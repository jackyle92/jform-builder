import { createElement } from "lwc";
import JformPhoneInput from "c/jformPhoneInput";

const flush = () => Promise.resolve();

function mount(props = {}) {
  const el = createElement("c-jform-phone-input", { is: JformPhoneInput });
  Object.assign(el, { config: { countryPicker: true, defaultCountry: "AU" } }, props);
  const changes = [];
  el.addEventListener("change", (e) => changes.push(e.detail.value));
  document.body.appendChild(el);
  return { el, changes };
}
const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
/** Types into the number box as the browser would: value first, then an input event of the given kind. */
function type(el, value, inputType = "insertText") {
  const input = $(el, ".jf-ph-input");
  input.value = value;
  const event = new Event("input", { bubbles: true, composed: true });
  Object.defineProperty(event, "inputType", { value: inputType });
  input.dispatchEvent(event);
  return input;
}
function key(target, k) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}
const buttonText = (el) => $(el, ".jf-ph-dial").textContent;

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  jest.restoreAllMocks();
});

describe("c-jform-phone-input", () => {
  it("starts in the field's default country with a sample number as the placeholder", async () => {
    const { el } = mount();
    await flush();
    expect(buttonText(el)).toBe("+61");
    expect($(el, ".jf-ph-flag").getAttribute("style")).toContain("background-position");
    expect($(el, ".jf-ph-country").getAttribute("aria-label")).toBe("Country code: Australia +61");
    expect($(el, ".jf-ph-input").placeholder).toBe("0412 345 678");
  });

  it("starts in the visitor's country when detection is on", async () => {
    jest.spyOn(Intl, "DateTimeFormat").mockImplementation(() => ({ resolvedOptions: () => ({ timeZone: "Asia/Tokyo" }) }));
    const { el } = mount({ config: { countryPicker: true, defaultCountry: "AU", detectCountry: true }, detect: true });
    await flush();
    expect(buttonText(el)).toBe("+81");
  });

  it("formats the number as it is typed and sends the international number", async () => {
    const { el, changes } = mount();
    await flush();
    const input = type(el, "0412345678");
    expect(input.value).toBe("0412 345 678");
    expect(changes.at(-1)).toBe("+61412345678");
    type(el, "");
    expect(changes.at(-1)).toBe("");
  });

  it("shows a stored answer in its own country", async () => {
    const { el, changes } = mount({ value: "+84912345678" });
    await flush();
    expect(buttonText(el)).toBe("+84");
    expect($(el, ".jf-ph-input").value).toBe("0912 345 678");
    expect(changes).toEqual([]);
  });

  it("stores a prefilled number without its code in international format", async () => {
    const { changes } = mount({ value: "0412 345 678" });
    await flush();
    expect(changes).toEqual(["+61412345678"]);
  });

  it("switches to the country of a pasted international number", async () => {
    const { el, changes } = mount();
    await flush();
    const input = type(el, "+84 912 345 678", "insertFromPaste");
    await flush();
    expect(buttonText(el)).toBe("+84");
    expect(input.value).toBe("0912 345 678");
    expect(changes.at(-1)).toBe("+84912345678");
  });

  it("searches the list and picks with the keyboard, keeping the digits typed", async () => {
    const { el, changes } = mount();
    await flush();
    type(el, "0912345678");
    $(el, ".jf-ph-country").click();
    await flush();
    const search = $(el, ".jf-ph-search");
    expect(search).not.toBeNull();
    expect($$(el, ".jf-ph-option")).toHaveLength(51);
    expect($(el, ".jf-ph-active .jf-ph-name").textContent).toBe("Australia");
    search.value = "viet";
    search.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect($$(el, ".jf-ph-option .jf-ph-name").map((n) => n.textContent)).toEqual(["Vietnam", "Other country"]);
    key(search, "Enter");
    await flush();
    expect($(el, ".jf-ph-pop")).toBeNull();
    expect(buttonText(el)).toBe("+84");
    expect(changes.at(-1)).toBe("+84912345678");
  });

  it("finds countries by calling code and offers Other country for the rest", async () => {
    const { el, changes } = mount();
    await flush();
    $(el, ".jf-ph-country").click();
    await flush();
    const search = $(el, ".jf-ph-search");
    search.value = "+44";
    search.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect($$(el, ".jf-ph-option .jf-ph-name").map((n) => n.textContent)).toEqual(["United Kingdom", "Other country"]);
    search.value = "nepal";
    search.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect($(el, ".jf-ph-empty")).not.toBeNull();
    $(el, '.jf-ph-option[data-iso="OTHER"]').click();
    await flush();
    expect($(el, ".jf-ph-globe")).not.toBeNull();
    expect($(el, ".jf-ph-input").value).toBe("+");
    type(el, "+977 1 4123456");
    expect(changes.at(-1)).toBe("+97714123456");
  });

  it("closes on Escape and returns focus to the country button", async () => {
    const { el } = mount();
    await flush();
    $(el, ".jf-ph-country").click();
    await flush();
    key($(el, ".jf-ph-search"), "Escape");
    await flush();
    await flush();
    expect($(el, ".jf-ph-pop")).toBeNull();
    expect(el.shadowRoot.activeElement).toBe($(el, ".jf-ph-country"));
  });

  it("closes on a press outside, and leaves the search box alone after a tap on a touch screen", async () => {
    const { el } = mount();
    await flush();
    $(el, ".jf-ph-country").click();
    await flush();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await flush();
    expect($(el, ".jf-ph-pop")).toBeNull();
    window.matchMedia = jest.fn(() => ({ matches: true })); // pointer: coarse
    $(el, ".jf-ph-country").dispatchEvent(new MouseEvent("click", { detail: 1 }));
    await flush();
    await flush();
    expect($(el, ".jf-ph-pop")).not.toBeNull();
    expect(el.shadowRoot.activeElement).not.toBe($(el, ".jf-ph-search"));
    $(el, ".jf-ph-option").dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true })); // inside: stays open
    await flush();
    expect($(el, ".jf-ph-pop")).not.toBeNull();
    delete window.matchMedia;
  });

  it("follows the builder's default country while empty and stays inert when disabled", async () => {
    const { el } = mount({ disabled: true });
    await flush();
    expect($(el, ".jf-ph-country").disabled).toBe(true);
    expect($(el, ".jf-ph-input").disabled).toBe(true);
    expect($(el, ".jf-ph-control").className).toContain("jf-ph-disabled");
    el.inert = true;
    await flush();
    expect($(el, ".jf-ph-control").className).not.toContain("jf-ph-disabled"); // the builder canvas: not faded
    el.config = { countryPicker: true, defaultCountry: "VN" };
    await flush();
    await flush();
    expect(buttonText(el)).toBe("+84");
  });
});
