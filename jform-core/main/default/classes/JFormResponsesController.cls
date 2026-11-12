/**
 * Data for the Responses tab: counts, per-choice summaries, a paged table,
 * CSV export and reprocessing of failed target records.
 */
public with sharing class JFormResponsesController {

    public class Summary {
        @AuraEnabled public Integer total = 0;
        @AuraEnabled public Integer last7Days = 0;
        @AuraEnabled public Integer processed = 0;
        @AuraEnabled public Integer errors = 0;
        /** Responses flagged as spam; not part of total. */
        @AuraEnabled public Integer spam = 0;
        @AuraEnabled public Integer withTargetRecord = 0;
        @AuraEnabled public List<ChoiceSummary> choices = new List<ChoiceSummary>();
        /**
         * Payment forms: responses paid for as the table shows them by default (no test payments on a form taking live
         * payments), those still unpaid (left out of the counts above), and live money collected per currency, net of refunds.
         */
        @AuraEnabled public Boolean payments = false;
        @AuraEnabled public Integer paid = 0;
        @AuraEnabled public Integer unpaid = 0;
        @AuraEnabled public List<MoneyTotal> collected = new List<MoneyTotal>();
    }

    public class MoneyTotal {
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Decimal amount;
    }

    public class ChoiceSummary {
        @AuraEnabled public String fieldKey;
        @AuraEnabled public String label;
        @AuraEnabled public List<ChoiceCount> counts = new List<ChoiceCount>();
    }

    public class ChoiceCount {
        @AuraEnabled public String value;
        @AuraEnabled public Integer count = 0;
    }

    public class Row {
        @AuraEnabled public Id id;
        @AuraEnabled public Datetime submittedAt;
        @AuraEnabled public String status;
        @AuraEnabled public String targetRecordId;
        @AuraEnabled public String errorMessage;
        @AuraEnabled public String spamReason;
        @AuraEnabled public Decimal spamScore;
        @AuraEnabled public String actionResults;
        @AuraEnabled public List<String> cells = new List<String>();
        /** Payment forms: Payment_Status__c, the amount, and the payment's mode (Test or Live) and link in the gateway. */
        @AuraEnabled public String paymentStatus;
        @AuraEnabled public Decimal paymentAmount;
        @AuraEnabled public String paymentCurrency;
        @AuraEnabled public String paymentMode;
        @AuraEnabled public String paymentUrl;
        /** What the form priced, when the gateway charged another amount or currency (JFormPaymentService.transition). */
        @AuraEnabled public Decimal paymentExpected;
        @AuraEnabled public String paymentExpectedCurrency;
        /** The promotion code used and what it took off, in the main unit. */
        @AuraEnabled public String promotionCode;
        @AuraEnabled public Decimal discountAmount;
    }

    public class ResultPage {
        @AuraEnabled public List<String> columns = new List<String>();
        @AuraEnabled public List<String> columnKeys = new List<String>();
        @AuraEnabled public List<Row> rows = new List<Row>();
        @AuraEnabled public Integer total = 0;
        /** Every answer field of the form, for the "filter by field" control. */
        @AuraEnabled public List<FilterField> fields = new List<FilterField>();
    }

    public class FilterField {
        @AuraEnabled public String key;
        @AuraEnabled public String label;
        /** Choices for choice fields; empty for free text. */
        @AuraEnabled public List<String> options = new List<String>();
    }

    /** Paid, including refunded later: the response counts. */
    private static final Set<String> PAID_STATUSES = new Set<String>{ JFormPaymentService.PAID, JFormPaymentService.PARTIALLY_REFUNDED, JFormPaymentService.REFUNDED };
    /** The payment filter's values besides blank; the Responses tab, the export and the REST API share them. */
    public static final Set<String> PAYMENT_FILTERS = new Set<String>{ 'paid', 'unpaid', 'test' };
    private static final Set<String> CHOICE_TYPES = new Set<String>{ 'picklist', 'radio', 'multiselect', 'checkboxes', 'yesno', 'nps', 'rating', 'consent', 'checkbox' };

    @AuraEnabled
    public static Summary getSummary(Id formId) {
        try {
            Summary s = new Summary();
            Datetime weekAgo = System.now().addDays(-7);
            JFormDefinition.Form def = JFormDefinitionService.load(formId);
            // the tiles and the charts count what the Responses table shows by default (paymentClause): a response
            // whose payment never arrived only in "unpaid", and on a form taking live payments no test payments
            Map<String, Object> binds = new Map<String, Object>{ 'formId' => formId, 'weekAgo' => weekAgo };
            String inView = 'Form__c = :formId AND ' + paymentClause(def, null, binds);
            for (AggregateResult ar : (List<AggregateResult>) Database.queryWithBinds(
                'SELECT Status__c st, COUNT(Id) n FROM Form_Submission__c WHERE ' + inView + ' GROUP BY Status__c', binds, AccessLevel.USER_MODE
            )) {
                Integer n = (Integer) ar.get('n');
                if (ar.get('st') == 'Spam') {
                    s.spam += n;
                    continue;
                }
                s.total += n;
                if (ar.get('st') == 'Processed') {
                    s.processed += n;
                }
                if (ar.get('st') == 'Error') {
                    s.errors += n;
                }
            }
            s.last7Days = Database.countQueryWithBinds(
                'SELECT COUNT() FROM Form_Submission__c WHERE ' + inView + ' AND Submission_Date_Time__c >= :weekAgo AND Status__c != \'Spam\'', binds, AccessLevel.USER_MODE
            );
            s.withTargetRecord = Database.countQueryWithBinds(
                'SELECT COUNT() FROM Form_Submission__c WHERE ' + inView + ' AND Target_Record_Id__c != null AND Status__c != \'Spam\'', binds, AccessLevel.USER_MODE
            );
            summarisePayments(s, formId, def, inView, binds);

            Set<String> choiceKeys = new Set<String>();
            Map<String, ChoiceSummary> byKey = new Map<String, ChoiceSummary>();
            for (JFormDefinition.Section sec : def.sections) {
                for (JFormDefinition.Field f : sec.fields) {
                    // a table is stored one value per row, so each row gets its own summary
                    for (JFormTableService.Row row : JFormTableService.isTable(f) ? JFormTableService.rows(f) : new List<JFormTableService.Row>()) {
                        ChoiceSummary cs = new ChoiceSummary();
                        cs.fieldKey = JFormTableService.answerKey(f, row);
                        cs.label = JFormTableService.rowLabel(f, row);
                        byKey.put(cs.fieldKey, cs);
                        choiceKeys.add(cs.fieldKey);
                    }
                    if (CHOICE_TYPES.contains(f.fieldType)) {
                        ChoiceSummary cs = new ChoiceSummary();
                        cs.fieldKey = f.key;
                        cs.label = f.label;
                        byKey.put(f.key, cs);
                        choiceKeys.add(f.key);
                    }
                }
            }
            if (!choiceKeys.isEmpty()) {
                Map<String, Map<String, Integer>> counts = new Map<String, Map<String, Integer>>();
                Map<String, Object> valueBinds = new Map<String, Object>{ 'formId' => formId, 'choiceKeys' => choiceKeys };
                for (Submission_Field_Value__c v : (List<Submission_Field_Value__c>) Database.queryWithBinds(
                    'SELECT Field_Key__c, Field_Value__c FROM Submission_Field_Value__c'
                        + ' WHERE Form_Submission__r.Form__c = :formId AND Field_Key__c IN :choiceKeys AND Form_Submission__r.Status__c != \'Spam\' AND '
                        + paymentClause(JFormPaymentService.takesLivePayments(def), null, valueBinds, 'Form_Submission__c', 'Form_Submission__r.Payment_Status__c') + ' LIMIT 10000',
                    valueBinds, AccessLevel.USER_MODE
                )) {
                    if (!counts.containsKey(v.Field_Key__c)) {
                        counts.put(v.Field_Key__c, new Map<String, Integer>());
                    }
                    Map<String, Integer> m = counts.get(v.Field_Key__c);
                    if (String.isBlank(v.Field_Value__c)) {
                        continue;
                    }
                    for (String part : v.Field_Value__c.split('; ')) {
                        String p = part.trim();
                        if (p == '') {
                            continue;
                        }
                        m.put(p, (m.containsKey(p) ? m.get(p) : 0) + 1);
                    }
                }
                for (String key : byKey.keySet()) {
                    Map<String, Integer> m = counts.get(key);
                    if (m == null) {
                        continue;
                    }
                    ChoiceSummary cs = byKey.get(key);
                    List<String> vals = new List<String>(m.keySet());
                    vals.sort();
                    for (String val : vals) {
                        ChoiceCount cc = new ChoiceCount();
                        cc.value = val;
                        cc.count = m.get(val);
                        cs.counts.add(cc);
                    }
                    s.choices.add(cs);
                }
            }
            return s;
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /**
     * Paid and unpaid counts, and live payments collected per currency (net of refunds). The Paid tile counts the
     * paid responses the table shows by default; the Unpaid tile counts every unpaid response, as the Unpaid filter
     * shows them; test payments are left out of the money. The tiles appear once any response has a payment status.
     */
    private static void summarisePayments(Summary s, Id formId, JFormDefinition.Form def, String inView, Map<String, Object> binds) {
        s.payments = [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :formId AND Payment_Status__c != null AND Status__c != 'Spam' WITH USER_MODE] > 0;
        if (!s.payments) {
            return;
        }
        s.unpaid = Database.countQueryWithBinds(
            'SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :formId AND ' + paymentClause(def, 'unpaid', binds) + ' AND Status__c != \'Spam\'', binds, AccessLevel.USER_MODE
        );
        s.paid = Database.countQueryWithBinds(
            'SELECT COUNT() FROM Form_Submission__c WHERE ' + inView + ' AND Payment_Status__c != null AND Status__c != \'Spam\'', binds, AccessLevel.USER_MODE
        );
        for (AggregateResult ar : [
            SELECT Currency__c cur, SUM(Amount__c) amount, SUM(Amount_Refunded__c) refunded FROM Form_Payment__c
            WHERE Form__c = :formId AND Type__c = 'Payment' AND Mode__c = :JFormPaymentService.LIVE AND Status__c IN :PAID_STATUSES
            WITH USER_MODE GROUP BY Currency__c
        ]) {
            MoneyTotal t = new MoneyTotal();
            t.currencyCode = (String) ar.get('cur');
            Decimal amount = (Decimal) ar.get('amount');
            Decimal refunded = (Decimal) ar.get('refunded');
            Long net = (amount == null ? 0 : amount.longValue()) - (refunded == null ? 0 : refunded.longValue());
            t.amount = JFormPaymentPricing.toMajor(net, t.currencyCode);
            s.collected.add(t);
        }
    }

    /** One page of submissions. Columns are the first `maxColumns` answer-collecting fields of the form. */
    /**
     * One page of responses. `search` matches any answer (substring, case-insensitive) or the
     * submission number; `fromDate`/`toDate` bound the submission date; `fieldKey` + `fieldValue`
     * match one answer. Filters combine. Spam is left out of "all statuses" and has its own value.
     * `payment` blank shows paid responses and responses without a payment, leaving out unpaid ones and,
     * on a form that takes live payments, test payments; paid, unpaid and test show only those.
     */
    @AuraEnabled
    public static ResultPage getSubmissions(Id formId, Integer pageSize, Integer offset, Integer maxColumns, String status,
                                            String search, Date fromDate, Date toDate, String fieldKey, String fieldValue, String payment, String code) {
        try {
            ResultPage p = new ResultPage();
            Integer size = pageSize == null ? 25 : Math.min(Math.max(pageSize, 1), 200);
            Integer skip = offset == null ? 0 : Math.max(offset, 0);
            Integer cols = maxColumns == null ? 4 : Math.min(Math.max(maxColumns, 1), 12);

            JFormDefinition.Form def = JFormDefinitionService.load(formId);
            for (JFormDefinition.Section sec : def.sections) {
                for (JFormDefinition.Field f : sec.fields) {
                    if (JFormDefinition.LAYOUT_TYPES.contains(f.fieldType) || f.fieldType == 'hidden') {
                        continue;
                    }
                    if (JFormTableService.isTable(f)) {
                        addTableColumns(p, f, cols);
                        continue;
                    }
                    if (JFormFieldParts.isCompound(f)) {
                        addPartColumns(p, f, cols);
                        continue;
                    }
                    if (p.columnKeys.size() < cols) {
                        p.columnKeys.add(f.key);
                        p.columns.add(String.isBlank(f.label) ? f.key : f.label);
                    }
                    FilterField ff = new FilterField();
                    ff.key = f.key;
                    ff.label = String.isBlank(f.label) ? f.key : f.label;
                    if (f.options != null) {
                        for (JFormDefinition.Option o : f.options) {
                            ff.options.add(String.isBlank(o.label) ? o.value : o.label);
                        }
                    } else if (f.fieldType == 'yesno') {
                        ff.options.addAll(new List<String>{ 'Yes', 'No' });
                    }
                    if (JFormOtherChoice.offered(f) && !ff.options.contains(JFormOtherChoice.value(f))) {
                        ff.options.add(JFormOtherChoice.value(f));
                    }
                    p.fields.add(ff);
                    if (JFormOtherChoice.offered(f)) {
                        addOtherColumn(p, f, cols);
                    }
                }
            }

            // ---- where clause, one condition per filter, values bound by name
            List<String> clauses = new List<String>{ 'Form__c = :formId' };
            Map<String, Object> binds = new Map<String, Object>{ 'formId' => formId };
            String statusFilter = String.isBlank(status) ? null : status;
            if (statusFilter == null) {
                clauses.add('Status__c != :spam'); // "all statuses" leaves out spam; it has its own filter value
                binds.put('spam', 'Spam');
            } else {
                clauses.add('Status__c = :statusFilter');
                binds.put('statusFilter', statusFilter);
            }
            clauses.add(paymentClause(def, payment, binds));
            if (fromDate != null) {
                clauses.add('Submission_Date_Time__c >= :fromDt');
                binds.put('fromDt', Datetime.newInstance(fromDate, Time.newInstance(0, 0, 0, 0)));
            }
            if (toDate != null) {
                clauses.add('Submission_Date_Time__c < :toDt');
                binds.put('toDt', Datetime.newInstance(toDate.addDays(1), Time.newInstance(0, 0, 0, 0)));
            }
            String term = String.isBlank(search) ? null : search.trim();
            if (term != null) {
                if (Pattern.matches('(?i)^(formno-?)?\\d{1,8}$', term)) {
                    clauses.add('Name LIKE :namePattern');
                    binds.put('namePattern', '%' + term.replaceAll('(?i)^formno-?', '') + '%');
                } else {
                    clauses.add('Id IN (SELECT Form_Submission__c FROM Submission_Field_Value__c WHERE Search_Text__c LIKE :searchPattern)');
                    binds.put('searchPattern', likeContains(term));
                }
            }
            if (String.isNotBlank(fieldKey) && String.isNotBlank(fieldValue)) {
                clauses.add('Id IN (SELECT Form_Submission__c FROM Submission_Field_Value__c WHERE Field_Key__c = :fieldKey AND Search_Text__c LIKE :fieldPattern)');
                binds.put('fieldKey', fieldKey);
                binds.put('fieldPattern', likeContains(fieldValue.trim()));
            }
            if (String.isNotBlank(code)) {
                clauses.add(codeClause(code, binds));
            }
            String clause = String.join(clauses, ' AND ');
            p.total = Database.countQueryWithBinds('SELECT COUNT() FROM Form_Submission__c WHERE ' + clause, binds, AccessLevel.USER_MODE);

            List<String> columnKeys = p.columnKeys;
            binds.put('columnKeys', columnKeys);
            binds.put('size', size);
            binds.put('skip', skip);
            List<Form_Submission__c> subs = Database.queryWithBinds(
                'SELECT Id, Submission_Date_Time__c, Status__c, Target_Record_Id__c, Error_Message__c, Action_Results_JSON__c, Spam_Reason__c, Spam_Score__c, '
                + 'Payment_Status__c, Payment_Amount__c, '
                + '(SELECT Field_Key__c, Field_Value__c FROM Submission_Field_Values__r WHERE Field_Key__c IN :columnKeys), '
                + '(SELECT Mode__c, Currency__c, Provider_Url__c, Amount_Expected__c, Currency_Expected__c, Code__c, Discount_Amount__c FROM Form_Payments__r WHERE Type__c = \'Payment\' ORDER BY CreatedDate DESC LIMIT 1) '
                + 'FROM Form_Submission__c WHERE ' + clause + ' ORDER BY Submission_Date_Time__c DESC NULLS LAST LIMIT :size OFFSET :skip',
                binds, AccessLevel.USER_MODE);

            for (Form_Submission__c sub : subs) {
                Row r = new Row();
                r.id = sub.Id;
                r.submittedAt = sub.Submission_Date_Time__c;
                r.status = sub.Status__c;
                r.targetRecordId = sub.Target_Record_Id__c;
                r.errorMessage = sub.Error_Message__c;
                r.spamReason = sub.Spam_Reason__c;
                r.spamScore = sub.Spam_Score__c;
                r.actionResults = sub.Action_Results_JSON__c;
                r.paymentStatus = sub.Payment_Status__c;
                r.paymentAmount = sub.Payment_Amount__c;
                if (!sub.Form_Payments__r.isEmpty()) {
                    Form_Payment__c pay = sub.Form_Payments__r[0];
                    r.paymentMode = pay.Mode__c;
                    r.paymentCurrency = pay.Currency__c;
                    r.paymentUrl = pay.Provider_Url__c;
                    if (pay.Amount_Expected__c != null) {
                        r.paymentExpected = JFormPaymentPricing.toMajor(pay.Amount_Expected__c.longValue(), pay.Currency_Expected__c);
                        r.paymentExpectedCurrency = pay.Currency_Expected__c;
                    }
                    r.promotionCode = pay.Code__c;
                    r.discountAmount = pay.Discount_Amount__c == null || pay.Discount_Amount__c == 0 ? null : JFormPaymentPricing.toMajor(pay.Discount_Amount__c.longValue(), pay.Currency__c);
                }
                Map<String, String> byKey = new Map<String, String>();
                for (Submission_Field_Value__c v : sub.Submission_Field_Values__r) {
                    byKey.put(v.Field_Key__c, v.Field_Value__c);
                }
                for (String key : p.columnKeys) {
                    r.cells.add(byKey.get(key));
                }
                p.rows.add(r);
            }
            return p;
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** What was typed under a choice field's Other is stored on its own: a column and a filter, "Industry: Other". */
    private static void addOtherColumn(ResultPage p, JFormDefinition.Field f, Integer cols) {
        String key = JFormOtherChoice.answerKey(f);
        String label = JFormOtherChoice.answerLabel(f);
        if (p.columnKeys.size() < cols) {
            p.columnKeys.add(key);
            p.columns.add(label);
        }
        FilterField ff = new FilterField();
        ff.key = key;
        ff.label = label;
        p.fields.add(ff);
    }

    /** A table is stored one value per row: a column and a filter per row, "Satisfaction: Service". */
    private static void addTableColumns(ResultPage p, JFormDefinition.Field f, Integer cols) {
        for (JFormTableService.Row row : JFormTableService.rows(f)) {
            String key = JFormTableService.answerKey(f, row);
            String label = JFormTableService.rowLabel(f, row);
            if (p.columnKeys.size() < cols) {
                p.columnKeys.add(key);
                p.columns.add(label);
            }
            FilterField ff = new FilterField();
            ff.key = key;
            ff.label = label;
            if (f.options != null) {
                for (JFormDefinition.Option o : f.options) {
                    ff.options.add(String.isBlank(o.label) ? o.value : o.label);
                }
            }
            p.fields.add(ff);
        }
    }

    /**
     * A Name or Address field is stored as its whole value and one value per part: the full name or one-line
     * address as the column, a filter for it and for each part the respondent fills in.
     */
    private static void addPartColumns(ResultPage p, JFormDefinition.Field f, Integer cols) {
        String label = String.isBlank(f.label) ? f.key : f.label;
        if (p.columnKeys.size() < cols) {
            p.columnKeys.add(f.key);
            p.columns.add(label);
        }
        FilterField full = new FilterField();
        full.key = f.key;
        full.label = label;
        p.fields.add(full);
        for (JFormFieldParts.Part part : JFormFieldParts.storedParts(f)) {
            if (part.derived) {
                continue;
            }
            FilterField ff = new FilterField();
            ff.key = JFormFieldParts.answerKey(f, part);
            ff.label = JFormFieldParts.partLabel(f, part);
            p.fields.add(ff);
        }
    }

    /**
     * The payment condition of a response listing, with its binds. Blank shows paid responses and responses
     * without a payment, leaving out unpaid ones and, on a form that takes live payments, test payments;
     * paid, unpaid and test show only those. Whether the form takes live payments is decided as for the
     * checkout itself (JFormPaymentService.modeOf): in a sandbox every form takes test payments, so a form
     * saved as live keeps them in view there. The table, the export and the REST API share the condition,
     * so they agree on which responses count.
     */
    public static String paymentClause(JFormDefinition.Form def, String payment, Map<String, Object> binds) {
        return paymentClause(JFormPaymentService.takesLivePayments(def), payment, binds, 'Id', 'Payment_Status__c');
    }

    /**
     * The same condition for a form by Id, for a caller that needs nothing else of the definition
     * (JFormRestApi.listSubmissions): the form is read only for the blank filter, the one that depends on it.
     */
    public static String paymentClause(Id formId, String payment, Map<String, Object> binds) {
        Boolean liveForm = PAYMENT_FILTERS.contains(payment) ? false : JFormPaymentService.takesLivePayments(formId);
        return paymentClause(liveForm, payment, binds, 'Id', 'Payment_Status__c');
    }

    /**
     * The condition itself, from another object's query when asked, naming the response's Id and payment status as
     * seen from there; liveForm says whether the form takes live payments, which keeps test payments out of the blank filter.
     */
    private static String paymentClause(Boolean liveForm, String payment, Map<String, Object> binds, String idField, String statusField) {
        binds.put('unpaid', JFormPaymentService.UNPAID);
        binds.put('paidStatuses', PAID_STATUSES);
        binds.put('testMode', JFormPaymentService.TEST);
        if (payment == 'paid') {
            return statusField + ' IN :paidStatuses';
        }
        if (payment == 'unpaid') {
            return statusField + ' IN :unpaid';
        }
        if (payment == 'test') {
            return idField + ' IN (SELECT Form_Submission__c FROM Form_Payment__c WHERE Mode__c = :testMode)';
        }
        String clause = statusField + ' NOT IN :unpaid';
        if (liveForm) {
            clause += ' AND ' + idField + ' NOT IN (SELECT Form_Submission__c FROM Form_Payment__c WHERE Mode__c = :testMode)';
        }
        return clause;
    }

    /** Responses whose payment used a promotion code containing the text, whatever its case. */
    private static String codeClause(String code, Map<String, Object> binds) {
        binds.put('codePattern', likeContains(code.trim().toUpperCase()));
        return 'Id IN (SELECT Form_Submission__c FROM Form_Payment__c WHERE Type__c = \'Payment\' AND Code__c LIKE :codePattern)';
    }

    /** "%term%" with the LIKE wildcards in the term escaped, so "100%" finds the literal text. */
    @TestVisible
    private static String likeContains(String term) {
        return '%' + term.replaceAll('([%_\\\\])', '\\\\$1') + '%';
    }

    /**
     * CSV of every answer for the form (most recent first, up to 2000 submissions). Spam is left out unless
     * asked for; `payment` is the Responses table's filter, so the file holds what the table shows.
     */
    @AuraEnabled
    public static String exportCsv(Id formId, Boolean includeSpam, String payment, String code) {
        try {
            Boolean withSpam = includeSpam == true;
            List<String> excluded = withSpam ? new List<String>() : new List<String>{ 'Spam' };
            JFormDefinition.Form def = JFormDefinitionService.load(formId);
            List<String> keys = new List<String>();
            List<String> header = new List<String>{ 'Submission Id', 'Submitted', 'Status', 'Target Record Id' };
            if (withSpam) {
                header.add('Spam Reason');
            }
            Boolean payments = JFormPaymentService.isPaymentForm(def);
            if (payments) {
                header.addAll(new List<String>{ 'Payment Status', 'Payment Amount', 'Promotion Code', 'Discount' });
            }
            for (JFormDefinition.Section sec : def.sections) {
                for (JFormDefinition.Field f : sec.fields) {
                    if (JFormTableService.isTable(f)) {
                        for (JFormTableService.Row row : JFormTableService.rows(f)) {
                            keys.add(JFormTableService.answerKey(f, row));
                            header.add(JFormTableService.rowLabel(f, row));
                        }
                    } else if (JFormFieldParts.isCompound(f)) {
                        // the whole value, then each part (an address's codes too), so the file can be loaded into
                        // FirstName and LastName, or an address's fields
                        keys.add(f.key);
                        header.add(String.isBlank(f.label) ? f.key : f.label);
                        for (JFormFieldParts.Part part : JFormFieldParts.storedParts(f)) {
                            keys.add(JFormFieldParts.answerKey(f, part));
                            header.add(JFormFieldParts.partLabel(f, part));
                        }
                    } else if (!JFormDefinition.LAYOUT_TYPES.contains(f.fieldType)) {
                        keys.add(f.key);
                        header.add(String.isBlank(f.label) ? f.key : f.label);
                        if (JFormOtherChoice.offered(f)) {
                            keys.add(JFormOtherChoice.answerKey(f));
                            header.add(JFormOtherChoice.answerLabel(f));
                        }
                    }
                }
            }
            Map<String, Object> binds = new Map<String, Object>{ 'formId' => formId, 'excluded' => excluded };
            String clause = 'Form__c = :formId AND Status__c NOT IN :excluded AND ' + paymentClause(def, payment, binds);
            if (String.isNotBlank(code)) {
                clause += ' AND ' + codeClause(code, binds);
            }
            List<String> lines = new List<String>{ csvLine(header) };
            for (Form_Submission__c sub : (List<Form_Submission__c>) Database.queryWithBinds(
                'SELECT Id, Submission_Date_Time__c, Status__c, Target_Record_Id__c, Spam_Reason__c, Payment_Status__c, Payment_Amount__c, '
                    + '(SELECT Field_Key__c, Field_Value__c FROM Submission_Field_Values__r), '
                    + '(SELECT Code__c, Discount_Amount__c, Currency__c FROM Form_Payments__r WHERE Type__c = \'Payment\' ORDER BY CreatedDate DESC LIMIT 1) '
                    + 'FROM Form_Submission__c WHERE ' + clause + ' ORDER BY Submission_Date_Time__c DESC NULLS LAST LIMIT 2000',
                binds, AccessLevel.USER_MODE
            )) {
                Map<String, String> byKey = new Map<String, String>();
                for (Submission_Field_Value__c v : sub.Submission_Field_Values__r) {
                    byKey.put(v.Field_Key__c, v.Field_Value__c);
                }
                List<String> cells = new List<String>{
                    sub.Id, sub.Submission_Date_Time__c == null ? '' : sub.Submission_Date_Time__c.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                    sub.Status__c, sub.Target_Record_Id__c
                };
                if (withSpam) {
                    cells.add(sub.Spam_Reason__c);
                }
                if (payments) {
                    cells.add(sub.Payment_Status__c);
                    cells.add(sub.Payment_Amount__c == null ? null : String.valueOf(sub.Payment_Amount__c));
                    Form_Payment__c pay = sub.Form_Payments__r.isEmpty() ? null : sub.Form_Payments__r[0];
                    cells.add(pay == null ? null : pay.Code__c);
                    cells.add(pay == null || pay.Discount_Amount__c == null || pay.Discount_Amount__c == 0
                        ? null : String.valueOf(JFormPaymentPricing.toMajor(pay.Discount_Amount__c.longValue(), pay.Currency__c)));
                }
                for (String key : keys) {
                    cells.add(byKey.get(key));
                }
                lines.add(csvLine(cells));
            }
            return String.join(lines, '\n');
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    @AuraEnabled
    public static JFormSubmissionService.Result reprocess(Id submissionId) {
        try {
            // the service runs without sharing; only reprocess what the caller can see
            if (submissionId == null || [SELECT COUNT() FROM Form_Submission__c WHERE Id = :submissionId WITH USER_MODE] == 0) {
                throw new JFormSubmissionService.SubmissionException('Response not found.');
            }
            return JFormSubmissionService.reprocess(submissionId);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** AuraHandledException shows "Script-thrown exception" unless the message is set explicitly. */
    private static AuraHandledException aura(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }

    @TestVisible
    public static String csvLine(List<String> cells) {
        List<String> out = new List<String>();
        for (String c : cells) {
            String v = c == null ? '' : c;
            if (v.contains(',') || v.contains('"') || v.contains('\n')) {
                v = '"' + v.replace('"', '""') + '"';
            }
            out.add(v);
        }
        return String.join(out, ',');
    }
}
