@IsTest
private class JFormNamespaceTest {
    @IsTest
    static void agreesWithTheSchema() {
        Assert.areEqual(Form__c.SObjectType.getDescribe().getName(), JFormNamespace.qualify('Form__c'), 'the prefix is the one the platform uses');
        Assert.areEqual(Form_Changed__e.SObjectType.getDescribe().getName(), JFormNamespace.qualify('Form_Changed__e'));
        String expectedKey = (String.isBlank(JFormNamespace.NAME) ? 'c' : JFormNamespace.NAME) + '__formid';
        Assert.areEqual(expectedKey, JFormNamespace.stateKey('formid'));
    }
}
