import { createElement } from "lwc";
import JformShareModal from "c/jformShareModal";

const sites = [
  { id: "0DM1", name: "jform1", label: "jform", siteType: "ChatterNetworkPicasso", baseUrl: "https://acme.my.site.com/jform", isExperienceSite: true },
  { id: "0DM2", name: "vf", label: "VF site", siteType: "Visualforce", baseUrl: "https://acme.my.salesforce-sites.com/vf", isExperienceSite: false }
];

const live = (overrides = {}) => ({
  id: "a00",
  name: "Summer Clinic",
  label: "Register for the Summer Clinic",
  isActive: true,
  version: 2,
  publicKey: "K7f3xQ",
  settings: {},
  ...overrides
});

function mount(definition, siteList = sites) {
  const el = createElement("c-jform-share-modal", { is: JformShareModal });
  el.definition = definition;
  el.sites = siteList;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-share-modal", () => {
  it("builds the public link from the first Experience site and the default page path", async () => {
    const el = mount(live());
    await Promise.resolve();
    const url = el.shadowRoot.querySelector("input.sh-input");
    expect(url.value).toBe("https://acme.my.site.com/jform/form?key=K7f3xQ");
    expect(el.shadowRoot.querySelectorAll("input.sh-input")[1].value).toContain("/lightning/n/JForm_Preview?c__key=K7f3xQ");
  });

  it("honours the saved site and page path", async () => {
    const el = mount(live({ settings: { publish: { siteId: "0DM2", pagePath: "/s/form" } } }));
    await Promise.resolve();
    expect(el.shadowRoot.querySelector("input.sh-input").value).toBe("https://acme.my.salesforce-sites.com/vf/s/form?key=K7f3xQ");
  });

  it("produces an embed snippet with the resize script", async () => {
    const el = mount(live());
    await Promise.resolve();
    el.shadowRoot.querySelector('button[data-tab="embed"]').click();
    await Promise.resolve();
    const snippet = el.shadowRoot.querySelector("textarea.sh-code").value;
    expect(snippet).toContain('src="https://acme.my.site.com/jform/form?key=K7f3xQ&embed=1"');
    expect(snippet).toContain('id="jform-K7f3xQ"');
    expect(snippet).toContain("jform:height");
    expect(snippet).toContain('e.origin==="https://acme.my.site.com"');
  });

  it("lets the form move the page after the thank-you screen, only to an http(s) link from its own site", async () => {
    const el = mount(live());
    await Promise.resolve();
    el.shadowRoot.querySelector('button[data-tab="embed"]').click();
    await Promise.resolve();
    const snippet = el.shadowRoot.querySelector("textarea.sh-code").value;
    const script = snippet.slice(snippet.indexOf("<script>") + 8, snippet.indexOf("</script>"));
    let listener;
    const frame = { style: {} };
    const location = { href: "https://host.example.com/page" };
    // run the pasted script against a stand-in page
    new Function("window", "document", script)(
      { addEventListener: (type, fn) => (listener = fn), location },
      { getElementById: () => frame }
    );
    const from = (origin, data) => listener({ origin, data });
    from("https://acme.my.site.com", { type: "jform:height", key: "K7f3xQ", height: 400 });
    expect(frame.style.height).toBe("408px");
    from("https://evil.example.com", { type: "jform:redirect", key: "K7f3xQ", url: "https://evil.example.com" });
    from("https://acme.my.site.com", { type: "jform:redirect", key: "K7f3xQ", url: "javascript:alert(1)" });
    from("https://acme.my.site.com", { type: "jform:redirect", key: "other", url: "https://example.com/other" });
    expect(location.href).toBe("https://host.example.com/page");
    from("https://acme.my.site.com", { type: "jform:redirect", key: "K7f3xQ", url: "https://example.com/next" });
    expect(location.href).toBe("https://example.com/next");
  });

  it("escapes the form name in the snippet's title attribute", async () => {
    const el = mount(live({ label: 'Q&A "beta" <script>' }));
    await Promise.resolve();
    el.shadowRoot.querySelector('button[data-tab="embed"]').click();
    await Promise.resolve();
    const snippet = el.shadowRoot.querySelector("textarea.sh-code").value;
    expect(snippet).toContain('title="Q&amp;A &quot;beta&quot; &lt;script&gt;"');
    expect(snippet).not.toContain("<script>\"");
  });

  it("asks to publish first when the form is a draft", async () => {
    const el = mount(live({ isActive: false, version: undefined, publicKey: undefined }));
    await Promise.resolve();
    expect(el.shadowRoot.textContent).toContain("Publish the form to get its public link");
    expect(el.shadowRoot.querySelector("input.sh-input")).toBeNull();
  });

  it("explains when no site exists", async () => {
    const el = mount(live(), []);
    await Promise.resolve();
    expect(el.shadowRoot.textContent).toContain("No Experience Cloud site with a domain was found");
  });

  it("emits channelchange with merged publish settings", async () => {
    const el = mount(live({ settings: { access: { responseLimit: 5 } } }));
    const handler = jest.fn();
    el.addEventListener("channelchange", handler);
    await Promise.resolve();
    el.shadowRoot.querySelector('button[data-tab="site"]').click();
    await Promise.resolve();
    const combo = el.shadowRoot.querySelector("lightning-combobox");
    combo.dispatchEvent(new CustomEvent("change", { detail: { value: "0DM2" } }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.patch.settings).toEqual({ access: { responseLimit: 5 }, publish: { siteId: "0DM2" } });
  });
});
