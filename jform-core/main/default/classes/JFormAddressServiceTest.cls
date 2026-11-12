/**
 * Address fields. The countries and states depend on the org: with State and Country/Territory Picklists they are the
 * org's, without them JForm's own countries with typed states. Tests that depend on it branch on lists().fromOrg, and
 * typedStatesWithoutOrgPicklists checks the other path in any org.
 */
@IsTest
private class JFormAddressServiceTest {

    /** A required Address field keyed "address", set up the way the builder adds one, starting in Australia. */
    private static JFormDefinition.Field addressField() {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = 'address';
        f.fieldType = 'address';
        f.label = 'Address';
        f.required = true;
        f.config = new Map<String, Object>{ 'defaultCountry' => 'AU' };
        return f;
    }

    private static Map<String, Object> parts(JFormDefinition.Field f) {
        if (!f.config.containsKey('parts')) {
            f.config.put('parts', new Map<String, Object>());
        }
        return (Map<String, Object>) f.config.get('parts');
    }

    private static void setPart(JFormDefinition.Field f, String part, String setting, Object value) {
        if (!parts(f).containsKey(part)) {
            parts(f).put(part, new Map<String, Object>());
        }
        ((Map<String, Object>) parts(f).get(part)).put(setting, value);
    }

    private static JFormDefinition.Field text(String key, String label) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key;
        f.fieldType = 'text';
        f.label = label;
        return f;
    }

    private static JFormDefinition.Form formOf(List<JFormDefinition.Field> fields) {
        JFormDefinition.Form def = new JFormDefinition.Form();
        JFormDefinition.Section s = new JFormDefinition.Section();
        s.fields.addAll(fields);
        def.sections = new List<JFormDefinition.Section>{ s };
        return def;
    }

    /** The sample form plus a company field and the given fields on the first page, published, with no record step unless given. */
    private static Form__c publishedForm(String name, List<JFormDefinition.Field> extra, List<Object> steps) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition(name);
        def.sections[0].fields.add(text('company', 'Company'));
        def.sections[0].fields.addAll(extra);
        def.targetObjectApiName = null;
        def.settings = steps == null
            ? new Map<String, Object>{ 'target' => new Map<String, Object>{ 'strategy' => 'none' } }
            : new Map<String, Object>{ 'automation' => new Map<String, Object>{ 'steps' => steps } };
        def = JFormDefinitionService.create(def);
        Id formId = JFormPublishService.publish(def.id, null).formId;
        return [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :formId];
    }

    private static JFormDefinition.Form definitionOf(Form__c form) {
        return JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
    }

    /** The sample form's required answers, plus the answer under the given key when there is one. */
    private static Map<String, Object> answers(String key, Object answer) {
        Map<String, Object> a = new Map<String, Object>{
            'first_name' => 'Noah', 'email' => 'noah@example.com', 'company' => 'Riverside', 'season' => 'autumn'
        };
        if (answer != null) {
            a.put(key, answer);
        }
        return a;
    }

    private static Map<String, Object> sydney() {
        return new Map<String, Object>{ 'country' => 'AU', 'street' => '1 George St', 'city' => 'Sydney', 'state' => 'NSW', 'postalCode' => '2000' };
    }

    /** The message submit() refuses the answers with, or null when they are accepted. */
    private static String refusal(Form__c form, Map<String, Object> a) {
        try {
            JFormSubmissionService.submit(form, definitionOf(form), a, null);
            return null;
        } catch (JFormSubmissionService.SubmissionException e) {
            return e.getMessage();
        }
    }

    private static Map<String, Object> mapping(String field, String key) {
        return new Map<String, Object>{ 'field' => field, 'source' => new Map<String, Object>{ 'type' => 'field', 'key' => key } };
    }

    /** Mappings of an Address field's parts to an object's default address, as the builder makes them. */
    private static List<Object> addressMappings(Schema.DescribeSObjectResult d, JFormDefinition.Field f) {
        List<Object> out = new List<Object>();
        JFormAddressService.Target t = JFormAddressService.defaultTarget(d, f);
        for (String part : t.fields.keySet()) {
            out.add(mapping(t.fields.get(part), f.key + '.' + part));
        }
        return out;
    }

    private static Map<String, Object> step(String key, String objectName, Boolean primary, List<Object> fields) {
        return new Map<String, Object>{ 'key' => key, 'label' => 'Create the ' + key, 'action' => 'create', 'object' => objectName, 'primary' => primary, 'fields' => fields };
    }

    private static Boolean orgLists() {
        return JFormAddressService.lists().fromOrg;
    }

    /** A country the lists have no states for, or null. */
    private static JFormAddressService.Country countryWithoutStates() {
        for (JFormAddressService.Country c : JFormAddressService.lists().countries) {
            if (c.states.isEmpty()) {
                return c;
            }
        }
        return null;
    }

    @IsTest
    static void listsThePartsAndTheStoredCodes() {
        JFormDefinition.Field f = addressField();
        Assert.isTrue(JFormAddressService.isAddress(f));
        Assert.isTrue(JFormFieldParts.isCompound(f));
        Assert.areEqual(new List<String>{ 'address.country', 'address.street', 'address.city', 'address.state', 'address.postalCode', 'address.stateCode', 'address.countryCode' },
            JFormFieldParts.answerKeys(f));
        List<JFormFieldParts.Part> stored = JFormFieldParts.storedParts(f);
        Assert.areEqual('Address: City', JFormFieldParts.partLabel(f, stored[2]));
        Assert.areEqual('State/Province code', stored[5].label);
        Assert.isTrue(stored[5].derived);
        Assert.areEqual(40, stored[2].maxLength);

        // every part shows; settings older drafts may carry (hidden, optional) are ignored
        setPart(f, 'state', 'hidden', true);
        setPart(f, 'city', 'label', 'Suburb');
        Assert.areEqual(new List<String>{ 'country', 'street', 'city', 'state', 'postalCode' }, keysOf(JFormAddressService.parts(f)));
        Assert.areEqual('Suburb', JFormAddressService.parts(f)[2].label);

        Assert.areEqual('', JFormAddressService.purposeOf(f));
        f.config.put('purpose', ' Billing ');
        Assert.areEqual('billing', JFormAddressService.purposeOf(f));
    }

    private static List<String> keysOf(List<JFormFieldParts.Part> parts) {
        List<String> out = new List<String>();
        for (JFormFieldParts.Part p : parts) {
            out.add(p.key);
        }
        return out;
    }

    @IsTest
    static void readsTheCountriesAndStates() {
        JFormAddressService.Lists l = JFormAddressService.lists();
        Map<String, JFormAddressService.Country> byCode = new Map<String, JFormAddressService.Country>();
        for (JFormAddressService.Country c : l.countries) {
            byCode.put(c.code, c);
        }
        Assert.areEqual('Australia', byCode.get('AU').name);
        if (l.fromOrg) {
            Map<String, String> states = new Map<String, String>();
            for (JFormAddressService.Region r : byCode.get('AU').states) {
                states.put(r.code, r.name);
            }
            Assert.areEqual('New South Wales', states.get('NSW'), 'each state under its country, from validFor');
            Assert.isFalse(states.containsKey('CA'), 'California is a state of the US only');
        } else {
            Assert.areEqual(JFormCountries.entries().size(), l.countries.size());
            Assert.isTrue(byCode.get('AU').states.isEmpty(), 'states are typed');
        }

        // the public view carries the countries the form's Address fields offer, and nothing without one
        JFormDefinition.Field f = addressField();
        f.config.put('countries', new List<Object>{ 'nz', 'AU' });
        JFormAddressService.Lists offered = JFormAddressService.listsFor(formOf(new List<JFormDefinition.Field>{ f }));
        Assert.areEqual(2, offered.countries.size());
        Assert.areEqual(l.fromOrg, offered.fromOrg);
        Assert.isNull(JFormAddressService.listsFor(formOf(new List<JFormDefinition.Field>{ text('city', 'City') })));
    }

    @IsTest
    static void expandsIntoNamesCodesAndOneLine() {
        JFormDefinition.Form def = formOf(new List<JFormDefinition.Field>{ addressField() });
        Map<String, Object> answer = sydney();
        answer.put('street', ' 1 George St\nLevel 2 ');
        answer.put('state', 'nsw');
        // a caller may echo the codes or the whole address back; they are always worked out here
        answer.put('countryCode', 'NZ');
        answer.put('fullAddress', 'somewhere');
        Map<String, Object> a = new Map<String, Object>{ 'address' => answer };

        Assert.areEqual(new List<String>(), JFormAddressService.expand(def, a));
        Assert.areEqual('Australia', a.get('address.country'));
        Assert.areEqual('AU', a.get('address.countryCode'));
        Assert.areEqual('Sydney', a.get('address.city'));
        Assert.areEqual('1 George St\nLevel 2', a.get('address.street'), 'trimmed');
        if (orgLists()) {
            Assert.areEqual('New South Wales', a.get('address.state'));
            Assert.areEqual('NSW', a.get('address.stateCode'));
            Assert.areEqual('1 George St, Level 2, Sydney, NSW 2000, Australia', a.get('address'));
        } else {
            Assert.areEqual('nsw', a.get('address.state'), 'typed');
            Assert.isFalse(a.containsKey('address.stateCode'));
            Assert.areEqual('1 George St, Level 2, Sydney, nsw 2000, Australia', a.get('address'));
        }

        // a country by name, and an API caller's flat parts
        Map<String, Object> flat = new Map<String, Object>{ 'address.country' => 'australia', 'address.city' => 'Perth' };
        Assert.areEqual(new List<String>(), JFormAddressService.expand(def, flat));
        Assert.areEqual('AU', flat.get('address.countryCode'));
        Assert.areEqual('Perth, Australia', flat.get('address'));

        // whitespace alone is no answer, and nothing is stored for it
        Map<String, Object> blank = new Map<String, Object>{ 'address' => new Map<String, Object>{ 'city' => '  ', 'street' => '' } };
        Assert.areEqual(new List<String>(), JFormAddressService.expand(def, blank));
        Assert.isTrue(blank.isEmpty(), String.valueOf(blank));
    }

    @IsTest
    static void typedStatesWithoutOrgPicklists() {
        JFormAddressService.withoutOrgPicklists = true;
        Assert.isFalse(JFormAddressService.lists().fromOrg);
        Assert.areEqual(JFormCountries.entries().size(), JFormAddressService.lists().countries.size());

        JFormDefinition.Field f = addressField();
        Map<String, Object> a = new Map<String, Object>{ 'address' => sydney() };
        Assert.areEqual(new List<String>(), JFormAddressService.expand(formOf(new List<JFormDefinition.Field>{ f }), a));
        Assert.areEqual('Australia', a.get('address.country'));
        Assert.areEqual('AU', a.get('address.countryCode'));
        Assert.areEqual('NSW', a.get('address.state'));
        Assert.isFalse(a.containsKey('address.stateCode'), 'a typed state has no code');

        // the state is never required when it is typed
        a.remove('address.state');
        Assert.isNull(JFormAddressService.unanswered(f, a));
    }

    @IsTest
    static void refusesCountriesAndStatesOutsideTheLists() {
        JFormDefinition.Field f = addressField();
        JFormDefinition.Form def = formOf(new List<JFormDefinition.Field>{ f });
        Assert.areEqual(new List<String>{ 'Address: choose a country from the list.' },
            JFormAddressService.expand(def, new Map<String, Object>{ 'address' => new Map<String, Object>{ 'country' => 'XX', 'city' => 'Nowhere' } }));
        Assert.areEqual(new List<String>{ 'Address: send the address by part (country, street, city, state, postalCode).' },
            JFormAddressService.expand(def, new Map<String, Object>{ 'address' => '1 George St, Sydney' }));
        Assert.areEqual(new List<String>{ 'Address: there is no part "line2".' },
            JFormAddressService.expand(def, new Map<String, Object>{ 'address' => new Map<String, Object>{ 'country' => 'AU', 'line2' => 'Level 2' } }));

        // a country the field does not offer
        f.config.put('countries', new List<Object>{ 'NZ' });
        f.config.put('defaultCountry', 'NZ');
        Assert.areEqual(new List<String>{ 'Address: choose a country from the list.' },
            JFormAddressService.expand(def, new Map<String, Object>{ 'address' => sydney() }));
        f.config.remove('countries');

        if (orgLists()) {
            Map<String, Object> texas = sydney();
            texas.put('state', 'Texas');
            Assert.areEqual(new List<String>{ 'Address: choose a state or province of Australia from the list.' },
                JFormAddressService.expand(def, new Map<String, Object>{ 'address' => texas }));
            JFormAddressService.Country plain = countryWithoutStates();
            if (plain != null) {
                Assert.areEqual(new List<String>{ 'Address: ' + plain.name + ' has no states or provinces to choose from.' },
                    JFormAddressService.expand(def, new Map<String, Object>{ 'address' => new Map<String, Object>{ 'country' => plain.code, 'state' => 'Somewhere' } }));
            }
        }
    }

    @IsTest
    static void aCountryAloneIsNoAnswer() {
        JFormDefinition.Field f = addressField();
        f.required = false;
        JFormDefinition.Form def = formOf(new List<JFormDefinition.Field>{ f });

        // the form fills in the country before the respondent starts, so on its own it is not stored
        Map<String, Object> countryOnly = new Map<String, Object>{ 'address' => new Map<String, Object>{ 'country' => 'AU' } };
        Assert.areEqual(new List<String>(), JFormAddressService.expand(def, countryOnly));
        Assert.isTrue(countryOnly.isEmpty(), String.valueOf(countryOnly));

        Map<String, Object> a = new Map<String, Object>{ 'address' => new Map<String, Object>{ 'city' => 'Perth', 'country' => 'AU' } };
        Assert.areEqual(new List<String>(), JFormAddressService.expand(def, a));
        Assert.areEqual('Australia', a.get('address.country'));
        Assert.areEqual('Perth, Australia', a.get('address'));

        // with the org's picklists a state is chosen from the country's list, so it needs the country
        Map<String, Object> noCountry = new Map<String, Object>{ 'address' => new Map<String, Object>{ 'city' => 'Perth', 'state' => 'WA' } };
        List<String> problems = JFormAddressService.expand(def, noCountry);
        if (orgLists()) {
            Assert.areEqual(new List<String>{ 'Address: choose the country before the state or province.' }, problems);
        } else {
            Assert.isTrue(problems.isEmpty(), String.valueOf(problems));
            Assert.areEqual('WA', noCountry.get('address.state'), 'a typed state is kept as typed');
        }
    }

    @IsTest
    static void requiresEveryPart() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field f = addressField();
            Form__c form = publishedForm('Required address', new List<JFormDefinition.Field>{ f }, null);

            Assert.areEqual('Please answer: Address', refusal(form, answers('address', null)), 'the label alone when nothing is answered');
            String missing = orgLists() ? 'City, State/Province' : 'City';
            Assert.areEqual('Please answer: Address (' + missing + ')',
                refusal(form, answers('address', new Map<String, Object>{ 'country' => 'AU', 'street' => '1 George St' })), 'the state only where the country lists states');
            Map<String, Object> noPostcode = sydney();
            noPostcode.remove('postalCode');
            Assert.isNull(refusal(form, answers('address', noPostcode)), 'the postal code is optional: many countries have none');
            Map<String, Object> noStreet = sydney();
            noStreet.remove('street');
            Assert.areEqual('Please answer: Address (Street)', refusal(form, answers('address', noStreet)));
            Map<String, Object> secondLine = sydney();
            secondLine.put('street', '\n Level 2');
            Assert.isNull(refusal(form, answers('address', secondLine)), 'one line of the street is enough');
            Map<String, Object> tooLong = sydney();
            tooLong.put('city', 'S'.repeat(41));
            Assert.areEqual('Please check: Address (City): Enter no more than 40 characters', refusal(form, answers('address', tooLong)));

            JFormAddressService.Country plain = countryWithoutStates();
            if (orgLists() && plain != null) {
                Assert.isNull(refusal(form, answers('address', new Map<String, Object>{ 'country' => plain.code, 'street' => '1 Main St', 'city' => 'Town' })),
                    'no state for a country without states');
            }
        }
    }

    @IsTest
    static void storesEachPartAndTheCodes() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Form__c form = publishedForm('Address values', new List<JFormDefinition.Field>{ addressField() }, null);

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form), answers('address', sydney()), null);
            Test.stopTest();

            Map<String, Submission_Field_Value__c> byKey = new Map<String, Submission_Field_Value__c>();
            for (Submission_Field_Value__c v : [SELECT Field_Key__c, Field_Label__c, Field_Value__c, Form_Field_Definition__c
                                                FROM Submission_Field_Value__c WHERE Form_Submission__c = :res.submissionId]) {
                byKey.put(v.Field_Key__c, v);
            }
            Assert.isTrue(byKey.get('address').Field_Value__c.startsWith('1 George St, Sydney, NSW 2000'), byKey.get('address').Field_Value__c);
            Assert.areEqual('Address', byKey.get('address').Field_Label__c);
            Assert.areEqual('Sydney', byKey.get('address.city').Field_Value__c);
            Assert.areEqual('Address: City', byKey.get('address.city').Field_Label__c);
            Assert.areEqual('Australia', byKey.get('address.country').Field_Value__c);
            Assert.areEqual('AU', byKey.get('address.countryCode').Field_Value__c);
            Assert.areEqual('Address: Country code', byKey.get('address.countryCode').Field_Label__c);
            Assert.isNotNull(byKey.get('address.postalCode').Form_Field_Definition__c, 'points to the Address field');

            String csv = JFormResponsesController.exportCsv(form.Id, false, null, null);
            Assert.isTrue(csv.contains('Address: Country code'), csv);
            JFormResponsesController.ResultPage page = JFormResponsesController.getSubmissions(form.Id, 25, 0, 12, null, null, null, null, 'address.city', 'Sydney', null, null);
            Assert.areEqual(1, page.rows.size(), 'filters by a part');
            Assert.isFalse(page.columnKeys.contains('address.city'), 'one column for the address');
        }
    }

    @IsTest
    static void savesToContactLeadAndAccountAddresses() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field home = addressField();
            JFormDefinition.Field billing = addressField();
            billing.key = 'billing';
            billing.label = 'Billing address';
            billing.config.put('purpose', 'billing');
            List<Object> contactFields = new List<Object>{ mapping('LastName', 'company'), mapping('Email', 'email') };
            contactFields.addAll(addressMappings(Schema.SObjectType.Contact, home));
            List<Object> leadFields = new List<Object>{ mapping('LastName', 'first_name'), mapping('Company', 'company') };
            leadFields.addAll(addressMappings(Schema.SObjectType.Lead, home));
            List<Object> accountFields = new List<Object>{ mapping('Name', 'company') };
            accountFields.addAll(addressMappings(Schema.SObjectType.Account, billing));
            List<Object> steps = new List<Object>{
                step('contact', 'Contact', true, contactFields), step('lead', 'Lead', false, leadFields), step('account', 'Account', false, accountFields)
            };
            Form__c form = publishedForm('Address mapping', new List<JFormDefinition.Field>{ home, billing }, steps);
            Map<String, Object> a = answers('address', sydney());
            a.put('billing', new Map<String, Object>{ 'country' => 'AU', 'street' => '5 Pitt St', 'city' => 'Sydney', 'state' => 'NSW', 'postalCode' => '2000' });

            Test.startTest();
            JFormSubmissionService.Result res = JFormSubmissionService.submit(form, definitionOf(form), a, null);
            Test.stopTest();

            Assert.areEqual('Processed', res.status, 'error: ' + res.errorMessage);
            String stateField = orgLists() ? 'StateCode' : 'State';
            String countryField = orgLists() ? 'CountryCode' : 'Country';
            String country = orgLists() ? 'AU' : 'Australia';
            SObject c = Database.query('SELECT MailingStreet, MailingCity, MailingPostalCode, Mailing' + stateField + ', Mailing' + countryField + ' FROM Contact WHERE Id = \'' + res.targetRecordId + '\'');
            Assert.areEqual('1 George St', c.get('MailingStreet'));
            Assert.areEqual('Sydney', c.get('MailingCity'));
            Assert.areEqual('2000', c.get('MailingPostalCode'));
            Assert.areEqual('NSW', c.get('Mailing' + stateField), 'the code, or the typed state');
            Assert.areEqual(country, c.get('Mailing' + countryField));
            SObject l = Database.query('SELECT City, ' + countryField + ' FROM Lead WHERE Company = \'Riverside\' LIMIT 1');
            Assert.areEqual('Sydney', l.get('City'));
            Assert.areEqual(country, l.get(countryField));
            Account acc = [SELECT BillingStreet, BillingCity, ShippingCity FROM Account WHERE Name = 'Riverside' LIMIT 1];
            Assert.areEqual('5 Pitt St', acc.BillingStreet, 'the billing purpose goes to the Billing Address');
            Assert.isNull(acc.ShippingCity);
        }
    }

    @IsTest
    static void findsEachObjectsAddresses() {
        JFormDefinition.Field f = addressField();
        Map<String, JFormAddressService.Target> contact = new Map<String, JFormAddressService.Target>();
        for (JFormAddressService.Target t : JFormAddressService.targets(Schema.SObjectType.Contact)) {
            contact.put(t.name, t);
        }
        Assert.isTrue(contact.containsKey('MailingAddress') && contact.containsKey('OtherAddress'), String.valueOf(contact.keySet()));
        Map<String, String> mailing = contact.get('MailingAddress').fields;
        Assert.areEqual('MailingCity', mailing.get('city'));
        Assert.areEqual('MailingStreet', mailing.get('street'));
        if (orgLists()) {
            Assert.areEqual('MailingCountryCode', mailing.get('countryCode'), 'the codes where the org has them');
            Assert.isFalse(mailing.containsKey('country'));
        } else {
            Assert.areEqual('MailingCountry', mailing.get('country'));
        }

        Assert.areEqual('MailingAddress', JFormAddressService.defaultTarget(Schema.SObjectType.Contact, f).name);
        Assert.areEqual('Address', JFormAddressService.defaultTarget(Schema.SObjectType.Lead, f).name);
        Assert.areEqual('BillingAddress', JFormAddressService.defaultTarget(Schema.SObjectType.Account, f).name);
        f.config.put('purpose', 'shipping');
        Assert.areEqual('ShippingAddress', JFormAddressService.defaultTarget(Schema.SObjectType.Account, f).name);
        Assert.areEqual('MailingAddress', JFormAddressService.defaultTarget(Schema.SObjectType.Contact, f).name, 'Mailing when the object has no shipping address');
        Assert.isNull(JFormAddressService.defaultTarget(Schema.SObjectType.Task, f));

        Assert.areEqual('stateCode', JFormAddressService.componentPart('MailingStateCode'));
        Assert.areEqual('postalCode', JFormAddressService.componentPart('BillingPostalCode'));
        Assert.areEqual('city', JFormAddressService.componentPart('Home__City__s'));
        Assert.isNull(JFormAddressService.componentPart('MailingLatitude'));
    }

    @IsTest
    static void suggestsTheAddressForTheObject() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Suggested');
        for (JFormDefinition.Field f : def.fieldsByKey().values()) {
            f.targetFieldApiName = null;
        }
        def.sections[0].fields.add(addressField());
        def.targetObjectApiName = 'Contact';

        Map<String, String> sourceByField = new Map<String, String>();
        for (Object o : (List<Object>) ((Map<String, Object>) JFormAutomationService.stepsFromLegacy(def)[0]).get('fields')) {
            Map<String, Object> m = (Map<String, Object>) o;
            sourceByField.put(String.valueOf(m.get('field')), String.valueOf(((Map<String, Object>) m.get('source')).get('key')));
        }
        Assert.areEqual('address.city', sourceByField.get('MailingCity'), String.valueOf(sourceByField));
        Assert.areEqual('address.street', sourceByField.get('MailingStreet'));
        Assert.areEqual(orgLists() ? 'address.countryCode' : 'address.country', sourceByField.get(orgLists() ? 'MailingCountryCode' : 'MailingCountry'));
        Assert.isFalse(sourceByField.values().contains('address'), 'the whole address is never mapped');
    }

    @IsTest
    static void checksTheDefinition() {
        Assert.isTrue(JFormAddressService.definitionProblems(addressField()).isEmpty(), String.valueOf(JFormAddressService.definitionProblems(addressField())));

        JFormDefinition.Field whole = addressField();
        whole.targetFieldApiName = 'MailingStreet';
        whole.config.put('purpose', 'gift');
        whole.config.put('countries', new List<Object>{ 'AU', 'ZZ' });
        String problems = String.join(JFormAddressService.definitionProblems(whole), ' ');
        Assert.isTrue(problems.contains('is mapped part by part in a record step, with sources such as "address.city"'), problems);
        Assert.isTrue(problems.contains('the purpose must be billing or shipping, or none'), problems);
        Assert.isTrue(problems.contains('ZZ is not a country this org lists'), problems);

        JFormDefinition.Field notOffered = addressField();
        notOffered.config.put('countries', new List<Object>{ 'NZ' });
        Assert.isTrue(String.join(JFormAddressService.definitionProblems(notOffered), ' ').contains('the default country must be one of the countries offered'));

        JFormDefinition.Field longKey = addressField();
        longKey.key = 'a'.repeat(75);
        Assert.isTrue(String.join(JFormAddressService.definitionProblems(longKey), ' ').contains('the field key must be at most'));
    }

    @IsTest
    static void conditionsTestOnePart() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Field abn = text('abn', 'Your ABN');
            abn.required = true;
            abn.conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'address.country', 'equals', 'Australia');
            Form__c form = publishedForm('Address rule', new List<JFormDefinition.Field>{ addressField(), abn }, null);

            Assert.areEqual('Please answer: Your ABN', refusal(form, answers('address', sydney())), 'rules test the country name');
            Assert.isNull(refusal(form, answers('address', new Map<String, Object>{ 'country' => 'US', 'street' => '1 Main St', 'city' => 'Austin', 'state' => 'TX', 'postalCode' => '73301' })),
                'hidden, so not required');

            JFormDefinition.Form def = definitionOf(form);
            def.sections[0].fields[def.sections[0].fields.size() - 1].conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'address', 'is_not_empty', null);
            try {
                JFormDefinitionService.validate(def);
                Assert.fail('a rule on the whole address is refused');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('must test one part of the address "address", such as "address.city"'), e.getMessage());
            }
        }
    }

    @IsTest
    static void agentsAddAddressFields() {
        JFormDefinition.Form def = JFormAgentSupport.parseDefinition(
            '[{"label":"Billing address","type":"billing address","targetFieldApiName":"BillingStreet","countries":"AU, NZ","defaultCountry":"AU"},'
            + '{"label":"Where do you live?","type":"postal address"}]', 'Agent address');
        JFormDefinition.Field billing = def.fieldsByKey().get('billing_address');
        Assert.areEqual('address', billing.fieldType);
        Assert.isNull(billing.targetFieldApiName, 'never mapped whole');
        Assert.areEqual('billing', JFormAddressService.purposeOf(billing));
        Assert.areEqual('(AU, NZ)', String.valueOf(billing.config.get('countries')));
        Assert.areEqual('AU', JFormAddressService.defaultCountry(billing));
        Assert.areEqual('address', def.fieldsByKey().get('where_do_you_live').fieldType);
        Assert.areEqual('', JFormAddressService.purposeOf(def.fieldsByKey().get('where_do_you_live')));

        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
            req.formName = 'Agent delivery';
            req.definitionJson = '[{"label":"Delivery address","type":"shipping address","required":true},{"label":"Gate code","type":"text"}]';
            JFormCreateFormAction.Result created = JFormCreateFormAction.create(new List<JFormCreateFormAction.Request>{ req })[0];
            Assert.isNull(created.errorMessage, 'unexpected error: ' + created.errorMessage);
            Assert.isTrue(created.summary.contains('City (key delivery_address.city)'), created.summary);
            Assert.isTrue(created.summary.contains('shipping address'), created.summary);

            JFormAddRuleAction.Request rule = new JFormAddRuleAction.Request();
            rule.formId = created.formId;
            rule.targetField = 'Gate code';
            rule.ruleAction = 'show';
            rule.whenField = 'Delivery address';
            rule.value = 'Sydney';
            JFormAddRuleAction.Result refused = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ rule })[0];
            Assert.isTrue(String.valueOf(refused.errorMessage).contains('is an address: name one of its parts'), 'refused: ' + refused.errorMessage);

            rule.whenField = 'Delivery address: City';
            JFormAddRuleAction.Result onCity = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ rule })[0];
            Assert.isNull(onCity.errorMessage, 'unexpected error: ' + onCity.errorMessage);
            JFormDefinition.Rule r = JFormDefinitionService.load(created.formId).fieldsByKey().get('gate_code').conditionalLogic;
            Assert.areEqual('delivery_address.city', r.conditions[r.conditions.size() - 1].field);

            // answers hold the country's name, so a rule given its code stores the name
            rule.whenField = 'Delivery address: Country';
            rule.value = 'au';
            JFormAddRuleAction.Result onCountry = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ rule })[0];
            Assert.isNull(onCountry.errorMessage, 'unexpected error: ' + onCountry.errorMessage);
            r = JFormDefinitionService.load(created.formId).fieldsByKey().get('gate_code').conditionalLogic;
            Assert.areEqual('delivery_address.country', r.conditions[r.conditions.size() - 1].field);
            Assert.areEqual('Australia', r.conditions[r.conditions.size() - 1].value);

            rule.value = 'Atlantis';
            JFormAddRuleAction.Result unknown = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ rule })[0];
            Assert.isTrue(String.valueOf(unknown.errorMessage).contains('"Atlantis" is not a country Delivery address offers.'), 'refused: ' + unknown.errorMessage);

            // contains tests part of the text, so the value is kept as given
            rule.operator = 'contains';
            rule.value = ' United ';
            JFormAddRuleAction.Result partly = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ rule })[0];
            Assert.isNull(partly.errorMessage, 'unexpected error: ' + partly.errorMessage);
            r = JFormDefinitionService.load(created.formId).fieldsByKey().get('gate_code').conditionalLogic;
            Assert.areEqual('contains', r.conditions[r.conditions.size() - 1].operator);
            Assert.areEqual('United', r.conditions[r.conditions.size() - 1].value);
        }
    }

    @IsTest
    static void ruleValuesAreTheStoredNamesAndCodes() {
        JFormDefinition.Field f = addressField();
        Assert.areEqual('Australia', JFormAddressService.ruleValue(f, 'country', ' AU '));
        Assert.areEqual('Australia', JFormAddressService.ruleValue(f, 'country', 'australia'));
        Assert.areEqual('AU', JFormAddressService.ruleValue(f, 'countryCode', 'Australia'));
        Assert.areEqual('Sydney', JFormAddressService.ruleValue(f, 'city', ' Sydney '), 'other parts as given');
        try {
            JFormAddressService.ruleValue(f, 'country', 'Atlantis');
            Assert.fail('a country the lists do not have is refused');
        } catch (JFormDefinition.JFormException e) {
            Assert.areEqual('"Atlantis" is not a country Address offers.', e.getMessage());
        }

        f.config.put('countries', new List<Object>{ 'AU' });
        try {
            JFormAddressService.ruleValue(f, 'country', 'NZ');
            Assert.fail('a country the field does not offer is refused');
        } catch (JFormDefinition.JFormException e) {
            Assert.areEqual('"NZ" is not a country Address offers.', e.getMessage());
        }

        if (orgLists()) {
            Assert.areEqual('New South Wales', JFormAddressService.ruleValue(f, 'state', 'nsw'));
            Assert.areEqual('NSW', JFormAddressService.ruleValue(f, 'stateCode', 'New South Wales'));
            Assert.areEqual('Western Australia', JFormAddressService.ruleValue(f, 'state', 'WA'), 'one country offered, so WA is Western Australia');

            f.config.put('countries', new List<Object>{ 'AU', 'US' });
            try {
                JFormAddressService.ruleValue(f, 'state', 'WA');
                Assert.fail('a code two offered countries use is refused');
            } catch (JFormDefinition.JFormException e) {
                Assert.areEqual('"WA" could be Washington (United States) or Western Australia (Australia): give the state or province by name.', e.getMessage());
            }
            Assert.areEqual('Washington', JFormAddressService.ruleValue(f, 'state', 'washington'), 'a name is never ambiguous');
        } else {
            Assert.areEqual('NSW', JFormAddressService.ruleValue(f, 'state', ' NSW '), 'typed states are kept');
            try {
                JFormAddressService.ruleValue(f, 'stateCode', 'NSW');
                Assert.fail('no state codes without the org\'s lists');
            } catch (JFormDefinition.JFormException e) {
                Assert.areEqual('"NSW" is not a state or province Address offers.', e.getMessage());
            }
        }
    }
}
