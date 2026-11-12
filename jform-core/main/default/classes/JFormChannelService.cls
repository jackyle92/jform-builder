/**
 * Where a published form can be reached: Experience Cloud sites and their
 * domains. URL assembly itself happens in the Share dialog from these parts
 * plus the form's publish settings (site and page path).
 */
public with sharing class JFormChannelService {

    public class SiteOption {
        @AuraEnabled public Id id;
        @AuraEnabled public String name;
        @AuraEnabled public String label;
        @AuraEnabled public String siteType;
        @AuraEnabled public String baseUrl;
        @AuraEnabled public Boolean isExperienceSite;
        /** False when the site's Experience Cloud community is not Live (for example Under Construction). */
        @AuraEnabled public Boolean isLive;
    }

    /**
     * Active sites with a domain mapping, best default first: live Experience
     * Builder sites, then live Visualforce community sites, then sites whose
     * community is not live, then other sites. Within a group, sites named
     * like the shipped JForm site come first. Callers that take the first
     * Experience site as the default (the Share dialog, agent links) rely on
     * this order.
     *
     * Reads site configuration (names, URL prefixes, domains) in system mode on purpose: every
     * builder needs the public link, and Site is not readable without View Setup and Configuration.
     * No record data is returned.
     */
    public static List<SiteOption> getSites() {
        Map<String, String> networkStatusByPrefix = new Map<String, String>();
        // Network exists only where Digital Experiences is enabled; a static query would make that a
        // requirement for installing the package, so it is queried dynamically and skipped when absent.
        if (JFormSchema.globalDescribe().containsKey('network')) {
            for (SObject n : Database.query('SELECT UrlPathPrefix, Status FROM Network', AccessLevel.SYSTEM_MODE)) {
                String prefix = (String) n.get('UrlPathPrefix');
                networkStatusByPrefix.put(prefix == null ? '' : prefix.toLowerCase(), (String) n.get('Status'));
            }
        }
        List<Site> sites = [SELECT Id, Name, MasterLabel, UrlPathPrefix, SiteType, Status, GuestUserId FROM Site WHERE Status = 'Active' WITH SYSTEM_MODE ORDER BY Name];
        // Both site records of a community (Visualforce and Experience Builder) share its guest user;
        // the Visualforce one shares the community's URL prefix.
        Map<Id, String> networkStatusByGuest = new Map<Id, String>();
        for (Site s : sites) {
            String prefix = s.UrlPathPrefix == null ? '' : s.UrlPathPrefix.toLowerCase();
            if (s.SiteType == 'ChatterNetwork' && s.GuestUserId != null && networkStatusByPrefix.containsKey(prefix)) {
                networkStatusByGuest.put(s.GuestUserId, networkStatusByPrefix.get(prefix));
            }
        }
        Map<Id, SiteOption> byId = new Map<Id, SiteOption>();
        for (Site s : sites) {
            SiteOption o = new SiteOption();
            o.id = s.Id;
            o.name = s.Name;
            o.label = String.isBlank(s.MasterLabel) ? s.Name : s.MasterLabel;
            o.siteType = s.SiteType;
            o.isExperienceSite = s.SiteType == 'ChatterNetworkPicasso' || s.SiteType == 'ChatterNetwork';
            String networkStatus = s.GuestUserId == null ? null : networkStatusByGuest.get(s.GuestUserId);
            o.isLive = !o.isExperienceSite || networkStatus == null || networkStatus == 'Live';
            byId.put(s.Id, o);
        }
        if (byId.isEmpty()) {
            return new List<SiteOption>();
        }
        for (DomainSite ds : [SELECT SiteId, PathPrefix, Domain.Domain, Domain.HttpsOption FROM DomainSite WHERE SiteId IN :byId.keySet() WITH SYSTEM_MODE ORDER BY Domain.Domain]) {
            SiteOption o = byId.get(ds.SiteId);
            if (o != null && String.isBlank(o.baseUrl)) {
                o.baseUrl = buildBaseUrl(ds.Domain.Domain, ds.PathPrefix);
            }
        }
        List<SiteOption> out = new List<SiteOption>();
        for (SiteOption o : byId.values()) {
            if (String.isNotBlank(o.baseUrl)) {
                out.add(o);
            }
        }
        return sortByPreference(out);
    }

    /**
     * Every domain the active sites answer on, lowercased. A site served on its *.my.site.com domain and
     * on a custom one is reached on both, while getSites names one address per site; checks that a page
     * is one of the org's (the payment return address, the reCAPTCHA token's host) need them all. Read in
     * system mode for the same reason as getSites; no record data is returned.
     */
    public static Set<String> siteHosts() {
        Set<String> hosts = new Set<String>();
        for (DomainSite ds : [SELECT Domain.Domain FROM DomainSite WHERE Site.Status = 'Active' WITH SYSTEM_MODE]) {
            if (String.isNotBlank(ds.Domain.Domain)) {
                hosts.add(ds.Domain.Domain.toLowerCase());
            }
        }
        return hosts;
    }

    /** Stable sort by default preference (see getSites). */
    @TestVisible
    private static List<SiteOption> sortByPreference(List<SiteOption> sites) {
        Map<String, List<SiteOption>> byRank = new Map<String, List<SiteOption>>();
        for (SiteOption o : sites) {
            String rank = String.valueOf(rankOf(o)) + (isJFormName(o) ? '0' : '1');
            if (!byRank.containsKey(rank)) {
                byRank.put(rank, new List<SiteOption>());
            }
            byRank.get(rank).add(o);
        }
        List<String> ranks = new List<String>(byRank.keySet());
        ranks.sort();
        List<SiteOption> out = new List<SiteOption>();
        for (String r : ranks) {
            out.addAll(byRank.get(r));
        }
        return out;
    }

    private static Integer rankOf(SiteOption o) {
        if (o.isExperienceSite != true) {
            return 4;
        }
        Boolean builder = o.siteType == 'ChatterNetworkPicasso';
        if (o.isLive != false) {
            return builder ? 1 : 2;
        }
        return 3;
    }

    private static Boolean isJFormName(SiteOption o) {
        return (o.name != null && o.name.toLowerCase().startsWith('jform')) || (o.label != null && o.label.toLowerCase().startsWith('jform'));
    }

    @TestVisible
    private static String buildBaseUrl(String domain, String pathPrefix) {
        if (String.isBlank(domain)) {
            return null;
        }
        String prefix = String.isBlank(pathPrefix) ? '' : (pathPrefix.startsWith('/') ? pathPrefix : '/' + pathPrefix);
        return 'https://' + domain + prefix.removeEnd('/');
    }
}
