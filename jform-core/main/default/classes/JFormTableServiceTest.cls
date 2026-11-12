@IsTest
private class JFormTableServiceTest {

    private static JFormDefinition.Field table(String key, String label, List<String> rows, List<String> columns) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key;
        f.fieldType = 'table';
        f.label = label;
        f.required = true;
        f.options = new List<JFormDefinition.Option>();
        for (String c : columns) {
            JFormDefinition.Option o = new JFormDefinition.Option();
            o.label = c;
            o.value = c;
            f.options.add(o);
        }
        List<Object> rowList = new List<Object>();
        for (String r : rows) {
            rowList.add(new Map<String, Object>{ 'key' => r.toLowerCase(), 'label' => r });
        }
        f.config = new Map<String, Object>{ 'rows' => rowList };
        return f;
    }

    private static JFormDefinition.Field satisfaction() {
        return table('satisfaction', 'How satisfied were you with', new List<String>{ 'Service', 'Price', 'Speed' }, new List<String>{ 'Poor', 'Fair', 'Good' });
    }

    private static JFormDefinition.Field text(String key, String label, String target) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key;
        f.fieldType = 'text';
        f.label = label;
        f.targetFieldApiName = target;
        return f;
    }

    /** The sample form plus what a Lead needs and the given fields on the first page, published, with no record step unless given. */
    private static Form__c publishedForm(String name, List<JFormDefinition.Field> extra, List<Object> steps) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition(name);
        def.sections[0].fields.add(text('last_name', 'Last name', null));
        def.sections[0].fields.add(text('company', 'Company', null));
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

    private static Map<String, Object> answers(Object tableAnswer) {
        Map<String, Object> a = new Map<String, Object>{
            'first_name' => 'Noah', 'last_name' => 'Lee', 'email' => 'noah.lee@example.com', 'company' => 'Riverside', 'season' => 'autumn'
        };
        if (tableAnswer != null) {
            a.put('satisfaction', tableAnswer);
        }
        return a;
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

    private static Map<String, Object> stepFor(List<Object> fields) {
        return new Map<String, Object>{ 'key' => 'lead', 'label' => 'Create the lead', 'action' => 'create', 'object' => 'Lead', 'primary' => true, 'fields' => fields };
    }

    private static Map<String, Object> mapping(String field, Map<String, Object> source) {
        return new Map<String, Object>{ 'field' => field, 'source' => source };
    }

    @IsTest
    static void storesOneValuePerAnsweredRow() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field optional = satisfaction();
            optional.required = false;
            Form__c form = publishedForm('Satisfaction', new List<JFormDefinition.Field>{ optional }, null);

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form),
                answers(new Map<String, Object>{ 'service' => 'Good', 'price' => 'Poor', 'speed' => '' }), null);
            Test.stopTest();

            Map<String, Submission_Field_Value__c> byKey = new Map<String, Submission_Field_Value__c>();
            for (Submission_Field_Value__c v : [SELECT Field_Key__c, Field_Label__c, Field_Value__c, Search_Text__c, Form_Field_Definition__c
                                                FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId]) {
                byKey.put(v.Field_Key__c, v);
            }
            Assert.isFalse(byKey.containsKey('satisfaction'), 'the table itself is not stored');
            Assert.isFalse(byKey.containsKey('satisfaction.speed'), 'an unanswered row is not stored');
            Submission_Field_Value__c service = byKey.get('satisfaction.service');
            Assert.areEqual('How satisfied were you with: Service', service.Field_Label__c);
            Assert.areEqual('Good', service.Field_Value__c);
            Assert.areEqual('Good', service.Search_Text__c);
            Assert.isNotNull(service.Form_Field_Definition__c, 'points to the table field');
            Assert.areEqual('Poor', byKey.get('satisfaction.price').Field_Value__c);
        }
    }

    @IsTest
    static void requiresEveryRowOrOne() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field oneRowEnough = table('ratings', 'Ratings', new List<String>{ 'Food', 'Music' }, new List<String>{ 'Poor', 'Good' });
            oneRowEnough.config.put('everyRow', false);
            Form__c form = publishedForm('Required rows', new List<JFormDefinition.Field>{ satisfaction(), oneRowEnough }, null);

            Map<String, Object> partly = answers(new Map<String, Object>{ 'service' => 'Good' });
            partly.put('ratings', new Map<String, Object>{ 'food' => 'Good' });
            Assert.areEqual('Please answer: How satisfied were you with (Price, Speed)', refusal(form, partly), 'names the missing rows');

            Map<String, Object> none = answers(null);
            none.put('ratings', new Map<String, Object>{ 'food' => 'Good' });
            Assert.areEqual('Please answer: How satisfied were you with', refusal(form, none), 'the label alone when nothing is answered');

            Map<String, Object> enough = answers(new Map<String, Object>{ 'service' => 'Good', 'price' => 'Fair', 'speed' => 'Poor' });
            enough.put('ratings', new Map<String, Object>{ 'music' => 'Poor' });
            Assert.isNull(refusal(form, enough), 'one row is enough when everyRow is off');

            // submit() rewrites the answers it is given, so each call gets its own map
            Map<String, Object> emptyTable = answers(new Map<String, Object>{ 'service' => 'Good', 'price' => 'Fair', 'speed' => 'Poor' });
            emptyTable.put('ratings', new Map<String, Object>());
            Assert.areEqual('Please answer: Ratings', refusal(form, emptyTable));
        }
    }

    @IsTest
    static void refusesRowsAndColumnsTheTableDoesNotHave() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Checks', new List<JFormDefinition.Field>{ satisfaction() }, null);
            Map<String, Object> all = new Map<String, Object>{ 'service' => 'Good', 'price' => 'Fair', 'speed' => 'Poor' };

            Map<String, Object> unknownRow = all.clone();
            unknownRow.put('parking', 'Good');
            Assert.areEqual('Please check: How satisfied were you with: there is no row "parking".', refusal(form, answers(unknownRow)));

            Map<String, Object> unknownColumn = all.clone();
            unknownColumn.put('price', 'Excellent');
            Assert.areEqual('Please check: How satisfied were you with (Price): Choose one of the listed options.', refusal(form, answers(unknownColumn)));

            Map<String, Object> twoValues = all.clone();
            twoValues.put('speed', new List<Object>{ 'Poor', 'Good' });
            Assert.areEqual('Please check: How satisfied were you with (Speed): Choose one option.', refusal(form, answers(twoValues)));

            Assert.areEqual('Please check: How satisfied were you with: send an answer per row, keyed by row.', refusal(form, answers('Good')));
            Assert.isNull(refusal(form, answers(all)));
        }
    }

    @IsTest
    static void storesSeveralAnswersPerRow() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field availability = table('availability', 'When can you come?', new List<String>{ 'Mon', 'Tue' }, new List<String>{ 'am', 'pm' });
            availability.config.put('multiple', true);
            availability.config.put('everyRow', false);
            Form__c form = publishedForm('Availability', new List<JFormDefinition.Field>{ availability }, null);
            Map<String, Object> a = answers(null);
            a.put('availability', new Map<String, Object>{ 'mon' => new List<Object>{ 'am', 'pm' } });

            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form), a, null);

            Assert.areEqual('am; pm', [SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId AND Field_Key__c = 'availability.mon'].Field_Value__c);
        }
    }

    @IsTest
    static void conditionsTestOneRow() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field why = text('why_price', 'What went wrong with the price?', null);
            why.required = true;
            why.conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'satisfaction.price', 'equals', 'Poor');
            Form__c form = publishedForm('Row rule', new List<JFormDefinition.Field>{ satisfaction(), why }, null);

            Assert.areEqual('Please answer: What went wrong with the price?',
                refusal(form, answers(new Map<String, Object>{ 'service' => 'Good', 'price' => 'Poor', 'speed' => 'Good' })));
            Assert.isNull(refusal(form, answers(new Map<String, Object>{ 'service' => 'Good', 'price' => 'Fair', 'speed' => 'Good' })), 'hidden, so not required');

            JFormDefinition.Form def = definitionOf(form);
            def.sections[0].fields[def.sections[0].fields.size() - 1].conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'satisfaction', 'is_not_empty', null);
            try {
                JFormDefinitionService.validate(def);
                Assert.fail('a rule on the whole table is refused');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('must test one row of the table "satisfaction"'), e.getMessage());
            }
        }
    }

    @IsTest
    static void mapsRowsInRecordStepsOnSubmitAndReprocess() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<Object> steps = new List<Object>{ stepFor(new List<Object>{
                mapping('LastName', new Map<String, Object>{ 'type' => 'field', 'key' => 'last_name' }),
                mapping('Company', new Map<String, Object>{ 'type' => 'field', 'key' => 'company' }),
                mapping('Title', new Map<String, Object>{ 'type' => 'field', 'key' => 'satisfaction.service' }),
                mapping('Description', new Map<String, Object>{ 'type' => 'value', 'value' => 'Price: {{satisfaction.price}}' })
            }) };
            Form__c form = publishedForm('Row mapping', new List<JFormDefinition.Field>{ satisfaction() }, steps);

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form),
                answers(new Map<String, Object>{ 'service' => 'Good', 'price' => 'Poor', 'speed' => 'Fair' }), null);
            Assert.areEqual('Processed', res.status, 'error: ' + res.errorMessage);
            Lead lead = [SELECT Title, Description FROM Lead WHERE Id = :res.targetRecordId];
            Assert.areEqual('Good', lead.Title);
            Assert.areEqual('Price: Poor', lead.Description);

            // reprocessing reads the stored rows back by key
            update new Form_Submission__c(Id = res.submissionId, Status__c = 'Error');
            JFormSubmissionService.Result again = JFormSubmissionService.reprocess(res.submissionId);
            Test.stopTest();

            Assert.areNotEqual(res.targetRecordId, again.targetRecordId);
            Lead second = [SELECT Title, Description FROM Lead WHERE Id = :again.targetRecordId];
            Assert.areEqual('Good', second.Title);
            Assert.areEqual('Price: Poor', second.Description);
        }
    }

    @IsTest
    static void responsesListEachRow() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Responses', new List<JFormDefinition.Field>{ satisfaction() }, null);
            JFormSubmissionService.submit(form, definitionOf(form),
                answers(new Map<String, Object>{ 'service' => 'Good', 'price' => 'Poor', 'speed' => 'Fair' }), null);

            JFormResponsesController.ResultPage page = JFormResponsesController.getSubmissions(form.Id, 25, 0, 12, null, null, null, null, null, null, null, null);
            Assert.isTrue(page.columnKeys.contains('satisfaction.price'), String.valueOf(page.columnKeys));
            Assert.isFalse(page.columnKeys.contains('satisfaction'));
            Assert.isTrue(page.columns.contains('How satisfied were you with: Price'));
            Boolean filterFound = false;
            for (JFormResponsesController.FilterField ff : page.fields) {
                if (ff.key == 'satisfaction.speed') {
                    filterFound = true;
                    Assert.areEqual(new List<String>{ 'Poor', 'Fair', 'Good' }, ff.options);
                }
            }
            Assert.isTrue(filterFound, 'a filter per row');

            JFormResponsesController.ResultPage filtered = JFormResponsesController.getSubmissions(form.Id, 25, 0, 12, null, null, null, null, 'satisfaction.price', 'Poor', null, null);
            Assert.areEqual(1, filtered.rows.size(), 'filters by a row');

            Boolean summaryFound = false;
            for (JFormResponsesController.ChoiceSummary cs : JFormResponsesController.getSummary(form.Id).choices) {
                if (cs.fieldKey == 'satisfaction.service') {
                    summaryFound = true;
                    Assert.areEqual('How satisfied were you with: Service', cs.label);
                    Assert.areEqual('Good', cs.counts[0].value);
                    Assert.areEqual(1, cs.counts[0].count);
                }
            }
            Assert.isTrue(summaryFound, 'a summary per row');

            String csv = JFormResponsesController.exportCsv(form.Id, false, null, null);
            Assert.isTrue(csv.contains('How satisfied were you with: Service'), csv);
            Assert.isTrue(csv.contains('Poor'), csv);
        }
    }

    @IsTest
    static void checksTheDefinition() {
        JFormDefinition.Field noRows = table('empty', 'Empty', new List<String>(), new List<String>{ 'Yes' });
        Assert.isTrue(String.join(JFormTableService.definitionProblems(noRows), ' ').contains('needs at least one row'));

        List<String> manyRows = new List<String>();
        for (Integer i = 1; i <= JFormTableService.MAX_ROWS + 1; i++) {
            manyRows.add('Row' + i);
        }
        List<String> manyColumns = new List<String>();
        for (Integer i = 1; i <= JFormTableService.MAX_COLUMNS + 1; i++) {
            manyColumns.add('C' + i);
        }
        String problems = String.join(JFormTableService.definitionProblems(table('big', 'Big', manyRows, manyColumns)), ' ');
        Assert.isTrue(problems.contains('has 21 rows'), problems);
        Assert.isTrue(problems.contains('has 11 columns'), problems);

        JFormDefinition.Field longKey = table('k'.repeat(70), 'Long', new List<String>{ 'Twelve_chars' }, new List<String>{ 'Yes' });
        Assert.isTrue(String.join(JFormTableService.definitionProblems(longKey), ' ').contains('together must be at most 79 characters'));

        JFormDefinition.Field badKey = satisfaction();
        ((Map<String, Object>) ((List<Object>) badKey.config.get('rows'))[0]).put('key', '1st');
        Assert.isTrue(String.join(JFormTableService.definitionProblems(badKey), ' ').contains('row key "1st" must start with a letter'));

        Assert.isTrue(JFormTableService.definitionProblems(satisfaction()).isEmpty());
    }

    @IsTest
    static void givesRowsStableKeys() {
        JFormDefinition.Field f = satisfaction();
        f.config.put('rows', new List<Object>{
            'Ease of use',
            new Map<String, Object>{ 'key' => 'price', 'label' => 'Price' },
            new Map<String, Object>{ 'key' => 'price', 'label' => 'Price again' },
            new Map<String, Object>{ 'label' => '24/7 support' },
            new Map<String, Object>{ 'key' => 'bad key', 'label' => 'Ease of use' },
            new Map<String, Object>{ 'label' => 'A very long row label that goes on' }
        });

        JFormTableService.normaliseRows(f);

        List<String> keys = new List<String>();
        for (JFormTableService.Row r : JFormTableService.rows(f)) {
            keys.add(r.key);
        }
        Assert.areEqual(new List<String>{ 'ease_of_use', 'price', 'price_again', 'r_24_7_support', 'ease_of_use_2', 'a_very_long_row_labe' }, keys);
        Assert.areEqual('Ease of use', JFormTableService.rows(f)[0].label, 'a plain string is the label');
        Assert.areEqual('row_3', JFormTableService.keyFromLabel('!!!', 3));
    }

    @IsTest
    static void agentsDescribeTablesWithPlainRows() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Agent survey';
            req.definitionJson = '[{"label":"Rate us","type":"likert","rows":["Service","Price"],"options":["Poor","Good"],"required":true},'
                + '{"label":"What went wrong?","type":"text"}]';
            JFormCreateFormAction.Result created = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];
            Assert.isNull(created.errorMessage, 'unexpected error: ' + created.errorMessage);

            JFormDefinition.Field t = JFormDefinitionService.load(created.formId).fieldsByKey().get('rate_us');
            Assert.areEqual('table', t.fieldType, 'likert is a table');
            Assert.areEqual(new List<String>{ 'rate_us.service', 'rate_us.price' }, JFormTableService.answerKeys(t), 'row keys made from the labels');
            Assert.isTrue(created.summary.contains('rows Service (key rate_us.service) | Price (key rate_us.price); columns Poor | Good'), created.summary);

            JFormAddRuleAction.Request onTable = new JFormAddRuleAction.Request();
            onTable.formId = created.formId;
            onTable.targetField = 'What went wrong?';
            onTable.ruleAction = 'show';
            onTable.whenField = 'Rate us';
            onTable.value = 'Poor';
            JFormAddRuleAction.Result refused = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ onTable })[0];
            Assert.isTrue(String.valueOf(refused.errorMessage).contains('is a table: name one of its rows, rate_us.service, rate_us.price'), 'refused: ' + refused.errorMessage);

            onTable.whenField = 'Rate us: Price';
            onTable.value = 'poor';
            JFormAddRuleAction.Result added = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ onTable })[0];
            Assert.isNull(added.errorMessage, 'unexpected error: ' + added.errorMessage);
            Assert.areEqual('Show "What went wrong?" when Rate us: Price equals "Poor"', added.ruleSentence);
            JFormDefinition.Condition c = JFormDefinitionService.load(created.formId).fieldsByKey().get('what_went_wrong').conditionalLogic.conditions[0];
            Assert.areEqual('rate_us.price', c.field);
        }
    }

    @IsTest
    static void listsRowsAsAnswerKeys() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Keys');
        def.sections[0].fields.add(satisfaction());

        Set<String> keys = JFormTableService.answerKeys(def);

        Assert.isTrue(keys.contains('satisfaction.service'));
        Assert.isTrue(keys.contains('email'));
        Assert.isFalse(keys.contains('satisfaction'));
        Assert.areEqual('Price: Poor', JFormAutomationService.interpolate('Price: {{ satisfaction.price }}', new Map<String, Object>{ 'satisfaction.price' => 'Poor' }));
    }
}
