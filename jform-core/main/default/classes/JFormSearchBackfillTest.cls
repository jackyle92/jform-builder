@IsTest
private class JFormSearchBackfillTest {
    @IsTest
    static void fillsMissingSearchTextOnly() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Backfill');
            def.targetObjectApiName = null;
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{ 'first_name' => 'Old  Row', 'email' => 'old@example.com', 'season' => 'Summer', 'why_summer' => 'sun', 'nps' => 9 }));
            List<Submission_Field_Value__c> values = [SELECT Id, Search_Text__c FROM Submission_Field_Value__c WHERE Form_Submission__r.Form__c = :def.id];
            Assert.isTrue(values.size() >= 4);
            for (Submission_Field_Value__c v : values) {
                Assert.isNotNull(v.Search_Text__c, 'submit writes the search text');
                v.Search_Text__c = null; // pretend these rows predate the field
            }
            update values;

            Test.startTest();
            Database.executeBatch(new JFormSearchBackfill(), 200);
            Test.stopTest();

            Map<String, String> byKey = new Map<String, String>();
            for (Submission_Field_Value__c v : [SELECT Field_Key__c, Search_Text__c FROM Submission_Field_Value__c WHERE Form_Submission__r.Form__c = :def.id]) {
                byKey.put(v.Field_Key__c, v.Search_Text__c);
            }
            Assert.areEqual('Old Row', byKey.get('first_name'), 'whitespace collapsed');
            Assert.areEqual('old@example.com', byKey.get('email'));
            Assert.areEqual('x'.repeat(255), JFormSearchBackfill.searchText('x'.repeat(300)));
            Assert.isNull(JFormSearchBackfill.searchText('   '));
        }
    }
}
