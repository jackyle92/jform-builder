import { createElement } from "lwc";
import JformSettingsTab from "c/jformSettingsTab";
import getProtectionStatus from "@salesforce/apex/JFormWorkspaceController.getProtectionStatus";
import getPaymentStatus from "@salesforce/apex/JFormWorkspaceController.getPaymentStatus";
import getTimeZones from "@salesforce/apex/JFormWorkspaceController.getTimeZones";

jest.mock("@salesforce/apex/JFormWorkspaceController.getProtectionStatus", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getPaymentStatus", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormWorkspaceController.getTimeZones", () => ({ default: jest.fn() }), { virtual: true });

const definition = { name: "Form", label: "Form", displayStyle: "Single Page", settings: { access: {} }, sections: [{ key: "p1", name: "Page 1", fields: [] }] };

function mount(def = definition) {
  const el = createElement("c-jform-settings-tab", { is: JformSettingsTab });
  el.definition = def;
  el.targetObjects = [];
  document.body.appendChild(el);
  return el;
}
/** A macrotask, so the status reads the tab starts when it connects have landed and rendered. */
const flush = () => new Promise((r) => setTimeout(r, 0));
const byProp = (el, prop) => el.shadowRoot.querySelector(`[data-prop="${prop}"]`);
const navItem = (el, id) => el.shadowRoot.querySelector(`.st-nav-item[data-section="${id}"]`);
const summary = (el, id) => navItem(el, id).querySelector(".st-nav-summary").textContent;
async function open(el, id) {
  navItem(el, id).click();
  await flush();
}
async function openAdvanced(el) {
  el.shadowRoot.querySelector(".st-advanced-toggle").click();
  await flush();
}
const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// the statuses are read when the tab connects, so a test sets them before it mounts; unset, the hints stay quiet
beforeEach(() => {
  getProtectionStatus.mockReset();
  getPaymentStatus.mockReset();
  getTimeZones.mockReset();
});
afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-settings-tab navigation", () => {
  it("lists the six sections, opens General first and shows one section at a time", async () => {
    const el = mount();
    await flush();
    const labels = [...el.shadowRoot.querySelectorAll(".st-nav-label")].map((n) => n.textContent);
    expect(labels).toEqual(["General", "Availability", "Messages and buttons", "Responses", "Spam protection", "Payments"]);
    expect(navItem(el, "general").getAttribute("aria-current")).toBe("page");
    expect(el.shadowRoot.querySelector(".st-title").textContent).toBe("General");
    expect(byProp(el, "name")).not.toBeNull();
    expect(byProp(el, "openAt")).toBeNull();

    await open(el, "availability");
    expect(navItem(el, "availability").getAttribute("aria-current")).toBe("page");
    expect(navItem(el, "general").getAttribute("aria-current")).toBeNull();
    expect(el.shadowRoot.querySelector(".st-title").textContent).toBe("Availability");
    expect(byProp(el, "openAt")).not.toBeNull();
    expect(byProp(el, "name")).toBeNull();
  });

  it("summarises each section's state in the navigation", async () => {
    getProtectionStatus.mockResolvedValue({ captchaConfigured: true, signingConfigured: true });
    const el = mount({
      ...definition,
      displayStyle: "Multi-Page (Sections)",
      isActive: true,
      version: 3,
      welcomeMessage: "<p>Hello</p>",
      thankYouMessage: "<p><br></p>",
      settings: {
        access: { responseLimit: 100 },
        buttons: { submit: "Send" },
        automation: { steps: [{ key: "s1", object: "Lead", primary: true }, { key: "s2", object: "Task" }] },
        protection: { enabled: false }
      }
    });
    await flush();
    expect(summary(el, "general")).toBe("One page per section");
    expect(summary(el, "availability")).toBe("Live · up to 100 responses");
    expect(summary(el, "messages")).toBe("Custom welcome, buttons");
    expect(summary(el, "responses")).toBe("2 record steps");
    expect(summary(el, "spam")).toBe("Off");
  });

  it("uses plain summaries for a new form", async () => {
    getProtectionStatus.mockResolvedValue({ captchaConfigured: false, signingConfigured: true });
    const el = mount();
    await flush();
    expect(summary(el, "general")).toBe("One long page");
    expect(summary(el, "availability")).toBe("Draft");
    expect(summary(el, "messages")).toBe("Standard wording");
    expect(summary(el, "responses")).toBe("Stored in JForm only");
    expect(summary(el, "spam")).toBe("On");
    expect(el.shadowRoot.querySelector(".st-nav-dot")).toBeNull();
  });
});

describe("c-jform-settings-tab general", () => {
  it("emits name and page style changes", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    const name = byProp(el, "name");
    name.value = "Spring intake";
    name.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ name: "Spring intake" });
    el.shadowRoot.querySelector('.st-layout[data-value="Multi-Page (Sections)"]').click();
    expect(handler.mock.calls[1][0].detail.patch).toEqual({ displayStyle: "Multi-Page (Sections)" });
    el.shadowRoot.querySelector('.st-layout[data-value="Single Page"]').click();
    expect(handler).toHaveBeenCalledTimes(2); // already the layout: nothing to save
  });
});

describe("c-jform-settings-tab page layout", () => {
  const three = { ...definition, sections: [{ key: "a", fields: [] }, { key: "b", fields: [] }, { key: "c", fields: [] }] };
  const cards = (el) => [...el.shadowRoot.querySelectorAll(".st-layout")];

  it("shows the two layouts as picture cards in a radio group", async () => {
    const el = mount(three);
    await flush();
    expect(el.shadowRoot.querySelector(".st-layouts").getAttribute("role")).toBe("radiogroup");
    expect(cards(el).map((c) => c.querySelector(".st-layout-title").textContent)).toEqual(["One long page", "One page per section"]);
    expect(cards(el).map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(cards(el).map((c) => c.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    expect(cards(el).every((c) => c.querySelector("svg"))).toBe(true);
    expect(cards(el)[0].querySelector(".st-layout-check")).not.toBeNull();
    expect(cards(el)[1].querySelector(".st-layout-text").textContent).toBe("3 sections become 3 pages with Back and Next.");
    expect(cards(el)[0].querySelector(".st-layout-text").textContent).toBe("All 3 sections on one page that scrolls.");
  });

  it("switches with the arrow keys, and says how to get pages on a one-section form", async () => {
    const el = mount({ ...definition, displayStyle: "Multi-Page (Sections)" });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    expect(cards(el)[1].getAttribute("aria-checked")).toBe("true");
    expect(cards(el)[1].querySelector(".st-layout-text").textContent).toBe("Add sections on the Build tab to split the form into pages.");
    cards(el)[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(handler.mock.calls[0][0].detail.patch).toEqual({ displayStyle: "Single Page" });
  });
});

describe("c-jform-settings-tab availability", () => {
  const change = (box, value) => {
    box.value = value;
    box.dispatchEvent(new CustomEvent("change", { detail: { value } }));
  };
  const lastAccess = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail.patch.settings.access;
  const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

  it("keeps the opening and closing times in settings.access, with the zone they were picked in", async () => {
    const el = mount({ ...definition, settings: { access: { responseLimit: 5, closeDate: "2030-01-31" } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "availability");
    expect(el.shadowRoot.textContent).toContain("Draft, never published");
    expect(el.shadowRoot.textContent).toContain("Assigned on first publish");
    expect(el.shadowRoot.textContent).toContain("a last day set before closing times");
    expect(byProp(el, "openAt").timezone).toBe("America/Los_Angeles");

    change(byProp(el, "openAt"), "2030-01-10T17:00:00.000Z");
    expect(lastAccess(handler)).toEqual({ responseLimit: 5, closeDate: "2030-01-31", openAt: "2030-01-10T17:00:00.000Z", timeZone: "America/Los_Angeles" });
    // a closing time replaces the older last day
    el.definition = { ...definition, settings: { access: lastAccess(handler) } };
    await flush();
    change(byProp(el, "closeAt"), "2030-02-01T01:00:00.000Z");
    expect(lastAccess(handler)).toEqual({ responseLimit: 5, openAt: "2030-01-10T17:00:00.000Z", closeAt: "2030-02-01T01:00:00.000Z", timeZone: "America/Los_Angeles" });

    const limit = byProp(el, "responseLimit");
    limit.value = "";
    limit.dispatchEvent(new CustomEvent("change"));
    expect(lastAccess(handler)).toEqual({ openAt: "2030-01-10T17:00:00.000Z", closeDate: "2030-01-31", timeZone: "America/Los_Angeles" });
  });

  it("refuses a closing time before the opening time", async () => {
    const el = mount({ ...definition, settings: { access: { openAt: "2030-01-10T17:00:00.000Z", timeZone: "America/Los_Angeles" } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "availability");
    const closes = byProp(el, "closeAt");
    closes.setCustomValidity = jest.fn();
    change(closes, "2030-01-09T17:00:00.000Z");
    expect(handler).not.toHaveBeenCalled();
    expect(closes.setCustomValidity).toHaveBeenLastCalledWith("Pick a time after the form opens.");
    change(closes, "2030-01-11T17:00:00.000Z");
    expect(closes.setCustomValidity).toHaveBeenLastCalledWith("");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("saves a refused time once the other box makes the pair work, never the old one behind it", async () => {
    const el = mount({ ...definition, settings: { access: { openAt: "2030-01-10T17:00:00.000Z", closeAt: "2030-01-20T17:00:00.000Z", timeZone: "America/Los_Angeles" } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "availability");
    const opens = byProp(el, "openAt");
    const closes = byProp(el, "closeAt");
    opens.setCustomValidity = jest.fn();
    closes.setCustomValidity = jest.fn();
    change(opens, "2030-01-25T17:00:00.000Z");
    expect(handler).not.toHaveBeenCalled();
    expect(opens.setCustomValidity).toHaveBeenLastCalledWith("Pick a time before the form closes.");

    // still a clash: both boxes now show a time that isn't saved
    change(closes, "2030-01-22T17:00:00.000Z");
    expect(handler).not.toHaveBeenCalled();
    expect(opens.setCustomValidity).toHaveBeenLastCalledWith("Pick a time before the form closes.");
    expect(closes.setCustomValidity).toHaveBeenLastCalledWith("Pick a time after the form opens.");

    change(closes, "2030-01-30T17:00:00.000Z");
    expect(lastAccess(handler)).toEqual({ openAt: "2030-01-25T17:00:00.000Z", closeAt: "2030-01-30T17:00:00.000Z", timeZone: "America/Los_Angeles" });
    expect(opens.setCustomValidity).toHaveBeenLastCalledWith("");
    expect(closes.setCustomValidity).toHaveBeenLastCalledWith("");
  });

  it("removes the older last day, and refuses an opening time after it", async () => {
    const el = mount({ ...definition, settings: { access: { closeDate: "2030-01-31", timeZone: "UTC" } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "availability");
    const opens = byProp(el, "openAt");
    opens.setCustomValidity = jest.fn();
    change(opens, "2030-02-01T09:00:00.000Z");
    expect(handler).not.toHaveBeenCalled();
    expect(opens.setCustomValidity).toHaveBeenLastCalledWith("Pick a time on or before the last day, or remove the last day.");
    change(opens, "2030-01-31T09:00:00.000Z");
    expect(lastAccess(handler)).toEqual({ closeDate: "2030-01-31", openAt: "2030-01-31T09:00:00.000Z", timeZone: "UTC" });

    el.definition = { ...definition, settings: { access: lastAccess(handler) } };
    await flush();
    el.shadowRoot.querySelector(".st-clear-day").click();
    expect(lastAccess(handler)).toEqual({ openAt: "2030-01-31T09:00:00.000Z", timeZone: "UTC" });
  });

  it("saves an opening time refused for falling after the last day once that day is removed", async () => {
    const el = mount({ ...definition, settings: { access: { closeDate: "2030-01-31", timeZone: "UTC" } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "availability");
    const opens = byProp(el, "openAt");
    opens.setCustomValidity = jest.fn();
    change(opens, "2030-02-05T09:00:00.000Z");
    expect(handler).not.toHaveBeenCalled();
    el.shadowRoot.querySelector(".st-clear-day").click();
    expect(lastAccess(handler)).toEqual({ openAt: "2030-02-05T09:00:00.000Z", timeZone: "UTC" });
    expect(opens.setCustomValidity).toHaveBeenLastCalledWith("");
  });

  it("keeps the clock times when the time zone changes, and lists Salesforce's zones", async () => {
    getTimeZones.mockResolvedValue([{ label: "(GMT+11:00) Australian Eastern Daylight Time (Australia/Sydney)", value: "Australia/Sydney" }]);
    const el = mount({ ...definition, settings: { access: { openAt: "2030-01-10T17:00:00.000Z", timeZone: "America/Los_Angeles" } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "availability");
    const zone = byProp(el, "timeZone");
    expect(zone.options.map((o) => o.value)).toEqual(["America/Los_Angeles", "Australia/Sydney"]);
    zone.dispatchEvent(new CustomEvent("change", { detail: { value: "Australia/Sydney" } }));
    // 9:00 AM in Los Angeles becomes 9:00 AM in Sydney
    expect(lastAccess(handler)).toEqual({ openAt: "2030-01-09T22:00:00.000Z", timeZone: "Australia/Sydney" });
  });

  it("says when a form opens later, and flags one whose closing time has passed", async () => {
    const later = mount({ ...definition, isActive: true, version: 1, settings: { access: { openAt: inHours(48), closeAt: inHours(96), timeZone: "America/Los_Angeles" } } });
    await flush();
    expect(summary(later, "availability")).toMatch(/^Live · opens .+ · until .+P[SD]T$/);
    expect(navItem(later, "availability").querySelector(".st-nav-dot")).toBeNull();
    await open(later, "availability");
    expect(later.shadowRoot.querySelector(".st-notice").textContent).toMatch(/^Opens on \w+day .+ at .+: respondents see the not-yet-open screen\.$/);

    const closed = mount({ ...definition, isActive: true, version: 1, settings: { access: { closeAt: inHours(-1) } } });
    await flush();
    expect(summary(closed, "availability")).toBe("Live · closed");
    await open(closed, "availability");
    expect(closed.shadowRoot.querySelector(".st-notice").textContent).toMatch(/^Closed since .+: respondents see the closed screen\.$/);
  });

  it("edits the not-yet-open and closed screens", async () => {
    const el = mount({ ...definition, settings: { access: { closedMessage: "No more <places>." } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "availability");
    const part = (screen, prop) => el.shadowRoot.querySelector(`[data-screen="${screen}"][data-prop="${prop}"]`);
    // the older closed message shows in the closed screen's editor until it is replaced
    expect(part("closed", "message").value).toBe("<p>No more &lt;places&gt;.</p>");

    change(part("notOpen", "title"), "  Bookings open soon ");
    expect(lastAccess(handler)).toEqual({ closedMessage: "No more <places>.", notOpen: { title: "Bookings open soon" } });
    const image = part("notOpen", "imageUrl");
    image.setCustomValidity = jest.fn();
    change(image, "http://example.com/a.png");
    expect(image.setCustomValidity).toHaveBeenLastCalledWith("Use an https link or a path on your site.");
    expect(handler).toHaveBeenCalledTimes(1);

    part("closed", "message").dispatchEvent(new CustomEvent("change", { detail: { value: "<p>See you next year.</p>" } }));
    expect(lastAccess(handler)).toEqual({ closed: { message: "<p>See you next year.</p>" } });
    part("closed", "message").dispatchEvent(new CustomEvent("change", { detail: { value: "<p><br></p>" } }));
    expect(lastAccess(handler)).toEqual({});
  });

  it("flags a form whose last day has passed, but not one closing today", async () => {
    const closed = mount({ ...definition, isActive: true, version: 1, settings: { access: { closeDate: isoDay(-1) } } });
    await flush();
    expect(summary(closed, "availability")).toBe("Live · closed");
    expect(navItem(closed, "availability").querySelector(".st-nav-dot")).not.toBeNull();
    await open(closed, "availability");
    expect(closed.shadowRoot.querySelector(".st-notice").textContent).toContain("Closed since");

    const today = mount({ ...definition, settings: { access: { closeDate: isoDay(0) } } });
    await flush();
    expect(summary(today, "availability")).toMatch(/^Draft · until /);
    expect(navItem(today, "availability").querySelector(".st-nav-dot")).toBeNull();
  });
});

describe("c-jform-settings-tab responses", () => {
  it("counts flow steps apart from record steps", async () => {
    const el = mount({ ...definition, settings: { automation: { steps: [{ key: "lead", action: "create", object: "Lead" }, { key: "flow", action: "flow", flow: "Welcome_Pack" }] } } });
    await flush();
    expect(summary(el, "responses")).toBe("1 record step and 1 flow");
  });

  it("points to the Automate tab and asks the workspace to open it", async () => {
    const el = mount({ ...definition, settings: { automation: { steps: [{ key: "s1", object: "Contact", primary: true }] } } });
    const handler = jest.fn();
    el.addEventListener("gotab", handler);
    await open(el, "responses");
    expect(el.shadowRoot.textContent).toContain("Each response runs 1 record step from the Automate tab; the main record is a Contact.");
    el.shadowRoot.querySelector('[data-action="automate"]').click();
    expect(handler.mock.calls[0][0].detail).toEqual({ tab: "automate" });
  });
});

describe("c-jform-settings-tab spam protection", () => {
  it("is on by default and emits the protection settings as they change", async () => {
    getProtectionStatus.mockResolvedValue({ captchaConfigured: false, signingConfigured: true });
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "spam");
    expect(byProp(el, "enabled").checked).toBe(true);
    expect(byProp(el, "minSeconds")).toBeNull();
    await openAdvanced(el);
    expect(byProp(el, "minSeconds").value).toBe(3);

    const perMinute = byProp(el, "perMinute");
    perMinute.value = "5";
    perMinute.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[0][0].detail.patch.settings.protection).toEqual({ perMinute: 5 });

    const enabled = byProp(el, "enabled");
    enabled.checked = false;
    enabled.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[1][0].detail.patch.settings.protection).toEqual({ enabled: false });
    expect(handler.mock.calls[1][0].detail.patch.settings.access).toEqual({});
  });

  it("offers reCAPTCHA only once the org has keys, read again each time the section opens", async () => {
    getProtectionStatus.mockResolvedValue({ captchaConfigured: false, signingConfigured: false });
    const el = mount();
    await open(el, "spam");
    expect(byProp(el, "captcha").disabled).toBe(true);
    expect(el.shadowRoot.textContent).toContain("Setup > Custom Settings > JForm Protection");
    expect(el.shadowRoot.textContent).toContain("No signing key is set");
    expect(navItem(el, "spam").querySelector(".st-nav-dot")).not.toBeNull();
    expect(getProtectionStatus).toHaveBeenCalledTimes(2); // when the tab opened, and when the section did

    // an admin saves the keys on the Setup tab; opening the section again sees them without a reload
    getProtectionStatus.mockResolvedValue({ captchaConfigured: true, signingConfigured: true });
    await open(el, "general");
    await open(el, "spam");
    expect(getProtectionStatus).toHaveBeenCalledTimes(3);
    expect(byProp(el, "captcha").disabled).toBe(false);
    expect(el.shadowRoot.textContent).not.toContain("No signing key is set");
    expect(navItem(el, "spam").querySelector(".st-nav-dot")).toBeNull();
  });

  it("hides the details when protection is switched off", async () => {
    getProtectionStatus.mockResolvedValue({ captchaConfigured: true, signingConfigured: true });
    const el = mount({ ...definition, settings: { protection: { enabled: false } } });
    await open(el, "spam");
    expect(byProp(el, "enabled").checked).toBe(false);
    expect(byProp(el, "captcha")).toBeNull();
    expect(el.shadowRoot.querySelector(".st-advanced-toggle")).toBeNull();
  });

  it("counts changed advanced values and resets them, keeping the switches", async () => {
    getProtectionStatus.mockResolvedValue({ captchaConfigured: true, signingConfigured: true });
    const el = mount({ ...definition, settings: { protection: { captcha: true, minSeconds: 3, maxLinks: 0, blockedWords: "casino" } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "spam");
    expect(summary(el, "spam")).toBe("On, with reCAPTCHA");
    const toggle = el.shadowRoot.querySelector(".st-advanced-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("2 changed");
    el.shadowRoot.querySelector('[data-action="reset-advanced"]').click();
    expect(handler.mock.calls[0][0].detail.patch.settings.protection).toEqual({ captcha: true });
  });
});

describe("c-jform-settings-tab welcome and thank-you screens", () => {
  it("sums up both screens and opens their cards on the Build tab", async () => {
    const el = mount({
      ...definition,
      thankYouMessage: "<p>Thanks</p>",
      settings: { access: {}, welcome: { mode: "screen", buttonLabel: "Begin" }, ending: { buttons: [{ label: "Home", url: "https://example.com" }], redirectUrl: "https://www.example.com/next" } }
    });
    const tabs = jest.fn();
    el.addEventListener("gotab", tabs);
    await open(el, "messages");
    const help = [...el.shadowRoot.querySelectorAll(".st-row-help")].map((p) => p.textContent);
    expect(help).toContain("A start screen with a Begin button.");
    expect(help).toContain("Your message, a button, then on to example.com.");
    expect(el.shadowRoot.querySelector('[data-prop="welcomeMessage"]')).toBeNull(); // edited on the card now

    el.shadowRoot.querySelector('lightning-button[data-select="ending"]').click();
    expect(tabs.mock.calls[0][0].detail).toEqual({ tab: "build", select: "ending" });
  });
});

describe("c-jform-settings-tab button text", () => {
  const box = (el, key) => el.shadowRoot.querySelector(`lightning-input[data-key="${key}"]`);
  it("keeps typed words in settings.buttons next to the other settings, and drops them when cleared", async () => {
    const el = mount({ ...definition, settings: { access: { responseLimit: 5 } } });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "messages");
    box(el, "submit").dispatchEvent(new CustomEvent("change", { detail: { value: "Register now" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings).toEqual({ access: { responseLimit: 5 }, buttons: { submit: "Register now" } });

    el.definition = { ...definition, settings: { access: { responseLimit: 5 }, buttons: { submit: "Register now" } } };
    await flush();
    expect(box(el, "submit").value).toBe("Register now");
    box(el, "submit").dispatchEvent(new CustomEvent("change", { detail: { value: "" } }));
    expect(handler.mock.calls[1][0].detail.patch.settings).toEqual({ access: { responseLimit: 5 } });
  });

  it("explains that Next and Back only show on paged forms", async () => {
    const single = mount();
    await open(single, "messages");
    expect(single.shadowRoot.textContent).toContain("Only shown when the form has one page per section");
    const paged = mount({ ...definition, displayStyle: "Multi-Page (Sections)" });
    await open(paged, "messages");
    expect(paged.shadowRoot.textContent).not.toContain("Only shown when the form has one page per section");
  });
});

describe("c-jform-settings-tab payments", () => {
  const paymentForm = {
    ...definition,
    settings: { access: {} },
    sections: [{ key: "p1", name: "Page 1", fields: [{ key: "pay", type: "payment", label: "Payment", config: { pricing: "fixed", amount: 45 } }] }]
  };

  it("starts with test payments in dollars in a popup, and keeps changes in settings.payments", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount(paymentForm);
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    expect(summary(el, "payments")).toBe("Stripe · Test payments, USD");
    expect(navItem(el, "payments").querySelector(".st-nav-dot")).toBeNull();
    await open(el, "payments");
    const picker = el.shadowRoot.querySelector("c-jform-gateway-picker");
    expect(picker.value).toBe("stripe");
    expect(picker.options[0].states.map((s) => s.text)).toEqual(["Test: ready", "Live: not set up"]);
    expect(el.shadowRoot.textContent).toContain("Test payments take Stripe's test cards");
    expect(byProp(el, "mode").value).toBe("test");
    expect(byProp(el, "currency").value).toBe("USD");
    expect(byProp(el, "openIn").value).toBe("popup");

    byProp(el, "currency").dispatchEvent(new CustomEvent("change", { detail: { value: "EUR" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings).toEqual({ access: {}, payments: { currency: "EUR" } });
    const steps = byProp(el, "testSteps");
    steps.checked = false;
    steps.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[1][0].detail.patch.settings.payments).toEqual({ testSteps: false });
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "stripe" } }));
    expect(handler.mock.calls[2][0].detail.patch.settings.payments).toEqual({ gateway: "stripe" });
    // a billing address is asked of every payer only when turned on, and stored only while on
    const billing = byProp(el, "askBillingAddress");
    expect(billing.checked).toBe(false);
    billing.checked = true;
    billing.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[3][0].detail.patch.settings.payments).toEqual({ askBillingAddress: true });
    billing.checked = false;
    billing.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[4][0].detail.patch.settings.payments).toEqual({});
  });

  it("shows which Email field fills in the payment page, and lets the builder choose Ask instead", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const oneEmail = {
      ...paymentForm,
      sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }, ...paymentForm.sections[0].fields] }]
    };
    const el = mount(oneEmail);
    const oneHandler = jest.fn();
    el.addEventListener("formchange", oneHandler);
    await open(el, "payments");
    // with one Email field and no choice made, that field is the one sent
    expect(byProp(el, "emailField").value).toBe("email");
    expect(el.shadowRoot.textContent).toContain("Choose Ask if that field isn't the payer's email.");
    byProp(el, "emailField").dispatchEvent(new CustomEvent("change", { detail: { value: "" } }));
    expect(oneHandler.mock.calls[0][0].detail.patch.settings.payments).toEqual({ askEmail: true });
    el.definition = { ...oneEmail, settings: { ...oneEmail.settings, payments: { askEmail: true } } };
    await flush();
    expect(byProp(el, "emailField").value).toBe("");
    byProp(el, "emailField").dispatchEvent(new CustomEvent("change", { detail: { value: "email" } }));
    expect(oneHandler.mock.calls[1][0].detail.patch.settings.payments).toEqual({ emailField: "email" });

    // without a Payment block there is nothing to fill in
    const noBlock = mount({ ...oneEmail, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }] }] });
    await open(noBlock, "payments");
    expect(byProp(noBlock, "emailField")).toBeNull();

    const twoEmails = {
      ...paymentForm,
      settings: { access: {}, payments: { currency: "EUR" } },
      sections: [
        { key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }, { key: "billing", type: "email", label: "Billing email" }] },
        { key: "p2", name: "Page 2", fields: paymentForm.sections[0].fields }
      ]
    };
    const two = mount(twoEmails);
    const handler = jest.fn();
    two.addEventListener("formchange", handler);
    await open(two, "payments");
    const picker = byProp(two, "emailField");
    expect(picker.value).toBe("");
    expect(picker.options).toEqual([
      { label: "Ask on Stripe's page", value: "" },
      { label: "Email", value: "email" },
      { label: "Billing email", value: "billing" }
    ]);
    expect(two.shadowRoot.textContent).toContain("The form has several Email fields.");
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "billing" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings.payments).toEqual({ currency: "EUR", emailField: "billing" });

    two.definition = { ...twoEmails, settings: { access: {}, payments: { currency: "EUR", emailField: "billing" } } };
    await flush();
    expect(byProp(two, "emailField").value).toBe("billing");
    byProp(two, "emailField").dispatchEvent(new CustomEvent("change", { detail: { value: "" } }));
    expect(handler.mock.calls[1][0].detail.patch.settings.payments).toEqual({ currency: "EUR", askEmail: true });

    // a field that was removed since stays listed, so the builder sees what the setting names
    two.definition = { ...twoEmails, settings: { access: {}, payments: { emailField: "old" } } };
    await flush();
    expect(byProp(two, "emailField").options.map((o) => o.label)).toEqual(["Ask on Stripe's page", "Email", "Billing email", "old (not on the form)"]);
  });

  it("shows the Email choice when it names a field that is gone, even with one Email field left, so it can be cleared", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const stale = {
      ...paymentForm,
      settings: { access: {}, payments: { emailField: "billing" } },
      sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }, ...paymentForm.sections[0].fields] }]
    };
    const el = mount(stale);
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "payments");
    const picker = byProp(el, "emailField");
    expect(picker).not.toBeNull();
    expect(picker.value).toBe("billing");
    expect(picker.options.map((o) => o.label)).toEqual(["Ask on Stripe's page", "Email", "billing (not on the form)"]);
    expect(el.shadowRoot.textContent).toContain("The chosen Email field is no longer on the form, so the form can't be published.");
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings.payments).toEqual({ askEmail: true });
  });

  it("only warns about publishing when the form has a Payment block", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount({
      ...paymentForm,
      settings: { access: {}, payments: { emailField: "billing" } },
      sections: [{ key: "p1", name: "Page 1", fields: [{ key: "email", type: "email", label: "Email" }] }]
    });
    await open(el, "payments");
    expect(el.shadowRoot.textContent).toContain("The chosen Email field is no longer on the form. Pick another");
    expect(el.shadowRoot.textContent).not.toContain("can't be published");
  });

  it("tells Email fields with the same label apart by their keys", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount({
      ...paymentForm,
      sections: [
        { key: "p1", name: "You", fields: [{ key: "email", type: "email", label: "Email" }, { key: "work", type: "email", label: "Work email" }] },
        { key: "p2", name: "Contact", fields: [{ key: "contact_email", type: "email", label: "Email" }, ...paymentForm.sections[0].fields] }
      ]
    });
    await open(el, "payments");
    expect(byProp(el, "emailField").options.map((o) => o.label)).toEqual(["Ask on Stripe's page", "Email (email)", "Work email", "Email (contact_email)"]);
  });

  it("lets an Email field keyed none be chosen", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount({
      ...paymentForm,
      sections: [
        { key: "p1", name: "Page 1", fields: [{ key: "none", type: "email", label: "Personal" }, { key: "work", type: "email", label: "Work" }] },
        { key: "p2", name: "Page 2", fields: paymentForm.sections[0].fields }
      ]
    });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await open(el, "payments");
    byProp(el, "emailField").dispatchEvent(new CustomEvent("change", { detail: { value: "none" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings.payments).toEqual({ emailField: "none" });
  });

  it("picks mode, where respondents pay and promotion codes from dropdowns", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount(paymentForm);
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    await open(el, "payments");
    const mode = byProp(el, "mode");
    const openIn = byProp(el, "openIn");
    const codes = byProp(el, "codes");
    for (const box of [mode, openIn, codes]) expect(box.tagName).toBe("LIGHTNING-COMBOBOX");
    expect(mode.options.map((o) => o.value)).toEqual(["test", "live"]);
    expect(openIn.options).toEqual([{ label: "In a popup window", value: "popup" }, { label: "On Stripe's page", value: "page" }]);
    expect(codes.value).toBe("none");
    expect(codes.options.map((o) => o.label)).toEqual(["No promotion codes", "Codes defined in JForm", "Codes defined in Stripe"]);
    expect(codes.disabled).toBe(false);

    mode.dispatchEvent(new CustomEvent("change", { detail: { value: "live" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings.payments).toEqual({ mode: "live" });
    openIn.dispatchEvent(new CustomEvent("change", { detail: { value: "page" } }));
    expect(handler.mock.calls[1][0].detail.patch.settings.payments).toEqual({ openIn: "page" });
    codes.dispatchEvent(new CustomEvent("change", { detail: { value: "jform" } }));
    expect(handler.mock.calls[2][0].detail.patch.settings.payments).toEqual({ codes: "jform" });
  });

  it("stores no codes setting for None, and turns codes off for pay what you want", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const withCodes = { ...paymentForm, settings: { access: {}, payments: { codes: "jform", currency: "EUR" } } };
    const el = mount(withCodes);
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    await open(el, "payments");
    expect(byProp(el, "codes").value).toBe("jform");
    byProp(el, "codes").dispatchEvent(new CustomEvent("change", { detail: { value: "none" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings.payments).toEqual({ currency: "EUR" });

    const custom = mount({ ...paymentForm, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "pay", type: "payment", label: "Payment", config: { pricing: "custom", minimum: 5 } }] }] });
    await flush();
    await open(custom, "payments");
    expect(byProp(custom, "codes").disabled).toBe(true);
  });

  it("says when the gateway isn't set up, and refuses one JForm does not support", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: false, liveConnected: false, sandbox: false });
    const el = mount(paymentForm);
    await flush();
    await open(el, "payments");
    expect(el.shadowRoot.querySelector(".st-notice").textContent).toBe(
      "Stripe test payments aren't set up yet. An admin finishes the setup on the JForm Setup tab, under Payments."
    );
    expect(getPaymentStatus).toHaveBeenCalledTimes(2); // when the tab opened, and when the section did

    // the admin saves the secret on the Setup tab; opening the section again sees it
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    await open(el, "general");
    await open(el, "payments");
    expect(getPaymentStatus).toHaveBeenCalledTimes(3);
    expect(el.shadowRoot.querySelector(".st-notice")).toBeNull();
    expect(el.shadowRoot.querySelector("c-jform-gateway-picker").options[0].states[0].text).toBe("Test: ready");
    const other = mount({ ...paymentForm, settings: { payments: { gateway: "paypal" } } });
    await open(other, "payments");
    expect(other.shadowRoot.querySelector(".st-notice").textContent).toContain('JForm doesn\'t support the payment gateway "paypal"');
    expect(byProp(other, "openIn")).toBeNull();
  });

  it("opens on the section the workspace asks for", async () => {
    const el = createElement("c-jform-settings-tab", { is: JformSettingsTab });
    el.definition = paymentForm;
    el.section = "payments";
    document.body.appendChild(el);
    await flush();
    expect(byProp(el, "mode")).not.toBeNull();
  });

  it("says what stops live payments", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount({ ...paymentForm, settings: { payments: { mode: "live", currency: "eur" } } });
    await flush();
    expect(summary(el, "payments")).toBe("Stripe · Live payments, EUR");
    expect(navItem(el, "payments").querySelector(".st-nav-dot")).not.toBeNull();
    await open(el, "payments");
    expect(el.shadowRoot.querySelector(".st-notice").textContent).toContain("Stripe live payments aren't set up yet");
  });

  it("chooses who defines the promotion codes, and lists them when JForm does", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const el = mount({ ...paymentForm, id: "a00000000000001AAA" });
    const handler = jest.fn();
    el.addEventListener("formchange", handler);
    await flush();
    await open(el, "payments");
    const codes = byProp(el, "codes");
    expect(codes.value).toBe("none");
    expect(codes.disabled).toBe(false);
    expect(codes.options.map((o) => o.label)).toEqual(["No promotion codes", "Codes defined in JForm", "Codes defined in Stripe"]);
    expect(el.shadowRoot.querySelector("c-jform-promotion-codes")).toBeNull();

    codes.dispatchEvent(new CustomEvent("change", { detail: { value: "jform" } }));
    expect(handler.mock.calls[0][0].detail.patch.settings.payments).toEqual({ codes: "jform" });
    codes.dispatchEvent(new CustomEvent("change", { detail: { value: "none" } }));
    expect(handler.mock.calls[1][0].detail.patch.settings.payments).toEqual({ codes: undefined });

    el.definition = { ...paymentForm, id: "a00000000000001AAA", settings: { payments: { codes: "jform", currency: "EUR" } } };
    await flush();
    const list = el.shadowRoot.querySelector("c-jform-promotion-codes");
    expect([list.formId, list.currency]).toEqual(["a00000000000001AAA", "EUR"]);
    expect(el.shadowRoot.textContent).toContain("Adding or changing a code needs no publish; this choice does.");

    // gateway codes: the limitations are listed, no JForm list
    el.definition = { ...paymentForm, id: "a00000000000001AAA", settings: { payments: { codes: "gateway" } } };
    await flush();
    expect(el.shadowRoot.querySelector("c-jform-promotion-codes")).toBeNull();
    const limits = [...el.shadowRoot.querySelectorAll(".st-row-list li")].map((li) => li.textContent);
    expect(limits).toHaveLength(4);
    expect(limits[0]).toBe("Codes are made, limited and expired in Stripe, separately for test and live payments.");
  });

  it("takes no promotion codes on pay-what-you-want pricing", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: true, liveConnected: false, sandbox: false });
    const custom = {
      ...paymentForm,
      id: "a00000000000001AAA",
      settings: { payments: { codes: "jform" } },
      sections: [{ key: "p1", name: "Page 1", fields: [{ key: "pay", type: "payment", label: "Payment", config: { pricing: "custom", minimum: 5 } }] }]
    };
    const el = mount(custom);
    await flush();
    await open(el, "payments");
    expect(byProp(el, "codes").disabled).toBe(true);
    expect(el.shadowRoot.querySelector("c-jform-promotion-codes")).toBeNull();
    expect(el.shadowRoot.textContent).toContain('Not available with "pay what you want" pricing');
  });

  it("explains the settings wait for a Payment block", async () => {
    getPaymentStatus.mockResolvedValue({ testConnected: false, liveConnected: false, sandbox: false });
    const el = mount();
    await flush();
    expect(summary(el, "payments")).toBe("No Payment block");
    expect(navItem(el, "payments").querySelector(".st-nav-dot")).toBeNull();
    await open(el, "payments");
    expect(el.shadowRoot.querySelector(".st-notice").textContent).toContain("Add one from the Advanced fields");
  });
});
