@IsTest
private class JFormPublishServiceTest {

    @IsTest
    static void publishCreatesSnapshotAndKey() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Publish me');

            Test.startTest();
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, 'first release');
            Test.stopTest();

            Assert.areEqual(1, r.versionNumber);
            Assert.areEqual(12, r.publicKey.length(), 'public key minted');
            Assert.areEqual('Active', r.status);

            Form__c form = [SELECT Status__c, Is_Active__c, Version__c, Public_Key__c, Current_Version__c FROM Form__c WHERE Id = :def.id];
            Assert.areEqual('Active', form.Status__c);
            Assert.isTrue(form.Is_Active__c);
            Assert.areEqual(1, form.Version__c);
            Assert.areEqual(r.publicKey, form.Public_Key__c);
            Assert.areEqual(r.versionId, form.Current_Version__c);

            Form_Version__c v = [SELECT Version_Number__c, Definition_JSON__c, Change_Summary__c, Published_By__c FROM Form_Version__c WHERE Id = :r.versionId];
            Assert.areEqual(1, v.Version_Number__c);
            Assert.areEqual('first release', v.Change_Summary__c);
            Assert.areEqual(UserInfo.getUserId(), v.Published_By__c);
            JFormDefinition.Form snapshot = JFormDefinition.parse(v.Definition_JSON__c);
            Assert.areEqual(r.publicKey, snapshot.publicKey, 'snapshot carries the key');
            Assert.areEqual(1, snapshot.version);
            Assert.areEqual('Active', snapshot.status);
            Assert.areEqual(def.fieldCount(), snapshot.fieldCount());
        }
    }

    @IsTest
    static void republishKeepsKeyAndIncrementsVersion() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult first = JFormTestDataFactory.createAndPublish('Twice');

            // change the draft, then publish again
            JFormDefinition.Form def = JFormDefinitionService.load(first.formId);
            def.sections[0].fields[1].label = 'Given name';
            JFormDefinitionService.save(def);

            Test.startTest();
            JFormPublishService.PublishResult second = JFormPublishService.publish(first.formId, 'rename');
            Test.stopTest();

            Assert.areEqual(first.publicKey, second.publicKey, 'key is stable across versions');
            Assert.areEqual(2, second.versionNumber);
            Assert.areEqual(2, [SELECT COUNT() FROM Form_Version__c WHERE Form__c = :first.formId]);
            String liveJson = [SELECT Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :first.formId].Current_Version__r.Definition_JSON__c;
            Assert.isTrue(liveJson.contains('Given name'), 'current version is the newest snapshot');
        }
    }

    @IsTest
    static void unpublishDeactivates() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = JFormTestDataFactory.createAndPublish('Off');

            JFormPublishService.PublishResult off = JFormPublishService.unpublish(r.formId);

            Assert.areEqual('Inactive', off.status);
            Assert.areEqual(r.publicKey, off.publicKey);
            Form__c form = [SELECT Status__c, Is_Active__c FROM Form__c WHERE Id = :r.formId];
            Assert.areEqual('Inactive', form.Status__c);
            Assert.isFalse(form.Is_Active__c);
        }
    }

    @IsTest
    static void cannotPublishEmptyForm() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = new Form__c(Name = 'Empty');
            insert form;
            String message;
            try {
                JFormPublishService.publish(form.Id, null);
            } catch (JFormDefinition.JFormException e) {
                message = e.getMessage();
            }
            Assert.isTrue(message != null && message.contains('no fields'), message);
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Version__c WHERE Form__c = :form.Id]);
        }
    }

    @IsTest
    static void keysAreRandom() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Set<String> keys = new Set<String>();
            for (Integer i = 0; i < 20; i++) {
                keys.add(JFormPublishService.mintPublicKey());
            }
            Assert.areEqual(20, keys.size(), 'twenty mints, twenty distinct keys');
        }
    }

    @IsTest
    static void publishingBumpsTheRevisionAndTellsOpenWorkspaces() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Rev');
            Integer before = def.revision;
            JFormChangeEvents.published.clear();
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, 'go');
            Assert.areEqual(before + 1, [SELECT Revision__c FROM Form__c WHERE Id = :def.id].Revision__c.intValue());
            Assert.areEqual('published', JFormChangeEvents.published[0].Change__c);
            Assert.areEqual(before + 1, JFormChangeEvents.published[0].Revision__c);

            JFormPublishService.unpublish(r.formId);
            Assert.areEqual(before + 2, [SELECT Revision__c FROM Form__c WHERE Id = :def.id].Revision__c.intValue());
            Assert.areEqual('unpublished', JFormChangeEvents.published[1].Change__c);

            Assert.areEqual(before + 1, r.revision, 'the publish result carries the new revision for the workspace');
            // a tab that loaded the form before the publish cannot overwrite it
            try {
                JFormDefinitionService.save(def);
                Assert.fail('expected a conflict');
            } catch (JFormDefinition.ConflictException e) {
                Assert.isTrue(e.getMessage().contains('changed elsewhere'));
            }
        }
    }

    @IsTest
    static void publishedRevisionTellsWhetherTheDraftChanged() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Changes');
            Assert.isNull(JFormDefinitionService.load(def.id).publishedRevision, 'never published');
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, 'v1');
            JFormDefinition.Form live = JFormDefinitionService.load(def.id);
            Assert.areEqual(r.revision, live.publishedRevision, 'right after publishing the draft is the live version');
            Assert.areEqual(live.revision, live.publishedRevision);
            live.name = 'Changes, edited';
            JFormDefinition.Form saved = JFormDefinitionService.save(live);
            Assert.isTrue(saved.revision > saved.publishedRevision, 'a save after publishing is an unpublished change');
            JFormPublishService.PublishResult off = JFormPublishService.unpublish(def.id);
            Assert.areEqual(saved.revision + 1, off.revision, 'unpublish returns the new revision too');
        }
    }
}
