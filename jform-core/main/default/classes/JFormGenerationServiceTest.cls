@IsTest
private class JFormGenerationServiceTest {

    /** Scripted model: returns the queued replies in order and records the prompts it was given. */
    private class StubClient implements JFormGenerationService.Client {
        List<String> replies = new List<String>();
        List<String> prompts = new List<String>();
        List<String> models = new List<String>();
        StubClient(List<String> replies) {
            this.replies = replies;
        }
        public String generate(String modelName, String prompt) {
            models.add(modelName);
            prompts.add(prompt);
            return replies.isEmpty() ? '' : replies.remove(0);
        }
    }

    private static final String GOOD = '{"sections":[{"name":"Contact details","fields":['
        + '{"label":"First name","type":"text","required":true,"width":50},'
        + '{"label":"Last name","type":"text","required":true,"width":50},'
        + '{"label":"Email","type":"email","required":true}]},'
        + '{"name":"Booking","fields":['
        + '{"label":"Preferred date","type":"date","config":{"noPast":true,"disabledDays":[0,6]}},'
        + '{"label":"Store","type":"dropdown","options":["London","Leeds"]},'
        + '{"label":"How will you get here?","type":"single choice","options":["Driving","Train"]},'
        + '{"label":"Number plate","type":"text","conditionalLogic":{"action":"show","conditions":[{"field":"How will you get here?","operator":"equals","value":"Driving"}]}}]}]}';

    @IsTest
    static void describeTurnsTheReplyIntoAPreviewAndADefinition() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            StubClient stub = new StubClient(new List<String>{ GOOD });
            JFormGenerationService.client = stub;
            JFormGenerationService.configOverride = new AI_Settings__c(Model__c = 'sfdc_ai__DefaultGPT4Omni');

            JFormGenerationService.Draft d = JFormGenerationService.describe('Booking form with name, email, date, store and how they travel', 'Store visit', 'Lead');

            Assert.areEqual(1, stub.prompts.size(), 'one call when the first answer parses');
            Assert.areEqual('sfdc_ai__DefaultGPT4Omni', stub.models[0], 'the configured model is used');
            Assert.isTrue(stub.prompts[0].contains('<description>'), 'the description is wrapped as data');
            Assert.isTrue(stub.prompts[0].contains('Lead records'), 'the target object steers labels');
            Assert.areEqual('Store visit', d.name);
            Assert.areEqual('Lead', d.targetObjectApiName);
            Assert.areEqual(2, d.pages.size());
            Assert.areEqual(7, d.fieldCount);
            Assert.areEqual('Booking', d.pages[1].name);
            JFormGenerationService.FieldPreview store = d.pages[1].fields[1];
            Assert.areEqual('Picklist', store.type, 'aliases are normalised');
            Assert.areEqual('London, Leeds', store.options);
            Assert.isTrue(d.pages[0].fields[2].required);
            Assert.isNotNull(d.pages[1].fields[3].rule, 'rules by label become sentences');
            Assert.isTrue(d.pages[1].fields[3].rule.containsIgnoreCase('Driving'), d.pages[1].fields[3].rule);

            JFormDefinition.Form def = JFormDefinition.parse(d.definitionJson);
            Assert.areEqual('picklist', def.fieldsByKey().get('store').fieldType);
            Assert.isNotNull(def.fieldsByKey().get('number_plate').conditionalLogic, 'the rule references the field key after parsing');
            Assert.areEqual(true, def.fieldsByKey().get('preferred_date').config.get('noPast'), 'date limits from the model are kept');
            Assert.isTrue(stub.prompts[0].contains('"disabledDays"'), 'the prompt teaches the date config');
        }
    }

    @IsTest
    static void fencedAndChattyRepliesStillParse() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormGenerationService.client = new StubClient(new List<String>{ 'Here is the form you asked for:\n```json\n' + GOOD + '\n```\nLet me know if you want changes.' });
            JFormGenerationService.Draft d = JFormGenerationService.describe('Booking form', 'Fenced', null);
            Assert.areEqual(7, d.fieldCount);
            Assert.isNull(d.targetObjectApiName);
        }
    }

    @IsTest
    static void aBadFirstAnswerIsRetriedWithTheProblem() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            StubClient stub = new StubClient(new List<String>{ 'Sure! What kind of form?', GOOD });
            JFormGenerationService.client = stub;
            JFormGenerationService.Draft d = JFormGenerationService.describe('Booking form', 'Retry', null);
            Assert.areEqual(2, stub.prompts.size());
            Assert.isTrue(stub.prompts[1].contains('could not be used: No JSON found'), stub.prompts[1].right(200));
            Assert.areEqual(7, d.fieldCount);
        }
    }

    @IsTest
    static void aDeclinedDescriptionIsNotRetried() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            StubClient stub = new StubClient(new List<String>{ '{"error":"not a form"}', GOOD });
            JFormGenerationService.client = stub;
            try {
                JFormGenerationService.describe('asdf', 'Nonsense', null);
                Assert.fail('expected an error');
            } catch (JFormGenerationService.GenerationException e) {
                Assert.areEqual(JFormGenerationService.NOT_UNDERSTOOD, e.getMessage());
            }
            Assert.areEqual(1, stub.prompts.size(), 'a decline is final; the model is not asked again');
            Assert.isTrue(stub.prompts[0].contains('{"error":"not a form"}'), 'the prompt offers the way to decline');
        }
    }

    @IsTest
    static void twoBadAnswersGiveAReadableError() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormGenerationService.client = new StubClient(new List<String>{ 'nope', '{"sections":[{"name":"Empty","fields":[]}]}' });
            try {
                JFormGenerationService.describe('asdf', 'Nonsense', null);
                Assert.fail('expected an error');
            } catch (JFormGenerationService.GenerationException e) {
                Assert.areEqual(JFormGenerationService.NOT_UNDERSTOOD, e.getMessage());
            }
        }
    }

    @IsTest
    static void inputsAndAvailabilityAreChecked() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormGenerationService.client = new StubClient(new List<String>{ GOOD });
            expectError(null, 'Name', null, 'Describe the form');
            expectError('x', '', null, 'name first');
            expectError('x'.repeat(2001), 'Name', null, 'under 2000');
            JFormGenerationService.configOverride = new AI_Settings__c(Disabled__c = true);
            Assert.isFalse(JFormGenerationService.isAvailable());
            expectError('Booking form', 'Name', null, JFormGenerationService.UNAVAILABLE);
            JFormGenerationService.configOverride = new AI_Settings__c();
            Assert.isTrue(JFormGenerationService.isAvailable(), 'a stub client counts as available');
            Assert.areEqual(JFormGenerationService.DEFAULT_MODEL, JFormGenerationService.modelName());
            // limits on what comes back
            try {
                JFormGenerationService.parseReply('[' + '{"label":"F","type":"text"},'.repeat(41).removeEnd(',') + ']', 'Big');
                Assert.fail('expected a field-count error');
            } catch (JFormGenerationService.GenerationException e) {
                Assert.isTrue(e.getMessage().contains('more than 40'), e.getMessage());
            }
            Assert.isNull(JFormGenerationService.extractJson('no json here'));
            Assert.areEqual('[1,2]', JFormGenerationService.extractJson('list: [1,2] done'));
        }
    }
    private static void expectError(String description, String name, String target, String contains) {
        try {
            JFormGenerationService.describe(description, name, target);
            Assert.fail('expected an error for ' + contains);
        } catch (JFormGenerationService.GenerationException e) {
            Assert.isTrue(e.getMessage().contains(contains), e.getMessage());
        }
    }

    @IsTest
    static void createSavesTheConfirmedDraft() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormGenerationService.client = new StubClient(new List<String>{ GOOD });
            JFormGenerationService.Draft d = JFormGenerationService.describe('Booking form', 'Created from words', 'Lead');
            Assert.areEqual(0, [SELECT COUNT() FROM Form__c WHERE Name = 'Created from words'], 'describe creates nothing');

            Test.startTest();
            String json = JFormGenerationService.create(d.definitionJson, d.targetObjectApiName);
            Test.stopTest();

            JFormDefinition.Form saved = JFormDefinition.parse(json);
            Assert.isNotNull(saved.id);
            Assert.areEqual('Created from words', saved.name);
            Assert.areEqual('Draft', saved.status);
            Assert.areEqual(2, saved.sections.size());
            Assert.areEqual(2, saved.fieldsByKey().get('store').options.size());
            Assert.isNotNull(saved.fieldsByKey().get('number_plate').conditionalLogic);
            Assert.areEqual('Lead', saved.targetObjectApiName, 'the target object becomes the main record step');
            try {
                JFormGenerationService.create('', null);
                Assert.fail('expected an error');
            } catch (JFormGenerationService.GenerationException e) {
                Assert.isTrue(e.getMessage().contains('no draft'));
            }
        }
    }
}
