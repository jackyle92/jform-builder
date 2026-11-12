/**
 * The JForm Setup tab: what a new org still needs before a form can go live, and the
 * steps Apex can do itself. Creating and publishing an Experience site has no Apex API,
 * so those steps are detected and linked; builder and guest access are granted here.
 * Grants run in user mode, so only users allowed to assign permission sets can make them.
 *
 * Stripe callouts go through JForm's external credentials, and Salesforce lets a callout use one only when the
 * running user can read User External Credentials. That is a standard object, and Salesforce leaves standard
 * object permissions out of packaged permission sets when it installs them, so the installed JForm Guest and
 * ACCESS_FORM_BUILDER cannot carry it. Granting access therefore also gives users without it the org's own
 * JForm Payment Credentials permission set, which JForm creates the first time it is needed.
 */
public with sharing class JFormSetupController {

    public static final String BUILDER_PERMISSION_SET = 'ACCESS_FORM_BUILDER';
    public static final String GUEST_PERMISSION_SET = 'JForm_Guest';
    /** Not packaged: created in the org by credentialPermissionSetId(). */
    public static final String PAYMENT_CALLOUT_PERMISSION_SET = 'JForm_Payment_Credentials';
    private static final String CALLOUT_ACCESS_OBJECT = 'UserExternalCredential';
    private static final Integer MAX_LISTED = 25;

    public class Status {
        /** The running user may assign permission sets, so the grant buttons work. */
        @AuraEnabled public Boolean canAssign = false;
        @AuraEnabled public Boolean builderAccess = false;
        @AuraEnabled public Integer builderCount = 0;
        @AuraEnabled public List<UserRow> builders = new List<UserRow>();
        @AuraEnabled public Boolean experiencesEnabled = false;
        @AuraEnabled public List<SiteRow> sites = new List<SiteRow>();
        @AuraEnabled public Integer liveForms = 0;
        @AuraEnabled public Boolean agentInstalled = false;
        /** Booleans only: whether keys are present, never the keys. */
        @AuraEnabled public Boolean signingKeySet = false;
        @AuraEnabled public Boolean captchaSet = false;
        /** Wrong promotion codes are counted (the org has Platform Cache capacity for JForm), so codes cannot be guessed. */
        @AuraEnabled public Boolean codeLimitOn = false;
        /** The running user has Customize Application, so the key fields are offered. */
        @AuraEnabled public Boolean canManageKeys = false;
        /** The reCAPTCHA site key is public (every form page sends it to the browser); the secret and signing key are never returned. */
        @AuraEnabled public String siteKey;
        @AuraEnabled public Decimal minScore;
        /** Required steps done and total, for the checklist and the Home banner. */
        @AuraEnabled public Integer done = 0;
        @AuraEnabled public Integer total = 0;
    }

    public class UserRow {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String username;
    }

    public class SiteRow {
        /** The Experience Builder site record (the one the public link uses). */
        @AuraEnabled public Id id;
        @AuraEnabled public Id networkId;
        @AuraEnabled public String label;
        @AuraEnabled public String baseUrl;
        /** Network status: Live, UnderConstruction or DownForMaintenance. */
        @AuraEnabled public String status;
        /** The guest user has JForm Guest, so visitors can open forms and submit them. */
        @AuraEnabled public Boolean guestAccess = false;
        /** The guest user can read User External Credentials, so visitors can pay (see the class comment). */
        @AuraEnabled public Boolean guestCanPay = false;
        @AuraEnabled public Boolean likelyJForm = false;
    }

    @AuraEnabled
    public static Status getStatus() {
        try {
            return computeStatus();
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /**
     * The checklist state; also behind the Home page's "finish setup" banner, which every builder sees.
     * Permission set assignments, sites and networks are setup data that a builder without View Setup
     * cannot query, so these reads run in system mode; only counts, names and site labels are returned.
     * Granting access (assign, grantGuestAccess) stays in user mode.
     */
    public static Status computeStatus() {
        Status s = new Status();
        s.canAssign = Schema.SObjectType.PermissionSetAssignment.isCreateable();
        Id builderPs = permissionSetId(BUILDER_PERMISSION_SET);
        Id guestPs = permissionSetId(GUEST_PERMISSION_SET);
        if (builderPs != null) {
            s.builderAccess = [SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = :UserInfo.getUserId() AND PermissionSetId = :builderPs WITH SYSTEM_MODE] > 0;
            s.builderCount = [SELECT COUNT() FROM PermissionSetAssignment WHERE PermissionSetId = :builderPs AND Assignee.IsActive = true AND Assignee.UserType = 'Standard' WITH SYSTEM_MODE];
            for (PermissionSetAssignment a : [
                SELECT AssigneeId, Assignee.Name, Assignee.Username FROM PermissionSetAssignment
                WHERE PermissionSetId = :builderPs AND Assignee.IsActive = true AND Assignee.UserType = 'Standard'
                WITH SYSTEM_MODE
                ORDER BY Assignee.Name LIMIT :MAX_LISTED
            ]) {
                UserRow u = new UserRow();
                u.id = a.AssigneeId;
                u.name = a.Assignee.Name;
                u.username = a.Assignee.Username;
                s.builders.add(u);
            }
        }
        s.experiencesEnabled = JFormSchema.globalDescribe().containsKey('network');
        if (s.experiencesEnabled) {
            s.sites = experienceSites(guestPs);
        }
        // a count only; an admin without ACCESS_FORM_BUILDER (the checklist's first step) has no FLS on the field
        s.liveForms = [SELECT COUNT() FROM Form__c WHERE Is_Active__c = true WITH SYSTEM_MODE];
        s.agentInstalled = JFormGenerationService.agentInstalled();
        Protection_Settings__c p = Protection_Settings__c.getOrgDefaults();
        s.signingKeySet = p != null && String.isNotBlank(p.Signing_Key__c);
        s.captchaSet = p != null && String.isNotBlank(p.Site_Key__c) && String.isNotBlank(p.Secret__c);
        s.codeLimitOn = JFormPromotionCodeService.guessLimitOn();
        s.canManageKeys = canManageKeys();
        if (s.canManageKeys && p != null) {
            s.siteKey = p.Site_Key__c;
            s.minScore = p.Min_Score__c;
        }

        SiteRow site = s.sites.isEmpty() ? null : s.sites[0];
        List<Boolean> steps = new List<Boolean>{
            s.builderAccess,
            s.experiencesEnabled,
            site != null,
            site != null && site.guestAccess && site.guestCanPay,
            site != null && site.status == 'Live',
            s.liveForms > 0
        };
        s.total = steps.size();
        for (Boolean b : steps) {
            if (b) {
                s.done++;
            }
        }
        return s;
    }

    /**
     * Active standard users matching a name, username or email who do not have builder access yet.
     * "Jane Doe" also finds people in orgs whose locale shows names last name first.
     */
    @AuraEnabled
    public static List<UserRow> searchUsers(String term) {
        try {
            List<UserRow> out = new List<UserRow>();
            if (String.isBlank(term) || term.trim().length() < 2) {
                return out;
            }
            String t = term.trim();
            List<String> parts = t.split('\\s+');
            // bound below, so no escaping
            String needle = '%' + t + '%';
            String first = '%' + parts[0] + '%';
            String last = '%' + parts[parts.size() - 1] + '%';
            List<User> users = [
                SELECT Id, Name, Username FROM User
                WHERE IsActive = true AND UserType = 'Standard'
                AND (Name LIKE :needle OR Username LIKE :needle OR Email LIKE :needle
                    OR (FirstName LIKE :first AND LastName LIKE :last) OR (FirstName LIKE :last AND LastName LIKE :first))
                WITH USER_MODE
                ORDER BY Name LIMIT 40
            ];
            Set<Id> already = new Set<Id>();
            Id builderPs = permissionSetId(BUILDER_PERMISSION_SET);
            if (builderPs != null && !users.isEmpty()) {
                for (PermissionSetAssignment a : [SELECT AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId = :builderPs AND AssigneeId IN :users WITH USER_MODE]) {
                    already.add(a.AssigneeId);
                }
            }
            for (User u : users) {
                if (already.contains(u.Id) || out.size() >= 20) {
                    continue;
                }
                UserRow r = new UserRow();
                r.id = u.Id;
                r.name = u.Name;
                r.username = u.Username;
                out.add(r);
            }
            return out;
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /**
     * Give users builder access. Empty means the running user. Returns how many were added. Builders also get
     * the Stripe credentials (Check connection and the hourly payment check call Stripe as them).
     */
    @AuraEnabled
    public static Integer grantBuilderAccess(List<Id> userIds) {
        try {
            Set<Id> ids = (userIds == null || userIds.isEmpty()) ? new Set<Id>{ UserInfo.getUserId() } : new Set<Id>(userIds);
            Integer added = assign(BUILDER_PERMISSION_SET, ids);
            grantCredentialAccess(ids);
            return added;
        } catch (Exception e) {
            throw aura(friendly(e));
        }
    }

    /** Let a site's guest user load published forms, submit responses and pay. */
    @AuraEnabled
    public static Integer grantGuestAccess(Id siteId) {
        try {
            List<Site> sites = [SELECT GuestUserId FROM Site WHERE Id = :siteId WITH USER_MODE LIMIT 1];
            if (sites.isEmpty() || sites[0].GuestUserId == null) {
                throw new JFormDefinition.JFormException('That site has no guest user. Turn on guest access in Experience Builder (Settings > General) first.');
            }
            Set<Id> guest = new Set<Id>{ sites[0].GuestUserId };
            Integer added = assign(GUEST_PERMISSION_SET, guest);
            grantCredentialAccess(guest);
            return added;
        } catch (Exception e) {
            throw aura(friendly(e));
        }
    }

    /**
     * Save the reCAPTCHA keys. A blank secret keeps the stored one; a blank site key turns reCAPTCHA
     * off and clears the secret. A blank minimum score means the default (0.5).
     */
    @AuraEnabled
    public static void saveCaptchaKeys(String siteKey, String secret, Decimal minScore) {
        try {
            if (minScore != null && (minScore < 0 || minScore > 1)) {
                throw new JFormDefinition.JFormException('The minimum score must be between 0 and 1.');
            }
            Protection_Settings__c p = protectionSettings();
            p.Site_Key__c = String.isBlank(siteKey) ? null : siteKey.trim();
            if (p.Site_Key__c == null) {
                p.Secret__c = null;
            } else if (String.isNotBlank(secret)) {
                p.Secret__c = secret.trim();
            } else if (String.isBlank(p.Secret__c)) {
                throw new JFormDefinition.JFormException('Enter the secret that goes with the site key.');
            }
            p.Min_Score__c = minScore;
            saveProtectionSettings(p);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** Create a new random signing key for timing tokens. Forms opened before a replacement send tokens that no longer verify. */
    @AuraEnabled
    public static void generateSigningKey() {
        try {
            Protection_Settings__c p = protectionSettings();
            p.Signing_Key__c = EncodingUtil.convertToHex(Crypto.generateAesKey(256));
            saveProtectionSettings(p);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    // ------------------------------------------------------------ payments

    /** The Payments page: each mode's key and signing secret (whether saved, never the values) and webhook address. */
    public class PaymentSetup {
        @AuraEnabled public Boolean canManageKeys = false;
        @AuraEnabled public JFormPaymentService.ModeSetup testKeys;
        @AuraEnabled public JFormPaymentService.ModeSetup liveKeys;
        /** Sandboxes and scratch orgs take test payments only. */
        @AuraEnabled public Boolean sandbox = false;
        @AuraEnabled public Boolean checkScheduled = false;
        /** The events the webhook endpoint in Stripe must send. */
        @AuraEnabled public List<String> events = JFormStripeProvider.EVENTS;
        /** The Experience sites Stripe's events can go to, best first, and the one the webhook address is on. */
        @AuraEnabled public List<SiteRow> sites = new List<SiteRow>();
        @AuraEnabled public Id webhookSiteId;
    }

    @AuraEnabled
    public static PaymentSetup getPaymentSetup() {
        try {
            PaymentSetup p = new PaymentSetup();
            p.canManageKeys = canManageKeys();
            p.sandbox = JFormPaymentService.isSandbox();
            if (p.canManageKeys) {
                p.testKeys = JFormPaymentService.modeSetup(JFormPaymentService.TEST);
                p.liveKeys = JFormPaymentService.modeSetup(JFormPaymentService.LIVE);
                p.checkScheduled = JFormPaymentService.checkScheduled();
                if (JFormSchema.globalDescribe().containsKey('network')) {
                    p.sites = experienceSites(permissionSetId(GUEST_PERMISSION_SET));
                }
                JFormPaymentService.WebhookSite w = JFormPaymentService.webhookSite();
                p.webhookSiteId = w == null ? null : w.siteId;
            }
            return p;
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** The Experience site Stripe sends events to (one of PaymentSetup.sites); blank goes back to the first live one. */
    @AuraEnabled
    public static void savePaymentWebhookSite(Id siteId) {
        try {
            requireKeyAccess();
            if (siteId != null) {
                Boolean listed = false;
                for (SiteRow s : experienceSites(permissionSetId(GUEST_PERMISSION_SET))) {
                    listed = listed || s.id == siteId;
                }
                if (!listed) {
                    throw new JFormDefinition.JFormException('Pick one of the org\'s Experience sites.');
                }
            }
            JFormPaymentService.saveWebhookSite(siteId);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** Save a Stripe secret key for test or live payments; blank removes it. */
    @AuraEnabled
    public static void savePaymentKey(String mode, String secretKey) {
        try {
            requireKeyAccess();
            JFormPaymentService.saveKey(paymentMode(mode), secretKey);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** Save the webhook signing secret for test or live payments; blank removes it. */
    @AuraEnabled
    public static void savePaymentWebhookSecret(String mode, String secret) {
        try {
            requireKeyAccess();
            JFormPaymentService.saveWebhookSecret(paymentMode(mode), secret);
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    /** Ask Stripe whether the key works and the webhook address is registered for the seven events. */
    @AuraEnabled
    public static JFormPaymentService.ConnectionCheck checkPaymentConnection(String mode) {
        try {
            requireKeyAccess();
            return JFormPaymentService.checkConnection(paymentMode(mode));
        } catch (Exception e) {
            throw aura(e.getMessage());
        }
    }

    private static String paymentMode(String mode) {
        if ('live'.equalsIgnoreCase(mode)) {
            if (JFormPaymentService.isSandbox()) {
                throw new JFormDefinition.JFormException('This org is a sandbox or scratch org, so it takes test payments only.');
            }
            return JFormPaymentService.LIVE;
        }
        return JFormPaymentService.TEST;
    }

    private static void requireKeyAccess() {
        if (!canManageKeys()) {
            throw new JFormDefinition.JFormException('You need the "Customize Application" permission to change the Stripe keys. Ask a Salesforce admin to do this step.');
        }
    }

    // ------------------------------------------------------------ helpers

    /** Customize Application, from the profile or any assigned permission set. */
    @TestVisible
    private static Boolean canManageKeys() {
        return [
            SELECT COUNT() FROM PermissionSetAssignment
            WHERE AssigneeId = :UserInfo.getUserId() AND PermissionSet.PermissionsCustomizeApplication = true
            WITH SYSTEM_MODE
        ] > 0;
    }

    /** The org default, or a new one to insert. */
    private static Protection_Settings__c protectionSettings() {
        if (!canManageKeys()) {
            throw new JFormDefinition.JFormException('You need the "Customize Application" permission to change the spam protection keys. Ask a Salesforce admin to do this step.');
        }
        Protection_Settings__c p = Protection_Settings__c.getOrgDefaults();
        if (p == null || p.Id == null) {
            p = new Protection_Settings__c(SetupOwnerId = UserInfo.getOrganizationId());
        }
        return p;
    }

    /**
     * Protected settings of an installed package are writable only from the package's own code and
     * not by the subscriber in user mode, so this write runs in system mode after the Customize
     * Application check in protectionSettings().
     */
    private static void saveProtectionSettings(Protection_Settings__c p) {
        Database.upsert(p, AccessLevel.SYSTEM_MODE);
    }


    private static Integer assign(String permissionSetName, Set<Id> userIds) {
        Id psId = permissionSetId(permissionSetName);
        if (psId == null) {
            throw new JFormDefinition.JFormException('The ' + permissionSetName + ' permission set was not found. Reinstall JForm.');
        }
        Set<Id> already = new Set<Id>();
        for (PermissionSetAssignment a : [SELECT AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId = :psId AND AssigneeId IN :userIds WITH USER_MODE]) {
            already.add(a.AssigneeId);
        }
        List<PermissionSetAssignment> toInsert = new List<PermissionSetAssignment>();
        for (Id u : userIds) {
            if (!already.contains(u)) {
                toInsert.add(new PermissionSetAssignment(AssigneeId = u, PermissionSetId = psId));
            }
        }
        if (!toInsert.isEmpty()) {
            Database.insert(toInsert, AccessLevel.USER_MODE);
        }
        return toInsert.size();
    }

    /**
     * Give the users who cannot read User External Credentials the org's JForm Payment Credentials permission set,
     * creating it first if needed. Users who already can (System Administrators, JForm Guest deployed from source,
     * a grant made by hand) are left alone. Returns how many were given it.
     */
    @TestVisible
    private static Integer grantCredentialAccess(Set<Id> userIds) {
        Set<Id> without = new Set<Id>(userIds);
        without.removeAll(usersWithCredentialRead(userIds));
        if (without.isEmpty()) {
            return 0;
        }
        Id psId = credentialPermissionSetId();
        List<PermissionSetAssignment> toInsert = new List<PermissionSetAssignment>();
        for (Id u : without) {
            toInsert.add(new PermissionSetAssignment(AssigneeId = u, PermissionSetId = psId));
        }
        Database.insert(toInsert, AccessLevel.USER_MODE);
        return toInsert.size();
    }

    /**
     * The users among these who can read User External Credentials, from their profile, a permission set or a
     * permission set group: every one of these is a permission set the user is assigned. System mode, as in
     * computeStatus(), for builders without View Setup.
     */
    @TestVisible
    private static Set<Id> usersWithCredentialRead(Set<Id> userIds) {
        Set<Id> out = new Set<Id>();
        if (userIds == null || userIds.isEmpty()) {
            return out;
        }
        for (PermissionSetAssignment a : [
            SELECT AssigneeId FROM PermissionSetAssignment
            WHERE AssigneeId IN :userIds
            AND PermissionSetId IN (SELECT ParentId FROM ObjectPermissions WHERE SobjectType = :CALLOUT_ACCESS_OBJECT AND PermissionsRead = true)
            WITH SYSTEM_MODE
        ]) {
            out.add(a.AssigneeId);
        }
        return out;
    }

    /**
     * The org's JForm Payment Credentials permission set, with Read on User External Credentials. Created in user
     * mode the first time, so it needs Manage Profiles and Permission Sets; the Read is put back if it was removed.
     */
    @TestVisible
    private static Id credentialPermissionSetId() {
        Id psId;
        // an installed package's code creates it without a namespace; a namespaced scratch org may give it jform's
        String ns = String.isBlank(JFormNamespace.NAME) ? null : JFormNamespace.NAME;
        for (PermissionSet ps : [
            SELECT Id FROM PermissionSet
            WHERE Name = :PAYMENT_CALLOUT_PERMISSION_SET AND (NamespacePrefix = null OR NamespacePrefix = :ns) AND IsOwnedByProfile = false
            WITH SYSTEM_MODE ORDER BY NamespacePrefix NULLS FIRST LIMIT 1
        ]) {
            psId = ps.Id;
        }
        if (psId == null) {
            PermissionSet ps = new PermissionSet(
                Name = PAYMENT_CALLOUT_PERMISSION_SET,
                Label = 'JForm Payment Credentials',
                Description = 'Created by JForm. Read on User External Credentials, which Salesforce needs before a Stripe callout can use the key saved in JForm\'s credentials. Packaged permission sets cannot include it.'
            );
            Database.insert(ps, AccessLevel.USER_MODE);
            psId = ps.Id;
        }
        List<ObjectPermissions> rows = [SELECT Id, PermissionsRead FROM ObjectPermissions WHERE ParentId = :psId AND SobjectType = :CALLOUT_ACCESS_OBJECT WITH SYSTEM_MODE LIMIT 1];
        if (rows.isEmpty()) {
            Database.insert(new ObjectPermissions(ParentId = psId, SobjectType = CALLOUT_ACCESS_OBJECT, PermissionsRead = true), AccessLevel.USER_MODE);
        } else if (rows[0].PermissionsRead != true) {
            rows[0].PermissionsRead = true;
            Database.update(rows[0], AccessLevel.USER_MODE);
        }
        return psId;
    }

    /** The package's permission set (namespaced in a subscriber org); system mode so builders without View Setup can resolve it. */
    @TestVisible
    private static Id permissionSetId(String name) {
        String ns = String.isBlank(JFormNamespace.NAME) ? null : JFormNamespace.NAME;
        for (PermissionSet ps : [SELECT Id FROM PermissionSet WHERE Name = :name AND NamespacePrefix = :ns WITH SYSTEM_MODE LIMIT 1]) {
            return ps.Id;
        }
        return null;
    }

    /**
     * One row per Experience site, best first (the order JFormChannelService uses for public links).
     * A site has two Site records sharing a guest user; the network is matched by URL prefix.
     */
    private static List<SiteRow> experienceSites(Id guestPs) {
        Map<String, SObject> networkByPrefix = new Map<String, SObject>();
        for (SObject n : Database.query('SELECT Id, Name, UrlPathPrefix, Status FROM Network', AccessLevel.SYSTEM_MODE)) {
            String prefix = (String) n.get('UrlPathPrefix');
            networkByPrefix.put(prefix == null ? '' : prefix.toLowerCase(), n);
        }
        Map<Id, Site> byId = new Map<Id, Site>([SELECT Id, Name, MasterLabel, UrlPathPrefix, SiteType, GuestUserId FROM Site WHERE SiteType IN ('ChatterNetwork', 'ChatterNetworkPicasso') WITH SYSTEM_MODE]);
        Map<Id, SObject> networkByGuest = new Map<Id, SObject>();
        Set<Id> guestIds = new Set<Id>();
        for (Site st : byId.values()) {
            if (st.GuestUserId == null) {
                continue;
            }
            guestIds.add(st.GuestUserId);
            String prefix = st.UrlPathPrefix == null ? '' : st.UrlPathPrefix.toLowerCase();
            if (st.SiteType == 'ChatterNetwork' && networkByPrefix.containsKey(prefix)) {
                networkByGuest.put(st.GuestUserId, networkByPrefix.get(prefix));
            }
        }
        Set<Id> guestsWithAccess = new Set<Id>();
        if (guestPs != null && !guestIds.isEmpty()) {
            for (PermissionSetAssignment a : [SELECT AssigneeId FROM PermissionSetAssignment WHERE PermissionSetId = :guestPs AND AssigneeId IN :guestIds WITH SYSTEM_MODE]) {
                guestsWithAccess.add(a.AssigneeId);
            }
        }
        Set<Id> guestsWhoCanPay = usersWithCredentialRead(guestIds);
        List<SiteRow> out = new List<SiteRow>();
        Set<Id> seenGuests = new Set<Id>();
        for (JFormChannelService.SiteOption o : JFormChannelService.getSites()) {
            Site st = byId.get(o.id);
            if (st == null || o.isExperienceSite != true || (st.GuestUserId != null && seenGuests.contains(st.GuestUserId))) {
                continue;
            }
            if (st.GuestUserId != null) {
                seenGuests.add(st.GuestUserId);
            }
            SiteRow r = new SiteRow();
            r.id = o.id;
            r.label = o.label;
            r.baseUrl = o.baseUrl;
            SObject n = st.GuestUserId == null ? null : networkByGuest.get(st.GuestUserId);
            r.networkId = n == null ? null : (Id) n.get('Id');
            r.status = n == null ? (o.isLive == true ? 'Live' : 'UnderConstruction') : (String) n.get('Status');
            r.guestAccess = st.GuestUserId != null && guestsWithAccess.contains(st.GuestUserId);
            r.guestCanPay = st.GuestUserId != null && guestsWhoCanPay.contains(st.GuestUserId);
            r.likelyJForm = (o.label != null && o.label.toLowerCase().contains('jform')) || (o.name != null && o.name.toLowerCase().contains('jform'));
            out.add(r);
        }
        return out;
    }

    private static String friendly(Exception e) {
        String m = e.getMessage();
        if (m != null && (m.contains('INSUFFICIENT_ACCESS') || m.contains('insufficient access'))) {
            return 'You need the "Assign Permission Sets" permission to grant access, and "Manage Profiles and Permission Sets" the first time, '
                + 'when JForm creates the JForm Payment Credentials permission set. Ask a Salesforce admin to do this step.';
        }
        return m;
    }

    private static AuraHandledException aura(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }
}
