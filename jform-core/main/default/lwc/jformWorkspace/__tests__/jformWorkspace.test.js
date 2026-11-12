import { createElement } from "lwc";
import JformWorkspace from "c/jformWorkspace";
import { loadAddressLists } from "c/jformAddressLists";
import { CurrentPageReference } from "lightning/navigation";
import getDefinition from "@salesforce/apex/JFormWorkspaceController.getDefinition";
import saveDefinition from "@salesforce/apex/JFormWorkspaceController.saveDefinition";
import getTargetObjects from "@salesforce/apex/JFormWorkspaceController.getTargetObjects";
import getSites from "@salesforce/apex/JFormWorkspaceController.getSites";
import createForm from "@salesforce/apex/JFormWorkspaceController.createForm";
import describeForm from "@salesforce/apex/JFormWorkspaceController.describeForm";
import createDescribedForm from "@salesforce/apex/JFormWorkspaceController.createDescribedForm";
import getGenerationStatus from "@salesforce/apex/JFormWorkspaceController.getGenerationStatus";
import { subscribe, unsubscribe, isEmpEnabled } from "lightning/empApi";
import publishForm from "@salesforce/apex/JFormWorkspaceController.publish";
import getObjectFields from "@salesforce/apex/JFormWorkspaceController.getObjectFields";
import getPaymentStatus from "@salesforce/apex/JFormWorkspaceController.getPaymentStatus";

const mockNavigate = jest.fn();
jest.mock("lightning/navigation", () => {
  const { createTestWireAdapter } = require("@salesforce/wire-service-jest-util");
  const Navigate = Symbol("Navigate");
  const NavigationMixin = (Base) =>
    class extends Base {
      [Navigate](ref, replace) {
        mockNavigate(ref, replace);
      }
    };
  NavigationMixin.Navigate = Navigate;
  NavigationMixin.GenerateUrl = Symbol("GenerateUrl");
  return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});
/** The last navigation, as { pageReference, replace }. */
const lastNavigation = () => {
  const call = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1] || [];
  return { pageReference: call[0], replace: call[1] };
};
jest.mock("@salesforce/apex/JFormWorkspaceController.getDefinition", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.saveDefinition", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getTargetObjects", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getSites", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.publish", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.unpublish", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.createForm", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.describeForm", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.createDescribedForm", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getGenerationStatus", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getObjectFields", () => ({ default: jest.fn(() => Promise.resolve([])) }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getPaymentStatus", () => ({ default: jest.fn() }), { virtual: true });
// the org's countries; a test sets them, or leaves them unread (a promise that never settles)
jest.mock("c/jformAddressLists", () => ({ ...jest.requireActual("c/jformAddressLists"), loadAddressLists: jest.fn(() => new Promise(() => {})) }));

const FORM_ID = "a00000000000001AAA";
/** A form saved before record steps existed: one target object and per-field mappings. */
const legacy = {
  id: FORM_ID,
  name: "Lead Form",
  targetObjectApiName: "lead", // older forms stored the object in lower case
  settings: { target: { strategy: "update_or_create", matchField: "Email" } },
  sections: [{ key: "p1", name: "Page 1", fields: [
    { key: "first", type: "text", label: "First name", targetFieldApiName: "FirstName" },
    { key: "last", type: "text", label: "Last name", targetFieldApiName: "LastName" },
    { key: "email", type: "email", label: "Email", targetFieldApiName: "Email" },
    { key: "notes", type: "comment", label: "Notes" }
  ] }]
};
const AUTOSAVE_MS = 1500;

/** Settle promise chains without touching the (fake) timers. */
const tick = async (n = 12) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const FORM_LIST = { type: "standard__objectPage", attributes: { objectApiName: "Form__c", actionName: "list" }, state: { filterName: "All" } };

function mount() {
  const el = createElement("c-jform-workspace", { is: JformWorkspace });
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  jest.useFakeTimers();
  window.innerWidth = 1280; // desktop layout unless a test says otherwise (jsdom defaults to 1024, the compact layout)
  getTargetObjects.mockResolvedValue([{ label: "Lead", value: "Lead" }]);
  getSites.mockResolvedValue([]);
  getPaymentStatus.mockResolvedValue({ sandbox: false });
  getGenerationStatus.mockResolvedValue({ available: false });
  // the server normalises the object name when it saves, like JFormAutomationService.normalise
  saveDefinition.mockImplementation(({ definitionJson }) => {
    const d = JSON.parse(definitionJson);
    if (d.targetObjectApiName) d.targetObjectApiName = d.targetObjectApiName.charAt(0).toUpperCase() + d.targetObjectApiName.slice(1).toLowerCase();
    return Promise.resolve(JSON.stringify(d));
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-workspace: opening a form", () => {
  it("shows the avatar loader until the form has loaded", async () => {
    let resolve;
    getDefinition.mockReturnValue(new Promise((r) => (resolve = r)));
    const el = mount();
    await tick();
    // before the page state arrives
    expect(el.shadowRoot.querySelector(".ws-loading")).not.toBeNull();

    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const loader = el.shadowRoot.querySelector(".ws-loading");
    expect(loader.getAttribute("role")).toBe("status");
    expect(loader.querySelector(".ws-loader-text").textContent).toBe("Opening your form…");
    expect(loader.querySelector("img.ws-loader-avatar").getAttribute("src")).toBe("jformLoadingAvatar");
    expect(loader.querySelector("svg.ws-loader-ring")).not.toBeNull();

    resolve(JSON.stringify({ ...legacy, settings: {}, targetObjectApiName: null }));
    await tick();
    expect(el.shadowRoot.querySelector(".ws-loading")).toBeNull();
    expect(el.shadowRoot.querySelector(".ws-header")).not.toBeNull();
  });

  it("reads only the form when it opens; objects, sites and the AI status wait until something shows them", async () => {
    getDefinition.mockResolvedValue(JSON.stringify({ ...legacy, settings: { automation: { steps: [{ key: "record", action: "create", object: "Lead", primary: true, fields: [] }] } }, targetObjectApiName: null }));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(el.shadowRoot.querySelector(".ws-header")).not.toBeNull();
    expect(getDefinition).toHaveBeenCalledTimes(1);
    expect(getTargetObjects).not.toHaveBeenCalled();
    expect(getSites).not.toHaveBeenCalled();
    expect(getGenerationStatus).not.toHaveBeenCalled();
    expect(getPaymentStatus).not.toHaveBeenCalled();
    expect(loadAddressLists).not.toHaveBeenCalled();

    // a field of a form whose record step fixes the object needs no object list
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("select", { detail: { kind: "field", sectionIndex: 0, fieldIndex: 0 } }));
    await tick();
    expect(getTargetObjects).not.toHaveBeenCalled();

    el.shadowRoot.querySelector('button[data-tab="automate"]').click();
    await tick();
    expect(getTargetObjects).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot.querySelector("c-jform-automate-tab").targetObjects).toEqual([{ label: "Lead", value: "Lead" }]);
    el.shadowRoot.querySelector('button[data-tab="build"]').click();
    await tick();
    el.shadowRoot.querySelector('button[data-tab="automate"]').click();
    await tick();
    expect(getTargetObjects).toHaveBeenCalledTimes(1);

    [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Share").click();
    await tick();
    expect(getSites).toHaveBeenCalledTimes(1);
  });

  it("reads the objects when a field is selected on a form with no record step yet", async () => {
    getDefinition.mockResolvedValue(JSON.stringify({ ...legacy, settings: { automation: { steps: [] } }, targetObjectApiName: null }));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(getTargetObjects).not.toHaveBeenCalled();
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("select", { detail: { kind: "field", sectionIndex: 0, fieldIndex: 0 } }));
    await tick();
    expect(getTargetObjects).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot.querySelector("c-jform-properties").targetObjects).toEqual([{ label: "Lead", value: "Lead" }]);
  });

  it("goes to the Forms list view when the page state has no form", async () => {
    const el = mount();
    CurrentPageReference.emit({ state: {} });
    await tick();
    expect(el.shadowRoot.querySelector(".ws-loading")).toBeNull();
    expect(el.shadowRoot.querySelector(".ws-header")).toBeNull();
    const { pageReference, replace } = lastNavigation();
    expect(pageReference).toEqual(FORM_LIST);
    expect(replace).toBe(true);
  });

  it("keeps a form left open in this tab when the page state names no form", async () => {
    getDefinition.mockResolvedValue(JSON.stringify({ ...legacy, settings: {}, targetObjectApiName: null }));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    CurrentPageReference.emit({ state: {} }); // the Form Workspace tab itself
    await tick();
    expect(el.shadowRoot.querySelector(".ws-header")).not.toBeNull();
    expect(lastNavigation().pageReference).not.toEqual(FORM_LIST);
  });

  it("shows why a form could not be opened, with a way back to the forms", async () => {
    getDefinition.mockRejectedValue({ body: { message: "Form not found" } });
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const box = el.shadowRoot.querySelector(".ws-load-error");
    expect(box.querySelector(".ws-alert").textContent).toBe("Form not found");
    box.querySelector("lightning-button").click();
    expect(lastNavigation().pageReference).toEqual(FORM_LIST);
  });

  it("saves the form's edits, then goes to the Forms list view, from the header's Forms", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(legacy)); // converted on open: unsaved changes
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Unsaved changes");
    expect(saveDefinition).not.toHaveBeenCalled();

    el.shadowRoot.querySelector(".ws-back").click();
    await tick(30);
    expect(saveDefinition).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot.querySelector(".ws-header")).toBeNull();
    expect(lastNavigation().pageReference).toEqual(FORM_LIST);

    // the same form opens again from Home or the record's Edit
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(getDefinition).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot.querySelector(".ws-header")).not.toBeNull();
  });

  it("keeps the form open with its edits when they can't be saved before going to the forms", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(legacy));
    saveDefinition.mockRejectedValue({ body: { message: "Insufficient access" } });
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    el.shadowRoot.querySelector(".ws-back").click();
    await tick(30);
    expect(saveDefinition).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot.querySelector(".ws-header")).not.toBeNull();
    expect(lastNavigation().pageReference).not.toEqual(FORM_LIST);
  });

  it("opens New form from Home over an empty workspace, and goes to the forms when it is closed", async () => {
    const el = mount();
    CurrentPageReference.emit({ state: { c__action: "new" } });
    await tick();
    // the dialog takes "action=new" out of the address; that empty state doesn't send the page away
    CurrentPageReference.emit({ state: {} });
    await tick();
    expect(el.shadowRoot.querySelector('section[aria-label="New form"]')).not.toBeNull();
    expect(lastNavigation().pageReference).not.toEqual(FORM_LIST);
    el.shadowRoot.querySelector(".jf-modal-close").click();
    await tick();
    expect(el.shadowRoot.querySelector('section[aria-label="New form"]')).toBeNull();
    expect(lastNavigation()).toEqual({ pageReference: FORM_LIST, replace: true });
  });

  it("converts a legacy single-target form into a record step and autosaves it", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(legacy));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();

    expect(getDefinition).toHaveBeenCalledWith({ formId: FORM_ID });
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Unsaved changes");
    // the conversion is not something the user did, so it is not an undo entry
    expect(el.shadowRoot.querySelector('lightning-button-icon[title^="Undo"]').disabled).toBe(true);

    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();

    expect(saveDefinition).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(saveDefinition.mock.calls[0][0].definitionJson);
    expect(saved.settings.target).toBeUndefined();
    expect(saved.targetObjectApiName).toBe("lead");
    expect(saved.settings.automation.steps).toHaveLength(1);
    expect(saved.settings.automation.steps[0]).toMatchObject({
      action: "find_or_create",
      object: "lead",
      primary: true,
      match: { field: "Email", source: { type: "field", key: "email" } }
    });
    expect(saved.settings.automation.steps[0].fields).toEqual([
      { field: "FirstName", source: { type: "field", key: "first" } },
      { field: "LastName", source: { type: "field", key: "last" } },
      { field: "Email", source: { type: "field", key: "email" } }
    ]);
    expect(saved.sections[0].fields.some((f) => f.targetFieldApiName)).toBe(false);
    // the server's normalised version is adopted, so the form reads as saved
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");
    expect(el.shadowRoot.querySelector('lightning-button-icon[title^="Undo"]').disabled).toBe(true);
  });

  it("leaves a form that already has steps untouched", async () => {
    const current = { ...legacy, settings: { automation: { steps: [{ key: "record", action: "create", object: "Lead", primary: true, fields: [] }] } } };
    getDefinition.mockResolvedValue(JSON.stringify(current));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await tick();

    expect(saveDefinition).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");
  });

  it("ignores a save that returns after another form was opened", async () => {
    let resolveSave;
    saveDefinition.mockImplementationOnce(() => new Promise((resolve) => (resolveSave = resolve)));
    getDefinition.mockResolvedValueOnce(JSON.stringify(legacy));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    jest.advanceTimersByTime(AUTOSAVE_MS); // form A's conversion is now saving, slowly
    await tick();
    expect(saveDefinition).toHaveBeenCalledTimes(1);

    const otherId = "a00000000000002AAA";
    const other = { ...legacy, id: otherId, name: "Other form", settings: { automation: { steps: [{ key: "record", action: "create", object: "Lead", primary: true, fields: [] }] } } };
    getDefinition.mockResolvedValueOnce(JSON.stringify(other));
    CurrentPageReference.emit({ state: { c__formid: otherId } });
    await tick();
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");

    resolveSave(JSON.stringify({ ...legacy, targetObjectApiName: "Lead" })); // form A's save lands while B is open
    await tick();
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await tick();

    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");
    expect(saveDefinition).toHaveBeenCalledTimes(1); // B was never marked dirty, so it was never sent with A's ids
  });

  it("leaves a bare legacy object for the server to map on the next save", async () => {
    const bare = { ...legacy, settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }] }] };
    getDefinition.mockResolvedValue(JSON.stringify(bare));
    mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await tick();

    expect(saveDefinition).not.toHaveBeenCalled();
  });
});

describe("c-jform-workspace: in a Lightning tab", () => {
  /** The padded container Lightning puts a component tab in, with its wrappers in between. */
  function mountInTab(padding) {
    const tab = document.createElement("div");
    tab.className = "slds-brand-band slds-template_default";
    tab.style.padding = padding;
    document.body.appendChild(tab);
    let inner = tab;
    for (const cls of ["slds-template__container", "center oneCenterStage", "oneContent active"]) {
      const wrapper = document.createElement("div");
      wrapper.className = cls;
      inner.appendChild(wrapper);
      inner = wrapper;
    }
    const el = createElement("c-jform-workspace", { is: JformWorkspace });
    inner.appendChild(el);
    return el;
  }

  it("fills the tab's padding so the builder meets the navigation bar and the window edges", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(legacy));
    const el = mountInTab("16px");
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const style = el.shadowRoot.querySelector(".ws").getAttribute("style");
    expect(style).toContain("margin:-16px -16px -16px -16px");
    // jsdom puts the host at the top of an empty window: the builder reaches the bottom, with no 12px gap
    expect(style).toContain(`height:${window.innerHeight + 16}px`);
  });

  it("keeps its place anywhere else, such as on an App Page", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(legacy));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const style = el.shadowRoot.querySelector(".ws").getAttribute("style");
    expect(style).not.toContain("margin");
    expect(style).toContain(`height:${window.innerHeight - 12}px`);
  });
});

describe("c-jform-workspace: side panels", () => {
  const current = { ...legacy, settings: { automation: { steps: [{ key: "record", action: "create", object: "Lead", primary: true, fields: [] }] } } };
  const resizer = (el, panel) => el.shadowRoot.querySelector(`.ws-resizer[data-panel="${panel}"]`);

  it("resizes the properties panel from the keyboard, within limits, and remembers it", async () => {
    window.localStorage.clear();
    window.innerWidth = 1400;
    getDefinition.mockResolvedValue(JSON.stringify(current));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const handle = resizer(el, "props");
    expect(handle).not.toBeNull();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); // grows a right-hand panel
    await tick();
    const props = el.shadowRoot.querySelector(".ws-props");
    expect(props.getAttribute("style")).toContain("width:296px"); // 280 minimum + one step
    expect(JSON.parse(window.localStorage.getItem("jform.workspace.panels")).props.width).toBe(296);
    for (let i = 0; i < 40; i++) handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await tick();
    expect(el.shadowRoot.querySelector(".ws-props").getAttribute("style")).toContain("width:280px"); // never below the minimum
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    await tick();
    expect(el.shadowRoot.querySelector(".ws-props").getAttribute("style") || "").toBe(""); // back to the default flex sizing
  });

  it("hides and shows the palette with the chevron", async () => {
    window.localStorage.clear();
    getDefinition.mockResolvedValue(JSON.stringify(current));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const palette = () => el.shadowRoot.querySelector(".ws-palette");
    expect(palette().classList.contains("ws-panel-closed")).toBe(false);
    resizer(el, "palette").querySelector(".ws-resizer-toggle").click();
    await tick();
    // stays in the page, closed, so the slide can animate
    expect(palette()).not.toBeNull();
    expect(palette().classList.contains("ws-panel-closed")).toBe(true);
    expect(resizer(el, "palette").classList.contains("ws-resizer-collapsed")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("jform.workspace.panels")).palette.collapsed).toBe(true);
    resizer(el, "palette").querySelector(".ws-resizer-toggle").click();
    await tick();
    expect(palette().classList.contains("ws-panel-closed")).toBe(false);
  });
});

describe("c-jform-workspace: keyboard undo", () => {
  const current = { ...legacy, settings: { automation: { steps: [{ key: "record", action: "create", object: "Lead", primary: true, fields: [] }] } } };
  async function openAndRename(el) {
    getDefinition.mockResolvedValue(JSON.stringify(current));
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const name = el.shadowRoot.querySelector(".ws-name");
    name.value = "Renamed";
    name.dispatchEvent(new Event("change"));
    await tick();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Renamed");
  }
  /** Cmd+Z dispatched on `target`; `path` stands in for composedPath() when the key came from inside a base component's shadow root. */
  const press = (target, path) => {
    const event = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, composed: true });
    if (path) event.composedPath = () => path;
    target.dispatchEvent(event);
  };

  it("undoes the last form edit when Cmd+Z is pressed outside an editor", async () => {
    const el = mount();
    await openAndRename(el);
    press(el.shadowRoot.querySelector(".ws"));
    await tick();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Lead Form");
  });

  it("leaves Cmd+Z to the rich text editor, whose editable sits behind its own shadow root", async () => {
    const el = mount();
    await openAndRename(el);
    // the key reaches the workspace through the lightning-input-rich-text host in the properties panel,
    // whose closed shadow root hides the contenteditable from composedPath()
    const root = el.shadowRoot.querySelector(".ws");
    press(root, [document.createElement("lightning-input-rich-text"), root, el]);
    await tick();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Renamed");
    // plain inputs and editable elements are editors too
    press(el.shadowRoot.querySelector(".ws-name"));
    await tick();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Renamed");
  });

  it("saves an undo after an autosave at the revision that autosave returned, not as a conflict", async () => {
    // like JFormDefinitionService.save: a stale revision is refused, every save bumps it
    let serverRevision = 3;
    saveDefinition.mockImplementation(({ definitionJson }) => {
      const d = JSON.parse(definitionJson);
      if (d.revision !== serverRevision) return Promise.reject({ body: { message: "CONFLICT: This form was changed elsewhere after you loaded it." } });
      serverRevision += 1;
      return Promise.resolve(JSON.stringify({ ...d, revision: serverRevision }));
    });
    const el = mount();
    getDefinition.mockResolvedValue(JSON.stringify({ ...current, revision: 3 }));
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const name = el.shadowRoot.querySelector(".ws-name");
    name.value = "Renamed";
    name.dispatchEvent(new CustomEvent("change"));
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");

    el.shadowRoot.querySelector('lightning-button-icon[title="Undo (Ctrl+Z)"]').click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Lead Form");
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    expect(saveDefinition).toHaveBeenCalledTimes(2);
    expect(JSON.parse(saveDefinition.mock.calls[1][0].definitionJson)).toMatchObject({ name: "Lead Form", revision: 4 });
    expect(el.shadowRoot.querySelector(".ws-conflict")).toBeNull();
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");
  });
});

describe("c-jform-workspace: New form → Describe it", () => {
  const DRAFT = {
    name: "Store visit",
    targetObjectApiName: null,
    definitionJson: JSON.stringify({ name: "Store visit", label: "Store visit", sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email", required: true }] }] }),
    fieldCount: 2,
    pages: [{ name: "Contact details", fields: [{ label: "Email", type: "Email", required: true }, { label: "Store", type: "Picklist", required: false, options: "London, Leeds" }] }]
  };
  async function openDialog(available) {
    getDefinition.mockResolvedValue(JSON.stringify({ ...legacy, settings: { automation: { steps: [] } } }));
    getGenerationStatus.mockResolvedValue({ available, model: "sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet" });
    const el = mount();
    CurrentPageReference.emit({ state: { c__action: "new" } });
    await tick();
    return el;
  }
  const buttons = (el) => [...el.shadowRoot.querySelectorAll(".slds-modal__footer lightning-button")].map((b) => b.label);
  const button = (el, label) => [...el.shadowRoot.querySelectorAll(".slds-modal__footer lightning-button")].find((b) => b.label === label);
  /** Lightning stubs expose `label` as a property, so inputs are found by it, not by attribute. */
  const setInput = (el, tagOrLabel, value) => {
    const input = tagOrLabel.includes("-")
      ? el.shadowRoot.querySelector(tagOrLabel)
      : [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === tagOrLabel);
    input.value = value;
    input.dispatchEvent(new CustomEvent("change"));
  };

  it("offers Describe it only when generation is available", async () => {
    const hidden = await openDialog(false);
    expect(hidden.shadowRoot.querySelector(".ws-seg")).toBeNull();
    expect(buttons(hidden)).toEqual(["Cancel", "Create"]);
    document.body.removeChild(hidden);

    const el = await openDialog(true);
    expect(el.shadowRoot.querySelector(".ws-seg")).not.toBeNull();
    expect(buttons(el)).toEqual(["Cancel", "Create"]); // Blank stays the default
    el.shadowRoot.querySelector('.ws-seg-btn[data-mode="describe"]').click();
    await tick();
    expect(el.shadowRoot.querySelector("lightning-textarea")).not.toBeNull();
    expect(buttons(el)).toEqual(["Cancel", "Generate"]);
    expect(button(el, "Generate").disabled).toBe(true); // needs a name and a description
  });

  it("previews the draft, lets the user try again, and creates only on confirmation", async () => {
    const el = await openDialog(true);
    el.shadowRoot.querySelector('.ws-seg-btn[data-mode="describe"]').click();
    await tick();
    setInput(el, "Name", "Store visit");
    setInput(el, "lightning-textarea", "Booking form with email and a store dropdown");
    await tick();
    expect(button(el, "Generate").disabled).toBe(false);
    describeForm.mockResolvedValue(JSON.stringify(DRAFT));
    button(el, "Generate").click();
    await tick();
    expect(describeForm).toHaveBeenCalledWith({ description: "Booking form with email and a store dropdown", name: "Store visit", targetObjectApiName: null });
    expect(createDescribedForm).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".ws-draft-summary").textContent).toBe("1 page, 2 fields");
    const items = [...el.shadowRoot.querySelectorAll(".ws-draft-fields li")].map((li) => li.textContent);
    expect(items[0]).toBe("EmailEmail, required");
    expect(items[1]).toBe("StorePicklist: London, Leeds");
    expect(buttons(el)).toEqual(["Cancel", "Try again", "Create form"]);

    // the description can be refined and sent again
    setInput(el, "lightning-textarea", "Booking form with email, a store dropdown and a date");
    button(el, "Try again").click();
    await tick();
    expect(describeForm).toHaveBeenLastCalledWith(expect.objectContaining({ description: "Booking form with email, a store dropdown and a date" }));

    // the name typed after the preview wins over the one in the draft
    setInput(el, "Name", "Store visit 2026");
    createDescribedForm.mockResolvedValue(JSON.stringify({ id: "a00000000000009AAA", name: "Store visit 2026", label: "Store visit 2026", settings: { automation: { steps: [] } }, sections: DRAFT.pages.map((p, i) => ({ key: `p${i}`, name: p.name, fields: [] })) }));
    button(el, "Create form").click();
    await tick();
    const sent = createDescribedForm.mock.calls[0][0];
    expect(JSON.parse(sent.definitionJson).name).toBe("Store visit 2026");
    expect(sent.clientId).toBeTruthy(); // the tab ignores the change event its own create publishes
    expect(sent.targetObjectApiName).toBeNull();
    expect(el.shadowRoot.querySelector(".slds-modal")).toBeNull(); // dialog closed, form adopted
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Store visit 2026");
    expect(createForm).not.toHaveBeenCalled();
  });

  it("shows generation errors inline and keeps the description", async () => {
    const el = await openDialog(true);
    el.shadowRoot.querySelector('.ws-seg-btn[data-mode="describe"]').click();
    await tick();
    setInput(el, "Name", "Nonsense");
    setInput(el, "lightning-textarea", "asdf");
    describeForm.mockResolvedValueOnce(JSON.stringify(DRAFT));
    button(el, "Generate").click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-draft")).not.toBeNull();
    describeForm.mockRejectedValue({ body: { message: "The description could not be turned into a form." } });
    button(el, "Try again").click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-draft")).toBeNull(); // a failed retry drops the stale preview
    expect(el.shadowRoot.querySelector(".ws-alert").textContent).toContain("could not be turned into a form");
    expect(el.shadowRoot.querySelector("lightning-textarea").value).toBe("asdf");
    expect(el.shadowRoot.querySelector(".slds-modal")).not.toBeNull();
    expect(buttons(el)).toEqual(["Cancel", "Generate"]);
  });
});

describe("c-jform-workspace: live updates from elsewhere", () => {
  const current = { ...legacy, revision: 3, settings: { automation: { steps: [{ key: "record", action: "create", object: "Lead", primary: true, fields: [] }] } } };
  /** The event handler the component registered with empApi. */
  const handler = () => subscribe.mock.calls[subscribe.mock.calls.length - 1][2];
  const event = (overrides) => ({ data: { payload: { Form_Id__c: FORM_ID, Revision__c: 4, Change__c: "saved", Client_Id__c: null, ...overrides } } });
  async function open() {
    isEmpEnabled.mockResolvedValue(true);
    subscribe.mockResolvedValue({ id: "sub-1" });
    getDefinition.mockResolvedValue(JSON.stringify(current));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    return el;
  }
  const rename = (el, name) => {
    const input = el.shadowRoot.querySelector(".ws-name");
    input.value = name;
    input.dispatchEvent(new Event("change"));
  };

  it("subscribes on connect, unsubscribes on disconnect, and ignores events that are not about this tab's form", async () => {
    const el = await open();
    expect(subscribe).toHaveBeenCalledWith("/event/Form_Changed__e", -1, expect.any(Function));
    getDefinition.mockClear();
    handler()(event({ Form_Id__c: "a00000000000002AAA" }));
    await tick();
    expect(getDefinition).not.toHaveBeenCalled();
    document.body.removeChild(el);
    expect(unsubscribe).toHaveBeenCalledWith({ id: "sub-1" }, expect.any(Function));
  });

  it("ignores its own saves: the client id sent with the save comes back on the event", async () => {
    const el = await open();
    rename(el, "Mine");
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    const { clientId } = saveDefinition.mock.calls[0][0];
    expect(clientId).toBeTruthy();
    getDefinition.mockClear();
    handler()(event({ Client_Id__c: clientId, Revision__c: 4 }));
    await tick();
    expect(getDefinition).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".ws-conflict")).toBeNull();
  });

  it("reloads a clean tab silently and tells the user who changed it", async () => {
    const el = await open();
    const toasts = [];
    el.addEventListener("lightning__showtoast", (e) => toasts.push(e.detail));
    getDefinition.mockResolvedValue(JSON.stringify({ ...current, name: "Changed by the agent", revision: 4 }));
    handler()(event());
    await tick();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Changed by the agent");
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");
    expect(toasts[0].title).toBe("Updated");
    expect(toasts[0].message).toContain("Agentforce updated this form");
    expect(el.shadowRoot.querySelector(".ws-conflict")).toBeNull();
  });

  it("holds a tab with unsaved edits: banner, autosave paused, then Reload or Keep mine", async () => {
    const el = await open();
    rename(el, "Typed locally");
    handler()(event({ Revision__c: 7, Client_Id__c: "other-tab" }));
    await tick();
    const banner = el.shadowRoot.querySelector(".ws-conflict");
    expect(banner.textContent).toContain("Another tab updated this form while you have unsaved edits");
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Typed locally"); // nothing overwritten
    jest.advanceTimersByTime(AUTOSAVE_MS * 2);
    await tick();
    expect(saveDefinition).not.toHaveBeenCalled(); // autosave waits for the decision

    // Keep mine: the next save carries the newer revision and goes through
    [...banner.querySelectorAll("lightning-button")].find((b) => b.label === "Keep mine").click();
    await tick();
    expect(saveDefinition).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(saveDefinition.mock.calls[0][0].definitionJson);
    expect(sent.revision).toBe(7);
    expect(sent.name).toBe("Typed locally");
    expect(el.shadowRoot.querySelector(".ws-conflict")).toBeNull();

    // Reload: the server copy replaces the local edits
    rename(el, "Typed again");
    handler()(event({ Revision__c: 9 }));
    await tick();
    getDefinition.mockResolvedValue(JSON.stringify({ ...current, name: "Agent's version", revision: 9 }));
    [...el.shadowRoot.querySelectorAll(".ws-conflict lightning-button")].find((b) => b.label === "Reload").click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Agent's version");
    expect(el.shadowRoot.querySelector(".ws-conflict")).toBeNull();
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Saved");
  });

  it("turns a refused stale save into the same banner, even without an event", async () => {
    isEmpEnabled.mockResolvedValue(false); // streaming API off: no subscription at all
    getDefinition.mockResolvedValue(JSON.stringify(current));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const before = subscribe.mock.calls.length;
    expect(subscribe.mock.calls.length).toBe(before);
    rename(el, "Stale");
    saveDefinition.mockRejectedValueOnce({ body: { message: "CONFLICT: This form was changed elsewhere after you loaded it." } });
    getDefinition.mockResolvedValue(JSON.stringify({ ...current, revision: 12 }));
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    expect(el.shadowRoot.querySelector(".ws-save").textContent).toBe("Updated elsewhere");
    expect(el.shadowRoot.querySelector(".ws-conflict")).not.toBeNull();
    [...el.shadowRoot.querySelectorAll(".ws-conflict lightning-button")].find((b) => b.label === "Keep mine").click();
    await tick();
    expect(JSON.parse(saveDefinition.mock.calls[1][0].definitionJson).revision).toBe(12);
  });
});

describe("c-jform-workspace: fixes from the partner org test", () => {
  const live = {
    id: FORM_ID,
    name: "Live form",
    isActive: true,
    status: "Active",
    version: 1,
    revision: 5,
    publishedRevision: 5,
    publicKey: "k1",
    settings: {},
    sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }] }]
  };
  const brandButton = (el) => [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.variant === "brand" && /^Publish/.test(b.label));
  const rename = async (el, name) => {
    const input = el.shadowRoot.querySelector(".ws-name");
    input.value = name;
    input.dispatchEvent(new CustomEvent("change"));
    await tick();
  };

  it("opens New form from Home even while another form is open in this tab", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(live));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(el.shadowRoot.querySelector('section[aria-label="New form"]')).toBeNull();

    CurrentPageReference.emit({ state: { c__action: "new" } });
    await tick();
    expect(el.shadowRoot.querySelector('section[aria-label="New form"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector(".ws-name").value).toBe("Live form"); // the open form stays behind the dialog
  });

  it("disables Publish changes until something changed, and keeps the save counter after publishing", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(live));
    publishForm.mockResolvedValue({ versionNumber: 2, publicKey: "k1", status: "Active", revision: 8 });
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(brandButton(el).label).toBe("Publish changes");
    expect(brandButton(el).disabled).toBe(true);
    expect(brandButton(el).title).toBe("No changes since version 1");

    await rename(el, "Live form v2");
    expect(brandButton(el).disabled).toBe(false);
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();

    brandButton(el).click();
    await tick();
    const confirm = [...el.shadowRoot.querySelectorAll('section[aria-label="Publish form"] lightning-button')].find((b) => b.label === "Publish");
    confirm.click();
    await tick();
    expect(publishForm).toHaveBeenCalled();
    expect(brandButton(el).disabled).toBe(true);

    // the next edit is saved with the revision the publish returned, so it is not refused as stale
    await rename(el, "Live form v3");
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    const sent = JSON.parse(saveDefinition.mock.calls[saveDefinition.mock.calls.length - 1][0].definitionJson);
    expect(sent.revision).toBe(8);
    expect(sent.name).toBe("Live form v3");
  });

  it("shows the public link first after publishing when the org has a site", async () => {
    getSites.mockResolvedValue([{ id: "site1", label: "JForm", baseUrl: "https://example.my.site.com/jform", isExperienceSite: true }]);
    getDefinition.mockResolvedValue(JSON.stringify({ ...live, isActive: false, publishedRevision: null, version: null, publicKey: null }));
    publishForm.mockResolvedValue({ versionNumber: 1, publicKey: "abc123", status: "Active", revision: 6 });
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    brandButton(el).click();
    await tick();
    [...el.shadowRoot.querySelectorAll('section[aria-label="Publish form"] lightning-button')].find((b) => b.label === "Publish").click();
    await tick();
    const inputs = [...el.shadowRoot.querySelectorAll('section[aria-label="Publish form"] lightning-input')];
    expect(inputs[0].label).toBe("Public link");
    expect(inputs[0].value).toBe("https://example.my.site.com/jform/form?key=abc123");
  });

  it("names a generated key after its label and maps it to the matching object field", async () => {
    getObjectFields.mockResolvedValue([{ label: "Company", value: "Company" }, { label: "Email", value: "Email" }]);
    const draft = {
      id: FORM_ID,
      name: "Draft",
      revision: 1,
      settings: { automation: { steps: [{ key: "record", action: "create", object: "Lead", primary: true, fields: [{ field: "Email", source: { type: "field", key: "email" } }] }] } },
      sections: [{ key: "p1", name: "Page 1", fields: [
        { key: "email", type: "email", label: "Email" },
        { key: "text_2", type: "text", label: "Company", conditionalLogic: { action: "show", match: "all", conditions: [{ field: "text_2", operator: "isNotEmpty" }] } }
      ] }]
    };
    getDefinition.mockResolvedValue(JSON.stringify(draft));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    el.shadowRoot.querySelector("c-jform-properties").dispatchEvent(new CustomEvent("labelcommit", { detail: { key: "text_2" } }));
    await tick();
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    const sent = JSON.parse(saveDefinition.mock.calls[saveDefinition.mock.calls.length - 1][0].definitionJson);
    const field = sent.sections[0].fields[1];
    expect(field.key).toBe("company");
    expect(field.conditionalLogic.conditions[0].field).toBe("company");
    expect(sent.settings.automation.steps[0].fields).toContainEqual({ field: "Company", source: { type: "field", key: "company" } });
  });

  it("keeps keys once the form has been published", async () => {
    getObjectFields.mockResolvedValue([]);
    getDefinition.mockResolvedValue(JSON.stringify({ ...live, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "text", type: "text", label: "Company" }] }] }));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    el.shadowRoot.querySelector("c-jform-properties").dispatchEvent(new CustomEvent("labelcommit", { detail: { key: "text" } }));
    await tick();
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    expect(saveDefinition).not.toHaveBeenCalled(); // nothing changed: responses may already carry the key
  });
});

describe("c-jform-workspace: status chip", () => {
  it("says Closed in amber for a form taken offline, Draft before the first publish", async () => {
    getDefinition.mockResolvedValue(JSON.stringify({ id: FORM_ID, name: "Offline", isActive: false, status: "Inactive", version: 2, revision: 3, settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [] }] }));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    const chip = el.shadowRoot.querySelector(".ws-header .ws-chip");
    expect(chip.textContent).toBe("Closed");
    expect(chip.className).toBe("ws-chip ws-chip-closed");
  });
});

describe("c-jform-workspace: compact layout (600 to 1099px)", () => {
  const form = { id: FORM_ID, name: "A very long form name that will not fit next to the actions", revision: 1, settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }] }] };
  const select = (el) =>
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("select", { detail: { kind: "field", sectionIndex: 0, fieldIndex: 0 } }));

  it("opens the properties as a drawer for a selection and closes it with the button or Escape", async () => {
    window.innerWidth = 900;
    getDefinition.mockResolvedValue(JSON.stringify(form));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(el.shadowRoot.querySelector(".ws").className).toContain("ws-compact");
    expect(el.shadowRoot.querySelector(".ws-props")).toBeNull(); // nothing selected, no drawer over the canvas

    select(el);
    await tick();
    expect(el.shadowRoot.querySelector(".ws-props c-jform-properties")).not.toBeNull();
    el.shadowRoot.querySelector(".ws-drawer-close").click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-props")).toBeNull();

    select(el); // selecting again, even the same field, reopens it
    await tick();
    expect(el.shadowRoot.querySelector(".ws-props")).not.toBeNull();
    el.shadowRoot.querySelector(".ws").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(el.shadowRoot.querySelector(".ws-props")).toBeNull();
  });

  it("folds Undo, Redo and Full screen into a menu and keeps the name's full text in a tooltip", async () => {
    window.innerWidth = 900;
    getDefinition.mockResolvedValue(JSON.stringify(form));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(el.shadowRoot.querySelector('lightning-button-icon[title^="Undo"]')).toBeNull();
    const menu = el.shadowRoot.querySelector("lightning-button-menu.ws-more");
    expect([...menu.querySelectorAll("lightning-menu-item")].map((i) => i.value)).toEqual(["undo", "redo", "fullscreen"]);
    expect(el.shadowRoot.querySelector(".ws-name").title).toBe(form.name);
  });

  it("keeps the side-by-side panels on a wide window", async () => {
    getDefinition.mockResolvedValue(JSON.stringify(form));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect(el.shadowRoot.querySelector(".ws").className).not.toContain("ws-compact");
    expect(el.shadowRoot.querySelector(".ws-props c-jform-properties")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".ws-drawer-bar")).toBeNull();
  });
});


describe("c-jform-workspace: trying the form", () => {
  it("has no Preview button: the form is tried in the Design & preview tab", async () => {
    getDefinition.mockResolvedValue(JSON.stringify({ ...legacy, settings: {}, targetObjectApiName: null }));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    expect([...el.shadowRoot.querySelectorAll("lightning-button")].map((b) => b.label)).not.toContain("Preview");
    expect([...el.shadowRoot.querySelectorAll(".ws-tab, [role='tab']")].map((t) => t.textContent.trim()).join(" ")).toContain("Design & preview");
  });
});

describe("c-jform-workspace: the Payment block", () => {
  const withPayment = (payments) => ({
    id: FORM_ID,
    name: "Workshop",
    revision: 1,
    settings: { payments },
    sections: [{ key: "p1", name: "Page 1", fields: [
      { key: "email", type: "email", label: "Email" },
      { key: "payment", type: "payment", label: "Payment", config: { pricing: "fixed", amount: 45 } }
    ] }]
  });
  const open = async (def) => {
    getDefinition.mockResolvedValue(JSON.stringify(def));
    const el = mount();
    const toasts = [];
    el.addEventListener("lightning__showtoast", (e) => toasts.push(e.detail));
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    return { el, toasts };
  };

  it("keeps one Payment block per form: a second one selects the first", async () => {
    const { el, toasts } = await open(withPayment({ mode: "test" }));
    const canvas = el.shadowRoot.querySelector("c-jform-canvas");
    canvas.dispatchEvent(new CustomEvent("insert", { detail: { sectionIndex: 0, index: 0, type: "payment" } }));
    await tick();
    expect(toasts[0]).toMatchObject({ title: "One per form", message: "This form already has a Payment block." });
    expect(canvas.selection).toMatchObject({ kind: "field", sectionIndex: 0, fieldIndex: 1 });

    canvas.dispatchEvent(new CustomEvent("duplicatefield", { detail: { sectionIndex: 0, fieldIndex: 1 } }));
    await tick();
    expect(toasts[1]).toMatchObject({ title: "One per form", message: "A form can have one Payment block." });
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    expect(saveDefinition).not.toHaveBeenCalled();
  });

  it("adds a Payment block with a fixed price to a form without one", async () => {
    const { el, toasts } = await open({ ...withPayment({}), sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }] }] });
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("insert", { detail: { sectionIndex: 0, index: 1, type: "payment" } }));
    await tick();
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    expect(toasts).toHaveLength(0);
    const sent = JSON.parse(saveDefinition.mock.calls[saveDefinition.mock.calls.length - 1][0].definitionJson);
    expect(sent.sections[0].fields[1]).toMatchObject({ type: "payment", config: { pricing: "fixed", amount: 10 } });
  });

  it("says in the publish dialog whether this version takes live payments", async () => {
    const brand = (el) => [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.variant === "brand" && /^Publish/.test(b.label));
    let { el } = await open(withPayment({ mode: "live", currency: "USD" }));
    brand(el).click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-publish-live").textContent).toBe("This version takes live payments. Real cards will be charged.");
    document.body.removeChild(el);

    // a sandbox or scratch org takes test payments from a form set to live, so the dialog says so, not "real cards"
    getPaymentStatus.mockResolvedValue({ sandbox: true });
    ({ el } = await open(withPayment({ mode: "live", currency: "USD" })));
    brand(el).click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-publish-live")).toBeNull();
    expect(el.shadowRoot.querySelector(".ws-publish-pay").textContent).toBe(
      "This version is set to live payments, but this org is a sandbox or scratch org, so it takes test payments: respondents see a test banner and no money is charged."
    );
    document.body.removeChild(el);

    ({ el } = await open(withPayment({ mode: "test" })));
    brand(el).click();
    await tick();
    expect(el.shadowRoot.querySelector(".ws-publish-live")).toBeNull();
    expect(el.shadowRoot.querySelector(".ws-publish-pay").textContent).toContain("test payments");
  });
});

describe("c-jform-workspace: the Name field", () => {
  const CONTACT_FIELDS = [
    { label: "Salutation", value: "Salutation" },
    { label: "First Name", value: "FirstName" },
    { label: "Last Name", value: "LastName" },
    { label: "Email", value: "Email" }
  ];
  const contactForm = (fields, stepFields = [], rule) => ({
    id: FORM_ID,
    name: "Sign-up",
    revision: 1,
    settings: { automation: { steps: [{ key: "record", action: "create", object: "Contact", primary: true, fields: stepFields }] } },
    sections: [{ key: "p1", name: "Page 1", fields: [...fields, { key: "notes", type: "comment", label: "Notes", ...(rule ? { conditionalLogic: rule } : {}) }] }]
  });
  const nameField = () => ({
    key: "name",
    type: "name",
    label: "Name",
    config: { layout: "inline", parts: { firstName: {}, lastName: {} } }
  });
  const open = async (def) => {
    getObjectFields.mockResolvedValue(CONTACT_FIELDS);
    getDefinition.mockResolvedValue(JSON.stringify(def));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    return el;
  };
  const saved = async () => {
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    return JSON.parse(saveDefinition.mock.calls[saveDefinition.mock.calls.length - 1][0].definitionJson);
  };
  const patchSelected = async (el, patch) => {
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("select", { detail: { kind: "field", sectionIndex: 0, fieldIndex: 0 } }));
    await tick();
    el.shadowRoot.querySelector("c-jform-properties").dispatchEvent(new CustomEvent("fieldchange", { detail: { patch } }));
    await tick();
  };

  it("adds a Name field that saves its first and last name to the Contact straight away", async () => {
    const el = await open(contactForm([{ key: "email", type: "email", label: "Email" }], [{ field: "Email", source: { type: "field", key: "email" } }]));
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("insert", { detail: { sectionIndex: 0, index: 0, type: "name" } }));
    await tick();
    const sent = await saved();
    expect(sent.sections[0].fields[0]).toMatchObject({ key: "name", type: "name", label: "Name", config: { layout: "inline" } });
    expect(sent.sections[0].fields[0].options).toBeUndefined();
    expect(sent.settings.automation.steps[0].fields).toEqual([
      { field: "Email", source: { type: "field", key: "email" } },
      { field: "FirstName", source: { type: "field", key: "name.firstName" } },
      { field: "LastName", source: { type: "field", key: "name.lastName" } }
    ]); // Salutation is never mapped
  });

  it("maps several parts at once from Saves to", async () => {
    const el = await open(contactForm([nameField()], [{ field: "LastName", source: { type: "field", key: "name.lastName" } }]));
    el.shadowRoot.querySelector("c-jform-properties").dispatchEvent(new CustomEvent("mappingchange", { detail: { object: "Contact", mappings: [
      { fieldKey: "name.firstName", objectField: "FirstName" },
      { fieldKey: "name.lastName", objectField: "LastName" }
    ] } }));
    await tick();
    const sent = await saved();
    expect(sent.settings.automation.steps[0].fields).toEqual([
      { field: "FirstName", source: { type: "field", key: "name.firstName" } },
      { field: "LastName", source: { type: "field", key: "name.lastName" } }
    ]);
  });

  it("drops every part's references when the field becomes another type", async () => {
    const rule = { action: "show", match: "all", conditions: [{ field: "name.lastName", operator: "is_not_empty" }] };
    const el = await open(contactForm([nameField()], [{ field: "LastName", source: { type: "field", key: "name.lastName" } }], rule));
    await patchSelected(el, { type: "text" });
    const sent = await saved();
    expect(sent.sections[0].fields[0].type).toBe("text");
    expect(sent.sections[0].fields[0].options).toBeUndefined();
    expect(sent.settings.automation.steps[0].fields).toEqual([]);
    expect(sent.sections[0].fields[1].conditionalLogic).toBeUndefined();
  });

  it("drops the Other text's references when the field stops offering Other, and keeps rules on the choice", async () => {
    const industry = { key: "industry", type: "radio", label: "Industry", options: [{ label: "Retail", value: "Retail" }], config: { other: {} } };
    const rule = { action: "show", match: "any", conditions: [{ field: "industry.other", operator: "is_not_empty" }, { field: "industry", operator: "equals", value: "Other" }] };
    const el = await open(contactForm([industry], [{ field: "Description", source: { type: "field", key: "industry.other" } }], rule));
    await patchSelected(el, { config: undefined });
    const sent = await saved();
    expect(sent.sections[0].fields[0].config).toBeUndefined();
    expect(sent.settings.automation.steps[0].fields).toEqual([]);
    expect(sent.sections[0].fields[1].conditionalLogic.conditions).toEqual([{ field: "industry", operator: "equals", value: "Other" }]);
  });

  it("clears the payment page's Email field when that field stops being an Email field", async () => {
    const def = contactForm([{ key: "billing", type: "email", label: "Billing email" }]);
    def.settings.payments = { currency: "EUR", emailField: "billing" };
    const el = await open(def);
    await patchSelected(el, { label: "Billing address" });
    let sent = await saved();
    expect(sent.settings.payments).toEqual({ currency: "EUR", emailField: "billing" });
    await patchSelected(el, { type: "text" });
    sent = await saved();
    expect(sent.settings.payments).toEqual({ currency: "EUR" });
  });

  it("clears it too when the key and the type change in one edit", async () => {
    const def = contactForm([{ key: "billing", type: "email", label: "Billing email" }]);
    def.settings.payments = { emailField: "billing" };
    const el = await open(def);
    await patchSelected(el, { key: "contact", type: "text" });
    const sent = await saved();
    expect(sent.settings.payments).toEqual({});
  });
});

describe("c-jform-workspace: a new Address field's default country", () => {
  // the Jest locale is en-US, so a new Address field starts in the US
  const WITH_US = { fromOrg: true, countries: [{ code: "AU", name: "Australia", states: [] }, { code: "US", name: "United States", states: [] }] };
  const WITHOUT_US = { fromOrg: true, countries: [{ code: "AU", name: "Australia", states: [] }] };
  const NOTES = { key: "notes", type: "text", label: "Notes" };
  const form = (fields) => ({
    id: FORM_ID,
    name: "Delivery",
    revision: 1,
    settings: { automation: { steps: [] } },
    sections: [{ key: "p1", name: "Page 1", fields }]
  });
  const open = async (lists, fields = [NOTES]) => {
    loadAddressLists.mockImplementation(() => lists);
    getDefinition.mockResolvedValue(JSON.stringify(form(fields)));
    const el = mount();
    CurrentPageReference.emit({ state: { c__formid: FORM_ID } });
    await tick();
    return el;
  };
  const insertAddress = async (el) => {
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("insert", { detail: { sectionIndex: 0, index: 0, type: "address" } }));
    await tick();
  };
  const saved = async () => {
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    return JSON.parse(saveDefinition.mock.calls[saveDefinition.mock.calls.length - 1][0].definitionJson);
  };

  afterEach(() => {
    loadAddressLists.mockClear();
    loadAddressLists.mockImplementation(() => new Promise(() => {}));
  });

  it("keeps the builder's country when the org lists it", async () => {
    const el = await open(Promise.resolve(WITH_US));
    await insertAddress(el);
    const sent = await saved();
    expect(sent.sections[0].fields[0]).toMatchObject({ type: "address", config: { defaultCountry: "US", detectCountry: true } });
  });

  it("starts with no default when the org doesn't list the builder's country", async () => {
    const el = await open(Promise.resolve(WITHOUT_US));
    await insertAddress(el);
    const sent = await saved();
    expect(sent.sections[0].fields[0].type).toBe("address");
    expect(sent.sections[0].fields[0].config.defaultCountry).toBeUndefined();
    expect(sent.sections[0].fields[0].config.detectCountry).toBe(true);
  });

  it("does the same when another field becomes an Address field", async () => {
    const el = await open(Promise.resolve(WITHOUT_US));
    el.shadowRoot.querySelector("c-jform-canvas").dispatchEvent(new CustomEvent("select", { detail: { kind: "field", sectionIndex: 0, fieldIndex: 0 } }));
    await tick();
    el.shadowRoot.querySelector("c-jform-properties").dispatchEvent(new CustomEvent("fieldchange", { detail: { patch: { type: "address" } } }));
    await tick();
    const sent = await saved();
    expect(sent.sections[0].fields[0].type).toBe("address");
    expect(sent.sections[0].fields[0].config.defaultCountry).toBeUndefined();
  });

  it("drops the default when the lists arrive after the field was added", async () => {
    let arrive;
    const el = await open(new Promise((r) => (arrive = r)));
    await insertAddress(el);
    arrive(WITHOUT_US);
    await tick();
    const sent = await saved();
    expect(sent.sections[0].fields[0].config.defaultCountry).toBeUndefined();
  });

  it("reads the lists only once the form has an Address field", async () => {
    const el = await open(Promise.resolve(WITH_US));
    expect(loadAddressLists).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector("c-jform-canvas").addressLists).toBeNull();
    await insertAddress(el);
    await tick();
    expect(loadAddressLists).toHaveBeenCalled();
    expect(el.shadowRoot.querySelector("c-jform-canvas").addressLists).toEqual(WITH_US);
  });

  it("hands its lists to the canvas, properties, Logic and Design tabs, which no longer read their own", async () => {
    const el = await open(Promise.resolve(WITH_US), [NOTES, { key: "address", type: "address", label: "Address" }]);
    await tick();
    expect(loadAddressLists).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot.querySelector("c-jform-canvas").addressLists).toEqual(WITH_US);
    expect(el.shadowRoot.querySelector("c-jform-properties").addressLists).toEqual(WITH_US);
    el.shadowRoot.querySelector('button[data-tab="logic"]').click();
    await tick();
    expect(el.shadowRoot.querySelector("c-jform-logic-tab").addressLists).toEqual(WITH_US);
    el.shadowRoot.querySelector('button[data-tab="design"]').click();
    await tick();
    expect(el.shadowRoot.querySelector("c-jform-design-tab").addressLists).toEqual(WITH_US);
    expect(loadAddressLists).toHaveBeenCalledTimes(1);
  });

  it("leaves a default the builder chose before the lists arrived", async () => {
    let arrive;
    const el = await open(new Promise((r) => (arrive = r)));
    await insertAddress(el);
    el.shadowRoot.querySelector("c-jform-properties").dispatchEvent(new CustomEvent("fieldchange", { detail: { patch: { config: { defaultCountry: "NZ", detectCountry: true } } } }));
    await tick();
    arrive(WITHOUT_US);
    await tick();
    const sent = await saved();
    expect(sent.sections[0].fields[0].config.defaultCountry).toBe("NZ");
  });
});
