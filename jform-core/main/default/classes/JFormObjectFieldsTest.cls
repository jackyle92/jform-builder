@IsTest
private class JFormObjectFieldsTest {

    @IsTest
    static void leadStartsWithItsRequiredFields() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, JFormDefinition.Field> byTarget = new Map<String, JFormDefinition.Field>();
            for (JFormDefinition.Field f : JFormObjectFields.requiredFormFields('lead')) {
                byTarget.put(f.targetFieldApiName.toLowerCase(), f);
                Assert.isTrue(f.required, f.label + ' is required');
                Assert.areEqual('Lead', f.targetObjectApiName);
                Assert.isTrue(Pattern.matches('[a-z][a-z0-9_]*', f.key), 'readable key: ' + f.key);
            }
            Assert.isTrue(byTarget.containsKey('lastname'), 'Last Name: ' + byTarget.keySet());
            Assert.areEqual('text', byTarget.get('lastname').fieldType);
            Assert.isFalse(byTarget.containsKey('ownerid'), 'defaulted fields are left out');
            Assert.isFalse(byTarget.containsKey('status'), 'Status has a default');
        }
    }

    @IsTest
    static void namesComeFirstAndPicklistsBecomeDropdowns() {
        List<JFormDefinition.Field> fields = JFormObjectFields.requiredFormFields('Opportunity');
        Assert.isFalse(fields.isEmpty());
        Assert.areEqual('Name', fields[0].targetFieldApiName, 'the name leads the form');
        for (JFormDefinition.Field f : fields) {
            if (f.targetFieldApiName == 'StageName') {
                Assert.areEqual('picklist', f.fieldType);
                Assert.isFalse(f.options.isEmpty(), 'active stages become the choices');
            }
            if (f.targetFieldApiName == 'CloseDate') {
                Assert.areEqual('date', f.fieldType);
            }
        }
    }

    @IsTest
    static void unknownOrBlankObjectsGiveNothing() {
        Assert.isTrue(JFormObjectFields.requiredFormFields(null).isEmpty());
        Assert.isTrue(JFormObjectFields.requiredFormFields('  ').isEmpty());
        Assert.isTrue(JFormObjectFields.requiredFormFields('No_Such_Object__c').isEmpty());
    }

    @IsTest
    static void keysAreUnique() {
        Set<String> taken = new Set<String>();
        Assert.areEqual('last_name', JFormObjectFields.uniqueKey('Last Name', taken));
        Assert.areEqual('last_name_2', JFormObjectFields.uniqueKey('Last Name', taken));
        Assert.areEqual('field_2024', JFormObjectFields.uniqueKey('2024', taken));
        Assert.areEqual('field', JFormObjectFields.uniqueKey('', taken));
    }
}
