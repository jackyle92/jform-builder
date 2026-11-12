@IsTest
private class JFormRestApiTest {

    private class Call {
        Integer status;
        Object body;
        Map<String, Object> obj() { return (Map<String, Object>) body; }
        List<Object> arr() { return (List<Object>) body; }
    }

    private static Call call(String method, String path, Object payload) {
        RestRequest req = new RestRequest();
        String uri = '/services/apexrest/jform/v1' + path;
        if (uri.contains('?')) {
            for (String pair : uri.substringAfter('?').split('&')) {
                req.addParameter(pair.substringBefore('='), EncodingUtil.urlDecode(pair.substringAfter('='), 'UTF-8'));
            }
            uri = uri.substringBefore('?');
        }
        req.requestURI = uri;
        req.httpMethod = method;
        if (payload != null) {
            req.requestBody = Blob.valueOf(payload instanceof String ? (String) payload : JSON.serialize(payload));
        }
        RestContext.request = req;
        RestContext.response = new RestResponse();
        switch on method {
            when 'GET' { JFormRestApi.doGet(); }
            when 'POST' { JFormRestApi.doPost(); }
            when 'PUT' { JFormRestApi.doPut(); }
            when 'PATCH' { JFormRestApi.doPatch(); }
            when 'DELETE' { JFormRestApi.doDelete(); }
        }
        Call c = new Call();
        c.status = RestContext.response.statusCode;
        String text = RestContext.response.responseBody == null ? '' : RestContext.response.responseBody.toString();
        c.body = String.isBlank(text) ? null : JSON.deserializeUntyped(text);
        return c;
    }

    @IsTest
    static void callersWithoutTheBuilderPermissionAreRefused() {
        System.runAs(JFormTestDataFactory.plainUser('NoJForm')) {
            for (String method : new List<String>{ 'GET', 'POST', 'PUT', 'PATCH', 'DELETE' }) {
                Call c = call(method, '/forms', null);
                Assert.areEqual(403, c.status, method);
                Assert.areEqual('INSUFFICIENT_ACCESS', c.obj().get('errorCode'), method);
            }
        }
    }

    @IsTest
    static void buildersWithoutViewSetupCanUseTheApi() {
        System.runAs(JFormTestDataFactory.builderWithoutViewSetup()) {
            Assert.areEqual(200, call('GET', '/forms', null).status, 'the custom permission comes with ACCESS_FORM_BUILDER');
        }
    }

    @IsTest
    static void errorMessagesDoNotEchoExceptions() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Call badId = call('GET', '/forms/not-an-id', null);
            Assert.areEqual(400, badId.status);
            Assert.areEqual('INVALID_ID', badId.obj().get('errorCode'));
            Assert.isFalse(((String) badId.obj().get('message')).contains('Exception'), 'no exception text: ' + badId.obj().get('message'));
        }
    }

    private static Map<String, Object> createBody(String name) {
        return new Map<String, Object>{
            'name' => name,
            'description' => 'REST test',
            'targetObjectApiName' => 'Lead',
            'thankYouMessage' => 'Thanks!',
            'sections' => new List<Object>{
                new Map<String, Object>{ 'key' => 'contact', 'name' => 'Contact details', 'fields' => new List<Object>{
                    new Map<String, Object>{ 'key' => 'last_name', 'type' => 'text', 'label' => 'Last name', 'required' => true, 'targetFieldApiName' => 'LastName', 'width' => 50 },
                    new Map<String, Object>{ 'key' => 'email', 'type' => 'email', 'label' => 'Email', 'required' => true, 'targetFieldApiName' => 'Email' },
                    new Map<String, Object>{ 'key' => 'company', 'type' => 'text', 'label' => 'Company', 'targetFieldApiName' => 'Company' }
                } },
                new Map<String, Object>{ 'key' => 'survey', 'name' => 'Survey', 'fields' => new List<Object>{
                    new Map<String, Object>{ 'key' => 'season', 'type' => 'picklist', 'label' => 'Season', 'options' => new List<Object>{
                        new Map<String, Object>{ 'label' => 'Summer' }, new Map<String, Object>{ 'label' => 'Autumn', 'value' => 'autumn' }
                    } },
                    new Map<String, Object>{ 'key' => 'why', 'type' => 'comment', 'label' => 'Why summer?',
                        'conditionalLogic' => new Map<String, Object>{ 'action' => 'show', 'match' => 'all', 'conditions' => new List<Object>{
                            new Map<String, Object>{ 'field' => 'season', 'operator' => 'equals', 'value' => 'Summer' } } } }
                } }
            }
        };
    }

    @IsTest
    static void formLifecycle() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Call created = call('POST', '/forms', createBody('REST Summer 2026'));
            Assert.areEqual(201, created.status, String.valueOf(created.body));
            String formId = (String) created.obj().get('id');
            Assert.areEqual(2, created.obj().get('sectionCount'));
            Assert.isTrue(((String) created.obj().get('builderUrl')).endsWith(formId));
            Assert.areEqual('Multi-Page (Sections)', created.obj().get('displayStyle'));

            // each REST call is its own transaction in real use; here the calls below get fresh limits
            Test.startTest();

            Call listed = call('GET', '/forms?search=rest%20summer&limit=5', null);
            Assert.areEqual(200, listed.status);
            Assert.areEqual(1, listed.arr().size());
            Assert.areEqual(formId, ((Map<String, Object>) listed.arr()[0]).get('id'));
            Assert.areEqual(0, call('GET', '/forms?status=Active', null).arr().size());
            Assert.areEqual(1, call('GET', '/forms?modifiedSince=2020-01-01T00:00:00Z&targetObject=Lead', null).arr().size());
            Assert.areEqual(1, call('GET', '/forms?modifiedSince=2020-01-01&activeOnly=false', null).arr().size());

            Call got = call('GET', '/forms/' + formId, null);
            List<Object> sections = (List<Object>) got.obj().get('sections');
            Map<String, Object> survey = (Map<String, Object>) sections[1];
            Map<String, Object> season = (Map<String, Object>) ((List<Object>) survey.get('fields'))[0];
            Assert.areEqual('autumn', ((Map<String, Object>) ((List<Object>) season.get('options'))[1]).get('value'));

            Call patched = call('PATCH', '/forms/' + formId, new Map<String, Object>{ 'thankYouMessage' => 'See you soon' });
            Assert.areEqual('See you soon', patched.obj().get('thankYouMessage'));

            Call added = call('POST', '/forms/' + formId + '/fields', new Map<String, Object>{
                'sectionKey' => 'contact',
                'fields' => new List<Object>{ new Map<String, Object>{ 'key' => 'phone', 'type' => 'phone', 'label' => 'Phone' } }
            });
            Assert.areEqual(200, added.status, String.valueOf(added.body));
            Assert.areEqual(new List<Object>{ 'phone' }, added.obj().get('addedFieldKeys'));
            Call newPage = call('POST', '/forms/' + formId + '/fields', new Map<String, Object>{
                'newSection' => new Map<String, Object>{ 'name' => 'Booking' },
                'fields' => new List<Object>{ new Map<String, Object>{ 'type' => 'date', 'label' => 'Preferred date', 'width' => 50 } }
            });
            Assert.areEqual(3, newPage.obj().get('sectionCount'));

            Call removed = call('DELETE', '/forms/' + formId + '/fields/phone', null);
            Assert.areEqual(200, removed.status);
            Assert.isFalse(JSON.serialize(removed.body).contains('"phone"'));

            Call ruled = call('POST', '/forms/' + formId + '/rules', new Map<String, Object>{
                'target' => 'Preferred date', 'action' => 'require', 'when' => 'Season', 'value' => 'Autumn'
            });
            Assert.areEqual(200, ruled.status, String.valueOf(ruled.body));
            Assert.areEqual('Require "Preferred date" when Season equals "autumn"', ruled.obj().get('ruleSentence'));

            // a body saved from an older GET is refused with 409; without a revision it overwrites
            Call fresh = call('GET', '/forms/' + formId, null);
            Map<String, Object> staleBody = (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(fresh.obj()));
            Map<String, Object> newerBody = (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(fresh.obj()));
            newerBody.put('description', 'saved first');
            Assert.areEqual(200, call('PUT', '/forms/' + formId, newerBody).status);
            staleBody.put('description', 'saved from a stale copy');
            Call conflict = call('PUT', '/forms/' + formId, staleBody);
            Assert.areEqual(409, conflict.status, String.valueOf(conflict.body));
            Assert.areEqual('CONFLICT', conflict.obj().get('errorCode'));
            staleBody.remove('revision');
            Assert.areEqual(200, call('PUT', '/forms/' + formId, staleBody).status, 'no revision, no check');

            Call cloned = call('POST', '/forms/' + formId + '/clone', new Map<String, Object>{ 'newName' => 'REST Autumn 2026', 'targetObjectApiName' => 'Contact' });
            Assert.areEqual(200, cloned.status, String.valueOf(cloned.body));
            Map<String, Object> copy = (Map<String, Object>) cloned.obj().get('form');
            Assert.areEqual('REST Autumn 2026', copy.get('name'));
            Assert.areEqual('Contact', copy.get('targetObjectApiName'));
            Assert.areEqual(formId, ((Map<String, Object>) cloned.obj().get('source')).get('id'));
        }
    }

    @IsTest
    static void formPublishSubmitAndDelete() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Call created = call('POST', '/forms', createBody('REST Summer 2026'));
            Assert.areEqual(201, created.status, String.valueOf(created.body));
            String formId = (String) created.obj().get('id');

            Call notLive = call('POST', '/forms/' + formId + '/submissions', new Map<String, Object>{ 'answers' => new Map<String, Object>() });
            Assert.areEqual(409, notLive.status);

            // each REST call is its own transaction in real use; here the calls below get fresh limits
            Test.startTest();
            Call published = call('POST', '/forms/' + formId + '/publish', new Map<String, Object>{ 'note' => 'v1' });
            Assert.areEqual(200, published.status, String.valueOf(published.body));
            Assert.areEqual(1, published.obj().get('versionNumber'));
            Assert.isNotNull(published.obj().get('publicKey'));
            Assert.isNotNull(published.obj().get('publicUrlNote'));
            Map<String, Object> pubForm = (Map<String, Object>) published.obj().get('form');
            Assert.areEqual(true, pubForm.get('isActive'));
            Assert.isFalse(pubForm.containsKey('sections'));

            Call submitted = call('POST', '/forms/' + formId + '/submissions', new Map<String, Object>{
                'answers' => new Map<String, Object>{ 'last_name' => 'Rest', 'email' => 'rest@example.com', 'company' => 'Acme', 'season' => 'Summer', 'why' => 'Sun' },
                'sourceUrl' => 'https://example.com/landing'
            });
            Assert.areEqual(200, submitted.status, String.valueOf(submitted.body));
            Assert.isNotNull(submitted.obj().get('submissionId'));

            Call subs = call('GET', '/forms/' + formId + '/submissions?limit=5', null);
            Assert.areEqual(1, subs.arr().size());
            Assert.isTrue(JSON.serialize(subs.body).contains('rest@example.com'));

            Call summary = call('GET', '/forms/' + formId + '/summary', null);
            Assert.areEqual(1, summary.obj().get('total'));

            Call live = call('DELETE', '/forms/' + formId, null);
            Assert.areEqual(409, live.status);

            Call offline = call('POST', '/forms/' + formId + '/unpublish', null);
            Assert.areEqual(false, offline.obj().get('isActive'));

            Call deleted = call('DELETE', '/forms/' + formId, null);
            Assert.areEqual(200, deleted.status, String.valueOf(deleted.body));
            Assert.areEqual(0, [SELECT COUNT() FROM Form__c WHERE Id = :formId]);
        }
    }

    @IsTest
    static void submissionsLeaveOutResponsesNotPaidFor() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            String formId = (String) call('POST', '/forms', createBody('REST Paid 2026')).obj().get('id');
            Test.startTest();
            Assert.areEqual(200, call('POST', '/forms/' + formId + '/publish', new Map<String, Object>{ 'note' => 'v1' }).status);
            for (String name : new List<String>{ 'Paid', 'Open' }) {
                Assert.areEqual(200, call('POST', '/forms/' + formId + '/submissions', new Map<String, Object>{
                    'answers' => new Map<String, Object>{ 'last_name' => name, 'email' => name + '@example.com', 'company' => 'Acme', 'season' => 'Summer', 'why' => 'Sun' }
                }).status);
            }
            Test.stopTest();
            // the second response is waiting for its payment, as the renderer leaves one until the gateway reports it
            List<Form_Submission__c> subs = [SELECT Id FROM Form_Submission__c WHERE Form__c = :formId ORDER BY Submission_Date_Time__c, Id];
            update new Form_Submission__c(Id = subs[1].Id, Payment_Status__c = JFormPaymentService.AWAITING, Payment_Amount__c = 45);

            Assert.areEqual(1, call('GET', '/forms/' + formId + '/submissions', null).arr().size(), 'left out, as on the Responses tab');
            Call unpaid = call('GET', '/forms/' + formId + '/submissions?payment=unpaid', null);
            Assert.areEqual(1, unpaid.arr().size());
            Map<String, Object> row = (Map<String, Object>) unpaid.arr()[0];
            Assert.areEqual(JFormPaymentService.AWAITING, row.get('paymentStatus'));
            Assert.areEqual(45, Decimal.valueOf(String.valueOf(row.get('paymentAmount'))).intValue());
            Assert.areEqual(0, call('GET', '/forms/' + formId + '/submissions?payment=paid', null).arr().size());
            Call bad = call('GET', '/forms/' + formId + '/submissions?payment=later', null);
            Assert.areEqual(400, bad.status);
            Assert.areEqual('INVALID_PAYMENT', bad.obj().get('errorCode'));

            // a form taking live payments leaves test payments out too, read from its settings and Payment block alone
            Map<String, Object> withPayment = createBody('REST Paid 2026');
            ((List<Object>) ((Map<String, Object>) ((List<Object>) withPayment.get('sections'))[1]).get('fields')).add(new Map<String, Object>{
                'key' => 'pay', 'type' => 'payment', 'label' => 'Payment', 'config' => new Map<String, Object>{ 'pricing' => 'fixed', 'amount' => 45 }
            });
            withPayment.put('settings', new Map<String, Object>{ 'payments' => new Map<String, Object>{ 'mode' => 'live', 'currency' => 'USD' } });
            Assert.areEqual(200, call('PUT', '/forms/' + formId, withPayment).status);
            update new Form_Submission__c(Id = subs[0].Id, Payment_Status__c = JFormPaymentService.PAID, Payment_Amount__c = 45);
            insert new Form_Payment__c(Form_Submission__c = subs[0].Id, Form__c = formId, Type__c = 'Payment', Mode__c = JFormPaymentService.TEST,
                Status__c = JFormPaymentService.PAID, Amount__c = 4500, Amount_Refunded__c = 0, Currency__c = 'USD', Provider__c = 'Stripe');
            JFormPaymentService.sandbox = false;
            Assert.areEqual(0, call('GET', '/forms/' + formId + '/submissions', null).arr().size(), 'the test payment is left out on a live form');
            Assert.areEqual(1, call('GET', '/forms/' + formId + '/submissions?payment=test', null).arr().size());
            Assert.areEqual(1, call('GET', '/forms/' + formId + '/submissions?payment=paid', null).arr().size());
            JFormPaymentService.sandbox = true;
            Assert.areEqual(1, call('GET', '/forms/' + formId + '/submissions', null).arr().size(), 'a sandbox takes test payments, so they stay in view');
        }
    }

    @IsTest
    static void replaceDefinition() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Replace');
            Map<String, Object> body = JFormDefinition.toMap(def);
            List<Object> sections = (List<Object>) body.get('sections');
            sections.remove(1);
            body.remove('name');
            Call replaced = call('PUT', '/forms/' + def.id, body);
            Assert.areEqual(200, replaced.status, String.valueOf(replaced.body));
            Assert.areEqual(1, replaced.obj().get('sectionCount'));
            Assert.areEqual('Replace', replaced.obj().get('name'));
        }
    }

    @IsTest
    static void submitValidationErrorsAre400() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Validate');
            JFormPublishService.publish(def.id, null);

            Call c = call('POST', '/forms/' + def.id + '/submissions', new Map<String, Object>{ 'answers' => new Map<String, Object>{ 'first_name' => 'A' } });

            Assert.areEqual(400, c.status, String.valueOf(c.body));
            Assert.areEqual('INVALID_ANSWERS', c.obj().get('errorCode'));
            Assert.isTrue(String.valueOf(c.obj().get('message')).contains('Please answer'), String.valueOf(c.body));
        }
    }

    @IsTest
    static void errorsAreJson() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.createSampleForm('Errors');
            String missingFormId = Form__c.SObjectType.getDescribe().getKeyPrefix() + '000000000000';
            Map<String, Integer> expected = new Map<String, Integer>{
                'GET /forms/notanid' => 400,
                'GET /forms/' + missingFormId => 404,
                'GET /forms/' + UserInfo.getUserId() => 400,
                'GET /unknown' => 404,
                'POST /forms/' + def.id + '/publish/extra' => 404,
                'GET /forms?limit=abc' => 400,
                'GET /forms?modifiedSince=yesterday' => 400,
                'DELETE /forms/' + def.id + '/fields/missing' => 404
            };
            for (String route : expected.keySet()) {
                Call c = call(route.substringBefore(' '), route.substringAfter(' '), null);
                Assert.areEqual(expected.get(route), c.status, route + ' -> ' + String.valueOf(c.body));
                Assert.isNotNull(c.obj().get('errorCode'), route);
                Assert.isNotNull(c.obj().get('message'), route);
            }

            Assert.areEqual('INVALID_JSON', call('POST', '/forms', '{oops').obj().get('errorCode'));
            Assert.areEqual('INVALID_JSON', call('POST', '/forms', '[1,2]').obj().get('errorCode'));
            Assert.areEqual('MISSING_NAME', call('POST', '/forms', new Map<String, Object>()).obj().get('errorCode'));
            Assert.areEqual('NOTHING_TO_UPDATE', call('PATCH', '/forms/' + def.id, new Map<String, Object>{ 'unknown' => 1 }).obj().get('errorCode'));
            Assert.areEqual('MISSING_FIELDS', call('POST', '/forms/' + def.id + '/fields', new Map<String, Object>()).obj().get('errorCode'));
            Call badRule = call('POST', '/forms/' + def.id + '/rules', new Map<String, Object>{ 'target' => 'nps', 'action' => 'show', 'when' => 'season', 'value' => 'Winter' });
            Assert.areEqual(400, badRule.status);
            Assert.isTrue(((String) badRule.obj().get('message')).contains('Choices'));
            Call badForm = call('POST', '/forms', new Map<String, Object>{ 'name' => 'Bad', 'sections' => new List<Object>{
                new Map<String, Object>{ 'name' => 'P', 'fields' => new List<Object>{ new Map<String, Object>{ 'label' => 'Size', 'type' => 'dropdown' } } } } });
            Assert.areEqual(400, badForm.status, String.valueOf(badForm.body));
            Assert.isTrue(((String) badForm.obj().get('message')).contains('needs at least one option'), String.valueOf(badForm.body));
            Assert.areEqual(0, [SELECT COUNT() FROM Form__c WHERE Name = 'Bad'], 'rolled back');
        }
    }

    @IsTest
    static void createWithoutSectionsGetsOnePage() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Call c = call('POST', '/forms', new Map<String, Object>{ 'name' => 'Empty' });
            Assert.areEqual(201, c.status, String.valueOf(c.body));
            Assert.areEqual(1, c.obj().get('sectionCount'));

            Call loose = call('POST', '/forms', new Map<String, Object>{ 'name' => 'Loose', 'fields' => new List<Object>{ 'Name', new Map<String, Object>{ 'label' => 'Size', 'type' => 'dropdown', 'options' => new List<Object>{ 'S', 'M' } } } });
            Assert.areEqual(201, loose.status, String.valueOf(loose.body));
            Assert.isTrue(JSON.serialize(loose.body).contains('"type":"picklist"'));
        }
    }

    @IsTest
    static void schemaEndpoints() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Call objects = call('GET', '/schema/objects', null);
            Assert.areEqual(200, objects.status);
            Assert.isTrue(JSON.serialize(objects.body).contains('"apiName":"Lead"'));

            Call everything = call('GET', '/schema/objects?all=true', null);
            Assert.isTrue(everything.arr().size() >= objects.arr().size());

            Call lead = call('GET', '/schema/objects/Lead/fields?search=email', null);
            Assert.areEqual('Lead', lead.obj().get('objectApiName'));
            Assert.isTrue(JSON.serialize(lead.body).contains('"suggestedFieldType":"email"'));

            Assert.areEqual(404, call('GET', '/schema/objects/NoSuchObject__c/fields', null).status);
        }
    }

    @IsTest
    static void helpers() {
        Assert.areEqual(new List<String>{ 'forms', 'a00', 'publish' }, JFormRestApi.pathParts('/services/apexrest/jform/v1/forms/a00/publish/'));
        Assert.areEqual(new List<String>{ 'forms' }, JFormRestApi.pathParts('/jform/v1/forms?x=1'));
        Assert.areEqual(new List<String>(), JFormRestApi.pathParts(null));
        Assert.areEqual('comment', JFormRestApi.suggestFieldType('textarea'));
        Assert.areEqual('number', JFormRestApi.suggestFieldType('currency'));
        Assert.areEqual('consent', JFormRestApi.suggestFieldType('boolean'));
        Assert.isNull(JFormRestApi.suggestFieldType('reference'));
    }
}
