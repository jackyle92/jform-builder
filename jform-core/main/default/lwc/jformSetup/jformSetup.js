import { LightningElement, wire } from "lwc";
import { NavigationMixin, CurrentPageReference } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { qualify, stateKey, readState } from "c/jformNamespace";
import getStatus from "@salesforce/apex/JFormSetupController.getStatus";
import searchUsers from "@salesforce/apex/JFormSetupController.searchUsers";
import grantBuilderAccess from "@salesforce/apex/JFormSetupController.grantBuilderAccess";
import grantGuestAccess from "@salesforce/apex/JFormSetupController.grantGuestAccess";
import saveCaptchaKeys from "@salesforce/apex/JFormSetupController.saveCaptchaKeys";
import generateSigningKey from "@salesforce/apex/JFormSetupController.generateSigningKey";
import getPaymentSetup from "@salesforce/apex/JFormSetupController.getPaymentSetup";
import savePaymentKey from "@salesforce/apex/JFormSetupController.savePaymentKey";
import savePaymentWebhookSecret from "@salesforce/apex/JFormSetupController.savePaymentWebhookSecret";
import savePaymentWebhookSite from "@salesforce/apex/JFormSetupController.savePaymentWebhookSite";
import checkPaymentConnection from "@salesforce/apex/JFormSetupController.checkPaymentConnection";
import { GATEWAYS, DEFAULT_GATEWAY, gatewayOf } from "c/jformPayment";

const LINKS = {
  experienceSettings: "/lightning/setup/NetworkSettings/home",
  allSites: "/lightning/setup/SetupNetworks/home",
  filesSettings: "/lightning/setup/FilesGeneralSettings/home",
  agentforceStudio: "/lightning/n/standard-AgentforceStudio",
  recaptchaAdmin: "https://www.google.com/recaptcha/admin",
  stripeKeys: "https://dashboard.stripe.com/apikeys",
  stripeWebhooks: "https://dashboard.stripe.com/webhooks"
};
const SEARCH_DELAY_MS = 300;
const COPIED_MS = 1500;
/**
 * The pages in the Setup rail, in order. A feature with its own settings (payments, email,
 * SMS) gets an entry here and a page block in the template; the page id is kept in the address.
 */
const SECTIONS = [
  { id: "core", label: "Core setup", description: "Six steps take this org from install to a form anyone can fill in." },
  { id: "settings", label: "Optional settings", description: "None of these are needed for a first form." },
  { id: "payments", label: "Payments", description: "Payments through your organization's own payment gateway account." }
];

/** "Payments", "Payments and Test mode", "A, B and C". */
function listText(items = []) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A status tag: always a word, so the state never rests on colour alone. */
function tag(label, tone) {
  return { label, cls: `tag tag-${tone}`, icon: tone === "on" ? "utility:check" : tone === "warn" ? "utility:warning" : undefined };
}

/**
 * JForm Setup: a rail of pages on the left (Core setup, Optional settings, Payments) and the open page
 * on the right. Core setup is a checklist from install to a first live form: each step says why it is
 * needed, whether it is done, and either does the work (builder and guest access) or links to the
 * Salesforce page that does it. Only the next step is open; the others fold to one line. Settings show
 * their state and open a form only to change it. The status reloads when the browser tab regains
 * focus, so finishing a step elsewhere ticks it here.
 */
export default class JformSetup extends NavigationMixin(LightningElement) {
  status;
  loading = true;
  error;
  busy = false;
  siteId;
  userQuery = "";
  userResults = [];
  searching = false;
  searchTimer;
  links = LINKS;
  /** The open page, from the address (c__section) so links and Back land on it. */
  section = SECTIONS[0].id;
  /** Steps the user opened or closed, by id; the rest follow the default (only the next step open). */
  expanded = {};
  /** Once every step is done the checklist folds away; Review setup steps brings it back. */
  showSteps = false;
  /** Which setting is being changed. Each opens its form or confirmation in place. */
  editingCaptcha = false;
  confirmSigning = false;
  /** reCAPTCHA fields; the secret starts empty because it is never sent to the browser. */
  captchaSiteKey = "";
  captchaSecret = "";
  captchaMinScore = "";
  /** Selector to focus after the next render, so keyboard users land in the form they opened. */
  pendingFocus;
  /** The Payments page (JFormSetupController.PaymentSetup), loaded when the page opens. */
  paySetup;
  payLoading = false;
  payError;
  /** "test:key", "live:secret": the one key or secret being entered; the saved values are never shown. */
  payEditing = null;
  payValue = "";
  /** Check connection results by mode, and the mode being checked. */
  payChecks = {};
  payChecking = null;
  payCopied = null;
  /** The gateway tile and the Test or Live tab open on the Payments page. */
  payGateway = DEFAULT_GATEWAY;
  payTab = "test";

  connectedCallback() {
    this.load();
    this.onFocus = () => this.load({ quiet: true });
    window.addEventListener("focus", this.onFocus);
  }
  disconnectedCallback() {
    window.removeEventListener("focus", this.onFocus);
    clearTimeout(this.searchTimer);
    clearTimeout(this.copiedTimer);
    clearTimeout(this.focusTimer);
  }
  renderedCallback() {
    if (!this.pendingFocus) return;
    const target = this.template.querySelector(this.pendingFocus);
    this.pendingFocus = undefined;
    if (target) target.focus();
  }

  @wire(CurrentPageReference)
  wiredPageRef(ref) {
    const wanted = readState(ref?.state, "section");
    this.section = SECTIONS.some((x) => x.id === wanted) ? wanted : SECTIONS[0].id;
    if (this.section === "payments") this.loadPayments();
  }

  async load({ quiet = false } = {}) {
    if (!quiet) this.loading = true;
    this.error = undefined;
    try {
      this.status = await getStatus();
      // the page reloads when the window gets focus back, often after the admin copied a key from Google's
      // console in another tab: keys being typed stay until they are saved or cancelled
      if (!this.editingCaptcha) this.resetCaptchaFields();
      const sites = this.status.sites || [];
      if (!sites.find((s) => s.id === this.siteId)) this.siteId = sites.length ? sites[0].id : undefined;
    } catch (e) {
      this.error = this.messageOf(e);
    } finally {
      this.loading = false;
    }
  }
  resetCaptchaFields() {
    this.captchaSiteKey = this.s.siteKey || "";
    this.captchaMinScore = this.s.minScore ?? "";
    this.captchaSecret = "";
  }

  // ------------------------------------------------------------ pages
  get page() {
    return SECTIONS.find((x) => x.id === this.section);
  }
  get isCore() {
    return this.section === "core";
  }
  get isSettings() {
    return this.section === "settings";
  }
  get isPayments() {
    return this.section === "payments";
  }
  /** Rail entries with their state as a word under each label. */
  get sections() {
    const detail = {
      core: { sub: this.allDone ? `All ${this.stepCount} done` : this.progressText, marker: this.allDone ? "done" : "" },
      settings: { sub: "Spam protection, file uploads, Agentforce", marker: "" },
      payments: { sub: this.paymentsRailText, marker: "" }
    };
    return SECTIONS.map((x) => {
      const d = detail[x.id];
      const current = x.id === this.section;
      return {
        ...x,
        sub: this.status ? d.sub : "",
        current: current ? "page" : "false",
        cls: `rail-item${current ? " rail-current" : ""}${d.marker ? ` rail-${d.marker}` : ""}`
      };
    });
  }

  // ------------------------------------------------------------ derived
  get s() {
    return this.status || {};
  }
  get site() {
    return (this.s.sites || []).find((x) => x.id === this.siteId);
  }
  get hasSites() {
    return (this.s.sites || []).length > 0;
  }
  get manySites() {
    return (this.s.sites || []).length > 1;
  }
  get siteOptions() {
    return (this.s.sites || []).map((x) => ({ label: `${x.label} (${x.baseUrl})`, value: x.id }));
  }
  get siteLive() {
    return this.site?.status === "Live";
  }
  get siteStatusText() {
    const st = this.site?.status;
    if (st === "Live") return "Live";
    if (st === "DownForMaintenance") return "Down for maintenance";
    return "Under construction";
  }
  get builderUrl() {
    return this.site?.networkId ? `/sfsites/picasso/core/config/commeditor.jsp?siteId=${this.site.networkId}` : LINKS.allSites;
  }
  get builderSummary() {
    const n = this.s.builderCount || 0;
    return `${n} ${n === 1 ? "person has" : "people have"} builder access.`;
  }
  get liveFormsText() {
    const n = this.s.liveForms || 0;
    return `${n} ${n === 1 ? "form is" : "forms are"} live.`;
  }
  get cannotAssign() {
    return !this.s.canAssign;
  }
  /** Why the key buttons are missing, for builders without Customize Application. */
  get keysNote() {
    if (!this.status || this.s.canManageKeys) return "";
    if (this.isSettings) return "Changing the spam protection keys needs the Customize Application permission.";
    if (this.isPayments) return "Connecting Stripe needs the Customize Application permission.";
    return "";
  }
  get noUserResults() {
    return this.userQuery.trim().length >= 2 && !this.searching && this.userResults.length === 0;
  }

  /**
   * The six required steps. A step that needs an earlier one says so instead of offering an action
   * that cannot work yet; the first open step is "Next" and starts expanded.
   */
  get steps() {
    const st = this.s;
    const site = this.site;
    const list = [
      {
        id: "builder",
        title: "Give builders access",
        done: Boolean(st.builderAccess),
        why: "People who build forms need the JForm builder permission set, admins included.",
        result: `You have access. ${this.builderSummary}`
      },
      {
        id: "experiences",
        title: "Turn on Digital Experiences",
        done: Boolean(st.experiencesEnabled),
        why: "Public forms are served from an Experience Cloud site, and sites need Digital Experiences.",
        result: "On. This org can host a public site."
      },
      {
        id: "site",
        title: "Create the public site",
        done: this.hasSites,
        needs: 2,
        why: "Respondents open published forms on this site.",
        result: site ? `Forms are served from ${site.label} at ${site.baseUrl}.` : ""
      },
      {
        id: "guest",
        title: "Let visitors open forms",
        done: Boolean(site && site.guestAccess && site.guestCanPay),
        needs: 3,
        why: "The site's guest user needs the JForm Guest permission set to load published forms and save responses. To pay on forms with a Payment block it also needs Read on User External Credentials, which Salesforce leaves out of installed permission sets, so JForm adds it in a permission set of your org's own, JForm Payment Credentials. They grant nothing else.",
        note: site && site.guestAccess && !site.guestCanPay ? `Visitors to ${site.label} can open forms but can't pay yet.` : "",
        result: site ? `Visitors to ${site.label} can open published forms, submit responses and pay.` : ""
      },
      {
        id: "publish",
        title: "Publish the site",
        done: Boolean(site && site.status === "Live"),
        needs: 3,
        why: "Visitors can open the site only after it is published and active.",
        result: site ? `${site.label} is Live.` : ""
      },
      {
        id: "form",
        title: "Publish your first form",
        done: (st.liveForms || 0) > 0,
        needs: 1,
        why: "A published form gets a public link that anyone can open.",
        result: this.liveFormsText
      }
    ];
    const next = list.find((x) => !x.done);
    return list.map((x, i) => {
      const blocker = x.needs && !list[x.needs - 1].done ? x.needs : 0;
      const state = x.done ? "done" : blocker ? "blocked" : x === next ? "next" : "todo";
      const expanded = this.expanded[x.id] ?? x === next;
      return {
        ...x,
        number: String(i + 1),
        state,
        blocked: state === "blocked",
        blockedText: `Finish step ${blocker} first.`,
        statusTag: tag(
          { done: "Done", next: "Next", todo: "To do", blocked: `Needs step ${blocker}` }[state],
          { done: "done", next: "next", todo: "off", blocked: "wait" }[state]
        ),
        summary: x.done ? x.result : "",
        expanded,
        expandedText: String(expanded),
        chevron: expanded ? "utility:chevronup" : "utility:chevrondown",
        cls: `step step-${state}${expanded ? " step-open" : ""}`,
        pending: !x.done,
        isBuilder: x.id === "builder",
        isExperiences: x.id === "experiences",
        isSite: x.id === "site",
        isGuest: x.id === "guest",
        isPublish: x.id === "publish",
        isForm: x.id === "form"
      };
    });
  }
  get stepCount() {
    return this.steps.length;
  }
  get doneCount() {
    return this.steps.filter((x) => x.done).length;
  }
  get allDone() {
    return this.stepCount > 0 && this.doneCount === this.stepCount;
  }
  get progressText() {
    return `${this.doneCount} of ${this.stepCount} done`;
  }
  get nextStepTitle() {
    return this.steps.find((x) => x.state === "next")?.title;
  }
  get progressStyle() {
    return `width:${Math.round((100 * this.doneCount) / this.stepCount)}%`;
  }
  get stepsVisible() {
    return !this.allDone || this.showSteps;
  }
  get toggleStepsLabel() {
    return this.showSteps ? "Hide setup steps" : "Review setup steps";
  }
  get showStepsText() {
    return String(this.showSteps);
  }
  get newFormVariant() {
    return (this.s.liveForms || 0) > 0 ? "neutral" : "brand";
  }

  // ------------------------------------------------------------ settings
  get signingTag() {
    return this.s.signingKeySet ? tag("On", "on") : tag("Off", "off");
  }
  get signingNote() {
    return this.s.signingKeySet
      ? "Responses sent too soon after a form opens are marked as spam, on every form."
      : "Marks responses sent too soon after a form opens as spam. Needs a signing key, which JForm generates.";
  }
  /** Wrong promotion codes are counted in Platform Cache; an org without capacity for JForm has no guessing limit. */
  get codeLimitOffNote() {
    return this.s.codeLimitOn === false
      ? "Code guessing limit: off. This org has no Platform Cache capacity for JForm, so wrong promotion codes are not counted."
      : "";
  }
  get signingButtonLabel() {
    return this.s.signingKeySet ? "Replace signing key" : "Generate signing key";
  }
  get showSigningButton() {
    return this.s.canManageKeys && !this.confirmSigning;
  }
  get captchaTag() {
    return this.s.captchaSet ? tag("Keys saved", "on") : tag("Not set up", "off");
  }
  get captchaNote() {
    return this.s.captchaSet
      ? "Turn reCAPTCHA on per form in its Spam protection settings. Responses that score below the minimum are marked as spam."
      : "Scores each response with Google reCAPTCHA v3 and marks likely bots as spam. Add the keys here, then turn it on per form.";
  }
  get captchaEditLabel() {
    return this.s.captchaSet ? "Change keys" : "Add keys";
  }
  get showCaptchaEdit() {
    return this.s.canManageKeys && !this.editingCaptcha;
  }
  get secretPlaceholder() {
    return this.s.captchaSet ? "Saved. Leave blank to keep it" : "";
  }
  get agentTag() {
    return this.s.agentInstalled ? tag("Installed", "on") : tag("Not installed", "off");
  }

  // ------------------------------------------------------------ payments
  async loadPayments() {
    if (this.payLoading) return;
    this.payLoading = !this.paySetup;
    this.payError = undefined;
    try {
      this.paySetup = await getPaymentSetup();
    } catch (e) {
      this.payError = this.messageOf(e);
    } finally {
      this.payLoading = false;
    }
  }
  get paymentsRailText() {
    const p = this.paySetup;
    if (!p) return "Stripe";
    const ready = [p.testKeys, p.liveKeys].filter((m) => m?.keySet && m?.secretSet).map((m) => (m.mode === "Live" ? "live" : "test"));
    return ready.length ? `Stripe: ${ready.join(" and ")} ready` : "Stripe: not set up";
  }
  /**
   * One tile per gateway, with a line per mode. Only Stripe has a setup so far (JFormSetupController.PaymentSetup);
   * a gateway added later brings its own.
   */
  get payGatewayOptions() {
    const modes = this.payModes;
    return GATEWAYS.map((g) => ({
      id: g.id,
      name: g.name,
      states: g.id === "stripe" ? modes.map((m) => ({ key: m.mode, text: `${m.short}: ${m.state.word}`, tone: m.state.tone })) : []
    }));
  }
  get payGatewayShown() {
    const g = gatewayOf(this.payGateway) || GATEWAYS[0];
    return { ...g, dashboardLabel: `Open ${g.name} dashboard` };
  }
  /** Test payments and Live payments as two tabs over the open mode's steps. */
  get payTabs() {
    return this.payModes.map((m) => {
      const on = m.mode === this.payTab;
      return { ...m, selected: on ? "true" : "false", tabindex: on ? "0" : "-1", cls: `gw-tab${on ? " gw-tab-on" : ""}` };
    });
  }
  /** The open tab's mode, as a list of one for the template. */
  get payPanel() {
    return this.payModes.filter((m) => m.mode === this.payTab);
  }
  get payEvents() {
    return (this.paySetup?.events || []).map((e) => ({ key: e, label: e }));
  }
  /**
   * The Experience sites Stripe's events can go to; the webhook address is on the chosen one. Stripe's calls reach
   * the site as its guest user, who needs JForm Guest, so a site without it says so.
   */
  get paySiteOptions() {
    return (this.paySetup?.sites || []).map((s) => ({ label: s.guestAccess ? s.label : `${s.label} (guest user has no JForm Guest access)`, value: s.id }));
  }
  /**
   * Sites whose guest user has JForm Guest but cannot read User External Credentials, so Stripe refuses their
   * visitors' payments (and Stripe's events there). Installed permission sets cannot carry that Read.
   */
  get payGuestsBlocked() {
    if (!this.paySetup?.canManageKeys) return [];
    return (this.paySetup.sites || [])
      .filter((x) => x.guestAccess && !x.guestCanPay)
      .map((x) => ({ id: x.id, text: `Visitors to ${x.label} can't pay yet.` }));
  }
  get paySiteShown() {
    return Boolean(this.paySetup?.canManageKeys) && this.paySiteOptions.length > 0;
  }
  get paySiteId() {
    return this.paySetup?.webhookSiteId || "";
  }
  get paySiteNote() {
    const site = (this.paySetup?.sites || []).find((s) => s.id === this.paySiteId);
    if (site && !site.guestAccess) {
      return `Stripe's events are refused on ${site.label} until its guest user has JForm Guest. In Core setup, pick it as the site for public forms and grant guest access.`;
    }
    return "The webhook address below is on this site. Pick the site your forms are published on.";
  }
  async handlePaySite(event) {
    const siteId = event.detail.value;
    await this.run(async () => {
      await savePaymentWebhookSite({ siteId });
      this.payChecks = {};
      await this.loadPayments();
    });
  }
  get payCheckScheduledText() {
    return this.paySetup?.checkScheduled
      ? "JForm also checks open payments every hour, in case Stripe's message does not arrive."
      : "Saving a signing secret also starts JForm's hourly check of open payments.";
  }
  /** One card per mode: its key, its webhook address and signing secret, and the last connection check. */
  get payModes() {
    const p = this.paySetup;
    if (!p) return [];
    return [
      { mode: "test", setup: p.testKeys, title: "Test payments", prefix: "sk_test_" },
      { mode: "live", setup: p.liveKeys, title: "Live payments", prefix: "sk_live_" }
    ].map(({ mode, setup, title, prefix }) => {
      const m = setup || {};
      const blocked = mode === "live" && p.sandbox;
      const state = blocked
        ? { word: "test only in this org", tone: "off" }
        : m.keySet && m.secretSet
          ? { word: "ready", tone: "on" }
          : m.keySet
            ? { word: "needs signing secret", tone: "warn" }
            : m.secretSet
              ? { word: "needs secret key", tone: "warn" }
              : { word: "not set up", tone: "off" };
      const check = this.payChecks[mode];
      return {
        mode,
        title,
        short: mode === "test" ? "Test" : "Live",
        state,
        tabId: `pay-tab-${mode}`,
        tag: tag(state.word.charAt(0).toUpperCase() + state.word.slice(1), state.tone),
        intro:
          mode === "test"
            ? "Stripe's test cards, no money moves. Free in every org: use these to build and try payment forms."
            : "Real cards and real money. Forms take live payments once they are published with live payments.",
        blockedNote: blocked ? "This org is a sandbox or scratch org, so forms take test payments only, even with live keys copied from production." : "",
        canEdit: p.canManageKeys && !blocked,
        keyStep: `In Stripe, copy the secret key from Developers > API keys${mode === "test" ? " with Test mode on" : ""}. It starts with ${prefix}.`,
        keyTag: m.keySet ? tag("Saved", "on") : tag("Not saved", "off"),
        keyProblem: m.keyProblem || "",
        keyButton: m.keySet ? "Replace key" : "Add key",
        keyEditing: this.payEditing === `${mode}:key`,
        keyRemovable: m.keySet,
        webhookUrl: m.webhookUrl || "",
        noWebhookUrl: !m.webhookUrl,
        copyLabel: this.payCopied === mode ? "Copied" : "Copy address",
        secretTag: m.secretSet ? tag("Saved", "on") : tag("Not saved", "off"),
        secretButton: m.secretSet ? "Replace secret" : "Add signing secret",
        secretEditing: this.payEditing === `${mode}:secret`,
        checking: this.payChecking === mode,
        checkLines: check ? this.checkLines(check) : []
      };
    });
  }
  checkLines(c) {
    const lines = [
      c.keyWorks ? { ok: true, text: "The secret key works." } : { ok: false, text: c.keyProblem ? `The secret key does not work: ${c.keyProblem}` : "The secret key does not work." }
    ];
    if (!c.webhookFound) lines.push({ ok: false, text: "Stripe has no webhook endpoint with this org's address yet (step 2)." });
    else if (!c.webhookEnabled) lines.push({ ok: false, text: "The webhook endpoint is disabled in Stripe. Enable it there." });
    else if (c.missingEvents?.length) lines.push({ ok: false, text: `The endpoint does not send ${listText(c.missingEvents)}. Add the missing events in Stripe.` });
    else lines.push({ ok: true, text: "Stripe sends the seven events to this org's webhook address." });
    lines.push(c.secretSet ? { ok: true, text: "The signing secret is saved." } : { ok: false, text: "The signing secret is not saved yet (step 3)." });
    return lines.map((l, i) => ({ ...l, key: `c${i}`, icon: l.ok ? "utility:success" : "utility:warning", cls: `check-line ${l.ok ? "check-ok" : "check-warn"}` }));
  }
  get payInputLabel() {
    return this.payEditing?.endsWith(":secret") ? "Signing secret" : "Secret key";
  }
  handlePayEdit(event) {
    const { mode, what } = event.currentTarget.dataset;
    this.payEditing = `${mode}:${what}`;
    this.payValue = "";
    this.pendingFocus = ".pay-value";
  }
  handlePayCancel() {
    this.payEditing = null;
    this.payValue = "";
  }
  handlePayValue(event) {
    this.payValue = event.target.value || "";
  }
  get cannotSavePay() {
    return this.busy || !this.payValue.trim();
  }
  async handlePaySave() {
    const [mode, what] = (this.payEditing || "").split(":");
    if (!mode) return;
    await this.savePay(mode, what, this.payValue);
  }
  async handlePayRemove(event) {
    const { mode, what } = event.currentTarget.dataset;
    await this.savePay(mode, what, "");
  }
  async savePay(mode, what, value) {
    await this.run(async () => {
      if (what === "secret") await savePaymentWebhookSecret({ mode, secret: value });
      else await savePaymentKey({ mode, secretKey: value });
      this.payEditing = null;
      this.payValue = "";
      const done = value ? "saved" : "removed";
      this.toast(what === "secret" ? `Signing secret ${done}` : `Secret key ${done}`, value ? "Press Check connection to confirm Stripe is set up." : "", "success");
      this.payChecks = { ...this.payChecks, [mode]: undefined };
      await this.loadPayments();
    });
  }
  async handlePayCheck(event) {
    const mode = event.currentTarget.dataset.mode;
    this.payChecking = mode;
    try {
      this.payChecks = { ...this.payChecks, [mode]: await checkPaymentConnection({ mode }) };
    } catch (e) {
      this.toast("Could not check the connection", this.messageOf(e), "error");
    } finally {
      this.payChecking = null;
    }
  }
  handlePayGateway(event) {
    this.payGateway = event.detail.value;
    this.payEditing = null;
  }
  handlePayTab(event) {
    this.payTab = event.currentTarget.dataset.mode;
    this.payEditing = null;
  }
  /** Arrow keys, Home and End move between the Test and Live tabs, as in any tab list. */
  handlePayTabKey(event) {
    const modes = this.payModes.map((m) => m.mode);
    const at = modes.indexOf(this.payTab);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: modes.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    this.payTab = modes[(to + modes.length) % modes.length];
    this.payEditing = null;
    this.template.querySelector(`.gw-tab[data-mode="${this.payTab}"]`)?.focus();
  }
  async handlePayCopy(event) {
    const mode = event.currentTarget.dataset.mode;
    const row = this.payModes.find((m) => m.mode === mode);
    try {
      await navigator.clipboard.writeText(row.webhookUrl);
      this.payCopied = mode;
      clearTimeout(this.copiedTimer);
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      this.copiedTimer = setTimeout(() => (this.payCopied = null), COPIED_MS);
    } catch (e) {
      /* clipboard unavailable: the address is selectable */
    }
  }

  // ------------------------------------------------------------ page actions
  handleSection(event) {
    const id = event.currentTarget.dataset.section;
    if (id === this.section) return;
    this.section = id;
    if (id === "payments") this.loadPayments();
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Setup") }, state: { [stateKey("section")]: id } });
    // Lightning moves focus to its page container while it navigates, so the new page's
    // title takes focus once that is done.
    clearTimeout(this.focusTimer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.focusTimer = setTimeout(() => this.template.querySelector(".page-title")?.focus());
  }

  // ------------------------------------------------------------ checklist actions
  handleToggleStep(event) {
    const id = event.currentTarget.dataset.id;
    const step = this.steps.find((x) => x.id === id);
    this.expanded = { ...this.expanded, [id]: !step.expanded };
  }
  handleToggleSteps() {
    this.showSteps = !this.showSteps;
  }
  async handleGrantMe() {
    await this.run(async () => {
      const n = await grantBuilderAccess({ userIds: [] });
      this.toast("Access granted", n ? "You can now build forms. Reload the page if the tabs do not show yet." : "You already had builder access.", "success");
    });
  }
  handleUserQuery(event) {
    this.userQuery = event.target.value || "";
    clearTimeout(this.searchTimer);
    if (this.userQuery.trim().length < 2) {
      this.userResults = [];
      return;
    }
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.searchTimer = setTimeout(() => this.search(), SEARCH_DELAY_MS);
  }
  async search() {
    this.searching = true;
    try {
      this.userResults = (await searchUsers({ term: this.userQuery })) || [];
    } catch (e) {
      this.userResults = [];
      this.toast("Search failed", this.messageOf(e), "error");
    } finally {
      this.searching = false;
    }
  }
  async handleGrantUser(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name;
    await this.run(async () => {
      await grantBuilderAccess({ userIds: [id] });
      this.userResults = this.userResults.filter((u) => u.id !== id);
      this.toast("Access granted", `${name} can now build forms.`, "success");
    });
  }
  async handleGrantGuest() {
    if (!this.site) return;
    await this.run(async () => {
      await grantGuestAccess({ siteId: this.site.id });
      this.toast("Guest access granted", `Visitors to ${this.site.label} can open published forms, submit them and pay.`, "success");
    });
  }
  /** From the Payments page: a site whose guest user opens forms but cannot use the Stripe credentials. */
  async handleGrantPayGuest(event) {
    const site = (this.paySetup?.sites || []).find((x) => x.id === event.currentTarget.dataset.id);
    if (!site) return;
    await this.run(async () => {
      await grantGuestAccess({ siteId: site.id });
      await this.loadPayments();
      this.toast("Visitors can pay", `Visitors to ${site.label} can pay on forms with a Payment block.`, "success");
    });
  }
  handleSite(event) {
    this.siteId = event.detail.value;
  }
  handleRefresh() {
    this.load();
  }
  handleNewForm() {
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Workspace") }, state: { [stateKey("action")]: "new" } });
  }

  // ------------------------------------------------------------ settings actions
  /** Without a key, generate one; replacing a key breaks forms that are open, so it asks first. */
  async handleSigningButton() {
    if (this.s.signingKeySet) {
      this.confirmSigning = true;
      this.pendingFocus = ".signing-cancel";
      return;
    }
    await this.saveSigningKey();
  }
  async handleConfirmSigning() {
    await this.saveSigningKey();
  }
  handleCancelSigning() {
    this.confirmSigning = false;
    this.pendingFocus = ".signing-button";
  }
  async saveSigningKey() {
    await this.run(async () => {
      await generateSigningKey();
      this.confirmSigning = false;
      this.pendingFocus = ".signing-button";
      this.toast("Signing key saved", "Timing tokens are on for every form.", "success");
    });
  }
  handleEditCaptcha() {
    this.editingCaptcha = true;
    this.pendingFocus = ".captcha-site-key";
  }
  handleCancelCaptcha() {
    this.resetCaptchaFields();
    this.editingCaptcha = false;
    this.pendingFocus = ".captcha-edit";
  }
  handleCaptchaSiteKey(event) {
    this.captchaSiteKey = event.target.value || "";
  }
  handleCaptchaSecret(event) {
    this.captchaSecret = event.target.value || "";
  }
  handleCaptchaMinScore(event) {
    this.captchaMinScore = event.target.value ?? "";
  }
  async handleSaveCaptcha() {
    const minScore = this.captchaMinScore === "" ? null : Number(this.captchaMinScore);
    await this.run(async () => {
      await saveCaptchaKeys({ siteKey: this.captchaSiteKey, secret: this.captchaSecret, minScore });
      this.editingCaptcha = false;
      this.pendingFocus = ".captcha-edit";
      this.toast("reCAPTCHA keys saved", this.captchaSiteKey.trim() ? "Turn reCAPTCHA on per form in its Spam protection settings." : "reCAPTCHA is off for every form.", "success");
    });
  }
  async run(work) {
    this.busy = true;
    try {
      await work();
      await this.load({ quiet: true });
    } catch (e) {
      this.toast("That did not work", this.messageOf(e), "error");
    } finally {
      this.busy = false;
    }
  }
  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
  messageOf(e) {
    return (e && e.body && e.body.message) || (e && e.message) || "Unknown error";
  }
}
