import { createElement } from "lwc";
import JformCanvas from "c/jformCanvas";

const definition = {
  sections: [
    { key: "p1", name: "Page 1", fields: [{ key: "a", type: "text", label: "A" }, { key: "b", type: "text", label: "B" }] },
    { key: "p2", name: "Page 2", fields: [{ key: "c", type: "text", label: "C" }] }
  ]
};

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-canvas", () => {
  it("scrolls the selected field into view", async () => {
    const el = createElement("c-jform-canvas", { is: JformCanvas });
    el.definition = definition;
    el.selection = { kind: "field", sectionIndex: 1, fieldIndex: 0 };
    document.body.appendChild(el);
    await Promise.resolve();
    const selected = el.shadowRoot.querySelector(".cv-selected");
    selected.scrollIntoView = jest.fn();
    el.scrollToSelection();
    expect(selected.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("marks Delete and Delete page as the red tools, and only those", async () => {
    const el = createElement("c-jform-canvas", { is: JformCanvas });
    el.definition = definition;
    el.selection = { kind: "field", sectionIndex: 0, fieldIndex: 0 };
    document.body.appendChild(el);
    await Promise.resolve();
    const red = [...el.shadowRoot.querySelectorAll(".cv-tool-delete")].map((b) => b.getAttribute("aria-label"));
    expect(red).toEqual(["Delete page", "Delete", "Delete page"]);
  });

  it("does nothing when nothing is selected", async () => {
    const el = createElement("c-jform-canvas", { is: JformCanvas });
    el.definition = definition;
    el.selection = { kind: null };
    document.body.appendChild(el);
    await Promise.resolve();
    expect(() => el.scrollToSelection()).not.toThrow();
  });

  describe("drop placeholder", () => {
    const flush = () => Promise.resolve();
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
    /** Lays page 1 out: its fields as full-width rows 60px apart, or as given; the grid 600px wide. */
    function layout(el, boxes) {
      const section = el.shadowRoot.querySelector('section[data-si="0"]');
      section.getBoundingClientRect = () => rect(0, 0, 640, 400);
      section.querySelector(".cv-grid").getBoundingClientRect = () => rect(20, 40, 600, 300);
      section.querySelectorAll(".cv-cell").forEach((cell, i) => {
        cell.getBoundingClientRect = () => (boxes ? boxes[i] : rect(20, 50 + i * 60, 600, 50));
      });
      return section;
    }
    function dragEvent(name, { x = 100, y = 100, types = [], data = "" } = {}) {
      const e = new CustomEvent(name, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clientX", { value: x });
      Object.defineProperty(e, "clientY", { value: y });
      e.dataTransfer = { types, dropEffect: "", effectAllowed: "", getData: () => data, setData: jest.fn() };
      return e;
    }
    const fromPalette = (type) => ["text/plain", `application/x-jform-type-${type}`];
    const order = (el) => Array.from(el.shadowRoot.querySelectorAll('section[data-si="0"] .cv-grid > div')).map((d) => (d.classList.contains("cv-placeholder") ? "*" : d.dataset.fi));
    async function mount(def = definition) {
      const el = createElement("c-jform-canvas", { is: JformCanvas });
      el.definition = def;
      el.selection = { kind: null };
      document.body.appendChild(el);
      await flush();
      return el;
    }

    it("shows a placeholder between the fields the pointer is over, sized for the incoming type", async () => {
      const el = await mount();
      const section = layout(el);
      section.dispatchEvent(dragEvent("dragover", { y: 115, types: fromPalette("comment") })); // lower half of the first row
      await flush();
      expect(order(el)).toEqual(["0", "*", "1"]);
      const ph = el.shadowRoot.querySelector(".cv-placeholder");
      expect(ph.textContent).toContain("Paragraph");
      expect(ph.querySelector("img.cv-ph-icon").getAttribute("src")).toBe("jformFieldIcons/comment.svg");
      expect(ph.getAttribute("style")).toContain("132px");
      expect(section.classList.contains("cv-dragover")).toBe(true);

      layout(el);
      section.dispatchEvent(dragEvent("dragover", { y: 55, types: fromPalette("comment") })); // upper half of the first row
      await flush();
      expect(order(el)).toEqual(["*", "0", "1"]);
    });

    it("works across a shared row by left and right halves", async () => {
      const half = { sections: [{ key: "p1", fields: [{ key: "a", type: "text", label: "A", width: 50 }, { key: "b", type: "text", label: "B", width: 50 }] }] };
      const el = await mount(half);
      const section = layout(el, [rect(20, 50, 290, 50), rect(330, 50, 290, 50)]);
      section.dispatchEvent(dragEvent("dragover", { x: 250, y: 70, types: fromPalette("text") })); // right half of A
      await flush();
      expect(order(el)).toEqual(["0", "*", "1"]);
      layout(el, [rect(20, 50, 290, 50), rect(330, 50, 290, 50)]);
      section.dispatchEvent(dragEvent("dragover", { x: 600, y: 70, types: fromPalette("text") })); // right half of B
      await flush();
      expect(order(el)).toEqual(["0", "1", "*"]);
    });

    it("removes the placeholder when the drag leaves the page, but not when it crosses into a field", async () => {
      const el = await mount();
      const section = layout(el);
      section.dispatchEvent(dragEvent("dragover", { y: 115, types: fromPalette("text") }));
      await flush();
      section.dispatchEvent(dragEvent("dragleave", { x: 100, y: 120 })); // still inside the page
      await flush();
      expect(el.shadowRoot.querySelector(".cv-placeholder")).not.toBeNull();
      section.dispatchEvent(dragEvent("dragleave", { x: 700, y: 120 })); // outside
      await flush();
      expect(el.shadowRoot.querySelector(".cv-placeholder")).toBeNull();
      expect(section.classList.contains("cv-dragover")).toBe(false);
    });

    it("drops the new field where the placeholder was and clears it", async () => {
      const el = await mount();
      const handler = jest.fn();
      el.addEventListener("insert", handler);
      const section = layout(el);
      section.dispatchEvent(dragEvent("dragover", { y: 115, types: fromPalette("comment") }));
      await flush();
      section.dispatchEvent(dragEvent("drop", { y: 115, types: fromPalette("comment"), data: "jform-type:comment" }));
      await flush();
      expect(handler.mock.calls[0][0].detail).toEqual({ sectionIndex: 0, index: 1, type: "comment" });
      expect(el.shadowRoot.querySelector(".cv-placeholder")).toBeNull();
    });

    it("moves a canvas field to the placeholder, fading the original while it is dragged", async () => {
      const el = await mount();
      const handler = jest.fn();
      el.addEventListener("movefieldto", handler);
      let section = layout(el);
      const first = section.querySelector('.cv-cell[data-fi="0"]');
      first.dispatchEvent(dragEvent("dragstart"));
      await flush();
      expect(el.shadowRoot.querySelector('.cv-cell[data-fi="0"]').classList.contains("cv-dragging")).toBe(true);
      section = layout(el);
      section.dispatchEvent(dragEvent("dragover", { y: 175 })); // lower half of the second row
      await flush();
      expect(order(el)).toEqual(["0", "1", "*"]);
      section.dispatchEvent(dragEvent("drop", { y: 175, data: "jform-move:0:0" }));
      await flush();
      expect(handler.mock.calls[0][0].detail).toEqual({ from: { sectionIndex: 0, fieldIndex: 0 }, to: { sectionIndex: 0, index: 2 } });
      expect(el.shadowRoot.querySelector(".cv-dragging")).toBeNull();
    });

    it("ignores drags that are not JForm fields", async () => {
      const el = await mount();
      const section = layout(el);
      const e = dragEvent("dragover", { y: 115, types: ["Files"] });
      section.dispatchEvent(e);
      await flush();
      expect(e.defaultPrevented).toBe(false);
      expect(el.shadowRoot.querySelector(".cv-placeholder")).toBeNull();
    });

    it("clears a palette drag that ends anywhere else", async () => {
      const el = await mount();
      const section = layout(el);
      section.dispatchEvent(dragEvent("dragover", { y: 115, types: fromPalette("text") }));
      await flush();
      window.dispatchEvent(new CustomEvent("dragend"));
      await flush();
      expect(el.shadowRoot.querySelector(".cv-placeholder")).toBeNull();
    });
  });

  it("draws a tall field over its rows, as on the form", async () => {
    const el = createElement("c-jform-canvas", { is: JformCanvas });
    el.definition = { sections: [{ key: "p1", fields: [{ key: "a", type: "text", label: "A", width: 50 }, { key: "e", type: "event", label: "E", width: 50, config: { rowSpan: 2 } }] }] };
    el.selection = { kind: null };
    document.body.appendChild(el);
    await Promise.resolve();
    expect(el.shadowRoot.querySelector('.cv-cell[data-fi="1"]').className).toContain("cv-tall cv-rows-2");
  });
});


describe("c-jform-canvas options per row", () => {
  const mountWith = async (theme) => {
    const el = createElement("c-jform-canvas", { is: JformCanvas });
    el.definition = { ...definition, theme };
    el.selection = { kind: null };
    document.body.appendChild(el);
    await Promise.resolve();
    return el.shadowRoot.querySelector(".cv").getAttribute("style");
  };

  it("lays choices out as the form design does, so the builder matches the preview", async () => {
    expect(await mountWith({ choiceStyle: "cards" })).toBe("--jf-choice-cols: repeat(auto-fill, minmax(11rem, 1fr))");
    expect(await mountWith({ choiceStyle: "list" })).toBe("--jf-choice-cols: minmax(0, 1fr)");
  });
});

describe("c-jform-canvas welcome and thank-you cards", () => {
  const mountWith = async (extra) => {
    const el = createElement("c-jform-canvas", { is: JformCanvas });
    el.definition = { ...definition, label: "Clinic registration", ...extra };
    el.selection = { kind: null };
    document.body.appendChild(el);
    await Promise.resolve();
    return el;
  };
  const card = (el, label) => el.shadowRoot.querySelector(`section[aria-label="${label}"]`);
  const message = '<h1 class="ql-align-center">Request an appointment</h1><p class="ql-align-center">Welcome!</p>';

  it("draws the start screen as the preview does: image, title, the message as formatted, Start and the time", async () => {
    const el = await mountWith({
      welcomeMessage: message,
      theme: { primary: "#1d4ed8", titleAlign: "center", coverUrl: "https://cdn.example.com/cover.jpg", logoUrl: "/logo.png" },
      settings: { welcome: { mode: "screen", buttonLabel: "Begin", showTime: true } }
    });
    const welcome = card(el, "Welcome screen settings");
    expect(welcome.querySelector(".cv-screen-image").getAttribute("src")).toBe("https://cdn.example.com/cover.jpg");
    expect(welcome.querySelector(".cv-screen-logo").getAttribute("src")).toBe("/logo.png");
    expect(welcome.querySelector(".cv-screen-title").textContent).toBe("Clinic registration");
    expect(welcome.querySelector("lightning-formatted-rich-text").value).toBe(message); // the HTML, not a plain-text summary
    expect(welcome.querySelector(".cv-screen-button").textContent.trim()).toBe("Begin");
    expect(welcome.querySelector(".cv-screen-time").textContent.trim()).toBe("Takes about 1 minute");
    expect(welcome.querySelector(".cv-screen-body").classList.contains("cv-screen-center")).toBe(true);
    expect(welcome.getAttribute("style")).toContain("--cv-screen-btn-bg: #1d4ed8");
    expect(welcome.getAttribute("style")).toContain("--cv-screen-font:");
  });

  it("shows a welcome message above the form as formatted text, and says when there is none", async () => {
    let el = await mountWith({ welcomeMessage: message });
    expect(card(el, "Welcome screen settings").querySelector("lightning-formatted-rich-text").value).toBe(message);
    document.body.removeChild(el);
    el = await mountWith({ welcomeMessage: "<p></p>", settings: { welcome: { mode: "message" } } });
    expect(card(el, "Welcome screen settings").querySelector(".cv-screen-muted").textContent).toBe("No message yet. Select to write one.");
  });

  it("draws the thank-you screen with its buttons in the preview's order and styles", async () => {
    const el = await mountWith({
      thankYouMessage: "<p><strong>Thanks!</strong></p>",
      settings: { ending: { title: "All done", buttons: [{ label: "Home", url: "https://example.com" }, { label: "Blog", url: "https://example.com/blog" }], submitAnother: true, redirectUrl: "https://example.com/next", redirectDelay: 5 } }
    });
    const ending = card(el, "Thank-you screen settings");
    expect(ending.querySelector(".cv-screen-title").textContent).toBe("All done");
    expect(ending.querySelector("lightning-formatted-rich-text").value).toBe("<p><strong>Thanks!</strong></p>");
    const buttons = [...ending.querySelectorAll(".cv-screen-button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Home", "Blog", "Submit another response"]);
    expect(buttons.map((b) => b.classList.contains("cv-screen-button-plain"))).toEqual([false, true, true]);
    expect(ending.querySelector(".cv-screen-note").textContent).toBe("Then goes to example.com after 5 s");
  });

  it("falls back to the standard thank-you sentence", async () => {
    const el = await mountWith({ thankYouMessage: "" });
    expect(card(el, "Thank-you screen settings").querySelector("lightning-formatted-rich-text").value).toBe("<p>Thank you. Your response has been recorded.</p>");
  });
});

describe("c-jform-canvas Add field here", () => {
  const flush = () => Promise.resolve();
  async function mount() {
    const el = createElement("c-jform-canvas", { is: JformCanvas });
    el.definition = definition;
    el.selection = { kind: null };
    document.body.appendChild(el);
    await flush();
    return el;
  }
  const insertButton = (el, si) => el.shadowRoot.querySelector(`.cv-insert[data-si="${si}"]`);
  const menu = (el) => el.shadowRoot.querySelector(".cv-menu");

  it("opens a menu of field types instead of adding a text field", async () => {
    const el = await mount();
    const handler = jest.fn();
    el.addEventListener("insert", handler);
    insertButton(el, 1).click();
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(menu(el)).not.toBeNull();
    expect(menu(el).closest('section[data-si="1"]')).not.toBeNull();
    expect(insertButton(el, 1)).toBeNull(); // the menu takes the button's place
    const types = Array.from(el.shadowRoot.querySelectorAll(".cv-menu-option")).map((b) => b.dataset.type);
    expect(types).toEqual(expect.arrayContaining(["text", "email", "date", "radio"]));
    expect(el.shadowRoot.querySelector(".cv-menu-heading")).not.toBeNull();
  });

  it("adds the picked type at the end of that page and closes", async () => {
    const el = await mount();
    const handler = jest.fn();
    el.addEventListener("insert", handler);
    insertButton(el, 0).click();
    await flush();
    el.shadowRoot.querySelector('.cv-menu-option[data-type="email"]').click();
    await flush();
    expect(handler.mock.calls[0][0].detail).toEqual({ sectionIndex: 0, index: 2, type: "email" });
    expect(menu(el)).toBeNull();
    expect(insertButton(el, 0)).not.toBeNull();
  });

  it("narrows the list as you search, and says when nothing matches", async () => {
    const el = await mount();
    insertButton(el, 0).click();
    await flush();
    const search = el.shadowRoot.querySelector(".cv-menu-search");
    search.value = "date";
    search.dispatchEvent(new CustomEvent("change"));
    await flush();
    const types = Array.from(el.shadowRoot.querySelectorAll(".cv-menu-option")).map((b) => b.dataset.type);
    expect(types).toContain("date");
    expect(types).not.toContain("email");
    search.value = "zzzz";
    search.dispatchEvent(new CustomEvent("change"));
    await flush();
    expect(el.shadowRoot.querySelectorAll(".cv-menu-option").length).toBe(0);
    expect(el.shadowRoot.querySelector(".cv-menu-empty")).not.toBeNull();
  });

  it("closes on Escape or Cancel without adding anything", async () => {
    const el = await mount();
    const handler = jest.fn();
    el.addEventListener("insert", handler);
    insertButton(el, 0).click();
    await flush();
    menu(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(menu(el)).toBeNull();
    insertButton(el, 0).click();
    await flush();
    menu(el).querySelector("lightning-button-icon").click();
    await flush();
    expect(menu(el)).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("stays on its page when pages move, and closes when its page is deleted", async () => {
    const el = await mount();
    const handler = jest.fn();
    el.addEventListener("insert", handler);
    insertButton(el, 1).click();
    await flush();
    // Page 2 moves up: the menu goes with it, and a pick adds the field to Page 2 in its new place
    el.definition = { sections: [definition.sections[1], definition.sections[0]] };
    await flush();
    expect(menu(el).closest('section[data-si="0"]')).not.toBeNull();
    el.shadowRoot.querySelector('.cv-menu-option[data-type="date"]').click();
    expect(handler.mock.calls[0][0].detail).toEqual({ sectionIndex: 0, index: 1, type: "date" });

    insertButton(el, 1).click();
    await flush();
    el.definition = { sections: [definition.sections[1]] };
    await flush();
    await flush();
    expect(menu(el)).toBeNull();
    // a page added later does not come with the menu open
    el.definition = { sections: [definition.sections[1], { key: "p3", name: "Page 3", fields: [] }] };
    await flush();
    expect(menu(el)).toBeNull();
  });

  it("puts the keyboard back on the page's Add field here button after a pick", async () => {
    const el = await mount();
    insertButton(el, 0).click();
    await flush();
    el.shadowRoot.querySelector('.cv-menu-option[data-type="email"]').click();
    await flush();
    await flush();
    expect(el.shadowRoot.activeElement).toBe(insertButton(el, 0));
  });

  it("closes when you click elsewhere on the canvas", async () => {
    const el = await mount();
    insertButton(el, 0).click();
    await flush();
    el.shadowRoot.querySelector('[data-si="1"][data-fi="0"]').click();
    await flush();
    expect(menu(el)).toBeNull();
    // another page's button closes this menu and opens its own
    insertButton(el, 0).click();
    await flush();
    insertButton(el, 1).click();
    await flush();
    expect(el.shadowRoot.querySelectorAll(".cv-menu")).toHaveLength(1);
    expect(menu(el).closest('section[data-si="1"]')).not.toBeNull();
  });

  it("is a plain button, not a menu button", async () => {
    const el = await mount();
    expect(insertButton(el, 0).getAttribute("aria-haspopup")).toBeNull();
  });

  it("keeps clicks inside the menu from clearing the selection behind it", async () => {
    const el = await mount();
    const handler = jest.fn();
    el.addEventListener("select", handler);
    insertButton(el, 0).click();
    await flush();
    el.shadowRoot.querySelector(".cv-menu-search").click();
    expect(handler).not.toHaveBeenCalled();
  });
});
