/**
 * The "Other" choice on Single choice, Checkboxes and Dropdown fields: config.other = { label, placeholder }.
 *
 * Picking Other stores "Other" like any listed option, whatever the builder calls the choice, so logic rules, the
 * choice check and record steps work as before and renaming the choice keeps earlier answers. The text typed under it
 * is an answer of its own, "<field key>.other", checked, stored and mapped like a Name part. Mirrors offersOther(),
 * otherLabel(), otherChoiceValue(), picksOther() and choiceOptionsOf() in c/jformFieldRegistry.
 */
public inherited sharing class JFormOtherChoice {

    /** A stored answer holds 255 characters (Search_Text__c); the renderer's box stops there too. */
    public static final Integer MAX_LENGTH = 255;
    public static final String DEFAULT_LABEL = 'Other';
    private static final Set<String> TYPES = new Set<String>{ 'radio', 'checkboxes', 'picklist', 'multiselect' };
    private static final Set<String> MULTI_TYPES = new Set<String>{ 'checkboxes', 'multiselect' };
    private static final Integer MAX_LABEL_LENGTH = 255;

    public static Boolean offered(JFormDefinition.Field f) {
        return f != null && f.fieldType != null && TYPES.contains(f.fieldType.toLowerCase())
            && f.config != null && f.config.get('other') instanceof Map<String, Object>;
    }

    /** What the Other choice shows: "Other" unless the builder named it. */
    public static String label(JFormDefinition.Field f) {
        return setting(f, 'label');
    }

    /** What picking Other stores: "Other" whatever the choice is called (config.other.value, which the panel never sets, overrides it). */
    public static String value(JFormDefinition.Field f) {
        return setting(f, 'value');
    }

    private static String setting(JFormDefinition.Field f, String name) {
        Object raw = offered(f) ? ((Map<String, Object>) f.config.get('other')).get(name) : null;
        return raw == null || String.isBlank(String.valueOf(raw)) ? DEFAULT_LABEL : String.valueOf(raw).trim();
    }

    public static String answerKey(JFormDefinition.Field f) {
        return f.key + '.other';
    }

    /** The stored text's label: "Industry: Other". */
    public static String answerLabel(JFormDefinition.Field f) {
        return (JFormFieldParts.name(f) + ': ' + label(f)).left(MAX_LABEL_LENGTH);
    }

    /**
     * Whether a choice answer picks Other: a single choice's whole value, a list's items, or values joined with "; " for
     * Checkboxes. Compared exactly, as the choice check compares options.
     */
    public static Boolean picked(JFormDefinition.Field f, Object answer) {
        if (!offered(f) || JFormSubmissionService.isEmpty(answer)) {
            return false;
        }
        String other = value(f);
        if (answer instanceof List<Object>) {
            for (Object item : (List<Object>) answer) {
                if (item != null && String.valueOf(item).trim().equals(other)) {
                    return true;
                }
            }
            return false;
        }
        String text = String.valueOf(answer).trim();
        if (text.equals(other)) {
            return true;
        }
        if (!MULTI_TYPES.contains(f.fieldType.toLowerCase())) {
            return false;
        }
        for (String part : text.split(';')) {
            if (part.trim().equals(other)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Before logic reads the answers: trims each Other text, and drops one that has nothing to belong to (the field
     * doesn't offer Other, or the answer doesn't pick it), so it is never stored or mapped.
     */
    public static void tidy(JFormDefinition.Form def, Map<String, Object> answers) {
        if (def == null || def.sections == null || answers == null) {
            return;
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                String key = answerKey(f);
                if (!answers.containsKey(key)) {
                    continue;
                }
                Object text = answers.get(key);
                if (!picked(f, answers.get(f.key)) || JFormSubmissionService.isEmpty(text)) {
                    answers.remove(key);
                } else {
                    answers.put(key, JFormSubmissionService.stringify(text).trim());
                }
            }
        }
    }

    /** For a required field that picks Other: what is still missing, "Industry (Other)", or null. */
    public static String unanswered(JFormDefinition.Field f, Map<String, Object> answers) {
        if (!picked(f, answers.get(f.key)) || !JFormSubmissionService.isEmpty(answers.get(answerKey(f)))) {
            return null;
        }
        return JFormFieldParts.name(f) + ' (' + label(f) + ')';
    }

    /** A text longer than a stored answer holds, as "Industry (Other): Enter no more than 255 characters", or null. */
    public static String problem(JFormDefinition.Field f, Map<String, Object> answers) {
        if (!offered(f)) {
            return null;
        }
        Object text = answers.get(answerKey(f));
        if (JFormSubmissionService.isEmpty(text) || JFormSubmissionService.stringify(text).length() <= MAX_LENGTH) {
            return null;
        }
        return JFormFieldParts.name(f) + ' (' + label(f) + '): Enter no more than ' + MAX_LENGTH + ' characters';
    }
}
