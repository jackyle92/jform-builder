/** Agent action: create a new draft form, optionally with pages and fields from JSON. */
global with sharing class JFormCreateFormAction {

    global class Request {
        @InvocableVariable(
            label='Form Name'
            description='Name of the new form, for example "Store Visit Booking"'
            required=true
        )
        global String formName;

        @InvocableVariable(
            label='Description'
            description='Optional short description shown under the form title'
        )
        global String description;

        @InvocableVariable(
            label='Target Object'
            description='Optional Salesforce object submissions create, for example Lead, Contact or Case. Adds a record step with the form\'s fields matched by name; refine it on the Automate tab.'
        )
        global String targetObjectApiName;

        @InvocableVariable(
            label='Definition JSON'
            description='Optional pages and fields as JSON. Either a list of fields for one page, e.g. [{"label":"Email","type":"email","required":true},{"label":"Preferred date","type":"date"},{"label":"Store","type":"dropdown","options":["London","Leeds"]}], or a list of pages, e.g. [{"name":"Contact details","fields":[...]},{"name":"Booking","fields":[...]}], one page per section of the request. Each field can also take helpText, placeholder, width (25, 50, 75 or 100) and defaultValue (a hidden field saves it with every response). Field types: text, name (first and last name in one field, each saved and mapped on its own; use it for each person\'s full name, even when the request calls it a text field), address (country, street, city, state and postal code in one field), email, phone (with the country code picker, as in the builder), number, long text, dropdown, single choice, checkboxes, date, time, file upload, signature, rating, nps, yes/no, consent (one checkbox whose label is what the person agrees to, e.g. "I agree to the waiver above"; put terms or waiver wording in a rich text field right before it, e.g. {"label":"Waiver","type":"rich text","richtext":"<p>...</p>"}), heading, rich text, divider, hidden, table (questions in rows answered on a shared scale, e.g. {"label":"How satisfied were you with","type":"table","rows":["Service","Price"],"options":["Poor","Fair","Good"]}; "multiple":true allows several answers per row), payment (one per form: the price and a Pay button for Stripe checkout, which offers card, Apple Pay and Google Pay; {"label":"Payment","type":"payment","amount":50} for a fixed price, or {"label":"Payment","type":"payment","pricing":"choice","source":"Sessions","prices":{"Morning":50,"Full day":90}} to charge for the choices picked in a choice field). JForm has no calculated fields. Leave empty for a blank form.'
        )
        global String definitionJson;
    }

    global class Result {
        @InvocableVariable(
            label='Form Id'
            description='Id of the new draft form'
        )
        global String formId;

        @InvocableVariable(
            label='Builder Link'
            description='Link that opens the new form in the JForm workspace'
        )
        global String builderUrl;

        @InvocableVariable(
            label='Form Outline'
            description='Outline of the new form: pages and fields'
        )
        global String summary;

        @InvocableVariable(
            label='Error Message'
            description='Why the form could not be created, if it could not'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Create Form'
        description='Creates a new draft form, blank or with pages and fields described as JSON.'
        category='JForm'
    )
    global static List<Result> create(List<Request> requests) {
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
                JFormDefinition.Form def = JFormAgentSupport.parseDefinition(req.definitionJson, req.formName);
                if (String.isNotBlank(req.description)) {
                    def.description = req.description;
                }
                if (String.isNotBlank(req.targetObjectApiName)) {
                    def.targetObjectApiName = req.targetObjectApiName.trim();
                }
                JFormDefinition.Form saved = JFormDefinitionService.create(def);
                r.formId = saved.id;
                r.builderUrl = JFormAgentSupport.builderUrl(saved.id);
                r.summary = JFormAgentSupport.outline(saved) + JFormAgentSupport.afterCreateText(saved);
            } catch (Exception e) {
                Database.rollback(sp); // nothing half-done stays behind: the request either fully applies or not at all
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }
}
