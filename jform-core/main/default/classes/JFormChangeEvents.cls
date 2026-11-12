/**
 * Tells open workspaces that a form changed. One Form_Changed__e per save, publish
 * or unpublish, carrying the new revision and the tab that made the change (empty for the
 * JForm Assistant and API callers), so a tab can ignore its own changes and reload on
 * everyone else's. Publishing never fails the caller's transaction.
 */
public with sharing class JFormChangeEvents {

    /** Set by the workspace controller for the current request; null elsewhere. */
    public static String clientId;
    /** Everything published in this transaction, for tests (PublishAfterCommit events cannot be queried). */
    @TestVisible private static List<Form_Changed__e> published = new List<Form_Changed__e>();

    public static void publish(Id formId, Integer revision, String change) {
        if (formId == null) {
            return;
        }
        Form_Changed__e evt = new Form_Changed__e(
            Form_Id__c = formId,
            Revision__c = revision,
            Change__c = change,
            Client_Id__c = String.isBlank(clientId) ? null : clientId.left(64),
            Changed_By__c = UserInfo.getUserId()
        );
        published.add(evt);
        try {
            Database.SaveResult sr = EventBus.publish(evt);
            if (!sr.isSuccess()) {
                System.debug(LoggingLevel.WARN, 'JForm change event not published: ' + sr.getErrors());
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'JForm change event not published: ' + e.getMessage());
        }
    }
}
