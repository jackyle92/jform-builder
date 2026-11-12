/**
 * Long forms: many pages, fields and choices. These used to fail on load with
 * "Aggregate query has too many rows for direct assignment, use FOR loop" once a form's
 * records passed what a nested subquery hands over at once, and choice lists of 100 or more
 * could not be saved at all.
 */
@IsTest
private class JFormLongFormTest {

    private static JFormDefinition.Form longForm(String name, Integer pages, Integer fieldsPerPage, Integer optionsPerField) {
        JFormDefinition.Form def = new JFormDefinition.Form();
        def.name = name;
        def.label = name;
        for (Integer p = 1; p <= pages; p++) {
            JFormDefinition.Section s = new JFormDefinition.Section();
            s.key = 'page_' + p;
            s.name = 'Page ' + p;
            s.label = 'Page ' + p;
            for (Integer i = 1; i <= fieldsPerPage; i++) {
                JFormDefinition.Field f = new JFormDefinition.Field();
                f.key = 'q_' + p + '_' + i;
                f.label = 'Question ' + p + '.' + i;
                f.fieldType = 'picklist';
                f.options = options('Choice', optionsPerField);
                s.fields.add(f);
            }
            def.sections.add(s);
        }
        return def;
    }

    private static List<JFormDefinition.Option> options(String prefix, Integer n) {
        List<JFormDefinition.Option> out = new List<JFormDefinition.Option>();
        for (Integer i = 1; i <= n; i++) {
            JFormDefinition.Option o = new JFormDefinition.Option();
            o.label = prefix + ' ' + String.valueOf(i).leftPad(4, '0');
            o.value = o.label;
            out.add(o);
        }
        return out;
    }

    @IsTest
    static void aLongFormLoadsSavesAndKeepsItsOrder() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = longForm('Long form', 3, 50, 4); // 150 fields, 600 choices
            JFormDefinition.Field country = new JFormDefinition.Field();
            country.key = 'country';
            country.label = 'Country';
            country.fieldType = 'picklist';
            country.options = options('Country', 250); // one long list, as an address block would have
            def.sections[0].fields.add(0, country);

            Test.startTest();
            JFormDefinition.Form created = JFormDefinitionService.create(def);
            JFormDefinition.Form loaded = JFormDefinitionService.load(created.id);
            Test.stopTest();

            Assert.areEqual(3, loaded.sections.size());
            Assert.areEqual(151, loaded.fieldCount());
            JFormDefinition.Field c = loaded.sections[0].fields[0];
            Assert.areEqual('country', c.key, 'the field order survives');
            Assert.areEqual(250, c.options.size());
            for (Integer i = 0; i < 250; i++) {
                Assert.areEqual('Country ' + String.valueOf(i + 1).leftPad(4, '0'), c.options[i].label, 'choice ' + (i + 1) + ' is in place');
                Assert.areEqual(i + 1, c.options[i].sortOrder);
            }
            Assert.areEqual('Question 3.50', loaded.sections[2].fields[49].label);

            // an edit to a long form saves and loads again
            loaded.sections[1].fields[0].label = 'Renamed question';
            loaded.sections[0].fields[0].options.remove(0);
            JFormDefinition.Form saved = JFormDefinitionService.save(loaded);
            Assert.areEqual('Renamed question', saved.sections[1].fields[0].label);
            Assert.areEqual(249, saved.sections[0].fields[0].options.size());
            Assert.areEqual('Country 0002', saved.sections[0].fields[0].options[0].label);
        }
    }

    @IsTest
    static void limitsAreExplainedNotHitAsErrors() {
        JFormDefinition.Form tooManyChoices = longForm('Too many choices', 1, 1, JFormDefinitionService.MAX_OPTIONS_PER_FIELD + 1);
        try {
            JFormDefinitionService.validate(tooManyChoices);
            Assert.fail('expected a limit message');
        } catch (JFormDefinition.JFormException e) {
            Assert.isTrue(e.getMessage().contains('up to ' + JFormDefinitionService.MAX_OPTIONS_PER_FIELD), e.getMessage());
        }
        JFormDefinition.Form tooManyPages = longForm('Too many pages', JFormDefinitionService.MAX_PAGES + 1, 1, 2);
        try {
            JFormDefinitionService.validate(tooManyPages);
            Assert.fail('expected a limit message');
        } catch (JFormDefinition.JFormException e) {
            Assert.isTrue(e.getMessage().contains(JFormDefinitionService.MAX_PAGES + ' pages'), e.getMessage());
        }
        JFormDefinition.Form tooManyInTotal = longForm('Too many in total', 6, 20, 50); // 6000 choices
        try {
            JFormDefinitionService.validate(tooManyInTotal);
            Assert.fail('expected a limit message');
        } catch (JFormDefinition.JFormException e) {
            Assert.isTrue(e.getMessage().contains('choices in total'), e.getMessage());
        }
    }

    @IsTest
    static void longChoiceListsStoreTheirOrderInTheField() {
        Assert.areEqual(5, JFormDefinitionService.orderValue(5, 99), 'short lists keep whole numbers');
        Assert.areEqual(0.005, JFormDefinitionService.orderValue(5, 100), 'long lists use thousandths');
        Assert.areEqual(1.000, JFormDefinitionService.orderValue(1000, 1000));
    }

    @IsTest
    static void agentActionsReportLongFormsAndLockMissingForms() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form created = JFormDefinitionService.create(longForm('Agent long form', 2, 60, 5));
            JFormFindFormsAction.Request find = new JFormFindFormsAction.Request();
            find.searchText = 'Agent long form';
            JFormFindFormsAction.Result found = JFormFindFormsAction.find(new List<JFormFindFormsAction.Request>{ find })[0];
            Assert.isNull(found.errorMessage, 'Find Forms failed: ' + found.errorMessage);
            Assert.isTrue(found.formsSummary.contains('120 fields'), found.formsSummary);

            JFormAddFieldsAction.Request add = new JFormAddFieldsAction.Request();
            add.formId = created.id;
            add.fieldsJson = '[{"label":"One more","type":"text"}]';
            add.newPageName = 'Extra';
            JFormAddFieldsAction.Result r = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ add })[0];
            Assert.isNull(r.errorMessage, 'Add Fields failed: ' + r.errorMessage);
            Assert.areEqual(121, JFormDefinitionService.load(created.id).fieldCount());

            // a failing request leaves the form exactly as it was
            JFormAddFieldsAction.Request bad = new JFormAddFieldsAction.Request();
            bad.formId = created.id;
            bad.fieldsJson = 'not json';
            JFormAddFieldsAction.Result failed = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ bad })[0];
            Assert.isNotNull(failed.errorMessage);
            Assert.areEqual(121, JFormDefinitionService.load(created.id).fieldCount());
        }
        try {
            JFormDefinitionService.lockForEdit(UserInfo.getUserId());
            Assert.fail('expected not found');
        } catch (Exception e) {
            Assert.isTrue(e.getMessage().contains('Form not found') || e instanceof System.QueryException, e.getMessage());
        }
    }
}
