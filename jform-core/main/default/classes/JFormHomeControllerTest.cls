@IsTest
private class JFormHomeControllerTest {

    @IsTest
    static void countsFormsAndResponses() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form draft = JFormTestDataFactory.createSampleForm('Draft form');
            JFormDefinition.Form live = JFormTestDataFactory.sampleDefinition('Live form');
            live.targetObjectApiName = null;
            live = JFormDefinitionService.create(live);
            JFormPublishService.PublishResult pub = JFormPublishService.publish(live.id, null);
            for (Integer i = 0; i < 3; i++) {
                JFormPublicController.submit(pub.publicKey, JSON.serialize(new Map<String, Object>{
                    'first_name' => 'P' + i, 'email' => 'p' + i + '@example.com', 'season' => 'autumn'
                }));
            }
            Form_Submission__c old = [SELECT Id FROM Form_Submission__c WHERE Form__c = :live.id LIMIT 1];
            old.Submission_Date_Time__c = System.now().addDays(-30);
            old.Status__c = 'Error';
            update old;

            JFormHomeController.Overview o = JFormHomeController.getOverview(null);

            Assert.areEqual(2, o.formCount);
            Assert.areEqual(1, o.liveCount);
            Assert.areEqual(3, o.responsesTotal);
            Assert.areEqual(2, o.responses7Days);
            Assert.areEqual(1, o.errorCount);
            Assert.areEqual(2, o.recent.size());
            Map<Id, JFormHomeController.RecentForm> byId = new Map<Id, JFormHomeController.RecentForm>();
            for (JFormHomeController.RecentForm r : o.recent) {
                byId.put(r.id, r);
            }
            JFormHomeController.RecentForm liveRow = byId.get(live.id);
            Assert.isNotNull(liveRow, 'live form listed');
            Assert.isTrue(liveRow.isActive);
            Assert.areEqual(1, liveRow.version);
            Assert.areEqual(3, liveRow.responseCount);
            Assert.areEqual(2, liveRow.responses7Days);
            JFormHomeController.RecentForm draftRow = byId.get(draft.id);
            Assert.isNotNull(draftRow, 'draft form listed');
            Assert.isFalse(draftRow.isActive);
            Assert.areEqual(0, draftRow.responseCount);

            Assert.areEqual(1, JFormHomeController.getOverview(1).recent.size(), 'limit honoured');
        }
    }

    @IsTest
    static void emptyOrgReturnsZeros() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormHomeController.Overview o = JFormHomeController.getOverview(8);
            Assert.areEqual(0, o.formCount);
            Assert.areEqual(0, o.responsesTotal);
            Assert.isTrue(o.recent.isEmpty());
            Assert.areEqual(6, o.setupTotal, 'the finish-setup banner knows the checklist');
            Assert.isTrue(o.setupDone < o.setupTotal, 'no live form yet, so setup is not finished');
            Assert.isNotNull(o.agentInstalled);
        }
    }
}
