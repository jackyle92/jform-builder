/**
 * Fills Submission_Field_Value__c.Search_Text__c for answers saved before the field existed,
 * so the Responses tab can search them. Run once per org after deploying:
 *   Database.executeBatch(new JFormSearchBackfill(), 2000);
 * Safe to run again: rows that already have a search text are skipped.
 */
public with sharing class JFormSearchBackfill implements Database.Batchable<SObject> {

    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([SELECT Id, Field_Value__c FROM Submission_Field_Value__c WHERE Search_Text__c = null]);
    }

    public void execute(Database.BatchableContext bc, List<Submission_Field_Value__c> scope) {
        List<Submission_Field_Value__c> changed = new List<Submission_Field_Value__c>();
        for (Submission_Field_Value__c v : scope) {
            String text = searchText(v.Field_Value__c);
            if (text != null) {
                changed.add(new Submission_Field_Value__c(Id = v.Id, Search_Text__c = text));
            }
        }
        if (!changed.isEmpty()) {
            Database.update(changed, false);
        }
    }

    public void finish(Database.BatchableContext bc) {}

    /** What the Responses tab searches: the answer's first 255 characters, whitespace collapsed. */
    public static String searchText(String value) {
        if (String.isBlank(value)) {
            return null;
        }
        return value.normalizeSpace().left(255);
    }
}
