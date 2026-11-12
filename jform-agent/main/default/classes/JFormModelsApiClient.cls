/**
 * The one place JForm talks to the Models API. Kept in its own class (shipped in the JForm
 * Agent package) so JForm itself installs in orgs without Einstein generative AI:
 * JFormGenerationService looks this class up by name and treats its absence as "not available".
 */
@NamespaceAccessible
public with sharing class JFormModelsApiClient implements JFormGenerationService.Client {

    /** Apex tests cannot reach the Models API; a test sets the reply here instead. */
    @TestVisible private static aiplatform.ModelsAPI.createGenerations_Response testReply;
    /** The last request built, so tests can check what would have been sent. */
    @TestVisible private static aiplatform.ModelsAPI.createGenerations_Request lastRequest;

    public String generate(String modelName, String prompt) {
        aiplatform.ModelsAPI.createGenerations_Request request = buildRequest(modelName, prompt);
        lastRequest = request;
        return textOf(Test.isRunningTest() ? testReply : new aiplatform.ModelsAPI().createGenerations(request));
    }

    @TestVisible
    private static aiplatform.ModelsAPI.createGenerations_Request buildRequest(String modelName, String prompt) {
        aiplatform.ModelsAPI.createGenerations_Request request = new aiplatform.ModelsAPI.createGenerations_Request();
        request.modelName = modelName;
        aiplatform.ModelsAPI_GenerationRequest body = new aiplatform.ModelsAPI_GenerationRequest();
        body.prompt = prompt;
        request.body = body;
        return request;
    }

    @TestVisible
    private static String textOf(aiplatform.ModelsAPI.createGenerations_Response response) {
        if (response == null || response.Code200 == null || response.Code200.generation == null
            || String.isBlank(response.Code200.generation.generatedText)) {
            throw new JFormGenerationService.GenerationException('The model returned no text.');
        }
        return response.Code200.generation.generatedText;
    }
}
