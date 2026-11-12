import FORM_OBJECT from "@salesforce/schema/Form__c";

/**
 * The package namespace on the client: the schema import compiles to "jform__Form__c" in the
 * managed package and "Form__c" from source, so the prefix is known without a server call.
 * Use it for every API, tab or event name and every page-state key built as a string.
 */
const FORM_API_NAME = (FORM_OBJECT && FORM_OBJECT.objectApiName) || "Form__c";

/** "jform__" or "". */
export const NAMESPACE_PREFIX = FORM_API_NAME.endsWith("Form__c") ? FORM_API_NAME.slice(0, FORM_API_NAME.length - "Form__c".length) : "";
/** "jform" or "". */
export const NAMESPACE = NAMESPACE_PREFIX.replace(/__$/, "");

/** Form_Changed__e → jform__Form_Changed__e in the package. */
export function qualify(apiName) {
  return NAMESPACE_PREFIX + apiName;
}

/** Page-state keys carry the component's namespace: c__formid, or jform__formid in the package. */
export function stateKey(name) {
  return `${NAMESPACE || "c"}__${name}`;
}

/** Read a page-state value, accepting the unmanaged c__ form too (links shared before packaging). */
export function readState(state, name) {
  if (!state) return undefined;
  return state[stateKey(name)] ?? state[`c__${name}`];
}

/** The Forms list view, where "All forms" goes: the workspace only opens one form. A packaged list view's name carries the prefix (jform__All). */
export function formListPage() {
  return { type: "standard__objectPage", attributes: { objectApiName: FORM_API_NAME, actionName: "list" }, state: { filterName: qualify("All") } };
}
