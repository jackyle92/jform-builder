@IsTest
private class JFormModelsApiClientTest {

    /** A Models API reply as the platform returns it; built from JSON so no inner type names are needed. */
    private static aiplatform.ModelsAPI.createGenerations_Response reply(String generationJson) {
        aiplatform.ModelsAPI.createGenerations_Response r = new aiplatform.ModelsAPI.createGenerations_Response();
        if (generationJson != null) {
            r.Code200 = (aiplatform.ModelsAPI_GenerationResponse) JSON.deserialize(generationJson, aiplatform.ModelsAPI_GenerationResponse.class);
        }
        return r;
    }

    @IsTest
    static void sendsTheModelAndPromptAndReturnsTheText() {
        JFormModelsApiClient.testReply = reply('{"generation":{"generatedText":"{\\"sections\\":[]}"}}');
        String text = new JFormModelsApiClient().generate('sfdc_ai__DefaultGPT4Omni', 'Describe a booking form');
        Assert.areEqual('{"sections":[]}', text);
        Assert.areEqual('sfdc_ai__DefaultGPT4Omni', JFormModelsApiClient.lastRequest.modelName);
        Assert.areEqual('Describe a booking form', JFormModelsApiClient.lastRequest.body.prompt);
    }

    @IsTest
    static void aReplyWithoutTextIsAnError() {
        List<aiplatform.ModelsAPI.createGenerations_Response> empties = new List<aiplatform.ModelsAPI.createGenerations_Response>{
            null, reply(null), reply('{}'), reply('{"generation":{"generatedText":"  "}}')
        };
        for (aiplatform.ModelsAPI.createGenerations_Response empty : empties) {
            JFormModelsApiClient.testReply = empty;
            try {
                new JFormModelsApiClient().generate('model', 'prompt');
                Assert.fail('an empty reply must be reported');
            } catch (JFormGenerationService.GenerationException e) {
                Assert.isTrue(e.getMessage().contains('no text'), e.getMessage());
            }
        }
    }
}
