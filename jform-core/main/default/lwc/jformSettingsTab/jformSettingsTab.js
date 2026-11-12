import { LightningElement, api } from "lwc";
import { mainStepOf } from "c/jformAutomationPresets";
import { welcomeOf, endingOf, hostOf, hasContent, safeImage, olderClosedHtml } from "c/jformScreens";
import getProtectionStatus from "@salesforce/apex/JFormWorkspaceController.getProtectionStatus";
import getPaymentStatus from "@salesforce/apex/JFormWorkspaceController.getPaymentStatus";
import getTimeZones from "@salesforce/apex/JFormWorkspaceController.getTimeZones";
import { USER_TIME_ZONE, zonedDateTime, zonedDay, opensText, moveToZone } from "c/jformDates";
import { paymentBlock, paymentSettings, emailFields, gatewayOf, gatewayOptions, pricingOf, CURRENCIES, CODE_KINDS } from "c/jformPayment";

/** Defaults the server applies when a setting is missing (JFormProtectionService.Settings). */
export const PROTECTION_DEFAULTS = { enabled: true, captcha: false, minSeconds: 3, perMinute: 20, maxLinks: 3, duplicateMinutes: 10, blockedWords: "" };
const SINGLE = "Single Page";
const PAGED = "Multi-Page (Sections)";
const PROTECTION_NUMBERS = new Set(["minSeconds", "perMinute", "maxLinks", "duplicateMinutes"]);
/** The tuning values behind "Advanced settings"; the on/off switches stay in view. */
const PROTECTION_ADVANCED = ["minSeconds", "perMinute", "maxLinks", "duplicateMinutes", "blockedWords"];

/** Side navigation of the Settings tab, in order. */
export const SECTIONS = [
  { id: "general", label: "General", icon: "utility:settings", description: "What the form is called and how its pages are shown." },
  { id: "availability", label: "Availability", icon: "utility:clock", description: "Whether respondents can reach the form, when it opens and closes, and what they see while it is shut." },
  { id: "messages", label: "Messages and buttons", icon: "utility:comments", description: "The words respondents read before, during and after the form." },
  { id: "responses", label: "Responses", icon: "utility:record_create", description: "Where each response is stored and which records it creates." },
  { id: "spam", label: "Spam protection", icon: "utility:shield", description: "How JForm keeps bots and junk out of your responses." },
  { id: "payments", label: "Payments", icon: "utility:moneybag", description: "Payments through your organization's own payment gateway account, for forms with a Payment block." }
];
const PAYMENT_MODES = [
  { label: "Test payments", value: "test" },
  { label: "Live payments", value: "live" }
];

/** "2026-12-31" as a local date, or null. */
function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function formatDay(date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Form-level settings in a side navigation: General, Availability, Messages and buttons, Responses, Spam protection, Payments. */
export default class JformSettingsTab extends LightningElement {
  @api definition;
  @api targetObjects = [];
  /** The section to open first, such as "payments" from the Payment block's properties. */
  @api
  get section() {
    return this.activeSection;
  }
  set section(id) {
    if (SECTIONS.some((s) => s.id === id)) this.activeSection = id;
  }

  activeSection = "general";
  advancedOpen = false;

  /**
   * What the org has set up, never the values: the spam protection keys (JFormWorkspaceController.getProtectionStatus)
   * and the gateway secrets and edition (getPaymentStatus). Read when the tab opens and again each time the
   * Spam protection or Payments section does, so keys an admin saves on the Setup tab show without a reload.
   */
  protectionStatus;
  paymentStatus;
  /** Salesforce's time zones, [{ label, value }], for the opening and closing times. */
  timeZones = [];

  connectedCallback() {
    this.readStatus("spam");
    this.readStatus("payments");
    this.readTimeZones();
  }
  async readTimeZones() {
    try {
      this.timeZones = (await getTimeZones()) || [];
    } catch {
      // the list offers the form's own zone until Salesforce's arrive
    }
  }
  async readStatus(section) {
    const read = { spam: getProtectionStatus, payments: getPaymentStatus }[section];
    if (!read) return;
    try {
      const status = await read();
      if (section === "spam") this.protectionStatus = status;
      else this.paymentStatus = status;
    } catch (e) {
      // the hints stay quiet, as before the status arrives
    }
  }

  // ------------------------------------------------------------ navigation
  get navItems() {
    const summaries = {
      general: this.generalSummary,
      availability: this.availabilitySummary,
      messages: this.messagesSummary,
      responses: this.responsesSummary,
      spam: this.spamSummary,
      payments: this.paymentsSummary
    };
    const attention = { availability: this.closedNotice, spam: this.protection.enabled ? this.signingHint : "", payments: this.hasPaymentBlock ? this.paymentsNotice : "" };
    return SECTIONS.map((s) => ({
      ...s,
      summary: summaries[s.id],
      attention: attention[s.id] || "",
      current: s.id === this.activeSection ? "page" : null,
      cls: `st-nav-item${s.id === this.activeSection ? " st-nav-item-active" : ""}`
    }));
  }
  get active() {
    return SECTIONS.find((s) => s.id === this.activeSection) || SECTIONS[0];
  }
  get isGeneral() {
    return this.activeSection === "general";
  }
  get isAvailability() {
    return this.activeSection === "availability";
  }
  get isMessages() {
    return this.activeSection === "messages";
  }
  get isResponses() {
    return this.activeSection === "responses";
  }
  get isSpam() {
    return this.activeSection === "spam";
  }
  get isPayments() {
    return this.activeSection === "payments";
  }
  handleSection(event) {
    const id = event.currentTarget.dataset.section;
    if (!SECTIONS.some((s) => s.id === id)) return;
    this.activeSection = id;
    this.readStatus(id);
  }

  // ------------------------------------------------------------ general
  /** The two page layouts as picture cards; the description counts this form's sections. */
  get layoutChoices() {
    const n = (this.definition?.sections || []).length;
    const sections = `${n} section${n === 1 ? "" : "s"}`;
    const current = this.isPaged ? PAGED : SINGLE;
    return [
      { value: SINGLE, title: "One long page", text: n > 1 ? `All ${sections} on one page that scrolls.` : "Every question on one page that scrolls.", isSingle: true },
      { value: PAGED, title: "One page per section", text: n > 1 ? `${sections} become ${n} pages with Back and Next.` : "Add sections on the Build tab to split the form into pages.", isSingle: false }
    ].map((c) => ({
      ...c,
      checked: c.value === current ? "true" : "false",
      selected: c.value === current,
      tabindex: c.value === current ? "0" : "-1",
      cls: `st-layout${c.value === current ? " st-layout-on" : ""}`
    }));
  }
  get isPaged() {
    return this.definition?.displayStyle === PAGED;
  }
  get generalSummary() {
    return this.isPaged ? "One page per section" : "One long page";
  }
  handleText(event) {
    this.emit({ [event.target.dataset.prop]: event.target.value });
  }
  handleLayoutPick(event) {
    this.pickLayout(event.currentTarget.dataset.value);
  }
  /** Arrow keys move between the two cards, like any radio group. */
  handleLayoutKey(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = event.currentTarget.dataset.value === SINGLE ? PAGED : SINGLE;
    this.pickLayout(next);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    requestAnimationFrame(() => this.template.querySelector(`.st-layout[data-value="${next}"]`)?.focus());
  }
  pickLayout(value) {
    if (value && value !== (this.isPaged ? PAGED : SINGLE)) this.emit({ displayStyle: value });
  }

  // ------------------------------------------------------------ availability
  get access() {
    return this.definition?.settings?.access || {};
  }
  get statusText() {
    const d = this.definition || {};
    if (d.isActive) return `Live, version ${d.version || 1}`;
    if (d.version) return `${d.status || "Inactive"}, last published version ${d.version}`;
    return "Draft, never published";
  }
  get statusShort() {
    const d = this.definition || {};
    if (d.isActive) return "Live";
    return d.version ? d.status || "Inactive" : "Draft";
  }
  get statusClass() {
    return `st-pill${this.definition?.isActive ? " st-pill-live" : ""}`;
  }
  get publicKey() {
    return this.definition?.publicKey || "Assigned on first publish";
  }
  /** The zone the opening and closing times are entered and shown in: the form's own, else the builder's. */
  get zone() {
    return this.access.timeZone || USER_TIME_ZONE;
  }
  get zoneOptions() {
    const zones = this.timeZones || [];
    return zones.some((z) => z.value === this.zone) ? zones : [{ label: this.zone, value: this.zone }, ...zones];
  }
  /** The older day-only closing (closeDate), which counts only while no closing time is set. */
  get closeDay() {
    return this.access.closeAt ? null : parseDay(this.access.closeDate);
  }
  get olderCloseNote() {
    return this.closeDay ? `Closes after ${formatDay(this.closeDay)}, a last day set before closing times. Pick a time to replace it, or remove it.` : "";
  }
  /** Removes the older last day, so the form stays open until a closing time, if any. */
  handleClearCloseDay() {
    const access = { ...this.access };
    delete access.closeDate;
    // an opening time refused for falling after that day is saved with it, and its box stops refusing
    const opens = this.template.querySelector('lightning-input[data-prop="openAt"]');
    if (opens) this.saveTimes(opens, access);
    else this.emitAccess(access);
  }
  momentOf(prop) {
    const ms = Date.parse(this.access[prop] || "");
    return Number.isNaN(ms) ? null : ms;
  }
  get notOpenNotice() {
    const opens = this.momentOf("openAt");
    return opens !== null && opens > Date.now() ? `Opens on ${opensText(this.access.openAt, this.zone)}: respondents see the not-yet-open screen.` : "";
  }
  get closedNotice() {
    const closes = this.momentOf("closeAt");
    if (closes !== null) return closes <= Date.now() ? `Closed since ${zonedDateTime(this.access.closeAt, this.zone)}: respondents see the closed screen.` : "";
    const day = this.closeDay;
    if (!day) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today > day ? `Closed since ${formatDay(day)}: respondents see the closed screen.` : "";
  }
  get availabilitySummary() {
    if (this.closedNotice) return `${this.statusShort} · closed`;
    const parts = [this.statusShort];
    if (this.notOpenNotice) parts.push(`opens ${zonedDateTime(this.access.openAt, this.zone)}`);
    if (this.momentOf("closeAt") !== null) parts.push(`until ${zonedDateTime(this.access.closeAt, this.zone)}`);
    else if (this.closeDay) parts.push(`until ${formatDay(this.closeDay)}`);
    if (this.access.responseLimit) parts.push(`up to ${this.access.responseLimit} responses`);
    return parts.join(" · ");
  }
  get notOpenScreen() {
    return this.access.notOpen || {};
  }
  /** The closed screen, its message falling back to the older plain-text closed message. */
  get closedScreen() {
    const screen = this.access.closed || {};
    const older = olderClosedHtml(this.access.closedMessage);
    return screen.message || !older ? screen : { ...screen, message: older };
  }
  get notOpenEditorMode() {
    return this.definition?.settings?.editors?.notOpenMessage === "html" ? "html" : "visual";
  }
  get closedEditorMode() {
    return this.definition?.settings?.editors?.closedMessage === "html" ? "html" : "visual";
  }
  emitAccess(access) {
    this.emit({ settings: { ...(this.definition?.settings || {}), access } });
  }
  /** Opens or Closes: a moment in UTC from the datetime box, which shows it in the form's zone. */
  handleMoment(event) {
    this.saveTimes(event.target, { ...this.access });
  }
  /**
   * Opens and Closes as the boxes show them, on top of `access`, saved unless they clash; `box` is the one just
   * changed. A clash saves nothing and says so on each box showing a time that isn't saved.
   */
  saveTimes(box, access) {
    const prop = box.dataset.prop;
    const other = this.template.querySelector(`lightning-input[data-prop="${prop === "openAt" ? "closeAt" : "openAt"}"]`);
    // the pair as both boxes show it: a time refused earlier is saved once the other box makes the pair work
    for (const b of [box, other]) {
      if (!b) continue;
      if (b.value) access[b.dataset.prop] = b.value;
      else delete access[b.dataset.prop];
    }
    // the zone the times were picked in is kept with them, and a closing time replaces the older last day
    if ((access.openAt || access.closeAt) && !access.timeZone) access.timeZone = this.zone;
    if (access.closeAt) delete access.closeDate;
    const opens = Date.parse(access.openAt || "");
    const closes = Date.parse(access.closeAt || "");
    const lastDay = !access.closeAt && /^\d{4}-\d{2}-\d{2}/.test(access.closeDate || "") ? access.closeDate.slice(0, 10) : "";
    const clash = !Number.isNaN(opens) && ((!Number.isNaN(closes) && closes <= opens) || (lastDay && zonedDay(access.openAt, access.timeZone) > lastDay));
    for (const b of [box, other]) {
      if (!b || typeof b.setCustomValidity !== "function") continue;
      const p = b.dataset.prop;
      // on a clash each box showing a time that isn't saved says so
      const unsaved = b === box || Date.parse(b.value || "") !== Date.parse(this.access[p] || "");
      const refusal = p === "closeAt" ? "Pick a time after the form opens." : lastDay ? "Pick a time on or before the last day, or remove the last day." : "Pick a time before the form closes.";
      b.setCustomValidity(clash && unsaved ? refusal : "");
      b.reportValidity();
    }
    // a clash saves nothing: the saved pair stays one that works
    if (!clash) this.emitAccess(access);
  }
  /** A new time zone keeps the clock times: 9:00 AM stays 9:00 AM, now in the new zone. */
  handleZone(event) {
    const to = event.detail.value;
    const from = this.zone;
    const access = { ...this.access, timeZone: to };
    for (const prop of ["openAt", "closeAt"]) {
      if (access[prop]) access[prop] = moveToZone(access[prop], from, to);
    }
    this.emitAccess(access);
  }
  /** A part of the not-yet-open or closed screen: title, message or image. */
  handleScreen(event) {
    const { screen: which, prop } = event.target.dataset;
    const raw = event.detail && "value" in event.detail ? event.detail.value : event.target.value;
    const value = prop === "message" ? (hasContent(raw) ? raw : "") : String(raw || "").trim();
    if (prop === "imageUrl" && typeof event.target.setCustomValidity === "function") {
      const bad = Boolean(value) && !safeImage(value);
      event.target.setCustomValidity(bad ? "Use an https link or a path on your site." : "");
      event.target.reportValidity();
      if (bad) return;
    }
    const screen = { ...(this.access[which] || {}) };
    if (value) screen[prop] = value;
    else delete screen[prop];
    const access = { ...this.access };
    if (Object.keys(screen).length) access[which] = screen;
    else delete access[which];
    // the closed screen's message replaces the older plain-text one
    if (which === "closed" && prop === "message") delete access.closedMessage;
    this.emitAccess(access);
  }
  handleScreenMode(event) {
    const prop = `${event.target.dataset.screen}Message`;
    const editors = { ...(this.definition?.settings?.editors || {}) };
    if (event.detail.mode === "html") editors[prop] = "html";
    else delete editors[prop];
    const settings = { ...(this.definition?.settings || {}) };
    if (Object.keys(editors).length) settings.editors = editors;
    else delete settings.editors;
    this.emit({ settings });
  }
  handleAccessText(event) {
    const prop = event.target.dataset.prop;
    let value = event.target.value;
    if (prop === "responseLimit") value = value === "" ? undefined : Number(value);
    if (value === "") value = undefined;
    const access = { ...this.access, [prop]: value };
    if (value === undefined) delete access[prop];
    this.emit({ settings: { ...(this.definition?.settings || {}), access } });
  }

  // ------------------------------------------------------------ messages and buttons
  get messagesSummary() {
    const d = this.definition || {};
    const parts = [];
    if (welcomeOf(d).mode !== "off") parts.push("welcome");
    if (hasContent(d.thankYouMessage) || Object.keys(d.settings?.ending || {}).length) parts.push("thank-you");
    if (Object.keys(this.buttonText).length) parts.push("buttons");
    return parts.length ? `Custom ${parts.join(", ")}` : "Standard wording";
  }
  /** The welcome and thank-you screens are edited on their cards on the Build tab. */
  get welcomeSummary() {
    const w = welcomeOf(this.definition);
    if (w.mode === "screen") return `A start screen with a ${w.buttonLabel || "Start"} button.`;
    if (w.mode === "message") return "A message at the top of the first page.";
    return "Off: the form opens on its first page.";
  }
  get endingSummary() {
    const e = endingOf(this.definition);
    const parts = [hasContent(this.definition?.thankYouMessage) ? "Your message" : "The standard thank-you message"];
    if (e.buttons.length) parts.push(e.buttons.length === 1 ? "a button" : `${e.buttons.length} buttons`);
    if (e.submitAnother) parts.push("Submit another response");
    if (e.redirectUrl) parts.push(`then on to ${hostOf(e.redirectUrl)}`);
    return `${parts.join(", ")}.`;
  }
  handleOpenScreen(event) {
    this.dispatchEvent(new CustomEvent("gotab", { detail: { tab: "build", select: event.currentTarget.dataset.select } }));
  }
  /** Footer button text, kept in settings.buttons; empty boxes fall back to Submit, Next and Back. */
  get buttonText() {
    return this.definition?.settings?.buttons || {};
  }
  get pagedButtonsHelp() {
    return this.isPaged ? "" : " Only shown when the form has one page per section (General).";
  }
  handleButtonText(event) {
    const key = event.target.dataset.key;
    const value = String(event.detail.value || "").slice(0, 40);
    const buttons = { ...this.buttonText };
    if (value.trim()) buttons[key] = value;
    else delete buttons[key];
    const settings = { ...(this.definition?.settings || {}) };
    if (Object.keys(buttons).length) settings.buttons = buttons;
    else delete settings.buttons;
    this.emit({ settings });
  }

  // ------------------------------------------------------------ responses
  get steps() {
    return this.definition?.settings?.automation?.steps || [];
  }
  get hasSteps() {
    return this.steps.length > 0;
  }
  /** "2 record steps", "1 flow", "2 record steps and 1 flow". */
  get stepCountText() {
    const records = this.steps.filter((s) => s.action !== "flow").length;
    const flows = this.steps.length - records;
    const parts = [];
    if (records) parts.push(`${records} record step${records === 1 ? "" : "s"}`);
    if (flows) parts.push(`${flows} flow${flows === 1 ? "" : "s"}`);
    return parts.join(" and ");
  }
  get mainRecordText() {
    const main = mainStepOf(this.steps);
    return main ? `; the main record is a ${main.object}` : "";
  }
  get responsesSummary() {
    return this.hasSteps ? this.stepCountText.replace(/^./, (c) => c.toUpperCase()) : "Stored in JForm only";
  }
  handleOpenAutomate() {
    this.dispatchEvent(new CustomEvent("gotab", { detail: { tab: "automate" } }));
  }

  // ------------------------------------------------------------ spam protection
  get protection() {
    return { ...PROTECTION_DEFAULTS, ...(this.definition?.settings?.protection || {}) };
  }
  get captchaConfigured() {
    return this.protectionStatus?.captchaConfigured === true;
  }
  get captchaDisabled() {
    return !this.protection.enabled || !this.captchaConfigured;
  }
  get captchaHint() {
    if (this.captchaConfigured) return "Respondents are scored invisibly by Google reCAPTCHA v3; low scores are stored as spam.";
    return "Add the reCAPTCHA site key and secret under Setup > Custom Settings > JForm Protection to turn this on.";
  }
  get signingHint() {
    return this.protectionStatus?.signingConfigured === false
      ? "No signing key is set under Setup > Custom Settings > JForm Protection, so the time-to-fill check is off."
      : "";
  }
  get spamSummary() {
    const p = this.protection;
    if (!p.enabled) return "Off";
    return p.captcha && this.captchaConfigured ? "On, with reCAPTCHA" : "On";
  }
  /** Advanced values this form changed from the defaults. */
  get advancedChanged() {
    const saved = this.definition?.settings?.protection || {};
    return PROTECTION_ADVANCED.filter((k) => saved[k] !== undefined && saved[k] !== PROTECTION_DEFAULTS[k]);
  }
  get advancedState() {
    const n = this.advancedChanged.length;
    return n ? `${n} changed` : "Defaults";
  }
  get hasAdvancedChanges() {
    return this.advancedChanged.length > 0;
  }
  get advancedExpanded() {
    return this.advancedOpen ? "true" : "false";
  }
  get advancedIcon() {
    return this.advancedOpen ? "utility:chevrondown" : "utility:chevronright";
  }
  handleAdvancedToggle() {
    this.advancedOpen = !this.advancedOpen;
  }
  handleAdvancedReset() {
    const protection = { ...(this.definition?.settings?.protection || {}) };
    for (const k of PROTECTION_ADVANCED) delete protection[k];
    this.emit({ settings: { ...(this.definition?.settings || {}), protection } });
  }
  handleProtectionToggle(event) {
    this.patchProtection(event.target.dataset.prop, event.target.checked);
  }
  handleProtectionText(event) {
    const prop = event.target.dataset.prop;
    let value = event.target.value;
    if (PROTECTION_NUMBERS.has(prop)) value = value === "" ? undefined : Number(value);
    if (value === "") value = undefined;
    this.patchProtection(prop, value);
  }
  patchProtection(prop, value) {
    const protection = { ...(this.definition?.settings?.protection || {}), [prop]: value };
    if (value === undefined) delete protection[prop];
    this.emit({ settings: { ...(this.definition?.settings || {}), protection } });
  }

  // ------------------------------------------------------------ payments
  get payments() {
    return paymentSettings(this.definition);
  }
  get hasPaymentBlock() {
    return Boolean(paymentBlock(this.definition));
  }
  get paymentsSummary() {
    if (!this.hasPaymentBlock) return "No Payment block";
    return `${this.gatewayName} · ${this.payments.mode === "live" ? "Live" : "Test"} payments, ${this.payments.currency}`;
  }
  /** The form's gateway, or null when it names one JForm does not support. */
  get gateway() {
    return gatewayOf(this.payments.gateway);
  }
  get gatewayName() {
    return this.gateway?.name || this.payments.gateway;
  }
  get gatewayOptions() {
    return gatewayOptions(this.paymentStatus);
  }
  get paymentModeOptions() {
    return PAYMENT_MODES;
  }
  get paymentModeHelp() {
    return `Test payments take ${this.gatewayName}'s test cards and move no money; respondents see a test banner. Live payments charge real cards. The choice is part of the published version: publish again after changing it.`;
  }
  get currencyHelp() {
    return `Every price on the form is in this currency. ${this.gatewayName} may show respondents the amount in their own currency as well.`;
  }
  /** Where respondents pay applies to gateways with a hosted checkout page. */
  get showPaymentWindow() {
    return this.gateway?.hostedCheckout === true;
  }
  get paymentWindowHelp() {
    const name = this.gatewayName;
    return `A popup keeps the form on screen while ${name}'s checkout opens beside it (a new tab on phones). ${name}'s page takes the whole window and brings respondents back to the form when they finish.`;
  }
  get paymentWindowOptions() {
    return [
      { label: "In a popup window", value: "popup" },
      { label: `On ${this.gatewayName}'s page`, value: "page" }
    ];
  }
  get currencyOptions() {
    const codes = CURRENCIES.includes(this.payments.currency) ? CURRENCIES : [this.payments.currency, ...CURRENCIES];
    return codes.map((c) => ({ label: c, value: c }));
  }
  // the respondent's email on the gateway's page: the form's one Email field is used on its own; several need a choice
  get emailFields() {
    return emailFields(this.definition);
  }
  /** The setting names a field that is no longer an Email field on the form; publishing is refused until it is fixed. */
  get emailFieldStale() {
    const chosen = this.payments.emailField;
    return Boolean(chosen) && !this.emailFields.some((f) => f.key === chosen);
  }
  /** Shown whenever there is an Email answer to send, so the builder can see which one goes and choose to let the page ask. */
  get showEmailField() {
    return (this.hasPaymentBlock && this.emailFields.length > 0) || this.emailFieldStale;
  }
  get emailFieldHelp() {
    const page = `${this.gatewayName}'s payment page`;
    if (this.emailFieldStale) {
      // without a Payment block the setting is not checked when publishing (JFormPaymentService.publishProblems)
      const blocks = this.hasPaymentBlock ? ", so the form can't be published" : "";
      return `The chosen Email field is no longer on the form${blocks}. Pick another, or let ${page} ask for the email.`;
    }
    const locked = `${page} shows it filled in and read-only, so respondents don't type it again.`;
    if (this.emailFields.length === 1) {
      return `The answer to the form's Email field is sent: ${locked} Choose Ask if that field isn't the payer's email.`;
    }
    return `The form has several Email fields. Choose the one whose answer is sent: ${locked} Until one is chosen, the page asks for it.`;
  }
  get emailFieldOptions() {
    const chosen = this.payments.emailField;
    // two Email fields with the same label are told apart by their keys
    const labels = this.emailFields.map((f) => f.label || f.key);
    const options = this.emailFields.map((f, i) => ({
      label: labels.indexOf(labels[i]) !== labels.lastIndexOf(labels[i]) ? `${labels[i]} (${f.key})` : labels[i],
      value: f.key
    }));
    if (chosen && !options.some((o) => o.value === chosen)) options.push({ label: `${chosen} (not on the form)`, value: chosen });
    // "" means none: a field key is never empty, so no field can be mistaken for it
    return [{ label: `Ask on ${this.gatewayName}'s page`, value: "" }, ...options];
  }
  /** "" is Ask; with no choice made, the form's only Email field is the one sent (JFormPaymentService.customerEmail). */
  get emailFieldValue() {
    if (this.payments.askEmail) return "";
    if (this.payments.emailField) return this.payments.emailField;
    return this.emailFields.length === 1 ? this.emailFields[0].key : "";
  }
  /** Ask is stored as askEmail, so it holds for a form with one Email field too; a field is stored by its key. */
  handleEmailField(event) {
    const value = event.detail.value;
    const payments = { ...(this.definition?.settings?.payments || {}) };
    delete payments.emailField;
    delete payments.askEmail;
    if (value) payments.emailField = value;
    else payments.askEmail = true;
    this.emit({ settings: { ...(this.definition?.settings || {}), payments } });
  }
  /**
   * What stops this form's payments as set: a gateway JForm does not support, a sandbox, no license for live
   * payments, or the gateway not set up yet. Builders can't see the keys, so the notice doesn't say which part is missing.
   */
  get paymentsNotice() {
    if (!this.gateway) return `JForm doesn't support the payment gateway "${this.payments.gateway}". Choose one above.`;
    const status = this.paymentStatus;
    if (!status) return "";
    const name = this.gateway.name;
    if (this.payments.mode === "live") {
      if (status.sandbox) return "This org is a sandbox or scratch org, so the form takes test payments whatever is chosen here.";
      if (!status.liveConnected) return `${name} live payments aren't set up yet. An admin finishes the setup on the JForm Setup tab, under Payments.`;
      return "";
    }
    return status.testConnected ? "" : `${name} test payments aren't set up yet. An admin finishes the setup on the JForm Setup tab, under Payments.`;
  }
  handleGateway(event) {
    this.patchPayments("gateway", event.detail.value);
  }
  // promotion codes: none, codes defined in JForm (records under the form) or codes defined in the gateway
  get formId() {
    return this.definition?.id;
  }
  get codeOptions() {
    return CODE_KINDS.map((k) => ({ value: k.value, label: k.value === "gateway" ? `Codes defined in ${this.gatewayName}` : k.label }));
  }
  /** "Pay what you want" takes no codes: the respondent picks the amount, so a discount on it means nothing. */
  get codesDisabled() {
    const block = paymentBlock(this.definition);
    return Boolean(block) && pricingOf(block) === "custom";
  }
  get showCodeList() {
    return this.payments.codes === "jform" && !this.codesDisabled && Boolean(this.formId);
  }
  get codesHelp() {
    if (this.codesDisabled) return `Not available with "pay what you want" pricing: the respondent picks the amount.`;
    const name = this.gatewayName;
    if (this.payments.codes === "jform") {
      return "Codes you define here, with a percent or an amount off, a validity window and a use limit. Respondents enter one in the Payment block and see the discount before they pay. Adding or changing a code needs no publish; this choice does.";
    }
    if (this.payments.codes === "gateway") {
      return `Promotion codes made in your ${name} dashboard. Respondents enter one on ${name}'s payment page, and JForm records the discount once the payment is confirmed. What this gives up:`;
    }
    return `Let respondents use a promotion code: one you define here, or one made in your ${name} dashboard. The choice is part of the published version.`;
  }
  get codesLimits() {
    if (this.codesDisabled || this.payments.codes !== "gateway") return [];
    const name = this.gatewayName;
    return [
      `Codes are made, limited and expired in ${name}, separately for test and live payments.`,
      "The form shows the price before the discount; the discount appears in JForm only after payment.",
      `A code can't be limited to one form: any active code in your ${name} account works on every form that allows ${name} codes.`,
      "JForm can't count or export them."
    ];
  }
  handleCodes(event) {
    const value = event.detail.value;
    this.patchPayments("codes", value === "none" ? undefined : value);
  }
  get testStepsOn() {
    return this.payments.testSteps;
  }
  get billingAddressHelp() {
    return `${this.gatewayName}'s payment page asks for a billing address only when the card needs one. Turn this on to ask every payer.`;
  }
  handleBillingAddress(event) {
    this.patchPayments("askBillingAddress", event.target.checked ? true : undefined);
  }
  handlePaymentChoice(event) {
    this.patchPayments(event.target.dataset.prop, event.detail.value);
  }
  handleTestSteps(event) {
    this.patchPayments("testSteps", event.target.checked ? undefined : false);
  }
  patchPayments(prop, value) {
    const payments = { ...(this.definition?.settings?.payments || {}), [prop]: value };
    if (value === undefined) delete payments[prop];
    this.emit({ settings: { ...(this.definition?.settings || {}), payments } });
  }

  emit(patch) {
    this.dispatchEvent(new CustomEvent("formchange", { detail: { patch } }));
  }
}
