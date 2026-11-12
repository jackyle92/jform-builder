/**
 * Form operations for the MCP tools. Every call goes through the JForm Apex REST
 * API (/services/apexrest/jform/v1 when installed as the package, /v1 from source; class JFormRestApi), so the MCP server, the
 * Lightning workspace and the Agentforce actions share one implementation:
 * the same validation, key handling, version snapshots on publish and public
 * links. Requests run as the CLI user, with that user's CRUD, FLS and sharing.
 */
import { SalesforceClient, assertSalesforceId } from "./salesforce.js";
import { type ConditionalLogic, type FieldInput, type FieldType, type FormInput, validateFormDefinition } from "./schema.js";

// ---------------------------------------------------------------------------
// Output shapes (as returned by JFormRestApi)
// ---------------------------------------------------------------------------

export interface FormSummary {
  id: string;
  name: string;
  label?: string;
  description?: string;
  status?: string;
  isActive: boolean;
  displayStyle?: string;
  targetObjectApiName?: string;
  version?: number;
  publicKey?: string;
  sectionCount: number;
  createdDate: string;
  lastModifiedDate: string;
  builderUrl: string;
  publicUrl?: string;
}

export interface FieldDefinition {
  id: string;
  key?: string;
  type: FieldType | string;
  label?: string;
  helpText?: string;
  placeholder?: string;
  defaultValue?: string;
  required: boolean;
  order: number;
  options?: Array<{ id: string; label: string; value: string; order: number }>;
  richtext?: string;
  targetObjectApiName?: string;
  targetFieldApiName?: string;
  fileType?: string;
  validation?: {
    regexPattern?: string;
    errorMessage?: string;
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
  };
  width: number;
  conditionalLogic?: ConditionalLogic;
}

export interface SectionDefinition {
  id: string;
  key?: string;
  name: string;
  label?: string;
  description?: string;
  order: number;
  conditionalLogic?: ConditionalLogic;
  fields: FieldDefinition[];
}

export interface FormDefinition extends FormSummary {
  welcomeMessage?: string;
  thankYouMessage?: string;
  theme?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  sections: SectionDefinition[];
}

const enc = encodeURIComponent;

function query(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

function formPath(formId: string, suffix = ""): string {
  assertSalesforceId(formId, "Form Id");
  return `/forms/${formId}${suffix}`;
}

function invalid(issues: Array<{ path: string; message: string }>, what = "Form definition is invalid"): Error {
  return new Error(`${what}:\n${issues.map((i) => `- ${i.path}: ${i.message}`).join("\n")}`);
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export interface ListFormsOptions {
  search?: string;
  status?: string;
  activeOnly?: boolean;
  targetObjectApiName?: string;
  modifiedSince?: string;
  limit?: number;
}

export async function listForms(client: SalesforceClient, opts: ListFormsOptions = {}): Promise<FormSummary[]> {
  let since: string | undefined;
  if (opts.modifiedSince) {
    const d = new Date(opts.modifiedSince);
    if (Number.isNaN(d.getTime())) throw new Error(`modifiedSince "${opts.modifiedSince}" is not a valid date.`);
    since = d.toISOString();
  }
  return client.apex<FormSummary[]>(
    "GET",
    `/forms${query({
      search: opts.search,
      status: opts.status,
      activeOnly: opts.activeOnly ? true : undefined,
      targetObject: opts.targetObjectApiName,
      modifiedSince: since,
      limit: opts.limit,
    })}`,
  );
}

export async function getForm(client: SalesforceClient, formId: string): Promise<FormDefinition> {
  return client.apex<FormDefinition>("GET", formPath(formId));
}

/** Create a Draft form. The definition is checked locally first, then again by the server. */
export async function createForm(client: SalesforceClient, input: FormInput): Promise<FormDefinition> {
  const issues = validateFormDefinition(input);
  if (issues.length) throw invalid(issues);
  return client.apex<FormDefinition>("POST", "/forms", input);
}

export interface CloneFormOptions {
  newName?: string;
  label?: string;
  description?: string;
  targetObjectApiName?: string;
  displayStyle?: FormInput["displayStyle"];
  welcomeMessage?: string;
  thankYouMessage?: string;
}

export async function cloneForm(client: SalesforceClient, sourceFormId: string, opts: CloneFormOptions = {}): Promise<{ source: FormSummary; form: FormDefinition }> {
  return client.apex("POST", formPath(sourceFormId, "/clone"), opts);
}

export interface FormSettingsPatch {
  name?: string;
  label?: string;
  description?: string;
  targetObjectApiName?: string;
  displayStyle?: FormInput["displayStyle"];
  welcomeMessage?: string;
  thankYouMessage?: string;
  /** Whole objects; null goes back to the default. */
  welcome?: FormInput["welcome"] | null;
  ending?: FormInput["ending"] | null;
}

export async function updateFormSettings(client: SalesforceClient, formId: string, patch: FormSettingsPatch): Promise<FormDefinition> {
  const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(body).length) throw new Error("Nothing to update: provide at least one setting.");
  return client.apex<FormDefinition>("PATCH", formPath(formId), body);
}

/** Add fields to a section (by Id or key; defaults to the last one) or to a new section. */
export async function addFields(
  client: SalesforceClient,
  formId: string,
  fields: FieldInput[],
  target: { sectionId?: string; sectionKey?: string; newSection?: { name: string; label?: string; description?: string } },
): Promise<FormDefinition & { addedFieldKeys: string[] }> {
  return client.apex("POST", formPath(formId, "/fields"), {
    fields,
    sectionId: target.sectionId,
    sectionKey: target.sectionKey,
    newSection: target.newSection,
  });
}

/** Remove a field by record Id or key. */
export async function removeField(client: SalesforceClient, formId: string, fieldIdOrKey: string): Promise<FormDefinition> {
  return client.apex<FormDefinition>("DELETE", formPath(formId, `/fields/${enc(fieldIdOrKey)}`));
}

export interface LogicRuleInput {
  target: string;
  action: "show" | "hide" | "require";
  when: string;
  operator?: string;
  value?: string;
  combine?: "and" | "or";
}

/** Add a show, hide or require rule. Fields and pages can be named by label or key. */
export async function addLogicRule(client: SalesforceClient, formId: string, rule: LogicRuleInput): Promise<FormDefinition & { ruleSentence: string }> {
  return client.apex("POST", formPath(formId, "/rules"), rule);
}

export interface PublishResult {
  form: FormSummary;
  versionNumber: number;
  publicKey: string;
  builderUrl: string;
  publicUrl?: string;
  publicUrlNote: string;
  previewUrl?: string;
  embedSnippet?: string;
}

/** Publish the draft as a new version (snapshot) and return the public link and embed snippet. */
export async function publishForm(client: SalesforceClient, formId: string, note?: string): Promise<PublishResult> {
  return client.apex<PublishResult>("POST", formPath(formId, "/publish"), note ? { note } : {});
}

export async function unpublishForm(client: SalesforceClient, formId: string): Promise<FormSummary> {
  return client.apex<FormSummary>("POST", formPath(formId, "/unpublish"));
}

export async function deleteForm(client: SalesforceClient, formId: string): Promise<{ deleted: string; name: string }> {
  return client.apex("DELETE", formPath(formId));
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export interface SubmissionSummary {
  id: string;
  submittedAt?: string;
  status?: string;
  targetRecordId?: string;
  errorMessage?: string;
  values: Array<{ fieldId?: string; key?: string; label?: string; value?: string }>;
  /** Why the response was flagged as spam, when status is Spam. */
  spamReason?: string;
  /** On a payment form: Paid, Awaiting payment, Failed, Expired, Partially refunded or Refunded, and the amount. */
  paymentStatus?: string;
  paymentAmount?: number;
}

export async function listSubmissions(
  client: SalesforceClient, formId: string, limit = 25, status?: string, includeSpam?: boolean, payment?: string
): Promise<SubmissionSummary[]> {
  return client.apex<SubmissionSummary[]>("GET", formPath(formId, `/submissions${query({ limit, status, includeSpam: includeSpam ? "true" : undefined, payment })}`));
}

export interface ResponseSummary {
  total: number;
  last7Days: number;
  processed: number;
  errors: number;
  withTargetRecord: number;
  choices: Array<{ fieldKey: string; label: string; counts: Array<{ value: string; count: number }> }>;
  /** Responses flagged as spam; not part of total. */
  spam?: number;
}

export async function getResponseSummary(client: SalesforceClient, formId: string): Promise<ResponseSummary> {
  return client.apex<ResponseSummary>("GET", formPath(formId, "/summary"));
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

export async function listTargetObjects(client: SalesforceClient, includeAllStandard = false): Promise<Array<{ apiName: string; label: string; custom: boolean }>> {
  return client.apex("GET", `/schema/objects${query({ all: includeAllStandard ? true : undefined })}`);
}

export async function describeObjectFields(
  client: SalesforceClient,
  objectApiName: string,
  search?: string,
): Promise<{
  objectApiName: string;
  label: string;
  fields: Array<{ apiName: string; label: string; type: string; length?: number; required: boolean; picklistValues?: string[]; referenceTo?: string[]; suggestedFieldType?: FieldType }>;
}> {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApiName)) throw new Error(`"${objectApiName}" is not a valid object API name.`);
  return client.apex("GET", `/schema/objects/${objectApiName}/fields${query({ search })}`);
}
