/**
 * Agent action: find forms by text (name, title or description), status and recency.
 * Used for requests like "the latest form we built for the Summer season".
 */
global with sharing class JFormFindFormsAction {

    global class Request {
        @InvocableVariable(
            label='Search Text'
            description='Words to look for in the form name, public title or description, for example "summer" or "clinic". Leave empty to list recent forms.'
        )
        global String searchText;

        @InvocableVariable(
            label='Modified Within Days'
            description='Only return forms changed in the last N days. Leave empty for any time.'
        )
        global Integer modifiedWithinDays;

        @InvocableVariable(
            label='Status'
            description='Only return forms with this status: Draft, Active, Inactive or Archived. Leave empty for all.'
        )
        global String status;

        @InvocableVariable(
            label='Max Results'
            description='Maximum number of forms to return, newest first. Defaults to 10.'
        )
        global Integer maxResults;
    }

    global class Result {
        @InvocableVariable(
            label='Forms Summary'
            description='Numbered list of matching forms, newest first, with Id, status, field count and last modified date'
        )
        global String formsSummary;

        @InvocableVariable(
            label='Form Count'
            description='Number of forms returned'
        )
        global Integer formCount;

        @InvocableVariable(
            label='Most Recent Form Id'
            description='Id of the most recently modified matching form, for follow-up actions'
        )
        global String mostRecentFormId;

        @InvocableVariable(
            label='Error Message'
            description='Why the search failed, if it did'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Find Forms'
        description='Finds forms by name, title or description text, status and how recently they changed. Returns the newest matches first.'
        category='JForm'
    )
    global static List<Result> find(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            String capacity = JFormAgentSupport.capacityProblem(results.size());
            if (capacity != null) {
                Result r = new Result();
                r.errorMessage = capacity;
                results.add(r);
                continue;
            }
            results.add(findOne(req));
        }
        return results;
    }

    private static Result findOne(Request req) {
        Result r = new Result();
        try {
            Integer maxResults = req.maxResults == null || req.maxResults < 1 ? 10 : Math.min(req.maxResults, 50);
            String needle = String.isBlank(req.searchText) ? null : req.searchText.trim().toLowerCase();
            Datetime since = req.modifiedWithinDays == null || req.modifiedWithinDays <= 0 ? null : System.now().addDays(-req.modifiedWithinDays);
            String status = String.isBlank(req.status) ? null : req.status.trim();
            Datetime floor = since == null ? Datetime.newInstanceGmt(2000, 1, 1) : since;

            List<Form__c> candidates = [
                SELECT Id, Name, Form_Label__c, Description__c, Status__c, Is_Active__c, Version__c, LastModifiedDate
                FROM Form__c
                WHERE LastModifiedDate >= :floor
                WITH USER_MODE
                ORDER BY LastModifiedDate DESC
                LIMIT 500
            ];
            List<Form__c> matches = new List<Form__c>();
            for (Form__c f : candidates) {
                if (status != null && !status.equalsIgnoreCase(f.Status__c == null ? 'Draft' : f.Status__c)) {
                    continue;
                }
                if (needle != null && !matchesText(f, needle)) {
                    continue;
                }
                matches.add(f);
                if (matches.size() >= maxResults) {
                    break;
                }
            }

            r.formCount = matches.size();
            if (matches.isEmpty()) {
                r.formsSummary = 'No forms matched' + (needle == null ? '' : ' "' + req.searchText + '"') + '.';
                return r;
            }
            r.mostRecentFormId = matches[0].Id;
            // counted per form, not read through a subquery: 500 forms' field rows would not fit one
            Map<Id, Integer> fieldCounts = new Map<Id, Integer>();
            for (AggregateResult ar : [SELECT Form__c formId, COUNT(Id) n FROM Form_Field_Definition__c WHERE Form__c IN :matches WITH USER_MODE GROUP BY Form__c]) {
                fieldCounts.put((Id) ar.get('formId'), (Integer) ar.get('n'));
            }
            List<String> lines = new List<String>();
            Integer i = 0;
            for (Form__c f : matches) {
                i++;
                String state = f.Is_Active__c == true ? 'Live v' + (f.Version__c == null ? 1 : f.Version__c.intValue()) : (String.isBlank(f.Status__c) ? 'Draft' : f.Status__c);
                Integer fields = fieldCounts.containsKey(f.Id) ? fieldCounts.get(f.Id) : 0;
                lines.add(i + '. ' + f.Name + ' (Id ' + f.Id + ', ' + state + ', ' + fields + ' fields, modified ' + f.LastModifiedDate.format('yyyy-MM-dd') + ')');
            }
            r.formsSummary = String.join(lines, '\n');
        } catch (Exception e) {
            r.errorMessage = JFormAgentSupport.errorText(e);
        }
        return r;
    }

    private static Boolean matchesText(Form__c f, String needle) {
        String hay = ((f.Name == null ? '' : f.Name) + ' ' + (f.Form_Label__c == null ? '' : f.Form_Label__c) + ' ' + (f.Description__c == null ? '' : f.Description__c)).toLowerCase();
        for (String word : needle.split('\\s+')) {
            if (!hay.contains(word)) {
                return false;
            }
        }
        return true;
    }
}
