@IsTest
private class JFormNameServiceTest {

    /** A required Name field keyed "name", set up the way the builder adds one. */
    private static JFormDefinition.Field nameField() {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = 'name';
        f.fieldType = 'name';
        f.label = 'Name';
        f.required = true;
        f.config = new Map<String, Object>{
            'layout' => 'inline',
            'parts' => new Map<String, Object>{
                'firstName' => new Map<String, Object>{ 'label' => 'First name', 'maxLength' => 40 },
                'lastName' => new Map<String, Object>{ 'label' => 'Last name', 'maxLength' => 80 }
            }
        };
        return f;
    }

    private static Map<String, Object> partSettings(JFormDefinition.Field f, String part) {
        return (Map<String, Object>) ((Map<String, Object>) f.config.get('parts')).get(part);
    }

    private static JFormDefinition.Field text(String key, String label) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key;
        f.fieldType = 'text';
        f.label = label;
        return f;
    }

    /** The sample form plus a company field and the given fields on the first page, published, with no record step unless given. */
    private static Form__c publishedForm(String name, List<JFormDefinition.Field> extra, List<Object> steps) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition(name);
        def.sections[0].fields.add(text('company', 'Company'));
        def.sections[0].fields.addAll(extra);
        def.targetObjectApiName = null;
        def.settings = steps == null
            ? new Map<String, Object>{ 'target' => new Map<String, Object>{ 'strategy' => 'none' } }
            : new Map<String, Object>{ 'automation' => new Map<String, Object>{ 'steps' => steps } };
        def = JFormDefinitionService.create(def);
        Id formId = JFormPublishService.publish(def.id, null).formId;
        return [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :formId];
    }

    private static JFormDefinition.Form definitionOf(Form__c form) {
        return JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
    }

    /** The sample form's required answers, plus the Name answer when given. */
    private static Map<String, Object> answers(Object nameAnswer) {
        Map<String, Object> a = new Map<String, Object>{
            'first_name' => 'Noah', 'email' => 'jane.doe@example.com', 'company' => 'Riverside', 'season' => 'autumn'
        };
        if (nameAnswer != null) {
            a.put('name', nameAnswer);
        }
        return a;
    }

    private static Map<String, Object> janeDoe() {
        return new Map<String, Object>{ 'firstName' => 'Jane', 'lastName' => 'Doe' };
    }

    /** The message submit() refuses the answers with, or null when they are accepted. */
    private static String refusal(Form__c form, Map<String, Object> a) {
        try {
            JFormSubmissionService.submit(form, definitionOf(form), a, null);
            return null;
        } catch (JFormSubmissionService.SubmissionException e) {
            return e.getMessage();
        }
    }

    private static Map<String, Object> mapping(String field, String key) {
        return new Map<String, Object>{ 'field' => field, 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => key } };
    }

    private static Map<String, Object> step(String key, String objectName, Boolean primary, List<Object> fields) {
        return new Map<String, Object>{ 'key' => key, 'label' => 'Create the ' + key, 'action' => 'create', 'object' => objectName, 'primary' => primary, 'fields' => fields };
    }

    @IsTest
    static void listsFirstNameThenLastName() {
        JFormDefinition.Field f = nameField();
        Assert.areEqual(new List<String>{ 'name.firstName', 'name.lastName' }, JFormNameService.answerKeys(f));
        List<JFormNameService.Part> parts = JFormNameService.parts(f);
        Assert.areEqual(40, parts[0].maxLength);
        Assert.areEqual(80, parts[1].maxLength);
        Assert.areEqual('Name: Last name', JFormNameService.partLabel(f, parts[1]));

        // an older definition's order and salutation are ignored
        f.config.put('order', 'last_first');
        ((Map<String, Object>) f.config.get('parts')).put('salutation', new Map<String, Object>{ 'enabled' => true });
        Assert.areEqual(new List<String>{ 'name.firstName', 'name.lastName' }, JFormNameService.answerKeys(f));

        // blank labels and missing lengths fall back to the defaults; lengths are capped at 255
        partSettings(f, 'firstName').put('label', '  ');
        partSettings(f, 'firstName').remove('maxLength');
        partSettings(f, 'lastName').put('maxLength', 1000);
        parts = JFormNameService.parts(f);
        Assert.areEqual('First name', parts[0].label);
        Assert.areEqual(40, parts[0].maxLength);
        Assert.areEqual(JFormNameService.MAX_PART_LENGTH, parts[1].maxLength);

        Assert.isFalse(JFormNameService.isName(text('full_name', 'Full name')));
    }

    @IsTest
    static void buildsTheFullName() {
        JFormDefinition.Field f = nameField();
        Map<String, Object> a = new Map<String, Object>{ 'name' => new Map<String, Object>{ 'firstName' => ' Jane', 'lastName' => 'Doe  ' } };
        JFormDefinition.Form def = new JFormDefinition.Form();
        JFormDefinition.Section s = new JFormDefinition.Section();
        s.fields.add(f);
        def.sections = new List<JFormDefinition.Section>{ s };

        Assert.isTrue(JFormNameService.expand(def, a).isEmpty());
        Assert.areEqual('Jane', a.get('name.firstName'), 'trimmed');
        Assert.areEqual('Doe', a.get('name.lastName'));
        Assert.areEqual('Jane Doe', a.get('name'));

        // a full name sent along is ignored: it is always worked out from the parts
        Map<String, Object> echoed = new Map<String, Object>{ 'name' => new Map<String, Object>{ 'firstName' => 'Jane', 'lastName' => 'Doe', 'fullName' => 'Someone Else' } };
        Assert.isTrue(JFormNameService.expand(def, echoed).isEmpty());
        Assert.areEqual('Jane Doe', echoed.get('name'));

        a.remove('name.firstName');
        Assert.areEqual('Doe', JFormNameService.fullName(f, a), 'empty parts are left out');

        // whitespace alone is no answer, and no full name is stored for it
        Map<String, Object> blank = new Map<String, Object>{ 'name' => new Map<String, Object>{ 'firstName' => '   ', 'lastName' => '' } };
        Assert.isTrue(JFormNameService.expand(def, blank).isEmpty());
        Assert.isTrue(blank.isEmpty(), String.valueOf(blank));
    }

    @IsTest
    static void storesTheFullNameAndEachPart() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Name values', new List<JFormDefinition.Field>{ nameField() }, null);

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form),
                answers(new Map<String, Object>{ 'firstName' => '  Jane ', 'lastName' => 'Doe' }), null);
            Test.stopTest();

            Map<String, Submission_Field_Value__c> byKey = new Map<String, Submission_Field_Value__c>();
            for (Submission_Field_Value__c v : [SELECT Field_Key__c, Field_Label__c, Field_Value__c, Form_Field_Definition__c
                                                FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId]) {
                byKey.put(v.Field_Key__c, v);
            }
            Assert.areEqual('Jane Doe', byKey.get('name').Field_Value__c, 'the full name for the Responses tab');
            Assert.areEqual('Name', byKey.get('name').Field_Label__c);
            Assert.areEqual('Jane', byKey.get('name.firstName').Field_Value__c, 'trimmed');
            Assert.areEqual('Name: First name', byKey.get('name.firstName').Field_Label__c);
            Assert.areEqual('Doe', byKey.get('name.lastName').Field_Value__c);
            Assert.isNotNull(byKey.get('name.lastName').Form_Field_Definition__c, 'points to the Name field');
        }
    }

    @IsTest
    static void requiresFirstAndLastName() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Required name', new List<JFormDefinition.Field>{ nameField() }, null);

            Assert.areEqual('Please answer: Name', refusal(form, answers(null)), 'the label alone when nothing is answered');
            Assert.areEqual('Please answer: Name (Last name)', refusal(form, answers(new Map<String, Object>{ 'firstName' => 'Jane' })));
            Assert.areEqual('Please answer: Name (First name)', refusal(form, answers(new Map<String, Object>{ 'firstName' => '  ', 'lastName' => 'Doe' })), 'whitespace alone is empty');
            Assert.isNull(refusal(form, answers(new Map<String, Object>{ 'firstName' => 'Jane', 'lastName' => 'Doe' })));

            // an API caller can send the parts flat
            Map<String, Object> flat = answers(null);
            flat.put('name.firstName', 'Jane');
            flat.put('name.lastName', 'Doe');
            Assert.isNull(refusal(form, flat));
        }
    }

    @IsTest
    static void optionalNameCanBeLeftEmpty() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field optional = nameField();
            optional.required = false;
            Form__c form = publishedForm('Optional name', new List<JFormDefinition.Field>{ optional }, null);

            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form),
                answers(new Map<String, Object>{ 'firstName' => '', 'lastName' => ' ' }), null);

            Assert.areEqual(0, [SELECT COUNT() FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId AND Field_Key__c LIKE 'name%'], 'nothing stored for an empty name');
        }
    }

    @IsTest
    static void checksEachPart() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Name checks', new List<JFormDefinition.Field>{ nameField() }, null);

            Assert.areEqual('Please check: Name (First name): Enter no more than 40 characters',
                refusal(form, answers(new Map<String, Object>{ 'firstName' => 'J'.repeat(41), 'lastName' => 'Doe' })));
            Assert.isNull(refusal(form, answers(new Map<String, Object>{ 'firstName' => ' ' + 'J'.repeat(40) + ' ', 'lastName' => 'Doe' })), 'the length is counted after trimming');
            Assert.areEqual('Please check: Name: there is no part "middleName".',
                refusal(form, answers(new Map<String, Object>{ 'firstName' => 'Jane', 'middleName' => 'Q', 'lastName' => 'Doe' })));
            Assert.areEqual('Please check: Name: send the name by part (firstName, lastName).', refusal(form, answers('Jane Doe')));
            Assert.areEqual('Please check: Name: there is no part "salutation".',
                refusal(form, answers(new Map<String, Object>{ 'salutation' => 'Dr.', 'firstName' => 'Jane', 'lastName' => 'Doe' })));
        }
    }

    @IsTest
    static void mapsPartsToContactAndLeadNames() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<Object> steps = new List<Object>{
                step('contact', 'Contact', true, new List<Object>{
                    mapping('FirstName', 'name.firstName'), mapping('LastName', 'name.lastName'),
                    mapping('Email', 'email'),
                    new Map<String, Object>{ 'field' => 'Description', 'source' => new Map<String, Object>{ 'type' => 'value', 'value' => 'Signed up as {{name}}' } }
                }),
                step('lead', 'Lead', false, new List<Object>{
                    mapping('FirstName', 'name.firstName'), mapping('LastName', 'name.lastName'),
                    mapping('Company', 'company')
                })
            };
            Form__c form = publishedForm('Name mapping', new List<JFormDefinition.Field>{ nameField() }, steps);

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form), answers(janeDoe()), null);
            Assert.areEqual('Processed', res.status, 'error: ' + res.errorMessage);
            Contact c = [SELECT FirstName, LastName, Description FROM Contact WHERE Id = :res.targetRecordId];
            Assert.areEqual('Jane', c.FirstName);
            Assert.areEqual('Doe', c.LastName);
            Assert.areEqual('Signed up as Jane Doe', c.Description, 'the full name in step text');
            Lead l = [SELECT FirstName, LastName FROM Lead WHERE Company = 'Riverside' LIMIT 1];
            Assert.areEqual('Jane', l.FirstName);
            Assert.areEqual('Doe', l.LastName);

            // reprocessing reads the stored parts back by key; a response in error has no records (its steps
            // roll back), and the org's duplicate rules would refuse a second Jane Doe
            delete new List<SObject>{ c, l };
            update new Form_Submission__c(Id = res.submissionId, Status__c = 'Error');
            JFormSubmissionService.Result again = JFormSubmissionService.reprocess(res.submissionId);
            Test.stopTest();

            Assert.areEqual('Processed', again.status, 'error: ' + again.errorMessage);
            Assert.areNotEqual(res.targetRecordId, again.targetRecordId);
            Contact second = [SELECT FirstName, LastName FROM Contact WHERE Id = :again.targetRecordId];
            Assert.areEqual('Jane', second.FirstName);
            Assert.areEqual('Doe', second.LastName);
        }
    }

    @IsTest
    static void suggestsNameMappingsForAContact() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Suggested');
        for (JFormDefinition.Field f : def.fieldsByKey().values()) {
            f.targetFieldApiName = null;
        }
        def.sections[0].fields.add(nameField());
        def.targetObjectApiName = 'Contact';

        Map<String, String> sourceByField = new Map<String, String>();
        for (Object o : (List<Object>) ((Map<String, Object>) JFormAutomationService.stepsFromLegacy(def)[0]).get('fields')) {
            Map<String, Object> m = (Map<String, Object>) o;
            sourceByField.put(String.valueOf(m.get('field')), String.valueOf(((Map<String, Object>) m.get('source')).get('key')));
        }
        Assert.areEqual('name.firstName', sourceByField.get('FirstName'), 'the Name field wins over a field labelled First name: ' + sourceByField);
        Assert.areEqual('name.lastName', sourceByField.get('LastName'));
        Assert.isFalse(sourceByField.values().contains('name'), 'the whole name is never mapped');
    }

    @IsTest
    static void neverMapsTheWholeName() {
        // a saved definition may not map the name as a whole
        JFormDefinition.Field whole = nameField();
        whole.targetFieldApiName = 'LastName';
        String problems = String.join(JFormNameService.definitionProblems(whole), ' ');
        Assert.isTrue(problems.contains('is mapped part by part in a record step, with sources such as "name.lastName"'), problems);

        // agents and REST callers often send one; it is dropped, and the record step maps the parts instead
        JFormDefinition.Form def = JFormAgentSupport.parseDefinition(
            '[{"label":"Name","type":"name","targetFieldApiName":"LastName"},{"label":"Email","type":"email","targetFieldApiName":"Email"}]', 'Mapped name');
        JFormDefinition.Field n = def.fieldsByKey().get('name');
        Assert.areEqual('name', n.fieldType);
        Assert.isNull(n.targetFieldApiName);
        Assert.isTrue(JFormNameService.definitionProblems(n).isEmpty());

        def.targetObjectApiName = 'Contact';
        Map<String, String> sourceByField = new Map<String, String>();
        for (Object o : (List<Object>) ((Map<String, Object>) JFormAutomationService.stepsFromLegacy(def)[0]).get('fields')) {
            Map<String, Object> m = (Map<String, Object>) o;
            sourceByField.put(String.valueOf(m.get('field')), String.valueOf(((Map<String, Object>) m.get('source')).get('key')));
        }
        Assert.areEqual(new Map<String, String>{ 'Email' => 'email', 'FirstName' => 'name.firstName', 'LastName' => 'name.lastName' }, sourceByField,
            'the parts are mapped alongside the explicit mappings');

        // an older definition that still carries one is never mapped whole
        def.fieldsByKey().get('name').targetFieldApiName = 'LastName';
        List<Object> fields = (List<Object>) ((Map<String, Object>) JFormAutomationService.stepsFromLegacy(def)[0]).get('fields');
        for (Object o : fields) {
            Assert.areNotEqual('name', ((Map<String, Object>) ((Map<String, Object>) o).get('source')).get('key'));
        }
    }

    @IsTest
    static void conditionsTestOnePart() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field doctor = text('practice', 'Which practice are you with?');
            doctor.required = true;
            doctor.conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'name.lastName', 'equals', 'Doe');
            Form__c form = publishedForm('Name rule', new List<JFormDefinition.Field>{ nameField(), doctor }, null);

            Assert.areEqual('Please answer: Which practice are you with?', refusal(form, answers(janeDoe())));
            Assert.isNull(refusal(form, answers(new Map<String, Object>{ 'firstName' => 'Jane', 'lastName' => 'Lee' })), 'hidden, so not required');

            JFormDefinition.Form def = definitionOf(form);
            def.sections[0].fields[def.sections[0].fields.size() - 1].conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'name', 'is_not_empty', null);
            try {
                JFormDefinitionService.validate(def);
                Assert.fail('a rule on the whole name is refused');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('must test one part of the name "name", such as "name.lastName"'), e.getMessage());
            }
        }
    }

    @IsTest
    static void checksTheDefinition() {
        Assert.isTrue(JFormNameService.definitionProblems(nameField()).isEmpty());

        JFormDefinition.Field badLength = nameField();
        partSettings(badLength, 'firstName').put('maxLength', 0);
        partSettings(badLength, 'lastName').put('maxLength', 12.5);
        String problems = String.join(JFormNameService.definitionProblems(badLength), ' ');
        Assert.isTrue(problems.contains('the first name max length must be a whole number from 1 to 255'), problems);
        Assert.isTrue(problems.contains('the last name max length must be a whole number from 1 to 255'), problems);

        JFormDefinition.Field longKey = nameField();
        longKey.key = 'n'.repeat(75);
        Assert.isTrue(String.join(JFormNameService.definitionProblems(longKey), ' ').contains('the field key must be at most 70 characters'));
    }

    @IsTest
    static void responsesShowTheFullNameAndFilterByPart() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Name responses', new List<JFormDefinition.Field>{ nameField() }, null);
            JFormSubmissionService.submit(form, definitionOf(form), answers(janeDoe()), null);

            JFormResponsesController.ResultPage page = JFormResponsesController.getSubmissions(form.Id, 25, 0, 12, null, null, null, null, null, null, null, null);
            Assert.isTrue(page.columnKeys.contains('name'), String.valueOf(page.columnKeys));
            Assert.isFalse(page.columnKeys.contains('name.firstName'), 'one column for the name');
            Map<String, JFormResponsesController.FilterField> filters = new Map<String, JFormResponsesController.FilterField>();
            for (JFormResponsesController.FilterField ff : page.fields) {
                filters.put(ff.key, ff);
            }
            Assert.isTrue(filters.containsKey('name'), 'a filter on the full name');
            Assert.areEqual('Name: Last name', filters.get('name.lastName').label);
            Assert.isFalse(filters.containsKey('name.salutation'));

            JFormResponsesController.ResultPage filtered = JFormResponsesController.getSubmissions(form.Id, 25, 0, 12, null, null, null, null, 'name.lastName', 'Doe', null, null);
            Assert.areEqual(1, filtered.rows.size(), 'filters by a part');

            String csv = JFormResponsesController.exportCsv(form.Id, false, null, null);
            Assert.isTrue(csv.contains('Name: First name'), csv);
            Assert.isTrue(csv.contains('Jane Doe'), csv);
        }
    }

    @IsTest
    static void agentsAddNameFieldsAndRulesOnParts() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Agent sign-up';
            req.definitionJson = '[{"label":"Your name","type":"full name","required":true},'
                + '{"label":"Which practice are you with?","type":"text"}]';
            JFormCreateFormAction.Result created = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];
            Assert.isNull(created.errorMessage, 'unexpected error: ' + created.errorMessage);

            JFormDefinition.Field n = JFormDefinitionService.load(created.formId).fieldsByKey().get('your_name');
            Assert.areEqual('name', n.fieldType, '"full name" is a Name field');
            Assert.areEqual(new List<String>{ 'your_name.firstName', 'your_name.lastName' }, JFormNameService.answerKeys(n));
            Assert.isTrue(created.summary.contains('First name (key your_name.firstName) | Last name (key your_name.lastName)'), created.summary);

            JFormAddRuleAction.Request rule = new JFormAddRuleAction.Request();
            rule.formId = created.formId;
            rule.targetField = 'Which practice are you with?';
            rule.ruleAction = 'show';
            rule.whenField = 'Your name';
            rule.value = 'Nguyen';
            JFormAddRuleAction.Result refused = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ rule })[0];
            Assert.isTrue(String.valueOf(refused.errorMessage).contains('is a name: name one of its parts, your_name.firstName, your_name.lastName'), 'refused: ' + refused.errorMessage);

            // a first or last name is free text
            rule.whenField = 'Your name: Last name';
            JFormAddRuleAction.Result onLastName = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ rule })[0];
            Assert.isNull(onLastName.errorMessage, 'unexpected error: ' + onLastName.errorMessage);
            Assert.areEqual('Show "Which practice are you with?" when Your name: Last name equals "Nguyen"', onLastName.ruleSentence);
            JFormDefinition.Rule r = JFormDefinitionService.load(created.formId).fieldsByKey().get('which_practice_are_you_with').conditionalLogic;
            JFormDefinition.Condition last = r.conditions[r.conditions.size() - 1];
            Assert.areEqual('your_name.lastName', last.field);
            Assert.areEqual('Nguyen', last.value);
        }
    }
}
