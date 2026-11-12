@IsTest
private class JFormChangeEventsTest {
    @IsTest
    static void publishesWithTheClientAndUser() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = JFormTestDataFactory.createSampleForm('Events').id;
            JFormChangeEvents.published.clear();
            JFormChangeEvents.clientId = 'tab-1';
            Test.startTest();
            JFormChangeEvents.publish(formId, 7, 'saved');
            JFormChangeEvents.clientId = null;
            JFormChangeEvents.publish(formId, 8, 'published');
            JFormChangeEvents.publish(null, 9, 'saved'); // ignored
            Test.stopTest();
            Assert.areEqual(2, JFormChangeEvents.published.size());
            Form_Changed__e first = JFormChangeEvents.published[0];
            Assert.areEqual(String.valueOf(formId), first.Form_Id__c);
            Assert.areEqual(7, first.Revision__c);
            Assert.areEqual('saved', first.Change__c);
            Assert.areEqual('tab-1', first.Client_Id__c);
            Assert.areEqual(UserInfo.getUserId(), first.Changed_By__c);
            Assert.isNull(JFormChangeEvents.published[1].Client_Id__c, 'no client id outside the workspace');
        }
    }
}
