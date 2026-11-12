@IsTest
private class JFormSetupControllerTest {

    @IsTest
    static void statusCountsTheSixSteps() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormSetupController.Status before = JFormSetupController.getStatus();
            Assert.areEqual(6, before.total);
            Assert.isTrue(before.builderAccess, 'the builder has the permission set');
            Assert.isTrue(before.builderCount >= 1);
            Assert.areEqual(0, before.liveForms);
            Assert.isNotNull(before.builders);

            JFormTestDataFactory.createAndPublish('Setup live');
            JFormSetupController.Status after = JFormSetupController.getStatus();
            Assert.areEqual(1, after.liveForms);
            Assert.areEqual(before.done + 1, after.done, 'a live form ticks the last step');
        }
    }

    @IsTest
    static void statusWorksForBuildersWithoutViewSetup() {
        // the Home page banner calls this for every builder; it must not need setup rights
        System.runAs(JFormTestDataFactory.builderWithoutViewSetup()) {
            JFormSetupController.Status status = JFormSetupController.getStatus();
            Assert.isTrue(status.builderAccess, 'the builder has the permission set');
            Assert.areEqual(6, status.total);
        }
    }

    @IsTest
    static void adminGrantsBuilderAccessOnce() {
        User plain = JFormTestDataFactory.plainUser('Grantee');
        Assert.areEqual(1, JFormSetupController.grantBuilderAccess(new List<Id>{ plain.Id }));
        Assert.areEqual(0, JFormSetupController.grantBuilderAccess(new List<Id>{ plain.Id }), 'granting twice adds nothing');
        Id ps = JFormSetupController.permissionSetId(JFormSetupController.BUILDER_PERMISSION_SET);
        Assert.areEqual(1, [SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = :plain.Id AND PermissionSetId = :ps]);
        Integer self = JFormSetupController.grantBuilderAccess(null);
        Assert.isTrue(self == 0 || self == 1, 'an empty list means the running user');
    }

    @IsTest
    static void builderAccessIncludesTheStripeCredentials() {
        User plain = JFormTestDataFactory.plainUser('Payer');
        JFormSetupController.grantBuilderAccess(new List<Id>{ plain.Id });
        // from ACCESS_FORM_BUILDER where it carries the Read (deployed from source), else from JForm Payment Credentials
        Assert.isTrue(JFormSetupController.usersWithCredentialRead(new Set<Id>{ plain.Id }).contains(plain.Id), 'the builder can use the Stripe credentials');
    }

    @IsTest
    static void credentialPermissionSetGoesOnlyToUsersWithoutTheRead() {
        User plain = JFormTestDataFactory.plainUser('Guestlike');
        Set<Id> ids = new Set<Id>{ plain.Id };
        Boolean already = JFormSetupController.usersWithCredentialRead(ids).contains(plain.Id);
        Assert.areEqual(already ? 0 : 1, JFormSetupController.grantCredentialAccess(ids), 'only a user without the Read is given the permission set');
        Assert.isTrue(JFormSetupController.usersWithCredentialRead(ids).contains(plain.Id), 'the user can read User External Credentials now');
        Assert.areEqual(0, JFormSetupController.grantCredentialAccess(ids), 'granting twice adds nothing');
        Assert.areEqual(0, JFormSetupController.grantCredentialAccess(new Set<Id>()), 'nobody to grant');
        Assert.isTrue(JFormSetupController.usersWithCredentialRead(null).isEmpty());
    }

    @IsTest
    static void createsTheCredentialPermissionSetOnceAndKeepsItsRead() {
        Id first = JFormSetupController.credentialPermissionSetId();
        Assert.areEqual(1, [SELECT COUNT() FROM ObjectPermissions WHERE ParentId = :first AND SobjectType = 'UserExternalCredential' AND PermissionsRead = true]);
        // an admin took the Read off by hand: it comes back, on the same permission set
        delete [SELECT Id FROM ObjectPermissions WHERE ParentId = :first AND SobjectType = 'UserExternalCredential'];
        Assert.areEqual(first, JFormSetupController.credentialPermissionSetId());
        Assert.areEqual(1, [SELECT COUNT() FROM ObjectPermissions WHERE ParentId = :first AND SobjectType = 'UserExternalCredential' AND PermissionsRead = true]);
        Assert.areEqual(1, [SELECT COUNT() FROM PermissionSet WHERE Name = :JFormSetupController.PAYMENT_CALLOUT_PERMISSION_SET]);
    }

    @IsTest
    static void builderWithoutAssignRightsGetsAPlainMessage() {
        User plain = JFormTestDataFactory.plainUser('Target');
        System.runAs(JFormTestDataFactory.builderUser()) {
            try {
                JFormSetupController.grantBuilderAccess(new List<Id>{ plain.Id });
                Assert.fail('a standard user cannot assign permission sets');
            } catch (AuraHandledException e) {
                Assert.isFalse(String.isBlank(e.getMessage()));
            }
        }
    }

    @IsTest
    static void searchListsOnlyPeopleWithoutAccess() {
        User plain = JFormTestDataFactory.plainUser('Searchable');
        List<JFormSetupController.UserRow> hits = JFormSetupController.searchUsers('Plain Searchable');
        Assert.areEqual(1, hits.size(), 'first and last name, whatever order the locale shows them in');
        Assert.areEqual(plain.Id, hits[0].id);
        Assert.areEqual(1, JFormSetupController.searchUsers('Searchable Plain').size());
        Assert.areEqual(1, JFormSetupController.searchUsers('searchable').size(), 'one word, any case');
        JFormSetupController.grantBuilderAccess(new List<Id>{ plain.Id });
        Assert.areEqual(0, JFormSetupController.searchUsers('Plain Searchable').size(), 'people who already build are not offered again');
        Assert.areEqual(0, JFormSetupController.searchUsers('P').size(), 'one letter is not a search');
        Assert.areEqual(0, JFormSetupController.searchUsers(null).size());
    }

    @IsTest
    static void guestAccessNeedsARealSite() {
        try {
            JFormSetupController.grantGuestAccess(UserInfo.getUserId()); // a real id that is not a site
            Assert.fail('expected an error');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('guest user'), e.getMessage());
        }
    }

    @IsTest
    static void findsThePackagePermissionSets() {
        Assert.isNotNull(JFormSetupController.permissionSetId(JFormSetupController.BUILDER_PERMISSION_SET));
        Assert.isNotNull(JFormSetupController.permissionSetId(JFormSetupController.GUEST_PERMISSION_SET));
        Assert.isNull(JFormSetupController.permissionSetId('No_Such_Permission_Set'));
    }

    @IsTest
    static void adminSetsTheKeysWithoutReadingThemBack() {
        JFormSetupController.generateSigningKey();
        JFormSetupController.saveCaptchaKeys(' site-key ', 'the-secret', 0.7);
        Protection_Settings__c stored = Protection_Settings__c.getOrgDefaults();
        Assert.areEqual(64, stored.Signing_Key__c.length(), 'a 256-bit key in hex');
        Assert.areEqual('site-key', stored.Site_Key__c);
        Assert.areEqual('the-secret', stored.Secret__c);

        JFormSetupController.Status status = JFormSetupController.getStatus();
        Assert.isTrue(status.canManageKeys);
        Assert.isTrue(status.signingKeySet);
        Assert.isTrue(status.captchaSet);
        Assert.areEqual('site-key', status.siteKey);
        Assert.areEqual(0.7, status.minScore);
        String json = JSON.serialize(status);
        Assert.isFalse(json.contains('the-secret'), 'the secret is never returned');
        Assert.isFalse(json.contains(stored.Signing_Key__c), 'the signing key is never returned');

        JFormSetupController.saveCaptchaKeys('new-site-key', '', null);
        stored = Protection_Settings__c.getOrgDefaults();
        Assert.areEqual('the-secret', stored.Secret__c, 'a blank secret keeps the stored one');
        Assert.isNull(stored.Min_Score__c);

        JFormSetupController.saveCaptchaKeys('', null, null);
        stored = Protection_Settings__c.getOrgDefaults();
        Assert.isNull(stored.Site_Key__c);
        Assert.isNull(stored.Secret__c, 'clearing the site key turns reCAPTCHA off');
    }

    @IsTest
    static void keysNeedASecretAndAScoreInRange() {
        for (Decimal score : new List<Decimal>{ -0.1, 1.5 }) {
            try {
                JFormSetupController.saveCaptchaKeys('site-key', 'secret', score);
                Assert.fail('expected an error');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('between 0 and 1'), e.getMessage());
            }
        }
        try {
            JFormSetupController.saveCaptchaKeys('site-key', '', null);
            Assert.fail('expected an error');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('secret'), e.getMessage());
        }
    }

    @IsTest
    static void buildersCannotChangeTheKeys() {
        System.runAs(JFormTestDataFactory.builderWithoutViewSetup()) {
            Assert.isFalse(JFormSetupController.getStatus().canManageKeys);
            try {
                JFormSetupController.generateSigningKey();
                Assert.fail('expected an error');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('Customize Application'), e.getMessage());
            }
            try {
                JFormSetupController.saveCaptchaKeys('site-key', 'secret', null);
                Assert.fail('expected an error');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('Customize Application'), e.getMessage());
            }
        }
        Assert.isNull(Protection_Settings__c.getOrgDefaults().Signing_Key__c);
    }
}
