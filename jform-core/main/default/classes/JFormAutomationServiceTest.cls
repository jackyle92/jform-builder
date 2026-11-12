@IsTest
private class JFormAutomationServiceTest {

    private static Map<String, Object> src(String type, String a, String b) {
        Map<String, Object> m = new Map<String, Object>{ 'type' => type };
        if (type == 'field') { m.put('key', a); }
        if (type == 'value') { m.put('value', a); }
        if (type == 'submission') { m.put('path', a); }
        if (type == 'step') { m.put('step', a); m.put('path', b == null ? 'Id' : b); }
        return m;
    }
    private static Map<String, Object> mapping(String field, Map<String, Object> source) {
        return new Map<String, Object>{ 'field' => field, 'source' => source };
    }
    private static Map<String, Object> step(String key, String label, String action, String obj, Map<String, Object> match, List<Object> fields) {
        Map<String, Object> s = new Map<String, Object>{ 'key' => key, 'label' => label, 'action' => action, 'object' => obj, 'fields' => fields };
        if (match != null) { s.put('match', match); }
        return s;
    }
    private static JFormDefinition.Field field(String key, String type, String label) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key; f.fieldType = type; f.label = label;
        return f;
    }

    /** A support form: name, email, company, subject, description, priority. */
    private static JFormDefinition.Form supportForm(List<Object> steps) {
        JFormDefinition.Form def = new JFormDefinition.Form();
        def.name = 'Support request';
        def.label = 'Support request';
        JFormDefinition.Section s = new JFormDefinition.Section();
        s.key = 'main'; s.name = 'Main'; s.label = 'Main';
        s.fields.add(field('first_name', 'text', 'First name'));
        s.fields.add(field('last_name', 'text', 'Last name'));
        s.fields.add(field('email', 'email', 'Email'));
        s.fields.add(field('company', 'text', 'Company'));
        s.fields.add(field('subject', 'text', 'Subject'));
        s.fields.add(field('description', 'comment', 'Describe the problem'));
        JFormDefinition.Field priority = field('priority', 'picklist', 'Priority');
        priority.options = new List<JFormDefinition.Option>();
        for (String v : new List<String>{ 'Low', 'Normal', 'Urgent' }) {
            JFormDefinition.Option o = new JFormDefinition.Option(); o.label = v; o.value = v; priority.options.add(o);
        }
        s.fields.add(priority);
        def.sections.add(s);
        def.settings = new Map<String, Object>{ 'automation' => new Map<String, Object>{ 'steps' => steps } };
        return def;
    }

    private static List<Object> supportSteps() {
        Map<String, Object> account = step('account', 'Find or create the account', 'find_or_create', 'Account',
            mapping('Name', src('field', 'company', null)),
            new List<Object>{ mapping('Name', src('field', 'company', null)) });
        Map<String, Object> contact = step('contact', 'Find or create the contact', 'find_or_create', 'Contact',
            mapping('Email', src('field', 'email', null)),
            new List<Object>{
                mapping('FirstName', src('field', 'first_name', null)), mapping('LastName', src('field', 'last_name', null)),
                mapping('Email', src('field', 'email', null)), mapping('AccountId', src('step', 'account', 'Id'))
            });
        Map<String, Object> cse = step('case', 'Create the case', 'create', 'Case', null, new List<Object>{
            mapping('Subject', src('value', '{{subject}} ({{priority}})', null)),
            mapping('Description', src('field', 'description', null)),
            mapping('Priority', src('field', 'priority', null)),
            mapping('Origin', src('value', 'Web', null)),
            mapping('ContactId', src('step', 'contact', 'Id')),
            mapping('AccountId', src('step', 'contact', 'AccountId'))
        });
        cse.put('primary', true);
        Map<String, Object> task = step('task', 'Alert the support lead', 'create', 'Task', null, new List<Object>{
            mapping('Subject', src('value', 'Urgent: {{subject}}', null)),
            mapping('WhatId', src('step', 'case', 'Id')),
            mapping('WhoId', src('step', 'contact', 'Id')),
            mapping('Description', src('submission', 'sourceUrl', null)),
            mapping('Priority', src('value', 'High', null))
        });
        task.put('condition', new Map<String, Object>{ 'match' => 'all', 'conditions' => new List<Object>{
            new Map<String, Object>{ 'field' => 'priority', 'operator' => 'equals', 'value' => 'Urgent' } } });
        return new List<Object>{ account, contact, cse, task };
    }

    private static Id publish(JFormDefinition.Form def) {
        JFormDefinition.Form saved = JFormDefinitionService.create(def);
        JFormPublishService.publish(saved.id, null);
        return saved.id;
    }
    private static String keyOf(Id formId) {
        return [SELECT Public_Key__c FROM Form__c WHERE Id = :formId].Public_Key__c;
    }
    private static Map<String, Object> answers(String priority) {
        return new Map<String, Object>{
            'first_name' => 'Ada', 'last_name' => 'Lovelace', 'email' => 'ada@example.com', 'company' => 'Analytical Engines',
            'subject' => 'Printer broken', 'description' => 'It jams on page two.', 'priority' => priority
        };
    }

    @IsTest
    static void supportCaseFlowCreatesLinkedRecords() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = publish(supportForm(supportSteps()));
            String key = keyOf(formId);

            Id sub1 = JFormPublicController.submitWithSource(key, JSON.serialize(answers('Urgent')), 'https://example.com/support');

            Account acc = [SELECT Id, Name FROM Account WHERE Name = 'Analytical Engines'];
            Contact con = [SELECT Id, AccountId, FirstName FROM Contact WHERE Email = 'ada@example.com'];
            Assert.areEqual(acc.Id, con.AccountId, 'contact linked to the account from step 1');
            Case c = [SELECT Id, Subject, Priority, Origin, ContactId, AccountId, Description FROM Case WHERE ContactId = :con.Id];
            Assert.areEqual('Printer broken (Urgent)', c.Subject, 'placeholders filled');
            Assert.areEqual('Urgent', c.Priority);
            Assert.areEqual('Web', c.Origin);
            Assert.areEqual(acc.Id, c.AccountId, 'AccountId read from the contact found in step 2');
            Task t = [SELECT Id, WhatId, WhoId, Subject, Description, Priority FROM Task WHERE WhatId = :c.Id];
            Assert.areEqual('Urgent: Printer broken', t.Subject);
            Assert.areEqual(con.Id, t.WhoId);
            Assert.areEqual('https://example.com/support', t.Description, 'submission source URL');

            Form_Submission__c s1 = [SELECT Status__c, Target_Record_Id__c, Action_Results_JSON__c FROM Form_Submission__c WHERE Id = :sub1];
            Assert.areEqual('Processed', s1.Status__c);
            Assert.areEqual(c.Id, s1.Target_Record_Id__c, 'the case is the main record');
            List<Object> results = (List<Object>) JSON.deserializeUntyped(s1.Action_Results_JSON__c);
            Assert.areEqual(4, results.size());
            Assert.areEqual('created', ((Map<String, Object>) results[0]).get('outcome'));
            Assert.areEqual('created', ((Map<String, Object>) results[3]).get('outcome'));

            // Same person again, low priority: records are reused, no task.
            Id sub2 = JFormPublicController.submit(key, JSON.serialize(answers('Low')));
            Assert.areEqual(1, [SELECT COUNT() FROM Account WHERE Name = 'Analytical Engines']);
            Assert.areEqual(1, [SELECT COUNT() FROM Contact WHERE Email = 'ada@example.com']);
            Assert.areEqual(2, [SELECT COUNT() FROM Case WHERE ContactId = :con.Id]);
            Assert.areEqual(1, [SELECT COUNT() FROM Task]);
            Form_Submission__c s2 = [SELECT Action_Results_JSON__c FROM Form_Submission__c WHERE Id = :sub2];
            List<Object> r2 = (List<Object>) JSON.deserializeUntyped(s2.Action_Results_JSON__c);
            Assert.areEqual('found', ((Map<String, Object>) r2[0]).get('outcome'));
            Assert.areEqual('found', ((Map<String, Object>) r2[1]).get('outcome'));
            Assert.areEqual('created', ((Map<String, Object>) r2[2]).get('outcome'));
            Assert.areEqual('skipped', ((Map<String, Object>) r2[3]).get('outcome'));
        }
    }

    @IsTest
    static void findOrCreateCanUpdateTheFoundRecord() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, Object> lead = step('lead', 'Lead', 'find_or_create', 'Lead', mapping('Email', src('field', 'email', null)), new List<Object>{
                mapping('LastName', src('field', 'last_name', null)), mapping('Company', src('field', 'company', null)),
                mapping('Email', src('field', 'email', null)), mapping('Description', src('field', 'description', null))
            });
            lead.put('updateExisting', true);
            Id formId = publish(supportForm(new List<Object>{ lead }));
            String key = keyOf(formId);

            JFormPublicController.submit(key, JSON.serialize(answers('Low')));
            Map<String, Object> second = answers('Low');
            second.put('description', 'Second message');
            Id sub2 = JFormPublicController.submit(key, JSON.serialize(second));

            List<Lead> leads = [SELECT Description FROM Lead WHERE Email = 'ada@example.com'];
            Assert.areEqual(1, leads.size(), 'one lead');
            Assert.areEqual('Second message', leads[0].Description, 'updated in place');
            Assert.isTrue([SELECT Action_Results_JSON__c FROM Form_Submission__c WHERE Id = :sub2].Action_Results_JSON__c.contains('"updated"'));
        }
    }

    @IsTest
    static void anyFailureRollsBackEveryStep() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, Object> contact = step('contact', 'Contact', 'find_or_create', 'Contact', mapping('Email', src('field', 'email', null)), new List<Object>{
                mapping('LastName', src('field', 'last_name', null)), mapping('Email', src('field', 'email', null))
            });
            Map<String, Object> broken = step('account', 'Account without a name', 'create', 'Account', null, new List<Object>{
                mapping('Description', src('field', 'description', null))
            });
            Id formId = publish(supportForm(new List<Object>{ contact, broken }));

            Id subId = JFormPublicController.submit(keyOf(formId), JSON.serialize(answers('Low')));

            Form_Submission__c s = [SELECT Status__c, Error_Message__c, Target_Record_Id__c FROM Form_Submission__c WHERE Id = :subId];
            Assert.areEqual('Error', s.Status__c);
            Assert.isTrue(s.Error_Message__c.startsWith('Step 2 (Account without a name):'), s.Error_Message__c);
            Assert.isNull(s.Target_Record_Id__c);
            Assert.areEqual(0, [SELECT COUNT() FROM Contact WHERE Email = 'ada@example.com'], 'step 1 rolled back');
            Assert.areEqual(1, [SELECT COUNT() FROM Submission_Field_Value__c WHERE Form_Submission__c = :subId AND Field_Key__c = 'email'], 'answers kept');
        }
    }

    @IsTest
    static void findStepsCanBeRequiredOrOptional() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, Object> find = step('contact', 'Find the contact', 'find', 'Contact', mapping('Email', src('field', 'email', null)), new List<Object>());
            Map<String, Object> task = step('task', 'Follow up', 'create', 'Task', null, new List<Object>{
                mapping('Subject', src('value', 'Follow up {{first_name}}', null)), mapping('WhoId', src('step', 'contact', 'Id'))
            });
            Id optionalForm = publish(supportForm(new List<Object>{ find, task }));
            Id subA = JFormPublicController.submit(keyOf(optionalForm), JSON.serialize(answers('Low')));
            Form_Submission__c a = [SELECT Status__c, Action_Results_JSON__c FROM Form_Submission__c WHERE Id = :subA];
            Assert.areEqual('Processed', a.Status__c);
            Assert.isTrue(a.Action_Results_JSON__c.contains('"not_found"'), a.Action_Results_JSON__c);
            Task t = [SELECT WhoId, Subject FROM Task WHERE Subject = 'Follow up Ada'];
            Assert.isNull(t.WhoId, 'missing record leaves the lookup empty');

            Map<String, Object> required = find.clone();
            required.put('required', true);
            Id requiredForm = publish(supportForm(new List<Object>{ required, task }));
            Id subB = JFormPublicController.submit(keyOf(requiredForm), JSON.serialize(answers('Low')));
            Form_Submission__c b = [SELECT Status__c, Error_Message__c FROM Form_Submission__c WHERE Id = :subB];
            Assert.areEqual('Error', b.Status__c);
            Assert.isTrue(b.Error_Message__c.contains('no Contact found'), b.Error_Message__c);
        }
    }

    @IsTest
    static void validationChecksAccessAndShapes() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, Object> empty = step('lead', 'Lead', 'create', 'Lead', null, new List<Object>());
            Map<String, Object> readOnly = step('lead2', 'Lead2', 'create', 'Lead', null, new List<Object>{ mapping('CreatedDate', src('value', '2026-01-01', null)) });
            Map<String, Object> blocked = step('usr', 'User', 'find', 'User', mapping('Email', src('field', 'email', null)), new List<Object>());
            Map<String, Object> longText = step('lead3', 'Lead3', 'find_or_create', 'Lead', mapping('Description', src('field', 'description', null)), new List<Object>{ mapping('LastName', src('field', 'last_name', null)) });
            Map<String, Object> badPath = step('task', 'Task', 'create', 'Task', null, new List<Object>{ mapping('WhoId', src('step', 'lead3', 'Nope__c')), mapping('Subject', src('value', 'x', null)) });
            String all = String.join(JFormAutomationService.validate(supportForm(new List<Object>{ empty, readOnly, blocked, longText, badPath })), ' | ');
            Assert.isTrue(all.contains('map at least one answer to a Lead field'), all);
            Assert.isTrue(all.contains('"CreatedDate" cannot be set when creating Lead records'), all);
            Assert.isTrue(all.contains('User records cannot be created or updated by a form'), all);
            Assert.isTrue(all.contains('match field "Description" cannot be used to find records'), all);
            Assert.isTrue(all.contains('"Nope__c" is not on Lead (step "lead3")'), all);
            Assert.isFalse(all.contains('"LastName"'), 'a createable field passes: ' + all);
        }
    }

    @IsTest
    static void validationCatchesBrokenSteps() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, Object> later = step('task', 'Task', 'create', 'Task', null, new List<Object>{ mapping('WhoId', src('step', 'contact', 'Id')) });
            Map<String, Object> contact = step('contact', 'Contact', 'find_or_create', 'Contact', null, new List<Object>{ mapping('Nope__c', src('field', 'email', null)), mapping('LastName', src('field', 'missing', null)) });
            Map<String, Object> dup = step('contact', 'Again', 'explode', 'Nothing__c', null, new List<Object>());
            List<String> problems = JFormAutomationService.validate(supportForm(new List<Object>{ later, contact, dup }));
            String all = String.join(problems, ' | ');
            Assert.isTrue(all.contains('earlier steps'), all);
            Assert.isTrue(all.contains('choose a field to match'), all);
            Assert.isTrue(all.contains('"Nope__c" is not on Contact'), all);
            Assert.isTrue(all.contains('form field "missing" does not exist'), all);
            Assert.isTrue(all.contains('duplicate key'), all);
            Assert.isTrue(all.contains('unknown action "explode"'), all);
            Assert.isTrue(all.contains('object "Nothing__c" was not found'), all);
            try {
                JFormDefinitionService.create(supportForm(new List<Object>{ later }));
                Assert.fail('saving broken steps must fail');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('earlier steps'), e.getMessage());
            }
            Assert.isTrue(JFormAutomationService.validate(supportForm(supportSteps())).isEmpty(), 'good steps validate');
            Assert.isTrue(JFormAutomationService.validate(supportForm(new List<Object>())).isEmpty(), 'no steps is fine');
        }
    }

    @IsTest
    static void interpolationAndParsing() {
        Map<String, Object> answers = new Map<String, Object>{ 'subject' => 'Hi', 'tags' => new List<Object>{ 'a', 'b' } };
        Assert.areEqual('Re: Hi [a; b] ', JFormAutomationService.interpolate('Re: {{subject}} [{{ tags }}] {{missing}}', answers));
        Assert.areEqual('plain', JFormAutomationService.interpolate('plain', answers));
        Assert.isNull(JFormAutomationService.interpolate(null, answers));
        JFormDefinition.Form def = supportForm(supportSteps());
        List<JFormAutomationService.Step> steps = JFormAutomationService.steps(def);
        Assert.areEqual(4, steps.size());
        Assert.areEqual('find_or_create', steps[0].action);
        Assert.areEqual('Email', steps[1].match.field);
        Assert.isTrue(steps[2].primary);
        Assert.areEqual(1, steps[3].condition.conditions.size());
        Assert.isTrue(JFormAutomationService.steps(new JFormDefinition.Form()).isEmpty());
    }

    @IsTest
    static void legacyTargetsBecomeStepsAndCanBeRetargeted() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            // explicit per-field mappings with update_or_create
            JFormDefinition.Form def = supportForm(new List<Object>());
            def.settings = new Map<String, Object>{ 'target' => new Map<String, Object>{ 'strategy' => 'update_or_create', 'matchField' => 'Email' } };
            def.targetObjectApiName = 'Lead';
            def.fieldsByKey().get('email').targetFieldApiName = 'Email';
            def.fieldsByKey().get('last_name').targetFieldApiName = 'LastName';
            def.fieldsByKey().get('company').targetFieldApiName = 'Company';
            JFormDefinition.Form saved = JFormDefinitionService.create(def);
            List<JFormAutomationService.Step> steps = JFormAutomationService.steps(saved);
            Assert.areEqual(1, steps.size());
            Assert.areEqual('find_or_create', steps[0].action);
            Assert.areEqual('Email', steps[0].match.field);
            Assert.isTrue(steps[0].updateExisting);
            Assert.areEqual(3, steps[0].fields.size());
            Assert.isNull(saved.fieldsByKey().get('email').targetFieldApiName, 'legacy mapping cleared');
            Assert.isFalse(saved.settings.containsKey('target'));
            Assert.areEqual('Lead', saved.targetObjectApiName);

            // retarget the main step: mappings that exist on the new object survive
            JFormAutomationService.retarget(saved, 'Contact');
            saved = JFormDefinitionService.save(saved);
            steps = JFormAutomationService.steps(saved);
            Assert.areEqual('Contact', steps[0].objectApiName);
            Assert.areEqual('Contact', saved.targetObjectApiName);
            Assert.areEqual(2, steps[0].fields.size(), 'Company is not on Contact');
            Assert.areEqual('find_or_create', steps[0].action, 'Email exists on Contact, match kept');

            // a bare object name is matched by name
            JFormDefinition.Form bare = supportForm(new List<Object>());
            bare.settings = null;
            bare.targetObjectApiName = 'Lead';
            JFormDefinition.Form savedBare = JFormDefinitionService.create(bare);
            JFormAutomationService.Step auto = JFormAutomationService.steps(savedBare)[0];
            Assert.areEqual('create', auto.action, 'a bare target never updates existing records on its own');
            Assert.isNull(auto.match);
            Set<String> mapped = new Set<String>();
            for (JFormAutomationService.Mapping m : auto.fields) {
                mapped.add(m.field);
            }
            Assert.isTrue(mapped.containsAll(new Set<String>{ 'FirstName', 'LastName', 'Email', 'Company', 'Description' }), String.join(new List<String>(mapped), ','));

            // dropping a field removes every reference to it
            JFormAutomationService.dropReferences(savedBare, 'email');
            auto = JFormAutomationService.steps(savedBare)[0];
            Assert.areEqual('create', auto.action);
            Assert.isNull(auto.match);
            for (JFormAutomationService.Mapping m : auto.fields) {
                Assert.areNotEqual('email', m.source.key);
            }

            // strategy none means no records
            JFormDefinition.Form none = supportForm(new List<Object>());
            none.settings = new Map<String, Object>{ 'target' => new Map<String, Object>{ 'strategy' => 'none' } };
            none.targetObjectApiName = 'Lead';
            JFormDefinition.Form savedNone = JFormDefinitionService.create(none);
            Assert.isTrue(JFormAutomationService.steps(savedNone).isEmpty());
            Assert.isNull(savedNone.targetObjectApiName);
        }
    }

    // ------------------------------------------------------------ flow steps

    /** A flow tests pretend is in the org: three inputs a form can fill, a record input it cannot, one output. */
    private static JFormAutomationService.FlowInfo welcomeFlow() {
        JFormAutomationService.FlowInfo f = new JFormAutomationService.FlowInfo();
        f.apiName = 'Welcome_Pack';
        f.label = 'Welcome pack';
        f.variables.add(JFormAutomationService.flowVar('email', 'String', null, true, false, false, null));
        f.variables.add(JFormAutomationService.flowVar('vip', 'Boolean', null, true, false, false, null));
        f.variables.add(JFormAutomationService.flowVar('contactId', 'String', null, true, false, false, null));
        f.variables.add(JFormAutomationService.flowVar('contactRecord', 'SObject', 'Contact', true, false, false, null));
        f.variables.add(JFormAutomationService.flowVar('ticket', 'String', null, false, true, false, null));
        return f;
    }
    private class FakeRunner implements JFormAutomationService.FlowRunner {
        public String flowApiName;
        public Map<String, Object> inputs;
        public Boolean fail = false;
        public Map<String, Object> run(String flowApiName, Map<String, Object> inputs, List<String> outputs) {
            this.flowApiName = flowApiName;
            this.inputs = inputs;
            if (fail) {
                throw new JFormAutomationService.AutomationException('the flow hit a fault');
            }
            return new Map<String, Object>{ 'Ticket' => 'T-' + inputs.get('email') }; // a different case than the step asks for
        }
    }
    private static FakeRunner useFakeFlows(Boolean canUse) {
        JFormAutomationService.testFlows = new Map<String, JFormAutomationService.FlowInfo>{ 'Welcome_Pack' => welcomeFlow() };
        JFormAutomationService.testCanUseFlows = canUse;
        FakeRunner runner = new FakeRunner();
        JFormAutomationService.flowRunner = runner;
        return runner;
    }
    private static Map<String, Object> input(String name, String type, Map<String, Object> source) {
        return new Map<String, Object>{ 'field' => name, 'type' => type, 'source' => source };
    }
    private static Map<String, Object> flowStep(String key, List<Object> inputs) {
        return new Map<String, Object>{
            'key' => key, 'label' => 'Welcome pack', 'action' => 'flow', 'flow' => 'Welcome_Pack', 'fields' => inputs,
            'outputs' => new List<Object>{ new Map<String, Object>{ 'name' => 'ticket', 'type' => 'String' } }
        };
    }
    /** Contact, then the flow (given the email, a fixed VIP flag and the contact), then a Task named after the flow's ticket. */
    private static List<Object> flowSteps() {
        Map<String, Object> contact = step('contact', 'Contact', 'find_or_create', 'Contact', mapping('Email', src('field', 'email', null)),
            new List<Object>{ mapping('LastName', src('field', 'last_name', null)), mapping('Email', src('field', 'email', null)) });
        Map<String, Object> flow = flowStep('welcome', new List<Object>{
            input('email', 'String', src('field', 'email', null)),
            input('vip', 'Boolean', src('value', 'yes', null)),
            input('contactId', 'String', src('step', 'contact', 'Id'))
        });
        Map<String, Object> task = step('task', 'Task', 'create', 'Task', null, new List<Object>{
            mapping('Subject', src('step', 'welcome', 'ticket')), mapping('WhoId', src('step', 'contact', 'Id'))
        });
        return new List<Object>{ contact, flow, task };
    }

    @IsTest
    static void flowStepGetsConvertedInputsAndFeedsLaterSteps() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            FakeRunner runner = useFakeFlows(true);
            Assert.isTrue(JFormAutomationService.validate(supportForm(flowSteps())).isEmpty(), String.join(JFormAutomationService.validate(supportForm(flowSteps())), ' | '));
            Id formId = publish(supportForm(flowSteps()));
            Id subId = JFormPublicController.submit(keyOf(formId), JSON.serialize(answers('Low')));

            Contact con = [SELECT Id FROM Contact WHERE Email = 'ada@example.com'];
            Assert.areEqual('Welcome_Pack', runner.flowApiName);
            Assert.areEqual('ada@example.com', runner.inputs.get('email'));
            Assert.areEqual(true, runner.inputs.get('vip'), 'yes becomes a Boolean');
            Assert.areEqual(String.valueOf(con.Id), runner.inputs.get('contactId'), 'the contact from step 1, as Text');
            Task t = [SELECT Subject, WhoId FROM Task];
            Assert.areEqual('T-ada@example.com', t.Subject, 'the flow output, whatever its case');
            Assert.areEqual(con.Id, t.WhoId);

            Form_Submission__c sub = [SELECT Status__c, Target_Record_Id__c, Action_Results_JSON__c FROM Form_Submission__c WHERE Id = :subId];
            Assert.areEqual('Processed', sub.Status__c);
            Assert.areEqual(con.Id, sub.Target_Record_Id__c, 'a flow step is never the main record');
            List<Object> results = (List<Object>) JSON.deserializeUntyped(sub.Action_Results_JSON__c);
            Assert.areEqual('ran', ((Map<String, Object>) results[1]).get('outcome'));
            Assert.areEqual('Welcome_Pack', ((Map<String, Object>) results[1]).get('flowApiName'));
        }
    }

    @IsTest
    static void aFailingFlowRollsBackEveryStep() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            FakeRunner runner = useFakeFlows(true);
            Id formId = publish(supportForm(flowSteps()));
            runner.fail = true;
            Id subId = JFormPublicController.submit(keyOf(formId), JSON.serialize(answers('Low')));
            Form_Submission__c sub = [SELECT Status__c, Error_Message__c FROM Form_Submission__c WHERE Id = :subId];
            Assert.areEqual('Error', sub.Status__c);
            Assert.isTrue(sub.Error_Message__c.contains('Step 2 (Welcome pack): the flow hit a fault'), sub.Error_Message__c);
            Assert.areEqual(0, [SELECT COUNT() FROM Contact WHERE Email = 'ada@example.com'], 'the contact from step 1 is rolled back');
        }
    }

    @IsTest
    static void validationChecksFlowSteps() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            useFakeFlows(true);
            Map<String, Object> none = flowStep('none', new List<Object>());
            none.remove('flow');
            Map<String, Object> unknown = flowStep('unknown', new List<Object>());
            unknown.put('flow', 'Nope');
            Map<String, Object> bad = flowStep('bad', new List<Object>{
                input('nope', 'String', src('value', 'x', null)),
                input('contactRecord', 'SObject', src('value', 'x', null)),
                input('vip', 'String', src('value', 'yes', null))
            });
            Map<String, Object> later = step('task', 'Task', 'create', 'Task', null, new List<Object>{ mapping('Subject', src('step', 'bad', 'missing')) });
            String all = String.join(JFormAutomationService.validate(supportForm(new List<Object>{ none, unknown, bad, later })), ' | ');
            Assert.isTrue(all.contains('choose a flow to run'), all);
            Assert.isTrue(all.contains('flow "Nope" is not an active autolaunched flow'), all);
            Assert.isTrue(all.contains('"nope" is not an input of the flow Welcome pack'), all);
            Assert.isTrue(all.contains('input "contactRecord" is a Contact record, which a form cannot fill yet'), all);
            Assert.isTrue(all.contains('input "vip" is now True/false in the flow'), all);
            Assert.isTrue(all.contains('"missing" is not an output of the flow in step "bad"'), all);
        }
    }

    @IsTest
    static void onlyManageFlowCanAddOrChangeAFlowStep() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            useFakeFlows(false);
            try {
                JFormDefinitionService.create(supportForm(flowSteps()));
                Assert.fail('a builder without Manage Flow cannot add a flow step');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('Manage Flow'), e.getMessage());
            }
            JFormAutomationService.testCanUseFlows = true;
            JFormDefinition.Form saved = JFormDefinitionService.create(supportForm(flowSteps()));

            // someone without the permission can still edit the rest of the form
            JFormAutomationService.testCanUseFlows = false;
            saved.label = 'Renamed';
            saved = JFormDefinitionService.save(saved);
            Assert.areEqual('Renamed', saved.label);

            // ...but not what the flow is given
            List<Object> steps = (List<Object>) ((Map<String, Object>) saved.settings.get('automation')).get('steps');
            Map<String, Object> flow = (Map<String, Object>) steps[1];
            ((List<Object>) flow.get('fields')).add(input('email', 'String', src('field', 'company', null)));
            try {
                JFormDefinitionService.save(saved);
                Assert.fail('changing the inputs needs Manage Flow');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('Step 2 (Welcome pack): only people with the Manage Flow permission'), e.getMessage());
            }
        }
    }

    @IsTest
    static void flowValuesTypesAndMainRecord() {
        Assert.areEqual(12.5, JFormAutomationService.coerceFlow('Number', '12.5'));
        Assert.areEqual(true, JFormAutomationService.coerceFlow('Boolean', 'yes'));
        Assert.areEqual(false, JFormAutomationService.coerceFlow('Boolean', 'no'));
        Assert.areEqual(Date.newInstance(2026, 3, 14), JFormAutomationService.coerceFlow('Date', '2026-03-14'));
        Assert.areEqual(Datetime.newInstanceGmt(2026, 3, 14, 9, 30, 0), JFormAutomationService.coerceFlow('DateTime', '2026-03-14T09:30:00Z'));
        Assert.areEqual('a;b', JFormAutomationService.coerceFlow('Multipicklist', 'a; b'));
        Assert.areEqual('5', JFormAutomationService.coerceFlow('String', 5));
        Assert.isNull(JFormAutomationService.coerceFlow('Number', 'abc'));
        Assert.isNull(JFormAutomationService.coerceFlow('String', ' '));

        JFormAutomationService.FlowVar record = JFormAutomationService.flowVar('c', 'SObject', 'Contact', true, false, false, null);
        Assert.areEqual('a Contact record', record.typeLabel);
        Assert.isFalse(record.supported);
        JFormAutomationService.FlowVar texts = JFormAutomationService.flowVar('t', 'String', null, true, false, true, null);
        Assert.areEqual('a list of Text', texts.typeLabel);
        Assert.isFalse(texts.supported);
        Assert.isTrue(JFormAutomationService.flowVar('n', 'Number', null, true, false, false, null).supported);

        JFormDefinition.Form onlyFlow = supportForm(new List<Object>{ flowStep('welcome', new List<Object>()) });
        Assert.isNull(JFormAutomationService.mainStep(JFormAutomationService.steps(onlyFlow)), 'a flow is never the main record');
        Map<String, Object> find = step('contact', 'Contact', 'find', 'Contact', mapping('Email', src('field', 'email', null)), new List<Object>());
        JFormDefinition.Form flowThenFind = supportForm(new List<Object>{ flowStep('welcome', new List<Object>()), find });
        Assert.areEqual('contact', JFormAutomationService.mainStep(JFormAutomationService.steps(flowThenFind)).key);
    }

    @IsTest
    static void realFlowLookupsAnswerWithoutTestFlows() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormAutomationService.FlowInfo> flows = JFormAutomationService.listFlows();
            Assert.isNotNull(flows);
            if (!flows.isEmpty()) {
                // any org flow will do: reads its variables the way the step editor does
                JFormAutomationService.FlowInfo first = JFormAutomationService.flowInfo(flows[0].apiName);
                Assert.areEqual(flows[0].apiName, first.apiName);
                for (JFormAutomationService.FlowVar v : first.variables) {
                    Assert.isTrue(v.isInput || v.isOutput, v.name);
                }
            }
            Assert.isNull(JFormAutomationService.flowInfo('Definitely_Not_A_JForm_Flow'));
            Assert.isFalse(JFormAutomationService.canUseFlows(), 'the test builder has no Manage Flow');
            try {
                new JFormAutomationService.InterviewRunner().run('Definitely_Not_A_JForm_Flow', new Map<String, Object>(), new List<String>());
                Assert.fail('an unknown flow cannot start');
            } catch (Exception e) {
                Assert.isNotNull(e.getMessage());
            }
        }
    }
}
