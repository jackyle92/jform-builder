import { createElement } from "lwc";
import JformProperties from "c/jformProperties";
import getObjectFields from "@salesforce/apex/JFormWorkspaceController.getObjectFields";
import createPublicLink from "@salesforce/apex/JFormImageService.createPublicLink";
import getPaymentStatus from "@salesforce/apex/JFormWorkspaceController.getPaymentStatus";

jest.mock("@salesforce/apex/JFormWorkspaceController.getObjectFields", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormImageService.createPublicLink", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getPaymentStatus", () => ({ default: jest.fn() }), { virtual: true });

const LEAD_FIELDS = [{ label: "Last Name", value: "LastName", type: "string", required: true }, { label: "Email", value: "Email", type: "email" }, { label: "Company", value: "Company", type: "string", required: true }];
const baseDefinition = {
  name: "Form",
  settings: {},
  sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }, { key: "last", type: "text", label: "Last name" }] }]
};
const targetObjects = [{ label: "Lead", value: "Lead" }, { label: "Contact", value: "Contact" }];

function mount(definition, objectFields = LEAD_FIELDS) {
  getObjectFields.mockResolvedValue(objectFields);
  const el = createElement("c-jform-properties", { is: JformProperties });
  el.definition = definition;
  el.targetObjects = targetObjects;
  el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 0 };
  document.body.appendChild(el);
  return el;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Group titles in order: a folding section's label, or a plain group heading. */
const groupTitles = (el) => [...el.shadowRoot.querySelectorAll(".pp-group, c-jform-property-section")].map((g) => g.label ?? g.textContent);

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  jest.clearAllMocks();
});

describe("c-jform-properties mapping shortcut", () => {
  it("asks for an object first when the form has no steps, then emits the mapping", async () => {
    const el = mount(baseDefinition);
    const handler = jest.fn();
    el.addEventListener("mappingchange", handler);
    await flush();
    const combos = () => [...el.shadowRoot.querySelectorAll("lightning-combobox")];
    const objectPick = el.shadowRoot.querySelector("c-jform-object-picker");
    expect(objectPick.label).toBe("Object");
    expect(objectPick.disabled).toBe(false);
    expect(combos().find((c) => c.label === "Field").disabled).toBe(true);

    objectPick.dispatchEvent(new CustomEvent("change", { detail: { value: "lead" } }));
    await flush();
    await flush();
    const fieldPick = combos().find((c) => c.label === "Field");
    expect(fieldPick.disabled).toBe(false);
    fieldPick.dispatchEvent(new CustomEvent("change", { detail: { value: "Email" } }));
    expect(handler.mock.calls[0][0].detail).toEqual({ fieldKey: "email", object: "Lead", objectField: "Email" });
  });

  it("shows the main step's object locked and the current mapping", async () => {
    const def = { ...baseDefinition, targetObjectApiName: "Lead", settings: { automation: { steps: [{ key: "record", action: "find_or_create", object: "Lead", primary: true, match: { field: "Email", source: { type: "field", key: "email" } }, fields: [{ field: "Email", source: { type: "field", key: "email" } }] }] } } };
    const el = mount(def);
    await flush();
    await flush();
    const combos = [...el.shadowRoot.querySelectorAll("lightning-combobox")];
    expect(el.shadowRoot.querySelector("c-jform-object-picker").disabled).toBe(true);
    expect(combos.find((c) => c.label === "Field").value).toBe("Email");
    expect(el.shadowRoot.textContent).toContain("Saved to Lead by step 1");
  });
});

describe("c-jform-properties rich text editing", () => {
  const richDefinition = {
    name: "Form",
    settings: {},
    sections: [{ key: "p1", name: "Page 1", fields: [{ key: "intro", type: "richtext", label: "Intro", richtext: "<p>Hello&nbsp;there</p>" }, { key: "last", type: "text", label: "Last name" }] }]
  };
  const editor = (el) => el.shadowRoot.querySelector("c-jform-rich-editor");

  it("hands the rich editor the stored text and patches the field with what it emits", async () => {
    const el = mount(richDefinition);
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(editor(el).value).toBe("<p>Hello&nbsp;there</p>");
    expect(editor(el).mode).toBe("visual");
    editor(el).dispatchEvent(new CustomEvent("change", { detail: { value: "<p><strong>Hello</strong>&nbsp;there, friends</p>" } }));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ richtext: "<p><strong>Hello</strong>&nbsp;there, friends</p>" });
  });

  it("remembers that a block is edited as HTML on the field", async () => {
    const el = mount(richDefinition);
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    editor(el).dispatchEvent(new CustomEvent("modechange", { detail: { mode: "html" } }));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ config: { editor: "html" } });
    el.definition = { ...richDefinition, sections: [{ ...richDefinition.sections[0], fields: [{ ...richDefinition.sections[0].fields[0], config: { editor: "html" } }, richDefinition.sections[0].fields[1]] }] };
    await flush();
    expect(editor(el).mode).toBe("html");
    editor(el).dispatchEvent(new CustomEvent("modechange", { detail: { mode: "visual" } }));
    expect(handler.mock.calls[1][0].detail.patch).toEqual({ config: undefined });
  });

  it("shows the editor only for rich text fields", async () => {
    const el = mount(richDefinition);
    await flush();
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 1 };
    await flush();
    expect(editor(el)).toBeNull();
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 0 };
    await flush();
    expect(editor(el).value).toBe("<p>Hello&nbsp;there</p>");
  });
});

describe("c-jform-properties date and time options", () => {
  const withPickers = {
    ...baseDefinition,
    sections: [{ key: "p1", name: "Page 1", fields: [
      { key: "visit", type: "date", label: "Visit date", config: { disabledDays: [0, 6] } },
      { key: "slot", type: "time", label: "Arrival" }
    ] }]
  };
  const group = (el, title) => groupTitles(el).includes(title);

  it("shows the date options and writes limits and weekdays into the field config", async () => {
    const el = mount(withPickers);
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(group(el, "Date options")).toBe(true);
    expect(group(el, "Validation")).toBe(false);
    const days = el.shadowRoot.querySelector("lightning-checkbox-group");
    expect(days.value).toEqual(["1", "2", "3", "4", "5"]); // Sat and Sun are off

    const noPast = [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === "No past dates");
    noPast.checked = true;
    noPast.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ config: { disabledDays: [0, 6], noPast: true } });

    days.dispatchEvent(new CustomEvent("change", { detail: { value: ["1", "2", "3", "4", "5", "6", "0"] } }));
    expect(handler.mock.calls[1][0].detail.patch).toEqual({ config: undefined }); // every day allowed: nothing to store

    const latest = [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === "Latest date");
    latest.value = "2026-12-31";
    latest.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[2][0].detail.patch).toEqual({ config: { disabledDays: [0, 6], maxDate: "2026-12-31" } });
  });

  it("shows the time options and stores only what differs from the defaults", async () => {
    const el = mount(withPickers);
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 1 };
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(group(el, "Time options")).toBe(true);
    const combos = [...el.shadowRoot.querySelectorAll("lightning-combobox")];
    const step = combos.find((c) => c.label === "Times every");
    expect(step.value).toBe("15");
    step.dispatchEvent(new CustomEvent("change", { detail: { value: "30" } }));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ config: { step: 30 } });
    combos.find((c) => c.label === "Clock").dispatchEvent(new CustomEvent("change", { detail: { value: "24" } }));
    expect(handler.mock.calls[1][0].detail.patch).toEqual({ config: { hourFormat: "24" } });
    step.dispatchEvent(new CustomEvent("change", { detail: { value: "15" } }));
    expect(handler.mock.calls[2][0].detail.patch).toEqual({ config: undefined });
  });
});

describe("c-jform-properties width control", () => {
  it("shows the width as a segmented control and patches the field on click", async () => {
    const el = mount({ ...baseDefinition, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email", width: 50 }] }] });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const buttons = [...el.shadowRoot.querySelectorAll(".pr-seg-btn")].filter((b) => b.textContent.endsWith("%")); // the width buttons, not rows
    expect(buttons.map((b) => b.textContent)).toEqual(["25%", "50%", "75%", "100%"]);
    expect(buttons[1].getAttribute("aria-checked")).toBe("true");
    expect(buttons[1].className).toContain("pr-seg-on");
    buttons[3].click();
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ width: 100 });
  });
});

describe("c-jform-properties layout, image and event", () => {
  function mountField(field) {
    return mount({ id: "a0X000000000001", name: "Form", settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });
  }
  const groups = (el) => groupTitles(el);
  const lastPatch = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
  const inputByLabel = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-input, lightning-textarea")].find((i) => i.label === label);

  it("gives every shown field a Layout group with width and rows; rows go to config.rowSpan", async () => {
    const el = mountField({ key: "a", type: "text", label: "A", width: 50 });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(groups(el)).toContain("Layout");
    el.shadowRoot.querySelector('button[role="radio"][data-value="2"]').click();
    expect(lastPatch(handler)).toEqual({ config: { rowSpan: 2 } });
  });

  it("goes back to one row by dropping the setting", async () => {
    const el = mountField({ key: "a", type: "text", label: "A", config: { rowSpan: 3 } });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(el.shadowRoot.querySelector('button[role="radio"][data-value="3"]').getAttribute("aria-checked")).toBe("true");
    el.shadowRoot.querySelector('button[role="radio"][data-value="1"]').click();
    expect(lastPatch(handler)).toEqual({ config: undefined });
  });

  it("has no Layout group for a divider or a hidden field", async () => {
    let el = mountField({ key: "d", type: "divider" });
    await flush();
    expect(groups(el)).not.toContain("Layout");
    document.body.removeChild(el);
    el = mountField({ key: "h", type: "hidden", label: "H" });
    await flush();
    expect(groups(el)).not.toContain("Layout");
  });

  it("turns an uploaded image into a public link and sets fit, with a builder name and a caption", async () => {
    createPublicLink.mockResolvedValue({ url: "https://org.file.force.com/sfc/dist/version/download/?ids=1" });
    const el = mountField({ key: "img", type: "image", label: "Image", config: { fit: "cover", height: "medium" } });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(groups(el)).toEqual(expect.arrayContaining(["General", "Layout", "Image"]));
    expect(inputByLabel(el, "Name (shown only in the builder)")).toBeTruthy();
    expect(inputByLabel(el, "Caption")).toBeTruthy();
    el.shadowRoot.querySelector("lightning-file-upload").dispatchEvent(new CustomEvent("uploadfinished", { detail: { files: [{ documentId: "069000000000001" }] } }));
    await flush();
    expect(createPublicLink).toHaveBeenCalledWith({ contentDocumentId: "069000000000001" });
    expect(lastPatch(handler).config.url).toBe("https://org.file.force.com/sfc/dist/version/download/?ids=1");
    el.shadowRoot.querySelector('button[data-prop="fit"][data-value="contain"]').click();
    expect(lastPatch(handler).config).toMatchObject({ fit: "contain", height: "medium" });
  });

  it("edits the event: title, HH:MM times and the calendar links switch", async () => {
    const el = mountField({ key: "ev", type: "event", label: "Event title", config: { date: "2026-11-15" } });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(inputByLabel(el, "Event title")).toBeTruthy();
    expect(inputByLabel(el, "Help text")).toBeFalsy();
    const start = inputByLabel(el, "Starts");
    start.value = "09:30:00.000";
    start.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler).config).toEqual({ date: "2026-11-15", startTime: "09:30" });
    const links = inputByLabel(el, "Add to calendar links");
    expect(links.checked).toBe(true);
    links.checked = false;
    links.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler).config).toEqual({ date: "2026-11-15", hideCalendar: true });
  });
});

describe("c-jform-properties signature", () => {
  function mountField(field) {
    return mount({ id: "a0X000000000001", name: "Form", settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });
  }
  const groups = (el) => groupTitles(el);
  const lastPatch = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
  const inputByLabel = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-input, lightning-textarea")].find((i) => i.label === label);

  it("edits the statement and pad height, with no record field mapping or default value", async () => {
    const el = mountField({ key: "sig", type: "signature", label: "Signature" });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(groups(el)).toEqual(expect.arrayContaining(["General", "Layout", "Signature", "Logic"]));
    expect(groups(el)).not.toContain("Saves to");
    expect(inputByLabel(el, "Default value")).toBeFalsy();
    const statement = inputByLabel(el, "Statement (shown under the pad)");
    statement.value = "I confirm the above.";
    statement.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler)).toEqual({ config: { statement: "I confirm the above." } });
    el.shadowRoot.querySelector('button[data-prop="height"][data-value="large"]').click();
    expect(lastPatch(handler).config).toMatchObject({ height: "large" });
  });

  it("keeps typing and record files on unless switched off, storing only false", async () => {
    const el = mountField({ key: "sig", type: "signature", label: "Signature", config: { attachToRecord: false } });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const typing = inputByLabel(el, "Let people type their name");
    const toRecord = inputByLabel(el, "Add to the created record");
    expect(typing.checked).toBe(true);
    expect(toRecord.checked).toBe(false);
    typing.checked = false;
    typing.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler)).toEqual({ config: { attachToRecord: false, allowTyped: false } });
    toRecord.checked = true;
    toRecord.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler)).toEqual({ config: undefined });
  });
});

describe("c-jform-properties table", () => {
  function mountField(field) {
    return mount({ id: "a0X000000000001", name: "Form", settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });
  }
  const groups = (el) => groupTitles(el);
  const lastPatch = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
  const inputByLabel = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-input, lightning-textarea, lightning-combobox")].find((i) => i.label === label);
  const buttonByLabel = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === label);
  const table = () => ({
    key: "satisfaction",
    type: "table",
    label: "How satisfied were you with",
    options: [{ label: "Poor", value: "Poor" }],
    config: { rows: [{ key: "service", label: "Service" }, { key: "price", label: "Price" }] }
  });

  it("edits rows and columns, with no record field mapping and no width setting", async () => {
    const el = mountField(table());
    await flush();
    expect(groups(el)).toEqual(expect.arrayContaining(["General", "Rows", "Columns", "Logic"]));
    expect(groups(el)).not.toContain("Saves to");
    expect(groups(el)).not.toContain("Layout");
    expect([...el.shadowRoot.querySelectorAll(".pp-table-row lightning-input")].map((i) => i.value)).toEqual(["Service", "Price"]);
    expect(buttonByLabel(el, "Add column")).toBeTruthy();
  });

  it("renames a row without changing its key", async () => {
    const el = mountField(table());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const first = el.shadowRoot.querySelector('.pp-table-row lightning-input[data-index="0"]');
    first.value = "Customer service";
    first.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler).config.rows).toEqual([{ key: "service", label: "Customer service" }, { key: "price", label: "Price" }]);
  });

  it("adds rows one at a time or pasted one per line, with keys made from the labels", async () => {
    const el = mountField(table());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    buttonByLabel(el, "Add row").click();
    expect(lastPatch(handler).config.rows[2]).toEqual({ key: "row_3", label: "Row 3" });

    const paste = inputByLabel(el, "Add several rows, one per line");
    paste.value = "Speed\n\n  Ease of use \nPrice";
    paste.dispatchEvent(new CustomEvent("change"));
    buttonByLabel(el, "Add these rows").click();
    expect(lastPatch(handler).config.rows.slice(2)).toEqual([
      { key: "speed", label: "Speed" },
      { key: "ease_of_use", label: "Ease of use" },
      { key: "price_2", label: "Price" }
    ]);
  });

  it("removes and moves rows, keeping at least one", async () => {
    const el = mountField(table());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const rowButton = (index, text) =>
      [...el.shadowRoot.querySelectorAll(`.pp-table-row lightning-button-icon[data-index="${index}"]`)].find((b) => b.alternativeText === text);
    rowButton(1, "Move up").click();
    expect(lastPatch(handler).config.rows.map((r) => r.key)).toEqual(["price", "service"]);
    rowButton(0, "Remove").click();
    expect(lastPatch(handler).config.rows.map((r) => r.key)).toEqual(["price"]);
  });

  it("switches to several answers per row, and stores only false for every row", async () => {
    const el = mountField(table());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    el.shadowRoot.querySelector('button[data-value="several"]').click();
    expect(lastPatch(handler).config.multiple).toBe(true);
    const everyRow = inputByLabel(el, "Every row must be answered");
    expect(everyRow.checked).toBe(true);
    everyRow.checked = false;
    everyRow.dispatchEvent(new CustomEvent("change"));
    expect(lastPatch(handler).config.everyRow).toBe(false);
  });

  it("replaces the columns with a scale, the words as values", async () => {
    const el = mountField(table());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    inputByLabel(el, "Use a scale").dispatchEvent(new CustomEvent("change", { detail: { value: "agreement" } }));
    expect(lastPatch(handler).options).toEqual(
      ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"].map((c) => ({ label: c, value: c }))
    );
  });

  it("stops adding columns at ten", async () => {
    const field = table();
    field.options = Array.from({ length: 10 }, (_, i) => ({ label: `C${i}`, value: `C${i}` }));
    const el = mountField(field);
    await flush();
    expect(buttonByLabel(el, "Add column").disabled).toBe(true);
  });
});

describe("c-jform-properties phone options", () => {
  const phoneDefinition = (config) => ({
    name: "Form",
    settings: {},
    sections: [{ key: "p1", name: "Page 1", fields: [{ key: "mobile", type: "phone", label: "Mobile", ...(config ? { config } : {}) }] }]
  });
  const toggle = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === label);

  it("turns the picker on in the builder's country and hides format and length rules", async () => {
    const el = mount(phoneDefinition());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(toggle(el, "Country code picker").checked).toBe(false);
    expect(toggle(el, "Min length")).toBeDefined();
    const picker = toggle(el, "Country code picker");
    picker.checked = true;
    picker.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ config: { countryPicker: true, defaultCountry: "US", detectCountry: true } });
  });

  it("edits the default country and the checks, and turns everything off together", async () => {
    const el = mount(phoneDefinition({ countryPicker: true, defaultCountry: "AU", detectCountry: true }));
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(toggle(el, "Min length")).toBeUndefined();
    const country = el.shadowRoot.querySelector("c-jform-value-picker");
    expect(country.value).toBe("AU");
    expect(country.options.find((o) => o.value === "VN")).toEqual({ label: "Vietnam", value: "VN", detail: "+84" });
    country.dispatchEvent(new CustomEvent("change", { detail: { value: "VN" } }));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ config: { countryPicker: true, defaultCountry: "VN", detectCountry: true } });
    const mobile = toggle(el, "Mobile numbers only");
    mobile.checked = true;
    mobile.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[1][0].detail.patch.config.mobileOnly).toBe(true);
    const picker = toggle(el, "Country code picker");
    picker.checked = false;
    picker.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[2][0].detail.patch).toEqual({ config: undefined });
  });
});

describe("c-jform-properties field type", () => {
  const typeBox = (el) => [...el.shadowRoot.querySelectorAll("lightning-combobox")].find((c) => c.label === "Field type");
  const withField = (field) => ({ ...baseDefinition, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });

  it("offers Checkboxes but not the retired Multi-select for new choices", async () => {
    const el = mount(withField({ key: "diet", type: "checkboxes", label: "Diet", options: [{ label: "Vegan", value: "Vegan" }] }));
    await flush();
    const values = typeBox(el).options.map((o) => o.value);
    expect(values).toContain("checkboxes");
    expect(values).not.toContain("multiselect");
  });

  it("still shows Multi-select on a field that has it, so it can be switched", async () => {
    const el = mount(withField({ key: "diet", type: "multiselect", label: "Diet", options: [{ label: "Vegan", value: "Vegan" }] }));
    await flush();
    const box = typeBox(el);
    expect(box.value).toBe("multiselect");
    expect(box.options.map((o) => o.value)).toEqual(expect.arrayContaining(["multiselect", "checkboxes"]));
  });
});

describe("c-jform-properties options per row", () => {
  const radio = { key: "status", type: "radio", label: "Status", options: [{ label: "New", value: "New" }] };
  const mountOne = (field, theme) => mount({ ...baseDefinition, theme, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });
  const selected = (el) => el.shadowRoot.querySelector('button[data-prop="optionColumns"][aria-checked="true"]')?.dataset.value;

  it("starts from the form design and saves the field's own choice", async () => {
    const el = mountOne(radio, { choiceStyle: "cards" });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(selected(el)).toBe("auto");
    el.shadowRoot.querySelector('button[data-prop="optionColumns"][data-value="2"]').click();
    expect(handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch.config).toMatchObject({ optionColumns: "2" });
  });

  it("shows one per row for a list design and the saved value when there is one", async () => {
    let el = mountOne(radio, { choiceStyle: "list" });
    await flush();
    expect(selected(el)).toBe("1");
    document.body.removeChild(el);
    el = mountOne({ ...radio, type: "checkboxes", config: { optionColumns: "3" } }, { choiceStyle: "list" });
    await flush();
    expect(selected(el)).toBe("3");
  });

  it("is not offered for a dropdown", async () => {
    const el = mountOne({ ...radio, type: "picklist" });
    await flush();
    expect(el.shadowRoot.querySelector('button[data-prop="optionColumns"]')).toBeNull();
  });
});

describe("c-jform-properties welcome and thank-you screens", () => {
  function mountScreen(kind, settings = {}, extra = {}) {
    const el = createElement("c-jform-properties", { is: JformProperties });
    el.definition = { ...baseDefinition, id: "a00000000000001AAA", welcomeMessage: "<p>Hi</p>", settings, ...extra };
    el.targetObjects = targetObjects;
    el.selection = { kind };
    document.body.appendChild(el);
    return el;
  }
  const last = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
  const input = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === label);

  it("switches how the form opens and keeps the other settings", async () => {
    const el = mountScreen("welcome", { buttons: { submit: "Send" } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    expect(el.shadowRoot.querySelector(".pp-title").textContent).toBe("Welcome screen");
    expect(el.shadowRoot.querySelector('button[aria-checked="true"]').dataset.value).toBe("message"); // an existing message stays above the form
    el.shadowRoot.querySelector('button[data-value="screen"]').click();
    expect(last(handler)).toEqual({ settings: { buttons: { submit: "Send" }, welcome: { mode: "screen" } } });
  });

  it("edits the start screen and only saves a valid time and image", async () => {
    const el = mountScreen("welcome", { welcome: { mode: "screen", showTime: true } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    input(el, "Start button").dispatchEvent(new CustomEvent("change", { detail: { value: "Begin" } }));
    expect(last(handler).settings.welcome).toEqual({ mode: "screen", showTime: true, buttonLabel: "Begin" });
    const header = input(el, "Show the title, description and logo on form pages");
    expect(header.checked).toBe(false); // the start screen shows them; the questions start straight away
    header.checked = true;
    header.dispatchEvent(new CustomEvent("change"));
    expect(last(handler).settings.welcome.showHeader).toBe(true);

    const calls = handler.mock.calls.length;
    input(el, "Minutes").dispatchEvent(new CustomEvent("change", { detail: { value: "500" } }));
    input(el, "Image link").dispatchEvent(new CustomEvent("change", { detail: { value: "https://cdn" } }));
    input(el, "Image link").dispatchEvent(new CustomEvent("change", { detail: { value: "htp:/x" } }));
    await flush();
    expect(handler.mock.calls.length).toBe(calls + 1); // the partial https link is valid; 500 minutes and "htp:/x" are not saved
    expect(el.shadowRoot.querySelector(".pp-warn").textContent).toContain("https://");
    input(el, "Minutes").dispatchEvent(new CustomEvent("change", { detail: { value: "4" } }));
    expect(last(handler).settings.welcome.minutes).toBe(4);
  });

  it("adds a thank-you button only once it has a label and a link, and removes it", async () => {
    const el = mountScreen("ending");
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Add a button").click();
    await flush();
    input(el, "Label").dispatchEvent(new CustomEvent("change", { detail: { value: "Home" } }));
    input(el, "Link").dispatchEvent(new CustomEvent("change", { detail: { value: "example.com" } }));
    await flush();
    const add = () => [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Add button");
    expect(add().disabled).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    input(el, "Link").dispatchEvent(new CustomEvent("change", { detail: { value: "https://example.com" } }));
    await flush();
    add().click();
    expect(last(handler)).toEqual({ settings: { ending: { buttons: [{ label: "Home", url: "https://example.com" }] } } });

    el.definition = { ...el.definition, settings: last(handler).settings };
    await flush();
    el.shadowRoot.querySelector('lightning-button-icon[data-index="0"]').click();
    expect(last(handler)).toEqual({ settings: {} });
  });

  it("turns the redirect on with a valid link and off again", async () => {
    const el = mountScreen("ending", { ending: { submitAnother: true } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    const toggle = () => input(el, "Send people to another page");
    toggle().checked = true;
    toggle().dispatchEvent(new CustomEvent("change"));
    await flush();
    expect(handler).not.toHaveBeenCalled(); // nothing to save until there is a link
    input(el, "Link").dispatchEvent(new CustomEvent("change", { detail: { value: "https://example.com/next" } }));
    expect(last(handler).settings.ending).toEqual({ submitAnother: true, redirectUrl: "https://example.com/next" });

    el.definition = { ...el.definition, settings: last(handler).settings };
    await flush();
    el.shadowRoot.querySelector('button[data-value="5"]').click();
    expect(last(handler).settings.ending.redirectDelay).toBe(5);
    toggle().checked = false;
    toggle().dispatchEvent(new CustomEvent("change"));
    expect(last(handler).settings.ending).toEqual({ submitAnother: true });
  });

  it("patches the screen's message and remembers the HTML editor mode", async () => {
    const el = mountScreen("ending", {}, { thankYouMessage: "<p>Thanks</p>" });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    const editor = el.shadowRoot.querySelector('c-jform-rich-editor[data-prop="thankYouMessage"]');
    editor.dispatchEvent(new CustomEvent("change", { detail: { value: "<p>See you</p>" } }));
    expect(last(handler)).toEqual({ thankYouMessage: "<p>See you</p>" });
    editor.dispatchEvent(new CustomEvent("modechange", { detail: { mode: "html" } }));
    expect(last(handler)).toEqual({ settings: { editors: { thankYouMessage: "html" } } });
  });
});

describe("c-jform-properties Payment block", () => {
  const paymentForm = {
    name: "Workshop",
    settings: { payments: { mode: "test", currency: "USD" } },
    sections: [
      {
        key: "p1",
        name: "Page 1",
        fields: [
          { key: "pay", type: "payment", label: "Payment", config: { pricing: "fixed", amount: 45 } },
          { key: "email", type: "email", label: "Email" }
        ]
      }
    ]
  };

  it("reads the gateways' state only when a Payment block is selected", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const [pay, email] = paymentForm.sections[0].fields;
    const el = mount({ ...paymentForm, sections: [{ ...paymentForm.sections[0], fields: [email, pay] }] }); // the Email field selected
    await flush();
    expect(getPaymentStatus).not.toHaveBeenCalled();
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 1 };
    await flush();
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 0 };
    await flush();
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 1 };
    await flush();
    expect(getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(groupTitles(el)).toContain("Gateway");
  });

  it("chooses the form's gateway and has no Saves to group", async () => {
    // read when the panel first shows a Payment block, so a secret saved on the Setup tab shows the next time the Build tab is opened
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount(paymentForm);
    await flush();
    expect(getPaymentStatus).toHaveBeenCalledTimes(1);
    const groups = groupTitles(el);
    expect(groups).toContain("Gateway");
    expect(groups).not.toContain("Saves to");
    expect(el.shadowRoot.querySelector("c-jform-object-picker")).toBeNull();

    const picker = el.shadowRoot.querySelector("c-jform-gateway-picker");
    expect(picker.variant).toBe("row");
    expect(picker.value).toBe("stripe");
    expect(picker.options[0].states.map((s) => s.text)).toEqual(["Test: ready", "Live: not set up"]);

    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "stripe" } }));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ settings: { payments: { mode: "test", currency: "USD", gateway: "stripe" } } });

    const goTab = jest.fn();
    el.addEventListener("gotab", goTab);
    [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Open Payments settings").click();
    expect(goTab.mock.calls[0][0].detail).toEqual({ tab: "settings", section: "payments" });
  });

  it("says who defines the promotion codes, without editing it here", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const text = (def) => {
      const el = mount(def);
      return [...el.shadowRoot.querySelectorAll(".pp-muted")].map((p) => p.textContent).find((t) => t.startsWith("Promotion codes:"));
    };
    expect(text(paymentForm)).toBe("Promotion codes: none");
    expect(text({ ...paymentForm, settings: { payments: { codes: "jform" } } })).toBe("Promotion codes: codes defined in JForm");
    expect(text({ ...paymentForm, settings: { payments: { codes: "gateway" } } })).toBe("Promotion codes: codes defined in Stripe");
    const custom = { ...paymentForm, settings: { payments: { codes: "jform" } }, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "pay", type: "payment", label: "Payment", config: { pricing: "custom" } }] }] };
    expect(text(custom)).toBe('Promotion codes: none ("pay what you want" takes no codes)');
  });
});

describe("c-jform-properties name", () => {
  const nameField = () => ({
    key: "name",
    type: "name",
    label: "Name",
    config: {
      layout: "inline",
      parts: { firstName: { label: "First name", maxLength: 40 }, lastName: { label: "Last name", maxLength: 80 } }
    }
  });
  function mountField(field, settings = {}) {
    return mount({ id: "a0X000000000001", name: "Form", settings, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });
  }
  const groups = (el) => groupTitles(el);
  const lastPatch = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
  const partInput = (el, part, prop) => el.shadowRoot.querySelector(`.pp-name-part [data-part="${part}"][data-prop="${prop}"]`);

  it("sets the layout, and edits each part without a field-level default value, salutation or order", async () => {
    const el = mountField(nameField());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(groups(el)).toEqual(expect.arrayContaining(["General", "Name parts", "Saves to", "Logic"]));
    expect(groups(el)).not.toContain("Salutations");
    expect(groups(el)).not.toContain("Choices");
    expect(el.shadowRoot.querySelector('button[data-prop="order"]')).toBeNull();
    expect([...el.shadowRoot.querySelectorAll("lightning-input")].some((i) => i.type === "toggle" && i.label === "Salutation")).toBe(false);
    expect([...el.shadowRoot.querySelectorAll(".pp-name-part .pp-subgroup")].map((h) => h.textContent)).toEqual(["First name", "Last name"]);
    expect([...el.shadowRoot.querySelectorAll("lightning-input")].filter((i) => i.label === "Default value" && !i.dataset.part)).toHaveLength(0);

    el.shadowRoot.querySelector('button[data-prop="layout"][data-value="stacked"]').click();
    expect(lastPatch(handler).config.layout).toBe("stacked");

    const label = partInput(el, "lastName", "label");
    label.value = "Surname";
    label.dispatchEvent(new CustomEvent("change", { detail: { value: "Surname" } }));
    expect(lastPatch(handler).config.parts.lastName).toEqual({ label: "Surname", maxLength: 80 });

    const max = partInput(el, "firstName", "maxLength");
    max.dispatchEvent(new CustomEvent("change", { detail: { value: "999" } }));
    expect(lastPatch(handler).config.parts.firstName.maxLength).toBe(255);
    max.dispatchEvent(new CustomEvent("change", { detail: { value: "" } }));
    expect(lastPatch(handler).config.parts.firstName).toEqual({ label: "First name" }); // back to the default length
  });

  it("maps every part to a Contact's name fields as soon as Contact is chosen", async () => {
    const el = mountField(nameField());
    const handler = jest.fn();
    el.addEventListener("mappingchange", handler);
    await flush();
    el.shadowRoot.querySelector("c-jform-object-picker").dispatchEvent(new CustomEvent("change", { detail: { value: "contact" } }));
    expect(handler.mock.calls[0][0].detail).toEqual({
      object: "Contact",
      mappings: [
        { fieldKey: "name.firstName", objectField: "FirstName" },
        { fieldKey: "name.lastName", objectField: "LastName" }
      ]
    });
  });

  it("shows and changes each part's mapping on the main step", async () => {
    const steps = [{ key: "record", action: "create", object: "Lead", primary: true, fields: [{ field: "LastName", source: { type: "field", key: "name.lastName" } }] }];
    const el = mountField(nameField(), { automation: { steps } });
    const handler = jest.fn();
    el.addEventListener("mappingchange", handler);
    await flush();
    await flush();
    const combos = [...el.shadowRoot.querySelectorAll("lightning-combobox[data-key]")];
    expect(combos.map((c) => [c.label, c.value])).toEqual([["First name", ""], ["Last name", "LastName"]]);
    expect(el.shadowRoot.textContent).toContain("Each part is saved to Lead by step 1 on its own");
    combos[0].dispatchEvent(new CustomEvent("change", { detail: { value: "Company" } }));
    expect(handler.mock.calls[0][0].detail).toEqual({ fieldKey: "name.firstName", object: "Lead", objectField: "Company" });
  });
});

describe("c-jform-properties address purpose", () => {
  const part = (address, prefix, p, suffix) => ({ label: `${prefix} ${suffix}`, value: `${prefix}${suffix}`, type: "string", addressName: address, addressLabel: `${prefix} Address`, addressPart: p });
  const ACCOUNT_FIELDS = ["Billing", "Shipping"].flatMap((prefix) => [
    part(`${prefix}Address`, prefix, "street", "Street"),
    part(`${prefix}Address`, prefix, "city", "City"),
    part(`${prefix}Address`, prefix, "state", "State"),
    part(`${prefix}Address`, prefix, "postalCode", "PostalCode"),
    part(`${prefix}Address`, prefix, "country", "Country")
  ]);
  const onAddress = (prefix) => ["street", "city", "state", "postalCode", "country"].map((p) => ({ field: `${prefix}${p === "postalCode" ? "PostalCode" : p[0].toUpperCase() + p.slice(1)}`, source: { type: "field", key: `addr.${p}` } }));
  const accountForm = (fields) => ({
    name: "Form",
    targetObjectApiName: "Account",
    settings: { automation: { steps: [{ key: "record", action: "create", object: "Account", primary: true, fields }] } },
    sections: [{ key: "p1", name: "Page 1", fields: [{ key: "addr", type: "address", label: "Address", config: {} }] }]
  });
  const mountAccount = async (fields) => {
    const el = mount(accountForm(fields), ACCOUNT_FIELDS);
    const mappings = jest.fn();
    const changes = jest.fn();
    el.addEventListener("mappingchange", mappings);
    el.addEventListener("fieldchange", changes);
    await flush();
    await flush();
    return { el, mappings, changes };
  };
  const choose = async (el, purpose) => {
    el.shadowRoot.querySelector(`button[data-value="${purpose}"]`).click();
    await flush();
    await flush();
  };

  it("moves a field on the old purpose's address to the new purpose's", async () => {
    const { el, mappings, changes } = await mountAccount(onAddress("Billing"));
    await choose(el, "shipping");
    expect(mappings).toHaveBeenCalledTimes(1);
    const sent = Object.fromEntries(mappings.mock.calls[0][0].detail.mappings.map((m) => [m.fieldKey, m.objectField]));
    expect(sent).toMatchObject({ "addr.street": "ShippingStreet", "addr.city": "ShippingCity", "addr.postalCode": "ShippingPostalCode" });
    expect(mappings.mock.calls[0][0].detail.object).toBe("Account");
    // the label still follows the purpose
    expect(changes.mock.calls.some((c) => JSON.stringify(c[0].detail).includes("Shipping address"))).toBe(true);
  });

  it("leaves an address the builder chose in Saves to", async () => {
    const { el, mappings } = await mountAccount(onAddress("Shipping"));
    await choose(el, "billing");
    expect(mappings).not.toHaveBeenCalled();
  });

  it("leaves a field that is not mapped", async () => {
    const { el, mappings } = await mountAccount([]);
    await choose(el, "shipping");
    expect(mappings).not.toHaveBeenCalled();
  });});

describe("c-jform-properties choosing the object for an Address field", () => {
  const part = (prefix, p, suffix) => ({ label: `${prefix} ${suffix}`, value: `${prefix}${suffix}`, type: "string", addressName: `${prefix}Address`, addressLabel: `${prefix} Address`, addressPart: p });
  const ACCOUNT_FIELDS = ["Billing", "Shipping"].flatMap((prefix) => [part(prefix, "street", "Street"), part(prefix, "city", "City")]);
  const twoAddresses = {
    name: "Form",
    settings: {},
    sections: [{ key: "p1", name: "Page 1", fields: [
      { key: "home", type: "address", label: "Home", config: {} },
      { key: "work", type: "address", label: "Work", config: {} },
      { key: "notes", type: "text", label: "Notes" }
    ] }]
  };
  /** Mounted on Home with the object's fields held back until `arrive` is called. */
  const mountHeld = async () => {
    const el = mount(twoAddresses);
    let arrive;
    getObjectFields.mockImplementation(() => new Promise((r) => (arrive = () => r(ACCOUNT_FIELDS))));
    const mappings = jest.fn();
    el.addEventListener("mappingchange", mappings);
    await flush();
    el.shadowRoot.querySelector("c-jform-object-picker").dispatchEvent(new CustomEvent("change", { detail: { value: "account" } }));
    await flush();
    return { el, mappings, arrive: async () => { arrive(); await flush(); await flush(); } };
  };
  const mappedKeys = (mappings) => mappings.mock.calls.flatMap((c) => c[0].detail.mappings.filter((m) => m.objectField).map((m) => `${m.fieldKey}=${m.objectField}`));

  it("maps the field the object was chosen for when another Address field is selected meanwhile", async () => {
    const { el, mappings, arrive } = await mountHeld();
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 1 };
    await flush();
    await arrive();
    expect(mappings).toHaveBeenCalledTimes(1);
    expect(mappedKeys(mappings)).toEqual(["home.street=BillingStreet", "home.city=BillingCity"]);
  });

  it("still maps it when a field that is not an address is selected meanwhile", async () => {
    const { el, mappings, arrive } = await mountHeld();
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 2 };
    await flush();
    await arrive();
    expect(mappedKeys(mappings)).toEqual(["home.street=BillingStreet", "home.city=BillingCity"]);
  });
});

describe("c-jform-properties Offer every country", () => {
  const LISTS = { fromOrg: true, countries: [{ code: "AU", name: "Australia", states: [] }, { code: "NZ", name: "New Zealand", states: [] }] };
  const withAddress = (config) => ({ name: "Form", settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "home", type: "address", label: "Home", config }] }] });
  const toggle = (el) => [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === "Offer every country");
  const switchOff = (el) => {
    const t = toggle(el);
    t.checked = false;
    t.dispatchEvent(new CustomEvent("change"));
  };
  /** Mounted before the workspace has the lists. */
  const mountWithout = async (config) => {
    const el = mount(withAddress(config));
    const changes = jest.fn();
    el.addEventListener("fieldchange", changes);
    await flush();
    return { el, changes };
  };
  const sentCountries = (changes) => changes.mock.calls.map((c) => c[0].detail.patch.config?.countries);

  it("waits for the lists when there is no default country to start from", async () => {
    const { el, changes } = await mountWithout({});
    expect(toggle(el).checked).toBe(true);
    expect(toggle(el).disabled).toBe(true);
    switchOff(el);
    expect(changes).not.toHaveBeenCalled();

    el.addressLists = LISTS;
    await flush();
    expect(toggle(el).disabled).toBe(false);
    switchOff(el);
    expect(sentCountries(changes)).toEqual([["AU"]]);
  });

  it("starts from the default country, even before the lists arrive", async () => {
    const { el, changes } = await mountWithout({ defaultCountry: "NZ" });
    expect(toggle(el).disabled).toBe(false);
    switchOff(el);
    expect(sentCountries(changes)).toEqual([["NZ"]]);
  });
});

describe("c-jform-properties sections", () => {
  afterEach(() => window.localStorage.removeItem("jform.propertySections"));
  const address = { name: "Form", settings: {}, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "home", type: "address", label: "Home", config: {} }] }] };
  const sections = (el) => [...el.shadowRoot.querySelectorAll("c-jform-property-section")];
  const section = (el, id) => el.shadowRoot.querySelector(`c-jform-property-section[data-sec="${id}"]`);
  const head = (el, id) => section(el, id).shadowRoot.querySelector(".pp-sec-head");
  const body = (el, id) => section(el, id).shadowRoot.querySelector(".pp-sec-body");
  const open = (el) => sections(el).filter((s) => s.shadowRoot.querySelector(".pp-sec-head").getAttribute("aria-expanded") === "true").map((s) => s.dataset.sec);

  it("keeps the basics open and folds the rest, each folded one with a summary", async () => {
    const el = mount(address);
    await flush();
    expect(sections(el).map((s) => s.dataset.sec)).toEqual(["general", "address", "addressParts", "layout", "mapping", "logic"]);
    expect(open(el)).toEqual(["general", "address"]);
    expect(body(el, "layout").hidden).toBe(true);
    expect(body(el, "address").hidden).toBe(false);
    const summary = (id) => head(el, id).querySelector(".pp-sec-sum")?.textContent;
    expect(summary("addressParts")).toBe("5 parts");
    expect(summary("layout")).toBe("100% wide");
    expect(summary("mapping")).toBe("Not saved to a record");
    expect(summary("logic")).toBe("None");
    expect(summary("general")).toBeUndefined();
  });

  it("opens and folds a section and remembers the choice for other fields", async () => {
    const el = mount(address);
    await flush();
    head(el, "mapping").click();
    head(el, "address").click();
    await flush();
    expect(open(el)).toEqual(["general", "mapping"]);
    expect(body(el, "mapping").hidden).toBe(false);
    expect(JSON.parse(window.localStorage.getItem("jform.propertySections"))).toEqual({ mapping: true, address: false });
    document.body.removeChild(el);

    const again = mount(baseDefinition);
    await flush();
    expect(open(again)).toEqual(["general", "mapping"]);
  });
});

describe("c-jform-properties Other choice and choice limits", () => {
  const diet = { key: "diet", type: "checkboxes", label: "Diet", options: [{ label: "Vegan", value: "Vegan" }, { label: "Halal", value: "Halal" }] };
  const mountOne = (field) => mount({ ...baseDefinition, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });
  const input = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === label);
  const lastPatch = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
  const change = (box, prop, value) => {
    box[prop] = value;
    box.dispatchEvent(new CustomEvent("change"));
  };

  it("turns Other on and off, and saves its label and placeholder", async () => {
    const el = mountOne(diet);
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const toggle = input(el, "Add “Other” with a text box");
    expect(toggle.checked).toBe(false);
    expect(input(el, "Choice label")).toBeUndefined();
    change(toggle, "checked", true);
    expect(lastPatch(handler)).toEqual({ config: { other: {} } });

    el.definition = { ...baseDefinition, sections: [{ key: "p1", name: "Page 1", fields: [{ ...diet, config: { other: {} } }] }] };
    await flush();
    expect(input(el, "Choice label").placeholder).toBe("Other");
    change(input(el, "Choice label"), "value", " Something else ");
    expect(lastPatch(handler)).toEqual({ config: { other: { label: "Something else" } } });
    change(input(el, "Add “Other” with a text box"), "checked", false);
    expect(lastPatch(handler)).toEqual({ config: undefined });
  });

  it("offers Other on choice fields only", async () => {
    let el = mountOne({ ...diet, type: "picklist" });
    await flush();
    expect(input(el, "Add “Other” with a text box")).toBeTruthy();
    expect(input(el, "At most")).toBeUndefined(); // limits are for Checkboxes
    document.body.removeChild(el);
    el = mountOne({ key: "email", type: "email", label: "Email" });
    await flush();
    expect(input(el, "Add “Other” with a text box")).toBeUndefined();
  });

  it("saves At least and At most, refusing numbers that can't work", async () => {
    const el = mountOne({ ...diet, config: { other: {}, minChoices: 2 } });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const most = input(el, "At most");
    most.setCustomValidity = jest.fn();
    most.reportValidity = jest.fn();
    change(most, "value", "4"); // two options and Other
    expect(most.setCustomValidity).toHaveBeenLastCalledWith("There are 3 choices.");
    change(most, "value", "1");
    expect(most.setCustomValidity).toHaveBeenLastCalledWith("Less than At least.");
    change(most, "value", "0");
    expect(most.setCustomValidity).toHaveBeenLastCalledWith("Enter a whole number from 1.");
    expect(handler).not.toHaveBeenCalled();
    change(most, "value", "3");
    expect(most.setCustomValidity).toHaveBeenLastCalledWith("");
    expect(lastPatch(handler)).toEqual({ config: { other: {}, minChoices: 2, maxChoices: 3 } });
    change(input(el, "At least"), "value", "");
    expect(lastPatch(handler)).toEqual({ config: { other: {}, maxChoices: 3 } }); // At most stays as its box reads
  });

  it("saves a limit that clashed once the other one is fixed", async () => {
    const el = mountOne({ ...diet, config: { other: {}, maxChoices: 2 } });
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const least = input(el, "At least");
    const most = input(el, "At most");
    for (const box of [least, most]) {
      box.setCustomValidity = jest.fn();
      box.reportValidity = jest.fn();
    }
    change(least, "value", "3");
    expect(least.setCustomValidity).toHaveBeenLastCalledWith("More than At most.");
    expect(handler).not.toHaveBeenCalled();
    change(most, "value", "3");
    expect(least.setCustomValidity).toHaveBeenLastCalledWith("");
    expect(most.setCustomValidity).toHaveBeenLastCalledWith("");
    expect(lastPatch(handler)).toEqual({ config: { other: {}, minChoices: 3, maxChoices: 3 } });
  });
});

describe("c-jform-properties accepted files", () => {
  const upload = (extra) => ({ key: "sheet", type: "fileupload", label: "Timesheet", ...extra });
  const mountOne = (field) => mount({ ...baseDefinition, sections: [{ key: "p1", name: "Page 1", fields: [field] }] });
  const lastPatch = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch;
  const kindGroups = (el) => [...el.shadowRoot.querySelectorAll("lightning-checkbox-group.pp-file-kinds")];
  const button = (el, value) => [...el.shadowRoot.querySelectorAll("button.pr-seg-btn")].find((b) => b.dataset.value === value);
  const maxFiles = (el) => [...el.shadowRoot.querySelectorAll("lightning-input")].find((i) => i.label === "Maximum files");

  it("takes any allowed file until Only these is picked, and refuses Only these with nothing ticked", async () => {
    const el = mountOne(upload());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(groupTitles(el)).toContain("Accepted files");
    expect(button(el, "any").getAttribute("aria-checked")).toBe("true");
    expect(kindGroups(el)).toHaveLength(0);
    button(el, "only").click();
    await flush();
    expect(kindGroups(el).map((g) => g.label)).toEqual(["Documents", "Images", "Audio"]);
    expect(el.shadowRoot.querySelector(".pp-error").textContent).toBe("Tick at least one file type.");
    expect(handler).not.toHaveBeenCalled(); // nothing is saved until a kind is ticked
  });

  it("saves the ticked kinds' extensions: Excel, CSV and PDF", async () => {
    const el = mountOne(upload({ config: { extensions: ["pdf"] } }));
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const [documents, images] = kindGroups(el);
    expect(documents.value).toEqual(["pdf"]);
    expect(documents.options[2]).toEqual({ label: "Excel (.xls, .xlsx)", value: "excel" });
    documents.value = ["pdf", "excel", "csv"];
    documents.dispatchEvent(new CustomEvent("change", { detail: { value: ["pdf", "excel", "csv"] } }));
    expect(lastPatch(handler)).toEqual({ config: { extensions: ["pdf", "xls", "xlsx", "csv"] } });
    images.dispatchEvent(new CustomEvent("change", { detail: { value: ["png"] } }));
    expect(lastPatch(handler)).toEqual({ config: { extensions: ["pdf", "png"] } }); // the documents ticked when the panel last drew
    documents.dispatchEvent(new CustomEvent("change", { detail: { value: [] } }));
    expect(lastPatch(handler)).toEqual({ config: undefined });
  });

  it("goes back to any allowed file", async () => {
    const el = mountOne(upload({ config: { extensions: ["pdf"], maxFiles: 3 } }));
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    button(el, "any").click();
    expect(lastPatch(handler)).toEqual({ config: { maxFiles: 3 } });
  });

  it("offers only the kinds of the field's file type", async () => {
    const el = mountOne(upload({ fileType: "Image", config: { extensions: ["png"] } }));
    await flush();
    expect(kindGroups(el).map((g) => g.label)).toEqual(["Images"]);
  });

  it("keeps a kind's extensions set through the API when another kind is ticked", async () => {
    const el = mountOne(upload({ config: { extensions: ["docx", "png"] } }));
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    const [documents] = kindGroups(el);
    expect(documents.value).toEqual(["word"]);
    documents.dispatchEvent(new CustomEvent("change", { detail: { value: ["pdf", "word"] } }));
    expect(lastPatch(handler)).toEqual({ config: { extensions: ["pdf", "docx", "png"] } }); // not .doc
  });

  it("drops chosen extensions of a group the field doesn't offer", async () => {
    const el = mountOne(upload({ fileType: "Image", config: { extensions: ["png", "pdf"] } }));
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    kindGroups(el)[0].dispatchEvent(new CustomEvent("change", { detail: { value: ["png", "gif"] } }));
    expect(lastPatch(handler)).toEqual({ config: { extensions: ["png", "gif"] } });
  });

  it("saves the largest file and the number of files, refusing numbers out of range", async () => {
    const el = mountOne(upload());
    const handler = jest.fn();
    el.addEventListener("fieldchange", handler);
    await flush();
    expect(button(el, "3").getAttribute("aria-checked")).toBe("true");
    button(el, "2").click();
    expect(lastPatch(handler)).toEqual({ config: { maxSizeMb: 2 } });
    const box = maxFiles(el);
    box.setCustomValidity = jest.fn();
    box.reportValidity = jest.fn();
    for (const bad of ["0", "11", "2.5"]) {
      box.value = bad;
      box.dispatchEvent(new CustomEvent("change"));
      expect(box.setCustomValidity).toHaveBeenLastCalledWith("Enter a whole number from 1 to 10.");
    }
    expect(handler).toHaveBeenCalledTimes(1);
    box.value = "3";
    box.dispatchEvent(new CustomEvent("change"));
    expect(box.setCustomValidity).toHaveBeenLastCalledWith("");
    expect(lastPatch(handler)).toEqual({ config: { maxFiles: 3 } });
  });

  it("sums the rules up when the section is folded", async () => {
    window.localStorage.setItem("jform.propertySections", JSON.stringify({ files: false }));
    const el = mountOne(upload({ config: { extensions: ["pdf", "xls", "xlsx", "csv"], maxSizeMb: 2, maxFiles: 3 } }));
    await flush();
    const section = [...el.shadowRoot.querySelectorAll("c-jform-property-section")].find((s) => s.label === "Accepted files");
    expect(section.summary).toBe("PDF, Excel or CSV, up to 2 MB, at most 3 files");
    window.localStorage.removeItem("jform.propertySections");
  });
});
