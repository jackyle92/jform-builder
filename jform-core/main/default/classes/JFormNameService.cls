/**
 * Name fields: first and last name in one field, always in that order. Each part's settings are in config.parts
 * by part key (label, placeholder, defaultValue, maxLength).
 *
 * The renderer sends a Name answer as one object, { "firstName": "Jane", "lastName": "Doe" }.
 * expand() runs at the start of a submission and replaces it with one trimmed answer per part under
 * "<field key>.<part key>", and the full name under the field key, so the required check, JFormAnswerValidator,
 * the stored values and the record steps see each part: a record step maps a part to FirstName or LastName.
 * Conditions and record steps use a part, never the whole name. What Name shares with Address is in
 * JFormFieldParts. Mirrors nameParts() and fullNameOf() in c/jformFieldRegistry.
 */
public inherited sharing class JFormNameService {

    public static final String FIELD_TYPE = 'name';
    public static final String FIRST_NAME = 'firstName';
    public static final String LAST_NAME = 'lastName';
    /** Not a part: the full name, worked out from the parts and stored under the field key. */
    public static final String FULL_NAME = 'fullName';
    /** The longest a part's max length can be set: a stored answer holds 255 characters. */
    public static final Integer MAX_PART_LENGTH = JFormFieldParts.MAX_PART_LENGTH;
    /** The standard field each part fills on a Contact or Lead. */
    public static final Map<String, String> OBJECT_FIELDS = new Map<String, String>{
        FIRST_NAME => 'FirstName', LAST_NAME => 'LastName'
    };
    /** The parts in display order. */
    private static final List<String> PART_KEYS = new List<String>{ FIRST_NAME, LAST_NAME };
    private static final Map<String, String> DEFAULT_LABELS = new Map<String, String>{
        FIRST_NAME => 'First name', LAST_NAME => 'Last name'
    };
    /** Salesforce's own lengths for Contact and Lead first and last names. */
    private static final Map<String, Integer> DEFAULT_LENGTHS = new Map<String, Integer>{ FIRST_NAME => 40, LAST_NAME => 80 };

    public class Part extends JFormFieldParts.Part {
    }

    public static Boolean isName(JFormDefinition.Field f) {
        return f != null && f.fieldType == FIELD_TYPE;
    }

    /** A Name field's parts, first name then last name, with their settings filled in. */
    public static List<Part> parts(JFormDefinition.Field f) {
        List<Part> out = new List<Part>();
        for (String key : PART_KEYS) {
            Map<String, Object> s = JFormFieldParts.settings(f, key);
            Part p = new Part();
            p.key = key;
            p.label = JFormFieldParts.labelOf(s, DEFAULT_LABELS.get(key));
            Integer max = JFormFieldParts.intOf(s.get('maxLength'));
            p.maxLength = max != null && max > 0 ? Math.min(max, MAX_PART_LENGTH) : DEFAULT_LENGTHS.get(key);
            out.add(p);
        }
        return out;
    }

    public static String answerKey(JFormDefinition.Field f, Part p) {
        return JFormFieldParts.answerKey(f, p);
    }

    /** The stored part's label: "Name: First name". */
    public static String partLabel(JFormDefinition.Field f, Part p) {
        return JFormFieldParts.partLabel(f, p);
    }

    /** The keys a Name field's answer is read from: one per part. */
    public static List<String> answerKeys(JFormDefinition.Field f) {
        return JFormFieldParts.answerKeys(f);
    }

    /**
     * Replace each Name answer object with one trimmed answer per part and the full name under the field key.
     * An API caller may also send the parts as "field.part" answers. Returns problems for an answer that is not
     * an object or names a part the field does not have.
     */
    public static List<String> expand(JFormDefinition.Form def, Map<String, Object> answers) {
        List<String> problems = new List<String>();
        if (def == null || def.sections == null || answers == null) {
            return problems;
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (!isName(f)) {
                    continue;
                }
                // a caller may echo the full name back; it is always worked out here
                Map<String, Object> byPart = JFormFieldParts.takeAnswer(f, answers, PART_KEYS, new Set<String>{ FULL_NAME }, 'name', problems);
                if (byPart == null) {
                    continue;
                }
                JFormFieldParts.putParts(f, answers, PART_KEYS, byPart);
                String full = fullName(f, answers);
                if (String.isNotBlank(full)) {
                    answers.put(f.key, full);
                }
            }
        }
        return problems;
    }

    /** The full name from expanded answers: first name then last name, empty ones left out ("Jane Doe"). */
    public static String fullName(JFormDefinition.Field f, Map<String, Object> answers) {
        List<String> words = new List<String>();
        for (Part p : parts(f)) {
            Object value = answers == null ? null : answers.get(answerKey(f, p));
            String text = value == null ? '' : String.valueOf(value).trim();
            if (String.isNotBlank(text)) {
                words.add(text);
            }
        }
        return String.join(words, ' ');
    }

    /**
     * What a required Name field still needs, for "Please answer: ...": the label alone when first and last
     * name are both missing, the label and the missing part otherwise. Null when both are there.
     */
    public static String unanswered(JFormDefinition.Field f, Map<String, Object> answers) {
        List<String> missing = new List<String>();
        for (Part p : parts(f)) {
            if (JFormSubmissionService.isEmpty(answers.get(answerKey(f, p)))) {
                missing.add(p.label);
            }
        }
        return JFormFieldParts.missingText(f, missing, PART_KEYS.size());
    }

    /** Problems with a Name field's definition: a whole-field mapping, max lengths and the stored key length. */
    public static List<String> definitionProblems(JFormDefinition.Field f) {
        String label = 'Name "' + JFormFieldParts.name(f) + '"';
        // the longest part key, "firstName", must still fit the stored answer key
        List<String> problems = JFormFieldParts.commonDefinitionProblems(f, label, LAST_NAME, FIRST_NAME);
        for (String key : DEFAULT_LENGTHS.keySet()) {
            Object raw = JFormFieldParts.settings(f, key).get('maxLength');
            Integer max = JFormFieldParts.intOf(raw);
            if (raw != null && (max == null || max < 1 || max > MAX_PART_LENGTH)) {
                problems.add(label + ': the ' + DEFAULT_LABELS.get(key).toLowerCase() + ' max length must be a whole number from 1 to ' + MAX_PART_LENGTH + '.');
            }
        }
        return problems;
    }
}
