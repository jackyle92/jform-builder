/**
 * Stripe hosted checkout for JForm Payments, in the customer's own Stripe account.
 *
 * Calls go through the JForm Stripe named credentials (test and live), so the secret key is added as the
 * Authorization header by Salesforce and never read by Apex. Webhooks are checked with the signing
 * secret in the protected Payment_Settings__c: HMAC-SHA256 over "<timestamp>.<raw body>", at most five
 * minutes old. A checkout event is then confirmed by reading the checkout back from Stripe, so the
 * webhook, the return page and the hourly check all apply the same, current state.
 */
public inherited sharing class JFormStripeProvider implements JFormPaymentProvider {

    /** Request and response shapes this class reads, whatever the account's default API version (the first with adaptive_pricing on checkouts). */
    @TestVisible private static final String API_VERSION = '2024-11-20.acacia';
    private static final Integer TIMEOUT_MS = 20000;
    private static final Integer TOLERANCE_SECONDS = 300;
    @TestVisible private static final Pattern CHECKOUT_ID = Pattern.compile('cs_(test|live)_[A-Za-z0-9]{10,200}');
    private static final Pattern PAYMENT_ID = Pattern.compile('pi_[A-Za-z0-9]{10,200}');
    /**
     * The events the webhook endpoint must send; checkConnection reports any that are missing. A refund
     * arrives as charge.refunded; one that settles or fails later (bank debits take days) as refund.updated
     * or refund.failed.
     */
    public static final List<String> EVENTS = new List<String>{
        'checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed', 'charge.refunded', 'refund.updated', 'refund.failed'
    };

    public String name() {
        return 'Stripe';
    }

    /** The mode's named credential. An installed package does not resolve a bare credential name, so the namespace is named. */
    public static String endpoint(String mode) {
        return 'callout:' + JFormNamespace.qualify(credentialName(mode));
    }

    /** JForm_Stripe_Test or JForm_Stripe_Live, without the namespace. */
    private static String credentialName(String mode) {
        return mode == JFormPaymentService.LIVE ? 'JForm_Stripe_Live' : 'JForm_Stripe_Test';
    }

    public static Boolean isCheckoutReference(String value) {
        return value != null && CHECKOUT_ID.matcher(value).matches();
    }

    // ------------------------------------------------------------ checkout

    public JFormPaymentService.Checkout createCheckout(JFormPaymentService.CheckoutRequest r) {
        List<String> body = new List<String>{
            enc('mode', 'payment'),
            enc('client_reference_id', r.reference),
            enc('metadata[jform_form]', r.publicKey),
            enc('metadata[jform_reference]', r.reference),
            enc('payment_intent_data[metadata][jform_form]', r.publicKey),
            enc('payment_intent_data[metadata][jform_reference]', r.reference),
            enc('expires_at', String.valueOf(r.expiresAt.getTime() / 1000)),
            enc('success_url', r.successUrl),
            enc('cancel_url', r.cancelUrl),
            // Stripe's Adaptive Pricing, on by default for new accounts, would present and charge the checkout in the
            // respondent's own currency; the amount charged then differs from the one priced and recorded here
            enc('adaptive_pricing[enabled]', 'false')
        };
        if (String.isNotBlank(r.description)) {
            body.add(enc('payment_intent_data[description]', r.description.left(1000)));
        }
        // the form's Email answer: Stripe's page shows it filled in and read-only instead of asking again
        String email = String.isNotBlank(r.customerEmail) ? enc('customer_email', r.customerEmail) : null;
        if (email != null) {
            body.add(email);
        }
        // otherwise Stripe asks for a billing address only when the card needs one
        if (r.askBillingAddress == true) {
            body.add(enc('billing_address_collection', 'required'));
        }
        // Stripe takes either its own code box or a discount set here, never both
        String coupon;
        if (r.allowGatewayCodes == true) {
            body.add(enc('allow_promotion_codes', 'true'));
        } else if (r.discount != null && r.discount > 0) {
            coupon = createCoupon(r);
            body.add(enc('discounts[0][coupon]', coupon));
        }
        Integer i = 0;
        for (JFormPaymentPricing.Line line : r.quote.lines) {
            String p = 'line_items[' + i + ']';
            body.add(enc(p + '[price_data][currency]', r.quote.currencyCode.toLowerCase()));
            body.add(enc(p + '[price_data][unit_amount]', String.valueOf(line.unitAmount)));
            body.add(enc(p + '[price_data][product_data][name]', line.name));
            body.add(enc(p + '[quantity]', String.valueOf(line.quantity)));
            i++;
        }
        HttpRequest req = request(r.mode, 'POST', '/v1/checkout/sessions');
        req.setBody(String.join(body, '&'));
        Map<String, Object> session;
        try {
            try {
                session = send(req, 'create the checkout');
            } catch (JFormPaymentService.PaymentException e) {
                // Stripe checks addresses more strictly than the Email field: when it refuses the address itself,
                // let its page ask for the email instead. Any other failure (a rate limit, an outage) stands.
                if (email == null || e.param != 'customer_email' || e.statusCode != 400 || e.errorType != 'invalid_request_error') {
                    throw e;
                }
                body.remove(body.indexOf(email));
                req.setBody(String.join(body, '&'));
                session = send(req, 'create the checkout');
            }
        } catch (JFormPaymentService.PaymentException e) {
            deleteCoupon(r.mode, coupon);
            throw e;
        }
        if ((session.get('livemode') == true) != (r.mode == JFormPaymentService.LIVE)) {
            throw new JFormPaymentService.PaymentException('The Stripe key for ' + r.mode + ' payments belongs to the other mode.');
        }
        JFormPaymentService.Checkout c = new JFormPaymentService.Checkout();
        c.reference = (String) session.get('id');
        c.url = (String) session.get('url');
        if (!isCheckoutReference(c.reference) || String.isBlank(c.url) || !c.url.startsWith('https://checkout.stripe.com/')) {
            throw new JFormPaymentService.PaymentException('Stripe returned a checkout JForm cannot use.');
        }
        return c;
    }

    /**
     * A JForm promotion code's discount goes to Stripe as a coupon made for this checkout, with the discount
     * as a fixed amount (also for percent codes, so Stripe's total equals JForm's by construction) and the
     * code as its name, shown on Stripe's page and receipt. One use, once: the coupon stays in the account's
     * list, named after the code and marked with JForm's reference.
     */
    private static String createCoupon(JFormPaymentService.CheckoutRequest r) {
        HttpRequest req = request(r.mode, 'POST', '/v1/coupons');
        req.setBody(String.join(new List<String>{
            enc('amount_off', String.valueOf(r.discount)),
            enc('currency', r.quote.currencyCode.toLowerCase()),
            enc('name', String.isBlank(r.discountName) ? 'Discount' : r.discountName.left(40)),
            enc('duration', 'once'),
            enc('max_redemptions', '1'),
            enc('metadata[jform_form]', r.publicKey),
            enc('metadata[jform_reference]', r.reference)
        }, '&'));
        Map<String, Object> coupon = send(req, 'apply the discount');
        String id = (String) coupon.get('id');
        if (String.isBlank(id)) {
            throw new JFormPaymentService.PaymentException('Stripe returned a discount JForm cannot use.');
        }
        return id;
    }

    /** A coupon made for a checkout Stripe then refused would stay in the account unused: removed, as far as Stripe lets it. */
    private static void deleteCoupon(String mode, String coupon) {
        if (String.isBlank(coupon)) {
            return;
        }
        try {
            send(request(mode, 'DELETE', '/v1/coupons/' + EncodingUtil.urlEncode(coupon, 'UTF-8')), 'remove the discount');
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'JForm could not remove Stripe coupon ' + coupon + ': ' + e.getMessage());
        }
    }

    /** The payment intent with its charge, and a promotion code's text, come with the checkout. */
    private static final String SESSION_EXPAND = '?expand%5B%5D=payment_intent.latest_charge&expand%5B%5D=discounts.promotion_code';

    public JFormPaymentService.GatewayUpdate fetchCheckout(String mode, String checkoutReference) {
        if (!isCheckoutReference(checkoutReference)) {
            throw new JFormPaymentService.PaymentException('Not a Stripe checkout reference.');
        }
        HttpRequest req = request(mode, 'GET', '/v1/checkout/sessions/' + checkoutReference + SESSION_EXPAND);
        return fromSession(mode, send(req, 'read the checkout'), null);
    }

    public void expireCheckout(String mode, String checkoutReference) {
        if (!isCheckoutReference(checkoutReference)) {
            throw new JFormPaymentService.PaymentException('Not a Stripe checkout reference.');
        }
        send(request(mode, 'POST', '/v1/checkout/sessions/' + checkoutReference + '/expire'), 'end the checkout');
    }

    /** A checkout session (payment intent and its charge expanded, or not) as a JForm update. */
    @TestVisible
    private static JFormPaymentService.GatewayUpdate fromSession(String mode, Map<String, Object> session, String eventType) {
        JFormPaymentService.GatewayUpdate u = new JFormPaymentService.GatewayUpdate();
        u.mode = session.get('livemode') == true ? JFormPaymentService.LIVE : JFormPaymentService.TEST;
        u.checkoutReference = (String) session.get('id');
        u.amount = longOf(session.get('amount_total'));
        u.currencyCode = session.get('currency') == null ? null : String.valueOf(session.get('currency')).toUpperCase();
        u.subtotal = longOf(session.get('amount_subtotal'));
        if (session.get('total_details') instanceof Map<String, Object>) {
            u.discount = longOf(((Map<String, Object>) session.get('total_details')).get('amount_discount'));
        }
        u.code = discountCode(session.get('discounts'));
        Object intent = session.get('payment_intent');
        String intentStatus;
        if (intent instanceof Map<String, Object>) {
            Map<String, Object> pi = (Map<String, Object>) intent;
            u.paymentReference = (String) pi.get('id');
            intentStatus = (String) pi.get('status');
            if (pi.get('latest_charge') instanceof Map<String, Object>) {
                Map<String, Object> charge = (Map<String, Object>) pi.get('latest_charge');
                if (charge.get('payment_method_details') instanceof Map<String, Object>) {
                    u.paymentMethod = (String) ((Map<String, Object>) charge.get('payment_method_details')).get('type');
                }
            }
        } else if (intent instanceof String) {
            u.paymentReference = (String) intent;
        }
        if (String.isNotBlank(u.paymentReference)) {
            u.providerUrl = dashboardUrl(u.mode, u.paymentReference);
        }
        String status = (String) session.get('status');
        String paymentStatus = (String) session.get('payment_status');
        if (status == 'expired') {
            u.kind = JFormPaymentService.KIND_EXPIRED;
        } else if (paymentStatus == 'paid' || paymentStatus == 'no_payment_required') {
            u.kind = JFormPaymentService.KIND_PAID;
        } else if (status == 'complete') {
            // a bank debit: the checkout is done, the money follows days later, or never
            Boolean failed = eventType == 'checkout.session.async_payment_failed' || intentStatus == 'requires_payment_method' || intentStatus == 'canceled';
            u.kind = failed ? JFormPaymentService.KIND_FAILED : JFormPaymentService.KIND_PROCESSING;
        } else {
            u.kind = JFormPaymentService.KIND_OPEN;
        }
        return u;
    }

    // ------------------------------------------------------------ webhook

    public JFormPaymentService.GatewayUpdate readWebhook(String mode, Map<String, String> headers, Blob body) {
        String problem = verify(header(headers, 'Stripe-Signature'), body, JFormPaymentService.webhookSecret(mode), System.now().getTime() / 1000);
        if (problem != null) {
            throw new JFormPaymentService.PaymentException(problem);
        }
        Map<String, Object> event = parse(body.toString());
        if ((event.get('livemode') == true) != (mode == JFormPaymentService.LIVE)) {
            throw new JFormPaymentService.PaymentException('A ' + (event.get('livemode') == true ? 'live' : 'test') + ' event reached the ' + mode + ' webhook address.');
        }
        String type = (String) event.get('type');
        Map<String, Object> obj = event.get('data') instanceof Map<String, Object> && ((Map<String, Object>) event.get('data')).get('object') instanceof Map<String, Object>
            ? (Map<String, Object>) ((Map<String, Object>) event.get('data')).get('object')
            : new Map<String, Object>();
        JFormPaymentService.GatewayUpdate u;
        if (type != null && type.startsWith('checkout.session.') && isCheckoutReference((String) obj.get('id'))) {
            // the event says something changed; Stripe's current copy of the checkout says what
            HttpRequest req = request(mode, 'GET', '/v1/checkout/sessions/' + obj.get('id') + SESSION_EXPAND);
            u = fromSession(mode, send(req, 'read the checkout'), type);
        } else if ((type == 'charge.refunded' || (type != null && type.startsWith('refund.'))) && obj.get('payment_intent') instanceof String) {
            // whichever refund changed, Stripe's list of the payment's refunds says where each stands now
            u = new JFormPaymentService.GatewayUpdate();
            u.kind = JFormPaymentService.KIND_REFUNDED;
            u.mode = mode;
            u.paymentReference = (String) obj.get('payment_intent');
            u.currencyCode = obj.get('currency') == null ? null : String.valueOf(obj.get('currency')).toUpperCase();
            u.refunds = listRefunds(mode, u.paymentReference);
        } else {
            u = new JFormPaymentService.GatewayUpdate();
            u.kind = JFormPaymentService.KIND_IGNORED;
            u.mode = mode;
        }
        u.eventId = (String) event.get('id');
        u.eventType = type;
        return u;
    }

    /** Null when the Stripe-Signature header is valid for this exact body; otherwise why not. */
    @TestVisible
    private static String verify(String header, Blob raw, String secret, Long nowSeconds) {
        if (String.isBlank(secret)) {
            return 'No signing secret is saved for this mode.';
        }
        if (String.isBlank(header) || raw == null) {
            return 'Missing signature or body.';
        }
        Long t;
        Set<String> signatures = new Set<String>();
        for (String part : header.split(',')) {
            List<String> kv = part.trim().split('=', 2);
            if (kv.size() != 2) {
                continue;
            }
            if (kv[0] == 't' && kv[1].isNumeric()) {
                t = Long.valueOf(kv[1]);
            }
            if (kv[0] == 'v1') {
                signatures.add(kv[1].toLowerCase());
            }
        }
        if (t == null || signatures.isEmpty()) {
            return 'Malformed signature header.';
        }
        if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) {
            return 'Signature timestamp is too old or in the future.';
        }
        // sign the exact bytes Stripe sent: "<t>." and the raw body, joined as hex so nothing is re-encoded
        Blob signed = EncodingUtil.convertFromHex(EncodingUtil.convertToHex(Blob.valueOf(t + '.')) + EncodingUtil.convertToHex(raw));
        String expected = EncodingUtil.convertToHex(Crypto.generateMac('hmacSHA256', signed, Blob.valueOf(secret)));
        return signatures.contains(expected) ? null : 'Signature does not match.';
    }

    // ------------------------------------------------------------ refunds

    public List<JFormPaymentService.Refund> listRefunds(String mode, String paymentReference) {
        List<JFormPaymentService.Refund> out = new List<JFormPaymentService.Refund>();
        if (paymentReference == null || !PAYMENT_ID.matcher(paymentReference).matches()) {
            return out;
        }
        Map<String, Object> page = send(request(mode, 'GET', '/v1/refunds?limit=100&payment_intent=' + paymentReference), 'read the refunds');
        for (Object o : page.get('data') instanceof List<Object> ? (List<Object>) page.get('data') : new List<Object>()) {
            Map<String, Object> m = (Map<String, Object>) o;
            JFormPaymentService.Refund r = new JFormPaymentService.Refund();
            r.reference = (String) m.get('id');
            r.amount = longOf(m.get('amount'));
            r.currencyCode = m.get('currency') == null ? null : String.valueOf(m.get('currency')).toUpperCase();
            String status = (String) m.get('status');
            r.status = status == 'succeeded' ? 'Succeeded' : (status == 'failed' || status == 'canceled') ? 'Failed' : 'Pending';
            Long created = longOf(m.get('created'));
            r.createdAt = created == null ? null : Datetime.newInstance(created * 1000);
            out.add(r);
        }
        return out;
    }

    // ------------------------------------------------------------ connection check

    public JFormPaymentService.ConnectionCheck checkConnection(String mode, String webhookUrl) {
        JFormPaymentService.ConnectionCheck c = new JFormPaymentService.ConnectionCheck();
        c.mode = mode;
        HttpResponse res;
        try {
            res = new Http().send(request(mode, 'GET', '/v1/webhook_endpoints?limit=100'));
        } catch (Exception e) {
            String refused = noAccess(mode, e);
            c.keyProblem = refused != null ? refused : 'Salesforce could not reach Stripe: ' + e.getMessage();
            return c;
        }
        if (res.getStatusCode() == 401) {
            c.keyProblem = 'Stripe did not accept the saved secret key.';
            return c;
        }
        if (res.getStatusCode() == 403) {
            c.keyProblem = 'The saved key is a restricted key without access to webhook endpoints. Give it Read access to Webhook Endpoints, or use the secret key.';
            return c;
        }
        if (res.getStatusCode() != 200) {
            c.keyProblem = 'Stripe answered ' + res.getStatusCode() + ': ' + errorMessage(parse(res.getBody()));
            return c;
        }
        c.keyWorks = true;
        String wanted = normaliseUrl(webhookUrl);
        Map<String, Object> page = parse(res.getBody());
        for (Object o : page.get('data') instanceof List<Object> ? (List<Object>) page.get('data') : new List<Object>()) {
            Map<String, Object> endpoint = (Map<String, Object>) o;
            if (normaliseUrl((String) endpoint.get('url')) != wanted) {
                continue;
            }
            c.webhookFound = true;
            c.webhookEnabled = endpoint.get('status') == 'enabled';
            Set<String> enabled = new Set<String>();
            for (Object e : endpoint.get('enabled_events') instanceof List<Object> ? (List<Object>) endpoint.get('enabled_events') : new List<Object>()) {
                enabled.add(String.valueOf(e));
            }
            for (String e : EVENTS) {
                if (!enabled.contains(e) && !enabled.contains('*')) {
                    c.missingEvents.add(e);
                }
            }
            break;
        }
        return c;
    }

    // ------------------------------------------------------------ helpers

    public static String dashboardUrl(String mode, String paymentReference) {
        return 'https://dashboard.stripe.com/' + (mode == JFormPaymentService.LIVE ? '' : 'test/') + 'payments/' + paymentReference;
    }

    private static HttpRequest request(String mode, String method, String path) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint(mode) + path);
        req.setMethod(method);
        req.setHeader('Stripe-Version', API_VERSION);
        if (method == 'POST') {
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        }
        req.setTimeout(TIMEOUT_MS);
        return req;
    }

    /**
     * Null unless Salesforce refused the call because the running user cannot use the mode's credential. A
     * user needs its principal from a permission set: ACCESS_FORM_BUILDER for builders and admins (Check
     * connection, the hourly check), JForm Guest for the site guest user and logged-in respondents.
     * Salesforce's message names the external credential, and the name is never translated. A credential
     * with no key saved is named too, as "<credential>.SecretKey", and is a different problem.
     * The user also needs Read on User External Credentials, which installed permission sets cannot carry
     * (JFormSetupController); Salesforce's message for that names the object instead.
     */
    @TestVisible
    private static String noAccess(String mode, Exception e) {
        // Salesforce may name the credential with or without the namespace
        String credential = credentialName(mode);
        String message = e.getMessage();
        if (e instanceof CalloutException && message != null && (message.contains('User External Credential') || message.contains('UserExternalCredential'))) {
            return 'Your user can\'t read User External Credentials, which Salesforce needs before a callout can use the saved Stripe key. '
                + 'In JForm Setup, grant builder access to the user (or guest access for a site\'s guest user) to add the JForm Payment Credentials permission set.';
        }
        if (!(e instanceof CalloutException) || message == null || !message.contains(credential) || message.contains(credential + '.')) {
            return null;
        }
        return 'Your user can\'t use the JForm Stripe (' + mode.toLowerCase() + ') credential. Assign the ACCESS_FORM_BUILDER permission set, '
            + 'or JForm Guest for the site guest user and logged-in respondents.';
    }

    /** The response as a map; Stripe's own message in a PaymentException when it refuses. */
    private static Map<String, Object> send(HttpRequest req, String what) {
        HttpResponse res;
        try {
            res = new Http().send(req);
        } catch (Exception e) {
            String refused = noAccess(req.getEndpoint().startsWith(endpoint(JFormPaymentService.LIVE)) ? JFormPaymentService.LIVE : JFormPaymentService.TEST, e);
            throw new JFormPaymentService.PaymentException(refused != null ? refused : 'Salesforce could not reach Stripe to ' + what + ': ' + e.getMessage());
        }
        Map<String, Object> body = parse(res.getBody());
        if (res.getStatusCode() < 200 || res.getStatusCode() > 299) {
            JFormPaymentService.PaymentException e = new JFormPaymentService.PaymentException('Stripe could not ' + what + ' (' + res.getStatusCode() + '): ' + errorMessage(body));
            e.statusCode = res.getStatusCode();
            if (body.get('error') instanceof Map<String, Object>) {
                Map<String, Object> error = (Map<String, Object>) body.get('error');
                e.param = error.get('param') == null ? null : String.valueOf(error.get('param'));
                e.errorType = error.get('type') == null ? null : String.valueOf(error.get('type'));
            }
            throw e;
        }
        return body;
    }

    private static String errorMessage(Map<String, Object> body) {
        if (body.get('error') instanceof Map<String, Object>) {
            Object message = ((Map<String, Object>) body.get('error')).get('message');
            return message == null ? 'no message' : String.valueOf(message);
        }
        return 'no message';
    }

    private static String normaliseUrl(String url) {
        return url == null ? null : url.trim().toLowerCase().removeEnd('/');
    }

    private static String header(Map<String, String> headers, String name) {
        for (String k : headers == null ? new Set<String>() : headers.keySet()) {
            if (k.equalsIgnoreCase(name)) {
                return headers.get(k);
            }
        }
        return null;
    }

    private static String enc(String key, String value) {
        return EncodingUtil.urlEncode(key, 'UTF-8') + '=' + EncodingUtil.urlEncode(value == null ? '' : value, 'UTF-8');
    }

    /** The first discount's promotion code text (expanded), or its coupon's name; null without one. */
    @TestVisible
    private static String discountCode(Object discounts) {
        if (!(discounts instanceof List<Object>) || ((List<Object>) discounts).isEmpty()) {
            return null;
        }
        Object first = ((List<Object>) discounts)[0];
        if (!(first instanceof Map<String, Object>)) {
            return null;
        }
        Map<String, Object> d = (Map<String, Object>) first;
        if (d.get('promotion_code') instanceof Map<String, Object>) {
            Object code = ((Map<String, Object>) d.get('promotion_code')).get('code');
            if (code instanceof String && String.isNotBlank((String) code)) {
                return (String) code;
            }
        }
        if (d.get('coupon') instanceof Map<String, Object>) {
            Object name = ((Map<String, Object>) d.get('coupon')).get('name');
            return name instanceof String && String.isNotBlank((String) name) ? (String) name : null;
        }
        return null;
    }

    private static Long longOf(Object value) {
        if (value instanceof Long) {
            return (Long) value;
        }
        if (value instanceof Integer) {
            return Long.valueOf(String.valueOf(value));
        }
        if (value instanceof Decimal) {
            return ((Decimal) value).longValue();
        }
        return null;
    }

    private static Map<String, Object> parse(String body) {
        try {
            Object o = JSON.deserializeUntyped(body);
            return o instanceof Map<String, Object> ? (Map<String, Object>) o : new Map<String, Object>();
        } catch (Exception e) {
            return new Map<String, Object>();
        }
    }
}
