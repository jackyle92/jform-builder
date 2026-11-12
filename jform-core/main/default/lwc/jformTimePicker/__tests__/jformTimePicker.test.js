import { createElement } from "lwc";
import JformTimePicker from "c/jformTimePicker";

function mount(props = {}) {
  const el = createElement("c-jform-time-picker", { is: JformTimePicker });
  Object.assign(el, { forceNative: false, ...props });
  document.body.appendChild(el);
  return el;
}
const flush = () => Promise.resolve();
const changes = (el) => {
  const seen = [];
  el.addEventListener("change", (e) => seen.push(e.detail.value));
  return seen;
};
afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-time-picker", () => {
  it("shows the stored time in the respondent's format and reads typed times", async () => {
    const el = mount({ value: "13:05" });
    await flush();
    const input = el.shadowRoot.querySelector("input.jf-tp-input");
    expect(input.value).toBe("1:05 PM");
    expect(input.placeholder).toBe("h:mm am/pm");
    const seen = changes(el);
    input.value = "9.30pm";
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(seen).toEqual(["21:30"]);
    expect(input.value).toBe("9:30 PM");
    input.value = "later";
    input.dispatchEvent(new Event("change"));
    expect(seen[1]).toBe("later");
  });

  it("lists times at the field's step within its limits and picks one", async () => {
    const el = mount({ value: "", config: { step: 30, minTime: "09:00", maxTime: "11:00" } });
    await flush();
    const seen = changes(el);
    el.shadowRoot.querySelector(".jf-tp-btn").click();
    await flush();
    const slots = [...el.shadowRoot.querySelectorAll(".jf-tp-slot")];
    expect(slots.map((s) => s.textContent)).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
    expect(slots[0].classList.contains("jf-tp-active")).toBe(true); // nothing chosen: starts at the first daytime slot
    slots[3].click();
    await flush();
    expect(seen).toEqual(["10:30"]);
    expect(el.shadowRoot.querySelector(".jf-tp-list")).toBeNull();
    expect(el.shadowRoot.querySelector("input.jf-tp-input").value).toBe("10:30 AM");
  });

  it("uses a 24-hour clock when the field says so", async () => {
    const el = mount({ value: "15:00", config: { hourFormat: "24", step: 60 } });
    await flush();
    expect(el.shadowRoot.querySelector("input.jf-tp-input").value).toBe("15:00");
    expect(el.shadowRoot.querySelector("input.jf-tp-input").placeholder).toBe("HH:mm");
    el.shadowRoot.querySelector(".jf-tp-btn").click();
    await flush();
    expect(el.shadowRoot.querySelectorAll(".jf-tp-slot")).toHaveLength(24);
    expect(el.shadowRoot.querySelector(".jf-tp-selected").textContent).toBe("15:00");
  });

  it("opens and walks the list from the keyboard", async () => {
    const el = mount({ value: "09:00", config: { step: 15 } });
    await flush();
    const seen = changes(el);
    const input = el.shadowRoot.querySelector("input.jf-tp-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await flush();
    expect(el.shadowRoot.querySelector(".jf-tp-list")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-tp-active").textContent).toBe("9:00 AM");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await flush();
    expect(el.shadowRoot.querySelector(".jf-tp-active").textContent).toBe("9:15 AM");
    expect(input.getAttribute("aria-activedescendant")).toBe(el.shadowRoot.querySelector(".jf-tp-active").id);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flush();
    expect(seen).toEqual(["09:15"]);
    expect(el.shadowRoot.querySelector(".jf-tp-list")).toBeNull();
  });

  it("falls back to the platform control on touch devices, with step and limits", async () => {
    const el = mount({ forceNative: true, value: "09:00", config: { step: 30, minTime: "08:00", maxTime: "18:00" } });
    await flush();
    const native = el.shadowRoot.querySelector("input[type=time]");
    expect(native.getAttribute("step")).toBe("1800");
    expect(native.getAttribute("min")).toBe("08:00");
    expect(native.getAttribute("max")).toBe("18:00");
    expect(el.shadowRoot.querySelector("button.jf-tp-btn")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-tp-icon")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-tp-ph")).toBeNull();
    const seen = changes(el);
    native.value = "10:30";
    native.dispatchEvent(new Event("change"));
    expect(seen).toEqual(["10:30"]);
    el.value = "";
    await flush();
    expect(el.shadowRoot.querySelector(".jf-tp-ph").textContent).toBe("h:mm am/pm");
  });
});
