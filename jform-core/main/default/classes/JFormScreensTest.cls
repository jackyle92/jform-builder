@IsTest
private class JFormScreensTest {

    private static JFormDefinition.Form withScreens(Map<String, Object> welcome, Map<String, Object> ending) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Screens');
        def.settings = new Map<String, Object>();
        if (welcome != null) {
            def.settings.put('welcome', welcome);
        }
        if (ending != null) {
            def.settings.put('ending', ending);
        }
        return def;
    }

    private static Map<String, Object> asMap(String body) {
        return (Map<String, Object>) JSON.deserializeUntyped(body);
    }

    @IsTest
    static void publicFormGetsTheCleanedScreensButNotTheSettings() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = withScreens(
                new Map<String, Object>{ 'mode' => 'screen', 'title' => '  Welcome   aboard ', 'buttonLabel' => 'Let\'s go', 'showTime' => true, 'minutes' => 3, 'imageUrl' => 'https://cdn.example.com/hero.jpg', 'showHeader' => true },
                new Map<String, Object>{
                    'title' => 'Thanks!',
                    'buttons' => new List<Object>{ new Map<String, Object>{ 'label' => 'Back to home', 'url' => 'https://example.com' } },
                    'submitAnother' => true,
                    'redirectUrl' => 'https://example.com/next',
                    'redirectDelay' => 5
                }
            );
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);

            Map<String, Object> view = asMap(JFormPublicController.getPublishedDefinition(r.publicKey));

            Assert.isNull(view.get('settings'), 'settings stay private');
            Map<String, Object> welcome = (Map<String, Object>) view.get('welcome');
            Assert.areEqual('screen', welcome.get('mode'));
            Assert.areEqual('Welcome aboard', welcome.get('title'), 'spaces are collapsed');
            Assert.areEqual('Let\'s go', welcome.get('buttonLabel'));
            Assert.areEqual(true, welcome.get('showTime'));
            Assert.areEqual(3, welcome.get('minutes'));
            Assert.areEqual('https://cdn.example.com/hero.jpg', welcome.get('imageUrl'));
            Assert.areEqual(true, welcome.get('showHeader'), 'the renderer needs it to repeat the title on form pages');
            Map<String, Object> ending = (Map<String, Object>) view.get('ending');
            Assert.areEqual('Thanks!', ending.get('title'));
            Assert.areEqual(1, ((List<Object>) ending.get('buttons')).size());
            Assert.areEqual(true, ending.get('submitAnother'));
            Assert.areEqual('https://example.com/next', ending.get('redirectUrl'));
            Assert.areEqual(5, ending.get('redirectDelay'));
        }
    }

    @IsTest
    static void formsWithoutScreenSettingsKeepTodaysBehaviour() {
        JFormDefinition.Form plain = JFormTestDataFactory.sampleDefinition('Plain');
        plain.welcomeMessage = null;
        Assert.areEqual('off', JFormScreens.welcomeView(plain).get('mode'));
        Assert.isNull(JFormScreens.endingView(plain));

        plain.welcomeMessage = '<p>Hello</p>';
        Assert.areEqual('message', JFormScreens.modeOf(plain), 'an existing welcome message stays above the form');
        plain.welcomeMessage = '<p></p>';
        Assert.areEqual('off', JFormScreens.modeOf(plain), 'an empty paragraph is no message');
        Assert.areEqual(new List<String>{ 'Opens with: page 1', 'After submitting: the thank-you message' }, JFormScreens.describe(plain));
    }

    @IsTest
    static void outlineDescribesBothScreens() {
        JFormDefinition.Form def = withScreens(
            new Map<String, Object>{ 'mode' => 'screen', 'title' => 'Hi', 'showTime' => true },
            new Map<String, Object>{
                'title' => 'Done',
                'buttons' => new List<Object>{ new Map<String, Object>{ 'label' => 'Home', 'url' => 'https://example.com' } },
                'submitAnother' => true,
                'redirectUrl' => 'https://example.com/next',
                'redirectDelay' => 5
            }
        );
        List<String> lines = JFormScreens.describe(def);
        Assert.areEqual('Opens with: a start screen "Hi" with a "Start" button and the time to complete; form pages leave out the title', lines[0]);
        Assert.areEqual('After submitting: a thank-you screen "Done"; button "Home" to https://example.com; a Submit another response button; then goes to https://example.com/next after 5 s', lines[1]);
        def.settings.put('welcome', new Map<String, Object>{ 'mode' => 'message' });
        def.settings.put('ending', new Map<String, Object>{ 'redirectUrl' => 'https://example.com' });
        lines = JFormScreens.describe(def);
        Assert.areEqual('Opens with: the welcome message above page 1', lines[0]);
        Assert.areEqual('After submitting: the thank-you message; then goes straight to https://example.com', lines[1]);
    }

    @IsTest
    static void savingRefusesUnsafeOrOutOfRangeValues() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Map<String, String> cases = new Map<String, String>{
                'mode' => 'welcome screen must be off',
                'image' => 'welcome image must be an https link',
                'minutes' => 'time to complete must be between',
                'button' => 'Each thank-you button needs a label and a link',
                'buttons' => 'at most 2 buttons',
                'redirect' => 'redirect link must start with http',
                'delay' => 'redirect wait must be between'
            };
            Map<String, Object> ok = new Map<String, Object>{ 'label' => 'Home', 'url' => 'https://example.com' };
            Map<String, JFormDefinition.Form> forms = new Map<String, JFormDefinition.Form>{
                'mode' => withScreens(new Map<String, Object>{ 'mode' => 'banner' }, null),
                'image' => withScreens(new Map<String, Object>{ 'imageUrl' => 'javascript:alert(1)' }, null),
                'minutes' => withScreens(new Map<String, Object>{ 'minutes' => 500 }, null),
                'button' => withScreens(null, new Map<String, Object>{ 'buttons' => new List<Object>{ new Map<String, Object>{ 'label' => 'Go', 'url' => 'ftp://x' } } }),
                'buttons' => withScreens(null, new Map<String, Object>{ 'buttons' => new List<Object>{ ok, ok, ok } }),
                'redirect' => withScreens(null, new Map<String, Object>{ 'redirectUrl' => 'javascript:alert(1)' }),
                'delay' => withScreens(null, new Map<String, Object>{ 'redirectUrl' => 'https://example.com', 'redirectDelay' => 99 })
            };
            for (String key : forms.keySet()) {
                try {
                    JFormDefinitionService.create(forms.get(key));
                    Assert.fail('expected a refusal for ' + key);
                } catch (JFormDefinition.JFormException e) {
                    Assert.isTrue(e.getMessage().contains(cases.get(key)), key + ': ' + e.getMessage());
                }
            }
        }
    }

    @IsTest
    static void viewDropsWhatItCannotShow() {
        JFormDefinition.Form def = withScreens(
            new Map<String, Object>{ 'mode' => 'screen', 'showTime' => false, 'minutes' => 4, 'imageUrl' => '//evil.example.com/x.png' },
            new Map<String, Object>{ 'buttons' => new List<Object>{ new Map<String, Object>{ 'label' => ' ', 'url' => 'https://example.com' } }, 'redirectUrl' => 'https://example.com', 'redirectDelay' => '7' }
        );
        Map<String, Object> welcome = JFormScreens.welcomeView(def);
        Assert.isFalse(welcome.containsKey('minutes'), 'minutes only travel with showTime');
        Assert.isFalse(welcome.containsKey('imageUrl'), 'a protocol-relative link is not a site path');
        Assert.isFalse(welcome.containsKey('showHeader'), 'form pages leave out the title by default');
        Map<String, Object> ending = JFormScreens.endingView(def);
        Assert.isFalse(ending.containsKey('buttons'), 'a button without a label is dropped');
        Assert.areEqual(7, ending.get('redirectDelay'), 'a digit string counts');
        Assert.areEqual('/images/hero.png', JFormScreens.image('/images/hero.png'));
        Assert.isNull(JFormScreens.link('http://exa mple.com'));
        Assert.isNull(JFormScreens.whole(2.5));
    }

    @IsTest
    static void restPatchSetsAndClearsScreens() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Rest screens');
            RestRequest req = new RestRequest();
            req.httpMethod = 'PATCH';
            req.requestURI = '/services/apexrest/v1/forms/' + def.id;
            req.requestBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{
                'welcome' => new Map<String, Object>{ 'mode' => 'screen', 'buttonLabel' => 'Begin' },
                'ending' => new Map<String, Object>{ 'redirectUrl' => 'https://example.com' }
            }));
            RestContext.request = req;
            RestContext.response = new RestResponse();
            JFormRestApi.doPatch();
            Assert.areEqual(200, RestContext.response.statusCode, RestContext.response.responseBody.toString());
            JFormDefinition.Form saved = JFormDefinitionService.load(def.id);
            Assert.areEqual('screen', JFormScreens.modeOf(saved));
            Assert.areEqual('https://example.com', JFormScreens.endingView(saved).get('redirectUrl'));

            req.requestBody = Blob.valueOf('{"ending": null}');
            RestContext.response = new RestResponse();
            JFormRestApi.doPatch();
            Assert.isNull(JFormScreens.endingView(JFormDefinitionService.load(def.id)), 'null removes the screen settings');
        }
    }
}
