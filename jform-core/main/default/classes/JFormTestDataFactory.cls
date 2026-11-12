@IsTest
public class JFormTestDataFactory {

    /**
     * A Standard User holding only the ACCESS_FORM_BUILDER permission set, the way a
     * marketing user is set up. The services run in user mode, so this is what proves the
     * permission set is sufficient; an administrator profile would hide every gap.
     * Wrap test bodies in System.runAs(builderUser()) to avoid mixed DML with the setup objects created here.
     */
    public static User builderUser() {
        Profile admin = standardUserProfile();
        String unique = String.valueOf(Math.abs(Crypto.getRandomInteger()));
        User u = new User(
            Alias = 'jform',
            Email = 'jform.tester@example.com',
            EmailEncodingKey = 'UTF-8',
            FirstName = 'JForm',
            LastName = 'Tester',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            ProfileId = admin.Id,
            TimeZoneSidKey = 'Europe/London',
            Username = 'jform.tester.' + unique + '@example.com'
        );
        insert u;
        PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'ACCESS_FORM_BUILDER' LIMIT 1];
        insert new List<PermissionSetAssignment>{
            new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id),
            new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = standardFieldAccess(unique).Id)
        };
        return u;
    }

    /**
     * A builder whose profile has no View Setup and Configuration (Standard User has it in some orgs),
     * for proving that builder screens work in user mode without setup rights. Found by permissions, not by name.
     */
    public static User builderWithoutViewSetup() {
        List<Profile> profiles = [
            SELECT Id FROM Profile
            WHERE UserLicense.Name = 'Salesforce' AND PermissionsViewSetup = false AND PermissionsModifyAllData = false
            ORDER BY Name LIMIT 1
        ];
        Assert.isFalse(profiles.isEmpty(), 'the org needs a Salesforce profile without View Setup for this test');
        String unique = String.valueOf(Math.abs(Crypto.getRandomInteger()));
        User u = new User(
            Alias = 'jfnosu',
            Email = 'jform.nosetup@example.com',
            EmailEncodingKey = 'UTF-8',
            FirstName = 'JForm',
            LastName = 'NoSetup',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            ProfileId = profiles[0].Id,
            TimeZoneSidKey = 'Europe/London',
            Username = 'jform.nosetup.' + unique + '@example.com'
        );
        insert u;
        PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'ACCESS_FORM_BUILDER' LIMIT 1];
        insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
        return u;
    }

    /** A Standard User with no JForm permission set, for tests that grant access. */
    public static User plainUser(String lastName) {
        String unique = String.valueOf(Math.abs(Crypto.getRandomInteger()));
        User u = new User(
            Alias = 'jplain',
            Email = 'jform.plain@example.com',
            EmailEncodingKey = 'UTF-8',
            FirstName = 'Plain',
            LastName = lastName,
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            ProfileId = standardUserProfile().Id,
            TimeZoneSidKey = 'Europe/London',
            Username = 'jform.plain.' + unique + '@example.com'
        );
        insert u;
        return u;
    }

    /**
     * The Standard User profile. Standard profile names are translated in orgs whose default
     * language is not English ("標準使用者"), so when the English name finds nothing, take a
     * non-admin Salesforce-licence profile that can create Leads, found through its object
     * permissions, which do not depend on the language.
     */
    private static Profile standardUserProfile() {
        List<Profile> byName = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        if (!byName.isEmpty()) {
            return byName[0];
        }
        for (ObjectPermissions op : [
            SELECT Parent.ProfileId, Parent.Profile.Name FROM ObjectPermissions
            WHERE SobjectType = 'Lead' AND PermissionsCreate = true AND PermissionsModifyAllRecords = false
                AND Parent.IsOwnedByProfile = true AND Parent.Profile.UserLicense.Name = 'Salesforce'
                AND Parent.PermissionsModifyAllData = false AND Parent.PermissionsCustomizeApplication = false
            ORDER BY Parent.Profile.Name
        ]) {
            return new Profile(Id = op.Parent.ProfileId);
        }
        throw new JFormDefinition.JFormException('No non-admin Salesforce profile that can create Leads was found for the test user.');
    }

    /**
     * Record steps are validated against the saving user's field-level security, so the test
     * builder needs the kind of CRM field access a real marketing user has. The Standard User
     * profile varies by org; this grants the fields the tests map to explicitly.
     */
    private static PermissionSet standardFieldAccess(String unique) {
        PermissionSet fls = new PermissionSet(Name = 'JForm_Test_Fields_' + unique, Label = 'JForm test field access');
        insert fls;
        Map<String, List<String>> fieldsByObject = new Map<String, List<String>>{
            'Lead' => new List<String>{ 'FirstName', 'Email', 'Description', 'DoNotCall', 'Phone', 'MobilePhone', 'AnnualRevenue', 'NumberOfEmployees', 'Website', 'Title', 'Status', 'LeadSource' },
            'Contact' => new List<String>{ 'FirstName', 'Email', 'AccountId', 'Description', 'Phone', 'MobilePhone', 'Title' },
            'Account' => new List<String>{ 'Phone', 'Website', 'Description', 'Industry' },
            'Case' => new List<String>{ 'Subject', 'Description', 'Priority', 'Origin', 'ContactId', 'AccountId', 'Status', 'SuppliedEmail' },
            'Task' => new List<String>{ 'Subject', 'Description', 'Priority', 'Status', 'WhoId', 'WhatId', 'ActivityDate' }
        };
        List<ObjectPermissions> objectPerms = new List<ObjectPermissions>();
        List<FieldPermissions> fieldPerms = new List<FieldPermissions>();
        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
        for (String obj : fieldsByObject.keySet()) {
            objectPerms.add(new ObjectPermissions(ParentId = fls.Id, SobjectType = obj, PermissionsRead = true, PermissionsCreate = true, PermissionsEdit = true));
            Map<String, Schema.SObjectField> fieldMap = globalDescribe.get(obj).getDescribe().fields.getMap();
            for (String f : fieldsByObject.get(obj)) {
                Schema.SObjectField token = fieldMap.get(f.toLowerCase());
                if (token != null && token.getDescribe().isPermissionable()) {
                    fieldPerms.add(new FieldPermissions(ParentId = fls.Id, SobjectType = obj, Field = obj + '.' + token.getDescribe().getName(), PermissionsRead = true, PermissionsEdit = true));
                }
            }
        }
        // Activities (Task) take no ObjectPermissions row and some fields are not permissionable in
        // every org: grant what the org accepts, the tests show whatever is still missing.
        Database.insert(objectPerms, false);
        Database.insert(fieldPerms, false);
        return fls;
    }

    /** A two-page form: contact details, then a survey with a conditional comment field. */
    public static JFormDefinition.Form sampleDefinition(String name) {
        JFormDefinition.Form def = new JFormDefinition.Form();
        def.name = name;
        def.label = name;
        def.description = 'Created by JFormTestDataFactory';
        def.targetObjectApiName = 'Lead';
        def.welcomeMessage = 'Welcome';
        def.thankYouMessage = 'Thanks!';
        def.theme = new JFormDefinition.Theme();
        def.theme.primaryColor = '#0F766E';
        def.theme.background = '#F1F5F4';
        def.theme.extra.put('labelColor', '#334155');
        def.settings = new Map<String, Object>{ 'honeypot' => true };

        JFormDefinition.Section contact = new JFormDefinition.Section();
        contact.key = 'contact';
        contact.name = 'Contact details';
        contact.label = 'Contact details';

        JFormDefinition.Field intro = new JFormDefinition.Field();
        intro.key = 'intro';
        intro.fieldType = 'richtext';
        intro.richtext = '<h2>Tell us about you</h2>';
        contact.fields.add(intro);

        JFormDefinition.Field firstName = new JFormDefinition.Field();
        firstName.key = 'first_name';
        firstName.fieldType = 'text';
        firstName.label = 'First name';
        firstName.required = true;
        firstName.targetFieldApiName = 'FirstName';
        firstName.width = 50;
        contact.fields.add(firstName);

        JFormDefinition.Field email = new JFormDefinition.Field();
        email.key = 'email';
        email.fieldType = 'email';
        email.label = 'Email';
        email.required = true;
        email.targetFieldApiName = 'Email';
        email.validation = new JFormDefinition.Validation();
        email.validation.regexPattern = '^[^@]+@[^@]+$';
        email.validation.errorMessage = 'Enter a valid email';
        contact.fields.add(email);
        def.sections.add(contact);

        JFormDefinition.Section survey = new JFormDefinition.Section();
        survey.key = 'survey';
        survey.name = 'Survey';
        survey.label = 'Survey';

        JFormDefinition.Field season = new JFormDefinition.Field();
        season.key = 'season';
        season.fieldType = 'picklist';
        season.label = 'Which season did you attend?';
        season.required = true;
        season.options = new List<JFormDefinition.Option>();
        JFormDefinition.Option summer = new JFormDefinition.Option();
        summer.label = 'Summer';
        season.options.add(summer);
        JFormDefinition.Option autumn = new JFormDefinition.Option();
        autumn.label = 'Autumn';
        autumn.value = 'autumn';
        season.options.add(autumn);
        survey.fields.add(season);

        JFormDefinition.Field whySummer = new JFormDefinition.Field();
        whySummer.key = 'why_summer';
        whySummer.fieldType = 'comment';
        whySummer.label = 'What did you like about summer?';
        whySummer.required = true; // only enforced when visible
        whySummer.conditionalLogic = rule('show', 'all', 'season', 'equals', 'Summer');
        survey.fields.add(whySummer);

        JFormDefinition.Field nps = new JFormDefinition.Field();
        nps.key = 'nps';
        nps.fieldType = 'nps';
        nps.label = 'How likely are you to recommend us?';
        survey.fields.add(nps);
        def.sections.add(survey);

        return def;
    }

    public static JFormDefinition.Rule rule(String action, String match, String field, String operator, String value) {
        JFormDefinition.Rule r = new JFormDefinition.Rule();
        r.action = action;
        r.match = match;
        JFormDefinition.Condition c = new JFormDefinition.Condition();
        c.field = field;
        c.operator = operator;
        c.value = value;
        r.conditions.add(c);
        return r;
    }

    /** Creates the sample form in the database and returns the saved definition. */
    public static JFormDefinition.Form createSampleForm(String name) {
        return JFormDefinitionService.create(sampleDefinition(name));
    }

    public static JFormPublishService.PublishResult createAndPublish(String name) {
        JFormDefinition.Form def = createSampleForm(name);
        return JFormPublishService.publish(def.id, 'initial');
    }
}
