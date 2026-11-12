/** Promotion codes are added and their terms changed only in JForm (JFormPromotionCodeService.guard). */
trigger JFormPromotionCodeTrigger on Promotion_Code__c (before insert, before update) {
    JFormPromotionCodeService.guard(Trigger.new, Trigger.oldMap);
}
