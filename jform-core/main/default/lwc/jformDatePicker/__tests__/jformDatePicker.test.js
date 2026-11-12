import { createElement } from "lwc";
import JformDatePicker from "c/jformDatePicker";
import { todayISO, addDays } from "c/jformDateTime";

function mount(props = {}) {
  const el = createElement("c-jform-date-picker", { is: JformDatePicker });
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

describe("c-jform-date-picker", () => {
  it("shows the stored ISO date in the respondent's format and accepts typed dates", async () => {
    const el = mount({ value: "2026-10-15" });
    await flush();
    const input = el.shadowRoot.querySelector("input.jf-dp-input");
    expect(input.value).toBe("Oct 15, 2026"); // jsdom runs as en-US
    expect(input.placeholder).toBe("MM/DD/YYYY");
    const seen = changes(el);
    input.value = "12/1/2026";
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(seen).toEqual(["2026-12-01"]);
    expect(input.value).toBe("Dec 1, 2026");
    input.value = "not a date";
    input.dispatchEvent(new Event("change"));
    expect(seen[1]).toBe("not a date"); // passed on so validation can report it
    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect(seen[2]).toBe("");
  });

  it("opens a calendar on the stored month and picks a day with the mouse", async () => {
    const el = mount({ value: "2026-10-15" });
    await flush();
    const seen = changes(el);
    el.shadowRoot.querySelector(".jf-dp-btn").click();
    await flush();
    const pop = el.shadowRoot.querySelector(".jf-dp-pop");
    expect(pop).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-dp-grid").getAttribute("aria-label")).toBe("October 2026");
    expect(el.shadowRoot.querySelector("th").textContent).toContain("Sun"); // en-US weeks start on Sunday
    expect(el.shadowRoot.querySelector(".jf-dp-selected").dataset.iso).toBe("2026-10-15");
    el.shadowRoot.querySelector('button[data-iso="2026-10-20"]').click();
    await flush();
    expect(seen).toEqual(["2026-10-20"]);
    expect(el.shadowRoot.querySelector(".jf-dp-pop")).toBeNull();
    expect(el.shadowRoot.querySelector("input.jf-dp-input").value).toBe("Oct 20, 2026");
  });

  it("disables days outside the limits and off the allowed weekdays", async () => {
    const el = mount({ value: "2026-10-15", config: { minDate: "2026-10-10", maxDate: "2026-10-25", disabledDays: [0, 6] } });
    await flush();
    el.shadowRoot.querySelector(".jf-dp-btn").click();
    await flush();
    const day = (iso) => el.shadowRoot.querySelector(`button[data-iso="${iso}"]`);
    expect(day("2026-10-09").disabled).toBe(true);
    expect(day("2026-10-26").disabled).toBe(true);
    expect(day("2026-10-17").disabled).toBe(true); // Saturday
    expect(day("2026-10-16").disabled).toBe(false);
    expect(el.shadowRoot.querySelector(".jf-dp-year").value).toBe("2026"); // year list clipped to the limits
    expect(el.shadowRoot.querySelectorAll(".jf-dp-year option")).toHaveLength(1);
  });

  it("moves with the keyboard and chooses with Enter", async () => {
    const el = mount({ value: "2026-10-15" });
    await flush();
    const seen = changes(el);
    el.shadowRoot.querySelector(".jf-dp-btn").click();
    await flush();
    const day = (iso) => el.shadowRoot.querySelector(`button[data-iso="${iso}"]`);
    expect(day("2026-10-15").getAttribute("tabindex")).toBe("0");
    day("2026-10-15").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(day("2026-10-16").getAttribute("tabindex")).toBe("0");
    day("2026-10-16").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flush();
    expect(day("2026-10-23").getAttribute("tabindex")).toBe("0");
    day("2026-10-23").dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    await flush();
    expect(el.shadowRoot.querySelector(".jf-dp-grid").getAttribute("aria-label")).toBe("November 2026");
    day("2026-11-23").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(seen).toEqual(["2026-11-23"]);
    expect(el.shadowRoot.querySelector(".jf-dp-pop")).toBeNull();
  });

  it("offers Today and Clear, and starts on the first allowed day when nothing is chosen", async () => {
    const tomorrow = addDays(todayISO(), 1);
    const el = mount({ value: "", config: { minDate: tomorrow } });
    await flush();
    const seen = changes(el);
    el.shadowRoot.querySelector(".jf-dp-btn").click();
    await flush();
    const links = [...el.shadowRoot.querySelectorAll(".jf-dp-link")];
    expect(links.find((b) => b.textContent === "Today").disabled).toBe(true);
    expect(el.shadowRoot.querySelector(`button[data-iso="${tomorrow}"]`).getAttribute("tabindex")).toBe("0");
    links.find((b) => b.textContent === "Clear").click();
    await flush();
    expect(seen).toEqual([""]);
  });

  it("falls back to the platform control on touch devices, with the same limits", async () => {
    const el = mount({ forceNative: true, value: "2026-10-15", config: { noPast: true, maxDate: "2027-01-01" } });
    await flush();
    const native = el.shadowRoot.querySelector("input[type=date]");
    expect(native).not.toBeNull();
    expect(native.getAttribute("min")).toBe(todayISO());
    expect(native.getAttribute("max")).toBe("2027-01-01");
    expect(el.shadowRoot.querySelector("button.jf-dp-btn")).toBeNull(); // no popover button
    expect(el.shadowRoot.querySelector(".jf-dp-icon")).not.toBeNull(); // but the same calendar icon
    expect(el.shadowRoot.querySelector(".jf-dp-ph")).toBeNull(); // a value is shown, no placeholder
    const seen = changes(el);
    native.value = "2026-12-24";
    native.dispatchEvent(new Event("change"));
    expect(seen).toEqual(["2026-12-24"]);
    el.value = "";
    await flush();
    expect(el.shadowRoot.querySelector(".jf-dp-ph").textContent).toBe("MM/DD/YYYY"); // iOS leaves an empty control blank
  });
});
