@IsTest
private class JFormPublicControllerTest {

    @IsTest
    static void returnsPublishedDefinitionByKey() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Public');

            String published = JFormPublicController.getPublishedDefinition(r.publicKey);

            JFormDefinition.Form def = JFormDefinition.parse(published);
            Assert.areEqual('Public', def.name);
            Assert.areEqual(r.publicKey, def.publicKey);
            Assert.areEqual(2, def.sections.size());

            // respondents get what the renderer needs, not record steps, settings or record ids
            Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(published);
            Assert.isNull(raw.get('settings'), 'settings stay private');
            Assert.isNull(raw.get('targetObjectApiName'));
            Assert.isNull(raw.get('id'));
            Map<String, Object> firstSection = (Map<String, Object>) ((List<Object>) raw.get('sections'))[0];
            Assert.isNull(firstSection.get('id'));
            Map<String, Object> firstName = (Map<String, Object>) ((List<Object>) firstSection.get('fields'))[1];
            Assert.areEqual('first_name', firstName.get('key'));
            Assert.isNull(firstName.get('id'));
            Assert.isNull(firstName.get('targetFieldApiName'));
            Assert.isFalse(published.contains('"automation"'), published);
            Map<String, Object> protection = (Map<String, Object>) raw.get('protection');
            Assert.areEqual(false, protection.get('captcha'), 'the renderer learns only whether to load reCAPTCHA');
            Assert.isFalse(protection.containsKey('siteKey'));
        }
    }

    @IsTest
    static void submitPublishesTheEventAndDropsBots() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Events');
            Map<String, Object> answers = new Map<String, Object>{ 'first_name' => 'Eve', 'email' => 'eve@example.com', 'season' => 'autumn' };

            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(answers));

            Assert.isNotNull(submissionId);
            Assert.isTrue(JFormSubmissionService.lastEventPublished, 'Submitted__e goes out for every real submission');
            Assert.areEqual('Events', [SELECT Form_Name__c FROM Form_Submission__c WHERE Id = :submissionId].Form_Name__c, 'the form name is kept on the response for reporting after the form is gone');

            answers.put(JFormPublicController.HONEYPOT_KEY, 'http://spam.example');
            Id bot = JFormPublicController.submit(r.publicKey, JSON.serialize(answers));

            Assert.isNotNull(bot, 'a filled honeypot looks successful');
            Form_Submission__c flagged = [SELECT Status__c, Spam_Reason__c, Spam_Score__c FROM Form_Submission__c WHERE Id = :bot];
            Assert.areEqual('Spam', flagged.Status__c, 'but is kept as spam for review');
            Assert.areEqual('honeypot filled', flagged.Spam_Reason__c);
            Assert.areEqual(100, flagged.Spam_Score__c);
            Assert.isFalse(JFormSubmissionService.lastEventPublished, 'and no event goes out for it');
            Assert.areEqual(1, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId AND Status__c != 'Spam']);
        }
    }

    @IsTest
    static void attachFileIsLimitedToUploadFieldsAndSize() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Limits');
            def.targetObjectApiName = null;
            JFormDefinition.Field photo = new JFormDefinition.Field();
            photo.key = 'photo';
            photo.fieldType = 'fileupload';
            photo.label = 'Photo';
            def.sections[0].fields.add(photo);
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{ 'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn' }));
            String small = EncodingUtil.base64Encode(Blob.valueOf('bytes'));

            Assert.areEqual('Files can only be attached to a file upload field.', attachError(r.publicKey, submissionId, 'first_name', small));
            JFormPublicController.maxFileBase64 = 4;
            Assert.areEqual('Files must be 3 MB or smaller.', attachError(r.publicKey, submissionId, 'photo', small));
            JFormPublicController.maxFileBase64 = 4 * 1024 * 1024;
            JFormPublicController.maxFilesPerSubmission = 1;
            Assert.isNotNull(JFormPublicController.attachFile(r.publicKey, submissionId, 'photo', 'one.png', small));
            Assert.areEqual('No more than 1 files can be attached to a response.', attachError(r.publicKey, submissionId, 'photo', small));
        }
    }

    @IsTest
    static void attachFileRefusesDisallowedTypesAndCleansTheName() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Upload types');
            def.targetObjectApiName = null;
            JFormDefinition.Field photo = new JFormDefinition.Field();
            photo.key = 'photo';
            photo.fieldType = 'fileupload';
            photo.label = 'Photo';
            photo.fileType = 'Image';
            def.sections[0].fields.add(photo);
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{ 'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn' }));
            String content = EncodingUtil.base64Encode(Blob.valueOf('bytes'));

            for (String refused : new List<String>{ 'page.html', 'cv.pdf' }) {
                try {
                    JFormPublicController.attachFile(r.publicKey, submissionId, 'photo', refused, content);
                    Assert.fail(refused + ' must be refused on an Image field');
                } catch (AuraHandledException e) {
                    Assert.isTrue(e.getMessage().startsWith('Files of this type cannot be attached.'), e.getMessage());
                }
            }
            Id documentId = JFormPublicController.attachFile(r.publicKey, submissionId, 'photo', '../uploads/team<1>.png', content);
            ContentVersion stored = [SELECT Title, PathOnClient FROM ContentVersion WHERE ContentDocumentId = :documentId];
            Assert.areEqual('team_1_.png', stored.Title);
            Assert.areEqual('team_1_.png', stored.PathOnClient);
        }
    }

    @IsTest
    static void attachFileHoldsTheFieldsTypesSizeAndCount() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Upload rules');
            def.targetObjectApiName = null;
            JFormDefinition.Field sheet = new JFormDefinition.Field();
            sheet.key = 'sheet';
            sheet.fieldType = 'fileupload';
            sheet.label = 'Timesheet';
            sheet.config = new Map<String, Object>{ 'extensions' => new List<Object>{ 'pdf', 'xls', 'xlsx', 'csv' }, 'maxSizeMb' => 1, 'maxFiles' => 2 };
            def.sections[0].fields.add(sheet);
            JFormDefinition.Field notes = new JFormDefinition.Field();
            notes.key = 'notes';
            notes.fieldType = 'fileupload';
            notes.label = 'Notes';
            notes.config = new Map<String, Object>{ 'maxFiles' => 1 };
            def.sections[0].fields.add(notes);
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{
                'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn', 'sheet' => new List<Object>{ 'data.csv', 'b.xlsx' },
                'notes' => new List<Object>{ 'a.csv' }
            }));
            String small = EncodingUtil.base64Encode(Blob.valueOf('1,2'));

            Assert.isTrue(attachError(r.publicKey, submissionId, 'sheet', 'song.mp3', small).startsWith('Files of this type cannot be attached.'));
            // a little over 1 MB of base64
            Assert.areEqual('Files must be 1 MB or smaller.', attachError(r.publicKey, submissionId, 'sheet', 'a.csv', 'A'.repeat(1398108)));
            Assert.isNotNull(JFormPublicController.attachFile(r.publicKey, submissionId, 'sheet', 'a.csv', small));
            Assert.isNotNull(JFormPublicController.attachFile(r.publicKey, submissionId, 'sheet', 'b.xlsx', small));
            Assert.areEqual('No more than 2 files can be attached to this field.', attachError(r.publicKey, submissionId, 'sheet', 'c.pdf', small));

            // a.csv counted toward the field though its answer didn't list it, and added to the answer though data.csv ends with its name
            Assert.areEqual('data.csv; b.xlsx; a.csv', [
                SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :submissionId AND Field_Key__c = 'sheet'
            ].Field_Value__c);
            // a file of the same name on another field doesn't count toward this one
            Assert.isNotNull(JFormPublicController.attachFile(r.publicKey, submissionId, 'notes', 'a.csv', small));
            Assert.areEqual('Only one file can be attached to this field.', attachError(r.publicKey, submissionId, 'notes', 'b.csv', small));
        }
    }

    private static String attachError(String key, Id submissionId, String fieldKey, String fileName, String content) {
        try {
            JFormPublicController.attachFile(key, submissionId, fieldKey, fileName, content);
            return null;
        } catch (AuraHandledException e) {
            return e.getMessage();
        }
    }

    private static String attachError(String key, Id submissionId, String fieldKey, String content) {
        try {
            JFormPublicController.attachFile(key, submissionId, fieldKey, 'x.png', content);
            return null;
        } catch (AuraHandledException e) {
            return e.getMessage();
        }
    }

    @IsTest
    static void unknownOrInactiveKeyIsRejected() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            String message;
            try {
                JFormPublicController.getPublishedDefinition('nope');
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'unknown key rejected');

            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Inactive');
            JFormPublishService.unpublish(r.formId);
            message = null;
            try {
                JFormPublicController.getPublishedDefinition(r.publicKey);
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'inactive form rejected');
        }
    }

    @IsTest
    static void submitStoresVisibleAnswersAndDropsHidden() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Submit');
            Map<String, Object> answers = new Map<String, Object>{
                'first_name' => 'Noah',
                'email' => 'noah@example.com',
                'season' => 'autumn',
                'why_summer' => 'should be dropped because season is not Summer',
                'nps' => 9
            };

            Test.startTest();
            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(answers));
            Test.stopTest();

            Form_Submission__c sub = [SELECT Form__c, Form_Version__c, Status__c, Error_Message__c FROM Form_Submission__c WHERE Id = :submissionId];
            Assert.isNotNull(sub.Error_Message__c);
            Assert.areEqual(r.formId, sub.Form__c);
            Assert.areEqual(r.versionId, sub.Form_Version__c, 'submission records the version seen');
            Assert.areEqual('Error', sub.Status__c, 'Lead needs LastName and Company, so the target step records an error while answers are kept');

            Map<String, Submission_Field_Value__c> byKey = new Map<String, Submission_Field_Value__c>();
            for (Submission_Field_Value__c v : [SELECT Field_Key__c, Field_Label__c, Field_Value__c, Form_Field_Definition__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :submissionId]) {
                byKey.put(v.Field_Key__c, v);
            }
            Assert.isTrue(byKey.containsKey('first_name'));
            Assert.areEqual('Noah', byKey.get('first_name').Field_Value__c);
            Assert.isNotNull(byKey.get('first_name').Form_Field_Definition__c, 'linked to the live field definition');
            Assert.areEqual('9', byKey.get('nps').Field_Value__c);
            Assert.isFalse(byKey.containsKey('why_summer'), 'hidden field not stored');
            Assert.isFalse(byKey.containsKey('intro'), 'layout field not stored');
        }
    }

    @IsTest
    static void submitEnforcesRequiredIncludingConditionalRequire() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Required');
            // season = Summer makes why_summer visible, and it is required
            Map<String, Object> answers = new Map<String, Object>{
                'first_name' => 'Noah',
                'email' => 'noah@example.com',
                'season' => 'Summer'
            };
            String message;
            try {
                JFormPublicController.submit(r.publicKey, JSON.serialize(answers));
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'missing required answer rejected');
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId], 'nothing stored');
        }
    }

    @IsTest
    static void multiSelectAnswersAreJoined() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Multi');
            JFormDefinition.Field diet = new JFormDefinition.Field();
            diet.key = 'diet';
            diet.fieldType = 'multiselect';
            diet.label = 'Dietary requirements';
            diet.options = new List<JFormDefinition.Option>();
            for (String o : new List<String>{ 'Vegan', 'Vegetarian', 'None' }) {
                JFormDefinition.Option opt = new JFormDefinition.Option();
                opt.label = o;
                diet.options.add(opt);
            }
            def.sections[1].fields.add(diet);
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);

            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{
                'first_name' => 'A', 'email' => 'a@b.c', 'season' => 'autumn', 'diet' => new List<String>{ 'Vegan', 'None' }
            }));

            Submission_Field_Value__c v = [SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :submissionId AND Field_Key__c = 'diet'];
            Assert.areEqual('Vegan; None', v.Field_Value__c);
        }
    }

    @IsTest
    static void submitWithSourceAndAttachFile() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Upload');
            def.targetObjectApiName = null;
            JFormDefinition.Field photo = new JFormDefinition.Field();
            photo.key = 'photo';
            photo.fieldType = 'fileupload';
            photo.label = 'Photo';
            def.sections[0].fields.add(photo);
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);

            Id submissionId = JFormPublicController.submitWithSource(r.publicKey, JSON.serialize(new Map<String, Object>{
                'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn', 'photo' => new List<String>{ 'team.png' }
            }), 'https://example.com/page?utm_source=newsletter');
            Assert.areEqual('https://example.com/page?utm_source=newsletter', [SELECT Source_URL__c FROM Form_Submission__c WHERE Id = :submissionId].Source_URL__c);

            Id docId = JFormPublicController.attachFile(r.publicKey, submissionId, 'photo', 'team.png', EncodingUtil.base64Encode(Blob.valueOf('bytes')));
            Assert.isNotNull(docId);
            Assert.areEqual(1, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :submissionId]);

            String message;
            try {
                JFormPublicController.attachFile(r.publicKey, def.id, 'photo', 'x.png', 'AAAA'); // not a submission of this form
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'foreign record rejected');
        }
    }

    @IsTest
    static void buttonTextGoesPublicButSettingsStayPrivate() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Buttons');
            def.targetObjectApiName = null;
            def.settings = new Map<String, Object>{
                'access' => new Map<String, Object>{ 'responseLimit' => 50 },
                'buttons' => new Map<String, Object>{ 'submit' => '  Register   now ', 'next' => '', 'back' => 42, 'other' => 'not a button' }
            };
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);

            Map<String, Object> raw = (Map<String, Object>) JSON.deserializeUntyped(JFormPublicController.getPublishedDefinition(r.publicKey));
            Assert.isNull(raw.get('settings'), 'settings stay private');
            Assert.areEqual(new Map<String, Object>{ 'submit' => 'Register now' }, raw.get('buttonLabels'), 'only known, non-blank words, spaces collapsed');
        }
    }

    @IsTest
    static void buttonLabelsAreShortPlainTextOrNothing() {
        Assert.isNull(JFormPublicController.buttonLabels(null));
        Assert.isNull(JFormPublicController.buttonLabels(new Map<String, Object>{ 'buttons' => 'not a map' }));
        Assert.isNull(JFormPublicController.buttonLabels(new Map<String, Object>{ 'buttons' => new Map<String, Object>{ 'submit' => ' ' } }));
        Map<String, String> labels = JFormPublicController.buttonLabels(new Map<String, Object>{
            'buttons' => new Map<String, Object>{ 'next' => 'N'.repeat(60), 'back' => 'Go back' }
        });
        Assert.areEqual(40, labels.get('next').length(), 'capped at 40 characters');
        Assert.areEqual('Go back', labels.get('back'));
        Assert.isFalse(labels.containsKey('submit'));
    }

    @IsTest
    static void accessRulesCloseTheForm() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Limited');
            def.targetObjectApiName = null;
            def.settings = new Map<String, Object>{ 'access' => new Map<String, Object>{ 'responseLimit' => 1, 'closedMessage' => 'All spaces are taken.' } };
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            String answers = JSON.serialize(new Map<String, Object>{ 'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn' });

            JFormPublicController.submit(r.publicKey, answers);
            String message;
            try {
                JFormPublicController.submit(r.publicKey, answers);
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
            Assert.areEqual('All spaces are taken.', message, 'second response rejected by the limit');
            try {
                JFormPublicController.getPublishedDefinition(r.publicKey);
                Assert.fail('definition must be withheld when the form is full');
            } catch (AuraHandledException e) {
                Assert.areEqual('All spaces are taken.', e.getMessage());
            }

            // close date in the past
            def = JFormDefinitionService.load(def.id);
            def.settings = new Map<String, Object>{ 'access' => new Map<String, Object>{ 'closeDate' => String.valueOf(Date.today().addDays(-1)) } };
            JFormDefinitionService.save(def);
            JFormPublishService.publish(def.id, 'closed');
            try {
                JFormPublicController.getPublishedDefinition(r.publicKey);
                Assert.fail('closed by date');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('no longer accepting'), e.getMessage());
            }

            // future close date keeps it open (publishing bumped the revision, so load again before saving)
            def = JFormDefinitionService.load(def.id);
            def.settings = new Map<String, Object>{ 'access' => new Map<String, Object>{ 'closeDate' => String.valueOf(Date.today().addDays(30)) } };
            JFormDefinitionService.save(def);
            JFormPublishService.publish(def.id, 'open');
            Assert.isNotNull(JFormPublicController.getPublishedDefinition(r.publicKey));
        }
    }

    @IsTest
    static void beforeItOpensRespondentsGetTheScreenNotTheQuestions() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Opens later');
            def.targetObjectApiName = null;
            String opens = Datetime.now().addDays(3).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
            def.settings = new Map<String, Object>{ 'access' => new Map<String, Object>{
                'openAt' => opens,
                'timeZone' => 'America/Los_Angeles',
                'notOpen' => new Map<String, Object>{ 'title' => 'Bookings open soon', 'message' => '<p>See you then.</p>', 'imageUrl' => 'javascript:alert(1)' }
            } };
            // an image that isn't https is refused on save
            try {
                JFormDefinitionService.create(def);
                Assert.fail('a bad screen image must be refused');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('not-yet-open screen image'), e.getMessage());
            }
            ((Map<String, Object>) ((Map<String, Object>) def.settings.get('access')).get('notOpen')).put('imageUrl', 'https://example.com/a.png');
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);

            try {
                JFormPublicController.getPublishedDefinition(r.publicKey);
                Assert.fail('the questions stay private until the form opens');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().startsWith('This form is not open yet. It opens on '), e.getMessage());
                Assert.isTrue(e.getMessage().endsWith('GMT-08:00.') || e.getMessage().endsWith('GMT-07:00.'), e.getMessage());
            }
            String screenJson = JFormPublicController.getAvailabilityScreen(r.publicKey);
            Map<String, Object> screen = (Map<String, Object>) JSON.deserializeUntyped(screenJson);
            Assert.areEqual('notOpen', screen.get('state'));
            Assert.areEqual('Bookings open soon', screen.get('title'));
            Assert.areEqual('<p>See you then.</p>', screen.get('message'));
            Assert.areEqual('https://example.com/a.png', screen.get('imageUrl'));
            Assert.areEqual(opens, screen.get('opensAt'));
            Assert.areEqual('Opens later', screen.get('name'));
            Assert.isFalse(screenJson.contains('first_name') || screenJson.contains('"sections"') || screenJson.contains('"settings"'), screenJson);

            String answers = JSON.serialize(new Map<String, Object>{ 'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn' });
            try {
                JFormPublicController.submit(r.publicKey, answers);
                Assert.fail('no responses before the form opens');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().startsWith('This form is not open yet.'), e.getMessage());
            }
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :def.id]);

            // once open the form shows and there is no screen; past its closing time the closed screen
            def = JFormDefinitionService.load(def.id);
            String closes = Datetime.now().addDays(1).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
            def.settings = new Map<String, Object>{ 'access' => new Map<String, Object>{
                'openAt' => Datetime.now().addDays(-2).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                'closeAt' => closes,
                'timeZone' => 'America/Los_Angeles'
            } };
            JFormDefinitionService.save(def);
            JFormPublishService.publish(def.id, 'open');
            Map<String, Object> live = (Map<String, Object>) JSON.deserializeUntyped(JFormPublicController.getPublishedDefinition(r.publicKey));
            Assert.areEqual(closes, live.get('closesAt'), 'a cached copy knows when to ask again');
            Assert.areEqual(true, live.get('mayClose'), 'a refused submission may mean the form has closed since');
            Assert.isNull(JFormPublicController.getAvailabilityScreen(r.publicKey));

            def = JFormDefinitionService.load(def.id);
            def.settings = new Map<String, Object>{
                'access' => new Map<String, Object>{
                    'closeAt' => Datetime.now().addMinutes(-5).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                    'timeZone' => 'America/Los_Angeles',
                    'closed' => new Map<String, Object>{ 'title' => 'Bookings are closed', 'message' => '<p>Thanks &amp; see you next year.</p>' }
                },
                'ending' => new Map<String, Object>{ 'title' => 'You are booked' }
            };
            JFormDefinitionService.save(def);
            JFormPublishService.publish(def.id, 'closed');
            try {
                JFormPublicController.submit(r.publicKey, answers);
                Assert.fail('no responses after the form closes');
            } catch (AuraHandledException e) {
                Assert.areEqual('Thanks & see you next year.', e.getMessage());
            }
            screen = (Map<String, Object>) JSON.deserializeUntyped(JFormPublicController.getAvailabilityScreen(r.publicKey));
            Assert.areEqual('closed', screen.get('state'));
            Assert.areEqual('Bookings are closed', screen.get('title'));
            Assert.isFalse(screen.containsKey('opensAt'));
            // a respondent back from paying after the form closed still gets its thank-you screen
            Assert.areEqual('You are booked', ((Map<String, Object>) screen.get('ending')).get('title'));
        }
    }

    @IsTest
    static void aFullFormShowsTheClosedScreenWithTheOlderMessage() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Full');
            def.targetObjectApiName = null;
            def.settings = new Map<String, Object>{ 'access' => new Map<String, Object>{ 'responseLimit' => 1, 'closedMessage' => 'All <spaces> are taken.' } };
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            Assert.isNull(JFormPublicController.getAvailabilityScreen(r.publicKey));
            JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{ 'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn' }));

            Map<String, Object> screen = (Map<String, Object>) JSON.deserializeUntyped(JFormPublicController.getAvailabilityScreen(r.publicKey));
            Assert.areEqual('closed', screen.get('state'));
            Assert.areEqual('<p>All &lt;spaces&gt; are taken.</p>', screen.get('message'), 'the plain-text message is escaped');
        }
    }
}
