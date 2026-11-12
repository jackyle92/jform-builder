/**
 * Each action handles up to JFormAgentSupport.MAX_REQUESTS requests per call, every request in its own
 * savepoint, and stops early when the transaction has too few queries or DML statements left. These tests
 * send a full batch to each action and check it stays within the per-request allowance that check assumes.
 */
@IsTest
private class JFormAgentActionsLimitsTest {

    private static final Integer BATCH = JFormAgentSupport.MAX_REQUESTS;

    /** Draft forms made before Test.startTest, so their setup does not count against the batch. */
    private static List<Id> forms() {
        List<Id> ids = new List<Id>();
        for (Integer i = 0; i < BATCH; i++) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Batch ' + i);
            def.targetObjectApiName = null;
            ids.add(JFormDefinitionService.create(def).id);
        }
        return ids;
    }

    /** The batch stays within the per-request allowance JFormAgentSupport.capacityProblem reserves. */
    private static void assertHeadroom(String action) {
        Integer queries = Limits.getQueries();
        Integer dml = Limits.getDmlStatements();
        System.debug(LoggingLevel.INFO, action + ' x' + BATCH + ': ' + queries + ' SOQL, ' + dml + ' DML');
        Assert.isTrue(queries <= BATCH * JFormAgentSupport.QUERIES_PER_REQUEST, action + ' used ' + queries + ' SOQL queries for ' + BATCH + ' requests');
        Assert.isTrue(dml <= BATCH * JFormAgentSupport.DML_PER_REQUEST, action + ' used ' + dml + ' DML statements for ' + BATCH + ' requests');
    }

    private static void assertNoErrors(List<Object> results) {
        Assert.areEqual(BATCH, results.size());
        for (Object result : results) {
            Map<String, Object> fields = (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(result));
            Assert.isNull(fields.get('errorMessage'), 'unexpected error: ' + fields.get('errorMessage'));
        }
    }

    @IsTest
    static void createFormsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormCreateFormAction.Request> requests = new List<JFormCreateFormAction.Request>();
            for (Integer i = 0; i < BATCH; i++) {
                JFormCreateFormAction.Request req = new JFormCreateFormAction.Request();
                req.formName = 'Created ' + i;
                req.definitionJson = '[{"label":"Name","type":"text"},{"label":"Email","type":"email"}]';
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormCreateFormAction.create(requests));
            assertHeadroom('Create Form');
            Test.stopTest();
        }
    }

    @IsTest
    static void cloneFormsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormCloneFormAction.Request> requests = new List<JFormCloneFormAction.Request>();
            for (Id formId : forms()) {
                JFormCloneFormAction.Request req = new JFormCloneFormAction.Request();
                req.sourceFormId = formId;
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormCloneFormAction.cloneForms(requests));
            assertHeadroom('Clone Form');
            Test.stopTest();
        }
    }

    @IsTest
    static void addFieldsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormAddFieldsAction.Request> requests = new List<JFormAddFieldsAction.Request>();
            for (Id formId : forms()) {
                JFormAddFieldsAction.Request req = new JFormAddFieldsAction.Request();
                req.formId = formId;
                req.fieldsJson = '[{"label":"Notes","type":"long text"}]';
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormAddFieldsAction.addFields(requests));
            assertHeadroom('Add Fields');
            Test.stopTest();
        }
    }

    @IsTest
    static void addRulesInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormAddRuleAction.Request> requests = new List<JFormAddRuleAction.Request>();
            for (Id formId : forms()) {
                JFormAddRuleAction.Request req = new JFormAddRuleAction.Request();
                req.formId = formId;
                req.targetField = 'How likely are you to recommend us?';
                req.ruleAction = 'Require';
                req.whenField = 'season';
                req.operator = 'is';
                req.value = 'Autumn';
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormAddRuleAction.addRule(requests));
            assertHeadroom('Add Rule');
            Test.stopTest();
        }
    }

    @IsTest
    static void updateFieldsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormUpdateFieldAction.Request> requests = new List<JFormUpdateFieldAction.Request>();
            for (Id formId : forms()) {
                JFormUpdateFieldAction.Request req = new JFormUpdateFieldAction.Request();
                req.formId = formId;
                req.field = 'Email';
                req.helpText = 'We only use it to reply.';
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormUpdateFieldAction.updateField(requests));
            assertHeadroom('Update Field');
            Test.stopTest();
        }
    }

    @IsTest
    static void applyDesignsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormApplyDesignAction.Request> requests = new List<JFormApplyDesignAction.Request>();
            for (Id formId : forms()) {
                JFormApplyDesignAction.Request req = new JFormApplyDesignAction.Request();
                req.formId = formId;
                req.style = 'Teal';
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormApplyDesignAction.applyDesign(requests));
            assertHeadroom('Apply Design');
            Test.stopTest();
        }
    }

    @IsTest
    static void publishFormsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormPublishFormAction.Request> requests = new List<JFormPublishFormAction.Request>();
            for (Id formId : forms()) {
                JFormPublishFormAction.Request req = new JFormPublishFormAction.Request();
                req.formId = formId;
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormPublishFormAction.publish(requests));
            assertHeadroom('Publish Form');
            Test.stopTest();
        }
    }

    @IsTest
    static void getFormDetailsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormGetFormDetailsAction.Request> requests = new List<JFormGetFormDetailsAction.Request>();
            for (Id formId : forms()) {
                JFormGetFormDetailsAction.Request req = new JFormGetFormDetailsAction.Request();
                req.formId = formId;
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormGetFormDetailsAction.describe(requests));
            assertHeadroom('Get Form Details');
            Test.stopTest();
        }
    }

    @IsTest
    static void responseSummariesInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<JFormResponseSummaryAction.Request> requests = new List<JFormResponseSummaryAction.Request>();
            for (Id formId : forms()) {
                JFormResponseSummaryAction.Request req = new JFormResponseSummaryAction.Request();
                req.formId = formId;
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormResponseSummaryAction.summarise(requests));
            assertHeadroom('Response Summary');
            Test.stopTest();
        }
    }

    @IsTest
    static void findFormsInOneBatch() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            forms();
            List<JFormFindFormsAction.Request> requests = new List<JFormFindFormsAction.Request>();
            for (Integer i = 0; i < BATCH; i++) {
                JFormFindFormsAction.Request req = new JFormFindFormsAction.Request();
                req.searchText = 'Batch';
                requests.add(req);
            }
            Test.startTest();
            assertNoErrors(JFormFindFormsAction.find(requests));
            assertHeadroom('Find Forms');
            Test.stopTest();
        }
    }

    @IsTest
    static void stopsCleanlyWhenTheTransactionIsLowOnQueries() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            List<Id> ids = forms();
            List<JFormPublishFormAction.Request> requests = new List<JFormPublishFormAction.Request>();
            for (Id formId : ids) {
                JFormPublishFormAction.Request req = new JFormPublishFormAction.Request();
                req.formId = formId;
                requests.add(req);
            }
            Test.startTest();
            // a Flow that already used most of its queries before calling the action
            while (Limits.getLimitQueries() - Limits.getQueries() > 3 * JFormAgentSupport.QUERIES_PER_REQUEST) {
                Integer unused = [SELECT COUNT() FROM Form__c WHERE Id = :ids[0]];
            }
            List<JFormPublishFormAction.Result> results = JFormPublishFormAction.publish(requests);
            Test.stopTest();
            Assert.areEqual(BATCH, results.size());
            Integer published = 0;
            for (JFormPublishFormAction.Result r : results) {
                if (r.errorMessage == null) {
                    published++;
                } else {
                    Assert.areEqual(JFormAgentSupport.OUT_OF_LIMITS, r.errorMessage);
                }
            }
            Assert.isTrue(published >= 1 && published < BATCH, 'some requests ran, the rest were sent back: ' + published);
        }
    }

    @IsTest
    static void sendsBackRequestsOverTheCap() {
        List<JFormFindFormsAction.Request> requests = new List<JFormFindFormsAction.Request>();
        for (Integer i = 0; i <= BATCH; i++) {
            requests.add(new JFormFindFormsAction.Request());
        }
        List<JFormFindFormsAction.Result> results = JFormFindFormsAction.find(requests);
        Assert.areEqual(BATCH + 1, results.size());
        Assert.areEqual(JFormAgentSupport.TOO_MANY_REQUESTS, results[BATCH].errorMessage);
    }
}
