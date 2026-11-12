@IsTest
private class JFormAgentActionsTest {

    // ------------------------------------------------------------ find + details

    @IsTest
    static void findFormsByTextStatusAndRecency() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form summer = JFormTestDataFactory.createSampleForm('Summer Clinic 2026');
            JFormDefinition.Form winter = JFormDefinitionService.create(JFormTestDataFactory.sampleDefinition('Winter Survey'));
            JFormPublishService.publish(winter.id, null);

            JFormFindFormsAction.Request byText = new JFormFindFormsAction.Request();
            byText.searchText = 'summer clinic';
            JFormFindFormsAction.Result r = JFormFindFormsAction.find(new List<JFormFindFormsAction.Request>{ byText })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual(1, r.formCount);
            Assert.areEqual(summer.id, r.mostRecentFormId);
            Assert.isTrue(r.formsSummary.contains('Summer Clinic 2026'), r.formsSummary);
            Assert.isTrue(r.formsSummary.contains('6 fields'), 'field count from the form lookup: ' + r.formsSummary);

            JFormFindFormsAction.Request recent = new JFormFindFormsAction.Request();
            recent.modifiedWithinDays = 30;
            recent.maxResults = 1;
            Assert.areEqual(1, JFormFindFormsAction.find(new List<JFormFindFormsAction.Request>{ recent })[0].formCount, 'max results honoured');

            JFormFindFormsAction.Request live = new JFormFindFormsAction.Request();
            live.status = 'Active';
            JFormFindFormsAction.Result liveResult = JFormFindFormsAction.find(new List<JFormFindFormsAction.Request>{ live })[0];
            Assert.areEqual(1, liveResult.formCount);
            Assert.isTrue(liveResult.formsSummary.contains('Live v1'), liveResult.formsSummary);

            JFormFindFormsAction.Request none = new JFormFindFormsAction.Request();
            none.searchText = 'no such form';
            JFormFindFormsAction.Result empty = JFormFindFormsAction.find(new List<JFormFindFormsAction.Request>{ none })[0];
            Assert.areEqual(0, empty.formCount);
            Assert.isNull(empty.mostRecentFormId);
            Assert.isTrue(empty.formsSummary.startsWith('No forms matched'));
        }
    }

    @IsTest
    static void detailsDescribePagesFieldsAndRules() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Details');

            JFormGetFormDetailsAction.Request req = new JFormGetFormDetailsAction.Request();
            req.formId = def.id;
            JFormGetFormDetailsAction.Result r = JFormGetFormDetailsAction.describe(new List<JFormGetFormDetailsAction.Request>{ req })[0];

            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual('Details', r.formName);
            Assert.areEqual('Draft, never published', r.status);
            Assert.isNull(r.publicUrl, 'no public link before publishing');
            Assert.isTrue(r.builderUrl.contains('/lightning/n/' + JFormNamespace.qualify('JForm_Workspace') + '?' + JFormNamespace.stateKey('formid') + '=' + def.id), r.builderUrl);
            Assert.isTrue(r.outline.contains('Page 2: Survey'), r.outline);
            Assert.isTrue(r.outline.contains('key season, required): Summer | Autumn'), r.outline);
            Assert.isTrue(r.outline.contains('[Show this field when Which season did you attend? equals "Summer"]'), r.outline);

            req.formId = Form__c.SObjectType.getDescribe().getKeyPrefix() + '000000000000';
            Assert.isNotNull(JFormGetFormDetailsAction.describe(new List<JFormGetFormDetailsAction.Request>{ req })[0].errorMessage);
        }
    }

    @IsTest
    static void createForContactMatchesBirthDateAndMobile() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Patient intake';
            req.targetObjectApiName = 'Contact';
            req.definitionJson = '[{"label":"First name","type":"text"},{"label":"Last name","type":"text","required":true},'
                + '{"label":"Date of birth","type":"date"},{"label":"Mobile phone","type":"phone"},{"label":"Email","type":"email"},'
                + '{"label":"Emergency contact phone","type":"phone"}]';
            JFormCreateFormAction.Result r = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Map<String, String> mapped = new Map<String, String>();
            for (JFormAutomationService.Mapping m : JFormAutomationService.steps(JFormDefinitionService.load(r.formId))[0].fields) {
                mapped.put(m.field, m.source.key);
            }
            Assert.areEqual('date_of_birth', mapped.get('Birthdate'), String.valueOf(mapped));
            Assert.areEqual('mobile_phone', mapped.get('MobilePhone'), String.valueOf(mapped));
            Assert.areEqual('mobile_phone', mapped.get('Phone'), 'the first phone answer, not the emergency contact');
            Assert.areEqual('email', mapped.get('Email'));
        }
    }

    @IsTest
    static void outlineDescribesFlowStepsAndPhonePickers() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Outline');
        JFormDefinition.Field mobile = new JFormDefinition.Field();
        mobile.key = 'mobile';
        mobile.label = 'Mobile';
        mobile.fieldType = 'phone';
        mobile.config = new Map<String, Object>{ 'countryPicker' => true, 'defaultCountry' => 'VN', 'detectCountry' => true, 'mobileOnly' => true };
        def.sections[0].fields.add(mobile);
        Map<String, Object> source = new Map<String, Object>{ 'type' => 'field', 'key' => 'first_name' };
        def.settings = new Map<String, Object>{ 'automation' => new Map<String, Object>{ 'steps' => new List<Object>{
            new Map<String, Object>{ 'key' => 'contact', 'action' => 'find_or_create', 'object' => 'Contact', 'primary' => true,
                'match' => new Map<String, Object>{ 'field' => 'Email', 'source' => source },
                'fields' => new List<Object>{ new Map<String, Object>{ 'field' => 'Email', 'source' => source } } },
            new Map<String, Object>{ 'key' => 'welcome', 'action' => 'flow', 'flow' => 'Welcome_Pack', 'flowLabel' => 'Welcome pack',
                'fields' => new List<Object>{ new Map<String, Object>{ 'field' => 'email', 'source' => source } },
                'outputs' => new List<Object>{ new Map<String, Object>{ 'name' => 'ticket', 'type' => 'String' } } }
        } } };

        String outline = JFormAgentSupport.outline(def);
        Assert.isTrue(outline.contains('Steps, run in order for each response:'), outline);
        Assert.isTrue(outline.contains('1. Find or create Contact matching Email: Email from First name [main record]'), outline);
        Assert.isTrue(outline.contains('2. Run flow Welcome pack (Welcome_Pack) (1 input, outputs ticket)'), outline);
        Assert.isTrue(outline.contains('Mobile (phone, key mobile) [country code picker, default VN, starts in the visitor\'s country, mobile numbers only]'), outline);

        mobile.config = null;
        Assert.isFalse(JFormAgentSupport.outline(def).contains('country code picker'), 'a plain phone box has no picker note');
    }

    @IsTest
    static void applyDesignSetsStyleColourAndLayout() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form start = JFormTestDataFactory.sampleDefinition('Design');
            start.theme.logoUrl = 'https://example.com/logo.png';
            JFormDefinition.Form def = JFormDefinitionService.create(start);

            JFormApplyDesignAction.Request req = new JFormApplyDesignAction.Request();
            req.formId = def.id;
            req.style = 'Teal';
            req.layout = 'one page per section';
            JFormApplyDesignAction.Result r = JFormApplyDesignAction.applyDesign(new List<JFormApplyDesignAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual('Teal style, main colour #0f766e, one page per section', r.design);
            Assert.isTrue(r.summary.contains('Design: Teal style'), r.summary);
            JFormDefinition.Form saved = JFormDefinitionService.load(def.id);
            Assert.areEqual('teal', saved.theme.preset);
            Assert.areEqual('#f1f5f4', saved.theme.background);
            Assert.areEqual('serif', saved.theme.headingFont);
            Assert.areEqual('outline', saved.theme.extra.get('fieldStyle'));
            Assert.areEqual(JFormDesignPresets.PAGED, saved.displayStyle);
            Assert.areEqual('https://example.com/logo.png', saved.theme.logoUrl, 'the logo stays');

            JFormApplyDesignAction.Request brand = new JFormApplyDesignAction.Request();
            brand.formId = def.id;
            brand.primaryColor = '2A5BD7';
            brand.layout = 'one long page';
            r = JFormApplyDesignAction.applyDesign(new List<JFormApplyDesignAction.Request>{ brand })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual('Teal style, main colour #2a5bd7, one long page', r.design);

            // gold on a white card: refused with a shade that works, nothing saved
            JFormApplyDesignAction.Request gold = new JFormApplyDesignAction.Request();
            gold.formId = def.id;
            gold.primaryColor = '#ffd700';
            r = JFormApplyDesignAction.applyDesign(new List<JFormApplyDesignAction.Request>{ gold })[0];
            Assert.isNotNull(r.errorMessage);
            Matcher m = Pattern.compile('The nearest shade that reads well is (#[0-9a-f]{6})\\.').matcher(r.errorMessage);
            Assert.isTrue(m.find(), r.errorMessage);
            Assert.isNull(JFormDesignPresets.colourProblem(m.group(1), JFormDefinitionService.load(def.id).theme), 'the offered shade passes');
            Assert.areEqual('#2a5bd7', JFormDefinitionService.load(def.id).theme.primaryColor);
        }
    }

    @IsTest
    static void applyDesignDriftSetsTheFinishAndOtherStylesClearIt() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Drift');
            JFormApplyDesignAction.Request req = new JFormApplyDesignAction.Request();
            req.formId = def.id;
            req.style = 'Drift';
            JFormApplyDesignAction.Result r = JFormApplyDesignAction.applyDesign(new List<JFormApplyDesignAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            JFormDefinition.Theme t = JFormDefinitionService.load(def.id).theme;
            Assert.areEqual('drift', t.preset);
            Assert.areEqual('mesh', t.extra.get('backgroundStyle'));
            Assert.areEqual('glass', t.extra.get('surfaceStyle'));
            Assert.areEqual('pill', t.extra.get('buttonShape'));
            Assert.areEqual('segments', t.extra.get('progressStyle'));
            Assert.areEqual('spotlight', t.extra.get('focusStyle'));
            Assert.areEqual('60', String.valueOf(t.extra.get('shadowBlur')));
            Assert.areEqual('24', String.valueOf(t.extra.get('shadowStrength')));

            req.style = 'Card';
            r = JFormApplyDesignAction.applyDesign(new List<JFormApplyDesignAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            t = JFormDefinitionService.load(def.id).theme;
            Assert.areEqual('solid', t.extra.get('backgroundStyle'), 'another style sets the page back to plain');
            Assert.areEqual('solid', t.extra.get('surfaceStyle'));
            Assert.areEqual('corners', t.extra.get('buttonShape'));
            Assert.areEqual('segments', t.extra.get('progressStyle'), 'progress is layout, which another style leaves alone');
            Assert.areEqual('none', t.extra.get('focusStyle'));
            Assert.areEqual('2', String.valueOf(t.extra.get('shadowBlur')), 'and the shadow back to soft');
            Assert.areEqual('4', String.valueOf(t.extra.get('shadowStrength')));
        }
    }

    @IsTest
    static void applyDesignRejectsUnclearRequests() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Design errors');
            Map<String, List<String>> cases = new Map<String, List<String>>{
                'Nothing to change' => new List<String>{ null, null, null },
                'Unknown style "Neon"' => new List<String>{ 'Neon', null, null },
                '"blue" is not a colour' => new List<String>{ null, 'blue', null },
                'Unknown layout "sideways"' => new List<String>{ null, null, 'sideways' }
            };
            for (String expected : cases.keySet()) {
                JFormApplyDesignAction.Request req = new JFormApplyDesignAction.Request();
                req.formId = def.id;
                req.style = cases.get(expected)[0];
                req.primaryColor = cases.get(expected)[1];
                req.layout = cases.get(expected)[2];
                String error = JFormApplyDesignAction.applyDesign(new List<JFormApplyDesignAction.Request>{ req })[0].errorMessage;
                Assert.isTrue(error != null && error.contains(expected), expected + ' / ' + error);
            }
        }
        JFormDefinition.Form plain = new JFormDefinition.Form();
        plain.sections = new List<JFormDefinition.Section>{ new JFormDefinition.Section() };
        Assert.areEqual('Card style (default), main colour #337418, one long page', JFormDesignPresets.describe(plain));
        Assert.areEqual('#ffffff', JFormDesignPresets.onColor('#0f766e'));
        Assert.areEqual('#181818', JFormDesignPresets.onColor('#ffd700'));
        Assert.areEqual('#aabbcc', JFormDesignPresets.normalizeHex('#ABC'));
    }

    // ------------------------------------------------------------ clone + create

    @IsTest
    static void cloneCopiesFormAndCanRetarget() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form source = JFormTestDataFactory.createSampleForm('Summer 2026');

            JFormCloneFormAction.Request req = new JFormCloneFormAction.Request();
            req.sourceFormId = source.id;
            req.newName = 'Autumn 2026';
            req.targetObjectApiName = 'Contact';
            JFormCloneFormAction.Result r = JFormCloneFormAction.cloneForms(new List<JFormCloneFormAction.Request>{ req })[0];

            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areNotEqual(source.id, r.newFormId);
            JFormDefinition.Form copy = JFormDefinitionService.load(r.newFormId);
            Assert.areEqual('Autumn 2026', copy.name);
            Assert.areEqual('Contact', copy.targetObjectApiName);
            Assert.areEqual(2, copy.sections.size());
            Assert.isNotNull(copy.fieldsByKey().get('why_summer').conditionalLogic, 'rules copied');
            Assert.isTrue(r.summary.contains('creates Contact records'), r.summary);
        }
    }

    @IsTest
    static void createFromLooseFieldListWithAliases() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Store Visit Booking';
            req.description = 'Book a visit';
            req.targetObjectApiName = 'Lead';
            req.definitionJson = JSON.serialize(new List<Object>{
                new Map<String, Object>{ 'label' => 'Email', 'type' => 'email', 'required' => true },
                new Map<String, Object>{ 'label' => 'Store', 'type' => 'dropdown', 'options' => new List<Object>{ 'London', 'Leeds' } },
                new Map<String, Object>{ 'label' => 'Anything else?', 'type' => 'long text' },
                new Map<String, Object>{ 'label' => 'First visit?', 'type' => 'Yes/No' },
                new Map<String, Object>{ 'label' => 'Width', 'type' => 'text', 'width' => '50%' },
                'Company'
            });
            JFormCreateFormAction.Result r = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];

            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            JFormDefinition.Form saved = JFormDefinitionService.load(r.formId);
            Assert.areEqual('Book a visit', saved.description);
            Assert.areEqual('Lead', saved.targetObjectApiName);
            Assert.areEqual(1, saved.sections.size());
            Map<String, JFormDefinition.Field> byKey = saved.fieldsByKey();
            Assert.areEqual('picklist', byKey.get('store').fieldType);
            Assert.areEqual(2, byKey.get('store').options.size());
            Assert.areEqual('Leeds', byKey.get('store').options[1].value);
            Assert.areEqual('comment', byKey.get('anything_else').fieldType);
            Assert.areEqual('yesno', byKey.get('first_visit').fieldType);
            Assert.areEqual(50, byKey.get('width').width);
            Assert.areEqual('text', byKey.get('company').fieldType, 'plain strings become text fields');
            Assert.isTrue(byKey.get('email').required);
            Assert.isTrue(r.builderUrl.endsWith(r.formId));
        }
    }

    @IsTest
    static void createFromPagesWithLabelRules() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Event RSVP';
            req.definitionJson = JSON.serialize(new List<Object>{
                new Map<String, Object>{ 'name' => 'You', 'fields' => new List<Object>{
                    new Map<String, Object>{ 'label' => 'How will you travel?', 'type' => 'single choice', 'options' => new List<Object>{ 'Driving', 'Train' } }
                } },
                new Map<String, Object>{ 'title' => 'Parking', 'fields' => new List<Object>{
                    new Map<String, Object>{ 'label' => 'Number plate', 'type' => 'text',
                        'conditionalLogic' => new Map<String, Object>{ 'action' => 'show', 'match' => 'all', 'conditions' => new List<Object>{
                            new Map<String, Object>{ 'field' => 'How will you travel?', 'operator' => 'equals', 'value' => 'Driving' }
                        } } }
                } }
            });
            JFormCreateFormAction.Result r = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];

            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            JFormDefinition.Form saved = JFormDefinitionService.load(r.formId);
            Assert.areEqual(2, saved.sections.size());
            Assert.areEqual('Parking', saved.sections[1].label);
            JFormDefinition.Field plate = saved.fieldsByKey().get('number_plate');
            Assert.areEqual('how_will_you_travel', plate.conditionalLogic.conditions[0].field, 'label reference resolved to key');
            Assert.areEqual('radio', saved.fieldsByKey().get('how_will_you_travel').fieldType);
        }
    }

    @IsTest
    static void createBlankAndRejectBadJson() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request blank = new JFormCreateFormAction.Request();
            blank.formName = 'Blank';
            JFormCreateFormAction.Result ok = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ blank })[0];
            Assert.isNull(ok.errorMessage, 'unexpected error: ' + ok.errorMessage);
            Assert.isTrue(ok.summary.contains('(no fields yet)'), ok.summary);

            JFormCreateFormAction.Request bad = new JFormCreateFormAction.Request();
            bad.formName = 'Bad';
            bad.definitionJson = '{not json';
            Assert.isNotNull(JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ bad })[0].errorMessage);

            bad.definitionJson = '{"title":"no fields"}';
            Assert.isTrue(JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ bad })[0].errorMessage.contains('sections'));
        }
    }

    @IsTest
    static void createKeepsWordingInATextBlockAndItsLabelShort() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            String wording = 'Medical release and liability waiver. ' + 'Sports training carries a risk of injury. '.repeat(10) + '\nPhotos & video may be taken.';
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Waiver wording';
            req.definitionJson = JSON.serialize(new List<Object>{
                new Map<String, Object>{ 'label' => wording, 'type' => 'rich text' },
                new Map<String, Object>{ 'label' => wording, 'type' => 'rich text', 'richtext' => '<p>Short wording.</p>' },
                new Map<String, Object>{ 'label' => 'Emergency care', 'type' => 'rich text', 'richtext' => 'I authorise treatment.\nPhotos & video may be taken.' },
                new Map<String, Object>{ 'label' => 'Marked up', 'type' => 'rich text', 'richtext' => 'Read <b>this</b> first.' }
            });
            JFormCreateFormAction.Result r = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'a label holds 255 characters, so wording sent as the label must not stay there: ' + r.errorMessage);

            List<JFormDefinition.Field> fields = JFormDefinitionService.load(r.formId).sections[0].fields;
            Assert.isTrue(fields[0].label.startsWith('Medical release and liability waiver.'), fields[0].label);
            Assert.isTrue(fields[0].label.length() <= 80, fields[0].label);
            Assert.isTrue(fields[0].richtext.startsWith('<p>Medical release and liability waiver. Sports training'), fields[0].richtext);
            Assert.isTrue(fields[0].richtext.endsWith('<br>Photos &amp; video may be taken.</p>'), fields[0].richtext);
            Assert.isTrue(fields[1].label.length() <= 80, 'a long label is cut even when the wording came separately: ' + fields[1].label);
            Assert.areEqual('<p>Short wording.</p>', fields[1].richtext);
            Assert.areEqual('<p>I authorise treatment.<br>Photos &amp; video may be taken.</p>', fields[2].richtext, 'plain text keeps its line breaks');
            Assert.areEqual('Read <b>this</b> first.', fields[3].richtext, 'markup stays as it was sent');
            Assert.areEqual('Emergency care', fields[2].label);
        }
    }

    @IsTest
    static void createBuildsNamePhoneWaiverAndPaymentAsTheBuilderDoes() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Skills clinic';
            req.definitionJson = JSON.serialize(new List<Object>{
                new Map<String, Object>{ 'name' => 'Participant', 'fields' => new List<Object>{
                    new Map<String, Object>{ 'label' => 'Participant full name', 'type' => 'name', 'required' => true },
                    new Map<String, Object>{ 'label' => 'Primary phone', 'type' => 'Phone Field', 'required' => true },
                    new Map<String, Object>{ 'label' => 'Office phone', 'type' => 'phone', 'countryPicker' => false },
                    new Map<String, Object>{ 'label' => 'Session', 'type' => 'checkboxes', 'options' => new List<Object>{ 'Morning Session (9:00 AM \u2013 12:00 PM)', 'Full-Day Pass' } }
                } },
                new Map<String, Object>{ 'name' => 'Waiver', 'fields' => new List<Object>{
                    new Map<String, Object>{ 'label' => 'Liability waiver', 'type' => 'rich text', 'richtext' => '<p>I release the clinic from claims.</p>' },
                    new Map<String, Object>{ 'label' => 'Medical release', 'type' => 'rich text', 'defaultValue' => 'I authorise emergency treatment.' },
                    new Map<String, Object>{ 'label' => 'Photo release', 'type' => 'rich text', 'required' => true, 'helpText' => 'We may take photos.\n\nThey may appear online & in print.' },
                    new Map<String, Object>{ 'label' => 'I have read and agree to the waiver above', 'type' => 'consent', 'required' => true },
                    new Map<String, Object>{ 'label' => 'Signature', 'type' => 'Digital Signature', 'required' => true },
                    new Map<String, Object>{ 'label' => 'Date signed', 'type' => 'date', 'defaultValue' => 'today' },
                    new Map<String, Object>{ 'label' => 'Clinic start', 'type' => 'date', 'defaultValue' => '2026-07-01' }
                } },
                new Map<String, Object>{ 'name' => 'Payment', 'fields' => new List<Object>{
                    new Map<String, Object>{ 'label' => 'Clinic fee', 'type' => 'Payment Gateway', 'required' => true,
                        'options' => new List<Object>{ 'Credit Card', 'Apple Pay' }, 'source' => 'session',
                        'prices' => new Map<String, Object>{ 'morning session (9:00 am - 12:00  pm)' => '$75', 'full-day' => 130 } },
                    new Map<String, Object>{ 'label' => 'Discount Code / Promo Field', 'type' => 'text' }
                } }
            });
            JFormCreateFormAction.Result r = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);

            JFormDefinition.Form saved = JFormDefinitionService.load(r.formId);
            Assert.areEqual(3, saved.sections.size(), 'one page per section');
            Map<String, JFormDefinition.Field> byKey = saved.fieldsByKey();
            Assert.areEqual('name', byKey.get('participant_full_name').fieldType);
            JFormDefinition.Field phone = byKey.get('primary_phone');
            Assert.areEqual('phone', phone.fieldType, '"Phone Field" is a phone field');
            Assert.areEqual(true, phone.config.get('countryPicker'), 'a new phone field gets the picker, as in the builder');
            Assert.areEqual(true, phone.config.get('detectCountry'));
            Assert.areEqual(JFormAgentSupport.localeCountry(UserInfo.getLocale()), phone.config.get('defaultCountry'));
            Assert.areEqual(false, byKey.get('office_phone').config.get('countryPicker'), 'a plain box when asked for');
            Assert.areEqual('consent', byKey.get('i_have_read_and_agree_to_the_waiver_above').fieldType);
            Assert.areEqual('<p>I release the clinic from claims.</p>', byKey.get('liability_waiver').richtext);
            JFormDefinition.Field photos = byKey.get('photo_release');
            Assert.areEqual('<p>We may take photos.</p><p>They may appear online &amp; in print.</p>', photos.richtext, 'a text block shows only its richtext, so the wording goes there');
            Assert.isNull(photos.helpText);
            Assert.isFalse(photos.required, 'nothing is answered in a text block');
            JFormDefinition.Field medical = byKey.get('medical_release');
            Assert.areEqual('<p>I authorise emergency treatment.</p>', medical.richtext, 'wording sent as a default value is still the wording');
            Assert.isNull(medical.defaultValue);
            Assert.areEqual('signature', byKey.get('signature').fieldType);
            Assert.isNull(byKey.get('date_signed').defaultValue, '"today" is no date the box can show');
            Assert.areEqual('2026-07-01', byKey.get('clinic_start').defaultValue);

            JFormDefinition.Field pay = byKey.get('clinic_fee');
            Assert.areEqual('payment', pay.fieldType);
            Assert.isFalse(pay.required, 'a Payment block is never required');
            Assert.isTrue(pay.options == null || pay.options.isEmpty(), 'payment methods are the checkout\'s, not choices');
            Assert.areEqual('choice', pay.config.get('pricing'), 'prices from a choice field');
            Assert.areEqual('session', pay.config.get('source'));
            Map<String, Decimal> prices = new Map<String, Decimal>();
            for (Object o : (List<Object>) pay.config.get('prices')) {
                Map<String, Object> p = (Map<String, Object>) o;
                prices.put((String) p.get('value'), Decimal.valueOf(String.valueOf(p.get('amount'))));
            }
            Assert.areEqual(new Map<String, Decimal>{ 'Morning Session (9:00 AM \u2013 12:00 PM)' => 75, 'Full-Day Pass' => 130 }, prices, 'choices matched by label whatever the case, dash or spacing, or by a label\'s start; "$75" read as 75');
            Assert.isTrue(JFormPaymentPricing.publishProblems(saved, 'USD').isEmpty(), String.valueOf(JFormPaymentPricing.publishProblems(saved, 'USD')));

            Assert.isTrue(r.summary.contains('Clinic fee (payment, key clinic_fee): price by Session: Morning Session (9:00 AM \u2013 12:00 PM) USD 75 | Full-Day Pass USD 130; test payments'), r.summary);
            Assert.isTrue(r.summary.contains('Primary phone (phone, key primary_phone, required) [country code picker'), r.summary);
            Assert.isTrue(r.summary.contains('Remove "Discount Code / Promo Field" with Update Field'), 'a code box on a paid form takes nothing off: ' + r.summary);
            Assert.isTrue(r.summary.endsWith('Next, in this same turn: add each rule the plan agreed with Add Logic Rule, and call Apply Design with the agreed style, main colour and layout. Then show the outline and this builder link, copied exactly: ' + r.builderUrl), r.summary);
        }
    }

    @IsTest
    static void createRefusesACalculatedField() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Fee form';
            req.definitionJson = '[{"label":"Email","type":"email"},{"label":"Clinic fee","type":"Calculated Field"}]';
            JFormCreateFormAction.Result r = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];
            Assert.areEqual(JFormAgentSupport.NO_CALCULATED, r.errorMessage, 'a stand-in box would let people type their own fee');
            Assert.areEqual(0, [SELECT COUNT() FROM Form__c WHERE Name = 'Fee form'], 'nothing was created');
        }
    }

    @IsTest
    static void addFieldsPricesAPaymentByAFieldAlreadyOnTheForm() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Priced');
            JFormAddFieldsAction.Request req = new JFormAddFieldsAction.Request();
            req.formId = def.id;
            req.fieldsJson = '[{"label":"Fee","type":"checkout","source":"Which season did you attend?","prices":[{"label":"AUTUMN","price":"20.5"},{"option":"Winter","amount":5}]}]';
            JFormAddFieldsAction.Result refused = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ req })[0];
            Assert.areEqual('The Payment block has a price for "Winter", which is not a choice of "Which season did you attend?". Name each price by one of its choices: "Summer", "Autumn".', refused.errorMessage, 'a price no one can pick would leave that choice free');
            Assert.isNull(JFormDefinitionService.load(def.id).fieldsByKey().get('fee'), 'nothing was added');

            req.fieldsJson = '[{"label":"Fee","type":"checkout","source":"Which season did you attend?","prices":[{"label":"AUTUMN","price":"20.5"}]}]';
            JFormAddFieldsAction.Result r = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            JFormDefinition.Field fee = JFormDefinitionService.load(def.id).fieldsByKey().get('fee');
            Assert.areEqual('payment', fee.fieldType);
            Assert.areEqual('season', fee.config.get('source'), 'the label became the key');
            Map<String, Object> autumn = (Map<String, Object>) ((List<Object>) fee.config.get('prices'))[0];
            Assert.areEqual('autumn', autumn.get('value'), 'the option\'s value, not its label');
            Assert.areEqual(20.5, Decimal.valueOf(String.valueOf(autumn.get('amount'))));
            Assert.isTrue(r.summary.contains('price by Which season did you attend?: Autumn USD 20.5; test payments'), r.summary);

            JFormAddFieldsAction.Request perTicket = new JFormAddFieldsAction.Request();
            perTicket.formId = def.id;
            perTicket.fieldsJson = '[{"label":"Tickets","type":"number"},{"label":"Ticket price","type":"payment","source":"Tickets","unitPrice":12}]';
            Assert.isTrue(JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ perTicket })[0].errorMessage.contains('one Payment block'), 'a form has one');
        }
    }

    // ------------------------------------------------------------ add fields

    @IsTest
    static void addFieldsToNamedNewAndLastPage() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Add fields');

            JFormAddFieldsAction.Request toContact = new JFormAddFieldsAction.Request();
            toContact.formId = def.id;
            toContact.pageName = 'Contact details';
            toContact.fieldsJson = '[{"label":"Work email","type":"email"},{"label":"Phone","type":"phone number"}]';
            JFormAddFieldsAction.Result r1 = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ toContact })[0];
            Assert.isNull(r1.errorMessage, 'unexpected error: ' + r1.errorMessage);
            Assert.areEqual('work_email, phone', r1.addedFieldKeys, 'keys come from the labels');

            JFormAddFieldsAction.Request newPage = new JFormAddFieldsAction.Request();
            newPage.formId = def.id;
            newPage.newPageName = 'Dietary needs';
            newPage.fieldsJson = '{"fields":[{"label":"Diet","type":"checkboxes","options":["Vegetarian","Vegan"]}]}';
            Assert.isNull(JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ newPage })[0].errorMessage);

            JFormAddFieldsAction.Request last = new JFormAddFieldsAction.Request();
            last.formId = def.id;
            last.fieldsJson = '["Allergies"]';
            Assert.isNull(JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ last })[0].errorMessage);

            JFormDefinition.Form saved = JFormDefinitionService.load(def.id);
            Assert.areEqual(3, saved.sections.size());
            Assert.areEqual(5, saved.sections[0].fields.size());
            Assert.areEqual('Dietary needs', saved.sections[2].label);
            Assert.areEqual(new List<String>{ 'diet', 'allergies' }, new List<String>{ saved.sections[2].fields[0].key, saved.sections[2].fields[1].key });

            JFormAddFieldsAction.Request missing = new JFormAddFieldsAction.Request();
            missing.formId = def.id;
            missing.pageName = 'Nope';
            missing.fieldsJson = '["X"]';
            String err = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ missing })[0].errorMessage;
            Assert.isTrue(err.contains('Pages: Contact details, Survey, Dietary needs'), err);

            missing.pageName = null;
            missing.fieldsJson = '42';
            Assert.isNotNull(JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ missing })[0].errorMessage);
        }
    }

    // ------------------------------------------------------------ rules

    @IsTest
    static void addRuleMatchesChoicesAndCombines() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Rules');

            JFormAddRuleAction.Request req = new JFormAddRuleAction.Request();
            req.formId = def.id;
            req.targetField = 'How likely are you to recommend us?';
            req.ruleAction = 'Require';
            req.whenField = 'season';
            req.operator = 'is';
            req.value = 'AUTUMN';
            JFormAddRuleAction.Result r = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual('Require "How likely are you to recommend us?" when Which season did you attend? equals "autumn"', r.ruleSentence);

            req.operator = 'is not empty';
            req.value = null;
            req.whenField = 'Email';
            req.combine = 'or';
            r = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ req })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            JFormDefinition.Rule saved = JFormDefinitionService.load(def.id).fieldsByKey().get('nps').conditionalLogic;
            Assert.areEqual('any', saved.match);
            Assert.areEqual(2, saved.conditions.size());
            Assert.areEqual('is_not_empty', saved.conditions[1].operator);

            JFormAddRuleAction.Request page = new JFormAddRuleAction.Request();
            page.formId = def.id;
            page.targetField = 'page 2';
            page.ruleAction = 'hide';
            page.whenField = 'First name';
            page.operator = 'equals';
            page.value = 'Test';
            r = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ page })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual('Hide page "Survey" when First name equals "Test"', r.ruleSentence);
            Assert.areEqual('hide', JFormDefinitionService.load(def.id).sections[1].conditionalLogic.action);
        }
    }

    @IsTest
    static void addRuleRejectsBadInput() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Bad rules');
            Map<String, String> expectations = new Map<String, String>{
                'action' => 'show, hide or require',
                'operator' => 'Unknown operator',
                'when' => 'No field called',
                'target' => 'No field or page called',
                'pageRequire' => 'not required',
                'self' => 'cannot depend on itself',
                'value' => 'A value is needed',
                'choice' => 'Choices: Summer, Autumn'
            };
            for (String scenario : expectations.keySet()) {
                JFormAddRuleAction.Request req = new JFormAddRuleAction.Request();
                req.formId = def.id;
                req.targetField = scenario == 'target' ? 'Missing' : (scenario == 'pageRequire' ? 'Survey' : (scenario == 'self' ? 'season' : 'nps'));
                req.ruleAction = scenario == 'action' ? 'skip' : (scenario == 'pageRequire' ? 'require' : 'show');
                req.whenField = scenario == 'when' ? 'Missing' : 'season';
                req.operator = scenario == 'operator' ? 'roughly' : 'equals';
                req.value = scenario == 'value' ? null : (scenario == 'choice' ? 'Winter' : 'Summer');
                String err = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ req })[0].errorMessage;
                Assert.isNotNull(err, scenario + ' should fail');
                Assert.isTrue(err.contains(expectations.get(scenario)), scenario + ': ' + err);
            }
        }
    }

    @IsTest
    static void aPaymentBlockCannotBeMadeRequired() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Pay rules');
            JFormDefinition.Field block = new JFormDefinition.Field();
            block.key = 'pay';
            block.fieldType = 'payment';
            block.label = 'Payment';
            block.config = new Map<String, Object>{ 'pricing' => 'fixed', 'amount' => 10 };
            def.sections[1].fields.add(block);
            JFormDefinitionService.save(def);

            // the builder's properties panel never offers the flag; the Logic tab, the agent and the API are told why
            JFormAddRuleAction.Request req = new JFormAddRuleAction.Request();
            req.formId = def.id;
            req.targetField = 'Payment';
            req.ruleAction = 'require';
            req.whenField = 'season';
            req.operator = 'equals';
            req.value = 'Summer';
            String err = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ req })[0].errorMessage;
            Assert.isTrue(err != null && err.contains('never optional'), err);
            req.ruleAction = 'hide';
            Assert.isNull(JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ req })[0].errorMessage, 'it can be shown or hidden');

            JFormUpdateFieldAction.Request up = new JFormUpdateFieldAction.Request();
            up.formId = def.id;
            up.field = 'Payment';
            up.required = 'yes';
            JFormUpdateFieldAction.Result r = JFormUpdateFieldAction.updateField(new List<JFormUpdateFieldAction.Request>{ up })[0];
            Assert.isTrue(r.errorMessage != null && r.errorMessage.contains('never optional'), r.errorMessage);
            Assert.isFalse(JFormDefinitionService.load(def.id).fieldsByKey().get('pay').required);
        }
    }

    // ------------------------------------------------------------ publish + responses

    @IsTest
    static void publishReturnsVersionKeyAndLinks() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Publish me');

            JFormPublishFormAction.Request req = new JFormPublishFormAction.Request();
            req.formId = def.id;
            req.releaseNote = 'first';
            JFormPublishFormAction.Result r = JFormPublishFormAction.publish(new List<JFormPublishFormAction.Request>{ req })[0];

            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual(1, r.versionNumber);
            Assert.isNotNull(r.publicKey);
            Assert.isTrue(r.previewUrl.endsWith(JFormNamespace.stateKey('key') + '=' + r.publicKey), r.previewUrl);
            if (r.publicUrl != null) {
                Assert.isTrue(r.publicUrl.endsWith('/form?key=' + r.publicKey), r.publicUrl);
                Assert.isTrue(r.embedSnippet.contains(r.publicUrl + '&embed=1'));
            }

            JFormPublishFormAction.Result again = JFormPublishFormAction.publish(new List<JFormPublishFormAction.Request>{ req })[0];
            Assert.areEqual(2, again.versionNumber);
            Assert.areEqual(r.publicKey, again.publicKey, 'key is stable');

            req.formId = null;
            Assert.isNotNull(JFormPublishFormAction.publish(new List<JFormPublishFormAction.Request>{ req })[0].errorMessage);
        }
    }

    @IsTest
    static void responseSummaryCountsChoices() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Summary');
            def.targetObjectApiName = null;
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult pub = JFormPublishService.publish(def.id, null);
            JFormPublicController.submit(pub.publicKey, '{"first_name":"A","email":"a@example.com","season":"Summer","why_summer":"sun"}');
            JFormPublicController.submit(pub.publicKey, '{"first_name":"B","email":"b@example.com","season":"autumn"}');

            JFormResponseSummaryAction.Request req = new JFormResponseSummaryAction.Request();
            req.formId = def.id;
            JFormResponseSummaryAction.Result r = JFormResponseSummaryAction.summarise(new List<JFormResponseSummaryAction.Request>{ req })[0];

            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual(2, r.totalResponses);
            Assert.isTrue(r.summary.contains('Total responses: 2'), r.summary);
            Assert.isTrue(r.summary.contains('Which season did you attend?: '), r.summary);

            req.formId = 'not an id';
            Assert.isNotNull(JFormResponseSummaryAction.summarise(new List<JFormResponseSummaryAction.Request>{ req })[0].errorMessage);
        }
    }

    // ------------------------------------------------------------ support helpers

    @IsTest
    static void supportHelpers() {
        Assert.areEqual('picklist', JFormAgentSupport.normaliseType('Dropdown'));
        Assert.areEqual('checkboxes', JFormAgentSupport.normaliseType('Multi-Select'));
        Assert.areEqual('checkboxes', JFormAgentSupport.normaliseType('multiselect'));
        Assert.areEqual('fileupload', JFormAgentSupport.normaliseType('File_Upload'));
        Assert.areEqual('text', JFormAgentSupport.normaliseType('something odd'));
        Assert.areEqual('email', JFormAgentSupport.normaliseType('Email Field'));
        Assert.areEqual('date', JFormAgentSupport.normaliseType('Date Picker'));
        Assert.areEqual('payment', JFormAgentSupport.normaliseType('Payment Module'));
        Assert.areEqual('signature', JFormAgentSupport.normaliseType('E-Signature Field'));
        Assert.areEqual('AU', JFormAgentSupport.localeCountry('en_AU'));
        Assert.areEqual('RS', JFormAgentSupport.localeCountry('sr_Latn_RS'));
        Assert.areEqual('US', JFormAgentSupport.localeCountry('en'));
        Assert.areEqual('US', JFormAgentSupport.localeCountry(null));

        Set<String> used = new Set<String>{ 'email' };
        Assert.areEqual('email_2', JFormAgentSupport.keyFromLabel('Email', used));
        Assert.areEqual('field_1st_choice', JFormAgentSupport.keyFromLabel('1st choice!', used));
        Assert.areEqual('field', JFormAgentSupport.keyFromLabel('???', used));

        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Helpers');
        Assert.areEqual('survey', JFormAgentSupport.findPage(def, '2').key);
        Assert.areEqual('survey', JFormAgentSupport.findPage(def, 'Page 2').key);
        Assert.isNull(JFormAgentSupport.findPage(def, 'page 9'));
        Assert.areEqual('why_summer', JFormAgentSupport.findField(def, 'like about summer').key, 'label contains');
        Assert.isNull(JFormAgentSupport.findField(def, ''));
        Assert.isNull(JFormAgentSupport.publicUrl(def), 'no key, no link');
        Assert.isNull(JFormAgentSupport.embedSnippet(null, 'k', 't'));
        String snippet = JFormAgentSupport.embedSnippet('https://x.site.com/form?key=k1', 'k1', 'Tom & Jerry');
        Assert.isTrue(snippet.contains('title="Tom &amp; Jerry"'), snippet);
        Assert.isTrue(snippet.contains('"jform:height"'));
        Assert.isTrue(snippet.contains('"jform:redirect"'), 'the embed can move the page after the thank-you screen');
        Assert.isTrue(snippet.contains('e.origin==="https://x.site.com"'), 'only the form\'s site may resize or redirect');
        Assert.areEqual('https://x.site.com:8443', JFormAgentSupport.originOf('https://x.site.com:8443/form?key=k1'));
        Assert.isNull(JFormAgentSupport.originOf('not a link'));

        def.version = 3;
        def.status = 'Inactive';
        Assert.areEqual('Inactive (last published version 3)', JFormAgentSupport.statusText(def));
        def.isActive = true;
        Assert.areEqual('Live, version 3', JFormAgentSupport.statusText(def));
    }

    @IsTest
    static void addFieldsRefusesALabelThatAlreadyExists() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Twins');
            JFormAddFieldsAction.Request req = new JFormAddFieldsAction.Request();
            req.formId = def.id;
            req.fieldsJson = '[{"label":"which season did you attend?","type":"single choice","options":["Summer","Autumn","Winter"]}]';
            JFormAddFieldsAction.Result r = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ req })[0];
            Assert.isNotNull(r.errorMessage, 'a second field with the same label is refused');
            Assert.isTrue(r.errorMessage.contains('key season'), r.errorMessage);
            Assert.isTrue(r.errorMessage.contains('Update Field'), r.errorMessage);
            Assert.areEqual(1, [SELECT COUNT() FROM Form_Field_Definition__c WHERE Form__c = :def.id AND Field_Label__c LIKE 'Which season%'], 'nothing was added');
        }
    }

    @IsTest
    static void updateFieldChangesChoicesLabelRequiredAndPosition() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Edit');

            JFormUpdateFieldAction.Request add = new JFormUpdateFieldAction.Request();
            add.formId = def.id;
            add.field = 'Which session'; // close enough: label contains it
            add.field = 'which season did you attend?';
            add.addOptions = 'Winter, Summer'; // Summer is already there
            add.required = 'no'; // the sample's season field starts out required
            add.helpText = 'Pick one';
            JFormUpdateFieldAction.Result r = JFormUpdateFieldAction.updateField(new List<JFormUpdateFieldAction.Request>{ add })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.areEqual('season', r.fieldKey);
            Assert.isTrue(r.changes.contains('added Winter'), r.changes);
            Assert.isTrue(r.changes.contains('now optional'), r.changes);
            JFormDefinition.Field season = JFormDefinitionService.load(def.id).fieldsByKey().get('season');
            Assert.areEqual(3, season.options.size(), 'Winter added once, Summer not duplicated');
            Assert.areEqual('Winter', season.options[2].label);
            Assert.isFalse(season.required);
            Assert.areEqual('Pick one', season.helpText);

            JFormUpdateFieldAction.Request rename = new JFormUpdateFieldAction.Request();
            rename.formId = def.id;
            rename.field = 'season';
            rename.newLabel = 'Season attended';
            rename.removeOptions = 'autumn';
            rename.afterField = 'How likely are you to recommend us?';
            r = JFormUpdateFieldAction.updateField(new List<JFormUpdateFieldAction.Request>{ rename })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            JFormDefinition.Form after = JFormDefinitionService.load(def.id);
            season = after.fieldsByKey().get('season');
            Assert.areEqual('Season attended', season.label);
            Assert.areEqual(2, season.options.size(), 'Autumn removed by value');
            List<JFormDefinition.Field> survey = after.sections[1].fields;
            Assert.areEqual('season', survey[survey.size() - 1].key, 'moved after the last field');
            Assert.isNotNull(after.fieldsByKey().get('why_summer').conditionalLogic, 'the rule on the renamed field still stands (keys are stable)');

            JFormUpdateFieldAction.Request bad = new JFormUpdateFieldAction.Request();
            bad.formId = def.id;
            bad.field = 'Email';
            bad.addOptions = 'Nope';
            r = JFormUpdateFieldAction.updateField(new List<JFormUpdateFieldAction.Request>{ bad })[0];
            Assert.isTrue(r.errorMessage.contains('has no choices'), r.errorMessage);

            JFormUpdateFieldAction.Request none = new JFormUpdateFieldAction.Request();
            none.formId = def.id;
            none.field = 'no such field';
            none.required = 'yes';
            r = JFormUpdateFieldAction.updateField(new List<JFormUpdateFieldAction.Request>{ none })[0];
            Assert.isTrue(r.errorMessage.contains('No field matching'), r.errorMessage);
        }
    }

    @IsTest
    static void updateFieldCanRemoveAFieldAndItsReferences() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Remove');
            Assert.isNotNull(def.fieldsByKey().get('why_summer').conditionalLogic, 'the sample rule refers to season');
            JFormUpdateFieldAction.Request rm = new JFormUpdateFieldAction.Request();
            rm.formId = def.id;
            rm.field = 'Which season did you attend?';
            rm.remove = true;
            JFormUpdateFieldAction.Result r = JFormUpdateFieldAction.updateField(new List<JFormUpdateFieldAction.Request>{ rm })[0];
            Assert.isNull(r.errorMessage, 'unexpected error: ' + r.errorMessage);
            Assert.isTrue(r.changes.contains('removed'), r.changes);
            JFormDefinition.Form after = JFormDefinitionService.load(def.id);
            Assert.isNull(after.fieldsByKey().get('season'));
            Assert.isNull(after.fieldsByKey().get('why_summer').conditionalLogic, 'the rule that pointed at the removed field is dropped');
            Assert.areEqual(3, JFormUpdateFieldAction.splitList('Morning, Afternoon, Evening ,').size(), 'one line: commas separate');
            List<String> lines = JFormUpdateFieldAction.splitList('Korea, Republic of\nCôte d\'Ivoire,\n\nPeru');
            Assert.areEqual(new List<String>{ 'Korea, Republic of', 'Côte d\'Ivoire', 'Peru' }, lines, 'one per line keeps commas inside a choice');
        }
    }
}
