/**
 * Hourly JForm payment check (JFormPaymentService.checkOpenCheckouts), scheduled when a webhook signing
 * secret is saved on the Setup tab. The work is found by name, so this scheduled class depends on nothing
 * that changes and never holds up a deploy or a package upgrade of JFormPaymentService.
 */
public with sharing class JFormPaymentCheckJob implements Schedulable {

    public void execute(SchedulableContext ctx) {
        Type work = Type.forName(String.isBlank(JFormNamespace.NAME) ? null : JFormNamespace.NAME, 'JFormPaymentService.CheckWork');
        System.enqueueJob((Queueable) work.newInstance());
    }
}
