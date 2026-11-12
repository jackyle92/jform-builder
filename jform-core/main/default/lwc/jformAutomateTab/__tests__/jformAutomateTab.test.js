import { createElement } from "lwc";
import JformAutomateTab, { encodeSource, decodeSource } from "c/jformAutomateTab";
import getObjectFields from "@salesforce/apex/JFormWorkspaceController.getObjectFields";
import getFlows from "@salesforce/apex/JFormWorkspaceController.getFlows";
import getFlowDetails from "@salesforce/apex/JFormWorkspaceController.getFlowDetails";

jest.mock("@salesforce/apex/JFormWorkspaceController.getObjectFields", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getFlows", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getFlowDetails", () => ({ default: jest.fn() }), { virtual: true });

/** A flow as getFlowDetails returns it: variables sorted by name, like the server. */
const variable = (name, dataType, io, typeLabel, extra = {}) => ({
  name, dataType, typeLabel, isInput: io.includes("in"), isOutput: io.includes("out"), isCollection: false,
  supported: io.includes("in") && dataType !== "SObject", ...extra
});
const WELCOME = {
  apiName: "Welcome_Pack", label: "Welcome pack", description: "Sends the welcome pack.", versionId: "301000000000001AAA",
  variables: [
    variable("contactId", "String", "in", "Text"),
    variable("contactRecord", "SObject", "in", "a Contact record", { objectType: "Contact" }),
    variable("email", "String", "in", "Text"),
    variable("ticket", "String", "out", "Text"),
    variable("vip", "Boolean", "in", "True/false")
  ]
};

const FIELDS = {
  contact: [{ label: "First Name", value: "FirstName", type: "string" }, { label: "Last Name", value: "LastName", type: "string", required: true }, { label: "Email", value: "Email", type: "email" }, { label: "Account ID", value: "AccountId", type: "reference", referenceTo: ["Account"] }],
  case: [{ label: "Subject", value: "Subject", type: "string" }, { label: "Description", value: "Description", type: "textarea" }, { label: "Priority", value: "Priority", type: "picklist" }, { label: "Case Origin", value: "Origin", type: "picklist" }, { label: "Contact ID", value: "ContactId", type: "reference", referenceTo: ["Contact"] }, { label: "Account ID", value: "AccountId", type: "reference", referenceTo: ["Account"] }],
  account: [{ label: "Account Name", value: "Name", type: "string", required: true }],
  task: [{ label: "Subject", value: "Subject", type: "string" }, { label: "Name ID", value: "WhoId", type: "reference", referenceTo: ["Contact", "Lead"] }, { label: "Related To ID", value: "WhatId", type: "reference", referenceTo: ["Case", "Account"] }, { label: "Priority", value: "Priority", type: "picklist" }, { label: "Status", value: "Status", type: "picklist" }],
  lead: [{ label: "Last Name", value: "LastName", type: "string", required: true }, { label: "Company", value: "Company", type: "string", required: true }, { label: "Email", value: "Email", type: "email" }]
};
const definition = {
  name: "Support",
  targetObjectApiName: "Lead",
  settings: { target: { strategy: "update_or_create", matchField: "Email" } },
  sections: [{ key: "p1", name: "Page 1", fields: [
    { key: "first_name", type: "text", label: "First name" }, { key: "last_name", type: "text", label: "Last name", targetFieldApiName: "LastName" },
    { key: "email", type: "email", label: "Email", targetFieldApiName: "Email" }, { key: "company", type: "text", label: "Company" },
    { key: "subject", type: "text", label: "Subject" }, { key: "description", type: "comment", label: "Describe the problem" },
    { key: "priority", type: "picklist", label: "Priority", options: [{ label: "Low" }, { label: "Urgent" }] }
  ] }]
};
const targetObjects = [{ label: "Contact", value: "Contact" }, { label: "Case", value: "Case" }, { label: "Account", value: "Account" }, { label: "Task", value: "Task" }, { label: "Lead", value: "Lead" }];

function mount(def = definition, { canUseFlows = true } = {}) {
  getObjectFields.mockImplementation(({ objectApiName }) => Promise.resolve(FIELDS[String(objectApiName).toLowerCase()] || []));
  getFlows.mockResolvedValue({ canUseFlows, flows: canUseFlows ? [{ apiName: "Welcome_Pack", label: "Welcome pack" }] : [] });
  getFlowDetails.mockImplementation(({ flowApiName }) => (flowApiName === "Welcome_Pack" ? Promise.resolve(WELCOME) : Promise.reject(new Error("not a flow"))));
  const el = createElement("c-jform-automate-tab", { is: JformAutomateTab });
  el.definition = def;
  el.targetObjects = targetObjects;
  document.body.appendChild(el);
  return el;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const byLabel = (el, tag, prefix) => $$(el, tag).find((b) => String(b.label || "").startsWith(prefix));
const byAlt = (el, text) => $$(el, "lightning-button-icon").find((b) => b.alternativeText === text);
const withSteps = (steps) => ({ ...definition, settings: { ...definition.settings, automation: { steps } } });
const lastPatch = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
const rows = (el) => $$(el, ".at-map:not(.at-map-head)");

const TWO_STEPS = [
  { key: "contact", label: "Find or create the contact", action: "find_or_create", object: "Contact", match: { field: "Email", source: { type: "field", key: "email" } }, fields: [{ field: "LastName", source: { type: "field", key: "last_name" } }, { field: "Email", source: { type: "field", key: "email" } }] },
  { key: "case", label: "Create the case", action: "create", object: "Case", primary: true, condition: { match: "all", conditions: [{ field: "priority", operator: "equals", value: "Urgent" }] }, fields: [{ field: "Subject", source: { type: "value", value: "{{subject}}" } }, { field: "ContactId", source: { type: "step", step: "contact", path: "Id" } }] }
];

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  jest.clearAllMocks();
});

describe("c-jform-automate-tab sources", () => {
  it("encodes and decodes every source type for the value picker", () => {
    for (const src of [{ type: "field", key: "email" }, { type: "step", step: "contact", path: "AccountId" }, { type: "submission", path: "submittedAt" }]) {
      expect(decodeSource(encodeSource(src))).toEqual(src);
    }
    expect(encodeSource({ type: "step", step: "contact" })).toBe("step:contact:Id");
    expect(encodeSource({ type: "value", value: "Hi" })).toBe("value:");
    expect(decodeSource("value:")).toEqual({ type: "value", value: "" });
  });
});

describe("c-jform-automate-tab empty form", () => {
  it("shows the preset gallery and an empty flow, and applies a preset", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    expect($(el, ".at-gallery")).not.toBeNull();
    expect($$(el, ".at-preset").length).toBeGreaterThan(5);
    expect(byLabel(el, "lightning-button", "Convert the Lead")).toBeTruthy();
    expect($$(el, ".at-node-edge")).toHaveLength(2);
    expect($$(el, ".at-plus")).toHaveLength(1);
    expect($(el, ".at-guide")).not.toBeNull();

    $(el, '.at-preset[data-id="support_case"]').click();
    const patch = lastPatch(handler);
    const steps = patch.settings.automation.steps;
    expect(steps.map((s) => s.object)).toEqual(["Account", "Contact", "Case", "Task"]);
    expect(steps[2].primary).toBe(true);
    expect(patch.targetObjectApiName).toBe("Case");
    expect(patch.settings.target).toBeUndefined();
  });

  it("converts the legacy target into one step", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    byLabel(el, "lightning-button", "Convert the Lead").click();
    await flush();
    await flush();
    const [step] = lastPatch(handler).settings.automation.steps;
    expect(step).toMatchObject({ action: "find_or_create", object: "Lead", primary: true, match: { field: "Email", source: { type: "field", key: "email" } } });
    expect(step.fields).toHaveLength(2);
  });
});

describe("c-jform-automate-tab canvas", () => {
  it("draws steps between the trigger and the end, with gates, the main record and summaries", async () => {
    const el = mount(withSteps(TWO_STEPS));
    await flush();
    await flush();
    expect($(el, ".at-gallery")).toBeNull();
    const cards = $$(el, ".at-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".at-card-title").textContent).toContain("Find or create Contact");
    expect(cards[0].querySelector(".at-card-label").textContent).toBe("Find or create the contact");
    expect(cards[1].querySelector(".at-pill-primary")).not.toBeNull();
    expect(cards[1].querySelector(".at-summary").textContent).toBe("2 fields · uses Contact from 1");
    expect($$(el, ".at-gate").map((g) => g.textContent.trim())).toEqual(["Only when Priority is Urgent"]);
    expect($$(el, ".at-plus").map((p) => p.dataset.index)).toEqual(["0", "1", "2"]);
    expect($$(el, ".at-node-edge")[1].textContent).toContain("The Case from step 2 is the main record");
  });

  it("selects a step to edit it and closes the editor again", async () => {
    const el = mount(withSteps(TWO_STEPS));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    await flush();
    $$(el, ".at-card")[0].click();
    await flush();
    await flush();
    expect($$(el, ".at-card")[0].classList.contains("at-card-on")).toBe(true);
    expect($(el, ".at-ed-kicker").textContent).toBe("Step 1");
    expect($(el, ".at-ed-title").textContent).toBe("Find or create Contact");
    expect(rows(el)).toHaveLength(2);
    expect($(el, ".at-warn")).toBeNull();

    $(el, "lightning-combobox[data-prop='action']").dispatchEvent(new CustomEvent("change", { detail: { value: "create" } }));
    const updated = lastPatch(handler).settings.automation.steps;
    expect(updated[0].action).toBe("create");
    expect(updated[1]).toEqual(TWO_STEPS[1]);

    byAlt(el, "Close the step editor").click();
    await flush();
    expect($(el, ".at-guide")).not.toBeNull();
  });

  it("clicking a gate opens the step it guards", async () => {
    const el = mount(withSteps(TWO_STEPS));
    await flush();
    $(el, ".at-gate").click();
    await flush();
    expect($(el, ".at-ed-title").textContent).toBe("Create Case");
  });

  it("adds a step at any point from the + menu, keeping later links valid", async () => {
    const el = mount(withSteps(TWO_STEPS));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    $(el, '.at-plus[data-index="0"]').click();
    await flush();
    expect($(el, ".at-insert")).not.toBeNull();
    expect($$(el, ".at-insert-option").map((o) => o.dataset.action)).toEqual(["create", "find_or_create", "find", "update", "flow"]);
    $(el, '.at-insert-option[data-action="find"]').click();
    const steps = lastPatch(handler).settings.automation.steps;
    expect(steps.map((s) => s.key)).toEqual(["step", "contact", "case"]);
    expect(steps[0]).toMatchObject({ action: "find", object: "Contact", match: { field: "Email", source: { type: "field", key: "email" } }, fields: [] });
    expect(steps[2].fields[1].source).toEqual({ type: "step", step: "contact", path: "Id" });
    await flush();
    expect($(el, ".at-insert")).toBeNull();
  });

  it("Add step opens the menu at the end, and the menu can be cancelled", async () => {
    const el = mount(withSteps(TWO_STEPS));
    await flush();
    byLabel(el, "lightning-button", "Add step").click();
    await flush();
    const links = $$(el, ".at-link");
    expect(links[links.length - 1].querySelector(".at-insert")).not.toBeNull();
    byAlt(el, "Cancel").click();
    await flush();
    expect($(el, ".at-insert")).toBeNull();
  });

  it("flags problems on the canvas: unmapped required fields and removed questions", async () => {
    const steps = [
      { key: "account", label: "Account", action: "create", object: "Account", fields: [{ field: "Name", source: { type: "field", key: "company" } }] },
      { key: "contact", label: "Contact", action: "create", object: "Contact", fields: [{ field: "AccountId", source: { type: "step", step: "account", path: "Id" } }] },
      { key: "task", label: "Task", action: "create", object: "Task", fields: [{ field: "Subject", source: { type: "field", key: "gone" } }] }
    ];
    const el = mount(withSteps(steps));
    await flush();
    await flush();
    const cards = $$(el, ".at-card");
    expect(cards[0].querySelector(".at-issue")).toBeNull();
    expect(cards[1].querySelector(".at-issue").textContent).toBe("Required, not mapped: Last Name");
    expect(cards[1].classList.contains("at-card-issue")).toBe(true);
    expect(cards[2].querySelector(".at-issue").textContent).toBe("Uses a question that was removed");

    cards[1].click();
    await flush();
    await flush();
    expect($(el, ".at-warn").textContent).toBe("Required on Contact and not mapped: Last Name");
    const picker = $(el, "c-jform-value-picker");
    expect(picker.value).toBe("step:account:Id");
    expect(picker.options.filter((o) => o.group === "Earlier steps")).toEqual([{ group: "Earlier steps", label: "Account from step 1", value: "step:account:Id", detail: "Record Id" }]);
  });

  it("sets a field from the value picker, a fixed value, and back", async () => {
    const el = mount(withSteps(TWO_STEPS));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    $$(el, ".at-card")[1].click();
    await flush();
    await flush();
    // Subject is a fixed value: a text box with a button back to the picker
    const text = $(el, ".at-fixed lightning-input");
    expect(text.value).toBe("{{subject}}");
    text.value = "Case: {{subject}}";
    text.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler).settings.automation.steps[1].fields[0].source).toEqual({ type: "value", value: "Case: {{subject}}" });
    byAlt(el, "Pick an answer instead").click();
    expect(lastPatch(handler).settings.automation.steps[1].fields[0].source).toEqual({ type: "field", key: "first_name" });

    const picker = $(el, "c-jform-value-picker");
    expect(picker.options.map((o) => o.group)).toEqual(expect.arrayContaining(["Form answers", "Earlier steps", "Submission", "Other"]));
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "submission:submittedAt" } }));
    expect(lastPatch(handler).settings.automation.steps[1].fields[1].source).toEqual({ type: "submission", path: "submittedAt" });
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "value:" } }));
    expect(lastPatch(handler).settings.automation.steps[1].fields[1].source).toEqual({ type: "value", value: "" });
    // no Payment block: none of the payment values
    expect(picker.options.some((o) => o.group === "Payment")).toBe(false);
  });

  it("offers the payment values, the promotion code among them, on a form with a Payment block", async () => {
    const def = {
      ...definition,
      sections: [{ ...definition.sections[0], fields: [...definition.sections[0].fields, { key: "pay", type: "payment", label: "Payment", config: { pricing: "fixed", amount: 45 } }] }],
      settings: { ...definition.settings, automation: { steps: TWO_STEPS } }
    };
    const el = mount(def);
    await flush();
    $$(el, ".at-card")[1].click();
    await flush();
    await flush();
    const picker = $(el, "c-jform-value-picker");
    const payment = picker.options.filter((o) => o.group === "Payment");
    expect(payment.map((o) => o.label)).toEqual(["Payment status", "Payment amount", "Payment currency", "Payment reference (Stripe)", "Promotion code", "Discount amount"]);
    expect(payment[4].value).toBe("submission:promotionCode");
  });

  it("deleting a step clears links to it, moving keeps links valid, duplicating adds a copy below", async () => {
    const steps = [
      { key: "contact", label: "Contact", action: "create", object: "Contact", primary: true, fields: [{ field: "LastName", source: { type: "field", key: "last_name" } }] },
      { key: "case", label: "Case", action: "create", object: "Case", fields: [{ field: "ContactId", source: { type: "step", step: "contact", path: "Id" } }] }
    ];
    const el = mount(withSteps(steps));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    $(el, "lightning-button-icon[data-dir='1']").click();
    const moved = handler.mock.calls[0][0].detail.patch.settings.automation.steps;
    expect(moved.map((s) => s.key)).toEqual(["case", "contact"]);
    expect(moved[0].fields[0].source).toEqual({ type: "value", value: "" });

    byAlt(el, "Delete step").click();
    const afterDelete = handler.mock.calls[1][0].detail.patch.settings.automation.steps;
    expect(afterDelete.map((s) => s.key)).toEqual(["case"]);
    expect(afterDelete[0].fields[0].source).toEqual({ type: "value", value: "" });

    byAlt(el, "Duplicate step").click();
    const afterCopy = handler.mock.calls[2][0].detail.patch.settings.automation.steps;
    expect(afterCopy.map((s) => s.key)).toEqual(["contact", "contact_copy", "case"]);
    expect(afterCopy[1]).toMatchObject({ label: "Contact (copy)", primary: false, object: "Contact" });
  });

  it("asks before a preset replaces existing steps", async () => {
    const el = mount(withSteps(TWO_STEPS));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    byLabel(el, "lightning-button", "Presets").click();
    await flush();
    $(el, '.at-preset[data-id="lead_capture"]').click();
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect($(el, ".at-confirm").textContent).toContain('Replace the 2 current steps with "Lead capture"?');
    byLabel(el, "lightning-button", "Cancel").click();
    await flush();
    expect($(el, ".at-confirm")).toBeNull();

    $(el, '.at-preset[data-id="lead_capture"]').click();
    await flush();
    byLabel(el, "lightning-button", "Replace").click();
    expect(lastPatch(handler).settings.automation.steps[0].object).toBe("Lead");
    await flush();
    expect($(el, ".at-gallery")).toBeNull();
  });

  it("explains the main record in the editor when no step is marked", async () => {
    const steps = TWO_STEPS.map((s) => ({ ...s, primary: false }));
    const el = mount(withSteps(steps));
    await flush();
    expect($$(el, ".at-card")[0].querySelector(".at-pill-primary")).not.toBeNull();
    $$(el, ".at-card")[0].click();
    await flush();
    expect($(el, ".at-ed-row").textContent).toContain("Used as the main record because no step is marked");
  });
});

describe("c-jform-automate-tab flow steps", () => {
  const CONTACT = { key: "contact", label: "", action: "find_or_create", object: "Contact", match: { field: "Email", source: { type: "field", key: "email" } }, fields: [{ field: "LastName", source: { type: "field", key: "last_name" } }] };
  const FLOW = {
    key: "welcome", label: "", action: "flow", flow: "Welcome_Pack", flowLabel: "Welcome pack",
    fields: [{ field: "contactId", type: "String", source: { type: "step", step: "contact", path: "Id" } }, { field: "email", type: "String", source: { type: "field", key: "email" } }],
    outputs: [{ name: "ticket", type: "String" }]
  };
  const TASK = { key: "task", label: "", action: "create", object: "Task", fields: [{ field: "Subject", source: { type: "step", step: "welcome", path: "ticket" } }] };
  const settle = async () => {
    await flush();
    await flush();
  };

  it("adds a flow from the + menu with inputs matched to answers and earlier records", async () => {
    const el = mount(withSteps([CONTACT]));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await settle();
    $(el, '.at-plus[data-index="1"]').click();
    await flush();
    const flowOption = $(el, '.at-insert-option[data-action="flow"]');
    expect(flowOption.disabled).toBe(false);
    flowOption.click();
    await flush();
    expect($(el, ".at-insert-title").textContent).toBe("Run a flow");
    const picker = $(el, ".at-insert c-jform-value-picker");
    expect(picker.options).toEqual([{ label: "Welcome pack", value: "Welcome_Pack", detail: "Welcome_Pack" }]);
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "Welcome_Pack" } }));
    await settle();
    const steps = lastPatch(handler).settings.automation.steps;
    expect(steps[1]).toEqual({
      key: "flow", label: "", action: "flow", flow: "Welcome_Pack", flowLabel: "Welcome pack",
      fields: [{ field: "contactId", type: "String", source: { type: "step", step: "contact", path: "Id" } }, { field: "email", type: "String", source: { type: "field", key: "email" } }],
      outputs: [{ name: "ticket", type: "String" }]
    });
    expect(lastPatch(handler).targetObjectApiName).toBe("Contact");
  });

  it("draws the flow on the canvas and lets later steps use its outputs", async () => {
    const el = mount(withSteps([CONTACT, FLOW, TASK]));
    await settle();
    const cards = $$(el, ".at-card");
    expect(cards[0].querySelector(".at-pill-primary")).not.toBeNull();
    expect(cards[1].querySelector(".at-card-title").textContent).toContain("Run Welcome pack");
    expect(cards[1].querySelector(".at-summary").textContent).toBe("2 inputs · 1 output · uses Contact from 1");
    expect(cards[1].querySelector(".at-issue")).toBeNull();
    expect(cards[2].querySelector(".at-summary").textContent).toBe("1 field · uses Welcome pack from 2");

    cards[2].click();
    await settle();
    const picker = $(el, "c-jform-value-picker");
    expect(picker.value).toBe("step:welcome:ticket");
    expect(picker.options).toEqual(expect.arrayContaining([{ group: "Earlier steps", label: "Welcome pack (step 2) › ticket", value: "step:welcome:ticket", detail: "Text" }]));
  });

  it("edits a flow's inputs in its own editor", async () => {
    const el = mount(withSteps([CONTACT, FLOW, TASK]));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await settle();
    $$(el, ".at-card")[1].click();
    await settle();
    expect($(el, ".at-ed-title").textContent).toBe("Run Welcome pack");
    expect($$(el, ".at-flow-input .at-var-name").map((n) => n.textContent)).toEqual(["contactId", "email", "vip"]);
    expect($(el, ".at-editor").textContent).toContain("Not filled by forms yet: contactRecord (a Contact record).");
    expect($$(el, ".at-output .at-var-name").map((n) => n.textContent)).toEqual(["ticket"]);
    expect($(el, ".at-ed-row")).toBeNull();
    expect($(el, "a.at-link-out").getAttribute("href")).toBe("/builder_platform_interaction/flowBuilder.app?flowId=301000000000001AAA");
    expect($(el, 'c-jform-value-picker[data-name="vip"]').value).toBe("none:");

    $(el, 'c-jform-value-picker[data-name="vip"]').dispatchEvent(new CustomEvent("change", { detail: { value: "field:priority" } }));
    expect(lastPatch(handler).settings.automation.steps[1].fields.map((m) => [m.field, m.type])).toEqual([["contactId", "String"], ["email", "String"], ["vip", "Boolean"]]);
    $(el, 'c-jform-value-picker[data-name="email"]').dispatchEvent(new CustomEvent("change", { detail: { value: "none:" } }));
    expect(lastPatch(handler).settings.automation.steps[1].fields.map((m) => m.field)).toEqual(["contactId"]);
  });

  it("keeps the flow locked for builders without Manage Flow", async () => {
    const el = mount(withSteps([CONTACT, FLOW]), { canUseFlows: false });
    await settle();
    $(el, '.at-plus[data-index="2"]').click();
    await flush();
    const flowOption = $(el, '.at-insert-option[data-action="flow"]');
    expect(flowOption.disabled).toBe(true);
    expect(flowOption.textContent).toContain("Needs the Manage Flow permission");
    $$(el, ".at-card")[1].click();
    await settle();
    expect($(el, ".at-editor .at-warn").textContent).toContain("Only people with the Manage Flow permission");
    expect($(el, 'c-jform-value-picker[data-name="email"]').disabled).toBe(true);
  });

  it("flags a flow whose outputs changed and refreshes the step from it", async () => {
    const stale = { ...FLOW, fields: [{ field: "email", type: "Number", source: { type: "field", key: "email" } }], outputs: [{ name: "oldTicket", type: "String" }] };
    const el = mount(withSteps([CONTACT, stale]));
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await settle();
    expect($$(el, ".at-card")[1].querySelector(".at-issue").textContent).toBe("The flow changed: open the step and refresh it");
    $$(el, ".at-card")[1].click();
    await settle();
    $(el, '[data-action="refresh-flow"]').click();
    await settle();
    const step = lastPatch(handler).settings.automation.steps[1];
    expect(step.fields).toEqual([{ field: "email", type: "String", source: { type: "field", key: "email" } }]);
    expect(step.outputs).toEqual([{ name: "ticket", type: "String" }]);
  });

  it("flags a flow that is no longer active, and a form that only runs flows has no main record", async () => {
    const gone = { ...FLOW, key: "gone", flow: "Gone_Flow", flowLabel: "Gone flow", fields: [] };
    const el = mount(withSteps([gone]));
    await settle();
    expect($(el, ".at-card .at-issue").textContent).toBe("This flow is no longer an active autolaunched flow");
    expect($$(el, ".at-node-edge")[1].textContent).toContain("No step saves a record");
    $(el, ".at-card").click();
    await settle();
    expect($(el, ".at-editor").textContent).toContain("This flow is no longer an active autolaunched flow. Activate it again");
  });
});

