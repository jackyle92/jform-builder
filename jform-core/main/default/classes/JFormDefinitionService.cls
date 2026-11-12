/**
 * Loads and saves form definitions against the normalized objects.
 * Save is a key-based diff: pages, fields and options are matched by record Id
 * when present and by key otherwise; anything missing from the definition is
 * deleted. Runs in user mode so CRUD, FLS and sharing of the caller apply.
 */
public with sharing class JFormDefinitionService {

    /** Choices per field and in a whole form, pages per form: what one load can read comfortably. */
    public static final Integer MAX_OPTIONS_PER_FIELD = 1000;
    public static final Integer MAX_OPTIONS_PER_FORM = 5000;
    public static final Integer MAX_PAGES = 99;

    public static JFormDefinition.Form load(Id formId) {
        JFormDefinition.Records records = queryTree(formId);
        if (records == null) {
            throw new JFormDefinition.JFormException('Form not found: ' + formId);
        }
        return JFormDefinition.fromRecords(records);
    }

    /**
     * Lock the form row until the transaction ends, before reading it to change it. Two agent
     * actions run in parallel (the planner may call Add Fields twice at once) otherwise both read
     * the same version and the later save drops what the earlier one added. With the lock the
     * second waits for the first to commit and reads its result.
     */
    public static void lockForEdit(Id formId) {
        if (formId == null) {
            return;
        }
        List<Form__c> locked = [SELECT Id FROM Form__c WHERE Id = :formId WITH USER_MODE LIMIT 1 FOR UPDATE];
        if (locked.isEmpty()) {
            throw new JFormDefinition.JFormException('Form not found: ' + formId);
        }
    }

    /** Create a new form from a definition (id ignored). Returns the saved definition. */
    public static JFormDefinition.Form create(JFormDefinition.Form def) {
        if (def == null || String.isBlank(def.name)) {
            throw new JFormDefinition.JFormException('A form needs a name.');
        }
        normaliseKeys(def);
        JFormAutomationService.normalise(def);
        validate(def); // fail before anything is written
        throwIfAny(JFormAutomationService.flowPermissionProblems(def, null));
        Form__c form = new Form__c(
            Name = truncate(def.name, 80),
            Form_Label__c = String.isBlank(def.label) ? def.name : def.label,
            Description__c = def.description,
            Display_Style__c = String.isBlank(def.displayStyle)
                ? (def.sections.size() > 1 ? 'Multi-Page (Sections)' : 'Single Page')
                : def.displayStyle,
            Target_Object_API_Name__c = def.targetObjectApiName,
            Welcome_Message__c = def.welcomeMessage,
            Thank_You_Message__c = def.thankYouMessage,
            Status__c = 'Draft',
            Is_Active__c = false,
            Version__c = 0,
            Revision__c = 0
        );
        Database.insert(form, AccessLevel.USER_MODE);
        def.id = form.Id;
        def.revision = null; // a new record has no history to be stale against (clone passes the source's revision in)
        stripIds(def);
        return save(def);
    }

    /** Deep copy an existing form into a new Draft. */
    public static JFormDefinition.Form clone(Id sourceFormId, String newName) {
        JFormDefinition.Form def = load(sourceFormId);
        def.name = String.isBlank(newName) ? truncate(def.name + ' (copy)', 80) : newName;
        def.label = String.isBlank(newName) ? def.label : newName;
        def.status = 'Draft';
        def.isActive = false;
        def.publicKey = null;
        def.version = null;
        // promotion codes are records of the source form, not copied: a copy set to JForm codes would refuse every code
        if (def.settings != null && def.settings.get('payments') instanceof Map<String, Object>) {
            Map<String, Object> payments = (Map<String, Object>) def.settings.get('payments');
            // read as everything else reads it: trimmed and in any case
            if (JFormPaymentService.settingsOf(def).codes == JFormPromotionCodeService.JFORM) {
                payments.remove('codes');
            }
        }
        return create(def);
    }

    /** Save settings, pages, fields and options of an existing form. */
    public static JFormDefinition.Form save(JFormDefinition.Form def) {
        if (def == null || String.isBlank(def.id)) {
            throw new JFormDefinition.JFormException('save() needs a definition with an id. Use create() for a new form.');
        }
        normaliseKeys(def);
        JFormAutomationService.normalise(def);
        validate(def);
        // Optimistic lock: a caller that says which revision it loaded may not overwrite a newer one.
        // Callers without a revision (REST, agents sending plain JSON) skip the check.
        Integer currentRevision = 0;
        String savedSettings;
        // locked, so a save that started at the same time cannot pass this check with the same revision
        for (Form__c f : [SELECT Revision__c, Settings_JSON__c FROM Form__c WHERE Id = :def.id WITH USER_MODE LIMIT 1 FOR UPDATE]) {
            currentRevision = f.Revision__c == null ? 0 : f.Revision__c.intValue();
            savedSettings = f.Settings_JSON__c;
        }
        // new or changed flow steps need the Manage Flow permission; untouched ones do not
        throwIfAny(JFormAutomationService.flowPermissionProblems(def, savedSettings));
        if (def.revision != null && def.revision != currentRevision) {
            throw new JFormDefinition.ConflictException('This form was changed elsewhere after you loaded it. Reload to see the latest version, or keep your edits to overwrite it.');
        }
        Integer nextRevision = currentRevision + 1;
        Savepoint sp = Database.setSavepoint();
        try {
            Form__c form = new Form__c(
                Id = def.id,
                Revision__c = nextRevision,
                Name = truncate(def.name, 80),
                Form_Label__c = String.isBlank(def.label) ? def.name : def.label,
                Description__c = def.description,
                Display_Style__c = String.isBlank(def.displayStyle)
                    ? (def.sections.size() > 1 ? 'Multi-Page (Sections)' : 'Single Page')
                    : def.displayStyle,
                Target_Object_API_Name__c = def.targetObjectApiName,
                Welcome_Message__c = def.welcomeMessage,
                Thank_You_Message__c = def.thankYouMessage,
                Theme_JSON__c = def.theme == null ? null : JSON.serialize(JFormDefinition.toMap(def.theme)),
                Settings_JSON__c = def.settings == null ? null : JSON.serialize(def.settings)
            );
            Database.update(form, AccessLevel.USER_MODE);

            JFormDefinition.Records existing = queryTree(def.id);
            Map<Id, Form_Section__c> exSections = new Map<Id, Form_Section__c>();
            Map<Id, Form_Field_Definition__c> exFields = new Map<Id, Form_Field_Definition__c>();
            Map<Id, Form_Picklist_Option__c> exOptions = new Map<Id, Form_Picklist_Option__c>();
            // Definitions without record ids (API clients, agents) still update in place: match by key, options by value.
            Map<String, Id> exSectionByKey = new Map<String, Id>();
            Map<String, Id> exFieldByKey = new Map<String, Id>();
            Map<String, Id> exOptionByValue = new Map<String, Id>();
            for (Form_Section__c s : existing.sections) {
                exSections.put(s.Id, s);
                if (String.isNotBlank(s.External_Section_Id__c)) {
                    exSectionByKey.put(s.External_Section_Id__c, s.Id);
                }
                for (Form_Field_Definition__c f : existing.fieldsOf(s.Id)) {
                    exFields.put(f.Id, f);
                    if (String.isNotBlank(f.External_Field_Definition_Id__c)) {
                        exFieldByKey.put(f.External_Field_Definition_Id__c, f.Id);
                    }
                    for (Form_Picklist_Option__c o : existing.optionsOf(f.Id)) {
                        exOptions.put(o.Id, o);
                        exOptionByValue.put(f.Id + '|' + (String.isBlank(o.Option_Value__c) ? o.Option_Label__c : o.Option_Value__c), o.Id);
                    }
                }
            }

            // Pages
            List<Form_Section__c> sectionRecords = new List<Form_Section__c>();
            Set<Id> keepSections = new Set<Id>();
            for (Integer i = 0; i < def.sections.size(); i++) {
                JFormDefinition.Section s = def.sections[i];
                Form_Section__c rec = new Form_Section__c();
                Id sectionId = existingId(s.id, exSections.keySet(), exSectionByKey.get(s.key), keepSections);
                if (sectionId != null) {
                    rec.Id = sectionId;
                    keepSections.add(sectionId);
                } else {
                    rec.Form__c = def.id;
                }
                rec.Name = truncate(String.isBlank(s.name) ? (String.isBlank(s.label) ? 'Page ' + (i + 1) : s.label) : s.name, 80);
                rec.Section_Label__c = String.isBlank(s.label) ? rec.Name : s.label;
                rec.Description__c = s.description;
                rec.Order__c = i + 1;
                rec.External_Section_Id__c = s.key;
                rec.Conditional_Logic_JSON__c = s.conditionalLogic == null ? null : JSON.serialize(JFormDefinition.toMap(s.conditionalLogic));
                sectionRecords.add(rec);
            }
            Database.upsert(sectionRecords, true, AccessLevel.USER_MODE);

            // Fields
            List<Form_Field_Definition__c> fieldRecords = new List<Form_Field_Definition__c>();
            List<JFormDefinition.Field> fieldDefs = new List<JFormDefinition.Field>();
            Set<Id> keepFields = new Set<Id>();
            for (Integer i = 0; i < def.sections.size(); i++) {
                JFormDefinition.Section s = def.sections[i];
                for (Integer j = 0; j < s.fields.size(); j++) {
                    JFormDefinition.Field f = s.fields[j];
                    Form_Field_Definition__c rec = new Form_Field_Definition__c();
                    Id fieldId = existingId(f.id, exFields.keySet(), exFieldByKey.get(f.key), keepFields);
                    if (fieldId != null) {
                        rec.Id = fieldId;
                        keepFields.add(fieldId);
                    } else {
                        rec.Form__c = def.id;
                    }
                    rec.Form_Section__c = sectionRecords[i].Id;
                    Boolean isLayout = JFormDefinition.LAYOUT_TYPES.contains(f.fieldType);
                    rec.Name = truncate(isLayout ? (f.fieldType == 'richtext' ? 'Rich Text Field' : f.fieldType) : (String.isBlank(f.label) ? f.fieldType : f.label), 80);
                    rec.Field_Label__c = String.isBlank(f.label) ? rec.Name : f.label;
                    rec.Field_Type__c = JFormDefinition.picklistValueForType(f.fieldType);
                    rec.Help_Text__c = f.helpText;
                    rec.Placeholder__c = f.placeholder;
                    rec.Default_Value__c = f.defaultValue;
                    rec.Is_Required__c = f.required == true;
                    rec.Order__c = j;
                    rec.Richtext_Value__c = f.richtext;
                    rec.Salesforce_Object_API_Name__c = String.isBlank(f.targetFieldApiName) ? null : (String.isBlank(f.targetObjectApiName) ? def.targetObjectApiName : f.targetObjectApiName);
                    rec.Salesforce_Field_API_Name__c = f.targetFieldApiName;
                    rec.File_Type__c = f.fileType;
                    rec.Regex_Pattern__c = f.validation == null ? null : f.validation.regexPattern;
                    rec.Validation_Type__c = (f.validation != null && String.isNotBlank(f.validation.regexPattern)) ? 'Regular Expression' : null;
                    rec.Validation_Error_Message__c = f.validation == null ? null : f.validation.errorMessage;
                    rec.Minimum_Length__c = f.validation == null ? null : f.validation.minLength;
                    rec.Maximum_Length__c = f.validation == null ? null : f.validation.maxLength;
                    rec.Min_Value__c = f.validation == null ? null : f.validation.minValue;
                    rec.Max_Value__c = f.validation == null ? null : f.validation.maxValue;
                    rec.Config_JSON__c = (f.config == null || f.config.isEmpty()) ? null : JSON.serialize(f.config);
                    Integer cols = JFormDefinition.colsFromWidth(f.width);
                    rec.Default_Size__c = JFormDefinition.DEFAULT_SIZE_CLASS;
                    rec.Small_Size__c = '';
                    rec.Medium_Size__c = 'slds-medium-size_' + cols + '-of-12';
                    rec.Large_Size__c = 'slds-large-size_' + cols + '-of-12';
                    rec.External_Field_Definition_Id__c = f.key;
                    rec.Conditional_Logic_JSON__c = f.conditionalLogic == null ? null : JSON.serialize(JFormDefinition.toMap(f.conditionalLogic));
                    fieldRecords.add(rec);
                    fieldDefs.add(f);
                }
            }
            if (!fieldRecords.isEmpty()) {
                Database.upsert(fieldRecords, true, AccessLevel.USER_MODE);
            }

            // Options
            List<Form_Picklist_Option__c> optionRecords = new List<Form_Picklist_Option__c>();
            Set<Id> keepOptions = new Set<Id>();
            for (Integer k = 0; k < fieldDefs.size(); k++) {
                JFormDefinition.Field f = fieldDefs[k];
                if (f.options == null) {
                    continue;
                }
                for (Integer n = 0; n < f.options.size(); n++) {
                    JFormDefinition.Option o = f.options[n];
                    String value = String.isBlank(o.value) ? o.label : o.value;
                    Form_Picklist_Option__c rec = new Form_Picklist_Option__c();
                    Id optionId = existingId(o.id, exOptions.keySet(), exOptionByValue.get(fieldRecords[k].Id + '|' + value), keepOptions);
                    if (optionId != null) {
                        rec.Id = optionId;
                        keepOptions.add(optionId);
                    } else {
                        rec.Form_Field_Definition__c = fieldRecords[k].Id;
                    }
                    rec.Option_Label__c = o.label;
                    rec.Option_Value__c = value;
                    rec.Order__c = orderValue(n + 1, f.options.size());
                    optionRecords.add(rec);
                }
            }
            if (!optionRecords.isEmpty()) {
                Database.upsert(optionRecords, true, AccessLevel.USER_MODE);
            }

            // Deletes: options, then fields, then pages
            List<Form_Picklist_Option__c> delOptions = new List<Form_Picklist_Option__c>();
            for (Id oid : exOptions.keySet()) {
                if (!keepOptions.contains(oid)) {
                    delOptions.add(new Form_Picklist_Option__c(Id = oid));
                }
            }
            if (!delOptions.isEmpty()) {
                Database.delete(delOptions, true, AccessLevel.USER_MODE);
            }
            List<Form_Field_Definition__c> delFields = new List<Form_Field_Definition__c>();
            for (Id fid : exFields.keySet()) {
                if (!keepFields.contains(fid)) {
                    delFields.add(new Form_Field_Definition__c(Id = fid));
                }
            }
            if (!delFields.isEmpty()) {
                Database.delete(delFields, true, AccessLevel.USER_MODE);
            }
            List<Form_Section__c> delSections = new List<Form_Section__c>();
            for (Id sid : exSections.keySet()) {
                if (!keepSections.contains(sid)) {
                    delSections.add(new Form_Section__c(Id = sid));
                }
            }
            if (!delSections.isEmpty()) {
                Database.delete(delSections, true, AccessLevel.USER_MODE);
            }
        } catch (Exception e) {
            Database.rollback(sp);
            throw e;
        }
        JFormChangeEvents.publish(def.id, nextRevision, 'saved');
        return load(def.id);
    }

    /** Semantic checks shared with the MCP validator. Throws on the first group of problems. */
    private static void throwIfAny(List<String> problems) {
        if (!problems.isEmpty()) {
            throw new JFormDefinition.JFormException(String.join(problems, ' '));
        }
    }

    public static void validate(JFormDefinition.Form def) {
        List<String> problems = new List<String>();
        if (def.sections == null || def.sections.isEmpty()) {
            problems.add('A form needs at least one page.');
        }
        Set<String> keys = new Set<String>();
        Set<String> tableKeys = new Set<String>();
        // a Name or Address field's key => what a rule on it must name instead: 'part of the name "name", such as "name.lastName"'
        Map<String, String> partKeys = new Map<String, String>();
        Integer fieldCount = 0;
        for (JFormDefinition.Section s : def.sections) {
            if (String.isNotBlank(s.key) && !keys.add(s.key)) {
                problems.add('Duplicate key "' + s.key + '".');
            }
            for (JFormDefinition.Field f : s.fields) {
                fieldCount++;
                if (String.isNotBlank(f.key) && !keys.add(f.key)) {
                    problems.add('Duplicate key "' + f.key + '".');
                }
                if (!JFormDefinition.PICKLIST_BY_TYPE.containsKey(f.fieldType)) {
                    problems.add('Unknown field type "' + f.fieldType + '".');
                }
                Boolean needsOptions = f.fieldType == 'picklist' || f.fieldType == 'multiselect' || f.fieldType == 'radio' || f.fieldType == 'checkboxes'
                    || JFormTableService.isTable(f);
                if (needsOptions && (f.options == null || f.options.isEmpty())) {
                    problems.add('Field "' + (String.isBlank(f.label) ? f.key : f.label) + '" needs at least one option.');
                }
                if (JFormTableService.isTable(f)) {
                    problems.addAll(JFormTableService.definitionProblems(f));
                    tableKeys.add(f.key);
                }
                problems.addAll(JFormUploadPolicy.configProblems(f));
                if (JFormFieldParts.isCompound(f)) {
                    problems.addAll(JFormFieldParts.definitionProblems(f));
                    partKeys.put(f.key, JFormNameService.isName(f)
                        ? 'part of the name "' + f.key + '", such as "' + f.key + '.' + JFormNameService.LAST_NAME + '"'
                        : 'part of the address "' + f.key + '", such as "' + f.key + '.' + JFormAddressService.CITY + '"');
                }
                if (f.fieldType == 'richtext' && String.isBlank(f.richtext)) {
                    problems.add('Rich text field "' + f.key + '" has no content.');
                }
                if (!JFormDefinition.LAYOUT_TYPES.contains(f.fieldType) && String.isBlank(f.label) && f.fieldType != 'hidden') {
                    problems.add('Field "' + f.key + '" needs a label.');
                }
            }
        }
        // a condition tests one row of a table or one part of a name or address, never the field as a whole
        Set<String> conditionKeys = new Set<String>(keys);
        conditionKeys.removeAll(tableKeys);
        conditionKeys.removeAll(partKeys.keySet());
        conditionKeys.addAll(JFormTableService.answerKeys(def));
        for (JFormDefinition.Section s : def.sections) {
            checkRule(s.conditionalLogic, conditionKeys, tableKeys, partKeys, s.key, problems);
            for (JFormDefinition.Field f : s.fields) {
                checkRule(f.conditionalLogic, conditionKeys, tableKeys, partKeys, f.key, problems);
            }
        }
        if (fieldCount > 200) {
            problems.add('Forms are limited to 200 fields.');
        }
        if (def.sections != null && def.sections.size() > MAX_PAGES) {
            problems.add('Forms are limited to ' + MAX_PAGES + ' pages.');
        }
        Integer optionCount = 0;
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                Integer n = f.options == null ? 0 : f.options.size();
                optionCount += n;
                if (n > MAX_OPTIONS_PER_FIELD) {
                    problems.add('Field "' + (String.isBlank(f.label) ? f.key : f.label) + '" has ' + n + ' choices; a field can have up to ' + MAX_OPTIONS_PER_FIELD + '.');
                }
            }
        }
        if (optionCount > MAX_OPTIONS_PER_FORM) {
            problems.add('Forms are limited to ' + MAX_OPTIONS_PER_FORM + ' choices in total.');
        }
        problems.addAll(JFormScreens.problems(def));
        problems.addAll(JFormAvailability.problems(def));
        problems.addAll(JFormAutomationService.validate(def));
        problems.addAll(JFormPaymentService.definitionProblems(def));
        if (!problems.isEmpty()) {
            throw new JFormDefinition.JFormException(String.join(problems, ' '));
        }
    }

    private static void checkRule(JFormDefinition.Rule r, Set<String> keys, Set<String> tableKeys, Map<String, String> partKeys, String selfKey, List<String> problems) {
        if (r == null) {
            return;
        }
        for (JFormDefinition.Condition c : r.conditions) {
            if (tableKeys.contains(c.field)) {
                problems.add('Rule on "' + selfKey + '" must test one row of the table "' + c.field + '", such as "' + c.field + '.<row key>".');
            } else if (partKeys.containsKey(c.field)) {
                problems.add('Rule on "' + selfKey + '" must test one ' + partKeys.get(c.field) + '.');
            } else if (!keys.contains(c.field)) {
                problems.add('Rule on "' + selfKey + '" references unknown field "' + c.field + '".');
            } else if (c.field == selfKey || c.field.startsWith(selfKey + '.')) {
                problems.add('Field "' + selfKey + '" cannot depend on itself.');
            }
        }
    }

    // ------------------------------------------------------------- helpers

    /**
     * The form, its pages and fields in one query, and the fields' choices in a second one, copied into
     * the plain lists and maps the rest of the code uses. Pages and fields are both direct children of
     * the form (fields keep their page in Form_Section__c), so neither query nests more than one level.
     * A single query nesting pages, fields and choices came back short in Lightning: a four-page form
     * loaded with two pages in the workspace, while anonymous Apex and the REST API got all four. Child
     * lists are only walked with for loops: a long form's arrive in batches, and Apex refuses any direct
     * use of them ("Aggregate query has too many rows for direct assignment, use FOR loop").
     */
    public static JFormDefinition.Records queryTree(Id formId) {
        List<Form__c> forms = [
            SELECT Id, Name, Form_Label__c, Description__c, Status__c, Is_Active__c, Display_Style__c,
                Target_Object_API_Name__c, Thank_You_Message__c, Welcome_Message__c, Version__c,
                Public_Key__c, Theme_JSON__c, Settings_JSON__c, Current_Version__c, Current_Version__r.Definition_JSON__c, Revision__c,
                (SELECT Id, Name, Section_Label__c, Description__c, Order__c, Conditional_Logic_JSON__c, External_Section_Id__c
                 FROM Form_Sections__r ORDER BY Order__c NULLS LAST, Id),
                (SELECT Id, Name, Form_Section__c, Field_Label__c, Field_Type__c, Help_Text__c, Placeholder__c, Default_Value__c,
                    Is_Required__c, Order__c, Richtext_Value__c, Salesforce_Object_API_Name__c,
                    Salesforce_Field_API_Name__c, File_Type__c, Regex_Pattern__c, Validation_Error_Message__c,
                    Minimum_Length__c, Maximum_Length__c, Min_Value__c, Max_Value__c, Large_Size__c, Medium_Size__c,
                    Conditional_Logic_JSON__c, Config_JSON__c, External_Field_Definition_Id__c
                 FROM Form_Field_Definitions__r ORDER BY Order__c NULLS LAST, Id)
            FROM Form__c
            WHERE Id = :formId
            WITH USER_MODE
            LIMIT 1
        ];
        if (forms.isEmpty()) {
            return null;
        }
        JFormDefinition.Records r = new JFormDefinition.Records();
        r.form = forms[0];
        for (Form_Section__c s : forms[0].Form_Sections__r) {
            r.sections.add(s);
            r.fieldsBySection.put(s.Id, new List<Form_Field_Definition__c>());
        }
        Set<Id> fieldIds = new Set<Id>();
        for (Form_Field_Definition__c f : forms[0].Form_Field_Definitions__r) {
            List<Form_Field_Definition__c> pageFields = f.Form_Section__c == null ? null : r.fieldsBySection.get(f.Form_Section__c);
            if (pageFields != null) { // a field whose page was deleted belongs to no page
                pageFields.add(f);
                fieldIds.add(f.Id);
            }
        }
        if (fieldIds.isEmpty()) {
            return r;
        }
        for (Form_Picklist_Option__c o : [
            SELECT Id, Form_Field_Definition__c, Option_Label__c, Option_Value__c, Order__c
            FROM Form_Picklist_Option__c
            WHERE Form_Field_Definition__c IN :fieldIds
            WITH USER_MODE
            ORDER BY Order__c NULLS LAST, Id
        ]) {
            List<Form_Picklist_Option__c> options = r.optionsByField.get(o.Form_Field_Definition__c);
            if (options == null) {
                options = new List<Form_Picklist_Option__c>();
                r.optionsByField.put(o.Form_Field_Definition__c, options);
            }
            options.add(o);
        }
        return r;
    }

    /**
     * Order__c on choices holds two whole digits (Number 5,3), so a list of 100 or more stores its
     * positions as thousandths (0.001 to 99.999): the order is the same, the field fits.
     */
    @TestVisible
    private static Decimal orderValue(Integer position, Integer listSize) {
        return listSize < 100 ? (Decimal) position : Decimal.valueOf(position).divide(1000, 3);
    }

    /** The record to update: the definition's id when it belongs to this form, else the record with the same key or value, unless another entry already claimed it. */
    private static Id existingId(String recordId, Set<Id> known, Id byKey, Set<Id> alreadyKept) {
        if (isExisting(recordId, known)) {
            return Id.valueOf(recordId);
        }
        return byKey != null && !alreadyKept.contains(byKey) ? byKey : null;
    }

    /**
     * Blank or invalid page and field keys get a generated one before validation, and every
     * rule, step mapping and condition that used the old key follows the rename. Duplicate
     * keys are left alone: validate() rejects them, because silently renaming one would
     * change which field a rule or mapping points at.
     */
    private static void normaliseKeys(JFormDefinition.Form def) {
        if (def.sections == null) {
            return;
        }
        Set<String> used = new Set<String>();
        for (Integer i = 0; i < def.sections.size(); i++) {
            JFormDefinition.Section s = def.sections[i];
            if (validKey(s.key)) {
                used.add(s.key);
                continue;
            }
            String key = uniqueKey(null, 'section_' + (i + 1), used);
            JFormAutomationService.renameKey(def, s.key, key);
            s.key = key;
        }
        for (Integer i = 0; i < def.sections.size(); i++) {
            JFormDefinition.Section s = def.sections[i];
            if (s.fields == null) {
                continue;
            }
            for (Integer j = 0; j < s.fields.size(); j++) {
                JFormDefinition.Field f = s.fields[j];
                JFormTableService.normaliseRows(f);
                if (validKey(f.key)) {
                    used.add(f.key);
                    continue;
                }
                String key = uniqueKey(null, 'field_' + (i + 1) + '_' + (j + 1), used);
                JFormAutomationService.renameKey(def, f.key, key);
                f.key = key;
            }
        }
        JFormPaymentService.normaliseEmailField(def);
    }

    private static Boolean validKey(String key) {
        return String.isNotBlank(key) && Pattern.matches('[A-Za-z][A-Za-z0-9_]*', key);
    }

    private static Boolean isExisting(String recordId, Set<Id> known) {
        if (String.isBlank(recordId) || recordId.startsWith('id-') || !(recordId.length() == 15 || recordId.length() == 18)) {
            return false;
        }
        try {
            return known.contains(Id.valueOf(recordId));
        } catch (Exception e) {
            return false;
        }
    }

    private static String uniqueKey(String preferred, String fallback, Set<String> used) {
        String base = String.isBlank(preferred) || !Pattern.matches('[A-Za-z][A-Za-z0-9_]*', preferred) ? fallback : preferred;
        String key = base.left(60);
        Integer n = 2;
        while (used.contains(key)) {
            key = (base + '_' + n).left(60);
            n++;
        }
        used.add(key);
        return key;
    }

    private static void stripIds(JFormDefinition.Form def) {
        for (JFormDefinition.Section s : def.sections) {
            s.id = null;
            for (JFormDefinition.Field f : s.fields) {
                f.id = null;
                if (f.options != null) {
                    for (JFormDefinition.Option o : f.options) {
                        o.id = null;
                    }
                }
            }
        }
    }

    private static String truncate(String s, Integer max) {
        if (s == null) {
            return null;
        }
        return s.length() > max ? s.substring(0, max) : s;
    }
}
