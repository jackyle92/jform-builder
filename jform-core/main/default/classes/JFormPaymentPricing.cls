/**
 * The price of a response, worked out on the server from the form's Payment block and the answers.
 * The renderer shows a total from the same rules (c/jformPayment), but no amount from the browser is
 * trusted: only "pay what you want" takes the respondent's figure, and checks it against its minimum.
 *
 * A Payment block (field type "payment") keeps its rules in config:
 *   pricing    fixed | choice | quantity | custom
 *   item       what the respondent pays for, shown on Stripe's page and receipt
 *   amount     fixed: the price
 *   source     choice: a choice field; quantity: a number field
 *   prices     choice: [{ value, amount }] for the source field's options; an option without one is free
 *   unitPrice  quantity: the price of one
 *   minimum    custom: the least the respondent may pay
 * Prices are in the currency's main unit (45, 12.5). Gateways take the smallest unit (4500, 1250);
 * zero-decimal currencies such as JPY and VND go as whole amounts.
 */
public inherited sharing class JFormPaymentPricing {

    public static final String FIELD_TYPE = 'payment';
    public static final Set<String> PRICING = new Set<String>{ 'fixed', 'choice', 'quantity', 'custom' };
    public static final Set<String> CHOICE_SOURCES = new Set<String>{ 'radio', 'picklist', 'checkboxes', 'multiselect' };
    private static final Set<String> MULTI_SOURCES = new Set<String>{ 'checkboxes', 'multiselect' };
    /** Currencies charged in whole units. */
    public static final Set<String> ZERO_DECIMAL = new Set<String>{
        'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
    };
    /**
     * The currencies forms can take, mirrored in CURRENCIES of c/jformPayment (the Settings tab's list). Three-decimal
     * currencies (BHD, JOD, KWD, OMR, TND) are left out because Stripe rounds their amounts to tens.
     */
    public static final List<String> SUPPORTED = new List<String>{
        'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'JPY', 'VND', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN',
        'CZK', 'MXN', 'BRL', 'INR', 'ZAR', 'AED', 'THB', 'MYR', 'PHP', 'IDR', 'KRW'
    };
    private static final Set<String> SUPPORTED_SET = new Set<String>(SUPPORTED);
    /** The largest amount gateways take, in the smallest unit (Stripe: eight digits). */
    public static final Long MAX_AMOUNT = 99999999L;
    public static final Integer MAX_QUANTITY = 1000;
    public static final Integer MAX_ITEM_LENGTH = 120;

    public class PricingException extends Exception {}

    public class Line {
        public String name;
        public Long unitAmount;
        public Integer quantity = 1;
    }

    public class Quote {
        public String currencyCode;
        /** The total in the smallest unit, after the discount. */
        public Long amount = 0;
        /** The lines' total before the discount. */
        public Long subtotal = 0;
        /** What the promotion code took off; 0 without one. */
        public Long discount = 0;
        /** The promotion code applied, as stored, and its record. */
        public String code;
        public Id codeId;
        public List<Line> lines = new List<Line>();
        /** The Payment block's key; its stored answer is the total in the main unit. */
        public String fieldKey;

        public Decimal major() {
            return toMajor(amount, currencyCode);
        }
    }

    /** The form's Payment block, or null. A form has at most one (JFormPaymentService.definitionProblems). */
    public static JFormDefinition.Field paymentField(JFormDefinition.Form def) {
        if (def == null || def.sections == null) {
            return null;
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (f.fieldType == FIELD_TYPE) {
                    return f;
                }
            }
        }
        return null;
    }

    /**
     * What the respondent owes, or null when the form has no Payment block or logic hides it. Throws a
     * message for the respondent when an answer the price depends on cannot be used.
     */
    public static Quote quote(JFormDefinition.Form def, Map<String, Object> answers, JFormLogicEvaluator.Result logic, String currencyCode) {
        JFormDefinition.Field block = paymentField(def);
        if (block == null || (logic != null && logic.visible.get(block.key) == false)) {
            return null;
        }
        Map<String, Object> config = block.config == null ? new Map<String, Object>() : block.config;
        String pricing = pricingOf(block);
        String item = itemName(def, block);
        Quote q = new Quote();
        q.currencyCode = normaliseCurrency(currencyCode);
        q.fieldKey = block.key;

        if (pricing == 'fixed') {
            addLine(q, item, toMinor(decimalOf(config.get('amount')), q.currencyCode), 1);
        } else if (pricing == 'choice') {
            JFormDefinition.Field source = def.fieldsByKey().get(stringOf(config.get('source')));
            if (source != null && (logic == null || logic.visible.get(source.key) != false)) {
                Map<String, Decimal> prices = pricesOf(config);
                for (String chosen : chosenValues(answers.get(source.key), MULTI_SOURCES.contains(source.fieldType))) {
                    Decimal price = prices.get(chosen);
                    if (price != null && price > 0) {
                        addLine(q, item + ': ' + optionLabel(source, chosen), toMinor(price, q.currencyCode), 1);
                    }
                }
            }
        } else if (pricing == 'quantity') {
            JFormDefinition.Field source = def.fieldsByKey().get(stringOf(config.get('source')));
            if (source != null && (logic == null || logic.visible.get(source.key) != false)) {
                Integer quantity = quantityOf(answers.get(source.key), source);
                if (quantity > 0) {
                    addLine(q, item, toMinor(decimalOf(config.get('unitPrice')), q.currencyCode), quantity);
                }
            }
        } else {
            Object given = answers.get(block.key);
            if (JFormSubmissionService.isEmpty(given)) {
                throw new PricingException('Enter the amount you want to pay.');
            }
            Decimal amount = parseAmount(given);
            if (amount == null || amount <= 0) {
                throw new PricingException('Enter the amount you want to pay as a number, such as 25 or 12.50.');
            }
            Decimal minimum = decimalOf(config.get('minimum'));
            if (minimum != null && amount < minimum) {
                throw new PricingException('The amount must be at least ' + formatMajor(minimum, q.currencyCode) + '.');
            }
            Long minor = toMinor(amount, q.currencyCode);
            if (minor == null) {
                throw new PricingException(ZERO_DECIMAL.contains(q.currencyCode)
                    ? 'Enter the amount as a whole number.'
                    : 'Enter the amount with at most two decimals.');
            }
            addLine(q, item, minor, 1);
        }
        if (q.amount > MAX_AMOUNT) {
            throw new PricingException('The total is more than this form can take in one payment.');
        }
        q.subtotal = q.amount;
        return q;
    }

    /**
     * Takes a promotion code off the quote: the percentage of the total rounded half up to the smallest
     * unit, or the fixed amount, and never more than the total. A total left between zero and the currency's
     * minimumCharge is raised to it. c/jformPayment applies the same rule with the minimum checkPromotionCode sends.
     */
    public static Quote applyCode(Quote q, JFormPromotionCodeService.Verdict v) {
        if (q == null || v == null || !v.valid) {
            return q;
        }
        Long off = v.discountType == JFormPromotionCodeService.PERCENT
            ? (Decimal.valueOf(q.subtotal) * v.percentOff / 100).setScale(0, System.RoundingMode.HALF_UP).longValue()
            : v.amountOff;
        q.discount = Math.max(0, Math.min(off == null ? 0 : off, q.subtotal));
        // a total the gateway cannot charge is raised to its minimum; a code that makes it free stays free
        Long least = minimumCharge(q.currencyCode);
        if (q.subtotal - q.discount > 0 && q.subtotal - q.discount < least) {
            q.discount = Math.max(0, q.subtotal - least);
        }
        q.amount = q.subtotal - q.discount;
        q.code = v.code;
        q.codeId = v.codeId;
        return q;
    }

    /**
     * Problems with a Payment block that stop a form from being published: what each pricing option
     * needs, with prices the form's currency can take. Saving a draft checks only the pricing option
     * (JFormPaymentService.definitionProblems).
     */
    public static List<String> publishProblems(JFormDefinition.Form def, String currencyCode) {
        List<String> problems = new List<String>();
        JFormDefinition.Field block = paymentField(def);
        if (block == null) {
            return problems;
        }
        String c;
        try {
            c = normaliseCurrency(currencyCode);
        } catch (PricingException e) {
            problems.add(e.getMessage());
            return problems;
        }
        Map<String, Object> config = block.config == null ? new Map<String, Object>() : block.config;
        String pricing = pricingOf(block);
        JFormDefinition.Field source = def.fieldsByKey().get(stringOf(config.get('source')));
        // a price with more decimals than the currency would be left out of the total, so the response would be free
        Boolean precise = true;
        if (pricing == 'fixed') {
            if (!isPositive(config.get('amount'))) {
                problems.add('The Payment block needs a price.');
            }
            precise = fits(config.get('amount'), c);
        } else if (pricing == 'choice') {
            if (source == null || !CHOICE_SOURCES.contains(source.fieldType)) {
                problems.add('The Payment block needs the choice field its prices come from.');
            } else if (pricesOf(config).isEmpty()) {
                problems.add('The Payment block needs a price for at least one option of "' + source.label + '".');
            }
            for (Decimal price : pricesOf(config).values()) {
                precise = precise && toMinor(price, c) != null;
            }
        } else if (pricing == 'quantity') {
            if (source == null || source.fieldType != 'number') {
                problems.add('The Payment block needs the number field that holds the quantity.');
            }
            if (!isPositive(config.get('unitPrice'))) {
                problems.add('The Payment block needs a price for each one.');
            }
            precise = fits(config.get('unitPrice'), c);
        } else if (pricing == 'custom' && config.get('minimum') != null) {
            if (decimalOf(config.get('minimum')) == null) {
                problems.add('The minimum amount of the Payment block must be a number.');
            }
            precise = fits(config.get('minimum'), c);
        }
        if (!precise) {
            problems.add(decimalsOf(c) == 0
                ? 'Prices in the Payment block must be whole amounts in ' + c + '.'
                : 'Prices in the Payment block can have at most two decimals.');
        }
        return problems;
    }

    // ------------------------------------------------------------ amounts

    /** "USD" for blanks; supported codes upper-cased. Throws for codes forms cannot take (SUPPORTED). */
    public static String normaliseCurrency(String code) {
        String c = String.isBlank(code) ? 'USD' : code.trim().toUpperCase();
        if (!SUPPORTED_SET.contains(c)) {
            throw new PricingException('This form\'s currency (' + c + ') cannot take payments. Use one of: ' + String.join(SUPPORTED, ', ') + '.');
        }
        return c;
    }

    /**
     * The least a checkout can charge, in the smallest unit: the currency's Payment Currency record
     * (Payment_Currency__mdt, one per code, updated by package upgrades). 0 for a currency without one.
     */
    public static Long minimumCharge(String currencyCode) {
        Payment_Currency__mdt c = String.isBlank(currencyCode) ? null : Payment_Currency__mdt.getInstance(currencyCode);
        Long least = c == null ? null : toMinor(c.Minimum_Charge__c, currencyCode);
        return least == null ? 0L : least;
    }

    public static Integer decimalsOf(String currencyCode) {
        return ZERO_DECIMAL.contains(currencyCode) ? 0 : 2;
    }

    /** 12.5 USD -> 1250; null when the amount has more decimals than the currency. */
    public static Long toMinor(Decimal major, String currencyCode) {
        if (major == null) {
            return null;
        }
        // Decimal arithmetic throughout: 0.29 * 100 in Double is 28.999...
        Decimal scaled = major * Decimal.valueOf(10).pow(decimalsOf(currencyCode));
        if (scaled != scaled.round(System.RoundingMode.DOWN)) {
            return null;
        }
        return scaled.longValue();
    }

    /** 1250 USD -> 12.50 */
    public static Decimal toMajor(Long minor, String currencyCode) {
        if (minor == null) {
            return null;
        }
        Integer digits = decimalsOf(currencyCode);
        return Decimal.valueOf(minor).divide(Decimal.valueOf(10).pow(digits), digits);
    }

    /** "12.50 USD", for messages; the renderer formats amounts for the respondent's locale. */
    public static String formatMajor(Decimal major, String currencyCode) {
        return major.setScale(decimalsOf(currencyCode)).toPlainString() + ' ' + currencyCode;
    }

    // ------------------------------------------------------------ helpers

    public static String pricingOf(JFormDefinition.Field block) {
        String p = block.config == null ? null : stringOf(block.config.get('pricing'));
        return PRICING.contains(p) ? p : 'fixed';
    }

    private static void addLine(Quote q, String name, Long unitAmount, Integer quantity) {
        if (unitAmount == null || unitAmount <= 0) {
            return;
        }
        Line l = new Line();
        l.name = name.left(MAX_ITEM_LENGTH);
        l.unitAmount = unitAmount;
        l.quantity = quantity;
        q.lines.add(l);
        q.amount += unitAmount * quantity;
    }

    private static String itemName(JFormDefinition.Form def, JFormDefinition.Field block) {
        String item = block.config == null ? null : stringOf(block.config.get('item'));
        if (String.isNotBlank(item)) {
            return item.normalizeSpace();
        }
        String form = String.isNotBlank(def.label) ? def.label : def.name;
        return String.isBlank(form) ? 'Payment' : form.normalizeSpace();
    }

    /** prices [{ value, amount }] as value -> amount; entries without a usable amount are left out. */
    private static Map<String, Decimal> pricesOf(Map<String, Object> config) {
        Map<String, Decimal> prices = new Map<String, Decimal>();
        if (config.get('prices') instanceof List<Object>) {
            for (Object o : (List<Object>) config.get('prices')) {
                if (o instanceof Map<String, Object>) {
                    Map<String, Object> m = (Map<String, Object>) o;
                    Decimal amount = decimalOf(m.get('amount'));
                    String value = stringOf(m.get('value'));
                    if (value != null && amount != null && amount > 0) {
                        prices.put(value, amount);
                    }
                }
            }
        }
        return prices;
    }

    /**
     * A single choice's value, or each of a multiple choice ("a; b" as stored, or a list from the renderer):
     * each once, and one for a single-choice source, whatever a tampered answer holds.
     */
    private static List<String> chosenValues(Object answer, Boolean multiple) {
        List<String> parts = new List<String>();
        if (answer instanceof List<Object>) {
            for (Object o : (List<Object>) answer) {
                parts.add(o == null ? null : String.valueOf(o));
            }
        } else if (answer != null) {
            for (String part : multiple ? String.valueOf(answer).split(';') : new List<String>{ String.valueOf(answer) }) {
                parts.add(part.trim());
            }
        }
        List<String> values = new List<String>();
        for (String part : parts) {
            if (String.isNotBlank(part) && !values.contains(part)) {
                values.add(part);
            }
            if (!multiple && !values.isEmpty()) {
                break;
            }
        }
        return values;
    }

    private static String optionLabel(JFormDefinition.Field source, String value) {
        for (JFormDefinition.Option o : source.options == null ? new List<JFormDefinition.Option>() : source.options) {
            if (o.value == value) {
                return String.isBlank(o.label) ? value : o.label;
            }
        }
        return value;
    }

    private static Integer quantityOf(Object answer, JFormDefinition.Field source) {
        if (JFormSubmissionService.isEmpty(answer)) {
            return 0;
        }
        Decimal n = parseAmount(answer);
        String name = String.isBlank(source.label) ? source.key : source.label;
        if (n == null || n < 0 || n != n.round(System.RoundingMode.DOWN)) {
            throw new PricingException('Enter a whole number for ' + name + '.');
        }
        if (n > MAX_QUANTITY) {
            throw new PricingException(name + ' can be at most ' + MAX_QUANTITY + '.');
        }
        return n.intValue();
    }

    /** "12.50", 12.5 or "1,250.00"; null when it is not a plain amount. */
    private static Decimal parseAmount(Object value) {
        String text = String.valueOf(value).trim().replace(',', '');
        if (!Pattern.matches('\\d{1,12}(\\.\\d{1,4})?', text)) {
            return null;
        }
        return Decimal.valueOf(text);
    }

    private static Decimal decimalOf(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Decimal) {
            return (Decimal) value;
        }
        if (value instanceof Integer) {
            return Decimal.valueOf((Integer) value);
        }
        if (value instanceof Long) {
            return Decimal.valueOf((Long) value);
        }
        if (value instanceof Double) {
            return Decimal.valueOf((Double) value);
        }
        return parseAmount(value);
    }

    /** A missing or unreadable amount fits: the checks above report those. */
    private static Boolean fits(Object value, String currencyCode) {
        Decimal d = decimalOf(value);
        return d == null || toMinor(d, currencyCode) != null;
    }

    private static Boolean isPositive(Object value) {
        Decimal d = decimalOf(value);
        return d != null && d > 0;
    }

    private static String stringOf(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
