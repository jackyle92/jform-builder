/**
 * Agent action: give a form one of the Design tab's styles, an optional main colour and a page
 * layout, and save the draft. The rest of the theme (logo, cover, width, fonts the style does not
 * set) stays. A main colour that would make buttons or selected choices hard to read is refused,
 * with the nearest shade that works.
 */
global with sharing class JFormApplyDesignAction {

    global class Request {
        @InvocableVariable(label='Form Id' description='Id of the form to change' required=true)
        global String formId;

        @InvocableVariable(label='Style' description='One of the Design tab\'s styles: Card (clean and neutral, the default), Minimal (plain, underlined fields), Teal (calm, serif headings), Dark (dark background), Warm (friendly orange tones), Corporate (formal blue) or Drift (a soft colour mesh behind a frosted card, with pill buttons). Leave empty to keep the current style.')
        global String style;

        @InvocableVariable(label='Main Colour' description='Colour for buttons and highlights as a hex code, for example #2a5bd7, such as the organisation\'s brand colour. Leave empty for the style\'s own colour.')
        global String primaryColor;

        @InvocableVariable(label='Layout' description='"one long page" to show every question at once, or "one page per section" to show each page of the form on its own with Next and Back buttons. Leave empty to keep it.')
        global String layout;
    }

    global class Result {
        @InvocableVariable(label='Design' description='The form\'s design after the change, in plain English')
        global String design;

        @InvocableVariable(label='Form Outline' description='Updated outline of the form')
        global String summary;

        @InvocableVariable(label='Error Message' description='Why the design could not be changed, if it could not')
        global String errorMessage;
    }

    @InvocableMethod(
        label='JForm: Apply Design'
        description='Give a JForm form a style from the Design tab, an optional main colour and a page layout. Saves the draft.'
        category='JForm'
    )
    global static List<Result> applyDesign(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            Result r = new Result();
            String capacity = JFormAgentSupport.capacityProblem(results.size());
            if (capacity != null) {
                r.errorMessage = capacity;
                results.add(r);
                continue;
            }
            Savepoint sp = Database.setSavepoint();
            try {
                JFormDefinitionService.lockForEdit(req.formId); // parallel calls take turns instead of overwriting each other
                JFormDefinition.Form def = JFormDefinitionService.load(req.formId);
                apply(def, req);
                JFormDefinition.Form saved = JFormDefinitionService.save(def);
                r.design = JFormDesignPresets.describe(saved);
                r.summary = JFormAgentSupport.outline(saved);
            } catch (Exception e) {
                Database.rollback(sp); // nothing half-done stays behind
                r.errorMessage = JFormAgentSupport.errorText(e);
            }
            results.add(r);
        }
        return results;
    }

    private static void apply(JFormDefinition.Form def, Request req) {
        Boolean hasStyle = String.isNotBlank(req.style);
        Boolean hasColour = String.isNotBlank(req.primaryColor);
        Boolean hasLayout = String.isNotBlank(req.layout);
        if (!hasStyle && !hasColour && !hasLayout) {
            throw new JFormDefinition.JFormException('Nothing to change: give a style (' + JFormDesignPresets.styleNames() + '), a main colour or a layout.');
        }
        if (def.theme == null) {
            def.theme = new JFormDefinition.Theme();
        }
        if (hasStyle) {
            JFormDesignPresets.Style s = JFormDesignPresets.find(req.style);
            if (s == null) {
                throw new JFormDefinition.JFormException('Unknown style "' + req.style + '". Use ' + JFormDesignPresets.styleNames() + '.');
            }
            JFormDesignPresets.apply(def.theme, s);
        }
        if (hasColour) {
            String hex = JFormDesignPresets.normalizeHex(req.primaryColor);
            if (hex == null) {
                throw new JFormDefinition.JFormException('"' + req.primaryColor + '" is not a colour. Give a hex code such as #2a5bd7.');
            }
            String problem = JFormDesignPresets.colourProblem(hex, def.theme);
            if (problem != null) {
                String shade = JFormDesignPresets.readableShade(hex, def.theme);
                throw new JFormDefinition.JFormException(problem + (shade == null ? ' Choose a darker or lighter colour.' : ' The nearest shade that reads well is ' + shade + '.'));
            }
            def.theme.primaryColor = hex;
        }
        if (hasLayout) {
            String value = JFormDesignPresets.layoutValue(req.layout);
            if (value == null) {
                throw new JFormDefinition.JFormException('Unknown layout "' + req.layout + '". Use "one long page" or "one page per section".');
            }
            def.displayStyle = value;
        }
    }
}
