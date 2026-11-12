import { LightningElement, api, track } from "lwc";
import getObjectFields from "@salesforce/apex/JFormWorkspaceController.getObjectFields";
import getFlows from "@salesforce/apex/JFormWorkspaceController.getFlows";
import getFlowDetails from "@salesforce/apex/JFormWorkspaceController.getFlowDetails";
import { OPERATORS } from "c/jformLogic";
import { collectsAnswer, holdsFiles, answerFieldsOf } from "c/jformFieldRegistry";
import { PRESETS, buildPreset, convertLegacy, defaultStep, mainStepOf, suggestField, withAddressMappings } from "c/jformAutomationPresets";
import { paymentBlock } from "c/jformPayment";

/** What a record step does; a flow step is added from the + menu and keeps its own editor. */
const ACTIONS = [
  { value: "create", label: "Create a record" },
  { value: "find_or_create", label: "Find or create a record" },
  { value: "find", label: "Find a record to use later" },
  { value: "update", label: "Update a matching record" }
];
const ACTION_WORD = { create: "Create", find_or_create: "Find or create", find: "Find", update: "Update", flow: "Run" };
const ACTION_HELP = { create: "A new record every time", find_or_create: "Reuse a match, or create one", find: "Look one up to use later", update: "Change a matching record", flow: "Hand off to a flow you built" };
const ACTION_ICON = { create: "utility:record_create", find_or_create: "utility:merge", find: "utility:record_lookup", update: "utility:record_update", flow: "utility:flow" };
const FLOW_TYPE_LABELS = { string: "Text", number: "Number", currency: "Currency", boolean: "True/false", date: "Date", datetime: "Date/time", picklist: "Picklist", multipicklist: "Multi-select picklist" };
const EMPTY = "none:";
const PRESET_ICON = {
  lead_capture: "utility:lead",
  contact_us: "utility:email",
  support_case: "utility:case",
  event_registration: "utility:event",
  newsletter: "utility:news",
  booking: "utility:date_time",
  quote_request: "utility:quote",
  partner_onboarding: "utility:groups",
  feedback: "utility:comments",
  job_application: "utility:people"
};
const SUBMISSION_PATHS = [
  { value: "formName", label: "Form name" },
  { value: "sourceUrl", label: "Source URL" },
  { value: "id", label: "Response Id" },
  { value: "submittedAt", label: "Submitted at" },
  { value: "publicKey", label: "Public key" }
];
/** On forms with a Payment block: record steps run once the response is paid, so these are filled in. */
const PAYMENT_PATHS = [
  { value: "paymentStatus", label: "Payment status" },
  { value: "paymentAmount", label: "Payment amount" },
  { value: "paymentCurrency", label: "Payment currency" },
  { value: "paymentReference", label: "Payment reference (Stripe)" },
  { value: "promotionCode", label: "Promotion code" },
  { value: "discountAmount", label: "Discount amount" }
];
const EXTRA_OBJECTS = [{ label: "Campaign Member", value: "CampaignMember" }];
const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty"]);
const OP_WORDS = { equals: "is", not_equals: "is not", contains: "contains", is_empty: "is empty", is_not_empty: "is answered", greater_than: "is more than", less_than: "is less than" };
const MATCH_TYPES = new Set(["email", "string", "phone", "url", "id", "reference", "picklist", "textarea"]);
const lower = (s) => String(s || "").toLowerCase();
const squash = (s) => lower(s).replace(/[^a-z0-9]/g, "");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isFlow = (s) => s?.action === "flow";

/** A mapping source as one picker value: "field:email", "step:contact:Id", "submission:formName", "value:". */
export function encodeSource(src) {
  if (!src) return "";
  if (src.type === "field") return src.key ? `field:${src.key}` : "";
  if (src.type === "step") return src.step ? `step:${src.step}:${src.path || "Id"}` : "";
  if (src.type === "submission") return `submission:${src.path || "formName"}`;
  if (src.type === "value") return "value:";
  return "";
}
export function decodeSource(value) {
  const [type, ...rest] = String(value || "").split(":");
  if (type === "field") return { type: "field", key: rest.join(":") };
  if (type === "step") {
    const path = rest.pop() || "Id";
    return { type: "step", step: rest.join(":"), path };
  }
  if (type === "submission") return { type: "submission", path: rest.join(":") || "formName" };
  return { type: "value", value: "" };
}

/**
 * Automate tab: record steps on a top-to-bottom canvas (trigger, steps with "add here" points,
 * condition gates, end) and a step editor beside it. Steps live in settings.automation.steps.
 */
export default class JformAutomateTab extends LightningElement {
  @api definition;
  @api targetObjects = [];
  @track fieldCache = {};
  loadingObjects = new Set();
  selectedKey;
  insertAt = null;
  insertStage = ""; // "flow" while the + menu lists flows
  insertBusy = false;
  showPresets = false;
  pendingPreset = "";
  /** Flows this person may run from a form (empty without the Manage Flow permission). */
  flowCatalog = { loaded: false, canUseFlows: false, flows: [] };
  /** Flow API name (lower case) -> its variables, from getFlowDetails. */
  @track flowDetails = {};
  loadingFlows = new Set();

  connectedCallback() {
    getFlows()
      .then((c) => {
        this.flowCatalog = { loaded: true, canUseFlows: Boolean(c?.canUseFlows), flows: c?.flows || [] };
      })
      .catch(() => {
        this.flowCatalog = { loaded: true, canUseFlows: false, flows: [] };
      });
  }

  // ------------------------------------------------------------ data
  get settings() {
    return this.definition?.settings || {};
  }
  get steps() {
    return this.settings.automation?.steps || [];
  }
  get hasSteps() {
    return this.steps.length > 0;
  }
  /** Answers a step can use: every field that collects one, except files; a table gives one per row ("field.row"), a Name or Address field one per part ("field.part"). */
  get formFields() {
    const out = [];
    for (const s of this.definition?.sections || []) {
      for (const f of s.fields || []) {
        if (collectsAnswer(f.type) && !holdsFiles(f.type)) out.push(...answerFieldsOf(f));
      }
    }
    return out;
  }
  /** Fields that presets and suggestions may pick on their own: table rows are only mapped by choice; Name parts go to FirstName and LastName, Address parts to an address. */
  get presetFields() {
    return this.formFields.filter((f) => !f.table);
  }
  get formFieldOptions() {
    return this.formFields.map((f) => ({ label: f.label || f.key, value: f.key }));
  }
  get actionOptions() {
    return ACTIONS;
  }
  get matchModeOptions() {
    return [
      { label: "all", value: "all" },
      { label: "any", value: "any" }
    ];
  }
  get operatorOptions() {
    return OPERATORS;
  }
  get showConvert() {
    return !this.hasSteps && Boolean(this.definition?.targetObjectApiName);
  }
  get convertLabel() {
    return `Convert the ${this.definition?.targetObjectApiName} target to a step`;
  }
  objectOptionsFor(current) {
    const opts = (this.targetObjects || []).map((o) => ({ label: o.label, value: String(o.value) }));
    for (const extra of EXTRA_OBJECTS) {
      if (!opts.some((o) => lower(o.value) === lower(extra.value))) opts.push(extra);
    }
    if (current && !opts.some((o) => lower(o.value) === lower(current))) opts.unshift({ label: current, value: current });
    return opts;
  }
  objectLabel(apiName) {
    if (!apiName) return "record";
    const o = this.objectOptionsFor(apiName).find((x) => lower(x.value) === lower(apiName));
    return o ? o.label : apiName;
  }
  objectFields(apiName) {
    return this.fieldCache[lower(apiName)] || null;
  }
  fieldLabel(key) {
    const f = this.formFields.find((x) => x.key === key);
    return f ? f.label || f.key : key;
  }
  objectFieldLabel(apiName, field) {
    const f = (this.objectFields(apiName) || []).find((x) => lower(x.value) === lower(field));
    return f ? f.label : field;
  }
  stepIndex(key) {
    return this.steps.findIndex((s) => s.key === key);
  }
  stepRecordName(key) {
    const i = this.stepIndex(key);
    if (i < 0) return "a removed step";
    const s = this.steps[i];
    return isFlow(s) ? `${this.flowLabelOf(s)} (step ${i + 1})` : `${this.objectLabel(s.object)} from step ${i + 1}`;
  }
  flowLabelOf(s) {
    return s.flowLabel || this.flowDetails[lower(s.flow)]?.label || s.flow || "a flow";
  }
  /** Output variables of a flow step: from the flow once loaded, else as saved on the step. */
  flowOutputsOf(s) {
    const details = this.flowDetails[lower(s.flow)];
    if (details && !details.missing) return details.variables.filter((v) => v.isOutput).map((v) => ({ name: v.name, type: v.dataType }));
    return (s.outputs || []).map((o) => (typeof o === "string" ? { name: o } : o));
  }
  describeSource(src) {
    if (!src) return "";
    if (src.type === "field") return this.fieldLabel(src.key);
    if (src.type === "value") return `"${src.value || ""}"`;
    if (src.type === "submission") return ([...SUBMISSION_PATHS, ...PAYMENT_PATHS].find((p) => p.value === src.path) || { label: src.path }).label;
    if (src.type === "step") {
      const target = this.steps[this.stepIndex(src.step)];
      if (isFlow(target)) return `${this.stepRecordName(src.step)} › ${src.path}`;
      const path = src.path && lower(src.path) !== "id" ? ` › ${this.objectFieldLabel(target?.object, src.path)}` : "";
      return `${this.stepRecordName(src.step)}${path}`;
    }
    return "";
  }
  conditionText(step) {
    const conds = step.condition?.conditions || [];
    if (!conds.length) return "";
    return conds
      .map((c) => `${this.fieldLabel(c.field)} ${OP_WORDS[c.operator] || c.operator}${c.value !== undefined && !NO_VALUE_OPS.has(c.operator) ? ` ${c.value}` : ""}`)
      .join(step.condition.match === "any" ? " or " : " and ");
  }
  /** What would stop this step from publishing, in the builder's words (mirrors JFormAutomationService.validate). */
  issuesOf(step, index) {
    const out = [];
    const formKeys = new Set(this.formFields.map((f) => f.key));
    const earlier = new Set(this.steps.slice(0, index).map((s) => s.key));
    const badSource = (src) => (src?.type === "field" && !formKeys.has(src.key)) || (src?.type === "step" && !earlier.has(src.step));
    const mappings = step.fields || [];
    const goneOutput = mappings.some((m) => {
      const target = m.source?.type === "step" ? this.steps.find((s) => s.key === m.source.step) : null;
      return isFlow(target) && !this.flowOutputsOf(target).some((o) => lower(o.name) === lower(m.source.path));
    });
    if (isFlow(step)) {
      if (!step.flow) out.push("Choose a flow");
      const details = this.flowDetails[lower(step.flow)];
      if (details?.missing) out.push("This flow is no longer an active autolaunched flow");
      else if (details) {
        const inputs = new Map(details.variables.filter((v) => v.isInput).map((v) => [lower(v.name), v]));
        const unknown = mappings.filter((m) => !inputs.get(lower(m.field))?.supported).map((m) => m.field);
        if (unknown.length) out.push(`Not an input the flow takes: ${unknown.join(", ")}`);
        if (this.flowChanged(step, details)) out.push("The flow changed: open the step and refresh it");
      }
      if (mappings.some((m) => m.source?.type === "field" && !formKeys.has(m.source.key))) out.push("Uses a question that was removed");
      if (mappings.some((m) => m.source?.type === "step" && !earlier.has(m.source.step))) out.push("Uses a record from a later or removed step");
      if (goneOutput) out.push("Uses a flow output that no longer exists");
      if ((step.condition?.conditions || []).some((c) => !formKeys.has(c.field))) out.push("Its condition uses a question that was removed");
      return out;
    }
    const fields = this.objectFields(step.object);
    if (!step.object) out.push("Choose an object");
    if (step.action !== "create" && (!step.match?.field || !step.match?.source || badSource(step.match.source))) out.push("Choose how to find the record");
    if (step.action !== "find" && !mappings.length) out.push("Set at least one field");
    if (mappings.some((m) => !m.field)) out.push("A field row has no field chosen");
    if (fields && fields.length) {
      const missing = mappings.filter((m) => m.field && !fields.some((f) => lower(f.value) === lower(m.field))).map((m) => m.field);
      if (missing.length) out.push(`Not on ${this.objectLabel(step.object)}: ${missing.join(", ")}`);
    }
    if (mappings.some((m) => m.source?.type === "field" && !formKeys.has(m.source.key))) out.push("Uses a question that was removed");
    if (mappings.some((m) => m.source?.type === "step" && !earlier.has(m.source.step))) out.push("Uses a record from a later or removed step");
    if (goneOutput) out.push("Uses a flow output that no longer exists");
    if ((step.condition?.conditions || []).some((c) => !formKeys.has(c.field))) out.push("Its condition uses a question that was removed");
    const required = this.unmappedRequired(step);
    if (required.length) out.push(`Required, not mapped: ${required.join(", ")}`);
    return out;
  }
  /** Saved input types or outputs that no longer match the flow's active version. */
  flowChanged(step, details) {
    const vars = new Map(details.variables.map((v) => [lower(v.name), v]));
    const typeMoved = (step.fields || []).some((m) => m.type && vars.get(lower(m.field)) && lower(vars.get(lower(m.field)).dataType) !== lower(m.type));
    const saved = (step.outputs || []).map((o) => lower(typeof o === "string" ? o : o.name)).sort().join(",");
    const now = details.variables.filter((v) => v.isOutput).map((v) => lower(v.name)).sort().join(",");
    return typeMoved || saved !== now;
  }
  /** Required fields a creating step leaves empty; known once the object's fields are loaded. */
  unmappedRequired(step) {
    if (step.action !== "create" && step.action !== "find_or_create") return [];
    const fields = this.objectFields(step.object) || [];
    const mapped = new Set((step.fields || []).map((m) => lower(m.field)));
    return fields.filter((f) => f.required && !mapped.has(lower(f.value))).map((f) => f.label);
  }

  // ------------------------------------------------------------ presets
  get presetCards() {
    return PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description, icon: PRESET_ICON[p.id] || "utility:record_create" }));
  }
  get showGallery() {
    return !this.hasSteps || this.showPresets;
  }
  get presetsButtonLabel() {
    return this.showPresets ? "Hide presets" : "Presets";
  }
  get pendingPresetText() {
    const p = PRESETS.find((x) => x.id === this.pendingPreset);
    const n = this.steps.length;
    return p ? `Replace the ${n} current step${n === 1 ? "" : "s"} with "${p.label}"?` : "";
  }

  // ------------------------------------------------------------ canvas
  get mainStep() {
    return mainStepOf(this.steps);
  }
  get flowItems() {
    const items = [{ key: "start", isStart: true }];
    this.steps.forEach((s, i) => {
      items.push(this.linkItem(i, s));
      items.push(this.nodeItem(s, i));
    });
    items.push(this.linkItem(this.steps.length, null));
    items.push({ key: "end", isEnd: true });
    return items;
  }
  linkItem(index, next) {
    return {
      key: `link-${index}`,
      isLink: true,
      index,
      menuOpen: this.insertAt === index,
      gateText: next ? this.conditionText(next) : "",
      gateKey: next ? next.key : "",
      plusLabel: index === 0 ? "Add a step at the start" : `Add a step after step ${index}`
    };
  }
  nodeItem(s, i) {
    const summary = [];
    if (isFlow(s)) {
      summary.push(plural((s.fields || []).length, "input"));
      const outputs = this.flowOutputsOf(s).length;
      if (outputs) summary.push(plural(outputs, "output"));
    } else {
      if (s.action !== "create" && s.match) summary.push(`Match ${this.objectFieldLabel(s.object, s.match.field)} = ${this.describeSource(s.match.source)}`);
      if (s.action !== "find") summary.push(plural((s.fields || []).length, "field"));
    }
    const uses = [...new Set((s.fields || []).filter((m) => m.source?.type === "step").map((m) => m.source.step))]
      .map((k) => this.stepIndex(k))
      .filter((n) => n >= 0 && n < i)
      .sort((a, b) => a - b)
      .map((n) => `${isFlow(this.steps[n]) ? this.flowLabelOf(this.steps[n]) : this.objectLabel(this.steps[n].object)} from ${n + 1}`);
    if (uses.length) summary.push(`uses ${uses.join(", ")}`);
    const title = this.stepTitle(s);
    const issues = this.issuesOf(s, i);
    const selected = s.key === this.selectedKey;
    return {
      key: `step-${s.key}`,
      isStep: true,
      stepKey: s.key,
      number: i + 1,
      isFirst: i === 0,
      isLast: i === this.steps.length - 1,
      icon: ACTION_ICON[s.action] || "utility:record_create",
      title,
      label: s.label && s.label !== title ? s.label : "",
      primary: this.mainStep?.key === s.key,
      summary: summary.join(" · "),
      issue: issues.length ? issues[0] + (issues.length > 1 ? ` (+${issues.length - 1} more)` : "") : "",
      pressed: selected ? "true" : "false",
      cls: `at-card${selected ? " at-card-on" : ""}${issues.length ? " at-card-issue" : ""}`
    };
  }
  stepTitle(s) {
    return isFlow(s) ? `Run ${this.flowLabelOf(s)}` : `${ACTION_WORD[s.action] || s.action} ${this.objectLabel(s.object)}`;
  }
  get insertActions() {
    const record = ACTIONS.map((a) => ({ ...a, help: ACTION_HELP[a.value], icon: ACTION_ICON[a.value], disabled: false }));
    const canRun = this.flowCatalog.canUseFlows;
    return [...record, { value: "flow", label: "Run a flow", help: canRun ? ACTION_HELP.flow : "Needs the Manage Flow permission", icon: ACTION_ICON.flow, disabled: !canRun }];
  }
  get insertFlowStage() {
    return this.insertStage === "flow";
  }
  get flowPickOptions() {
    return this.flowCatalog.flows.map((f) => ({ label: f.label, value: f.apiName, detail: f.apiName }));
  }
  get hasFlows() {
    return this.flowCatalog.flows.length > 0;
  }
  get endTitle() {
    return this.hasSteps ? "Done" : "Response stored";
  }
  get endText() {
    if (!this.hasSteps) return "Each response is kept on the Responses tab. Add a step to also create or update records.";
    const main = this.mainStep;
    if (!main) return "All steps succeed or none are kept. No step saves a record, so the response has no main record.";
    return `All steps succeed or none are kept. The ${this.objectLabel(main.object)} from step ${this.stepIndex(main.key) + 1} is the main record, linked to the response and sent with the JForm Submitted event.`;
  }

  // ------------------------------------------------------------ editor
  get selected() {
    return this.steps.find((s) => s.key === this.selectedKey) || null;
  }
  valueOptions(index, objField, current, allowEmpty) {
    const opts = this.formFields.map((f) => ({ group: "Form answers", label: f.label || f.key, value: `field:${f.key}` }));
    const refTargets = (objField?.referenceTo || []).map(lower);
    for (const e of this.steps.slice(0, index)) {
      const name = this.stepRecordName(e.key);
      if (isFlow(e)) {
        // a lookup can take a Text output (an Id); anything else takes any output
        for (const o of this.flowOutputsOf(e)) {
          if (refTargets.length && lower(o.type || "string") !== "string") continue;
          opts.push({ group: "Earlier steps", label: `${name} › ${o.name}`, value: `step:${e.key}:${o.name}`, detail: FLOW_TYPE_LABELS[lower(o.type)] || "" });
        }
        continue;
      }
      if (!refTargets.length || refTargets.includes(lower(e.object))) opts.push({ group: "Earlier steps", label: name, value: `step:${e.key}:Id`, detail: "Record Id" });
      for (const f of this.objectFields(e.object) || []) {
        if (refTargets.length && !(f.referenceTo || []).some((r) => refTargets.includes(lower(r)))) continue;
        opts.push({ group: "Earlier steps", label: `${name} › ${f.label}`, value: `step:${e.key}:${f.value}` });
      }
    }
    for (const p of SUBMISSION_PATHS) opts.push({ group: "Submission", label: p.label, value: `submission:${p.value}` });
    if (paymentBlock(this.definition)) for (const p of PAYMENT_PATHS) opts.push({ group: "Payment", label: p.label, value: `submission:${p.value}` });
    opts.push({ group: "Other", label: "Type a fixed value…", value: "value:" });
    if (allowEmpty) opts.push({ group: "Other", label: "Leave empty", value: EMPTY });
    if (current && current !== "value:" && current !== EMPTY && !opts.some((o) => o.value === current)) {
      opts.unshift({ group: "Current", label: this.describeSource(decodeSource(current)) || current, value: current });
    }
    return opts;
  }
  conditionsOf(s) {
    return (s.condition?.conditions || []).map((c, i) => {
      const f = this.formFields.find((x) => x.key === c.field);
      const options = f?.options?.length ? f.options.map((o) => ({ label: o.label, value: o.value ?? o.label })) : null;
      return { index: i, field: c.field, operator: c.operator || "equals", value: c.value ?? "", needsValue: !NO_VALUE_OPS.has(c.operator), hasOptions: Boolean(options), options };
    });
  }
  /** The editor for a flow step: which flow, a row per input it can take, the outputs later steps can use. */
  flowEditor(s) {
    const index = this.stepIndex(s.key);
    const details = this.flowDetails[lower(s.flow)];
    const usable = details && !details.missing;
    const locked = !this.flowCatalog.canUseFlows;
    const mappings = s.fields || [];
    const vars = usable
      ? details.variables.filter((v) => v.isInput && v.supported)
      : mappings.map((m) => ({ name: m.field, dataType: m.type, typeLabel: FLOW_TYPE_LABELS[lower(m.type)] || m.type || "" }));
    const inputs = vars.map((v) => {
      const m = mappings.find((x) => lower(x.field) === lower(v.name));
      const pickerValue = m ? encodeSource(m.source) : EMPTY;
      return {
        name: v.name,
        typeLabel: v.typeLabel || FLOW_TYPE_LABELS[lower(v.dataType)] || v.dataType || "",
        isValue: m?.source?.type === "value",
        text: m?.source?.value || "",
        pickerValue,
        valueOptions: this.valueOptions(index, null, pickerValue, true)
      };
    });
    const unsupported = usable ? details.variables.filter((v) => v.isInput && !v.supported).map((v) => `${v.name} (${v.typeLabel})`) : [];
    const outputs = this.flowOutputsOf(s).map((o) => ({ name: o.name, typeLabel: FLOW_TYPE_LABELS[lower(o.type)] || o.type || "" }));
    const flowOptions = this.flowPickOptions.slice();
    if (s.flow && !flowOptions.some((o) => lower(o.value) === lower(s.flow))) flowOptions.unshift({ label: this.flowLabelOf(s), value: s.flow, detail: s.flow });
    const conditions = this.conditionsOf(s);
    return {
      isFlow: true,
      isRecord: false,
      number: index + 1,
      title: this.stepTitle(s),
      label: s.label || "",
      flowApiName: s.flow || "",
      flowOptions,
      flowLocked: locked,
      flowMissing: Boolean(details?.missing),
      flowDescription: usable ? details.description || "" : "",
      flowBuilderUrl: usable && details.versionId ? `/builder_platform_interaction/flowBuilder.app?flowId=${details.versionId}` : "",
      flowLoading: this.loadingFlows.has(lower(s.flow)),
      canRefresh: Boolean(usable) && !locked && this.flowChanged(s, details),
      inputs,
      hasInputs: inputs.length > 0,
      unsupportedText: unsupported.join(", "),
      outputs,
      hasOutputs: outputs.length > 0,
      hasConditions: conditions.length > 0,
      conditions,
      matchMode: s.condition?.match === "any" ? "any" : "all"
    };
  }
  get editor() {
    const s = this.selected;
    if (!s) return null;
    if (isFlow(s)) return this.flowEditor(s);
    const index = this.stepIndex(s.key);
    const fields = this.objectFields(s.object) || [];
    const fieldOptions = fields.map((f) => ({ label: `${f.label}${f.required ? " *" : ""}`, value: f.value }));
    const mappings = (s.fields || []).map((m, i) => {
      const src = m.source || { type: "field" };
      const objField = fields.find((f) => lower(f.value) === lower(m.field));
      const pickerValue = encodeSource(src);
      return {
        index: i,
        field: m.field,
        isValue: src.type === "value",
        text: src.value || "",
        pickerValue,
        valueOptions: this.valueOptions(index, objField, pickerValue)
      };
    });
    const conditions = this.conditionsOf(s);
    const isMain = this.mainStep?.key === s.key;
    const title = this.stepTitle(s);
    return {
      isFlow: false,
      isRecord: true,
      number: index + 1,
      title,
      label: s.label || "",
      action: s.action,
      object: s.object,
      objectLabel: this.objectLabel(s.object),
      objectOptions: this.objectOptionsFor(s.object),
      loading: this.loadingObjects.has(lower(s.object)),
      needsMatch: s.action !== "create",
      matchField: s.match?.field || "",
      matchKey: s.match?.source?.key || "",
      matchFieldOptions: fields.filter((f) => MATCH_TYPES.has(f.type)).map((f) => ({ label: f.label, value: f.value })),
      showUpdateExisting: s.action === "find_or_create",
      updateExisting: Boolean(s.updateExisting),
      showRequired: s.action === "find" || s.action === "update",
      required: Boolean(s.required),
      primary: Boolean(s.primary),
      mainHelp: s.primary
        ? "Linked to the response on the Responses tab and sent with the JForm Submitted event."
        : isMain
          ? "Used as the main record because no step is marked. Turn on to keep it that way."
          : "Turn on to link this step's record to the response instead.",
      showFields: s.action !== "find",
      fieldOptions,
      mappings,
      hasMappings: mappings.length > 0,
      unmappedRequired: this.unmappedRequired(s).join(", "),
      hasConditions: conditions.length > 0,
      conditions,
      matchMode: s.condition?.match === "any" ? "any" : "all"
    };
  }

  renderedCallback() {
    // every step's object or flow, so the canvas can flag problems without opening the step
    for (const s of this.steps) {
      if (isFlow(s)) this.ensureFlowDetails(s.flow);
      else this.ensureFields(s.object);
    }
  }
  ensureFlowDetails(apiName) {
    const key = lower(apiName);
    if (!key || this.flowDetails[key] || this.loadingFlows.has(key)) return;
    this.loadFlowDetails(apiName);
  }
  /** Resolves to the flow's details, or null when it is not an active autolaunched flow. */
  loadFlowDetails(apiName) {
    const key = lower(apiName);
    this.loadingFlows.add(key);
    return getFlowDetails({ flowApiName: apiName })
      .then((f) => {
        this.flowDetails = { ...this.flowDetails, [key]: f };
        return f;
      })
      .catch(() => {
        this.flowDetails = { ...this.flowDetails, [key]: { apiName, label: apiName, variables: [], missing: true } };
        return null;
      })
      .finally(() => {
        this.loadingFlows.delete(key);
      });
  }
  ensureFields(apiName) {
    const key = lower(apiName);
    if (!key || this.fieldCache[key] || this.loadingObjects.has(key)) return;
    this.loadingObjects.add(key);
    getObjectFields({ objectApiName: apiName })
      .then((fields) => {
        this.fieldCache = { ...this.fieldCache, [key]: fields };
      })
      .catch(() => {
        this.fieldCache = { ...this.fieldCache, [key]: [] };
      })
      .finally(() => {
        this.loadingObjects.delete(key);
      });
  }

  // ------------------------------------------------------------ commits
  commit(steps) {
    const automation = { ...(this.settings.automation || {}), steps };
    const main = mainStepOf(steps);
    const settings = { ...this.settings, automation };
    delete settings.target; // steps are the single model
    this.dispatchEvent(new CustomEvent("formchange", { detail: { patch: { settings, targetObjectApiName: main ? main.object : null } } }));
  }
  updateSelected(mutator) {
    const steps = JSON.parse(JSON.stringify(this.steps));
    const s = steps.find((x) => x.key === this.selectedKey);
    if (!s) return;
    mutator(s, steps);
    this.commit(steps);
  }
  uniqueKey(base) {
    let key = base;
    let n = 2;
    while (this.steps.some((s) => s.key === key)) key = `${base}_${n++}`;
    return key;
  }
  newStep(action) {
    const key = this.uniqueKey("step");
    if (action === "create") return { key, label: "", action, object: "Task", fields: [{ field: "Subject", source: { type: "value", value: "Follow up" } }] };
    const email = this.formFields.find((f) => f.type === "email") || this.formFields[0];
    const match = { field: "Email", source: { type: "field", key: email?.key } };
    // the workspace saves every change and saving checks the steps, so a new step starts out valid
    if (action === "find_or_create" || action === "update") {
      const base = defaultStep("Contact", this.presetFields, this.objectFields("Contact"));
      return { key, label: "", action, object: "Contact", match, ...(action === "find_or_create" ? { updateExisting: false } : {}), fields: base.fields };
    }
    return { key, label: "", action, object: "Contact", match, fields: [] };
  }
  /** A flow step for these flow details: inputs filled where an answer or earlier record matches by name. */
  flowStepFor(details, index, key, base = {}) {
    const fields = [];
    for (const v of details.variables.filter((x) => x.isInput && x.supported)) {
      const source = this.guessSource(v.name, index);
      if (source) fields.push({ field: v.name, type: v.dataType, source });
    }
    const step = {
      key,
      label: base.label || "",
      action: "flow",
      flow: details.apiName,
      flowLabel: details.label,
      fields,
      outputs: details.variables.filter((v) => v.isOutput).map((v) => ({ name: v.name, type: v.dataType }))
    };
    if (base.condition) step.condition = base.condition;
    return step;
  }
  /** contactId -> the Contact from an earlier step; email -> the Email answer; sourceUrl -> the submission's. */
  guessSource(name, index) {
    const n = squash(name);
    const earlier = this.steps.slice(0, index).filter((s) => !isFlow(s));
    if (n.length > 2 && n.endsWith("id")) {
      const base = n.slice(0, -2);
      const hit = earlier.find((s) => squash(s.object) === base) || (base === "record" ? earlier.find((s) => s.key === this.mainStep?.key) || earlier[0] : null);
      if (hit) return { type: "step", step: hit.key, path: "Id" };
    }
    const exact = this.formFields.find((f) => squash(f.key) === n || squash(f.label) === n);
    if (exact) return { type: "field", key: exact.key };
    const near = suggestField(name, this.presetFields);
    if (near) return { type: "field", key: near.key };
    const detail = { formname: "formName", sourceurl: "sourceUrl", submittedat: "submittedAt", responseid: "id", submissionid: "id" }[n];
    return detail ? { type: "submission", path: detail } : null;
  }
  replaceStep(key, step) {
    const steps = JSON.parse(JSON.stringify(this.steps));
    const i = steps.findIndex((x) => x.key === key);
    if (i < 0) return;
    steps[i] = step;
    this.commit(steps);
  }

  // ------------------------------------------------------------ canvas handlers
  handleSelect(event) {
    this.selectedKey = event.currentTarget.dataset.key;
    this.insertAt = null;
    this.insertStage = "";
  }
  handleCardKey(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.selectedKey = event.currentTarget.dataset.key;
    }
  }
  handleCloseEditor() {
    this.selectedKey = undefined;
  }
  handleAddEnd() {
    this.insertAt = this.steps.length;
    this.insertStage = "";
  }
  handleInsertOpen(event) {
    this.insertAt = Number(event.currentTarget.dataset.index);
    this.insertStage = "";
  }
  handleInsertCancel() {
    this.insertAt = null;
    this.insertStage = "";
  }
  handleInsertKey(event) {
    if (event.key === "Escape") this.handleInsertCancel();
  }
  handleInsertBack() {
    this.insertStage = "";
  }
  /** A flow picked in the + menu: read its variables, then add the step with its inputs filled where they can be. */
  async handleInsertFlow(event) {
    const apiName = event.detail.value;
    if (!apiName || this.insertBusy) return;
    const index = this.insertAt === null ? this.steps.length : this.insertAt;
    this.insertBusy = true;
    const details = await this.loadFlowDetails(apiName);
    this.insertBusy = false;
    if (!details) return;
    const step = this.flowStepFor(details, index, this.uniqueKey("flow"));
    const steps = JSON.parse(JSON.stringify(this.steps));
    steps.splice(index, 0, step);
    this.commit(steps);
    this.selectedKey = step.key;
    this.insertAt = null;
    this.insertStage = "";
  }
  handleInsertPick(event) {
    const action = event.currentTarget.dataset.action;
    if (action === "flow") {
      this.insertStage = "flow";
      return;
    }
    const index = this.insertAt === null ? this.steps.length : this.insertAt;
    const step = this.newStep(action);
    const steps = JSON.parse(JSON.stringify(this.steps));
    steps.splice(index, 0, step);
    this.commit(steps);
    this.selectedKey = step.key;
    this.insertAt = null;
  }
  handleDelete(event) {
    event.stopPropagation();
    const key = event.currentTarget.dataset.key;
    const steps = JSON.parse(JSON.stringify(this.steps)).filter((s) => s.key !== key);
    for (const s of steps) {
      s.fields = (s.fields || []).map((m) => (m.source?.type === "step" && m.source.step === key ? { ...m, source: { type: "value", value: "" } } : m));
      if (s.match?.source?.type === "step" && s.match.source.step === key) s.match.source = { type: "field", key: this.formFields[0]?.key };
    }
    this.commit(steps);
    if (this.selectedKey === key) this.selectedKey = undefined;
  }
  handleDuplicate(event) {
    event.stopPropagation();
    const key = event.currentTarget.dataset.key;
    const steps = JSON.parse(JSON.stringify(this.steps));
    const i = steps.findIndex((s) => s.key === key);
    if (i < 0) return;
    const copy = { ...steps[i], key: this.uniqueKey(`${key}_copy`), primary: false };
    if (steps[i].label) copy.label = `${steps[i].label} (copy)`;
    steps.splice(i + 1, 0, copy);
    this.commit(steps);
    this.selectedKey = copy.key;
  }
  handleMove(event) {
    event.stopPropagation();
    const key = event.currentTarget.dataset.key;
    const dir = Number(event.currentTarget.dataset.dir);
    const steps = JSON.parse(JSON.stringify(this.steps));
    const i = steps.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    // a step may only use records from earlier steps
    steps.forEach((s, idx) => {
      s.fields = (s.fields || []).map((m) => (m.source?.type === "step" && steps.findIndex((e) => e.key === m.source.step) >= idx ? { ...m, source: { type: "value", value: "" } } : m));
    });
    this.commit(steps);
  }
  handleTogglePresets() {
    this.showPresets = !this.showPresets;
    this.pendingPreset = "";
  }
  handlePreset(event) {
    const id = event.currentTarget.dataset.id;
    if (this.hasSteps) {
      this.pendingPreset = id;
      return;
    }
    this.applyPreset(id);
  }
  handlePresetConfirm() {
    this.applyPreset(this.pendingPreset);
  }
  handlePresetCancel() {
    this.pendingPreset = "";
  }
  applyPreset(id) {
    const steps = buildPreset(id, this.presetFields);
    this.pendingPreset = "";
    this.showPresets = false;
    if (!steps.length) return;
    const finish = () => {
      this.commit(steps);
      this.selectedKey = steps[0].key;
    };
    if (!this.presetFields.some((f) => f.address)) {
      finish();
      return;
    }
    // Address fields map by address, which needs each record object's fields
    const writes = steps.filter((s) => s.object && s.action !== "find" && s.action !== "flow");
    Promise.all(
      writes.map((s) => {
        const cached = this.objectFields(s.object);
        if (cached) return Promise.resolve(cached);
        return getObjectFields({ objectApiName: s.object })
          .then((fields) => {
            this.fieldCache = { ...this.fieldCache, [lower(s.object)]: fields };
            return fields;
          })
          .catch(() => []);
      })
    ).then((fieldsByStep) => {
      writes.forEach((s, i) => {
        s.fields = withAddressMappings(s.fields, this.presetFields, fieldsByStep[i]);
      });
      finish();
    });
  }
  handleConvert() {
    const object = this.definition?.targetObjectApiName;
    const apply = (objectFields) => {
      const steps = convertLegacy(this.definition, objectFields);
      if (!steps.length) return;
      this.commit(steps);
      this.selectedKey = steps[0].key;
    };
    const cached = this.objectFields(object);
    if (cached) {
      apply(cached);
      return;
    }
    getObjectFields({ objectApiName: object })
      .then((fields) => {
        this.fieldCache = { ...this.fieldCache, [lower(object)]: fields };
        apply(fields);
      })
      .catch(() => apply([]));
  }

  // ------------------------------------------------------------ editor handlers
  handleStepText(event) {
    const prop = event.target.dataset.prop;
    const value = event.target.value;
    this.updateSelected((s) => {
      s[prop] = value;
    });
  }
  handleStepSelect(event) {
    const prop = event.target.dataset.prop;
    const value = event.detail.value;
    this.updateSelected((s) => {
      s[prop] = value;
      if (prop === "action" && value !== "create" && !s.match) {
        const email = this.formFields.find((f) => f.type === "email") || this.formFields[0];
        s.match = { field: "Email", source: { type: "field", key: email?.key } };
      }
      if (prop === "object") {
        s.fields = (s.fields || []).filter((m) => (this.objectFields(value) || []).some((f) => lower(f.value) === lower(m.field)) || !this.objectFields(value));
      }
    });
  }
  handleStepCheck(event) {
    const prop = event.target.dataset.prop;
    const checked = event.target.checked;
    this.updateSelected((s, steps) => {
      if (prop === "primary") steps.forEach((x) => (x.primary = false));
      s[prop] = checked;
    });
  }
  handleMatch(event) {
    const prop = event.target.dataset.prop;
    const value = event.detail.value;
    this.updateSelected((s) => {
      s.match = s.match || { field: "", source: { type: "field" } };
      if (prop === "field") s.match.field = value;
      else s.match.source = { type: "field", key: value };
    });
  }
  handleAddMapping() {
    this.updateSelected((s) => {
      const mapped = new Set((s.fields || []).map((m) => lower(m.field)));
      const fields = this.objectFields(s.object) || [];
      const next = fields.find((f) => f.required && !mapped.has(lower(f.value))) || fields.find((f) => !mapped.has(lower(f.value)));
      s.fields = [...(s.fields || []), { field: next ? next.value : "", source: { type: "field", key: this.formFields[0]?.key } }];
    });
  }
  handleRemoveMapping(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.updateSelected((s) => {
      s.fields.splice(index, 1);
    });
  }
  handleMappingField(event) {
    const index = Number(event.target.dataset.index);
    const value = event.detail.value;
    this.updateSelected((s) => {
      if (s.fields[index]) s.fields[index].field = value;
    });
  }
  handleMappingValue(event) {
    const index = Number(event.target.dataset.index);
    const source = decodeSource(event.detail.value);
    this.updateSelected((s) => {
      if (s.fields[index]) s.fields[index].source = source;
    });
  }
  handleMappingText(event) {
    const index = Number(event.target.dataset.index);
    const value = event.target.value;
    this.updateSelected((s) => {
      if (s.fields[index]) s.fields[index].source = { type: "value", value };
    });
  }
  /** From a fixed value back to the picker, starting on the first form answer. */
  handleMappingUnfix(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.updateSelected((s) => {
      if (s.fields[index]) s.fields[index].source = { type: "field", key: this.formFields[0]?.key };
    });
  }
  /** Another flow for the selected step: its inputs are filled afresh, its name and condition stay. */
  async handleFlowChange(event) {
    const apiName = event.detail.value;
    const s = this.selected;
    if (!s || !apiName || lower(apiName) === lower(s.flow)) return;
    const details = await this.loadFlowDetails(apiName);
    if (!details) return;
    this.replaceStep(s.key, this.flowStepFor(details, this.stepIndex(s.key), s.key, s));
  }
  /** Re-read the flow: keep inputs it still takes, with their current types, and its current outputs. */
  async handleFlowRefresh() {
    const s = this.selected;
    if (!s) return;
    const details = await this.loadFlowDetails(s.flow);
    if (!details) return;
    const inputs = new Map(details.variables.filter((v) => v.isInput && v.supported).map((v) => [lower(v.name), v]));
    this.updateSelected((x) => {
      x.fields = (x.fields || []).filter((m) => inputs.has(lower(m.field))).map((m) => ({ ...m, field: inputs.get(lower(m.field)).name, type: inputs.get(lower(m.field)).dataType }));
      x.outputs = details.variables.filter((v) => v.isOutput).map((v) => ({ name: v.name, type: v.dataType }));
      x.flowLabel = details.label;
    });
  }
  setFlowInput(name, source) {
    this.updateSelected((s) => {
      const vars = this.flowDetails[lower(s.flow)]?.variables || [];
      const v = vars.find((x) => lower(x.name) === lower(name));
      const old = (s.fields || []).find((m) => lower(m.field) === lower(name));
      const fields = (s.fields || []).filter((m) => lower(m.field) !== lower(name));
      if (source) fields.push({ field: v ? v.name : name, type: v ? v.dataType : old?.type, source });
      const order = vars.map((x) => lower(x.name)); // the flow's own order
      s.fields = order.length ? fields.sort((a, b) => order.indexOf(lower(a.field)) - order.indexOf(lower(b.field))) : fields;
    });
  }
  handleFlowInput(event) {
    const value = event.detail.value;
    this.setFlowInput(event.target.dataset.name, value === EMPTY ? null : decodeSource(value));
  }
  handleFlowInputText(event) {
    this.setFlowInput(event.target.dataset.name, { type: "value", value: event.target.value });
  }
  handleFlowInputUnfix(event) {
    const first = this.formFields[0];
    this.setFlowInput(event.currentTarget.dataset.name, first ? { type: "field", key: first.key } : null);
  }
  handleAddCondition() {
    this.updateSelected((s) => {
      const f = this.formFields[0];
      s.condition = s.condition || { match: "all", conditions: [] };
      s.condition.conditions.push({ field: f?.key, operator: "equals", value: f?.options?.[0]?.value ?? f?.options?.[0]?.label ?? "" });
    });
  }
  handleCondition(event) {
    const index = Number(event.target.dataset.index);
    const prop = event.target.dataset.prop;
    const value = event.detail ? event.detail.value : event.target.value;
    this.updateSelected((s) => {
      const c = s.condition.conditions[index];
      if (c) c[prop] = value;
    });
  }
  handleRemoveCondition(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.updateSelected((s) => {
      s.condition.conditions.splice(index, 1);
      if (!s.condition.conditions.length) delete s.condition;
    });
  }
  handleMatchMode(event) {
    const value = event.detail.value;
    this.updateSelected((s) => {
      if (s.condition) s.condition.match = value;
    });
  }
}
