/** Overview numbers and recent forms for the JForm home page. Runs as the user. */
public with sharing class JFormHomeController {

    public class Overview {
        @AuraEnabled public Integer formCount = 0;
        @AuraEnabled public Integer liveCount = 0;
        @AuraEnabled public Integer responsesTotal = 0;
        @AuraEnabled public Integer responses7Days = 0;
        @AuraEnabled public Integer errorCount = 0;
        /** Responses flagged as spam, not counted anywhere else. */
        @AuraEnabled public Integer spamCount = 0;
        @AuraEnabled public List<RecentForm> recent = new List<RecentForm>();
        /** JForm Agent installed: only then are the Agentforce prompts offered. */
        @AuraEnabled public Boolean agentInstalled = false;
        /** Setup checklist progress, for the "finish setup" banner. Null when it could not be worked out. */
        @AuraEnabled public Integer setupDone;
        @AuraEnabled public Integer setupTotal;
    }

    public class RecentForm {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String status;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public Integer version;
        @AuraEnabled public String publicKey;
        @AuraEnabled public Datetime lastModified;
        @AuraEnabled public Integer responseCount = 0;
        @AuraEnabled public Integer responses7Days = 0;
    }

    @AuraEnabled
    public static Overview getOverview(Integer recentLimit) {
        try {
            Integer max = recentLimit == null ? 8 : Math.min(Math.max(recentLimit, 1), 50);
            Datetime weekAgo = System.now().addDays(-7);
            Overview o = new Overview();
            o.agentInstalled = JFormGenerationService.agentInstalled();
            try {
                JFormSetupController.Status setup = JFormSetupController.computeStatus();
                o.setupDone = setup.done;
                o.setupTotal = setup.total;
            } catch (Exception e) {
                o.setupDone = null; // the banner is a convenience; Home works without it
            }
            o.formCount = [SELECT COUNT() FROM Form__c WITH USER_MODE];
            o.liveCount = [SELECT COUNT() FROM Form__c WHERE Is_Active__c = true WITH USER_MODE];
            o.responsesTotal = [SELECT COUNT() FROM Form_Submission__c WHERE Status__c != 'Spam' WITH USER_MODE];
            o.responses7Days = [SELECT COUNT() FROM Form_Submission__c WHERE Submission_Date_Time__c >= :weekAgo AND Status__c != 'Spam' WITH USER_MODE];
            o.errorCount = [SELECT COUNT() FROM Form_Submission__c WHERE Status__c = 'Error' WITH USER_MODE];
            o.spamCount = [SELECT COUNT() FROM Form_Submission__c WHERE Status__c = 'Spam' WITH USER_MODE];

            Map<Id, RecentForm> byId = new Map<Id, RecentForm>();
            for (Form__c f : [
                SELECT Id, Name, Status__c, Is_Active__c, Version__c, Public_Key__c, LastModifiedDate
                FROM Form__c
                WITH USER_MODE
                ORDER BY LastModifiedDate DESC
                LIMIT :max
            ]) {
                RecentForm r = new RecentForm();
                r.id = f.Id;
                r.name = f.Name;
                r.status = f.Status__c;
                r.isActive = f.Is_Active__c == true;
                r.version = f.Version__c == null ? null : f.Version__c.intValue();
                r.publicKey = f.Public_Key__c;
                r.lastModified = f.LastModifiedDate;
                byId.put(f.Id, r);
                o.recent.add(r);
            }
            if (!byId.isEmpty()) {
                for (AggregateResult ar : [
                    SELECT Form__c formId, COUNT(Id) total
                    FROM Form_Submission__c
                    WHERE Form__c IN :byId.keySet() AND Status__c != 'Spam'
                    WITH USER_MODE
                    GROUP BY Form__c
                ]) {
                    byId.get((Id) ar.get('formId')).responseCount = (Integer) ar.get('total');
                }
                for (AggregateResult ar : [
                    SELECT Form__c formId, COUNT(Id) total
                    FROM Form_Submission__c
                    WHERE Form__c IN :byId.keySet() AND Submission_Date_Time__c >= :weekAgo AND Status__c != 'Spam'
                    WITH USER_MODE
                    GROUP BY Form__c
                ]) {
                    byId.get((Id) ar.get('formId')).responses7Days = (Integer) ar.get('total');
                }
            }
            return o;
        } catch (Exception e) {
            AuraHandledException ex = new AuraHandledException(e.getMessage());
            ex.setMessage(e.getMessage());
            throw ex;
        }
    }
}
