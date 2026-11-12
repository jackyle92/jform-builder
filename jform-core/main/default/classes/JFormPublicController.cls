/**
 * Guest-facing controller for the public renderer. Deliberately `without sharing`
 * and system mode: respondents never read the normalized objects, only the
 * published snapshot, and can only insert submissions.
 */
public without sharing class JFormPublicController {

    /** Answer key the renderer uses for its invisible honeypot field; a value there means a bot filled the form. */
    public static final String HONEYPOT_KEY = '__jf_honeypot';
    /** Answer key carrying the timing token from startSubmission(). */
    public static final String TIMING_ANSWER_KEY = '__jf_token';
    /** Answer key carrying the reCAPTCHA v3 token. */
    public static final String CAPTCHA_KEY = '__jf_captcha';
    /** Answer key carrying the promotion code the respondent applied in the Payment block. */
    public static final String CODE_KEY = '__jf_code';
    /** 3 MB of file content, as base64. */
    @TestVisible private static Integer maxFileBase64 = 4 * 1024 * 1024;
    @TestVisible private static Integer maxFilesPerSubmission = 10;
    /** Files can only be attached shortly after a submission was created. */
    private static final Integer ATTACH_WINDOW_MINUTES = 30;

    /** Returns what the renderer needs of the published definition for a public key, or throws if the form is not live. */
    @AuraEnabled(cacheable=true)
    public static String getPublishedDefinition(String publicKey) {
        Form__c form = findLiveForm(publicKey);
        JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
        enforceAccess(form, def);
        // whether to load reCAPTCHA, and the public site key, ride along next to the stripped definition
        Map<String, Object> protection = JFormProtectionService.publicView(def);
        // footer button text and the welcome and thank-you screens live in settings, which stay private:
        // only their cleaned, visible parts go out
        Map<String, String> buttonLabels = buttonLabels(def.settings);
        Map<String, Object> welcome = JFormScreens.welcomeView(def);
        Map<String, Object> ending = JFormScreens.endingView(def);
        // mode, currency and where respondents pay; prices stay in the Payment block, worked out again on the server
        Map<String, Object> payments = JFormPaymentService.publicView(def);
        // this answer is cached: past its closing time a copy kept by the browser or the site's CDN asks again
        Datetime closesAt = JFormAvailability.closesAt(def);
        // whether a refused submission may mean the form has closed since, so the renderer asks for its closed screen
        Boolean mayClose = JFormAvailability.mayClose(def);
        Map<String, Object> view = JFormDefinition.toMap(publicView(def));
        view.put('protection', protection);
        if (closesAt != null) {
            view.put('closesAt', closesAt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''));
        }
        if (buttonLabels != null) {
            view.put('buttonLabels', buttonLabels);
        }
        view.put('welcome', welcome);
        if (ending != null) {
            view.put('ending', ending);
        }
        if (payments != null) {
            view.put('payments', payments);
        }
        if (mayClose) {
            view.put('mayClose', true);
        }
        // the countries the form's Address fields offer, with their states where the org lists them
        JFormAddressService.Lists addressLists = JFormAddressService.listsFor(def);
        if (addressLists != null) {
            view.put('addressLists', addressLists);
        }
        return JSON.serialize(view);
    }

    /**
     * The screen the public form shows instead of its questions while it isn't taking responses: the cleaned
     * not-yet-open or closed screen, when it opens, the form's name and its design, and its thank-you screen for
     * a respondent back from paying after it shut. Never the questions. Null while the form takes responses.
     * Not cacheable, so a form that has opened since is never shown shut.
     */
    @AuraEnabled
    public static String getAvailabilityScreen(String publicKey) {
        Form__c form = findLiveForm(publicKey);
        JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
        String state = availabilityOf(form, def);
        if (state == null) {
            return null;
        }
        Map<String, Object> view = JFormAvailability.publicView(def, state);
        view.put('name', def.name);
        view.put('label', def.label);
        view.put('theme', def.theme);
        view.put('thankYouMessage', def.thankYouMessage);
        view.put('ending', JFormScreens.endingView(def));
        return JSON.serialize(view, true);
    }

    /**
     * Called by the renderer once a form is shown: a signed stamp of that moment, sent back with
     * the answers so a submission that arrives seconds later can be told from a human's.
     * Not cacheable on purpose. Null when the org has no signing key yet.
     */
    @AuraEnabled
    public static String startSubmission(String publicKey) {
        Form__c form = findLiveForm(publicKey);
        return JFormProtectionService.issueToken(form.Public_Key__c);
    }

    private static final List<String> BUTTON_KEYS = new List<String>{ 'submit', 'next', 'back' };
    private static final Integer BUTTON_LABEL_MAX = 40;

    /** settings.buttons as plain text: known keys only, spaces collapsed, at most 40 characters; null when none is set. */
    @TestVisible
    private static Map<String, String> buttonLabels(Map<String, Object> settings) {
        if (settings == null || !(settings.get('buttons') instanceof Map<String, Object>)) {
            return null;
        }
        Map<String, Object> raw = (Map<String, Object>) settings.get('buttons');
        Map<String, String> labels = new Map<String, String>();
        for (String key : BUTTON_KEYS) {
            Object value = raw.get(key);
            if (value instanceof String) {
                String text = ((String) value).normalizeSpace();
                if (String.isNotBlank(text)) {
                    labels.put(key, text.left(BUTTON_LABEL_MAX));
                }
            }
        }
        return labels.isEmpty() ? null : labels;
    }

    /**
     * The renderer reads labels, fields, rules, theme, messages and the public key. Record steps,
     * object mappings, publishing settings and record Ids stay inside the org.
     */
    @TestVisible
    private static JFormDefinition.Form publicView(JFormDefinition.Form def) {
        def.id = null;
        def.settings = null;
        def.targetObjectApiName = null;
        for (JFormDefinition.Section s : def.sections) {
            s.id = null;
            for (JFormDefinition.Field f : s.fields) {
                f.id = null;
                f.targetObjectApiName = null;
                f.targetFieldApiName = null;
                if (f.options != null) {
                    for (JFormDefinition.Option o : f.options) {
                        o.id = null;
                    }
                }
            }
        }
        return def;
    }

    /**
     * Accepts answers keyed by field key. Hidden fields are dropped and required
     * fields enforced server side, the target record is created or updated, and
     * Submitted__e is published. Returns the submission Id.
     */
    @AuraEnabled
    public static Id submit(String publicKey, String answersJson) {
        return submitWithSource(publicKey, answersJson, null);
    }

    @AuraEnabled
    public static Id submitWithSource(String publicKey, String answersJson, String sourceUrl) {
        return submitInternal(publicKey, answersJson, sourceUrl, false);
    }

    /** For authenticated callers (the REST API): the spam checks meant for anonymous respondents are skipped, the honeypot is not. */
    public static Id submitTrusted(String publicKey, String answersJson, String sourceUrl) {
        return submitInternal(publicKey, answersJson, sourceUrl, true);
    }

    private static Id submitInternal(String publicKey, String answersJson, String sourceUrl, Boolean trusted) {
        Form__c form = findLiveForm(publicKey);
        JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
        enforceAccess(form, def);
        Incoming incoming = read(answersJson, trusted);
        // the verdict may call reCAPTCHA, so it comes before the savepoint and any DML
        JFormProtectionService.Verdict verdict = JFormProtectionService.evaluate(form, def, incoming.answers, incoming.ctx);
        Savepoint sp = Database.setSavepoint();
        try {
            JFormSubmissionService.Prepared prepared = JFormSubmissionService.prepare(form, def, incoming.answers, sourceUrl, verdict);
            if (JFormPaymentService.owes(prepared)) {
                // only the Pay button opens a checkout; no path stores a response that skipped its payment
                throw new JFormSubmissionService.SubmissionException(PAY_FIRST);
            }
            // a flagged response is stored as Spam and still returns an Id: a bot sees success, a person's mistake stays reviewable
            return JFormSubmissionService.store(prepared, null).submissionId;
        } catch (JFormSubmissionService.SubmissionException e) {
            Database.rollback(sp);
            throw aura(e.getMessage());
        } catch (Exception e) {
            Database.rollback(sp);
            // Internal detail (object names, validation rules, limits) stays in the log.
            System.debug(LoggingLevel.ERROR, 'JForm submit failed for ' + publicKey + ': ' + e.getTypeName() + ': ' + e.getMessage());
            throw aura('Your answers could not be saved. Please try again.');
        }
    }

    @TestVisible private static final String PAY_FIRST = 'This form takes a payment, so responses can only be sent with its Pay button.';

    /**
     * The Pay button of a payment form. The answers are checked and priced on the server, the response
     * is stored as Awaiting payment, and the renderer sends the respondent to the returned checkout
     * address, in a popup or on the gateway's page. Its record steps run once the payment is confirmed.
     * returnUrl is the form's own page on the site, where the gateway sends the respondent back.
     * A response that owes nothing, or was flagged as spam, is stored at once and gets no checkout.
     */
    @AuraEnabled
    public static JFormPaymentService.Started submitWithPayment(String publicKey, String answersJson, String sourceUrl, String returnUrl) {
        Form__c form = findLiveForm(publicKey);
        JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
        enforceAccess(form, def);
        Incoming incoming = read(answersJson, false);
        incoming.answers.remove(ATTEMPT_KEY);
        // callouts first (reCAPTCHA, then the checkout inside JFormPaymentService.submit), DML after
        JFormProtectionService.Verdict verdict = JFormProtectionService.evaluate(form, def, incoming.answers, incoming.ctx);
        try {
            JFormSubmissionService.Prepared prepared = JFormSubmissionService.prepare(form, def, incoming.answers, sourceUrl, verdict);
            prepared.promotionCode = incoming.promotionCode;
            prepared.timingToken = incoming.ctx.token;
            return JFormPaymentService.submit(prepared, returnUrl);
        } catch (JFormSubmissionService.SubmissionException e) {
            throw aura(e.getMessage());
        } catch (JFormPaymentPricing.PricingException e) {
            throw aura(e.getMessage());
        } catch (JFormPaymentService.PaymentException e) {
            System.debug(LoggingLevel.ERROR, 'JForm checkout failed for ' + publicKey + ': ' + e.getMessage());
            throw aura(e.getMessage() == JFormPaymentService.NOT_TAKING || e.getMessage().startsWith('This form can take payments only')
                ? e.getMessage()
                : 'The payment page could not be opened. Please try again.');
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'JForm pay and submit failed for ' + publicKey + ': ' + e.getTypeName() + ': ' + e.getMessage());
            throw aura('Your answers could not be saved. Please try again.');
        }
    }

    /**
     * The Payment block's Apply button: whether a promotion code can be used on this form now, with its
     * terms when it can. Only valid or not goes back; why a code was refused stays on the server, so
     * nobody learns which codes exist by trying. Needs the form's timing token from startSubmission(),
     * so only a loaded form can ask; where the org has no signing key, nothing can be checked and the
     * form is trusted as it is for submissions. Refused codes count towards the guessing limit
     * (JFormPromotionCodeService.checkLimited), past which every code is refused for a while.
     */
    @AuraEnabled
    public static Map<String, Object> checkPromotionCode(String publicKey, String code, String token) {
        Form__c form = findLiveForm(publicKey);
        Map<String, Object> refused = new Map<String, Object>{ 'valid' => false };
        String timing = JFormProtectionService.verifyToken(token, form.Public_Key__c, 0);
        if (timing != 'ok' && timing != 'unverifiable') {
            return refused;
        }
        JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
        JFormPaymentService.FormSettings settings = JFormPaymentService.settingsOf(def);
        if (settings.codes != JFormPromotionCodeService.JFORM || !JFormPaymentService.isPaymentForm(def)) {
            return refused;
        }
        JFormPromotionCodeService.Verdict v = JFormPromotionCodeService.checkLimited(form.Id, settings.currencyCode, code, token);
        if (!v.valid) {
            return refused;
        }
        return new Map<String, Object>{
            'valid' => true,
            'code' => v.code,
            'discountType' => v.discountType,
            'percentOff' => v.percentOff,
            'amountOff' => v.amountOff,
            // the renderer prices with it, so a code never shows a total the checkout would raise
            'minimumCharge' => JFormPaymentPricing.minimumCharge(settings.currencyCode)
        };
    }

    /**
     * The status of one of this form's checkouts as a word (open, processing, paid, failed, expired,
     * unknown), for the popup's checks and the return page. Takes only the form key and the gateway's
     * checkout reference; returns nothing about the response. With confirm, an open checkout is read
     * from the gateway first.
     */
    @AuraEnabled
    public static String getPaymentStatus(String publicKey, String checkoutReference, Boolean confirm) {
        try {
            return JFormPaymentService.publicStatus(publicKey, checkoutReference, confirm);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'JForm payment status failed: ' + e.getTypeName() + ': ' + e.getMessage());
            throw aura('The payment could not be checked. Please try again.');
        }
    }

    /** The respondent left the checkout without paying: it is ended, and the unpaid response becomes Expired. */
    @AuraEnabled
    public static String cancelPayment(String publicKey, String checkoutReference) {
        try {
            return JFormPaymentService.cancel(publicKey, checkoutReference);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'JForm payment cancel failed: ' + e.getTypeName() + ': ' + e.getMessage());
            throw aura('The payment could not be cancelled. Please try again.');
        }
    }

    /** Dropped from the answers: renderers published before 1.1 sent the Pay click's attempt ID under this key. */
    public static final String ATTEMPT_KEY = '__jf_attempt';

    /** The answers, and what the renderer sent about the respondent, which is never stored as answers. */
    private class Incoming {
        Map<String, Object> answers = new Map<String, Object>();
        JFormProtectionService.Context ctx = new JFormProtectionService.Context();
        String promotionCode;
    }

    private static Incoming read(String answersJson, Boolean trusted) {
        Incoming i = new Incoming();
        if (String.isNotBlank(answersJson)) {
            Object raw = JSON.deserializeUntyped(answersJson);
            if (raw instanceof Map<String, Object>) {
                i.answers = (Map<String, Object>) raw;
            }
        }
        i.ctx.trusted = trusted;
        Object trap = i.answers.remove(HONEYPOT_KEY);
        i.ctx.honeypotFilled = trap != null && String.isNotBlank(String.valueOf(trap));
        Object token = i.answers.remove(TIMING_ANSWER_KEY);
        i.ctx.token = token == null ? null : String.valueOf(token);
        Object captcha = i.answers.remove(CAPTCHA_KEY);
        i.ctx.captchaToken = captcha == null ? null : String.valueOf(captcha);
        Object code = i.answers.remove(CODE_KEY);
        i.promotionCode = code == null ? null : String.valueOf(code);
        return i;
    }

    /**
     * Attach a file (base64, up to 3 MB or the field's maximum size) to a file upload field of a submission
     * created by submit() in the last half hour. At most ten files per submission, and no more than the field's maximum files.
     */
    @AuraEnabled
    public static Id attachFile(String publicKey, Id submissionId, String fieldKey, String fileName, String base64Content) {
        Form__c form = findLiveForm(publicKey);
        Datetime since = System.now().addMinutes(-ATTACH_WINDOW_MINUTES);
        List<Form_Submission__c> owned = [
            SELECT Id, Status__c FROM Form_Submission__c
            WHERE Id = :submissionId AND Form__c = :form.Id AND Submission_Date_Time__c >= :since
            LIMIT 1
        ];
        if (owned.isEmpty()) {
            throw aura('Unknown submission.');
        }
        if (owned[0].Status__c == 'Spam') {
            return null; // flagged responses keep no files; looks like success to the caller
        }
        JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
        JFormDefinition.Field field = String.isBlank(fieldKey) ? null : def.fieldsByKey().get(fieldKey);
        if (field == null || field.fieldType != 'fileupload') {
            throw aura('Files can only be attached to a file upload field.');
        }
        String fileProblem = JFormUploadPolicy.problemWith(field, fileName);
        if (fileProblem != null) {
            throw aura(fileProblem);
        }
        Integer maxSizeMb = JFormUploadPolicy.maxSizeMb(field);
        if (base64Content == null || base64Content.length() > Math.min(maxFileBase64, base64LengthOf(maxSizeMb))) {
            throw aura('Files must be ' + maxSizeMb + ' MB or smaller.');
        }
        // signature images are saved with the response and do not count toward the upload limit
        List<ContentDocumentLink> links = [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :submissionId WITH SYSTEM_MODE];
        Integer uploaded = links.size() - JFormSignatureService.countOn(submissionId);
        if (uploaded >= maxFilesPerSubmission) {
            throw aura('No more than ' + maxFilesPerSubmission + ' files can be attached to a response.');
        }
        Integer maxFiles = JFormUploadPolicy.maxFiles(field);
        if (maxFiles < JFormUploadPolicy.MAX_FILES && filesOnField(fieldKey, links) >= maxFiles) {
            throw aura(maxFiles == 1 ? 'Only one file can be attached to this field.' : 'No more than ' + maxFiles + ' files can be attached to this field.');
        }
        try {
            return JFormSubmissionService.attachFile(submissionId, fieldKey, fileName, base64Content);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'JForm attachFile failed: ' + e.getMessage());
            throw aura('The file could not be attached.');
        }
    }

    /** Length of the base64 text for a file of this many MB. */
    private static Integer base64LengthOf(Integer megabytes) {
        return (megabytes * 1024 * 1024 + 2) / 3 * 4;
    }

    /** Files already attached to one field of a submission: those whose Description names it (JFormUploadPolicy.description). */
    private static Integer filesOnField(String fieldKey, List<ContentDocumentLink> links) {
        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink link : links) {
            documentIds.add(link.ContentDocumentId);
        }
        Integer count = 0;
        // Description cannot be filtered in SOQL, so it is read here
        for (ContentVersion cv : [SELECT Description FROM ContentVersion WHERE ContentDocumentId IN :documentIds AND IsLatest = true WITH SYSTEM_MODE]) {
            if (fieldKey.equals(JFormUploadPolicy.fieldKeyOf(cv.Description))) {
                count++;
            }
        }
        return count;
    }

    /**
     * Throws what the respondent should read while the form isn't taking responses: before its opening time,
     * after its closing time, or once it is full (JFormAvailability).
     */
    @TestVisible
    private static void enforceAccess(Form__c form, JFormDefinition.Form def) {
        String state = availabilityOf(form, def);
        if (state != null) {
            throw aura(JFormAvailability.messageFor(def, state));
        }
    }

    /** JFormAvailability.NOT_OPEN or CLOSED while the form isn't taking responses, null while it is. */
    private static String availabilityOf(Form__c form, JFormDefinition.Form def) {
        String state = JFormAvailability.stateOf(def, Datetime.now());
        if (state != null) {
            return state;
        }
        Integer lim = JFormAvailability.responseLimit(def);
        if (lim != null) {
            // checkouts that expired or failed hold no place; one still open does
            Set<String> ended = JFormPaymentService.ENDED;
            Integer n = [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :form.Id AND Status__c != 'Spam' AND Payment_Status__c NOT IN :ended];
            if (n >= lim) {
                return JFormAvailability.CLOSED;
            }
        }
        return null;
    }

    /** AuraHandledException shows "Script-thrown exception" unless the message is set explicitly. */
    private static AuraHandledException aura(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }

    private static Form__c findLiveForm(String publicKey) {
        if (String.isBlank(publicKey)) {
            throw aura('This form is not available.');
        }
        List<Form__c> forms = [
            SELECT Id, Name, Public_Key__c, Is_Active__c, Status__c, Current_Version__c, Current_Version__r.Definition_JSON__c
            FROM Form__c
            WHERE Public_Key__c = :publicKey
            LIMIT 1
        ];
        if (forms.isEmpty() || forms[0].Is_Active__c != true || forms[0].Current_Version__c == null
            || String.isBlank(forms[0].Current_Version__r.Definition_JSON__c)) {
            throw aura('This form is not available.');
        }
        return forms[0];
    }
}
