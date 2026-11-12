import { createElement } from "lwc";
import JformDesignTab from "c/jformDesignTab";
import createPublicLink from "@salesforce/apex/JFormImageService.createPublicLink";

jest.mock("@salesforce/apex/JFormImageService.createPublicLink", () => ({ default: jest.fn() }), { virtual: true });

const definition = { name: "Form", theme: { preset: "card", labelPosition: "left" }, sections: [{ key: "p1", name: "Page 1", fields: [] }] };

function mount(props) {
  const el = createElement("c-jform-design-tab", { is: JformDesignTab });
  el.definition = definition;
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  window.localStorage.removeItem("jform.designSection");
});

/**
 * The panel opens on its home view (themes and a list of categories). Open a category, and its More options
 * when asked, before looking for its controls.
 */
async function openSection(el, id, more = false) {
  const back = el.shadowRoot.querySelector(".ds-back");
  if (back) {
    back.click();
    await Promise.resolve();
  }
  el.shadowRoot.querySelector(`.ds-nav-row[data-id="${id}"]`).click();
  await Promise.resolve();
  if (more) {
    el.shadowRoot.querySelector(".ds-more").click();
    await Promise.resolve();
  }
}

describe("c-jform-design-tab", () => {
  it("uses independent scrolling only when the workspace is contained", async () => {
    const free = mount({ contained: false });
    await Promise.resolve();
    expect(free.shadowRoot.querySelector(".ds").classList.contains("ds-contained")).toBe(false);
    const contained = mount({ contained: true });
    await Promise.resolve();
    expect(contained.shadowRoot.querySelector(".ds").classList.contains("ds-contained")).toBe(true);
  });

  it("emits theme changes from the segmented controls", async () => {
    const el = mount({});
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    await openSection(el, "fields");
    const underline = [...el.shadowRoot.querySelectorAll("button")].find((b) => b.dataset.prop === "fieldStyle" && b.dataset.value === "underline");
    underline.click();
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ fieldStyle: "underline" });
  });

  it("edits the header alignment and image URLs", async () => {
    const el = mount({});
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    await openSection(el, "header", true);
    const center = [...el.shadowRoot.querySelectorAll("button")].find((b) => b.dataset.prop === "titleAlign" && b.dataset.value === "center");
    center.click();
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ titleAlign: "center" });

    const cover = el.shadowRoot.querySelector('input[data-prop="coverUrl"]');
    cover.value = " https://cdn.example.com/cover.jpg ";
    cover.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[1][0].detail.patch).toEqual({ coverUrl: "https://cdn.example.com/cover.jpg" });
    expect([...el.shadowRoot.querySelectorAll("button")].some((b) => b.dataset.prop === "coverHeight")).toBe(false);
  });

  it("previews images, shows their options and warns when one cannot load", async () => {
    const el = mount({ definition: { ...definition, theme: { ...definition.theme, coverUrl: "https://cdn.example.com/cover.jpg", logoUrl: "https://cdn.example.com/logo.png" } } });
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    await openSection(el, "header", true);
    const buttons = () => [...el.shadowRoot.querySelectorAll("button")];
    const thumb = el.shadowRoot.querySelector('img.ds-thumb-img[data-prop="coverUrl"]');
    expect(thumb.getAttribute("src")).toBe("https://cdn.example.com/cover.jpg");
    expect(el.shadowRoot.querySelector('img.ds-thumb-logo').getAttribute("src")).toBe("https://cdn.example.com/logo.png");
    expect(buttons().some((b) => b.dataset.prop === "coverHeight")).toBe(true);
    expect(buttons().some((b) => b.dataset.prop === "logoSize")).toBe(true);
    expect(buttons().some((b) => b.dataset.prop === "sideImagePosition")).toBe(false);

    thumb.dispatchEvent(new CustomEvent("error"));
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".ds-warn").textContent).toContain("could not be loaded");

    buttons().find((b) => b.dataset.prop === "coverUrl" && b.textContent === "Clear").click();
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ coverUrl: undefined });
  });

  it("turns an uploaded file into a public link and applies it", async () => {
    createPublicLink.mockResolvedValue({ url: "https://org.file.force.com/sfc/dist/version/download/?ids=1", fileName: "logo.png" });
    const el = mount({ definition: { ...definition, id: "a00000000000001AAA" } });
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    // the page image sits with the background; logo, cover and side images with the header
    await openSection(el, "background");
    expect([...el.shadowRoot.querySelectorAll("lightning-file-upload")].map((u) => u.dataset.prop)).toEqual(["backgroundImageUrl"]);
    await openSection(el, "header", true);
    const uploads = el.shadowRoot.querySelectorAll("lightning-file-upload");
    expect([...uploads].map((u) => u.dataset.prop)).toEqual(["logoUrl", "coverUrl", "sideImageUrl"]);
    expect(uploads[0].recordId).toBe("a00000000000001AAA");
    expect(uploads[0].accept).toContain(".png");

    uploads[0].dispatchEvent(new CustomEvent("uploadfinished", { detail: { files: [{ documentId: "069000000000001AAA", name: "logo.png" }] } }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(createPublicLink).toHaveBeenCalledWith({ contentDocumentId: "069000000000001AAA" });
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ logoUrl: "https://org.file.force.com/sfc/dist/version/download/?ids=1" });
  });

  it("shows the server message when the public link cannot be created", async () => {
    createPublicLink.mockRejectedValue({ body: { message: '"notes" is not an image. Upload a PNG, JPG, GIF, WebP or SVG file.' } });
    const el = mount({ definition: { ...definition, id: "a00000000000001AAA" } });
    await Promise.resolve();
    await openSection(el, "header", true);
    const cover = el.shadowRoot.querySelector('lightning-file-upload[data-prop="coverUrl"]');
    cover.dispatchEvent(new CustomEvent("uploadfinished", { detail: { files: [{ documentId: "069000000000002AAA" }] } }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".ds-warn").textContent).toContain("is not an image");
  });

  it("hides the upload buttons until the form has been saved", async () => {
    const el = mount({});
    await Promise.resolve();
    expect(el.shadowRoot.querySelector("lightning-file-upload")).toBeNull();
  });
});

describe("c-jform-design-tab panel", () => {
  it("has a handle that resizes, collapses and restores the design panel", async () => {
    window.localStorage.clear();
    window.innerWidth = 1400;
    const el = mount({ contained: true });
    await Promise.resolve();
    const handle = el.shadowRoot.querySelector(".ds-resizer");
    expect(handle).not.toBeNull();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".ds-panel").getAttribute("style")).toContain("width:336px"); // 320 minimum + one step
    handle.querySelector(".ds-resizer-toggle").click();
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".ds-panel")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("jform.workspace.panels")).design).toEqual({ width: 336, collapsed: true });
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".ds-panel")).not.toBeNull();
  });
});

describe("c-jform-design-tab live preview", () => {
  it("shows the form's pages in the picker and starts with required-field checks off", async () => {
    const el = mount({
      definition: {
        name: "Pages",
        displayStyle: "Multi-Page (Sections)",
        settings: {},
        theme: {},
        sections: [
          { key: "p1", name: "One", fields: [{ key: "a", type: "text", label: "A", required: true }] },
          { key: "p2", name: "Two", fields: [{ key: "b", type: "text", label: "B" }] }
        ]
      }
    });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const bar = el.shadowRoot.querySelector("c-jform-preview-pages");
    expect(bar.pages.map((p) => p.label)).toEqual(["One", "Two"]);
    expect(bar.current).toBe("p1");
    expect(bar.checkRequired).toBe(false);
    expect(el.shadowRoot.querySelector("c-jform-renderer").previewSkipChecks).toBe(true);
    expect(bar.welcome).toBe(false);
  });

  it("opens the preview on the start screen and offers it in the picker", async () => {
    const el = mount({
      definition: {
        name: "Welcome",
        displayStyle: "Multi-Page (Sections)",
        settings: { welcome: { mode: "screen", title: "Hello" } },
        theme: {},
        sections: [
          { key: "p1", name: "One", fields: [{ key: "a", type: "text", label: "A" }] },
          { key: "p2", name: "Two", fields: [{ key: "b", type: "text", label: "B" }] }
        ]
      }
    });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const bar = el.shadowRoot.querySelector("c-jform-preview-pages");
    expect(bar.welcome).toBe(true);
    expect(bar.current).toBe("__welcome");
  });
});

describe("c-jform-design-tab categories", () => {
  afterEach(() => window.localStorage.removeItem("jform.designSection"));
  const rows = (el) => [...el.shadowRoot.querySelectorAll(".ds-nav-row")];

  it("starts on the themes and a list of categories that say what each is set to", async () => {
    const el = mount({ definition: { ...definition, theme: { ...definition.theme, primary: "#5b3df5", background: "#f6f5fb", backgroundStyle: "mesh", buttonShape: "pill" } } });
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".ds-title").textContent).toBe("Design");
    expect(el.shadowRoot.querySelectorAll(".ds-preset")).toHaveLength(7);
    expect(rows(el).map((r) => r.querySelector(".ds-nav-label").textContent)).toEqual(["Colors", "Background", "Fonts", "Fields", "Buttons", "Logo and header", "Layout"]);
    const summary = (id) => el.shadowRoot.querySelector(`.ds-nav-row[data-id="${id}"] .ds-nav-sum`).textContent;
    expect(summary("colors")).toBe("Button #5B3DF5, page #F6F5FB");
    expect(summary("background")).toBe("Mesh page, solid card");
    expect(summary("buttons")).toBe("Filled, pill");
    expect(summary("header")).toBe("No logo, title on the left");
    expect(el.shadowRoot.querySelector(".ds-schemes")).toBeNull();
  });

  it("names the page image in place of the mesh it hides, and the heading font as the Fonts list does", async () => {
    const theme = { ...definition.theme, backgroundStyle: "mesh", surfaceStyle: "glass", backgroundImageUrl: "https://cdn.example.com/bg.jpg", headingFont: "serif" };
    const el = mount({ definition: { ...definition, theme } });
    await Promise.resolve();
    const summary = (id) => el.shadowRoot.querySelector(`.ds-nav-row[data-id="${id}"] .ds-nav-sum`).textContent;
    expect(summary("background")).toBe("Page image, glass card");
    expect(summary("fonts")).toMatch(/^Serif \(Georgia\), /);
  });

  it("opens a category, goes back to its row, and remembers the last category", async () => {
    const el = mount({});
    await Promise.resolve();
    await openSection(el, "colors");
    expect(el.shadowRoot.querySelector(".ds-title").textContent).toBe("Colors");
    expect(el.shadowRoot.activeElement).toBe(el.shadowRoot.querySelector(".ds-title-section"));
    expect(el.shadowRoot.querySelector(".ds-schemes")).not.toBeNull();
    expect([...el.shadowRoot.querySelectorAll(".ds-color-cell .ds-row-label")].map((n) => n.textContent)).toEqual(["Page color", "Form color", "Text color", "Label color", "Button color"]);
    expect(el.shadowRoot.querySelector(".ds-preset")).toBeNull();
    expect(window.localStorage.getItem("jform.designSection")).toBe("colors");
    document.body.removeChild(el);

    const again = mount({});
    await Promise.resolve();
    expect(again.shadowRoot.querySelector(".ds-title").textContent).toBe("Colors");
    again.shadowRoot.querySelector(".ds-back").click();
    await Promise.resolve();
    await Promise.resolve();
    expect(again.shadowRoot.activeElement).toBe(again.shadowRoot.querySelector('.ds-nav-row[data-id="colors"]'));
    expect(window.localStorage.getItem("jform.designSection")).toBeNull();
  });

  it("keeps the settings few forms need under More options", async () => {
    const el = mount({});
    await Promise.resolve();
    await openSection(el, "buttons");
    const props = () => [...el.shadowRoot.querySelectorAll("button[data-prop]")].map((b) => b.dataset.prop).filter((v, i, all) => all.indexOf(v) === i);
    expect(props()).toEqual(["buttonStyle", "buttonShape"]);
    const more = el.shadowRoot.querySelector(".ds-more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.click();
    await Promise.resolve();
    expect(props()).toEqual(["buttonStyle", "buttonShape", "buttonSize", "buttonAlign"]);
    expect(el.shadowRoot.querySelector(".ds-more").getAttribute("aria-expanded")).toBe("true");
    expect(el.shadowRoot.querySelector(".ds-more").textContent).toContain("Fewer options");
  });

  it("applies Drift with its mesh, glass card, pill buttons, segments and spotlight, and other themes set them back", async () => {
    const el = mount({});
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    const drift = el.shadowRoot.querySelector('.ds-preset[data-id="drift"]');
    expect(drift.querySelector(".ds-thumb").getAttribute("style")).toContain("radial-gradient");
    drift.click();
    expect(handler.mock.calls[0][0].detail.patch).toMatchObject({ preset: "drift", primary: "#5b3df5", backgroundStyle: "mesh", surfaceStyle: "glass", buttonShape: "pill", progressStyle: "segments", focusStyle: "spotlight", shadowBlur: 60, shadowDistance: 24, shadowStrength: 24 });
    el.shadowRoot.querySelector('.ds-preset[data-id="teal"]').click();
    const teal = handler.mock.calls[1][0].detail.patch;
    expect(teal).toMatchObject({ preset: "teal", backgroundStyle: "solid", surfaceStyle: "solid", buttonShape: "corners", focusStyle: "none", shadowBlur: 2, shadowDistance: 1, shadowStrength: 4, shadowColor: "" });
    expect(teal).not.toHaveProperty("progressStyle"); // progress is layout: other themes leave it as it is

    el.definition = { ...definition, theme: { ...definition.theme, ...handler.mock.calls[0][0].detail.patch } };
    await openSection(el, "background");
    expect(el.shadowRoot.querySelector('button[data-id="strong"]').getAttribute("aria-pressed")).toBe("true"); // Drift's shadow is Strong
  });

  it("offers the page background, form card, button shape, progress and spotlight one at a time", async () => {
    const el = mount({});
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    const pick = (prop, value) => [...el.shadowRoot.querySelectorAll("button")].find((b) => b.dataset.prop === prop && b.dataset.value === value).click();
    await openSection(el, "background");
    pick("backgroundStyle", "mesh");
    pick("surfaceStyle", "glass");
    await openSection(el, "buttons");
    pick("buttonShape", "pill");
    await openSection(el, "layout");
    pick("progressStyle", "segments");
    await openSection(el, "fields", true);
    pick("focusStyle", "spotlight");
    expect(handler.mock.calls.map((c) => c[0].detail.patch)).toEqual([{ backgroundStyle: "mesh" }, { surfaceStyle: "glass" }, { buttonShape: "pill" }, { progressStyle: "segments" }, { focusStyle: "spotlight" }]);
  });

  it("sets the form shadow by size, or fine-tunes it under More options", async () => {
    const el = mount({});
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    await openSection(el, "background");
    const size = (id) => el.shadowRoot.querySelector(`button[data-id="${id}"]`);
    expect(size("soft").getAttribute("aria-pressed")).toBe("true");
    size("medium").click();
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ shadowBlur: 24, shadowDistance: 12, shadowStrength: 12 });

    el.shadowRoot.querySelector(".ds-more").click();
    await Promise.resolve();
    const blur = el.shadowRoot.querySelector('input[type="range"][data-prop="shadowBlur"]');
    const value = () => blur.parentElement.querySelector(".ds-range-value").textContent;
    expect(value()).toBe("2px");
    blur.value = "40";
    blur.dispatchEvent(new CustomEvent("input"));
    await Promise.resolve();
    expect(value()).toBe("40px"); // the number follows while dragging
    expect(handler).toHaveBeenCalledTimes(1); // and the theme waits for the release
    blur.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[1][0].detail.patch).toEqual({ shadowBlur: 40 });

    const hex = el.shadowRoot.querySelector('input.ds-hex[data-prop="shadowColor"]');
    expect(hex.value).toBe("#000000");
    hex.value = "#5b3df5";
    hex.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[2][0].detail.patch).toEqual({ shadowColor: "#5b3df5" });

    el.definition = { ...definition, theme: { ...definition.theme, shadowBlur: 40, shadowStrength: 4, shadowDistance: 1 } };
    await Promise.resolve();
    expect([...el.shadowRoot.querySelectorAll("button[data-id]")].filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(0); // no size matches
  });

  it("applies a color scheme as colors only and marks it as chosen", async () => {
    const el = mount({});
    const handler = jest.fn();
    el.addEventListener("themechange", handler);
    await Promise.resolve();
    await openSection(el, "colors");
    el.shadowRoot.querySelector('.ds-scheme[data-id="purple"]').click();
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ primary: "#6d28d9", background: "#f5f3ff", surface: "#ffffff", text: "#2e1065", labelColor: "" });
    el.definition = { ...definition, theme: { ...definition.theme, ...handler.mock.calls[0][0].detail.patch } };
    await Promise.resolve();
    expect(el.shadowRoot.querySelector('.ds-scheme[data-id="purple"]').getAttribute("aria-pressed")).toBe("true");
  });
});

describe("c-jform-design-tab page changes", () => {
  it("starts a new page at the top of the preview without moving anything else", async () => {
    const el = mount({});
    await Promise.resolve();
    const renderer = el.shadowRoot.querySelector("c-jform-renderer");
    const stage = el.shadowRoot.querySelector(".ds-stage");
    renderer.dispatchEvent(new CustomEvent("previewstate", { detail: { pages: [{ key: "p1" }, { key: "p2" }], current: "p1", multiPage: true } }));
    await Promise.resolve();
    stage.scrollTop = 300;
    renderer.dispatchEvent(new CustomEvent("previewstate", { detail: { pages: [{ key: "p1" }, { key: "p2" }], current: "p1", multiPage: true } }));
    expect(stage.scrollTop).toBe(300); // same page (an answer changed): stays where it was
    renderer.dispatchEvent(new CustomEvent("previewstate", { detail: { pages: [{ key: "p1" }, { key: "p2" }], current: "p2", multiPage: true } }));
    expect(stage.scrollTop).toBe(0);
    // the page picker has its own row, outside the toolbar with the device buttons
    expect(el.shadowRoot.querySelector(".ds-toolbar c-jform-preview-pages")).toBeNull();
    expect(el.shadowRoot.querySelector("c-jform-preview-pages.ds-preview-pages")).not.toBeNull();
  });
});
