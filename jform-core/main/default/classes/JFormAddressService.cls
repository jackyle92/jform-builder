/**
 * Address fields: Country, Street, City, State/Province and Zip/Postal code in one field, like the Mailing Address
 * on a Salesforce record page. config: purpose (empty, "billing" or "shipping"), defaultCountry, detectCountry,
 * countries (the codes offered; all when missing) and parts.<key> with label and placeholder. Every part shows, and a
 * required field needs every part but the postal code (see unanswered).
 *
 * The renderer sends { street, city, state, postalCode, country }: the country as its code, and the state as its
 * code when it was chosen from a list. expand() stores each part under "<field key>.<part>" with the country and
 * state names, their codes under "<key>.countryCode" and "<key>.stateCode", and the one-line address under the
 * field key. People read the names (Responses, the export, {{key.city}}); record steps write the codes to
 * StateCode and CountryCode where the org has State and Country/Territory Picklists. What Address shares with Name
 * is in JFormFieldParts.
 *
 * The countries and states come from the org's picklists (Contact.MailingCountryCode and MailingStateCode, read by
 * describe so the package installs in orgs without them), or from JFormCountries with typed states.
 * Mirrors addressParts() in c/jformFieldRegistry.
 */
public inherited sharing class JFormAddressService {

    public static final String FIELD_TYPE = 'address';
    public static final String COUNTRY = 'country';
    public static final String STREET = 'street';
    public static final String CITY = 'city';
    public static final String STATE = 'state';
    public static final String POSTAL_CODE = 'postalCode';
    /** Not parts the respondent fills in: worked out from the lists and stored next to the names. */
    public static final String STATE_CODE = 'stateCode';
    public static final String COUNTRY_CODE = 'countryCode';
    public static final Set<String> PURPOSES = new Set<String>{ 'billing', 'shipping' };

    /** The parts in display order: the country first, since it decides the state list. */
    private static final List<String> PART_KEYS = new List<String>{ COUNTRY, STREET, CITY, STATE, POSTAL_CODE };
    private static final List<String> STORED_KEYS = new List<String>{ COUNTRY, STREET, CITY, STATE, POSTAL_CODE, STATE_CODE, COUNTRY_CODE };
    private static final Map<String, String> DEFAULT_LABELS = new Map<String, String>{
        COUNTRY => 'Country', STREET => 'Street', CITY => 'City', STATE => 'State/Province', POSTAL_CODE => 'Zip/Postal code'
    };
    /** Salesforce's own lengths for MailingStreet, MailingCity, MailingState and MailingPostalCode. */
    private static final Map<String, Integer> LENGTHS = new Map<String, Integer>{ STREET => 255, CITY => 40, STATE => 80, POSTAL_CODE => 20 };
    /** The address a record step fills on an object, by purpose, before any other address it has. */
    private static final Map<String, List<String>> PREFERRED_TARGETS = new Map<String, List<String>>{
        '' => new List<String>{ 'MailingAddress', 'Address', 'BillingAddress' },
        'billing' => new List<String>{ 'BillingAddress', 'MailingAddress', 'Address' },
        'shipping' => new List<String>{ 'ShippingAddress', 'MailingAddress', 'Address' }
    };

    public class Lists {
        /** True when the lists are the org's State and Country/Territory Picklists. */
        @AuraEnabled public Boolean fromOrg = false;
        @AuraEnabled public List<Country> countries = new List<Country>();
    }

    public class Country {
        @AuraEnabled public String code;
        @AuraEnabled public String name;
        /** The org's states or provinces of this country; empty when it has none, or the state is typed. */
        @AuraEnabled public List<Region> states = new List<Region>();
    }

    public class Region {
        @AuraEnabled public String code;
        @AuraEnabled public String name;
    }

    /** An object's address: a compound field such as MailingAddress and the fields it fills, by answer part. */
    public class Target {
        public String name;
        public String label;
        /** Answer part => object field: street, city and postalCode, with stateCode and countryCode where the org has them, else state and country. */
        public Map<String, String> fields = new Map<String, String>();
    }

    public static Boolean isAddress(JFormDefinition.Field f) {
        return f != null && f.fieldType == FIELD_TYPE;
    }

    /** The parts a respondent fills in, in display order, with their settings filled in. */
    public static List<JFormFieldParts.Part> parts(JFormDefinition.Field f) {
        List<JFormFieldParts.Part> out = new List<JFormFieldParts.Part>();
        for (String key : PART_KEYS) {
            out.add(part(f, key));
        }
        return out;
    }

    /** Every stored part: the parts, then the codes. */
    public static List<JFormFieldParts.Part> storedParts(JFormDefinition.Field f) {
        List<JFormFieldParts.Part> out = parts(f);
        out.add(derivedPart(STATE_CODE, part(f, STATE).label + ' code'));
        out.add(derivedPart(COUNTRY_CODE, part(f, COUNTRY).label + ' code'));
        return out;
    }

    public static String purposeOf(JFormDefinition.Field f) {
        Object raw = f == null || f.config == null ? null : f.config.get('purpose');
        String purpose = raw == null ? '' : String.valueOf(raw).trim().toLowerCase();
        return PURPOSES.contains(purpose) ? purpose : '';
    }

    public static String defaultCountry(JFormDefinition.Field f) {
        Object raw = f == null || f.config == null ? null : f.config.get('defaultCountry');
        return raw == null || String.isBlank(String.valueOf(raw)) ? null : String.valueOf(raw).trim().toUpperCase();
    }

    // ------------------------------------------------------------ lists

    private static Lists cachedLists;
    /** Ignore the org's picklists, so tests in such an org can check the typed-state path too. */
    @TestVisible private static Boolean withoutOrgPicklists = false;

    /** The countries, with their states where the org lists them. Read once per transaction. */
    public static Lists lists() {
        if (cachedLists == null) {
            cachedLists = readLists();
        }
        return cachedLists;
    }

    /** The countries a field offers, in list order: config.countries, or every country when it names none. */
    public static List<Country> offered(JFormDefinition.Field f) {
        Set<String> chosen = chosenCountries(f);
        List<Country> out = new List<Country>();
        for (Country c : lists().countries) {
            if (chosen.isEmpty() || chosen.contains(c.code)) {
                out.add(c);
            }
        }
        return out;
    }

    /** What the renderer needs: the countries the form's Address fields offer, with their states. Null without one. */
    public static Lists listsFor(JFormDefinition.Form def) {
        Set<String> codes = new Set<String>();
        Boolean hasAddress = false;
        for (JFormDefinition.Section s : def == null || def.sections == null ? new List<JFormDefinition.Section>() : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (isAddress(f)) {
                    hasAddress = true;
                    for (Country c : offered(f)) {
                        codes.add(c.code);
                    }
                }
            }
        }
        if (!hasAddress) {
            return null;
        }
        Lists out = new Lists();
        out.fromOrg = lists().fromOrg;
        for (Country c : lists().countries) {
            if (codes.contains(c.code)) {
                out.countries.add(c);
            }
        }
        return out;
    }

    private static Lists readLists() {
        Map<String, Schema.SObjectField> contactFields = Schema.SObjectType.Contact.fields.getMap();
        Schema.SObjectField countryField = withoutOrgPicklists ? null : contactFields.get('mailingcountrycode');
        Lists l = new Lists();
        if (countryField == null) {
            for (String entry : JFormCountries.entries()) {
                l.countries.add(country(entry.substringBefore('='), entry.substringAfter('=')));
            }
            return l;
        }
        l.fromOrg = true;
        // a state's validFor numbers the country entries in describe order, inactive ones included
        List<Country> byIndex = new List<Country>();
        for (Schema.PicklistEntry e : countryField.getDescribe().getPicklistValues()) {
            Country c = e.isActive() ? country(e.getValue(), e.getLabel()) : null;
            if (c != null) {
                l.countries.add(c);
            }
            byIndex.add(c);
        }
        Schema.SObjectField stateField = contactFields.get('mailingstatecode');
        if (stateField == null) {
            return l;
        }
        // validFor, a bitmap of the countries a state belongs to, shows only in the entry's JSON
        List<Schema.PicklistEntry> stateEntries = stateField.getDescribe().getPicklistValues();
        List<Object> stateJson = (List<Object>) JSON.deserializeUntyped(JSON.serialize(stateEntries));
        for (Integer i = 0; i < stateEntries.size(); i++) {
            Schema.PicklistEntry e = stateEntries[i];
            Object validFor = ((Map<String, Object>) stateJson[i]).get('validFor');
            if (!e.isActive() || validFor == null) {
                continue;
            }
            List<Integer> hex = EncodingUtil.convertToHex(EncodingUtil.base64Decode(String.valueOf(validFor))).getChars();
            for (Integer h = 0; h < hex.size(); h++) {
                // '0' to '9' and 'a' to 'f'; most digits are 0
                Integer nibble = hex[h] <= 57 ? hex[h] - 48 : hex[h] - 87;
                for (Integer b = 0; nibble > 0 && b < 4; b++) {
                    Integer index = h * 4 + b;
                    if ((nibble & (8 >> b)) != 0 && index < byIndex.size() && byIndex[index] != null) {
                        Region r = new Region();
                        r.code = e.getValue();
                        r.name = e.getLabel();
                        byIndex[index].states.add(r);
                    }
                }
            }
        }
        return l;
    }

    // ------------------------------------------------------------ answers

    /**
     * Replace each Address answer object with one trimmed answer per part, the country and state names and codes,
     * and the one-line address under the field key. Returns problems for an answer that is not an object, names a
     * part the field does not have, or a country or state that is not in the lists.
     */
    public static List<String> expand(JFormDefinition.Form def, Map<String, Object> answers) {
        List<String> problems = new List<String>();
        if (def == null || def.sections == null || answers == null) {
            return problems;
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (!isAddress(f)) {
                    continue;
                }
                // a caller may echo the codes or the whole address back; they are always worked out here
                Map<String, Object> byPart = JFormFieldParts.takeAnswer(f, answers, PART_KEYS, new Set<String>{ STATE_CODE, COUNTRY_CODE, 'fullAddress' }, 'address', problems);
                if (byPart == null) {
                    continue;
                }
                String problem = resolve(f, byPart);
                if (problem != null) {
                    problems.add(JFormFieldParts.name(f) + ': ' + problem);
                    continue;
                }
                JFormFieldParts.putParts(f, answers, STORED_KEYS, byPart);
                String line = oneLine(f, answers);
                if (String.isNotBlank(line)) {
                    answers.put(f.key, line);
                }
            }
        }
        return problems;
    }

    /**
     * Turn an answer by part into what is stored: the country and a listed state as name and code. Returns why the
     * answer cannot be taken, or null.
     */
    private static String resolve(JFormDefinition.Field f, Map<String, Object> byPart) {
        Boolean typed = false;
        for (String key : PART_KEYS) {
            typed = typed || (key != COUNTRY && byPart.containsKey(key));
        }
        // a country alone is no answer: the form fills it in before the respondent starts
        if (!typed) {
            byPart.remove(COUNTRY);
        }
        Country c = null;
        if (byPart.containsKey(COUNTRY)) {
            c = findCountry(f, String.valueOf(byPart.get(COUNTRY)));
            if (c == null) {
                return 'choose a country from the list.';
            }
            byPart.put(COUNTRY, c.name);
            byPart.put(COUNTRY_CODE, c.code);
        }
        if (byPart.containsKey(STATE) && c == null && lists().fromOrg) {
            // the state is chosen from the country's list; the form shows none until there is a country
            return 'choose the country before the state or province.';
        }
        if (byPart.containsKey(STATE) && c != null) {
            if (!c.states.isEmpty()) {
                Region r = findState(c, String.valueOf(byPart.get(STATE)));
                if (r == null) {
                    return 'choose a state or province of ' + c.name + ' from the list.';
                }
                byPart.put(STATE, r.name);
                byPart.put(STATE_CODE, r.code);
            } else if (lists().fromOrg) {
                // Salesforce refuses a state for a country it lists none for
                return c.name + ' has no states or provinces to choose from.';
            }
        }
        return null;
    }

    /**
     * The value a logic rule on an address part stores: answers hold the country and a listed state as names, and
     * their codes under countryCode and stateCode, so "AU" or "NSW" becomes the name, or the code for a code part.
     * A typed state, or another part, is kept as given. Throws when the country or state is not one the field offers,
     * or a state code is used by more than one of its countries.
     */
    public static String ruleValue(JFormDefinition.Field f, String part, String given) {
        String value = given == null ? '' : given.trim();
        if (part == COUNTRY || part == COUNTRY_CODE) {
            Country c = findCountry(f, value);
            if (c == null) {
                throw new JFormDefinition.JFormException('"' + value + '" is not a country ' + JFormFieldParts.name(f) + ' offers.');
            }
            return part == COUNTRY ? c.name : c.code;
        }
        if (part != STATE && part != STATE_CODE) {
            return value;
        }
        // a name first, then a code, which two countries can share (WA)
        Map<String, String> byName = new Map<String, String>();
        Map<String, String> byCode = new Map<String, String>();
        for (Country c : offered(f)) {
            for (Region r : c.states) {
                if (r.name.equalsIgnoreCase(value)) {
                    byName.put(r.name + ' (' + c.name + ')', part == STATE ? r.name : r.code);
                } else if (r.code.equalsIgnoreCase(value)) {
                    byCode.put(r.name + ' (' + c.name + ')', part == STATE ? r.name : r.code);
                }
            }
        }
        Map<String, String> hits = byName.isEmpty() ? byCode : byName;
        Set<String> values = new Set<String>(hits.values());
        if (values.size() == 1) {
            return new List<String>(values)[0];
        }
        if (values.size() > 1) {
            List<String> names = new List<String>(hits.keySet());
            names.sort();
            throw new JFormDefinition.JFormException('"' + value + '" could be ' + String.join(names, ' or ') + ': give the state or province by name.');
        }
        if (part == STATE_CODE) {
            throw new JFormDefinition.JFormException('"' + value + '" is not a state or province ' + JFormFieldParts.name(f) + ' offers.');
        }
        // a state typed where the country lists none
        return value;
    }

    /** One line for people: "1 George St, Sydney, NSW 2000, Australia", empty parts left out. */
    public static String oneLine(JFormDefinition.Field f, Map<String, Object> answers) {
        List<String> segments = new List<String>();
        String street = text(answers, f, STREET);
        if (String.isNotBlank(street)) {
            List<String> lines = new List<String>();
            for (String line : street.split('\\s*\\r?\\n\\s*')) {
                if (String.isNotBlank(line)) {
                    lines.add(line.trim());
                }
            }
            segments.add(String.join(lines, ', '));
        }
        String region = String.isNotBlank(text(answers, f, STATE_CODE)) ? text(answers, f, STATE_CODE) : text(answers, f, STATE);
        for (String segment : new List<String>{ text(answers, f, CITY), (region + ' ' + text(answers, f, POSTAL_CODE)).trim(), text(answers, f, COUNTRY) }) {
            if (String.isNotBlank(segment)) {
                segments.add(segment);
            }
        }
        return String.join(segments, ', ');
    }

    /**
     * What a required Address field still needs, for "Please answer: ...": every part but the postal code, which many
     * countries do not have. The state is needed only when the chosen country has states in the list, since typed
     * states are not always part of an address, and one line of the street is enough. Null when nothing is missing.
     */
    public static String unanswered(JFormDefinition.Field f, Map<String, Object> answers) {
        Country c = findCountry(f, text(answers, f, COUNTRY_CODE));
        List<String> missing = new List<String>();
        Integer needed = 0;
        for (JFormFieldParts.Part p : parts(f)) {
            if (p.key == POSTAL_CODE || (p.key == STATE && (c == null || c.states.isEmpty()))) {
                continue;
            }
            needed++;
            if (JFormSubmissionService.isEmpty(answers.get(JFormFieldParts.answerKey(f, p)))) {
                missing.add(p.label);
            }
        }
        return JFormFieldParts.missingText(f, missing, needed);
    }

    /**
     * Problems with an Address field's definition: a whole-field mapping, the stored key length, the purpose,
     * and countries that are not in the lists.
     */
    public static List<String> definitionProblems(JFormDefinition.Field f) {
        String label = 'Address "' + JFormFieldParts.name(f) + '"';
        // the longest stored part key, "countryCode", must still fit the stored answer key
        List<String> problems = JFormFieldParts.commonDefinitionProblems(f, label, CITY, COUNTRY_CODE);
        Object purpose = f.config == null ? null : f.config.get('purpose');
        if (purpose != null && String.isNotBlank(String.valueOf(purpose)) && !PURPOSES.contains(String.valueOf(purpose).trim().toLowerCase())) {
            problems.add(label + ': the purpose must be billing or shipping, or none.');
        }
        Set<String> known = new Set<String>();
        for (Country c : lists().countries) {
            known.add(c.code);
        }
        Set<String> chosen = chosenCountries(f);
        List<String> unknown = new List<String>();
        for (String code : chosen) {
            if (!known.contains(code)) {
                unknown.add(code);
            }
        }
        if (!unknown.isEmpty()) {
            unknown.sort();
            problems.add(label + ': ' + String.join(unknown, ', ') + (unknown.size() == 1 ? ' is not a country' : ' are not countries') + ' this org lists.');
        }
        String fallback = defaultCountry(f);
        if (fallback != null && (!known.contains(fallback) || (!chosen.isEmpty() && !chosen.contains(fallback)))) {
            problems.add(label + ': the default country must be one of the countries offered.');
        }
        return problems;
    }

    // ------------------------------------------------------------ record steps

    /**
     * An object's addresses, by describe: the compound Address fields (Mailing and Other on a Contact, the Lead's
     * Address, Billing and Shipping on an Account, custom ones) and their createable component fields. StateCode
     * and CountryCode exist only where the org has State and Country/Territory Picklists, and are used when they do.
     */
    public static List<Target> targets(Schema.DescribeSObjectResult d) {
        Map<String, Schema.DescribeFieldResult> described = new Map<String, Schema.DescribeFieldResult>();
        for (Schema.SObjectField sf : d.fields.getMap().values()) {
            Schema.DescribeFieldResult fd = sf.getDescribe();
            described.put(fd.getName().toLowerCase(), fd);
        }
        return targets(described);
    }

    /** The same from fields a caller has already described, by lower-case API name, so they are described once. */
    public static List<Target> targets(Map<String, Schema.DescribeFieldResult> described) {
        Map<String, Target> byName = new Map<String, Target>();
        List<Target> out = new List<Target>();
        for (Schema.DescribeFieldResult fd : described.values()) {
            String compound = fd.getCompoundFieldName();
            String partKey = compound == null ? null : componentPart(fd.getName());
            if (partKey == null || !fd.isCreateable()) {
                continue;
            }
            Schema.DescribeFieldResult compoundField = described.get(compound.toLowerCase());
            if (compoundField == null || compoundField.getType() != Schema.DisplayType.ADDRESS) {
                continue;
            }
            Target t = byName.get(compound);
            if (t == null) {
                t = new Target();
                t.name = compoundField.getName();
                t.label = compoundField.getLabel();
                byName.put(compound, t);
                out.add(t);
            }
            t.fields.put(partKey, fd.getName());
        }
        for (Target t : out) {
            // the codes replace the names where the org has them
            if (t.fields.containsKey(STATE_CODE)) {
                t.fields.remove(STATE);
            }
            if (t.fields.containsKey(COUNTRY_CODE)) {
                t.fields.remove(COUNTRY);
            }
        }
        return out;
    }

    /** The address a record step fills for a field: by purpose, Mailing, the Lead's Address, Billing or Shipping, else the first. */
    public static Target defaultTarget(Schema.DescribeSObjectResult d, JFormDefinition.Field f) {
        return defaultTarget(targets(d), f);
    }

    /** The same from an object's addresses (targets), for several fields of one object. */
    public static Target defaultTarget(List<Target> all, JFormDefinition.Field f) {
        for (String name : PREFERRED_TARGETS.get(purposeOf(f))) {
            for (Target t : all) {
                if (t.name.equalsIgnoreCase(name)) {
                    return t;
                }
            }
        }
        return all.isEmpty() ? null : all[0];
    }

    /** The answer part an address component field takes: MailingStateCode is stateCode, Home__City__s is city; null for others (Latitude). */
    public static String componentPart(String fieldName) {
        String n = fieldName.toLowerCase().removeEnd('__s');
        for (String suffix : new List<String>{ 'statecode', 'countrycode', 'postalcode', 'street', 'city', 'state', 'country' }) {
            if (n.endsWith(suffix)) {
                return suffix == 'statecode' ? STATE_CODE : suffix == 'countrycode' ? COUNTRY_CODE : suffix == 'postalcode' ? POSTAL_CODE : suffix;
            }
        }
        return null;
    }

    // ------------------------------------------------------------ helpers

    private static JFormFieldParts.Part part(JFormDefinition.Field f, String key) {
        JFormFieldParts.Part p = new JFormFieldParts.Part();
        p.key = key;
        p.label = JFormFieldParts.labelOf(JFormFieldParts.settings(f, key), DEFAULT_LABELS.get(key));
        p.maxLength = LENGTHS.get(key);
        return p;
    }

    private static JFormFieldParts.Part derivedPart(String key, String label) {
        JFormFieldParts.Part p = new JFormFieldParts.Part();
        p.key = key;
        p.label = label;
        p.derived = true;
        return p;
    }

    private static Country country(String code, String name) {
        Country c = new Country();
        c.code = code;
        c.name = name;
        return c;
    }

    /** config.countries as upper-case codes; empty when the field offers every country. */
    private static Set<String> chosenCountries(JFormDefinition.Field f) {
        Set<String> out = new Set<String>();
        Object raw = f == null || f.config == null ? null : f.config.get('countries');
        if (raw instanceof List<Object>) {
            for (Object code : (List<Object>) raw) {
                if (code != null && String.isNotBlank(String.valueOf(code))) {
                    out.add(String.valueOf(code).trim().toUpperCase());
                }
            }
        }
        return out;
    }

    /** An offered country by code or by name, ignoring case; null when the field does not offer it. */
    private static Country findCountry(JFormDefinition.Field f, String raw) {
        if (String.isBlank(raw)) {
            return null;
        }
        String needle = raw.trim();
        for (Country c : offered(f)) {
            if (c.code.equalsIgnoreCase(needle) || c.name.equalsIgnoreCase(needle)) {
                return c;
            }
        }
        return null;
    }

    private static Region findState(Country c, String raw) {
        String needle = raw == null ? '' : raw.trim();
        for (Region r : c.states) {
            if (r.code.equalsIgnoreCase(needle) || r.name.equalsIgnoreCase(needle)) {
                return r;
            }
        }
        return null;
    }

    private static String text(Map<String, Object> answers, JFormDefinition.Field f, String key) {
        Object value = answers == null ? null : answers.get(f.key + '.' + key);
        return value == null ? '' : String.valueOf(value).trim();
    }
}
