import { LightningElement, api, track } from "lwc";
import getPublishedDefinition from "@salesforce/apex/JFormPublicController.getPublishedDefinition";
import submitWithSource from "@salesforce/apex/JFormPublicController.submitWithSource";
import attachFile from "@salesforce/apex/JFormPublicController.attachFile";
import startSubmission from "@salesforce/apex/JFormPublicController.startSubmission";
import submitWithPayment from "@salesforce/apex/JFormPublicController.submitWithPayment";
import getPaymentStatus from "@salesforce/apex/JFormPublicController.getPaymentStatus";
import cancelPayment from "@salesforce/apex/JFormPublicController.cancelPayment";
import checkPromotionCode from "@salesforce/apex/JFormPublicController.checkPromotionCode";
import getAvailabilityScreen from "@salesforce/apex/JFormPublicController.getAvailabilityScreen";
import { evaluate } from "c/jformLogic";
import { themeToStyle, resolveTheme, safeImageUrl, SPLIT_MIN_WIDTH } from "c/jformTheme";
import { collectsAnswer, isEmptyValue, rowSpanOf, isTable, isName, nameDefaults, nameValue, isAddress, addressDefaults, addressValue, addressStored, otherKey, picksOther, fileProblem } from "c/jformFieldRegistry";
import { detectCountry } from "c/jformPhone";
import { stateKey } from "c/jformNamespace";
import { displayHtml } from "c/jformRichtext";
import { welcomeOf, endingOf, timeTextOf, hostOf, availabilityOf, availabilityStops, NOT_OPEN } from "c/jformScreens";
import { paymentView, paymentSettings, gatewayOf, formatMoney, CODE_REFUSED } from "c/jformPayment";

/** Answer key the server treats as the honeypot (JFormPublicController.HONEYPOT_KEY). */
const HONEYPOT_KEY = "__jf_honeypot";
/** Answer keys for the timing token and the reCAPTCHA token (JFormPublicController.TIMING_ANSWER_KEY / CAPTCHA_KEY). */
const TIMING_ANSWER_KEY = "__jf_token";
const CAPTCHA_KEY = "__jf_captcha";
/** Answer key carrying the promotion code the respondent applied (JFormPublicController.CODE_KEY). */
const CODE_KEY = "__jf_code";
const CAPTCHA_TIMEOUT_MS = 8000;
/** While the respondent pays, the form reads the payment record this often (the webhook updates it). */
const PAY_POLL_MS = 3000;
/** A checkout lasts an hour (JFormPaymentService.CHECKOUT_MINUTES); the form stops asking a little after. */
const PAY_POLL_LIMIT_MS = 65 * 60 * 1000;
const PAY_WINDOW = "jformPay";
const PAY_WINDOW_FEATURES = "popup,width=520,height=760";
/** sessionStorage key prefix for a checkout on Stripe's page, so the answers survive the trip where the browser keeps them. */
const PAY_STORE = "jform:pay:";
/** Return parameters JFormPaymentService adds to this page's address. */
const PAY_PARAMS = ["jfpay", "jfcs", "jfref", "jfwin"];
const PAY_CANCELLED = "Your response wasn't sent because the payment wasn't completed.";
const PAY_PROCESSING = "Your payment is processing. We'll confirm it by email.";

const COLS_BY_WIDTH = { 25: 3, 50: 6, 75: 9, 100: 12 };
/** Preview stops for the builder's page picker, next to the page keys. */
const WELCOME_STOP = "__welcome";
const ENDING_STOP = "__ending";
const NOT_OPEN_STOP = "__notOpen";
const CLOSED_STOP = "__closed";

/** Fields that take an answer but are not questions: a Hidden field is never shown, and a Payment block is paid, not answered. */
const NOT_ASKED = new Set(["hidden", "payment"]);
const ticked = (v) => v === true || v === "true";

/**
 * Share of these questions that have an answer; a page with none to answer counts as done. A question that starts
 * answered (a default, a value from the link, a box ticked from the start) leaves nothing to do, so it is not counted.
 */
function answeredShare(fields, answers, start) {
  const asked = fields.filter((f) => collectsAnswer(f.type) && !NOT_ASKED.has(f.type) && !startsAnswered(f, start[f.key]));
  if (!asked.length) return 1;
  return asked.filter((f) => isAnswered(f, answers[f.key], start[f.key])).length / asked.length;
}
/** A Name or Address field starts with some parts at most (a default part, the visitor's country), so it is still asked. */
function startsAnswered(field, start) {
  if (field.type === "checkbox" || field.type === "consent") return ticked(start);
  if (start && typeof start === "object" && !Array.isArray(start)) return false;
  return !isEmptyValue(start);
}
/** Whether the question has an answer. The parts a Name or Address field starts with are not one, and neither is an unticked box. */
function isAnswered(field, value, start) {
  if (field.type === "checkbox" || field.type === "consent") return ticked(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const from = start && typeof start === "object" ? start : {};
    return Object.entries(value).some(([k, v]) => !(isAddress(field.type) && k === "country") && !isEmptyValue(v) && v !== from[k]);
  }
  return !isEmptyValue(value);
}
/** Per renderer: the answered share and what it was worked out for, so a builder preview of a hidden page does not run the form's logic on every read. Not reactive state. */
const progressCache = new WeakMap();
/** Per definition: the answers a form starts with. */
const startCache = new WeakMap();

/**
 * Public renderer. Loads a published snapshot by public key (component
 * property or ?key= URL parameter), evaluates conditional logic live, validates,
 * and submits answers keyed by field key.
 */
export default class JformRenderer extends LightningElement {
  @api publicKey;
  /** Hide the outer card and header, for iframe embeds. */
  @api embedded = false;
  /** Preview mode: render the given definition and never submit. Used by the builder. */
  @api previewMode = false;
  /** Preview only: move between pages and submit without checking required fields (the builder's "Check required fields" is off). */
  @api previewSkipChecks = false;
  /**
   * Paint the theme background (and background image) across the whole page instead of only this
   * component's box, for a page that exists for the form. Site layouts pad the content slot; without
   * this the page's own background shows around the form.
   */
  @api fullPage = false;

  _definitionInput;
  /** A definition object or JSON string to render directly instead of loading by key. */
  @api
  get definition() {
    return this._definitionInput;
  }
  set definition(value) {
    this._definitionInput = value;
    if (!value) return;
    const def = typeof value === "string" ? JSON.parse(value) : JSON.parse(JSON.stringify(value));
    const previous = this.answers || {};
    const first = !this.definition_;
    this.definition_ = def;
    // the draft is handed over again on every edit: only the first one decides where the form opens
    if (first) this.onWelcome = this.startsOnWelcome();
    this.answers = { ...this.initialAnswers(def), ...previous };
    this.recompute();
    if (this.pageIndex > (def.sections || []).length - 1) this.pageIndex = 0;
    this.loading = false;
    this.loadError = undefined;
    this.errorMessage = undefined;
    this.prepareCaptcha();
  }

  @track definition_;
  @track answers = {};
  previewNotice = false;
  /** On the start screen (settings.welcome mode "screen") rather than a page of questions. */
  onWelcome = false;
  /** Preview only: the builder asked to see the thank-you screen without submitting. */
  previewEnding = false;
  /** Preview only: the screen the builder asked to see while the form is shut ("notOpen" or "closed"). */
  previewAvailability = null;
  /** The server's not-yet-open or closed screen (getAvailabilityScreen), shown instead of the form. */
  liveAvailability = null;
  /** Seconds left before the thank-you screen sends people on; null when it does not. */
  redirectSeconds = null;
  redirectTimer;
  @track logic = { visible: {}, required: {}, sectionVisible: {} };
  pageIndex = 0;
  /** Preview only: a page a rule hides that the builder chose to look at anyway. */
  forcedKey = null;
  /** Last page list reported to the builder, so it is only sent again when it changes. */
  previewSignature;
  loading = true;
  submitting = false;
  submitted = false;
  /** The form could not be shown at all (no key, not live, closed). */
  loadError;
  /** A submission problem; the form stays on screen with the message. */
  errorMessage;
  submissionId;
  uploadWarning;
  honeypot = "";
  /** Files chosen in fileupload fields, by field key. Kept here because a page's field components are destroyed when the respondent moves on. */
  files = {};
  /** Signed "form opened at" stamp from the server; sent back with the answers. */
  protectionToken = "";
  /**
   * The checkout the respondent is paying: { reference, url, popup, blocked, leaving, confirming, closed,
   * uncancelled }. While it is set the answers are locked and the panel in place of the buttons says where to pay.
   */
  payment = null;
  /** This window is Stripe's popup coming back (?jfwin=1): { result, status, checking }. */
  payReturn = null;
  /** Paid by bank debit: the checkout is done and the money follows; the thank-you screen says so. */
  paymentProcessing = false;
  /** Why the last checkout ended without a response (cancelled, failed or expired). */
  payNotice;
  /** The promotion code the respondent applied, as checkPromotionCode answered it: { code, discountType, percentOff, amountOff, minimumCharge }. */
  promotion = null;
  promotionError = "";
  promotionBusy = false;
  payWindow = null;
  payTimer;
  payStarted;
  payBusy = false;
  captchaRequested = false;
  captchaUnavailable = false;
  urlParams = {};
  embedFromUrl = false;
  narrow = false;
  /** Wide enough to show a side image beside the form (set by the ResizeObserver). */
  wide = false;

  connectedCallback() {
    try {
      this.urlParams = Object.fromEntries(new URLSearchParams(window.location.search).entries());
    } catch (e) {
      this.urlParams = {};
    }
    this.embedFromUrl = ["1", "true", "yes"].includes(String(this.urlParams.embed || "").toLowerCase());
    const key = this.publicKey || this.urlParams.key || this.urlParams.formKey || this.urlParams[stateKey("key")] || this.urlParams.c__key;
    if (key && this.urlParams.jfwin === "1" && this.urlParams.jfpay && !this.previewMode) {
      this.resolvedKey = key;
      this.showPayReturn();
      return;
    }
    if (this._definitionInput) {
      this.resolvedKey = key || this._definitionInput.publicKey; // definition provided directly (preview, tests)
      this.onWelcome = this.startsOnWelcome(); // now that ?start=1 can be read
      this.fetchToken();
      return;
    }
    if (!key) {
      this.loading = false;
      this.loadError = "No form key was provided. Add ?key=<public key> to the URL or set the Form key property.";
      return;
    }
    this.resolvedKey = key;
    this.fetchToken();
    this.load(key);
  }

  /** The timing token tells the server when the form was opened; a missing one only lowers trust, it never blocks. */
  async fetchToken() {
    if (this.previewMode || !this.resolvedKey) return;
    try {
      this.protectionToken = (await startSubmission({ publicKey: this.resolvedKey })) || "";
    } catch (e) {
      this.protectionToken = "";
    }
  }

  /**
   * Ask the page to load reCAPTCHA v3. Google's script cannot run inside the Lightning Web Security
   * sandbox and the sandbox cannot see globals the page creates, so a small listener in the site's
   * head markup loads it in the real window and hands tokens back by postMessage.
   */
  prepareCaptcha() {
    const p = this.definition_?.protection;
    if (this.previewMode || !p?.captcha || !p.siteKey || this.captchaRequested) return;
    this.captchaRequested = true;
    try {
      window.postMessage({ type: "jform:captcha", siteKey: p.siteKey }, window.location.origin);
    } catch (e) {
      this.captchaUnavailable = true;
    }
  }

  /** A fresh reCAPTCHA token for this submission from the page's listener, or null when reCAPTCHA is off, blocked or slow. */
  captchaToken() {
    const p = this.definition_?.protection;
    if (!p?.captcha || !p.siteKey) return Promise.resolve(null);
    const requestId = `jf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const onMessage = (event) => {
        // only the site's own head script answers; a frame or window on another origin cannot hand in a token
        if (event.origin !== window.location.origin) return;
        const m = event.data;
        if (m && m.type === "jform:captcha:token" && m.requestId === requestId) finish(m.token);
      };
      const finish = (token) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(token || null);
      };
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      timer = setTimeout(() => finish(null), CAPTCHA_TIMEOUT_MS);
      window.addEventListener("message", onMessage);
      try {
        window.postMessage({ type: "jform:captcha:execute", siteKey: p.siteKey, action: "jform_submit", requestId }, window.location.origin);
      } catch (e) {
        finish(null);
      }
    });
  }

  async load(key) {
    this.loading = true;
    this.loadError = undefined;
    let shut = false;
    try {
      const json = await getPublishedDefinition({ publicKey: key });
      const def = JSON.parse(json);
      this.definition_ = def;
      this.answers = this.initialAnswers(def);
      this.recompute();
      this.pageIndex = 0;
      this.onWelcome = this.startsOnWelcome();
      // a cached copy can outlive the closing time: past it, ask the server whether the form still takes responses
      shut = this.pastClosing(def) && (await this.loadAvailability(key));
      if (!shut) {
        this.prepareCaptcha();
        this.resumePayment();
      }
    } catch (e) {
      // a form that isn't taking responses shows its not-yet-open or closed screen, not an error line
      shut = await this.loadAvailability(key);
      if (!shut) this.loadError = this.messageOf(e) || "This form is not available.";
    } finally {
      this.loading = false;
    }
    if (shut && this.urlParams.jfpay) this.resumeWhileShut(key);
  }

  pastClosing(def) {
    return Boolean(def?.closesAt) && Date.now() >= Date.parse(def.closesAt);
  }

  /**
   * Whether the form is shut (not open yet, closed or full), and if so its screen in place of the form. Asked
   * only after the form was refused, or when its copy is past the closing time: getPublishedDefinition is
   * cacheable, this is not, so a form that has opened since never shows shut. False when the form is open or
   * the screen can't be read.
   */
  async loadAvailability(key) {
    if (this.previewMode || !key) return false;
    try {
      const json = await getAvailabilityScreen({ publicKey: key });
      if (!json) return false;
      const view = JSON.parse(json);
      // before it opens the questions never arrive: the screen brings the form's name, design and thank-you screen
      if (!this.definition_) {
        this.definition_ = { name: view.name, label: view.label, theme: view.theme, thankYouMessage: view.thankYouMessage, ending: view.ending, sections: [] };
      }
      this.liveAvailability = view;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Back from Stripe's page to a form that shut while the respondent paid (it closed, or this very checkout took
   * its last place): the checkout is confirmed or ended all the same. A paid one ends on the thank-you screen.
   * One ended unpaid gives its place back, so the form is asked for again and, when it takes responses now,
   * comes back with the answers.
   */
  async resumeWhileShut(key) {
    const saved = this.recallPayment();
    await this.resumePayment();
    if (this.submitted || this.payment) return;
    try {
      const def = JSON.parse(await getPublishedDefinition({ publicKey: key }));
      if (this.pastClosing(def)) return;
      this.definition_ = def;
      this.answers = { ...this.initialAnswers(def), ...this.answers };
      this.recompute();
      this.pageIndex = Math.min(saved?.pageIndex || 0, Math.max(0, this.visibleSections.length - 1));
      this.liveAvailability = null;
      this.prepareCaptcha();
    } catch {
      /* still shut: its screen stays */
    }
  }

  /** After a refused submission: the closed screen, asked for only when the form can close (mayClose). */
  loadClosedScreen() {
    return this.definition_?.mayClose ? this.loadAvailability(this.resolvedKey) : Promise.resolve(false);
  }

  initialAnswers(def) {
    const answers = {};
    for (const section of def.sections || []) {
      for (const field of section.fields || []) {
        // a signature is drawn on the form, never carried in by a link or a default; a table neither, for now
        if (!collectsAnswer(field.type) || field.type === "signature" || field.type === "table") continue;
        // a Name field starts from its parts' default values; links do not fill it, for now
        if (isName(field.type)) {
          const start = nameDefaults(field);
          if (start) answers[field.key] = start;
          continue;
        }
        // an Address field starts in the visitor's country, or the default; links do not fill it, for now
        if (isAddress(field.type)) {
          const start = addressDefaults(field, def.addressLists, field.config?.detectCountry === true ? detectCountry() : null);
          if (start) answers[field.key] = start;
          continue;
        }
        if (field.key in this.urlParams) {
          answers[field.key] = this.urlParams[field.key];
        } else if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
          answers[field.key] = field.defaultValue;
        }
      }
    }
    return answers;
  }

  /** The countries and states Address fields offer: the published view's, or the ones the builder adds to the draft for Preview. */
  get addressLists() {
    return this.definition_?.addressLists || null;
  }
  /** The answers rules test: an Address answer as the server stores it, with the country and state names. */
  get logicAnswers() {
    const out = { ...this.answers };
    for (const s of this.allSections) {
      for (const f of s.fields || []) if (isAddress(f.type) && f.key in out) out[f.key] = addressStored(f, out[f.key], this.addressLists);
    }
    return out;
  }

  recompute() {
    this.logic = evaluate(this.definition_, this.logicAnswers);
    if (this.forcedKey) {
      // the page the builder forced may have been deleted, or an answer may have made it visible
      const at = this.visibleSections.findIndex((s) => s.key === this.forcedKey);
      if (at >= 0) {
        this.pageIndex = at;
        this.forcedKey = null;
      } else if (!this.allSections.some((s) => s.key === this.forcedKey)) {
        this.forcedKey = null;
      }
    }
    // a later page may have just been hidden by an answer: never point past the last visible page
    const last = Math.max(0, this.visibleSections.length - 1);
    if (this.pageIndex > last) this.pageIndex = last;
  }

  // ------------------------------------------------------------ preview: pick a page
  get allSections() {
    return this.definition_?.sections || [];
  }
  get skipChecks() {
    return this.previewMode === true && this.previewSkipChecks === true;
  }
  /** The page on screen: the one the builder forced, else the current visible page. */
  get currentSection() {
    if (this.forcedKey) {
      const forced = this.allSections.find((s) => s.key === this.forcedKey);
      if (forced) return forced;
    }
    return this.visibleSections[Math.min(this.pageIndex, this.visibleSections.length - 1)];
  }
  /** Field rules on the forced page, worked out as if the page itself were shown (its own rule would hide every field). */
  get forcedLogic() {
    if (!this.forcedKey || !this.definition_) return null;
    const sections = this.allSections.map((s) => (s.key === this.forcedKey ? { ...s, conditionalLogic: undefined } : s));
    return evaluate({ ...this.definition_, sections }, this.logicAnswers);
  }
  get showHiddenPageNotice() {
    return this.previewMode && Boolean(this.forcedKey);
  }
  /** Visible page next to the forced one in form order, before (-1) or after (+1); null at either end. */
  visibleNeighbour(dir) {
    const all = this.allSections;
    const visible = new Set(this.visibleSections.map((s) => s.key));
    for (let i = all.findIndex((s) => s.key === this.forcedKey) + dir; i >= 0 && i < all.length; i += dir) {
      if (visible.has(all[i].key)) return all[i];
    }
    return null;
  }
  /**
   * Preview only: show a page by key, even one a rule hides with the answers so far.
   * Respondents never get here; their pages stay in order and checked.
   */
  @api
  showPage(key) {
    if (!this.previewMode || !this.definition_) return;
    this.previewAvailability = key === NOT_OPEN_STOP ? "notOpen" : key === CLOSED_STOP ? "closed" : null;
    if (this.previewAvailability) {
      this.onWelcome = false;
      this.previewEnding = false;
      this.forcedKey = null;
      this.previewNotice = false;
      return;
    }
    if (key === WELCOME_STOP || key === ENDING_STOP) {
      if (key === WELCOME_STOP && !this.hasStartScreen) return;
      this.onWelcome = key === WELCOME_STOP;
      this.previewEnding = key === ENDING_STOP;
      this.forcedKey = null;
      this.previewNotice = false;
      return;
    }
    this.onWelcome = false;
    this.previewEnding = false;
    const at = this.visibleSections.findIndex((s) => s.key === key);
    if (at >= 0) {
      this.forcedKey = null;
      this.pageIndex = at;
    } else if (this.allSections.some((s) => s.key === key)) {
      this.forcedKey = key;
    } else {
      return;
    }
    this.previewNotice = false;
    this.scrollToTop();
  }
  leaveForcedPage(dir) {
    const target = this.visibleNeighbour(dir);
    this.forcedKey = null;
    if (target) this.pageIndex = this.visibleSections.findIndex((s) => s.key === target.key);
    this.scrollToTop();
    this.focusPage();
  }
  /** Tell the builder's page picker which pages exist, which a rule hides, and which is on screen. */
  reportPreviewState() {
    if (!this.previewMode || !this.definition_) return;
    const pages = this.allSections.map((s, i) => ({
      key: s.key,
      number: i + 1,
      label: s.label || s.name || `Page ${i + 1}`,
      hidden: this.logic.sectionVisible[s.key] === false
    }));
    const stops = availabilityStops(this.definition_);
    // a screen the draft can no longer reach (its opening time or closing rules were removed) gives way to the form
    if (this.previewAvailability && !stops[this.previewAvailability]) this.previewAvailability = null;
    let current = this.showWelcomeScreen ? WELCOME_STOP : this.previewEnding ? ENDING_STOP : this.currentSection?.key;
    if (this.previewAvailability) current = this.previewAvailability === "notOpen" ? NOT_OPEN_STOP : CLOSED_STOP;
    const detail = {
      pages,
      current,
      multiPage: this.definition_.displayStyle === "Multi-Page (Sections)" && pages.length > 1,
      welcome: this.hasStartScreen,
      notOpen: stops.notOpen,
      closed: stops.closed
    };
    const signature = JSON.stringify(detail);
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;
    this.dispatchEvent(new CustomEvent("previewstate", { detail }));
  }

  // ------------------------------------------------------------ derived state
  get theme() {
    return resolveTheme(this.definition_?.theme);
  }
  get rootStyle() {
    return themeToStyle(this.definition_?.theme);
  }
  /** On the mesh itself, so an answer moves the three spots without restyling the whole form. */
  get meshStyle() {
    return `--jf-drift:${this.drift}`;
  }
  /** How far through the form the respondent is, 0 to 1: the mesh background moves with it. */
  get drift() {
    if (this.showEnding) return 1;
    if (!this.showForm) return 0;
    return Math.round(this.answeredProgress * 100) / 100;
  }
  /** Share of the questions on the page shown now (every page, on a single-page form) that have an answer. */
  get pageAnsweredShare() {
    const def = this.definition_;
    const { answers, pageIndex, forcedKey } = this;
    const hit = progressCache.get(this);
    if (hit && hit.def === def && hit.answers === answers && hit.pageIndex === pageIndex && hit.forcedKey === forcedKey) return hit.share;
    const fields = this.shownSections.flatMap((p) => p.fields);
    const share = answeredShare(fields, answers, this.startAnswers);
    progressCache.set(this, { def, answers, pageIndex, forcedKey, share });
    return share;
  }
  /** The answers the form starts with: progress does not count questions that start answered. */
  get startAnswers() {
    const def = this.definition_;
    if (!def) return {};
    if (!startCache.has(def)) startCache.set(def, this.initialAnswers(def));
    return startCache.get(def);
  }
  /** Progress through the form by answers, 0 to 1: the pages behind count whole, this one by its share answered. */
  get answeredProgress() {
    const share = this.pageAnsweredShare;
    return this.isMultiPage ? (this.currentPageNumber - 1 + share) / this.totalPages : share;
  }
  get isEmbedded() {
    return this.embedded === true || this.embedFromUrl;
  }
  /** Embedded forms show only the card: the host page provides its own title and branding. */
  get showHeader() {
    return !this.isEmbedded;
  }
  get headerInCard() {
    return this.theme.titlePlacement === "card";
  }
  get showPageHeader() {
    return this.showHeader && !this.headerInCard;
  }
  /**
   * The title and description above the questions. A start screen already shows them, so its form pages leave
   * them out unless settings.welcome.showHeader brings them back; the cover image and logo stay either way.
   */
  get showFormTitle() {
    return !this.hasStartScreen || this.welcome.showHeader;
  }
  get hideFormTitle() {
    return !this.showFormTitle;
  }
  /** After a start screen the logo stays on it: the form pages show it only when they repeat the title. */
  get showHeaderBox() {
    return this.showFormTitle;
  }
  get showCardHeader() {
    return this.showHeader && this.headerInCard;
  }
  get showProgressAbove() {
    return this.isMultiPage && !this.showCardHeader && !this.forcedKey; // a hidden page has no place in the respondent's steps
  }
  get showProgressInCard() {
    return this.isMultiPage && this.showCardHeader && !this.forcedKey;
  }
  get images() {
    const t = this.theme;
    return {
      logo: safeImageUrl(t.logoUrl),
      cover: safeImageUrl(t.coverUrl),
      side: safeImageUrl(t.sideImageUrl),
      background: safeImageUrl(t.backgroundImageUrl)
    };
  }
  get logoUrl() {
    return this.images.logo || null;
  }
  /** Side image shown beside the form: needs room, and never in an embed. */
  get sideUrl() {
    return this.showHeader && this.wide ? this.images.side || null : null;
  }
  /** Banner above the title: the cover image, or the side image when there is no room beside the form. */
  get bannerUrl() {
    if (!this.showHeader) return null;
    return this.images.cover || (this.wide ? null : this.images.side) || null;
  }
  get backgroundUrl() {
    return this.showHeader ? this.images.background || null : null;
  }
  /** Mesh background (theme.backgroundStyle): behind the form like the page color; a page image takes its place. */
  get showMesh() {
    return this.theme.backgroundStyle === "mesh" && this.showHeader && !this.backgroundUrl && Boolean(this.definition_);
  }
  /** A fixed backdrop behind the page: full-page mode on a live form, never in embeds or the builder preview. */
  get showBackdrop() {
    return this.fullPage === true && !this.isEmbedded && !this.previewMode && Boolean(this.definition_);
  }
  get rootClass() {
    const classes = ["jf-root"];
    if (this.isEmbedded) classes.push("jf-embedded");
    if (this.showBackdrop) classes.push("jf-full-page");
    if (this.sideUrl) classes.push("jf-split", `jf-split-${this.theme.sideImagePosition === "right" ? "right" : "left"}`);
    if (this.backgroundUrl) classes.push("jf-has-bg");
    const t = this.theme;
    // glass needs something behind the card to show through; over a plain page or a host page it stays solid
    if (t.surfaceStyle === "glass" && (this.showMesh || this.backgroundUrl)) classes.push("jf-glass");
    if (t.buttonShape === "pill") classes.push("jf-pill");
    if (t.focusStyle === "spotlight") classes.push("jf-spotlight");
    return classes.join(" ");
  }
  get containerClass() {
    return `jf-container${this.narrow ? " jf-narrow" : ""}`;
  }
  /** Footer button text: the public view carries buttonLabels, the builder preview reads the draft's settings. */
  get buttonText() {
    return this.definition_?.buttonLabels || this.definition_?.settings?.buttons || {};
  }
  buttonLabel(key, fallback) {
    const value = this.buttonText[key];
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 40) : fallback;
  }
  get submitLabel() {
    if (this.submitting) return "Submitting…";
    const due = this.paymentDue;
    return due ? `Pay ${formatMoney(due.amount, due.currency, true)} and submit` : this.buttonLabel("submit", "Submit");
  }
  get nextLabel() {
    return this.buttonLabel("next", "Next");
  }
  get backLabel() {
    return this.buttonLabel("back", "Back");
  }
  /** Where the footer buttons sit (theme.buttonAlign) and how big they are (theme.buttonSize). */
  get actionsClass() {
    const t = this.theme;
    return `jf-actions jf-actions-${t.buttonAlign}${t.buttonSize === "large" ? " jf-actions-large" : ""}`;
  }
  get title() {
    return this.definition_?.label || this.definition_?.name;
  }
  get description() {
    return this.definition_?.description;
  }
  get showPoweredBy() {
    return this.theme.poweredBy !== false;
  }
  get visibleSections() {
    return (this.definition_?.sections || []).filter((s) => this.logic.sectionVisible[s.key] !== false);
  }
  get isMultiPage() {
    return this.definition_?.displayStyle === "Multi-Page (Sections)" && (this.visibleSections.length > 1 || Boolean(this.forcedKey));
  }
  /** Pages shown now (one for multi-page, all for single page), each with its visible fields and the logic that decides them. */
  get shownSections() {
    const sections = this.isMultiPage ? [this.currentSection] : this.visibleSections;
    const forced = this.forcedLogic;
    return sections.filter(Boolean).map((section) => {
      const logic = forced && section.key === this.forcedKey ? forced : this.logic;
      return { section, logic, fields: (section.fields || []).filter((f) => logic.visible[f.key] !== false) };
    });
  }
  get pages() {
    // Each shown page carries its fields decorated for the template.
    return this.shownSections.map(({ section: s, logic, fields }) => {
      return {
        key: s.key,
        label: s.label || s.name,
        description: s.description,
        showHeader: !this.isMultiPage && this.visibleSections.length > 1 && Boolean(s.label || s.name),
        fields: fields.map((f) => ({
          key: f.key,
          field: f,
          value: this.answers[f.key],
          otherValue: this.answers[otherKey(f)],
          required: logic.required[f.key] === true,
          payment: f.type === "payment" ? this.paymentInfo : null,
          cls: `jf-cell jf-span-${(!isTable(f.type) && COLS_BY_WIDTH[f.width]) || 12}${rowSpanOf(f) > 1 ? ` jf-tall jf-rows-${rowSpanOf(f)}` : ""}`
        }))
      };
    });
  }
  get currentPageNumber() {
    return Math.min(this.pageIndex, this.visibleSections.length - 1) + 1;
  }
  get totalPages() {
    return this.visibleSections.length;
  }
  get currentPageLabel() {
    const s = this.currentSection;
    return s ? s.label || s.name : "";
  }
  /** The bar counts pages reached; segments count answers, so the number read out matches what they show. */
  get progressPercent() {
    if (!this.totalPages) return 0;
    if (this.segmentedProgress) return Math.round(this.answeredProgress * 100);
    return Math.round((this.currentPageNumber / this.totalPages) * 100);
  }
  get segmentedProgress() {
    return this.theme.progressStyle === "segments";
  }
  /** One segment per page: pages behind are full, this one fills as its questions are answered. Null for one bar. */
  get progressSegments() {
    if (!this.segmentedProgress) return null;
    const current = this.currentPageNumber;
    const share = this.pageAnsweredShare;
    return Array.from({ length: this.totalPages }, (_, i) => {
      const fill = i + 1 < current ? 100 : i + 1 === current ? Math.round(share * 100) : 0;
      return { key: `seg${i}`, style: `width:${fill}%` };
    });
  }
  get isFirstPage() {
    if (this.forcedKey) return !this.visibleNeighbour(-1);
    return this.pageIndex === 0;
  }
  get isLastPage() {
    if (this.forcedKey) return !this.visibleNeighbour(1);
    return !this.isMultiPage || this.pageIndex >= this.visibleSections.length - 1;
  }
  get showBack() {
    return (this.isMultiPage && !this.isFirstPage) || (this.hasStartScreen && this.isFirstPage && !this.forcedKey);
  }
  get showNext() {
    return this.isMultiPage && !this.isLastPage;
  }
  /** Google's terms ask for this when the badge is hidden or the form is embedded. */
  get showRecaptchaNotice() {
    return Boolean(this.definition_?.protection?.captcha && this.definition_?.protection?.siteKey);
  }
  get ready() {
    return !this.loading && !this.loadError && Boolean(this.definition_);
  }
  get showForm() {
    return this.ready && !this.showEnding && !this.showWelcomeScreen;
  }
  get thankYouMessage() {
    return displayHtml(this.definition_?.thankYouMessage) || "<p>Thank you. Your response has been recorded.</p>";
  }
  get welcomeMessage() {
    return displayHtml(this.definition_?.welcomeMessage);
  }
  /** The welcome message above the first page (mode "message", and forms from before the start screen). */
  get showWelcome() {
    return this.welcome.mode === "message" && Boolean(this.welcomeMessage) && (!this.isMultiPage || this.isFirstPage);
  }

  // ------------------------------------------------------------ start screen
  get welcome() {
    return welcomeOf(this.definition_);
  }
  get hasStartScreen() {
    return this.welcome.mode === "screen";
  }
  /** A link with ?start=1 opens on the questions, for pages that already introduce the form. */
  get skipWelcome() {
    return ["1", "true", "yes"].includes(String(this.urlParams.start || "").toLowerCase());
  }
  startsOnWelcome() {
    return this.hasStartScreen && (this.previewMode || !this.skipWelcome);
  }
  get showWelcomeScreen() {
    return this.ready && !this.showEnding && this.onWelcome && this.hasStartScreen;
  }
  get welcomeTitle() {
    return this.welcome.title || this.title;
  }
  get startLabel() {
    return this.welcome.buttonLabel || "Start";
  }
  /** The start screen's own image, else the design's cover. */
  get welcomeImage() {
    return this.welcome.imageUrl || this.images.cover || null;
  }
  get timeText() {
    return timeTextOf(this.definition_);
  }

  // ------------------------------------------------------------ not-yet-open and closed screens
  /** The screen shown instead of the form while it is shut: the server's, or in the preview the draft's. */
  get availability() {
    if (this.previewMode) return this.previewAvailability ? availabilityOf(this.definition_, this.previewAvailability) : null;
    return this.liveAvailability;
  }
  get showAvailability() {
    // a checkout still being confirmed or ended, and its thank-you screen, come first (resumeWhileShut)
    return !this.loading && !this.submitted && !this.payment && Boolean(this.definition_) && Boolean(this.availability);
  }
  get isNotOpen() {
    return this.availability?.state === NOT_OPEN;
  }
  get availabilityTitle() {
    return this.availability?.title || this.title || (this.isNotOpen ? "This form isn't open yet" : "This form is closed");
  }
  get availabilityMessage() {
    const message = displayHtml(this.availability?.message);
    return message || (this.isNotOpen ? "" : "<p>This form is no longer accepting responses.</p>");
  }
  get availabilityWhen() {
    return this.isNotOpen && this.availability.opensText ? `This form opens on ${this.availability.opensText}.` : "";
  }
  /** The screen's own image, else the design's cover. */
  get availabilityImage() {
    return this.availability?.imageUrl || this.images.cover || null;
  }

  // ------------------------------------------------------------ thank-you screen
  get ending() {
    return endingOf(this.definition_);
  }
  get showEnding() {
    return this.ready && (this.submitted || (this.previewMode && this.previewEnding));
  }
  get endingTitle() {
    return this.ending.title;
  }
  get endingButtons() {
    return this.ending.buttons.map((b, i) => ({ ...b, key: `b${i}`, cls: `jf-btn ${i === 0 ? "jf-btn-primary" : "jf-btn-secondary"} jf-thanks-link` }));
  }
  get showSubmitAnother() {
    return this.ending.submitAnother;
  }
  get hasEndingActions() {
    return this.endingButtons.length > 0 || this.showSubmitAnother;
  }
  /** In a frame, links and the redirect move the page around it. */
  get linkTarget() {
    return this.isEmbedded ? "_top" : "_self";
  }
  get inFrame() {
    return this.isEmbedded && typeof window !== "undefined" && window.parent !== window;
  }
  /** What the thank-you screen says about the redirect, or null when there is none. */
  get redirect() {
    const { redirectUrl, redirectDelay } = this.ending;
    if (!redirectUrl) return null;
    const host = hostOf(redirectUrl);
    if (this.previewMode) {
      const when = redirectDelay > 0 ? `After ${redirectDelay} s, people` : "People";
      return { preview: true, url: redirectUrl, text: `${when} go on to ${host}. The preview stays here.` };
    }
    const seconds = this.redirectSeconds;
    return {
      preview: false,
      url: redirectUrl,
      text: seconds > 0 ? `Taking you to ${host} in ${seconds} s.` : `Taking you to ${host}…`,
      linkLabel: this.inFrame ? `Continue to ${host}` : "Go now"
    };
  }
  get versionLabel() {
    return this.definition_?.version ? `Form v${this.definition_.version}` : "";
  }

  // ------------------------------------------------------------ size: narrow layout + embed height
  renderedCallback() {
    this.reportPreviewState();
    if (this.resizeObserver || typeof ResizeObserver === "undefined") return;
    const root = this.template.querySelector(".jf-root");
    if (!root) return;
    this.resizeObserver = new ResizeObserver(() => {
      const width = root.getBoundingClientRect().width;
      const wide = width >= SPLIT_MIN_WIDTH;
      if (wide !== this.wide) this.wide = wide;
      // With a side image the form gets the wider of two columns; measure that column, not the whole root.
      const split = wide && this.showHeader && Boolean(this.images.side);
      const mainWidth = split ? (width * 7) / 12 : width;
      const narrow = width > 0 && mainWidth < 600;
      if (narrow !== this.narrow) this.narrow = narrow;
      if (this.isEmbedded && window.parent !== window) this.postHeight(root);
    });
    this.resizeObserver.observe(root);
  }
  disconnectedCallback() {
    this.stopRedirect();
    this.stopPayPolling();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
  }
  postHeight(root) {
    try {
      window.parent.postMessage({ type: "jform:height", key: this.resolvedKey, height: Math.ceil(root.getBoundingClientRect().height) }, "*");
    } catch (e) {
      /* cross-origin parents still receive the message; ignore any failure */
    }
  }

  // ------------------------------------------------------------ handlers
  handleFieldChange(event) {
    const { key, value, files } = event.detail;
    if (!key) return;
    this.answers = { ...this.answers, [key]: value };
    // the text typed under a choice's Other, kept as its own answer; dropped once Other is unpicked
    if ("other" in event.detail) {
      const other = otherKey({ key });
      const answers = { ...this.answers, [other]: event.detail.other };
      if (event.detail.other === undefined) delete answers[other];
      this.answers = answers;
    }
    if (files) this.files = { ...this.files, [key]: files };
    this.recompute();
  }

  handleHoneypot(event) {
    this.honeypot = event.target.value;
  }

  handleBack() {
    if (this.forcedKey) {
      this.leaveForcedPage(-1);
      return;
    }
    if (this.isMultiPage && this.pageIndex > 0) {
      this.pageIndex -= 1;
      this.scrollToTop();
      this.focusPage();
    } else if (this.hasStartScreen) {
      this.onWelcome = true;
      this.scrollToTop();
      this.focusSelector(".jf-welcome-title");
    }
  }

  handleStart() {
    this.onWelcome = false;
    this.scrollToTop();
    this.focusPage();
  }

  /** Start again from the welcome screen (or page 1) with a fresh, empty form. */
  handleSubmitAnother() {
    this.stopRedirect();
    this.answers = this.initialAnswers(this.definition_);
    this.files = {};
    this.honeypot = "";
    this.submitted = false;
    this.submissionId = undefined;
    this.uploadWarning = undefined;
    this.errorMessage = undefined;
    this.paymentProcessing = false;
    this.payNotice = undefined;
    this.promotion = null;
    this.promotionError = "";
    this.pageIndex = 0;
    this.forcedKey = null;
    this.recompute();
    this.onWelcome = this.startsOnWelcome();
    this.fetchToken();
    this.scrollToTop();
    if (this.onWelcome) this.focusSelector(".jf-welcome-title");
    else this.focusPage();
  }

  handleNext() {
    if (!this.skipChecks && !this.validateCurrentPage()) return;
    if (this.forcedKey) {
      this.leaveForcedPage(1);
      return;
    }
    if (this.pageIndex < this.visibleSections.length - 1) {
      this.pageIndex += 1;
      this.scrollToTop();
      this.focusPage();
    }
  }

  focusSelector(selector) {
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      const el = this.template.querySelector(selector);
      if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
    }, 0);
  }

  // ------------------------------------------------------------ redirect after the thank-you screen
  startRedirect() {
    const { redirectUrl, redirectDelay } = this.ending;
    if (!redirectUrl || this.previewMode) return;
    this.redirectSeconds = redirectDelay;
    if (redirectDelay <= 0) {
      this.goToRedirect();
      return;
    }
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.redirectTimer = setInterval(() => {
      this.redirectSeconds -= 1;
      if (this.redirectSeconds <= 0) {
        this.stopRedirect();
        this.goToRedirect();
      }
    }, 1000);
  }
  stopRedirect() {
    if (this.redirectTimer) clearInterval(this.redirectTimer);
    this.redirectTimer = undefined;
  }
  /**
   * A frame cannot reliably move the page around it, so an embedded form asks the embed snippet to
   * (jform:redirect, next to jform:height). Snippets from before the redirect ignore the message; the
   * "Continue to …" link on the thank-you screen covers them.
   */
  goToRedirect() {
    const url = this.ending.redirectUrl;
    if (!url) return;
    if (this.inFrame) {
      try {
        window.parent.postMessage({ type: "jform:redirect", key: this.resolvedKey, url }, "*");
      } catch (e) {
        /* the link on the screen still works */
      }
      return;
    }
    window.location.assign(url);
  }

  /** Keyboard and screen-reader users land on the new page's title rather than on a button that just disappeared. */
  focusPage() {
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      const title = this.template.querySelector(".jf-page-title") || this.template.querySelector("c-jform-field");
      if (title && typeof title.focus === "function") title.focus({ preventScroll: true });
    }, 0);
  }

  async handleSubmit(event) {
    event.preventDefault();
    if (this.submitting || this.payment) return;
    if (!this.skipChecks && !this.validateCurrentPage()) return;
    if (this.previewMode) {
      this.previewNotice = true;
      return;
    }
    // the fields refuse a wrong file when it's picked; this catches anything that got past them
    const fileTrouble = this.pendingUploads().map(([key, list]) => fileProblem(this.fieldOf(key), list)).find(Boolean);
    if (fileTrouble) {
      this.errorMessage = fileTrouble;
      return;
    }
    const problem = this.paymentInfo?.problem;
    if (problem) {
      this.errorMessage = problem;
      return;
    }
    if (this.paymentDue || this.freeWithCode) {
      this.pay();
      return;
    }
    this.submitting = true;
    this.errorMessage = undefined;
    this.payNotice = undefined;
    try {
      const payload = await this.payloadOf();
      this.submissionId = await submitWithSource({ publicKey: this.resolvedKey, answersJson: JSON.stringify(payload), sourceUrl: window.location.href });
      if (this.submissionId) await this.uploadFiles();
      this.finishSubmission();
    } catch (e) {
      const message = this.messageOf(e);
      // the form closed or filled up while it was being answered: its closed screen says so
      if (!(await this.loadClosedScreen())) this.errorMessage = message || "Your answers could not be saved. Please try again.";
    } finally {
      this.submitting = false;
    }
  }

  /** The visible answers, and what the server scores alongside them. */
  async payloadOf() {
    const payload = {};
    for (const section of this.definition_.sections || []) {
      for (const field of section.fields || []) {
        if (collectsAnswer(field.type) && this.logic.visible[field.key] !== false && field.key in this.answers) {
          // a Name or Address field sends its parts, trimmed: { firstName, lastName }, { country: "AU", ... }
          const value = this.answers[field.key];
          payload[field.key] = isName(field.type) ? nameValue(field, value) : isAddress(field.type) ? addressValue(field, value, this.addressLists) : value;
          const other = this.answers[otherKey(field)];
          if (picksOther(field, value) && typeof other === "string" && other.trim()) payload[otherKey(field)] = other.trim();
        }
      }
    }
    // The server scores these alongside the answers: a filled honeypot, a submission faster than a person could
    // type, or a low reCAPTCHA score is stored as spam while still looking successful.
    payload[HONEYPOT_KEY] = this.honeypot || "";
    payload[TIMING_ANSWER_KEY] = this.protectionToken || "";
    if (this.promotion?.code) payload[CODE_KEY] = this.promotion.code;
    const captcha = await this.captchaToken();
    if (captcha) payload[CAPTCHA_KEY] = captcha;
    return payload;
  }

  finishSubmission() {
    this.submitted = true;
    // the submission Id stays inside: attachFile trusts it, so it is not handed to the page or other components
    this.dispatchEvent(new CustomEvent("submitted"));
    this.scrollToTop();
    this.focusSelector(".jf-thanks");
    this.startRedirect();
  }

  // ------------------------------------------------------------ payments
  /** The Payment block's lines and total for the answers so far, with the applied promotion code; null without a visible block. */
  get paymentInfo() {
    const view = this.definition_ ? paymentView(this.definition_, this.answers, this.logic.visible, false, this.promotion) : null;
    if (view) {
      view.codeError = this.promotionError || "";
      view.codeBusy = this.promotionBusy === true;
    }
    return view;
  }

  /**
   * The Payment block's Apply button. The server answers valid or not, with the code's terms when valid; a
   * refused code gets one message whatever the reason. The terms price the block here until the Pay click,
   * when the server checks the code again.
   */
  async handleApplyCode(event) {
    const code = String(event.detail?.code || "").trim();
    if (!code || this.promotionBusy) return;
    if (this.previewMode) {
      this.promotionError = "Promotion codes are checked on the published form.";
      return;
    }
    this.promotionBusy = true;
    this.promotionError = "";
    try {
      const answer = await checkPromotionCode({ publicKey: this.resolvedKey, code, token: this.protectionToken || "" });
      if (answer && answer.valid) {
        this.promotion = {
          code: answer.code,
          discountType: answer.discountType,
          percentOff: answer.percentOff,
          amountOff: answer.amountOff,
          minimumCharge: answer.minimumCharge
        };
      } else {
        this.promotionError = CODE_REFUSED;
      }
    } catch (e) { // eslint-disable-line no-unused-vars
      this.promotionError = CODE_REFUSED;
    } finally {
      this.promotionBusy = false;
    }
  }

  handleRemoveCode() {
    this.promotion = null;
    this.promotionError = "";
  }
  /** The payment the Pay button takes, or null when there is nothing to pay. */
  get paymentDue() {
    const p = this.paymentInfo;
    return p && p.amount > 0 && !p.problem ? p : null;
  }
  /** A promotion code took the total to zero: still sent through the Pay path, where the server checks the code and records its use. */
  get freeWithCode() {
    const p = this.paymentInfo;
    return Boolean(p && p.codeApplied && p.amount <= 0 && !p.problem);
  }
  /** "This form isn't taking payments right now." when live payments stopped (no license) or the currency is unusable. */
  get paymentUnavailable() {
    return this.paymentDue && !this.previewMode ? paymentSettings(this.definition_).unavailable : null;
  }
  get submitDisabled() {
    return this.submitting || Boolean(this.paymentUnavailable);
  }
  /** Answers cannot change while a checkout for them is open. */
  get formLocked() {
    return Boolean(this.payment);
  }
  get showSubmit() {
    return this.isLastPage && !this.payment;
  }
  get payPanel() {
    const p = this.payment;
    if (!p) return null;
    const name = gatewayOf(paymentSettings(this.definition_).gateway)?.name;
    return {
      confirming: p.confirming === true,
      leaving: p.leaving === true,
      blocked: !p.confirming && !p.leaving && p.blocked === true,
      waiting: !p.confirming && !p.leaving && p.blocked !== true,
      // no window came back: the browser blocked it, or opened it without telling the form (noopener)
      blockedTitle: "The payment window may not have opened.",
      blockedText: "If you don't see it, open the payment page. This form updates as soon as you have paid.",
      url: p.url,
      popup: p.popup === true,
      leavingTitle: name ? `Taking you to ${name}'s payment page…` : "Taking you to the payment page…",
      // a cancel the gateway could not take leaves a checkout that can still be paid, so the form stays locked;
      // a popup closed without paying: the respondent is not told to pay in a window that is gone
      waitingTitle: p.uncancelled
        ? "The payment could not be cancelled."
        : p.closed
          ? "The payment window was closed."
          : name
            ? `Complete your payment in the ${name} window`
            : "Complete your payment in the payment window",
      waitingText: p.uncancelled
        ? p.url
          ? "You can still finish paying, or try cancelling again."
          : "Try cancelling again in a moment."
        : p.closed
          ? "Reopen it to finish paying, or cancel the payment."
          : "This form updates as soon as you have paid."
    };
  }
  get processingText() {
    return PAY_PROCESSING;
  }
  get previewNoticeText() {
    return this.paymentDue
      ? "Preview mode: the form validates but answers are not submitted and no payment is taken. Publish with test payments to try a checkout."
      : "Preview mode: the form validates but answers are not submitted.";
  }

  /**
   * The Pay button. The server checks and prices the answers, opens a Stripe checkout and stores the response as
   * Awaiting payment; the response counts once Stripe says it is paid. In popup mode the window opens here,
   * inside the click, so popup blockers allow it, and gets Stripe's address when the server has it. Lightning
   * Web Security can refuse that blank window (from Winter '27 it lets no component open a same-origin page in a
   * new window where its blockWindowOpenSameOriginSameContext gate is on, as on Aura sites); then Stripe's address
   * opens as soon as the server has it. That window comes back without a reference (the gate adds noopener), so
   * the form cannot tell it from a blocked one: the panel offers the payment page either way, and the form
   * still learns of the payment by reading it.
   */
  async pay() {
    const popup = paymentSettings(this.definition_).openIn === "popup";
    // a free order opens no checkout, so no window
    const win = popup && this.paymentDue ? this.openPayWindow("") : null;
    this.submitting = true;
    this.errorMessage = undefined;
    this.payNotice = undefined;
    try {
      const payload = await this.payloadOf();
      const started = await submitWithPayment({
        publicKey: this.resolvedKey,
        answersJson: JSON.stringify(payload),
        sourceUrl: window.location.href,
        returnUrl: this.payReturnUrl(popup)
      });
      this.submissionId = started?.submissionId;
      if (!started?.checkoutUrl) {
        // nothing to pay after all, or a response set aside as spam: it was stored like any other
        this.closePayWindow(win);
        if (this.submissionId) await this.uploadFiles();
        this.finishSubmission();
        return;
      }
      const opened = popup && !win ? this.openPayWindow(started.checkoutUrl) : win;
      this.payment = { reference: started.checkoutReference, url: started.checkoutUrl, popup, blocked: popup && !opened };
      if (popup) {
        this.payWindow = opened;
        if (win && !this.sendPayWindow(started.checkoutUrl)) this.payment = { ...this.payment, blocked: true };
        this.startPayPolling();
        if (this.submissionId) await this.uploadFiles();
      } else {
        if (this.submissionId) await this.uploadFiles();
        this.rememberPayment();
        this.goToCheckout(started.checkoutUrl);
      }
    } catch (e) {
      this.closePayWindow(win);
      const message = this.messageOf(e);
      if (this.promotion && message === CODE_REFUSED) {
        // the code stopped being valid since it was applied: the block prices again without it
        this.promotion = null;
        this.promotionError = message;
      }
      if (!(await this.loadClosedScreen())) this.errorMessage = message || "Your answers could not be saved. Please try again.";
    } finally {
      this.submitting = false;
    }
  }

  /** Stripe sends the respondent back here. A framed form that went to Stripe's page comes back as a page of its own. */
  payReturnUrl(popup) {
    const url = new URL(window.location.href);
    for (const p of PAY_PARAMS) url.searchParams.delete(p);
    if (!popup && this.inFrame) url.searchParams.delete("embed");
    return url.toString();
  }

  openPayWindow(url) {
    try {
      return window.open(url, PAY_WINDOW, PAY_WINDOW_FEATURES) || null;
    } catch (e) {
      return null;
    }
  }
  sendPayWindow(url) {
    try {
      this.payWindow.location.href = url;
      return true;
    } catch (e) {
      return false;
    }
  }
  closePayWindow(win) {
    try {
      if (win && !win.closed) win.close();
    } catch (e) {
      /* Stripe's page may already have taken the window over */
    }
  }

  /** Stripe's page: a framed form asks the embed snippet to move the page around it (Stripe cannot run in a frame). */
  goToCheckout(url) {
    this.payment = { ...this.payment, leaving: true };
    if (!this.inFrame) {
      window.location.assign(url);
      return;
    }
    try {
      window.parent.postMessage({ type: "jform:redirect", key: this.resolvedKey, url }, "*");
    } catch (e) {
      /* the "Open payment page" link on the panel still works */
    }
  }

  handleReopenPayment() {
    const p = this.payment;
    if (!p?.url) return;
    const win = this.openPayWindow(p.url);
    if (win) this.payWindow = win;
    this.payment = { ...p, blocked: !win, closed: false, uncancelled: false };
    this.checkPayment(false);
  }

  payWindowClosed() {
    try {
      return this.payWindow?.closed === true;
    } catch (e) {
      return false;
    }
  }

  handleCancelPayment() {
    this.cancelCheckout();
  }

  startPayPolling() {
    this.stopPayPolling();
    this.payStarted = Date.now();
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.payTimer = setInterval(() => this.checkPayment(false), PAY_POLL_MS);
    window.addEventListener("message", this.onPayMessage);
    document.addEventListener("visibilitychange", this.onPayVisible);
  }
  stopPayPolling() {
    if (this.payTimer) clearInterval(this.payTimer);
    this.payTimer = undefined;
    window.removeEventListener("message", this.onPayMessage);
    document.removeEventListener("visibilitychange", this.onPayVisible);
  }
  /** The popup's return page reports back (same origin only): paid, or left without paying. */
  onPayMessage = (event) => {
    if (event.origin !== window.location.origin) return;
    const m = event.data;
    if (!m || m.type !== "jform:payment" || !this.payment) return;
    if (m.result === "cancel") this.cancelCheckout();
    else this.checkPayment(true);
  };
  onPayVisible = () => {
    if (document.visibilityState === "visible") this.checkPayment(false);
  };

  /** Read the payment record; with confirm, the server asks Stripe first instead of waiting for the webhook. */
  async checkPayment(confirm) {
    if (!this.payment || this.payBusy) return;
    if (this.payStarted && Date.now() - this.payStarted > PAY_POLL_LIMIT_MS) {
      // the checkout has expired at the gateway by now: end the wait rather than leave the form behind the
      // panel; the cancel path applies what the gateway has, so a payment made meanwhile still counts
      this.cancelCheckout();
      return;
    }
    if (this.payment.popup && !this.payment.closed && this.payWindowClosed()) this.payment = { ...this.payment, closed: true };
    const p = this.payment;
    this.payBusy = true;
    try {
      const status = await getPaymentStatus({ publicKey: this.resolvedKey, checkoutReference: p.reference, confirm });
      if (this.payment === p) this.applyPaymentStatus(status);
    } catch (e) {
      /* the next check tries again */
    } finally {
      this.payBusy = false;
    }
  }

  /**
   * What the server said about the checkout. Paid and processing end in the thank-you screen; failed and
   * expired end the wait with the notice. "unknown" (no checkout of this form has the reference: the response
   * is gone, or the reference is stale) is left to the next read like a failed one, so the wait only ends
   * through the limit's cancel, where the checkout is read once more.
   */
  applyPaymentStatus(status) {
    if (status === "paid" || status === "processing") {
      this.endPayment();
      this.paymentProcessing = status === "processing";
      this.finishSubmission();
      return true;
    }
    if (status === "failed" || status === "expired") {
      this.endPayment();
      this.payNotice = PAY_CANCELLED;
      return true;
    }
    return false;
  }

  endPayment() {
    this.stopPayPolling();
    this.closePayWindow(this.payWindow);
    this.payWindow = null;
    this.payment = null;
    this.forgetPayment();
  }

  /**
   * The respondent stops paying: end the checkout so it cannot be paid later. One paid meanwhile counts as paid.
   * When the gateway cannot be reached or does not end the checkout (the cancel throws, or answers "open"), the
   * checkout can still be paid, so the form stays locked, says so, and keeps reading the checkout until it is
   * paid, fails or expires, or a later cancel ends it; unlocking here would let a second checkout be opened
   * and both be paid.
   */
  async cancelCheckout() {
    const p = this.payment;
    if (!p) return;
    this.stopPayPolling();
    this.closePayWindow(this.payWindow);
    this.payWindow = null;
    this.payment = { ...p, confirming: true };
    let status;
    try {
      status = await cancelPayment({ publicKey: this.resolvedKey, checkoutReference: p.reference });
    } catch (e) {
      status = undefined;
    }
    if (!this.applyPaymentStatus(status)) {
      if (status === "unknown") {
        // no checkout of this form has the reference, so there is nothing left to pay or to cancel
        this.endPayment();
        this.payNotice = PAY_CANCELLED;
        return;
      }
      this.payment = { ...p, confirming: false, leaving: false, blocked: false, closed: false, uncancelled: true };
      this.startPayPolling();
    }
  }

  // ------------------------------------------------------------ payments: Stripe's page and the popup's return
  rememberPayment() {
    try {
      const answers = {};
      for (const [key, value] of Object.entries(this.answers)) if (!(key in this.files)) answers[key] = value;
      sessionStorage.setItem(
        PAY_STORE + this.resolvedKey,
        JSON.stringify({ reference: this.payment.reference, url: this.payment.url, answers, pageIndex: this.pageIndex })
      );
    } catch (e) {
      /* without storage a cancelled payment shows an empty form */
    }
  }
  recallPayment() {
    try {
      return JSON.parse(sessionStorage.getItem(PAY_STORE + this.resolvedKey) || "null");
    } catch (e) {
      return null;
    }
  }
  forgetPayment() {
    try {
      sessionStorage.removeItem(PAY_STORE + this.resolvedKey);
    } catch (e) {
      /* nothing kept */
    }
  }
  /** Drop jfpay, jfcs and jfwin from the address, so a reload or a new response starts clean. */
  clearPayParams() {
    try {
      const url = new URL(window.location.href);
      for (const p of PAY_PARAMS) url.searchParams.delete(p);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch (e) {
      /* the parameters stay; the outcome is the same */
    }
  }

  /** Back from Stripe's page (?jfpay=success or cancel, without jfwin): the thank-you screen, or the answers again. */
  async resumePayment() {
    const result = this.urlParams.jfpay;
    if (!result || this.previewMode || this.urlParams.jfwin === "1") return;
    this.clearPayParams();
    const saved = this.recallPayment();
    // Stripe's ID from the success link, else JForm's own reference from either link, else what the browser kept.
    // An embedded form comes back with no storage (browsers keep a frame's apart), so the checkout is ended from
    // the link alone; its answers are gone.
    const reference = (result === "success" && this.urlParams.jfcs) || this.urlParams.jfref || saved?.reference;
    if (!reference) return;
    if (saved?.answers) {
      this.answers = { ...this.answers, ...saved.answers };
      this.recompute();
      this.pageIndex = Math.min(saved.pageIndex || 0, Math.max(0, this.visibleSections.length - 1));
    }
    this.onWelcome = false;
    // the checkout's address comes back with the answers, so a cancel the gateway could not take can offer it again
    this.payment = { reference, url: saved?.url, popup: false, confirming: true };
    if (result !== "success") {
      await this.cancelCheckout();
      return;
    }
    let status;
    try {
      status = await getPaymentStatus({ publicKey: this.resolvedKey, checkoutReference: reference, confirm: true });
    } catch (e) {
      status = "open";
    }
    if (!this.applyPaymentStatus(status)) {
      if (status === "unknown") {
        // no checkout of this form has the reference (as in cancelCheckout): nothing to confirm, and the
        // checking panel has no Cancel to end the wait with
        this.endPayment();
        this.payNotice = PAY_CANCELLED;
        return;
      }
      // Stripe has not reported yet: keep checking, as the popup does
      this.payment = { reference, url: saved?.url, popup: false, confirming: true };
      this.startPayPolling();
    }
  }

  /** This window is the popup coming back from Stripe: confirm the payment, tell the form that opened it, close. */
  async showPayReturn() {
    const result = this.urlParams.jfpay === "success" ? "success" : "cancel";
    this.loading = false;
    this.payReturn = { result, checking: result === "success" && Boolean(this.urlParams.jfcs) };
    let status;
    if (this.payReturn.checking) {
      try {
        status = await getPaymentStatus({ publicKey: this.resolvedKey, checkoutReference: this.urlParams.jfcs, confirm: true });
      } catch (e) {
        status = undefined;
      }
    }
    this.payReturn = { result, status, checking: false };
    let opener = null;
    try {
      opener = window.opener;
    } catch (e) {
      opener = null;
    }
    if (!opener) return;
    try {
      opener.postMessage({ type: "jform:payment", result, status }, window.location.origin);
      window.close();
    } catch (e) {
      /* the form checks the payment by itself too; the screen tells the respondent to close the window */
    }
  }
  get payReturnTitle() {
    const r = this.payReturn;
    if (!r) return "";
    if (r.checking) return "Checking your payment…";
    if (r.result !== "success") return "Payment not completed";
    return r.status === "processing" ? "Payment processing" : "Payment received";
  }
  get payReturnText() {
    const r = this.payReturn;
    if (!r || r.checking) return "";
    if (r.result === "success" && r.status === "processing") return `${PAY_PROCESSING} You can close this window.`;
    return "You can close this window and go back to the form.";
  }
  handleCloseWindow() {
    try {
      window.close();
    } catch (e) {
      /* a window the script did not open stays; the text says to close it */
    }
  }

  /** [fieldKey, files] for every fileupload field that is still visible, from any page. */
  pendingUploads() {
    return Object.entries(this.files).filter(([key, list]) => list && list.length && this.logic.visible[key] !== false);
  }

  /** The field with this key, from any page. */
  fieldOf(key) {
    return this.allSections.flatMap((s) => s.fields || []).find((f) => f.key === key);
  }

  /** Upload files chosen in fileupload fields; failures are reported but do not undo the submission. */
  async uploadFiles() {
    const failures = [];
    for (const [fieldKey, files] of this.pendingUploads()) {
      const field = this.fieldOf(fieldKey);
      for (const file of files) {
        const problem = fileProblem(field, [file]);
        if (problem) {
          failures.push(problem);
          continue;
        }
        try {
          const base64 = await this.readAsBase64(file);
          await attachFile({ publicKey: this.resolvedKey, submissionId: this.submissionId, fieldKey, fileName: file.name, base64Content: base64 });
        } catch (e) {
          failures.push(`${file.name}: ${this.messageOf(e)}`);
        }
      }
    }
    if (failures.length) this.uploadWarning = `Your answers were saved, but some files could not be attached: ${failures.join("; ")}`;
  }

  readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("could not read the file"));
      reader.readAsDataURL(file);
    });
  }

  validateCurrentPage() {
    const fields = Array.from(this.template.querySelectorAll("c-jform-field"));
    let firstInvalid;
    for (const f of fields) {
      const ok = f.validate();
      if (!ok && !firstInvalid) firstInvalid = f;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  scrollToTop() {
    // In the builder the preview scrolls inside its own panel, which the Design tab resets when it hears
    // of the page change (previewstate); scrolling into view here would move the whole Lightning page.
    if (this.previewMode) return;
    const root = this.template.querySelector(".jf-root");
    if (root && typeof root.scrollIntoView === "function") {
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  messageOf(e) {
    if (!e) return undefined;
    if (typeof e === "string") return e;
    if (e.body?.message) return e.body.message;
    if (Array.isArray(e.body) && e.body[0]?.message) return e.body[0].message;
    return e.message;
  }
}
