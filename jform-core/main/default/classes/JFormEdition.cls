/**
 * Kept on purpose. JForm once sold a Subscription edition unlocked by license keys. JForm is now free and open
 * source: every feature works in every org and nothing checks an edition. Installed package versions shipped
 * this class and the License_Settings__c setting, and a managed package cannot drop them, so both stay. The one
 * method keeps the class above zero lines, which deploys that run specified tests need.
 */
public with sharing class JFormEdition {

    /** The features the paid edition used to hold. */
    public enum Feature { PAYMENTS, TEST_MODE }

    /** Always true: every feature is on in every org. */
    public static Boolean isEnabled(Feature f) {
        return true;
    }
}
