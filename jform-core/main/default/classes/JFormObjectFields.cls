/**
 * Form fields for the fields an object needs before a record can be created, so a new form
 * that creates Leads starts with Last Name and Company already on it and mapped.
 * Runs as the user: only fields the user can create are offered.
 */
public with sharing class JFormObjectFields {

    /** Salesforce field type -> form field type; types a respondent cannot fill (lookups, checkboxes, ids) are left out. */
    private static final Map<Schema.DisplayType, String> FORM_TYPE = new Map<Schema.DisplayType, String>{
        Schema.DisplayType.STRING => 'text', Schema.DisplayType.COMBOBOX => 'text', Schema.DisplayType.URL => 'text',
        Schema.DisplayType.EMAIL => 'email', Schema.DisplayType.PHONE => 'phone', Schema.DisplayType.TEXTAREA => 'comment',
        Schema.DisplayType.PICKLIST => 'picklist', Schema.DisplayType.MULTIPICKLIST => 'checkboxes',
        Schema.DisplayType.DATE => 'date', Schema.DisplayType.DATETIME => 'date', Schema.DisplayType.TIME => 'time',
        Schema.DisplayType.INTEGER => 'number', Schema.DisplayType.DOUBLE => 'number', Schema.DisplayType.CURRENCY => 'number',
        Schema.DisplayType.PERCENT => 'number', Schema.DisplayType.LONG => 'number'
    };
    /** Name fields lead the form, in this order; the rest follow by label. */
    private static final List<String> NAME_FIELDS = new List<String>{ 'firstname', 'lastname', 'name' };

    public static List<JFormDefinition.Field> requiredFormFields(String objectApiName) {
        List<JFormDefinition.Field> out = new List<JFormDefinition.Field>();
        if (String.isBlank(objectApiName)) {
            return out;
        }
        Schema.SObjectType t = JFormSchema.globalDescribe().get(objectApiName.trim().toLowerCase());
        if (t == null) {
            return out;
        }
        Schema.DescribeSObjectResult od = t.getDescribe();
        Map<String, Schema.DescribeFieldResult> byLabel = new Map<String, Schema.DescribeFieldResult>();
        for (Schema.SObjectField sf : od.fields.getMap().values()) {
            Schema.DescribeFieldResult d = sf.getDescribe();
            if (d.isCreateable() && !d.isNillable() && !d.isDefaultedOnCreate() && FORM_TYPE.containsKey(d.getType())) {
                byLabel.put(sortKey(d), d);
            }
        }
        List<String> order = new List<String>(byLabel.keySet());
        order.sort();
        Set<String> keys = new Set<String>();
        for (String k : order) {
            Schema.DescribeFieldResult d = byLabel.get(k);
            JFormDefinition.Field f = new JFormDefinition.Field();
            f.label = d.getLabel();
            f.key = uniqueKey(d.getLabel(), keys);
            f.fieldType = FORM_TYPE.get(d.getType());
            f.required = true;
            f.targetObjectApiName = od.getName();
            f.targetFieldApiName = d.getName();
            if (f.fieldType == 'picklist' || f.fieldType == 'checkboxes') {
                f.options = new List<JFormDefinition.Option>();
                for (Schema.PicklistEntry e : d.getPicklistValues()) {
                    if (e.isActive()) {
                        JFormDefinition.Option o = new JFormDefinition.Option();
                        o.label = e.getLabel();
                        o.value = e.getValue();
                        f.options.add(o);
                    }
                }
                if (f.options.isEmpty()) {
                    f.fieldType = 'text';
                    f.options = null;
                }
            }
            out.add(f);
        }
        return out;
    }

    private static String sortKey(Schema.DescribeFieldResult d) {
        Integer i = NAME_FIELDS.indexOf(d.getName().toLowerCase());
        return (i < 0 ? '9' : String.valueOf(i)) + d.getLabel().toLowerCase() + '|' + d.getName();
    }

    /** "Last Name" -> last_name, unique within the set. */
    @TestVisible
    private static String uniqueKey(String label, Set<String> taken) {
        String base = String.isBlank(label) ? 'field' : label.toLowerCase().replaceAll('[^a-z0-9]+', '_').replaceAll('^_+|_+$', '');
        if (String.isBlank(base) || !Pattern.matches('[a-z].*', base)) {
            base = 'field_' + base;
        }
        base = base.left(50);
        String key = base;
        Integer n = 2;
        while (taken.contains(key)) {
            key = base + '_' + n++;
        }
        taken.add(key);
        return key;
    }
}
