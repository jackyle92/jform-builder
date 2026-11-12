/** Agent action: publish a form and return its public link, preview link and embed snippet. */
global with sharing class JFormPublishFormAction {

    global class Request {
        @InvocableVariable(
            label='Form Id'
            description='Id of the form to publish'
            required=true
        )
        global String formId;

        @InvocableVariable(
            label='Release Note'
            description='Optional note describing what changed in this version'
        )
        global String releaseNote;
    }

    global class Result {
        @InvocableVariable(
            label='Version Number'
            description='The version that is now live'
        )
        global Integer versionNumber;

        @InvocableVariable(
            label='Public Link'
            description='Link respondents use. Empty when no Experience Cloud site is set up.'
        )
        global String publicUrl;

        @InvocableVariable(
            label='Preview Link'
            description='Internal preview link (requires a Salesforce login)'
        )
        global String previewUrl;

        @InvocableVariable(
            label='Embed Snippet'
            description='HTML snippet that embeds the form on any website'
        )
        global String embedSnippet;

        @InvocableVariable(
            label='Public Key'
            description='Stable key in the public link; it never changes between versions'
        )
        global String publicKey;

        @InvocableVariable(
            label='Error Message'
            description='Why the form could not be published, if it could not'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Publish Form'
        description='Publishes the current draft as a new live version and returns the public link, preview link and embed snippet.'
        category='JForm'
    )
    global static List<Result> publish(List<Request> requests) {
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
                JFormPublishService.PublishResult pub = JFormPublishService.publish(req.formId, req.releaseNote);
                JFormDefinition.Form def = JFormDefinitionService.load(req.formId);
                r.versionNumber = pub.versionNumber;
                r.publicKey = pub.publicKey;
                r.publicUrl = JFormAgentSupport.publicUrl(def);
                r.previewUrl = JFormAgentSupport.previewUrl(pub.publicKey);
                r.embedSnippet = JFormAgentSupport.embedSnippet(r.publicUrl, pub.publicKey, String.isBlank(def.label) ? def.name : def.label);
            } catch (Exception e) {
                Database.rollback(sp); // nothing half-done stays behind: the request either fully applies or not at all
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }
}
