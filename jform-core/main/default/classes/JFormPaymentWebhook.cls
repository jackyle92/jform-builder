/**
 * The gateway's webhook for JForm Payments, on the Experience site (JFormPaymentService.webhookUrl):
 *   POST /services/apexrest/jform/payments/stripe/test
 *   POST /services/apexrest/jform/payments/stripe/live
 * The address names the gateway (JFormPaymentService.GATEWAYS) and the mode, so each gateway's events
 * reach its own provider. Test and live have their own address and signing secret in Stripe, so a test
 * event can never mark a live payment paid. The signature is checked over the exact body before anything else is read; a request that
 * fails it gets 400 and changes nothing. Repeats are harmless: a payment moves forward once.
 *
 * Runs as the site's guest user, who has access to this class only.
 */
@RestResource(urlMapping='/payments/*')
global without sharing class JFormPaymentWebhook {

    @HttpPost
    global static void receive() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        List<String> parts = req.requestURI == null ? new List<String>() : req.requestURI.removeEnd('/').split('/');
        String mode = parts.size() < 2 ? null : parts[parts.size() - 1].toLowerCase();
        String gateway = parts.size() < 2 ? null : parts[parts.size() - 2].toLowerCase();
        if (!JFormPaymentService.GATEWAYS.contains(gateway) || (mode != 'test' && mode != 'live')) {
            reply(res, 404, new Map<String, Object>{ 'error' => 'Unknown address.' });
            return;
        }
        JFormPaymentService.GatewayUpdate u;
        try {
            u = JFormPaymentService.providerFor(gateway).readWebhook(mode == 'live' ? JFormPaymentService.LIVE : JFormPaymentService.TEST, req.headers, req.requestBody);
        } catch (JFormPaymentService.PaymentException e) {
            // a bad signature, or Stripe could not be read back: Stripe retries for three days
            reply(res, 400, new Map<String, Object>{ 'error' => e.getMessage() });
            return;
        } catch (Exception e) {
            // a shape the provider did not expect: logged under the event's ID so it can be found in Stripe, which retries
            System.debug(LoggingLevel.ERROR, 'JForm payment webhook ' + eventIdOf(req.requestBody) + ' could not be read: ' + e.getTypeName() + ': ' + e.getMessage());
            reply(res, 500, new Map<String, Object>{ 'error' => 'The event could not be read.' });
            return;
        }
        try {
            Map<String, String> outcomes = JFormPaymentService.apply(new List<JFormPaymentService.GatewayUpdate>{ u });
            reply(res, 200, new Map<String, Object>{ 'received' => true, 'event' => u.eventType, 'outcome' => outcomes.values() });
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'JForm payment webhook ' + u.eventId + ' failed: ' + e.getTypeName() + ': ' + e.getMessage());
            reply(res, 500, new Map<String, Object>{ 'error' => 'The event could not be applied.' });
        }
    }

    /** The event's ID from the body, for the log line, when the body is a JSON object that carries one. */
    @TestVisible
    private static String eventIdOf(Blob body) {
        try {
            Object event = JSON.deserializeUntyped(body.toString());
            Object id = event instanceof Map<String, Object> ? ((Map<String, Object>) event).get('id') : null;
            return id instanceof String ? (String) id : '(no event ID)';
        } catch (Exception e) {
            return '(unreadable body)';
        }
    }

    private static void reply(RestResponse res, Integer status, Map<String, Object> body) {
        res.statusCode = status;
        res.addHeader('Content-Type', 'application/json');
        res.responseBody = Blob.valueOf(JSON.serialize(body));
    }
}
