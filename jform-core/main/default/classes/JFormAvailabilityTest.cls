@IsTest
private class JFormAvailabilityTest {

    private static JFormDefinition.Form withAccess(Map<String, Object> access) {
        JFormDefinition.Form def = new JFormDefinition.Form();
        def.settings = new Map<String, Object>{ 'access' => access };
        return def;
    }

    @IsTest
    static void opensAndClosesAtTheStoredMoments() {
        Datetime now = Datetime.newInstanceGmt(2027, 1, 12, 17, 0, 0);
        JFormDefinition.Form def = withAccess(new Map<String, Object>{ 'openAt' => '2027-01-12T17:00:00.000Z', 'closeAt' => '2027-03-31T09:00:00-07:00' });

        Assert.areEqual(JFormAvailability.NOT_OPEN, JFormAvailability.stateOf(def, now.addSeconds(-1)));
        Assert.isNull(JFormAvailability.stateOf(def, now), 'open from the opening moment');
        Assert.isNull(JFormAvailability.stateOf(def, Datetime.newInstanceGmt(2027, 3, 31, 15, 59, 59)));
        Assert.areEqual(JFormAvailability.CLOSED, JFormAvailability.stateOf(def, Datetime.newInstanceGmt(2027, 3, 31, 16, 0, 0)), 'closed from the closing moment');
        Assert.areEqual(Datetime.newInstanceGmt(2027, 3, 31, 16, 0, 0), JFormAvailability.closesAt(def));
        Assert.isNull(JFormAvailability.stateOf(new JFormDefinition.Form(), now));
        Assert.isNull(JFormAvailability.closesAt(new JFormDefinition.Form()));
    }

    @IsTest
    static void unreadableTimesAreIgnoredAndRefusedOnSave() {
        JFormDefinition.Form def = withAccess(new Map<String, Object>{ 'openAt' => '12 Jan 2027', 'closeAt' => '2027-01-12', 'timeZone' => 'Mars/Base' });
        Assert.isNull(JFormAvailability.stateOf(def, Datetime.now()), 'an unreadable time never locks the form');
        List<String> problems = JFormAvailability.problems(def);
        Assert.areEqual(3, problems.size(), String.join(problems, ' | '));
        Assert.isTrue(problems[2].contains('Mars/Base'));

        def = withAccess(new Map<String, Object>{ 'openAt' => '2027-02-01T00:00:00Z', 'closeAt' => '2027-01-01T00:00:00Z', 'timeZone' => 'Australia/Sydney' });
        Assert.areEqual(new List<String>{ 'The form must close after it opens.' }, JFormAvailability.problems(def));
        Assert.isTrue(JFormAvailability.problems(withAccess(new Map<String, Object>{ 'openAt' => '2027-02-01T00:00:00Z', 'timeZone' => 'UTC' })).isEmpty());
        Assert.areEqual(
            new List<String>{ 'Pick the time zone the opening and closing times are in.' },
            JFormAvailability.problems(withAccess(new Map<String, Object>{ 'openAt' => '2027-02-01T00:00:00Z' })),
            'times are read in a zone the builder picked, never the guest user\'s'
        );
    }

    @IsTest
    static void theOpeningCanNotComeAfterTheOlderLastDay() {
        // 1 February 01:00 in Sydney is still 31 January in UTC: the day is the form's
        Map<String, Object> access = new Map<String, Object>{ 'openAt' => '2027-01-31T14:00:00Z', 'timeZone' => 'Australia/Sydney', 'closeDate' => '2027-01-31' };
        Assert.areEqual(
            new List<String>{ 'The form opens after its last day to respond. Remove the last day or pick a closing time.' },
            JFormAvailability.problems(withAccess(access))
        );
        access.put('closeDate', '2027-02-01');
        Assert.isTrue(JFormAvailability.problems(withAccess(access)).isEmpty(), 'opening on its last day is fine');
        access.put('closeDate', '2027-01-01');
        access.put('closeAt', '2027-03-01T00:00:00Z');
        Assert.isTrue(JFormAvailability.problems(withAccess(access)).isEmpty(), 'a closing time replaces the last day');
    }

    @IsTest
    static void saysWhetherAnOpenFormMayClose() {
        Assert.isFalse(JFormAvailability.mayClose(new JFormDefinition.Form()));
        Assert.isFalse(JFormAvailability.mayClose(withAccess(new Map<String, Object>{ 'openAt' => '2027-01-12T17:00:00Z', 'closeDate' => 'soon' })));
        Assert.isTrue(JFormAvailability.mayClose(withAccess(new Map<String, Object>{ 'closeAt' => '2027-01-12T17:00:00Z' })));
        Assert.isTrue(JFormAvailability.mayClose(withAccess(new Map<String, Object>{ 'closeDate' => '2027-01-12' })));
        Assert.isTrue(JFormAvailability.mayClose(withAccess(new Map<String, Object>{ 'responseLimit' => 10 })));
    }

    @IsTest
    static void theOlderCloseDateCountsOnlyWithoutAClosingTime() {
        String yesterday = String.valueOf(Date.today().addDays(-1));
        Assert.areEqual(JFormAvailability.CLOSED, JFormAvailability.stateOf(withAccess(new Map<String, Object>{ 'closeDate' => yesterday }), Datetime.now()));
        Assert.isNull(JFormAvailability.stateOf(withAccess(new Map<String, Object>{ 'closeDate' => String.valueOf(Date.today()) }), Datetime.now()), 'open through its last day');
        Assert.isNull(JFormAvailability.stateOf(withAccess(new Map<String, Object>{ 'closeDate' => 'soon' }), Datetime.now()));
        Assert.areEqual(
            Datetime.newInstance(Date.today().addDays(1), Time.newInstance(0, 0, 0, 0)),
            JFormAvailability.closesAt(withAccess(new Map<String, Object>{ 'closeDate' => String.valueOf(Date.today()) })),
            'closed from the start of the next day'
        );
        Assert.isNull(JFormAvailability.closesAt(withAccess(new Map<String, Object>{ 'closeDate' => 'soon' })));
        JFormDefinition.Form def = withAccess(new Map<String, Object>{ 'closeDate' => yesterday, 'closeAt' => Datetime.now().addDays(1).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'') });
        Assert.isNull(JFormAvailability.stateOf(def, Datetime.now()), 'the closing time replaces the day');
    }

    @IsTest
    static void saysWhenItOpensInTheFormsTimeZone() {
        JFormDefinition.Form def = withAccess(new Map<String, Object>{ 'openAt' => '2027-01-12T17:00:00Z', 'timeZone' => 'America/Los_Angeles' });
        Assert.areEqual('Tuesday 12 January 2027 at 9:00 AM GMT-08:00', JFormAvailability.opensText(def));
        Assert.areEqual('This form is not open yet. It opens on Tuesday 12 January 2027 at 9:00 AM GMT-08:00.', JFormAvailability.messageFor(def, JFormAvailability.NOT_OPEN));
        def.settings.put('access', new Map<String, Object>{ 'openAt' => '2027-07-12T17:00:00Z', 'timeZone' => 'Asia/Kolkata' });
        Assert.areEqual('Monday 12 July 2027 at 10:30 PM GMT+05:30', JFormAvailability.opensText(def));
        def.settings.put('access', new Map<String, Object>{ 'openAt' => '2027-01-12T17:00:00Z', 'timeZone' => 'Australia/Sydney' });
        Assert.areEqual('Wednesday 13 January 2027 at 4:00 AM GMT+11:00', JFormAvailability.opensText(def));
        Assert.areEqual('GMT', JFormAvailability.gmtOffset(0));
        // noon and midnight, and a site guest user in another language: still English, as the sentence around it
        User german = JFormTestDataFactory.plainUser('Deutsch');
        german.LocaleSidKey = 'de_DE';
        german.LanguageLocaleKey = 'de';
        update german;
        System.runAs(german) {
            def.settings.put('access', new Map<String, Object>{ 'openAt' => '2027-01-12T12:00:00Z', 'timeZone' => 'Europe/London' });
            Assert.areEqual('Tuesday 12 January 2027 at 12:00 PM GMT', JFormAvailability.opensText(def));
            def.settings.put('access', new Map<String, Object>{ 'openAt' => '2027-01-12T08:00:00Z', 'timeZone' => 'Asia/Singapore' });
            Assert.areEqual('Tuesday 12 January 2027 at 4:00 PM GMT+08:00', JFormAvailability.opensText(def));
            def.settings.put('access', new Map<String, Object>{ 'openAt' => '2027-01-11T16:00:00Z', 'timeZone' => 'Asia/Singapore' });
            Assert.areEqual('Tuesday 12 January 2027 at 12:00 AM GMT+08:00', JFormAvailability.opensText(def));
        }
        def.settings.put('access', new Map<String, Object>{ 'openAt' => '2027-01-12T17:00:00Z', 'timeZone' => 'Australia/Sydney' });

        Map<String, Object> view = JFormAvailability.publicView(def, JFormAvailability.NOT_OPEN);
        Assert.areEqual('2027-01-12T17:00:00Z', view.get('opensAt'));
        Assert.areEqual('notOpen', view.get('state'));
        Assert.isFalse(view.containsKey('title'));
    }

    @IsTest
    static void theClosedMessageAndTheLimit() {
        Assert.areEqual(JFormAvailability.CLOSED_DEFAULT, JFormAvailability.messageFor(withAccess(new Map<String, Object>()), JFormAvailability.CLOSED));
        JFormDefinition.Form def = withAccess(new Map<String, Object>{ 'closed' => new Map<String, Object>{ 'message' => '<p>Closed for <b>2027</b>.</p>' }, 'closedMessage' => 'Older' });
        Assert.areEqual('Closed for 2027.', JFormAvailability.messageFor(def, JFormAvailability.CLOSED), 'the screen message wins over the older one');
        def = withAccess(new Map<String, Object>{ 'closed' => new Map<String, Object>{ 'message' => '<p>&nbsp;</p>' } });
        Assert.areEqual(JFormAvailability.CLOSED_DEFAULT, JFormAvailability.messageFor(def, JFormAvailability.CLOSED), 'a message of only spaces is no message');

        Assert.areEqual(5, JFormAvailability.responseLimit(withAccess(new Map<String, Object>{ 'responseLimit' => 5 })));
        Assert.isNull(JFormAvailability.responseLimit(withAccess(new Map<String, Object>{ 'responseLimit' => 0 })));
        Assert.isNull(JFormAvailability.responseLimit(withAccess(new Map<String, Object>{ 'responseLimit' => 'many' })));
        Assert.isNull(JFormAvailability.responseLimit(new JFormDefinition.Form()));
    }
}
