/**
 * JForm REST API: /services/apexrest/jform/v1/... in the managed package (namespace jform);
 * /services/apexrest/v1/... when deployed from source without a namespace.
 *
 *   GET    /forms                         list (search, status, activeOnly, targetObject, modifiedSince, limit)
 *   POST   /forms                         create from a definition (canonical or loose field JSON)
 *   GET    /forms/{id}                    full definition plus status and links
 *   PUT    /forms/{id}                    replace the draft definition
 *   PATCH  /forms/{id}                    change settings (name, label, description, target object, messages)
 *   DELETE /forms/{id}                    delete an unpublished form
 *   POST   /forms/{id}/clone              copy into a new draft
 *   POST   /forms/{id}/fields             add fields to a page (sectionId, sectionKey or page) or a new page
 *   DELETE /forms/{id}/fields/{idOrKey}   remove a field
 *   POST   /forms/{id}/rules              add a show, hide or require rule
 *   POST   /forms/{id}/publish            publish; returns version, public link, preview link and embed snippet
 *   POST   /forms/{id}/unpublish          take the form offline
 *   GET    /forms/{id}/submissions        responses with every answer (limit, offset, status, includeSpam, payment)
 *   POST   /forms/{id}/submissions        submit answers to a live form as the calling user (spam checks for
 *                                         anonymous respondents are skipped; the honeypot still applies)
 *   GET    /forms/{id}/summary            response counts and choice breakdowns
 *   GET    /schema/objects                objects a form can create records in (all=true for every createable object)
 *   GET    /schema/objects/{name}/fields  createable fields with a suggested form field type (search)
 *
 * Callers need the JForm_Builder custom permission (granted by ACCESS_FORM_BUILDER).
 * Everything runs as the calling user: the services use USER_MODE, so CRUD, FLS
 * and sharing apply. The one exception is POST /forms/{id}/submissions, which feeds the
 * same system-mode pipeline the public page uses, so a live form's record steps run for
 * the caller exactly as they would for a respondent. Errors come back as
 * {"errorCode": "...", "message": "..."}.
 */
@RestResource(urlMapping='/v1/*')
global with sharing class JFormRestApi {

    private static final Set<String> COMMON_OBJECTS = new Set<String>{
        'account', 'contact', 'lead', 'opportunity', 'case', 'campaign', 'campaignmember', 'event', 'task',
        'contract', 'order', 'product2', 'asset', 'quote', 'individual'
    };
    private static final Set<String> EXCLUDED_SUFFIXES = new Set<String>{ 'Share', 'History', 'Feed', 'ChangeEvent', '__mdt', '__e', '__x', '__b', 'Tag', 'Event' };

    global class ApiException extends Exception {
        public Integer statusCode = 400;
        public String errorCode = 'BAD_REQUEST';
        public ApiException(Integer statusCode, String errorCode, String message) {
            this(message);
            this.statusCode = statusCode;
            this.errorCode = errorCode;
        }
    }

    // ------------------------------------------------------------ HTTP verbs

    @HttpGet
    global static void doGet() {
        handle('GET');
    }

    @HttpPost
    global static void doPost() {
        handle('POST');
    }

    @HttpPut
    global static void doPut() {
        handle('PUT');
    }

    @HttpPatch
    global static void doPatch() {
        handle('PATCH');
    }

    @HttpDelete
    global static void doDelete() {
        handle('DELETE');
    }

    // ------------------------------------------------------------ routing

    /** Custom permission every route requires; granted by the ACCESS_FORM_BUILDER permission set. */
    @TestVisible
    private static final String BUILDER_PERMISSION = 'JForm_Builder';

    @TestVisible
    private static void handle(String method) {
        RestRequest req = RestContext.request;
        Savepoint sp = method == 'GET' ? null : Database.setSavepoint();
        try {
            if (!hasBuilderPermission()) {
                throw new ApiException(403, 'INSUFFICIENT_ACCESS', 'The JForm REST API needs the ACCESS_FORM_BUILDER permission set.');
            }
            List<String> parts = pathParts(req.requestURI);
            respond(method == 'POST' && parts.size() == 1 && parts[0] == 'forms' ? 201 : 200, route(method, parts, req));
        } catch (ApiException e) {
            rollback(sp);
            respondError(e.statusCode, e.errorCode, e.getMessage());
        } catch (JSONException e) {
            rollback(sp);
            respondError(400, 'INVALID_JSON', 'The request body is not valid JSON: ' + e.getMessage());
        } catch (JFormDefinition.ConflictException e) {
            // the body carries a revision older than the stored one: someone saved in between
            rollback(sp);
            respondError(409, 'CONFLICT', e.getMessage() + ' GET the form again, or omit "revision" to overwrite.');
        } catch (JFormDefinition.JFormException e) {
            rollback(sp);
            Boolean notFound = e.getMessage().startsWith('Form not found');
            respondError(notFound ? 404 : 400, notFound ? 'NOT_FOUND' : 'INVALID_FORM', e.getMessage());
        } catch (StringException e) {
            rollback(sp);
            respondError(400, 'INVALID_ID', 'The path contains a value that is not a valid record Id.');
        } catch (System.QueryException e) {
            // the raw message can quote the query; the caller gets a fixed one and the detail stays in the log
            rollback(sp);
            logDetail(e);
            Boolean denied = e.getMessage().contains('access') || e.getMessage().contains('permission');
            respondError(denied ? 403 : 400, denied ? 'INSUFFICIENT_ACCESS' : 'QUERY_FAILED',
                denied ? 'You do not have access to an object or field this request needs.' : 'The records could not be read.');
        } catch (System.NoAccessException e) {
            rollback(sp);
            logDetail(e);
            respondError(403, 'INSUFFICIENT_ACCESS', 'You do not have access to an object or field this request needs.');
        } catch (DmlException e) {
            rollback(sp);
            respondError(400, 'SAVE_FAILED', e.getDmlMessage(0));
        } catch (AuraHandledException e) {
            // the public submission pipeline reports missing answers and closed forms this way
            rollback(sp);
            respondError(400, 'INVALID_ANSWERS', e.getMessage());
        } catch (Exception e) {
            rollback(sp);
            logDetail(e);
            respondError(500, 'UNEXPECTED', 'Something went wrong on the server. Try again, or ask your Salesforce admin to check the debug log.');
        }
    }

    /** The custom permission, by its own name from source and namespaced (jform__JForm_Builder) in the package. */
    private static Boolean hasBuilderPermission() {
        return FeatureManagement.checkPermission(BUILDER_PERMISSION)
            || (String.isNotBlank(JFormNamespace.PREFIX) && FeatureManagement.checkPermission(JFormNamespace.qualify(BUILDER_PERMISSION)));
    }

    private static void logDetail(Exception e) {
        System.debug(LoggingLevel.ERROR, 'JForm REST API: ' + e.getTypeName() + ': ' + e.getMessage() + '\n' + e.getStackTraceString());
    }

    private static Object route(String method, List<String> p, RestRequest req) {
        Integer n = p.size();
        if (n >= 1 && p[0] == 'forms') {
            if (n == 1) {
                if (method == 'GET') return listForms(req);
                if (method == 'POST') return createForm(body(req));
            } else {
                Id formId = toId(p[1]);
                // a change to a form waits for any other change in progress, so neither overwrites the other
                if (method != 'GET' && !(n == 3 && (p[2] == 'submissions' || p[2] == 'clone'))) {
                    JFormDefinitionService.lockForEdit(formId);
                }
                if (n == 2) {
                    if (method == 'GET') return formResponse(JFormDefinitionService.load(formId));
                    if (method == 'PUT') return replaceForm(formId, body(req));
                    if (method == 'PATCH') return patchForm(formId, body(req));
                    if (method == 'DELETE') return deleteForm(formId);
                } else {
                    String sub = p[2];
                    if (sub == 'clone' && method == 'POST' && n == 3) return cloneForm(formId, body(req));
                    if (sub == 'fields' && method == 'POST' && n == 3) return addFields(formId, body(req));
                    if (sub == 'fields' && method == 'DELETE' && n == 4) return removeField(formId, EncodingUtil.urlDecode(p[3], 'UTF-8'));
                    if (sub == 'rules' && method == 'POST' && n == 3) return addRule(formId, body(req));
                    if (sub == 'publish' && method == 'POST' && n == 3) return publish(formId, body(req));
                    if (sub == 'unpublish' && method == 'POST' && n == 3) return unpublish(formId);
                    if (sub == 'submissions' && method == 'GET' && n == 3) return listSubmissions(formId, req);
                    if (sub == 'submissions' && method == 'POST' && n == 3) return submit(formId, body(req));
                    if (sub == 'summary' && method == 'GET' && n == 3) return JFormResponsesController.getSummary(formId);
                }
            }
        } else if (n >= 2 && p[0] == 'schema' && p[1] == 'objects') {
            if (n == 2 && method == 'GET') return listObjects(req);
            if (n == 4 && p[3] == 'fields' && method == 'GET') return describeFields(p[2], req.params.get('search'));
        }
        throw new ApiException(404, 'NOT_FOUND', 'No endpoint for ' + method + ' /' + String.join(p, '/') + '.');
    }

    // ------------------------------------------------------------ forms

    private static List<Map<String, Object>> listForms(RestRequest req) {
        Map<String, String> q = req.params;
        Integer max = intParam(q, 'limit', 25, 1, 200);
        Map<String, Object> binds = new Map<String, Object>();
        List<String> conditions = new List<String>();
        if (String.isNotBlank(q.get('status'))) {
            conditions.add('Status__c = :status');
            binds.put('status', q.get('status'));
        }
        if (q.get('activeOnly') == 'true') {
            conditions.add('Is_Active__c = true');
        }
        if (String.isNotBlank(q.get('targetObject'))) {
            conditions.add('Target_Object_API_Name__c = :targetObject');
            binds.put('targetObject', q.get('targetObject'));
        }
        if (String.isNotBlank(q.get('modifiedSince'))) {
            Datetime since;
            String raw = q.get('modifiedSince').trim();
            try {
                since = raw.length() == 10
                    ? Datetime.newInstanceGmt(Date.valueOf(raw), Time.newInstance(0, 0, 0, 0))
                    : (Datetime) JSON.deserialize('"' + raw + '"', Datetime.class);
            } catch (Exception e) {
                throw new ApiException(400, 'INVALID_PARAMETER', 'modifiedSince "' + q.get('modifiedSince') + '" is not an ISO date or date-time.');
            }
            conditions.add('LastModifiedDate >= :since');
            binds.put('since', since);
        }
        String needle = String.isBlank(q.get('search')) ? null : q.get('search').trim().toLowerCase();
        String soql = 'SELECT Id, Name, Form_Label__c, Description__c, Status__c, Is_Active__c, Display_Style__c, '
            + 'Target_Object_API_Name__c, Version__c, Public_Key__c, CreatedDate, LastModifiedDate '
            + 'FROM Form__c' + (conditions.isEmpty() ? '' : ' WHERE ' + String.join(conditions, ' AND '))
            + ' ORDER BY LastModifiedDate DESC LIMIT ' + (needle == null ? max : 1000);
        List<Form__c> picked = new List<Form__c>();
        for (Form__c f : (List<Form__c>) Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE)) {
            if (needle != null) {
                String hay = ((f.Name == null ? '' : f.Name) + ' ' + (f.Form_Label__c == null ? '' : f.Form_Label__c) + ' ' + (f.Description__c == null ? '' : f.Description__c)).toLowerCase();
                if (!hay.contains(needle)) {
                    continue;
                }
            }
            picked.add(f);
            if (picked.size() >= max) {
                break;
            }
        }
        // page counts per form, grouped: a subquery over hundreds of forms is too many rows to read directly
        Map<Id, Integer> pages = new Map<Id, Integer>();
        if (!picked.isEmpty()) {
            for (AggregateResult ar : [SELECT Form__c formId, COUNT(Id) n FROM Form_Section__c WHERE Form__c IN :picked WITH USER_MODE GROUP BY Form__c]) {
                pages.put((Id) ar.get('formId'), (Integer) ar.get('n'));
            }
        }
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Form__c f : picked) {
            out.add(summaryOf(f, pages.containsKey(f.Id) ? pages.get(f.Id) : 0));
        }
        return out;
    }

    private static Map<String, Object> createForm(Map<String, Object> b) {
        String name = str(b, 'name');
        if (String.isBlank(name)) {
            throw new ApiException(400, 'MISSING_NAME', 'A form needs a "name".');
        }
        Map<String, Object> copy = new Map<String, Object>(b);
        if (!(copy.get('sections') instanceof List<Object>) && !(copy.get('fields') instanceof List<Object>)) {
            copy.put('sections', new List<Object>{ new Map<String, Object>{ 'name' => 'Page 1', 'fields' => new List<Object>() } });
        }
        JFormDefinition.Form def = JFormAgentSupport.parseDefinition(JSON.serialize(copy), name);
        if (b.get('settings') instanceof Map<String, Object>) {
            def.settings = (Map<String, Object>) b.get('settings');
        }
        // after settings, so a top-level welcome or ending wins over the one inside settings
        applySettings(def, b);
        if (b.get('theme') instanceof Map<String, Object>) {
            def.theme = JFormDefinition.parseTheme(JSON.serialize(b.get('theme')));
        }
        return formResponse(JFormDefinitionService.create(def));
    }

    private static Map<String, Object> replaceForm(Id formId, Map<String, Object> b) {
        JFormDefinition.Form def = JFormDefinition.formFromMap(b);
        def.id = formId;
        if (String.isBlank(def.name)) {
            def.name = JFormDefinitionService.load(formId).name;
        }
        return formResponse(JFormDefinitionService.save(def));
    }

    private static Map<String, Object> patchForm(Id formId, Map<String, Object> b) {
        JFormDefinition.Form def = JFormDefinitionService.load(formId);
        if (!applySettings(def, b)) {
            throw new ApiException(400, 'NOTHING_TO_UPDATE', 'Provide at least one of name, label, description, targetObjectApiName, displayStyle, welcomeMessage, thankYouMessage, welcome, ending.');
        }
        return formResponse(JFormDefinitionService.save(def));
    }

    private static Map<String, Object> deleteForm(Id formId) {
        JFormDefinition.Form def = JFormDefinitionService.load(formId);
        if (def.isActive == true) {
            throw new ApiException(409, 'FORM_IS_LIVE', 'Form "' + def.name + '" is live. Unpublish it before deleting.');
        }
        Database.delete(new Form__c(Id = formId), AccessLevel.USER_MODE);
        return new Map<String, Object>{ 'deleted' => formId, 'name' => def.name };
    }

    private static Map<String, Object> cloneForm(Id formId, Map<String, Object> b) {
        JFormDefinition.Form source = JFormDefinitionService.load(formId);
        JFormDefinition.Form copy = JFormDefinitionService.clone(formId, str(b, 'newName'));
        if (applySettings(copy, b)) {
            copy = JFormDefinitionService.save(copy);
        }
        return new Map<String, Object>{ 'source' => summaryOf(source), 'form' => formResponse(copy) };
    }

    private static Map<String, Object> addFields(Id formId, Map<String, Object> b) {
        if (!(b.get('fields') instanceof List<Object>)) {
            throw new ApiException(400, 'MISSING_FIELDS', 'Provide "fields" as a JSON array.');
        }
        JFormAddFieldsAction.Request r = new JFormAddFieldsAction.Request();
        r.formId = formId;
        r.fieldsJson = JSON.serialize(b.get('fields'));
        r.pageName = firstNonBlank(new List<String>{ str(b, 'sectionId'), str(b, 'sectionKey'), str(b, 'page') });
        if (b.get('newSection') instanceof Map<String, Object>) {
            Map<String, Object> ns = (Map<String, Object>) b.get('newSection');
            r.newPageName = firstNonBlank(new List<String>{ str(ns, 'label'), str(ns, 'name') });
        } else {
            r.newPageName = str(b, 'newPage');
        }
        JFormAddFieldsAction.Result res = JFormAddFieldsAction.addFields(new List<JFormAddFieldsAction.Request>{ r })[0];
        failIf(res.errorMessage);
        Map<String, Object> out = formResponse(JFormDefinitionService.load(formId));
        out.put('addedFieldKeys', res.addedFieldKeys == null ? new List<String>() : res.addedFieldKeys.split(', '));
        return out;
    }

    private static Map<String, Object> removeField(Id formId, String ref) {
        JFormDefinition.Form def = JFormDefinitionService.load(formId);
        Boolean removed = false;
        for (JFormDefinition.Section s : def.sections) {
            for (Integer i = s.fields.size() - 1; i >= 0; i--) {
                JFormDefinition.Field f = s.fields[i];
                if (f.key == ref || f.id == ref || (f.id != null && ref.length() == 15 && f.id.left(15) == ref)) {
                    s.fields.remove(i);
                    JFormAutomationService.dropReferences(def, f.key);
                    removed = true;
                }
            }
        }
        if (!removed) {
            throw new ApiException(404, 'FIELD_NOT_FOUND', 'Field ' + ref + ' does not belong to form ' + formId + '.');
        }
        return formResponse(JFormDefinitionService.save(def));
    }

    private static Map<String, Object> addRule(Id formId, Map<String, Object> b) {
        JFormAddRuleAction.Request r = new JFormAddRuleAction.Request();
        r.formId = formId;
        r.targetField = firstNonBlank(new List<String>{ str(b, 'target'), str(b, 'targetField') });
        r.ruleAction = firstNonBlank(new List<String>{ str(b, 'action'), str(b, 'ruleAction') });
        r.whenField = firstNonBlank(new List<String>{ str(b, 'when'), str(b, 'whenField'), str(b, 'field') });
        r.operator = str(b, 'operator');
        r.value = str(b, 'value');
        r.combine = str(b, 'combine');
        JFormAddRuleAction.Result res = JFormAddRuleAction.addRule(new List<JFormAddRuleAction.Request>{ r })[0];
        failIf(res.errorMessage);
        Map<String, Object> out = formResponse(JFormDefinitionService.load(formId));
        out.put('ruleSentence', res.ruleSentence);
        return out;
    }

    private static Map<String, Object> publish(Id formId, Map<String, Object> b) {
        JFormPublishService.PublishResult pub = JFormPublishService.publish(formId, firstNonBlank(new List<String>{ str(b, 'note'), str(b, 'releaseNote') }));
        JFormDefinition.Form def = JFormDefinitionService.load(formId);
        String publicUrl = JFormAgentSupport.publicUrl(def);
        Map<String, Object> summary = formResponse(def);
        summary.remove('sections');
        return new Map<String, Object>{
            'form' => summary,
            'versionNumber' => pub.versionNumber,
            'publicKey' => pub.publicKey,
            'builderUrl' => JFormAgentSupport.builderUrl(formId),
            'publicUrl' => publicUrl,
            'publicUrlNote' => publicUrl == null
                ? 'No active Experience Cloud site was found. Publish the jform site, or choose a site in the Share dialog.'
                : 'The form\'s site page hosts the JForm renderer and reads ?key= from the URL. Add &embed=1 inside an iframe.',
            'previewUrl' => JFormAgentSupport.previewUrl(pub.publicKey),
            'embedSnippet' => JFormAgentSupport.embedSnippet(publicUrl, pub.publicKey, String.isBlank(def.label) ? def.name : def.label)
        };
    }

    private static Map<String, Object> unpublish(Id formId) {
        JFormPublishService.unpublish(formId);
        Map<String, Object> summary = formResponse(JFormDefinitionService.load(formId));
        summary.remove('sections');
        return summary;
    }

    // ------------------------------------------------------------ submissions

    private static List<Map<String, Object>> listSubmissions(Id formId, RestRequest req) {
        Integer max = intParam(req.params, 'limit', 25, 1, 200);
        Integer skip = intParam(req.params, 'offset', 0, 0, 2000);
        String status = req.params.get('status');
        String payment = req.params.get('payment');
        if (String.isNotBlank(payment) && !JFormResponsesController.PAYMENT_FILTERS.contains(payment)) {
            throw new ApiException(400, 'INVALID_PAYMENT', 'payment must be paid, unpaid or test.');
        }
        Map<String, Object> binds = new Map<String, Object>{ 'formId' => formId };
        String soql = 'SELECT Id, Submission_Date_Time__c, Status__c, Target_Record_Id__c, Error_Message__c, Spam_Reason__c, Payment_Status__c, Payment_Amount__c, '
            + '(SELECT Form_Field_Definition__c, Field_Key__c, Field_Label__c, Field_Value__c FROM Submission_Field_Values__r), '
            + '(SELECT Code__c, Discount_Amount__c, Currency__c FROM Form_Payments__r WHERE Type__c = \'Payment\' ORDER BY CreatedDate DESC LIMIT 1) '
            + 'FROM Form_Submission__c WHERE Form__c = :formId';
        if (String.isNotBlank(status)) {
            soql += ' AND Status__c = :status';
            binds.put('status', status);
        } else if (req.params.get('includeSpam') != 'true') {
            soql += ' AND Status__c != \'Spam\''; // flagged responses only on request
        }
        // the Responses tab's payment filter: responses not paid for are left out unless asked for
        soql += ' AND ' + JFormResponsesController.paymentClause(formId, payment, binds);
        soql += ' ORDER BY Submission_Date_Time__c DESC NULLS LAST LIMIT ' + max + ' OFFSET ' + skip;
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Form_Submission__c s : (List<Form_Submission__c>) Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE)) {
            List<Object> values = new List<Object>();
            for (Submission_Field_Value__c v : s.Submission_Field_Values__r) {
                values.add(compact(new Map<String, Object>{
                    'fieldId' => v.Form_Field_Definition__c, 'key' => v.Field_Key__c, 'label' => v.Field_Label__c, 'value' => v.Field_Value__c
                }));
            }
            Form_Payment__c pay = s.Form_Payments__r.isEmpty() ? null : s.Form_Payments__r[0];
            out.add(compact(new Map<String, Object>{
                'id' => s.Id, 'submittedAt' => s.Submission_Date_Time__c, 'status' => s.Status__c,
                'targetRecordId' => s.Target_Record_Id__c, 'errorMessage' => s.Error_Message__c, 'spamReason' => s.Spam_Reason__c,
                'paymentStatus' => s.Payment_Status__c, 'paymentAmount' => s.Payment_Amount__c,
                'promotionCode' => pay == null ? null : pay.Code__c,
                // 0 is no discount, as on the Responses tab and in the export: left out like a missing code
                'discountAmount' => pay == null || pay.Discount_Amount__c == null || pay.Discount_Amount__c == 0 ? null : JFormPaymentPricing.toMajor(pay.Discount_Amount__c.longValue(), pay.Currency__c),
                'values' => values
            }));
        }
        return out;
    }

    private static Map<String, Object> submit(Id formId, Map<String, Object> b) {
        JFormDefinition.Form def = JFormDefinitionService.load(formId);
        if (def.isActive != true || String.isBlank(def.publicKey)) {
            throw new ApiException(409, 'FORM_NOT_LIVE', 'Form "' + def.name + '" is not published.');
        }
        Object answers = b.containsKey('answers') ? b.get('answers') : b;
        if (!(answers instanceof Map<String, Object>)) {
            throw new ApiException(400, 'INVALID_ANSWERS', 'Provide "answers" as an object keyed by field key.');
        }
        Id submissionId = JFormPublicController.submitTrusted(def.publicKey, JSON.serialize(answers), str(b, 'sourceUrl'));
        Form_Submission__c s = [SELECT Status__c, Target_Record_Id__c, Error_Message__c, Spam_Reason__c FROM Form_Submission__c WHERE Id = :submissionId WITH USER_MODE];
        return compact(new Map<String, Object>{
            'submissionId' => submissionId, 'status' => s.Status__c, 'targetRecordId' => s.Target_Record_Id__c,
            'errorMessage' => s.Error_Message__c, 'spamReason' => s.Spam_Reason__c
        });
    }

    // ------------------------------------------------------------ schema

    private static List<Map<String, Object>> listObjects(RestRequest req) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        if (req.params.get('all') == 'true') {
            Map<String, Schema.SObjectType> describeAll = JFormSchema.globalDescribe();
            for (String key : describeAll.keySet()) {
                Schema.DescribeSObjectResult d = describeAll.get(key).getDescribe(SObjectDescribeOptions.DEFERRED);
                if (!d.isCreateable() || !d.isQueryable() || d.isCustomSetting() || excluded(d.getName())) {
                    continue;
                }
                out.add(new Map<String, Object>{ 'apiName' => d.getName(), 'label' => d.getLabel(), 'custom' => d.isCustom() });
            }
        } else {
            Map<String, Schema.SObjectType> describeAll = JFormSchema.globalDescribe();
            for (String key : describeAll.keySet()) {
                if (!key.endsWith('__c') && !COMMON_OBJECTS.contains(key)) {
                    continue;
                }
                Schema.DescribeSObjectResult d = describeAll.get(key).getDescribe(SObjectDescribeOptions.DEFERRED);
                if (!d.isCreateable() || d.isCustomSetting()) {
                    continue;
                }
                out.add(new Map<String, Object>{ 'apiName' => d.getName(), 'label' => d.getLabel(), 'custom' => d.isCustom() });
            }
        }
        sortByLabel(out);
        return out;
    }

    private static Map<String, Object> describeFields(String objectApiName, String search) {
        Schema.SObjectType t = JFormSchema.globalDescribe().get(objectApiName);
        if (t == null) {
            throw new ApiException(404, 'UNKNOWN_OBJECT', 'Object "' + objectApiName + '" does not exist or is not accessible.');
        }
        Schema.DescribeSObjectResult od = t.getDescribe();
        String needle = String.isBlank(search) ? null : search.toLowerCase();
        List<Map<String, Object>> fields = new List<Map<String, Object>>();
        Map<String, Schema.SObjectField> fieldMap = od.fields.getMap();
        List<String> names = new List<String>(fieldMap.keySet());
        names.sort();
        for (String n : names) {
            Schema.DescribeFieldResult d = fieldMap.get(n).getDescribe();
            if (!d.isCreateable() || d.isCalculated() || d.isAutoNumber()) {
                continue;
            }
            if (needle != null && !d.getName().toLowerCase().contains(needle) && !d.getLabel().toLowerCase().contains(needle)) {
                continue;
            }
            String sfType = String.valueOf(d.getType()).toLowerCase();
            Map<String, Object> f = new Map<String, Object>{
                'apiName' => d.getName(),
                'label' => d.getLabel(),
                'type' => sfType,
                'required' => !d.isNillable() && !d.isDefaultedOnCreate() && d.getType() != Schema.DisplayType.BOOLEAN
            };
            if (d.getLength() > 0) {
                f.put('length', d.getLength());
            }
            if (d.getType() == Schema.DisplayType.PICKLIST || d.getType() == Schema.DisplayType.MULTIPICKLIST) {
                List<String> values = new List<String>();
                for (Schema.PicklistEntry pe : d.getPicklistValues()) {
                    if (pe.isActive()) {
                        values.add(pe.getValue());
                    }
                }
                f.put('picklistValues', values);
            }
            if (!d.getReferenceTo().isEmpty()) {
                List<String> refs = new List<String>();
                for (Schema.SObjectType r : d.getReferenceTo()) {
                    refs.add(String.valueOf(r));
                }
                f.put('referenceTo', refs);
            }
            String suggested = suggestFieldType(sfType);
            if (suggested != null) {
                f.put('suggestedFieldType', suggested);
            }
            fields.add(f);
        }
        return new Map<String, Object>{ 'objectApiName' => od.getName(), 'label' => od.getLabel(), 'fields' => fields };
    }

    @TestVisible
    private static String suggestFieldType(String sfType) {
        switch on sfType {
            when 'email' { return 'email'; }
            when 'phone' { return 'phone'; }
            when 'textarea' { return 'comment'; }
            when 'picklist' { return 'picklist'; }
            when 'multipicklist' { return 'checkboxes'; }
            when 'date', 'datetime' { return 'date'; }
            when 'time' { return 'time'; }
            when 'boolean' { return 'consent'; }
            when 'integer', 'double', 'currency', 'percent' { return 'number'; }
            when 'string', 'url' { return 'text'; }
            when else { return null; }
        }
    }

    // ------------------------------------------------------------ shapes

    /** Canonical definition plus the summary fields clients list and link with. */
    @TestVisible
    private static Map<String, Object> formResponse(JFormDefinition.Form def) {
        Map<String, Object> m = JFormDefinition.toMap(def);
        Form__c rec = [SELECT CreatedDate, LastModifiedDate FROM Form__c WHERE Id = :def.id WITH USER_MODE];
        m.put('sectionCount', def.sections.size());
        m.put('createdDate', rec.CreatedDate);
        m.put('lastModifiedDate', rec.LastModifiedDate);
        m.put('builderUrl', JFormAgentSupport.builderUrl(def.id));
        if (def.isActive == true) {
            String publicUrl = JFormAgentSupport.publicUrl(def);
            if (publicUrl != null) {
                m.put('publicUrl', publicUrl);
            }
        }
        return m;
    }

    private static Map<String, Object> summaryOf(Form__c f, Integer sectionCount) {
        return compact(new Map<String, Object>{
            'id' => f.Id,
            'name' => f.Name,
            'label' => f.Form_Label__c,
            'description' => f.Description__c,
            'status' => f.Status__c,
            'isActive' => f.Is_Active__c == true,
            'displayStyle' => f.Display_Style__c,
            'targetObjectApiName' => f.Target_Object_API_Name__c,
            'version' => f.Version__c == null ? null : f.Version__c.intValue(),
            'publicKey' => f.Public_Key__c,
            'sectionCount' => sectionCount,
            'createdDate' => f.CreatedDate,
            'lastModifiedDate' => f.LastModifiedDate,
            'builderUrl' => JFormAgentSupport.builderUrl(f.Id)
        });
    }

    private static Map<String, Object> summaryOf(JFormDefinition.Form def) {
        Map<String, Object> m = formResponse(def);
        m.remove('sections');
        m.remove('theme');
        m.remove('settings');
        return m;
    }

    /** Copy settings present in the body onto the definition. Returns true when anything changed. */
    private static Boolean applySettings(JFormDefinition.Form def, Map<String, Object> b) {
        Boolean changed = false;
        if (b.containsKey('name') && String.isNotBlank(str(b, 'name')) && !b.containsKey('newName')) { def.name = str(b, 'name'); changed = true; }
        if (b.containsKey('label')) { def.label = str(b, 'label'); changed = true; }
        if (b.containsKey('description')) { def.description = str(b, 'description'); changed = true; }
        if (b.containsKey('targetObjectApiName')) { JFormAutomationService.retarget(def, str(b, 'targetObjectApiName')); changed = true; }
        if (b.containsKey('displayStyle')) { def.displayStyle = str(b, 'displayStyle'); changed = true; }
        if (b.containsKey('welcomeMessage')) { def.welcomeMessage = str(b, 'welcomeMessage'); changed = true; }
        if (b.containsKey('thankYouMessage')) { def.thankYouMessage = str(b, 'thankYouMessage'); changed = true; }
        // welcome and thank-you screens: whole objects, checked by JFormScreens when the form is saved
        for (String screen : new List<String>{ 'welcome', 'ending' }) {
            if (b.containsKey(screen)) {
                if (def.settings == null) {
                    def.settings = new Map<String, Object>();
                }
                if (b.get(screen) == null) {
                    def.settings.remove(screen);
                } else if (b.get(screen) instanceof Map<String, Object>) {
                    def.settings.put(screen, b.get(screen));
                } else {
                    throw new ApiException(400, 'INVALID_FORM', screen + ' must be an object.');
                }
                changed = true;
            }
        }
        return changed;
    }

    // ------------------------------------------------------------ helpers

    @TestVisible
    private static List<String> pathParts(String uri) {
        String path = uri == null ? '' : uri;
        // .../apexrest/jform/v1/forms in the package, .../apexrest/v1/forms from source
        Integer at = path.indexOf('/v1/');
        if (at < 0 && path.endsWith('/v1')) {
            at = path.length() - 3;
        }
        path = at < 0 ? path : path.substring(at + '/v1'.length());
        if (path.contains('?')) {
            path = path.substringBefore('?');
        }
        List<String> parts = new List<String>();
        for (String s : path.split('/')) {
            if (String.isNotBlank(s)) {
                parts.add(s);
            }
        }
        return parts;
    }

    private static Map<String, Object> body(RestRequest req) {
        if (req.requestBody == null || String.isBlank(req.requestBody.toString())) {
            return new Map<String, Object>();
        }
        Object raw = JSON.deserializeUntyped(req.requestBody.toString());
        if (!(raw instanceof Map<String, Object>)) {
            throw new ApiException(400, 'INVALID_JSON', 'The request body must be a JSON object.');
        }
        return (Map<String, Object>) raw;
    }

    private static Id toId(String raw) {
        try {
            Id value = Id.valueOf(raw);
            if (value.getSObjectType() != Form__c.SObjectType) {
                throw new ApiException(400, 'INVALID_ID', raw + ' is not a form Id.');
            }
            return value;
        } catch (StringException e) {
            throw new ApiException(400, 'INVALID_ID', raw + ' is not a valid Salesforce Id.');
        }
    }

    private static Integer intParam(Map<String, String> q, String name, Integer fallback, Integer min, Integer max) {
        String raw = q.get(name);
        if (String.isBlank(raw)) {
            return fallback;
        }
        if (!raw.isNumeric()) {
            throw new ApiException(400, 'INVALID_PARAMETER', name + ' must be a whole number.');
        }
        return Math.min(Math.max(Integer.valueOf(raw), min), max);
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static String firstNonBlank(List<String> values) {
        for (String v : values) {
            if (String.isNotBlank(v)) {
                return v;
            }
        }
        return null;
    }

    private static void failIf(String errorMessage) {
        if (String.isNotBlank(errorMessage)) {
            Integer status = errorMessage.startsWith('Form not found') ? 404 : 400;
            throw new ApiException(status, status == 404 ? 'NOT_FOUND' : 'INVALID_REQUEST', errorMessage);
        }
    }

    private static Map<String, Object> compact(Map<String, Object> m) {
        for (String k : new List<String>(m.keySet())) {
            if (m.get(k) == null) {
                m.remove(k);
            }
        }
        return m;
    }

    private static Boolean excluded(String apiName) {
        for (String suffix : EXCLUDED_SUFFIXES) {
            if (apiName.endsWith(suffix) && apiName != 'Event') {
                return true;
            }
        }
        return false;
    }

    private static void sortByLabel(List<Map<String, Object>> rows) {
        Map<String, Map<String, Object>> byKey = new Map<String, Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            byKey.put(String.valueOf(r.get('label')).toLowerCase() + '|' + r.get('apiName'), r);
        }
        List<String> keys = new List<String>(byKey.keySet());
        keys.sort();
        rows.clear();
        for (String k : keys) {
            rows.add(byKey.get(k));
        }
    }

    private static void rollback(Savepoint sp) {
        if (sp != null) {
            Database.rollback(sp);
        }
    }

    private static void respond(Integer status, Object payload) {
        RestResponse res = RestContext.response;
        res.statusCode = status;
        res.addHeader('Content-Type', 'application/json');
        res.responseBody = Blob.valueOf(JSON.serialize(payload, true));
    }

    private static void respondError(Integer status, String code, String message) {
        respond(status, new Map<String, Object>{ 'errorCode' => code, 'message' => message });
    }
}
