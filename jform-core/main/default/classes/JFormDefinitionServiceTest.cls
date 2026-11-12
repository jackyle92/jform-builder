@IsTest
private class JFormDefinitionServiceTest {

    @IsTest
    static void createAndLoadRoundTrip() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form saved = JFormTestDataFactory.createSampleForm('Round trip');

            Assert.isNotNull(saved.id, 'form id assigned');
            Assert.areEqual(2, saved.sections.size(), 'two pages');
            Assert.areEqual('Multi-Page (Sections)', saved.displayStyle, 'display style defaulted from page count');
            Assert.areEqual('Draft', saved.status);
            Assert.areEqual('contact', saved.sections[0].key);
            Assert.areEqual(3, saved.sections[0].fields.size());
            Assert.areEqual('richtext', saved.sections[0].fields[0].fieldType, 'type round-trips lowercase');
            Assert.areEqual(50, saved.sections[0].fields[1].width, 'width round-trips');
            Assert.isNull(saved.sections[0].fields[1].targetFieldApiName, 'per-field mapping moved to the record step');
            Assert.areEqual('Lead', saved.targetObjectApiName, 'target reports the main step object');
            List<JFormAutomationService.Step> steps = JFormAutomationService.steps(saved);
            Assert.areEqual(1, steps.size(), 'the legacy target became one step');
            Assert.areEqual('FirstName', steps[0].fields[0].field);
            Assert.areEqual('first_name', steps[0].fields[0].source.key);
            Assert.isNotNull(saved.sections[0].fields[2].validation);
            Assert.areEqual('^[^@]+@[^@]+$', saved.sections[0].fields[2].validation.regexPattern);

            JFormDefinition.Field season = saved.fieldsByKey().get('season');
            Assert.areEqual(2, season.options.size(), 'options stored');
            Assert.areEqual('Summer', season.options[0].value, 'value defaults to label');
            Assert.areEqual('autumn', season.options[1].value, 'explicit value kept');

            JFormDefinition.Field why = saved.fieldsByKey().get('why_summer');
            Assert.isNotNull(why.conditionalLogic, 'rule stored');
            Assert.areEqual('season', why.conditionalLogic.conditions[0].field);

            Assert.isNotNull(saved.theme);
            Assert.areEqual('#0F766E', saved.theme.primaryColor);
            Assert.areEqual('#334155', saved.theme.extra.get('labelColor'), 'new theme tokens persist through the database');
            Assert.areEqual(true, saved.settings.get('honeypot'));

            // Records exist with the legacy builder's expectations
            List<Form_Field_Definition__c> defs = [SELECT Field_Type__c, Large_Size__c, External_Field_Definition_Id__c FROM Form_Field_Definition__c WHERE Form__c = :saved.id AND External_Field_Definition_Id__c = 'first_name'];
            Assert.areEqual(1, defs.size());
            Assert.areEqual('Text', defs[0].Field_Type__c, 'picklist value is Title case');
            Assert.areEqual('slds-large-size_6-of-12', defs[0].Large_Size__c);
        }
    }

    @IsTest
    static void everyPageFieldAndChoiceLoadsInOrder() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = new JFormDefinition.Form();
            def.name = 'Four pages';
            def.sections = new List<JFormDefinition.Section>();
            for (Integer p = 1; p <= 5; p++) {
                JFormDefinition.Section s = new JFormDefinition.Section();
                s.key = 'page_' + p;
                s.name = 'Page ' + p;
                s.fields = new List<JFormDefinition.Field>();
                for (Integer i = 1; p < 5 && i <= 9; i++) { // the fifth page stays empty
                    JFormDefinition.Field f = new JFormDefinition.Field();
                    f.key = 'p' + p + '_q' + i;
                    f.label = 'Question ' + p + '.' + i;
                    f.fieldType = Math.mod(i, 3) == 0 ? 'radio' : 'text';
                    if (f.fieldType == 'radio') {
                        f.options = new List<JFormDefinition.Option>();
                        for (Integer o = 1; o <= 6; o++) {
                            JFormDefinition.Option opt = new JFormDefinition.Option();
                            opt.label = 'Choice ' + o;
                            opt.value = 'c' + o;
                            f.options.add(opt);
                        }
                    }
                    s.fields.add(f);
                }
                def.sections.add(s);
            }
            JFormDefinition.Form created = JFormDefinitionService.create(def);

            JFormDefinition.Form loaded = JFormDefinitionService.load(created.id);
            Assert.areEqual(5, loaded.sections.size(), 'every page, the empty one too');
            for (Integer p = 0; p < 4; p++) {
                Assert.areEqual('page_' + (p + 1), loaded.sections[p].key);
                Assert.areEqual(9, loaded.sections[p].fields.size());
                Assert.areEqual('p' + (p + 1) + '_q1', loaded.sections[p].fields[0].key, 'fields in order');
                Assert.areEqual(6, loaded.sections[p].fields[2].options.size());
                Assert.areEqual('c6', loaded.sections[p].fields[2].options[5].value, 'choices in order');
            }
            Assert.areEqual(0, loaded.sections[4].fields.size());
            Map<String, Object> asJson = (Map<String, Object>) JSON.deserializeUntyped(JFormWorkspaceController.getDefinition(created.id));
            Assert.areEqual(5, ((List<Object>) asJson.get('sections')).size(), 'the workspace gets every page');
        }
    }

    @IsTest
    static void saveDiffsByKeyAndId() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Diff');
            Integer sectionsBefore = [SELECT COUNT() FROM Form_Section__c WHERE Form__c = :def.id];
            Integer fieldsBefore = [SELECT COUNT() FROM Form_Field_Definition__c WHERE Form__c = :def.id];
            Assert.areEqual(2, sectionsBefore);
            Assert.areEqual(6, fieldsBefore);

            // rename a field, delete another, add an option, remove an option, add a page
            JFormDefinition.Field firstName = def.fieldsByKey().get('first_name');
            String firstNameId = firstName.id;
            firstName.label = 'Given name';
            def.sections[0].fields.remove(2); // email
            JFormAutomationService.dropReferences(def, 'email'); // the builder and the API do this when a field is deleted
            JFormDefinition.Field season = def.fieldsByKey().get('season');
            season.options.remove(1); // autumn
            JFormDefinition.Option winter = new JFormDefinition.Option();
            winter.label = 'Winter';
            season.options.add(winter);
            JFormDefinition.Section booking = new JFormDefinition.Section();
            booking.key = 'booking';
            booking.name = 'Booking';
            JFormDefinition.Field preferred = new JFormDefinition.Field();
            preferred.key = 'preferred_date';
            preferred.fieldType = 'date';
            preferred.label = 'Preferred date';
            booking.fields.add(preferred);
            def.sections.add(booking);
            def.thankYouMessage = 'See you soon';

            Test.startTest();
            JFormDefinition.Form saved = JFormDefinitionService.save(def);
            Test.stopTest();

            Assert.areEqual(3, saved.sections.size(), 'page added');
            Assert.areEqual('Booking', saved.sections[2].name);
            Assert.areEqual('See you soon', saved.thankYouMessage);
            Assert.isNull(saved.fieldsByKey().get('email'), 'email deleted');
            Assert.areEqual('Given name', saved.fieldsByKey().get('first_name').label);
            Assert.areEqual(firstNameId, saved.fieldsByKey().get('first_name').id, 'existing field updated in place, not recreated');
            List<String> optionLabels = new List<String>();
            for (JFormDefinition.Option o : saved.fieldsByKey().get('season').options) {
                optionLabels.add(o.label);
            }
            Assert.areEqual(new List<String>{ 'Summer', 'Winter' }, optionLabels);
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Picklist_Option__c WHERE Option_Label__c = 'Autumn' AND Form_Field_Definition__r.Form__c = :def.id], 'removed option deleted');
            Assert.areEqual(6, [SELECT COUNT() FROM Form_Field_Definition__c WHERE Form__c = :def.id], 'one removed, one added');
        }
    }

    @IsTest
    static void cloneCopiesEverythingIntoDraft() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form source = JFormTestDataFactory.createSampleForm('Source');
            JFormPublishService.publish(source.id, 'v1');

            Test.startTest();
            JFormDefinition.Form copy = JFormDefinitionService.clone(source.id, 'Source copy');
            Test.stopTest();

            Assert.areNotEqual(source.id, copy.id);
            Assert.areEqual('Source copy', copy.name);
            Assert.areEqual('Draft', copy.status);
            Assert.isFalse(copy.isActive);
            Assert.isNull(copy.publicKey, 'public key is not copied');
            Assert.areEqual(source.fieldCount(), copy.fieldCount());
            Assert.areEqual(2, copy.fieldsByKey().get('season').options.size());
            Assert.isNotNull(copy.fieldsByKey().get('why_summer').conditionalLogic, 'rules copied by key');
            Assert.areEqual('#0F766E', copy.theme.primaryColor, 'theme copied');
        }
    }

    @IsTest
    static void validateRejectsBadDefinitions() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Invalid');
            def.sections[1].fields[0].options = null; // picklist without options
            def.sections[0].fields[1].key = 'email';   // duplicate key
            JFormDefinition.Field orphanRule = new JFormDefinition.Field();
            orphanRule.key = 'orphan';
            orphanRule.fieldType = 'text';
            orphanRule.label = 'Orphan';
            orphanRule.conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'does_not_exist', 'equals', 'x');
            def.sections[1].fields.add(orphanRule);

            String message;
            try {
                JFormDefinitionService.create(def);
            } catch (JFormDefinition.JFormException e) {
                message = e.getMessage();
            }
            Assert.isNotNull(message, 'validation failed');
            Assert.isTrue(message.contains('needs at least one option'), message);
            Assert.isTrue(message.contains('Duplicate key'), message);
            Assert.isTrue(message.contains('unknown field "does_not_exist"'), message);
            Assert.areEqual(0, [SELECT COUNT() FROM Form__c WHERE Name = 'Invalid'], 'nothing persisted: validation runs before the insert');
        }
    }

    @IsTest
    static void fieldConfigRoundTripsThroughTheDatabaseAndJson() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Config');
            JFormDefinition.Field visit = new JFormDefinition.Field();
            visit.key = 'visit';
            visit.fieldType = 'date';
            visit.label = 'Visit date';
            visit.config = new Map<String, Object>{ 'minDate' => '2026-10-10', 'noFuture' => true, 'disabledDays' => new List<Object>{ 0, 6 } };
            JFormDefinition.Field slot = new JFormDefinition.Field();
            slot.key = 'slot';
            slot.fieldType = 'time';
            slot.label = 'Arrival';
            slot.config = new Map<String, Object>(); // empty config is the same as none
            def.sections[0].fields.add(visit);
            def.sections[0].fields.add(slot);

            JFormDefinition.Form saved = JFormDefinitionService.save(def);
            JFormDefinition.Form loaded = JFormDefinitionService.load(saved.id);
            JFormDefinition.Field back = loaded.fieldsByKey().get('visit');
            Assert.areEqual('2026-10-10', back.config.get('minDate'), 'config survives the database');
            Assert.areEqual(true, back.config.get('noFuture'));
            Assert.areEqual(2, ((List<Object>) back.config.get('disabledDays')).size());
            Assert.isNull(loaded.fieldsByKey().get('slot').config, 'an empty config is not stored');

            Form_Field_Definition__c rec = [SELECT Config_JSON__c FROM Form_Field_Definition__c WHERE Form__c = :saved.id AND External_Field_Definition_Id__c = 'visit'];
            Assert.isTrue(rec.Config_JSON__c.contains('"minDate":"2026-10-10"'), 'stored as JSON: ' + rec.Config_JSON__c);

            String json = loaded.serialize();
            Assert.isTrue(json.contains('"config":{'), 'JSON carries "config": ' + json);
            JFormDefinition.Form parsed = JFormDefinition.parse(json);
            Assert.areEqual('2026-10-10', parsed.fieldsByKey().get('visit').config.get('minDate'), 'config survives JSON');

            // unreadable stored JSON is ignored rather than breaking the form
            rec.Config_JSON__c = '{not json';
            update rec;
            Assert.isNull(JFormDefinitionService.load(saved.id).fieldsByKey().get('visit').config);
        }
    }

    @IsTest
    static void imageAndEventBlocksRoundTripAndCollectNoAnswer() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Blocks');
            def.targetObjectApiName = null;
            JFormDefinition.Field poster = new JFormDefinition.Field();
            poster.key = 'poster';
            poster.fieldType = 'image';
            poster.label = 'Poster';
            poster.width = 50;
            poster.config = new Map<String, Object>{ 'url' => 'https://example.file.force.com/sfc/dist/version/download/?ids=1', 'alt' => 'Clinic poster', 'fit' => 'contain', 'rowSpan' => 2 };
            JFormDefinition.Field clinic = new JFormDefinition.Field();
            clinic.key = 'clinic';
            clinic.fieldType = 'event';
            clinic.label = 'Spring Clinic';
            clinic.config = new Map<String, Object>{ 'date' => '2026-11-15', 'startTime' => '09:00', 'endTime' => '12:00', 'location' => 'WestTiger Dojo' };
            def.sections[0].fields.add(0, clinic);
            def.sections[0].fields.add(0, poster);

            JFormDefinition.Form saved = JFormDefinitionService.create(def);
            JFormDefinition.Form loaded = JFormDefinitionService.load(saved.id);
            JFormDefinition.Field posterBack = loaded.fieldsByKey().get('poster');
            JFormDefinition.Field clinicBack = loaded.fieldsByKey().get('clinic');
            Assert.areEqual('image', posterBack.fieldType);
            Assert.areEqual(50, posterBack.width);
            Assert.areEqual(2, posterBack.config.get('rowSpan'), 'rows survive the database');
            Assert.areEqual('Clinic poster', posterBack.config.get('alt'));
            Assert.areEqual('event', clinicBack.fieldType);
            Assert.areEqual('09:00', clinicBack.config.get('startTime'));
            Assert.areEqual(2, [SELECT COUNT() FROM Form_Field_Definition__c WHERE Form__c = :saved.id AND Field_Type__c IN ('Image', 'Event')], 'stored with their own picklist values');
            Assert.areEqual('event', JFormDefinition.parse(loaded.serialize()).fieldsByKey().get('clinic').fieldType, 'type survives JSON');

            // layout blocks never collect an answer
            JFormPublishService.PublishResult r = JFormPublishService.publish(saved.id, null);
            Id submissionId = JFormPublicController.submit(r.publicKey, JSON.serialize(new Map<String, Object>{
                'first_name' => 'A', 'email' => 'a@b.co', 'season' => 'autumn', 'poster' => 'x', 'clinic' => 'y'
            }));
            Assert.areEqual(0, [SELECT COUNT() FROM Submission_Field_Value__c WHERE Form_Submission__c = :submissionId AND Field_Key__c IN ('poster', 'clinic')]);
        }
    }

    @IsTest
    static void revisionsCountSavesAndRefuseStaleOnes() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormChangeEvents.published.clear();
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Revisions');
            Assert.areEqual(1, def.revision, 'create inserts at 0 and the first save makes it 1');
            Assert.isTrue(def.serialize().contains('"revision":1'), 'the revision travels in the JSON');

            def.description = 'first edit';
            JFormDefinition.Form second = JFormDefinitionService.save(def);
            Assert.areEqual(2, second.revision);
            Assert.areEqual(2, [SELECT Revision__c FROM Form__c WHERE Id = :def.id].Revision__c);

            // another editor (the agent, a second tab) saves from the same starting point
            JFormDefinition.Form stale = JFormDefinition.parse(def.serialize()); // still revision 1
            stale.description = 'from a stale copy';
            try {
                JFormDefinitionService.save(stale);
                Assert.fail('a stale save must be refused');
            } catch (JFormDefinition.ConflictException e) {
                Assert.isTrue(e.getMessage().contains('changed elsewhere'), e.getMessage());
            }
            Assert.areEqual('first edit', JFormDefinitionService.load(def.id).description, 'nothing was overwritten');

            // callers that send no revision (REST, agents with plain JSON) are not checked
            stale.revision = null;
            JFormDefinition.Form third = JFormDefinitionService.save(stale);
            Assert.areEqual(3, third.revision);

            List<Form_Changed__e> saved = new List<Form_Changed__e>();
            for (Form_Changed__e e : JFormChangeEvents.published) {
                if (e.Change__c == 'saved' && e.Form_Id__c == def.id) saved.add(e);
            }
            Assert.areEqual(3, saved.size(), 'one event per successful save (create, edit, unchecked save)');
            Assert.areEqual(3, saved[2].Revision__c);
        }
    }

    @IsTest
    static void serializeAndParseUseContractKeys() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('JSON');
            def.id = 'a00000000000001AAA';
            def.sections[0].fields[1].sortOrder = 7;
            def.theme.extra.put('fieldStyle', 'underline');
            def.theme.extra.put('labelPosition', 'ignored-because-known'); // typed keys win over extra

            String json = def.serialize();
            Assert.isTrue(json.contains('"type":"text"'), 'uses "type" not "fieldType": ' + json);
            Assert.isTrue(json.contains('"order":7'), 'uses "order"');
            Assert.isTrue(json.contains('"primary":"#0F766E"'), 'theme uses "primary"');
            Assert.isFalse(json.contains('fieldType'), 'internal names never leak');

            JFormDefinition.Form back = JFormDefinition.parse(json);
            Assert.areEqual(def.name, back.name);
            Assert.areEqual(2, back.sections.size());
            Assert.areEqual('text', back.sections[0].fields[1].fieldType);
            Assert.areEqual(7, back.sections[0].fields[1].sortOrder);
            Assert.areEqual('Summer', back.fieldsByKey().get('season').options[0].value);
            Assert.areEqual('equals', back.fieldsByKey().get('why_summer').conditionalLogic.conditions[0].operator);
            Assert.areEqual('#0F766E', back.theme.primaryColor);
            Assert.areEqual('underline', back.theme.extra.get('fieldStyle'), 'unknown theme keys round-trip');
            Assert.isFalse(json.contains('ignored-because-known'), 'extra never overrides a typed key');
            Assert.areEqual(true, back.settings.get('honeypot'));
        }
    }

    @IsTest
    static void saveWithoutIdsUpdatesInPlace() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('NoIds');
            String firstNameId = def.fieldsByKey().get('first_name').id;
            String sectionId = def.sections[0].id;
            String summerOptionId = def.fieldsByKey().get('season').options[0].id;
            // an API client round-trips its own JSON without record ids
            def.sections[0].id = null;
            for (JFormDefinition.Section s : def.sections) {
                s.id = null;
                for (JFormDefinition.Field f : s.fields) {
                    f.id = null;
                    if (f.options != null) {
                        for (JFormDefinition.Option o : f.options) {
                            o.id = null;
                        }
                    }
                }
            }
            def.fieldsByKey().get('first_name').label = 'Given name';

            JFormDefinition.Form saved = JFormDefinitionService.save(def);

            Assert.areEqual(firstNameId, saved.fieldsByKey().get('first_name').id, 'matched by key, not recreated');
            Assert.areEqual('Given name', saved.fieldsByKey().get('first_name').label);
            Assert.areEqual(sectionId, saved.sections[0].id);
            Assert.areEqual(summerOptionId, saved.fieldsByKey().get('season').options[0].id, 'options matched by value');
            Assert.areEqual(6, [SELECT COUNT() FROM Form_Field_Definition__c WHERE Form__c = :def.id]);
        }
    }

    @IsTest
    static void invalidKeysAreRenamedWithTheirReferences() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Keys');
            def.targetObjectApiName = null;
            def.fieldsByKey().get('season').key = '1st season';                 // not a valid key
            def.fieldsByKey().get('why_summer').conditionalLogic.conditions[0].field = '1st season';
            def.settings = new Map<String, Object>{ 'automation' => new Map<String, Object>{ 'steps' => new List<Object>{ new Map<String, Object>{
                'key' => 'lead', 'action' => 'create', 'object' => 'Lead', 'primary' => true, 'fields' => new List<Object>{
                    new Map<String, Object>{ 'field' => 'LastName', 'source' => new Map<String, Object>{ 'type' => 'value', 'value' => 'Keys' } },
                    new Map<String, Object>{ 'field' => 'Company', 'source' => new Map<String, Object>{ 'type' => 'value', 'value' => 'JForm' } },
                    new Map<String, Object>{ 'field' => 'Description', 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => '1st season' } }
                },
                'condition' => new Map<String, Object>{ 'match' => 'all', 'conditions' => new List<Object>{
                    new Map<String, Object>{ 'field' => '1st season', 'operator' => 'equals', 'value' => 'Summer' } } }
            } } } };

            JFormDefinition.Form saved = JFormDefinitionService.create(def);

            Assert.isNull(saved.fieldsByKey().get('1st season'));
            Assert.areEqual('field_2_1', saved.sections[1].fields[0].key, 'generated key');
            Assert.areEqual('field_2_1', saved.fieldsByKey().get('why_summer').conditionalLogic.conditions[0].field, 'rule follows the rename');
            JFormAutomationService.Step step = JFormAutomationService.steps(saved)[0];
            Assert.areEqual('field_2_1', step.fields[2].source.key, 'step mapping follows the rename');
            Assert.areEqual('field_2_1', step.condition.conditions[0].field, 'step condition follows the rename');
        }
    }

    @IsTest
    static void legacyRecordsWithoutKeysGetGeneratedKeys() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = new Form__c(Name = 'Legacy', Display_Style__c = 'Single Page');
            insert form;
            Form_Section__c section = new Form_Section__c(Form__c = form.Id, Name = 'Section 1', Section_Label__c = 'Section 1', Order__c = 1);
            insert section;
            insert new Form_Field_Definition__c(Form__c = form.Id, Form_Section__c = section.Id, Name = 'Name', Field_Label__c = 'Name', Field_Type__c = 'Text', Order__c = 0, Conditional_Logic_JSON__c = 'not json');

            JFormDefinition.Form def = JFormDefinitionService.load(form.Id);
            Assert.areEqual('section_1', def.sections[0].key);
            Assert.areEqual('field_1_1', def.sections[0].fields[0].key);
            Assert.isNull(def.sections[0].fields[0].conditionalLogic, 'malformed legacy rule ignored');
            Assert.areEqual(100, def.sections[0].fields[0].width);

            JFormDefinition.Form saved = JFormDefinitionService.save(def);
            Assert.areEqual('field_1_1', [SELECT External_Field_Definition_Id__c FROM Form_Field_Definition__c WHERE Form__c = :form.Id LIMIT 1].External_Field_Definition_Id__c, 'generated key persisted');
        }
    }
}
