/**
 * The package namespace at run time: "jform" in the managed package, empty when JForm is
 * deployed from source. Use it wherever an API name, tab name or page-state key is built as a
 * string; compiled references (Form__c, Form__c.Name) resolve on their own.
 */
public with sharing class JFormNamespace {
    /** "jform" or "". */
    public static final String NAME = JFormNamespace.class.getName().contains('.')
        ? JFormNamespace.class.getName().substringBefore('.')
        : '';
    /** "jform__" or "". */
    public static final String PREFIX = String.isBlank(NAME) ? '' : NAME + '__';

    /** Form__c → jform__Form__c in the package; tab and event names work the same way. */
    public static String qualify(String apiName) {
        return PREFIX + apiName;
    }

    /** Lightning page-state keys must carry the component's namespace: c__formid, or jform__formid in the package. */
    public static String stateKey(String key) {
        // (parameter is not called "name": Apex is case-insensitive and it would hide NAME)
        return (String.isBlank(NAME) ? 'c' : NAME) + '__' + key;
    }
}
