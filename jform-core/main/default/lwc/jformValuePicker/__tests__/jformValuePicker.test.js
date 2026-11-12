import { createElement } from "lwc";
import JformValuePicker from "c/jformValuePicker";

const OPTIONS = [
  { group: "Form answers", label: "Full name", value: "field:full_name" },
  { group: "Form answers", label: "Email", value: "field:email" },
  { group: "Earlier steps", label: "Lead from step 1", value: "step:lead:Id", detail: "Record Id" },
  { group: "Earlier steps", label: "Lead from step 1 › Email", value: "step:lead:Email" },
  { group: "Submission", label: "Submitted at", value: "submission:submittedAt" },
  { group: "Other", label: "Type a fixed value…", value: "value:" }
];
const flush = () => Promise.resolve();

function mount(props = {}) {
  const el = createElement("c-jform-value-picker", { is: JformValuePicker });
  Object.assign(el, { label: "Value", options: OPTIONS }, props);
  document.body.appendChild(el);
  return el;
}
const groups = (el) => [...el.shadowRoot.querySelectorAll(".vp-group")].map((n) => n.textContent);
const labels = (el) => [...el.shadowRoot.querySelectorAll(".vp-option .vp-label")].map((n) => n.textContent);

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-value-picker", () => {
  it("shows the chosen label and lists options under their groups", async () => {
    const el = mount({ value: "step:lead:Email" });
    const input = el.shadowRoot.querySelector("input");
    await flush();
    expect(input.value).toBe("Lead from step 1 › Email");
    input.dispatchEvent(new CustomEvent("focus"));
    await flush();
    expect(groups(el)).toEqual(["Form answers", "Earlier steps", "Submission", "Other"]);
    expect(labels(el)).toHaveLength(6);
  });

  it("filters as you type, dropping empty groups, and picks with Enter", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    const input = el.shadowRoot.querySelector("input");
    input.dispatchEvent(new CustomEvent("focus"));
    input.value = "email";
    input.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect(groups(el)).toEqual(["Form answers", "Earlier steps"]);
    expect(labels(el)).toEqual(["Email", "Lead from step 1 › Email"]);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(handler.mock.calls[0][0].detail).toEqual({ value: "step:lead:Email" });
  });

  it("picks with the mouse and ignores header rows", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    el.shadowRoot.querySelector("input").dispatchEvent(new CustomEvent("focus"));
    await flush();
    el.shadowRoot.querySelector(".vp-group").dispatchEvent(new CustomEvent("mousedown"));
    expect(handler).not.toHaveBeenCalled();
    el.shadowRoot.querySelector('[data-value="submission:submittedAt"]').dispatchEvent(new CustomEvent("mousedown"));
    expect(handler.mock.calls[0][0].detail).toEqual({ value: "submission:submittedAt" });
  });

  it("hides the label visually when asked", async () => {
    const el = mount({ variant: "label-hidden" });
    await flush();
    expect(el.shadowRoot.querySelector("label").className).toContain("slds-assistive-text");
  });
});
