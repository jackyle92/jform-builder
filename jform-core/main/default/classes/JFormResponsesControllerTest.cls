@IsTest
private class JFormResponsesControllerTest {

    private static Id formWithSubmissions() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Responses');
        def.targetObjectApiName = null;
        def = JFormDefinitionService.create(def);
        JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
        for (Integer i = 0; i < 3; i++) {
            JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{
                'first_name' => 'Person ' + i, 'email' => 'p' + i + '@example.com', 'season' => Math.mod(i, 2) == 0 ? 'Summer' : 'autumn',
                'why_summer' => 'sun', 'nps' => 7 + i
            }));
        }
        Form_Submission__c errored = [SELECT Id FROM Form_Submission__c WHERE Form__c = :def.id LIMIT 1];
        errored.Status__c = 'Error';
        errored.Error_Message__c = 'boom';
        update errored;
        return def.id;
    }

    @IsTest
    static void summaryCountsAndChoices() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = formWithSubmissions();

            JFormResponsesController.Summary s = JFormResponsesController.getSummary(formId);

            Assert.areEqual(3, s.total);
            Assert.areEqual(3, s.last7Days);
            Assert.areEqual(2, s.processed);
            Assert.areEqual(1, s.errors);
            JFormResponsesController.ChoiceSummary season;
            for (JFormResponsesController.ChoiceSummary c : s.choices) {
                if (c.fieldKey == 'season') {
                    season = c;
                }
            }
            Assert.isNotNull(season, 'picklist summarised');
            Map<String, Integer> counts = new Map<String, Integer>();
            for (JFormResponsesController.ChoiceCount cc : season.counts) {
                counts.put(cc.value, cc.count);
            }
            Assert.areEqual(2, counts.get('Summer'));
            Assert.areEqual(1, counts.get('autumn'));
        }
    }

    @IsTest
    static void pagedTableAndFilter() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = formWithSubmissions();

            JFormResponsesController.ResultPage p = JFormResponsesController.getSubmissions(formId, 2, 0, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(3, p.total);
            Assert.areEqual(2, p.rows.size());
            Assert.areEqual(3, p.columns.size());
            Assert.areEqual(new List<String>{ 'first_name', 'email', 'season' }, p.columnKeys, 'layout fields skipped');
            Assert.areEqual(3, p.rows[0].cells.size());

            JFormResponsesController.ResultPage second = JFormResponsesController.getSubmissions(formId, 2, 2, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(1, second.rows.size());

            JFormResponsesController.ResultPage errors = JFormResponsesController.getSubmissions(formId, 25, 0, 3, 'Error', null, null, null, null, null, null, null);
            Assert.areEqual(1, errors.total);
            Assert.areEqual('boom', errors.rows[0].errorMessage);
        }
    }

    @IsTest
    static void csvExport() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = formWithSubmissions();

            String csv = JFormResponsesController.exportCsv(formId, false, null, null);

            List<String> lines = csv.split('\n');
            Assert.areEqual(4, lines.size(), 'header + 3 rows');
            Assert.isTrue(lines[0].startsWith('Submission Id,Submitted,Status,Target Record Id,First name,Email'), lines[0]);
            Assert.isTrue(csv.contains('p0@example.com'));
            Assert.areEqual('a,"b,c","say ""hi"""', JFormResponsesController.csvLine(new List<String>{ 'a', 'b,c', 'say "hi"' }));
        }
    }

    @IsTest
    static void reprocessViaController() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = formWithSubmissions();
            Form_Submission__c errored = [SELECT Id FROM Form_Submission__c WHERE Form__c = :formId AND Status__c = 'Error' LIMIT 1];

            JFormSubmissionService.Result r = JFormResponsesController.reprocess(errored.Id);

            Assert.areEqual('Processed', r.status, 'no target object, so reprocessing simply clears the error');
            Assert.areEqual('Processed', [SELECT Status__c FROM Form_Submission__c WHERE Id = :errored.Id].Status__c);

            String message;
            try {
                JFormResponsesController.reprocess(errored.Id);
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isTrue(message != null && message.contains('already processed'), 'processed responses are never run twice: ' + message);
        }
    }

    @IsTest
    static void searchAndFilters() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = formWithSubmissions();
            JFormResponsesController.ResultPage all = JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(3, all.total);
            Assert.isTrue(all.fields.size() >= 4, 'every answer field is offered as a filter');
            JFormResponsesController.FilterField season;
            for (JFormResponsesController.FilterField f : all.fields) {
                if (f.key == 'season') season = f;
            }
            Assert.areEqual(new List<String>{ 'Summer', 'Autumn' }, season.options, 'choice fields carry their choices');

            // any answer, substring, case-insensitive
            Assert.areEqual(1, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, 'P1@EXAMPLE', null, null, null, null, null, null).total);
            Assert.areEqual(3, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, 'person', null, null, null, null, null, null).total);
            Assert.areEqual(0, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, 'nobody', null, null, null, null, null, null).total);
            // the submission number
            String subNumber = [SELECT Name FROM Form_Submission__c WHERE Form__c = :formId ORDER BY Name LIMIT 1].Name;
            Assert.areEqual(1, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, subNumber, null, null, null, null, null, null).total, subNumber);
            // one field
            Assert.areEqual(2, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, null, null, null, 'season', 'Summer', null, null).total);
            Assert.areEqual(1, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, null, null, null, 'season', 'autumn', null, null).total);
            // dates
            Assert.areEqual(3, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, null, Date.today(), Date.today(), null, null, null, null).total);
            Assert.areEqual(0, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, null, Date.today().addDays(1), null, null, null, null, null).total);
            Assert.areEqual(0, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, null, null, Date.today().addDays(-1), null, null, null, null).total);
            // combined with status
            JFormResponsesController.ResultPage combined = JFormResponsesController.getSubmissions(formId, 25, 0, 3, 'Error', 'person', Date.today(), Date.today(), null, null, null, null);
            Assert.areEqual(1, combined.total);
            Assert.areEqual('boom', combined.rows[0].errorMessage);
            // wildcards in the term are literal
            Assert.areEqual('%100\\%\\_x%', JFormResponsesController.likeContains('100%_x'));
            Assert.areEqual(0, JFormResponsesController.getSubmissions(formId, 25, 0, 3, null, '%', null, null, null, null, null, null).total);
        }
    }
}
