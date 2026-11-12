/**
 * Schema.getGlobalDescribe() is slow in orgs with many objects, so JForm reads it once per transaction.
 * The cached map is the platform's own (case-insensitive keys), so object names resolve exactly as
 * before, with and without the namespace.
 */
public inherited sharing class JFormSchema {

    private static Map<String, Schema.SObjectType> cached;

    public static Map<String, Schema.SObjectType> globalDescribe() {
        if (cached == null) {
            cached = Schema.getGlobalDescribe();
        }
        return cached;
    }
}
