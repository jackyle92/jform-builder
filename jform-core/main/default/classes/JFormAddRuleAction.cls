/**
 * Agent action: add a show, hide or require rule, e.g. "only ask about parking
 * if they are driving". Fields can be named by label or key; choice values are
 * matched to the field's options.
 */
global with sharing class JFormAddRuleAction {

    private static final Map<String, String> OPERATORS = new Map<String, String>{
        'equals' => 'equals', 'equal' => 'equals', 'is' => 'equals', '=' => 'equals', '==' => 'equals',
        'not_equals' => 'not_equals', 'not equals' => 'not_equals', 'is not' => 'not_equals', '!=' => 'not_equals', 'does not equal' => 'not_equals',
        'contains' => 'contains', 'includes' => 'contains',
        'is_empty' => 'is_empty', 'is empty' => 'is_empty', 'empty' => 'is_empty', 'is blank' => 'is_empty',
        'is_not_empty' => 'is_not_empty', 'is not empty' => 'is_not_empty', 'answered' => 'is_not_empty', 'is filled' => 'is_not_empty',
        'greater_than' => 'greater_than', 'greater than' => 'greater_than', '>' => 'greater_than', 'more than' => 'greater_than',
        'less_than' => 'less_than', 'less than' => 'less_than', '<' => 'less_than', 'fewer than' => 'less_than'
    };

    global class Request {
        @InvocableVariable(
            label='Form Id'
            description='Id of the form to change'
            required=true
        )
        global String formId;

        @InvocableVariable(
            label='Target'
            description='The field (label or key) or page (title or "page 2") the rule applies to, e.g. "Parking permit needed?"'
            required=true
        )
        global String targetField;

        @InvocableVariable(
            label='Rule Action'
            description='What happens when the condition is true: show, hide or require. Pages support show and hide.'
            required=true
        )
        global String ruleAction;

        @InvocableVariable(
            label='When Field'
            description='The field whose answer is checked (label or key), e.g. "How will you get here?", or a table row or a name part by its key from the outline, e.g. "satisfaction.price" or "name.lastName"'
            required=true
        )
        global String whenField;

        @InvocableVariable(
            label='Operator'
            description='equals, not equals, contains, is empty, is not empty, greater than or less than. Defaults to equals.'
        )
        global String operator;

        @InvocableVariable(
            label='Value'
            description='The answer to compare with, e.g. "Driving". Not needed for is empty / is not empty.'
        )
        global String value;

        @InvocableVariable(
            label='Combine With Existing'
            description='Set to "and" or "or" to add this condition to an existing rule with the same action on the target. Leave empty to replace any existing rule.'
        )
        global String combine;
    }

    global class Result {
        @InvocableVariable(
            label='Rule Sentence'
            description='The saved rule in plain English'
        )
        global String ruleSentence;

        @InvocableVariable(
            label='Form Outline'
            description='Updated outline of the form'
        )
        global String summary;

        @InvocableVariable(
            label='Error Message'
            description='Why the rule could not be added, if it could not'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Add Logic Rule'
        description='Adds a rule that shows, hides or requires a field or page depending on another answer.'
        category='JForm'
    )
    global static List<Result> addRule(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            String capacity = JFormAgentSupport.capacityProblem(results.size());
            if (capacity != null) {
                Result r = new Result();
                r.errorMessage = capacity;
                results.add(r);
                continue;
            }
            results.add(addOne(req));
        }
        return results;
    }

    private static Result addOne(Request req) {
        Result r = new Result();
        Savepoint sp = Database.setSavepoint();
        try {
            JFormDefinitionService.lockForEdit(req.formId); // parallel calls take turns instead of overwriting each other
            JFormDefinition.Form def = JFormDefinitionService.load(req.formId);
            String action = req.ruleAction == null ? '' : req.ruleAction.trim().toLowerCase();
            if (!new Set<String>{ 'show', 'hide', 'require' }.contains(action)) {
                throw new JFormDefinition.JFormException('Rule action must be show, hide or require.');
            }
            String op = OPERATORS.get(req.operator == null ? 'equals' : req.operator.trim().toLowerCase());
            if (op == null) {
                throw new JFormDefinition.JFormException('Unknown operator "' + req.operator + '". Use equals, not equals, contains, is empty, is not empty, greater than or less than.');
            }

            // a table is tested one row at a time: the condition reads "field.row", and its columns are the answers;
            // a name or an address one part at a time, "field.part"
            String rowKey = JFormAgentSupport.findTableRow(def, req.whenField);
            JFormDefinition.Field source = rowKey != null ? def.fieldsByKey().get(rowKey.substringBefore('.')) : JFormAgentSupport.findField(def, req.whenField);
            if (source == null) {
                throw new JFormDefinition.JFormException('No field called "' + req.whenField + '" on this form.');
            }
            if (rowKey == null && JFormTableService.isTable(source)) {
                throw new JFormDefinition.JFormException('"' + source.label + '" is a table: name one of its rows, ' + String.join(JFormTableService.answerKeys(source), ', ') + '.');
            }
            if (rowKey == null && JFormFieldParts.isCompound(source)) {
                throw new JFormDefinition.JFormException('"' + source.label + '" is ' + (JFormNameService.isName(source) ? 'a name' : 'an address')
                    + ': name one of its parts, ' + String.join(JFormFieldParts.answerKeys(source), ', ') + '.');
            }
            JFormDefinition.Field targetField = JFormAgentSupport.findField(def, req.targetField);
            JFormDefinition.Section targetPage = targetField == null ? JFormAgentSupport.findPage(def, req.targetField) : null;
            if (targetField == null && targetPage == null) {
                throw new JFormDefinition.JFormException('No field or page called "' + req.targetField + '" on this form.');
            }
            if (targetPage != null && action == 'require') {
                throw new JFormDefinition.JFormException('Pages can be shown or hidden, not required.');
            }
            if (targetField != null && action == 'require' && targetField.fieldType == JFormPaymentPricing.FIELD_TYPE) {
                throw new JFormDefinition.JFormException('A Payment block is never optional: its price decides whether there is anything to pay. It can be shown or hidden.');
            }
            if (targetField != null && targetField.key == source.key) {
                throw new JFormDefinition.JFormException('A field cannot depend on itself.');
            }

            JFormDefinition.Condition c = new JFormDefinition.Condition();
            c.field = rowKey != null ? rowKey : source.key;
            c.operator = op;
            if (op != 'is_empty' && op != 'is_not_empty') {
                if (String.isBlank(req.value)) {
                    throw new JFormDefinition.JFormException('A value is needed for "' + op.replace('_', ' ') + '".');
                }
                // a name's parts are free text; an address's country and state are stored as the names answers hold,
                // except for contains, which tests part of the text
                Boolean freeText = rowKey != null && JFormFieldParts.isCompound(source);
                if (freeText && JFormAddressService.isAddress(source) && (op == 'equals' || op == 'not_equals')) {
                    c.value = JFormAddressService.ruleValue(source, rowKey.substringAfter('.'), req.value);
                } else {
                    c.value = freeText ? req.value.trim() : matchOption(source, req.value.trim());
                }
            }

            JFormDefinition.Rule existing = targetField != null ? targetField.conditionalLogic : targetPage.conditionalLogic;
            JFormDefinition.Rule rule;
            String combine = req.combine == null ? '' : req.combine.trim().toLowerCase();
            if (existing != null && existing.action == action && (combine == 'and' || combine == 'or')) {
                rule = existing;
                rule.match = combine == 'or' ? 'any' : 'all';
                rule.conditions.add(c);
            } else {
                rule = new JFormDefinition.Rule();
                rule.action = action;
                rule.match = 'all';
                rule.conditions.add(c);
            }
            if (targetField != null) {
                targetField.conditionalLogic = rule;
            } else {
                targetPage.conditionalLogic = rule;
            }

            JFormDefinition.Form saved = JFormDefinitionService.save(def);
            String targetName = targetField != null ? '"' + targetField.label + '"' : 'page "' + (String.isBlank(targetPage.label) ? targetPage.name : targetPage.label) + '"';
            r.ruleSentence = JFormAgentSupport.ruleSentence(saved, rule, targetName);
            r.summary = JFormAgentSupport.outline(saved);
        } catch (Exception e) {
            Database.rollback(sp); // nothing half-done stays behind
            r.errorMessage = JFormAgentSupport.errorText(e);
        }
        return r;
    }

    /** For choice fields, use the stored option value that matches the label or value given, the Other choice included. */
    private static String matchOption(JFormDefinition.Field f, String given) {
        if (f.options == null || f.options.isEmpty()) {
            if (f.fieldType == 'yesno') {
                return given.equalsIgnoreCase('yes') || given.equalsIgnoreCase('true') ? 'Yes' : (given.equalsIgnoreCase('no') || given.equalsIgnoreCase('false') ? 'No' : given);
            }
            if (f.fieldType == 'consent' || f.fieldType == 'checkbox') {
                return given.equalsIgnoreCase('yes') || given.equalsIgnoreCase('true') || given.equalsIgnoreCase('checked') ? 'true' : 'false';
            }
            return given;
        }
        List<String> labels = new List<String>();
        for (JFormDefinition.Option o : f.options) {
            if (given.equalsIgnoreCase(o.value) || given.equalsIgnoreCase(o.label)) {
                return o.value;
            }
            labels.add(o.label);
        }
        // a field's Other choice is stored as JFormOtherChoice.value, whatever it is called
        if (JFormOtherChoice.offered(f)) {
            if (given.equalsIgnoreCase(JFormOtherChoice.value(f)) || given.equalsIgnoreCase(JFormOtherChoice.label(f))) {
                return JFormOtherChoice.value(f);
            }
            labels.add(JFormOtherChoice.label(f));
        }
        throw new JFormDefinition.JFormException('"' + given + '" is not a choice of "' + f.label + '". Choices: ' + String.join(labels, ', ') + '.');
    }
}
