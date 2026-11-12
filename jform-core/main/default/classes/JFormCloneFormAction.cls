/** Agent action: copy an existing form (pages, fields, choices, rules, theme) into a new draft. */
global with sharing class JFormCloneFormAction {

    global class Request {
        @InvocableVariable(
            label='Source Form Id'
            description='Id of the form to copy'
            required=true
        )
        global String sourceFormId;

        @InvocableVariable(
            label='New Form Name'
            description='Name for the copy, for example "Autumn Clinic 2026"'
            required=true
        )
        global String newName;

        @InvocableVariable(
            label='Target Object'
            description='Optional Salesforce object the copy should create records in, for example Lead or Contact; its main record step is pointed at that object. Leave empty to keep the source form\'s steps.'
        )
        global String targetObjectApiName;
    }

    global class Result {
        @InvocableVariable(
            label='New Form Id'
            description='Id of the new draft form'
        )
        global String newFormId;

        @InvocableVariable(
            label='Builder Link'
            description='Link that opens the new draft in the JForm workspace'
        )
        global String builderUrl;

        @InvocableVariable(
            label='Form Outline'
            description='Outline of the new draft: pages, fields and rules'
        )
        global String summary;

        @InvocableVariable(
            label='Error Message'
            description='Why the copy failed, if it did'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Clone Form'
        description='Creates a new draft form that copies every page, field, choice, rule and the theme of an existing form.'
        category='JForm'
    )
    global static List<Result> cloneForms(List<Request> requests) {
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
                JFormDefinition.Form copy = JFormDefinitionService.clone(req.sourceFormId, req.newName);
                if (String.isNotBlank(req.targetObjectApiName)) {
                    JFormAutomationService.retarget(copy, req.targetObjectApiName.trim());
                    copy = JFormDefinitionService.save(copy);
                }
                r.newFormId = copy.id;
                r.builderUrl = JFormAgentSupport.builderUrl(copy.id);
                r.summary = JFormAgentSupport.outline(copy);
            } catch (Exception e) {
                Database.rollback(sp); // nothing half-done stays behind: the request either fully applies or not at all
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }
}
