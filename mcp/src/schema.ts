/**
 * Zod schemas for form definitions. These double as the MCP tool input schemas
 * and as the local validator behind `validate_form_definition`, so an agent gets
 * precise errors before anything is written to Salesforce.
 */
import { z } from "zod";

/** Field types the JForm renderer (jformRenderer) draws. Mirrors JFormDefinition.PICKLIST_BY_TYPE in Apex. */
export const FIELD_TYPES = [
  "text",
  "name",
  "address",
  "email",
  "phone",
  "number",
  "comment",
  "picklist",
  "radio",
  "multiselect",
  "checkboxes",
  "date",
  "time",
  "fileupload",
  "signature",
  "rating",
  "nps",
  "yesno",
  "table",
  "consent",
  "checkbox",
  "payment",
  "hidden",
  "richtext",
  "heading",
  "divider",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Types that need `options`. */
export const OPTION_TYPES: readonly FieldType[] = ["picklist", "radio", "multiselect", "checkboxes", "table"];
/** Display-only types: no answer, no label required. */
export const LAYOUT_TYPES: readonly FieldType[] = ["richtext", "heading", "divider"];

export const FIELD_TYPE_HELP: Record<FieldType, string> = {
  text: "Single-line text input.",
  name: "A person's name: first name then last name in one field. `layout` is inline (default) or stacked. When required, first and last name must be filled in. Each part is stored as its own answer under `<field key>.firstName` and `.lastName`, which conditions and record steps use (map them to FirstName and LastName on a Contact or Lead); the name as a whole cannot be mapped or tested.",
  address:
    "A postal address in one field: country, street, city, state or province and postal code, like a Salesforce Mailing Address. Use it instead of separate street, city and postcode fields. `purpose` billing or shipping sets the browser's autofill and the default record address (an Account's Billing or Shipping Address); `defaultCountry` and `countries` are ISO codes such as AU (all countries when `countries` is omitted). The country and the state are lists where the org has State and Country/Territory Picklists. Each part is stored as its own answer under `<field key>.country`, `.street`, `.city`, `.state` and `.postalCode` (names), plus `.countryCode` and `.stateCode`; conditions test a part (country and state by name) and record steps map the parts, so the address as a whole cannot be mapped or tested.",
  email: "Email input with built-in format validation.",
  phone: "Phone number input.",
  number: "Numeric input. validation.minValue / maxValue apply.",
  comment: "Multi-line text area for free text.",
  picklist: "Single-select dropdown. Requires `options`.",
  radio: "Single choice shown as radio buttons or cards. Requires `options`.",
  multiselect: "Retired: looks and maps like checkboxes and is kept only for existing forms. Use `checkboxes` for new fields.",
  checkboxes: "Several checkboxes, any number can be ticked. Requires `options`.",
  date: "Date picker.",
  time: "Time picker.",
  fileupload: "File upload. Optional `fileType` restricts to Image, Document or Audio.",
  signature: "Signature pad: respondents draw, or type their name. Saved as a PNG file on the response and on the record the form creates, not mapped to a record field. Put it last, after the terms.",
  rating: "1 to 5 star rating.",
  nps: "Net Promoter Score, 0 to 10.",
  yesno: "Yes / No buttons. Stored as Yes or No.",
  table: "Several questions on one shared scale: `rows` are the questions, `options` the columns (the scale). Each answered row is stored as its own answer under `<field key>.<row key>`, which conditions and record steps use; the table as a whole cannot be mapped or tested. `multiple: true` allows several answers per row. At most 20 rows and 10 columns.",
  consent: "Single checkbox for terms or marketing consent. Stored as true or false.",
  checkbox: "Single checkbox. Stored as true or false.",
  payment:
    "Payment block: takes a card payment through the org's Stripe account before the response counts (one per form). `pricing` is fixed (`amount`), choice (`source` = a radio, picklist or checkboxes key, `prices` per option value), quantity (`source` = a number field key, `unitPrice`) or custom (pay what you want, optional `minimum`). Amounts are in the form's currency, set with test or live payments on the form's Settings tab. Its answer is the total paid.",
  hidden: "Not shown. Carries a defaultValue (for example a campaign code) into the submission.",
  richtext: "Read-only formatted text block (instructions). Uses `richtext` HTML instead of `label`.",
  heading: "Section heading. Uses `label` as the heading text.",
  divider: "Horizontal line between groups of fields.",
};

export const DISPLAY_STYLES = ["Single Page", "Multi-Page (Sections)"] as const;
export const FORM_STATUSES = ["Draft", "Active", "Inactive", "Archived"] as const;
export const FILE_TYPES = ["Image", "Document", "Audio"] as const;
export const WIDTHS = [25, 50, 75, 100] as const;

export const ConditionSchema = z.object({
  field: z.string().min(1).describe("`key` of the field whose value is tested."),
  operator: z
    .enum(["equals", "not_equals", "contains", "is_empty", "is_not_empty", "greater_than", "less_than"])
    .describe("Comparison operator."),
  value: z.string().optional().describe("Value to compare against. Not needed for is_empty / is_not_empty."),
});

export const ConditionalLogicSchema = z
  .object({
    action: z.enum(["show", "hide", "require"]).describe("What happens when the conditions match."),
    match: z.enum(["all", "any"]).default("all").describe("Whether all or any conditions must match."),
    conditions: z.array(ConditionSchema).min(1),
  })
  .describe("Conditional visibility or requirement rule. Fields are referenced by their `key`.");
export type ConditionalLogic = z.infer<typeof ConditionalLogicSchema>;

export const FieldOptionSchema = z.object({
  label: z.string().min(1).max(255),
  value: z.string().min(1).max(255).optional().describe("Stored value. Defaults to the label."),
});

/** Table limits; JFormTableService enforces the same. */
export const MAX_TABLE_ROWS = 20;
export const MAX_TABLE_COLUMNS = 10;
export const MAX_ROW_KEY_LENGTH = 20;
/** Submission_Field_Value__c.Field_Key__c holds `<field key>.<row key>`. */
export const MAX_ANSWER_KEY_LENGTH = 80;
/** The answers an address field stores, `<field key>.<part>`. Mirrors JFormAddressService. */
export const ADDRESS_ANSWER_PARTS = ["country", "street", "city", "state", "postalCode", "stateCode", "countryCode"] as const;

export const TableRowSchema = z.union([
  z.string().min(1).max(255).describe("Row label; its key is made from the label."),
  z.object({
    key: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .max(MAX_ROW_KEY_LENGTH)
      .optional()
      .describe("Stable row key. Made from the label when omitted; never changes afterwards."),
    label: z.string().min(1).max(255),
  }),
]);

/** The key a table row gets from its label ("Ease of use" -> ease_of_use), unique among `used`. Mirrors JFormTableService.normaliseRows. */
export function rowKeyFor(label: string, position: number, used: Set<string>): string {
  let key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) key = `row_${position}`;
  else if (!/^[a-z]/.test(key)) key = `r_${key}`;
  key = key.slice(0, MAX_ROW_KEY_LENGTH).replace(/_$/, "");
  let candidate = key;
  for (let n = 2; used.has(candidate); n++) {
    const suffix = `_${n}`;
    candidate = key.slice(0, MAX_ROW_KEY_LENGTH - suffix.length) + suffix;
  }
  return candidate;
}

/** A table's row keys as the server will save them: given keys kept (first use wins), the rest made from labels. */
export function tableRowKeys(rows: readonly (string | { key?: string; label: string })[]): string[] {
  const used = new Set<string>();
  const kept = rows.map((r) => {
    if (typeof r === "string" || !r.key || used.has(r.key)) return undefined;
    used.add(r.key);
    return r.key;
  });
  return rows.map((r, i) => {
    if (kept[i]) return kept[i] as string;
    const key = rowKeyFor(typeof r === "string" ? r : r.label, i + 1, used);
    used.add(key);
    return key;
  });
}

export const FieldValidationSchema = z.object({
  regexPattern: z.string().optional().describe("JavaScript regular expression the value must match."),
  errorMessage: z.string().max(255).optional().describe("Message shown when validation fails."),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
});

export const FieldInputSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .max(60)
    .optional()
    .describe("Stable identifier unique within the form, e.g. `email`. Used by conditional logic. Auto-generated when omitted."),
  type: z.enum(FIELD_TYPES),
  label: z.string().max(255).optional().describe("Label shown to the respondent. Required except for richtext and divider."),
  helpText: z.string().max(255).optional(),
  placeholder: z.string().max(255).optional(),
  defaultValue: z.string().max(255).optional(),
  required: z.boolean().default(false),
  options: z.array(FieldOptionSchema).optional().describe("Choices for picklist, radio, multiselect and checkboxes; the columns of a table."),
  rows: z.array(TableRowSchema).max(MAX_TABLE_ROWS).optional().describe("Table only: the questions, as labels or { key, label }."),
  multiple: z.boolean().optional().describe("Table only: several answers per row (checkboxes) instead of one."),
  everyRow: z.boolean().optional().describe("Table only, when required: every row must be answered (the default); false means one answered row is enough."),
  layout: z.enum(["inline", "stacked"]).optional().describe("Name only: the parts on one row (default) or one under another."),
  purpose: z.enum(["billing", "shipping"]).optional().describe("Address only: a billing or shipping address. Omit for any other address."),
  defaultCountry: z.string().regex(/^[A-Za-z]{2}$/).optional().describe("Address only: the ISO code of the country the field starts in, e.g. AU."),
  countries: z.array(z.string().regex(/^[A-Za-z]{2}$/)).optional().describe("Address only: the ISO codes of the countries offered; all when omitted."),
  richtext: z.string().optional().describe("HTML content for a richtext block."),
  pricing: z.enum(["fixed", "choice", "quantity", "custom"]).optional().describe("Payment only: how the total is found. Defaults to fixed."),
  item: z.string().max(120).optional().describe("Payment only: what people pay for, shown on Stripe's page and receipt. Defaults to the form's title."),
  amount: z.number().positive().optional().describe("Payment, fixed: the price in the form's currency, e.g. 45 or 12.5."),
  source: z.string().optional().describe("Payment, choice or quantity: the key of the choice field the prices follow, or of the number field that holds the quantity."),
  prices: z
    .array(z.object({ value: z.string(), amount: z.number().positive() }))
    .optional()
    .describe("Payment, choice: a price per option value of the source field. Options without a price are free."),
  unitPrice: z.number().positive().optional().describe("Payment, quantity: the price of one."),
  minimum: z.number().positive().optional().describe("Payment, custom: the least people may pay."),
  targetFieldApiName: z
    .string()
    .optional()
    .describe("Shortcut: API name of a field on the form's record step object this answer feeds, e.g. `Email` on Lead. It becomes a mapping on the form's record step (settings.automation.steps). Use describe_object_fields to find valid names."),
  fileType: z.enum(FILE_TYPES).optional(),
  validation: FieldValidationSchema.optional(),
  width: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]).default(100).describe("Column width in percent on medium and large screens."),
  conditionalLogic: ConditionalLogicSchema.optional(),
});
export type FieldInput = z.infer<typeof FieldInputSchema>;

export const SectionInputSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(60).optional(),
  name: z.string().min(1).max(80).describe("Internal section name, e.g. `Contact details`."),
  label: z.string().max(255).optional().describe("Heading shown to respondents. Defaults to `name`."),
  description: z.string().optional(),
  fields: z.array(FieldInputSchema).min(1).max(100),
  conditionalLogic: ConditionalLogicSchema.optional(),
});
export type SectionInput = z.infer<typeof SectionInputSchema>;

const HttpLinkSchema = z
  .string()
  .max(1000)
  .regex(/^https?:\/\/\S+$/i, "Links start with http:// or https://.");

export const WelcomeScreenSchema = z
  .object({
    mode: z
      .enum(["off", "message", "screen"])
      .optional()
      .describe("off: the form opens on page 1. message: welcomeMessage above page 1 (the default when the form has one). screen: a start screen before page 1 with title, welcomeMessage, image and a Start button; a link with ?start=1 skips it."),
    title: z.string().max(120).optional().describe("Start screen heading. Defaults to the form's label."),
    buttonLabel: z.string().max(40).optional().describe("Start button text. Defaults to \"Start\"."),
    showTime: z.boolean().optional().describe("Show \"Takes about N minutes\" on the start screen."),
    minutes: z.number().int().min(1).max(120).optional().describe("Time to complete, in minutes. Without it, estimated from the number of questions."),
    imageUrl: z
      .string()
      .max(1000)
      .regex(/^(https:\/\/\S+|\/(?!\/)\S*)$/i, "Images are https links or a path on the site.")
      .optional()
      .describe("Start screen image. Defaults to the design's cover image."),
    showHeader: z
      .boolean()
      .optional()
      .describe("With a start screen, the form pages leave out the form's title and description (the start screen shows them). true repeats them above the questions."),
  })
  .describe("How the form opens. Replaces the whole welcome screen object; null goes back to the default.");

export const ThankYouScreenSchema = z
  .object({
    title: z.string().max(120).optional().describe("Thank-you screen heading, above thankYouMessage."),
    buttons: z
      .array(z.object({ label: z.string().min(1).max(40), url: HttpLinkSchema }))
      .max(2)
      .optional()
      .describe("Up to two buttons, e.g. [{\"label\":\"Back to home\",\"url\":\"https://example.com\"}]. The first is the main one."),
    submitAnother: z.boolean().optional().describe("Offer a Submit another response button that resets the form."),
    redirectUrl: HttpLinkSchema.optional().describe("Send people to this link after the thank-you screen. Embedded forms ask the page around them to go there."),
    redirectDelay: z.number().int().min(0).max(30).optional().describe("Seconds to show the thank-you screen before the redirect; 0 goes at once."),
  })
  .describe("What follows a response. Replaces the whole thank-you screen object; null removes the extras.");

export const FormInputSchema = z.object({
  name: z.string().min(1).max(80).describe("Form name (record Name). Shown in the builder's form list."),
  label: z.string().max(255).optional().describe("Public title. Defaults to `name`."),
  description: z.string().optional(),
  targetObjectApiName: z
    .string()
    .optional()
    .describe("Shortcut: Salesforce object the form creates records in, e.g. `Lead`, `Contact`, `Case`. It becomes one record step with the form's fields matched by name (or the targetFieldApiName mappings). Richer flows live in settings.automation.steps. Use list_target_objects for options."),
  displayStyle: z
    .enum(DISPLAY_STYLES)
    .optional()
    .describe("Render as one long page or one page per section. Defaults to Multi-Page when there is more than one section."),
  welcomeMessage: z.string().optional(),
  thankYouMessage: z.string().optional(),
  welcome: WelcomeScreenSchema.optional(),
  ending: ThankYouScreenSchema.optional(),
  theme: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional theme, e.g. {\"primary\":\"#337418\",\"background\":\"#F8F8F8\",\"labelPosition\":\"above\",\"fieldStyle\":\"outline\"}. Clone a form to reuse its look."),
  sections: z.array(SectionInputSchema).min(1).max(20),
});
export type FormInput = z.infer<typeof FormInputSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Semantic checks Zod cannot express: option requirements, key uniqueness,
 * conditional logic references, and the collection size limit.
 */
export function validateFormDefinition(form: FormInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const keys = new Set<string>();
  // a condition tests one row of a table ("field.row") or one part of a name or address ("field.firstName"), never the field as a whole
  const tableKeys = new Set<string>();
  const nameKeys = new Set<string>();
  const addressKeys = new Set<string>();
  const answerKeys = new Set<string>();
  let fieldCount = 0;
  let optionCount = 0;

  form.sections.forEach((section, si) => {
    const sPath = `sections[${si}]`;
    if (section.key) {
      if (keys.has(section.key)) issues.push({ path: `${sPath}.key`, message: `Duplicate key "${section.key}".` });
      keys.add(section.key);
    }
    section.fields.forEach((field, fi) => {
      fieldCount += 1;
      const fPath = `${sPath}.fields[${fi}]`;
      if (field.key) {
        if (keys.has(field.key)) issues.push({ path: `${fPath}.key`, message: `Duplicate key "${field.key}".` });
        keys.add(field.key);
      }
      if (field.type === "richtext") {
        if (!field.richtext?.trim()) issues.push({ path: `${fPath}.richtext`, message: "richtext fields need `richtext` HTML content." });
      } else if (field.type !== "divider" && field.type !== "hidden" && !field.label?.trim()) {
        issues.push({ path: `${fPath}.label`, message: `A ${field.type} field needs a label.` });
      }
      if (OPTION_TYPES.includes(field.type)) {
        if (!field.options?.length) {
          issues.push({ path: `${fPath}.options`, message: `${field.type} fields need at least one option.` });
        } else {
          optionCount += field.options.length;
          const seen = new Set<string>();
          field.options.forEach((o, oi) => {
            const v = o.value ?? o.label;
            if (seen.has(v)) issues.push({ path: `${fPath}.options[${oi}]`, message: `Duplicate option value "${v}".` });
            seen.add(v);
          });
        }
      } else if (field.options?.length) {
        issues.push({ path: `${fPath}.options`, message: `Only ${OPTION_TYPES.join(", ")} fields accept options.` });
      }
      if (field.type === "name") {
        if (field.targetFieldApiName)
          issues.push({ path: `${fPath}.targetFieldApiName`, message: "A name is mapped part by part in a record step, with sources such as `<field key>.firstName`." });
        nameKeys.add(field.key ?? "");
        if (field.key) {
          for (const part of ["firstName", "lastName"]) answerKeys.add(`${field.key}.${part}`);
          if (`${field.key}.firstName`.length > MAX_ANSWER_KEY_LENGTH)
            issues.push({ path: `${fPath}.key`, message: `A name field's key must be at most ${MAX_ANSWER_KEY_LENGTH - "firstName".length - 1} characters.` });
        }
      } else if (field.layout !== undefined) {
        issues.push({ path: fPath, message: "layout only applies to name fields." });
      }
      if (field.type === "address") {
        if (field.targetFieldApiName)
          issues.push({ path: `${fPath}.targetFieldApiName`, message: "An address is mapped part by part in a record step, with sources such as `<field key>.city`." });
        addressKeys.add(field.key ?? "");
        if (field.key) {
          for (const part of ADDRESS_ANSWER_PARTS) answerKeys.add(`${field.key}.${part}`);
          if (`${field.key}.countryCode`.length > MAX_ANSWER_KEY_LENGTH)
            issues.push({ path: `${fPath}.key`, message: `An address field's key must be at most ${MAX_ANSWER_KEY_LENGTH - "countryCode".length - 1} characters.` });
        }
        const countries = (field.countries ?? []).map((c) => c.toUpperCase());
        if (field.defaultCountry && countries.length && !countries.includes(field.defaultCountry.toUpperCase()))
          issues.push({ path: `${fPath}.defaultCountry`, message: "The default country must be one of `countries`." });
      } else if (field.purpose !== undefined || field.defaultCountry !== undefined || field.countries !== undefined) {
        issues.push({ path: fPath, message: "purpose, defaultCountry and countries only apply to address fields." });
      }
      if (field.fileType && field.type !== "fileupload") {
        issues.push({ path: `${fPath}.fileType`, message: "fileType only applies to fileupload fields." });
      }
      if (field.type === "signature" && field.targetFieldApiName) {
        issues.push({ path: `${fPath}.targetFieldApiName`, message: "A signature is saved as a file on the record, not mapped to a record field." });
      }
      if (field.type === "table") {
        const rows = field.rows ?? [];
        if (!rows.length) issues.push({ path: `${fPath}.rows`, message: "A table needs at least one row." });
        if ((field.options?.length ?? 0) > MAX_TABLE_COLUMNS)
          issues.push({ path: `${fPath}.options`, message: `A table can have up to ${MAX_TABLE_COLUMNS} columns (got ${field.options?.length}).` });
        if (field.targetFieldApiName)
          issues.push({ path: `${fPath}.targetFieldApiName`, message: "A table is mapped row by row in a record step, with sources such as `<field key>.<row key>`." });
        tableKeys.add(field.key ?? "");
        tableRowKeys(rows).forEach((rowKey, ri) => {
          if (field.key && `${field.key}.${rowKey}`.length > MAX_ANSWER_KEY_LENGTH)
            issues.push({ path: `${fPath}.rows[${ri}]`, message: `The field key and row key "${rowKey}" together must be at most ${MAX_ANSWER_KEY_LENGTH - 1} characters.` });
          if (field.key) answerKeys.add(`${field.key}.${rowKey}`);
        });
        rows.forEach((r, ri) => {
          if (typeof r !== "string" && r.key && rows.findIndex((o) => typeof o !== "string" && o.key === r.key) !== ri)
            issues.push({ path: `${fPath}.rows[${ri}].key`, message: `Duplicate row key "${r.key}".` });
        });
      } else if (field.rows || field.multiple !== undefined || field.everyRow !== undefined) {
        issues.push({ path: fPath, message: "rows, multiple and everyRow only apply to table fields." });
      }
      const v = field.validation;
      if (v) {
        if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength)
          issues.push({ path: `${fPath}.validation`, message: "minLength is greater than maxLength." });
        if (v.minValue !== undefined && v.maxValue !== undefined && v.minValue > v.maxValue)
          issues.push({ path: `${fPath}.validation`, message: "minValue is greater than maxValue." });
        if (v.regexPattern) {
          try {
            new RegExp(v.regexPattern);
          } catch (e) {
            issues.push({ path: `${fPath}.validation.regexPattern`, message: `Invalid regular expression: ${(e as Error).message}` });
          }
        }
      }
    });
  });

  // Conditional logic may only reference known field keys.
  const checkLogic = (logic: ConditionalLogic | undefined, path: string, selfKey?: string) => {
    if (!logic) return;
    logic.conditions.forEach((c, ci) => {
      if (tableKeys.has(c.field))
        issues.push({ path: `${path}.conditions[${ci}].field`, message: `"${c.field}" is a table: test one of its rows, such as "${c.field}.<row key>".` });
      else if (nameKeys.has(c.field))
        issues.push({ path: `${path}.conditions[${ci}].field`, message: `"${c.field}" is a name: test one of its parts, such as "${c.field}.lastName".` });
      else if (addressKeys.has(c.field))
        issues.push({ path: `${path}.conditions[${ci}].field`, message: `"${c.field}" is an address: test one of its parts, such as "${c.field}.country".` });
      else if (!keys.has(c.field) && !answerKeys.has(c.field)) issues.push({ path: `${path}.conditions[${ci}].field`, message: `Unknown field key "${c.field}".` });
      if (selfKey && (c.field === selfKey || c.field.startsWith(`${selfKey}.`))) issues.push({ path: `${path}.conditions[${ci}].field`, message: "A field cannot depend on itself." });
      if (!["is_empty", "is_not_empty"].includes(c.operator) && c.value === undefined)
        issues.push({ path: `${path}.conditions[${ci}].value`, message: `Operator ${c.operator} needs a value.` });
    });
  };
  form.sections.forEach((section, si) => {
    checkLogic(section.conditionalLogic, `sections[${si}].conditionalLogic`, section.key);
    section.fields.forEach((field, fi) => checkLogic(field.conditionalLogic, `sections[${si}].fields[${fi}].conditionalLogic`, field.key));
  });

  if (fieldCount > 200) issues.push({ path: "sections", message: `Forms are limited to 200 fields (got ${fieldCount}).` });
  if (optionCount > 2000) issues.push({ path: "sections", message: `Forms are limited to 2000 picklist options in total (got ${optionCount}).` });
  return issues;
}
