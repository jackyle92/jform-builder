import { createElement } from "lwc";
import JformResponsesTab from "c/jformResponsesTab";
import getSummary from "@salesforce/apex/JFormResponsesController.getSummary";
import getSubmissions from "@salesforce/apex/JFormResponsesController.getSubmissions";
import exportCsv from "@salesforce/apex/JFormResponsesController.exportCsv";

jest.mock("@salesforce/apex/JFormResponsesController.getSummary", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormResponsesController.getSubmissions", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormResponsesController.exportCsv", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormResponsesController.reprocess", () => ({ default: jest.fn() }), { virtual: true });

const summary = { total: 3, last7Days: 1, processed: 3, errors: 0, spam: 2, withTargetRecord: 1, choices: [] };
const page = {
  columns: ["Email"],
  columnKeys: ["email"],
  fields: [{ key: "email", label: "Email", options: [] }, { key: "store", label: "Store", options: ["London", "Leeds"] }],
  total: 2,
  rows: [
    { id: "a0X000000000001AAA", submittedAt: "2026-10-14T10:00:00.000Z", status: "Spam", spamReason: "honeypot filled", cells: ["bot@example.com"] },
    { id: "a0X000000000002AAA", submittedAt: "2026-10-14T09:00:00.000Z", status: "Error", errorMessage: "Boom", cells: ["ann@example.com"] }
  ]
};
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function mount() {
  const el = createElement("c-jform-responses-tab", { is: JformResponsesTab });
  el.formId = "a00000000000001AAA";
  el.formName = "Clinic";
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  getSummary.mockResolvedValue(summary);
  getSubmissions.mockResolvedValue(page);
  exportCsv.mockResolvedValue("a,b");
  global.URL.createObjectURL = jest.fn(() => "blob:x");
  global.URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  jest.clearAllMocks();
});

describe("c-jform-responses-tab spam", () => {
  it("shows spam as its own tile and a grey pill with the reason, without a retry button", async () => {
    const el = mount();
    await settle();
    const tiles = [...el.shadowRoot.querySelectorAll(".rt-tile")].map((t) => `${t.querySelector(".rt-tile-value").textContent} ${t.querySelector(".rt-tile-label").textContent}`);
    expect(tiles).toEqual(expect.arrayContaining(["3 Responses", "2 Flagged as spam"]));
    const pills = [...el.shadowRoot.querySelectorAll(".rt-pill")];
    const spam = pills.find((p) => p.textContent.trim() === "Spam");
    expect(spam.className).toContain("rt-pill-spam");
    expect(spam.getAttribute("title")).toBe("honeypot filled");
    const row = spam.closest("tr");
    expect(row.querySelector('lightning-button-icon[icon-name="utility:refresh"]')).toBeNull();
    expect(el.shadowRoot.querySelector("lightning-combobox").options.map((o) => o.value)).toContain("Spam");
  });

  it("includes spam in the export only while the Spam filter is active", async () => {
    const el = mount();
    await settle();
    const exportButton = [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Export CSV");
    exportButton.click();
    await settle();
    expect(exportCsv).toHaveBeenLastCalledWith({ formId: "a00000000000001AAA", includeSpam: false, payment: null, code: null });

    el.shadowRoot.querySelector("lightning-combobox").dispatchEvent(new CustomEvent("change", { detail: { value: "Spam" } }));
    await settle();
    expect(getSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({ status: "Spam" }));
    exportButton.click();
    await settle();
    expect(exportCsv).toHaveBeenLastCalledWith({ formId: "a00000000000001AAA", includeSpam: true, payment: null, code: null });
  });
});

describe("c-jform-responses-tab search and filters", () => {
  const byLabel = (el, label) => [...el.shadowRoot.querySelectorAll("lightning-input, lightning-combobox")].find((i) => i.label === label);
  const lastCall = () => getSubmissions.mock.calls[getSubmissions.mock.calls.length - 1][0];

  it("searches answers after a pause in typing, from the first page", async () => {
    jest.useFakeTimers();
    const el = mount();
    await settle();
    expect(lastCall()).toMatchObject({ search: null, fromDate: null, toDate: null, fieldKey: null, fieldValue: null });
    const search = byLabel(el, "Search answers");
    search.value = "nguyen";
    search.dispatchEvent(new CustomEvent("change"));
    search.value = "nguyen.vantam";
    search.dispatchEvent(new CustomEvent("change"));
    expect(getSubmissions).toHaveBeenCalledTimes(1); // nothing yet: still typing
    jest.advanceTimersByTime(400);
    await settle();
    expect(getSubmissions).toHaveBeenCalledTimes(2);
    expect(lastCall()).toMatchObject({ search: "nguyen.vantam", offset: 0 });
    expect(el.shadowRoot.querySelector(".rt-footer .rt-muted").textContent).toBe("1 to 2 of 2 matching");
    jest.useRealTimers();
  });

  it("filters by date and by a field's choice, and clears everything at once", async () => {
    const el = mount();
    await settle();
    const from = byLabel(el, "From");
    from.value = "2026-10-01";
    from.dispatchEvent(new CustomEvent("change"));
    await settle();
    expect(lastCall()).toMatchObject({ fromDate: "2026-10-01", toDate: null });

    byLabel(el, "Field").dispatchEvent(new CustomEvent("change", { detail: { value: "store" } }));
    await settle();
    const value = byLabel(el, "Value");
    expect(value.options.map((o) => o.value)).toEqual(["London", "Leeds"]); // choice fields offer their choices
    value.dispatchEvent(new CustomEvent("change", { detail: { value: "Leeds" } }));
    await settle();
    expect(lastCall()).toMatchObject({ fieldKey: "store", fieldValue: "Leeds", fromDate: "2026-10-01" });

    const clear = [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Clear");
    clear.click();
    await settle();
    expect(lastCall()).toMatchObject({ search: null, fromDate: null, toDate: null, fieldKey: null, fieldValue: null });
    expect([...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Clear")).toBeUndefined();
  });

  it("exports every response regardless of the search and filters", async () => {
    const el = mount();
    await settle();
    const search = byLabel(el, "Search answers");
    search.value = "only me";
    search.dispatchEvent(new CustomEvent("change"));
    [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Export CSV").click();
    await settle();
    expect(exportCsv).toHaveBeenCalledWith({ formId: "a00000000000001AAA", includeSpam: false, payment: null, code: null });
  });
});

describe("c-jform-responses-tab payments", () => {
  const paySummary = { ...summary, payments: true, paid: 4, unpaid: 2, collected: [{ currencyCode: "USD", amount: 180 }, { currencyCode: "EUR", amount: 12.5 }] };
  const payPage = {
    ...page,
    rows: [
      { id: "a0X000000000003AAA", submittedAt: "2026-10-26T09:00:00.000Z", status: "Processed", cells: ["ann@example.com"], paymentStatus: "Paid", paymentAmount: 45, paymentCurrency: "USD", paymentMode: "Test", paymentUrl: "https://dashboard.stripe.com/test/payments/pi_1" },
      { id: "a0X000000000004AAA", submittedAt: "2026-10-26T08:00:00.000Z", status: "New", cells: ["bea@example.com"], paymentStatus: "Partially refunded", paymentAmount: 20, paymentCurrency: "EUR", paymentMode: "Live" },
      { id: "a0X000000000005AAA", submittedAt: "2026-10-26T07:00:00.000Z", status: "Processed", cells: ["cy@example.com"] },
      { id: "a0X000000000006AAA", submittedAt: "2026-10-26T06:00:00.000Z", status: "Processed", cells: ["di@example.com"], paymentStatus: "Paid", paymentAmount: 50, paymentCurrency: "EUR", paymentMode: "Live", paymentExpected: 45, paymentExpectedCurrency: "USD" },
      { id: "a0X000000000007AAA", submittedAt: "2026-10-26T05:00:00.000Z", status: "Processed", cells: ["ed@example.com"], paymentStatus: "Paid", paymentAmount: 36, paymentCurrency: "USD", paymentMode: "Test", promotionCode: "SAVE10", discountAmount: 4 },
      { id: "a0X000000000008AAA", submittedAt: "2026-10-26T04:00:00.000Z", status: "Processed", cells: ["fy@example.com"], paymentStatus: "Paid", paymentAmount: 0, paymentCurrency: "USD", paymentMode: "Test", promotionCode: "FREE" }
    ]
  };

  it("shows nothing about payments on a form without them", async () => {
    const el = mount();
    await settle();
    expect(el.shadowRoot.querySelector(".rt-payment-filter")).toBeNull();
    expect([...el.shadowRoot.querySelectorAll("th")].map((t) => t.textContent)).not.toContain("Payment");
  });

  it("counts paid and unpaid responses and the live money collected", async () => {
    getSummary.mockResolvedValue(paySummary);
    getSubmissions.mockResolvedValue(payPage);
    const el = mount();
    await settle();
    const tiles = [...el.shadowRoot.querySelectorAll(".rt-tile")].map((t) => `${t.querySelector(".rt-tile-value").textContent} ${t.querySelector(".rt-tile-label").textContent}`);
    expect(tiles).toEqual(expect.arrayContaining(["4 Paid", "2 Unpaid (not counted above)", "$180.00 · €12.50 Collected (live payments)"]));
  });

  it("shows each response's payment with a link to Stripe", async () => {
    getSummary.mockResolvedValue(paySummary);
    getSubmissions.mockResolvedValue(payPage);
    const el = mount();
    await settle();
    const cells = [...el.shadowRoot.querySelectorAll("td.rt-pay")];
    expect(cells).toHaveLength(6);
    expect(cells[0].querySelector(".rt-pill-pay-paid").textContent).toBe("Paid");
    expect(cells[0].querySelector(".rt-pill-test").textContent).toBe("Test");
    expect(cells[0].querySelector(".rt-pay-amount").textContent).toBe("$45.00");
    expect(cells[0].querySelector(".rt-pay-expected")).toBeNull();
    expect(cells[0].querySelector("a.rt-pay-link").getAttribute("href")).toBe("https://dashboard.stripe.com/test/payments/pi_1");
    expect(cells[1].querySelector(".rt-pill-pay-partially-refunded").textContent).toBe("Partially refunded");
    expect(cells[1].querySelector(".rt-pill-test")).toBeNull();
    expect(cells[1].querySelector("a")).toBeNull();
    expect(cells[2].textContent).toBe("—");
    // charged for another amount than priced: the amount charged, with what the form priced beside it
    expect(cells[3].querySelector(".rt-pay-amount").textContent).toBe("€50.00");
    expect(cells[3].querySelector(".rt-pay-expected").textContent).toBe("priced $45.00");
    expect(cells[3].querySelector(".rt-pay-code")).toBeNull();
    // a promotion code: the code and what it took off, under the amount charged
    expect(cells[4].querySelector(".rt-pay-amount").textContent).toBe("$36.00");
    expect(cells[4].querySelector(".rt-pay-code").textContent).toBe("SAVE10 · −$4.00");
    expect(cells[5].querySelector(".rt-pay-code").textContent).toBe("FREE");
  });

  it("filters by promotion code, after a pause, and exports what the filter shows", async () => {
    jest.useFakeTimers();
    getSummary.mockResolvedValue(paySummary);
    getSubmissions.mockResolvedValue(payPage);
    const el = mount();
    await settle();
    const box = el.shadowRoot.querySelector(".rt-code");
    expect(box).not.toBeNull();
    box.dispatchEvent(new CustomEvent("change", { detail: { value: " save " } }));
    expect(getSubmissions).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(300);
    await settle();
    expect(getSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({ code: "save", offset: 0 }));
    [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "Export CSV").click();
    await settle();
    expect(exportCsv).toHaveBeenLastCalledWith({ formId: "a00000000000001AAA", includeSpam: false, payment: null, code: "save" });
    jest.useRealTimers();
  });

  it("filters by payment from the first page", async () => {
    getSummary.mockResolvedValue(paySummary);
    getSubmissions.mockResolvedValue(payPage);
    const el = mount();
    await settle();
    expect(getSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({ payment: null, offset: 0 }));
    const filter = el.shadowRoot.querySelector(".rt-payment-filter");
    expect(filter.options.map((o) => o.value)).toEqual(["", "paid", "unpaid", "test"]);
    filter.dispatchEvent(new CustomEvent("change", { detail: { value: "unpaid" } }));
    await settle();
    expect(getSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({ payment: "unpaid", offset: 0 }));
  });
});
