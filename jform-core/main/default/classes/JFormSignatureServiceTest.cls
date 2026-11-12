@IsTest
private class JFormSignatureServiceTest {

    /** A 1 x 1 PNG. */
    private static final String PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    private static final String SIGNED = JFormSignatureService.DATA_URL_PREFIX + PNG_BASE64;

    private static JFormDefinition.Field signature(String key, String label) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key;
        f.fieldType = 'signature';
        f.label = label;
        return f;
    }

    private static JFormDefinition.Field text(String key, String label, String target) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key;
        f.fieldType = 'text';
        f.label = label;
        f.targetFieldApiName = target;
        return f;
    }

    /** The sample form plus what a Lead needs and the given fields on the first page, published; strategy create or none. */
    private static Form__c publishedForm(String name, String strategy, List<JFormDefinition.Field> extra) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition(name);
        def.sections[0].fields.add(text('last_name', 'Last name', 'LastName'));
        def.sections[0].fields.add(text('company', 'Company', 'Company'));
        def.sections[0].fields.addAll(extra);
        if (strategy == 'none') {
            def.targetObjectApiName = null;
        }
        def.settings = new Map<String, Object>{ 'target' => new Map<String, Object>{ 'strategy' => strategy } };
        def = JFormDefinitionService.create(def);
        Id formId = JFormPublishService.publish(def.id, null).formId;
        return [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :formId];
    }

    private static JFormDefinition.Form definitionOf(Form__c form) {
        return JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
    }

    private static Map<String, Object> answers() {
        return new Map<String, Object>{
            'first_name' => 'Noah', 'last_name' => 'Lee', 'email' => 'noah.lee@example.com', 'company' => 'Riverside', 'season' => 'autumn'
        };
    }

    private static List<Id> documentsOn(Id entityId) {
        List<Id> out = new List<Id>();
        for (ContentDocumentLink l : [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :entityId]) {
            out.add(l.ContentDocumentId);
        }
        return out;
    }

    @IsTest
    static void storesTheSignatureOnTheResponseAndTheRecord() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Waiver', 'create', new List<JFormDefinition.Field>{ signature('sig', 'Parent / guardian signature') });
            Map<String, Object> a = answers();
            a.put('sig', SIGNED);

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form), a, null);
            Test.stopTest();

            Assert.areEqual('Processed', res.status, 'error: ' + res.errorMessage);
            Submission_Field_Value__c v = [SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId AND Field_Key__c = 'sig'];
            Assert.areEqual('Parent _ guardian signature.png', v.Field_Value__c, 'the file name is stored, not the image');

            List<Id> onResponse = documentsOn(res.submissionId);
            Assert.areEqual(1, onResponse.size());
            ContentVersion cv = [SELECT Title, FileExtension, Description, VersionData FROM ContentVersion WHERE ContentDocumentId = :onResponse[0] AND IsLatest = true];
            Assert.areEqual('Parent _ guardian signature.png', cv.Title);
            Assert.areEqual('png', cv.FileExtension);
            Assert.areEqual(PNG_BASE64, EncodingUtil.base64Encode(cv.VersionData));
            String digest = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', EncodingUtil.base64Decode(PNG_BASE64)));
            Assert.areEqual('JForm signature\nField: sig\nSHA-256: ' + digest, cv.Description);

            ContentDocumentLink onLead = [SELECT ContentDocumentId, ShareType FROM ContentDocumentLink WHERE LinkedEntityId = :res.targetRecordId];
            Assert.areEqual(onResponse[0], onLead.ContentDocumentId);
            Assert.areEqual('I', onLead.ShareType, 'access follows the record');
            Assert.areEqual(1, JFormSignatureService.countOn(res.submissionId));
        }
    }

    @IsTest
    static void linksOnlyFieldsThatAllowItAndOnlyOnce() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field witness = signature('witness', 'Witness');
            witness.config = new Map<String, Object>{ 'attachToRecord' => false };
            JFormDefinition.Field late = signature('late', 'Late signature');
            late.conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'season', 'equals', 'Summer');
            Form__c form = publishedForm('Two signatures', 'none', new List<JFormDefinition.Field>{ signature('sig', 'Signature'), witness, late });
            JFormDefinition.Form def = definitionOf(form);
            Map<String, Object> a = answers();
            a.put('sig', SIGNED);
            a.put('witness', SIGNED);
            a.put('late', SIGNED); // hidden by logic: dropped like any hidden answer

            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, def, a, null);

            Assert.areEqual('Processed', res.status);
            Assert.isNull(res.targetRecordId);
            Assert.areEqual(2, documentsOn(res.submissionId).size(), 'no file for the hidden field');
            Assert.areEqual('Signature.png', [SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId AND Field_Key__c = 'sig'].Field_Value__c);

            Lead lead = new Lead(LastName = 'Lee', Company = 'Riverside');
            insert lead;
            JFormSignatureService.linkToRecord(def, res.submissionId, lead.Id);
            JFormSignatureService.linkToRecord(def, res.submissionId, lead.Id);
            List<Id> onLead = documentsOn(lead.Id);
            Assert.areEqual(1, onLead.size(), 'the witness keeps off the record, and a second run adds nothing');
            Assert.isTrue([SELECT Description FROM ContentVersion WHERE ContentDocumentId = :onLead[0] AND IsLatest = true].Description.contains('Field: sig'));
        }
    }

    @IsTest
    static void reprocessingLinksTheSignatureToTheNewRecord() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Retry', 'create', new List<JFormDefinition.Field>{ signature('sig', 'Signature') });
            Map<String, Object> a = answers();
            a.put('last_name', ''); // optional on the form, required on Lead: the record step fails
            a.put('sig', SIGNED);
            JFormSubmissionService.Result first = JFormSubmissionService.submit(form, definitionOf(form), a, null);
            Assert.areEqual('Error', first.status);
            Assert.areEqual(1, documentsOn(first.submissionId).size(), 'the signature is kept when the record step fails');

            Submission_Field_Value__c lastName = [SELECT Id FROM Submission_Field_Value__c WHERE Form_Submission__c = :first.submissionId AND Field_Key__c = 'last_name'];
            lastName.Field_Value__c = 'Lee';
            update lastName;
            JFormSubmissionService.Result second = JFormSubmissionService.reprocess(first.submissionId);

            Assert.areEqual('Processed', second.status, 'error: ' + second.errorMessage);
            Assert.areEqual(1, documentsOn(second.targetRecordId).size());
        }
    }

    @IsTest
    static void refusesAnswersThatAreNotAPng() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Refused', 'none', new List<JFormDefinition.Field>{ signature('sig', 'Signature') });
            Map<String, Object> a = answers();
            a.put('sig', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
            try {
                JFormSubmissionService.submit(form, definitionOf(form), a, null);
                Assert.fail('an SVG is not a signature');
            } catch (JFormSubmissionService.SubmissionException e) {
                Assert.areEqual('Please sign again: Signature', e.getMessage());
            }
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :form.Id]);

            // a flagged response is stored without the image, so the text never lands in a value
            a.put('sig', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
            JFormProtectionService.Verdict spam = new JFormProtectionService.Verdict();
            spam.spam = true;
            spam.reasons.add('honeypot');
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form), a, null, spam);
            Assert.areEqual('Spam', res.status);
            Assert.isNull([SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId AND Field_Key__c = 'sig'].Field_Value__c);
            Assert.areEqual(0, documentsOn(res.submissionId).size());
        }
    }

    @IsTest
    static void decodesOnlyPngsWithinTheLimits() {
        Assert.isNotNull(JFormSignatureService.decode(SIGNED));
        Assert.isNull(JFormSignatureService.decode(null));
        Assert.isNull(JFormSignatureService.decode(42));
        Assert.isNull(JFormSignatureService.decode(PNG_BASE64), 'no data URL prefix');
        Assert.isNull(JFormSignatureService.decode('data:image/jpeg;base64,' + PNG_BASE64));
        Assert.isNull(JFormSignatureService.decode(SIGNED + 'A'), 'not whole base64 quads');
        Assert.isNull(JFormSignatureService.decode(SIGNED.replace('iVBOR', 'iV<OR')), 'not base64');
        Assert.isNull(JFormSignatureService.decode(JFormSignatureService.DATA_URL_PREFIX + EncodingUtil.base64Encode(Blob.valueOf('GIF89a is not a PNG, and this text is long enough to pass the length check'))));
        // a PNG header claiming 5000 x 100 pixels
        String wide = '89504e470d0a1a0a0000000d49484452' + '00001388' + '00000064' + '08060000001f15c489' + '00'.repeat(23);
        Assert.isNull(JFormSignatureService.decode(JFormSignatureService.DATA_URL_PREFIX + EncodingUtil.base64Encode(EncodingUtil.convertFromHex(wide))));
        JFormSignatureService.maxBytes = 40;
        Assert.isNull(JFormSignatureService.decode(SIGNED), 'larger than the limit');
    }

    @IsTest
    static void namesAndFindsTheFiles() {
        Assert.areEqual('Signature.png', JFormSignatureService.fileName(signature('a', null)));
        Assert.areEqual('Client signature.png', JFormSignatureService.fileName(signature('a', '  Client   signature ')));
        Assert.areEqual('sig', JFormSignatureService.fieldKeyOf('JForm signature\nField: sig\nSHA-256: 00'));
        Assert.isNull(JFormSignatureService.fieldKeyOf('Uploaded by a respondent'));
        Assert.isNull(JFormSignatureService.fieldKeyOf(null));
        Assert.areEqual(0, JFormSignatureService.countOn(null));
        JFormSignatureService.linkToRecord(null, null, null); // nothing to do, no error
    }

    @IsTest
    static void signaturesDoNotCountTowardTheUploadLimit() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field photo = new JFormDefinition.Field();
            photo.key = 'photo';
            photo.fieldType = 'fileupload';
            photo.label = 'Photo';
            Form__c form = publishedForm('Upload and sign', 'none', new List<JFormDefinition.Field>{ signature('sig', 'Signature'), photo });
            Map<String, Object> a = answers();
            a.put('sig', SIGNED);
            Id submissionId = JFormPublicController.submit(form.Public_Key__c, JSON.serialize(a));
            Assert.areEqual(1, JFormSignatureService.countOn(submissionId));

            JFormPublicController.maxFilesPerSubmission = 1;
            Assert.isNotNull(JFormPublicController.attachFile(form.Public_Key__c, submissionId, 'photo', 'one.png', EncodingUtil.base64Encode(Blob.valueOf('bytes'))));
            try {
                JFormPublicController.attachFile(form.Public_Key__c, submissionId, 'sig', 'two.png', EncodingUtil.base64Encode(Blob.valueOf('bytes')));
                Assert.fail('a signature is not an upload field');
            } catch (AuraHandledException e) {
                Assert.areEqual(2, documentsOn(submissionId).size());
            }
        }
    }

    @IsTest
    static void spamChecksSkipTheImageText() {
        JFormDefinition.Form def = new JFormDefinition.Form();
        JFormDefinition.Section s = new JFormDefinition.Section();
        s.fields.add(signature('sig', 'Signature'));
        def.sections.add(s);
        JFormProtectionService.Settings settings = new JFormProtectionService.Settings();
        settings.blockedWords.add('casino');
        settings.maxLinks = 0;
        Assert.isTrue(JFormProtectionService.contentFlags(def, new Map<String, Object>{ 'sig' => SIGNED + '/casino/www.' }, settings).isEmpty());
    }
}
