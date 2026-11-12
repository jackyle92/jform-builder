/**
 * Fields made of parts: Name (first and last name, JFormNameService) and Address (JFormAddressService).
 *
 * The renderer sends such a field's answer as one object by part. expand() runs at the start of a submission and
 * replaces it with one trimmed answer per part under "<field key>.<part key>", and the whole value (the full name,
 * the one-line address) under the field key, so the required check, JFormAnswerValidator, the stored values, the
 * Responses tab, logic rules and record steps see each part. Rules and record steps use a part, never the whole
 * field. Mirrors partsOf() and answerFieldsOf() in c/jformFieldRegistry.
 */
public inherited sharing class JFormFieldParts {

    /** The longest a part's max length can be set: a stored answer holds 255 characters. */
    public static final Integer MAX_PART_LENGTH = 255;
    private static final Integer MAX_LABEL_LENGTH = 255;

    public virtual class Part {
        public String key;
        public String label;
        public Integer maxLength;
        /** Worked out on the server (an address's country code), never filled in: stored and mapped, not checked for length. */
        public Boolean derived = false;
    }

    public static Boolean isCompound(JFormDefinition.Field f) {
        return JFormNameService.isName(f) || JFormAddressService.isAddress(f);
    }

    /** The parts a respondent fills in, in display order; for an address, the shown ones. */
    public static List<Part> parts(JFormDefinition.Field f) {
        List<Part> out = new List<Part>();
        if (JFormNameService.isName(f)) {
            for (JFormNameService.Part p : JFormNameService.parts(f)) {
                out.add(p);
            }
        } else if (JFormAddressService.isAddress(f)) {
            out.addAll(JFormAddressService.parts(f));
        }
        return out;
    }

    /** Every part a field stores: the filled-in ones, then the derived ones (an address's codes). */
    public static List<Part> storedParts(JFormDefinition.Field f) {
        return JFormAddressService.isAddress(f) ? JFormAddressService.storedParts(f) : parts(f);
    }

    public static String answerKey(JFormDefinition.Field f, Part p) {
        return f.key + '.' + p.key;
    }

    /** The stored part's label: "Name: First name". */
    public static String partLabel(JFormDefinition.Field f, Part p) {
        return (name(f) + ': ' + p.label).left(MAX_LABEL_LENGTH);
    }

    /** The keys a field's answer is read from: one per stored part. */
    public static List<String> answerKeys(JFormDefinition.Field f) {
        List<String> keys = new List<String>();
        for (Part p : storedParts(f)) {
            keys.add(answerKey(f, p));
        }
        return keys;
    }

    /** Replace each Name and Address answer object with one answer per part (see the services). Returns problems. */
    public static List<String> expand(JFormDefinition.Form def, Map<String, Object> answers) {
        List<String> problems = JFormNameService.expand(def, answers);
        problems.addAll(JFormAddressService.expand(def, answers));
        return problems;
    }

    /** What a required field still needs, for "Please answer: ...", or null when it is answered. */
    public static String unanswered(JFormDefinition.Field f, Map<String, Object> answers) {
        if (JFormNameService.isName(f)) {
            return JFormNameService.unanswered(f, answers);
        }
        return JFormAddressService.unanswered(f, answers);
    }

    /** Answers longer than their part allows, as "Name (Last name): Enter no more than 80 characters". */
    public static List<String> lengthProblems(JFormDefinition.Field f, Map<String, Object> answers) {
        List<String> problems = new List<String>();
        for (Part p : parts(f)) {
            Object answer = answers.get(answerKey(f, p));
            if (p.derived || p.maxLength == null || JFormSubmissionService.isEmpty(answer)) {
                continue;
            }
            if (String.valueOf(answer).trim().length() > p.maxLength) {
                problems.add(name(f) + ' (' + p.label + '): Enter no more than ' + p.maxLength + ' characters');
            }
        }
        return problems;
    }

    /** Problems with the field's definition, from its service. */
    public static List<String> definitionProblems(JFormDefinition.Field f) {
        return JFormNameService.isName(f) ? JFormNameService.definitionProblems(f) : JFormAddressService.definitionProblems(f);
    }

    /** A part's settings in config.parts, by part key; empty when it has none. */
    public static Map<String, Object> settings(JFormDefinition.Field f, String key) {
        Object all = f == null || f.config == null ? null : f.config.get('parts');
        Object one = all instanceof Map<String, Object> ? ((Map<String, Object>) all).get(key) : null;
        return one instanceof Map<String, Object> ? (Map<String, Object>) one : new Map<String, Object>();
    }

    /** A part's label from its settings, or the default when it is blank. */
    public static String labelOf(Map<String, Object> settings, String fallback) {
        String label = settings.get('label') == null ? null : String.valueOf(settings.get('label')).trim();
        return String.isBlank(label) ? fallback : label;
    }

    /**
     * Take a field's answer object out of the answers: { part: value }. An API caller may also send the parts as
     * "field.part" answers, which are read in its place. Adds a problem for a part the field does not have; keys
     * in ignored (worked out here) are skipped. Adds a problem, and returns null, for an answer that is not an object.
     */
    public static Map<String, Object> takeAnswer(JFormDefinition.Field f, Map<String, Object> answers, List<String> partKeys, Set<String> ignored, String noun, List<String> problems) {
        Object answer = answers.remove(f.key);
        Map<String, Object> byPart = new Map<String, Object>();
        if (answer instanceof Map<String, Object>) {
            byPart = (Map<String, Object>) answer;
        } else if (!JFormSubmissionService.isEmpty(answer)) {
            problems.add(name(f) + ': send the ' + noun + ' by part (' + String.join(partKeys, ', ') + ').');
            return null;
        }
        for (String key : byPart.keySet()) {
            if (!partKeys.contains(key) && !ignored.contains(key)) {
                problems.add(name(f) + ': there is no part "' + key + '".');
            }
        }
        Map<String, Object> out = new Map<String, Object>();
        for (String key : partKeys) {
            Object value = byPart.containsKey(key) ? byPart.get(key) : answers.get(f.key + '.' + key);
            String text = value == null ? '' : JFormSubmissionService.stringify(value).trim();
            if (String.isNotBlank(text)) {
                out.put(key, text);
            }
        }
        return out;
    }

    /** Put each part's answer under "field.part", removing the parts left blank. */
    public static void putParts(JFormDefinition.Field f, Map<String, Object> answers, List<String> partKeys, Map<String, Object> byPart) {
        for (String key : partKeys) {
            Object value = byPart.get(key);
            if (JFormSubmissionService.isEmpty(value)) {
                answers.remove(f.key + '.' + key);
            } else {
                answers.put(f.key + '.' + key, value);
            }
        }
    }

    /** "Label" when every one of the needed parts is missing, "Label (Part, Part)" for some, null for none. */
    public static String missingText(JFormDefinition.Field f, List<String> missing, Integer needed) {
        if (missing.isEmpty()) {
            return null;
        }
        return missing.size() == needed ? name(f) : name(f) + ' (' + String.join(missing, ', ') + ')';
    }

    /** A whole-field mapping and an answer key too long to store, the problems every field with parts shares. */
    public static List<String> commonDefinitionProblems(JFormDefinition.Field f, String label, String examplePart, String longestPart) {
        List<String> problems = new List<String>();
        if (String.isNotBlank(f.targetFieldApiName)) {
            problems.add(label + ' is mapped part by part in a record step, with sources such as "' + f.key + '.' + examplePart + '", not to one field.');
        }
        if (String.isNotBlank(f.key) && (f.key + '.' + longestPart).length() > JFormTableService.MAX_ANSWER_KEY_LENGTH) {
            problems.add(label + ': the field key must be at most ' + (JFormTableService.MAX_ANSWER_KEY_LENGTH - longestPart.length() - 1) + ' characters.');
        }
        return problems;
    }

    public static String name(JFormDefinition.Field f) {
        return String.isBlank(f.label) ? f.key : f.label;
    }

    /** A whole number from a config value (JSON numbers arrive as Integer or Decimal), or null. */
    public static Integer intOf(Object raw) {
        if (raw == null) {
            return null;
        }
        try {
            Decimal d = Decimal.valueOf(String.valueOf(raw).trim());
            return d == d.round(System.RoundingMode.DOWN) ? d.intValue() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** A config flag that is true only when set to true (JSON true or "true"). */
    public static Boolean isOn(Object raw) {
        return raw == true || (raw instanceof String && ((String) raw).trim().equalsIgnoreCase('true'));
    }
}
