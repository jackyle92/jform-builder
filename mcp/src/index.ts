#!/usr/bin/env node
/**
 * JForm MCP server (stdio).
 *
 * Exposes the JForm Salesforce form builder to MCP clients such as Claude Code
 * and Claude Desktop. Authentication is delegated to the Salesforce CLI, so the
 * server never sees a password: run `sf org login web -a <alias>` once and set
 * JFORM_SF_ORG=<alias> (or make it the CLI's default org).
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { SalesforceClient } from "./salesforce.js";
import {
  DISPLAY_STYLES,
  FIELD_TYPES,
  FIELD_TYPE_HELP,
  FORM_STATUSES,
  FieldInputSchema,
  FormInputSchema,
  LAYOUT_TYPES,
  OPTION_TYPES,
  ThankYouScreenSchema,
  WelcomeScreenSchema,
  validateFormDefinition,
} from "./schema.js";
import {
  addFields,
  addLogicRule,
  cloneForm,
  createForm,
  deleteForm,
  describeObjectFields,
  getForm,
  getResponseSummary,
  listForms,
  listSubmissions,
  listTargetObjects,
  publishForm,
  removeField,
  unpublishForm,
  updateFormSettings,
} from "./tools.js";

const client = new SalesforceClient();

const server = new McpServer(
  { name: "jform-mcp", version: "0.2.0" },
  {
    instructions: [
      "Tools for the JForm form builder on Salesforce. Everything goes through the JForm REST API as the CLI user. Typical flows:",
      "- Build something like an existing form: list_forms (search, modifiedSince) -> clone_form -> add_fields / add_logic_rule / update_form_settings -> publish_form.",
      "- Build from scratch: list_target_objects + describe_object_fields to map answers to Salesforce fields -> validate_form_definition -> create_form -> publish_form.",
      "- Check results: get_response_summary for counts and choice breakdowns, list_submissions for individual answers.",
      "Field types are listed in the jform://field-types resource. Conditional logic in a definition references fields by `key`; add_logic_rule also accepts labels.",
      "publish_form creates a new version and returns the public link (when an Experience Cloud site is live), an internal preview link and an iframe embed snippet. Confirm with the user before publishing.",
    ].join("\n"),
  },
);

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const e = err as Error & { status?: number; errorCode?: string };
  const detail = e.errorCode ? ` (${e.errorCode})` : "";
  return { content: [{ type: "text", text: `Error${detail}: ${e.message}` }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

const formIdArg = z.string().describe("Salesforce Id of the Form__c record (15 or 18 characters).");

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

server.registerTool(
  "list_forms",
  {
    title: "List forms",
    description:
      "List forms in the org, newest first. Filter by free-text search (name, label, description), status, target object, or modifiedSince to find e.g. 'the form we built last summer'.",
    inputSchema: {
      search: z.string().optional().describe("Case-insensitive text matched against name, label and description."),
      status: z.enum(FORM_STATUSES).optional(),
      activeOnly: z.boolean().optional(),
      targetObjectApiName: z.string().optional(),
      modifiedSince: z.string().optional().describe("ISO date, e.g. 2025-06-01. Only forms modified on or after this date."),
      limit: z.number().int().min(1).max(200).optional().describe("Default 25."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => run(() => listForms(client, args)),
);

server.registerTool(
  "get_form",
  {
    title: "Get form definition",
    description: "Return the full definition of a form: settings, sections, fields, picklist options, validation and conditional logic.",
    inputSchema: { formId: formIdArg },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ formId }) => run(() => getForm(client, formId)),
);

server.registerTool(
  "list_submissions",
  {
    title: "List submissions",
    description:
      "List responses submitted to a form with every answer, newest first. Each response shows whether a target record was created and any processing error. Responses flagged as spam are left out unless status is Spam or includeSpam is true. On a payment form, responses not paid for (awaiting payment, failed, expired) are left out unless payment is unpaid, and each response carries its payment status and amount.",
    inputSchema: {
      formId: formIdArg,
      limit: z.number().int().min(1).max(200).optional(),
      status: z.enum(["New", "Processed", "Error", "Spam"]).optional().describe("Only responses with this processing status."),
      includeSpam: z.boolean().optional().describe("Also return responses flagged as spam when no status is given."),
      payment: z.enum(["paid", "unpaid", "test"]).optional().describe("Payment forms: only paid responses, only responses not paid for, or only test payments. Left blank, responses not paid for are left out, as on the Responses tab."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ formId, limit, status, includeSpam, payment }) => run(() => listSubmissions(client, formId, limit, status, includeSpam, payment)),
);

server.registerTool(
  "get_response_summary",
  {
    title: "Get response summary",
    description: "Totals for a form: responses overall and in the last 7 days, records created, processing errors, and counts for each choice of every choice field.",
    inputSchema: { formId: formIdArg },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ formId }) => run(() => getResponseSummary(client, formId)),
);

server.registerTool(
  "list_target_objects",
  {
    title: "List target objects",
    description: "Salesforce objects a form can feed (custom objects plus common standard ones such as Lead, Contact, Case, Campaign).",
    inputSchema: { includeAllStandard: z.boolean().optional().describe("Include every createable standard object, not just the common ones.") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ includeAllStandard }) => run(() => listTargetObjects(client, includeAllStandard)),
);

server.registerTool(
  "describe_object_fields",
  {
    title: "Describe object fields",
    description: "List createable fields of a Salesforce object with type, required flag, picklist values and a suggested JForm field type, so form fields can be mapped with targetFieldApiName.",
    inputSchema: {
      objectApiName: z.string().describe("e.g. Lead, Contact, Case or My_Object__c"),
      search: z.string().optional().describe("Filter by field label or API name."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ objectApiName, search }) => run(() => describeObjectFields(client, objectApiName, search)),
);

server.registerTool(
  "validate_form_definition",
  {
    title: "Validate form definition",
    description: "Check a form definition locally without touching Salesforce. Returns a list of issues (empty when valid). Call this before create_form when building a large form.",
    inputSchema: { form: FormInputSchema },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ form }) => ok({ valid: validateFormDefinition(form).length === 0, issues: validateFormDefinition(form) }),
);

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

server.registerTool(
  "create_form",
  {
    title: "Create form",
    description:
      "Create a new form in Draft status from a definition with sections and fields. Picklist, radio and checkboxes fields need options; richtext blocks use `richtext` instead of `label`. Returns the stored definition including record Ids and the builder URL.",
    inputSchema: { form: FormInputSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ form }) => run(() => createForm(client, form)),
);

server.registerTool(
  "clone_form",
  {
    title: "Clone form",
    description:
      "Create a new Draft form that copies every section, field, option and rule of an existing form. Use this for requests like 'build a form similar to X'. Optionally override name, target object and messages; then refine with add_fields / remove_field / update_form_settings.",
    inputSchema: {
      sourceFormId: formIdArg.describe("Id of the form to copy."),
      newName: z.string().max(80).optional().describe("Name for the copy. Defaults to '<source name> (copy)'."),
      label: z.string().optional(),
      description: z.string().optional(),
      targetObjectApiName: z.string().optional(),
      displayStyle: z.enum(DISPLAY_STYLES).optional(),
      welcomeMessage: z.string().optional(),
      thankYouMessage: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ sourceFormId, ...opts }) => run(() => cloneForm(client, sourceFormId, opts)),
);

server.registerTool(
  "add_fields",
  {
    title: "Add fields",
    description: "Append fields to an existing section (defaults to the last section) or to a new section of a form. Keys are made unique automatically; the response lists them in addedFieldKeys.",
    inputSchema: {
      formId: formIdArg,
      fields: z.array(FieldInputSchema).min(1).max(100),
      sectionId: z.string().optional().describe("Id of the section to append to. Defaults to the last section."),
      sectionKey: z.string().optional().describe("Key or title of the section to append to, instead of sectionId."),
      newSection: z
        .object({ name: z.string().min(1).max(80), label: z.string().optional(), description: z.string().optional() })
        .optional()
        .describe("Create a new section for these fields instead of using sectionId."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ formId, fields, sectionId, sectionKey, newSection }) => run(() => addFields(client, formId, fields, { sectionId, sectionKey, newSection })),
);

server.registerTool(
  "remove_field",
  {
    title: "Remove field",
    description:
      "Delete a field (and its options) from a form's draft. Rules, record-step mappings and conditions that used the field lose that reference; a step that matched existing records on it becomes a create step. Call get_form first to see what depends on the field. A second call for the same field returns FIELD_NOT_FOUND.",
    inputSchema: { formId: formIdArg, fieldId: z.string().describe("Field record Id or field key, as returned by get_form.") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  async ({ formId, fieldId }) => run(() => removeField(client, formId, fieldId)),
);

server.registerTool(
  "add_logic_rule",
  {
    title: "Add logic rule",
    description:
      "Show, hide or require a field or page depending on another answer, e.g. show 'Number plate' when 'How will you travel?' equals 'Driving'. Fields and pages can be named by label or key; choice values are matched to the field's options. Returns the rule in plain English.",
    inputSchema: {
      formId: formIdArg,
      target: z.string().describe("Field (label or key) or page (title, key or 'page 2') the rule applies to."),
      action: z.enum(["show", "hide", "require"]).describe("Pages support show and hide."),
      when: z.string().describe("Field whose answer is checked (label or key)."),
      operator: z.enum(["equals", "not_equals", "contains", "is_empty", "is_not_empty", "greater_than", "less_than"]).optional().describe("Defaults to equals."),
      value: z.string().optional().describe("Answer to compare with. Not needed for is_empty / is_not_empty."),
      combine: z.enum(["and", "or"]).optional().describe("Add to an existing rule with the same action instead of replacing it."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ formId, ...rule }) => run(() => addLogicRule(client, formId, rule)),
);

server.registerTool(
  "update_form_settings",
  {
    title: "Update form settings",
    description: "Change form-level settings: name, label, description, display style, welcome and thank-you messages, the welcome screen (welcome: off, message above the form, or a start screen) and the thank-you screen (ending: buttons, submit another, redirect), and the object of the form's main record step (targetObjectApiName). Changes reach respondents when the form is published again. Use publish_form / unpublish_form to take a form live or offline.",
    inputSchema: {
      formId: formIdArg,
      name: z.string().max(80).optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      targetObjectApiName: z.string().optional(),
      displayStyle: z.enum(DISPLAY_STYLES).optional(),
      welcomeMessage: z.string().optional(),
      thankYouMessage: z.string().optional(),
      welcome: WelcomeScreenSchema.nullable().optional(),
      ending: ThankYouScreenSchema.nullable().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ formId, ...patch }) => run(() => updateFormSettings(client, formId, patch)),
);

server.registerTool(
  "publish_form",
  {
    title: "Publish form",
    description:
      "Publish the current draft as a new live version. Returns the version number, the public link (when an Experience Cloud site is live), an internal preview link and an iframe embed snippet. The public link stays the same across versions.",
    inputSchema: {
      formId: formIdArg,
      note: z.string().max(255).optional().describe("Optional release note for this version."),
      confirm: z.literal(true).describe("Must be true. Publishing makes the form public; confirm with the user first."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ formId, note }) => run(() => publishForm(client, formId, note)),
);

server.registerTool(
  "unpublish_form",
  {
    title: "Unpublish form",
    description: "Take a live form offline. The public link stops accepting responses until the form is published again.",
    inputSchema: { formId: formIdArg },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ formId }) => run(() => unpublishForm(client, formId)),
);

server.registerTool(
  "delete_form",
  {
    title: "Delete form",
    description: "Permanently delete an unpublished form with its sections, fields, options and published versions. Submissions are kept but lose their link to the form. Refuses live forms; unpublish first.",
    inputSchema: { formId: formIdArg, confirm: z.literal(true).describe("Must be true. Guards against accidental deletion.") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ formId }) => run(() => deleteForm(client, formId)),
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.registerResource(
  "field-types",
  "jform://field-types",
  {
    title: "Supported field types",
    description: "Field types the JForm renderer supports, with what each one needs.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            fieldTypes: FIELD_TYPES.map((t) => ({ type: t, description: FIELD_TYPE_HELP[t] })),
            displayStyles: DISPLAY_STYLES,
            statuses: FORM_STATUSES,
            optionTypes: OPTION_TYPES,
            layoutTypes: LAYOUT_TYPES,
            widths: [25, 50, 75, 100],
            theme: {
              colors: ["primary", "background", "surface", "text", "labelColor"],
              options: {
                labelPosition: ["above", "left"],
                labelWidth: ["25", "33", "40"],
                fieldStyle: ["outline", "filled", "underline"],
                choiceStyle: ["cards", "list"],
                buttonStyle: ["filled", "outline"],
                textSize: ["small", "medium", "large"],
                width: ["narrow", "medium", "wide"],
                radius: ["square", "soft", "round"],
                headingFont: ["system", "salesforce", "serif", "mono"],
                bodyFont: ["system", "salesforce", "serif", "mono"],
                titleAlign: ["left", "center"],
                titlePlacement: ["page", "card"],
                logoSize: ["small", "medium", "large"],
                coverHeight: ["short", "medium", "tall"],
                sideImagePosition: ["left", "right"],
              },
              images: ["logoUrl", "coverUrl", "sideImageUrl", "backgroundImageUrl"],
              note: "Pass theme on create_form, or clone a form to reuse its look. Image values are public http(s) URLs; embedded forms show the card only.",
            },
            automation: {
              where: "settings.automation.steps, an ordered list of record steps run for every response (see get_form on a form built with the Automate tab for the shape).",
              step: { key: "string", label: "string", action: ["create", "find", "find_or_create", "update"], object: "API name", match: "{ field, source } for find actions", fields: "[{ field, source }]", condition: "{ match: all|any, conditions: [{ field, operator, value }] }", primary: "boolean", updateExisting: "boolean", required: "boolean" },
              sources: { field: "{ type: 'field', key }", value: "{ type: 'value', value: 'text with {{key}} placeholders' }", step: "{ type: 'step', step, path: 'Id' or a field on that record }", submission: "{ type: 'submission', path: formName|sourceUrl|id|submittedAt|publicKey }" },
              note: "targetObjectApiName is a shortcut that creates or retargets the main step. targetObjectApiName on get_form reports the main step's object.",
            },
            conditionalLogic: {
              actions: ["show", "hide", "require"],
              operators: ["equals", "not_equals", "contains", "is_empty", "is_not_empty", "greater_than", "less_than"],
              note: "In a definition, reference fields by `key`. add_logic_rule also accepts labels. Rules are evaluated in the browser and again on the server when a response is submitted.",
            },
          },
          null,
          2,
        ),
      },
    ],
  }),
);

server.registerResource(
  "form",
  new ResourceTemplate("jform://forms/{formId}", { list: undefined }),
  { title: "Form definition", description: "Full definition of one form.", mimeType: "application/json" },
  async (uri, { formId }) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await getForm(client, String(formId)), null, 2) }],
  }),
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Resolve credentials eagerly so misconfiguration surfaces in the client log right away.
  client
    .getAuth()
    .then((a) => console.error(`[jform-mcp] connected to ${a.alias ?? a.username} (${a.instanceUrl})`))
    .catch((e) => console.error(`[jform-mcp] ${e.message}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
