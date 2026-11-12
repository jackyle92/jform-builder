/**
 * Evaluates conditional logic rules against a set of answers.
 * Mirrors c/jformLogic in LWC: both must produce identical results for the
 * fixtures in jformLogic/__tests__.
 *
 * Rule shape: { action: show|hide|require, match: all|any,
 *               conditions: [{ field: <key>, operator, value }] }
 * Operators: equals, not_equals, contains, is_empty, is_not_empty, greater_than, less_than.
 */
public inherited sharing class JFormLogicEvaluator {

    public class Result {
        /** Field key -> visible. Keys of hidden sections' fields are false. */
        public Map<String, Boolean> visible = new Map<String, Boolean>();
        /** Field key -> effectively required (static flag or a matching require rule). */
        public Map<String, Boolean> required = new Map<String, Boolean>();
        /** Section key -> visible. */
        public Map<String, Boolean> sectionVisible = new Map<String, Boolean>();
    }

    public static Result evaluate(JFormDefinition.Form def, Map<String, Object> answers) {
        Result r = new Result();
        Map<String, Object> safeAnswers = answers == null ? new Map<String, Object>() : answers;
        for (JFormDefinition.Section s : def.sections) {
            Boolean sectionVisible = true;
            if (s.conditionalLogic != null) {
                Boolean matched = matches(s.conditionalLogic, safeAnswers);
                if (s.conditionalLogic.action == 'show') {
                    sectionVisible = matched;
                } else if (s.conditionalLogic.action == 'hide') {
                    sectionVisible = !matched;
                }
            }
            r.sectionVisible.put(s.key, sectionVisible);
            for (JFormDefinition.Field f : s.fields) {
                Boolean visible = sectionVisible;
                Boolean required = f.required == true;
                if (f.conditionalLogic != null) {
                    Boolean matched = matches(f.conditionalLogic, safeAnswers);
                    if (f.conditionalLogic.action == 'show') {
                        visible = visible && matched;
                    } else if (f.conditionalLogic.action == 'hide') {
                        visible = visible && !matched;
                    } else if (f.conditionalLogic.action == 'require') {
                        required = required || matched;
                    }
                }
                // a Payment block is never required: its price decides whether there is anything to pay, and its
                // answer is the total the server writes when the response is stored
                r.visible.put(f.key, visible);
                r.required.put(f.key, visible && required && f.fieldType != JFormPaymentPricing.FIELD_TYPE);
            }
        }
        return r;
    }

    public static Boolean matches(JFormDefinition.Rule rule, Map<String, Object> answers) {
        if (rule == null || rule.conditions == null || rule.conditions.isEmpty()) {
            return true;
        }
        Boolean anyMatch = rule.match == 'any';
        for (JFormDefinition.Condition c : rule.conditions) {
            Boolean ok = test(c, answers.get(c.field));
            if (anyMatch && ok) {
                return true;
            }
            if (!anyMatch && !ok) {
                return false;
            }
        }
        return !anyMatch;
    }

    @TestVisible
    private static Boolean test(JFormDefinition.Condition c, Object actual) {
        List<String> values = normalize(actual);
        String expected = c.value == null ? '' : c.value.trim();
        String op = c.operator == null ? 'equals' : c.operator;
        if (op == 'is_empty') {
            return values.isEmpty();
        }
        if (op == 'is_not_empty') {
            return !values.isEmpty();
        }
        if (op == 'equals') {
            for (String v : values) {
                if (v.equalsIgnoreCase(expected)) {
                    return true;
                }
            }
            return false;
        }
        if (op == 'not_equals') {
            for (String v : values) {
                if (v.equalsIgnoreCase(expected)) {
                    return false;
                }
            }
            return true;
        }
        if (op == 'contains') {
            for (String v : values) {
                if (v.containsIgnoreCase(expected)) {
                    return true;
                }
            }
            return false;
        }
        if (op == 'greater_than' || op == 'less_than') {
            if (values.isEmpty()) {
                return false;
            }
            Decimal a = toDecimal(values[0]);
            Decimal b = toDecimal(expected);
            if (a == null || b == null) {
                return false;
            }
            return op == 'greater_than' ? a > b : a < b;
        }
        return false;
    }

    /** Null, blank strings and empty lists are "no answer". Lists keep each element. */
    private static List<String> normalize(Object actual) {
        List<String> out = new List<String>();
        if (actual == null) {
            return out;
        }
        if (actual instanceof List<Object>) {
            for (Object o : (List<Object>) actual) {
                if (o != null && String.isNotBlank(String.valueOf(o))) {
                    out.add(String.valueOf(o).trim());
                }
            }
            return out;
        }
        if (actual instanceof Boolean) {
            out.add((Boolean) actual ? 'true' : 'false');
            return out;
        }
        String s = String.valueOf(actual);
        if (String.isNotBlank(s)) {
            out.add(s.trim());
        }
        return out;
    }

    private static Decimal toDecimal(String s) {
        try {
            return Decimal.valueOf(s);
        } catch (Exception e) {
            return null;
        }
    }
}
