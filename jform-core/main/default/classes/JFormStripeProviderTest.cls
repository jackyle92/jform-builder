@IsTest
private class JFormStripeProviderTest {

    private static final String CS = 'cs_test_a1B2c3D4e5F6g7H8';
    private static final String PI = 'pi_3PqRsTuVwXyZ0123';
    private static final String SECRET = 'whsec_testSigningSecret0123';

    /** Stripe's API by method and path ("GET checkout/sessions/cs_..."); records each request. */
    private class StripeMock implements HttpCalloutMock {
        Map<String, HttpResponse> routes = new Map<String, HttpResponse>();
        /** Answers given once each, in order, before the route's standing answer. */
        Map<String, List<HttpResponse>> once = new Map<String, List<HttpResponse>>();
        List<HttpRequest> requests = new List<HttpRequest>();
        /** Each request's body as sent: a retry changes the same HttpRequest's body. */
        List<String> bodies = new List<String>();
        Boolean unreachable = false;
        /** Salesforce's own refusal, before the request leaves the org. */
        String refusal;

        StripeMock answer(String route, Integer status, Object body) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(status);
            res.setBody(JSON.serialize(body));
            routes.put(route, res);
            return this;
        }

        StripeMock answerOnce(String route, Integer status, Object body) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(status);
            res.setBody(JSON.serialize(body));
            if (!once.containsKey(route)) {
                once.put(route, new List<HttpResponse>());
            }
            once.get(route).add(res);
            return this;
        }

        public HttpResponse respond(HttpRequest req) {
            requests.add(req);
            bodies.add(req.getBody());
            if (unreachable) {
                throw new CalloutException('Read timed out');
            }
            if (refusal != null) {
                throw new CalloutException(refusal);
            }
            String route = req.getMethod() + ' ' + req.getEndpoint().substringAfter('/v1/').substringBefore('?');
            HttpResponse res = once.containsKey(route) && !once.get(route).isEmpty() ? once.get(route).remove(0) : routes.get(route);
            Assert.isNotNull(res, 'unexpected call: ' + route);
            return res;
        }
    }

    static StripeMock mock() {
        StripeMock m = new StripeMock();
        Test.setMock(HttpCalloutMock.class, m);
        return m;
    }

    static Map<String, Object> session(String status, String paymentStatus, Object intent) {
        return new Map<String, Object>{
            'id' => CS, 'object' => 'checkout.session', 'livemode' => false, 'status' => status, 'payment_status' => paymentStatus,
            'amount_total' => 4500, 'currency' => 'usd', 'payment_intent' => intent, 'url' => 'https://checkout.stripe.com/c/pay/' + CS
        };
    }

    static Map<String, Object> intent(String status, String method) {
        return new Map<String, Object>{
            'id' => PI, 'status' => status,
            'latest_charge' => new Map<String, Object>{ 'payment_method_details' => new Map<String, Object>{ 'type' => method } }
        };
    }

    static String sign(String body, Long t, String secret) {
        Blob mac = Crypto.generateMac('hmacSHA256', Blob.valueOf(t + '.' + body), Blob.valueOf(secret));
        return 't=' + t + ',v1=' + EncodingUtil.convertToHex(mac);
    }

    static Long now() {
        return System.now().getTime() / 1000;
    }

    @TestSetup
    static void saveSigningSecret() {
        // saved here, so the webhook tests make their callouts before any DML of their own
        insert new Payment_Settings__c(SetupOwnerId = UserInfo.getOrganizationId(), Test_Webhook_Secret__c = SECRET);
    }

    @IsTest
    static void createsACheckoutFromTheServersPrices() {
        StripeMock m = mock().answer('POST checkout/sessions', 200, session('open', 'unpaid', null));
        JFormPaymentService.CheckoutRequest r = new JFormPaymentService.CheckoutRequest();
        r.mode = JFormPaymentService.TEST;
        r.publicKey = 'KEY123';
        r.reference = 'jf_0123456789abcdef01234567';
        r.description = 'Workshop';
        r.quote = new JFormPaymentPricing.Quote();
        r.quote.currencyCode = 'USD';
        JFormPaymentPricing.Line line = new JFormPaymentPricing.Line();
        line.name = 'Seat';
        line.unitAmount = 1500;
        line.quantity = 3;
        r.quote.lines.add(line);
        r.successUrl = 'https://jform.example.com/s/workshop?jfpay=success&jfcs={CHECKOUT_SESSION_ID}';
        r.cancelUrl = 'https://jform.example.com/s/workshop?jfpay=cancel';
        r.expiresAt = Datetime.newInstance(2026, 10, 26, 12, 0, 0);
        r.customerEmail = 'ann+pay@example.com';

        Test.startTest();
        JFormPaymentService.Checkout c = new JFormStripeProvider().createCheckout(r);
        Test.stopTest();

        Assert.areEqual(CS, c.reference);
        Assert.areEqual('https://checkout.stripe.com/c/pay/' + CS, c.url);
        HttpRequest req = m.requests[0];
        Assert.areEqual('callout:' + JFormNamespace.qualify('JForm_Stripe_Test') + '/v1/checkout/sessions', req.getEndpoint());
        Assert.areEqual('POST', req.getMethod());
        Assert.isNull(req.getHeader('Idempotency-Key'), 'each click opens its own checkout');
        Assert.areEqual(JFormStripeProvider.API_VERSION, req.getHeader('Stripe-Version'));
        String body = EncodingUtil.urlDecode(req.getBody(), 'UTF-8');
        for (String part : new List<String>{
            'mode=payment', 'client_reference_id=jf_0123456789abcdef01234567', 'metadata[jform_form]=KEY123',
            'line_items[0][price_data][currency]=usd', 'line_items[0][price_data][unit_amount]=1500',
            'line_items[0][price_data][product_data][name]=Seat', 'line_items[0][quantity]=3',
            'success_url=https://jform.example.com/s/workshop?jfpay=success&jfcs={CHECKOUT_SESSION_ID}',
            'payment_intent_data[description]=Workshop', 'expires_at=' + (r.expiresAt.getTime() / 1000),
            'adaptive_pricing[enabled]=false', // charged in the form's currency, whatever Stripe's account setting
            'customer_email=ann+pay@example.com' // the form's Email answer, filled in on Stripe's page
        }) {
            Assert.isTrue(body.contains(part), part + ' in ' + body);
        }
        Assert.isTrue(req.getBody().contains('customer_email=ann%2Bpay%40example.com'), 'sent form-encoded: ' + req.getBody());
        Assert.isFalse(body.contains('billing_address_collection'), 'Stripe asks for a billing address only when the card needs one');
    }

    @IsTest
    static void alwaysAsksForABillingAddressWhenSet() {
        StripeMock m = mock().answer('POST checkout/sessions', 200, session('open', 'unpaid', null));
        JFormPaymentService.CheckoutRequest r = request();
        r.askBillingAddress = true;

        Test.startTest();
        new JFormStripeProvider().createCheckout(r);
        Test.stopTest();

        Assert.isTrue(m.bodies[0].contains('billing_address_collection=required'), m.bodies[0]);
    }

    static JFormPaymentService.CheckoutRequest request() {
        JFormPaymentService.CheckoutRequest r = new JFormPaymentService.CheckoutRequest();
        r.mode = JFormPaymentService.TEST;
        r.publicKey = 'KEY123';
        r.reference = 'jf_0123456789abcdef01234567';
        r.description = 'Workshop';
        r.quote = new JFormPaymentPricing.Quote();
        r.quote.currencyCode = 'USD';
        JFormPaymentPricing.Line line = new JFormPaymentPricing.Line();
        line.name = 'Seat';
        line.unitAmount = 4500;
        line.quantity = 1;
        r.quote.lines.add(line);
        r.quote.subtotal = 4500;
        r.quote.amount = 4500;
        r.successUrl = 'https://jform.example.com/s/workshop?jfpay=success&jfcs={CHECKOUT_SESSION_ID}';
        r.cancelUrl = 'https://jform.example.com/s/workshop?jfpay=cancel';
        r.expiresAt = Datetime.newInstance(2026, 10, 26, 12, 0, 0);
        return r;
    }

    @IsTest
    static void aJFormCodeBecomesAOneOffCouponOnTheCheckout() {
        StripeMock m = mock()
            .answer('POST coupons', 200, new Map<String, Object>{ 'id' => 'Z4OV52SU', 'object' => 'coupon', 'amount_off' => 450, 'valid' => true })
            .answer('POST checkout/sessions', 200, session('open', 'unpaid', null));
        JFormPaymentService.CheckoutRequest r = request();
        r.discount = 450;
        r.discountName = 'SAVE10';
        r.quote.amount = 4050;

        Test.startTest();
        JFormPaymentService.Checkout c = new JFormStripeProvider().createCheckout(r);
        Test.stopTest();

        Assert.areEqual(CS, c.reference);
        Assert.areEqual(2, m.requests.size(), 'the coupon, then the checkout');
        Assert.areEqual('callout:' + JFormNamespace.qualify('JForm_Stripe_Test') + '/v1/coupons', m.requests[0].getEndpoint());
        String coupon = EncodingUtil.urlDecode(m.requests[0].getBody(), 'UTF-8');
        for (String part : new List<String>{
            'amount_off=450', 'currency=usd', 'name=SAVE10', 'duration=once', 'max_redemptions=1',
            'metadata[jform_form]=KEY123', 'metadata[jform_reference]=jf_0123456789abcdef01234567'
        }) {
            Assert.isTrue(coupon.contains(part), part + ' in ' + coupon);
        }
        String body = EncodingUtil.urlDecode(m.requests[1].getBody(), 'UTF-8');
        Assert.isTrue(body.contains('discounts[0][coupon]=Z4OV52SU'), body);
        Assert.isTrue(body.contains('line_items[0][price_data][unit_amount]=4500'), 'the lines stay at full price; Stripe takes the coupon off: ' + body);
        Assert.isFalse(body.contains('allow_promotion_codes'), 'Stripe takes a coupon or its own code box, never both');

        // Stripe answered without a coupon id: no checkout is opened
        m.answer('POST coupons', 200, new Map<String, Object>{ 'object' => 'coupon' });
        try {
            new JFormStripeProvider().createCheckout(r);
            Assert.fail();
        } catch (JFormPaymentService.PaymentException e) {
            Assert.areEqual('Stripe returned a discount JForm cannot use.', e.getMessage());
        }
        Assert.areEqual(3, m.requests.size());
    }

    @IsTest
    static void aCouponIsRemovedWhenStripeRefusesTheCheckout() {
        StripeMock m = mock()
            .answer('POST coupons', 200, new Map<String, Object>{ 'id' => 'Z4OV52SU', 'object' => 'coupon' })
            .answer('POST checkout/sessions', 400, new Map<String, Object>{ 'error' => new Map<String, Object>{ 'message' => 'Amount must be at least $0.50 usd' } })
            .answer('DELETE coupons/Z4OV52SU', 200, new Map<String, Object>{ 'id' => 'Z4OV52SU', 'deleted' => true });
        JFormPaymentService.CheckoutRequest r = request();
        r.discount = 4460;
        r.discountName = 'BIG';
        r.quote.amount = 40;

        Test.startTest();
        try {
            new JFormStripeProvider().createCheckout(r);
            Assert.fail();
        } catch (JFormPaymentService.PaymentException e) {
            Assert.isTrue(e.getMessage().contains('Amount must be at least'), 'Stripe\'s refusal is what is reported: ' + e.getMessage());
        }
        Test.stopTest();

        Assert.areEqual(3, m.requests.size(), 'the coupon, the checkout, then removing the coupon');
        Assert.areEqual('DELETE', m.requests[2].getMethod());
        Assert.areEqual('callout:' + JFormNamespace.qualify('JForm_Stripe_Test') + '/v1/coupons/Z4OV52SU', m.requests[2].getEndpoint());

        // a coupon Stripe will not remove leaves the checkout's refusal as the error
        m.answer('DELETE coupons/Z4OV52SU', 404, new Map<String, Object>{ 'error' => new Map<String, Object>{ 'message' => 'No such coupon' } });
        try {
            new JFormStripeProvider().createCheckout(r);
            Assert.fail();
        } catch (JFormPaymentService.PaymentException e) {
            Assert.isTrue(e.getMessage().contains('Amount must be at least'), e.getMessage());
        }
    }

    static Map<String, Object> stripeError(String message, String param) {
        return new Map<String, Object>{ 'error' => new Map<String, Object>{ 'type' => 'invalid_request_error', 'message' => message, 'param' => param } };
    }

    @IsTest
    static void anAddressStripeRefusesLetsItsPageAskInstead() {
        StripeMock m = mock()
            .answerOnce('POST checkout/sessions', 400, stripeError('Invalid email address: ann..x@example.com', 'customer_email'))
            .answer('POST checkout/sessions', 200, session('open', 'unpaid', null));
        JFormPaymentService.CheckoutRequest r = request();
        r.customerEmail = 'ann..x@example.com';

        Test.startTest();
        JFormPaymentService.Checkout c = new JFormStripeProvider().createCheckout(r);
        Test.stopTest();

        Assert.areEqual(CS, c.reference);
        Assert.areEqual(2, m.requests.size(), 'tried once more without the address');
        Assert.isTrue(m.bodies[0].contains('customer_email='), m.bodies[0]);
        String second = m.bodies[1];
        Assert.isFalse(second.contains('customer_email'), second);
        Assert.isTrue(second.contains('mode=payment'), 'otherwise the same checkout: ' + second);
    }

    @IsTest
    static void otherRefusalsAreNotRetried() {
        StripeMock m = mock().answer('POST checkout/sessions', 400, stripeError('Amount must be at least $0.50 usd', 'line_items[0][price_data][unit_amount]'));
        JFormPaymentService.CheckoutRequest r = request();
        r.customerEmail = 'ann@example.com';

        Test.startTest();
        try {
            new JFormStripeProvider().createCheckout(r);
            Assert.fail('Stripe refused the checkout');
        } catch (JFormPaymentService.PaymentException e) {
            Assert.isTrue(e.getMessage().contains('Amount must be at least'), e.getMessage());
            Assert.areEqual('line_items[0][price_data][unit_amount]', e.param);
        }
        Test.stopTest();
        Assert.areEqual(1, m.requests.size());

        // naming the address is not enough: only an invalid request (400) about it is retried without it
        Map<String, Object> limited = stripeError('Too many requests', 'customer_email');
        ((Map<String, Object>) limited.get('error')).put('type', 'rate_limit_error');
        StripeMock busy = mock().answer('POST checkout/sessions', 429, limited);
        try {
            new JFormStripeProvider().createCheckout(r);
            Assert.fail('Stripe refused the checkout');
        } catch (JFormPaymentService.PaymentException e) {
            Assert.areEqual(429, e.statusCode);
            Assert.areEqual('rate_limit_error', e.errorType);
        }
        Assert.areEqual(1, busy.requests.size());
    }

    @IsTest
    static void gatewayCodesOpenStripesOwnCodeBox() {
        StripeMock m = mock().answer('POST checkout/sessions', 200, session('open', 'unpaid', null));
        JFormPaymentService.CheckoutRequest r = request();
        r.allowGatewayCodes = true;

        Test.startTest();
        new JFormStripeProvider().createCheckout(r);
        Test.stopTest();

        Assert.areEqual(1, m.requests.size(), 'no coupon');
        String body = EncodingUtil.urlDecode(m.requests[0].getBody(), 'UTF-8');
        Assert.isTrue(body.contains('allow_promotion_codes=true'), body);
        Assert.isFalse(body.contains('discounts'), body);
        Assert.isFalse(body.contains('customer_email'), 'without an Email answer Stripe\'s page asks for one: ' + body);
    }

    @IsTest
    static void aDiscountIsReadBackWithTheCodesText() {
        Map<String, Object> s = session('complete', 'paid', intent('succeeded', 'card'));
        s.put('amount_subtotal', 4500);
        s.put('amount_total', 4000);
        s.put('total_details', new Map<String, Object>{ 'amount_discount' => 500, 'amount_shipping' => 0, 'amount_tax' => 0 });
        s.put('discounts', new List<Object>{ new Map<String, Object>{
            'coupon' => new Map<String, Object>{ 'id' => 'abc', 'name' => 'Spring sale' },
            'promotion_code' => new Map<String, Object>{ 'id' => 'promo_1', 'code' => 'SPRING10' }
        } });
        JFormPaymentService.GatewayUpdate u = JFormStripeProvider.fromSession(JFormPaymentService.TEST, s, null);
        Assert.areEqual(4000L, u.amount);
        Assert.areEqual(4500L, u.subtotal);
        Assert.areEqual(500L, u.discount);
        Assert.areEqual('SPRING10', u.code, 'a code typed on Stripe\'s page');

        // a coupon JForm made has no promotion code: its name is the code
        s.put('discounts', new List<Object>{ new Map<String, Object>{ 'coupon' => new Map<String, Object>{ 'id' => 'Z4OV52SU', 'name' => 'SAVE10' }, 'promotion_code' => null } });
        Assert.areEqual('SAVE10', JFormStripeProvider.fromSession(JFormPaymentService.TEST, s, null).code);
        // an unexpanded promotion code is an id, not a code: the coupon's name is used
        s.put('discounts', new List<Object>{ new Map<String, Object>{ 'coupon' => new Map<String, Object>{ 'name' => 'Spring sale' }, 'promotion_code' => 'promo_1' } });
        Assert.areEqual('Spring sale', JFormStripeProvider.fromSession(JFormPaymentService.TEST, s, null).code);
        Assert.isNull(JFormStripeProvider.discountCode(new List<Object>()));
        Assert.isNull(JFormStripeProvider.discountCode('promo_1'));
        Assert.isNull(JFormStripeProvider.discountCode(new List<Object>{ 'promo_1' }));
        Assert.isNull(JFormStripeProvider.discountCode(new List<Object>{ new Map<String, Object>{ 'coupon' => 'abc' } }));

        // no discount: nothing read
        JFormPaymentService.GatewayUpdate plain = JFormStripeProvider.fromSession(JFormPaymentService.TEST, session('complete', 'paid', intent('succeeded', 'card')), null);
        Assert.isNull(plain.code);
        Assert.isTrue(plain.discount == null || plain.discount == 0);

        // a code that takes the whole total: paid with nothing charged and no payment intent
        Map<String, Object> free = session('complete', 'no_payment_required', null);
        free.put('amount_subtotal', 4500);
        free.put('amount_total', 0);
        free.put('total_details', new Map<String, Object>{ 'amount_discount' => 4500 });
        JFormPaymentService.GatewayUpdate zero = JFormStripeProvider.fromSession(JFormPaymentService.TEST, free, null);
        Assert.areEqual(JFormPaymentService.KIND_PAID, zero.kind);
        Assert.areEqual(0L, zero.amount);
        Assert.areEqual(4500L, zero.discount);
        Assert.isNull(zero.paymentReference);
    }

    @IsTest
    static void refusesACheckoutFromTheWrongModeOrWithoutAStripeAddress() {
        JFormPaymentService.CheckoutRequest r = new JFormPaymentService.CheckoutRequest();
        r.mode = JFormPaymentService.TEST;
        r.quote = new JFormPaymentPricing.Quote();
        r.quote.currencyCode = 'USD';
        r.expiresAt = System.now();
        Map<String, Object> live = session('open', 'unpaid', null);
        live.put('livemode', true);
        Map<String, Object> elsewhere = session('open', 'unpaid', null);
        elsewhere.put('url', 'https://pay.example.com/' + CS);
        StripeMock m = mock();
        Test.startTest();
        m.answer('POST checkout/sessions', 200, live);
        Assert.areEqual('The Stripe key for Test payments belongs to the other mode.', createError(r));
        m.answer('POST checkout/sessions', 200, elsewhere);
        Assert.areEqual('Stripe returned a checkout JForm cannot use.', createError(r));
        m.answer('POST checkout/sessions', 400, new Map<String, Object>{ 'error' => new Map<String, Object>{ 'message' => 'Invalid currency: xyz' } });
        Assert.areEqual('Stripe could not create the checkout (400): Invalid currency: xyz', createError(r));
        m.unreachable = true;
        Assert.areEqual('Salesforce could not reach Stripe to create the checkout: Read timed out', createError(r));
        m.unreachable = false;
        m.refusal = noAccessMessage('JForm_Stripe_Test');
        Assert.isTrue(createError(r).startsWith('Your user can\'t use the JForm Stripe (test) credential.'), createError(r));
        Test.stopTest();
    }

    static String createError(JFormPaymentService.CheckoutRequest r) {
        try {
            new JFormStripeProvider().createCheckout(r);
        } catch (JFormPaymentService.PaymentException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void readsWhereACheckoutStands() {
        JFormPaymentService.GatewayUpdate paid = JFormStripeProvider.fromSession(JFormPaymentService.TEST, session('complete', 'paid', intent('succeeded', 'card')), null);
        Assert.areEqual(JFormPaymentService.KIND_PAID, paid.kind);
        Assert.areEqual(JFormPaymentService.TEST, paid.mode);
        Assert.areEqual(CS, paid.checkoutReference);
        Assert.areEqual(4500L, paid.amount);
        Assert.areEqual('USD', paid.currencyCode);
        Assert.areEqual(PI, paid.paymentReference);
        Assert.areEqual('card', paid.paymentMethod);
        Assert.areEqual('https://dashboard.stripe.com/test/payments/' + PI, paid.providerUrl);

        // a bank debit: the checkout is complete, the money follows, or does not
        Assert.areEqual(JFormPaymentService.KIND_PROCESSING,
            JFormStripeProvider.fromSession(JFormPaymentService.TEST, session('complete', 'unpaid', intent('processing', 'us_bank_account')), null).kind);
        Assert.areEqual(JFormPaymentService.KIND_FAILED,
            JFormStripeProvider.fromSession(JFormPaymentService.TEST, session('complete', 'unpaid', intent('requires_payment_method', 'sepa_debit')), null).kind);
        Assert.areEqual(JFormPaymentService.KIND_FAILED,
            JFormStripeProvider.fromSession(JFormPaymentService.TEST, session('complete', 'unpaid', PI), 'checkout.session.async_payment_failed').kind);
        Assert.areEqual(JFormPaymentService.KIND_EXPIRED, JFormStripeProvider.fromSession(JFormPaymentService.TEST, session('expired', 'unpaid', null), null).kind);
        Assert.areEqual(JFormPaymentService.KIND_OPEN, JFormStripeProvider.fromSession(JFormPaymentService.TEST, session('open', 'unpaid', null), null).kind);

        Map<String, Object> live = session('complete', 'paid', PI);
        live.put('livemode', true);
        JFormPaymentService.GatewayUpdate u = JFormStripeProvider.fromSession(JFormPaymentService.LIVE, live, null);
        Assert.areEqual(JFormPaymentService.LIVE, u.mode);
        Assert.areEqual('https://dashboard.stripe.com/payments/' + PI, u.providerUrl);
    }

    @IsTest
    static void fetchesAndEndsCheckouts() {
        StripeMock m = mock()
            .answer('GET checkout/sessions/' + CS, 200, session('complete', 'paid', intent('succeeded', 'card')))
            .answer('POST checkout/sessions/' + CS + '/expire', 200, session('expired', 'unpaid', null));
        Test.startTest();
        JFormStripeProvider p = new JFormStripeProvider();
        Assert.areEqual(JFormPaymentService.KIND_PAID, p.fetchCheckout(JFormPaymentService.TEST, CS).kind);
        Assert.isTrue(m.requests[0].getEndpoint().endsWith('?expand%5B%5D=payment_intent.latest_charge&expand%5B%5D=discounts.promotion_code'), m.requests[0].getEndpoint());
        p.expireCheckout(JFormPaymentService.LIVE, CS);
        Assert.areEqual('callout:' + JFormNamespace.qualify('JForm_Stripe_Live') + '/v1/checkout/sessions/' + CS + '/expire', m.requests[1].getEndpoint());
        for (String bad : new List<String>{ null, 'cs_test_x', 'pi_3PqRsTuVwXyZ0123', 'cs_test_abc/../../v1/charges' }) {
            try {
                p.fetchCheckout(JFormPaymentService.TEST, bad);
                Assert.fail(bad + ' is not read');
            } catch (JFormPaymentService.PaymentException e) {
                Assert.areEqual('Not a Stripe checkout reference.', e.getMessage());
            }
        }
        Test.stopTest();
        Assert.areEqual(2, m.requests.size());
    }

    @IsTest
    static void checksTheWebhookSignatureOverTheExactBody() {
        String body = '{"id":"evt_1","type":"checkout.session.completed","note":"Café ✓"}';
        Blob raw = Blob.valueOf(body);
        Long t = now();
        Assert.isNull(JFormStripeProvider.verify(sign(body, t, SECRET), raw, SECRET, t));
        Assert.isNull(JFormStripeProvider.verify('t=' + t + ',v1=deadbeef,' + sign(body, t, SECRET).substringAfter(','), raw, SECRET, t), 'any v1 signature may match');
        Assert.areEqual('Signature does not match.', JFormStripeProvider.verify(sign(body, t, 'whsec_other'), raw, SECRET, t));
        Assert.areEqual('Signature does not match.', JFormStripeProvider.verify(sign(body, t, SECRET), Blob.valueOf(body + ' '), SECRET, t));
        Assert.areEqual('Signature timestamp is too old or in the future.', JFormStripeProvider.verify(sign(body, t - 301, SECRET), raw, SECRET, t));
        Assert.areEqual('Malformed signature header.', JFormStripeProvider.verify('v1=abc', raw, SECRET, t));
        Assert.areEqual('Missing signature or body.', JFormStripeProvider.verify(null, raw, SECRET, t));
        Assert.areEqual('No signing secret is saved for this mode.', JFormStripeProvider.verify(sign(body, t, SECRET), raw, null, t));
    }

    static JFormPaymentService.GatewayUpdate webhook(String mode, Map<String, Object> event, String secret) {
        String body = JSON.serialize(event);
        return new JFormStripeProvider().readWebhook(mode, new Map<String, String>{ 'stripe-signature' => sign(body, now(), secret) }, Blob.valueOf(body));
    }

    static Map<String, Object> event(String type, Map<String, Object> obj) {
        return new Map<String, Object>{ 'id' => 'evt_1', 'type' => type, 'livemode' => false, 'data' => new Map<String, Object>{ 'object' => obj } };
    }

    @IsTest
    static void aCheckoutEventIsReadBackFromStripe() {
        StripeMock m = mock().answer('GET checkout/sessions/' + CS, 200, session('complete', 'paid', intent('succeeded', 'card')));
        Test.startTest();
        JFormPaymentService.GatewayUpdate u = webhook(JFormPaymentService.TEST, event('checkout.session.completed', session('complete', 'unpaid', null)), SECRET);
        Test.stopTest();
        Assert.areEqual(1, m.requests.size(), 'the event says something changed; the checkout read back says what');
        Assert.areEqual(JFormPaymentService.KIND_PAID, u.kind);
        Assert.areEqual('evt_1', u.eventId);
        Assert.areEqual('checkout.session.completed', u.eventType);
    }

    @IsTest
    static void aRefundEventListsThePaymentsRefunds() {
        mock().answer('GET refunds', 200, new Map<String, Object>{ 'data' => new List<Object>{
            new Map<String, Object>{ 'id' => 're_1', 'amount' => 1500, 'currency' => 'usd', 'status' => 'succeeded', 'created' => 1793000000 },
            new Map<String, Object>{ 'id' => 're_2', 'amount' => 500, 'currency' => 'usd', 'status' => 'pending' },
            new Map<String, Object>{ 'id' => 're_3', 'amount' => 700, 'currency' => 'usd', 'status' => 'canceled' }
        } });
        Test.startTest();
        JFormPaymentService.GatewayUpdate u = webhook(JFormPaymentService.TEST,
            event('charge.refunded', new Map<String, Object>{ 'id' => 'ch_1', 'payment_intent' => PI, 'amount_refunded' => 1500, 'currency' => 'usd' }), SECRET);
        // a refund that settles or fails days later arrives as a refund event, read the same way
        List<JFormPaymentService.GatewayUpdate> later = new List<JFormPaymentService.GatewayUpdate>();
        for (String type : new List<String>{ 'refund.updated', 'refund.failed' }) {
            later.add(webhook(JFormPaymentService.TEST,
                event(type, new Map<String, Object>{ 'id' => 're_2', 'object' => 'refund', 'charge' => 'ch_1', 'payment_intent' => PI, 'amount' => 500, 'currency' => 'usd', 'status' => 'succeeded' }), SECRET));
        }
        Test.stopTest();
        Assert.areEqual(JFormPaymentService.KIND_REFUNDED, u.kind);
        Assert.areEqual(PI, u.paymentReference);
        Assert.areEqual(3, u.refunds.size());
        Assert.areEqual('Succeeded', u.refunds[0].status);
        Assert.areEqual(Datetime.newInstance(1793000000000L), u.refunds[0].createdAt);
        Assert.areEqual('Pending', u.refunds[1].status);
        Assert.areEqual('Failed', u.refunds[2].status);
        for (JFormPaymentService.GatewayUpdate l : later) {
            Assert.areEqual(JFormPaymentService.KIND_REFUNDED, l.kind, l.eventType);
            Assert.areEqual(PI, l.paymentReference);
            Assert.areEqual(3, l.refunds.size(), l.eventType + ' lists the payment\'s refunds, not the event\'s one');
        }
        Assert.areEqual(0, new JFormStripeProvider().listRefunds(JFormPaymentService.TEST, 'ch_1').size(), 'only payment intents are looked up');
    }

    @IsTest
    static void otherEventsAreIgnoredAndBadOnesRefused() {
        mock();
        Assert.areEqual(JFormPaymentService.KIND_IGNORED, webhook(JFormPaymentService.TEST, event('customer.created', new Map<String, Object>()), SECRET).kind);
        for (Map<String, Object> c : new List<Map<String, Object>>{
            new Map<String, Object>{ 'mode' => JFormPaymentService.TEST, 'secret' => 'whsec_someoneElse0123', 'message' => 'Signature does not match.' },
            new Map<String, Object>{ 'mode' => JFormPaymentService.LIVE, 'secret' => SECRET, 'message' => 'No signing secret is saved for this mode.' }
        }) {
            try {
                webhook((String) c.get('mode'), event('checkout.session.completed', session('complete', 'paid', null)), (String) c.get('secret'));
                Assert.fail('refused');
            } catch (JFormPaymentService.PaymentException e) {
                Assert.areEqual(c.get('message'), e.getMessage());
            }
        }
        Map<String, Object> live = event('checkout.session.completed', session('complete', 'paid', null));
        live.put('livemode', true);
        try {
            webhook(JFormPaymentService.TEST, live, SECRET);
            Assert.fail('a live event never reaches test payments');
        } catch (JFormPaymentService.PaymentException e) {
            Assert.areEqual('A live event reached the Test webhook address.', e.getMessage());
        }
    }

    @IsTest
    static void checksTheKeyAndTheWebhookEndpoint() {
        String url = 'https://jform.example.my.site.com/vforcesite/services/apexrest/payments/stripe/test';
        StripeMock m = mock();
        Test.startTest();
        JFormStripeProvider p = new JFormStripeProvider();
        m.answer('GET webhook_endpoints', 401, new Map<String, Object>());
        Assert.areEqual('Stripe did not accept the saved secret key.', p.checkConnection(JFormPaymentService.TEST, url).keyProblem);
        m.answer('GET webhook_endpoints', 403, new Map<String, Object>());
        Assert.isTrue(p.checkConnection(JFormPaymentService.TEST, url).keyProblem.startsWith('The saved key is a restricted key'));
        m.answer('GET webhook_endpoints', 500, new Map<String, Object>{ 'error' => new Map<String, Object>{ 'message' => 'Try again' } });
        Assert.areEqual('Stripe answered 500: Try again', p.checkConnection(JFormPaymentService.TEST, url).keyProblem);

        m.answer('GET webhook_endpoints', 200, new Map<String, Object>{ 'data' => new List<Object>{
            new Map<String, Object>{ 'url' => 'https://elsewhere.example.com/hook', 'status' => 'enabled', 'enabled_events' => new List<Object>{ '*' } },
            new Map<String, Object>{ 'url' => url.toUpperCase() + '/', 'status' => 'disabled', 'enabled_events' => new List<Object>{
                'checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded'
            } }
        } });
        JFormPaymentService.ConnectionCheck c = p.checkConnection(JFormPaymentService.TEST, url);
        Assert.isTrue(c.keyWorks);
        Assert.isTrue(c.webhookFound);
        Assert.isFalse(c.webhookEnabled);
        Assert.areEqual(new List<String>{ 'checkout.session.async_payment_failed', 'charge.refunded', 'refund.updated', 'refund.failed' }, c.missingEvents);

        c = p.checkConnection(JFormPaymentService.TEST, 'https://elsewhere.example.com/hook');
        Assert.isTrue(c.webhookFound && c.webhookEnabled);
        Assert.isTrue(c.missingEvents.isEmpty(), 'every event');
        Assert.isFalse(p.checkConnection(JFormPaymentService.TEST, 'https://nowhere.example.com').webhookFound);

        m.unreachable = true;
        Assert.areEqual('Salesforce could not reach Stripe: Read timed out', p.checkConnection(JFormPaymentService.TEST, url).keyProblem);
        m.unreachable = false;
        m.refusal = noAccessMessage('jform__JForm_Stripe_Live');
        Assert.areEqual('Your user can\'t use the JForm Stripe (live) credential. Assign the ACCESS_FORM_BUILDER permission set, '
            + 'or JForm Guest for the site guest user and logged-in respondents.', p.checkConnection(JFormPaymentService.LIVE, url).keyProblem);
        Test.stopTest();
    }

    @IsTest
    static void onlyARefusalNamingTheModesCredentialIsAnAccessProblem() {
        Assert.isNotNull(JFormStripeProvider.noAccess(JFormPaymentService.TEST, new CalloutException(noAccessMessage('JForm_Stripe_Test'))));
        Assert.isNull(JFormStripeProvider.noAccess(JFormPaymentService.LIVE, new CalloutException(noAccessMessage('JForm_Stripe_Test'))), 'the other mode');
        Assert.isNull(JFormStripeProvider.noAccess(JFormPaymentService.TEST, new CalloutException('Read timed out')));
        Assert.isNull(JFormStripeProvider.noAccess(JFormPaymentService.LIVE,
            new CalloutException('Field JForm_Stripe_Live.SecretKey does not exist. Check spelling.')), 'no key saved');
        Assert.isNull(JFormStripeProvider.noAccess(JFormPaymentService.TEST, new JSONException('JForm_Stripe_Test')));
    }

    @IsTest
    static void aMissingReadOnUserExternalCredentialsSaysWhichPermissionSetAddsIt() {
        // what a site guest user got from an installed JForm Guest, whose copy has no Read on the object
        String refused = JFormStripeProvider.noAccess(JFormPaymentService.TEST,
            new CalloutException('You don\'t have read permissions on the User External Credential object.'));
        Assert.isNotNull(refused);
        Assert.isTrue(refused.contains('JForm Payment Credentials'), refused);
        Assert.isNull(JFormStripeProvider.noAccess(JFormPaymentService.TEST, new JSONException('User External Credential')), 'only a refused callout');
    }

    @IsTest
    static void callsStripeThroughThePackagesCredential() {
        // an installed package does not resolve a bare credential name, so the callout carries the namespace
        Assert.areEqual('callout:' + JFormNamespace.PREFIX + 'JForm_Stripe_Test', JFormStripeProvider.endpoint(JFormPaymentService.TEST));
        Assert.areEqual('callout:' + JFormNamespace.PREFIX + 'JForm_Stripe_Live', JFormStripeProvider.endpoint(JFormPaymentService.LIVE));
        Assert.isNotNull(JFormStripeProvider.noAccess(JFormPaymentService.TEST, new CalloutException(noAccessMessage('jform__JForm_Stripe_Test'))), 'named with the namespace');
        Assert.isNull(JFormStripeProvider.noAccess(JFormPaymentService.TEST,
            new CalloutException('Field jform__JForm_Stripe_Test.SecretKey does not exist. Check spelling.')), 'no key saved, named with the namespace');
    }

    /** What Salesforce says when the running user has no access to an external credential's principal. */
    static String noAccessMessage(String credential) {
        return 'We couldn\'t access the credential(s). You might not have the required permissions, or the external credential "' + credential + '" might not exist.';
    }
}
