/**
 * Conditional logic engine. Pure functions, no DOM, no platform imports, so it
 * runs in the renderer, the builder preview and Jest. Must stay in lockstep with
 * JFormLogicEvaluator.cls: the fixtures in __tests__ are the shared contract.
 *
 * Rule: { action: 'show'|'hide'|'require', match: 'all'|'any',
 *         conditions: [{ field: <key>, operator, value }] }
 */

export const OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than", label: "is less than" }
];

export const ACTIONS = [
  { value: "show", label: "Show" },
  { value: "hide", label: "Hide" },
  { value: "require", label: "Require" }
];

/** Null, blank strings and empty arrays are "no answer"; arrays keep each element. */
function normalize(actual) {
  if (actual === null || actual === undefined) return [];
  if (Array.isArray(actual)) {
    return actual
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
      .map((v) => String(v).trim());
  }
  if (typeof actual === "boolean") return [actual ? "true" : "false"];
  const s = String(actual).trim();
  return s === "" ? [] : [s];
}

function toNumber(s) {
  if (s === null || s === undefined || String(s).trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function testCondition(condition, actual) {
  const values = normalize(actual);
  const expected = (condition.value ?? "").toString().trim();
  const op = condition.operator || "equals";
  const lower = expected.toLowerCase();
  switch (op) {
    case "is_empty":
      return values.length === 0;
    case "is_not_empty":
      return values.length > 0;
    case "equals":
      return values.some((v) => v.toLowerCase() === lower);
    case "not_equals":
      return !values.some((v) => v.toLowerCase() === lower);
    case "contains":
      return values.some((v) => v.toLowerCase().includes(lower));
    case "greater_than":
    case "less_than": {
      if (!values.length) return false;
      const a = toNumber(values[0]);
      const b = toNumber(expected);
      if (a === null || b === null) return false;
      return op === "greater_than" ? a > b : a < b;
    }
    default:
      return false;
  }
}

/**
 * The answer a condition reads. A table row is "field.row": the renderer keeps the table's answer as one
 * object ({ row: value }), while the server has already split it into one answer per row.
 */
export function answerFor(answers, key) {
  if (key in answers) return answers[key];
  const dot = String(key ?? "").indexOf(".");
  if (dot < 0) return undefined;
  const table = answers[key.slice(0, dot)];
  return table && typeof table === "object" && !Array.isArray(table) ? table[key.slice(dot + 1)] : undefined;
}

export function matches(rule, answers) {
  if (!rule || !Array.isArray(rule.conditions) || rule.conditions.length === 0) return true;
  const safe = answers || {};
  const any = rule.match === "any";
  for (const c of rule.conditions) {
    const ok = testCondition(c, answerFor(safe, c.field));
    if (any && ok) return true;
    if (!any && !ok) return false;
  }
  return !any;
}

/**
 * @param {object} definition  canonical form definition
 * @param {object} answers     field key -> value
 * @returns {{visible: Record<string, boolean>, required: Record<string, boolean>, sectionVisible: Record<string, boolean>}}
 */
export function evaluate(definition, answers) {
  const result = { visible: {}, required: {}, sectionVisible: {} };
  const safe = answers || {};
  for (const section of definition?.sections || []) {
    let sectionVisible = true;
    if (section.conditionalLogic) {
      const matched = matches(section.conditionalLogic, safe);
      if (section.conditionalLogic.action === "show") sectionVisible = matched;
      else if (section.conditionalLogic.action === "hide") sectionVisible = !matched;
    }
    result.sectionVisible[section.key] = sectionVisible;
    for (const field of section.fields || []) {
      let visible = sectionVisible;
      let required = field.required === true;
      if (field.conditionalLogic) {
        const matched = matches(field.conditionalLogic, safe);
        const action = field.conditionalLogic.action;
        if (action === "show") visible = visible && matched;
        else if (action === "hide") visible = visible && !matched;
        else if (action === "require") required = required || matched;
      }
      // a Payment block is never required: its price decides whether there is anything to pay, and its
      // answer is the total the server writes when the response is stored
      result.visible[field.key] = visible;
      result.required[field.key] = visible && required && field.type !== "payment";
    }
  }
  return result;
}

/** Human-readable sentence for a rule, used by the Logic tab and tooltips. */
export function describeRule(rule, labelFor = (key) => key, targetLabel = "this field") {
  if (!rule) return "";
  const verb = { show: "Show", hide: "Hide", require: "Require" }[rule.action] || rule.action;
  const joiner = rule.match === "any" ? " or " : " and ";
  const parts = (rule.conditions || []).map((c) => {
    const op = OPERATORS.find((o) => o.value === c.operator)?.label || c.operator;
    const needsValue = !["is_empty", "is_not_empty"].includes(c.operator);
    return `${labelFor(c.field)} ${op}${needsValue ? ` "${c.value ?? ""}"` : ""}`;
  });
  return `${verb} ${targetLabel} when ${parts.join(joiner)}`;
}
