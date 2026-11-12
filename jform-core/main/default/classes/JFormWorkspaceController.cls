/**
 * Aura-enabled facade for the builder workspace (c/jformWorkspace). Thin: every
 * operation delegates to the Phase 1 services and converts exceptions into
 * AuraHandledException so the UI gets readable messages.
 */
public with sharing class JFormWorkspaceController {

    public class FormListItem {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String status;
        @AuraEnabled public Boolean isActive;
        @AuraEnabled public Integer version;
        @AuraEnabled public String publicKey;
        @AuraEnabled public Datetime lastModified;
    }

    /** Standard objects offered as targets besides custom objects (lower-case API names). */
    private static final Set<String> COMMON_TARGET_OBJECTS = new Set<String>{
        'account', 'contact', 'opportunity', 'lead', 'case', 'task', 'event', 'campaign', 'contract', 'product2', 'asset', 'order', 'quote', 'solution'
    };

    /** An object a form can create or update records in: its label and API name. */
    public class TargetObject {
        @AuraEnabled public String label;
        @AuraEnabled public String value;

        public TargetObject(String label, String value) {
            this.label = label;
            this.value = value;
        }
    }

    public class FieldOption {
        @AuraEnabled public String label;
        @AuraEnabled public String value;
        @AuraEnabled public String type;
        @AuraEnabled public Boolean required;
        @AuraEnabled public List<String> picklistValues;
        /** Objects a lookup field points to, so record steps can link to earlier steps. */
        @AuraEnabled public List<String> referenceTo;
        /** For a field of an address (MailingCity): the address (MailingAddress), its label and the answer part it takes (city). */
        @AuraEnabled public String addressName;
        @AuraEnabled public String addressLabel;
        @AuraEnabled public String addressPart;
    }

    /** Salesforce's time zones, for the form's opening and closing times: [{ label: "(GMT-08:00) Pacific Standard Time (America/Los_Angeles)", value: "America/Los_Angeles" }]. */
    @AuraEnabled(cacheable=true)
    public static List<TargetObject> getTimeZones() {
        List<TargetObject> zones = new List<TargetObject>();
        for (Schema.PicklistEntry e : User.TimeZoneSidKey.getDescribe().getPicklistValues()) {
            if (e.isActive()) {
                zones.add(new TargetObject(e.getLabel(), e.getValue()));
            }
        }
        return zones;
    }

    /** The countries and states Address fields offer: the org's State and Country/Territory Picklists, or JForm's own countries. */
    @AuraEnabled(cacheable=true)
    public static JFormAddressService.Lists getAddressLists() {
        return JFormAddressService.lists();
    }

    @AuraEnabled
    public static String getDefinition(Id formId) {
        try {
            return JFormDefinitionService.load(formId).serialize();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /** Messages for a refused stale save start with this, so the workspace can offer Reload / Keep mine instead of a generic error. */
    public static final String CONFLICT_PREFIX = 'CONFLICT: ';

    /** `clientId` names the saving tab; it rides on the change event so that tab ignores its own saves. */
    @AuraEnabled
    public static String saveDefinition(String definitionJson, String clientId) {
        try {
            JFormChangeEvents.clientId = clientId;
            JFormDefinition.Form def = JFormDefinition.parse(definitionJson);
            return JFormDefinitionService.save(def).serialize();
        } catch (JFormDefinition.ConflictException e) {
            throw aura(CONFLICT_PREFIX + e.getMessage());
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static String createForm(String name, String targetObjectApiName, String clientId) {
        try {
            JFormChangeEvents.clientId = clientId; // the creating tab ignores the event its own save publishes
            JFormDefinition.Form def = new JFormDefinition.Form();
            def.name = name;
            def.label = name;
            def.targetObjectApiName = targetObjectApiName;
            JFormDefinition.Section page = new JFormDefinition.Section();
            page.key = 'page_1';
            page.name = 'Page 1';
            page.label = 'Page 1';
            // a form that creates records starts with the object's required fields, already mapped
            page.fields.addAll(JFormObjectFields.requiredFormFields(targetObjectApiName));
            def.sections.add(page);
            return JFormDefinitionService.create(def).serialize();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /** Whether "Describe it" is offered in the New form dialog, and with which model. Booleans and names only. */
    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getGenerationStatus() {
        return new Map<String, Object>{
            'available' => JFormGenerationService.isAvailable(),
            'agentInstalled' => JFormGenerationService.agentInstalled(),
            'model' => JFormGenerationService.modelName()
        };
    }

    /** Turn a description into a draft to preview; nothing is saved. Returns JFormGenerationService.Draft as JSON. */
    @AuraEnabled
    public static String describeForm(String description, String name, String targetObjectApiName) {
        try {
            return JSON.serialize(JFormGenerationService.describe(description, name, targetObjectApiName));
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** Save a previewed draft. Returns the saved form's JSON, like createForm. */
    @AuraEnabled
    public static String createDescribedForm(String definitionJson, String targetObjectApiName, String clientId) {
        try {
            JFormChangeEvents.clientId = clientId;
            return JFormGenerationService.create(definitionJson, targetObjectApiName);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** AuraHandledException reads "Script-thrown exception" unless the message is set explicitly. */
    private static AuraHandledException aura(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }

    @AuraEnabled
    public static String cloneForm(Id sourceFormId, String newName, String clientId) {
        try {
            JFormChangeEvents.clientId = clientId;
            return JFormDefinitionService.clone(sourceFormId, newName).serialize();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static JFormPublishService.PublishResult publish(Id formId, String note, String clientId) {
        try {
            JFormChangeEvents.clientId = clientId;
            return JFormPublishService.publish(formId, note);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static JFormPublishService.PublishResult unpublish(Id formId, String clientId) {
        try {
            JFormChangeEvents.clientId = clientId;
            return JFormPublishService.unpublish(formId);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static List<FormListItem> listForms() {
        try {
            List<FormListItem> items = new List<FormListItem>();
            for (Form__c f : [
                SELECT Id, Name, Status__c, Is_Active__c, Version__c, Public_Key__c, LastModifiedDate
                FROM Form__c
                WITH USER_MODE
                ORDER BY LastModifiedDate DESC
                LIMIT 200
            ]) {
                FormListItem i = new FormListItem();
                i.id = f.Id;
                i.name = f.Name;
                i.status = f.Status__c;
                i.isActive = f.Is_Active__c;
                i.version = f.Version__c == null ? null : f.Version__c.intValue();
                i.publicKey = f.Public_Key__c;
                i.lastModified = f.LastModifiedDate;
                items.add(i);
            }
            return items;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /** Active sites a published form can be placed on. */
    @AuraEnabled(cacheable=true)
    public static List<JFormChannelService.SiteOption> getSites() {
        try {
            return JFormChannelService.getSites();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /** Objects a form can feed: custom objects plus common standard ones, sorted by label. */
    @AuraEnabled(cacheable=true)
    public static List<TargetObject> getTargetObjects() {
        try {
            Map<String, TargetObject> byLabelAndName = new Map<String, TargetObject>();
            Map<String, Schema.SObjectType> globalDescribe = JFormSchema.globalDescribe();
            for (String objectName : globalDescribe.keySet()) {
                if (objectName.endsWith('__c') || COMMON_TARGET_OBJECTS.contains(objectName)) {
                    Schema.DescribeSObjectResult describe = globalDescribe.get(objectName).getDescribe(SObjectDescribeOptions.DEFERRED);
                    TargetObject target = new TargetObject(describe.getLabel(), describe.getName());
                    byLabelAndName.put(target.label + '|' + target.value, target);
                }
            }
            List<String> sortKeys = new List<String>(byLabelAndName.keySet());
            sortKeys.sort();
            List<TargetObject> sorted = new List<TargetObject>();
            for (String sortKey : sortKeys) {
                sorted.add(byLabelAndName.get(sortKey));
            }
            return sorted;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /** Createable fields of an object with type, required flag and picklist values, for answer mapping. */
    @AuraEnabled(cacheable=true)
    public static List<FieldOption> getObjectFields(String objectApiName) {
        try {
            Schema.SObjectType sobjectType = JFormSchema.globalDescribe().get(objectApiName);
            if (sobjectType == null) {
                throw new AuraHandledException('Unknown object: ' + objectApiName);
            }
            List<FieldOption> out = new List<FieldOption>();
            Schema.DescribeSObjectResult objectDescribe = sobjectType.getDescribe();
            // each field described once, for the list and for the addresses
            Map<String, Schema.DescribeFieldResult> described = new Map<String, Schema.DescribeFieldResult>();
            for (Schema.SObjectField sf : objectDescribe.fields.getMap().values()) {
                Schema.DescribeFieldResult fd = sf.getDescribe();
                described.put(fd.getName().toLowerCase(), fd);
            }
            // the fields an Address field fills, by address: the codes where the org has them
            Map<String, JFormAddressService.Target> addressByField = new Map<String, JFormAddressService.Target>();
            Map<String, String> partByField = new Map<String, String>();
            for (JFormAddressService.Target t : JFormAddressService.targets(described)) {
                for (String part : t.fields.keySet()) {
                    addressByField.put(t.fields.get(part).toLowerCase(), t);
                    partByField.put(t.fields.get(part).toLowerCase(), part);
                }
            }
            List<String> names = new List<String>(described.keySet());
            names.sort();
            for (String n : names) {
                Schema.DescribeFieldResult d = described.get(n);
                if (!d.isCreateable() || d.isCalculated() || d.isAutoNumber()) {
                    continue;
                }
                FieldOption fo = new FieldOption();
                fo.label = d.getLabel();
                fo.value = d.getName();
                fo.type = String.valueOf(d.getType()).toLowerCase();
                fo.required = !d.isNillable() && !d.isDefaultedOnCreate();
                if (d.getType() == Schema.DisplayType.PICKLIST || d.getType() == Schema.DisplayType.MULTIPICKLIST) {
                    fo.picklistValues = new List<String>();
                    for (Schema.PicklistEntry pe : d.getPicklistValues()) {
                        if (pe.isActive()) {
                            fo.picklistValues.add(pe.getValue());
                        }
                    }
                }
                if (d.getType() == Schema.DisplayType.REFERENCE) {
                    fo.referenceTo = new List<String>();
                    for (Schema.SObjectType r : d.getReferenceTo()) {
                        fo.referenceTo.add(String.valueOf(r));
                    }
                }
                JFormAddressService.Target address = addressByField.get(n);
                if (address != null) {
                    fo.addressName = address.name;
                    fo.addressLabel = address.label;
                    fo.addressPart = partByField.get(n);
                }
                out.add(fo);
            }
            return out;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Whether the org-level spam protection keys are set, so the Settings tab can explain what reCAPTCHA needs.
     * Never the values. Not cached: the keys are saved on the Setup tab, and the Settings tab must see them next time it asks.
     */
    @AuraEnabled
    public static Map<String, Boolean> getProtectionStatus() {
        return new Map<String, Boolean>{
            'captchaConfigured' => JFormProtectionService.captchaConfigured(),
            'signingConfigured' => JFormProtectionService.signingConfigured()
        };
    }

    /**
     * What the Settings tab's Payments section can offer: test payments when the test signing secret is
     * saved on the Setup tab, live payments when the live one is
     * (never in a sandbox or scratch org). Booleans only. Not cached, like getProtectionStatus: a secret saved or
     * removed on the Setup tab shows the next time the Settings tab or the Payment block's properties ask.
     */
    @AuraEnabled
    public static Map<String, Boolean> getPaymentStatus() {
        Boolean sandbox = JFormPaymentService.isSandbox();
        return new Map<String, Boolean>{
            'testConnected' => String.isNotBlank(JFormPaymentService.webhookSecret(JFormPaymentService.TEST)),
            'liveConnected' => !sandbox && String.isNotBlank(JFormPaymentService.webhookSecret(JFormPaymentService.LIVE)),
            'sandbox' => sandbox
        };
    }

    // ------------------------------------------------------------ promotion codes (Settings › Payments)

    @AuraEnabled
    public static List<JFormPromotionCodeService.Summary> listPromotionCodes(Id formId) {
        try {
            return JFormPromotionCodeService.listCodes(formId);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** Adds a code, or changes one (id set); codeJson is a JFormPromotionCodeService.Summary. */
    @AuraEnabled
    public static JFormPromotionCodeService.Summary savePromotionCode(Id formId, String codeJson) {
        try {
            JFormPromotionCodeService.Summary input = (JFormPromotionCodeService.Summary) JSON.deserialize(codeJson, JFormPromotionCodeService.Summary.class);
            return JFormPromotionCodeService.save(formId, input);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** Up to 500 single-use codes with the same terms; requestJson is a JFormPromotionCodeService.GenerateRequest. */
    @AuraEnabled
    public static List<JFormPromotionCodeService.Summary> generatePromotionCodes(Id formId, String requestJson) {
        try {
            JFormPromotionCodeService.GenerateRequest r = (JFormPromotionCodeService.GenerateRequest) JSON.deserialize(requestJson, JFormPromotionCodeService.GenerateRequest.class);
            return JFormPromotionCodeService.generate(formId, r);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    @AuraEnabled
    public static void deletePromotionCode(Id formId, Id codeId) {
        try {
            JFormPromotionCodeService.remove(formId, codeId);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** The form's codes as CSV text (code, discount, validity, uses, state, note), for handing codes to customers. */
    @AuraEnabled
    public static String exportPromotionCodes(Id formId) {
        try {
            return JFormPromotionCodeService.exportCsv(formId);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    public class FlowCatalog {
        @AuraEnabled public Boolean canUseFlows;
        @AuraEnabled public List<JFormAutomationService.FlowInfo> flows;
    }

    /** Flows a step can run, listed only for people who may add one (the Manage Flow permission). */
    @AuraEnabled
    public static FlowCatalog getFlows() {
        try {
            FlowCatalog c = new FlowCatalog();
            c.canUseFlows = JFormAutomationService.canUseFlows();
            c.flows = c.canUseFlows ? JFormAutomationService.listFlows() : new List<JFormAutomationService.FlowInfo>();
            return c;
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** A flow's input and output variables (its active version), for the step editor. Not cached, so "Refresh from the flow" sees edits. */
    @AuraEnabled
    public static JFormAutomationService.FlowInfo getFlowDetails(String flowApiName) {
        JFormAutomationService.FlowInfo f;
        try {
            f = JFormAutomationService.flowInfo(flowApiName);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
        if (f == null) {
            throw aura('Flow "' + flowApiName + '" is not an active autolaunched flow.');
        }
        return f;
    }
}
