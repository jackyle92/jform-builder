import { createElement } from "lwc";
import JformPreviewPages from "c/jformPreviewPages";

const pages = [
  { key: "p1", number: 1, label: "About you", hidden: false },
  { key: "p2", number: 2, label: "Parking", hidden: true },
  { key: "p3", number: 3, label: "Consent", hidden: false }
];
const flush = () => Promise.resolve();
function mount(props) {
  const el = createElement("c-jform-preview-pages", { is: JformPreviewPages });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}
afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-preview-pages", () => {
  const pills = (el) => [...el.shadowRoot.querySelectorAll(".pp-pill")];
  const step = (el, label) => el.shadowRoot.querySelector(`button[aria-label="${label}"]`);

  it("shows a numbered button per page, marks hidden pages and the one on screen", async () => {
    const el = mount({ pages, current: "p2", multiPage: true });
    await flush();
    expect(pills(el).map((b) => b.textContent)).toEqual(["1", "2", "3", "Thank you"]);
    expect(pills(el)[1].getAttribute("aria-current")).toBe("step");
    expect(pills(el)[0].getAttribute("aria-current")).toBeNull();
    expect(pills(el)[1].getAttribute("aria-label")).toBe("Page 2 of 3: Parking, hidden by a rule");
    expect(pills(el)[1].classList.contains("pp-pill-hidden")).toBe(true);
    expect(el.shadowRoot.querySelector(".pp-name").textContent).toBe("Parking");
    expect(el.shadowRoot.querySelector(".pp-hidden-tag")).not.toBeNull();
    expect(el.shadowRoot.querySelector("select")).toBeNull();
  });

  it("steps with previous and next, and jumps with a page number", async () => {
    const el = mount({ pages, current: "p1", multiPage: true });
    const page = jest.fn();
    el.addEventListener("pagechange", page);
    await flush();
    expect(step(el, "Previous page").disabled).toBe(true);
    step(el, "Next page").click();
    expect(page.mock.calls[0][0].detail).toEqual({ key: "p2" });
    pills(el)[2].click();
    expect(page.mock.calls[1][0].detail).toEqual({ key: "p3" });

    el.current = "p3";
    await flush();
    step(el, "Next page").click();
    expect(page.mock.calls[2][0].detail).toEqual({ key: "__ending" }, "after the last page comes the thank-you screen");

    el.current = "__ending";
    await flush();
    expect(step(el, "Next page").disabled).toBe(true);
    step(el, "Previous page").click();
    expect(page.mock.calls[3][0].detail).toEqual({ key: "p3" });
  });

  it("offers the welcome screen first when the form opens on a start screen", async () => {
    const el = mount({ pages, current: "__welcome", multiPage: true, welcome: true });
    const page = jest.fn();
    el.addEventListener("pagechange", page);
    await flush();
    expect(pills(el).map((b) => b.textContent)).toEqual(["Welcome", "1", "2", "3", "Thank you"]);
    expect(pills(el)[0].getAttribute("aria-current")).toBe("step");
    expect(pills(el)[0].getAttribute("aria-label")).toBe("Welcome screen");
    expect(pills(el)[0].classList.contains("pp-pill-screen")).toBe(true);
    expect(el.shadowRoot.querySelector(".pp-name").textContent).toBe("Welcome screen");
    expect(step(el, "Previous page").disabled).toBe(true);
    step(el, "Next page").click();
    expect(page.mock.calls[0][0].detail).toEqual({ key: "p1" });
  });

  it("ends with the not-yet-open and closed screens when the form opens or closes on its own", async () => {
    const el = mount({ pages, current: "__closed", multiPage: true, notOpen: true, closed: true });
    const page = jest.fn();
    el.addEventListener("pagechange", page);
    await flush();
    expect(pills(el).map((b) => b.textContent)).toEqual(["1", "2", "3", "Thank you", "Not open yet", "Closed"]);
    expect(pills(el)[5].getAttribute("aria-current")).toBe("step");
    expect(el.shadowRoot.querySelector(".pp-name").textContent).toBe("Closed screen");
    step(el, "Previous page").click();
    expect(page.mock.calls[0][0].detail).toEqual({ key: "__notOpen" });

    const plain = mount({ pages, current: "p1", multiPage: true });
    await flush();
    expect(pills(plain).map((b) => b.textContent)).toEqual(["1", "2", "3", "Thank you"]);
  });

  it("keeps a dropdown, with previous and next, for forms with more than eight pages", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ key: `p${i + 1}`, number: i + 1, label: `Page ${i + 1}`, hidden: i === 4 }));
    const el = mount({ pages: many, current: "p5", multiPage: true });
    const page = jest.fn();
    el.addEventListener("pagechange", page);
    await flush();
    expect(pills(el)).toHaveLength(0);
    const options = [...el.shadowRoot.querySelectorAll("option")];
    expect(options[4].textContent).toBe("5. Page 5 (hidden by a rule)");
    expect(options[4].selected).toBe(true);
    expect(el.shadowRoot.querySelector(".pp-position").textContent).toBe("of 10 pages");
    expect(options[options.length - 1].textContent).toBe("Thank-you screen");
    const select = el.shadowRoot.querySelector("select");
    select.value = "p9";
    select.dispatchEvent(new CustomEvent("change"));
    expect(page.mock.calls[0][0].detail).toEqual({ key: "p9" });
    step(el, "Next page").click();
    expect(page.mock.calls[1][0].detail).toEqual({ key: "p6" });
  });

  it("asks for required-field checks", async () => {
    const el = mount({ pages, current: "p1", multiPage: true, checkRequired: false });
    const check = jest.fn();
    el.addEventListener("checkchange", check);
    await flush();
    const toggle = el.shadowRoot.querySelector("lightning-input");
    toggle.checked = true;
    toggle.dispatchEvent(new CustomEvent("change"));
    expect(check.mock.calls[0][0].detail).toEqual({ checked: true });
  });

  it("steps between the form and the thank-you screen for a single-page form", async () => {
    const el = mount({ pages: pages.slice(0, 1), current: "p1", multiPage: false });
    await flush();
    expect(pills(el).map((b) => b.textContent)).toEqual(["Form", "Thank you"]);
    expect(pills(el)[0].getAttribute("aria-label")).toBe("The form");
    expect(el.shadowRoot.querySelector("lightning-input").label).toBe("Check required fields");
  });

  it("shows only the required-fields switch before the renderer reports its pages", async () => {
    const el = mount({ pages: [], multiPage: false });
    await flush();
    expect(el.shadowRoot.querySelector(".pp-pager")).toBeNull();
    expect(el.shadowRoot.querySelector("lightning-input")).not.toBeNull();
  });
});
