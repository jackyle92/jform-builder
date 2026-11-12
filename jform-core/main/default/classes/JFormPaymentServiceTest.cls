@IsTest
private class JFormPaymentServiceTest {

    private static final String SITE = 'https://jform.example.my.site.com/forms';
    private static final String PI = 'pi_3PqRsTuVwXyZ0123';

    /** A gateway that answers from memory, so the payment flow runs without callouts. */
    private class FakeGateway implements JFormPaymentProvider {
        String reference = 'cs_test_fake0000000001';
        JFormPaymentService.CheckoutRequest lastRequest;
        Integer created = 0;
        /** What fetchCheckout reports; null means Stripe cannot be reached. */
        JFormPaymentService.GatewayUpdate current;
        /** What fetchCheckout reports for a given checkout, before current. */
        Map<String, JFormPaymentService.GatewayUpdate> byReference = new Map<String, JFormPaymentService.GatewayUpdate>();
        /** The checkouts fetchCheckout was asked for, in order. */
        List<String> fetched = new List<String>();
        Boolean expireFails = false;
        List<String> expired = new List<String>();

        public String name() {
            return 'Stripe';
        }
        public JFormPaymentService.Checkout createCheckout(JFormPaymentService.CheckoutRequest r) {
            created++;
            lastRequest = r;
            JFormPaymentService.Checkout c = new JFormPaymentService.Checkout();
            c.reference = reference;
            c.url = 'https://checkout.stripe.com/c/pay/' + reference;
            return c;
        }
        public JFormPaymentService.GatewayUpdate fetchCheckout(String mode, String checkoutReference) {
            fetched.add(checkoutReference);
            if (byReference.containsKey(checkoutReference)) {
                return byReference.get(checkoutReference);
            }
            if (current == null) {
                throw new JFormPaymentService.PaymentException('Salesforce could not reach Stripe.');
            }
            return current;
        }
        public void expireCheckout(String mode, String checkoutReference) {
            if (expireFails) {
                throw new JFormPaymentService.PaymentException('This Checkout Session is complete.');
            }
            expired.add(checkoutReference);
        }
        public JFormPaymentService.GatewayUpdate readWebhook(String mode, Map<String, String> headers, Blob body) {
            return current;
        }
        public List<JFormPaymentService.Refund> listRefunds(String mode, String paymentReference) {
            return new List<JFormPaymentService.Refund>();
        }
        public JFormPaymentService.ConnectionCheck checkConnection(String mode, String webhookUrl) {
            JFormPaymentService.ConnectionCheck c = new JFormPaymentService.ConnectionCheck();
            c.mode = mode;
            c.keyWorks = true;
            return c;
        }
    }

    /** Keys kept in memory instead of the named credential. */
    private class FakeStore implements JFormPaymentService.CredentialStore {
        Map<String, String> keys = new Map<String, String>();
        public Boolean hasKey(String mode) {
            return keys.containsKey(mode);
        }
        public void saveKey(String mode, String secretKey) {
            keys.put(mode, secretKey);
        }
        public void removeKey(String mode) {
            keys.remove(mode);
        }
    }

    static FakeGateway useGateway() {
        FakeGateway g = new FakeGateway();
        JFormPaymentService.providerOverride = g;
        JFormPaymentService.siteHosts = new Set<String>{ 'jform.example.my.site.com' };
        JFormPaymentService.sandbox = false;
        return g;
    }

    /** The sample form, without a target record, with a Payment block that charges per season. */
    static JFormDefinition.Form paymentForm(Map<String, Object> payments) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Workshop');
        def.targetObjectApiName = null;
        def.settings.put('payments', payments);
        JFormDefinition.Field block = new JFormDefinition.Field();
        block.key = 'pay';
        block.fieldType = 'payment';
        block.label = 'Payment';
        block.config = new Map<String, Object>{
            'pricing' => 'choice', 'source' => 'season', 'item' => 'Workshop ticket',
            'prices' => new List<Object>{ new Map<String, Object>{ 'value' => 'autumn', 'amount' => 45 } }
        };
        def.sections[1].fields.add(block);
        return def;
    }

    static JFormPublishService.PublishResult publish(Map<String, Object> payments) {
        JFormDefinition.Form def = JFormDefinitionService.create(paymentForm(payments));
        return JFormPublishService.publish(def.id, null);
    }

    static String answers(String season) {
        return JSON.serialize(new Map<String, Object>{ 'first_name' => 'Ann', 'email' => 'ann@example.com', 'season' => season, 'why_summer' => 'The sun' });
    }

    static JFormPaymentService.Started pay(String publicKey, FakeGateway g, String reference) {
        return pay(publicKey, g, reference, answers('autumn'));
    }

    static JFormPaymentService.Started pay(String publicKey, FakeGateway g, String reference, String answersJson) {
        g.reference = reference;
        return JFormPublicController.submitWithPayment(publicKey, answersJson, SITE + '/workshop', SITE + '/workshop');
    }

    static JFormPaymentService.GatewayUpdate gatewayUpdate(String kind, String reference) {
        JFormPaymentService.GatewayUpdate u = new JFormPaymentService.GatewayUpdate();
        u.kind = kind;
        u.mode = JFormPaymentService.TEST;
        u.checkoutReference = reference;
        u.paymentReference = kind == JFormPaymentService.KIND_OPEN || kind == JFormPaymentService.KIND_EXPIRED ? null : PI + reference.right(4);
        u.amount = 4500;
        u.currencyCode = 'USD';
        u.paymentMethod = 'card';
        u.providerUrl = 'https://dashboard.stripe.com/test/payments/' + u.paymentReference;
        return u;
    }

    static String apply(JFormPaymentService.GatewayUpdate u) {
        return JFormPaymentService.apply(new List<JFormPaymentService.GatewayUpdate>{ u }).values()[0];
    }

    /** Backdate a checkout so the hourly check sees it as settled: opened before the gateway would have expired it. */
    static void openedMinutesAgo(String reference, Integer minutes) {
        Test.setCreatedDate([SELECT Id FROM Form_Payment__c WHERE Checkout_Reference__c = :reference].Id, System.now().addMinutes(-minutes));
    }

    static Form_Payment__c paymentOf(String reference) {
        return [
            SELECT Status__c, Mode__c, Amount__c, Amount_Refunded__c, Currency__c, Amount_Expected__c, Currency_Expected__c, Provider__c, Payment_Reference__c,
                Client_Reference__c, Payment_Method__c, Provider_Url__c, Paid_At__c, Last_Checked_At__c, Form_Submission__c, Form_Submission__r.Payment_Status__c,
                Form_Submission__r.Payment_Amount__c, Form_Submission__r.Status__c
            FROM Form_Payment__c WHERE Checkout_Reference__c = :reference
        ];
    }

    static String auraMessage(Exception e) {
        return e.getMessage();
    }

    /** The REST listing of a form's responses with the Responses tab's default payment filter. */
    static List<Object> restSubmissions(Id formId) {
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/jform/v1/forms/' + formId + '/submissions';
        req.httpMethod = 'GET';
        RestContext.request = req;
        RestContext.response = new RestResponse();
        JFormRestApi.doGet();
        Assert.areEqual(200, RestContext.response.statusCode);
        return (List<Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
    }

    @IsTest
    static void thePayButtonOpensACheckoutAndHoldsTheResponse() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd' });
            FakeGateway g = useGateway();

            JFormPaymentService.Started s = JFormPublicController.submitWithPayment(
                r.publicKey, answers('autumn'), SITE + '/workshop', SITE + '/workshop?key=' + r.publicKey + '&jfpay=cancel&jfwin=1&jfref=jf_earlier#top');

            Assert.areEqual('https://checkout.stripe.com/c/pay/cs_test_fake0000000001', s.checkoutUrl);
            Assert.areEqual('cs_test_fake0000000001', s.checkoutReference);
            Assert.areEqual('test', s.mode);
            Assert.areEqual(45.00, s.amount);
            Assert.areEqual('USD', s.currencyCode);
            JFormPaymentService.CheckoutRequest req = g.lastRequest;
            Assert.isTrue(req.reference.startsWith('jf_'), req.reference);
            // both links carry JForm's own reference, so a cancelled checkout is found without the browser's storage
            Assert.areEqual(SITE + '/workshop?key=' + r.publicKey + '&jfpay=success&jfwin=1&jfref=' + req.reference + '&jfcs={CHECKOUT_SESSION_ID}', req.successUrl, 'an earlier attempt\'s parameters are dropped');
            Assert.areEqual(SITE + '/workshop?key=' + r.publicKey + '&jfpay=cancel&jfwin=1&jfref=' + req.reference, req.cancelUrl);
            Assert.areEqual(4500L, req.quote.amount, 'priced on the server');
            Assert.areEqual('Workshop ticket: Autumn', req.quote.lines[0].name);
            Assert.areEqual('Workshop', req.description);
            Assert.isTrue(req.expiresAt > System.now().addMinutes(59));
            Assert.areEqual('ann@example.com', req.customerEmail, 'the form\'s one Email field goes to the checkout on its own');

            Form_Payment__c p = paymentOf(s.checkoutReference);
            Assert.areEqual(req.reference, p.Client_Reference__c);
            Assert.areEqual(JFormPaymentService.AWAITING, p.Status__c);
            Assert.areEqual(JFormPaymentService.TEST, p.Mode__c);
            Assert.areEqual(4500, p.Amount__c);
            Assert.areEqual(0, p.Amount_Refunded__c);
            Assert.areEqual('USD', p.Currency__c);
            Assert.areEqual('Stripe', p.Provider__c);
            Assert.areEqual(s.submissionId, p.Form_Submission__c);
            Assert.areEqual(JFormPaymentService.AWAITING, p.Form_Submission__r.Payment_Status__c);
            Assert.areEqual(45, p.Form_Submission__r.Payment_Amount__c);
            Assert.areEqual('New', p.Form_Submission__r.Status__c, 'the record steps wait for the payment');
            Assert.isFalse(JFormSubmissionService.lastEventPublished, 'and so does Submitted__e');
            Assert.areEqual(45, Decimal.valueOf([
                SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :s.submissionId AND Field_Key__c = 'pay'
            ].Field_Value__c), 'the Payment block\'s answer is the total');

            // a second click opens a second checkout and a second response; an old renderer's attempt key is dropped
            Map<String, Object> withAttempt = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
            withAttempt.put(JFormPublicController.ATTEMPT_KEY, 'try2');
            JFormPaymentService.Started again = pay(r.publicKey, g, 'cs_test_fake0000000002', JSON.serialize(withAttempt));
            Assert.areNotEqual(s.submissionId, again.submissionId);
            Assert.areEqual('cs_test_fake0000000002', again.checkoutReference);
            Assert.areEqual(2, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId]);
            Assert.areEqual(2, [SELECT COUNT() FROM Form_Payment__c]);
            Assert.areEqual(0, [SELECT COUNT() FROM Submission_Field_Value__c WHERE Field_Key__c = :JFormPublicController.ATTEMPT_KEY]);

            Assert.areEqual('open', JFormPublicController.getPaymentStatus(r.publicKey, s.checkoutReference, false));
            Assert.areEqual('open', JFormPublicController.getPaymentStatus(r.publicKey, req.reference, false), 'found by JForm\'s own reference too');
            Assert.areEqual('unknown', JFormPublicController.getPaymentStatus('OTHERKEY', s.checkoutReference, false), 'another form\'s checkout is never found');
            Assert.areEqual('unknown', JFormPublicController.getPaymentStatus('OTHERKEY', req.reference, false));
            Assert.areEqual('unknown', JFormPublicController.getPaymentStatus(r.publicKey, 'cs_test_x\' OR Name != \'', false));
        }
    }

    static JFormDefinition.Field emailField(String key, String label) {
        JFormDefinition.Field f = new JFormDefinition.Field();
        f.key = key;
        f.fieldType = 'email';
        f.label = label;
        return f;
    }

    @IsTest
    static void theRespondentsEmailGoesToTheCheckoutWhenTheFormHasOneEmailField() {
        JFormPaymentService.FormSettings none = new JFormPaymentService.FormSettings();
        JFormDefinition.Form one = paymentForm(new Map<String, Object>());
        Map<String, Object> answers = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
        Assert.areEqual('ann@example.com', JFormPaymentService.customerEmail(one, answers, null, none));
        answers.put('email', '  Ann@Example.com ');
        Assert.areEqual('Ann@Example.com', JFormPaymentService.customerEmail(one, answers, null, none), 'trimmed, otherwise as typed');

        // no answer, a blank one, or one that is not an address: the gateway's page asks as before
        answers.remove('email');
        Assert.isNull(JFormPaymentService.customerEmail(one, answers, null, none));
        answers.put('email', '   ');
        Assert.isNull(JFormPaymentService.customerEmail(one, answers, null, none));
        answers.put('email', 'not an address');
        Assert.isNull(JFormPaymentService.customerEmail(one, answers, null, none));
        answers.put('email', new List<Object>{ 'ann@example.com' });
        Assert.isNull(JFormPaymentService.customerEmail(one, answers, null, none));
        Assert.isNull(JFormPaymentService.customerEmail(one, null, null, none));

        // an Email field logic hides is not stored, so it is not sent either
        answers.put('email', 'ann@example.com');
        JFormLogicEvaluator.Result hidden = new JFormLogicEvaluator.Result();
        hidden.visible.put('email', false);
        Assert.isNull(JFormPaymentService.customerEmail(one, answers, hidden, none));

        // a form without an Email field
        JFormDefinition.Form plain = paymentForm(new Map<String, Object>());
        plain.sections[0].fields.remove(2);
        Assert.isTrue(JFormPaymentService.emailFields(plain).isEmpty());
        Assert.isNull(JFormPaymentService.customerEmail(plain, answers, null, none));

        // the builder chose Ask: the page asks even though the form has an Email answer
        JFormPaymentService.FormSettings ask = new JFormPaymentService.FormSettings();
        ask.askEmail = true;
        Assert.isNull(JFormPaymentService.customerEmail(one, answers, null, ask));
        one.settings.put('payments', new Map<String, Object>{ 'askEmail' => true });
        Assert.isTrue(JFormPaymentService.settingsOf(one).askEmail);
        Assert.isFalse(JFormPaymentService.settingsOf(one).askBillingAddress, 'the page asks for a billing address only when the card needs one');
        one.settings.put('payments', new Map<String, Object>{ 'askBillingAddress' => true });
        Assert.isTrue(JFormPaymentService.settingsOf(one).askBillingAddress);

        // longer than an address can be (254 characters): the page asks rather than the gateway refusing it
        answers.put('email', 'a'.repeat(243) + '@example.com');
        Assert.isNull(JFormPaymentService.customerEmail(one, answers, null, none));
        answers.put('email', 'a'.repeat(242) + '@example.com');
        Assert.areEqual(254, JFormPaymentService.customerEmail(one, answers, null, none).length());
    }

    @IsTest
    static void savingTidiesTheEmailChoice() {
        JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'emailField' => ' billing ', 'currency' => 'EUR' });
        def.sections[1].fields.add(emailField('billing', 'Billing email'));
        Map<String, Object> payments = (Map<String, Object>) def.settings.get('payments');

        // spaces are trimmed, so removing or renaming the field finds the setting
        JFormPaymentService.normaliseEmailField(def);
        Assert.areEqual('billing', payments.get('emailField'));
        payments.put('emailField', ' billing ');
        JFormAutomationService.renameKey(def, 'billing', 'billing_email');
        Assert.areEqual('billing_email', payments.get('emailField'));
        payments.put('emailField', ' billing ');
        JFormAutomationService.dropReferences(def, 'billing');
        Assert.isFalse(payments.containsKey('emailField'));

        // a field that is no longer an Email field (REST, agents) stops filling in the payment page
        payments.put('emailField', 'billing');
        def.sections[1].fields[def.sections[1].fields.size() - 1].fieldType = 'text';
        JFormPaymentService.normaliseEmailField(def);
        Assert.isFalse(payments.containsKey('emailField'));
        Assert.areEqual('EUR', payments.get('currency'));

        // a key the form doesn't have, or a blank one, goes too
        payments.put('emailField', 'old');
        JFormPaymentService.normaliseEmailField(def);
        Assert.isFalse(payments.containsKey('emailField'));
        payments.put('emailField', '  ');
        JFormPaymentService.normaliseEmailField(def);
        Assert.isFalse(payments.containsKey('emailField'));
        JFormPaymentService.normaliseEmailField(null);

        // Ask wins over a field; askEmail is stored only when true
        def.sections[1].fields[def.sections[1].fields.size() - 1].fieldType = 'email';
        payments.put('emailField', 'billing');
        payments.put('askEmail', true);
        JFormPaymentService.normaliseEmailField(def);
        Assert.isFalse(payments.containsKey('emailField'));
        Assert.areEqual(true, payments.get('askEmail'));
        payments.put('emailField', 'billing');
        payments.put('askEmail', 'true');
        JFormPaymentService.normaliseEmailField(def);
        Assert.areEqual('billing', payments.get('emailField'));
        Assert.isFalse(payments.containsKey('askEmail'));
        def.sections[1].fields[def.sections[1].fields.size() - 1].fieldType = 'text';

        // through a save
        System.runAs(JFormTestDataFactory.builderUser()) {
            payments.put('emailField', 'billing');
            JFormDefinition.Form saved = JFormDefinitionService.create(def);
            Map<String, Object> stored = (Map<String, Object>) JFormDefinitionService.load(saved.id).settings.get('payments');
            Assert.isFalse(stored.containsKey('emailField'), String.valueOf(stored));
        }
    }

    @IsTest
    static void aFormWithSeveralEmailFieldsSendsTheOneTheSettingsChoose() {
        JFormDefinition.Form two = paymentForm(new Map<String, Object>());
        two.sections[1].fields.add(emailField('billing', 'Billing email'));
        Map<String, Object> answers = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
        answers.put('billing', 'accounts@example.com');
        Assert.areEqual(new List<String>{ 'email', 'billing' }, new List<String>{ JFormPaymentService.emailFields(two)[0].key, JFormPaymentService.emailFields(two)[1].key });

        // nothing chosen: the gateway's page keeps asking
        JFormPaymentService.FormSettings none = JFormPaymentService.settingsOf(two);
        Assert.isNull(none.emailField);
        Assert.isNull(JFormPaymentService.customerEmail(two, answers, null, none));
        Assert.isTrue(JFormPaymentService.definitionProblems(two).isEmpty());

        two.settings.put('payments', new Map<String, Object>{ 'emailField' => ' billing ' });
        JFormPaymentService.FormSettings chosen = JFormPaymentService.settingsOf(two);
        Assert.areEqual('billing', chosen.emailField);
        Assert.areEqual('accounts@example.com', JFormPaymentService.customerEmail(two, answers, null, chosen));
        Assert.isTrue(JFormPaymentService.definitionProblems(two).isEmpty());
        Assert.isTrue(JFormPaymentService.publishProblems(two).isEmpty());
        answers.remove('billing');
        Assert.isNull(JFormPaymentService.customerEmail(two, answers, null, chosen), 'the other Email field is not used in its place');

        // the setting names a field the form no longer has: saving goes ahead, publishing says so
        two.settings.put('payments', new Map<String, Object>{ 'emailField' => 'old' });
        String problem = 'The Payments settings name an Email field "old" the form doesn\'t have. Choose one in Settings › Payments.';
        Assert.isTrue(JFormPaymentService.definitionProblems(two).isEmpty(), 'deleting or renaming the field never stops a save');
        Assert.areEqual(new List<String>{ problem }, JFormPaymentService.publishProblems(two));
        Assert.isNull(JFormPaymentService.customerEmail(two, answers, null, JFormPaymentService.settingsOf(two)));

        // keys match exactly, as in the builder
        two.settings.put('payments', new Map<String, Object>{ 'emailField' => 'Billing' });
        answers.put('billing', 'accounts@example.com');
        Assert.isNull(JFormPaymentService.customerEmail(two, answers, null, JFormPaymentService.settingsOf(two)));
        Assert.areEqual(1, JFormPaymentService.publishProblems(two).size());

        // removing the field clears the setting
        two.settings.put('payments', new Map<String, Object>{ 'emailField' => 'billing', 'currency' => 'EUR' });
        JFormAutomationService.dropReferences(two, 'billing');
        Assert.areEqual(new Map<String, Object>{ 'currency' => 'EUR' }, two.settings.get('payments'));

        // a page sent without a fields list, on a form whose one Email field is used on its own
        two.sections[1].fields.remove(two.sections[1].fields.size() - 1);
        JFormDefinition.Section empty = new JFormDefinition.Section();
        empty.fields = null;
        two.sections.add(empty);
        Assert.areEqual(1, JFormPaymentService.emailFields(two).size());
        Assert.areEqual('ann@example.com', JFormPaymentService.customerEmail(two, answers, null, JFormPaymentService.settingsOf(two)));
        JFormDefinition.Form noBlock = JFormTestDataFactory.sampleDefinition('Plain');
        noBlock.settings.put('payments', new Map<String, Object>{ 'emailField' => 'old' });
        Assert.isTrue(JFormPaymentService.definitionProblems(noBlock).isEmpty(), 'without a Payment block the setting is not checked');
        Assert.isTrue(JFormPaymentService.publishProblems(noBlock).isEmpty());

        // through the Pay click: the published form's setting picks the field
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'emailField' => 'billing' });
            def.sections[1].fields.add(emailField('billing', 'Billing email'));
            JFormPublishService.PublishResult r = JFormPublishService.publish(JFormDefinitionService.create(def).id, null);
            FakeGateway g = useGateway();
            Map<String, Object> order = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
            order.put('billing', 'accounts@example.com');
            pay(r.publicKey, g, 'cs_test_mail_0000001', JSON.serialize(order));
            Assert.areEqual('accounts@example.com', g.lastRequest.customerEmail);
            order.remove('billing');
            pay(r.publicKey, g, 'cs_test_mail_0000002', JSON.serialize(order));
            Assert.isNull(g.lastRequest.customerEmail, 'blank: Stripe\'s page asks');
        }
    }

    static String withCode(String code) {
        Map<String, Object> a = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
        a.put(JFormPublicController.CODE_KEY, code);
        return JSON.serialize(a);
    }

    static JFormPromotionCodeService.Summary code(Id formId, String code, String discountType, Decimal off, Integer maxUses) {
        JFormPromotionCodeService.Summary s = new JFormPromotionCodeService.Summary();
        s.code = code;
        s.discountType = discountType;
        if (discountType == JFormPromotionCodeService.PERCENT) {
            s.percentOff = off;
        } else {
            s.amountOff = off;
        }
        s.maxUses = maxUses;
        return JFormPromotionCodeService.save(formId, s);
    }

    @IsTest
    static void thePayClickHonoursTheGuessingLimit() {
        JFormPromotionCodeService.testCounts = new Map<String, Integer>();
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'codes' => 'jform' });
            code(r.formId, 'LAST', JFormPromotionCodeService.PERCENT, 10, null);
            FakeGateway g = useGateway();
            // wrong codes tried at Pay count too
            try {
                pay(r.publicKey, g, 'cs_test_guess000000001', withCode('GUESS'));
                Assert.fail();
            } catch (AuraHandledException e) {
                Assert.areEqual(JFormPromotionCodeService.REFUSED, auraMessage(e));
            }
            Assert.areEqual(1, JFormPromotionCodeService.testCounts.get(JFormPromotionCodeService.formKey(r.formId)));

            // past the form's limit even the right code is refused, at Apply and at Pay, with the one message
            JFormPromotionCodeService.testCounts.put(JFormPromotionCodeService.formKey(r.formId), JFormPromotionCodeService.GUESSES_PER_FORM);
            Assert.areEqual(new Map<String, Object>{ 'valid' => false }, JFormPublicController.checkPromotionCode(r.publicKey, 'LAST', null));
            try {
                pay(r.publicKey, g, 'cs_test_guess000000002', withCode('LAST'));
                Assert.fail();
            } catch (AuraHandledException e) {
                Assert.areEqual(JFormPromotionCodeService.REFUSED, auraMessage(e));
            }
            Assert.areEqual(0, g.created, 'no checkout opened');
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId]);
        }
    }

    @IsTest
    static void aJFormCodeIsCheckedAppliedAndCountedOnThePayClick() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'codes' => 'jform' });
            JFormPromotionCodeService.Summary last = code(r.formId, 'LAST', JFormPromotionCodeService.PERCENT, 10, 1);
            code(r.formId, 'FIVE', JFormPromotionCodeService.AMOUNT, 5, null);
            FakeGateway g = useGateway();

            // the Apply click: the form's key, the code and the timing token; a refused code gets nothing but "valid: false"
            Map<String, Object> ok = JFormPublicController.checkPromotionCode(r.publicKey, ' last ', null);
            Assert.areEqual(true, ok.get('valid'), 'no signing key, so no token is held against the respondent');
            Assert.areEqual('LAST', ok.get('code'));
            Assert.areEqual(JFormPromotionCodeService.PERCENT, ok.get('discountType'));
            Assert.areEqual(10.00, ok.get('percentOff'));
            Assert.isNull(ok.get('amountOff'));
            Assert.areEqual(50L, ok.get('minimumCharge'), 'the USD Payment Currency record, in cents, so the renderer prices as the checkout will');
            Assert.areEqual(500L,JFormPublicController.checkPromotionCode(r.publicKey, 'five', null).get('amountOff'), 'in the smallest unit, as the renderer prices');
            Map<String, Object> no = JFormPublicController.checkPromotionCode(r.publicKey, 'NOPE', null);
            Assert.areEqual(new Map<String, Object>{ 'valid' => false }, no, 'nothing about why');
            JFormProtectionService.configOverride = new Protection_Settings__c(Signing_Key__c = 'k'.repeat(32), Min_Score__c = 0.5);
            Assert.areEqual(false, JFormPublicController.checkPromotionCode(r.publicKey, 'LAST', null).get('valid'), 'with a signing key the token is required');
            Assert.areEqual(false, JFormPublicController.checkPromotionCode(r.publicKey, 'LAST', 'not.a.token').get('valid'));
            Assert.areEqual(true, JFormPublicController.checkPromotionCode(r.publicKey, 'LAST', JFormProtectionService.issueToken(r.publicKey)).get('valid'));
            JFormProtectionService.configOverride = null;

            // the Pay click sends the code with the answers: checked again, priced, and on the checkout as a discount
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_coded00000001', withCode('last'));
            Assert.areEqual(40.50, s.amount);
            JFormPaymentService.CheckoutRequest req = g.lastRequest;
            Assert.areEqual(4050L, req.quote.amount);
            Assert.areEqual(4500L, req.quote.subtotal);
            Assert.areEqual(450L, req.discount);
            Assert.areEqual('LAST', req.discountName);
            Assert.isFalse(req.allowGatewayCodes);
            Form_Payment__c p = [SELECT Amount__c, Discount_Amount__c, Code__c, Promotion_Code__c, Status__c, Form_Submission__r.Payment_Amount__c FROM Form_Payment__c WHERE Checkout_Reference__c = :s.checkoutReference];
            Assert.areEqual(4050, p.Amount__c);
            Assert.areEqual(450, p.Discount_Amount__c);
            Assert.areEqual('LAST', p.Code__c);
            Assert.areEqual(last.id, p.Promotion_Code__c);
            Assert.areEqual(40.50, p.Form_Submission__r.Payment_Amount__c);
            Assert.areEqual(0, [SELECT COUNT() FROM Submission_Field_Value__c WHERE Field_Key__c = :JFormPublicController.CODE_KEY], 'the code is not an answer');
            Assert.areEqual(40.50, Decimal.valueOf([SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :s.submissionId AND Field_Key__c = 'pay'].Field_Value__c));

            // its one use is taken by the open checkout: the next Apply is refused, and so is a Pay click that still carries it
            Assert.areEqual(false, JFormPublicController.checkPromotionCode(r.publicKey, 'LAST', null).get('valid'));
            try {
                pay(r.publicKey, g, 'cs_test_coded00000002', withCode('LAST'));
                Assert.fail();
            } catch (AuraHandledException e) {
                Assert.areEqual(JFormPromotionCodeService.REFUSED, auraMessage(e), 'the one message, which the renderer recognises');
            }
            Assert.areEqual(1, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :r.formId], 'nothing stored for the refused click');
            Assert.areEqual(1, g.created);
            Assert.areEqual(1, JFormPromotionCodeService.listCodes(r.formId)[1].uses + JFormPromotionCodeService.listCodes(r.formId)[0].uses);

            // the checkout expires: the use is given back
            apply(gatewayUpdate(JFormPaymentService.KIND_EXPIRED, s.checkoutReference));
            Assert.areEqual(true, JFormPublicController.checkPromotionCode(r.publicKey, 'LAST', null).get('valid'));
            JFormPaymentService.Started again = pay(r.publicKey, g, 'cs_test_coded00000003', withCode('LAST'));
            JFormPaymentService.GatewayUpdate paid = gatewayUpdate(JFormPaymentService.KIND_PAID, again.checkoutReference);
            paid.amount = 4050;
            paid.subtotal = 4500;
            paid.discount = 450;
            paid.code = 'LAST';
            Assert.areEqual(JFormPaymentService.PAID, apply(paid), 'Stripe reports the discounted total, which is what JForm priced');
            Form_Payment__c done = paymentOf(again.checkoutReference);
            Assert.areEqual(4050, done.Amount__c);
            Assert.isNull(done.Amount_Expected__c);
            Assert.areEqual(40.50, done.Form_Submission__r.Payment_Amount__c);
            Assert.areEqual(JFormPaymentService.PAID, done.Form_Submission__r.Payment_Status__c);

            // a form without the code box ignores a code that is sent anyway
            JFormPublishService.PublishResult plain = publish(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd' });
            code(plain.formId, 'LAST', JFormPromotionCodeService.PERCENT, 10, null);
            Assert.areEqual(false, JFormPublicController.checkPromotionCode(plain.publicKey, 'LAST', null).get('valid'));
            JFormPaymentService.Started plainPay = pay(plain.publicKey, g, 'cs_test_coded00000004', withCode('LAST'));
            Assert.areEqual(45.00, plainPay.amount);

            // Responses and the REST listing show the code and what it took off
            JFormResponsesController.ResultPage listed = JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(1, listed.rows.size());
            Assert.areEqual('LAST', listed.rows[0].promotionCode);
            Assert.areEqual(4.50, listed.rows[0].discountAmount);
            Assert.areEqual(1, JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, 'la').total);
            Assert.areEqual(0, JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, 'FIVE').total);
            String csv = JFormResponsesController.exportCsv(r.formId, false, null, null);
            Assert.isTrue(csv.contains('Payment Status,Payment Amount,Promotion Code,Discount'), csv.substringBefore('\n'));
            Assert.isTrue(csv.contains('Paid,40.50,LAST,4.50'), csv);
            Assert.areEqual(1, JFormResponsesController.exportCsv(r.formId, false, null, 'FIVE').split('\n').size(), 'header only');
            Map<String, Object> rest = (Map<String, Object>) restSubmissions(r.formId)[0];
            Assert.areEqual('LAST', rest.get('promotionCode'));
            Assert.areEqual(4.50, rest.get('discountAmount'));
            Assert.isTrue(restSubmissions(plain.formId).isEmpty(), 'the plain form\'s checkout is still open, so its response is not listed');
            // paid without a code: no discount in the listing, as on the Responses tab
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, plainPay.checkoutReference));
            Map<String, Object> plainRest = (Map<String, Object>) restSubmissions(plain.formId)[0];
            Assert.areEqual('Paid', plainRest.get('paymentStatus'));
            Assert.isFalse(plainRest.containsKey('promotionCode'));
            Assert.isFalse(plainRest.containsKey('discountAmount'), 'a discount of 0 is no discount');
        }
    }

    @IsTest
    static void aCodeThatTakesTheWholeTotalStoresTheResponseAsPaidWithNoCheckout() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'codes' => 'jform' });
            JFormPromotionCodeService.Summary free = code(r.formId, 'FREE', JFormPromotionCodeService.AMOUNT, 100, null);
            FakeGateway g = useGateway();

            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_free000000001', withCode('free'));

            Assert.isNull(s.checkoutUrl);
            Assert.isNull(s.checkoutReference);
            Assert.areEqual(0, s.amount);
            Assert.areEqual('test', s.mode);
            Assert.areEqual(0, g.created, 'nothing to pay, so no checkout');
            Form_Payment__c p = [
                SELECT Status__c, Amount__c, Discount_Amount__c, Code__c, Promotion_Code__c, Paid_At__c, Checkout_Reference__c, Provider__c, Mode__c,
                    Form_Submission__r.Payment_Status__c, Form_Submission__r.Payment_Amount__c
                FROM Form_Payment__c WHERE Form_Submission__c = :s.submissionId
            ];
            Assert.areEqual(JFormPaymentService.PAID, p.Status__c);
            Assert.areEqual(0, p.Amount__c);
            Assert.areEqual(4500, p.Discount_Amount__c, 'capped at the subtotal');
            Assert.areEqual('FREE', p.Code__c);
            Assert.areEqual(free.id, p.Promotion_Code__c);
            Assert.isNotNull(p.Paid_At__c);
            Assert.isNull(p.Checkout_Reference__c);
            Assert.areEqual('Stripe', p.Provider__c);
            Assert.areEqual(JFormPaymentService.TEST, p.Mode__c);
            Assert.areEqual(JFormPaymentService.PAID, p.Form_Submission__r.Payment_Status__c);
            Assert.areEqual(0, p.Form_Submission__r.Payment_Amount__c);
            Assert.areEqual(new List<Id>{ s.submissionId }, JFormPaymentService.queuedSteps, 'the record steps run as after a payment');
            Assert.areEqual(1, JFormPromotionCodeService.listCodes(r.formId)[0].uses);
            Assert.areEqual('paid', JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, null).rows[0].paymentStatus.toLowerCase());
        }
    }

    @IsTest
    static void aCodeEnteredOnStripesPageIsReadBackFromTheSubtotal() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'codes' => 'gateway' });
            FakeGateway g = useGateway();
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_gwcode0000001');
            Assert.isTrue(g.lastRequest.allowGatewayCodes, 'Stripe shows its own code box');
            Assert.areEqual(0L, g.lastRequest.discount);
            Assert.areEqual(false, JFormPublicController.checkPromotionCode(r.publicKey, 'SPRING10', null).get('valid'), 'JForm cannot check a Stripe code');

            // Stripe charged the subtotal JForm priced less the code: not a mismatch, a discount
            JFormPaymentService.GatewayUpdate paid = gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference);
            paid.amount = 4000;
            paid.subtotal = 4500;
            paid.discount = 500;
            paid.code = 'SPRING10';
            Assert.areEqual(JFormPaymentService.PAID, apply(paid));
            Form_Payment__c p = paymentOf(s.checkoutReference);
            Assert.areEqual(4000, p.Amount__c);
            Assert.isNull(p.Amount_Expected__c);
            Assert.areEqual(40.00, p.Form_Submission__r.Payment_Amount__c, 'the response shows what was charged');
            Assert.areEqual(40.00, Decimal.valueOf([SELECT Field_Value__c FROM Submission_Field_Value__c WHERE Form_Submission__c = :s.submissionId AND Field_Key__c = 'pay'].Field_Value__c), 'and so does the Payment block\'s answer');
            Form_Payment__c codes = [SELECT Code__c, Discount_Amount__c, Promotion_Code__c FROM Form_Payment__c WHERE Checkout_Reference__c = :s.checkoutReference];
            Assert.areEqual('SPRING10', codes.Code__c);
            Assert.areEqual(500, codes.Discount_Amount__c);
            Assert.isNull(codes.Promotion_Code__c, 'not one of JForm\'s');
            JFormResponsesController.Row row = JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, 'spring').rows[0];
            Assert.areEqual('SPRING10', row.promotionCode);
            Assert.areEqual(5.00, row.discountAmount);
            Assert.areEqual(40.00, row.paymentAmount);

            // a discount off another subtotal than JForm priced is a mismatch as before: paid with what was charged, the priced amount kept
            JFormPaymentService.Started odd = pay(r.publicKey, g, 'cs_test_gwcode0000002');
            JFormPaymentService.GatewayUpdate off = gatewayUpdate(JFormPaymentService.KIND_PAID, odd.checkoutReference);
            off.amount = 4000;
            off.subtotal = 4400;
            off.discount = 400;
            off.code = 'OTHER';
            Assert.areEqual(JFormPaymentService.PAID, apply(off));
            Form_Payment__c mismatch = paymentOf(odd.checkoutReference);
            Assert.areEqual(4000, mismatch.Amount__c);
            Assert.areEqual(4500, mismatch.Amount_Expected__c);
            Assert.isNull([SELECT Code__c FROM Form_Payment__c WHERE Checkout_Reference__c = :odd.checkoutReference].Code__c);

            // a Stripe code worth the whole total: paid with nothing charged
            JFormPaymentService.Started whole = pay(r.publicKey, g, 'cs_test_gwcode0000003');
            JFormPaymentService.GatewayUpdate zero = gatewayUpdate(JFormPaymentService.KIND_PAID, whole.checkoutReference);
            zero.amount = 0;
            zero.subtotal = 4500;
            zero.discount = 4500;
            zero.code = 'ALLFREE';
            zero.paymentReference = null;
            Assert.areEqual(JFormPaymentService.PAID, apply(zero));
            Form_Payment__c nothing = paymentOf(whole.checkoutReference);
            Assert.areEqual(0, nothing.Amount__c);
            Assert.areEqual(0, nothing.Form_Submission__r.Payment_Amount__c);
            Assert.areEqual(JFormPaymentService.PAID, nothing.Form_Submission__r.Payment_Status__c);
        }
    }

    @IsTest
    static void codesNeedAPricedBlockAndTheFormsCurrency() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'codes' => 'gateway' });
            Assert.isTrue(JFormPaymentService.publishProblems(def).isEmpty());
            def.sections[1].fields[def.sections[1].fields.size() - 1].config = new Map<String, Object>{ 'pricing' => 'custom', 'minimum' => 5 };
            Assert.areEqual(new List<String>{ 'Promotion codes can\'t be used with "pay what you want" pricing. Turn them off in Settings › Payments, or price the Payment block.' },
                JFormPaymentService.publishProblems(def));
            def.settings.put('payments', new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd' });
            Assert.isTrue(JFormPaymentService.publishProblems(def).isEmpty(), 'no codes, no problem');

            // a JForm code in another currency than the form's stops the publish; the clone of a form on JForm codes starts without them
            JFormDefinition.Form created = JFormDefinitionService.create(paymentForm(new Map<String, Object>{ 'mode' => 'test', 'currency' => 'eur', 'codes' => 'jform' }));
            code(created.id, 'EURO5', JFormPromotionCodeService.AMOUNT, 5, null);
            Assert.isTrue(JFormPaymentService.publishProblems(created).isEmpty());
            created.settings.put('payments', new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'codes' => 'jform' });
            List<String> problems = JFormPaymentService.publishProblems(created);
            Assert.areEqual(1, problems.size(), String.join(problems, ' / '));
            Assert.isTrue(problems[0].startsWith('The promotion code EURO5 takes EUR off, but the form charges in USD.'), problems[0]);
            JFormDefinition.Form copy = JFormDefinitionService.clone(created.id, 'Workshop copy');
            Assert.isNull(((Map<String, Object>) copy.settings.get('payments')).get('codes'), 'the copy has no codes behind the setting');
            Assert.isTrue(JFormPromotionCodeService.listCodes(copy.id).isEmpty());
            // the setting as the REST API or MCP may have stored it counts as JForm codes too
            JFormDefinition.Form loose = JFormDefinitionService.clone(JFormDefinitionService.create(paymentForm(new Map<String, Object>{ 'codes' => ' JForm ' })).id, 'Loose copy');
            Assert.isNull(((Map<String, Object>) loose.settings.get('payments')).get('codes'), '" JForm " is JForm codes, so the copy drops it');
            JFormDefinition.Form gw = JFormDefinitionService.clone(JFormDefinitionService.create(paymentForm(new Map<String, Object>{ 'codes' => 'gateway' })).id, 'Gateway copy');
            Assert.areEqual('gateway', ((Map<String, Object>) gw.settings.get('payments')).get('codes'), 'gateway codes need no records, so they survive a clone');
        }
    }

    @IsTest
    static void aPaymentRunsTheRecordStepsOnce() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test' });
            FakeGateway g = useGateway();
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_paid000000001');

            Test.startTest();
            Assert.areEqual(JFormPaymentService.PAID, apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference)));
            Assert.areEqual(new List<Id>{ s.submissionId }, JFormPaymentService.queuedSteps);
            Test.stopTest();

            Form_Payment__c p = paymentOf(s.checkoutReference);
            Assert.areEqual(JFormPaymentService.PAID, p.Status__c);
            Assert.isNotNull(p.Paid_At__c);
            Assert.areEqual(PI + '0001', p.Payment_Reference__c);
            Assert.areEqual('card', p.Payment_Method__c);
            Assert.areEqual('https://dashboard.stripe.com/test/payments/' + PI + '0001', p.Provider_Url__c);
            Assert.areEqual(JFormPaymentService.PAID, p.Form_Submission__r.Payment_Status__c);
            Assert.areEqual('Processed', p.Form_Submission__r.Status__c, 'the held-back record steps ran');
            Assert.areEqual('paid', JFormPublicController.getPaymentStatus(r.publicKey, s.checkoutReference, true));

            // the webhook, the return page and the hourly check may all report it
            Assert.areEqual('already Paid', apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference)));
            Assert.areEqual('already Paid', apply(gatewayUpdate(JFormPaymentService.KIND_EXPIRED, s.checkoutReference)));
            Assert.areEqual(1, JFormPaymentService.queuedSteps.size());
        }
    }

    @IsTest
    static void testPaymentsCanSkipTheRecordSteps() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_skip000000001');
            Test.startTest();
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference));
            Test.stopTest();
            Assert.isTrue(JFormPaymentService.queuedSteps.isEmpty());
            Form_Payment__c p = paymentOf(s.checkoutReference);
            Assert.areEqual(JFormPaymentService.PAID, p.Form_Submission__r.Payment_Status__c);
            Assert.areEqual('New', p.Form_Submission__r.Status__c);

            // nor does a reprocess, from the Responses tab, the REST API, MCP or the agent, create records from it
            try {
                JFormSubmissionService.reprocess(s.submissionId);
                Assert.fail('a test payment the form keeps out of the steps');
            } catch (JFormSubmissionService.SubmissionException e) {
                Assert.areEqual('This response was paid with a test payment, and the form keeps test payments out of its record steps (Settings > Payments).', e.getMessage());
            }
            Assert.areEqual('New', paymentOf(s.checkoutReference).Form_Submission__r.Status__c);
        }
    }

    @IsTest
    static void onlyAMatchingPaymentMovesAResponseForward() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test' });
            FakeGateway g = useGateway();
            JFormPaymentService.Started debit = pay(r.publicKey, g, 'cs_test_debit00000001');
            JFormPaymentService.Started late = pay(r.publicKey, g, 'cs_test_late000000001');
            JFormPaymentService.Started odd = pay(r.publicKey, g, 'cs_test_odd0000000001');

            // a bank debit is processing until the money arrives, or does not
            Assert.areEqual(JFormPaymentService.KIND_PROCESSING, apply(gatewayUpdate(JFormPaymentService.KIND_PROCESSING, debit.checkoutReference)));
            Assert.areEqual('processing', JFormPublicController.getPaymentStatus(r.publicKey, debit.checkoutReference, false));
            Assert.areEqual('still processing', apply(gatewayUpdate(JFormPaymentService.KIND_PROCESSING, debit.checkoutReference)));
            Assert.areEqual(JFormPaymentService.FAILED, apply(gatewayUpdate(JFormPaymentService.KIND_FAILED, debit.checkoutReference)));
            Assert.areEqual('failed', JFormPublicController.getPaymentStatus(r.publicKey, debit.checkoutReference, false));
            Assert.areEqual(JFormPaymentService.FAILED, paymentOf(debit.checkoutReference).Form_Submission__r.Payment_Status__c);
            try {
                JFormSubmissionService.reprocess(debit.submissionId);
                Assert.fail('an unpaid response never runs its record steps');
            } catch (JFormSubmissionService.SubmissionException e) {
                Assert.areEqual('This response was not paid for (Failed), so its record steps do not run.', e.getMessage());
            }

            Assert.areEqual('still open', apply(gatewayUpdate(JFormPaymentService.KIND_OPEN, late.checkoutReference)));
            try {
                JFormSubmissionService.reprocess(late.submissionId);
                Assert.fail('a response waiting for its payment does not run its record steps');
            } catch (JFormSubmissionService.SubmissionException e) {
                Assert.isTrue(e.getMessage().startsWith('This response is waiting for its payment.'), e.getMessage());
            }
            Assert.areEqual(JFormPaymentService.EXPIRED, apply(gatewayUpdate(JFormPaymentService.KIND_EXPIRED, late.checkoutReference)));
            Assert.areEqual('expired', JFormPublicController.getPaymentStatus(r.publicKey, late.checkoutReference, false));

            // a paid checkout the gateway reports without an amount is not trusted, and a live update never moves a test payment
            JFormPaymentService.GatewayUpdate noAmount = gatewayUpdate(JFormPaymentService.KIND_PAID, odd.checkoutReference);
            noAmount.amount = null;
            Assert.areEqual('amount missing', apply(noAmount));
            JFormPaymentService.GatewayUpdate live = gatewayUpdate(JFormPaymentService.KIND_PAID, odd.checkoutReference);
            live.mode = JFormPaymentService.LIVE;
            Assert.areEqual('mode does not match', apply(live));
            Assert.areEqual(JFormPaymentService.AWAITING, paymentOf(odd.checkoutReference).Status__c);
            Assert.areEqual('unknown checkout', apply(gatewayUpdate(JFormPaymentService.KIND_PAID, 'cs_test_elsewhere0001')));

            JFormPaymentService.GatewayUpdate ignored = new JFormPaymentService.GatewayUpdate();
            ignored.kind = JFormPaymentService.KIND_IGNORED;
            Assert.isTrue(JFormPaymentService.apply(new List<JFormPaymentService.GatewayUpdate>{ ignored, null }).isEmpty());
            Assert.isTrue(JFormPaymentService.queuedSteps.isEmpty());

            // the gateway charged another amount, in another currency (its price localisation is off, so it should not):
            // the respondent has paid, so the payment counts with what was charged, keeps what the form priced, and
            // the response shows the amount charged and runs its record steps
            JFormPaymentService.GatewayUpdate charged = gatewayUpdate(JFormPaymentService.KIND_PAID, odd.checkoutReference);
            charged.amount = 5000;
            charged.currencyCode = 'EUR';
            Assert.areEqual(JFormPaymentService.PAID, apply(charged));
            Form_Payment__c oddPaid = paymentOf(odd.checkoutReference);
            Assert.areEqual(5000, oddPaid.Amount__c);
            Assert.areEqual('EUR', oddPaid.Currency__c);
            Assert.areEqual(4500, oddPaid.Amount_Expected__c);
            Assert.areEqual('USD', oddPaid.Currency_Expected__c);
            Assert.areEqual(50.00, oddPaid.Form_Submission__r.Payment_Amount__c);
            Assert.areEqual(JFormPaymentService.PAID, oddPaid.Form_Submission__r.Payment_Status__c);
            Assert.areEqual(new List<Id>{ odd.submissionId }, JFormPaymentService.queuedSteps);
            JFormResponsesController.ResultPage listed = JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(1, listed.rows.size(), 'the paid one; the failed and expired ones stay out');
            for (JFormResponsesController.Row row : listed.rows) {
                if (row.id == odd.submissionId) {
                    Assert.areEqual(50.00, row.paymentAmount);
                    Assert.areEqual('EUR', row.paymentCurrency);
                    Assert.areEqual(45.00, row.paymentExpected);
                    Assert.areEqual('USD', row.paymentExpectedCurrency);
                } else {
                    Assert.isNull(row.paymentExpected, 'charged as priced: ' + row.id);
                }
            }
        }
    }

    @IsTest
    static void refundsMadeInStripeAreRecorded() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_refund0000001');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference));
            String paymentRef = paymentOf(s.checkoutReference).Payment_Reference__c;

            Assert.areEqual(JFormPaymentService.PARTIALLY_REFUNDED, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded'), refundOf('re_2', 3000, 'Pending')
            })));
            Form_Payment__c p = paymentOf(s.checkoutReference);
            Assert.areEqual(JFormPaymentService.PARTIALLY_REFUNDED, p.Status__c);
            Assert.areEqual(1500, p.Amount_Refunded__c);
            Assert.areEqual(JFormPaymentService.PARTIALLY_REFUNDED, p.Form_Submission__r.Payment_Status__c);
            List<Form_Payment__c> rows = [
                SELECT Refund_Reference__c, Status__c, Amount__c, Currency__c, Mode__c, Refunded_Payment__r.Checkout_Reference__c, Form_Submission__c
                FROM Form_Payment__c WHERE Type__c = 'Refund' ORDER BY Refund_Reference__c
            ];
            Assert.areEqual(2, rows.size());
            Assert.areEqual('Succeeded', rows[0].Status__c);
            Assert.areEqual(1500, rows[0].Amount__c);
            Assert.areEqual(s.checkoutReference, rows[0].Refunded_Payment__r.Checkout_Reference__c);
            Assert.areEqual(s.submissionId, rows[0].Form_Submission__c);
            Assert.areEqual(JFormPaymentService.TEST, rows[0].Mode__c);
            Assert.areEqual('Pending', rows[1].Status__c);

            // the pending refund goes through: the rows are updated, not added again
            Assert.areEqual(JFormPaymentService.REFUNDED, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded'), refundOf('re_2', 3000, 'Succeeded')
            })));
            Assert.areEqual(2, [SELECT COUNT() FROM Form_Payment__c WHERE Type__c = 'Refund']);
            Assert.areEqual(4500, paymentOf(s.checkoutReference).Amount_Refunded__c);
            Assert.areEqual(JFormPaymentService.REFUNDED, paymentOf(s.checkoutReference).Form_Submission__r.Payment_Status__c);
            Assert.areEqual('paid', JFormPublicController.getPaymentStatus(r.publicKey, s.checkoutReference, false), 'a refunded response was paid for');

            Assert.areEqual('unknown payment', apply(refund('pi_someoneElse0001', new List<JFormPaymentService.Refund>())));
            JFormPaymentService.GatewayUpdate live = refund(paymentRef, new List<JFormPaymentService.Refund>());
            live.mode = JFormPaymentService.LIVE;
            Assert.areEqual('mode does not match', apply(live));
        }
    }

    @IsTest
    static void anOlderRefundListCannotUndoANewerOne() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_refund0000002');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference));
            String paymentRef = paymentOf(s.checkoutReference).Payment_Reference__c;

            // the second refund's event is applied first
            Assert.areEqual(JFormPaymentService.REFUNDED, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded'), refundOf('re_2', 3000, 'Succeeded')
            })));
            // then the first refund's, with a list read before the second refund existed or went through
            Assert.areEqual(JFormPaymentService.REFUNDED, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded')
            })));
            Assert.areEqual(JFormPaymentService.REFUNDED, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded'), refundOf('re_2', 3000, 'Pending')
            })));
            Form_Payment__c p = paymentOf(s.checkoutReference);
            Assert.areEqual(4500, p.Amount_Refunded__c);
            Assert.areEqual(JFormPaymentService.REFUNDED, p.Form_Submission__r.Payment_Status__c);
            Assert.areEqual('Succeeded', [SELECT Status__c FROM Form_Payment__c WHERE Refund_Reference__c = 're_2'].Status__c);
        }
    }

    @IsTest
    static void aRefundThatFailsStopsCounting() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_refund0000003');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference));
            String paymentRef = paymentOf(s.checkoutReference).Payment_Reference__c;
            apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded'), refundOf('re_2', 3000, 'Succeeded')
            }));

            // Stripe reports the second refund failed, so the money is back with the merchant
            Assert.areEqual(JFormPaymentService.PARTIALLY_REFUNDED, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded'), refundOf('re_2', 3000, 'Failed')
            })));
            Form_Payment__c p = paymentOf(s.checkoutReference);
            Assert.areEqual(1500, p.Amount_Refunded__c);
            Assert.areEqual(JFormPaymentService.PARTIALLY_REFUNDED, p.Form_Submission__r.Payment_Status__c);
            // a failed refund stays failed, even if an older list still shows it succeeded
            Assert.areEqual(JFormPaymentService.PARTIALLY_REFUNDED, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Succeeded'), refundOf('re_2', 3000, 'Succeeded')
            })));
            Assert.areEqual(JFormPaymentService.PAID, apply(refund(paymentRef, new List<JFormPaymentService.Refund>{
                refundOf('re_1', 1500, 'Failed')
            })));
            Assert.areEqual(0, paymentOf(s.checkoutReference).Amount_Refunded__c);
        }
    }

    static JFormPaymentService.GatewayUpdate refund(String paymentReference, List<JFormPaymentService.Refund> refunds) {
        JFormPaymentService.GatewayUpdate u = new JFormPaymentService.GatewayUpdate();
        u.kind = JFormPaymentService.KIND_REFUNDED;
        u.mode = JFormPaymentService.TEST;
        u.paymentReference = paymentReference;
        u.currencyCode = 'USD';
        u.refunds = refunds;
        return u;
    }

    static JFormPaymentService.Refund refundOf(String reference, Integer amount, String status) {
        JFormPaymentService.Refund r = new JFormPaymentService.Refund();
        r.reference = reference;
        r.amount = amount;
        r.currencyCode = 'USD';
        r.status = status;
        return r;
    }

    @IsTest
    static void theResponsesTabLeavesOutUnpaidResponses() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started paid = pay(r.publicKey, g, 'cs_test_resp_paid0001');
            pay(r.publicKey, g, 'cs_test_resp_open0001');
            JFormPaymentService.Started gone = pay(r.publicKey, g, 'cs_test_resp_gone0001');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, paid.checkoutReference));
            apply(gatewayUpdate(JFormPaymentService.KIND_EXPIRED, gone.checkoutReference));
            // a live payment, partly refunded, on another response
            Map<String, Object> other = (Map<String, Object>) JSON.deserializeUntyped(answers('Summer'));
            other.put('first_name', 'Bea');
            Id live = JFormPublicController.submit(r.publicKey, JSON.serialize(other));
            update new Form_Submission__c(Id = live, Payment_Status__c = JFormPaymentService.PARTIALLY_REFUNDED);
            insert new Form_Payment__c(Form_Submission__c = live, Form__c = r.formId, Type__c = 'Payment', Mode__c = JFormPaymentService.LIVE,
                Status__c = JFormPaymentService.PARTIALLY_REFUNDED, Amount__c = 4500, Amount_Refunded__c = 500, Currency__c = 'EUR', Provider__c = 'Stripe');

            JFormResponsesController.Summary s = JFormResponsesController.getSummary(r.formId);
            Assert.isTrue(s.payments);
            Assert.areEqual(2, s.paid);
            Assert.areEqual(2, s.unpaid);
            Assert.areEqual(2, s.total, 'unpaid responses are not counted as responses');
            Assert.areEqual(1, s.collected.size(), 'test payments move no money');
            Assert.areEqual('EUR', s.collected[0].currencyCode);
            Assert.areEqual(40.00, s.collected[0].amount);

            JFormResponsesController.ResultPage all = JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(2, all.total);
            Assert.areEqual(2, JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, 'paid', null).total, 'paid, refunded later or not');
            Assert.areEqual(2, JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, 'unpaid', null).total);
            Assert.areEqual(3, JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, 'test', null).total);
            for (JFormResponsesController.Row row : all.rows) {
                if (row.id == paid.submissionId) {
                    Assert.areEqual(JFormPaymentService.PAID, row.paymentStatus);
                    Assert.areEqual(45, row.paymentAmount);
                    Assert.areEqual('USD', row.paymentCurrency);
                    Assert.areEqual(JFormPaymentService.TEST, row.paymentMode);
                    Assert.isTrue(row.paymentUrl.startsWith('https://dashboard.stripe.com/test/payments/'), row.paymentUrl);
                }
            }
            String csv = JFormResponsesController.exportCsv(r.formId, false, null, null);
            Assert.isTrue(csv.contains('Payment Status,Payment Amount'), csv.substringBefore('\n'));
            Assert.areEqual(3, csv.split('\n').size(), 'header and the two paid responses: the export holds what the table shows');
            Assert.areEqual(3, JFormResponsesController.exportCsv(r.formId, false, 'unpaid', null).split('\n').size(), 'header and the two unpaid ones');
        }
    }

    @IsTest
    static void aLiveFormInASandboxShowsThePaymentsItTook() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            FakeGateway g = useGateway();
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'live', 'testSteps' => false });
            // the sandbox takes a test payment on the live form, whatever the form says
            JFormPaymentService.sandbox = true;
            JFormPaymentService.Started paid = pay(r.publicKey, g, 'cs_test_sand_paid0001');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, paid.checkoutReference));
            Assert.areEqual(JFormPaymentService.TEST, paymentOf(paid.checkoutReference).Mode__c);

            // and a live payment taken in production, on another response
            Map<String, Object> other = (Map<String, Object>) JSON.deserializeUntyped(answers('Summer'));
            other.put('first_name', 'Bea');
            Id live = JFormPublicController.submit(r.publicKey, JSON.serialize(other));
            update new Form_Submission__c(Id = live, Payment_Status__c = JFormPaymentService.PAID);
            insert new Form_Payment__c(Form_Submission__c = live, Form__c = r.formId, Type__c = 'Payment', Mode__c = JFormPaymentService.LIVE,
                Status__c = JFormPaymentService.PAID, Amount__c = 4500, Amount_Refunded__c = 0, Currency__c = 'USD', Provider__c = 'Stripe');

            JFormResponsesController.Summary s = JFormResponsesController.getSummary(r.formId);
            Assert.areEqual(2, s.paid);
            Assert.areEqual(2, s.total);
            Assert.areEqual(2, s.last7Days);
            Assert.areEqual(new Map<String, Integer>{ 'autumn' => 1, 'Summer' => 1 }, seasons(s), 'the charts count both');
            JFormResponsesController.ResultPage all = JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(2, all.total, 'the table shows the payment the sandbox took, as the tiles count it');
            Assert.areEqual(3, JFormResponsesController.exportCsv(r.formId, false, null, null).split('\n').size(), 'header and the two paid responses');
            Assert.areEqual(2, restSubmissions(r.formId).size());

            // in production the same version keeps its test payments to the Test filter: the tiles and the charts
            // count what the table shows
            JFormPaymentService.sandbox = false;
            s = JFormResponsesController.getSummary(r.formId);
            Assert.areEqual(1, s.paid);
            Assert.areEqual(0, s.unpaid);
            Assert.areEqual(1, s.total);
            Assert.areEqual(1, s.last7Days);
            Assert.areEqual(new Map<String, Integer>{ 'Summer' => 1 }, seasons(s), 'the charts leave the test payment out');
            Assert.areEqual(1, s.collected.size());
            Assert.areEqual(45.00, s.collected[0].amount);
            all = JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, null, null);
            Assert.areEqual(1, all.total);
            Assert.areEqual(JFormPaymentService.LIVE, all.rows[0].paymentMode);
            Assert.areEqual(1, JFormResponsesController.getSubmissions(r.formId, 25, 0, 3, null, null, null, null, null, null, 'test', null).total);
            Assert.areEqual(2, JFormResponsesController.exportCsv(r.formId, false, null, null).split('\n').size(), 'header and the live response');
            Assert.areEqual(1, restSubmissions(r.formId).size());
        }
    }

    /** The season chart's counts. */
    static Map<String, Integer> seasons(JFormResponsesController.Summary s) {
        Map<String, Integer> counts = new Map<String, Integer>();
        for (JFormResponsesController.ChoiceSummary cs : s.choices) {
            if (cs.fieldKey != 'season') {
                continue;
            }
            for (JFormResponsesController.ChoiceCount cc : cs.counts) {
                counts.put(cc.value, cc.count);
            }
        }
        return counts;
    }

    @IsTest
    static void theStepsJobLeavesAResponseTheBuilderReprocessedFirst() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            // a Lead form: the record steps create a Lead
            JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'mode' => 'test' });
            def.targetObjectApiName = 'Lead';
            for (String key : new List<String>{ 'last_name', 'company' }) {
                JFormDefinition.Field f = new JFormDefinition.Field();
                f.key = key;
                f.fieldType = 'text';
                f.label = key;
                f.targetFieldApiName = key == 'last_name' ? 'LastName' : 'Company';
                def.sections[0].fields.add(f);
            }
            JFormPublishService.PublishResult r = JFormPublishService.publish(JFormDefinitionService.create(def).id, null);
            FakeGateway g = useGateway();
            Map<String, Object> order = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
            order.putAll(new Map<String, Object>{ 'first_name' => 'Dee', 'last_name' => 'Deacon', 'email' => 'dee@example.com', 'company' => 'Deacon Ltd' });
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_reprocessed01', JSON.serialize(order));

            Test.startTest();
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference));
            Assert.areEqual(new List<Id>{ s.submissionId }, JFormPaymentService.queuedSteps);
            // the builder clicks Reprocess before the queued job runs: the records exist
            JFormSubmissionService.reprocess(s.submissionId);
            Assert.areEqual('Processed', withPayAnswer(s.submissionId).Status__c);
            Test.stopTest();

            Form_Submission__c sub = withPayAnswer(s.submissionId);
            Assert.areEqual('Processed', sub.Status__c, 'the job leaves the processed response alone');
            Assert.isNull(sub.Error_Message__c);
            Assert.areEqual(1, [SELECT COUNT() FROM Lead WHERE Id = :sub.Target_Record_Id__c]);
            Assert.areEqual(1, [SELECT COUNT() FROM Lead WHERE LastName = 'Deacon'], 'and runs the steps once');
        }
    }

    @IsTest
    static void aSecondOrderWithTheSameAnswersIsNotADuplicate() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started first = pay(r.publicKey, g, 'cs_test_dup_0001');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, first.checkoutReference));

            // the same answers again, minutes after paying: another order, charged on its own
            JFormPaymentService.Started again = pay(r.publicKey, g, 'cs_test_dup_0002');
            Assert.isNotNull(again.checkoutUrl, 'a second checkout opens');
            Assert.areEqual(2, g.created);
            Form_Submission__c second = [SELECT Status__c, Payment_Status__c, Spam_Reason__c FROM Form_Submission__c WHERE Id = :again.submissionId];
            Assert.areNotEqual('Spam', second.Status__c);
            Assert.areEqual(JFormPaymentService.AWAITING, second.Payment_Status__c);
            Assert.isNull(second.Spam_Reason__c);

            // a response that owes nothing is a duplicate of the one before it, as on any form
            JFormPublicController.submit(r.publicKey, answers('Summer'));
            JFormPaymentService.Started freeAgain = pay(r.publicKey, g, 'cs_test_dup_0003', answers('Summer'));
            Assert.isNull(freeAgain.checkoutUrl);
            Form_Submission__c dup = [SELECT Status__c, Spam_Reason__c FROM Form_Submission__c WHERE Id = :freeAgain.submissionId];
            Assert.areEqual('Spam', dup.Status__c);
            Assert.isTrue(dup.Spam_Reason__c.contains('same answers'), dup.Spam_Reason__c);
            Assert.areEqual(2, g.created, 'no checkout for a response that owes nothing');
        }
    }

    @IsTest
    static void aPaymentBlockFlaggedRequiredStillTakesPayments() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            // the builder never offers the flag, but a definition saved through the API can carry it, with a require rule on top;
            // the block's answer is the total the server writes, so neither may hold the Pay click
            JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            JFormDefinition.Field block = def.sections[1].fields[def.sections[1].fields.size() - 1];
            block.required = true;
            block.conditionalLogic = JFormTestDataFactory.rule('require', 'all', 'first_name', 'equals', 'Ann');
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            FakeGateway g = useGateway();

            JFormPaymentService.Started started = pay(r.publicKey, g, 'cs_test_req_0001');
            Assert.isNotNull(started.checkoutUrl, 'the Pay click opens a checkout');
            Assert.areEqual(45, paymentOf(started.checkoutReference).Form_Submission__r.Payment_Amount__c, 'the block\'s answer is the total');
            // nothing to pay for another season: stored like any other response
            JFormPaymentService.Started free = pay(r.publicKey, g, 'cs_test_req_0002', answers('Summer'));
            Assert.isNull(free.checkoutUrl);
            Assert.isNotNull(free.submissionId);
        }
    }

    @IsTest
    static void cancellingEndsTheCheckout() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started left = pay(r.publicKey, g, 'cs_test_left000000001');
            String leftOwnReference = g.lastRequest.reference;
            JFormPaymentService.Started paidMeanwhile = pay(r.publicKey, g, 'cs_test_meanwhile0001');
            JFormPaymentService.Started stuck = pay(r.publicKey, g, 'cs_test_stuck00000001');

            // an embedded form comes back from Stripe's page with no storage: the cancel link's own reference ends the checkout
            Assert.areEqual('expired', JFormPublicController.cancelPayment(r.publicKey, leftOwnReference));
            Assert.areEqual(new List<String>{ left.checkoutReference }, g.expired, 'ended at Stripe by its checkout ID');
            Assert.areEqual(JFormPaymentService.EXPIRED, paymentOf(left.checkoutReference).Form_Submission__r.Payment_Status__c);
            Assert.areEqual('expired', JFormPublicController.cancelPayment(r.publicKey, left.checkoutReference), 'once only');
            Assert.areEqual(1, g.expired.size());

            // Stripe will not end a checkout that was paid in the meantime: the payment is applied instead
            g.expireFails = true;
            g.current = gatewayUpdate(JFormPaymentService.KIND_PAID, paidMeanwhile.checkoutReference);
            Assert.areEqual('paid', JFormPublicController.cancelPayment(r.publicKey, paidMeanwhile.checkoutReference));
            g.current = null;
            Assert.areEqual('open', JFormPublicController.cancelPayment(r.publicKey, stuck.checkoutReference), 'unchanged when Stripe cannot be reached');
            Assert.areEqual('open', JFormPublicController.getPaymentStatus(r.publicKey, stuck.checkoutReference, true));
            Assert.areEqual('unknown', JFormPublicController.cancelPayment('OTHERKEY', stuck.checkoutReference));
        }
    }

    @IsTest
    static void anOpenCheckoutHoldsItsPlaceAgainstTheResponseLimit() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            def.settings.put('access', new Map<String, Object>{ 'responseLimit' => 1, 'closedMessage' => 'All spaces are taken.' });
            JFormPublishService.PublishResult r = JFormPublishService.publish(JFormDefinitionService.create(def).id, null);
            FakeGateway g = useGateway();

            // the first respondent is paying: the form is full while the checkout stays open
            JFormPaymentService.Started first = pay(r.publicKey, g, 'cs_test_limit_first01');
            Assert.areEqual('All spaces are taken.', refusal(r.publicKey, g, 'cs_test_limit_second1'));
            Assert.areEqual(1, g.created, 'the refused click opened no checkout');
            Assert.areEqual(1, JFormResponsesController.getSummary(r.formId).unpaid, 'the Unpaid tile counts the open checkout');

            // the checkout expires: its place is free again, until someone pays
            Assert.areEqual('expired', JFormPublicController.cancelPayment(r.publicKey, first.checkoutReference));
            JFormPaymentService.Started second = pay(r.publicKey, g, 'cs_test_limit_second1');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, second.checkoutReference));
            Assert.areEqual('All spaces are taken.', refusal(r.publicKey, g, 'cs_test_limit_third01'));
            Assert.areEqual(2, g.created);
            JFormResponsesController.Summary s = JFormResponsesController.getSummary(r.formId);
            Assert.areEqual(1, s.paid);
            Assert.areEqual(1, s.unpaid, 'the expired checkout');
        }
    }

    /** The closed message a Pay click gets, or null when the checkout opens. */
    static String refusal(String publicKey, FakeGateway g, String reference) {
        try {
            pay(publicKey, g, reference);
            return null;
        } catch (AuraHandledException e) {
            return e.getMessage();
        }
    }

    @IsTest
    static void theOtherSubmitPathsCannotSkipThePayment() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test' });
            FakeGateway g = useGateway();
            try {
                JFormPublicController.submit(r.publicKey, answers('autumn'));
                Assert.fail('a response that owes money arrives only through the Pay button');
            } catch (AuraHandledException e) {
                Assert.areEqual(JFormPublicController.PAY_FIRST, auraMessage(e));
            }

            // nothing owed: stored like any other response, with no checkout
            Id free = JFormPublicController.submit(r.publicKey, answers('Summer'));
            // another respondent: the same answers again would be a duplicate, and a blank payment status still counts
            Map<String, Object> other = (Map<String, Object>) JSON.deserializeUntyped(answers('Summer'));
            other.put('first_name', 'Bea');
            JFormPaymentService.Started s = JFormPublicController.submitWithPayment(r.publicKey, JSON.serialize(other), null, SITE + '/workshop');
            Assert.isNull(s.checkoutUrl);
            Assert.areEqual(0, g.created);
            Assert.isNull([SELECT Payment_Status__c FROM Form_Submission__c WHERE Id = :free].Payment_Status__c);
            Assert.areEqual('Processed', [SELECT Status__c FROM Form_Submission__c WHERE Id = :s.submissionId].Status__c);

            // a bot that fills the honeypot is stored as spam and sent to no checkout
            Map<String, Object> bot = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
            bot.put(JFormPublicController.HONEYPOT_KEY, 'http://spam.example');
            JFormPaymentService.Started spam = JFormPublicController.submitWithPayment(r.publicKey, JSON.serialize(bot), null, SITE + '/workshop');
            Assert.isNull(spam.checkoutUrl);
            Assert.areEqual('Spam', [SELECT Status__c FROM Form_Submission__c WHERE Id = :spam.submissionId].Status__c);
            Assert.areEqual(0, g.created);

            // another respondent, so the answers are not a duplicate of the bot's
            Map<String, Object> cy = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
            cy.put('first_name', 'Cy');
            for (String elsewhere : new List<String>{ 'https://evil.example.com/workshop', 'http://jform.example.my.site.com/forms', 'not a url', null }) {
                try {
                    JFormPublicController.submitWithPayment(r.publicKey, JSON.serialize(cy), null, elsewhere);
                    Assert.fail(elsewhere + ' is not a return address');
                } catch (AuraHandledException e) {
                    Assert.areEqual('This form can take payments only on its Salesforce site.', auraMessage(e));
                }
            }
            Assert.areEqual(0, g.created);
        }
    }

    @IsTest
    static void aFormTakesPaymentsOnEveryDomainOfItsSite() {
        // the site answers on its *.my.site.com domain and a custom one: the Pay click works from both
        JFormPaymentService.siteHosts = new Set<String>{ 'jform.example.my.site.com', 'forms.example.com' };
        Assert.areEqual('https://forms.example.com/workshop?lang=fr', JFormPaymentService.returnAddress('https://forms.example.com/workshop?lang=fr&jfpay=cancel#top'));
        Assert.areEqual(SITE + '/workshop', JFormPaymentService.returnAddress(SITE + '/workshop'));
        try {
            JFormPaymentService.returnAddress('https://forms.example.org/workshop');
            Assert.fail('another host is not a return address');
        } catch (JFormPaymentService.PaymentException e) {
            Assert.areEqual('This form can take payments only on its Salesforce site.', e.getMessage());
        }
    }

    @IsTest
    static void theStoredAmountIsTheServersWhateverTheBrowserSent() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            // a Lead form whose Payment block is mapped to a Lead field, as a form built before the Automate tab may be
            JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'mode' => 'test' });
            def.targetObjectApiName = 'Lead';
            for (String key : new List<String>{ 'last_name', 'company' }) {
                JFormDefinition.Field f = new JFormDefinition.Field();
                f.key = key;
                f.fieldType = 'text';
                f.label = key;
                f.targetFieldApiName = key == 'last_name' ? 'LastName' : 'Company';
                def.sections[0].fields.add(f);
            }
            List<JFormDefinition.Field> survey = def.sections[1].fields;
            survey[survey.size() - 1].targetFieldApiName = 'AnnualRevenue';
            JFormPublishService.PublishResult r = JFormPublishService.publish(JFormDefinitionService.create(def).id, null);
            FakeGateway g = useGateway();

            // a response that owes nothing, sent with a made-up amount, through both submit paths
            // (three different people, so the org's Lead duplicate rule lets each Lead in)
            Map<String, Object> faked = (Map<String, Object>) JSON.deserializeUntyped(answers('Summer'));
            faked.putAll(new Map<String, Object>{ 'first_name' => 'Ash', 'last_name' => 'Ashby', 'email' => 'ash@example.com', 'company' => 'Ashby Ltd', 'pay' => 999 });
            Id free = JFormPublicController.submit(r.publicKey, JSON.serialize(faked));
            faked.putAll(new Map<String, Object>{ 'first_name' => 'Bea', 'last_name' => 'Beacon', 'email' => 'bea@example.com', 'company' => 'Beacon Ltd' });
            Id viaPay = JFormPublicController.submitWithPayment(r.publicKey, JSON.serialize(faked), null, SITE + '/workshop').submissionId;
            Assert.areEqual(0, g.created);
            for (Id subId : new List<Id>{ free, viaPay }) {
                Form_Submission__c sub = withPayAnswer(subId);
                Assert.areEqual('Processed', sub.Status__c, 'error: ' + sub.Error_Message__c);
                Assert.isNull(sub.Payment_Amount__c);
                Assert.isNull(payAnswer(sub), 'a response that owes nothing stores no amount');
                Assert.isNull([SELECT AnnualRevenue FROM Lead WHERE Id = :sub.Target_Record_Id__c].AnnualRevenue, 'and its record step writes none');
            }

            // a paid response stores the total the server priced
            Map<String, Object> paid = (Map<String, Object>) JSON.deserializeUntyped(answers('autumn'));
            paid.putAll(new Map<String, Object>{ 'first_name' => 'Cy', 'last_name' => 'Cyan', 'email' => 'cy@example.com', 'company' => 'Cyan Ltd', 'pay' => 999 });
            JFormPaymentService.Started s = pay(r.publicKey, g, 'cs_test_priced0000001', JSON.serialize(paid));
            Test.startTest();
            Assert.areEqual(JFormPaymentService.PAID, apply(gatewayUpdate(JFormPaymentService.KIND_PAID, s.checkoutReference)));
            Test.stopTest();
            Form_Submission__c held = withPayAnswer(s.submissionId);
            Assert.areEqual('Processed', held.Status__c, 'error: ' + held.Error_Message__c);
            Assert.areEqual(45, held.Payment_Amount__c);
            Assert.areEqual(45, Decimal.valueOf(payAnswer(held)).intValue());
            Assert.areEqual(45, [SELECT AnnualRevenue FROM Lead WHERE Id = :held.Target_Record_Id__c].AnnualRevenue);
        }
    }

    static Form_Submission__c withPayAnswer(Id submissionId) {
        return [
            SELECT Status__c, Error_Message__c, Payment_Amount__c, Target_Record_Id__c,
                (SELECT Field_Value__c FROM Submission_Field_Values__r WHERE Field_Key__c = 'pay')
            FROM Form_Submission__c WHERE Id = :submissionId
        ];
    }

    static String payAnswer(Form_Submission__c sub) {
        return sub.Submission_Field_Values__r.isEmpty() ? null : sub.Submission_Field_Values__r[0].Field_Value__c;
    }

    @IsTest
    static void liveFormsPublishInEveryOrg() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            useGateway();
            JFormDefinition.Form def = JFormDefinitionService.create(paymentForm(new Map<String, Object>{ 'mode' => 'live', 'currency' => 'EUR', 'openIn' => 'page' }));

            // a sandbox takes test payments from a form set to live
            JFormPaymentService.sandbox = true;
            JFormPublishService.PublishResult inSandbox = JFormPublishService.publish(def.id, null);
            Map<String, Object> sandboxView = (Map<String, Object>) JSON.deserializeUntyped(JFormPublicController.getPublishedDefinition(inSandbox.publicKey));
            Assert.areEqual('test', ((Map<String, Object>) sandboxView.get('payments')).get('mode'));
            JFormPaymentService.sandbox = false;

            // production publishes it live: no license key or paid edition is needed
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            Map<String, Object> view = (Map<String, Object>) JSON.deserializeUntyped(JFormPublicController.getPublishedDefinition(r.publicKey));
            Assert.areEqual(new Map<String, Object>{ 'gateway' => 'stripe', 'mode' => 'live', 'currency' => 'EUR', 'openIn' => 'page', 'codes' => 'none', 'unavailable' => null }, view.get('payments'));

            // a sandbox or scratch org takes test payments only, whatever the form says
            JFormDefinition.Form published = JFormDefinitionService.load(def.id);
            JFormPaymentService.sandbox = true;
            Assert.areEqual('test', JFormPaymentService.publicView(published).get('mode'));
            JFormPaymentService.sandbox = false;
            Assert.areEqual('live', JFormPaymentService.publicView(published).get('mode'));
            Assert.isNull(JFormPaymentService.unavailableReason(published));
        }
    }

    @IsTest
    static void aFormHasOneUsablePaymentBlock() {
        JFormDefinition.Form def = paymentForm(new Map<String, Object>{ 'currency' => 'KWD' });
        JFormDefinition.Field second = new JFormDefinition.Field();
        second.key = 'pay2';
        second.fieldType = 'payment';
        second.config = new Map<String, Object>{ 'pricing' => 'barter' };
        def.sections[0].fields.add(second);
        Assert.areEqual(new List<String>{
            'The Payment block has an unknown pricing option "barter".', 'A form can have one Payment block.',
            'This form\'s currency (KWD) cannot take payments. Use one of: ' + String.join(JFormPaymentPricing.SUPPORTED, ', ') + '.'
        }, JFormPaymentService.definitionProblems(def));
        Assert.isTrue(JFormPaymentService.definitionProblems(JFormTestDataFactory.sampleDefinition('Plain')).isEmpty());
        Assert.isNull(JFormPaymentService.publicView(JFormTestDataFactory.sampleDefinition('Plain')));

        JFormPaymentService.FormSettings s = JFormPaymentService.settingsOf(JFormTestDataFactory.sampleDefinition('Plain'));
        Assert.areEqual(JFormPaymentService.STRIPE, s.gateway);
        Assert.areEqual(JFormPaymentService.TEST, s.mode);
        Assert.areEqual('USD', s.currencyCode);
        Assert.areEqual('popup', s.openIn);
        Assert.isTrue(s.testSteps);
    }

    @IsTest
    static void aFormTakesPaymentsThroughAGatewayJFormSupports() {
        JFormDefinition.Form stripe = paymentForm(new Map<String, Object>{ 'gateway' => ' Stripe ' });
        Assert.areEqual(JFormPaymentService.STRIPE, JFormPaymentService.settingsOf(stripe).gateway);
        Assert.isTrue(JFormPaymentService.definitionProblems(stripe).isEmpty());
        Assert.areEqual(JFormPaymentService.STRIPE, JFormPaymentService.publicView(stripe).get('gateway'));
        Assert.areEqual('Stripe', JFormPaymentService.providerFor(JFormPaymentService.STRIPE).name());
        Assert.areEqual('Stripe', JFormPaymentService.providerOf('Stripe').name(), 'a payment finds its gateway by the name it carries');
        try {
            JFormPaymentService.providerOf('PayPal');
            Assert.fail('no provider for a gateway JForm does not have');
        } catch (JFormPaymentService.PaymentException e) {
            Assert.areEqual('JForm has no payment gateway named "PayPal".', e.getMessage());
        }

        JFormDefinition.Form paypal = paymentForm(new Map<String, Object>{ 'gateway' => 'PayPal' });
        Assert.areEqual(new List<String>{ 'JForm doesn\'t support the payment gateway "paypal". Use one of: stripe.' }, JFormPaymentService.definitionProblems(paypal));
        Assert.areEqual(JFormPaymentService.NOT_TAKING, JFormPaymentService.unavailableReason(paypal));
        Assert.areEqual('paypal', JFormPaymentService.publicView(paypal).get('gateway'));
        try {
            JFormPaymentService.providerFor('paypal');
            Assert.fail('no provider for a gateway JForm does not support');
        } catch (JFormPaymentService.PaymentException e) {
            Assert.areEqual(JFormPaymentService.NOT_TAKING, e.getMessage());
        }
    }

    @IsTest
    static void theHourlyCheckCatchesMissedWebhooks() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started old = pay(r.publicKey, g, 'cs_test_hourly0000001');
            pay(r.publicKey, g, 'cs_test_fresh00000001');
            pay(r.publicKey, g, 'cs_test_open000000001');
            openedMinutesAgo(old.checkoutReference, 90);
            // still open at the gateway for a while: the gateway expires it itself, and tells us
            openedMinutesAgo('cs_test_open000000001', 65);
            g.current = gatewayUpdate(JFormPaymentService.KIND_PAID, old.checkoutReference);

            Test.startTest();
            // the scheduled class finds its work by name and queues it
            new JFormPaymentCheckJob().execute(null);
            Test.stopTest();

            Assert.areEqual(new List<String>{ old.checkoutReference }, g.fetched, 'only the checkout the gateway has had time to expire is read');
            Form_Payment__c paid = paymentOf(old.checkoutReference);
            Assert.areEqual(JFormPaymentService.PAID, paid.Status__c);
            Assert.isNotNull(paid.Last_Checked_At__c, 'the check records when it read the checkout');
            Assert.areEqual(JFormPaymentService.AWAITING, paymentOf('cs_test_fresh00000001').Status__c, 'a checkout opened minutes ago is left to the respondent');
            Assert.isNull(paymentOf('cs_test_fresh00000001').Last_Checked_At__c);
            Assert.areEqual(JFormPaymentService.AWAITING, paymentOf('cs_test_open000000001').Status__c);
            g.current = null;
            Assert.areEqual(0, JFormPaymentService.checkOpenCheckouts(), 'nothing old enough is left open');
        }
    }

    @IsTest
    static void theHourlyCheckReadsNeverReadCheckoutsFirstThenTheLeastRecentlyRead() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            pay(r.publicKey, g, 'cs_test_readlast00001');
            pay(r.publicKey, g, 'cs_test_readfirst0001');
            pay(r.publicKey, g, 'cs_test_readmid000001');
            // the oldest checkout was read an hour ago, the others never; the gateway keeps all three open
            openedMinutesAgo('cs_test_readlast00001', 300);
            openedMinutesAgo('cs_test_readfirst0001', 200);
            openedMinutesAgo('cs_test_readmid000001', 100);
            update new Form_Payment__c(Id = paymentOf('cs_test_readlast00001').Id, Last_Checked_At__c = System.now().addMinutes(-60));
            g.current = gatewayUpdate(JFormPaymentService.KIND_OPEN, 'cs_test_readfirst0001');

            // the field keeps whole seconds
            Datetime before = System.now().addSeconds(-1);
            Assert.areEqual(3, JFormPaymentService.checkOpenCheckouts());
            Assert.areEqual(new List<String>{ 'cs_test_readfirst0001', 'cs_test_readmid000001', 'cs_test_readlast00001' }, g.fetched);
            for (String reference : g.fetched) {
                Assert.isTrue(paymentOf(reference).Last_Checked_At__c >= before, reference + ' is marked as read now');
                Assert.areEqual(JFormPaymentService.AWAITING, paymentOf(reference).Status__c);
            }
        }
    }

    @IsTest
    static void theHourlyCheckStopsAtItsTimeBudgetAndMarksWhatItRead() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            pay(r.publicKey, g, 'cs_test_budget1000001');
            pay(r.publicKey, g, 'cs_test_budget2000001');
            openedMinutesAgo('cs_test_budget1000001', 200);
            openedMinutesAgo('cs_test_budget2000001', 100);
            // the gateway cannot be reached: a read that fails still counts as a turn, so the next run moves on
            g.current = null;
            JFormPaymentService.checkBudgetMs = 0;

            Assert.areEqual(0, JFormPaymentService.checkOpenCheckouts(), 'nothing applied when the gateway cannot be reached');
            Assert.areEqual(new List<String>{ 'cs_test_budget1000001' }, g.fetched, 'the first read always happens; the budget stops the second');
            Assert.isNotNull(paymentOf('cs_test_budget1000001').Last_Checked_At__c);
            Assert.isNull(paymentOf('cs_test_budget2000001').Last_Checked_At__c);

            g.fetched.clear();
            JFormPaymentService.checkOpenCheckouts();
            Assert.areEqual(new List<String>{ 'cs_test_budget2000001' }, g.fetched, 'the next run starts with the checkout it has not read');
        }
    }

    @IsTest
    static void theHourlyCheckSavesWhatItCanWhenTheOrgRefusesARow() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started refused = pay(r.publicKey, g, 'cs_test_refused000001');
            JFormPaymentService.Started paid = pay(r.publicKey, g, 'cs_test_savedpaid0001');
            JFormPaymentService.Started gone = pay(r.publicKey, g, 'cs_test_savedgone0001');
            for (String reference : new List<String>{ refused.checkoutReference, paid.checkoutReference, gone.checkoutReference }) {
                openedMinutesAgo(reference, 90);
            }
            // a paid update the org refuses: here a reference too long for its field, in an org more likely a rule on the response
            JFormPaymentService.GatewayUpdate bad = gatewayUpdate(JFormPaymentService.KIND_PAID, refused.checkoutReference);
            bad.paymentReference = 'pi_' + 'x'.repeat(300);
            g.byReference.put(refused.checkoutReference, bad);
            g.byReference.put(paid.checkoutReference, gatewayUpdate(JFormPaymentService.KIND_PAID, paid.checkoutReference));
            g.byReference.put(gone.checkoutReference, gatewayUpdate(JFormPaymentService.KIND_EXPIRED, gone.checkoutReference));

            Assert.areEqual(3, JFormPaymentService.checkOpenCheckouts());
            Assert.areEqual(JFormPaymentService.PAID, paymentOf(paid.checkoutReference).Status__c, 'the other rows are saved');
            Assert.areEqual(JFormPaymentService.EXPIRED, paymentOf(gone.checkoutReference).Status__c);
            Form_Payment__c left = paymentOf(refused.checkoutReference);
            Assert.areEqual(JFormPaymentService.AWAITING, left.Status__c, 'the refused row is left for a later run');
            Assert.isNotNull(left.Last_Checked_At__c, 'and its read is recorded, so the run moves on');
            Assert.areEqual(JFormPaymentService.PAID, left.Form_Submission__r.Payment_Status__c, 'its response was saved first');

            // the org takes the row next time: the payment catches up with its response
            g.byReference.put(refused.checkoutReference, gatewayUpdate(JFormPaymentService.KIND_PAID, refused.checkoutReference));
            Assert.areEqual(1, JFormPaymentService.checkOpenCheckouts(), 'only the refused checkout was still awaiting');
            Assert.areEqual(JFormPaymentService.PAID, paymentOf(refused.checkoutReference).Status__c);
        }
    }

    @IsTest
    static void theHourlyCheckRecordsItsReadsWhenApplyingFailsAsAWhole() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult r = publish(new Map<String, Object>{ 'mode' => 'test', 'testSteps' => false });
            FakeGateway g = useGateway();
            JFormPaymentService.Started paid = pay(r.publicKey, g, 'cs_test_wholepaid0001');
            apply(gatewayUpdate(JFormPaymentService.KIND_PAID, paid.checkoutReference));
            JFormPaymentService.Started open = pay(r.publicKey, g, 'cs_test_wholeopen0001');
            openedMinutesAgo(open.checkoutReference, 90);
            // an answer that fails outside any one row (here a refund list the org refuses as a whole, standing in for a lock)
            JFormPaymentService.Refund badRefund = refundOf('re_whole', 500, 'Succeeded');
            badRefund.currencyCode = 'TOOLONG';
            g.byReference.put(open.checkoutReference, refund(PI + paid.checkoutReference.right(4), new List<JFormPaymentService.Refund>{ badRefund }));

            Assert.areEqual(1, JFormPaymentService.checkOpenCheckouts());
            Form_Payment__c still = paymentOf(open.checkoutReference);
            Assert.areEqual(JFormPaymentService.AWAITING, still.Status__c);
            Assert.isNotNull(still.Last_Checked_At__c, 'the read is recorded, so the next run moves on');
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Payment__c WHERE Type__c = 'Refund'], 'nothing of the failed apply stays');
            Assert.areEqual(JFormPaymentService.PAID, paymentOf(paid.checkoutReference).Status__c);
        }
    }

    @IsTest
    static void whetherAFormTakesLivePaymentsIsReadWithoutItsDefinition() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPaymentService.sandbox = false;
            JFormDefinition.Form live = JFormDefinitionService.create(paymentForm(new Map<String, Object>{ 'mode' => 'live', 'currency' => 'USD' }));
            JFormDefinition.Form testOnly = JFormDefinitionService.create(paymentForm(new Map<String, Object>{ 'mode' => 'test' }));
            JFormDefinition.Form plain = JFormTestDataFactory.sampleDefinition('Plain');
            plain.targetObjectApiName = null;
            plain = JFormDefinitionService.create(plain);

            Assert.isTrue(JFormPaymentService.takesLivePayments(live.id));
            Assert.isTrue(JFormPaymentService.takesLivePayments(live), 'the same answer from the definition');
            Assert.isFalse(JFormPaymentService.takesLivePayments(testOnly.id));
            Assert.isFalse(JFormPaymentService.takesLivePayments(plain.id), 'no Payment block');
            Assert.isFalse(JFormPaymentService.takesLivePayments(Id.valueOf(Form__c.SObjectType.getDescribe().getKeyPrefix() + '000000000001')), 'no such form');
            JFormPaymentService.sandbox = true;
            Assert.isFalse(JFormPaymentService.takesLivePayments(live.id), 'a sandbox takes test payments whatever the form says');
            Assert.isFalse(JFormPaymentService.takesLivePayments(live));
            JFormPaymentService.sandbox = false;
        }
    }

    @IsTest
    static void setupSavesKeysAndSecretsWithoutShowingThem() {
        FakeStore store = new FakeStore();
        JFormPaymentService.credentialStore = store;
        JFormPaymentService.providerOverride = new FakeGateway();
        JFormPaymentService.sandbox = false;

        JFormSetupController.savePaymentKey('test', '  sk_test_51AbCdEfGhIjKlMnOp  ');
        Assert.areEqual('sk_test_51AbCdEfGhIjKlMnOp', store.keys.get(JFormPaymentService.TEST));
        JFormSetupController.savePaymentKey('live', 'rk_live_51AbCdEfGhIjKlMnOp');
        Assert.isTrue(store.hasKey(JFormPaymentService.LIVE));
        for (List<String> bad : new List<List<String>>{
            new List<String>{ 'test', 'sk_live_51AbCdEfGhIjKlMnOp', 'That is a live key.' },
            new List<String>{ 'live', 'sk_test_51AbCdEfGhIjKlMnOp', 'That is a test key.' },
            new List<String>{ 'test', 'pk_test_51AbCdEfGhIjKlMnOp', 'Paste the secret key' }
        }) {
            try {
                JFormSetupController.savePaymentKey(bad[0], bad[1]);
                Assert.fail(bad[1] + ' is refused');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().startsWith(bad[2]), e.getMessage());
            }
        }
        JFormSetupController.savePaymentKey('live', '');
        Assert.isFalse(store.hasKey(JFormPaymentService.LIVE), 'blank removes the key');

        JFormSetupController.savePaymentWebhookSecret('test', 'whsec_AbCdEf0123456789');
        Assert.areEqual('whsec_AbCdEf0123456789', JFormPaymentService.webhookSecret(JFormPaymentService.TEST));
        Assert.isNull(JFormPaymentService.webhookSecret(JFormPaymentService.LIVE));
        Assert.isTrue(JFormPaymentService.checkScheduled(), 'saving a signing secret starts the hourly check');
        try {
            JFormSetupController.savePaymentWebhookSecret('test', 'sk_test_51AbCdEfGhIjKlMnOp');
            Assert.fail('not a signing secret');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().startsWith('Paste the endpoint\'s signing secret'), e.getMessage());
        }

        JFormSetupController.PaymentSetup setup = JFormSetupController.getPaymentSetup();
        Assert.isTrue(setup.canManageKeys);
        Assert.isTrue(setup.testKeys.keySet);
        Assert.isTrue(setup.testKeys.secretSet);
        Assert.isFalse(setup.liveKeys.keySet);
        Assert.isFalse(setup.liveKeys.secretSet);
        Assert.isTrue(setup.checkScheduled);
        Assert.areEqual(7, setup.events.size());
        Assert.isFalse(JSON.serialize(setup).contains('sk_test_'), 'keys are never sent back');
        Assert.isFalse(JSON.serialize(setup).contains('whsec_'), 'nor signing secrets');

        JFormPaymentService.ConnectionCheck c = JFormSetupController.checkPaymentConnection('test');
        Assert.isTrue(c.keyWorks);
        Assert.isTrue(c.secretSet);
        Assert.areEqual(JFormPaymentService.webhookUrl(JFormPaymentService.TEST), c.webhookUrl);

        JFormSetupController.savePaymentWebhookSecret('test', '');
        Assert.isNull(JFormPaymentService.webhookSecret(JFormPaymentService.TEST), 'blank removes the secret');

        JFormPaymentService.sandbox = true;
        try {
            JFormSetupController.savePaymentKey('live', 'sk_live_51AbCdEfGhIjKlMnOp');
            Assert.fail('a sandbox takes test payments only');
        } catch (AuraHandledException e) {
            Assert.areEqual('This org is a sandbox or scratch org, so it takes test payments only.', e.getMessage());
        }
    }

    @IsTest
    static void buildersWithoutCustomizeApplicationCannotChangeKeys() {
        JFormPaymentService.credentialStore = new FakeStore();
        System.runAs(JFormTestDataFactory.builderUser()) {
            try {
                JFormSetupController.savePaymentKey('test', 'sk_test_51AbCdEfGhIjKlMnOp');
                Assert.fail('admins only');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('Customize Application'), e.getMessage());
            }
            JFormSetupController.PaymentSetup setup = JFormSetupController.getPaymentSetup();
            Assert.isFalse(setup.canManageKeys);
            Assert.isNull(setup.testKeys);

            JFormPaymentService.sandbox = true;
            Map<String, Boolean> status = JFormWorkspaceController.getPaymentStatus();
            Assert.areEqual(false, status.get('testConnected'));
            Assert.areEqual(false, status.get('liveConnected'));
            Assert.areEqual(true, status.get('sandbox'));
        }
    }

    @IsTest
    static void theWebhookAddressFollowsTheSite() {
        String url = JFormPaymentService.webhookUrl(JFormPaymentService.LIVE);
        Assert.isTrue(url == null || url.endsWith('/services/apexrest/' + (String.isBlank(JFormNamespace.NAME) ? '' : JFormNamespace.NAME + '/') + 'payments/stripe/live'), 'webhook url: ' + url);

        // the address is on the site chosen on the Setup tab, else the first live Experience site; sites are org
        // configuration, so a scratch org may have none
        JFormPaymentService.WebhookSite first = JFormPaymentService.webhookSite();
        Assert.areEqual(first == null, url == null);
        JFormSetupController.PaymentSetup setup = JFormSetupController.getPaymentSetup();
        Assert.areEqual(first == null ? null : first.siteId, setup.webhookSiteId);
        if (first != null) {
            Assert.isTrue(url.startsWith(first.baseUrl + '/'), url);
            Boolean listed = false;
            for (JFormSetupController.SiteRow s : setup.sites) {
                listed = listed || s.id == first.siteId;
            }
            Assert.isTrue(listed, 'the site in use is one the tab lists');
            JFormSetupController.savePaymentWebhookSite(first.siteId);
            Assert.areEqual(String.valueOf(first.siteId), Payment_Settings__c.getOrgDefaults().Webhook_Site__c);
            Assert.areEqual(first.siteId, JFormPaymentService.webhookSite().siteId);
            Assert.areEqual(url, JFormPaymentService.webhookUrl(JFormPaymentService.LIVE));
        }
        // a site that is gone, or none chosen, goes back to the first
        JFormPaymentService.saveWebhookSite(Id.valueOf('0DM000000000001'));
        Assert.areEqual(first == null ? null : first.siteId, JFormPaymentService.webhookSite()?.siteId);
        Assert.areEqual(url, JFormPaymentService.webhookUrl(JFormPaymentService.LIVE));
        try {
            JFormSetupController.savePaymentWebhookSite(Id.valueOf('0DM000000000001'));
            Assert.fail('only a listed site');
        } catch (AuraHandledException e) {
            Assert.areEqual('Pick one of the org\'s Experience sites.', e.getMessage());
        }
        JFormSetupController.savePaymentWebhookSite(null);
        Assert.isNull(Payment_Settings__c.getOrgDefaults().Webhook_Site__c);
        Assert.areEqual('https://dashboard.stripe.com/payments/pi_1', JFormStripeProvider.dashboardUrl(JFormPaymentService.LIVE, 'pi_1'));
        Assert.isTrue(JFormStripeProvider.isCheckoutReference('cs_live_a1B2c3D4e5F6g7H8'));
        Assert.areEqual('Stripe', JFormPaymentService.providerFor(JFormPaymentService.STRIPE).name());
        Assert.isNotNull(JFormPaymentService.isSandbox());
    }
}
