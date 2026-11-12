@IsTest
private class JFormWorkspaceControllerTest {

    @IsTest
    static void loadSavePublishRoundTrip() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form created = JFormTestDataFactory.createSampleForm('Workspace');

            String json = JFormWorkspaceController.getDefinition(created.id);
            JFormDefinition.Form def = JFormDefinition.parse(json);
            Assert.areEqual('Workspace', def.name);

            def.label = 'Workspace label';
            def.sections[0].fields[1].label = 'Given name';
            String savedJson = JFormWorkspaceController.saveDefinition(def.serialize(), null);
            JFormDefinition.Form saved = JFormDefinition.parse(savedJson);
            Assert.areEqual('Workspace label', saved.label);
            Assert.areEqual('Given name', saved.fieldsByKey().get('first_name').label);

            JFormPublishService.PublishResult pub = JFormWorkspaceController.publish(created.id, 'go live', null);
            Assert.areEqual(1, pub.versionNumber);
            Assert.isNotNull(pub.publicKey);

            List<JFormWorkspaceController.FormListItem> forms = JFormWorkspaceController.listForms();
            Boolean found = false;
            for (JFormWorkspaceController.FormListItem i : forms) {
                if (i.id == created.id) {
                    found = true;
                    Assert.areEqual('Active', i.status);
                    Assert.areEqual(pub.publicKey, i.publicKey);
                }
            }
            Assert.isTrue(found, 'form listed');

            JFormPublishService.PublishResult off = JFormWorkspaceController.unpublish(created.id, null);
            Assert.areEqual('Inactive', off.status);
        }
    }

    @IsTest
    static void listsSalesforceTimeZones() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, String> labels = new Map<String, String>();
            for (JFormWorkspaceController.TargetObject zone : JFormWorkspaceController.getTimeZones()) {
                labels.put(zone.value, zone.label);
            }
            Assert.isTrue(labels.containsKey('America/Los_Angeles'), 'the forms\' time zones are Salesforce\'s');
            Assert.isTrue(labels.get('America/Los_Angeles').contains('America/Los_Angeles'), labels.get('America/Los_Angeles'));
        }
    }

    @IsTest
    static void createAndClone() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormChangeEvents.published.clear();
            JFormDefinition.Form blank = JFormDefinition.parse(JFormWorkspaceController.createForm('Blank', 'Lead', 'tab-new'));
            Assert.areEqual('tab-new', JFormChangeEvents.published[JFormChangeEvents.published.size() - 1].Client_Id__c, 'the creating tab is named on the event, so it ignores its own new form');
            Assert.isNotNull(blank.id);
            Assert.areEqual(1, blank.sections.size(), 'starts with one page');
            Assert.areEqual('Lead', blank.targetObjectApiName);
            // a Lead form starts with the fields a Lead cannot be created without, each saved to its Lead field
            Map<String, String> savedTo = new Map<String, String>();
            Map<String, Object> automation = (Map<String, Object>) blank.settings.get('automation');
            for (Object o : (List<Object>) ((Map<String, Object>) ((List<Object>) automation.get('steps'))[0]).get('fields')) {
                Map<String, Object> m = (Map<String, Object>) o;
                savedTo.put(String.valueOf(m.get('field')).toLowerCase(), String.valueOf(((Map<String, Object>) m.get('source')).get('key')));
            }
            Assert.isTrue(savedTo.containsKey('lastname'), 'Last Name is on the form and mapped: ' + savedTo);
            Assert.isTrue(blank.fieldsByKey().get(savedTo.get('lastname')).required, 'and required');
            Assert.areEqual(0, JFormDefinition.parse(JFormWorkspaceController.createForm('No target', null, null)).fieldCount(), 'without a target object the form starts empty');

            JFormDefinition.Form source = JFormTestDataFactory.createSampleForm('Clone source');
            JFormDefinition.Form copy = JFormDefinition.parse(JFormWorkspaceController.cloneForm(source.id, 'Clone copy', null));
            Assert.areEqual('Clone copy', copy.name);
            Assert.areEqual(source.fieldCount(), copy.fieldCount());
        }
    }

    @IsTest
    static void describeHelpers() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormWorkspaceController.TargetObject> objects = JFormWorkspaceController.getTargetObjects();
            Assert.isFalse(objects.isEmpty());
            Boolean hasLead = false;
            for (JFormWorkspaceController.TargetObject o : objects) {
                if (o.value == 'lead') {
                    hasLead = true;
                }
            }
            Assert.isTrue(hasLead, 'Lead is offered as a target');

            List<JFormWorkspaceController.FieldOption> fields = JFormWorkspaceController.getObjectFields('Lead');
            JFormWorkspaceController.FieldOption email;
            JFormWorkspaceController.FieldOption lastName;
            for (JFormWorkspaceController.FieldOption f : fields) {
                if (f.value == 'Email') {
                    email = f;
                }
                if (f.value == 'LastName') {
                    lastName = f;
                }
            }
            Assert.isNotNull(email);
            Assert.areEqual('email', email.type);
            Assert.isNotNull(lastName);
            Assert.isTrue(lastName.required, 'LastName is required on Lead');
        }
    }

    @IsTest
    static void errorsBecomeAuraHandled() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            String message;
            try {
                JFormWorkspaceController.saveDefinition('{"name":"x"}', null);
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'save without id fails cleanly');
            message = null;
            try {
                JFormWorkspaceController.getObjectFields('No_Such_Object__c');
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'unknown object fails cleanly');
        }
    }

    @IsTest
    static void promotionCodesAreManagedFromTheSettingsTab() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Codes');
            def.settings.put('payments', new Map<String, Object>{ 'currency' => 'EUR', 'codes' => 'jform' });
            Id formId = JFormDefinitionService.create(def).id;

            JFormPromotionCodeService.Summary saved = JFormWorkspaceController.savePromotionCode(formId, '{"code":"welcome","discountType":"Amount","amountOff":5,"maxUses":10,"note":"Launch"}');
            Assert.areEqual('WELCOME', saved.code);
            Assert.areEqual('EUR', saved.currencyCode);
            Assert.areEqual(5.00, saved.amountOff);
            List<JFormPromotionCodeService.Summary> made = JFormWorkspaceController.generatePromotionCodes(formId, '{"count":3,"prefix":"vip","discountType":"Percent","percentOff":50}');
            Assert.areEqual(3, made.size());
            Assert.isTrue(made[0].code.startsWith('VIP-'), made[0].code);
            List<JFormPromotionCodeService.Summary> listed = JFormWorkspaceController.listPromotionCodes(formId);
            Assert.areEqual(4, listed.size());
            String csv = JFormWorkspaceController.exportPromotionCodes(formId);
            Assert.areEqual(5, csv.split('\n').size());
            Assert.isTrue(csv.contains('WELCOME,5.00 EUR,,,10,0,Active,Launch'), csv);
            JFormWorkspaceController.deletePromotionCode(formId, saved.id);
            Assert.areEqual(3, JFormWorkspaceController.listPromotionCodes(formId).size());

            String message;
            try {
                JFormWorkspaceController.savePromotionCode(formId, '{"code":"x","discountType":"Percent","percentOff":10}');
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.areEqual('A code has 3 to 40 letters, digits or hyphens.', message);
            message = null;
            try {
                JFormWorkspaceController.generatePromotionCodes(formId, '{"count":0,"discountType":"Percent","percentOff":10}');
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.areEqual('Generate between 1 and 500 codes.', message);
            message = null;
            try {
                JFormWorkspaceController.savePromotionCode(formId, 'not json');
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'bad input fails cleanly');
        }
    }

    private class OneReply implements JFormGenerationService.Client {
        public String generate(String modelName, String prompt) {
            return '[{"label":"Email","type":"email","required":true},{"label":"Preferred date","type":"date"}]';
        }
    }

    @IsTest
    static void describeAndCreateDescribedForm() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormGenerationService.client = new OneReply();
            Map<String, Object> status = JFormWorkspaceController.getGenerationStatus();
            Assert.areEqual(true, status.get('available'));
            Assert.areEqual(JFormGenerationService.DEFAULT_MODEL, status.get('model'));

            Map<String, Object> draft = (Map<String, Object>) JSON.deserializeUntyped(JFormWorkspaceController.describeForm('Email and a date', 'Described', null));
            Assert.areEqual(2, draft.get('fieldCount'));
            Assert.isTrue(String.valueOf(draft.get('definitionJson')).contains('"type":"email"'));

            JFormDefinition.Form saved = JFormDefinition.parse(JFormWorkspaceController.createDescribedForm(String.valueOf(draft.get('definitionJson')), 'Contact', null));
            Assert.isNotNull(saved.id);
            Assert.areEqual('Contact', saved.targetObjectApiName);
            Assert.areEqual(2, saved.sections[0].fields.size());

            JFormGenerationService.configOverride = new AI_Settings__c(Disabled__c = true);
            try {
                JFormWorkspaceController.describeForm('x', 'y', null);
                Assert.fail('expected an AuraHandledException');
            } catch (AuraHandledException e) {
                Assert.areEqual(JFormGenerationService.UNAVAILABLE, e.getMessage(), 'the message survives the Aura wrapper');
            }
            try {
                JFormWorkspaceController.createDescribedForm('', null, null);
                Assert.fail('expected an AuraHandledException');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('no draft'), e.getMessage());
            }
        }
    }

    @IsTest
    static void staleSavesAreMarkedAsConflicts() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Conflict');
            String copy = def.serialize();
            JFormChangeEvents.published.clear();
            JFormWorkspaceController.saveDefinition(def.serialize(), 'tab-a');
            Assert.areEqual('tab-a', JFormChangeEvents.published[0].Client_Id__c, 'the saving tab is named on the event');
            try {
                JFormWorkspaceController.saveDefinition(copy, 'tab-b');
                Assert.fail('expected a conflict');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().startsWith(JFormWorkspaceController.CONFLICT_PREFIX), e.getMessage());
            }
        }
    }

    @IsTest
    static void flowCatalogIsOnlyListedForManageFlow() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormAutomationService.FlowInfo f = new JFormAutomationService.FlowInfo();
            f.apiName = 'Welcome_Pack';
            f.label = 'Welcome pack';
            f.variables.add(JFormAutomationService.flowVar('email', 'String', null, true, false, false, null));
            JFormAutomationService.testFlows = new Map<String, JFormAutomationService.FlowInfo>{ 'Welcome_Pack' => f };

            JFormAutomationService.testCanUseFlows = false;
            JFormWorkspaceController.FlowCatalog none = JFormWorkspaceController.getFlows();
            Assert.isFalse(none.canUseFlows);
            Assert.isTrue(none.flows.isEmpty());

            JFormAutomationService.testCanUseFlows = true;
            JFormWorkspaceController.FlowCatalog some = JFormWorkspaceController.getFlows();
            Assert.isTrue(some.canUseFlows);
            Assert.areEqual('Welcome_Pack', some.flows[0].apiName);
            Assert.areEqual('email', JFormWorkspaceController.getFlowDetails('Welcome_Pack').variables[0].name);
            try {
                JFormWorkspaceController.getFlowDetails('Nope');
                Assert.fail('an unknown flow is an error');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('Nope'), e.getMessage());
            }
        }
    }
}
