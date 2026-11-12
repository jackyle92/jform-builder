import { LightningElement, api, track } from "lwc";
import { evaluate } from "c/jformLogic";
import { collectsAnswer, getType, holdsFiles, answerFieldsOf, offeredCountries, choiceOptionsOf } from "c/jformFieldRegistry";

const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty"]);
const OPTION_TYPES = new Set(["picklist", "radio", "multiselect", "checkboxes"]);
const MULTI_TYPES = new Set(["multiselect", "checkboxes"]);
const NUMBER_TYPES = new Set(["number", "rating", "nps"]);
const BOOLEAN_TYPES = new Set(["consent", "checkbox"]);
const ACTIONS = {
  show: { word: "Show", icon: "utility:preview", help: "Hidden until the conditions are met." },
  hide: { word: "Hide", icon: "utility:hide", help: "Shown until the conditions are met." },
  require: { word: "Require", icon: "utility:priority", help: "Optional until the conditions are met, then it must be answered." }
};
const BASE_WORDS = { equals: "is", not_equals: "is not", contains: "contains", is_empty: "is not answered", is_not_empty: "is answered", greater_than: "is more than", less_than: "is less than" };
/** Starting points on an empty Logic tab. */
const RECIPES = [
  { id: "follow_up", action: "show", kind: "field", icon: "utility:preview", title: "Show a follow-up question", text: "Ask something only when an earlier answer calls for it." },
  { id: "require", action: "require", kind: "field", icon: "utility:priority", title: "Require an answer sometimes", text: "Make a question required for some respondents only." },
  { id: "skip_page", action: "hide", kind: "page", icon: "utility:jump_to_right", title: "Skip a page", text: "Hide a whole page when it does not apply." }
];

/** Plain words for an operator on a question of this type: "is", "includes", "is checked". */
export function opWord(op, type) {
  if (BOOLEAN_TYPES.has(type)) {
    if (op === "equals") return "is checked";
    if (op === "not_equals") return "is not checked";
  }
  if (MULTI_TYPES.has(type)) {
    if (op === "equals") return "includes";
    if (op === "not_equals") return "does not include";
  }
  return BASE_WORDS[op] || op;
}
/** Operators that make sense for a question of this type, in the order offered. */
export function operatorsFor(type) {
  if (BOOLEAN_TYPES.has(type)) return ["equals", "not_equals"];
  if (OPTION_TYPES.has(type) || type === "yesno" || type === "date" || type === "time") return ["equals", "not_equals", "is_not_empty", "is_empty"];
  if (NUMBER_TYPES.has(type)) return ["equals", "not_equals", "greater_than", "less_than", "is_not_empty", "is_empty"];
  return ["equals", "not_equals", "contains", "is_not_empty", "is_empty"];
}
/** The fixed list of answers a question can have, or null when the respondent types it. */
export function answersFor(field) {
  if (!field) return null;
  // a choice's Other is one of its answers; the text typed under it is a question of its own ("field.other")
  if (OPTION_TYPES.has(field.type)) return choiceOptionsOf(field).map((o) => ({ label: o.label, value: o.value }));
  if (field.type === "yesno") return ["Yes", "No"].map((v) => ({ label: v, value: v }));
  if (field.type === "nps") return Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: String(i) }));
  if (field.type === "rating") return Array.from({ length: 5 }, (_, i) => ({ label: `${i + 1} of 5`, value: String(i + 1) }));
  return null;
}
const takesValue = (op, type) => !NO_VALUE_OPS.has(op) && !BOOLEAN_TYPES.has(type);
// a Payment block is never optional: its price decides whether there is anything to pay
const canRequire = (kind, field) => kind === "field" && Boolean(field) && collectsAnswer(field.type) && field.type !== "payment";

/**
 * Logic tab: rules as readable cards grouped by page, an editor that reads "When ... then ...",
 * and a panel to try the rules with sample answers. One rule per field or page
 * (conditionalLogic); changes go to the workspace as rulechange events.
 */
export default class JformLogicTab extends LightningElement {
  @api definition;
  /** { kind, key } to open from elsewhere (the field panel's "Add a rule"); a new object opens it again. */
  @api
  get focus() {
    return this._focus;
  }
  set focus(v) {
    this._focus = v;
    if (v?.key) this.openTarget(v.kind || "field", v.key);
  }
  _focus;

  @track draft; // { from: {kind,key}|null, kind, key, action, match, conditions: [{field, operator, value}] }
  snapshot = "";
  pendingDraft;
  showErrors = false;
  selectedId = "";
  query = "";
  @track trial = {};
  /** The countries and states (JFormAddressService.Lists), read by the workspace; null until then. */
  @api addressLists = null;

  // ------------------------------------------------------------ form catalog
  get sections() {
    return this.definition?.sections || [];
  }
  /** Every field by key, with its page and its place in the form. */
  get index() {
    const fields = new Map();
    const pages = new Map();
    this.sections.forEach((s, si) => {
      pages.set(s.key, { section: s, number: si + 1, pos: si * 1000 - 1, label: s.label || s.name || `Page ${si + 1}` });
      (s.fields || []).forEach((f, fi) => {
        fields.set(f.key, { field: f, section: s, pageNumber: si + 1, pos: si * 1000 + fi });
        // a table's rows are questions of their own, "field.row"
        for (const row of answerFieldsOf(f)) if (row !== f) fields.set(row.key, { field: row, section: s, pageNumber: si + 1, pos: si * 1000 + fi });
      });
    });
    return { fields, pages };
  }
  /**
   * Questions a condition can test: anything that collects an answer, except files; each row of a table, each part
   * of a Name or Address field. An address's codes are left out: rules test the country and state names.
   */
  get answerFields() {
    const out = [];
    for (const s of this.sections) for (const f of s.fields || []) if (collectsAnswer(f.type) && !holdsFiles(f.type)) out.push(...answerFieldsOf(f).filter((q) => !q.derived));
    return out;
  }
  get hasAnswerFields() {
    return this.answerFields.length > 0;
  }
  fieldLabel(key) {
    const hit = this.index.fields.get(key);
    return hit ? hit.field.label || hit.field.key : key;
  }
  targetLabel(kind, key) {
    if (kind === "page") {
      const p = this.index.pages.get(key);
      return p ? `Page ${p.number} · ${p.label}` : key;
    }
    return this.fieldLabel(key);
  }
  typeLabel(type) {
    const t = getType(type);
    return t ? t.short || t.label : type;
  }
  /**
   * The answers a question can have: answersFor, or for an address's country and state the names answers hold, from
   * the countries the field offers. A state stays typed where those countries list none, or the lists did not load.
   */
  optionsFor(field) {
    const fixed = answersFor(field);
    if (fixed || !field?.address || !this.addressLists) return fixed;
    const countries = offeredCountries(this.index.fields.get(field.address)?.field, this.addressLists);
    if (field.part === "country") return countries.map((c) => ({ label: c.name, value: c.name }));
    if (field.part !== "state") return null;
    const withStates = countries.filter((c) => c.states?.length);
    const out = [];
    const seen = new Set();
    for (const c of withStates) {
      for (const r of c.states) {
        if (seen.has(r.name)) continue;
        seen.add(r.name);
        out.push({ label: withStates.length > 1 ? `${r.name} (${c.name})` : r.name, value: r.name });
      }
    }
    return out.length ? out : null;
  }
  /** The answers a condition chooses from: an address's country or state for is and is not; contains tests part of the text. */
  valueOptions(field, operator) {
    if (field?.address && operator && operator !== "equals" && operator !== "not_equals") return null;
    return this.optionsFor(field);
  }
  valueLabel(field, value) {
    const hit = (this.optionsFor(field) || []).find((o) => o.value === String(value));
    return hit ? hit.label : String(value ?? "");
  }
  ruleOf(kind, key) {
    if (kind === "page") return this.index.pages.get(key)?.section?.conditionalLogic || null;
    return this.index.fields.get(key)?.field?.conditionalLogic || null;
  }

  // ------------------------------------------------------------ sentences and problems
  /** "When Gender is Female and Age is more than 18" as styled tokens. */
  whenTokens(rule) {
    const tokens = [{ key: "w", cls: "lg-word", text: "When" }];
    (rule.conditions || []).forEach((c, i) => {
      if (i > 0) tokens.push({ key: `j${i}`, cls: "lg-word lg-join", text: rule.match === "any" ? "or" : "and" });
      const field = this.index.fields.get(c.field)?.field;
      const type = field?.type;
      tokens.push({ key: `f${i}`, cls: `lg-chip${field ? "" : " lg-chip-gone"}`, text: field ? field.label || field.key : "a removed question" });
      tokens.push({ key: `o${i}`, cls: "lg-word", text: opWord(c.operator, type) });
      if (takesValue(c.operator, type)) tokens.push({ key: `v${i}`, cls: "lg-chip lg-chip-value", text: this.valueLabel(field, c.value) || "…" });
    });
    return tokens;
  }
  sentenceOf(kind, key, rule) {
    const when = this.whenTokens(rule)
      .map((t) => t.text)
      .join(" ");
    return `${when}, ${(ACTIONS[rule.action]?.word || rule.action).toLowerCase()} ${key ? this.targetLabel(kind, key) : "…"}.`;
  }
  /** What could surprise a respondent: removed questions or answers, or answers given after the thing they control. */
  problemsOf(kind, key, rule) {
    const out = [];
    const { fields, pages } = this.index;
    const targetPos = kind === "page" ? pages.get(key)?.pos : fields.get(key)?.pos;
    for (const c of rule.conditions || []) {
      const hit = fields.get(c.field);
      if (!hit) {
        out.push("Uses a question that was removed");
        continue;
      }
      const options = this.valueOptions(hit.field, c.operator);
      if (options && takesValue(c.operator, hit.field.type) && c.value !== undefined && c.value !== "" && !options.some((o) => o.value === String(c.value))) {
        out.push(`"${c.value}" is no longer an answer to ${this.fieldLabel(c.field)}`);
      }
      if (targetPos !== undefined && hit.pos > targetPos) {
        out.push(kind === "page" ? `${this.fieldLabel(c.field)} is on this page or a later one, so it is answered after the page decides` : `${this.fieldLabel(c.field)} comes later in the form, so it is answered after`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ rule list
  get allRules() {
    const out = [];
    this.sections.forEach((s, si) => {
      const targets = [];
      if (s.conditionalLogic) targets.push({ kind: "page", key: s.key, rule: s.conditionalLogic });
      for (const f of s.fields || []) if (f.conditionalLogic) targets.push({ kind: "field", key: f.key, rule: f.conditionalLogic });
      for (const t of targets) out.push({ ...t, pageKey: s.key, pageNumber: si + 1 });
    });
    return out;
  }
  get ruleCount() {
    return this.allRules.length;
  }
  get hasRules() {
    return this.ruleCount > 0;
  }
  get summaryText() {
    const rules = this.allRules;
    const pages = rules.filter((r) => r.kind === "page").length;
    const fields = rules.length - pages;
    const parts = [];
    if (fields) parts.push(`${fields} question${fields === 1 ? "" : "s"}`);
    if (pages) parts.push(`${pages} page${pages === 1 ? "" : "s"}`);
    return `${rules.length} rule${rules.length === 1 ? "" : "s"}: ${parts.join(" and ")} ${rules.length === 1 ? "reacts" : "react"} to answers`;
  }
  get problemCount() {
    return this.allRules.filter((r) => this.problemsOf(r.kind, r.key, r.rule).length).length;
  }
  get problemText() {
    const n = this.problemCount;
    return n ? `${n} to check` : "";
  }
  /** Rules grouped by the page they act on, filtered by the search box. */
  get groups() {
    const q = this.query.trim().toLowerCase();
    const groups = [];
    for (const r of this.allRules) {
      const id = `${r.kind}:${r.key}`;
      const tokens = this.whenTokens(r.rule);
      const target = this.targetLabel(r.kind, r.key);
      if (q && ![target, ...tokens.map((t) => t.text)].join(" ").toLowerCase().includes(q)) continue;
      const problems = this.problemsOf(r.kind, r.key, r.rule);
      const action = ACTIONS[r.rule.action] || ACTIONS.show;
      let group = groups.find((g) => g.key === r.pageKey);
      if (!group) {
        const page = this.index.pages.get(r.pageKey);
        group = { key: r.pageKey, title: `Page ${page.number}`, subtitle: page.label, rules: [] };
        groups.push(group);
      }
      group.rules.push({
        id,
        kind: r.kind,
        key: r.key,
        tokens,
        actionWord: action.word,
        actionIcon: action.icon,
        actionCls: `lg-action lg-action-${r.rule.action}`,
        target,
        sentence: this.sentenceOf(r.kind, r.key, r.rule),
        targetIsPage: r.kind === "page",
        problem: problems.length ? problems[0] + (problems.length > 1 ? ` (+${problems.length - 1} more)` : "") : "",
        pressed: id === this.selectedId ? "true" : "false",
        cls: `lg-card${id === this.selectedId ? " lg-card-on" : ""}${problems.length ? " lg-card-issue" : ""}`
      });
    }
    return groups;
  }
  get noMatches() {
    return this.hasRules && this.groups.length === 0;
  }
  get recipes() {
    return RECIPES;
  }
  handleSearch(event) {
    this.query = event.target.value || "";
  }

  // ------------------------------------------------------------ try the rules
  /** The questions that rules test, in form order, as inputs for sample answers. */
  get trialInputs() {
    const used = new Set(this.allRules.flatMap((r) => (r.rule.conditions || []).map((c) => c.field)));
    return this.answerFields
      .filter((f) => used.has(f.key))
      .map((f) => {
        const options = this.optionsFor(f);
        const value = this.trial[f.key];
        const multi = MULTI_TYPES.has(f.type);
        return {
          key: f.key,
          label: f.label || f.key,
          isMulti: multi && Boolean(options),
          isSingle: !multi && Boolean(options),
          isBoolean: BOOLEAN_TYPES.has(f.type),
          isTyped: !options && !BOOLEAN_TYPES.has(f.type),
          inputType: NUMBER_TYPES.has(f.type) ? "number" : f.type === "date" ? "date" : "text",
          options: options ? [{ label: "No answer", value: "" }, ...options] : null,
          multiOptions: options,
          value: multi ? value || [] : value === undefined ? "" : value,
          checked: value === true
        };
      });
  }
  get hasTrialInputs() {
    return this.trialInputs.length > 0;
  }
  /** What a respondent with these answers gets, for everything a rule acts on. */
  get trialResults() {
    const ev = evaluate(this.definition, this.trial);
    return this.allRules.map((r) => {
      let state;
      if (r.kind === "page") state = ev.sectionVisible[r.key] ? "Shown" : "Skipped";
      else {
        const pageShown = ev.sectionVisible[r.pageKey] !== false;
        if (!pageShown) state = "Page skipped";
        else if (r.rule.action === "require") state = ev.visible[r.key] === false ? "Hidden" : ev.required[r.key] ? "Required" : "Optional";
        else state = ev.visible[r.key] ? "Shown" : "Hidden";
      }
      const tone = { Shown: "on", Required: "warn", Optional: "off", Hidden: "off", Skipped: "off", "Page skipped": "off" }[state];
      return { id: `${r.kind}:${r.key}`, label: this.targetLabel(r.kind, r.key), state, cls: `lg-state lg-state-${tone}` };
    });
  }
  get hasTrialAnswers() {
    return Object.keys(this.trial).length > 0;
  }
  handleTrial(event) {
    const key = event.target.dataset.key;
    const kind = event.target.dataset.kind;
    let value = kind === "boolean" ? event.target.checked : event.detail?.value ?? event.target.value;
    const trial = { ...this.trial };
    if (value === "" || value === false || (Array.isArray(value) && !value.length)) delete trial[key];
    else trial[key] = Array.isArray(value) ? [...value] : value;
    this.trial = trial;
  }
  handleTrialReset() {
    this.trial = {};
  }

  // ------------------------------------------------------------ opening the editor
  get isEditing() {
    return Boolean(this.draft);
  }
  get isDirty() {
    return Boolean(this.draft) && JSON.stringify(this.cleanRule(this.draft)) + this.draft.kind + this.draft.key !== this.snapshot;
  }
  /** A new condition starts on a question with fixed answers when there is one: that is what rules usually test. */
  firstConditionFor(excludeKey) {
    const candidates = this.answerFields.filter((x) => x.key !== excludeKey);
    const f = candidates.find((x) => answersFor(x)?.length) || candidates[0];
    return f ? this.freshCondition(f) : { field: "", operator: "equals", value: "" };
  }
  freshCondition(field) {
    const type = field?.type;
    return { field: field?.key || "", operator: operatorsFor(type)[0], value: BOOLEAN_TYPES.has(type) ? "true" : "" };
  }
  open(draft) {
    if (this.draft && this.isDirty && !this.sameTarget(draft)) {
      this.pendingDraft = draft;
      return;
    }
    this.pendingDraft = undefined;
    this.showErrors = false;
    this.draft = draft;
    this.snapshot = JSON.stringify(this.cleanRule(draft)) + draft.kind + draft.key;
    this.selectedId = draft.from ? `${draft.from.kind}:${draft.from.key}` : "";
  }
  sameTarget(draft) {
    return Boolean(draft.from) && Boolean(this.draft?.from) && draft.from.kind === this.draft.from.kind && draft.from.key === this.draft.from.key;
  }
  existingDraft(kind, key) {
    const rule = this.ruleOf(kind, key);
    if (!rule) return null;
    return { from: { kind, key }, kind, key, action: rule.action || "show", match: rule.match === "any" ? "any" : "all", conditions: (rule.conditions || []).map((c) => ({ field: c.field, operator: c.operator || "equals", value: c.value ?? "" })) };
  }
  newDraft({ kind = "field", key = "", action = "show" } = {}) {
    return { from: null, kind, key, action, match: "all", conditions: [this.firstConditionFor(kind === "field" ? key : "")] };
  }
  /** A field or page from elsewhere: its rule, or a new rule for it. */
  openTarget(kind, key) {
    this.open(this.existingDraft(kind, key) || this.newDraft({ kind, key, action: "show" }));
  }
  handleNew() {
    this.open(this.newDraft());
  }
  handleRecipe(event) {
    const recipe = RECIPES.find((r) => r.id === event.currentTarget.dataset.id);
    if (!recipe) return;
    // a skipped page is usually not the first one
    const page = recipe.kind === "page" ? (this.sections[1] || this.sections[0])?.key || "" : "";
    this.open(this.newDraft({ kind: recipe.kind, key: page, action: recipe.action }));
  }
  handleSelectRule(event) {
    const { kind, key } = event.currentTarget.dataset;
    const draft = this.existingDraft(kind, key);
    if (draft) this.open(draft);
  }
  handleCardKey(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.handleSelectRule(event);
    }
  }
  handleCopyRule(event) {
    event.stopPropagation();
    const { kind, key } = event.currentTarget.dataset;
    const existing = this.existingDraft(kind, key);
    if (!existing) return;
    this.open({ ...existing, from: null, kind: "field", key: "" });
  }
  handleDeleteRule(event) {
    event.stopPropagation();
    const { kind, key } = event.currentTarget.dataset;
    this.dispatchEvent(new CustomEvent("rulechange", { detail: { kind, key, rule: null } }));
    if (this.draft?.from?.kind === kind && this.draft?.from?.key === key) this.close();
  }
  handleDiscardAndOpen() {
    const next = this.pendingDraft;
    this.pendingDraft = undefined;
    this.draft = undefined;
    if (next) this.open(next);
  }
  handleKeepEditing() {
    this.pendingDraft = undefined;
  }
  close() {
    this.draft = undefined;
    this.pendingDraft = undefined;
    this.showErrors = false;
    this.selectedId = "";
  }
  handleCancel() {
    this.close();
  }
  handleGoToBuild() {
    this.dispatchEvent(new CustomEvent("gotab", { detail: { tab: "build" } }));
  }

  // ------------------------------------------------------------ editor view
  get hasPending() {
    return Boolean(this.pendingDraft);
  }
  get editorKicker() {
    return this.draft?.from ? "Edit rule" : "New rule";
  }
  get canDelete() {
    return Boolean(this.draft?.from);
  }
  /** Questions a condition can use, grouped by page; the target itself is left out. */
  get questionOptions() {
    const out = [];
    this.sections.forEach((s, si) => {
      for (const f of s.fields || []) {
        if (!collectsAnswer(f.type) || holdsFiles(f.type)) continue;
        if (this.draft?.kind === "field" && f.key === this.draft.key) continue;
        for (const q of answerFieldsOf(f)) {
          if (q.derived) continue;
          out.push({ group: `Page ${si + 1} · ${s.label || s.name || ""}`, label: q.label || q.key, value: q.key, detail: q.table ? "Table row" : q.name ? "Name part" : q.address ? "Address part" : q.other ? "Other text" : this.typeLabel(q.type) });
        }
      }
    });
    return out;
  }
  /** Everything a rule can act on: each page, then its questions and blocks. */
  get targetOptions() {
    const out = [];
    const own = this.draft?.from ? `${this.draft.from.kind}:${this.draft.from.key}` : "";
    const used = new Set(this.allRules.map((r) => `${r.kind}:${r.key}`));
    const note = (id) => (used.has(id) && id !== own ? "Has a rule" : "");
    this.sections.forEach((s, si) => {
      const group = `Page ${si + 1} · ${s.label || s.name || ""}`;
      out.push({ group, label: "The whole page", value: `page:${s.key}`, detail: note(`page:${s.key}`) || "Page" });
      for (const f of s.fields || []) {
        if (f.type === "hidden") continue;
        out.push({ group, label: f.label || this.typeLabel(f.type), value: `field:${f.key}`, detail: note(`field:${f.key}`) || this.typeLabel(f.type) });
      }
    });
    return out;
  }
  get targetValue() {
    return this.draft?.key ? `${this.draft.kind}:${this.draft.key}` : "";
  }
  get targetField() {
    return this.draft?.kind === "field" ? this.index.fields.get(this.draft.key)?.field : null;
  }
  get actionOptions() {
    const opts = [
      { label: "Show", value: "show" },
      { label: "Hide", value: "hide" }
    ];
    if (!this.draft?.key || canRequire(this.draft.kind, this.targetField)) opts.push({ label: "Require", value: "require" });
    return opts;
  }
  get actionHelp() {
    const d = this.draft;
    if (!d) return "";
    if (d.kind === "page") return d.action === "show" ? "The page is skipped until the conditions are met." : "The page is skipped once the conditions are met.";
    return ACTIONS[d.action]?.help || "";
  }
  get matchOptions() {
    return [
      { label: "All of these", value: "all" },
      { label: "Any of these", value: "any" }
    ];
  }
  get showMatch() {
    return (this.draft?.conditions || []).length > 1;
  }
  get conditionRows() {
    const d = this.draft;
    if (!d) return [];
    return d.conditions.map((c, i) => {
      const field = this.index.fields.get(c.field)?.field;
      const type = field?.type;
      const ops = operatorsFor(type);
      if (c.operator && !ops.includes(c.operator)) ops.push(c.operator);
      const options = this.valueOptions(field, c.operator);
      const needsValue = takesValue(c.operator, type);
      let error = "";
      if (this.showErrors) {
        if (!field) error = "Choose a question.";
        else if (needsValue && String(c.value ?? "").trim() === "") error = "Choose or type an answer.";
      }
      return {
        index: i,
        joinWord: i > 0 ? (d.match === "any" ? "or" : "and") : "",
        field: c.field,
        operator: c.operator,
        operatorOptions: ops.map((op) => ({ label: opWord(op, type), value: op })),
        needsValue,
        hasOptions: needsValue && Boolean(options),
        options: options || [],
        typed: needsValue && !options,
        inputType: NUMBER_TYPES.has(type) ? "number" : type === "date" ? "date" : type === "time" ? "time" : "text",
        value: c.value ?? "",
        error,
        cls: `lg-cond${error ? " lg-cond-error" : ""}`,
        canRemove: d.conditions.length > 1
      };
    });
  }
  get targetError() {
    return this.showErrors && !this.draft?.key ? "Choose what this rule shows, hides or requires." : "";
  }
  get previewText() {
    const d = this.draft;
    return d ? this.sentenceOf(d.kind, d.key, d) : "";
  }
  /** Saving would replace another rule, or the rule may surprise respondents. */
  get draftNotes() {
    const d = this.draft;
    if (!d) return [];
    const notes = [];
    const id = `${d.kind}:${d.key}`;
    const own = d.from ? `${d.from.kind}:${d.from.key}` : "";
    if (d.key && id !== own && this.ruleOf(d.kind, d.key)) notes.push(`${this.targetLabel(d.kind, d.key)} already has a rule. Saving replaces it.`);
    if (d.key) notes.push(...this.problemsOf(d.kind, d.key, d).map((p) => `${p}.`));
    return notes.map((text, i) => ({ key: `n${i}`, text }));
  }
  get hasDraftNotes() {
    return this.draftNotes.length > 0;
  }

  // ------------------------------------------------------------ editor changes
  update(patch) {
    this.draft = { ...this.draft, ...patch };
  }
  handleMatch(event) {
    this.update({ match: event.detail.value });
  }
  handleAction(event) {
    this.update({ action: event.detail.value });
  }
  handleTarget(event) {
    const [kind, ...rest] = String(event.detail.value || "").split(":");
    const key = rest.join(":");
    const field = kind === "field" ? this.index.fields.get(key)?.field : null;
    const action = this.draft.action === "require" && !canRequire(kind, field) ? "show" : this.draft.action;
    // a question cannot depend on itself
    const conditions = this.draft.conditions.map((c) => (kind === "field" && c.field === key ? this.firstConditionFor(key) : c));
    this.update({ kind, key, action, conditions });
  }
  handleQuestion(event) {
    const i = Number(event.target.dataset.index);
    const field = this.index.fields.get(event.detail.value)?.field;
    const conditions = this.draft.conditions.map((c, idx) => (idx === i ? this.freshCondition(field) : c));
    this.update({ conditions });
  }
  handleOperator(event) {
    const i = Number(event.target.dataset.index);
    const op = event.detail.value;
    const conditions = this.draft.conditions.map((c, idx) => (idx === i ? { ...c, operator: op, value: NO_VALUE_OPS.has(op) ? "" : c.value } : c));
    this.update({ conditions });
  }
  handleValue(event) {
    const i = Number(event.target.dataset.index);
    const value = event.detail?.value ?? event.target.value;
    const conditions = this.draft.conditions.map((c, idx) => (idx === i ? { ...c, value } : c));
    this.update({ conditions });
  }
  handleAddCondition() {
    this.update({ conditions: [...this.draft.conditions, this.firstConditionFor(this.draft.kind === "field" ? this.draft.key : "")] });
  }
  handleRemoveCondition(event) {
    const i = Number(event.currentTarget.dataset.index);
    this.update({ conditions: this.draft.conditions.filter((_, idx) => idx !== i) });
  }

  // ------------------------------------------------------------ save
  /** The rule as stored: no value on operators that take none; consent tests "true". */
  cleanRule(d) {
    return {
      action: d.action,
      match: d.match === "any" ? "any" : "all",
      conditions: (d.conditions || []).map((c) => {
        const type = this.index.fields.get(c.field)?.field?.type;
        if (NO_VALUE_OPS.has(c.operator)) return { field: c.field, operator: c.operator };
        if (BOOLEAN_TYPES.has(type)) return { field: c.field, operator: c.operator, value: "true" };
        return { field: c.field, operator: c.operator, value: String(c.value ?? "").trim() };
      })
    };
  }
  get draftValid() {
    const d = this.draft;
    if (!d?.key || !(d.conditions || []).length) return false;
    return d.conditions.every((c) => {
      const type = this.index.fields.get(c.field)?.field?.type;
      return this.index.fields.has(c.field) && c.field !== (d.kind === "field" ? d.key : null) && (!takesValue(c.operator, type) || String(c.value ?? "").trim() !== "");
    });
  }
  handleSave() {
    if (!this.draftValid) {
      this.showErrors = true;
      return;
    }
    const d = this.draft;
    const detail = { kind: d.kind, key: d.key, rule: this.cleanRule(d) };
    if (d.from && (d.from.kind !== d.kind || d.from.key !== d.key)) detail.from = d.from;
    this.dispatchEvent(new CustomEvent("rulechange", { detail }));
    this.close();
    this.selectedId = `${d.kind}:${d.key}`;
  }
  handleDeleteDraft() {
    const from = this.draft?.from;
    if (!from) return;
    this.dispatchEvent(new CustomEvent("rulechange", { detail: { kind: from.kind, key: from.key, rule: null } }));
    this.close();
  }
}
