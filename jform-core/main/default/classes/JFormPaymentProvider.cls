/**
 * A payment gateway behind JForm Payments. Stripe is the first (JFormStripeProvider); PayPal or a
 * regional gateway is another implementation, with no change to forms, the Form Payment record or the
 * renderer. Every method that calls the gateway runs before the caller saves anything, because Apex
 * cannot make a callout after a DML statement in the same transaction.
 */
public interface JFormPaymentProvider {

    /** The Provider__c value on the payments this gateway takes. */
    String name();

    /** A hosted checkout for a quote; the respondent is sent to its URL. */
    JFormPaymentService.Checkout createCheckout(JFormPaymentService.CheckoutRequest request);

    /** The checkout as the gateway sees it now, for the return page and the hourly check. */
    JFormPaymentService.GatewayUpdate fetchCheckout(String mode, String checkoutReference);

    /** End a checkout that was not paid, when the respondent cancels. */
    void expireCheckout(String mode, String checkoutReference);

    /**
     * A webhook request, checked against the mode's signing secret and turned into the update it
     * describes. Throws JFormPaymentService.PaymentException when the signature does not hold.
     */
    JFormPaymentService.GatewayUpdate readWebhook(String mode, Map<String, String> headers, Blob body);

    /** The refunds of a payment, by the payment's reference. */
    List<JFormPaymentService.Refund> listRefunds(String mode, String paymentReference);

    /** Whether the mode's key works and the webhook address is registered for the events JForm needs. */
    JFormPaymentService.ConnectionCheck checkConnection(String mode, String webhookUrl);
}
