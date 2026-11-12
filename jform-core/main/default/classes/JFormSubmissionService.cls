/**
 * The submission pipeline:
 *   check signature images (JFormSignatureService) -> one answer per table row (JFormTableService)
 *   and per name or address part (JFormFieldParts) ->
 *   validate (logic + required + JFormAnswerValidator) ->
 *   store submission, values and signature files -> create or update the target record from mapped answers ->
 *   publish Submitted__e.
 * A payment form stops after storing (PaymentHold): its record steps and Submitted__e run through
 * reprocess once the payment is confirmed (JFormPaymentService).
 *
 * Runs without sharing because it serves guest users. A target-record failure
 * never fails the respondent: the submission is stored with Status__c = Error
 * and Error_Message__c, and can be reprocessed from the Responses tab.
 */
public without sharing class JFormSubmissionService {

    public class SubmissionException extends Exception {}

    public class Result {
        @AuraEnabled public Id submissionId;
        @AuraEnabled public Id targetRecordId;
        @AuraEnabled public String status;
        @AuraEnabled public String errorMessage;
        /** Outcome of each record step when the form uses the Automate tab. */
        @AuraEnabled public List<JFormAutomationService.StepResult> steps;
    }

    /** Target-record strategy read from Settings_JSON__c.target */
    public class TargetSettings {
        public String strategy = 'create';   // create | update_or_create | none
        public String matchField;             // e.g. Email, used by update_or_create
    }

    public static TargetSettings targetSettings(JFormDefinition.Form def) {
        TargetSettings t = new TargetSettings();
        if (def.settings != null && def.settings.get('target') instanceof Map<String, Object>) {
            Map<String, Object> m = (Map<String, Object>) def.settings.get('target');
            if (m.get('strategy') != null) {
                t.strategy = String.valueOf(m.get('strategy'));
            }
            if (m.get('matchField') != null) {
                t.matchField = String.valueOf(m.get('matchField'));
            }
        }
        if (String.isBlank(def.targetObjectApiName)) {
            t.strategy = 'none';
        }
        return t;
    }

    // ------------------------------------------------------------ submit

    public static Result submit(Form__c form, JFormDefinition.Form def, Map<String, Object> answers, String sourceUrl) {
        return submit(form, def, answers, sourceUrl, null);
    }

    /**
     * With a spam verdict: a flagged response is still stored (answers included) under Status Spam
     * with the reasons, but no record steps run and no event is published.
     */
    public static Result submit(Form__c form, JFormDefinition.Form def, Map<String, Object> answers, String sourceUrl, JFormProtectionService.Verdict verdict) {
        return store(prepare(form, def, answers, sourceUrl, verdict), null);
    }

    /** A response that passed the checks and is ready to store. */
    public class Prepared {
        public Form__c form;
        public JFormDefinition.Form def;
        public Map<String, Object> answers;
        public String sourceUrl;
        public JFormProtectionService.Verdict verdict;
        public Boolean spam = false;
        public JFormSignatureService.Extracted signatures;
        public JFormLogicEvaluator.Result logic;
        /** Visible answerable fields, in form order. */
        public List<JFormDefinition.Field> toStore = new List<JFormDefinition.Field>();
        /** The promotion code the respondent applied, checked again when the response is priced. */
        public String promotionCode;
        /** The form's timing token, which the promotion code guessing limit counts wrong codes against. */
        public String timingToken;
    }

    /**
     * A payment the response waits for (JFormPaymentService): it is stored as Awaiting payment, and its
     * record steps and Submitted__e wait until the payment is confirmed.
     */
    public class PaymentHold {
        public Decimal amount;
        /** Awaiting payment, or Paid for a response a promotion code made free: stored at once, nothing to wait for. */
        public String status = JFormPaymentService.AWAITING;
    }

    /**
     * Everything submit() checks, without saving anything, so a payment form can call the gateway
     * before its first DML statement. Throws SubmissionException with what the respondent must fix.
     */
    public static Prepared prepare(Form__c form, JFormDefinition.Form def, Map<String, Object> answers, String sourceUrl, JFormProtectionService.Verdict verdict) {
        Prepared p = new Prepared();
        p.form = form;
        p.def = def;
        p.answers = answers;
        p.sourceUrl = sourceUrl;
        p.verdict = verdict;
        p.spam = verdict != null && verdict.spam == true;
        Boolean spam = p.spam;
        // signatures arrive as PNG data URLs: checked, and swapped for their file names, before anything else reads the answers
        p.signatures = JFormSignatureService.extract(def, answers);
        if (!p.signatures.problems.isEmpty() && !spam) {
            throw new SubmissionException('Please sign again: ' + String.join(p.signatures.problems, ', '));
        }
        // a table's answer object becomes one answer per row, "field.row", before logic reads the answers
        List<String> tableProblems = JFormTableService.expand(def, answers);
        // a Name or Address answer object becomes one answer per part, "field.part", and the whole value under the field key
        tableProblems.addAll(JFormFieldParts.expand(def, answers));
        if (!tableProblems.isEmpty() && !spam) {
            throw new SubmissionException('Please check: ' + String.join(tableProblems, '; '));
        }
        // the text typed under an Other choice stays only when its field picks Other
        JFormOtherChoice.tidy(def, answers);
        p.logic = JFormLogicEvaluator.evaluate(def, answers);

        List<String> missing = new List<String>();
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (JFormDefinition.LAYOUT_TYPES.contains(f.fieldType) || p.logic.visible.get(f.key) != true) {
                    continue;
                }
                if (p.logic.required.get(f.key) == true && JFormTableService.isTable(f)) {
                    String unanswered = JFormTableService.unanswered(f, answers);
                    if (unanswered != null) {
                        missing.add(unanswered);
                    }
                } else if (p.logic.required.get(f.key) == true && JFormFieldParts.isCompound(f)) {
                    String unanswered = JFormFieldParts.unanswered(f, answers);
                    if (unanswered != null) {
                        missing.add(unanswered);
                    }
                } else if (p.logic.required.get(f.key) == true && isEmpty(answers.get(f.key))) {
                    missing.add(String.isBlank(f.label) ? f.key : f.label);
                } else if (p.logic.required.get(f.key) == true) {
                    // a required field that picks Other needs what the respondent meant
                    String unanswered = JFormOtherChoice.unanswered(f, answers);
                    if (unanswered != null) {
                        missing.add(unanswered);
                    }
                }
                p.toStore.add(f);
            }
        }
        if (!missing.isEmpty() && !spam) {
            throw new SubmissionException('Please answer: ' + String.join(missing, ', '));
        }
        // the renderer checks these too, but a direct Apex or REST call skips it
        List<String> invalidAnswers = JFormAnswerValidator.findProblems(p.toStore, answers);
        if (!invalidAnswers.isEmpty() && !spam) {
            throw new SubmissionException('Please check: ' + String.join(invalidAnswers, '; '));
        }
        return p;
    }

    /** Store a prepared response, then run its record steps, unless it is spam or waits for a payment. */
    public static Result store(Prepared p, PaymentHold hold) {
        lastEventPublished = false;
        Form__c form = p.form;
        JFormDefinition.Form def = p.def;
        Map<String, Object> answers = p.answers;
        JFormProtectionService.Verdict verdict = p.verdict;
        Boolean spam = p.spam;
        List<JFormDefinition.Field> toStore = p.toStore;

        // The Payment block's answer is the server's figure, never the browser's: the total the response
        // waits for, or nothing when it owes nothing. Record steps map it like any other answer.
        JFormDefinition.Field block = JFormPaymentPricing.paymentField(def);
        if (block != null) {
            if (hold == null) {
                answers.remove(block.key);
            } else {
                answers.put(block.key, hold.amount);
            }
        }

        Set<Id> liveFieldIds = new Set<Id>();
        for (Form_Field_Definition__c fd : [SELECT Id FROM Form_Field_Definition__c WHERE Form__c = :form.Id]) {
            liveFieldIds.add(fd.Id);
        }

        // The form's name travels with the response: a form can be deleted, its responses stay reportable.
        String formName = String.isNotBlank(def.name) ? def.name : (form.isSet('Name') ? form.Name : null);
        Form_Submission__c submission = new Form_Submission__c(
            Form__c = form.Id,
            Form_Version__c = form.Current_Version__c,
            Form_Name__c = formName == null ? null : formName.left(80),
            Status__c = spam ? 'Spam' : 'New',
            Submission_Date_Time__c = System.now(),
            Source_URL__c = p.sourceUrl == null ? null : p.sourceUrl.left(2000),
            Answers_Hash__c = verdict == null ? null : verdict.answersHash,
            Captcha_Score__c = verdict == null ? null : verdict.captchaScore,
            Spam_Score__c = spam ? verdict.score : null,
            Spam_Reason__c = spam ? verdict.reason() : null,
            Payment_Status__c = hold == null || spam ? null : hold.status,
            Payment_Amount__c = hold == null || spam ? null : hold.amount
        );
        insert submission;

        List<Submission_Field_Value__c> values = new List<Submission_Field_Value__c>();
        for (JFormDefinition.Field f : toStore) {
            Id fid = asId(f.id);
            Id fieldDefinitionId = fid != null && liveFieldIds.contains(fid) ? fid : null;
            if (JFormFieldParts.isCompound(f)) {
                // the full name or one-line address for the Responses tab, then one value per filled part, so record
                // steps, filters and reprocessing work per part
                if (!isEmpty(answers.get(f.key))) {
                    values.add(fieldValue(submission.Id, f.key, f.label, answers.get(f.key), fieldDefinitionId));
                }
                for (JFormFieldParts.Part part : JFormFieldParts.storedParts(f)) {
                    Object partAnswer = answers.get(JFormFieldParts.answerKey(f, part));
                    if (!isEmpty(partAnswer)) {
                        values.add(fieldValue(submission.Id, JFormFieldParts.answerKey(f, part), JFormFieldParts.partLabel(f, part), partAnswer, fieldDefinitionId));
                    }
                }
                continue;
            }
            if (!JFormTableService.isTable(f)) {
                values.add(fieldValue(submission.Id, f.key, f.label, answers.get(f.key), fieldDefinitionId));
                // what the respondent typed under Other, as its own answer for record steps, filters and reprocessing
                if (JFormOtherChoice.offered(f) && !isEmpty(answers.get(JFormOtherChoice.answerKey(f)))) {
                    values.add(fieldValue(submission.Id, JFormOtherChoice.answerKey(f), JFormOtherChoice.answerLabel(f), answers.get(JFormOtherChoice.answerKey(f)), fieldDefinitionId));
                }
                continue;
            }
            // one value per answered row, so reports, filters and record steps work per row
            for (JFormTableService.Row row : JFormTableService.rows(f)) {
                Object rowAnswer = answers.get(JFormTableService.answerKey(f, row));
                if (!isEmpty(rowAnswer)) {
                    values.add(fieldValue(submission.Id, JFormTableService.answerKey(f, row), JFormTableService.rowLabel(f, row), rowAnswer, fieldDefinitionId));
                }
            }
        }
        if (!values.isEmpty()) {
            insert values;
        }
        if (spam) {
            // kept for review under the Spam filter; nothing else happens
            Result flagged = new Result();
            flagged.submissionId = submission.Id;
            flagged.status = 'Spam';
            flagged.errorMessage = verdict.reason();
            return flagged;
        }

        // Record steps see exactly what was stored: answers to fields hidden by logic are dropped here too.
        Map<String, Object> visibleAnswers = new Map<String, Object>();
        for (JFormDefinition.Field f : toStore) {
            List<String> keys = JFormTableService.answerKeys(f);
            if (JFormFieldParts.isCompound(f)) {
                keys.add(f.key); // the full name or one-line address, for {{key}} in record step text
            }
            for (String key : keys) {
                if (answers.containsKey(key)) {
                    visibleAnswers.put(key, answers.get(key));
                }
            }
        }
        // in this transaction, so a response never exists without the signatures it was sent with
        JFormSignatureService.store(submission.Id, p.signatures, visibleAnswers.keySet());
        if (hold != null) {
            // the record steps and Submitted__e wait for the payment (JFormPaymentService.apply)
            Result held = new Result();
            held.submissionId = submission.Id;
            held.status = 'New';
            return held;
        }
        Result r = processTarget(submission.Id, def, visibleAnswers, p.logic);
        JFormSignatureService.linkToRecord(def, submission.Id, r.targetRecordId);
        publishEvent(form, def, r);
        return r;
    }

    /** Re-run the target record step for an existing submission, using its stored values. */
    public static Result reprocess(Id submissionId) {
        Form_Submission__c sub = [
            SELECT Id, Form__c, Form_Version__c, Status__c, Payment_Status__c, Form_Version__r.Definition_JSON__c,
                Form__r.Current_Version__r.Definition_JSON__c, Form__r.Public_Key__c, Form__r.Name,
                (SELECT Field_Key__c, Field_Value__c FROM Submission_Field_Values__r),
                (SELECT Mode__c FROM Form_Payments__r WHERE Type__c = 'Payment' ORDER BY CreatedDate DESC LIMIT 1)
            FROM Form_Submission__c WHERE Id = :submissionId LIMIT 1
        ];
        if (sub.Status__c == 'Processed') {
            throw new SubmissionException('This response was already processed and its records exist. Only responses with an error can be reprocessed.');
        }
        if (sub.Status__c == 'Spam') {
            throw new SubmissionException('This response was flagged as spam and is kept for review only. Responses flagged as spam are not processed.');
        }
        if (sub.Payment_Status__c == JFormPaymentService.AWAITING) {
            throw new SubmissionException('This response is waiting for its payment. Its record steps run once the payment is confirmed.');
        }
        if (JFormPaymentService.UNPAID.contains(sub.Payment_Status__c)) {
            throw new SubmissionException('This response was not paid for (' + sub.Payment_Status__c + '), so its record steps do not run.');
        }
        String json = sub.Form_Version__r?.Definition_JSON__c;
        if (String.isBlank(json)) {
            json = sub.Form__r.Current_Version__r?.Definition_JSON__c;
        }
        if (String.isBlank(json)) {
            throw new SubmissionException('No published definition to reprocess against.');
        }
        JFormDefinition.Form def = JFormDefinition.parse(json);
        // the same rule as the steps job (JFormPaymentService.queueSteps): a test payment on a form that keeps test
        // payments out of its record steps never creates records, from the REST API, MCP or the agent either
        if (sub.Payment_Status__c != null && !sub.Form_Payments__r.isEmpty() && sub.Form_Payments__r[0].Mode__c == JFormPaymentService.TEST
            && !JFormPaymentService.settingsOf(def).testSteps) {
            throw new SubmissionException('This response was paid with a test payment, and the form keeps test payments out of its record steps (Settings > Payments).');
        }
        Map<String, Object> answers = new Map<String, Object>();
        for (Submission_Field_Value__c v : sub.Submission_Field_Values__r) {
            answers.put(v.Field_Key__c, v.Field_Value__c);
        }
        JFormLogicEvaluator.Result logic = JFormLogicEvaluator.evaluate(def, answers);
        Result r = processTarget(sub.Id, def, answers, logic);
        JFormSignatureService.linkToRecord(def, sub.Id, r.targetRecordId);
        Form__c form = new Form__c(Id = sub.Form__c, Public_Key__c = sub.Form__r.Public_Key__c, Name = sub.Form__r.Name);
        publishEvent(form, def, r);
        return r;
    }

    // ------------------------------------------------------------ target record

    @TestVisible
    private static Result processTarget(Id submissionId, JFormDefinition.Form def, Map<String, Object> answers, JFormLogicEvaluator.Result logic) {
        Result r = new Result();
        r.submissionId = submissionId;
        TargetSettings settings = targetSettings(def);
        Form_Submission__c subUpdate = new Form_Submission__c(Id = submissionId, Processed_Date__c = System.now());

        if (!JFormAutomationService.steps(def).isEmpty()) {
            return runSteps(r, subUpdate, def, answers);
        }

        if (settings.strategy == 'none') {
            r.status = 'Processed';
            subUpdate.Status__c = 'Processed';
            subUpdate.Error_Message__c = null;
            Database.update(subUpdate);
            return r;
        }

        Savepoint sp = Database.setSavepoint();
        try {
            Schema.SObjectType sobjType = JFormSchema.globalDescribe().get(def.targetObjectApiName);
            if (sobjType == null) {
                throw new SubmissionException('Target object "' + def.targetObjectApiName + '" does not exist.');
            }
            Map<String, Schema.SObjectField> fieldMap = sobjType.getDescribe().fields.getMap();
            SObject record = sobjType.newSObject();
            Integer mapped = 0;
            for (JFormDefinition.Section s : def.sections) {
                for (JFormDefinition.Field f : s.fields) {
                    if (String.isBlank(f.targetFieldApiName) || logic.visible.get(f.key) != true) {
                        continue;
                    }
                    Schema.SObjectField sf = fieldMap.get(f.targetFieldApiName.toLowerCase());
                    if (sf == null) {
                        continue; // field removed from the object since the form was built
                    }
                    Object value = coerce(sf.getDescribe(), answers.get(f.key));
                    if (value != null) {
                        record.put(sf, value);
                        mapped++;
                    }
                }
            }
            if (mapped == 0) {
                throw new SubmissionException('No answers are mapped to ' + def.targetObjectApiName + ' fields.');
            }

            Id existingId;
            if (settings.strategy == 'update_or_create' && String.isNotBlank(settings.matchField)) {
                Object matchValue = record.get(settings.matchField);
                if (matchValue != null) {
                    String soql = 'SELECT Id FROM ' + String.escapeSingleQuotes(def.targetObjectApiName)
                        + ' WHERE ' + String.escapeSingleQuotes(settings.matchField) + ' = :matchValue ORDER BY LastModifiedDate DESC LIMIT 1';
                    List<SObject> found = Database.query(soql);
                    if (!found.isEmpty()) {
                        existingId = found[0].Id;
                    }
                }
            }
            if (existingId != null) {
                record.put('Id', existingId);
                Database.update(record);
            } else {
                Database.insert(record);
            }
            r.targetRecordId = record.Id;
            r.status = 'Processed';
            subUpdate.Status__c = 'Processed';
            subUpdate.Target_Record_Id__c = record.Id;
            subUpdate.Error_Message__c = null;
        } catch (Exception e) {
            Database.rollback(sp);
            r.status = 'Error';
            r.errorMessage = e.getMessage();
            subUpdate.Status__c = 'Error';
            subUpdate.Error_Message__c = e.getMessage().left(4000);
        }
        Database.update(subUpdate);
        return r;
    }

    /** Record steps from the Automate tab: all or nothing, like the single target record. */
    private static Result runSteps(Result r, Form_Submission__c subUpdate, JFormDefinition.Form def, Map<String, Object> answers) {
        Form_Submission__c sub = [
            SELECT Source_URL__c, Submission_Date_Time__c, Payment_Status__c, Payment_Amount__c,
                (SELECT Payment_Reference__c, Currency__c, Code__c, Discount_Amount__c FROM Form_Payments__r WHERE Type__c = 'Payment' AND Status__c != :JFormPaymentService.AWAITING ORDER BY CreatedDate DESC LIMIT 1)
            FROM Form_Submission__c WHERE Id = :subUpdate.Id
        ];
        Form_Payment__c payment = sub.Form_Payments__r.isEmpty() ? null : sub.Form_Payments__r[0];
        Map<String, Object> info = new Map<String, Object>{
            'id' => subUpdate.Id,
            'formName' => def.name,
            'publicKey' => def.publicKey,
            'sourceUrl' => sub.Source_URL__c,
            'submittedAt' => sub.Submission_Date_Time__c == null ? null : sub.Submission_Date_Time__c.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
            'paymentStatus' => sub.Payment_Status__c,
            'paymentAmount' => sub.Payment_Amount__c,
            'paymentCurrency' => payment?.Currency__c,
            'paymentReference' => payment?.Payment_Reference__c,
            'promotionCode' => payment?.Code__c,
            'discountAmount' => payment == null || payment.Discount_Amount__c == null ? null : JFormPaymentPricing.toMajor(payment.Discount_Amount__c.longValue(), payment.Currency__c)
        };
        Savepoint sp = Database.setSavepoint();
        try {
            JFormAutomationService.RunResult run = JFormAutomationService.run(def, answers, info);
            r.targetRecordId = run.primaryId;
            r.steps = run.steps;
            r.status = 'Processed';
            subUpdate.Status__c = 'Processed';
            subUpdate.Target_Record_Id__c = run.primaryId;
            subUpdate.Action_Results_JSON__c = resultsJson(run.steps);
            subUpdate.Error_Message__c = null;
        } catch (Exception e) {
            Database.rollback(sp);
            r.status = 'Error';
            r.errorMessage = e.getMessage();
            subUpdate.Status__c = 'Error';
            subUpdate.Error_Message__c = e.getMessage().left(4000);
            subUpdate.Target_Record_Id__c = null;
            subUpdate.Action_Results_JSON__c = null;
        }
        Database.update(subUpdate);
        return r;
    }

    /** Convert an answer to the Salesforce field's type. Returns null when it cannot. */
    public static Object coerce(Schema.DescribeFieldResult d, Object raw) {
        if (raw == null) {
            return null;
        }
        String s = stringify(raw);
        if (String.isBlank(s)) {
            return null;
        }
        try {
            switch on d.getType() {
                when BOOLEAN {
                    String l = s.toLowerCase();
                    return l == 'true' || l == 'yes' || l == 'on' || l == '1';
                }
                when INTEGER {
                    return Integer.valueOf(Decimal.valueOf(s).intValue());
                }
                when DOUBLE, CURRENCY, PERCENT {
                    return Decimal.valueOf(s);
                }
                when DATE {
                    return Date.valueOf(s.left(10));
                }
                when DATETIME {
                    return s.length() <= 10 ? Datetime.newInstance(Date.valueOf(s), Time.newInstance(0, 0, 0, 0)) : (Datetime) JSON.deserialize('"' + s + '"', Datetime.class);
                }
                when MULTIPICKLIST {
                    return s.replace('; ', ';');
                }
                when REFERENCE {
                    return Id.valueOf(s);
                }
                when TIME {
                    // HH:mm, HH:mm:ss or HH:mm:ss.SSS, optionally with a trailing Z
                    List<String> parts = s.replace('Z', '').split(':');
                    Decimal seconds = parts.size() > 2 ? Decimal.valueOf(parts[2]) : 0;
                    Integer whole = seconds.intValue();
                    return Time.newInstance(Integer.valueOf(parts[0]), parts.size() > 1 ? Integer.valueOf(parts[1]) : 0, whole, ((seconds - whole) * 1000).intValue());
                }
                when LONG {
                    return Long.valueOf(s);
                }
                when BASE64, ADDRESS, LOCATION, ANYTYPE {
                    return null; // no sensible text form
                }
                when else {
                    Integer max = d.getLength();
                    return max > 0 && s.length() > max ? s.left(max) : s;
                }
            }
        } catch (Exception e) {
            return null;
        }
    }

    /** Step outcomes for the Responses tab; falls back to the essentials when labels and messages would overflow the field. */
    @TestVisible
    private static String resultsJson(List<JFormAutomationService.StepResult> steps) {
        Integer max = Form_Submission__c.Action_Results_JSON__c.getDescribe().getLength();
        String full = JSON.serialize(steps);
        if (full.length() <= max) {
            return full;
        }
        List<Map<String, Object>> compact = new List<Map<String, Object>>();
        for (JFormAutomationService.StepResult sr : steps) {
            compact.add(new Map<String, Object>{ 'key' => sr.key, 'objectApiName' => sr.objectApiName, 'outcome' => sr.outcome, 'recordId' => sr.recordId });
        }
        return JSON.serialize(compact).left(max);
    }

    // ------------------------------------------------------------ files

    /** Attach an uploaded file to a submission and note its name on the field value. */
    public static Id attachFile(Id submissionId, String fieldKey, String originalFileName, String base64Content) {
        // callers check the type with JFormUploadPolicy.problemWith; the stored name is always the cleaned one
        String fileName = JFormUploadPolicy.safeFileName(originalFileName);
        if (submissionId == null || String.isBlank(fileName) || String.isBlank(base64Content)) {
            throw new SubmissionException('submissionId, fileName and content are required.');
        }
        ContentVersion cv = new ContentVersion(
            Title = fileName.left(255),
            PathOnClient = fileName,
            // names the field, so its files can be counted against its limit (JFormPublicController.attachFile)
            Description = JFormUploadPolicy.description(fieldKey),
            VersionData = EncodingUtil.base64Decode(base64Content),
            Origin = 'H',
            IsMajorVersion = true
        );
        insert cv;
        Id documentId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id].ContentDocumentId;
        insert new ContentDocumentLink(ContentDocumentId = documentId, LinkedEntityId = submissionId, ShareType = 'V', Visibility = 'AllUsers');

        List<Submission_Field_Value__c> values = [
            SELECT Id, Field_Value__c FROM Submission_Field_Value__c
            WHERE Form_Submission__c = :submissionId AND Field_Key__c = :fieldKey LIMIT 1
        ];
        if (!values.isEmpty()) {
            String current = values[0].Field_Value__c;
            values[0].Field_Value__c = String.isBlank(current) ? fileName : (current.split('; ').contains(fileName) ? current : current + '; ' + fileName);
            values[0].Search_Text__c = JFormSearchBackfill.searchText(values[0].Field_Value__c);
            update values[0];
        }
        return documentId;
    }

    // ------------------------------------------------------------ event

    /** Whether the last Submitted__e publish succeeded; lets tests prove the event goes out. */
    @TestVisible
    private static Boolean lastEventPublished = false;

    private static void publishEvent(Form__c form, JFormDefinition.Form def, Result r) {
        lastEventPublished = false;
        try {
            // form may come from a narrow query: fall back to the definition rather than read an unqueried field
            String formName = String.isNotBlank(def.name) ? def.name : (form.isSet('Name') ? form.Name : null);
            String publicKey = form.isSet(Form__c.Public_Key__c) ? form.Public_Key__c : def.publicKey;
            Database.SaveResult sr = EventBus.publish(new Submitted__e(
                Form_Id__c = form.Id,
                Form_Name__c = formName,
                Public_Key__c = publicKey,
                Submission_Id__c = r.submissionId,
                Target_Record_Id__c = r.targetRecordId,
                Status__c = r.status
            ));
            lastEventPublished = sr.isSuccess();
            if (!sr.isSuccess()) {
                System.debug(LoggingLevel.WARN, 'Submitted__e publish failed: ' + sr.getErrors());
            }
        } catch (Exception e) {
            // Event delivery must never break a submission; the submission record is the source of truth.
            System.debug(LoggingLevel.WARN, 'Submitted__e publish failed: ' + e.getMessage());
        }
    }

    // ------------------------------------------------------------ helpers

    public static Boolean isEmpty(Object v) {
        if (v == null) {
            return true;
        }
        if (v instanceof List<Object>) {
            return ((List<Object>) v).isEmpty();
        }
        return String.isBlank(String.valueOf(v));
    }

    public static String stringify(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof List<Object>) {
            List<String> parts = new List<String>();
            for (Object o : (List<Object>) v) {
                if (o != null) {
                    parts.add(String.valueOf(o));
                }
            }
            return String.join(parts, '; ');
        }
        if (v instanceof Map<String, Object>) {
            return JSON.serialize(v);
        }
        return String.valueOf(v);
    }

    private static Submission_Field_Value__c fieldValue(Id submissionId, String key, String label, Object answer, Id fieldDefinitionId) {
        return new Submission_Field_Value__c(
            Form_Submission__c = submissionId,
            Field_Key__c = key,
            Field_Label__c = label,
            Field_Value__c = stringify(answer),
            Search_Text__c = JFormSearchBackfill.searchText(stringify(answer)),
            Form_Field_Definition__c = fieldDefinitionId
        );
    }

    private static Id asId(String s) {
        if (String.isBlank(s) || !(s.length() == 15 || s.length() == 18)) {
            return null;
        }
        try {
            return Id.valueOf(s);
        } catch (Exception e) {
            return null;
        }
    }
}
