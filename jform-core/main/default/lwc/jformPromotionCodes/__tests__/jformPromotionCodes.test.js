import { createElement } from "lwc";
import JformPromotionCodes from "c/jformPromotionCodes";
import listPromotionCodes from "@salesforce/apex/JFormWorkspaceController.listPromotionCodes";
import savePromotionCode from "@salesforce/apex/JFormWorkspaceController.savePromotionCode";
import generatePromotionCodes from "@salesforce/apex/JFormWorkspaceController.generatePromotionCodes";
import deletePromotionCode from "@salesforce/apex/JFormWorkspaceController.deletePromotionCode";
import exportPromotionCodes from "@salesforce/apex/JFormWorkspaceController.exportPromotionCodes";

jest.mock("@salesforce/apex/JFormWorkspaceController.listPromotionCodes", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.savePromotionCode", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.generatePromotionCodes", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.deletePromotionCode", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.exportPromotionCodes", () => ({ default: jest.fn() }), { virtual: true });

const FORM = "a00000000000001AAA";
const codes = [
  { id: "a0Y000000000001AAA", code: "SAVE10", discountType: "Percent", percentOff: 10, uses: 3, active: true, note: "Newsletter", state: "Active" },
  { id: "a0Y000000000002AAA", code: "TENOFF", discountType: "Amount", amountOff: 10, currencyCode: "USD", maxUses: 50, uses: 50, active: true, state: "Used up", validUntil: "2026-12-31T23:59:00.000Z" },
  { id: "a0Y000000000003AAA", code: "EARLY-K7M2PQ4X", discountType: "Percent", percentOff: 100, maxUses: 1, uses: 0, active: false, state: "Paused" }
];
const settle = async () => {
  // eslint-disable-next-line no-await-in-loop
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const button = (el, label) => $$(el, "lightning-button").find((b) => b.label === label);
const byProp = (el, prop) => $(el, `[data-prop="${prop}"]`);
const set = (el, prop, value) => byProp(el, prop).dispatchEvent(new CustomEvent("change", { detail: { value } }));

function mount(props = {}) {
  const el = createElement("c-jform-promotion-codes", { is: JformPromotionCodes });
  el.formId = FORM;
  el.currency = "USD";
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  listPromotionCodes.mockReset().mockResolvedValue(codes);
  savePromotionCode.mockReset().mockResolvedValue(codes[0]);
  generatePromotionCodes.mockReset();
  deletePromotionCode.mockReset().mockResolvedValue();
  exportPromotionCodes.mockReset().mockResolvedValue("Code,Discount\nSAVE10,10%");
  global.URL.createObjectURL = jest.fn(() => "blob:x");
  global.URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-promotion-codes", () => {
  it("lists the form's codes with their discount, validity, uses and state", async () => {
    const el = mount();
    await settle();
    expect(listPromotionCodes).toHaveBeenCalledWith({ formId: FORM });
    expect($(el, ".pc-count").textContent).toBe("3 codes");
    const rows = $$(el, "tbody tr");
    expect(rows).toHaveLength(3);
    const cells = (i) => [...rows[i].querySelectorAll("td")].slice(0, 6).map((td) => td.textContent);
    expect(cells(0)).toEqual(["SAVE10", "10% off", "always", "3", "Active", "Newsletter"]);
    expect(cells(1).slice(0, 2)).toEqual(["TENOFF", "−$10.00"]);
    expect(cells(1)[2]).toMatch(/^until /);
    expect(cells(1).slice(3, 5)).toEqual(["50 / 50", "Used up"]);
    expect(rows[2].classList.contains("pc-paused")).toBe(true);
    expect(rows[2].querySelector("lightning-button").label).toBe("Resume");
    expect(rows[0].querySelector("lightning-button").label).toBe("Pause");
    expect(rows[0].querySelector(".pc-state").className).toBe("pc-state pc-state-active");
  });

  it("says so when there are none, and keeps the export for when there are", async () => {
    listPromotionCodes.mockResolvedValue([]);
    const el = mount();
    await settle();
    expect($(el, ".pc-empty").textContent).toContain("No codes yet");
    expect(button(el, "Export CSV").disabled).toBe(true);
    expect($(el, ".pc-count").textContent).toBe("");
  });

  it("adds a code from the dialog, upper-cased, and shows the server's objection in it", async () => {
    const el = mount();
    await settle();
    button(el, "Add code").click();
    await settle();
    expect($(el, ".slds-modal__title").textContent).toBe("Add code");
    // nothing typed yet: a message, no call
    button(el, "Add").click();
    await settle();
    expect(savePromotionCode).not.toHaveBeenCalled();
    expect($(el, ".pc-error").textContent).toBe("Enter how many percent the code takes off.");

    set(el, "code", " welcome ");
    set(el, "percentOff", "15");
    set(el, "maxUses", "100");
    set(el, "note", "Launch week");
    button(el, "Add").click();
    await settle();
    expect(JSON.parse(savePromotionCode.mock.calls[0][0].codeJson)).toEqual({
      discountType: "Percent",
      percentOff: 15,
      amountOff: null,
      validFrom: null,
      validUntil: null,
      note: "Launch week",
      code: "WELCOME",
      maxUses: 100,
      active: true
    });
    expect($(el, ".slds-modal__title")).toBeNull();
    expect(listPromotionCodes).toHaveBeenCalledTimes(2);

    // a duplicate: the dialog stays open with the message
    savePromotionCode.mockRejectedValue({ body: { message: "The code WELCOME already exists on this form." } });
    button(el, "Add code").click();
    await settle();
    set(el, "code", "welcome");
    set(el, "discountType", "Amount");
    await settle();
    expect(byProp(el, "amountOff").label).toBe("Amount off (USD)");
    set(el, "amountOff", "5");
    button(el, "Add").click();
    await settle();
    expect(JSON.parse(savePromotionCode.mock.calls[1][0].codeJson)).toMatchObject({ discountType: "Amount", amountOff: 5, percentOff: null });
    expect($(el, ".pc-error").textContent).toBe("The code WELCOME already exists on this form.");
    expect($(el, ".slds-modal__title")).not.toBeNull();
  });

  it("generates a batch of single-use codes with a prefix", async () => {
    generatePromotionCodes.mockResolvedValue(new Array(25).fill(codes[2]));
    const el = mount();
    await settle();
    const toasts = jest.fn();
    el.addEventListener("lightning__showtoast", toasts);
    button(el, "Generate codes").click();
    await settle();
    expect($(el, ".slds-modal__title").textContent).toBe("Generate codes");
    expect(byProp(el, "maxUses")).toBeNull();
    set(el, "count", "25");
    set(el, "prefix", "early");
    set(el, "percentOff", "100");
    set(el, "validUntil", "2026-12-31T23:59:00.000Z");
    button(el, "Generate").click();
    await settle();
    expect(JSON.parse(generatePromotionCodes.mock.calls[0][0].requestJson)).toEqual({
      discountType: "Percent",
      percentOff: 100,
      amountOff: null,
      validFrom: null,
      validUntil: "2026-12-31T23:59:00.000Z",
      note: null,
      count: 25,
      prefix: "EARLY"
    });
    expect(toasts.mock.calls[0][0].detail.title).toBe("25 codes generated");
    expect($(el, ".slds-modal__title")).toBeNull();

    button(el, "Generate codes").click();
    await settle();
    set(el, "count", "900");
    set(el, "percentOff", "10");
    button(el, "Generate").click();
    await settle();
    expect(generatePromotionCodes).toHaveBeenCalledTimes(1);
    expect($(el, ".pc-error").textContent).toBe("Generate between 1 and 500 codes at a time.");
  });

  it("pauses and resumes a code, and deletes one after asking", async () => {
    const el = mount();
    await settle();
    const rows = () => $$(el, "tbody tr");
    rows()[0].querySelector("lightning-button").click();
    await settle();
    expect(JSON.parse(savePromotionCode.mock.calls[0][0].codeJson)).toMatchObject({ id: codes[0].id, code: "SAVE10", active: false });
    rows()[2].querySelector("lightning-button").click();
    await settle();
    expect(JSON.parse(savePromotionCode.mock.calls[1][0].codeJson)).toMatchObject({ id: codes[2].id, active: true });

    rows()[1].querySelector("lightning-button-icon").click();
    await settle();
    expect(rows()[1].querySelector(".pc-confirm").textContent).toBe("Delete it?");
    expect(deletePromotionCode).not.toHaveBeenCalled();
    [...rows()[1].querySelectorAll("lightning-button")].find((b) => b.label === "Keep").click();
    await settle();
    expect(rows()[1].querySelector(".pc-confirm")).toBeNull();
    rows()[1].querySelector("lightning-button-icon").click();
    await settle();
    [...rows()[1].querySelectorAll("lightning-button")].find((b) => b.label === "Delete").click();
    await settle();
    expect(deletePromotionCode).toHaveBeenCalledWith({ formId: FORM, codeId: codes[1].id });
    expect(listPromotionCodes).toHaveBeenCalledTimes(4);
  });

  it("exports the list as a UTF-8 CSV through a text/plain blob", async () => {
    const el = mount();
    await settle();
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    button(el, "Export CSV").click();
    await settle();
    expect(exportPromotionCodes).toHaveBeenCalledWith({ formId: FORM });
    const blob = global.URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/plain");
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    // readAsText drops the byte-order mark while decoding; the blob's size shows it was there
    expect(text).toBe("Code,Discount\nSAVE10,10%");
    expect(blob.size).toBe(3 + "Code,Discount\nSAVE10,10%".length);
    expect(click).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    click.mockRestore();
  });

  it("reports a failed load as a toast", async () => {
    listPromotionCodes.mockRejectedValue({ body: { message: "No access" } });
    const el = mount();
    const toasts = jest.fn();
    el.addEventListener("lightning__showtoast", toasts);
    await settle();
    expect(toasts.mock.calls[0][0].detail).toMatchObject({ title: "Couldn't load the promotion codes", message: "No access", variant: "error" });
    expect($(el, ".pc-empty")).not.toBeNull();
  });
});
