@IsTest
private class JFormOtherChoiceTest {

    /** Options "Retail" and "Farming" (value "farm"), with Other when config is given. */
    private static JFormDefinition.Field industry(String fieldType, Map<String, Object> config) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = 'industry';
        f.fieldType = fieldType;
        f.label = 'Industry';
        f.config = config;
        f.options = new List<JFormDefinition.Option>();
        JFormDefinition.Option retail = new JFormDefinition.Option();
        retail.label = 'Retail';
        f.options.add(retail);
        JFormDefinition.Option farming = new JFormDefinition.Option();
        farming.label = 'Farming';
        farming.value = 'farm';
        f.options.add(farming);
        return f;
    }

    private static Map<String, Object> withOther() {
        return new Map<String, Object>{ 'other' => new Map<String, Object>() };
    }

    @IsTest
    static void offeredOnChoiceFieldsWithOther() {
        Assert.isTrue(JFormOtherChoice.offered(industry('radio', withOther())));
        Assert.isTrue(JFormOtherChoice.offered(industry('multiselect', withOther())));
        Assert.isFalse(JFormOtherChoice.offered(industry('radio', null)));
        Assert.isFalse(JFormOtherChoice.offered(industry('radio', new Map<String, Object>{ 'other' => true })), 'other must be an object');
        Assert.isFalse(JFormOtherChoice.offered(industry('text', withOther())));

        JFormDefinition.Field f = industry('radio', withOther());
        Assert.areEqual('Other', JFormOtherChoice.label(f));
        Assert.areEqual('industry.other', JFormOtherChoice.answerKey(f));
        Assert.areEqual('Industry: Other', JFormOtherChoice.answerLabel(f));
        f.config = new Map<String, Object>{ 'other' => new Map<String, Object>{ 'label' => '  Something else ' } };
        Assert.areEqual('Something else', JFormOtherChoice.label(f));
    }

    @IsTest
    static void pickedReadsValuesListsAndJoinedValues() {
        JFormDefinition.Field f = industry('checkboxes', withOther());
        Assert.isTrue(JFormOtherChoice.picked(f, 'Other'));
        Assert.isTrue(JFormOtherChoice.picked(f, new List<Object>{ 'Retail', 'Other' }));
        Assert.isTrue(JFormOtherChoice.picked(f, 'Retail; Other'));
        Assert.isFalse(JFormOtherChoice.picked(f, new List<Object>{ 'Retail' }));
        Assert.isFalse(JFormOtherChoice.picked(f, null));
        Assert.isFalse(JFormOtherChoice.picked(industry('checkboxes', null), 'Other'));
    }

    @IsTest
    static void renamingOtherKeepsItsStoredValue() {
        JFormDefinition.Field f = industry('radio', new Map<String, Object>{ 'other' => new Map<String, Object>{ 'label' => 'Something else' } });
        Assert.areEqual('Other', JFormOtherChoice.value(f), 'stored as Other whatever it is called');
        Assert.isTrue(JFormOtherChoice.picked(f, 'Other'));
        Assert.isFalse(JFormOtherChoice.picked(f, 'Something else'));
        Assert.isNull(JFormAnswerValidator.problemWith(f, 'Other'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(f, 'Something else'));
        Assert.areEqual('Industry: Something else', JFormOtherChoice.answerLabel(f), 'the text is labelled with what the choice shows');
    }

    @IsTest
    static void singleChoicesArePickedWhole() {
        Assert.isFalse(JFormOtherChoice.picked(industry('radio', withOther()), 'Retail; Other'), 'a single choice is never split');
        Assert.isFalse(JFormOtherChoice.picked(industry('radio', withOther()), 'other'), 'compared exactly, like the options');
        JFormDefinition.Field semicolon = industry('picklist', new Map<String, Object>{ 'other' => new Map<String, Object>{ 'value' => 'Other; please say' } });
        Assert.isTrue(JFormOtherChoice.picked(semicolon, 'Other; please say'));
    }

    @IsTest
    static void limitsFitTheChoicesLeft() {
        // two choices left after the builder removed some: At least 4 asks for both, At most 3 limits nothing
        JFormDefinition.Field shrunk = industry('checkboxes', new Map<String, Object>{ 'minChoices' => 4, 'maxChoices' => 3 });
        Assert.areEqual(new List<Integer>{ 2, null }, JFormAnswerValidator.limits(shrunk, 2));
        Assert.isNull(JFormAnswerValidator.problemWith(shrunk, new List<Object>{ 'Retail', 'farm' }), 'still answerable');
        Assert.areEqual('Choose at least 2.', JFormAnswerValidator.problemWith(shrunk, new List<Object>{ 'Retail' }));
        // At least never passes At most
        JFormDefinition.Field crossed = industry('checkboxes', new Map<String, Object>{ 'minChoices' => 3, 'maxChoices' => 2 });
        Assert.areEqual(new List<Integer>{ 2, 2 }, JFormAnswerValidator.limits(crossed, 5));
    }

    @IsTest
    static void tidyKeepsTextOnlyWhileOtherIsPicked() {
        JFormDefinition.Form def = new JFormDefinition.Form();
        JFormDefinition.Section s = new JFormDefinition.Section();
        s.fields = new List<JFormDefinition.Field>{ industry('radio', withOther()) };
        JFormDefinition.Field plain = industry('radio', null);
        plain.key = 'plain';
        s.fields.add(plain);
        def.sections = new List<JFormDefinition.Section>{ s };

        Map<String, Object> answers = new Map<String, Object>{ 'industry' => 'Other', 'industry.other' => '  Fishing ', 'plain' => 'Other', 'plain.other' => 'x' };
        JFormOtherChoice.tidy(def, answers);
        Assert.areEqual('Fishing', answers.get('industry.other'), 'trimmed');
        Assert.isFalse(answers.containsKey('plain.other'), 'the field offers no Other');

        answers = new Map<String, Object>{ 'industry' => 'Retail', 'industry.other' => 'Fishing' };
        JFormOtherChoice.tidy(def, answers);
        Assert.isFalse(answers.containsKey('industry.other'), 'Other not picked');

        answers = new Map<String, Object>{ 'industry' => 'Other', 'industry.other' => '   ' };
        JFormOtherChoice.tidy(def, answers);
        Assert.isFalse(answers.containsKey('industry.other'), 'nothing typed');
    }

    @IsTest
    static void validatorAcceptsOtherAndLimitsItsText() {
        JFormDefinition.Field f = industry('radio', withOther());
        Assert.isNull(JFormAnswerValidator.problemWith(f, 'Other'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(industry('radio', null), 'Other'), 'no Other on the field');

        List<String> problems = JFormAnswerValidator.findProblems(new List<JFormDefinition.Field>{ f },
            new Map<String, Object>{ 'industry' => 'Other', 'industry.other' => 'x'.repeat(256) });
        Assert.areEqual(new List<String>{ 'Industry (Other): Enter no more than 255 characters' }, problems);
        Assert.isTrue(JFormAnswerValidator.findProblems(new List<JFormDefinition.Field>{ f },
            new Map<String, Object>{ 'industry' => 'Other', 'industry.other' => 'x'.repeat(255) }).isEmpty());
        Assert.isNull(JFormOtherChoice.problem(industry('radio', null), new Map<String, Object>{ 'industry.other' => 'x'.repeat(300) }));
    }

    @IsTest
    static void validatorCountsCheckboxesChoices() {
        JFormDefinition.Field f = industry('checkboxes', new Map<String, Object>{ 'other' => new Map<String, Object>(), 'minChoices' => 2, 'maxChoices' => '2' });
        Assert.isNull(JFormAnswerValidator.problemWith(f, new List<Object>()), 'an empty answer passes');
        Assert.areEqual('Choose at least 2.', JFormAnswerValidator.problemWith(f, new List<Object>{ 'Retail' }));
        Assert.isNull(JFormAnswerValidator.problemWith(f, new List<Object>{ 'Retail', 'Other' }));
        Assert.areEqual('Choose no more than 2.', JFormAnswerValidator.problemWith(f, 'Retail; farm; Other'));
        f.fieldType = 'multiselect';
        Assert.areEqual('Choose no more than 2.', JFormAnswerValidator.problemWith(f, 'Retail;farm;Other'));
        Assert.isNull(JFormAnswerValidator.problemWith(industry('checkboxes', new Map<String, Object>{ 'minChoices' => 1 }), new List<Object>{ 'Retail' }));
    }

    /** The sample form with Other on its required season picklist, and a Lead step taking what was typed under it. */
    private static JFormPublishService.PublishResult seasonWithOther() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Other season');
        def.targetObjectApiName = null;
        for (JFormDefinition.Field f : def.sections[1].fields) {
            if (f.key == 'season') {
                f.config = withOther();
            }
        }
        def.settings = new Map<String, Object>{ 'automation' => new Map<String, Object>{ 'steps' => new List<Object>{ new Map<String, Object>{
            'key' => 'lead', 'action' => 'create', 'object' => 'Lead', 'primary' => true, 'fields' => new List<Object>{
                new Map<String, Object>{ 'field' => 'LastName', 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => 'first_name' } },
                new Map<String, Object>{ 'field' => 'Company', 'source' => new Map<String, Object>{ 'type' => 'value', 'value' => 'JForm' } },
                new Map<String, Object>{ 'field' => 'Description', 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => 'season.other' } }
            } } } } };
        def = JFormDefinitionService.create(def);
        return JFormPublishService.publish(def.id, null);
    }

    @IsTest
    static void submitStoresAndMapsTheOtherText() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = seasonWithOther();
            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{
                'first_name' => 'Ana', 'email' => 'ana@example.com', 'season' => 'Other', 'season.other' => '  Monsoon '
            }));

            Form_Submission__c sub = [SELECT Status__c, Target_Record_Id__c FROM Form_Submission__c WHERE Id = :submissionId];
            Assert.areEqual('Processed', sub.Status__c);
            Assert.areEqual('Monsoon', [SELECT Description FROM Lead WHERE Id = :sub.Target_Record_Id__c].Description);
            Submission_Field_Value__c stored = [SELECT Field_Label__c, Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :submissionId AND Field_Key__c = 'season.other'];
            Assert.areEqual('Monsoon', stored.Field_Value__c);
            Assert.areEqual('Which season did you attend?: Other', stored.Field_Label__c);

            JFormResponsesController.ResultPage p = JFormResponsesController.getSubmissions(r.formId, 25, 0, 20, null, null, null, null, null, null, null, null);
            Assert.isTrue(p.columnKeys.contains('season.other'), String.valueOf(p.columnKeys));
            String csv = JFormResponsesController.exportCsv(r.formId, false, null, null);
            Assert.isTrue(csv.contains('Which season did you attend?: Other'), csv);
            Assert.isTrue(csv.contains('Monsoon'), csv);
        }
    }

    @IsTest
    static void aRequiredFieldThatPicksOtherNeedsTheText() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = seasonWithOther();
            try {
                JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{
                    'first_name' => 'Ana', 'email' => 'ana@example.com', 'season' => 'Other', 'season.other' => ' '
                }));
                Assert.fail('the Other text is required');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('Which season did you attend? (Other)'), e.getMessage());
            }
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId]);
        }
    }

    @IsTest
    static void agentRulesMatchTheOtherChoice() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Other rules');
            def.fieldsByKey().get('season').config = new Map<String, Object>{ 'other' => new Map<String, Object>{ 'label' => 'Something else' } };
            JFormDefinitionService.save(def);

            JFormAddRuleAction.Request req = new JFormAddRuleAction.Request();
            req.formId = def.id;
            req.targetField = 'How likely are you to recommend us?';
            req.ruleAction = 'show';
            req.whenField = 'season';
            req.operator = 'equals';
            req.value = 'something else';
            JFormAddRuleAction.Result r = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual('Other', JFormDefinitionService.load(def.id).fieldsByKey().get('nps').conditionalLogic.conditions[0].value, 'the label is matched, the stored value kept');

            req.value = 'Winter sports';
            r = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ req })[0];
            Assert.isTrue(r.errorMessage.contains('Something else'), 'the choices offered name Other: ' + r.errorMessage);
        }
    }
}
