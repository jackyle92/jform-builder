@IsTest
private class JFormChannelServiceTest {

    @IsTest
    static void buildsBaseUrls() {
        Assert.areEqual('https://acme.my.site.com/jform', JFormChannelService.buildBaseUrl('acme.my.site.com', '/jform'));
        Assert.areEqual('https://acme.my.site.com/jform', JFormChannelService.buildBaseUrl('acme.my.site.com', 'jform/'));
        Assert.areEqual('https://acme.my.site.com', JFormChannelService.buildBaseUrl('acme.my.site.com', null));
        Assert.isNull(JFormChannelService.buildBaseUrl(null, '/x'));
    }

    @IsTest
    static void listsSitesWithoutFailing() {
        // Sites are org configuration, so the list may be empty in a scratch org; the call must still succeed.
        List<JFormChannelService.SiteOption> sites = JFormChannelService.getSites();
        Assert.isNotNull(sites);
        for (JFormChannelService.SiteOption s : sites) {
            Assert.isTrue(s.baseUrl.startsWith('https://'), s.baseUrl);
            Assert.isNotNull(s.isExperienceSite);
        }
    }

    @IsTest
    static void buildersWithoutViewSetupSeeTheSameSites() {
        // the site queries run in system mode so a builder whose profile lacks View Setup still gets the public links
        Integer adminCount = JFormChannelService.getSites().size();
        User builder = JFormTestDataFactory.builderWithoutViewSetup();
        System.runAs(builder) {
            Assert.areEqual(adminCount, JFormChannelService.getSites().size(), 'builder sees every site the admin sees');
        }
    }

    @IsTest
    static void listsEveryDomainOfTheActiveSites() {
        // a site is reached on each of its domains, not only the one getSites names as its address
        Set<String> expected = new Set<String>();
        for (DomainSite ds : [SELECT Domain.Domain FROM DomainSite WHERE Site.Status = 'Active']) {
            expected.add(ds.Domain.Domain.toLowerCase());
        }
        Set<String> hosts = JFormChannelService.siteHosts();
        Assert.areEqual(expected, hosts);
        for (JFormChannelService.SiteOption s : JFormChannelService.getSites()) {
            Assert.isTrue(hosts.contains(new Url(s.baseUrl).getHost().toLowerCase()), s.baseUrl);
        }
        System.runAs(JFormTestDataFactory.builderWithoutViewSetup()) {
            Assert.areEqual(expected, JFormChannelService.siteHosts(), 'read in system mode, like the sites');
        }
    }

    private static JFormChannelService.SiteOption site(String name, String siteType, Boolean live) {
        JFormChannelService.SiteOption o = new JFormChannelService.SiteOption();
        o.name = name;
        o.label = name;
        o.siteType = siteType;
        o.isExperienceSite = siteType == 'ChatterNetworkPicasso' || siteType == 'ChatterNetwork';
        o.isLive = live;
        o.baseUrl = 'https://x.my.site.com/' + name;
        return o;
    }

    @IsTest
    static void prefersLiveBuilderSitesAndJFormSites() {
        List<JFormChannelService.SiteOption> sorted = JFormChannelService.sortByPreference(new List<JFormChannelService.SiteOption>{
            site('Coral_Cloud', 'ChatterNetwork', false),
            site('Coral_Cloud1', 'ChatterNetworkPicasso', false),
            site('Portal', 'ChatterNetworkPicasso', true),
            site('jform', 'ChatterNetwork', true),
            site('jform1', 'ChatterNetworkPicasso', true),
            site('Public', 'Visualforce', true)
        });
        List<String> names = new List<String>();
        for (JFormChannelService.SiteOption o : sorted) {
            names.add(o.name);
        }
        Assert.areEqual(new List<String>{ 'jform1', 'Portal', 'jform', 'Coral_Cloud', 'Coral_Cloud1', 'Public' }, names);
    }
}
