/** Agent action: describe a form (pages, fields with keys, rules, status, links). */
global with sharing class JFormGetFormDetailsAction {

    global class Request {
        @InvocableVariable(
            label='Form Id'
            description='Salesforce Id of the form'
            required=true
        )
        global String formId;
    }

    global class Result {
        @InvocableVariable(
            label='Form Outline'
            description='Plain-text outline: the steps run for each response (record steps and flows), then pages, each field with label, type, key, required flag, choices and settings such as a phone country code picker, and any show, hide or require rules'
        )
        global String outline;

        @InvocableVariable(
            label='Form Name'
            description='Internal name of the form'
        )
        global String formName;

        @InvocableVariable(
            label='Status'
            description='Draft, or Live with its version number'
        )
        global String status;

        @InvocableVariable(
            label='Builder Link'
            description='Link that opens the form in the JForm workspace'
        )
        global String builderUrl;

        @InvocableVariable(
            label='Public Link'
            description='Link respondents use, when the form has been published to a site'
        )
        global String publicUrl;

        @InvocableVariable(
            label='Error Message'
            description='Why the form could not be loaded, if it could not'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Get Form Details'
        description='Returns the pages, fields (with keys), choices and rules of a form and the steps that run for each response, plus its status and links.'
        category='JForm'
    )
    global static List<Result> describe(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            Result r = new Result();
            String capacity = JFormAgentSupport.capacityProblem(results.size());
            if (capacity != null) {
                r.errorMessage = capacity;
                results.add(r);
                continue;
            }
            try {
                JFormDefinition.Form def = JFormDefinitionService.load(req.formId);
                r.outline = JFormAgentSupport.outline(def);
                r.formName = def.name;
                r.status = JFormAgentSupport.statusText(def);
                r.builderUrl = JFormAgentSupport.builderUrl(def.id);
                r.publicUrl = def.isActive == true ? JFormAgentSupport.publicUrl(def) : null;
            } catch (Exception e) {
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }
}
