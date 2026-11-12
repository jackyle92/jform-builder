/**
 * Table fields: questions in rows (config.rows), answers in columns (the field's options).
 * The renderer sends a table's answer as an object keyed by row, { "service": "Satisfied" }, or lists of
 * values with config.multiple. expand() runs at the start of a submission and replaces it with one answer
 * per row under "<field key>.<row key>", so logic, the required check, JFormAnswerValidator, the stored
 * values and the record steps all see one answer per row. Field keys cannot contain a dot.
 */
public inherited sharing class JFormTableService {

    public static final String FIELD_TYPE = 'table';
    public static final Integer MAX_ROWS = 20;
    public static final Integer MAX_COLUMNS = 10;
    public static final Integer MAX_ROW_KEY_LENGTH = 20;
    /** Submission_Field_Value__c.Field_Key__c holds 80 characters. */
    public static final Integer MAX_ANSWER_KEY_LENGTH = 80;
    private static final Integer MAX_LABEL_LENGTH = 255;
    private static final String KEY_PATTERN = '[A-Za-z][A-Za-z0-9_]*';

    public class Row {
        public String key;
        public String label;
    }

    public static Boolean isTable(JFormDefinition.Field f) {
        return f != null && f.fieldType == FIELD_TYPE;
    }

    /** The table's rows, in order. Entries that are not objects are skipped. */
    public static List<Row> rows(JFormDefinition.Field f) {
        List<Row> out = new List<Row>();
        Object raw = f == null || f.config == null ? null : f.config.get('rows');
        if (!(raw instanceof List<Object>)) {
            return out;
        }
        for (Object o : (List<Object>) raw) {
            if (o instanceof Map<String, Object>) {
                Map<String, Object> m = (Map<String, Object>) o;
                Row r = new Row();
                r.key = m.get('key') == null ? null : String.valueOf(m.get('key')).trim();
                r.label = m.get('label') == null ? null : String.valueOf(m.get('label')).trim();
                out.add(r);
            }
        }
        return out;
    }

    /** Several answers per row (checkboxes) instead of one. */
    public static Boolean multiple(JFormDefinition.Field f) {
        return f != null && f.config != null && String.valueOf(f.config.get('multiple')) == 'true';
    }

    /** When required, every row must be answered; on unless false. */
    public static Boolean everyRow(JFormDefinition.Field f) {
        return f == null || f.config == null || String.valueOf(f.config.get('everyRow')) != 'false';
    }

    public static String answerKey(JFormDefinition.Field f, Row r) {
        return f.key + '.' + r.key;
    }

    /** The stored row's label: "How satisfied were you with: Service". */
    public static String rowLabel(JFormDefinition.Field f, Row r) {
        String field = String.isBlank(f.label) ? f.key : f.label;
        return (field + ': ' + (String.isBlank(r.label) ? r.key : r.label)).left(MAX_LABEL_LENGTH);
    }

    /**
     * The keys a field's answer is read from: one per row for a table, one per stored part for a Name or Address field
     * (JFormFieldParts), the field key otherwise, followed by the Other text's key when the field offers Other.
     */
    public static List<String> answerKeys(JFormDefinition.Field f) {
        if (JFormFieldParts.isCompound(f)) {
            return JFormFieldParts.answerKeys(f);
        }
        if (!isTable(f)) {
            // a choice field with Other also gives the typed text (JFormOtherChoice)
            return JFormOtherChoice.offered(f) ? new List<String>{ f.key, JFormOtherChoice.answerKey(f) } : new List<String>{ f.key };
        }
        List<String> keys = new List<String>();
        for (Row r : rows(f)) {
            keys.add(answerKey(f, r));
        }
        return keys;
    }

    /**
     * Every key a condition or a record step can read: field keys, with each table replaced by its rows, each Name or
     * Address field by its parts, and a choice field's Other text after the field.
     */
    public static Set<String> answerKeys(JFormDefinition.Form def) {
        Set<String> keys = new Set<String>();
        if (def == null || def.sections == null) {
            return keys;
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                keys.addAll(answerKeys(f));
            }
        }
        return keys;
    }

    /**
     * Replace each table's answer object with one answer per row. Returns problems for answers that are not
     * an object or name a row the table does not have; the values themselves are checked by JFormAnswerValidator.
     */
    public static List<String> expand(JFormDefinition.Form def, Map<String, Object> answers) {
        List<String> problems = new List<String>();
        if (def == null || def.sections == null || answers == null) {
            return problems;
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (!isTable(f) || !answers.containsKey(f.key)) {
                    continue;
                }
                Object answer = answers.remove(f.key);
                if (answer == null) {
                    continue;
                }
                String name = String.isBlank(f.label) ? f.key : f.label;
                if (!(answer instanceof Map<String, Object>)) {
                    problems.add(name + ': send an answer per row, keyed by row.');
                    continue;
                }
                Set<String> rowKeys = new Set<String>();
                for (Row r : rows(f)) {
                    rowKeys.add(r.key);
                }
                Map<String, Object> byRow = (Map<String, Object>) answer;
                for (String rowKey : byRow.keySet()) {
                    if (!rowKeys.contains(rowKey)) {
                        problems.add(name + ': there is no row "' + rowKey + '".');
                        continue;
                    }
                    Object value = byRow.get(rowKey);
                    if (!JFormSubmissionService.isEmpty(value)) {
                        answers.put(f.key + '.' + rowKey, value);
                    }
                }
            }
        }
        return problems;
    }

    /**
     * What a required table still needs, for "Please answer: ...": the label alone when no row is answered
     * (or one row is enough), the label and the missing rows otherwise. Null when the table is answered.
     */
    public static String unanswered(JFormDefinition.Field f, Map<String, Object> answers) {
        List<String> missing = new List<String>();
        List<Row> all = rows(f);
        for (Row r : all) {
            if (JFormSubmissionService.isEmpty(answers.get(answerKey(f, r)))) {
                missing.add(String.isBlank(r.label) ? r.key : r.label);
            }
        }
        String name = String.isBlank(f.label) ? f.key : f.label;
        if (all.isEmpty() || missing.size() == all.size()) {
            return name;
        }
        if (missing.isEmpty() || !everyRow(f)) {
            return null;
        }
        return name + ' (' + String.join(missing, ', ') + ')';
    }

    /** Problems with a table's definition: rows, row keys, limits and the stored key length. */
    public static List<String> definitionProblems(JFormDefinition.Field f) {
        List<String> problems = new List<String>();
        String name = 'Table "' + (String.isBlank(f.label) ? f.key : f.label) + '"';
        List<Row> all = rows(f);
        if (all.isEmpty()) {
            problems.add(name + ' needs at least one row.');
        } else if (all.size() > MAX_ROWS) {
            problems.add(name + ' has ' + all.size() + ' rows; a table can have up to ' + MAX_ROWS + '.');
        }
        Integer columns = f.options == null ? 0 : f.options.size();
        if (columns > MAX_COLUMNS) {
            problems.add(name + ' has ' + columns + ' columns; a table can have up to ' + MAX_COLUMNS + '.');
        }
        Set<String> seen = new Set<String>();
        for (Row r : all) {
            if (String.isBlank(r.label)) {
                problems.add(name + ': every row needs a label.');
            }
            if (!validRowKey(r.key)) {
                problems.add(name + ': row key "' + r.key + '" must start with a letter, use only letters, numbers and _, and be at most ' + MAX_ROW_KEY_LENGTH + ' characters.');
            } else if (!seen.add(r.key)) {
                problems.add(name + ': duplicate row key "' + r.key + '".');
            } else if (String.isNotBlank(f.key) && (f.key + '.' + r.key).length() > MAX_ANSWER_KEY_LENGTH) {
                problems.add(name + ': the field key and row key "' + r.key + '" together must be at most ' + (MAX_ANSWER_KEY_LENGTH - 1) + ' characters.');
            }
        }
        return problems;
    }

    /**
     * Give rows without a usable key one made from the label ("Ease of use" -> ease_of_use), unique in the
     * table. Keys that are already valid never change, so renaming a row keeps its answers and rules.
     */
    public static void normaliseRows(JFormDefinition.Field f) {
        if (!isTable(f) || f.config == null || !(f.config.get('rows') instanceof List<Object>)) {
            return;
        }
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (Object o : (List<Object>) f.config.get('rows')) {
            // a plain string is a row label (REST callers, agents)
            rows.add(o instanceof Map<String, Object> ? (Map<String, Object>) o : new Map<String, Object>{ 'label' => o == null ? null : String.valueOf(o) });
        }
        // the first row with each valid key keeps it; the others get a new one
        Set<String> used = new Set<String>();
        Set<Integer> keeps = new Set<Integer>();
        for (Integer i = 0; i < rows.size(); i++) {
            String key = rows[i].get('key') == null ? null : String.valueOf(rows[i].get('key'));
            if (validRowKey(key) && used.add(key)) {
                keeps.add(i);
            }
        }
        List<Object> out = new List<Object>();
        for (Integer i = 0; i < rows.size(); i++) {
            Map<String, Object> m = rows[i];
            if (!keeps.contains(i)) {
                m.put('key', uniqueRowKey(keyFromLabel(m.get('label') == null ? null : String.valueOf(m.get('label')), i + 1), used));
            }
            out.add(m);
        }
        f.config.put('rows', out);
    }

    public static Boolean validRowKey(String key) {
        return String.isNotBlank(key) && key.length() <= MAX_ROW_KEY_LENGTH && Pattern.matches(KEY_PATTERN, key);
    }

    @TestVisible
    private static String keyFromLabel(String label, Integer position) {
        String key = label == null ? '' : label.toLowerCase().replaceAll('[^a-z0-9]+', '_').replaceAll('^_+|_+$', '');
        if (String.isBlank(key)) {
            key = 'row_' + position;
        } else if (!key.left(1).isAlpha()) {
            key = 'r_' + key;
        }
        return key.left(MAX_ROW_KEY_LENGTH).removeEnd('_');
    }

    private static String uniqueRowKey(String base, Set<String> used) {
        String key = base;
        Integer n = 2;
        while (used.contains(key)) {
            String suffix = '_' + n++;
            key = base.left(MAX_ROW_KEY_LENGTH - suffix.length()) + suffix;
        }
        used.add(key);
        return key;
    }
}
