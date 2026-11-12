import { createElement } from "lwc";
import JformPalette from "c/jformPalette";

const OPEN_DELAY = 350;
const CLOSE_DELAY = 200;

const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

function mount() {
  const el = createElement("c-jform-palette", { is: JformPalette });
  document.body.appendChild(el);
  return el;
}
const tile = (el, type) => el.shadowRoot.querySelector(`.pal-item[data-type="${type}"]`);
const card = (el) => el.shadowRoot.querySelector(".pal-card");

async function hover(el, type) {
  tile(el, type).dispatchEvent(new CustomEvent("mouseenter"));
  jest.advanceTimersByTime(OPEN_DELAY);
  await tick();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-palette: preview card", () => {
  it("opens after a pause on hover with what the field is, an example and look-alikes", async () => {
    const el = mount();
    await tick();
    tile(el, "picklist").dispatchEvent(new CustomEvent("mouseenter"));
    await tick();
    expect(card(el)).toBeNull(); // not while the pointer is just passing over

    jest.advanceTimersByTime(OPEN_DELAY);
    await tick();
    const c = card(el);
    expect(c.querySelector(".pal-card-title").textContent).toBe("Dropdown");
    expect(c.querySelector(".pal-card-desc").textContent).toMatch(/list that opens/);
    const example = c.querySelector("c-jform-field");
    expect(example.field.type).toBe("picklist");
    expect(example.field.label).toBe("Country");
    expect(example.mode).toBe("edit");
    expect([...c.querySelectorAll(".pal-chip")].map((b) => b.dataset.type)).toEqual(["radio", "checkboxes"]);
    expect(tile(el, "picklist").classList.contains("pal-item-active")).toBe(true);
  });

  it("switches at once between tiles while open, and to a look-alike from the card", async () => {
    const el = mount();
    await tick();
    await hover(el, "picklist");
    tile(el, "picklist").dispatchEvent(new CustomEvent("mouseleave"));
    tile(el, "rating").dispatchEvent(new CustomEvent("mouseenter"));
    await tick();
    expect(card(el).querySelector(".pal-card-title").textContent).toBe("Rating");

    card(el).querySelector('.pal-chip[data-type="nps"]').click();
    await tick();
    expect(card(el).querySelector(".pal-card-title").textContent).toBe("NPS");
    expect(card(el).querySelector("c-jform-field").value).toBe("9");
  });

  it("stays open while the pointer moves into the card and closes once it leaves", async () => {
    const el = mount();
    await tick();
    await hover(el, "text");
    tile(el, "text").dispatchEvent(new CustomEvent("mouseleave"));
    card(el).dispatchEvent(new CustomEvent("mouseenter"));
    jest.advanceTimersByTime(CLOSE_DELAY);
    await tick();
    expect(card(el)).not.toBeNull();

    card(el).dispatchEvent(new CustomEvent("mouseleave"));
    jest.advanceTimersByTime(CLOSE_DELAY);
    await tick();
    expect(card(el)).toBeNull();
  });

  it("adds the field from the card's button and closes", async () => {
    const el = mount();
    const inserted = jest.fn();
    el.addEventListener("insert", (e) => inserted(e.detail));
    await tick();
    await hover(el, "consent");
    expect(card(el).querySelector(".pal-add").textContent).toBe("Add Consent");
    card(el).querySelector(".pal-add").click();
    await tick();
    expect(inserted).toHaveBeenCalledWith({ type: "consent" });
    expect(card(el)).toBeNull();
  });

  it("shows a note instead of an example for fields with nothing to fill in", async () => {
    const el = mount();
    await tick();
    await hover(el, "hidden");
    expect(card(el).querySelector("c-jform-field")).toBeNull();
    expect(card(el).querySelector(".pal-card-note").textContent).toMatch(/Nothing shows on the form/);
  });

  it("shows a picture of a table, with one answer marked per row", async () => {
    const el = mount();
    await tick();
    await hover(el, "table");
    expect(card(el).querySelector("c-jform-field")).toBeNull();
    const pic = card(el).querySelector(".pal-pic");
    expect(pic.getAttribute("role")).toBe("img");
    expect(pic.getAttribute("aria-label")).toBe("How would you rate our: a table with the rows Service, Prices, Delivery and the columns Poor, Okay, Great");
    expect([...pic.querySelectorAll(".pal-pic-col")].map((c) => c.textContent)).toEqual(["Poor", "Okay", "Great"]);
    const rows = [...pic.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.querySelector(".pal-pic-row").textContent)).toEqual(["Service", "Prices", "Delivery"]);
    expect(rows.map((r) => r.querySelectorAll(".pal-pic-on").length)).toEqual([1, 1, 1]);
  });

  it("opens for keyboard focus and closes on Escape", async () => {
    const el = mount();
    await tick();
    // jsdom has no focus-visible heuristics: treat this focus as coming from the keyboard
    const date = tile(el, "date");
    date.matches = (selector) => selector === ":focus-visible" || Element.prototype.matches.call(date, selector);
    date.dispatchEvent(new CustomEvent("focus"));
    await tick();
    expect(card(el).querySelector(".pal-card-title").textContent).toBe("Date");
    tile(el, "date").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(card(el)).toBeNull();
  });

  it("opens the card at once on click and adds nothing", async () => {
    const el = mount();
    const inserted = jest.fn();
    el.addEventListener("insert", (e) => inserted(e.detail));
    await tick();
    tile(el, "email").click();
    await tick();
    expect(card(el).querySelector(".pal-card-title").textContent).toBe("Email");
    expect(tile(el, "email").getAttribute("aria-expanded")).toBe("true");
    expect(inserted).not.toHaveBeenCalled();
  });

  it("opens the card on Enter, moves to Add, and Escape goes back to the tile", async () => {
    const el = mount();
    const inserted = jest.fn();
    el.addEventListener("insert", (e) => inserted(e.detail));
    await tick();
    // keyboard focus counts as focus-visible, so a tile that gets focus back must not reopen its card
    const time = tile(el, "time");
    time.matches = (selector) => selector === ":focus-visible" || Element.prototype.matches.call(time, selector);
    time.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await tick();
    expect(inserted).not.toHaveBeenCalled();
    const add = card(el).querySelector(".pal-add");
    expect(el.shadowRoot.activeElement).toBe(add);

    add.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(card(el)).toBeNull();
    expect(el.shadowRoot.activeElement).toBe(tile(el, "time"));
  });

  it("closes when a tile is dragged", async () => {
    const el = mount();
    await tick();
    await hover(el, "phone");
    const drag = new CustomEvent("dragstart");
    drag.dataTransfer = { setData: jest.fn() };
    tile(el, "phone").dispatchEvent(drag);
    await tick();
    expect(card(el)).toBeNull();
  });
});

describe("c-jform-palette: search", () => {
  const search = async (el, text) => {
    const input = el.shadowRoot.querySelector("lightning-input");
    input.value = text;
    input.dispatchEvent(new CustomEvent("change"));
    await tick();
  };

  it("finds a field by what it is for, not only by name", async () => {
    const el = mount();
    await tick();
    await search(el, "country");
    // Phone mentions its country code picker, Address its country
    expect([...el.shadowRoot.querySelectorAll(".pal-item")].map((t) => t.dataset.type)).toEqual(["phone", "picklist", "address"]);
    await search(el, "agree");
    expect([...el.shadowRoot.querySelectorAll(".pal-item")].map((t) => t.dataset.type)).toEqual(["consent"]);
  });

  it("finds Checkboxes for multi-select, which is retired", async () => {
    const el = mount();
    await tick();
    await search(el, "multi");
    expect([...el.shadowRoot.querySelectorAll(".pal-item")].map((t) => t.dataset.type)).toEqual(["checkboxes"]);
  });

  it("says so when nothing matches", async () => {
    const el = mount();
    await tick();
    await search(el, "zzzz");
    expect(el.shadowRoot.querySelectorAll(".pal-item").length).toBe(0);
    expect(el.shadowRoot.querySelector(".pal-empty")).not.toBeNull();
  });

  it("gives every tile its description for screen readers", async () => {
    const el = mount();
    await tick();
    expect(tile(el, "yesno").querySelector(".pal-sr").textContent).toBe(": A quick yes or no.");
  });
});
