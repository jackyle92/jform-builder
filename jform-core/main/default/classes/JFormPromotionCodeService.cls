/**
 * Promotion codes a form defines itself (settings.payments.codes = "jform"): Promotion_Code__c records under
 * the form, each a percent or an amount off the total with an optional validity window and use limit
 * (docs/DESIGN.md 8.10).
 *
 * The respondent's side (check) runs without sharing and in system mode: guests have no access to the
 * object, and a refused code is answered with one generic message whatever the reason, so nobody learns
 * which codes exist. The builder's side (listCodes, save, generate, remove, exportCsv) runs in user mode through
 * JFormWorkspaceController, so ACCESS_FORM_BUILDER decides who manages a form's codes.
 *
 * There is no use counter: a use is a Form Payment linked to the code whose status is not Failed or
 * Expired, counted when the code is checked. Awaiting payment counts, so two respondents cannot both take
 * the last use except in the seconds between the check and the insert, which is accepted.
 */
public without sharing class JFormPromotionCodeService {

    /** settings.payments.codes: no codes, codes defined on the form, or codes defined in the gateway. */
    public static final String NONE = 'none';
    public static final String JFORM = 'jform';
    public static final String GATEWAY = 'gateway';
    public static final Set<String> KINDS = new Set<String>{ NONE, JFORM, GATEWAY };

    public static final String PERCENT = 'Percent';
    public static final String AMOUNT = 'Amount';
    /** What a refused code gets, whatever the reason. */
    public static final String REFUSED = 'This code isn\'t valid. Check it and try again.';
    public static final Integer MAX_GENERATED = 500;
    private static final Integer MIN_LENGTH = 3;
    private static final Integer MAX_LENGTH = 40;
    private static final Integer SUFFIX_LENGTH = 8;
    /** Generated codes: no 0, O, 1 or I, so a code read out loud or typed from paper is not mistaken. */
    private static final String ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    private static final Pattern WELL_FORMED = Pattern.compile('[A-Z0-9-]{3,40}');
    /** Payments in these states do not count as a use. */
    private static final Set<String> NOT_A_USE = new Set<String>{ JFormPaymentService.FAILED, JFormPaymentService.EXPIRED };

    /** The builder's mistake, with a message for the Settings tab. */
    public class CodeException extends Exception {}

    /** What the respondent's check learns. The reason never leaves the server. */
    public class Verdict {
        public Boolean valid = false;
        /** unknown, inactive, not_yet_valid, expired, used_up, currency or limited (too many wrong codes); null when valid. */
        public String reason;
        public Id codeId;
        /** The code as stored (upper case). */
        public String code;
        public String discountType;
        public Decimal percentOff;
        /** In the currency's smallest unit. */
        public Long amountOff;
    }

    /** One code as the Settings tab and the export see it. */
    public class Summary {
        @AuraEnabled public Id id;
        @AuraEnabled public String code;
        @AuraEnabled public String discountType;
        @AuraEnabled public Decimal percentOff;
        /** In the main unit (10.00), as the builder types it. */
        @AuraEnabled public Decimal amountOff;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Datetime validFrom;
        @AuraEnabled public Datetime validUntil;
        @AuraEnabled public Integer maxUses;
        @AuraEnabled public Integer uses = 0;
        @AuraEnabled public Boolean active = true;
        @AuraEnabled public String note;
        /** Active, Scheduled, Expired, Used up or Paused. */
        @AuraEnabled public String state;
    }

    /** What Generate codes asks for. */
    public class GenerateRequest {
        @AuraEnabled public Integer count;
        @AuraEnabled public String prefix;
        @AuraEnabled public String discountType;
        @AuraEnabled public Decimal percentOff;
        @AuraEnabled public Decimal amountOff;
        @AuraEnabled public Datetime validFrom;
        @AuraEnabled public Datetime validUntil;
        @AuraEnabled public String note;
    }

    // ------------------------------------------------------------ respondent

    /** The code as stored: trimmed and upper case; null when blank. */
    public static String normalise(String code) {
        return String.isBlank(code) ? null : code.trim().toUpperCase();
    }

    public static Boolean isWellFormed(String code) {
        return code != null && WELL_FORMED.matcher(code).matches();
    }

    /**
     * Whether a code can be used on the form now, with its terms when it can. One query for the code and,
     * when it has a use limit, one count of its payments.
     */
    public static Verdict check(Id formId, String currencyCode, String code) {
        Verdict v = new Verdict();
        v.code = normalise(code);
        if (!isWellFormed(v.code)) {
            v.reason = 'unknown';
            return v;
        }
        List<Promotion_Code__c> found = [
            SELECT Id, Name, Discount_Type__c, Percent_Off__c, Amount_Off__c, Currency__c, Valid_From__c, Valid_Until__c, Max_Uses__c, Active__c
            FROM Promotion_Code__c WHERE Code_Key__c = :keyOf(formId, v.code) LIMIT 1
        ];
        if (found.isEmpty()) {
            v.reason = 'unknown';
            return v;
        }
        Promotion_Code__c c = found[0];
        v.codeId = c.Id;
        v.code = c.Name;
        v.discountType = c.Discount_Type__c;
        v.percentOff = c.Percent_Off__c;
        v.amountOff = c.Amount_Off__c == null ? null : c.Amount_Off__c.longValue();
        Datetime now = System.now();
        if (c.Active__c != true) {
            v.reason = 'inactive';
        } else if (c.Valid_From__c != null && c.Valid_From__c > now) {
            v.reason = 'not_yet_valid';
        } else if (c.Valid_Until__c != null && c.Valid_Until__c < now) {
            v.reason = 'expired';
        } else if (c.Discount_Type__c == AMOUNT && c.Currency__c != currencyCode) {
            v.reason = 'currency';
        } else if (c.Max_Uses__c != null && usesOf(c.Id) >= c.Max_Uses__c) {
            v.reason = 'used_up';
        } else if (!hasTerms(c)) {
            v.reason = 'unknown';
        }
        v.valid = v.reason == null;
        return v;
    }

    private static Integer usesOf(Id codeId) {
        return [SELECT COUNT() FROM Form_Payment__c WHERE Promotion_Code__c = :codeId AND Type__c = 'Payment' AND Status__c NOT IN :NOT_A_USE];
    }

    // ------------------------------------------------------------ guessing limit

    /** Wrong codes one timing token may try, and one form may take in GUESS_WINDOW_MINUTES, before every code is refused. */
    @TestVisible private static final Integer GUESSES_PER_TOKEN = 5;
    @TestVisible private static final Integer GUESSES_PER_FORM = 30;
    private static final Integer GUESS_WINDOW_MINUTES = 10;
    /** As long as a timing token verifies (JFormProtectionService.TOKEN_MAX_AGE_MS). */
    private static final Integer TOKEN_SECONDS = 24 * 60 * 60;
    /** The package's Org cache partition. In an installed package "local" is the subscriber org's namespace, so the package's own is named. */
    private static final String PARTITION = (String.isBlank(JFormNamespace.NAME) ? 'local' : JFormNamespace.NAME) + '.JFormProtection';
    /** Tests count here instead of in Platform Cache, which a test org may have no capacity for. */
    @TestVisible private static Map<String, Integer> testCounts;

    /**
     * check() for a respondent, at the Apply click and again at the Pay click, with the guessing limit:
     * refused codes are counted per timing token and per form, and past either limit every code is refused,
     * with the same answer as any refused code. A respondent typing the right code is never counted. A code
     * this token has already been told is valid skips both limits, so wrong codes sent by someone else
     * cannot take away a discount the respondent applied before they click Pay; the token already knows
     * that code, so nothing is learnt. The counts live in Platform Cache; in an org without capacity
     * nothing is counted and no limit applies.
     */
    public static Verdict checkLimited(Id formId, String currencyCode, String code, String token) {
        String formKey = formKey(formId);
        String tokenKey = tokenKey(token);
        String appliedKey = appliedKey(formId, normalise(code), token);
        if (appliedKey != null && count(appliedKey) > 0) {
            return check(formId, currencyCode, code);
        }
        if (count(formKey) >= GUESSES_PER_FORM || (tokenKey != null && count(tokenKey) >= GUESSES_PER_TOKEN)) {
            System.debug(LoggingLevel.WARN, 'JForm refused promotion codes on form ' + formId + ': too many wrong codes');
            Verdict limited = new Verdict();
            limited.code = normalise(code);
            limited.reason = 'limited';
            return limited;
        }
        Verdict v = check(formId, currencyCode, code);
        if (v.valid) {
            if (appliedKey != null) {
                add(appliedKey, TOKEN_SECONDS);
            }
        } else {
            add(formKey, GUESS_WINDOW_MINUTES * 60);
            if (tokenKey != null) {
                add(tokenKey, TOKEN_SECONDS);
            }
        }
        return v;
    }

    /** Whether wrong codes can be counted: the org has Platform Cache capacity for the partition. For the Setup tab. */
    public static Boolean guessLimitOn() {
        if (testCounts != null) {
            return true;
        }
        try {
            Cache.OrgPartition p = Cache.Org.getPartition(PARTITION);
            p.put('probe', 1, 300);
            return p.contains('probe');
        } catch (Exception e) {
            return false;
        }
    }

    /** Cache keys are alphanumeric: the form and its current window, and hashes of the token and of an applied code. */
    @TestVisible
    private static String formKey(Id formId) {
        return 'f' + formId + 'w' + (System.now().getTime() / (GUESS_WINDOW_MINUTES * 60000L));
    }

    private static String tokenKey(String token) {
        return String.isBlank(token) ? null : 't' + hash(token);
    }

    /** A code this token was told is valid on the form. */
    private static String appliedKey(Id formId, String code, String token) {
        return String.isBlank(token) || code == null ? null : 'a' + hash(formId + '|' + code + '|' + token);
    }

    private static String hash(String s) {
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(s))).left(40);
    }

    private static Integer count(String key) {
        if (testCounts != null) {
            return testCounts.containsKey(key) ? testCounts.get(key) : 0;
        }
        try {
            Object n = Cache.Org.getPartition(PARTITION).get(key);
            return n instanceof Integer ? (Integer) n : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private static void add(String key, Integer seconds) {
        Integer n = count(key) + 1;
        if (testCounts != null) {
            testCounts.put(key, n);
            return;
        }
        try {
            Cache.Org.getPartition(PARTITION).put(key, n, seconds);
        } catch (Exception e) {
            // no capacity or no partition: nothing is counted
        }
    }

    private static Boolean hasTerms(Promotion_Code__c c) {
        return c.Discount_Type__c == PERCENT
            ? c.Percent_Off__c != null && c.Percent_Off__c > 0
            : c.Discount_Type__c == AMOUNT && c.Amount_Off__c != null && c.Amount_Off__c > 0;
    }

    public static String keyOf(Id formId, String code) {
        return String.valueOf(formId) + ':' + code;
    }

    // ------------------------------------------------------------ builder

    /** The form's codes with their uses and state, newest first. */
    public static List<Summary> listCodes(Id formId) {
        List<Promotion_Code__c> codes = [
            SELECT Id, Name, Discount_Type__c, Percent_Off__c, Amount_Off__c, Currency__c, Valid_From__c, Valid_Until__c, Max_Uses__c, Active__c, Note__c
            FROM Promotion_Code__c WHERE Form__c = :formId WITH USER_MODE ORDER BY CreatedDate DESC, Name LIMIT 2000
        ];
        Map<Id, Integer> uses = new Map<Id, Integer>();
        for (AggregateResult r : [
            SELECT Promotion_Code__c code, COUNT(Id) n FROM Form_Payment__c
            WHERE Form__c = :formId AND Promotion_Code__c != null AND Type__c = 'Payment' AND Status__c NOT IN :NOT_A_USE
            WITH USER_MODE GROUP BY Promotion_Code__c
        ]) {
            uses.put((Id) r.get('code'), (Integer) r.get('n'));
        }
        List<Summary> out = new List<Summary>();
        for (Promotion_Code__c c : codes) {
            out.add(summarise(c, uses.containsKey(c.Id) ? uses.get(c.Id) : 0));
        }
        return out;
    }

    private static Summary summarise(Promotion_Code__c c, Integer uses) {
        Summary s = new Summary();
        s.id = c.Id;
        s.code = c.Name;
        s.discountType = c.Discount_Type__c;
        s.percentOff = c.Percent_Off__c;
        s.currencyCode = c.Currency__c;
        s.amountOff = c.Amount_Off__c == null ? null : JFormPaymentPricing.toMajor(c.Amount_Off__c.longValue(), c.Currency__c);
        s.validFrom = c.Valid_From__c;
        s.validUntil = c.Valid_Until__c;
        s.maxUses = c.Max_Uses__c == null ? null : c.Max_Uses__c.intValue();
        s.uses = uses;
        s.active = c.Active__c == true;
        s.note = c.Note__c;
        s.state = stateOf(c, uses);
        return s;
    }

    private static String stateOf(Promotion_Code__c c, Integer uses) {
        Datetime now = System.now();
        if (c.Active__c != true) {
            return 'Paused';
        }
        if (c.Valid_Until__c != null && c.Valid_Until__c < now) {
            return 'Expired';
        }
        if (c.Max_Uses__c != null && uses >= c.Max_Uses__c) {
            return 'Used up';
        }
        if (c.Valid_From__c != null && c.Valid_From__c > now) {
            return 'Scheduled';
        }
        return 'Active';
    }

    /** Adds a code, or changes one (input.id set). Throws CodeException with the builder's mistake. */
    public static Summary save(Id formId, Summary input) {
        String currencyCode = currencyOf(formId);
        Promotion_Code__c c = new Promotion_Code__c(Form__c = formId);
        if (input.id != null) {
            Promotion_Code__c stored = [SELECT Id, Discount_Type__c, Currency__c FROM Promotion_Code__c WHERE Id = :input.id AND Form__c = :formId WITH USER_MODE LIMIT 1];
            // an Amount code keeps the currency it was made in: Pause and Resume send it back after the form may have
            // changed currency, and the publish check flags it until the builder replaces it
            if (stored.Discount_Type__c == AMOUNT && String.isNotBlank(stored.Currency__c)) {
                currencyCode = stored.Currency__c;
            }
            // the master-detail field cannot be written, so the update carries the Id alone
            c = new Promotion_Code__c(Id = stored.Id);
        }
        fill(c, formId, input.code, input.discountType, input.percentOff, input.amountOff, currencyCode, input.validFrom, input.validUntil, input.maxUses, input.active, input.note);
        writing = true;
        try {
            if (c.Id == null) {
                Database.insert(c, AccessLevel.USER_MODE);
            } else {
                Database.update(c, AccessLevel.USER_MODE);
            }
        } catch (DmlException e) {
            throw new CodeException(e.getDmlType(0) == StatusCode.DUPLICATE_VALUE ? 'The code ' + c.Name + ' already exists on this form.' : e.getDmlMessage(0));
        } finally {
            writing = false;
        }
        return summarise(c, input.id == null ? 0 : usesOf(c.Id));
    }

    /**
     * Up to MAX_GENERATED codes with the same terms and one use each: the prefix, then eight random letters and
     * digits. A code that collides with one already on the form is drawn again.
     */
    public static List<Summary> generate(Id formId, GenerateRequest r) {
        if (r.count == null || r.count < 1 || r.count > MAX_GENERATED) {
            throw new CodeException('Generate between 1 and ' + MAX_GENERATED + ' codes.');
        }
        String prefix = normalise(r.prefix);
        if (prefix != null && !Pattern.matches('[A-Z0-9-]{1,20}', prefix)) {
            throw new CodeException('The prefix can have letters, digits and hyphens, up to 20 characters.');
        }
        prefix = prefix == null ? '' : prefix + '-';
        String currencyCode = currencyOf(formId);
        Set<String> taken = new Set<String>();
        for (Promotion_Code__c c : [SELECT Name FROM Promotion_Code__c WHERE Form__c = :formId WITH USER_MODE]) {
            taken.add(c.Name);
        }
        List<Promotion_Code__c> codes = new List<Promotion_Code__c>();
        while (codes.size() < r.count) {
            String code = prefix + randomSuffix();
            if (taken.contains(code)) {
                continue;
            }
            taken.add(code);
            Promotion_Code__c c = new Promotion_Code__c(Form__c = formId);
            fill(c, formId, code, r.discountType, r.percentOff, r.amountOff, currencyCode, r.validFrom, r.validUntil, 1, true, r.note);
            codes.add(c);
        }
        writing = true;
        try {
            Database.insert(codes, AccessLevel.USER_MODE);
        } finally {
            writing = false;
        }
        List<Summary> out = new List<Summary>();
        for (Promotion_Code__c c : codes) {
            out.add(summarise(c, 0));
        }
        return out;
    }

    private static String randomSuffix() {
        String s = '';
        while (s.length() < SUFFIX_LENGTH) {
            // the mask keeps it non-negative: Math.abs leaves Integer.MIN_VALUE negative, a negative index for most alphabet lengths
            Integer i = Math.mod(Crypto.getRandomInteger() & 2147483647, ALPHABET.length());
            s += ALPHABET.substring(i, i + 1);
        }
        return s;
    }

    public static void remove(Id formId, Id codeId) {
        List<Promotion_Code__c> found = [SELECT Id FROM Promotion_Code__c WHERE Id = :codeId AND Form__c = :formId WITH USER_MODE LIMIT 1];
        if (!found.isEmpty()) {
            Database.delete(found[0], AccessLevel.USER_MODE);
        }
    }

    /** The list as a CSV file, for handing codes to customers. */
    public static String exportCsv(Id formId) {
        List<String> lines = new List<String>{
            JFormResponsesController.csvLine(new List<String>{ 'Code', 'Discount', 'Valid from', 'Valid until', 'Max uses', 'Uses', 'State', 'Note' })
        };
        for (Summary s : listCodes(formId)) {
            lines.add(JFormResponsesController.csvLine(new List<String>{
                s.code,
                discountText(s),
                s.validFrom == null ? '' : s.validFrom.formatGmt('yyyy-MM-dd HH:mm') + ' UTC',
                s.validUntil == null ? '' : s.validUntil.formatGmt('yyyy-MM-dd HH:mm') + ' UTC',
                s.maxUses == null ? '' : String.valueOf(s.maxUses),
                String.valueOf(s.uses),
                s.state,
                s.note == null ? '' : s.note
            }));
        }
        return String.join(lines, '\n');
    }

    /**
     * Problems that stop a form on JForm codes from being published: an Amount code in another currency than
     * the form's, since the discount could not be taken off its total.
     */
    public static List<String> publishProblems(Id formId, String currencyCode) {
        List<String> problems = new List<String>();
        if (formId == null) {
            return problems;
        }
        for (Promotion_Code__c c : [
            SELECT Name, Currency__c FROM Promotion_Code__c
            WHERE Form__c = :formId AND Discount_Type__c = :AMOUNT AND Currency__c != :currencyCode WITH USER_MODE ORDER BY Name LIMIT 3
        ]) {
            problems.add('The promotion code ' + c.Name + ' takes ' + c.Currency__c + ' off, but the form charges in ' + currencyCode + '. Change or delete the code in Settings › Payments.');
        }
        return problems;
    }

    // ------------------------------------------------------------ outside JForm

    /** Set while save() and generate() write, so the trigger lets JForm's own writes through. */
    private static Boolean writing = false;
    @TestVisible
    private static final String ADD_IN_JFORM = 'Add promotion codes in JForm: open the form, then Settings › Payments › Promotion codes.';
    @TestVisible
    private static final String CHANGE_IN_JFORM = 'Change a code or its discount in JForm: open the form, then Settings › Payments › Promotion codes.';

    /**
     * JFormPromotionCodeTrigger, before insert and update. Codes are added and their terms changed only through
     * save() and generate(), which work out the stored case, the key and the amount in the smallest unit. From a
     * record page, Data Loader or Salesforce's API a code cannot be added, and only its pause, note, dates and use
     * limit can change. Deleting is not checked.
     */
    public static void guard(List<Promotion_Code__c> rows, Map<Id, Promotion_Code__c> old) {
        if (writing) {
            return;
        }
        for (Promotion_Code__c c : rows) {
            Promotion_Code__c before = old == null ? null : old.get(c.Id);
            if (before == null) {
                c.addError(ADD_IN_JFORM);
            } else if (differs(c.Name, before.Name) || differs(c.Code_Key__c, before.Code_Key__c) || differs(c.Discount_Type__c, before.Discount_Type__c)
                    || differs(c.Currency__c, before.Currency__c) || c.Percent_Off__c != before.Percent_Off__c || c.Amount_Off__c != before.Amount_Off__c) {
                c.addError(CHANGE_IN_JFORM);
            } else if (c.Valid_From__c != null && c.Valid_Until__c != null && c.Valid_Until__c <= c.Valid_From__c) {
                c.addError('The code must end after it starts.');
            } else if (c.Max_Uses__c != null && c.Max_Uses__c < 1) {
                c.addError('The maximum number of uses is at least 1, or blank for no limit.');
            }
        }
    }

    /** Case counts: Apex compares strings without it, and "save10" is not the stored "SAVE10". */
    private static Boolean differs(String a, String b) {
        return a == null ? b != null : !a.equals(b);
    }

    // ------------------------------------------------------------ helpers

    /** "10%" or "10.00 USD" for the export; blank for a code without its terms. */
    private static String discountText(Summary s) {
        if (s.discountType == PERCENT) {
            return s.percentOff == null ? '' : s.percentOff.stripTrailingZeros().toPlainString() + '%';
        }
        return s.amountOff == null ? '' : JFormPaymentPricing.formatMajor(s.amountOff, s.currencyCode);
    }

    private static void fill(Promotion_Code__c c, Id formId, String code, String discountType, Decimal percentOff, Decimal amountOff, String currencyCode,
            Datetime validFrom, Datetime validUntil, Integer maxUses, Boolean active, String note) {
        String name = normalise(code);
        if (!isWellFormed(name)) {
            throw new CodeException('A code has ' + MIN_LENGTH + ' to ' + MAX_LENGTH + ' letters, digits or hyphens.');
        }
        c.Name = name;
        c.Code_Key__c = keyOf(formId, name);
        if (discountType == PERCENT) {
            if (percentOff == null || percentOff < 0.01 || percentOff > 100) {
                throw new CodeException('The percent off is between 0.01 and 100.');
            }
            c.Discount_Type__c = PERCENT;
            c.Percent_Off__c = percentOff.setScale(2, System.RoundingMode.HALF_UP);
            c.Amount_Off__c = null;
            c.Currency__c = null;
        } else if (discountType == AMOUNT) {
            Long minor = amountOff == null || amountOff <= 0 ? null : JFormPaymentPricing.toMinor(amountOff, currencyCode);
            if (minor == null) {
                throw new CodeException(JFormPaymentPricing.decimalsOf(currencyCode) == 0
                    ? 'The amount off is a whole number of ' + currencyCode + '.'
                    : 'The amount off is a positive amount in ' + currencyCode + ' with at most two decimals.');
            }
            c.Discount_Type__c = AMOUNT;
            c.Amount_Off__c = minor;
            c.Currency__c = currencyCode;
            c.Percent_Off__c = null;
        } else {
            throw new CodeException('A code takes a percent or an amount off.');
        }
        if (validFrom != null && validUntil != null && validUntil <= validFrom) {
            throw new CodeException('The code must end after it starts.');
        }
        c.Valid_From__c = validFrom;
        c.Valid_Until__c = validUntil;
        if (maxUses != null && maxUses < 1) {
            throw new CodeException('The maximum number of uses is at least 1, or blank for no limit.');
        }
        c.Max_Uses__c = maxUses;
        c.Active__c = active != false;
        c.Note__c = String.isBlank(note) ? null : note.trim().left(255);
    }

    /** The form's payment currency, read in user mode. */
    private static String currencyOf(Id formId) {
        List<Form__c> forms = [SELECT Settings_JSON__c FROM Form__c WHERE Id = :formId WITH USER_MODE LIMIT 1];
        if (forms.isEmpty()) {
            throw new CodeException('The form was not found.');
        }
        JFormDefinition.Form def = new JFormDefinition.Form();
        def.settings = JFormDefinition.parseSettings(forms[0].Settings_JSON__c);
        return JFormPaymentPricing.normaliseCurrency(JFormPaymentService.settingsOf(def).currencyCode);
    }
}
