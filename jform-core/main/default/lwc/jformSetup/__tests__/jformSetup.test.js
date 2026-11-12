import { createElement } from "lwc";
import JformSetup from "c/jformSetup";
import { CurrentPageReference } from "lightning/navigation";
import getStatus from "@salesforce/apex/JFormSetupController.getStatus";
import grantGuestAccess from "@salesforce/apex/JFormSetupController.grantGuestAccess";
import saveCaptchaKeys from "@salesforce/apex/JFormSetupController.saveCaptchaKeys";
import generateSigningKey from "@salesforce/apex/JFormSetupController.generateSigningKey";
import getPaymentSetup from "@salesforce/apex/JFormSetupController.getPaymentSetup";
import savePaymentKey from "@salesforce/apex/JFormSetupController.savePaymentKey";
import checkPaymentConnection from "@salesforce/apex/JFormSetupController.checkPaymentConnection";
import savePaymentWebhookSite from "@salesforce/apex/JFormSetupController.savePaymentWebhookSite";

// The stock stub's Navigate does nothing; this one records where the rail sends the page
const mockNavigate = jest.fn();
jest.mock("lightning/navigation", () => {
  const { createTestWireAdapter } = require("@salesforce/wire-service-jest-util");
  const Navigate = Symbol("Navigate");
  const NavigationMixin = (Base) =>
    class extends Base {
      [Navigate](ref) {
        mockNavigate(ref);
      }
    };
  NavigationMixin.Navigate = Navigate;
  NavigationMixin.GenerateUrl = Symbol("GenerateUrl");
  return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});
jest.mock("@salesforce/apex/JFormSetupController.getStatus", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.searchUsers", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.grantBuilderAccess", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.grantGuestAccess", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.saveCaptchaKeys", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.generateSigningKey", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.getPaymentSetup", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.savePaymentKey", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.savePaymentWebhookSecret", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.checkPaymentConnection", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormSetupController.savePaymentWebhookSite", () => ({ default: jest.fn() }), { virtual: true });

const site = { id: "0DM000000000001", networkId: "0DB000000000001", label: "JForm", baseUrl: "https://example.my.site.com/jform", status: "Live", guestAccess: true, guestCanPay: true };
const fiveDone = { canAssign: true, builderAccess: true, builderCount: 1, builders: [], experiencesEnabled: true, sites: [site], liveForms: 0, agentInstalled: false, done: 5, total: 6 };
const allDone = { ...fiveDone, liveForms: 2, done: 6 };
const fresh = { ...fiveDone, builderAccess: false, builderCount: 0, experiencesEnabled: false, sites: [], done: 0 };
const flush = () => new Promise((r) => setTimeout(r, 0));

function mount() {
  const el = createElement("c-jform-setup", { is: JformSetup });
  document.body.appendChild(el);
  return el;
}
const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const text = (el, sel) => $(el, sel).textContent.replace(/\s+/g, " ").trim();
/** Each step as the user reads it: title, status tag, open or not. */
const steps = (el) =>
  $$(el, ".step").map((li) => ({
    title: li.querySelector(".step-title").textContent,
    status: li.querySelector(".tag").textContent.trim(),
    open: li.querySelector(".step-toggle").getAttribute("aria-expanded") === "true",
    summary: li.querySelector(".step-summary")?.textContent
  }));
const toggle = (el, id) => $(el, `.step-toggle[data-id="${id}"]`);
/** Open a Setup page from the rail, as a user would. */
async function openPage(el, id) {
  $(el, `.rail-link[data-section="${id}"]`).click();
  await flush();
}
const rail = (el) =>
  $$(el, ".rail-item").map((li) => ({
    label: li.querySelector(".rail-label").textContent,
    sub: li.querySelector(".rail-sub")?.textContent,
    current: li.querySelector(".rail-link").getAttribute("aria-current") === "page"
  }));

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  jest.clearAllMocks();
});

describe("c-jform-setup", () => {
  describe("rail", () => {
    it("lists the Setup pages with their state and opens Core setup first", async () => {
      getStatus.mockResolvedValue({ ...fiveDone });
      const el = mount();
      await flush();
      expect(rail(el)).toEqual([
        { label: "Core setup", sub: "5 of 6 done", current: true },
        { label: "Optional settings", sub: "Spam protection, file uploads, Agentforce", current: false },
        { label: "Payments", sub: "Stripe", current: false }
      ]);
      expect(text(el, ".page-title")).toBe("Core setup");
      expect($(el, ".checklist")).not.toBeNull();
    });

    it("switches pages from the rail and keeps the page in the address", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      const el = mount();
      await flush();
      expect($(el, ".rail-item").className).toContain("rail-done");
      await openPage(el, "settings");
      expect(mockNavigate).toHaveBeenCalledWith({ type: "standard__navItemPage", attributes: { apiName: "JForm_Setup" }, state: { c__section: "settings" } });
      expect(text(el, ".page-title")).toBe("Optional settings");
      expect(el.shadowRoot.activeElement).toBe($(el, ".page-title"));
      expect(rail(el).map((x) => x.current)).toEqual([false, true, false]);
      expect($(el, ".checklist")).toBeNull();
      expect($(el, ".signing-button")).not.toBeNull();
    });

    it("opens the page named in the address, and Core setup for anything else", async () => {
      getStatus.mockResolvedValue({ ...fiveDone });
      const el = mount();
      CurrentPageReference.emit({ type: "standard__navItemPage", attributes: { apiName: "JForm_Setup" }, state: { c__section: "settings" } });
      await flush();
      expect(text(el, ".page-title")).toBe("Optional settings");

      // the Edition page is gone: old links to it land on Core setup
      CurrentPageReference.emit({ type: "standard__navItemPage", attributes: { apiName: "JForm_Setup" }, state: { c__section: "edition" } });
      await flush();
      expect(text(el, ".page-title")).toBe("Core setup");

      CurrentPageReference.emit({ type: "standard__navItemPage", attributes: { apiName: "JForm_Setup" }, state: { c__section: "nope" } });
      await flush();
      expect(text(el, ".page-title")).toBe("Core setup");
    });
  });

  describe("payments", () => {
    const keys = (mode, over = {}) => ({ mode, keySet: false, secretSet: false, webhookUrl: `https://example.my.salesforce-sites.com/services/apexrest/jform/payments/stripe/${mode.toLowerCase()}`, ...over });
    const setup = (over = {}) => ({
      canManageKeys: true,
      sandbox: false,
      checkScheduled: false,
      events: ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded", "refund.updated", "refund.failed"],
      testKeys: keys("Test"),
      liveKeys: keys("Live"),
      ...over
    });

    const openTab = async (el, mode) => {
      $(el, `.gw-tab[data-mode="${mode}"]`).click();
      await flush();
    };

    it("shows a tile per gateway and a tab per mode, with the webhook address and the seven events", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      getPaymentSetup.mockResolvedValue(setup({ testKeys: keys("Test", { keySet: true, secretSet: true }), liveKeys: keys("Live", { keySet: true }) }));
      const el = mount();
      await flush();
      await openPage(el, "payments");
      await flush();
      expect(text(el, ".page-title")).toBe("Payments");
      const picker = $(el, "c-jform-gateway-picker");
      expect(picker.value).toBe("stripe");
      expect([...picker.shadowRoot.querySelectorAll(".gw-state")].map((s) => s.textContent)).toEqual(["Test: ready", "Live: needs signing secret"]);
      expect(picker.shadowRoot.querySelector('[role="radio"]').getAttribute("aria-checked")).toBe("true");
      expect(text(el, ".gw-panel-title")).toBe("Stripe");
      expect(text(el, ".gw-dashboard")).toContain("Open Stripe dashboard");

      const tabs = $$(el, ".gw-tab");
      expect(tabs.map((t) => [t.textContent.replace(/\s+/g, " ").trim(), t.getAttribute("aria-selected")])).toEqual([
        ["Test payments, Ready", "true"],
        ["Live payments, Needs signing secret", "false"]
      ]);
      expect($$(el, ".gw-tabpanel")).toHaveLength(1);
      expect(text(el, ".gw-tabpanel .pay-url-text")).toContain("/stripe/test");
      expect($(el, ".gw-tabpanel").querySelectorAll(".pay-events li")).toHaveLength(7);
      expect($$(el, ".rail-item")[2].querySelector(".rail-sub").textContent).toBe("Stripe: test ready");

      await openTab(el, "live");
      expect(text(el, ".gw-tabpanel .pay-url-text")).toContain("/stripe/live");
      expect(text(el, ".gw-tabpanel")).not.toContain("Subscription edition");
    });

    it("moves between the Test and Live tabs with the arrow keys", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      getPaymentSetup.mockResolvedValue(setup());
      const el = mount();
      await flush();
      await openPage(el, "payments");
      await flush();
      $(el, ".gw-tabs").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await flush();
      expect($$(el, ".gw-tab").map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0"]);
      expect(text(el, ".gw-tabpanel .pay-url-text")).toContain("/stripe/live");
      $(el, ".gw-tabs").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      await flush();
      expect(text(el, ".gw-tabpanel .pay-url-text")).toContain("/stripe/test");
    });

    it("saves a key without showing it again, and reports the connection check", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      getPaymentSetup.mockResolvedValue(setup());
      savePaymentKey.mockResolvedValue();
      checkPaymentConnection.mockResolvedValue({ mode: "Test", keyWorks: true, webhookFound: true, webhookEnabled: true, missingEvents: ["charge.refunded"], secretSet: false });
      const el = mount();
      await flush();
      await openPage(el, "payments");
      await flush();
      $(el, '.pay-key[data-mode="test"]').click();
      await flush();
      const input = $(el, ".pay-value");
      input.value = "sk_test_abcdefghijkl";
      input.dispatchEvent(new CustomEvent("change"));
      await flush();
      $(el, ".pay-save").click();
      await flush();
      expect(savePaymentKey).toHaveBeenCalledWith({ mode: "test", secretKey: "sk_test_abcdefghijkl" });
      expect($(el, ".pay-value")).toBeNull();

      $(el, '.pay-check[data-mode="test"]').click();
      await flush();
      expect(checkPaymentConnection).toHaveBeenCalledWith({ mode: "test" });
      const lines = $(el, ".gw-tabpanel").querySelectorAll(".check-line");
      expect([...lines].map((l) => l.textContent)).toEqual([
        "The secret key works.",
        "The endpoint does not send charge.refunded. Add the missing events in Stripe.",
        "The signing secret is not saved yet (step 3)."
      ]);
    });

    it("keeps live payments to test only in a sandbox", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      getPaymentSetup.mockResolvedValue(setup({ sandbox: true }));
      const el = mount();
      await flush();
      await openPage(el, "payments");
      await flush();
      await openTab(el, "live");
      expect($$(el, ".gw-tab")[1].querySelector(".tag").textContent.trim()).toBe("Test only in this org");
      expect($(el, ".gw-tabpanel .pay-steps")).toBeNull();
      expect([...$(el, "c-jform-gateway-picker").shadowRoot.querySelectorAll(".gw-state")].map((s) => s.textContent)).toEqual(["Test: not set up", "Live: test only in this org"]);
    });

    it("lists the sites Stripe's events can go to, marks one whose guest user lacks JForm Guest, and keeps the choice", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      const sites = [
        { id: "0DM000000000001AAA", label: "jform", baseUrl: "https://example.my.site.com/jform", status: "Live", guestAccess: true, guestCanPay: true },
        { id: "0DM000000000002AAA", label: "Partners", baseUrl: "https://example.my.site.com/partners", status: "Live", guestAccess: false }
      ];
      getPaymentSetup.mockResolvedValueOnce(setup({ sites, webhookSiteId: sites[0].id })).mockResolvedValue(setup({ sites, webhookSiteId: sites[1].id }));
      savePaymentWebhookSite.mockResolvedValue();
      const el = mount();
      await flush();
      await openPage(el, "payments");
      await flush();
      const picker = $(el, ".pay-site-picker");
      expect(picker.value).toBe(sites[0].id);
      expect(picker.options.map((o) => o.label)).toEqual(["jform", "Partners (guest user has no JForm Guest access)"]);
      expect(text(el, ".pay-site .setting-note")).toBe("The webhook address below is on this site. Pick the site your forms are published on.");

      picker.dispatchEvent(new CustomEvent("change", { detail: { value: sites[1].id } }));
      await flush();
      await flush();
      expect(savePaymentWebhookSite).toHaveBeenCalledWith({ siteId: sites[1].id });
      expect($(el, ".pay-site-picker").value).toBe(sites[1].id);
      expect(text(el, ".pay-site .setting-note")).toBe("Stripe's events are refused on Partners until its guest user has JForm Guest. In Core setup, pick it as the site for public forms and grant guest access.");
    });

    it("warns when a site's visitors cannot pay, and lets them pay from there", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      const sites = [
        { id: "0DM000000000001AAA", label: "jform", baseUrl: "https://example.my.site.com/jform", status: "Live", guestAccess: true, guestCanPay: false },
        { id: "0DM000000000002AAA", label: "Partners", baseUrl: "https://example.my.site.com/partners", status: "Live", guestAccess: false, guestCanPay: false }
      ];
      getPaymentSetup
        .mockResolvedValueOnce(setup({ sites, webhookSiteId: sites[0].id }))
        .mockResolvedValue(setup({ sites: [{ ...sites[0], guestCanPay: true }, sites[1]], webhookSiteId: sites[0].id }));
      grantGuestAccess.mockResolvedValue(0);
      const el = mount();
      await flush();
      await openPage(el, "payments");
      await flush();
      // an installed JForm Guest opens forms but cannot carry the Read Stripe callouts need; a site without JForm Guest is the picker's note
      const alerts = $$(el, ".pay-guest-alert");
      expect(alerts.length).toBe(1);
      expect(alerts[0].textContent).toContain("Visitors to jform can't pay yet.");
      expect(alerts[0].textContent).toContain("JForm Payment Credentials");

      alerts[0].querySelector(".pay-guest-grant").click();
      await flush();
      await flush();
      expect(grantGuestAccess).toHaveBeenCalledWith({ siteId: sites[0].id });
      expect($$(el, ".pay-guest-alert").length).toBe(0);
    });

    it("shows no site picker to a builder who cannot manage keys, or without a site", async () => {
      getStatus.mockResolvedValue({ ...allDone, canManageKeys: true });
      getPaymentSetup.mockResolvedValue(setup({ sites: [] }));
      const el = mount();
      await flush();
      await openPage(el, "payments");
      await flush();
      expect($(el, ".pay-site-picker")).toBeNull();
    });
  });

  describe("checklist", () => {
    it("opens only the next step on a fresh org and says which steps wait on others", async () => {
      getStatus.mockResolvedValue(fresh);
      const el = mount();
      await flush();
      expect(text(el, ".progress-text")).toBe("0 of 6 done");
      expect($(el, ".bar").getAttribute("aria-valuenow")).toBe("0");
      expect($(el, ".ready")).toBeNull();
      expect(steps(el).map((s) => [s.title, s.status, s.open])).toEqual([
        ["Give builders access", "Next", true],
        ["Turn on Digital Experiences", "To do", false],
        ["Create the public site", "Needs step 2", false],
        ["Let visitors open forms", "Needs step 3", false],
        ["Publish the site", "Needs step 3", false],
        ["Publish your first form", "Needs step 1", false]
      ]);
      expect($$(el, ".step-panel")).toHaveLength(1);
      expect(text(el, ".step-panel .step-why")).toContain("JForm builder permission set");
    });

    it("folds done steps to their result and opens one on click", async () => {
      getStatus.mockResolvedValue(fiveDone);
      const el = mount();
      await flush();
      expect(text(el, ".progress-text")).toBe("5 of 6 done");
      const list = steps(el);
      expect(list.filter((s) => s.status === "Done")).toHaveLength(5);
      expect(list[0].summary).toBe("You have access. 1 person has builder access.");
      expect(list[2].summary).toBe("Forms are served from JForm at https://example.my.site.com/jform.");
      expect(list[5]).toMatchObject({ title: "Publish your first form", status: "Next", open: true });
      expect($$(el, ".step-panel")).toHaveLength(1);

      toggle(el, "publish").click();
      await flush();
      expect(toggle(el, "publish").getAttribute("aria-expanded")).toBe("true");
      expect($$(el, ".step-panel")).toHaveLength(2);

      toggle(el, "form").click();
      await flush();
      expect(toggle(el, "form").getAttribute("aria-expanded")).toBe("false");
      expect($$(el, ".step-panel")).toHaveLength(1);
    });

    it("explains a blocked step without offering its action", async () => {
      getStatus.mockResolvedValue({ ...fresh, builderAccess: true, experiencesEnabled: true });
      const el = mount();
      await flush();
      expect(steps(el)[2]).toMatchObject({ status: "Next", open: true });
      toggle(el, "guest").click();
      await flush();
      const guest = toggle(el, "guest").closest(".step");
      expect(guest.querySelector(".step-wait").textContent).toBe("Finish step 3 first.");
      expect(guest.querySelector(".guest-grant")).toBeNull();
    });

    it("asks for guest access again while visitors can open forms but cannot pay", async () => {
      getStatus.mockResolvedValue({ ...allDone, sites: [{ ...site, guestCanPay: false }], done: 5 });
      grantGuestAccess.mockResolvedValue(0);
      const el = mount();
      await flush();
      expect(steps(el)[3]).toMatchObject({ status: "Next", open: true });
      expect(text(el, ".guest-pay-note")).toBe("Visitors to JForm can open forms but can't pay yet.");
      $(el, ".guest-grant").click();
      await flush();
      expect(grantGuestAccess).toHaveBeenCalledWith({ siteId: site.id });
    });

    it("grants guest access to the chosen site", async () => {
      getStatus.mockResolvedValue({ ...fiveDone, sites: [{ ...site, guestAccess: false, status: "UnderConstruction" }], done: 3 });
      grantGuestAccess.mockResolvedValue(1);
      const el = mount();
      await flush();
      expect(steps(el)[3]).toMatchObject({ status: "Next", open: true });
      $(el, ".guest-grant").click();
      await flush();
      expect(grantGuestAccess).toHaveBeenCalledWith({ siteId: site.id });
    });

    it("shows a ready card once every step is done, with the steps one click away", async () => {
      getStatus.mockResolvedValue(allDone);
      const el = mount();
      await flush();
      expect(text(el, ".ready .section-title")).toBe("JForm is ready");
      expect(text(el, ".ready-text")).toBe("All six setup steps are done. Forms you publish are live on JForm at https://example.my.site.com/jform.");
      expect($(el, ".bar")).toBeNull();
      expect($(el, ".steps")).toBeNull();

      const review = $(el, ".steps-toggle");
      expect(review.textContent).toBe("Review setup steps");
      review.click();
      await flush();
      expect(review.getAttribute("aria-expanded")).toBe("true");
      expect(review.textContent).toBe("Hide setup steps");
      expect(steps(el).every((s) => s.status === "Done" && !s.open)).toBe(true);
    });
  });

  describe("spam protection", () => {
    it("keeps the reCAPTCHA fields closed until the admin changes the keys", async () => {
      getStatus.mockResolvedValue({ ...fiveDone, canManageKeys: true, captchaSet: true, siteKey: "site-key", minScore: 0.6 });
      saveCaptchaKeys.mockResolvedValue();
      const el = mount();
      await flush();
      await openPage(el, "settings");
      expect(text(el, ".captcha-status")).toContain("Turn reCAPTCHA on per form");
      expect($(el, ".captcha-site-key")).toBeNull();

      const edit = $(el, ".captcha-edit");
      expect(edit.label).toBe("Change keys");
      edit.click();
      await flush();
      expect($(el, ".captcha-edit")).toBeNull();
      expect($(el, ".captcha-site-key").value).toBe("site-key");
      const secret = $(el, ".captcha-secret");
      expect(secret.value).toBe("");
      expect(secret.placeholder).toBe("Saved. Leave blank to keep it");

      secret.value = "new-secret";
      secret.dispatchEvent(new CustomEvent("change"));
      $(el, ".captcha-save").click();
      await flush();
      expect(saveCaptchaKeys).toHaveBeenCalledWith({ siteKey: "site-key", secret: "new-secret", minScore: 0.6 });
      expect($(el, ".captcha-site-key")).toBeNull();
    });

    it("keeps the typed reCAPTCHA keys when the window gets focus back, and saves them together", async () => {
      getStatus.mockResolvedValue({ ...fiveDone, canManageKeys: true, captchaSet: false, siteKey: null, minScore: null });
      saveCaptchaKeys.mockResolvedValue();
      const el = mount();
      await flush();
      await openPage(el, "settings");
      $(el, ".captcha-edit").click();
      await flush();
      const type = (sel, value) => {
        const input = $(el, sel);
        input.value = value;
        input.dispatchEvent(new CustomEvent("change"));
      };
      // the admin types the site key, goes to Google's console for the secret, and comes back
      type(".captcha-site-key", "site-key");
      window.dispatchEvent(new CustomEvent("focus"));
      await flush();
      expect(getStatus).toHaveBeenCalledTimes(2);
      expect($(el, ".captcha-site-key").value).toBe("site-key");
      type(".captcha-secret", "secret");
      type(".captcha-min-score", "0.7");
      window.dispatchEvent(new CustomEvent("focus"));
      await flush();
      expect($(el, ".captcha-site-key").value).toBe("site-key");
      expect($(el, ".captcha-secret").value).toBe("secret");
      expect($(el, ".captcha-min-score").value).toBe("0.7");

      $(el, ".captcha-save").click();
      await flush();
      expect(saveCaptchaKeys).toHaveBeenCalledWith({ siteKey: "site-key", secret: "secret", minScore: 0.7 });
    });

    it("drops unsaved reCAPTCHA edits on Cancel", async () => {
      getStatus.mockResolvedValue({ ...fiveDone, canManageKeys: true, captchaSet: false, siteKey: null, minScore: null });
      const el = mount();
      await flush();
      await openPage(el, "settings");
      $(el, ".captcha-edit").click();
      await flush();
      const siteKey = $(el, ".captcha-site-key");
      siteKey.value = "typed";
      siteKey.dispatchEvent(new CustomEvent("change"));
      $(el, ".captcha-cancel").click();
      await flush();
      $(el, ".captcha-edit").click();
      await flush();
      expect($(el, ".captcha-site-key").value).toBe("");
      expect(saveCaptchaKeys).not.toHaveBeenCalled();
    });

    it("says when wrong promotion codes cannot be counted", async () => {
      getStatus.mockResolvedValue({ ...fiveDone, codeLimitOn: false });
      let el = mount();
      await flush();
      await openPage(el, "settings");
      expect(text(el, ".code-limit-off")).toContain("Code guessing limit: off");
      el.remove();

      getStatus.mockResolvedValue({ ...fiveDone, codeLimitOn: true });
      el = mount();
      await flush();
      await openPage(el, "settings");
      expect($(el, ".code-limit-off")).toBeNull();
    });

    it("generates a first signing key at once", async () => {
      getStatus.mockResolvedValue({ ...fiveDone, canManageKeys: true, signingKeySet: false });
      generateSigningKey.mockResolvedValue();
      const el = mount();
      await flush();
      await openPage(el, "settings");
      expect(text(el, ".setting .tag")).toBe("Off");
      const signing = $(el, ".signing-button");
      expect(signing.label).toBe("Generate signing key");
      signing.click();
      await flush();
      expect(generateSigningKey).toHaveBeenCalled();
    });

    it("asks before replacing a signing key", async () => {
      getStatus.mockResolvedValue({ ...fiveDone, canManageKeys: true, signingKeySet: true });
      generateSigningKey.mockResolvedValue();
      const el = mount();
      await flush();
      await openPage(el, "settings");
      expect(text(el, ".setting .tag")).toBe("On");
      $(el, ".signing-button").click();
      await flush();
      expect(generateSigningKey).not.toHaveBeenCalled();
      expect(text(el, ".panel-warning")).toContain("marked as spam");

      $(el, ".signing-cancel").click();
      await flush();
      expect($(el, ".panel-warning")).toBeNull();

      $(el, ".signing-button").click();
      await flush();
      $(el, ".signing-confirm").click();
      await flush();
      expect(generateSigningKey).toHaveBeenCalledTimes(1);
      expect($(el, ".signing-confirm")).toBeNull();
    });
  });

  it("shows no key actions to people without Customize Application, and says why", async () => {
    getStatus.mockResolvedValue({ ...fiveDone, canManageKeys: false });
    const el = mount();
    await flush();
    expect(text(el, ".page-sub")).not.toContain("Customize Application");
    await openPage(el, "settings");
    expect($(el, ".signing-button")).toBeNull();
    expect($(el, ".captcha-edit")).toBeNull();
    expect(text(el, ".page-sub")).toContain("Changing the spam protection keys needs the Customize Application permission.");
  });
});
