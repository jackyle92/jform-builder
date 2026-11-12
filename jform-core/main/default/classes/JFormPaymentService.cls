/**
 * JForm Payments: a payment form's response counts once the respondent has paid on the gateway's hosted
 * checkout page.
 *
 *   Pay button (JFormPublicController.submitWithPayment): the usual checks (JFormSubmissionService.prepare)
 *   -> the price, worked out on the server (JFormPaymentPricing) -> a checkout at the gateway, a callout and
 *   so before any DML -> the response stored as Awaiting payment, with a Form Payment record.
 *   The gateway's signed webhook (JFormPaymentWebhook), the return page and an hourly check then apply the
 *   checkout's state through apply(): Paid runs the record steps the response held back, through
 *   JFormSubmissionService.reprocess; Failed and Expired responses never run them.
 *
 * Without sharing: respondents and the webhook run as the site's guest user, who cannot read responses or
 * payments. Guests write, never read: the public methods take a form key and a checkout reference and
 * return a status word, nothing else.
 */
public without sharing class JFormPaymentService {

    /** Mode__c values: test payments move no money; live payments charge real cards. */
    public static final String TEST = 'Test';
    public static final String LIVE = 'Live';

    /** What a gateway reports about a checkout, or that a payment was refunded. */
    public static final String KIND_OPEN = 'open';
    public static final String KIND_PROCESSING = 'processing';
    public static final String KIND_PAID = 'paid';
    public static final String KIND_FAILED = 'failed';
    public static final String KIND_EXPIRED = 'expired';
    public static final String KIND_REFUNDED = 'refunded';
    public static final String KIND_IGNORED = 'ignored';

    /** Status__c of a payment, and Payment_Status__c of its response. */
    public static final String AWAITING = 'Awaiting payment';
    public static final String PAID = 'Paid';
    public static final String FAILED = 'Failed';
    public static final String EXPIRED = 'Expired';
    public static final String PARTIALLY_REFUNDED = 'Partially refunded';
    public static final String REFUNDED = 'Refunded';
    /**
     * Responses not paid for: their record steps never run, and the Responses tab and duplicate detection
     * leave them out (JFormResponsesController.paymentClause, JFormProtectionService).
     */
    public static final Set<String> UNPAID = new Set<String>{ AWAITING, FAILED, EXPIRED };
    /**
     * Checkouts that ended without a payment: they hold no place against a form's response limit, while one still
     * Awaiting payment keeps its place for the respondent paying (JFormPublicController).
     */
    public static final Set<String> ENDED = new Set<String>{ FAILED, EXPIRED };

    /** The payment gateways JForm supports, by the id a form keeps in settings.payments.gateway (c/jformPayment GATEWAYS). */
    public static final String STRIPE = 'stripe';
    public static final Set<String> GATEWAYS = new Set<String>{ STRIPE };

    public static final String NOT_TAKING = 'This form isn\'t taking payments right now.';
    /** How long a checkout stays open; Stripe allows 30 minutes to a day. */
    public static final Integer CHECKOUT_MINUTES = 60;
    /** The hourly check's scheduled job (JFormPaymentCheckJob). */
    public static final String JOB_NAME = 'JForm payment check';
    /** How many checkouts one hourly run reads at most, within its time budget: Apex allows 100 callouts. */
    private static final Integer CHECKS_PER_RUN = 100;
    /** Time one hourly run may spend reading from the gateway; Apex allows 120 seconds of callouts. */
    @TestVisible private static Integer checkBudgetMs = 90000;
    private static final Integer STEPS_PER_JOB = 5;
    /** Return parameters the renderer reads; an earlier attempt's are dropped from the return address. */
    private static final Set<String> RETURN_PARAMS = new Set<String>{ 'jfpay', 'jfcs', 'jfref', 'jfwin' };
    private static final String PRINCIPAL = 'Default';
    private static final String KEY_PARAMETER = 'SecretKey';

    @TestVisible private static JFormPaymentProvider providerOverride;
    @TestVisible private static CredentialStore credentialStore = new NamedCredentialStore();
    @TestVisible private static Boolean sandbox;
    /** Host names of the org's sites (lower case), loaded once per transaction; tests set it directly. */
    @TestVisible private static Set<String> siteHosts;
    /** Responses whose record steps were queued in this transaction, for tests. */
    @TestVisible private static List<Id> queuedSteps = new List<Id>();

    /** The longest an email address can be (RFC 5321); a longer answer is not sent to the gateway. */
    private static final Integer MAX_EMAIL_LENGTH = 254;

    public class PaymentException extends Exception {
        /** The request parameter the gateway refused, when it names one (Stripe's error.param). */
        public String param;
        /** The gateway's HTTP status and error type (Stripe's error.type), when it answered with an error. */
        public Integer statusCode;
        public String errorType;
    }

    // ------------------------------------------------------------ gateway shapes

    public class CheckoutRequest {
        public String mode;
        public String publicKey;
        /** JForm's own reference for the checkout, shown in the gateway's dashboard. */
        public String reference;
        public String description;
        public JFormPaymentPricing.Quote quote;
        public String successUrl;
        public String cancelUrl;
        public Datetime expiresAt;
        /** A JForm promotion code's discount, in the smallest unit, and the code, for the gateway's receipt. */
        public Long discount = 0;
        public String discountName;
        /** Whether the gateway's page shows its own promotion code box (settings.payments.codes = gateway). */
        public Boolean allowGatewayCodes = false;
        /** The respondent's email from the form's Email field, for the gateway's page to fill in; null when the form has none. */
        public String customerEmail;
        /** The gateway's page always asks for a billing address (settings.payments.askBillingAddress). */
        public Boolean askBillingAddress = false;
    }

    public class Checkout {
        public String reference;
        public String url;
    }

    /** A checkout's state, or a refund, as a gateway reports it. */
    public class GatewayUpdate {
        public String kind;
        public String mode;
        public String checkoutReference;
        public String paymentReference;
        /** In the currency's smallest unit. */
        public Long amount;
        public String currencyCode;
        /** With a discount taken on the gateway's page: the amount before it, what it took off, and the code. */
        public Long subtotal;
        public Long discount;
        public String code;
        public String paymentMethod;
        public String providerUrl;
        public List<Refund> refunds = new List<Refund>();
        public String eventId;
        public String eventType;
    }

    public class Refund {
        public String reference;
        public Long amount;
        public String currencyCode;
        /** Pending, Succeeded or Failed. */
        public String status;
        public Datetime createdAt;
    }

    public class ConnectionCheck {
        @AuraEnabled public String mode;
        @AuraEnabled public Boolean keyWorks = false;
        @AuraEnabled public String keyProblem;
        @AuraEnabled public Boolean webhookFound = false;
        @AuraEnabled public Boolean webhookEnabled = false;
        @AuraEnabled public List<String> missingEvents = new List<String>();
        @AuraEnabled public String webhookUrl;
        @AuraEnabled public Boolean secretSet = false;
    }

    /** What the Pay button gets back. */
    public class Started {
        @AuraEnabled public Id submissionId;
        /** Blank when nothing was owed: the response was stored like any other. */
        @AuraEnabled public String checkoutUrl;
        @AuraEnabled public String checkoutReference;
        @AuraEnabled public String mode;
        @AuraEnabled public Decimal amount;
        @AuraEnabled public String currencyCode;
    }

    /** The provider for a form's gateway (settings.payments.gateway). */
    public static JFormPaymentProvider providerFor(String gateway) {
        if (providerOverride != null) {
            return providerOverride;
        }
        if (gateway == STRIPE) {
            return new JFormStripeProvider();
        }
        throw new PaymentException(NOT_TAKING);
    }

    /** The provider that took a payment: the gateway whose name the payment carries in Provider__c. */
    public static JFormPaymentProvider providerOf(String providerName) {
        for (String gateway : GATEWAYS) {
            JFormPaymentProvider p = providerFor(gateway);
            if (p.name() == providerName) {
                return p;
            }
        }
        throw new PaymentException('JForm has no payment gateway named "' + providerName + '".');
    }

    // ------------------------------------------------------------ form settings

    /** settings.payments of a form: { gateway, mode: test | live, currency, openIn: popup | page, testSteps, codes, emailField, askEmail, askBillingAddress }. */
    public class FormSettings {
        /** Lower case; one JForm does not support is kept as given, so saving and publishing can name it. */
        public String gateway = STRIPE;
        public String mode = TEST;
        public String currencyCode = 'USD';
        public String openIn = 'popup';
        /** Test payments run the record steps too, so a test goes all the way through. */
        public Boolean testSteps = true;
        /** Promotion codes: none, jform (defined on the form) or gateway (defined in the gateway). */
        public String codes = JFormPromotionCodeService.NONE;
        /**
         * The key of the Email field whose answer goes to the gateway's page, on a form with several; null means
         * the form's only Email field, or none (customerEmail).
         */
        public String emailField;
        /** The builder chose "Ask on the gateway's page": no answer is sent, even from the form's only Email field. */
        public Boolean askEmail = false;
        /** The gateway's page always asks for a billing address, not only when the card needs one. */
        public Boolean askBillingAddress = false;
    }

    /** settings.payments as stored, to change it in place; null when the form has none. */
    public static Map<String, Object> storedSettings(JFormDefinition.Form def) {
        return def != null && def.settings != null && def.settings.get('payments') instanceof Map<String, Object>
            ? (Map<String, Object>) def.settings.get('payments') : null;
    }

    /** settings.payments.emailField trimmed; null when it is not set. */
    public static String storedEmailField(Map<String, Object> payments) {
        Object raw = payments == null ? null : payments.get('emailField');
        return raw instanceof String && String.isNotBlank((String) raw) ? ((String) raw).trim() : null;
    }

    public static FormSettings settingsOf(JFormDefinition.Form def) {
        FormSettings s = new FormSettings();
        Map<String, Object> raw = storedSettings(def) == null ? new Map<String, Object>() : storedSettings(def);
        if (raw.get('gateway') instanceof String && String.isNotBlank((String) raw.get('gateway'))) {
            s.gateway = ((String) raw.get('gateway')).trim().toLowerCase();
        }
        s.mode = 'live'.equalsIgnoreCase(String.valueOf(raw.get('mode'))) ? LIVE : TEST;
        if (raw.get('currency') instanceof String && String.isNotBlank((String) raw.get('currency'))) {
            s.currencyCode = ((String) raw.get('currency')).trim().toUpperCase();
        }
        s.openIn = raw.get('openIn') == 'page' ? 'page' : 'popup';
        s.testSteps = raw.get('testSteps') != false;
        String codes = raw.get('codes') instanceof String ? ((String) raw.get('codes')).trim().toLowerCase() : null;
        s.codes = JFormPromotionCodeService.KINDS.contains(codes) ? codes : JFormPromotionCodeService.NONE;
        s.emailField = storedEmailField(raw);
        s.askEmail = raw.get('askEmail') == true;
        s.askBillingAddress = raw.get('askBillingAddress') == true;
        return s;
    }

    /** The form's Email fields, in form order. */
    public static List<JFormDefinition.Field> emailFields(JFormDefinition.Form def) {
        List<JFormDefinition.Field> out = new List<JFormDefinition.Field>();
        for (JFormDefinition.Section s : def == null || def.sections == null ? new List<JFormDefinition.Section>() : def.sections) {
            for (JFormDefinition.Field f : s.fields == null ? new List<JFormDefinition.Field>() : s.fields) {
                if (f.fieldType == 'email') {
                    out.add(f);
                }
            }
        }
        return out;
    }

    /**
     * The Email field settings.payments.emailField names, or null. Keys are matched exactly, as the builder does:
     * Apex's == on strings ignores case.
     */
    private static JFormDefinition.Field namedEmailField(JFormDefinition.Form def, String key) {
        for (JFormDefinition.Field f : emailFields(def)) {
            if (f.key != null && f.key.equals(key)) {
                return f;
            }
        }
        return null;
    }

    /**
     * The respondent's email address for the gateway's page, so it is filled in there instead of asked again:
     * the answer of the form's one Email field, or of the one settings.payments.emailField names when the form
     * has several (none chosen, the page keeps asking). Null when the builder chose to let the page ask, the form
     * has no such field, logic hides it, it was left blank, or the answer is not an address or is longer than any
     * real one.
     */
    public static String customerEmail(JFormDefinition.Form def, Map<String, Object> answers, JFormLogicEvaluator.Result logic, FormSettings settings) {
        JFormDefinition.Field chosen;
        if (settings.askEmail) {
            return null;
        } else if (String.isNotBlank(settings.emailField)) {
            chosen = namedEmailField(def, settings.emailField);
        } else {
            List<JFormDefinition.Field> fields = emailFields(def);
            chosen = fields.size() == 1 ? fields[0] : null;
        }
        if (chosen == null || answers == null || (logic != null && logic.visible.get(chosen.key) == false)) {
            return null;
        }
        Object answer = answers.get(chosen.key);
        String text = answer instanceof String ? ((String) answer).trim() : null;
        return JFormAnswerValidator.isEmailAddress(text) && text.length() <= MAX_EMAIL_LENGTH ? text : null;
    }

    /**
     * On save: keep settings.payments.emailField only while it names an Email field of the form, trimmed. A field
     * that was deleted or changed type, whichever path did it (the builder, REST, an agent), leaves no choice
     * behind, and the gateway's page asks again. askEmail is kept only when true, and then no field is named.
     */
    public static void normaliseEmailField(JFormDefinition.Form def) {
        Map<String, Object> payments = storedSettings(def);
        if (payments == null) {
            return;
        }
        Boolean ask = payments.get('askEmail') == true;
        String key = storedEmailField(payments);
        if (ask || key == null || namedEmailField(def, key) == null) {
            payments.remove('emailField');
        } else {
            payments.put('emailField', key);
        }
        if (!ask) {
            payments.remove('askEmail');
        }
    }

    /**
     * Null, or why settings.payments.emailField cannot be used: it names no Email field of the form. Checked when
     * publishing, never on save. Saving already drops such a choice (normaliseEmailField), so this only catches a
     * definition published without going through a save.
     */
    private static String emailFieldProblem(JFormDefinition.Form def, FormSettings s) {
        if (String.isBlank(s.emailField) || namedEmailField(def, s.emailField) != null) {
            return null;
        }
        return 'The Payments settings name an Email field "' + s.emailField + '" the form doesn\'t have. Choose one in Settings › Payments.';
    }

    public static Boolean isPaymentForm(JFormDefinition.Form def) {
        return JFormPaymentPricing.paymentField(def) != null;
    }

    /** The mode a published form takes payments in: sandboxes and scratch orgs take test payments only. */
    public static String modeOf(FormSettings s) {
        return s.mode == LIVE && !isSandbox() ? LIVE : TEST;
    }

    /** Whether a form takes live payments: it has a Payment block and takes payments in live mode (modeOf). */
    public static Boolean takesLivePayments(JFormDefinition.Form def) {
        return isPaymentForm(def) && modeOf(settingsOf(def)) == LIVE;
    }

    /**
     * The same for a form by Id, reading only its settings and whether one of its fields is a Payment block,
     * for a caller that needs nothing else of the definition (JFormRestApi.listSubmissions).
     */
    public static Boolean takesLivePayments(Id formId) {
        String blockType = JFormDefinition.PICKLIST_BY_TYPE.get(JFormPaymentPricing.FIELD_TYPE);
        List<Form__c> forms = [
            SELECT Settings_JSON__c,
                (SELECT Id FROM Form_Field_Definitions__r WHERE Field_Type__c = :blockType AND Form_Section__c != null LIMIT 1)
            FROM Form__c WHERE Id = :formId WITH USER_MODE LIMIT 1
        ];
        if (forms.isEmpty() || forms[0].Form_Field_Definitions__r.isEmpty()) {
            return false;
        }
        JFormDefinition.Form def = new JFormDefinition.Form();
        def.settings = JFormDefinition.parseSettings(forms[0].Settings_JSON__c);
        return modeOf(settingsOf(def)) == LIVE;
    }

    /** Why a published payment form cannot take payments now, for the respondent; null when it can. */
    public static String unavailableReason(JFormDefinition.Form def) {
        FormSettings s = settingsOf(def);
        if (!GATEWAYS.contains(s.gateway)) {
            return NOT_TAKING;
        }
        try {
            JFormPaymentPricing.normaliseCurrency(s.currencyCode);
        } catch (JFormPaymentPricing.PricingException e) {
            return NOT_TAKING;
        }
        return null;
    }

    /** What the renderer needs: null for a form without a Payment block. */
    public static Map<String, Object> publicView(JFormDefinition.Form def) {
        if (!isPaymentForm(def)) {
            return null;
        }
        FormSettings s = settingsOf(def);
        return new Map<String, Object>{
            'gateway' => s.gateway,
            'mode' => modeOf(s).toLowerCase(),
            'currency' => s.currencyCode,
            'openIn' => s.openIn,
            'codes' => s.codes,
            'unavailable' => unavailableReason(def)
        };
    }

    /** Checked on every save: one Payment block at most, a known pricing option, a gateway JForm supports and a usable currency. */
    public static List<String> definitionProblems(JFormDefinition.Form def) {
        List<String> problems = new List<String>();
        Integer blocks = 0;
        for (JFormDefinition.Section s : def.sections == null ? new List<JFormDefinition.Section>() : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (f.fieldType != JFormPaymentPricing.FIELD_TYPE) {
                    continue;
                }
                blocks++;
                Object pricing = f.config == null ? null : f.config.get('pricing');
                if (pricing != null && !JFormPaymentPricing.PRICING.contains(String.valueOf(pricing))) {
                    problems.add('The Payment block has an unknown pricing option "' + pricing + '".');
                }
            }
        }
        if (blocks > 1) {
            problems.add('A form can have one Payment block.');
        }
        if (blocks > 0) {
            String gateway = settingsOf(def).gateway;
            if (!GATEWAYS.contains(gateway)) {
                problems.add('JForm doesn\'t support the payment gateway "' + gateway + '". Use one of: ' + String.join(new List<String>(GATEWAYS), ', ') + '.');
            }
            try {
                JFormPaymentPricing.normaliseCurrency(settingsOf(def).currencyCode);
            } catch (JFormPaymentPricing.PricingException e) {
                problems.add(e.getMessage());
            }
        }
        return problems;
    }

    /**
     * Checked when publishing: each pricing option's settings and, on a payment form, the email field and the
     * promotion codes.
     */
    public static List<String> publishProblems(JFormDefinition.Form def) {
        FormSettings s = settingsOf(def);
        List<String> problems = JFormPaymentPricing.publishProblems(def, s.currencyCode);
        String emailProblem = isPaymentForm(def) ? emailFieldProblem(def, s) : null;
        if (emailProblem != null) {
            problems.add(emailProblem);
        }
        if (isPaymentForm(def) && s.codes != JFormPromotionCodeService.NONE) {
            // the respondent picks the amount, so a discount on it means nothing
            if (JFormPaymentPricing.pricingOf(JFormPaymentPricing.paymentField(def)) == 'custom') {
                problems.add('Promotion codes can\'t be used with "pay what you want" pricing. Turn them off in Settings › Payments, or price the Payment block.');
            } else if (s.codes == JFormPromotionCodeService.JFORM && String.isNotBlank(def.id)) {
                try {
                    problems.addAll(JFormPromotionCodeService.publishProblems(def.id, JFormPaymentPricing.normaliseCurrency(s.currencyCode)));
                } catch (JFormPaymentPricing.PricingException e) {
                    // the currency itself is reported above
                }
            }
        }
        return problems;
    }

    // ------------------------------------------------------------ pay and submit

    /**
     * Whether a response to this form owes money, so it can only arrive through the Pay button. A price
     * that cannot be worked out counts as owing: the plain submit paths never skip a payment.
     */
    public static Boolean owes(JFormSubmissionService.Prepared p) {
        return !p.spam && owes(p.def, p.answers, p.logic);
    }

    /**
     * The same for answers that are not prepared yet, as the spam check sees them: the logic is evaluated
     * here. An order is never a duplicate, since each checkout is paid on its own.
     */
    public static Boolean owes(JFormDefinition.Form def, Map<String, Object> answers) {
        return isPaymentForm(def) && owes(def, answers, JFormLogicEvaluator.evaluate(def, answers));
    }

    private static Boolean owes(JFormDefinition.Form def, Map<String, Object> answers, JFormLogicEvaluator.Result logic) {
        if (!isPaymentForm(def)) {
            return false;
        }
        try {
            JFormPaymentPricing.Quote q = JFormPaymentPricing.quote(def, answers, logic, settingsOf(def).currencyCode);
            return q != null && q.amount > 0;
        } catch (JFormPaymentPricing.PricingException e) {
            return true;
        }
    }

    /**
     * The Pay button: price the checked response, open a checkout at the gateway (a callout, so before any
     * DML), then store the response as Awaiting payment with its Form Payment record. A response that owes
     * nothing, or was flagged as spam, is stored like any other and gets no checkout.
     */
    public static Started submit(JFormSubmissionService.Prepared p, String returnUrl) {
        Started out = new Started();
        if (p.spam) {
            out.submissionId = JFormSubmissionService.store(p, null).submissionId;
            return out;
        }
        String unavailable = unavailableReason(p.def);
        if (unavailable != null) {
            throw new PaymentException(unavailable);
        }
        FormSettings settings = settingsOf(p.def);
        JFormPaymentPricing.Quote quote = JFormPaymentPricing.quote(p.def, p.answers, p.logic, settings.currencyCode);
        if (quote != null && settings.codes == JFormPromotionCodeService.JFORM && String.isNotBlank(p.promotionCode)) {
            // checked again here: a code that stopped being valid since the Apply click refuses the whole click
            JFormPromotionCodeService.Verdict v = JFormPromotionCodeService.checkLimited(p.form.Id, quote.currencyCode, p.promotionCode, p.timingToken);
            if (!v.valid) {
                throw new JFormPaymentPricing.PricingException(JFormPromotionCodeService.REFUSED);
            }
            JFormPaymentPricing.applyCode(quote, v);
        }
        String mode = modeOf(settings);
        if (quote == null || quote.amount <= 0) {
            if (quote != null && quote.discount > 0) {
                return storeFree(p, quote, settings, mode);
            }
            out.submissionId = JFormSubmissionService.store(p, null).submissionId;
            return out;
        }
        String base = returnAddress(returnUrl);
        String sep = base.contains('?') ? '&' : '?';
        String window = settings.openIn == 'popup' ? '&jfwin=1' : '';

        CheckoutRequest r = new CheckoutRequest();
        r.mode = mode;
        r.publicKey = p.form.Public_Key__c;
        r.reference = 'jf_' + EncodingUtil.convertToHex(Crypto.generateAesKey(128)).left(24);
        r.description = String.isNotBlank(p.def.name) ? p.def.name : p.form.Name;
        r.quote = quote;
        // Stripe puts the checkout's ID in place of {CHECKOUT_SESSION_ID}; the renderer reads it back. JForm's own
        // reference rides on both links, so a cancelled checkout is found again where the browser kept nothing
        // (browsers keep a framed form's storage apart from the page it comes back to)
        r.successUrl = base + sep + 'jfpay=success' + window + '&jfref=' + r.reference + '&jfcs={CHECKOUT_SESSION_ID}';
        r.cancelUrl = base + sep + 'jfpay=cancel' + window + '&jfref=' + r.reference;
        r.expiresAt = System.now().addMinutes(CHECKOUT_MINUTES);
        r.discount = quote.discount;
        r.discountName = quote.code;
        r.allowGatewayCodes = settings.codes == JFormPromotionCodeService.GATEWAY;
        r.customerEmail = customerEmail(p.def, p.answers, p.logic, settings);
        r.askBillingAddress = settings.askBillingAddress;
        JFormPaymentProvider gateway = providerFor(settings.gateway);
        Checkout c = gateway.createCheckout(r);

        // Each click opens its own checkout and response. A click whose reply never reached the browser
        // leaves a checkout nobody can open: it expires at the gateway within the hour, and unpaid
        // responses stay out of the counts and the duplicate check.
        // the hold's amount becomes the Payment block's answer (JFormSubmissionService.store)
        JFormSubmissionService.PaymentHold hold = new JFormSubmissionService.PaymentHold();
        hold.amount = quote.major();
        out.submissionId = JFormSubmissionService.store(p, hold).submissionId;
        insert new Form_Payment__c(
            Form_Submission__c = out.submissionId,
            Form__c = p.form.Id,
            Type__c = 'Payment',
            Status__c = AWAITING,
            Mode__c = mode,
            Provider__c = gateway.name(),
            Amount__c = quote.amount,
            Amount_Refunded__c = 0,
            Currency__c = quote.currencyCode,
            Checkout_Reference__c = c.reference,
            Client_Reference__c = r.reference,
            Promotion_Code__c = quote.codeId,
            Code__c = quote.code,
            Discount_Amount__c = quote.discount
        );
        out.checkoutUrl = c.url;
        out.checkoutReference = c.reference;
        out.mode = mode.toLowerCase();
        out.amount = quote.major();
        out.currencyCode = quote.currencyCode;
        return out;
    }

    /**
     * A promotion code took the total to zero: nothing to pay, so no checkout. The response is stored at
     * once as Paid with a Form Payment of amount 0 and no checkout reference, so the code's use and the
     * discount are on record, and its record steps run as they do after a payment.
     */
    private static Started storeFree(JFormSubmissionService.Prepared p, JFormPaymentPricing.Quote quote, FormSettings settings, String mode) {
        Started out = new Started();
        JFormSubmissionService.PaymentHold hold = new JFormSubmissionService.PaymentHold();
        hold.amount = 0;
        hold.status = PAID;
        out.submissionId = JFormSubmissionService.store(p, hold).submissionId;
        insert new Form_Payment__c(
            Form_Submission__c = out.submissionId,
            Form__c = p.form.Id,
            Type__c = 'Payment',
            Status__c = PAID,
            Paid_At__c = System.now(),
            Mode__c = mode,
            Provider__c = providerFor(settings.gateway).name(),
            Amount__c = 0,
            Amount_Refunded__c = 0,
            Currency__c = quote.currencyCode,
            Promotion_Code__c = quote.codeId,
            Code__c = quote.code,
            Discount_Amount__c = quote.discount
        );
        queueSteps(new Map<Id, String>{ out.submissionId => mode });
        out.mode = mode.toLowerCase();
        out.amount = 0;
        out.currencyCode = quote.currencyCode;
        return out;
    }

    /** The page the respondent pays from, without an earlier attempt's return parameters. It must be on one of the org's sites. */
    @TestVisible
    private static String returnAddress(String returnUrl) {
        String text = returnUrl == null ? '' : returnUrl.trim().substringBefore('#');
        Url parsed;
        try {
            parsed = String.isBlank(text) || text.length() > 1500 ? null : new Url(text);
        } catch (Exception e) {
            parsed = null;
        }
        if (parsed == null || parsed.getProtocol() != 'https' || !isSiteHost(parsed.getHost())) {
            throw new PaymentException('This form can take payments only on its Salesforce site.');
        }
        List<String> kept = new List<String>();
        for (String part : String.isBlank(parsed.getQuery()) ? new List<String>() : parsed.getQuery().split('&')) {
            if (String.isNotBlank(part) && !RETURN_PARAMS.contains(part.substringBefore('='))) {
                kept.add(part);
            }
        }
        String port = parsed.getPort() > 0 ? ':' + parsed.getPort() : '';
        return 'https://' + parsed.getHost() + port + parsed.getPath() + (kept.isEmpty() ? '' : '?' + String.join(kept, '&'));
    }

    /** Whether the page is on one of the org's sites, on any of the site's domains. */
    private static Boolean isSiteHost(String host) {
        if (siteHosts == null) {
            siteHosts = JFormChannelService.siteHosts();
        }
        return String.isNotBlank(host) && siteHosts.contains(host.toLowerCase());
    }

    // ------------------------------------------------------------ status, for the renderer

    /**
     * The status of one of this form's checkouts, as a word: open, processing, paid, failed, expired or
     * unknown. A checkout of another form is unknown too, so the method cannot be used to probe. With
     * confirm, an open checkout is read from the gateway first (the return page, and the popup when it
     * says the respondent paid), so the thank-you does not wait for the webhook. The reference is the
     * gateway's or JForm's own (findCheckout).
     */
    public static String publicStatus(String publicKey, String checkoutReference, Boolean confirm) {
        Form_Payment__c p = findCheckout(publicKey, checkoutReference);
        if (p == null) {
            return 'unknown';
        }
        if (confirm == true && p.Status__c == AWAITING) {
            try {
                apply(new List<GatewayUpdate>{ providerOf(p.Provider__c).fetchCheckout(p.Mode__c, p.Checkout_Reference__c) });
                p = findCheckout(publicKey, checkoutReference);
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'JForm payment status check failed: ' + e.getMessage());
            }
        }
        return statusWord(p);
    }

    /**
     * The respondent left the checkout without paying: end it at the gateway, so it cannot be paid later,
     * and mark the response Expired. A checkout paid in the meantime is applied as paid instead.
     */
    public static String cancel(String publicKey, String checkoutReference) {
        Form_Payment__c p = findCheckout(publicKey, checkoutReference);
        if (p == null) {
            return 'unknown';
        }
        if (p.Status__c != AWAITING || p.Payment_Reference__c != null) {
            return statusWord(p);
        }
        GatewayUpdate u;
        try {
            providerOf(p.Provider__c).expireCheckout(p.Mode__c, p.Checkout_Reference__c);
            u = new GatewayUpdate();
            u.kind = KIND_EXPIRED;
            u.mode = p.Mode__c;
            u.checkoutReference = p.Checkout_Reference__c;
        } catch (Exception e) {
            // the gateway refuses to end a checkout that was completed meanwhile: apply what it has now
            try {
                u = providerOf(p.Provider__c).fetchCheckout(p.Mode__c, p.Checkout_Reference__c);
            } catch (Exception again) {
                System.debug(LoggingLevel.WARN, 'JForm could not cancel the checkout: ' + e.getMessage() + ' / ' + again.getMessage());
                return statusWord(p);
            }
        }
        apply(new List<GatewayUpdate>{ u });
        return statusWord(findCheckout(publicKey, checkoutReference));
    }

    /** One of the form's checkouts by either reference: the gateway's (the success link, the popup) or JForm's own (both return links). */
    private static Form_Payment__c findCheckout(String publicKey, String reference) {
        if (String.isBlank(publicKey) || String.isBlank(reference) || !Pattern.matches('[A-Za-z0-9_\\-]{1,255}', reference)) {
            return null;
        }
        List<Form_Payment__c> found = [
            SELECT Status__c, Mode__c, Provider__c, Checkout_Reference__c, Payment_Reference__c
            FROM Form_Payment__c
            WHERE (Checkout_Reference__c = :reference OR Client_Reference__c = :reference)
                AND Form__r.Public_Key__c = :publicKey AND Type__c = 'Payment'
            LIMIT 1
        ];
        return found.isEmpty() ? null : found[0];
    }

    private static String statusWord(Form_Payment__c p) {
        if (p.Status__c == AWAITING) {
            // a bank debit: the checkout is done, the money follows
            return p.Payment_Reference__c != null ? 'processing' : 'open';
        }
        if (p.Status__c == FAILED) {
            return 'failed';
        }
        if (p.Status__c == EXPIRED) {
            return 'expired';
        }
        return 'paid';
    }

    // ------------------------------------------------------------ apply what the gateway says

    /**
     * Apply checkout states and refunds. Each payment moves forward once (Awaiting payment to Paid, Failed
     * or Expired), so a repeated webhook, the return page and the hourly check can all report the same
     * checkout safely. A payment is marked Paid only when the gateway's mode matches the record; one charged
     * for another amount or currency than priced is recorded with what was charged (transition). Returns an
     * outcome per checkout or payment reference, for the webhook's reply and tests.
     * All or none: a row the org refuses fails the whole call, so the webhook replies 500 and the gateway tries again.
     */
    public static Map<String, String> apply(List<GatewayUpdate> updates) {
        return apply(updates, true);
    }

    /**
     * With allOrNone false (the hourly check), a row the org refuses, say by a rule on the response, is
     * logged with the reason and left for a later run while the others are saved; its outcome says so and
     * its record steps are not queued. Responses are saved before their payments, so a payment whose
     * response could not be saved stays Awaiting payment and is read again: no payment says Paid while
     * its response still waits.
     */
    public static Map<String, String> apply(List<GatewayUpdate> updates, Boolean allOrNone) {
        Map<String, String> outcomes = new Map<String, String>();
        Map<String, GatewayUpdate> byCheckout = new Map<String, GatewayUpdate>();
        for (GatewayUpdate u : updates) {
            if (u == null || u.kind == KIND_IGNORED) {
                continue;
            }
            if (u.kind == KIND_REFUNDED) {
                outcomes.put(u.paymentReference, applyRefund(u));
            } else if (String.isNotBlank(u.checkoutReference)) {
                byCheckout.put(u.checkoutReference, u);
            }
        }
        if (byCheckout.isEmpty()) {
            return outcomes;
        }
        List<Form_Payment__c> changed = new List<Form_Payment__c>();
        Map<Id, Form_Submission__c> responses = new Map<Id, Form_Submission__c>();
        Map<Id, String> paidModes = new Map<Id, String>();
        Map<Id, Decimal> repriced = new Map<Id, Decimal>();
        // locked, so the webhook and the return page cannot both apply the same change
        for (Form_Payment__c p : [
            SELECT Id, Status__c, Mode__c, Amount__c, Currency__c, Amount_Expected__c, Promotion_Code__c, Checkout_Reference__c, Payment_Reference__c, Form_Submission__c
            FROM Form_Payment__c WHERE Checkout_Reference__c IN :byCheckout.keySet() AND Type__c = 'Payment'
            FOR UPDATE
        ]) {
            // with a second gateway, also skip an update whose provider is not p.Provider__c (docs/ENHANCEMENTS.md)
            GatewayUpdate u = byCheckout.get(p.Checkout_Reference__c);
            Long priced = p.Amount__c == null ? null : p.Amount__c.longValue();
            String outcome = transition(p, u);
            outcomes.put(p.Checkout_Reference__c, outcome);
            if (outcome == PAID || outcome == FAILED || outcome == EXPIRED) {
                changed.add(p);
                Form_Submission__c response = new Form_Submission__c(Id = p.Form_Submission__c, Payment_Status__c = outcome);
                if (outcome == PAID && p.Amount__c.longValue() != priced) {
                    // a code on the gateway's page, or charged for another amount than priced: the response and
                    // the Payment block's stored answer show what was charged, as the payment does
                    response.Payment_Amount__c = JFormPaymentPricing.toMajor(p.Amount__c.longValue(), p.Currency__c);
                    repriced.put(p.Form_Submission__c, response.Payment_Amount__c);
                }
                responses.put(p.Form_Submission__c, response);
                if (outcome == PAID) {
                    paidModes.put(p.Form_Submission__c, p.Mode__c);
                }
            } else if (outcome == KIND_PROCESSING) {
                changed.add(p);
            }
        }
        for (String ref : byCheckout.keySet()) {
            if (!outcomes.containsKey(ref)) {
                outcomes.put(ref, 'unknown checkout'); // another app's checkout in the same gateway account
            }
        }
        List<Form_Submission__c> responseRows = responses.values();
        Set<Id> unsaved = new Set<Id>();
        List<Database.SaveResult> saved = Database.update(responseRows, allOrNone);
        for (Integer i = 0; i < saved.size(); i++) {
            if (!saved[i].isSuccess()) {
                unsaved.add(responseRows[i].Id);
                logRefused('response ' + responseRows[i].Id, saved[i]);
            }
        }
        repriced.keySet().removeAll(unsaved);
        restateBlockAnswers(repriced);
        List<Form_Payment__c> payments = new List<Form_Payment__c>();
        for (Form_Payment__c p : changed) {
            if (unsaved.contains(p.Form_Submission__c)) {
                outcomes.put(p.Checkout_Reference__c, 'not saved');
                paidModes.remove(p.Form_Submission__c);
            } else {
                payments.add(p);
            }
        }
        saved = Database.update(payments, allOrNone);
        for (Integer i = 0; i < saved.size(); i++) {
            if (!saved[i].isSuccess()) {
                outcomes.put(payments[i].Checkout_Reference__c, 'not saved');
                paidModes.remove(payments[i].Form_Submission__c);
                logRefused('payment ' + payments[i].Id, saved[i]);
            }
        }
        queueSteps(paidModes);
        return outcomes;
    }

    /** The Payment block's stored answer is the amount charged, as the response's Payment Amount is. */
    private static void restateBlockAnswers(Map<Id, Decimal> amounts) {
        if (amounts.isEmpty()) {
            return;
        }
        String blockType = JFormDefinition.PICKLIST_BY_TYPE.get(JFormPaymentPricing.FIELD_TYPE);
        List<Submission_Field_Value__c> values = [
            SELECT Id, Form_Submission__c FROM Submission_Field_Value__c
            WHERE Form_Submission__c IN :amounts.keySet() AND Form_Field_Definition__r.Field_Type__c = :blockType
        ];
        for (Submission_Field_Value__c v : values) {
            v.Field_Value__c = String.valueOf(amounts.get(v.Form_Submission__c));
        }
        Database.update(values, false);
    }

    private static void logRefused(String what, Database.SaveResult r) {
        List<String> reasons = new List<String>();
        for (Database.Error e : r.getErrors()) {
            reasons.add(e.getStatusCode() + ': ' + e.getMessage());
        }
        System.debug(LoggingLevel.ERROR, 'JForm payment: ' + what + ' could not be saved and will be tried again: ' + String.join(reasons, '; '));
    }

    /** Move one payment forward; returns its new status, processing, or why nothing changed. */
    private static String transition(Form_Payment__c p, GatewayUpdate u) {
        if (u.mode != p.Mode__c) {
            System.debug(LoggingLevel.WARN, 'JForm payment ' + p.Id + ': a ' + u.mode + ' update for a ' + p.Mode__c + ' payment was ignored.');
            return 'mode does not match';
        }
        if (p.Status__c != AWAITING) {
            return 'already ' + p.Status__c;
        }
        if (u.kind == KIND_PAID) {
            if (u.amount == null || String.isBlank(u.currencyCode)) {
                System.debug(LoggingLevel.ERROR, 'JForm payment ' + p.Id + ': the gateway reported it paid without an amount; not marked paid.');
                return 'amount missing';
            }
            if (u.discount != null && u.discount > 0 && p.Promotion_Code__c == null && u.subtotal != null
                    && u.subtotal == p.Amount__c.longValue() && u.currencyCode == p.Currency__c) {
                // a promotion code entered on the gateway's page: the form priced the subtotal, the gateway took
                // the discount off it, and the payment keeps both (settings.payments.codes = gateway)
                p.Amount__c = u.amount;
                p.Discount_Amount__c = u.discount;
                p.Code__c = String.isBlank(u.code) ? null : u.code.left(40);
            }
            if (u.amount != p.Amount__c.longValue() || u.currencyCode != p.Currency__c) {
                // The checkout is created with the gateway's price localisation off, so the amount charged is the
                // amount priced; should the gateway still charge another, the respondent has paid, so the payment
                // counts with what was charged and keeps what the form priced for the builder to see. Leaving it
                // Awaiting payment would keep a paid response out of the Responses tab and its record steps.
                System.debug(LoggingLevel.WARN, 'JForm payment ' + p.Id + ': the gateway charged ' + u.amount + ' ' + u.currencyCode
                    + ' for ' + p.Amount__c + ' ' + p.Currency__c + '.');
                p.Amount_Expected__c = p.Amount__c;
                p.Currency_Expected__c = p.Currency__c;
                p.Amount__c = u.amount;
                p.Currency__c = u.currencyCode;
            }
            p.Status__c = PAID;
            p.Paid_At__c = System.now();
            copyPayment(p, u);
            return PAID;
        }
        if (u.kind == KIND_PROCESSING) {
            if (p.Payment_Reference__c != null) {
                return 'still processing';
            }
            copyPayment(p, u);
            return KIND_PROCESSING;
        }
        if (u.kind == KIND_FAILED) {
            p.Status__c = FAILED;
            copyPayment(p, u);
            return FAILED;
        }
        if (u.kind == KIND_EXPIRED) {
            p.Status__c = EXPIRED;
            return EXPIRED;
        }
        return 'still open';
    }

    private static void copyPayment(Form_Payment__c p, GatewayUpdate u) {
        if (String.isNotBlank(u.paymentReference)) {
            p.Payment_Reference__c = u.paymentReference;
        }
        if (String.isNotBlank(u.paymentMethod)) {
            p.Payment_Method__c = u.paymentMethod.left(80);
        }
        if (String.isNotBlank(u.providerUrl)) {
            p.Provider_Url__c = u.providerUrl;
        }
    }

    /** A refund row moves Pending, Succeeded, Failed (a refund can fail after succeeding), never back. */
    private static final List<String> REFUND_STEPS = new List<String>{ 'Pending', 'Succeeded', 'Failed' };

    /**
     * A refund made in the gateway's dashboard: one refund row per gateway refund, kept up to date, and the
     * payment's amount refunded and status (Partially refunded, then Refunded) on it and its response.
     * Refund events can arrive late and out of order, so the amount refunded is the sum of the stored
     * Succeeded rows, read while the payment is locked: an older event's list cannot undo a newer one. A
     * refund the gateway reports as failed stops counting, the one way a payment's status can go down.
     */
    private static String applyRefund(GatewayUpdate u) {
        List<Form_Payment__c> found = String.isBlank(u.paymentReference) ? new List<Form_Payment__c>() : [
            SELECT Id, Status__c, Mode__c, Amount__c, Currency__c, Provider__c, Form__c, Form_Submission__c
            FROM Form_Payment__c WHERE Payment_Reference__c = :u.paymentReference AND Type__c = 'Payment'
            LIMIT 1 FOR UPDATE
        ];
        if (found.isEmpty()) {
            return 'unknown payment';
        }
        Form_Payment__c p = found[0];
        if (u.mode != p.Mode__c) {
            return 'mode does not match';
        }
        Map<String, Form_Payment__c> existing = new Map<String, Form_Payment__c>();
        for (Form_Payment__c r : [SELECT Id, Refund_Reference__c, Status__c FROM Form_Payment__c WHERE Refunded_Payment__c = :p.Id AND Type__c = 'Refund']) {
            existing.put(r.Refund_Reference__c, r);
        }
        List<Form_Payment__c> rows = new List<Form_Payment__c>();
        for (Refund r : u.refunds) {
            if (String.isBlank(r.reference)) {
                continue;
            }
            Form_Payment__c known = existing.get(r.reference);
            if (known != null && REFUND_STEPS.indexOf(r.status) < REFUND_STEPS.indexOf(known.Status__c)) {
                continue; // an older list than one already applied
            }
            Form_Payment__c row = known != null
                ? new Form_Payment__c(Id = known.Id)
                : new Form_Payment__c(
                    Form_Submission__c = p.Form_Submission__c,
                    Form__c = p.Form__c,
                    Type__c = 'Refund',
                    Refunded_Payment__c = p.Id,
                    Refund_Reference__c = r.reference,
                    Mode__c = p.Mode__c,
                    Provider__c = p.Provider__c
                );
            row.Status__c = r.status;
            row.Amount__c = r.amount;
            row.Currency__c = r.currencyCode;
            rows.add(row);
        }
        upsert rows;
        // the stored rows, including any that another event saved before this one got the lock
        // (Apex is case-insensitive: a local "refunded" would hide REFUNDED)
        Long refundedAmount = 0;
        for (Form_Payment__c r : [SELECT Amount__c FROM Form_Payment__c WHERE Refunded_Payment__c = :p.Id AND Type__c = 'Refund' AND Status__c = 'Succeeded']) {
            refundedAmount += r.Amount__c == null ? 0 : r.Amount__c.longValue();
        }
        p.Amount_Refunded__c = refundedAmount;
        Boolean wasPaid = p.Status__c == PAID || p.Status__c == PARTIALLY_REFUNDED || p.Status__c == REFUNDED;
        if (wasPaid) {
            p.Status__c = refundedAmount >= p.Amount__c ? REFUNDED : (refundedAmount > 0 ? PARTIALLY_REFUNDED : PAID);
            update new Form_Submission__c(Id = p.Form_Submission__c, Payment_Status__c = p.Status__c);
        }
        update p;
        return wasPaid ? p.Status__c : 'refund recorded';
    }

    // ------------------------------------------------------------ record steps after payment

    /** Queue the record steps of newly paid responses; a test payment skips them when the form says so. */
    private static void queueSteps(Map<Id, String> paidModes) {
        if (paidModes.isEmpty()) {
            return;
        }
        List<Id> ids = new List<Id>();
        for (Form_Submission__c s : [
            SELECT Id, Form_Version__r.Definition_JSON__c, Form__r.Current_Version__r.Definition_JSON__c
            FROM Form_Submission__c WHERE Id IN :paidModes.keySet()
        ]) {
            String json = s.Form_Version__r?.Definition_JSON__c;
            if (String.isBlank(json)) {
                json = s.Form__r?.Current_Version__r?.Definition_JSON__c;
            }
            Boolean skip = paidModes.get(s.Id) == TEST && String.isNotBlank(json) && !settingsOf(JFormDefinition.parse(json)).testSteps;
            if (!skip) {
                ids.add(s.Id);
            }
        }
        if (ids.isEmpty()) {
            return;
        }
        queuedSteps.addAll(ids);
        if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
            System.enqueueJob(new StepsJob(ids));
        } else {
            System.debug(LoggingLevel.ERROR, 'JForm could not queue the record steps of paid responses ' + ids + '; reprocess them from the Responses tab.');
        }
    }

    /** Runs the record steps paid responses held back, a few per job; the rest go to the next job. */
    public class StepsJob implements Queueable {
        private List<Id> submissionIds;

        public StepsJob(List<Id> submissionIds) {
            this.submissionIds = submissionIds;
        }

        public void execute(QueueableContext ctx) {
            List<Id> later = new List<Id>();
            for (Integer i = 0; i < submissionIds.size(); i++) {
                if (i >= JFormPaymentService.STEPS_PER_JOB) {
                    later.add(submissionIds[i]);
                    continue;
                }
                // a response processed meanwhile (the builder clicked Reprocess first) has its records: leave it be
                if (isProcessed(submissionIds[i])) {
                    continue;
                }
                try {
                    JFormSubmissionService.reprocess(submissionIds[i]);
                } catch (Exception e) {
                    if (!isProcessed(submissionIds[i])) {
                        update new Form_Submission__c(Id = submissionIds[i], Status__c = 'Error', Error_Message__c = e.getMessage().left(4000));
                    }
                }
            }
            if (!later.isEmpty()) {
                System.enqueueJob(new StepsJob(later));
            }
        }

        private Boolean isProcessed(Id submissionId) {
            return [SELECT Status__c FROM Form_Submission__c WHERE Id = :submissionId].Status__c == 'Processed';
        }
    }

    // ------------------------------------------------------------ hourly check

    /**
     * Checkouts still Awaiting payment after the gateway would have expired them, read from the gateway
     * and applied: a webhook that never arrived, and bank debits that finish days later. Runs hourly
     * (JFormPaymentCheckJob). A run reads the checkouts it has never read first, then the least recently
     * read, and stops at the time budget, so checkouts the gateway keeps reporting as open (or slowly)
     * take turns instead of holding the newer ones back. All callouts come before the updates. One bad
     * row never holds the run: the updates are saved one by one, and when applying them fails as a whole
     * (a lock the webhook holds, say) the run is rolled back and still records what it read, so the next
     * run moves on and this batch comes round again later.
     */
    public static Integer checkOpenCheckouts() {
        Datetime settled = System.now().addMinutes(-(CHECKOUT_MINUTES + 10));
        Datetime oldest = System.now().addDays(-30);
        List<GatewayUpdate> updates = new List<GatewayUpdate>();
        List<Form_Payment__c> checked = new List<Form_Payment__c>();
        Long started = System.currentTimeMillis();
        for (Form_Payment__c p : [
            SELECT Id, Mode__c, Provider__c, Checkout_Reference__c FROM Form_Payment__c
            WHERE Type__c = 'Payment' AND Status__c = :AWAITING AND CreatedDate < :settled AND CreatedDate > :oldest
            ORDER BY Last_Checked_At__c NULLS FIRST, CreatedDate LIMIT :CHECKS_PER_RUN
        ]) {
            if (!checked.isEmpty() && System.currentTimeMillis() - started >= checkBudgetMs) {
                break;
            }
            try {
                updates.add(providerOf(p.Provider__c).fetchCheckout(p.Mode__c, p.Checkout_Reference__c));
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'JForm payment check: ' + p.Checkout_Reference__c + ': ' + e.getMessage());
            }
            checked.add(new Form_Payment__c(Id = p.Id, Last_Checked_At__c = System.now()));
        }
        Savepoint sp = Database.setSavepoint();
        try {
            apply(updates, false);
        } catch (Exception e) {
            Database.rollback(sp);
            System.debug(LoggingLevel.ERROR, 'JForm payment check: the updates could not be applied and will be tried again: ' + e.getTypeName() + ': ' + e.getMessage());
        }
        Database.update(checked, false); // a row the org refuses does not keep the others from taking their turn
        return updates.size();
    }

    /** The work behind the hourly job, found by name from JFormPaymentCheckJob. */
    public class CheckWork implements Queueable, Database.AllowsCallouts {
        public void execute(QueueableContext ctx) {
            JFormPaymentService.checkOpenCheckouts();
        }
    }

    public static Boolean checkScheduled() {
        return [SELECT COUNT() FROM CronTrigger WHERE CronJobDetail.Name = :JOB_NAME] > 0;
    }

    /** Schedule the hourly check, once. */
    public static void scheduleCheck() {
        if (!checkScheduled()) {
            System.schedule(JOB_NAME, '0 17 * * * ?', new JFormPaymentCheckJob());
        }
    }

    // ------------------------------------------------------------ setup: keys, webhook, connection

    /** One mode's row on the Setup tab: whether its key and signing secret are saved (never the values) and its webhook address. */
    public class ModeSetup {
        @AuraEnabled public String mode;
        @AuraEnabled public Boolean keySet = false;
        @AuraEnabled public String keyProblem;
        @AuraEnabled public Boolean secretSet = false;
        @AuraEnabled public String webhookUrl;
    }

    public static ModeSetup modeSetup(String mode) {
        ModeSetup m = new ModeSetup();
        m.mode = mode;
        try {
            m.keySet = credentialStore.hasKey(mode);
        } catch (Exception e) {
            m.keyProblem = e.getMessage();
        }
        m.secretSet = String.isNotBlank(webhookSecret(mode));
        m.webhookUrl = webhookUrl(mode);
        return m;
    }

    /** Save a Stripe secret or restricted key in the mode's named credential. A test key cannot go in the live row, nor the other way round. */
    public static void saveKey(String mode, String secretKey) {
        String key = secretKey == null ? '' : secretKey.trim();
        if (String.isBlank(key)) {
            credentialStore.removeKey(mode);
            return;
        }
        if (!Pattern.matches('(sk|rk)_(test|live)_[A-Za-z0-9]{10,250}', key)) {
            throw new PaymentException('Paste the secret key from Stripe\'s Developers > API keys page. It starts with sk_test_ or sk_live_ (rk_ for a restricted key).');
        }
        Boolean liveKey = key.substring(3).startsWith('live_');
        if (liveKey != (mode == LIVE)) {
            throw new PaymentException(liveKey
                ? 'That is a live key. The Test keys row takes a key that starts with sk_test_.'
                : 'That is a test key. The Live keys row takes a key that starts with sk_live_.');
        }
        credentialStore.saveKey(mode, key);
    }

    /** Save the mode's webhook signing secret (whsec_...); blank removes it. Saving one also starts the hourly check. */
    public static void saveWebhookSecret(String mode, String secret) {
        String value = secret == null ? '' : secret.trim();
        if (String.isNotBlank(value) && !Pattern.matches('whsec_[A-Za-z0-9+/=]{10,250}', value)) {
            throw new PaymentException('Paste the endpoint\'s signing secret from Stripe. It starts with whsec_.');
        }
        Payment_Settings__c s = settingsToSave();
        if (mode == LIVE) {
            s.Live_Webhook_Secret__c = String.isBlank(value) ? null : value;
        } else {
            s.Test_Webhook_Secret__c = String.isBlank(value) ? null : value;
        }
        // protected settings are writable only from the package's own code (see JFormSetupController)
        Database.upsert(s, AccessLevel.SYSTEM_MODE);
        if (String.isNotBlank(value)) {
            scheduleCheck();
        }
    }

    /** Keep the Experience site Stripe sends events to (webhookSite); null goes back to the first live one. */
    public static void saveWebhookSite(Id siteId) {
        Payment_Settings__c s = settingsToSave();
        s.Webhook_Site__c = siteId == null ? null : String.valueOf(siteId);
        Database.upsert(s, AccessLevel.SYSTEM_MODE);
    }

    private static Payment_Settings__c settingsToSave() {
        Payment_Settings__c s = Payment_Settings__c.getOrgDefaults();
        return s == null || s.Id == null ? new Payment_Settings__c(SetupOwnerId = UserInfo.getOrganizationId()) : s;
    }

    public static String webhookSecret(String mode) {
        Payment_Settings__c s = Payment_Settings__c.getOrgDefaults();
        if (s == null) {
            return null;
        }
        return mode == LIVE ? s.Live_Webhook_Secret__c : s.Test_Webhook_Secret__c;
    }

    /**
     * The key works with Stripe, and Stripe sends the seven events to this org's webhook address. The Setup
     * tab's keys, signing secrets and webhook address are Stripe's; a second gateway brings its own
     * credential store, and this side takes a gateway then (docs/ENHANCEMENTS.md).
     */
    public static ConnectionCheck checkConnection(String mode) {
        String url = webhookUrl(mode);
        ConnectionCheck c = providerFor(STRIPE).checkConnection(mode, url);
        c.webhookUrl = url;
        c.secretSet = String.isNotBlank(webhookSecret(mode));
        return c;
    }

    /** An Experience site as the webhook sees it: the record the Setup tab lists it by, and its Visualforce side's address. */
    public class WebhookSite {
        public Id siteId;
        public String baseUrl;
    }

    /**
     * The Experience site Stripe sends events to: the one chosen on the Setup tab's Payments page
     * (Payment_Settings__c.Webhook_Site__c) while it is active, else the first in JFormChannelService.getSites
     * order, the Share dialog's default. Apex REST is served from a site's Visualforce side, which an Experience
     * Builder site has next to it (same guest user; its URL prefix ends in "vforcesite"), so a site is listed by
     * its first record in that order, as JFormSetupController does, and answers on its Visualforce record's
     * address. Null without a site that has one. Its guest user must hold JForm Guest for the events to be
     * taken, which the Setup tab shows.
     */
    public static WebhookSite webhookSite() {
        Map<Id, Id> guestOf = new Map<Id, Id>();
        for (Site st : [SELECT Id, GuestUserId FROM Site WHERE Status = 'Active' AND GuestUserId != null WITH SYSTEM_MODE]) {
            guestOf.put(st.Id, st.GuestUserId);
        }
        List<WebhookSite> sites = new List<WebhookSite>();
        Map<Id, WebhookSite> byGuest = new Map<Id, WebhookSite>();
        for (JFormChannelService.SiteOption o : JFormChannelService.getSites()) {
            Id guest = guestOf.get(o.id);
            if (guest == null || o.isExperienceSite != true) {
                continue;
            }
            WebhookSite w = byGuest.get(guest);
            if (w == null) {
                w = new WebhookSite();
                w.siteId = o.id;
                byGuest.put(guest, w);
                sites.add(w);
            }
            if (o.siteType == 'ChatterNetwork' && w.baseUrl == null) {
                w.baseUrl = o.baseUrl;
            }
        }
        Payment_Settings__c s = Payment_Settings__c.getOrgDefaults();
        String chosen = s == null ? null : s.Webhook_Site__c;
        WebhookSite first;
        for (WebhookSite w : sites) {
            if (w.baseUrl == null) {
                continue;
            }
            if (chosen != null && String.valueOf(w.siteId) == chosen) {
                return w;
            }
            if (first == null) {
                first = w;
            }
        }
        return first;
    }

    /** Where Stripe sends the mode's events: on the webhook site; null without one. */
    public static String webhookUrl(String mode) {
        WebhookSite w = webhookSite();
        if (w == null) {
            return null;
        }
        String ns = String.isBlank(JFormNamespace.NAME) ? '' : JFormNamespace.NAME + '/';
        return w.baseUrl + '/services/apexrest/' + ns + 'payments/stripe/' + mode.toLowerCase();
    }

    public static Boolean isSandbox() {
        if (sandbox == null) {
            Organization org = [SELECT IsSandbox, TrialExpirationDate FROM Organization LIMIT 1];
            // scratch orgs are not sandboxes, but expire like a trial; neither takes real cards
            sandbox = org.IsSandbox || org.TrialExpirationDate != null;
        }
        return sandbox;
    }

    /** Where the secret keys live; tests swap it, since the Named Credentials API needs real setup data. */
    public interface CredentialStore {
        Boolean hasKey(String mode);
        void saveKey(String mode, String secretKey);
        void removeKey(String mode);
    }

    /** The JForm Stripe external credentials' named principal, through the Named Credentials API. */
    public class NamedCredentialStore implements CredentialStore {
        public Boolean hasKey(String mode) {
            ConnectApi.Credential c = ConnectApi.NamedCredentials.getCredential(
                JFormPaymentService.externalCredential(mode), JFormPaymentService.PRINCIPAL, ConnectApi.CredentialPrincipalType.NamedPrincipal);
            return c != null && c.credentials != null && c.credentials.containsKey(JFormPaymentService.KEY_PARAMETER);
        }

        public void saveKey(String mode, String secretKey) {
            ConnectApi.CredentialInput input = new ConnectApi.CredentialInput();
            input.externalCredential = JFormPaymentService.externalCredential(mode);
            input.principalName = JFormPaymentService.PRINCIPAL;
            input.principalType = ConnectApi.CredentialPrincipalType.NamedPrincipal;
            input.authenticationProtocol = ConnectApi.CredentialAuthenticationProtocol.Custom;
            ConnectApi.CredentialValueInput value = new ConnectApi.CredentialValueInput();
            value.value = secretKey;
            value.encrypted = true;
            input.credentials = new Map<String, ConnectApi.CredentialValueInput>{ JFormPaymentService.KEY_PARAMETER => value };
            // the first key is created, later ones replace it
            if (hasKey(mode)) {
                ConnectApi.NamedCredentials.updateCredential(input);
            } else {
                ConnectApi.NamedCredentials.createCredential(input);
            }
        }

        public void removeKey(String mode) {
            if (hasKey(mode)) {
                ConnectApi.NamedCredentials.deleteCredential(
                    JFormPaymentService.externalCredential(mode), JFormPaymentService.PRINCIPAL, ConnectApi.CredentialPrincipalType.NamedPrincipal);
            }
        }
    }

    /** JForm_Stripe_Test or JForm_Stripe_Live, with the package namespace when installed. */
    private static String externalCredential(String mode) {
        return JFormNamespace.qualify(mode == LIVE ? 'JForm_Stripe_Live' : 'JForm_Stripe_Test');
    }
}
