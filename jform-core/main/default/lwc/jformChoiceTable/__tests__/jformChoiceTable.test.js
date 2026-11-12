import { createElement } from "lwc";
import JformChoiceTable from "c/jformChoiceTable";

const ROWS = [
  { key: "service", label: "Service" },
  { key: "price", label: "Price" }
];
const COLUMNS = ["Poor", "Fair", "Good"].map((c) => ({ label: c, value: c }));

/** Lets a test set the width the component sees; without ResizeObserver it stays narrow. */
let observers = [];
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    observers.push(this);
  }
  observe() {}
  disconnect() {}
}
const resizeTo = (width) => observers.forEach((o) => o.callback([{ contentRect: { width } }]));

function mount(props = {}) {
  const el = createElement("c-jform-choice-table", { is: JformChoiceTable });
  Object.assign(el, { rows: ROWS, columns: COLUMNS, ariaLabel: "How satisfied were you with" }, props);
  document.body.appendChild(el);
  return el;
}
const flush = () => Promise.resolve();
const inputs = (el) => [...el.shadowRoot.querySelectorAll("input")];

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  delete global.ResizeObserver;
  observers = [];
});

describe("c-jform-choice-table wide", () => {
  beforeEach(() => {
    global.ResizeObserver = FakeResizeObserver;
  });

  it("is a table with a header per column and per row, and one radio group per row", async () => {
    const el = mount({ value: { price: "Fair" } });
    await flush();
    resizeTo(700);
    await flush();
    const table = el.shadowRoot.querySelector("table.jf-tbl");
    expect(table).not.toBeNull();
    expect(table.getAttribute("aria-label")).toBe("How satisfied were you with");
    expect([...el.shadowRoot.querySelectorAll('th[scope="col"]')].map((t) => t.textContent)).toEqual(["Poor", "Fair", "Good"]);
    expect([...el.shadowRoot.querySelectorAll('th[scope="row"]')].map((t) => t.textContent)).toEqual(["Service", "Price"]);
    const all = inputs(el);
    expect(all).toHaveLength(6);
    expect(all.every((i) => i.type === "radio")).toBe(true);
    const names = new Set(all.map((i) => i.name));
    expect(names.size).toBe(2); // arrow keys stay in a row, Tab goes to the next
    expect([...el.shadowRoot.querySelectorAll(".jf-sr")].map((s) => s.textContent).slice(0, 3)).toEqual(["Service: Poor", "Service: Fair", "Service: Good"]);
    expect(all.filter((i) => i.checked).map((i) => `${i.dataset.row}=${i.value}`)).toEqual(["price=Fair"]);
  });

  it("reports the whole answer, keyed by row", async () => {
    const el = mount({ value: { price: "Fair" } });
    resizeTo(700);
    await flush();
    const seen = [];
    el.addEventListener("change", (e) => seen.push(e.detail.value));
    const good = inputs(el).find((i) => i.dataset.row === "service" && i.value === "Good");
    good.checked = true;
    good.dispatchEvent(new CustomEvent("change"));
    expect(seen).toEqual([{ price: "Fair", service: "Good" }]);
  });

  it("marks unanswered rows", async () => {
    const el = mount({ missingRows: ["price"] });
    resizeTo(700);
    await flush();
    const rows = [...el.shadowRoot.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.classList.contains("jf-tbl-missing"))).toEqual([false, true]);
  });

  it("stacks the rows when the field is narrow", async () => {
    const el = mount();
    resizeTo(700);
    await flush();
    expect(el.shadowRoot.querySelector("table")).not.toBeNull();
    resizeTo(360);
    await flush();
    expect(el.shadowRoot.querySelector("table")).toBeNull();
    expect(el.shadowRoot.querySelectorAll("fieldset")).toHaveLength(2);
  });

  it("stacks the rows with more than seven columns, whatever the width", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `C${i}`, value: `C${i}` }));
    const el = mount({ columns: many });
    resizeTo(1200);
    await flush();
    expect(el.shadowRoot.querySelector("table")).toBeNull();
  });
});

describe("c-jform-choice-table narrow", () => {
  it("shows each row as a group with the row as its legend", async () => {
    const el = mount({ value: { service: "Poor" } });
    await flush();
    const groups = [...el.shadowRoot.querySelectorAll("fieldset")];
    expect(groups.map((g) => g.querySelector("legend").textContent)).toEqual(["Service", "Price"]);
    expect([...groups[0].querySelectorAll(".jf-choice-text")].map((t) => t.textContent)).toEqual(["Poor", "Fair", "Good"]);
    expect(groups[0].querySelector(".jf-choice-on .jf-choice-text").textContent).toBe("Poor");
  });

  it("takes several answers per row in column order, and drops a row left empty", async () => {
    const el = mount({ multiple: true, value: { service: ["Good"] } });
    await flush();
    const seen = [];
    el.addEventListener("change", (e) => seen.push(e.detail.value));
    expect(inputs(el).every((i) => i.type === "checkbox")).toBe(true);
    const poor = inputs(el).find((i) => i.dataset.row === "service" && i.value === "Poor");
    poor.checked = true;
    poor.dispatchEvent(new CustomEvent("change"));
    expect(seen[0]).toEqual({ service: ["Poor", "Good"] });

    el.value = { service: ["Good"] };
    await flush();
    const good = inputs(el).find((i) => i.dataset.row === "service" && i.value === "Good");
    good.checked = false;
    good.dispatchEvent(new CustomEvent("change"));
    expect(seen[1]).toEqual({});
  });

  it("reports blur only when focus leaves the table", async () => {
    const el = mount();
    await flush();
    const blurs = jest.fn();
    el.addEventListener("blur", blurs);
    const [first, second] = inputs(el);
    first.dispatchEvent(new FocusEvent("blur", { relatedTarget: second }));
    expect(blurs).not.toHaveBeenCalled();
    first.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
    expect(blurs).toHaveBeenCalledTimes(1);
  });

  it("is inert when disabled", async () => {
    const el = mount({ disabled: true });
    await flush();
    expect(inputs(el).every((i) => i.disabled)).toBe(true);
  });
});
