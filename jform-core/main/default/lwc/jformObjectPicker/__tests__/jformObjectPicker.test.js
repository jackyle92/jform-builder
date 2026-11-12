import { createElement } from "lwc";
import JformObjectPicker from "c/jformObjectPicker";

const OPTIONS = [
  { label: "AB Test", value: "AB_Test__c" },
  { label: "Account", value: "Account" },
  { label: "Booking", value: "Booking__c" },
  { label: "Case", value: "Case" },
  { label: "Contact", value: "Contact" },
  { label: "Lead", value: "Lead" }
];
const flush = () => Promise.resolve();

function mount(props = {}) {
  const el = createElement("c-jform-object-picker", { is: JformObjectPicker });
  Object.assign(el, { label: "Target object", options: OPTIONS }, props);
  document.body.appendChild(el);
  return el;
}
const labels = (el) => [...el.shadowRoot.querySelectorAll(".op-option .op-label")].map((n) => n.textContent);
const groups = (el) => [...el.shadowRoot.querySelectorAll(".op-group")].map((n) => n.textContent);

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-object-picker", () => {
  it("lists common objects first, then the rest A to Z", async () => {
    const el = mount();
    el.shadowRoot.querySelector("input").dispatchEvent(new CustomEvent("focus"));
    await flush();
    expect(groups(el)).toEqual(["Common", "All objects"]);
    expect(labels(el)).toEqual(["Lead", "Contact", "Case", "Account", "AB Test", "Booking"]);
  });

  it("filters by label or API name as you type", async () => {
    const el = mount();
    const input = el.shadowRoot.querySelector("input");
    input.dispatchEvent(new CustomEvent("focus"));
    input.value = "book";
    input.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect(labels(el)).toEqual(["Booking"]);
    input.value = "__c";
    input.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect(labels(el)).toEqual(["AB Test", "Booking"]);
    input.value = "zzz";
    input.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect(el.shadowRoot.querySelector(".op-empty")).not.toBeNull();
  });

  it("re-renders cleanly while groups appear, rename and vanish keystroke by keystroke", async () => {
    const el = mount();
    const input = el.shadowRoot.querySelector("input");
    input.dispatchEvent(new CustomEvent("focus"));
    await flush();
    const steps = [
      ["c", ["Common", "Matches"], ["Contact", "Case", "Account", "AB Test", "Booking"]],
      ["co", ["Common"], ["Contact", "Account"]],
      ["con", ["Common"], ["Contact"]],
      ["co", ["Common"], ["Contact", "Account"]],
      ["c", ["Common", "Matches"], ["Contact", "Case", "Account", "AB Test", "Booking"]],
      ["", ["Common", "All objects"], ["Lead", "Contact", "Case", "Account", "AB Test", "Booking"]]
    ];
    for (const [query, expectedGroups, expectedLabels] of steps) {
      input.value = query;
      input.dispatchEvent(new CustomEvent("input"));
      await flush();
      expect(groups(el)).toEqual(expectedGroups);
      expect(labels(el)).toEqual(expectedLabels);
    }
    // a header row is not an option: pressing on it picks nothing and keeps the list open
    const handler = jest.fn();
    el.addEventListener("change", handler);
    el.shadowRoot.querySelector(".op-group").dispatchEvent(new CustomEvent("mousedown"));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelectorAll('[role="option"]')).toHaveLength(6);
  });

  it("picks with the mouse or the keyboard and shows the chosen label", async () => {
    const el = mount({ allowNone: true });
    const handler = jest.fn();
    el.addEventListener("change", handler);
    const input = el.shadowRoot.querySelector("input");
    input.dispatchEvent(new CustomEvent("focus"));
    await flush();
    expect(labels(el)[0]).toBe("None");
    el.shadowRoot.querySelector('[data-value="Lead"]').dispatchEvent(new CustomEvent("mousedown"));
    await flush();
    expect(handler.mock.calls[0][0].detail).toEqual({ value: "Lead" });
    expect(input.value).toBe("Lead");

    input.dispatchEvent(new CustomEvent("focus"));
    input.value = "cont";
    input.dispatchEvent(new CustomEvent("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flush();
    expect(handler.mock.calls[1][0].detail).toEqual({ value: "Contact" });
  });

  it("matches a value in another case and can be cleared", async () => {
    const el = mount({ value: "lead" });
    const handler = jest.fn();
    el.addEventListener("change", handler);
    await flush();
    expect(el.shadowRoot.querySelector("input").value).toBe("Lead");
    el.shadowRoot.querySelector(".op-clear").dispatchEvent(new CustomEvent("mousedown"));
    expect(handler.mock.calls[0][0].detail).toEqual({ value: "" });
  });
});
