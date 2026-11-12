/**
 * Shared helpers for the Agentforce actions and the REST API:
 *  - normalising field JSON written by people or AI models (type aliases,
 *    options given as plain strings, missing keys)
 *  - resolving fields and pages by key or label
 *  - plain-text outlines and summaries an agent can repeat verbatim
 *  - builder, public and embed links
 */
public with sharing class JFormAgentSupport {

    /** Each request loads and saves a whole form; Flow bulk runs must split larger batches. */
    public static final Integer MAX_REQUESTS = 10;
    public static final String TOO_MANY_REQUESTS = 'JForm actions handle up to 10 requests per call; send the rest in another call.';
    public static final String OUT_OF_LIMITS = 'This call ran out of Salesforce limits before this request; send it in another call.';
    /** Measured with JFormAgentActionsLimitsTest: Publish Form uses 9 queries per request and editing actions 7 DML statements; kept with margin. */
    @TestVisible private static final Integer QUERIES_PER_REQUEST = 12;
    @TestVisible private static final Integer DML_PER_REQUEST = 10;

    /**
     * Why the next request cannot run in this call, or null when it can: past the request cap, or too few
     * queries or DML statements left in the transaction (a Flow may already have used some) to finish it.
     */
    public static String capacityProblem(Integer handled) {
        if (handled >= MAX_REQUESTS) {
            return TOO_MANY_REQUESTS;
        }
        if (Limits.getLimitQueries() - Limits.getQueries() < QUERIES_PER_REQUEST
            || Limits.getLimitDmlStatements() - Limits.getDmlStatements() < DML_PER_REQUEST) {
            return OUT_OF_LIMITS;
        }
        return null;
    }

    public static final Map<String, String> TYPE_ALIASES = new Map<String, String>{
        'short text' => 'text', 'single line' => 'text', 'string' => 'text',
        'full name' => 'name', 'person name' => 'name', 'first and last name' => 'name',
        'postal address' => 'address', 'mailing address' => 'address', 'street address' => 'address', 'home address' => 'address',
        'billing address' => 'address', 'shipping address' => 'address', 'delivery address' => 'address',
        'long text' => 'comment', 'textarea' => 'comment', 'paragraph' => 'comment', 'multiline' => 'comment',
        'phone number' => 'phone', 'tel' => 'phone', 'mobile' => 'phone',
        'dropdown' => 'picklist', 'select' => 'picklist', 'combobox' => 'picklist',
        'single choice' => 'radio', 'radio button' => 'radio', 'radio buttons' => 'radio', 'choice' => 'radio',
        'multi select' => 'checkboxes', 'multi-select' => 'checkboxes', 'multiple choice' => 'checkboxes',
        'checkbox list' => 'checkboxes', 'checkbox group' => 'checkboxes',
        'yes/no' => 'yesno', 'yes no' => 'yesno', 'boolean' => 'yesno',
        'star rating' => 'rating', 'stars' => 'rating', 'net promoter score' => 'nps',
        'file' => 'fileupload', 'upload' => 'fileupload', 'file upload' => 'fileupload', 'attachment' => 'fileupload',
        'sign' => 'signature', 'e-signature' => 'signature', 'esignature' => 'signature', 'signature pad' => 'signature',
        'digital signature' => 'signature', 'electronic signature' => 'signature',
        'payment gateway' => 'payment', 'payment module' => 'payment', 'checkout' => 'payment', 'pay' => 'payment',
        'credit card' => 'payment', 'card payment' => 'payment', 'stripe' => 'payment',
        'date picker' => 'date', 'time picker' => 'time',
        'matrix' => 'table', 'grid' => 'table', 'likert' => 'table', 'likert scale' => 'table', 'input table' => 'table',
        'rating grid' => 'table', 'matrix table' => 'table', 'survey grid' => 'table',
        'agreement' => 'consent', 'terms' => 'consent', 'checkbox' => 'consent',
        'rich text' => 'richtext', 'text block' => 'richtext', 'paragraph text' => 'richtext',
        'title' => 'heading', 'section title' => 'heading', 'separator' => 'divider', 'line' => 'divider',
        'datetime' => 'date', 'integer' => 'number', 'decimal' => 'number', 'currency' => 'number'
    };

    /** Types JForm does not have that a text or number box would only fake: refused, with what to use instead. */
    private static final Set<String> CALCULATED_TYPES = new Set<String>{ 'calculated', 'calculation', 'formula', 'computed', 'auto sum', 'autosum', 'total' };
    @TestVisible
    private static final String NO_CALCULATED = 'JForm has no calculated fields. To charge an amount worked out from the answers, add one field of type payment priced from a choice field, for example {"type":"payment","pricing":"choice","source":"Sessions","prices":{"Morning":50,"Afternoon":50}}, or from a number field with "pricing":"quantity" and "unitPrice". Leave out any other calculation and tell the user JForm cannot do it.';

    // ------------------------------------------------------------ parsing

    /** Parse a JSON array (or an object with a "fields" array) into fields with unique, readable keys. */
    public static List<JFormDefinition.Field> parseFields(String fieldsJson, Set<String> usedKeys) {
        if (String.isBlank(fieldsJson)) {
            throw new JFormDefinition.JFormException('No fields were provided.');
        }
        Object raw;
        try {
            raw = JSON.deserializeUntyped(fieldsJson);
        } catch (JSONException e) {
            // usually a quote inside a label or choice, or a list cut short; say how to recover, not only where it broke
            throw new JFormDefinition.JFormException('The fields JSON could not be read (' + e.getMessage() + '). Check quotes inside labels and choices.'
                + ' For a long list of choices, such as countries, add the field with a few choices, then add the rest with Update Field (Add Options), one choice per line.');
        }
        if (raw instanceof Map<String, Object> && ((Map<String, Object>) raw).get('fields') instanceof List<Object>) {
            raw = ((Map<String, Object>) raw).get('fields');
        }
        if (!(raw instanceof List<Object>)) {
            throw new JFormDefinition.JFormException('Fields must be a JSON array, for example [{"label":"Email","type":"email","required":true}].');
        }
        List<JFormDefinition.Field> out = new List<JFormDefinition.Field>();
        Integer i = 0;
        for (Object o : (List<Object>) raw) {
            i++;
            if (o instanceof String) {
                o = new Map<String, Object>{ 'label' => o, 'type' => 'text' };
            }
            if (!(o instanceof Map<String, Object>)) {
                continue;
            }
            Map<String, Object> m = normaliseFieldMap((Map<String, Object>) o);
            JFormDefinition.Field f = JFormDefinition.fieldFromMap(m, 1, i);
            String preferred = m.get('key') == null ? null : String.valueOf(m.get('key'));
            f.key = keyFromLabel(String.isNotBlank(preferred) ? preferred : (String.isBlank(f.label) ? f.fieldType : f.label), usedKeys);
            f.id = null;
            out.add(f);
        }
        if (out.isEmpty()) {
            throw new JFormDefinition.JFormException('No usable fields were found in the JSON.');
        }
        return out;
    }

    /** Parse a full definition (object with sections), a list of sections, or a list of fields (one page). */
    public static JFormDefinition.Form parseDefinition(String definitionJson, String name) {
        JFormDefinition.Form def = new JFormDefinition.Form();
        def.name = name;
        def.label = name;
        if (String.isBlank(definitionJson)) {
            JFormDefinition.Section page = new JFormDefinition.Section();
            page.key = 'page_1';
            page.name = 'Page 1';
            page.label = 'Page 1';
            def.sections.add(page);
            return def;
        }
        Object raw = JSON.deserializeUntyped(definitionJson);
        List<Object> sectionsRaw;
        if (raw instanceof Map<String, Object>) {
            Map<String, Object> m = (Map<String, Object>) raw;
            if (m.get('sections') instanceof List<Object>) {
                JFormDefinition.Form parsed = JFormDefinition.formFromMap(m);
                def.label = String.isBlank(parsed.label) ? def.label : parsed.label;
                def.description = parsed.description;
                def.targetObjectApiName = parsed.targetObjectApiName;
                def.displayStyle = parsed.displayStyle;
                def.welcomeMessage = parsed.welcomeMessage;
                def.thankYouMessage = parsed.thankYouMessage;
                def.theme = parsed.theme;
                def.settings = parsed.settings;
                sectionsRaw = (List<Object>) m.get('sections');
            } else if (m.get('fields') instanceof List<Object>) {
                sectionsRaw = new List<Object>{ m };
            } else {
                throw new JFormDefinition.JFormException('The definition must contain "sections" or "fields".');
            }
        } else if (raw instanceof List<Object>) {
            List<Object> l = (List<Object>) raw;
            Boolean looksLikeSections = !l.isEmpty() && l[0] instanceof Map<String, Object> && ((Map<String, Object>) l[0]).get('fields') instanceof List<Object>;
            sectionsRaw = looksLikeSections ? l : new List<Object>{ new Map<String, Object>{ 'name' => 'Page 1', 'fields' => l } };
        } else {
            throw new JFormDefinition.JFormException('The definition must be a JSON object or array.');
        }
        Set<String> used = new Set<String>();
        Integer si = 0;
        for (Object so : sectionsRaw) {
            si++;
            if (!(so instanceof Map<String, Object>)) {
                continue;
            }
            Map<String, Object> sm = (Map<String, Object>) so;
            JFormDefinition.Section s = new JFormDefinition.Section();
            String pageName = firstNonBlank(new List<Object>{ sm.get('name'), sm.get('label'), sm.get('title') }, 'Page ' + si);
            s.name = pageName.left(80);
            s.label = firstNonBlank(new List<Object>{ sm.get('label'), sm.get('title'), sm.get('name') }, pageName);
            s.description = sm.get('description') == null ? null : String.valueOf(sm.get('description'));
            s.key = keyFromLabel(sm.get('key') != null ? String.valueOf(sm.get('key')) : 'page_' + si, used);
            if (sm.get('fields') instanceof List<Object> && !((List<Object>) sm.get('fields')).isEmpty()) {
                s.fields = parseFields(JSON.serialize(sm.get('fields')), used);
            }
            if (sm.get('conditionalLogic') != null) {
                s.conditionalLogic = JFormDefinition.parseRule(JSON.serialize(sm.get('conditionalLogic')));
            }
            def.sections.add(s);
        }
        if (def.sections.isEmpty()) {
            throw new JFormDefinition.JFormException('The definition has no pages.');
        }
        // Field-level rules and a Payment block's source may reference labels; resolve them to keys now that all fields exist.
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                resolveRuleReferences(def, f.conditionalLogic);
            }
            resolveRuleReferences(def, s.conditionalLogic);
            resolvePaymentReferences(def, s.fields);
        }
        return def;
    }

    private static final Pattern HTML_TAG = Pattern.compile('</?[a-zA-Z][^>]*>');
    private static final Integer BLOCK_LABEL_LENGTH = 80;

    private static Map<String, Object> normaliseFieldMap(Map<String, Object> source) {
        Map<String, Object> m = new Map<String, Object>(source);
        String t = m.get('type') == null ? (m.get('fieldType') == null ? 'text' : String.valueOf(m.get('fieldType'))) : String.valueOf(m.get('type'));
        if (CALCULATED_TYPES.contains(typeWords(t))) {
            throw new JFormDefinition.JFormException(NO_CALCULATED);
        }
        m.put('type', normaliseType(t));
        // "billing address" and "shipping address" are Address fields with that purpose
        String purpose = t.trim().toLowerCase().substringBefore(' address');
        if (m.get('type') == JFormAddressService.FIELD_TYPE && (purpose == 'billing' || purpose == 'shipping' || purpose == 'delivery') && m.get('purpose') == null) {
            m.put('purpose', purpose == 'billing' ? 'billing' : 'shipping');
        }
        if (m.get('label') == null && m.get('name') != null) {
            m.put('label', m.get('name'));
        }
        if (m.get('required') == null && m.get('isRequired') != null) {
            m.put('required', m.get('isRequired'));
        }
        if (m.get('options') == null && m.get('choices') instanceof List<Object>) {
            m.put('options', m.get('choices'));
        }
        if (m.get('options') instanceof List<Object>) {
            List<Object> opts = new List<Object>();
            for (Object o : (List<Object>) m.get('options')) {
                if (o instanceof Map<String, Object>) {
                    opts.add(o);
                } else if (o != null) {
                    opts.add(new Map<String, Object>{ 'label' => String.valueOf(o), 'value' => String.valueOf(o) });
                }
            }
            m.put('options', opts);
        }
        if (m.get('type') == JFormTableService.FIELD_TYPE) {
            normaliseTable(m);
        }
        if (m.get('type') == JFormPaymentPricing.FIELD_TYPE) {
            normalisePayment(m);
        }
        if (m.get('type') == JFormNameService.FIELD_TYPE) {
            normaliseName(m);
        }
        if (m.get('type') == JFormAddressService.FIELD_TYPE) {
            normaliseAddress(m);
        }
        if (m.get('type') == 'phone') {
            normalisePhone(m);
        }
        // a date box shows only a real date: "today" would sit in the answer as text, so it is dropped
        if (m.get('type') == 'date' && m.get('defaultValue') != null && !Pattern.matches('\\d{4}-\\d{2}-\\d{2}', String.valueOf(m.get('defaultValue')))) {
            m.remove('defaultValue');
        }
        if (m.get('type') == 'richtext') {
            // a text block shows only its richtext, so wording sent as text, content, help text or a default value goes there, else the label
            String text = firstNonBlank(new List<Object>{ m.get('richtext'), m.get('text'), m.get('content'), m.get('helpText'), m.get('defaultValue'), m.get('label') }, null);
            for (String prop : new List<String>{ 'helpText', 'defaultValue' }) {
                if (text != null && text == String.valueOf(m.get(prop))) {
                    m.remove(prop);
                }
            }
            m.put('richtext', text == null ? '<p></p>' : (HTML_TAG.matcher(text).find() ? text : paragraphs(text)));
            // the page never shows a text block's label, and wording sent as the label can run past what a label holds
            String label = firstNonBlank(new List<Object>{ m.get('label') }, '').trim();
            if (label.length() > BLOCK_LABEL_LENGTH) {
                m.put('label', label.substringBefore('\n').abbreviate(BLOCK_LABEL_LENGTH));
            }
        }
        // nothing is answered in a heading, text block, divider, image or event, so none is required, as in the builder
        if (JFormDefinition.LAYOUT_TYPES.contains(String.valueOf(m.get('type')))) {
            m.put('required', false);
        }
        if (m.get('width') != null) {
            String w = String.valueOf(m.get('width')).replace('%', '').trim();
            m.put('width', w.isNumeric() ? Integer.valueOf(w) : 100);
        }
        return m;
    }

    /** Plain text as HTML paragraphs: a blank line starts a paragraph, a line break stays one. */
    private static String paragraphs(String text) {
        List<String> out = new List<String>();
        for (String p : text.trim().split('\\r?\\n\\s*\\r?\\n')) {
            out.add('<p>' + p.trim().escapeHtml4().replaceAll('\\r?\\n', '<br>') + '</p>');
        }
        return String.join(out, '');
    }

    /**
     * A table takes "rows" (plain strings or { key, label }), and "multiple" and "everyRow", at the top level or in
     * config; "columns" may stand for its options. Rows get their keys from their labels when the form is saved.
     */
    private static void normaliseTable(Map<String, Object> m) {
        if (m.get('options') == null && m.get('columns') instanceof List<Object>) {
            List<Object> opts = new List<Object>();
            for (Object o : (List<Object>) m.get('columns')) {
                opts.add(o instanceof Map<String, Object> ? o : new Map<String, Object>{ 'label' => String.valueOf(o), 'value' => String.valueOf(o) });
            }
            m.put('options', opts);
        }
        Map<String, Object> config = m.get('config') instanceof Map<String, Object> ? (Map<String, Object>) m.get('config') : new Map<String, Object>();
        for (String prop : new List<String>{ 'rows', 'multiple', 'everyRow' }) {
            if (m.containsKey(prop) && !config.containsKey(prop)) {
                config.put(prop, m.remove(prop));
            }
        }
        if (config.get('rows') instanceof List<Object>) {
            List<Object> rows = new List<Object>();
            for (Object r : (List<Object>) config.get('rows')) {
                rows.add(r instanceof Map<String, Object> ? r : new Map<String, Object>{ 'label' => String.valueOf(r) });
            }
            config.put('rows', rows);
        }
        m.put('config', config);
    }

    /**
     * A Name field takes "layout" (inline or stacked) at the top level or in config. It is never mapped whole:
     * a targetFieldApiName sent for it (agents often send LastName) is dropped, and the record step maps its
     * parts to FirstName and LastName instead (JFormAutomationService.stepsFromLegacy).
     */
    private static void normaliseName(Map<String, Object> m) {
        m.remove('targetFieldApiName');
        Map<String, Object> config = m.get('config') instanceof Map<String, Object> ? (Map<String, Object>) m.get('config') : new Map<String, Object>();
        if (m.containsKey('layout') && !config.containsKey('layout')) {
            config.put('layout', m.remove('layout'));
        }
        if (!config.isEmpty()) {
            m.put('config', config);
        }
    }

    /**
     * An Address field takes purpose, defaultCountry and countries at the top level or in config. Like a Name field
     * it is never mapped whole: a targetFieldApiName sent for it (MailingStreet) is dropped, and the record step maps
     * its parts to one of the object's addresses instead (JFormAutomationService.stepsFromLegacy).
     */
    private static void normaliseAddress(Map<String, Object> m) {
        m.remove('targetFieldApiName');
        Map<String, Object> config = m.get('config') instanceof Map<String, Object> ? (Map<String, Object>) m.get('config') : new Map<String, Object>();
        for (String prop : new List<String>{ 'purpose', 'defaultCountry', 'countries' }) {
            if (m.containsKey(prop) && !config.containsKey(prop)) {
                config.put(prop, m.remove(prop));
            }
        }
        if (config.get('countries') instanceof String) {
            config.put('countries', String.valueOf(config.get('countries')).split('\\s*,\\s*'));
        }
        if (!config.isEmpty()) {
            m.put('config', config);
        }
    }

    /**
     * A Payment block takes its pricing (pricing, item, amount, source, prices, unitPrice, minimum) at the top level or in
     * config; without "pricing" it is worked out from what is given. Prices may come as { "choice": amount } or as
     * [{ value or label, amount or price }], and amounts as "$75". The source and the choices its prices name are matched
     * by label once every field exists (resolvePaymentReferences). How people pay is the gateway's checkout, so options
     * are dropped, and a Payment block is never optional or required.
     */
    private static void normalisePayment(Map<String, Object> m) {
        Map<String, Object> config = m.get('config') instanceof Map<String, Object> ? (Map<String, Object>) m.get('config') : new Map<String, Object>();
        for (String prop : new List<String>{ 'pricing', 'item', 'amount', 'source', 'prices', 'unitPrice', 'minimum' }) {
            if (m.containsKey(prop) && !config.containsKey(prop)) {
                config.put(prop, m.remove(prop));
            }
        }
        if (!config.containsKey('pricing')) {
            Boolean fromField = config.get('source') != null;
            config.put('pricing', fromField && config.get('unitPrice') != null ? 'quantity'
                : (fromField || config.get('prices') != null ? 'choice'
                : (config.get('minimum') != null && config.get('amount') == null ? 'custom' : 'fixed')));
        }
        for (String prop : new List<String>{ 'amount', 'unitPrice', 'minimum' }) {
            if (config.containsKey(prop)) {
                config.put(prop, amountOf(config.get(prop)));
            }
        }
        if (config.get('prices') != null) {
            config.put('prices', priceList(config.get('prices')));
        }
        m.remove('options');
        m.remove('choices');
        m.put('required', false);
        m.put('config', config);
    }

    /** prices as [{ value, amount }], from { "choice": amount } or a list of { value, label, option or choice, amount or price }. */
    private static List<Object> priceList(Object raw) {
        List<Object> out = new List<Object>();
        if (raw instanceof Map<String, Object>) {
            Map<String, Object> byChoice = (Map<String, Object>) raw;
            for (String choice : byChoice.keySet()) {
                out.add(new Map<String, Object>{ 'value' => choice, 'amount' => amountOf(byChoice.get(choice)) });
            }
        } else if (raw instanceof List<Object>) {
            for (Object o : (List<Object>) raw) {
                if (!(o instanceof Map<String, Object>)) {
                    continue;
                }
                Map<String, Object> p = (Map<String, Object>) o;
                String choice = firstNonBlank(new List<Object>{ p.get('value'), p.get('label'), p.get('option'), p.get('choice') }, null);
                if (choice != null) {
                    out.add(new Map<String, Object>{ 'value' => choice, 'amount' => amountOf(p.containsKey('amount') ? p.get('amount') : p.get('price')) });
                }
            }
        }
        return out;
    }

    /** 75, "75", "$75.00" or "USD 1,250" as a number; anything else as given, for the publish check to name. */
    private static Object amountOf(Object v) {
        if (!(v instanceof String)) {
            return v;
        }
        String s = ((String) v).replaceAll('[^0-9.,]', '');
        if (Pattern.matches('\\d{1,3}(,\\d{3})+(\\.\\d+)?', s)) {
            s = s.remove(',');
        }
        return Pattern.matches('\\d+(\\.\\d+)?', s) ? (Object) Decimal.valueOf(s) : v;
    }

    /**
     * A Payment block's source and the choices its prices name, given by label, as the source field's key and the
     * options' values. Runs once every field exists: on a new form, and on the form Add Fields adds to. A price for
     * no choice of the source is refused: it would never be charged, so that choice would be free.
     */
    public static void resolvePaymentReferences(JFormDefinition.Form def, List<JFormDefinition.Field> fields) {
        for (JFormDefinition.Field f : fields) {
            if (f.fieldType != JFormPaymentPricing.FIELD_TYPE || f.config == null || f.config.get('source') == null) {
                continue;
            }
            JFormDefinition.Field source = findField(def, String.valueOf(f.config.get('source')));
            if (source == null || source === f) {
                continue;
            }
            f.config.put('source', source.key);
            if (!(f.config.get('prices') instanceof List<Object>) || source.options == null) {
                continue;
            }
            List<String> unmatched = new List<String>();
            for (Object o : (List<Object>) f.config.get('prices')) {
                if (!(o instanceof Map<String, Object>)) {
                    continue;
                }
                Map<String, Object> price = (Map<String, Object>) o;
                JFormDefinition.Option option = findOption(source, String.valueOf(price.get('value')));
                if (option == null) {
                    unmatched.add('"' + price.get('value') + '"');
                } else {
                    price.put('value', option.value != null ? option.value : option.label);
                }
            }
            if (!unmatched.isEmpty()) {
                List<String> choices = new List<String>();
                for (JFormDefinition.Option o : source.options) {
                    choices.add('"' + o.label + '"');
                }
                throw new JFormDefinition.JFormException('The Payment block has a price for ' + String.join(unmatched, ', ')
                    + ', which is not a choice of "' + source.label + '". Name each price by one of its choices: ' + String.join(choices, ', ') + '.');
            }
        }
    }

    /**
     * The option with this value or label, ignoring case, dash style and spacing, else the only one whose label starts
     * with it ("Morning" for "Morning (9-12)").
     */
    private static JFormDefinition.Option findOption(JFormDefinition.Field f, String text) {
        String needle = matchText(text);
        List<JFormDefinition.Option> starting = new List<JFormDefinition.Option>();
        for (JFormDefinition.Option o : f.options) {
            String label = matchText(o.label);
            if ((o.value != null && matchText(o.value) == needle) || label == needle) {
                return o;
            }
            if (String.isNotBlank(needle) && label.startsWith(needle)) {
                starting.add(o);
            }
        }
        return starting.size() == 1 ? starting[0] : null;
    }

    /** Lower case, en and em dashes as hyphens, runs of spaces as one: "9:00 AM – 12:00 PM" matches "9:00 am - 12:00 pm". */
    private static String matchText(String text) {
        return text == null ? '' : text.replaceAll('[‐-―−]', '-').replaceAll('\\s+', ' ').trim().toLowerCase();
    }

    /**
     * A Phone field gets the country code picker the builder gives a new one (c/jformFieldRegistry defaultsFor): the
     * visitor's country picked for them, else the user's. countryPicker, defaultCountry, detectCountry, mobileOnly and
     * strictNumber come at the top level or in config; "countryPicker": false keeps a plain number box.
     */
    private static void normalisePhone(Map<String, Object> m) {
        Map<String, Object> config = m.get('config') instanceof Map<String, Object> ? (Map<String, Object>) m.get('config') : new Map<String, Object>();
        for (String prop : new List<String>{ 'countryPicker', 'defaultCountry', 'detectCountry', 'mobileOnly', 'strictNumber' }) {
            if (m.containsKey(prop) && !config.containsKey(prop)) {
                config.put(prop, m.remove(prop));
            }
        }
        if (!config.containsKey('countryPicker')) {
            config.put('countryPicker', true);
            if (!config.containsKey('detectCountry')) {
                config.put('detectCountry', true);
            }
            if (!config.containsKey('defaultCountry')) {
                config.put('defaultCountry', localeCountry(UserInfo.getLocale()));
            }
        }
        m.put('config', config);
    }

    /** The country of a locale such as en_AU, else US, as c/jformPhone.localeCountry falls back. */
    @TestVisible
    private static String localeCountry(String locale) {
        List<String> parts = String.isBlank(locale) ? new List<String>() : locale.split('_');
        for (Integer i = 1; i < parts.size(); i++) {
            if (Pattern.matches('[A-Za-z]{2}', parts[i])) {
                return parts[i].toUpperCase();
            }
        }
        return 'US';
    }

    /** The type as words: lower case, without a trailing "field" or "input" ("Email Field" is email). */
    private static String typeWords(String raw) {
        return raw == null ? 'text' : raw.trim().toLowerCase().removeEnd(' field').removeEnd(' input').trim();
    }

    public static String normaliseType(String raw) {
        String t = typeWords(raw);
        // Multi-select is retired for new fields: it looked and mapped like checkboxes
        if (t.replaceAll('[^a-z]', '') == 'multiselect') {
            return 'checkboxes';
        }
        if (JFormDefinition.PICKLIST_BY_TYPE.containsKey(t)) {
            return t;
        }
        if (TYPE_ALIASES.containsKey(t)) {
            return TYPE_ALIASES.get(t);
        }
        String compact = t.replaceAll('[^a-z]', '');
        for (String known : JFormDefinition.PICKLIST_BY_TYPE.keySet()) {
            if (known == compact) {
                return known;
            }
        }
        return 'text';
    }

    /** Readable, unique key from a label: "First name" -> first_name. */
    public static String keyFromLabel(String label, Set<String> used) {
        String base = (label == null ? 'field' : label).toLowerCase().replaceAll('[^a-z0-9]+', '_').replaceAll('^_+|_+$', '');
        if (String.isBlank(base)) {
            base = 'field';
        }
        if (!Pattern.matches('[a-z].*', base)) {
            base = 'field_' + base;
        }
        base = base.left(50);
        String key = base;
        Integer n = 2;
        while (used.contains(key)) {
            key = base + '_' + n;
            n++;
        }
        used.add(key);
        return key;
    }

    // ------------------------------------------------------------ resolution

    /** Find a field by exact key, then exact label, then a label containing the text (case-insensitive). */
    public static JFormDefinition.Field findField(JFormDefinition.Form def, String ref) {
        if (String.isBlank(ref)) {
            return null;
        }
        String needle = ref.trim().toLowerCase();
        JFormDefinition.Field byLabel;
        JFormDefinition.Field byContains;
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (f.key != null && f.key.toLowerCase() == needle) {
                    return f;
                }
                String label = f.label == null ? '' : f.label.toLowerCase();
                if (byLabel == null && label == needle) {
                    byLabel = f;
                }
                if (byContains == null && String.isNotBlank(label) && label.contains(needle)) {
                    byContains = f;
                }
            }
        }
        return byLabel != null ? byLabel : byContains;
    }

    /**
     * The answer key of a table row or a name part named by that key ("satisfaction.price", "name.lastName") or as
     * "Table: Row" ("Name: Last name"); null when ref names neither.
     */
    public static String findTableRow(JFormDefinition.Form def, String ref) {
        if (String.isBlank(ref)) {
            return null;
        }
        String needle = ref.trim().toLowerCase();
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (JFormFieldParts.isCompound(f)) {
                    for (JFormFieldParts.Part p : JFormFieldParts.storedParts(f)) {
                        String key = JFormFieldParts.answerKey(f, p);
                        if (key.toLowerCase() == needle || JFormFieldParts.partLabel(f, p).toLowerCase() == needle) {
                            return key;
                        }
                    }
                }
                if (!JFormTableService.isTable(f)) {
                    continue;
                }
                for (JFormTableService.Row r : JFormTableService.rows(f)) {
                    String key = JFormTableService.answerKey(f, r);
                    if (key.toLowerCase() == needle || JFormTableService.rowLabel(f, r).toLowerCase() == needle) {
                        return key;
                    }
                }
            }
        }
        return null;
    }

    public static JFormDefinition.Section findPage(JFormDefinition.Form def, String ref) {
        if (String.isBlank(ref)) {
            return null;
        }
        String needle = ref.trim().toLowerCase();
        for (JFormDefinition.Section s : def.sections) {
            if ((s.id != null && (s.id.toLowerCase() == needle || s.id.left(15).toLowerCase() == needle))
                || (s.key != null && s.key.toLowerCase() == needle)
                || (s.label != null && s.label.toLowerCase() == needle)
                || (s.name != null && s.name.toLowerCase() == needle)) {
                return s;
            }
        }
        if (needle.isNumeric()) {
            Integer idx = Integer.valueOf(needle) - 1;
            if (idx >= 0 && idx < def.sections.size()) {
                return def.sections[idx];
            }
        }
        if (needle.startsWith('page ') && needle.substringAfter('page ').trim().isNumeric()) {
            Integer idx = Integer.valueOf(needle.substringAfter('page ').trim()) - 1;
            if (idx >= 0 && idx < def.sections.size()) {
                return def.sections[idx];
            }
        }
        return null;
    }

    private static void resolveRuleReferences(JFormDefinition.Form def, JFormDefinition.Rule rule) {
        if (rule == null) {
            return;
        }
        for (JFormDefinition.Condition c : rule.conditions) {
            JFormDefinition.Field f = findField(def, c.field);
            if (f != null) {
                c.field = f.key;
            }
        }
    }

    public static Set<String> allKeys(JFormDefinition.Form def) {
        Set<String> keys = new Set<String>();
        for (JFormDefinition.Section s : def.sections) {
            if (s.key != null) {
                keys.add(s.key);
            }
            for (JFormDefinition.Field f : s.fields) {
                if (f.key != null) {
                    keys.add(f.key);
                }
            }
        }
        return keys;
    }

    // ------------------------------------------------------------ text for agents

    private static final Pattern PROMO_CODE_LABEL = Pattern.compile('(?i).*\\b(promo|promotion|discount|coupon|voucher)\\b.*');

    /**
     * What an agent does next after Create Form, read where it decides: the agreed rules and design in the same turn,
     * and a code box that would take nothing off a paid form, since promotion codes belong to the Payment block.
     */
    public static String afterCreateText(JFormDefinition.Form def) {
        List<String> lines = new List<String>();
        if (JFormPaymentPricing.paymentField(def) != null) {
            for (JFormDefinition.Section s : def.sections) {
                for (JFormDefinition.Field f : s.fields) {
                    if (f.fieldType == 'text' && f.label != null && PROMO_CODE_LABEL.matcher(f.label).matches()) {
                        lines.add('Remove "' + f.label + '" with Update Field: a code typed there takes nothing off the price. Turning on Promotion codes in Settings › Payments gives the Payment block its own code box.');
                    }
                }
            }
        }
        // the actions that follow return no link, so the one to show comes with the next steps
        lines.add('Next, in this same turn: add each rule the plan agreed with Add Logic Rule, and call Apply Design with the agreed style, main colour and layout. Then show the outline and this builder link, copied exactly: ' + builderUrl(def.id));
        return '\n\n' + String.join(lines, '\n');
    }

    /** Plain-text outline: the welcome and thank-you screens, the Automate tab's steps, pages, fields (label, type, key, required, options, settings), rules. */
    public static String outline(JFormDefinition.Form def) {
        List<String> lines = new List<String>();
        lines.add('Form "' + def.name + '" (Id ' + def.id + ')' + (String.isBlank(def.targetObjectApiName) ? '' : ', creates ' + def.targetObjectApiName + ' records'));
        lines.add('Status: ' + statusText(def));
        lines.add('Design: ' + JFormDesignPresets.describe(def));
        lines.addAll(JFormScreens.describe(def));
        List<JFormAutomationService.Step> steps = JFormAutomationService.steps(def);
        if (!steps.isEmpty()) {
            lines.add('Steps, run in order for each response:');
            Integer n = 0;
            for (JFormAutomationService.Step st : steps) {
                n++;
                lines.add('  ' + n + '. ' + stepLine(def, st));
            }
        }
        Integer si = 0;
        for (JFormDefinition.Section s : def.sections) {
            si++;
            lines.add('Page ' + si + ': ' + (String.isBlank(s.label) ? s.name : s.label) + (s.conditionalLogic == null ? '' : ' [' + ruleSentence(def, s.conditionalLogic, 'this page') + ']'));
            for (JFormDefinition.Field f : s.fields) {
                String line = '  - ' + (String.isBlank(f.label) ? '(' + f.fieldType + ')' : f.label)
                    + ' (' + f.fieldType + ', key ' + f.key + (f.required == true ? ', required' : '') + ')';
                if (JFormTableService.isTable(f)) {
                    line += tableText(f);
                } else if (JFormFieldParts.isCompound(f)) {
                    line += partsText(f);
                } else if (f.options != null && !f.options.isEmpty()) {
                    List<String> labels = new List<String>();
                    for (JFormDefinition.Option o : f.options) {
                        labels.add(o.label);
                    }
                    line += ': ' + String.join(labels, ' | ');
                } else if (f.fieldType == JFormPaymentPricing.FIELD_TYPE) {
                    line += paymentText(def, f);
                }
                String phone = phoneSettings(f);
                if (phone != null) {
                    line += ' [' + phone + ']';
                }
                if (f.conditionalLogic != null) {
                    line += ' [' + ruleSentence(def, f.conditionalLogic, 'this field') + ']';
                }
                lines.add(line);
            }
            if (s.fields.isEmpty()) {
                lines.add('  (no fields yet)');
            }
        }
        return String.join(lines, '\n');
    }

    /** ": rows Service (key satisfaction.service) | Price (...); columns Poor | Fair | Good; several answers per row". */
    private static String tableText(JFormDefinition.Field f) {
        List<String> rows = new List<String>();
        for (JFormTableService.Row r : JFormTableService.rows(f)) {
            rows.add(r.label + ' (key ' + JFormTableService.answerKey(f, r) + ')');
        }
        List<String> columns = new List<String>();
        for (JFormDefinition.Option o : f.options == null ? new List<JFormDefinition.Option>() : f.options) {
            columns.add(o.label);
        }
        return ': rows ' + String.join(rows, ' | ') + '; columns ' + String.join(columns, ' | ')
            + (JFormTableService.multiple(f) ? '; several answers per row' : '')
            + (f.required == true && !JFormTableService.everyRow(f) ? '; one answered row is enough' : '');
    }

    /** ": parts First name (key name.firstName) | Last name (key name.lastName)", and an address's purpose and countries. */
    private static String partsText(JFormDefinition.Field f) {
        List<String> parts = new List<String>();
        for (JFormFieldParts.Part p : JFormFieldParts.parts(f)) {
            parts.add(p.label + ' (key ' + JFormFieldParts.answerKey(f, p) + ')');
        }
        String text = ': parts ' + String.join(parts, ' | ');
        if (JFormAddressService.isAddress(f)) {
            String purpose = JFormAddressService.purposeOf(f);
            Object countries = f.config == null ? null : f.config.get('countries');
            text += (String.isBlank(purpose) ? '' : '; ' + purpose + ' address')
                + (countries instanceof List<Object> && !((List<Object>) countries).isEmpty() ? '; countries ' + String.join((List<Object>) countries, ', ') : '')
                + (JFormAddressService.defaultCountry(f) == null ? '' : '; default country ' + JFormAddressService.defaultCountry(f));
        }
        return text;
    }

    /** The label of an answer key: the field's, "Table: Row" for a table row ("field.row") or "Name: Part" for a name part. */
    private static String answerLabel(JFormDefinition.Form def, String key) {
        if (key != null && key.contains('.')) {
            JFormDefinition.Field compound = def.fieldsByKey().get(key.substringBefore('.'));
            if (JFormFieldParts.isCompound(compound)) {
                for (JFormFieldParts.Part p : JFormFieldParts.storedParts(compound)) {
                    if (JFormFieldParts.answerKey(compound, p) == key) {
                        return JFormFieldParts.partLabel(compound, p);
                    }
                }
            }
            JFormDefinition.Field table = def.fieldsByKey().get(key.substringBefore('.'));
            for (JFormTableService.Row r : JFormTableService.rows(table)) {
                if (JFormTableService.answerKey(table, r) == key) {
                    return JFormTableService.rowLabel(table, r);
                }
            }
        }
        JFormDefinition.Field f = findField(def, key);
        return f == null || String.isBlank(f.label) ? key : f.label;
    }

    /** One step of the Automate tab: a record step on an object, or a flow step. */
    private static String stepLine(JFormDefinition.Form def, JFormAutomationService.Step st) {
        String line;
        if (st.action == 'flow') {
            String name = String.isBlank(st.flowLabel) ? st.flowApiName : st.flowLabel + ' (' + st.flowApiName + ')';
            line = 'Run flow ' + name + ' (' + plural(st.fields.size(), 'input')
                + (st.outputs.isEmpty() ? '' : ', outputs ' + String.join(st.outputs, ', ')) + ')';
        } else {
            String verb = String.isBlank(st.action) ? 'Create' : st.action == 'find_or_create' ? 'Find or create' : st.action.substring(0, 1).toUpperCase() + st.action.substring(1);
            line = verb + ' ' + st.objectApiName + (st.match == null ? '' : ' matching ' + st.match.field) + ': ' + mappingText(def, st.fields);
        }
        if (st.condition != null) {
            line += ' [' + ruleSentence(def, st.condition, 'this step') + ']';
        }
        if (st.primary == true && st.action != 'flow') {
            line += ' [main record]';
        }
        return line;
    }

    /** "FirstName from First name, LeadSource = "Web"": which answer or value fills each field of a record step. */
    private static String mappingText(JFormDefinition.Form def, List<JFormAutomationService.Mapping> mappings) {
        if (mappings == null || mappings.isEmpty()) {
            return 'no fields set';
        }
        List<String> parts = new List<String>();
        for (JFormAutomationService.Mapping m : mappings) {
            JFormAutomationService.Source src = m.source;
            String origin;
            if (src == null) {
                origin = ' (no value)';
            } else if (src.type == 'field') {
                origin = ' from ' + answerLabel(def, src.key);
            } else if (src.type == 'value') {
                origin = ' = "' + (src.value == null ? '' : src.value) + '"';
            } else if (src.type == 'step') {
                origin = ' from step ' + src.step + (String.isBlank(src.path) ? '' : ' ' + src.path);
            } else {
                origin = ' from the response ' + (String.isBlank(src.path) ? 'id' : src.path);
            }
            parts.add(m.field + origin);
        }
        return String.join(parts, ', ');
    }

    /** A Payment block's price: ": USD 75", ": price by Sessions: Morning USD 50 | ...", ": USD 20 each, times Tickets" or ": pay what you want"; then its mode. */
    private static String paymentText(JFormDefinition.Form def, JFormDefinition.Field f) {
        Map<String, Object> config = f.config == null ? new Map<String, Object>() : f.config;
        JFormPaymentService.FormSettings settings = JFormPaymentService.settingsOf(def);
        String money = settings.currencyCode + ' ';
        String pricing = JFormPaymentPricing.pricingOf(f);
        JFormDefinition.Field source = config.get('source') == null ? null : def.fieldsByKey().get(String.valueOf(config.get('source')));
        String text;
        if (pricing == 'choice') {
            // in the order of the field's choices, then any price for a choice it does not have
            Map<String, Object> byValue = new Map<String, Object>();
            if (config.get('prices') instanceof List<Object>) {
                for (Object o : (List<Object>) config.get('prices')) {
                    if (o instanceof Map<String, Object>) {
                        byValue.put(String.valueOf(((Map<String, Object>) o).get('value')), ((Map<String, Object>) o).get('amount'));
                    }
                }
            }
            List<String> prices = new List<String>();
            for (JFormDefinition.Option o : source == null || source.options == null ? new List<JFormDefinition.Option>() : source.options) {
                if (byValue.containsKey(o.value)) {
                    prices.add(o.label + ' ' + money + byValue.remove(o.value));
                }
            }
            for (String value : byValue.keySet()) {
                prices.add(value + ' ' + money + byValue.get(value));
            }
            text = 'price by ' + (source == null ? '(no choice field chosen)' : source.label) + (prices.isEmpty() ? ', no prices yet' : ': ' + String.join(prices, ' | '));
        } else if (pricing == 'quantity') {
            text = money + config.get('unitPrice') + ' each, times ' + (source == null ? '(no number field chosen)' : source.label);
        } else if (pricing == 'custom') {
            text = 'pay what you want' + (config.get('minimum') == null ? '' : ', at least ' + money + config.get('minimum'));
        } else {
            text = config.get('amount') == null ? 'no price yet' : money + config.get('amount');
        }
        return ': ' + text + '; ' + (settings.mode == JFormPaymentService.LIVE ? 'live' : 'test') + ' payments';
    }

    /** A phone field's country code picker settings, or null when it has a plain number box. */
    private static String phoneSettings(JFormDefinition.Field f) {
        if (f.fieldType != 'phone' || f.config == null || f.config.get('countryPicker') != true) {
            return null;
        }
        List<String> parts = new List<String>{ 'country code picker, default ' + (f.config.get('defaultCountry') == null ? 'US' : String.valueOf(f.config.get('defaultCountry'))) };
        if (f.config.get('detectCountry') == true) {
            parts.add('starts in the visitor\'s country');
        }
        if (f.config.get('mobileOnly') == true) {
            parts.add('mobile numbers only');
        } else if (f.config.get('strictNumber') == true) {
            parts.add('strict check');
        }
        return String.join(parts, ', ');
    }

    private static String plural(Integer n, String noun) {
        return n + ' ' + noun + (n == 1 ? '' : 's');
    }

    public static String statusText(JFormDefinition.Form def) {
        if (def.isActive == true) {
            return 'Live, version ' + (def.version == null ? 1 : def.version);
        }
        if (def.version != null && def.version > 0) {
            return (String.isBlank(def.status) ? 'Inactive' : def.status) + ' (last published version ' + def.version + ')';
        }
        return 'Draft, never published';
    }

    public static String ruleSentence(JFormDefinition.Form def, JFormDefinition.Rule rule, String target) {
        if (rule == null) {
            return '';
        }
        List<String> parts = new List<String>();
        for (JFormDefinition.Condition c : rule.conditions) {
            String name = answerLabel(def, c.field);
            String op = c.operator == null ? 'equals' : c.operator.replace('_', ' ');
            Boolean needsValue = c.operator != 'is_empty' && c.operator != 'is_not_empty';
            parts.add(name + ' ' + op + (needsValue ? ' "' + (c.value == null ? '' : c.value) + '"' : ''));
        }
        String verb = rule.action == null ? 'Show' : rule.action.substring(0, 1).toUpperCase() + rule.action.substring(1);
        return verb + ' ' + target + ' when ' + String.join(parts, rule.match == 'any' ? ' or ' : ' and ');
    }

    // ------------------------------------------------------------ links

    public static String builderUrl(String formId) {
        return URL.getOrgDomainUrl().toExternalForm() + '/lightning/n/' + JFormNamespace.qualify('JForm_Workspace') + '?' + JFormNamespace.stateKey('formid') + '=' + formId;
    }

    public static String previewUrl(String publicKey) {
        return String.isBlank(publicKey) ? null : URL.getOrgDomainUrl().toExternalForm() + '/lightning/n/' + JFormNamespace.qualify('JForm_Preview') + '?' + JFormNamespace.stateKey('key') + '=' + publicKey;
    }

    /** Public link from the form's chosen site and page path (Share dialog settings), else the first Experience site. */
    public static String publicUrl(JFormDefinition.Form def) {
        if (def == null || String.isBlank(def.publicKey)) {
            return null;
        }
        Map<String, Object> publish = def.settings != null && def.settings.get('publish') instanceof Map<String, Object>
            ? (Map<String, Object>) def.settings.get('publish')
            : new Map<String, Object>();
        String siteId = publish.get('siteId') == null ? null : String.valueOf(publish.get('siteId'));
        String path = publish.get('pagePath') == null ? '/form' : String.valueOf(publish.get('pagePath'));
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        JFormChannelService.SiteOption chosen;
        try {
            for (JFormChannelService.SiteOption s : JFormChannelService.getSites()) {
                if (siteId != null && s.id == siteId) {
                    chosen = s;
                    break;
                }
                if (chosen == null && s.isExperienceSite == true) {
                    chosen = s;
                }
            }
        } catch (Exception e) {
            chosen = null;
        }
        return chosen == null ? null : chosen.baseUrl + path + '?key=' + def.publicKey;
    }

    public static String embedSnippet(String publicUrl, String publicKey, String title) {
        if (String.isBlank(publicUrl)) {
            return null;
        }
        String id = 'jform-' + publicKey;
        String safeTitle = (title == null ? 'Form' : title).escapeHtml4();
        // Same script as the Share dialog's: only the form's site may resize the frame or, after the
        // thank-you screen, move the page to an http(s) link (jform:redirect).
        String origin = originOf(publicUrl);
        String originCheck = origin == null ? '' : 'e.origin==="' + origin + '"&&';
        return '<iframe id="' + id + '" src="' + publicUrl + '&embed=1" title="' + safeTitle + '" style="width:100%;border:0;min-height:600px" loading="lazy"></iframe>\n'
            + '<script>window.addEventListener("message",function(e){var d=e.data;if(' + originCheck + 'd&&d.key==="' + publicKey + '"){'
            + 'if(d.type==="jform:height"){var f=document.getElementById("' + id + '");if(f)f.style.height=(d.height+8)+"px";}'
            + 'else if(d.type==="jform:redirect"&&/^https?:/i.test(d.url)){window.location.href=d.url;}}});</script>';
    }

    /** scheme://host[:port] of a link, or null when it is not one. */
    @TestVisible
    private static String originOf(String link) {
        try {
            Url u = new Url(link);
            if (!new Set<String>{ 'http', 'https' }.contains(u.getProtocol()) || String.isBlank(u.getHost())) {
                return null;
            }
            return u.getProtocol() + '://' + u.getHost() + (u.getPort() == -1 ? '' : ':' + u.getPort());
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------ misc

    public static String errorText(Exception e) {
        String m = e.getMessage();
        return String.isBlank(m) ? e.getTypeName() : m;
    }

    private static String firstNonBlank(List<Object> values, String fallback) {
        for (Object v : values) {
            if (v != null && String.isNotBlank(String.valueOf(v))) {
                return String.valueOf(v);
            }
        }
        return fallback;
    }
}
