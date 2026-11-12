@IsTest
private class JFormPaymentWebhookTest {

    private static final String SECRET = 'whsec_testSigningSecret0123';
    private static final String CS = 'cs_test_webhook0000000001';

    /** Opens checkouts in the setup; in the tests, reports whatever update a test gives it. */
    private class FakeGateway implements JFormPaymentProvider {
        JFormPaymentService.GatewayUpdate reported;
        String problem;

        public String name() {
            return 'Stripe';
        }
        public JFormPaymentService.Checkout createCheckout(JFormPaymentService.CheckoutRequest r) {
            JFormPaymentService.Checkout c = new JFormPaymentService.Checkout();
            c.reference = CS;
            c.url = 'https://checkout.stripe.com/c/pay/' + CS;
            return c;
        }
        public JFormPaymentService.GatewayUpdate fetchCheckout(String mode, String checkoutReference) {
            return reported;
        }
        public void expireCheckout(String mode, String checkoutReference) {
        }
        public JFormPaymentService.GatewayUpdate readWebhook(String mode, Map<String, String> headers, Blob body) {
            if (problem != null) {
                throw new JFormPaymentService.PaymentException(problem);
            }
            return reported;
        }
        public List<JFormPaymentService.Refund> listRefunds(String mode, String paymentReference) {
            return new List<JFormPaymentService.Refund>();
        }
        public JFormPaymentService.ConnectionCheck checkConnection(String mode, String webhookUrl) {
            return new JFormPaymentService.ConnectionCheck();
        }
    }

    /** Stripe's copy of the checkout, paid. */
    private class PaidSession implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            Assert.isTrue(req.getEndpoint().startsWith('callout:' + JFormNamespace.qualify('JForm_Stripe_Test') + '/v1/checkout/sessions/' + CS), req.getEndpoint());
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody(JSON.serialize(new Map<String, Object>{
                'id' => CS, 'livemode' => false, 'status' => 'complete', 'payment_status' => 'paid', 'amount_total' => 4500, 'currency' => 'usd',
                'payment_intent' => new Map<String, Object>{ 'id' => 'pi_3PqRsTuVwXyZ0123', 'status' => 'succeeded' }
            }));
            return res;
        }
    }

    @TestSetup
    static void awaitingPayment() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            // committed here, so the tests reach Stripe before any DML of their own
            insert new Payment_Settings__c(SetupOwnerId = UserInfo.getOrganizationId(), Test_Webhook_Secret__c = SECRET);
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Webhook');
            def.targetObjectApiName = null;
            JFormDefinition.Field block = new JFormDefinition.Field();
            block.key = 'pay';
            block.fieldType = 'payment';
            block.label = 'Payment';
            block.config = new Map<String, Object>{ 'pricing' => 'fixed', 'amount' => 45 };
            def.sections[1].fields.add(block);
            def = JFormDefinitionService.create(def);
            JFormPublishService.PublishResult r = JFormPublishService.publish(def.id, null);
            JFormPaymentService.providerOverride = new FakeGateway();
            JFormPaymentService.siteHosts = new Set<String>{ 'jform.example.my.site.com' };
            JFormPublicController.submitWithPayment(r.publicKey,
                JSON.serialize(new Map<String, Object>{ 'first_name' => 'Ann', 'email' => 'ann@example.com', 'season' => 'autumn' }),
                null, 'https://jform.example.my.site.com/forms/webhook');
        }
    }

    static RestResponse post(String uri, String body, String signature) {
        RestRequest req = new RestRequest();
        req.requestURI = uri;
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(body);
        if (signature != null) {
            req.addHeader('Stripe-Signature', signature);
        }
        RestContext.request = req;
        RestContext.response = new RestResponse();
        JFormPaymentWebhook.receive();
        return RestContext.response;
    }

    static String sign(String body, String secret) {
        Long t = System.now().getTime() / 1000;
        return 't=' + t + ',v1=' + EncodingUtil.convertToHex(Crypto.generateMac('hmacSHA256', Blob.valueOf(t + '.' + body), Blob.valueOf(secret)));
    }

    static String completedEvent() {
        return JSON.serialize(new Map<String, Object>{
            'id' => 'evt_1', 'type' => 'checkout.session.completed', 'livemode' => false,
            'data' => new Map<String, Object>{ 'object' => new Map<String, Object>{ 'id' => CS, 'object' => 'checkout.session' } }
        });
    }

    static Form_Payment__c payment() {
        return [SELECT Status__c, Payment_Reference__c, Form_Submission__r.Payment_Status__c, Form_Submission__r.Status__c FROM Form_Payment__c WHERE Checkout_Reference__c = :CS];
    }

    @IsTest
    static void aSignedStripeEventMarksTheResponsePaid() {
        Test.setMock(HttpCalloutMock.class, new PaidSession());
        String body = completedEvent();
        Test.startTest();
        RestResponse res = post('/services/apexrest/payments/stripe/test', body, sign(body, SECRET));
        Test.stopTest();

        Assert.areEqual(200, res.statusCode, res.responseBody.toString());
        Map<String, Object> reply = (Map<String, Object>) JSON.deserializeUntyped(res.responseBody.toString());
        Assert.areEqual('checkout.session.completed', reply.get('event'));
        Assert.areEqual(new List<Object>{ 'Paid' }, reply.get('outcome'));
        Form_Payment__c p = payment();
        Assert.areEqual(JFormPaymentService.PAID, p.Status__c);
        Assert.areEqual('pi_3PqRsTuVwXyZ0123', p.Payment_Reference__c);
        Assert.areEqual(JFormPaymentService.PAID, p.Form_Submission__r.Payment_Status__c);
        Assert.areEqual('Processed', p.Form_Submission__r.Status__c, 'the record steps ran after the payment');
    }

    @IsTest
    static void anUnsignedOrForgedEventChangesNothing() {
        String body = completedEvent();
        RestResponse forged = post('/services/apexrest/jform/payments/stripe/test/', body, sign(body, 'whsec_guessedSecret01'));
        Assert.areEqual(400, forged.statusCode);
        Assert.isTrue(forged.responseBody.toString().contains('Signature does not match.'), forged.responseBody.toString());
        Assert.areEqual(400, post('/services/apexrest/payments/stripe/test', body, null).statusCode);
        Assert.areEqual(400, post('/services/apexrest/payments/stripe/live', body, sign(body, SECRET)).statusCode, 'the live address has its own secret');
        Assert.areEqual(JFormPaymentService.AWAITING, payment().Status__c);
    }

    @IsTest
    static void otherAddressesAreNotFound() {
        Assert.areEqual(404, post('/services/apexrest/payments/paypal/test', '{}', null).statusCode);
        Assert.areEqual(404, post('/services/apexrest/payments/stripe/prod', '{}', null).statusCode);
        Assert.areEqual(404, post('/services/apexrest/payments', '{}', null).statusCode);
    }

    @IsTest
    static void anEventThatCannotBeAppliedIsRetried() {
        FakeGateway g = new FakeGateway();
        JFormPaymentService.providerOverride = g;
        g.reported = new JFormPaymentService.GatewayUpdate();
        g.reported.kind = JFormPaymentService.KIND_PAID;
        g.reported.mode = JFormPaymentService.TEST;
        g.reported.checkoutReference = CS;
        g.reported.amount = 4500;
        g.reported.currencyCode = 'USD';
        g.reported.providerUrl = 'https://dashboard.stripe.com/test/payments/' + 'x'.repeat(300);
        RestResponse res = post('/services/apexrest/payments/stripe/test', '{}', null);
        Assert.areEqual(500, res.statusCode, 'Stripe tries again later');
        Assert.areEqual(JFormPaymentService.AWAITING, payment().Status__c);

        g.problem = 'Stripe could not read the checkout (500): try again';
        Assert.areEqual(400, post('/services/apexrest/payments/stripe/test', '{}', null).statusCode);
    }

    @IsTest
    static void anEventThatCannotBeReadIsLoggedAndRetried() {
        // a signed event in a shape the provider does not expect (a numeric type) is Stripe's to send again, logged under its ID
        String body = JSON.serialize(new Map<String, Object>{ 'id' => 'evt_odd', 'type' => 5, 'livemode' => false, 'data' => new Map<String, Object>() });
        RestResponse res = post('/services/apexrest/payments/stripe/test', body, sign(body, SECRET));
        Assert.areEqual(500, res.statusCode, res.responseBody.toString());
        Assert.isTrue(res.responseBody.toString().contains('The event could not be read.'), res.responseBody.toString());
        Assert.areEqual(JFormPaymentService.AWAITING, payment().Status__c);

        Assert.areEqual('evt_odd', JFormPaymentWebhook.eventIdOf(Blob.valueOf(body)));
        Assert.areEqual('(no event ID)', JFormPaymentWebhook.eventIdOf(Blob.valueOf('{"type":"checkout.session.completed"}')));
        Assert.areEqual('(no event ID)', JFormPaymentWebhook.eventIdOf(Blob.valueOf('[]')));
        Assert.areEqual('(unreadable body)', JFormPaymentWebhook.eventIdOf(Blob.valueOf('not json')));
        Assert.areEqual('(unreadable body)', JFormPaymentWebhook.eventIdOf(null));
    }
}
