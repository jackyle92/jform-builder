/**
 * Canonical form definition model. One JSON shape is shared by the builder, the
 * published snapshot (Form_Version__c.Definition_JSON__c), the public renderer,
 * the REST API, Agentforce actions and the MCP server.
 *
 * Serialization is explicit (Map based) because the JSON contract uses the keys
 * "type" and "order", which are reserved words in Apex.
 */
public inherited sharing class JFormDefinition {

    public static final String DEFAULT_SIZE_CLASS = 'item-component slds-col slds-var-p-bottom_x-large  slds-size_1-of-1';

    /** Field types that render content but never collect an answer. */
    public static final Set<String> LAYOUT_TYPES = new Set<String>{ 'richtext', 'heading', 'divider', 'image', 'event' };

    /** Lower-case contract value -> Field_Type__c picklist value. */
    public static final Map<String, String> PICKLIST_BY_TYPE = new Map<String, String>{
        'text' => 'Text', 'number' => 'Number', 'date' => 'Date', 'checkbox' => 'Checkbox',
        'picklist' => 'Picklist', 'email' => 'Email', 'phone' => 'Phone', 'richtext' => 'Richtext',
        'lookup' => 'Lookup', 'fileupload' => 'FileUpload', 'comment' => 'Comment', 'time' => 'Time',
        'multiselect' => 'Multiselect', 'radio' => 'Radio', 'checkboxes' => 'Checkboxes',
        'rating' => 'Rating', 'nps' => 'NPS', 'yesno' => 'YesNo', 'hidden' => 'Hidden',
        'consent' => 'Consent', 'heading' => 'Heading', 'divider' => 'Divider',
        'image' => 'Image', 'event' => 'Event', 'signature' => 'Signature', 'table' => 'Table',
        'payment' => 'Payment', 'name' => 'Name', 'address' => 'Address'
    };

    public class JFormException extends Exception {}
    /** A save against an older revision than the one stored: someone else changed the form first. */
    public class ConflictException extends Exception {}

    // ------------------------------------------------------------------ model

    public class Condition {
        public String field;
        public String operator;
        public String value;
    }

    public class Rule {
        public String action;      // show | hide | require | skip_to
        public String match;       // all | any
        public List<Condition> conditions = new List<Condition>();
    }

    public class Validation {
        public String regexPattern;
        public String errorMessage;
        public Integer minLength;
        public Integer maxLength;
        public Decimal minValue;
        public Decimal maxValue;
    }

    public class Option {
        public String id;
        public String label;
        public String value;
        public Integer sortOrder;
    }

    public class Field {
        public String id;
        public String key;
        public String fieldType;   // JSON "type"
        public String label;
        public String helpText;
        public String placeholder;
        public String defaultValue;
        public Boolean required = false;
        public Integer sortOrder;  // JSON "order"
        public List<Option> options;
        public String richtext;
        public String targetObjectApiName;
        public String targetFieldApiName;
        public String fileType;
        public Validation validation;
        public Integer width = 100;
        public Rule conditionalLogic;
        /** Type-specific settings (date limits, time step …); JSON "config", stored as Config_JSON__c. */
        public Map<String, Object> config;
    }

    public class Section {
        public String id;
        public String key;
        public String name;
        public String label;
        public String description;
        public Integer sortOrder;
        public Rule conditionalLogic;
        public List<Field> fields = new List<Field>();
    }

    public class Theme {
        public String preset;
        public String primaryColor;   // JSON "primary"
        public String background;
        public String surface;
        public String textColor;      // JSON "text"
        public String headingFont;
        public String bodyFont;
        public String textSize;
        public String width;
        public String radius;
        public String buttonStyle;
        public String labelPosition;
        public String logoUrl;
        public String coverUrl;
        public Boolean poweredBy;
        /** Theme keys this model does not name (e.g. labelColor, fieldStyle, choiceStyle). Preserved on save. */
        public Map<String, Object> extra = new Map<String, Object>();
    }

    private static final Set<String> KNOWN_THEME_KEYS = new Set<String>{
        'preset', 'primary', 'background', 'surface', 'text', 'headingFont', 'bodyFont', 'textSize',
        'width', 'radius', 'buttonStyle', 'labelPosition', 'logoUrl', 'coverUrl', 'poweredBy'
    };

    public class Form {
        public String id;
        public String name;
        public String label;
        public String description;
        public String status;
        public Boolean isActive = false;
        public String displayStyle;
        public String targetObjectApiName;
        public String welcomeMessage;
        public String thankYouMessage;
        public Integer version;
        /** Save counter (Form__c.Revision__c); sent back with a save so a stale copy is refused. Null skips the check. */
        public Integer revision;
        /** The save counter at the last publish (from the live version), so the workspace knows whether anything changed since. Read only. */
        public Integer publishedRevision;
        public String publicKey;
        public Theme theme;
        public Map<String, Object> settings;
        public List<Section> sections = new List<Section>();

        /** Every field in page order, keyed by its key. */
        public Map<String, Field> fieldsByKey() {
            Map<String, Field> result = new Map<String, Field>();
            for (Section s : sections) {
                for (Field f : s.fields) {
                    if (String.isNotBlank(f.key)) {
                        result.put(f.key, f);
                    }
                }
            }
            return result;
        }

        public Integer fieldCount() {
            Integer n = 0;
            for (Section s : sections) {
                n += s.fields.size();
            }
            return n;
        }

        public String serialize() {
            return JSON.serialize(JFormDefinition.toMap(this));
        }
    }

    /** The revision stored in the live version's snapshot (publish writes the new revision into it), or null. */
    @TestVisible
    private static Integer publishedRevisionOf(Form__c form) {
        if (form.Current_Version__c == null || form.Current_Version__r == null || String.isBlank(form.Current_Version__r.Definition_JSON__c)) {
            return null;
        }
        try {
            Object parsed = JSON.deserializeUntyped(form.Current_Version__r.Definition_JSON__c);
            return parsed instanceof Map<String, Object> ? intval((Map<String, Object>) parsed, 'revision') : null;
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------- records -> model

    /**
     * A form's records, read with one query per level (JFormDefinitionService.queryTree). Nested
     * subqueries hand back long child lists in batches that can only be walked with a SOQL for
     * loop, which failed for long forms with "Aggregate query has too many rows".
     */
    public class Records {
        public Form__c form;
        public List<Form_Section__c> sections = new List<Form_Section__c>();
        public Map<Id, List<Form_Field_Definition__c>> fieldsBySection = new Map<Id, List<Form_Field_Definition__c>>();
        public Map<Id, List<Form_Picklist_Option__c>> optionsByField = new Map<Id, List<Form_Picklist_Option__c>>();

        public List<Form_Field_Definition__c> fieldsOf(Id sectionId) {
            List<Form_Field_Definition__c> l = fieldsBySection.get(sectionId);
            return l == null ? new List<Form_Field_Definition__c>() : l;
        }
        public List<Form_Picklist_Option__c> optionsOf(Id fieldId) {
            List<Form_Picklist_Option__c> l = optionsByField.get(fieldId);
            return l == null ? new List<Form_Picklist_Option__c>() : l;
        }
    }

    public static Form fromRecords(Records records) {
        Form__c form = records.form;
        Form def = new Form();
        def.id = form.Id;
        def.name = form.Name;
        def.label = form.Form_Label__c;
        def.description = form.Description__c;
        def.status = form.Status__c;
        def.isActive = form.Is_Active__c == true;
        def.displayStyle = form.Display_Style__c;
        def.targetObjectApiName = form.Target_Object_API_Name__c;
        def.welcomeMessage = form.Welcome_Message__c;
        def.thankYouMessage = form.Thank_You_Message__c;
        def.version = form.Version__c == null ? null : form.Version__c.intValue();
        def.revision = form.Revision__c == null ? 0 : form.Revision__c.intValue();
        def.publishedRevision = publishedRevisionOf(form);
        def.publicKey = form.Public_Key__c;
        def.theme = parseTheme(form.Theme_JSON__c);
        def.settings = parseSettings(form.Settings_JSON__c);

        Integer si = 0;
        for (Form_Section__c s : records.sections) {
                si++;
                Section sec = new Section();
                sec.id = s.Id;
                sec.key = String.isBlank(s.External_Section_Id__c) ? 'section_' + si : s.External_Section_Id__c;
                sec.name = s.Name;
                sec.label = s.Section_Label__c;
                sec.description = s.Description__c;
                sec.sortOrder = s.Order__c == null ? si : s.Order__c.intValue();
                sec.conditionalLogic = parseRule(s.Conditional_Logic_JSON__c);
                Integer fi = 0;
                for (Form_Field_Definition__c fd : records.fieldsOf(s.Id)) {
                    fi++;
                    sec.fields.add(fieldFromRecord(fd, records.optionsOf(fd.Id), si, fi));
                }
                def.sections.add(sec);
        }
        return def;
    }

    private static Field fieldFromRecord(Form_Field_Definition__c fd, List<Form_Picklist_Option__c> options, Integer si, Integer fi) {
        Field f = new Field();
        f.id = fd.Id;
        f.key = String.isBlank(fd.External_Field_Definition_Id__c) ? 'field_' + si + '_' + fi : fd.External_Field_Definition_Id__c;
        f.fieldType = String.isBlank(fd.Field_Type__c) ? 'text' : fd.Field_Type__c.toLowerCase();
        f.label = fd.Field_Label__c;
        f.helpText = fd.Help_Text__c;
        f.placeholder = fd.Placeholder__c;
        f.defaultValue = fd.Default_Value__c;
        f.required = fd.Is_Required__c == true;
        f.sortOrder = fd.Order__c == null ? fi - 1 : fd.Order__c.intValue();
        f.richtext = fd.Richtext_Value__c;
        f.targetObjectApiName = fd.Salesforce_Object_API_Name__c;
        f.targetFieldApiName = fd.Salesforce_Field_API_Name__c;
        f.fileType = fd.File_Type__c;
        f.width = widthFromSizeClass(fd.Large_Size__c != null ? fd.Large_Size__c : fd.Medium_Size__c);
        f.conditionalLogic = parseRule(fd.Conditional_Logic_JSON__c);
        f.config = parseConfig(fd.Config_JSON__c);
        if (fd.Regex_Pattern__c != null || fd.Validation_Error_Message__c != null || fd.Minimum_Length__c != null
            || fd.Maximum_Length__c != null || fd.Min_Value__c != null || fd.Max_Value__c != null) {
            Validation v = new Validation();
            v.regexPattern = fd.Regex_Pattern__c;
            v.errorMessage = fd.Validation_Error_Message__c;
            v.minLength = fd.Minimum_Length__c == null ? null : fd.Minimum_Length__c.intValue();
            v.maxLength = fd.Maximum_Length__c == null ? null : fd.Maximum_Length__c.intValue();
            v.minValue = fd.Min_Value__c;
            v.maxValue = fd.Max_Value__c;
            f.validation = v;
        }
        if (!options.isEmpty()) {
            f.options = new List<Option>();
            Integer oi = 0;
            for (Form_Picklist_Option__c po : options) {
                oi++;
                Option o = new Option();
                o.id = po.Id;
                o.label = po.Option_Label__c;
                o.value = String.isBlank(po.Option_Value__c) ? po.Option_Label__c : po.Option_Value__c;
                // the records arrive in order; long lists store fractions in Order__c (see JFormDefinitionService.orderValue)
                o.sortOrder = oi;
                f.options.add(o);
            }
        }
        return f;
    }

    public static Integer widthFromSizeClass(String cls) {
        if (String.isBlank(cls)) {
            return 100;
        }
        Pattern p = Pattern.compile('_(\\d+)-of-12');
        Matcher m = p.matcher(cls);
        if (m.find()) {
            Decimal cols = Decimal.valueOf(m.group(1));
            return (cols * 100 / 12).round().intValue();
        }
        return 100;
    }

    public static Integer colsFromWidth(Integer width) {
        if (width == null) {
            return 12;
        }
        if (width <= 25) {
            return 3;
        }
        if (width <= 50) {
            return 6;
        }
        if (width <= 75) {
            return 9;
        }
        return 12;
    }

    public static String picklistValueForType(String fieldType) {
        String key = fieldType == null ? 'text' : fieldType.toLowerCase();
        return PICKLIST_BY_TYPE.containsKey(key) ? PICKLIST_BY_TYPE.get(key) : 'Text';
    }

    // ----------------------------------------------------------- model -> JSON

    public static Map<String, Object> toMap(Form def) {
        Map<String, Object> m = new Map<String, Object>();
        put(m, 'id', def.id);
        put(m, 'name', def.name);
        put(m, 'label', def.label);
        put(m, 'description', def.description);
        put(m, 'status', def.status);
        m.put('isActive', def.isActive == true);
        put(m, 'displayStyle', def.displayStyle);
        put(m, 'targetObjectApiName', def.targetObjectApiName);
        put(m, 'welcomeMessage', def.welcomeMessage);
        put(m, 'thankYouMessage', def.thankYouMessage);
        put(m, 'version', def.version);
        put(m, 'revision', def.revision);
        put(m, 'publishedRevision', def.publishedRevision);
        put(m, 'publicKey', def.publicKey);
        if (def.theme != null) {
            m.put('theme', toMap(def.theme));
        }
        if (def.settings != null) {
            m.put('settings', def.settings);
        }
        List<Object> sections = new List<Object>();
        for (Section s : def.sections) {
            sections.add(toMap(s));
        }
        m.put('sections', sections);
        return m;
    }

    public static Map<String, Object> toMap(Section s) {
        Map<String, Object> m = new Map<String, Object>();
        put(m, 'id', s.id);
        put(m, 'key', s.key);
        put(m, 'name', s.name);
        put(m, 'label', s.label);
        put(m, 'description', s.description);
        put(m, 'order', s.sortOrder);
        if (s.conditionalLogic != null) {
            m.put('conditionalLogic', toMap(s.conditionalLogic));
        }
        List<Object> fields = new List<Object>();
        for (Field f : s.fields) {
            fields.add(toMap(f));
        }
        m.put('fields', fields);
        return m;
    }

    public static Map<String, Object> toMap(Field f) {
        Map<String, Object> m = new Map<String, Object>();
        put(m, 'id', f.id);
        put(m, 'key', f.key);
        put(m, 'type', f.fieldType);
        put(m, 'label', f.label);
        put(m, 'helpText', f.helpText);
        put(m, 'placeholder', f.placeholder);
        put(m, 'defaultValue', f.defaultValue);
        m.put('required', f.required == true);
        put(m, 'order', f.sortOrder);
        if (f.options != null) {
            List<Object> options = new List<Object>();
            for (Option o : f.options) {
                Map<String, Object> om = new Map<String, Object>();
                put(om, 'id', o.id);
                put(om, 'label', o.label);
                put(om, 'value', o.value);
                put(om, 'order', o.sortOrder);
                options.add(om);
            }
            m.put('options', options);
        }
        put(m, 'richtext', f.richtext);
        put(m, 'targetObjectApiName', f.targetObjectApiName);
        put(m, 'targetFieldApiName', f.targetFieldApiName);
        put(m, 'fileType', f.fileType);
        if (f.validation != null) {
            Map<String, Object> vm = new Map<String, Object>();
            put(vm, 'regexPattern', f.validation.regexPattern);
            put(vm, 'errorMessage', f.validation.errorMessage);
            put(vm, 'minLength', f.validation.minLength);
            put(vm, 'maxLength', f.validation.maxLength);
            put(vm, 'minValue', f.validation.minValue);
            put(vm, 'maxValue', f.validation.maxValue);
            m.put('validation', vm);
        }
        put(m, 'width', f.width == null ? 100 : f.width);
        if (f.conditionalLogic != null) {
            m.put('conditionalLogic', toMap(f.conditionalLogic));
        }
        if (f.config != null && !f.config.isEmpty()) {
            m.put('config', f.config);
        }
        return m;
    }

    public static Map<String, Object> toMap(Rule r) {
        Map<String, Object> m = new Map<String, Object>();
        put(m, 'action', r.action);
        put(m, 'match', String.isBlank(r.match) ? 'all' : r.match);
        List<Object> conditions = new List<Object>();
        if (r.conditions != null) {
            for (Condition c : r.conditions) {
                Map<String, Object> cm = new Map<String, Object>();
                put(cm, 'field', c.field);
                put(cm, 'operator', c.operator);
                put(cm, 'value', c.value);
                conditions.add(cm);
            }
        }
        m.put('conditions', conditions);
        return m;
    }

    public static Map<String, Object> toMap(Theme t) {
        Map<String, Object> m = new Map<String, Object>();
        if (t.extra != null) {
            for (String k : t.extra.keySet()) {
                if (!KNOWN_THEME_KEYS.contains(k) && t.extra.get(k) != null) {
                    m.put(k, t.extra.get(k));
                }
            }
        }
        put(m, 'preset', t.preset);
        put(m, 'primary', t.primaryColor);
        put(m, 'background', t.background);
        put(m, 'surface', t.surface);
        put(m, 'text', t.textColor);
        put(m, 'headingFont', t.headingFont);
        put(m, 'bodyFont', t.bodyFont);
        put(m, 'textSize', t.textSize);
        put(m, 'width', t.width);
        put(m, 'radius', t.radius);
        put(m, 'buttonStyle', t.buttonStyle);
        put(m, 'labelPosition', t.labelPosition);
        put(m, 'logoUrl', t.logoUrl);
        put(m, 'coverUrl', t.coverUrl);
        put(m, 'poweredBy', t.poweredBy);
        return m;
    }

    private static void put(Map<String, Object> m, String k, Object v) {
        if (v != null) {
            m.put(k, v);
        }
    }

    // ----------------------------------------------------------- JSON -> model

    public static Form parse(String jsonText) {
        if (String.isBlank(jsonText)) {
            throw new JFormException('Form definition JSON is empty.');
        }
        Object raw = JSON.deserializeUntyped(jsonText);
        if (!(raw instanceof Map<String, Object>)) {
            throw new JFormException('Form definition JSON must be an object.');
        }
        return formFromMap((Map<String, Object>) raw);
    }

    public static Form formFromMap(Map<String, Object> m) {
        Form def = new Form();
        def.id = str(m, 'id');
        def.name = str(m, 'name');
        def.label = str(m, 'label');
        def.description = str(m, 'description');
        def.status = str(m, 'status');
        def.isActive = bool(m, 'isActive') == true;
        def.displayStyle = str(m, 'displayStyle');
        def.targetObjectApiName = str(m, 'targetObjectApiName');
        def.welcomeMessage = str(m, 'welcomeMessage');
        def.thankYouMessage = str(m, 'thankYouMessage');
        def.version = intval(m, 'version');
        def.revision = intval(m, 'revision');
        def.publishedRevision = intval(m, 'publishedRevision');
        def.publicKey = str(m, 'publicKey');
        if (m.get('theme') instanceof Map<String, Object>) {
            def.theme = themeFromMap((Map<String, Object>) m.get('theme'));
        }
        if (m.get('settings') instanceof Map<String, Object>) {
            def.settings = (Map<String, Object>) m.get('settings');
        }
        if (m.get('sections') instanceof List<Object>) {
            Integer si = 0;
            for (Object so : (List<Object>) m.get('sections')) {
                si++;
                if (so instanceof Map<String, Object>) {
                    def.sections.add(sectionFromMap((Map<String, Object>) so, si));
                }
            }
        }
        return def;
    }

    private static Section sectionFromMap(Map<String, Object> m, Integer si) {
        Section s = new Section();
        s.id = str(m, 'id');
        s.key = String.isBlank(str(m, 'key')) ? 'section_' + si : str(m, 'key');
        s.name = str(m, 'name');
        s.label = str(m, 'label');
        s.description = str(m, 'description');
        s.sortOrder = intval(m, 'order') == null ? si : intval(m, 'order');
        s.conditionalLogic = ruleFromObject(m.get('conditionalLogic'));
        if (m.get('fields') instanceof List<Object>) {
            Integer fi = 0;
            for (Object fo : (List<Object>) m.get('fields')) {
                fi++;
                if (fo instanceof Map<String, Object>) {
                    s.fields.add(fieldFromMap((Map<String, Object>) fo, si, fi));
                }
            }
        }
        return s;
    }

    public static Field fieldFromMap(Map<String, Object> m, Integer si, Integer fi) {
        Field f = new Field();
        f.id = str(m, 'id');
        f.key = String.isBlank(str(m, 'key')) ? 'field_' + si + '_' + fi : str(m, 'key');
        f.fieldType = String.isBlank(str(m, 'type')) ? 'text' : str(m, 'type').toLowerCase();
        f.label = str(m, 'label');
        f.helpText = str(m, 'helpText');
        f.placeholder = str(m, 'placeholder');
        f.defaultValue = str(m, 'defaultValue');
        f.required = bool(m, 'required') == true;
        f.sortOrder = intval(m, 'order') == null ? fi - 1 : intval(m, 'order');
        f.richtext = str(m, 'richtext');
        f.targetObjectApiName = str(m, 'targetObjectApiName');
        f.targetFieldApiName = str(m, 'targetFieldApiName');
        f.fileType = str(m, 'fileType');
        f.width = intval(m, 'width') == null ? 100 : intval(m, 'width');
        f.conditionalLogic = ruleFromObject(m.get('conditionalLogic'));
        if (m.get('config') instanceof Map<String, Object> && !((Map<String, Object>) m.get('config')).isEmpty()) {
            f.config = (Map<String, Object>) m.get('config');
        }
        if (m.get('validation') instanceof Map<String, Object>) {
            Map<String, Object> vm = (Map<String, Object>) m.get('validation');
            Validation v = new Validation();
            v.regexPattern = str(vm, 'regexPattern');
            v.errorMessage = str(vm, 'errorMessage');
            v.minLength = intval(vm, 'minLength');
            v.maxLength = intval(vm, 'maxLength');
            v.minValue = dec(vm, 'minValue');
            v.maxValue = dec(vm, 'maxValue');
            f.validation = v;
        }
        if (m.get('options') instanceof List<Object>) {
            f.options = new List<Option>();
            Integer oi = 0;
            for (Object oo : (List<Object>) m.get('options')) {
                oi++;
                if (oo instanceof Map<String, Object>) {
                    Map<String, Object> om = (Map<String, Object>) oo;
                    Option o = new Option();
                    o.id = str(om, 'id');
                    o.label = str(om, 'label');
                    o.value = String.isBlank(str(om, 'value')) ? o.label : str(om, 'value');
                    o.sortOrder = intval(om, 'order') == null ? oi : intval(om, 'order');
                    f.options.add(o);
                }
            }
        }
        return f;
    }

    /** Config_JSON__c → map; anything unreadable is dropped rather than failing the whole form. */
    private static Map<String, Object> parseConfig(String raw) {
        if (String.isBlank(raw)) return null;
        try {
            Object parsed = JSON.deserializeUntyped(raw);
            if (parsed instanceof Map<String, Object> && !((Map<String, Object>) parsed).isEmpty()) {
                return (Map<String, Object>) parsed;
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'JForm: unreadable field config ignored: ' + e.getMessage());
        }
        return null;
    }

    public static Rule parseRule(String jsonText) {
        if (String.isBlank(jsonText)) {
            return null;
        }
        try {
            return ruleFromObject(JSON.deserializeUntyped(jsonText));
        } catch (Exception e) {
            return null; // legacy or malformed rule text is ignored, never fatal
        }
    }

    private static Rule ruleFromObject(Object raw) {
        if (!(raw instanceof Map<String, Object>)) {
            return null;
        }
        Map<String, Object> m = (Map<String, Object>) raw;
        if (!(m.get('conditions') instanceof List<Object>) || String.isBlank(str(m, 'action'))) {
            return null;
        }
        Rule r = new Rule();
        r.action = str(m, 'action');
        r.match = String.isBlank(str(m, 'match')) ? 'all' : str(m, 'match');
        for (Object co : (List<Object>) m.get('conditions')) {
            if (co instanceof Map<String, Object>) {
                Map<String, Object> cm = (Map<String, Object>) co;
                Condition c = new Condition();
                c.field = str(cm, 'field');
                c.operator = str(cm, 'operator');
                c.value = str(cm, 'value');
                r.conditions.add(c);
            }
        }
        return r.conditions.isEmpty() ? null : r;
    }

    public static Theme parseTheme(String jsonText) {
        if (String.isBlank(jsonText)) {
            return null;
        }
        try {
            Object raw = JSON.deserializeUntyped(jsonText);
            return raw instanceof Map<String, Object> ? themeFromMap((Map<String, Object>) raw) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Theme themeFromMap(Map<String, Object> m) {
        Theme t = new Theme();
        t.preset = str(m, 'preset');
        t.primaryColor = str(m, 'primary');
        t.background = str(m, 'background');
        t.surface = str(m, 'surface');
        t.textColor = str(m, 'text');
        t.headingFont = str(m, 'headingFont');
        t.bodyFont = str(m, 'bodyFont');
        t.textSize = str(m, 'textSize');
        t.width = str(m, 'width');
        t.radius = str(m, 'radius');
        t.buttonStyle = str(m, 'buttonStyle');
        t.labelPosition = str(m, 'labelPosition');
        t.logoUrl = str(m, 'logoUrl');
        t.coverUrl = str(m, 'coverUrl');
        t.poweredBy = bool(m, 'poweredBy');
        for (String k : m.keySet()) {
            if (!KNOWN_THEME_KEYS.contains(k) && m.get(k) != null) {
                t.extra.put(k, m.get(k));
            }
        }
        return t;
    }

    /** The settings stored in Form__c.Settings_JSON__c; null when blank or not an object. */
    public static Map<String, Object> parseSettings(String jsonText) {
        if (String.isBlank(jsonText)) {
            return null;
        }
        try {
            Object raw = JSON.deserializeUntyped(jsonText);
            return raw instanceof Map<String, Object> ? (Map<String, Object>) raw : null;
        } catch (Exception e) {
            return null;
        }
    }

    // --------------------------------------------------------- untyped helpers

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : String.valueOf(v);
    }

    private static Boolean bool(Map<String, Object> m, String k) {
        Object v = m.get(k);
        if (v == null) {
            return null;
        }
        if (v instanceof Boolean) {
            return (Boolean) v;
        }
        return String.valueOf(v).toLowerCase() == 'true';
    }

    private static Integer intval(Map<String, Object> m, String k) {
        Object v = m.get(k);
        if (v == null) {
            return null;
        }
        if (v instanceof Integer) {
            return (Integer) v;
        }
        if (v instanceof Long) {
            return ((Long) v).intValue();
        }
        if (v instanceof Decimal) {
            return ((Decimal) v).intValue();
        }
        if (v instanceof Double) {
            return ((Double) v).intValue();
        }
        try {
            return Integer.valueOf(String.valueOf(v));
        } catch (Exception e) {
            return null;
        }
    }

    private static Decimal dec(Map<String, Object> m, String k) {
        Object v = m.get(k);
        if (v == null) {
            return null;
        }
        if (v instanceof Decimal) {
            return (Decimal) v;
        }
        if (v instanceof Integer) {
            return Decimal.valueOf((Integer) v);
        }
        if (v instanceof Long) {
            return Decimal.valueOf((Long) v);
        }
        if (v instanceof Double) {
            return Decimal.valueOf((Double) v);
        }
        try {
            return Decimal.valueOf(String.valueOf(v));
        } catch (Exception e) {
            return null;
        }
    }
}
