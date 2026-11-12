/** Agent action: summarise a form's responses (counts, records created, errors, choice breakdowns). */
global with sharing class JFormResponseSummaryAction {

    global class Request {
        @InvocableVariable(
            label='Form Id'
            description='Id of the form'
            required=true
        )
        global String formId;
    }

    global class Result {
        @InvocableVariable(
            label='Response Summary'
            description='Plain-text summary: total responses, last 7 days, records created, errors, and counts per choice'
        )
        global String summary;

        @InvocableVariable(
            label='Total Responses'
            description='Total number of responses'
        )
        global Integer totalResponses;

        @InvocableVariable(
            label='Error Message'
            description='Why the summary could not be produced, if it could not'
        )
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Get Response Summary'
        description='Summarises responses to a form: totals, responses in the last 7 days, records created, errors and counts for each choice.'
        category='JForm'
    )
    global static List<Result> summarise(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            Result r = new Result();
            String capacity = JFormAgentSupport.capacityProblem(results.size());
            if (capacity != null) {
                r.errorMessage = capacity;
                results.add(r);
                continue;
            }
            try {
                JFormResponsesController.Summary s = JFormResponsesController.getSummary(req.formId);
                r.totalResponses = s.total;
                List<String> lines = new List<String>{
                    'Total responses: ' + s.total,
                    'Last 7 days: ' + s.last7Days,
                    'Records created or updated: ' + s.withTargetRecord,
                    'Errors to review: ' + s.errors,
                    'Flagged as spam: ' + s.spam
                };
                for (JFormResponsesController.ChoiceSummary c : s.choices) {
                    List<String> parts = new List<String>();
                    for (JFormResponsesController.ChoiceCount cc : c.counts) {
                        parts.add(cc.value + ' ' + cc.count);
                    }
                    lines.add(c.label + ': ' + String.join(parts, ', '));
                }
                r.summary = String.join(lines, '\n');
            } catch (Exception e) {
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }
}
