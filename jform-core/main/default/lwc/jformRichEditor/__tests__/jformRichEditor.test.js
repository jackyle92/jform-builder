import { createElement } from "lwc";
import JformRichEditor, { prettyHtml } from "c/jformRichEditor";

function mount(props = {}) {
  const el = createElement("c-jform-rich-editor", { is: JformRichEditor });
  Object.assign(el, { label: "Text", value: "<p>Hello&nbsp;there</p>", ...props });
  document.body.appendChild(el);
  return el;
}
const flush = () => Promise.resolve();
const visual = (el) => el.shadowRoot.querySelector("lightning-input-rich-text");
const html = (el) => el.shadowRoot.querySelector("textarea.re-html");
const toggle = (el) => el.shadowRoot.querySelector(".re-toggle");
afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-rich-editor", () => {
  it("keeps what was typed until the editor is left, even when the stored copy is rewritten", async () => {
    const el = mount();
    const seen = [];
    el.addEventListener("change", (e) => seen.push(e.detail.value));
    await flush();
    expect(visual(el).value).toBe("<p>Hello&nbsp;there</p>");
    visual(el).value = "<p><strong>Hello</strong>&nbsp;there, friends</p>";
    visual(el).dispatchEvent(new CustomEvent("change"));
    expect(seen).toEqual(["<p><strong>Hello</strong>&nbsp;there, friends</p>"]);
    el.value = "<p><strong>Hello</strong> there, friends</p>"; // the server's rewrite after autosave
    await flush();
    expect(visual(el).value).toBe("<p><strong>Hello</strong>&nbsp;there, friends</p>");
    visual(el).dispatchEvent(new CustomEvent("blur"));
    await flush();
    expect(visual(el).value).toBe("<p><strong>Hello</strong> there, friends</p>");
  });

  it("switches to an HTML text area and back, telling the host about the mode", async () => {
    const el = mount();
    const modes = [];
    const seen = [];
    el.addEventListener("modechange", (e) => modes.push(e.detail.mode));
    el.addEventListener("change", (e) => seen.push(e.detail.value));
    await flush();
    expect(html(el)).toBeNull();
    expect(toggle(el).textContent).toBe("Edit as HTML");
    toggle(el).click();
    await flush();
    expect(modes).toEqual(["html"]);
    expect(visual(el)).toBeNull();
    expect(html(el).value).toBe("<p>Hello&nbsp;there</p>");
    expect(prettyHtml("<p>a</p><ul><li>b</li><li>c</li></ul><p>d</p>")).toBe("<p>a</p>\n<ul>\n<li>b</li>\n<li>c</li>\n</ul>\n<p>d</p>");
    expect(prettyHtml("<p>a</p>\n<p>b</p>")).toBe("<p>a</p>\n<p>b</p>"); // already laid out: untouched
    expect(el.shadowRoot.querySelector(".re-hint").textContent).toContain("Scripts and iframes are removed");
    html(el).value = '<table><tr><td style="padding:4px">Cell</td></tr></table>';
    html(el).dispatchEvent(new Event("input"));
    expect(seen).toEqual(['<table><tr><td style="padding:4px">Cell</td></tr></table>']);
    expect(toggle(el).textContent).toBe("Back to the visual editor");
    toggle(el).click();
    await flush();
    expect(modes).toEqual(["html", "visual"]);
    expect(visual(el)).not.toBeNull();
  });

  it("opens in the mode the host persisted", async () => {
    const el = mount({ mode: "html", value: "<p>Raw</p>" });
    await flush();
    expect(html(el)).not.toBeNull();
    expect(html(el).value).toBe("<p>Raw</p>");
    el.mode = "visual";
    await flush();
    expect(visual(el)).not.toBeNull();
  });
});
