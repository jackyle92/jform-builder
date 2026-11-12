/**
 * Record steps (the Automate tab): an ordered list of create / find / find-or-create /
 * update steps, and steps that run an autolaunched flow, for every response. Stored at
 * settings.automation.steps in the form definition, so they are versioned with each
 * publish and clone with the form.
 *
 * Inherits sharing from the caller: the submission pipeline runs without sharing for
 * guests, exactly like the single target record this replaces. A mapping's value comes
 * from a form answer, text with {{field}} placeholders, a record from an earlier step
 * (its Id or one of its fields), or submission details.
 */
public inherited sharing class JFormAutomationService {

    public static final Integer MAX_STEPS = 10;
    public static final Set<String> ACTIONS = new Set<String>{ 'create', 'find', 'find_or_create', 'update', 'flow' };
    /** Flow variable types a form can fill: single values only, no records or collections yet. */
    public static final Set<String> FLOW_INPUT_TYPES = new Set<String>{ 'string', 'number', 'currency', 'boolean', 'date', 'datetime', 'picklist', 'multipicklist' };
    public static final Set<String> SOURCE_TYPES = new Set<String>{ 'field', 'value', 'step', 'submission' };
    public static final Set<String> SUBMISSION_PATHS = new Set<String>{
        'id', 'formName', 'publicKey', 'sourceUrl', 'submittedAt', 'paymentStatus', 'paymentAmount', 'paymentCurrency', 'paymentReference',
        'promotionCode', 'discountAmount'
    };
    /** Steps run in system mode for anonymous respondents, so setup objects and JForm's own records are off limits. */
    public static final Set<String> BLOCKED_OBJECTS = blockedObjects();

    /** Setup objects and JForm's own objects; the latter carry the package namespace when installed (jform__form__c). */
    private static Set<String> blockedObjects() {
        Set<String> blocked = new Set<String>{
            'user', 'group', 'groupmember', 'permissionset', 'permissionsetassignment', 'permissionsetgroup', 'profile', 'userrole',
            'organization', 'loginhistory', 'authsession', 'setupaudittrail', 'apexclass', 'apextrigger', 'namedcredential',
            'externaldatasource', 'connectedapplication'
        };
        for (String own : new List<String>{ 'form__c', 'form_version__c', 'form_section__c', 'form_field_definition__c',
                'form_picklist_option__c', 'form_submission__c', 'submission_field_value__c', 'protection_settings__c', 'ai_settings__c',
                'form_payment__c', 'payment_settings__c', 'license_settings__c' }) {
            blocked.add(JFormNamespace.PREFIX.toLowerCase() + own);
        }
        return blocked;
    }

    public class AutomationException extends Exception {}

    public class Source {
        public String type;   // field | value | step | submission
        public String key;    // field: form field key
        public String value;  // value: text, {{key}} placeholders allowed
        public String step;   // step: earlier step key
        public String path;   // step: field on that record (default Id); submission: id | formName | publicKey | sourceUrl | submittedAt
    }
    public class Mapping {
        public String field;   // object field, or for a flow step the input variable
        public String type;    // flow step: the input variable's data type, for converting the value
        public Source source;
    }
    public class Step {
        public String key;
        public String label;
        public String action;
        public String objectApiName;
        public Mapping match;                 // find / find_or_create / update: object field = source
        public List<Mapping> fields = new List<Mapping>();
        public JFormDefinition.Rule condition; // run only when
        public Boolean updateExisting = false;
        public Boolean required = false;       // find / update: fail when nothing is found
        public Boolean primary = false;
        public String flowApiName;             // flow: the autolaunched flow to run
        public String flowLabel;               // flow: its label when the step was saved, for display
        public List<String> outputs = new List<String>(); // flow: output variables later steps can use
    }
    public class StepResult {
        @AuraEnabled public String key;
        @AuraEnabled public String label;
        @AuraEnabled public String objectApiName;
        @AuraEnabled public String recordId;
        @AuraEnabled public String outcome;   // created | updated | found | not_found | skipped | ran
        @AuraEnabled public String flowApiName;
    }
    public class RunResult {
        public Id primaryId;
        public List<StepResult> steps = new List<StepResult>();
    }

    // ------------------------------------------------------------ parsing

    public static List<Step> steps(JFormDefinition.Form def) {
        List<Step> out = new List<Step>();
        if (def == null || def.settings == null || !(def.settings.get('automation') instanceof Map<String, Object>)) {
            return out;
        }
        Object raw = ((Map<String, Object>) def.settings.get('automation')).get('steps');
        if (!(raw instanceof List<Object>)) {
            return out;
        }
        for (Object o : (List<Object>) raw) {
            if (o instanceof Map<String, Object>) {
                out.add(stepFromMap((Map<String, Object>) o));
            }
        }
        return out;
    }

    private static Step stepFromMap(Map<String, Object> m) {
        Step s = new Step();
        s.key = str(m, 'key');
        s.label = str(m, 'label');
        s.action = str(m, 'action') == null ? null : str(m, 'action').toLowerCase();
        s.objectApiName = str(m, 'object');
        s.updateExisting = m.get('updateExisting') == true;
        s.required = m.get('required') == true;
        s.primary = m.get('primary') == true;
        s.flowApiName = str(m, 'flow');
        s.flowLabel = str(m, 'flowLabel');
        if (m.get('outputs') instanceof List<Object>) {
            for (Object o : (List<Object>) m.get('outputs')) {
                String name = o instanceof Map<String, Object> ? str((Map<String, Object>) o, 'name') : (o == null ? null : String.valueOf(o));
                if (String.isNotBlank(name)) {
                    s.outputs.add(name);
                }
            }
        }
        if (m.get('match') instanceof Map<String, Object>) {
            s.match = mappingFromMap((Map<String, Object>) m.get('match'));
        }
        if (m.get('fields') instanceof List<Object>) {
            for (Object f : (List<Object>) m.get('fields')) {
                if (f instanceof Map<String, Object>) {
                    s.fields.add(mappingFromMap((Map<String, Object>) f));
                }
            }
        }
        if (m.get('condition') instanceof Map<String, Object>) {
            Map<String, Object> c = (Map<String, Object>) m.get('condition');
            if (c.get('conditions') instanceof List<Object> && !((List<Object>) c.get('conditions')).isEmpty()) {
                JFormDefinition.Rule rule = new JFormDefinition.Rule();
                rule.action = 'run';
                rule.match = str(c, 'match') == 'any' ? 'any' : 'all';
                for (Object co : (List<Object>) c.get('conditions')) {
                    if (co instanceof Map<String, Object>) {
                        Map<String, Object> cm = (Map<String, Object>) co;
                        JFormDefinition.Condition cond = new JFormDefinition.Condition();
                        cond.field = str(cm, 'field');
                        cond.operator = String.isBlank(str(cm, 'operator')) ? 'equals' : str(cm, 'operator');
                        cond.value = str(cm, 'value');
                        rule.conditions.add(cond);
                    }
                }
                s.condition = rule;
            }
        }
        return s;
    }

    private static Mapping mappingFromMap(Map<String, Object> m) {
        Mapping mp = new Mapping();
        mp.field = str(m, 'field');
        mp.type = str(m, 'type');
        if (m.get('source') instanceof Map<String, Object>) {
            Map<String, Object> sm = (Map<String, Object>) m.get('source');
            Source src = new Source();
            src.type = str(sm, 'type');
            src.key = str(sm, 'key');
            src.value = str(sm, 'value');
            src.step = str(sm, 'step');
            src.path = str(sm, 'path');
            mp.source = src;
        }
        return mp;
    }

    private static String str(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v == null ? null : String.valueOf(v);
    }

    // ------------------------------------------------------------ validation

    /** Problems a person can fix in the Automate tab. Empty when the steps are usable. */
    public static List<String> validate(JFormDefinition.Form def) {
        List<String> problems = new List<String>();
        List<Step> steps = steps(def);
        if (steps.isEmpty()) {
            return problems;
        }
        if (steps.size() > MAX_STEPS) {
            problems.add('A form can have at most ' + MAX_STEPS + ' record steps.');
        }
        // a table's rows are its sources, one answer each
        Set<String> formKeys = JFormTableService.answerKeys(def);
        Set<String> seen = new Set<String>();
        // objects of the steps validated so far, for {type: step, path: Field} sources
        Map<String, Schema.DescribeSObjectResult> stepObjects = new Map<String, Schema.DescribeSObjectResult>();
        // output variables of the flow steps validated so far, lower case, for {type: step, path: output} sources
        Map<String, Set<String>> stepOutputs = new Map<String, Set<String>>();
        Map<String, Schema.SObjectType> globalDescribe = JFormSchema.globalDescribe();
        Integer n = 0;
        for (Step s : steps) {
            n++;
            String prefix = 'Step ' + n + (String.isBlank(s.label) ? '' : ' (' + s.label + ')') + ': ';
            if (String.isBlank(s.key)) {
                problems.add(prefix + 'needs a key.');
            } else if (!seen.add(s.key)) {
                problems.add(prefix + 'duplicate key "' + s.key + '".');
            }
            if (!ACTIONS.contains(s.action == null ? '' : s.action)) {
                problems.add(prefix + 'unknown action "' + s.action + '".');
            }
            if (s.action == 'flow') {
                problems.addAll(validateFlowStep(s, prefix, seen, formKeys, stepObjects, stepOutputs));
                problems.addAll(conditionProblems(s, formKeys, prefix));
                continue;
            }
            Schema.SObjectType t = String.isBlank(s.objectApiName) ? null : globalDescribe.get(s.objectApiName);
            if (t == null) {
                problems.add(prefix + 'object "' + s.objectApiName + '" was not found.');
                continue;
            }
            Schema.DescribeSObjectResult od = t.getDescribe();
            if (BLOCKED_OBJECTS.contains(od.getName().toLowerCase())) {
                problems.add(prefix + od.getName() + ' records cannot be created or updated by a form.');
                continue;
            }
            // Steps are configured by a builder and later run in system mode for respondents, so the
            // builder saving them must hold the access they grant: this is checked with the saving user's permissions.
            Boolean creates = s.action == 'create' || s.action == 'find_or_create';
            Boolean updates = s.action == 'update' || (s.action == 'find_or_create' && s.updateExisting == true);
            if (s.action != 'create' && !od.isAccessible()) {
                problems.add(prefix + 'you cannot read ' + od.getName() + ' records.');
            }
            if (creates && !od.isCreateable()) {
                problems.add(prefix + 'you cannot create ' + od.getName() + ' records.');
            }
            if (updates && !od.isUpdateable()) {
                problems.add(prefix + 'you cannot update ' + od.getName() + ' records.');
            }
            Map<String, Schema.SObjectField> fieldMap = od.fields.getMap();
            if (s.action != 'create') {
                if (s.match == null || String.isBlank(s.match.field) || s.match.source == null) {
                    problems.add(prefix + 'choose a field to match existing records on.');
                } else if (!fieldMap.containsKey(s.match.field.toLowerCase())) {
                    problems.add(prefix + 'match field "' + s.match.field + '" is not on ' + s.objectApiName + '.');
                } else {
                    Schema.DescribeFieldResult mf = fieldMap.get(s.match.field.toLowerCase()).getDescribe();
                    if (!mf.isFilterable()) {
                        problems.add(prefix + 'match field "' + s.match.field + '" cannot be used to find records.');
                    } else if (!mf.isAccessible()) {
                        problems.add(prefix + 'you cannot read ' + od.getName() + '.' + mf.getName() + '.');
                    }
                    problems.addAll(validateSource(s.match.source, seen, s.key, formKeys, stepObjects, stepOutputs, prefix + 'match: '));
                }
            }
            if (s.action != 'find' && s.fields.isEmpty()) {
                problems.add(prefix + 'map at least one answer to a ' + od.getName() + ' field.');
            }
            for (Mapping m : s.fields) {
                if (String.isBlank(m.field) || !fieldMap.containsKey(m.field.toLowerCase())) {
                    problems.add(prefix + 'field "' + m.field + '" is not on ' + s.objectApiName + '.');
                    continue;
                }
                if (m.source == null) {
                    problems.add(prefix + 'field "' + m.field + '" has no value.');
                    continue;
                }
                Schema.DescribeFieldResult df = fieldMap.get(m.field.toLowerCase()).getDescribe();
                if (creates && !df.isCreateable()) {
                    problems.add(prefix + 'field "' + m.field + '" cannot be set when creating ' + od.getName() + ' records.');
                }
                if (updates && !df.isUpdateable()) {
                    problems.add(prefix + 'field "' + m.field + '" cannot be changed on existing ' + od.getName() + ' records.');
                }
                problems.addAll(validateSource(m.source, seen, s.key, formKeys, stepObjects, stepOutputs, prefix + m.field + ': '));
            }
            if (String.isNotBlank(s.key)) {
                stepObjects.put(s.key, od);
            }
            problems.addAll(conditionProblems(s, formKeys, prefix));
        }
        return problems;
    }

    private static List<String> conditionProblems(Step s, Set<String> formKeys, String prefix) {
        List<String> problems = new List<String>();
        if (s.condition != null) {
            for (JFormDefinition.Condition c : s.condition.conditions) {
                if (!formKeys.contains(c.field)) {
                    problems.add(prefix + 'condition uses unknown field "' + c.field + '".');
                }
            }
        }
        return problems;
    }

    /** A flow step: an active autolaunched flow, inputs that are its input variables of a type a form can fill, valid sources. */
    private static List<String> validateFlowStep(Step s, String prefix, Set<String> earlierKeys, Set<String> formKeys,
            Map<String, Schema.DescribeSObjectResult> stepObjects, Map<String, Set<String>> stepOutputs) {
        List<String> problems = new List<String>();
        if (String.isBlank(s.flowApiName)) {
            problems.add(prefix + 'choose a flow to run.');
            return problems;
        }
        FlowInfo info = flowInfo(s.flowApiName);
        if (info == null) {
            problems.add(prefix + 'flow "' + s.flowApiName + '" is not an active autolaunched flow.');
            return problems;
        }
        for (Mapping m : s.fields) {
            FlowVar v = String.isBlank(m.field) ? null : info.variable(m.field);
            if (v == null || !v.isInput) {
                problems.add(prefix + '"' + m.field + '" is not an input of the flow ' + info.label + '.');
                continue;
            }
            if (!v.supported) {
                problems.add(prefix + 'input "' + v.name + '" is ' + v.typeLabel + ', which a form cannot fill yet.');
                continue;
            }
            if (String.isNotBlank(m.type) && m.type.toLowerCase() != v.dataType.toLowerCase()) {
                problems.add(prefix + 'input "' + v.name + '" is now ' + v.typeLabel + ' in the flow; open the step and refresh it from the flow.');
            }
            if (m.source == null) {
                problems.add(prefix + 'input "' + v.name + '" has no value.');
                continue;
            }
            problems.addAll(validateSource(m.source, earlierKeys, s.key, formKeys, stepObjects, stepOutputs, prefix + v.name + ': '));
        }
        Set<String> outs = new Set<String>();
        for (FlowVar v : info.variables) {
            if (v.isOutput) {
                outs.add(v.name.toLowerCase());
            }
        }
        if (String.isNotBlank(s.key)) {
            stepOutputs.put(s.key, outs);
        }
        return problems;
    }

    private static List<String> validateSource(Source src, Set<String> earlierKeys, String selfKey, Set<String> formKeys,
            Map<String, Schema.DescribeSObjectResult> stepObjects, Map<String, Set<String>> stepOutputs, String prefix) {
        List<String> problems = new List<String>();
        if (!SOURCE_TYPES.contains(src.type == null ? '' : src.type)) {
            problems.add(prefix + 'unknown source "' + src.type + '".');
        } else if (src.type == 'field' && !formKeys.contains(src.key)) {
            problems.add(prefix + 'form field "' + src.key + '" does not exist.');
        } else if (src.type == 'step' && (String.isBlank(src.step) || src.step == selfKey || !earlierKeys.contains(src.step))) {
            problems.add(prefix + 'can only use records from earlier steps ("' + src.step + '").');
        } else if (src.type == 'step' && stepOutputs.containsKey(src.step)
            && (String.isBlank(src.path) || !stepOutputs.get(src.step).contains(src.path.toLowerCase()))) {
            problems.add(prefix + '"' + src.path + '" is not an output of the flow in step "' + src.step + '".');
        } else if (src.type == 'step' && String.isNotBlank(src.path) && src.path.toLowerCase() != 'id'
            && stepObjects.containsKey(src.step) && !stepObjects.get(src.step).fields.getMap().containsKey(src.path.toLowerCase())) {
            problems.add(prefix + 'field "' + src.path + '" is not on ' + stepObjects.get(src.step).getName() + ' (step "' + src.step + '").');
        } else if (src.type == 'submission' && !SUBMISSION_PATHS.contains(src.path == null ? '' : src.path)) {
            problems.add(prefix + 'unknown submission detail "' + src.path + '".');
        }
        return problems;
    }

    // ------------------------------------------------------------ run

    /**
     * Run every step in order. Throws on the first failure; the caller owns the
     * savepoint and rolls back. info carries submission details for {type: submission}.
     */
    public static RunResult run(JFormDefinition.Form def, Map<String, Object> answers, Map<String, Object> info) {
        RunResult out = new RunResult();
        List<Step> steps = steps(def);
        Map<String, Set<String>> neededPaths = neededPaths(steps);
        Map<String, SObject> records = new Map<String, SObject>();
        // flow step key -> its output variables (lower-case names) for later steps
        Map<String, Map<String, Object>> flowOutputs = new Map<String, Map<String, Object>>();
        Map<String, Schema.SObjectType> globalDescribe = JFormSchema.globalDescribe();
        Integer n = 0;
        for (Step s : steps) {
            n++;
            StepResult sr = new StepResult();
            sr.key = s.key;
            sr.label = s.label;
            sr.objectApiName = s.objectApiName;
            sr.flowApiName = s.flowApiName;
            out.steps.add(sr);
            String prefix = 'Step ' + n + (String.isBlank(s.label) ? '' : ' (' + s.label + ')') + ': ';
            try {
                if (s.condition != null && !JFormLogicEvaluator.matches(s.condition, answers)) {
                    sr.outcome = 'skipped';
                    continue;
                }
                if (s.action == 'flow') {
                    flowOutputs.put(s.key, runFlowStep(s, answers, records, flowOutputs, info));
                    sr.outcome = 'ran';
                    continue;
                }
                Schema.SObjectType t = globalDescribe.get(s.objectApiName);
                if (t == null) {
                    throw new AutomationException('object "' + s.objectApiName + '" was not found.');
                }
                Map<String, Schema.SObjectField> fieldMap = t.getDescribe().fields.getMap();
                Set<String> paths = neededPaths.containsKey(s.key) ? neededPaths.get(s.key) : new Set<String>();

                SObject found;
                if (s.action != 'create') {
                    Schema.SObjectField matchField = fieldMap.get(s.match.field.toLowerCase());
                    Object matchValue = resolve(s.match.source, matchField.getDescribe(), answers, records, flowOutputs, info);
                    if (matchValue != null) {
                        found = findOne(s.objectApiName, matchField.getDescribe().getName(), matchValue, fieldMap, paths);
                    }
                    if (found == null && s.action != 'find_or_create') {
                        if (s.required) {
                            throw new AutomationException('no ' + s.objectApiName + ' found prefix ' + s.match.field + ' matches the response.');
                        }
                        sr.outcome = 'not_found';
                        continue;
                    }
                }
                if (s.action == 'find' || (s.action == 'find_or_create' && found != null && !s.updateExisting)) {
                    records.put(s.key, found);
                    sr.outcome = 'found';
                    sr.recordId = found.Id;
                } else {
                    SObject record = found != null ? found : t.newSObject();
                    Integer mapped = 0;
                    for (Mapping m : s.fields) {
                        Schema.SObjectField f = fieldMap.get(m.field == null ? '' : m.field.toLowerCase());
                        if (f == null || m.source == null) {
                            continue; // field removed from the object since the step was built
                        }
                        Object value = resolve(m.source, f.getDescribe(), answers, records, flowOutputs, info);
                        if (value != null) {
                            record.put(f, value);
                            mapped++;
                        }
                    }
                    if (found == null && mapped == 0) {
                        throw new AutomationException('no answers are mapped to ' + s.objectApiName + ' fields.');
                    }
                    if (found != null) {
                        Database.update(record);
                        sr.outcome = 'updated';
                    } else {
                        Database.insert(record);
                        sr.outcome = 'created';
                    }
                    if (!paths.isEmpty()) {
                        record = requery(record.Id, s.objectApiName, fieldMap, paths);
                    }
                    records.put(s.key, record);
                    sr.recordId = record.Id;
                }
                if (s.primary && out.primaryId == null && sr.recordId != null) {
                    out.primaryId = sr.recordId;
                }
            } catch (AutomationException e) {
                throw new AutomationException(prefix + e.getMessage());
            } catch (Exception e) {
                throw new AutomationException(prefix + e.getMessage());
            }
        }
        if (out.primaryId == null) {
            for (StepResult sr : out.steps) {
                if (sr.recordId != null) {
                    out.primaryId = sr.recordId;
                    break;
                }
            }
        }
        return out;
    }

    /** Fields of each step's record that later steps read (anything but Id), so finds and requeries select them. */
    private static Map<String, Set<String>> neededPaths(List<Step> steps) {
        Map<String, Set<String>> out = new Map<String, Set<String>>();
        for (Step s : steps) {
            List<Mapping> all = new List<Mapping>(s.fields);
            if (s.match != null) {
                all.add(s.match);
            }
            for (Mapping m : all) {
                if (m.source != null && m.source.type == 'step' && String.isNotBlank(m.source.step)
                    && String.isNotBlank(m.source.path) && m.source.path.toLowerCase() != 'id') {
                    if (!out.containsKey(m.source.step)) {
                        out.put(m.source.step, new Set<String>());
                    }
                    out.get(m.source.step).add(m.source.path.toLowerCase());
                }
            }
        }
        return out;
    }

    private static Object resolve(Source src, Schema.DescribeFieldResult target, Map<String, Object> answers, Map<String, SObject> records,
            Map<String, Map<String, Object>> flowOutputs, Map<String, Object> info) {
        return JFormSubmissionService.coerce(target, rawValue(src, answers, records, flowOutputs, info));
    }

    /** A source's value before it is converted to the target's type. */
    private static Object rawValue(Source src, Map<String, Object> answers, Map<String, SObject> records,
            Map<String, Map<String, Object>> flowOutputs, Map<String, Object> info) {
        if (src == null || src.type == null) {
            return null;
        }
        if (src.type == 'field') {
            return answers.get(src.key);
        } else if (src.type == 'value') {
            return interpolate(src.value, answers);
        } else if (src.type == 'submission') {
            return info == null ? null : info.get(src.path);
        } else if (src.type == 'step') {
            if (flowOutputs.containsKey(src.step)) {
                return String.isBlank(src.path) ? null : flowOutputs.get(src.step).get(src.path.toLowerCase());
            }
            SObject rec = records.get(src.step);
            if (rec == null) {
                return null;
            }
            if (String.isBlank(src.path) || src.path.toLowerCase() == 'id') {
                return rec.Id;
            }
            try {
                return rec.get(src.path);
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    // ------------------------------------------------------------ flows

    /** Runs an autolaunched flow. Swapped in tests, which cannot ship a flow. */
    public interface FlowRunner {
        /** Start the flow with these inputs and return the named output variables. */
        Map<String, Object> run(String flowApiName, Map<String, Object> inputs, List<String> outputs);
    }
    public class InterviewRunner implements FlowRunner {
        public Map<String, Object> run(String flowApiName, Map<String, Object> inputs, List<String> outputs) {
            // only flows in the org's own namespace are offered, so the namespace is always empty
            Flow.Interview interview = Flow.Interview.createInterview('', flowApiName, inputs);
            interview.start();
            Map<String, Object> out = new Map<String, Object>();
            for (String name : outputs) {
                out.put(name, interview.getVariableValue(name));
            }
            return out;
        }
    }
    @TestVisible
    private static FlowRunner flowRunner = new InterviewRunner();

    /** Inputs from the step's sources, converted to each variable's type; outputs keyed by lower-case name. */
    private static Map<String, Object> runFlowStep(Step s, Map<String, Object> answers, Map<String, SObject> records,
            Map<String, Map<String, Object>> flowOutputs, Map<String, Object> info) {
        Map<String, Object> inputs = new Map<String, Object>();
        for (Mapping m : s.fields) {
            if (String.isBlank(m.field) || m.source == null) {
                continue;
            }
            Object value = coerceFlow(m.type, rawValue(m.source, answers, records, flowOutputs, info));
            if (value != null) {
                inputs.put(m.field, value);
            }
        }
        Map<String, Object> outputs = new Map<String, Object>();
        Map<String, Object> raw = flowRunner.run(s.flowApiName, inputs, s.outputs);
        for (String name : (raw == null ? new Map<String, Object>() : raw).keySet()) {
            outputs.put(name.toLowerCase(), raw.get(name));
        }
        return outputs;
    }

    /** Convert a value to a flow variable's data type (String, Number, Currency, Boolean, Date, DateTime, Picklist, Multipicklist). */
    public static Object coerceFlow(String dataType, Object raw) {
        String s = JFormSubmissionService.stringify(raw);
        if (String.isBlank(s)) {
            return null;
        }
        String t = String.isBlank(dataType) ? 'string' : dataType.toLowerCase();
        try {
            switch on t {
                when 'boolean' {
                    String l = s.toLowerCase();
                    return l == 'true' || l == 'yes' || l == 'on' || l == '1';
                }
                when 'number', 'currency' {
                    return Decimal.valueOf(s);
                }
                when 'date' {
                    return Date.valueOf(s.left(10));
                }
                when 'datetime' {
                    return s.length() <= 10 ? Datetime.newInstance(Date.valueOf(s), Time.newInstance(0, 0, 0, 0)) : (Datetime) JSON.deserialize('"' + s + '"', Datetime.class);
                }
                when 'multipicklist' {
                    return s.replace('; ', ';');
                }
                when else {
                    return s;
                }
            }
        } catch (Exception e) {
            return null;
        }
    }

    public class FlowVar {
        @AuraEnabled public String name;
        @AuraEnabled public String dataType;
        @AuraEnabled public String objectType;
        @AuraEnabled public Boolean isInput;
        @AuraEnabled public Boolean isOutput;
        @AuraEnabled public Boolean isCollection;
        @AuraEnabled public String description;
        @AuraEnabled public Boolean supported;  // an input a form can fill
        @AuraEnabled public String typeLabel;   // "Text", "a Contact record", "a list of Text"
    }
    public class FlowInfo {
        @AuraEnabled public String apiName;
        @AuraEnabled public String label;
        @AuraEnabled public String description;
        @AuraEnabled public String versionId;
        @AuraEnabled public List<FlowVar> variables = new List<FlowVar>();
        public FlowVar variable(String name) {
            for (FlowVar v : variables) {
                if (v.name.equalsIgnoreCase(name)) {
                    return v;
                }
            }
            return null;
        }
    }
    /** Flows tests pretend are in the org, by API name. */
    @TestVisible
    private static Map<String, FlowInfo> testFlows;
    @TestVisible
    private static Boolean testCanUseFlows;

    private static final Map<String, String> FLOW_TYPE_LABELS = new Map<String, String>{
        'string' => 'Text', 'number' => 'Number', 'currency' => 'Currency', 'boolean' => 'True/false', 'date' => 'Date',
        'datetime' => 'Date/time', 'picklist' => 'Picklist', 'multipicklist' => 'Multi-select picklist'
    };
    private static String flowTypeLabel(String dataType, String objectType, Boolean isCollection) {
        String t = dataType == null ? '' : dataType.toLowerCase();
        String base = t == 'sobject' ? (String.isBlank(objectType) ? 'a record' : 'a ' + objectType + ' record')
            : t == 'apex' ? 'an Apex-defined value'
            : FLOW_TYPE_LABELS.containsKey(t) ? FLOW_TYPE_LABELS.get(t) : dataType;
        return isCollection == true ? 'a list of ' + base.removeStart('a ').removeStart('an ') : base;
    }

    /**
     * Active autolaunched flows a form can run: no trigger, in the org's own namespace. Apex reads
     * the flow views in system mode, so this works for every builder; the run itself is gated by canUseFlows().
     */
    public static List<FlowInfo> listFlows() {
        List<FlowInfo> out = new List<FlowInfo>();
        if (testFlows != null) {
            out.addAll(testFlows.values());
            return out;
        }
        for (FlowDefinitionView d : [
            SELECT ApiName, Label, Description, ActiveVersionId FROM FlowDefinitionView
            WHERE IsActive = true AND ProcessType = 'AutoLaunchedFlow' AND TriggerType = null AND NamespacePrefix = null
            ORDER BY Label LIMIT 500
        ]) {
            FlowInfo f = new FlowInfo();
            f.apiName = d.ApiName;
            f.label = d.Label;
            f.description = d.Description;
            f.versionId = d.ActiveVersionId;
            out.add(f);
        }
        return out;
    }

    /** One runnable flow with the variables of its active version, or null when it is not one. */
    public static FlowInfo flowInfo(String apiName) {
        if (String.isBlank(apiName)) {
            return null;
        }
        if (testFlows != null) {
            return testFlows.get(apiName);
        }
        List<FlowDefinitionView> defs = [
            SELECT ApiName, Label, Description, ActiveVersionId FROM FlowDefinitionView
            WHERE ApiName = :apiName AND IsActive = true AND ProcessType = 'AutoLaunchedFlow' AND TriggerType = null AND NamespacePrefix = null
            LIMIT 1
        ];
        if (defs.isEmpty()) {
            return null;
        }
        FlowInfo f = new FlowInfo();
        f.apiName = defs[0].ApiName;
        f.label = defs[0].Label;
        f.description = defs[0].Description;
        f.versionId = defs[0].ActiveVersionId;
        // FlowVariableView takes no OR in its filter, so inputs and outputs are picked out here
        for (FlowVariableView v : [
            SELECT ApiName, DataType, ObjectType, IsInput, IsOutput, IsCollection, Description
            FROM FlowVariableView WHERE FlowVersionViewId = :defs[0].ActiveVersionId
            ORDER BY ApiName
        ]) {
            if (v.IsInput || v.IsOutput) {
                f.variables.add(flowVar(v.ApiName, v.DataType, v.ObjectType, v.IsInput, v.IsOutput, v.IsCollection, v.Description));
            }
        }
        return f;
    }

    @TestVisible
    private static FlowVar flowVar(String name, String dataType, String objectType, Boolean isInput, Boolean isOutput, Boolean isCollection, String description) {
        FlowVar fv = new FlowVar();
        fv.name = name;
        fv.dataType = dataType;
        fv.objectType = objectType;
        fv.isInput = isInput == true;
        fv.isOutput = isOutput == true;
        fv.isCollection = isCollection == true;
        fv.description = description;
        fv.supported = fv.isInput && !fv.isCollection && FLOW_INPUT_TYPES.contains(dataType == null ? '' : dataType.toLowerCase());
        fv.typeLabel = flowTypeLabel(dataType, objectType, isCollection);
        return fv;
    }

    /**
     * Flows run in system context for anonymous respondents, so only someone who could build such
     * a flow (the Manage Flow permission) may add one to a form or change what it is given.
     */
    public static Boolean canUseFlows() {
        if (testCanUseFlows != null) {
            return testCanUseFlows;
        }
        try {
            return [SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = :UserInfo.getUserId() AND PermissionSet.PermissionsManageInteraction = true] > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Flow steps that are new or changed compared with the saved settings (null for a new form):
     * their flow or inputs. Unchanged flow steps can be saved by anyone who can edit the form.
     */
    public static List<String> flowPermissionProblems(JFormDefinition.Form def, String savedSettingsJson) {
        List<String> problems = new List<String>();
        Map<String, String> before = new Map<String, String>();
        if (String.isNotBlank(savedSettingsJson)) {
            JFormDefinition.Form saved = new JFormDefinition.Form();
            try {
                saved.settings = (Map<String, Object>) JSON.deserializeUntyped(savedSettingsJson);
            } catch (Exception e) {
                saved.settings = null;
            }
            for (Step s : steps(saved)) {
                if (s.action == 'flow') {
                    before.put(s.key, flowSignature(s));
                }
            }
        }
        Boolean allowed;
        Integer n = 0;
        for (Step s : steps(def)) {
            n++;
            if (s.action != 'flow' || before.get(s.key) == flowSignature(s)) {
                continue;
            }
            if (allowed == null) {
                allowed = canUseFlows();
            }
            if (!allowed) {
                problems.add('Step ' + n + (String.isBlank(s.label) ? '' : ' (' + s.label + ')')
                    + ': only people with the Manage Flow permission can add a flow step or change what it is given.');
            }
        }
        return problems;
    }
    private static String flowSignature(Step s) {
        List<String> parts = new List<String>{ s.flowApiName };
        for (Mapping m : s.fields) {
            parts.add(m.field + '=' + (m.source == null ? '' : JSON.serialize(m.source)));
        }
        return String.join(parts, '|');
    }

    /** Replace {{key}} with the answer for that key (blank when unanswered). */
    public static String interpolate(String text, Map<String, Object> answers) {
        if (String.isBlank(text) || !text.contains('{{')) {
            return text;
        }
        // a table row is {{field.row}}
        Pattern p = Pattern.compile('\\{\\{\\s*([A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)?)\\s*\\}\\}');
        Matcher m = p.matcher(text);
        String out = '';
        Integer last = 0;
        while (m.find()) {
            out += text.substring(last, m.start());
            String v = JFormSubmissionService.stringify(answers.get(m.group(1)));
            out += v == null ? '' : v;
            last = m.end();
        }
        return out + text.substring(last);
    }

    private static SObject findOne(String objectApiName, String matchField, Object matchValue, Map<String, Schema.SObjectField> fieldMap, Set<String> paths) {
        List<String> selected = new List<String>{ 'Id' };
        for (String p : paths) {
            Schema.SObjectField f = fieldMap.get(p);
            if (f != null) {
                selected.add(f.getDescribe().getName());
            }
        }
        String soql = 'SELECT ' + String.join(selected, ', ') + ' FROM ' + String.escapeSingleQuotes(objectApiName)
            + ' WHERE ' + String.escapeSingleQuotes(matchField) + ' = :matchValue ORDER BY LastModifiedDate DESC LIMIT 1';
        List<SObject> rows = Database.query(soql);
        return rows.isEmpty() ? null : rows[0];
    }

    private static SObject requery(Id recordId, String objectApiName, Map<String, Schema.SObjectField> fieldMap, Set<String> paths) {
        List<String> selected = new List<String>{ 'Id' };
        for (String p : paths) {
            Schema.SObjectField f = fieldMap.get(p);
            if (f != null) {
                selected.add(f.getDescribe().getName());
            }
        }
        return Database.query('SELECT ' + String.join(selected, ', ') + ' FROM ' + String.escapeSingleQuotes(objectApiName) + ' WHERE Id = :recordId LIMIT 1');
    }

    // ------------------------------------------------------------ single model

    /** Object field -> words that identify a matching form field, by key or label. */
    private static final Map<String, List<String>> SYNONYMS = new Map<String, List<String>>{
        'FirstName' => new List<String>{ 'first_name', 'firstname', 'first', 'given_name', 'forename' },
        'LastName' => new List<String>{ 'last_name', 'lastname', 'surname', 'family_name', 'last' },
        'Email' => new List<String>{ 'email', 'e_mail', 'email_address', 'work_email', 'your_email' },
        'Birthdate' => new List<String>{ 'date_of_birth', 'birthdate', 'birth_date', 'dob', 'birthday' },
        'MobilePhone' => new List<String>{ 'mobile_phone', 'mobile', 'mobile_number', 'cell_phone', 'cell', 'cellphone' },
        'Phone' => new List<String>{ 'phone', 'phone_number', 'telephone', 'mobile', 'mobile_number', 'contact_number', 'tel' },
        'Company' => new List<String>{ 'company', 'company_name', 'organisation', 'organization', 'business', 'employer', 'club_or_school', 'school', 'club' },
        'Title' => new List<String>{ 'job_title', 'title', 'position', 'role' },
        'Website' => new List<String>{ 'website', 'web_site', 'url', 'company_website' },
        'Industry' => new List<String>{ 'industry', 'sector' },
        'Description' => new List<String>{ 'description', 'message', 'details', 'comments', 'notes', 'question', 'describe_the_problem', 'problem', 'enquiry', 'inquiry', 'anything_else', 'tell_us_more', 'how_can_we_help' },
        'Subject' => new List<String>{ 'subject', 'topic', 'issue', 'reason', 'request_type', 'category' },
        'Priority' => new List<String>{ 'priority', 'urgency' },
        'Name' => new List<String>{ 'name', 'full_name', 'your_name', 'company', 'company_name', 'organisation', 'organization', 'business' },
        'Street' => new List<String>{ 'street', 'address', 'address_line_1', 'street_address' },
        'City' => new List<String>{ 'city', 'town' },
        'PostalCode' => new List<String>{ 'postcode', 'zip', 'postal_code', 'zip_code' },
        'Country' => new List<String>{ 'country' },
        'State' => new List<String>{ 'state', 'county', 'region', 'province' }
    };
    private static final List<String> SYNONYM_ORDER = new List<String>{
        'FirstName', 'LastName', 'Email', 'Birthdate', 'MobilePhone', 'Phone', 'Company', 'Title', 'Website', 'Industry', 'Description', 'Subject', 'Priority', 'Name', 'Street', 'City', 'PostalCode', 'Country', 'State'
    };

    /** The step whose record is the response's main record: the one marked primary, else the first that creates or updates, else the first. */
    public static Step mainStep(List<Step> steps) {
        for (Step s : steps) {
            if (s.primary && s.action != 'flow') {
                return s;
            }
        }
        for (Step s : steps) {
            if (s.action != 'find' && s.action != 'flow') {
                return s;
            }
        }
        for (Step s : steps) {
            if (s.action != 'flow') {
                return s;
            }
        }
        return null;
    }

    /**
     * One model. A legacy target (an object name with per-field mappings, or just an object
     * name from the API or the agent) becomes a record step, and targetObjectApiName always
     * reports the main step's object. Called before validation on create and save.
     */
    public static void normalise(JFormDefinition.Form def) {
        if (def == null) {
            return;
        }
        List<Step> steps = steps(def);
        if (steps.isEmpty() && String.isNotBlank(def.targetObjectApiName)) {
            setRawSteps(def, stepsFromLegacy(def));
            clearLegacy(def);
            steps = steps(def);
        }
        Step main = mainStep(steps);
        def.targetObjectApiName = main == null ? null : canonicalObject(main.objectApiName);
    }

    /** Point the main step at another object, keeping the mappings that exist there. With no steps, the object becomes one on the next save. */
    public static void retarget(JFormDefinition.Form def, String objectApiName) {
        if (def == null || String.isBlank(objectApiName)) {
            return;
        }
        List<Step> steps = steps(def);
        if (steps.isEmpty()) {
            def.targetObjectApiName = objectApiName.trim();
            return;
        }
        Schema.SObjectType t = JFormSchema.globalDescribe().get(objectApiName.trim());
        if (t == null) {
            throw new JFormDefinition.JFormException('Object "' + objectApiName + '" was not found.');
        }
        Schema.DescribeSObjectResult d = t.getDescribe();
        Map<String, Schema.SObjectField> fieldMap = d.fields.getMap();
        Step main = mainStep(steps);
        if (main == null) {
            throw new JFormDefinition.JFormException('This form only runs flows. Add a record step on the Automate tab to save answers to ' + objectApiName.trim() + '.');
        }
        Map<String, Object> raw = rawStep(def, main.key);
        if (raw == null) {
            return;
        }
        raw.put('object', d.getName());
        List<Object> kept = new List<Object>();
        if (raw.get('fields') instanceof List<Object>) {
            for (Object o : (List<Object>) raw.get('fields')) {
                if (o instanceof Map<String, Object> && fieldMap.containsKey(String.valueOf(((Map<String, Object>) o).get('field')).toLowerCase())) {
                    kept.add(o);
                }
            }
        }
        raw.put('fields', kept);
        if (raw.get('match') instanceof Map<String, Object> && !fieldMap.containsKey(String.valueOf(((Map<String, Object>) raw.get('match')).get('field')).toLowerCase())) {
            raw.remove('match');
            raw.put('action', 'create');
        }
        raw.put('label', (raw.get('action') == 'create' ? 'Create the ' : 'Find or create the ') + d.getLabel());
        def.targetObjectApiName = d.getName();
    }

    /** Record steps for a legacy single target: per-field mappings and the old strategy, or fields matched by name when nothing is mapped. */
    public static List<Object> stepsFromLegacy(JFormDefinition.Form def) {
        Schema.SObjectType t = JFormSchema.globalDescribe().get(def.targetObjectApiName);
        if (t == null) {
            throw new JFormDefinition.JFormException('Object "' + def.targetObjectApiName + '" was not found.');
        }
        String strategy = 'create';
        String matchField;
        if (def.settings != null && def.settings.get('target') instanceof Map<String, Object>) {
            Map<String, Object> target = (Map<String, Object>) def.settings.get('target');
            if (target.get('strategy') != null) {
                strategy = String.valueOf(target.get('strategy'));
            }
            if (target.get('matchField') != null) {
                matchField = String.valueOf(target.get('matchField'));
            }
        }
        if (strategy == 'none') {
            return new List<Object>();
        }
        Schema.DescribeSObjectResult d = t.getDescribe();
        Map<String, Schema.SObjectField> fieldMap = d.fields.getMap();
        List<Object> mappings = new List<Object>();
        Map<String, Map<String, Object>> byField = new Map<String, Map<String, Object>>();
        for (JFormDefinition.Field f : def.fieldsByKey().values()) {
            // a Name or Address field is never mapped whole: its parts are, below
            if (JFormFieldParts.isCompound(f) || String.isBlank(f.targetFieldApiName) || !fieldMap.containsKey(f.targetFieldApiName.toLowerCase())) {
                continue;
            }
            if (String.isNotBlank(f.targetObjectApiName) && !f.targetObjectApiName.equalsIgnoreCase(def.targetObjectApiName)) {
                continue;
            }
            Map<String, Object> m = mappingMap(fieldMap.get(f.targetFieldApiName.toLowerCase()).getDescribe().getName(), new Map<String, Object>{ 'type' => 'field', 'key' => f.key });
            mappings.add(m);
            byField.put(f.targetFieldApiName.toLowerCase(), m);
        }
        Boolean explicit = !mappings.isEmpty();
        if (explicit) {
            mappings.addAll(nameMappings(fieldMap, def, byField));
            mappings.addAll(addressMappings(d, def, byField));
        } else {
            mappings = suggestMappings(d, def, byField);
        }
        Map<String, Object> step = new Map<String, Object>{
            'key' => 'record', 'action' => 'create', 'object' => d.getName(), 'primary' => true, 'fields' => mappings
        };
        if (explicit && strategy == 'update_or_create' && String.isNotBlank(matchField) && byField.containsKey(matchField.toLowerCase())) {
            step.put('action', 'find_or_create');
            step.put('updateExisting', true);
            step.put('match', mappingMap(fieldMap.get(matchField.toLowerCase()).getDescribe().getName(), byField.get(matchField.toLowerCase()).get('source')));
        }
        // A bare object name never becomes "find and update existing records": that lets anyone who
        // knows an email address overwrite the matching record, so the builder has to choose it.
        step.put('label', (step.get('action') == 'create' ? 'Create the ' : 'Find or create the ') + d.getLabel());
        return new List<Object>{ step };
    }

    /** Each Name field's parts mapped to FirstName and LastName where the object has them and they are still free. */
    private static List<Object> nameMappings(Map<String, Schema.SObjectField> fieldMap, JFormDefinition.Form def, Map<String, Map<String, Object>> byField) {
        List<Object> out = new List<Object>();
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (!JFormNameService.isName(f)) {
                    continue;
                }
                for (JFormNameService.Part part : JFormNameService.parts(f)) {
                    String objectField = JFormNameService.OBJECT_FIELDS.get(part.key);
                    Schema.SObjectField sf = fieldMap.get(objectField.toLowerCase());
                    if (sf == null || !sf.getDescribe().isCreateable() || byField.containsKey(objectField.toLowerCase())) {
                        continue;
                    }
                    Map<String, Object> m = mappingMap(sf.getDescribe().getName(), new Map<String, Object>{ 'type' => 'field', 'key' => JFormNameService.answerKey(f, part) });
                    out.add(m);
                    byField.put(objectField.toLowerCase(), m);
                }
            }
        }
        return out;
    }

    /**
     * Each Address field's parts mapped to one of the object's addresses, chosen by the field's purpose (Mailing,
     * the Lead's Address, Billing or Shipping), where that address's fields are still free.
     */
    private static List<Object> addressMappings(Schema.DescribeSObjectResult d, JFormDefinition.Form def, Map<String, Map<String, Object>> byField) {
        List<Object> out = new List<Object>();
        List<JFormAddressService.Target> targets; // the object's addresses, read for the first Address field
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (JFormAddressService.isAddress(f) && targets == null) {
                    targets = JFormAddressService.targets(d);
                }
                JFormAddressService.Target t = JFormAddressService.isAddress(f) ? JFormAddressService.defaultTarget(targets, f) : null;
                if (t == null) {
                    continue;
                }
                Set<String> stored = new Set<String>(JFormFieldParts.answerKeys(f));
                for (String partKey : t.fields.keySet()) {
                    String objectField = t.fields.get(partKey);
                    String sourceKey = f.key + '.' + partKey;
                    if (!stored.contains(sourceKey) || byField.containsKey(objectField.toLowerCase())) {
                        continue;
                    }
                    Map<String, Object> m = mappingMap(objectField, new Map<String, Object>{ 'type' => 'field', 'key' => sourceKey });
                    out.add(m);
                    byField.put(objectField.toLowerCase(), m);
                }
            }
        }
        return out;
    }

    /**
     * Match the object's well-known fields to the form's fields by key and label; fill required name fields with safe text.
     * A Name field's parts go to FirstName and LastName where the object has them, an Address field's to one of its addresses.
     */
    private static List<Object> suggestMappings(Schema.DescribeSObjectResult d, JFormDefinition.Form def, Map<String, Map<String, Object>> byField) {
        Map<String, Schema.SObjectField> fieldMap = d.fields.getMap();
        List<JFormDefinition.Field> formFields = new List<JFormDefinition.Field>();
        List<Object> out = nameMappings(fieldMap, def, byField);
        out.addAll(addressMappings(d, def, byField));
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (!JFormFieldParts.isCompound(f) && !JFormDefinition.LAYOUT_TYPES.contains(f.fieldType) && f.fieldType != 'fileupload' && f.fieldType != JFormSignatureService.FIELD_TYPE
                    && !JFormTableService.isTable(f)) {
                    formFields.add(f);
                }
            }
        }
        for (String objectField : SYNONYM_ORDER) {
            Schema.SObjectField sf = fieldMap.get(objectField.toLowerCase());
            if (sf == null || !sf.getDescribe().isCreateable() || byField.containsKey(objectField.toLowerCase())) {
                continue;
            }
            JFormDefinition.Field hit = findByWords(formFields, SYNONYMS.get(objectField));
            if (hit != null) {
                Map<String, Object> m = mappingMap(sf.getDescribe().getName(), new Map<String, Object>{ 'type' => 'field', 'key' => hit.key });
                out.add(m);
                byField.put(objectField.toLowerCase(), m);
            }
        }
        if (fieldMap.containsKey('lastname') && !byField.containsKey('lastname')) {
            JFormDefinition.Field name = findByWords(formFields, SYNONYMS.get('Name'));
            Map<String, Object> m = mappingMap('LastName', name != null ? new Map<String, Object>{ 'type' => 'field', 'key' => name.key } : new Map<String, Object>{ 'type' => 'value', 'value' => 'Unknown' });
            out.add(m);
            byField.put('lastname', m);
        }
        if (fieldMap.containsKey('company') && !byField.containsKey('company') && !fieldMap.get('company').getDescribe().isNillable()) {
            Map<String, Object> m = mappingMap('Company', new Map<String, Object>{ 'type' => 'value', 'value' => 'Unknown' });
            out.add(m);
            byField.put('company', m);
        }
        if (d.getName() == 'Account' && !byField.containsKey('name')) {
            Map<String, Object> m = mappingMap('Name', new Map<String, Object>{ 'type' => 'value', 'value' => 'Unknown' });
            out.add(m);
            byField.put('name', m);
        }
        return out;
    }

    private static JFormDefinition.Field findByWords(List<JFormDefinition.Field> formFields, List<String> words) {
        if (words == null) {
            return null;
        }
        for (String w : words) {
            for (JFormDefinition.Field f : formFields) {
                if (normalise(f.key) == w || normalise(f.label) == w) {
                    return f;
                }
            }
        }
        for (String w : words) {
            if (w.length() < 4) {
                continue;
            }
            for (JFormDefinition.Field f : formFields) {
                if (normalise(f.key).contains(w) || normalise(f.label).contains(w)) {
                    return f;
                }
            }
        }
        return null;
    }

    private static String normalise(String s) {
        return s == null ? '' : s.toLowerCase().replaceAll('[^a-z0-9]+', '_').replaceAll('^_+|_+$', '');
    }

    private static Map<String, Object> mappingMap(String field, Object source) {
        return new Map<String, Object>{ 'field' => field, 'source' => source };
    }

    private static String canonicalObject(String apiName) {
        Schema.SObjectType t = String.isBlank(apiName) ? null : JFormSchema.globalDescribe().get(apiName);
        return t == null ? apiName : t.getDescribe().getName();
    }

    private static List<Object> rawSteps(JFormDefinition.Form def) {
        if (def.settings == null || !(def.settings.get('automation') instanceof Map<String, Object>)) {
            return null;
        }
        Object raw = ((Map<String, Object>) def.settings.get('automation')).get('steps');
        return raw instanceof List<Object> ? (List<Object>) raw : null;
    }

    private static Map<String, Object> rawStep(JFormDefinition.Form def, String key) {
        List<Object> raw = rawSteps(def);
        if (raw == null) {
            return null;
        }
        for (Object o : raw) {
            if (o instanceof Map<String, Object> && ((Map<String, Object>) o).get('key') == key) {
                return (Map<String, Object>) o;
            }
        }
        return null;
    }

    private static void setRawSteps(JFormDefinition.Form def, List<Object> steps) {
        if (def.settings == null) {
            def.settings = new Map<String, Object>();
        }
        Map<String, Object> automation = def.settings.get('automation') instanceof Map<String, Object>
            ? (Map<String, Object>) def.settings.get('automation') : new Map<String, Object>();
        automation.put('steps', steps);
        def.settings.put('automation', automation);
    }

    private static void clearLegacy(JFormDefinition.Form def) {
        if (def.settings != null) {
            def.settings.remove('target');
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                f.targetFieldApiName = null;
                f.targetObjectApiName = null;
            }
        }
    }

    /** A form field is going away: drop every step mapping, match, step condition and logic rule condition that uses it. */
    public static void dropReferences(JFormDefinition.Form def, String key) {
        if (def == null || String.isBlank(key)) {
            return;
        }
        List<Object> raw = rawSteps(def);
        if (raw != null) {
            for (Object o : raw) {
                if (!(o instanceof Map<String, Object>)) {
                    continue;
                }
                Map<String, Object> step = (Map<String, Object>) o;
                if (step.get('fields') instanceof List<Object>) {
                    List<Object> kept = new List<Object>();
                    for (Object m : (List<Object>) step.get('fields')) {
                        if (!usesField(m, key)) {
                            kept.add(m);
                        }
                    }
                    step.put('fields', kept);
                }
                if (usesField(step.get('match'), key)) {
                    step.remove('match');
                    step.put('action', 'create');
                }
                if (step.get('condition') instanceof Map<String, Object>) {
                    Map<String, Object> cond = (Map<String, Object>) step.get('condition');
                    List<Object> kept = new List<Object>();
                    if (cond.get('conditions') instanceof List<Object>) {
                        for (Object c : (List<Object>) cond.get('conditions')) {
                            if (!(c instanceof Map<String, Object>) || ((Map<String, Object>) c).get('field') != key) {
                                kept.add(c);
                            }
                        }
                    }
                    if (kept.isEmpty()) {
                        step.remove('condition');
                    } else {
                        cond.put('conditions', kept);
                    }
                }
            }
        }
        for (JFormDefinition.Section s : def.sections) {
            s.conditionalLogic = pruneRule(s.conditionalLogic, key);
            for (JFormDefinition.Field f : s.fields) {
                f.conditionalLogic = pruneRule(f.conditionalLogic, key);
            }
        }
        // the Email field whose answer goes to the gateway's page (JFormPaymentService.customerEmail)
        Map<String, Object> payments = JFormPaymentService.storedSettings(def);
        if (key.equals(JFormPaymentService.storedEmailField(payments))) {
            payments.remove('emailField');
        }
    }

    /** A form field key changed (normalised on save): point every step source, match, condition and logic rule at the new key. */
    public static void renameKey(JFormDefinition.Form def, String oldKey, String newKey) {
        if (def == null || String.isBlank(oldKey) || String.isBlank(newKey) || oldKey == newKey) {
            return;
        }
        List<Object> raw = rawSteps(def);
        if (raw != null) {
            for (Object o : raw) {
                if (!(o instanceof Map<String, Object>)) {
                    continue;
                }
                Map<String, Object> step = (Map<String, Object>) o;
                if (step.get('fields') instanceof List<Object>) {
                    for (Object m : (List<Object>) step.get('fields')) {
                        renameSource(m, oldKey, newKey);
                    }
                }
                renameSource(step.get('match'), oldKey, newKey);
                if (step.get('condition') instanceof Map<String, Object> && ((Map<String, Object>) step.get('condition')).get('conditions') instanceof List<Object>) {
                    for (Object c : (List<Object>) ((Map<String, Object>) step.get('condition')).get('conditions')) {
                        if (c instanceof Map<String, Object> && ((Map<String, Object>) c).get('field') == oldKey) {
                            ((Map<String, Object>) c).put('field', newKey);
                        }
                    }
                }
            }
        }
        for (JFormDefinition.Section s : def.sections) {
            renameInRule(s.conditionalLogic, oldKey, newKey);
            for (JFormDefinition.Field f : s.fields) {
                renameInRule(f.conditionalLogic, oldKey, newKey);
            }
        }
        Map<String, Object> payments = JFormPaymentService.storedSettings(def);
        if (oldKey.equals(JFormPaymentService.storedEmailField(payments))) {
            payments.put('emailField', newKey);
        }
    }

    private static void renameSource(Object mapping, String oldKey, String newKey) {
        if (usesField(mapping, oldKey)) {
            ((Map<String, Object>) ((Map<String, Object>) mapping).get('source')).put('key', newKey);
        }
    }

    private static void renameInRule(JFormDefinition.Rule rule, String oldKey, String newKey) {
        if (rule == null) {
            return;
        }
        for (JFormDefinition.Condition c : rule.conditions) {
            if (c.field == oldKey) {
                c.field = newKey;
            }
        }
    }

    private static Boolean usesField(Object mapping, String key) {
        if (!(mapping instanceof Map<String, Object>)) {
            return false;
        }
        Object src = ((Map<String, Object>) mapping).get('source');
        return src instanceof Map<String, Object>
            && ((Map<String, Object>) src).get('type') == 'field'
            && ((Map<String, Object>) src).get('key') == key;
    }

    private static JFormDefinition.Rule pruneRule(JFormDefinition.Rule rule, String key) {
        if (rule == null) {
            return null;
        }
        List<JFormDefinition.Condition> kept = new List<JFormDefinition.Condition>();
        for (JFormDefinition.Condition c : rule.conditions) {
            if (c.field != key) {
                kept.add(c);
            }
        }
        if (kept.isEmpty()) {
            return null;
        }
        rule.conditions = kept;
        return rule;
    }
}
