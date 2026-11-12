/**
 * Publishing: snapshot the current definition into Form_Version__c, mint the
 * public key on first publish, and point Form__c at the new version.
 */
public with sharing class JFormPublishService {

    public class PublishResult {
        @AuraEnabled public Id formId;
        @AuraEnabled public Id versionId;
        @AuraEnabled public Integer versionNumber;
        @AuraEnabled public String publicKey;
        @AuraEnabled public String status;
        /** The form's save counter after this change; the workspace sends it with its next save. */
        @AuraEnabled public Integer revision;
    }

    public static PublishResult publish(Id formId, String changeSummary) {
        JFormDefinitionService.lockForEdit(formId); // a save arriving meanwhile waits, so the snapshot is what gets published
        JFormDefinition.Form def = JFormDefinitionService.load(formId);
        if (def.fieldCount() == 0) {
            throw new JFormDefinition.JFormException('Cannot publish a form with no fields.');
        }
        JFormDefinitionService.validate(def);
        // a Payment block needs its prices
        List<String> paymentProblems = JFormPaymentService.publishProblems(def);
        if (!paymentProblems.isEmpty()) {
            throw new JFormDefinition.JFormException(String.join(paymentProblems, ' '));
        }

        Form__c form = [
            SELECT Id, Public_Key__c, Version__c, Revision__c, (SELECT Version_Number__c FROM Form_Versions__r ORDER BY Version_Number__c DESC LIMIT 1)
            FROM Form__c WHERE Id = :formId WITH USER_MODE LIMIT 1
        ];
        Integer nextVersion = 1;
        if (!form.Form_Versions__r.isEmpty() && form.Form_Versions__r[0].Version_Number__c != null) {
            nextVersion = form.Form_Versions__r[0].Version_Number__c.intValue() + 1;
        } else if (form.Version__c != null && form.Version__c > 0) {
            nextVersion = form.Version__c.intValue() + 1;
        }
        String publicKey = String.isBlank(form.Public_Key__c) ? mintPublicKey() : form.Public_Key__c;

        Integer nextRevision = (form.Revision__c == null ? 0 : form.Revision__c.intValue()) + 1;
        def.version = nextVersion;
        def.revision = nextRevision;
        def.publicKey = publicKey;
        def.status = 'Active';
        def.isActive = true;

        Savepoint sp = Database.setSavepoint();
        try {
            Form_Version__c version = new Form_Version__c(
                Form__c = formId,
                Version_Number__c = nextVersion,
                Definition_JSON__c = def.serialize(),
                Published_Date__c = System.now(),
                Published_By__c = UserInfo.getUserId(),
                Change_Summary__c = changeSummary
            );
            Database.insert(version, AccessLevel.USER_MODE);

            Form__c formUpdate = new Form__c(
                Id = formId,
                Public_Key__c = publicKey,
                Status__c = 'Active',
                Is_Active__c = true,
                Version__c = nextVersion,
                Revision__c = nextRevision,
                Current_Version__c = version.Id
            );
            Database.update(formUpdate, AccessLevel.USER_MODE);
            JFormChangeEvents.publish(formId, nextRevision, 'published');

            PublishResult r = new PublishResult();
            r.formId = formId;
            r.versionId = version.Id;
            r.versionNumber = nextVersion;
            r.publicKey = publicKey;
            r.status = 'Active';
            r.revision = nextRevision;
            return r;
        } catch (Exception e) {
            Database.rollback(sp);
            throw e;
        }
    }

    public static PublishResult unpublish(Id formId) {
        Form__c form = [SELECT Id, Public_Key__c, Version__c, Revision__c FROM Form__c WHERE Id = :formId WITH USER_MODE LIMIT 1];
        Integer nextRevision = (form.Revision__c == null ? 0 : form.Revision__c.intValue()) + 1;
        Database.update(new Form__c(Id = formId, Status__c = 'Inactive', Is_Active__c = false, Revision__c = nextRevision), AccessLevel.USER_MODE);
        JFormChangeEvents.publish(formId, nextRevision, 'unpublished');
        PublishResult r = new PublishResult();
        r.formId = formId;
        r.publicKey = form.Public_Key__c;
        r.versionNumber = form.Version__c == null ? null : form.Version__c.intValue();
        r.status = 'Inactive';
        r.revision = nextRevision;
        return r;
    }

    /** 12 URL-safe characters from a random AES key. Uniqueness is enforced by the field. */
    @TestVisible
    private static String mintPublicKey() {
        String hex = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
        return hex.substring(0, 12);
    }
}
