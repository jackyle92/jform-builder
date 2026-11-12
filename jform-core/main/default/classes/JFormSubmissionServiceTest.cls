@IsTest
private class JFormSubmissionServiceTest {

    /** Sample form plus the Lead fields a Lead insert needs, published. */
    private static JFormPublishService.PublishResult leadForm(String name, String strategy, String matchField) {
        return leadForm(name, strategy, matchField, true);
    }

    private static JFormPublishService.PublishResult leadForm(String name, String strategy, String matchField, Boolean lastNameRequired) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition(name);
        JFormDefinition.Field lastName = new JFormDefinition.Field();
        lastName.key = 'last_name';
        lastName.fieldType = 'text';
        lastName.label = 'Last name';
        lastName.required = lastNameRequired;
        lastName.targetFieldApiName = 'LastName';
        JFormDefinition.Field company = new JFormDefinition.Field();
        company.key = 'company';
        company.fieldType = 'text';
        company.label = 'Company';
        company.targetFieldApiName = 'Company';
        JFormDefinition.Field consent = new JFormDefinition.Field();
        consent.key = 'consent';
        consent.fieldType = 'consent';
        consent.label = 'Do not call';
        consent.targetFieldApiName = 'DoNotCall';
        def.sections[0].fields.add(lastName);
        def.sections[0].fields.add(company);
        def.sections[0].fields.add(consent);
        def.settings = new Map<String, Object>{ 'target' => new Map<String, Object>{ 'strategy' => strategy, 'matchField' => matchField } };
        def = JFormDefinitionService.create(def);
        return JFormPublishService.publish(def.id, null);
    }

    private static Map<String, Object> answers() {
        return new Map<String, Object>{
            'first_name' => 'Noah', 'last_name' => 'Lee', 'email' => 'noah.lee@example.com', 'company' => 'Riverside',
            'season' => 'Summer', 'why_summer' => 'The weather', 'nps' => 9, 'consent' => true
        };
    }

    @IsTest
    static void createsTargetRecordAndStoresAnswers() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = leadForm('Lead capture', 'create', null);
            Form__c form = [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :r.formId];
            JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, def, answers(), 'https://example.com/clinic?utm_campaign=summer');
            Test.stopTest();

            Assert.areEqual('Processed', res.status, 'error: ' + res.errorMessage);
            Assert.isNotNull(res.targetRecordId);
            Lead lead = [SELECT FirstName, LastName, Email, Company, DoNotCall FROM Lead WHERE Id = :res.targetRecordId];
            Assert.areEqual('Noah', lead.FirstName);
            Assert.areEqual('Lee', lead.LastName);
            Assert.areEqual('noah.lee@example.com', lead.Email);
            Assert.areEqual('Riverside', lead.Company);
            Assert.isTrue(lead.DoNotCall, 'boolean coerced');

            Form_Submission__c sub = [SELECT Status__c, Target_Record_Id__c, Source_URL__c, Processed_Date__c, Error_Message__c FROM Form_Submission__c WHERE Id = :res.submissionId];
            Assert.areEqual('Processed', sub.Status__c);
            Assert.areEqual(res.targetRecordId, sub.Target_Record_Id__c);
            Assert.isTrue(sub.Source_URL__c.contains('utm_campaign=summer'));
            Assert.isNotNull(sub.Processed_Date__c);
            Assert.isNull(sub.Error_Message__c);
            Assert.areEqual(8, [SELECT COUNT() FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId], 'visible answer fields stored (why_summer visible because season = Summer)');
        }
    }

    @IsTest
    static void updateOrCreateMatchesOnEmail() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            insert new Lead(FirstName = 'Old', LastName = 'Record', Company = 'Before', Email = 'noah.lee@example.com');
            JFormPublishService.PublishResult r = leadForm('Match', 'update_or_create', 'Email');
            Form__c form = [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :r.formId];
            JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);

            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, def, answers(), null);

            Assert.areEqual('Processed', res.status, 'error: ' + res.errorMessage);
            Assert.areEqual(1, [SELECT COUNT() FROM Lead WHERE Email = 'noah.lee@example.com'], 'no duplicate created');
            Lead lead = [SELECT FirstName, Company FROM Lead WHERE Id = :res.targetRecordId];
            Assert.areEqual('Noah', lead.FirstName, 'existing record updated');
            Assert.areEqual('Riverside', lead.Company);
        }
    }

    @IsTest
    static void targetFailureIsRecordedNotThrown() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            // the plain sample form maps FirstName and Email only: Lead insert fails on LastName/Company
            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Partial');
            Form__c form = [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :r.formId];
            JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);

            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, def, new Map<String, Object>{ 'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn' }, null);

            Assert.areEqual('Error', res.status);
            Assert.isNotNull(res.errorMessage);
            Form_Submission__c sub = [SELECT Status__c, Error_Message__c FROM Form_Submission__c WHERE Id = :res.submissionId];
            Assert.areEqual('Error', sub.Status__c);
            Assert.isTrue(sub.Error_Message__c.length() > 0);
            Assert.areEqual(4, [SELECT COUNT() FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId], 'visible fields stored (why_summer hidden because season is autumn)');
            Assert.areEqual(0, [SELECT COUNT() FROM Lead], 'no partial Lead');
        }
    }

    @IsTest
    static void noTargetObjectMeansProcessed() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('No target');
            def.targetObjectApiName = null;
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            Form__c form = [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :r.formId];

            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c), new Map<String, Object>{ 'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn' }, null);

            Assert.areEqual('Processed', res.status);
            Assert.isNull(res.targetRecordId);
        }
    }

    @IsTest
    static void reprocessFixesAnErroredSubmission() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = leadForm('Retry', 'create', null, false);
            Form__c form = [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :r.formId];
            JFormDefinition.Form def = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
            Map<String, Object> a = answers();
            a.put('last_name', ''); // optional on the form, required on Lead: the insert fails
            JFormSubmissionService.Result first = JFormSubmissionService.submit(form, def, a, null);
            Assert.areEqual('Error', first.status);
            Assert.isTrue(first.errorMessage.containsIgnoreCase('LastName') || first.errorMessage.containsIgnoreCase('Last Name'), first.errorMessage);

            // fix the stored answer, then reprocess
            Submission_Field_Value__c lastName = [SELECT Id FROM Submission_Field_Value__c WHERE Form_Submission__c = :first.submissionId AND Field_Key__c = 'last_name'];
            lastName.Field_Value__c = 'Lee';
            update lastName;

            Test.startTest();
            JFormSubmissionService.Result second = JFormSubmissionService.reprocess(first.submissionId);
            Test.stopTest();

            Assert.areEqual('Processed', second.status, 'error: ' + second.errorMessage);
            Assert.isNotNull(second.targetRecordId);
            Assert.areEqual('Lee', [SELECT LastName FROM Lead WHERE Id = :second.targetRecordId].LastName);
            Assert.areEqual('Processed', [SELECT Status__c FROM Form_Submission__c WHERE Id = :first.submissionId].Status__c);
        }
    }

    @IsTest
    static void attachFileLinksToSubmission() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Files');
            Form_Submission__c sub = new Form_Submission__c(Form__c = r.formId, Status__c = 'New', Submission_Date_Time__c = System.now());
            insert sub;
            insert new Submission_Field_Value__c(Form_Submission__c = sub.Id, Field_Key__c = 'photo', Field_Label__c = 'Photo');

            Id docId = JFormSubmissionService.attachFile(sub.Id, 'photo', 'team.png', EncodingUtil.base64Encode(Blob.valueOf('png bytes')));

            Assert.isNotNull(docId);
            Assert.areEqual(1, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :sub.Id AND ContentDocumentId = :docId]);
            Assert.areEqual('team.png', [SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :sub.Id AND Field_Key__c = 'photo'].Field_Value__c);
            JFormSubmissionService.attachFile(sub.Id, 'photo', 'second.png', EncodingUtil.base64Encode(Blob.valueOf('more')));
            Assert.areEqual('team.png; second.png', [SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :sub.Id AND Field_Key__c = 'photo'].Field_Value__c);
        }
    }

    @IsTest
    static void coercesTypes() {
        Map<String, Schema.SObjectField> leadFields = Schema.SObjectType.Lead.fields.getMap();
        Assert.areEqual(true, JFormSubmissionService.coerce(leadFields.get('donotcall').getDescribe(), 'Yes'));
        Assert.areEqual(false, JFormSubmissionService.coerce(leadFields.get('donotcall').getDescribe(), 'no'));
        Assert.areEqual(12.5, JFormSubmissionService.coerce(leadFields.get('annualrevenue').getDescribe(), '12.5'));
        Assert.isNull(JFormSubmissionService.coerce(leadFields.get('annualrevenue').getDescribe(), 'abc'), 'bad number ignored');
        Assert.areEqual(3, JFormSubmissionService.coerce(leadFields.get('numberofemployees').getDescribe(), '3'));
        Assert.isNull(JFormSubmissionService.coerce(leadFields.get('email').getDescribe(), ''));
        Assert.areEqual('a;b', JFormSubmissionService.coerce(Form_Field_Definition__c.Field_Type__c.getDescribe(), 'a;b'), 'picklist passes through');
        Object dt = JFormSubmissionService.coerce(Form_Submission__c.Submission_Date_Time__c.getDescribe(), '2026-10-13');
        Assert.isTrue(dt instanceof Datetime);
        Schema.DescribeFieldResult timeField = Schema.SObjectType.BusinessHours.fields.getMap().get('mondaystarttime').getDescribe();
        Assert.areEqual(Time.newInstance(13, 45, 0, 0), JFormSubmissionService.coerce(timeField, '13:45'));
        Assert.areEqual(Time.newInstance(13, 45, 30, 250), JFormSubmissionService.coerce(timeField, '13:45:30.250Z'));
        Assert.isNull(JFormSubmissionService.coerce(timeField, 'noon'), 'bad time ignored');
    }

    @IsTest
    static void hiddenAnswersNeverReachRecordSteps() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Hidden');
            def.targetObjectApiName = null;
            def.settings = new Map<String, Object>{ 'automation' => new Map<String, Object>{ 'steps' => new List<Object>{ new Map<String, Object>{
                'key' => 'lead', 'action' => 'create', 'object' => 'Lead', 'primary' => true, 'fields' => new List<Object>{
                    new Map<String, Object>{ 'field' => 'LastName', 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => 'first_name' } },
                    new Map<String, Object>{ 'field' => 'Company', 'source' => new Map<String, Object>{ 'type' => 'value', 'value' => 'JForm' } },
                    new Map<String, Object>{ 'field' => 'Email', 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => 'email' } },
                    new Map<String, Object>{ 'field' => 'Description', 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => 'why_summer' } }
                } } } } };
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);

            // why_summer is shown only when season = Summer; a stale browser value for it must not land on the Lead
            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{
                'first_name' => 'Hidden', 'email' => 'hidden@example.com', 'season' => 'autumn', 'why_summer' => 'should vanish'
            }));

            Form_Submission__c sub = [SELECT Status__c, Target_Record_Id__c FROM Form_Submission__c WHERE Id = :submissionId];
            Assert.areEqual('Processed', sub.Status__c);
            Lead lead = [SELECT Description, Email FROM Lead WHERE Id = :sub.Target_Record_Id__c];
            Assert.areEqual('hidden@example.com', lead.Email);
            Assert.isNull(lead.Description, 'hidden answer dropped before the steps ran');
        }
    }

    @IsTest
    static void stepResultsAlwaysFitTheField() {
        List<JFormAutomationService.StepResult> steps = new List<JFormAutomationService.StepResult>();
        for (Integer i = 0; i < 10; i++) {
            JFormAutomationService.StepResult sr = new JFormAutomationService.StepResult();
            sr.key = 'step' + i;
            sr.objectApiName = 'Lead';
            sr.outcome = 'created';
            sr.label = 'x'.repeat(5000);
            steps.add(sr);
        }
        String results = JFormSubmissionService.resultsJson(steps);
        Assert.isTrue(results.length() <= Form_Submission__c.Action_Results_JSON__c.getDescribe().getLength());
        List<Object> parsed = (List<Object>) JSON.deserializeUntyped(results);
        Assert.areEqual(10, parsed.size());
        Assert.areEqual('created', ((Map<String, Object>) parsed[0]).get('outcome'));
        Assert.isFalse(results.contains('xxxx'), 'labels dropped to fit');
    }
}
