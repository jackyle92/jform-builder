@IsTest
private class JFormProtectionServiceTest {

    private static final String HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    private class RecaptchaMock implements HttpCalloutMock {
        Integer status;
        String body;
        String lastBody;
        RecaptchaMock(Integer status, String body) {
            this.status = status;
            this.body = body;
        }
        public HttpResponse respond(HttpRequest req) {
            lastBody = req.getBody();
            HttpResponse res = new HttpResponse();
            res.setStatusCode(status);
            res.setBody(body);
            return res;
        }
    }

    private static void config(String siteKey, String secret, String signingKey) {
        JFormProtectionService.configOverride = new Protection_Settings__c(Site_Key__c = siteKey, Secret__c = secret, Signing_Key__c = signingKey, Min_Score__c = 0.5);
    }

    private static JFormPublishService.PublishResult publishProtected(String name, Map<String, Object> protection) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition(name);
        def.targetObjectApiName = null;
        def.settings = new Map<String, Object>{ 'protection' => protection };
        def = JFormDefinitionService.create(def);
        return JFormPublishService.publish(def.id, null);
    }

    private static Map<String, Object> answers(String firstName) {
        return new Map<String, Object>{ 'first_name' => firstName, 'email' => firstName.toLowerCase() + '@example.com', 'season' => 'autumn' };
    }

    private static Form_Submission__c submit(String key, Map<String, Object> body) {
        Id id = JFormPublicController.submit(key, JSON.serialize(body));
        return [SELECT Status__c, Spam_Reason__c, Spam_Score__c, Captcha_Score__c, Answers_Hash__c FROM Form_Submission__c WHERE Id = :id];
    }

    @IsTest
    static void timingTokensRoundTripAndTellTooFastFromExpired() {
        config(null, null, HEX_KEY);
        String token = JFormProtectionService.issueToken('abc123');
        Assert.isNotNull(token);
        Assert.areEqual('ok', JFormProtectionService.verifyToken(token, 'abc123', 0));
        Assert.areEqual('too_fast', JFormProtectionService.verifyToken(token, 'abc123', 3), 'issued this very moment');
        Assert.areEqual('invalid', JFormProtectionService.verifyToken(token, 'other', 0), 'bound to the form');
        Assert.areEqual('invalid', JFormProtectionService.verifyToken(token.substring(0, token.length() - 4) + 'AAAA', 'abc123', 0), 'tampered signature');
        Assert.areEqual('invalid', JFormProtectionService.verifyToken('not.a.token', 'abc123', 0));
        Assert.areEqual('missing', JFormProtectionService.verifyToken(null, 'abc123', 0));

        String old = String.valueOf(System.now().getTime() - 25L * 60 * 60 * 1000) + '|abc123|nonce';
        Blob bytes = Blob.valueOf(old);
        String expired = EncodingUtil.base64Encode(bytes) + '.' + EncodingUtil.base64Encode(Crypto.generateMac('hmacSHA256', bytes, EncodingUtil.convertFromHex(HEX_KEY)));
        Assert.areEqual('expired', JFormProtectionService.verifyToken(expired, 'abc123', 0));

        config(null, null, null);
        Assert.isNull(JFormProtectionService.issueToken('abc123'), 'no signing key, no token');
        Assert.areEqual('unverifiable', JFormProtectionService.verifyToken(null, 'abc123', 0), 'and nothing is held against the respondent');
    }

    @IsTest
    static void settingsParseLooselyAndFallBackToDefaults() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Settings');
        JFormProtectionService.Settings s = JFormProtectionService.settingsOf(def);
        Assert.isTrue(s.enabled, 'protection is on unless switched off');
        Assert.isFalse(s.captcha);
        Assert.areEqual(3, s.minSeconds);
        Assert.areEqual(20, s.perMinute);

        def.settings = new Map<String, Object>{ 'protection' => new Map<String, Object>{
            'enabled' => 'false', 'captcha' => true, 'minSeconds' => '9', 'perMinute' => 5000000, 'maxLinks' => -2,
            'blockedWords' => 'Casino, FREE money\nviagra,,  '
        } };
        s = JFormProtectionService.settingsOf(def);
        Assert.isFalse(s.enabled);
        Assert.isTrue(s.captcha);
        Assert.areEqual(9, s.minSeconds);
        Assert.areEqual(10000, s.perMinute, 'clamped');
        Assert.areEqual(0, s.maxLinks, 'clamped');
        Assert.areEqual(new List<String>{ 'casino', 'free money', 'viagra' }, s.blockedWords);

        Assert.isFalse((Boolean) JFormProtectionService.publicView(def).get('captcha'), 'captcha wanted but no org keys');
        config('site-key', 'secret', null);
        def.settings = new Map<String, Object>{ 'protection' => new Map<String, Object>{ 'captcha' => true } };
        Map<String, Object> pub = JFormProtectionService.publicView(def);
        Assert.isTrue((Boolean) pub.get('captcha'));
        Assert.areEqual('site-key', pub.get('siteKey'));
    }

    @IsTest
    static void answersHashIgnoresOrderCaseAndSpacing() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Hash');
        String a = JFormProtectionService.answersHash(def, new Map<String, Object>{ 'first_name' => 'Ann', 'email' => 'ann@x.co' });
        String b = JFormProtectionService.answersHash(def, new Map<String, Object>{ 'email' => 'ANN@x.co ', 'first_name' => ' ann', 'not_a_field' => 'ignored' });
        Assert.areEqual(a, b);
        Assert.areNotEqual(a, JFormProtectionService.answersHash(def, new Map<String, Object>{ 'first_name' => 'Bob', 'email' => 'ann@x.co' }));
        Assert.isNull(JFormProtectionService.answersHash(def, new Map<String, Object>()));
    }

    @IsTest
    static void contentFlagsCountLinksAndBlockedWords() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Content');
        JFormDefinition.Field site = new JFormDefinition.Field();
        site.key = 'site';
        site.fieldType = 'url';
        site.label = 'Website';
        def.sections[0].fields.add(site);
        JFormProtectionService.Settings s = JFormProtectionService.settingsOf(def);
        s.blockedWords = new List<String>{ 'casino', 'free money' };
        List<String> flags = JFormProtectionService.contentFlags(def, new Map<String, Object>{
            'why_summer' => 'see http://a.example and https://b.example plus www.c.example and WWW.D.EXAMPLE',
            'site' => 'https://not-counted.example',
            'first_name' => 'Best CASINO deals, free  money'
        }, s);
        String all = String.join(flags, ' | ');
        Assert.isTrue(all.contains('4 links in the answers'), all);
        Assert.isTrue(all.contains('blocked word: casino'), 'free money has a double space so only casino matches: ' + all);
        Assert.isTrue(JFormProtectionService.contentFlags(def, new Map<String, Object>{ 'first_name' => 'Casinos are fun' }, s).isEmpty(), 'whole words only');
    }

    @IsTest
    static void timingRateAndDuplicateSignalsAddUp() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            config(null, null, HEX_KEY);
            JFormPublishService.PublishResult r = publishProtected('Signals', new Map<String, Object>{ 'minSeconds' => 3, 'perMinute' => 1, 'duplicateMinutes' => 10 });

            Form_Submission__c first = submit(r.publicKey, answers('Ann'));
            Assert.areEqual('Processed', first.Status__c, 'no timing token alone is not enough to flag: ' + first.Spam_Reason__c);
            Assert.isNotNull(first.Answers_Hash__c);

            Form_Submission__c second = submit(r.publicKey, answers('Bob'));
            Assert.areEqual('Spam', second.Status__c);
            Assert.isTrue(second.Spam_Reason__c.contains('no timing token') && second.Spam_Reason__c.contains('responses in a minute'), second.Spam_Reason__c);
            Assert.areEqual(80, second.Spam_Score__c);

            Map<String, Object> fast = answers('Cat');
            fast.put(JFormPublicController.TIMING_ANSWER_KEY, JFormPublicController.startSubmission(r.publicKey));
            Form_Submission__c tooFast = submit(r.publicKey, fast);
            Assert.isTrue(tooFast.Spam_Reason__c.contains('under 3 seconds'), tooFast.Spam_Reason__c);
            Assert.areEqual('Spam', tooFast.Status__c);

            // same answers as the first response, within the duplicate window
            JFormProtectionService.configOverride.Signing_Key__c = null; // no token check, so only the duplicate counts... plus the rate limit
            Form_Submission__c again = submit(r.publicKey, answers('Ann'));
            Assert.areEqual('Spam', again.Status__c);
            Assert.isTrue(again.Spam_Reason__c.contains('same answers within 10 minutes'), again.Spam_Reason__c);

            Assert.areEqual(1, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId AND Status__c != 'Spam']);
            Assert.areEqual(3, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId AND Status__c = 'Spam'], 'flagged responses are kept');
        }
    }

    @IsTest
    static void blockedWordsFlagAndSwitchedOffProtectionDoesNot() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            config(null, null, null);
            JFormPublishService.PublishResult protectedForm = publishProtected('Words', new Map<String, Object>{ 'blockedWords' => 'casino', 'perMinute' => 0 });
            Map<String, Object> body = answers('Dan');
            body.put('first_name', 'Dan from the casino');
            Form_Submission__c flagged = submit(protectedForm.publicKey, body);
            Assert.areEqual('Spam', flagged.Status__c);
            Assert.isTrue(flagged.Spam_Reason__c.contains('blocked word: casino'), flagged.Spam_Reason__c);

            JFormPublishService.PublishResult off = publishProtected('Open', new Map<String, Object>{ 'enabled' => false, 'blockedWords' => 'casino' });
            Assert.areEqual('Processed', submit(off.publicKey, body).Status__c, 'switched off: only the honeypot applies');
        }
    }

    /** A callout cannot follow uncommitted DML, so each reCAPTCHA case is one method: set up, Test.startTest(), one submission. */
    private static JFormPublishService.PublishResult captchaForm(String name) {
        config('site-key', 'top-secret', null);
        return publishProtected(name, new Map<String, Object>{ 'captcha' => true, 'perMinute' => 0, 'duplicateMinutes' => 0 });
    }

    @IsTest
    static void recaptchaTokenMissingIsFlagged() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = captchaForm('Captcha0');
            Test.startTest();
            Form_Submission__c noToken = submit(r.publicKey, answers('Eve'));
            Test.stopTest();
            Assert.areEqual('Spam', noToken.Status__c);
            Assert.isTrue(noToken.Spam_Reason__c.contains('no reCAPTCHA token'), noToken.Spam_Reason__c);
        }
    }

    @IsTest
    static void recaptchaHumanScorePasses() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = captchaForm('Captcha1');
            RecaptchaMock human = new RecaptchaMock(200, '{"success": true, "score": 0.9, "action": "jform_submit"}');
            Test.setMock(HttpCalloutMock.class, human);
            Test.startTest();
            Form_Submission__c ok = submit(r.publicKey, withCaptcha(answers('Fay')));
            Test.stopTest();
            Assert.areEqual('Processed', ok.Status__c, 'a human score passes: ' + ok.Spam_Reason__c);
            Assert.areEqual(0.9, ok.Captcha_Score__c);
            Assert.isTrue(human.lastBody.contains('secret=top-secret') && human.lastBody.contains('response=client-token'), human.lastBody);
        }
    }

    @IsTest
    static void recaptchaLowScoreIsFlagged() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = captchaForm('Captcha2');
            Test.setMock(HttpCalloutMock.class, new RecaptchaMock(200, '{"success": true, "score": 0.1, "action": "jform_submit"}'));
            Test.startTest();
            Form_Submission__c bot = submit(r.publicKey, withCaptcha(answers('Gus')));
            Test.stopTest();
            Assert.areEqual('Spam', bot.Status__c);
            Assert.isTrue(bot.Spam_Reason__c.contains('reCAPTCHA score 0.1'), bot.Spam_Reason__c);
            Assert.areEqual(0.1, bot.Captcha_Score__c);
        }
    }

    @IsTest
    static void recaptchaRejectedTokenIsFlagged() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = captchaForm('Captcha3');
            Test.setMock(HttpCalloutMock.class, new RecaptchaMock(200, '{"success": false, "error-codes": ["invalid-input-response"]}'));
            Test.startTest();
            Form_Submission__c rejected = submit(r.publicKey, withCaptcha(answers('Hal')));
            Test.stopTest();
            Assert.areEqual('Spam', rejected.Status__c, 'rejected token');
        }
    }

    @IsTest
    static void recaptchaTokenFromAnotherSiteIsFlagged() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = captchaForm('Captcha5');
            JFormProtectionService.siteHosts = new Set<String>{ 'acme.my.site.com' };
            Test.setMock(HttpCalloutMock.class, new RecaptchaMock(200, '{"success": true, "score": 0.9, "action": "jform_submit", "hostname": "elsewhere.example.com"}'));
            Test.startTest();
            Form_Submission__c foreign = submit(r.publicKey, withCaptcha(answers('Jo')));
            Test.stopTest();
            Assert.areEqual('Spam', foreign.Status__c, 'a token made on another host');
            Assert.areEqual(0, foreign.Captcha_Score__c);
        }
    }

    @IsTest
    static void recaptchaTokenFromTheSitePasses() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = captchaForm('Captcha6');
            JFormProtectionService.siteHosts = new Set<String>{ 'acme.my.site.com' };
            Test.setMock(HttpCalloutMock.class, new RecaptchaMock(200, '{"success": true, "score": 0.9, "action": "jform_submit", "hostname": "ACME.my.site.com"}'));
            Test.startTest();
            Form_Submission__c ok = submit(r.publicKey, withCaptcha(answers('Kim')));
            Test.stopTest();
            Assert.areEqual('Processed', ok.Status__c, 'the site host passes: ' + ok.Spam_Reason__c);
            Assert.areEqual(0.9, ok.Captcha_Score__c);
        }
    }

    @IsTest
    static void recaptchaOutageNeverBlocks() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = captchaForm('Captcha4');
            Test.setMock(HttpCalloutMock.class, new RecaptchaMock(500, 'oops'));
            Test.startTest();
            Form_Submission__c outage = submit(r.publicKey, withCaptcha(answers('Ivy')));
            Test.stopTest();
            Assert.areEqual('Processed', outage.Status__c, 'Google down never blocks a respondent');
            Assert.isNull(outage.Captcha_Score__c);
        }
    }

    private static Map<String, Object> withCaptcha(Map<String, Object> body) {
        body.put(JFormPublicController.CAPTCHA_KEY, 'client-token');
        return body;
    }

    @IsTest
    static void trustedCallersSkipEverythingButTheHoneypotAndSpamKeepsNoFiles() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            config('site-key', 'top-secret', HEX_KEY);
            JFormPublishService.PublishResult r = publishProtected('Trusted', new Map<String, Object>{ 'captcha' => true, 'minSeconds' => 30 });

            Id trusted = JFormPublicController.submitTrusted(r.publicKey, JSON.serialize(answers('Joe')), null);
            Assert.areEqual('Processed', [SELECT Status__c FROM Form_Submission__c WHERE Id = :trusted].Status__c, 'no token, no captcha, still fine for the API');

            Map<String, Object> bot = answers('Kim');
            bot.put(JFormPublicController.HONEYPOT_KEY, 'http://spam.example');
            Id flagged = JFormPublicController.submitTrusted(r.publicKey, JSON.serialize(bot), null);
            Assert.areEqual('Spam', [SELECT Status__c FROM Form_Submission__c WHERE Id = :flagged].Status__c);

            Assert.isNull(JFormPublicController.attachFile(r.publicKey, flagged, 'first_name', 'x.png', 'AAAA'), 'nothing is attached to a flagged response');
            Assert.areEqual(0, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :flagged]);

            String message;
            try {
                JFormSubmissionService.reprocess(flagged);
            } catch (JFormSubmissionService.SubmissionException e) {
                message = e.getMessage();
            }
            Assert.isTrue(message != null && message.contains('flagged as spam'), 'spam is never reprocessed: ' + message);
        }
    }
}
