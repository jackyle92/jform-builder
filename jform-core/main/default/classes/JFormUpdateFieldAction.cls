/**
 * Agent action: change one existing field of a draft form and save: label, help text,
 * placeholder, required, choice options (add, remove or replace), position, or remove it.
 * Add Fields only creates; this is how the assistant edits what is already there.
 */
global with sharing class JFormUpdateFieldAction {

    /** A table's options are its columns. */
    private static final Set<String> CHOICE_TYPES = new Set<String>{ 'picklist', 'multiselect', 'radio', 'checkboxes', 'table' };

    global class Request {
        @InvocableVariable(label='Form Id' description='Id of the form to change' required=true)
        global String formId;

        @InvocableVariable(label='Field' description='The field to change, by its label as shown in the outline (e.g. "Which session?") or its key' required=true)
        global String field;

        @InvocableVariable(label='New Label' description='New label for the field. Leave empty to keep it.')
        global String newLabel;

        @InvocableVariable(label='Help Text' description='New help text shown under the field. Leave empty to keep it.')
        global String helpText;

        @InvocableVariable(label='Placeholder' description='New placeholder shown inside the input. Leave empty to keep it.')
        global String placeholder;

        @InvocableVariable(label='Required' description='"yes" to make the field required, "no" to make it optional. Leave empty to keep it.')
        global String required;

        @InvocableVariable(label='Add Options' description='Choices to add to a dropdown, single choice or checkboxes field, or columns to a table, separated by commas, or one per line when a choice contains a comma, e.g. "Evening". Existing choices are kept.')
        global String addOptions;

        @InvocableVariable(label='Remove Options' description='Choices to remove from a choice field, separated by commas, or one per line when a choice contains a comma.')
        global String removeOptions;

        @InvocableVariable(label='Replace Options' description='The complete new list of choices for a choice field, separated by commas, or one per line when a choice contains a comma. Replaces all existing choices.')
        global String replaceOptions;

        @InvocableVariable(label='Move After Field' description='Move the field directly after this other field (label or key), on that field\'s page.')
        global String afterField;

        @InvocableVariable(label='Move To Page' description='Move the field to the end of this page (title or number).')
        global String pageName;

        @InvocableVariable(label='Remove Field' description='Set to true to delete the field from the form. Rules and record steps that used it are dropped.')
        global Boolean remove;
    }

    global class Result {
        @InvocableVariable(label='Field Key' description='Key of the field that was changed')
        global String fieldKey;

        @InvocableVariable(label='Changes' description='What changed, in plain English')
        global String changes;

        @InvocableVariable(label='Form Outline' description='Updated outline of the form')
        global String summary;

        @InvocableVariable(label='Error Message' description='Why the field could not be changed, if it could not')
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Update Field'
        description='Change an existing field of a JForm form: its label, help text, placeholder, required flag, choices, position, or remove it. Saves the draft.'
        category='JForm'
    )
    global static List<Result> updateField(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            Result r = new Result();
            String capacity = JFormAgentSupport.capacityProblem(results.size());
            if (capacity != null) {
                r.errorMessage = capacity;
                results.add(r);
                continue;
            }
            Savepoint sp = Database.setSavepoint();
            try {
                JFormDefinitionService.lockForEdit(req.formId); // parallel calls take turns instead of overwriting each other
                JFormDefinition.Form def = JFormDefinitionService.load(req.formId);
                JFormDefinition.Field f = JFormAgentSupport.findField(def, req.field);
                if (f == null) {
                    throw new JFormDefinition.JFormException('No field matching "' + req.field + '". Fields: ' + fieldList(def) + '.');
                }
                List<String> changes = new List<String>();
                if (req.remove == true) {
                    removeField(def, f);
                    JFormAutomationService.dropReferences(def, f.key);
                    changes.add('removed "' + f.label + '"');
                } else {
                    applyChanges(def, f, req, changes);
                }
                if (changes.isEmpty()) {
                    throw new JFormDefinition.JFormException('Nothing to change: give a new label, help text, placeholder, required yes/no, options to add, remove or replace, a new position, or remove = true.');
                }
                JFormDefinition.Form saved = JFormDefinitionService.save(def);
                r.fieldKey = f.key;
                r.changes = 'Field "' + f.label + '": ' + String.join(changes, '; ') + '.';
                r.summary = JFormAgentSupport.outline(saved);
            } catch (Exception e) {
                Database.rollback(sp); // nothing half-done stays behind: the request either fully applies or not at all
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }

    private static void applyChanges(JFormDefinition.Form def, JFormDefinition.Field f, Request req, List<String> changes) {
        if (String.isNotBlank(req.newLabel) && req.newLabel.trim() != f.label) {
            changes.add('renamed from "' + f.label + '" to "' + req.newLabel.trim() + '"');
            f.label = req.newLabel.trim();
        }
        if (String.isNotBlank(req.helpText)) {
            f.helpText = req.helpText.trim();
            changes.add('help text set');
        }
        if (String.isNotBlank(req.placeholder)) {
            f.placeholder = req.placeholder.trim();
            changes.add('placeholder set');
        }
        if (String.isNotBlank(req.required)) {
            String v = req.required.trim().toLowerCase();
            Boolean makeRequired = new Set<String>{ 'yes', 'true', 'required', 'y', '1' }.contains(v);
            Boolean makeOptional = new Set<String>{ 'no', 'false', 'optional', 'n', '0' }.contains(v);
            if (!makeRequired && !makeOptional) {
                throw new JFormDefinition.JFormException('Required must be "yes" or "no".');
            }
            if (makeRequired && f.fieldType == JFormPaymentPricing.FIELD_TYPE) {
                throw new JFormDefinition.JFormException('A Payment block is never optional: its price decides whether there is anything to pay.');
            }
            if (f.required != makeRequired) {
                f.required = makeRequired;
                changes.add(makeRequired ? 'now required' : 'now optional');
            }
        }
        Boolean touchesOptions = String.isNotBlank(req.addOptions) || String.isNotBlank(req.removeOptions) || String.isNotBlank(req.replaceOptions);
        if (touchesOptions) {
            if (!CHOICE_TYPES.contains(f.fieldType)) {
                throw new JFormDefinition.JFormException('"' + f.label + '" is a ' + f.fieldType + ' field and has no choices. Only dropdown, single choice, checkboxes and table fields do.');
            }
            if (f.options == null) {
                f.options = new List<JFormDefinition.Option>();
            }
            if (String.isNotBlank(req.replaceOptions)) {
                f.options.clear();
                for (String label : splitList(req.replaceOptions)) {
                    f.options.add(option(label));
                }
                changes.add('choices are now ' + joinLabels(f.options));
            }
            if (String.isNotBlank(req.removeOptions)) {
                Set<String> gone = new Set<String>();
                for (String label : splitList(req.removeOptions)) {
                    gone.add(label.toLowerCase());
                }
                List<JFormDefinition.Option> kept = new List<JFormDefinition.Option>();
                List<String> removed = new List<String>();
                for (JFormDefinition.Option o : f.options) {
                    if (gone.contains(String.valueOf(o.label).toLowerCase()) || gone.contains(String.valueOf(o.value).toLowerCase())) {
                        removed.add(o.label);
                    } else {
                        kept.add(o);
                    }
                }
                f.options = kept;
                if (!removed.isEmpty()) {
                    changes.add('removed ' + String.join(removed, ', '));
                }
            }
            if (String.isNotBlank(req.addOptions)) {
                Set<String> have = new Set<String>();
                for (JFormDefinition.Option o : f.options) {
                    have.add(String.valueOf(o.label).toLowerCase());
                    have.add(String.valueOf(o.value).toLowerCase());
                }
                List<String> added = new List<String>();
                for (String label : splitList(req.addOptions)) {
                    if (!have.contains(label.toLowerCase())) {
                        f.options.add(option(label));
                        have.add(label.toLowerCase());
                        added.add(label);
                    }
                }
                changes.add(added.isEmpty() ? 'choices unchanged (already present)' : 'added ' + String.join(added, ', '));
            }
            if (f.options.isEmpty()) {
                throw new JFormDefinition.JFormException('A choice field needs at least one choice.');
            }
        }
        if (String.isNotBlank(req.afterField)) {
            JFormDefinition.Field anchor = JFormAgentSupport.findField(def, req.afterField);
            if (anchor == null || anchor === f) {
                throw new JFormDefinition.JFormException('No other field matching "' + req.afterField + '" to move after. Fields: ' + fieldList(def) + '.');
            }
            removeField(def, f);
            for (JFormDefinition.Section s : def.sections) {
                Integer at = s.fields.indexOf(anchor);
                if (at >= 0) {
                    if (at + 1 >= s.fields.size()) {
                        s.fields.add(f); // Apex refuses add(index) at the very end
                    } else {
                        s.fields.add(at + 1, f);
                    }
                    changes.add('moved after "' + anchor.label + '"');
                    break;
                }
            }
        } else if (String.isNotBlank(req.pageName)) {
            JFormDefinition.Section page = JFormAgentSupport.findPage(def, req.pageName);
            if (page == null) {
                throw new JFormDefinition.JFormException('No page called "' + req.pageName + '".');
            }
            removeField(def, f);
            page.fields.add(f);
            changes.add('moved to page "' + (String.isBlank(page.label) ? page.name : page.label) + '"');
        }
    }

    private static void removeField(JFormDefinition.Form def, JFormDefinition.Field f) {
        for (JFormDefinition.Section s : def.sections) {
            Integer at = s.fields.indexOf(f);
            if (at >= 0) {
                s.fields.remove(at);
                return;
            }
        }
    }

    private static JFormDefinition.Option option(String label) {
        JFormDefinition.Option o = new JFormDefinition.Option();
        o.label = label;
        o.value = label;
        return o;
    }

    @TestVisible
    private static List<String> splitList(String raw) {
        List<String> out = new List<String>();
        if (String.isBlank(raw)) {
            return out;
        }
        // one per line keeps commas inside a choice ("Korea, Republic of"); a single line is split on commas
        String separator = raw.contains('\n') ? '\\r?\\n' : ',';
        for (String part : raw.split(separator)) {
            String t = part.trim().removeEnd(',').trim();
            if (String.isNotBlank(t)) {
                out.add(t);
            }
        }
        return out;
    }

    private static String joinLabels(List<JFormDefinition.Option> options) {
        List<String> labels = new List<String>();
        for (JFormDefinition.Option o : options) {
            labels.add(o.label);
        }
        return String.join(labels, ', ');
    }

    private static String fieldList(JFormDefinition.Form def) {
        List<String> labels = new List<String>();
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (String.isNotBlank(f.label)) {
                    labels.add('"' + f.label + '"');
                }
            }
        }
        return String.join(labels, ', ');
    }
}
