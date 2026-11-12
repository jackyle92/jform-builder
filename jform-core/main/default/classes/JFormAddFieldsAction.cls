/** Agent action: add fields to an existing page or a new page of a draft form. */
global with sharing class JFormAddFieldsAction {

    global class Request {
        @InvocableVariable(
            label='Form Id'
            description='Id of the form to change'
            required=true
        )
        global String formId;

        @InvocableVariable(
            label='Fields JSON'
            description='Fields to add as a JSON list, e.g. [{"label":"Dietary requirements","type":"checkboxes","options":["Vegetarian","Vegan","None"]},{"label":"Notes","type":"long text"}]. Each field takes label, type, required (true/false), options (for dropdown, single choice, checkboxes), helpText, placeholder, width (25, 50, 75 or 100) and defaultValue (a hidden field saves it with every response). Use one name field for each person\'s full name, a rich text field with the wording before a consent field for terms or a waiver, and one payment field for a fee (see Create Form).'
            required=true
        )
        global String fieldsJson;

        @InvocableVariable(
            label='Page'
            description='Existing page to add to, by title or number (e.g. "Booking" or "2"). Leave empty to add to the last page.'
        )
        global String pageName;

        @InvocableVariable(
            label='New Page Name'
            description='Create a new page with this title for the fields instead of using an existing page'
        )
        global String newPageName;
    }

    global class Result {
        @InvocableVariable(
            label='Form Outline'
            description='Updated outline of the form'
        )
        global String summary;

        @InvocableVariable(
            label='Added Field Keys'
            description='Keys of the fields that were added, comma separated, for use in rules'
        )
        global String addedFieldKeys;

        @InvocableVariable(
            label='Error Message'
            description='Why the fields could not be added, if they could not'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Add Fields'
        description='Adds fields to a page of a form, or to a new page, and saves the draft.'
        category='JForm'
    )
    global static List<Result> addFields(List<Request> requests) {
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
                Set<String> used = JFormAgentSupport.allKeys(def);
                List<JFormDefinition.Field> fields = JFormAgentSupport.parseFields(req.fieldsJson, used);
                // A label that is already on the form means the user wants that field changed, not a twin of it.
                for (JFormDefinition.Field candidate : fields) {
                    JFormDefinition.Field existing = existingByLabel(def, candidate.label);
                    if (existing != null) {
                        throw new JFormDefinition.JFormException('A field labelled "' + existing.label + '" already exists (key ' + existing.key
                            + '). Use Update Field to change it (for example to add choices), or give the new field a different label.');
                    }
                }

                JFormDefinition.Section target;
                if (String.isNotBlank(req.newPageName)) {
                    target = new JFormDefinition.Section();
                    target.name = req.newPageName.left(80);
                    target.label = req.newPageName;
                    target.key = JFormAgentSupport.keyFromLabel(req.newPageName, used);
                    def.sections.add(target);
                } else if (String.isNotBlank(req.pageName)) {
                    target = JFormAgentSupport.findPage(def, req.pageName);
                    if (target == null) {
                        throw new JFormDefinition.JFormException('No page called "' + req.pageName + '". Pages: ' + pageList(def) + '.');
                    }
                } else {
                    target = def.sections[def.sections.size() - 1];
                }
                target.fields.addAll(fields);
                JFormAgentSupport.resolvePaymentReferences(def, fields);
                JFormDefinition.Form saved = JFormDefinitionService.save(def);

                List<String> keys = new List<String>();
                for (JFormDefinition.Field f : fields) {
                    keys.add(f.key);
                }
                r.addedFieldKeys = String.join(keys, ', ');
                r.summary = JFormAgentSupport.outline(saved);
            } catch (Exception e) {
                Database.rollback(sp); // nothing half-done stays behind: the request either fully applies or not at all
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }

    private static JFormDefinition.Field existingByLabel(JFormDefinition.Form def, String label) {
        if (String.isBlank(label)) {
            return null;
        }
        String needle = label.trim().toLowerCase();
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (f.label != null && f.label.trim().toLowerCase() == needle) {
                    return f;
                }
            }
        }
        return null;
    }

    private static String pageList(JFormDefinition.Form def) {
        List<String> names = new List<String>();
        for (JFormDefinition.Section s : def.sections) {
            names.add(String.isBlank(s.label) ? s.name : s.label);
        }
        return String.join(names, ', ');
    }
}
