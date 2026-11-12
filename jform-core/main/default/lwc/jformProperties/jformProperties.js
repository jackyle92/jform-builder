import { LightningElement, api, track } from "lwc";
import getObjectFields from "@salesforce/apex/JFormWorkspaceController.getObjectFields";
import getPaymentStatus from "@salesforce/apex/JFormWorkspaceController.getPaymentStatus";
import { mainStepOf, addressTargets, defaultAddressTarget } from "c/jformAutomationPresets";
import {
  FIELD_TYPES, getType, needsOptions, isLayout, iconUrl, rowSpanOf, MAX_ROW_SPAN,
  tableRows, rowKeyFor, TABLE_SCALES, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS,
  NAME_PARTS, nameParts, MAX_NAME_PART_LENGTH, ADDRESS_PARTS, ADDRESS_PURPOSES, addressParts, addressPurpose, answerFieldsOf,
  canOfferOther, offersOther, otherLabel, otherChoiceValue, choiceOptionsOf, choiceLimitText, isMultiple, OTHER_LABEL, OTHER_PLACEHOLDER,
  FILE_KINDS, fileGroupsFor, chosenExtensions, allowedExtensions, fileLimits, fileRuleText, MAX_FILE_MB, MAX_FIELD_FILES
} from "c/jformFieldRegistry";
import createPublicLink from "@salesforce/apex/JFormImageService.createPublicLink";
import { describeRule } from "c/jformLogic";
import { COUNTRIES, localeCountry } from "c/jformPhone";
import { defaultChoiceColumns } from "c/jformTheme";
import { welcomeOf, estimateMinutes, questionCount, safeLink, safeImage, MAX_BUTTONS, MAX_MINUTES, TITLE_MAX, LABEL_MAX } from "c/jformScreens";
import LOCALE from "@salesforce/i18n/locale";
import { PRICING_OPTIONS, CHOICE_SOURCES, pricingOf, paymentSettings, decimalsOf, gatewayOf, gatewayOptions } from "c/jformPayment";

const PATTERN_PRESETS = [
  { label: "None", value: "none", pattern: "" },
  { label: "Email address", value: "email", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
  { label: "Phone number", value: "phone", pattern: "^[+()\\d\\s-]{6,20}$" },
  { label: "Digits only", value: "digits", pattern: "^\\d+$" },
  { label: "Web address", value: "url", pattern: "^https?://.+" },
  { label: "Custom expression", value: "custom", pattern: null }
];

const LENGTH_TYPES = new Set(["text", "comment", "email", "phone"]);
/** Choices shown as a list of options, which can sit several to a row. */
const OPTION_LIST_TYPES = new Set(["radio", "checkboxes", "multiselect"]);
const NUMBER_TYPES = new Set(["number", "nps", "rating"]);
const PLACEHOLDER_TYPES = new Set(["text", "comment", "email", "phone", "number", "picklist", "date", "time"]);
const WELCOME_MODES = [
  ["off", "Off"],
  ["message", "Message"],
  ["screen", "Start screen"]
];
const WELCOME_MODE_HELP = {
  off: "The form opens on its first page.",
  message: "A message at the top of the first page, under the form's description.",
  screen: "A screen of its own before the questions, with a Start button. A link ending in ?start=1 skips it, for pages that already introduce the form."
};
const REDIRECT_DELAYS = [
  ["0", "At once"],
  ["3", "3 s"],
  ["5", "5 s"],
  ["10", "10 s"]
];
const LINK_HELP = "Use a full link starting with https:// or http://.";
const WEEKDAYS = [
  { label: "Mon", value: "1" }, { label: "Tue", value: "2" }, { label: "Wed", value: "3" }, { label: "Thu", value: "4" },
  { label: "Fri", value: "5" }, { label: "Sat", value: "6" }, { label: "Sun", value: "0" }
];
const TIME_STEPS = [5, 10, 15, 20, 30, 60].map((n) => ({ label: `${n} minutes`, value: String(n) }));
/** Config settings that are on unless set to false (signature typing and record files); false is kept for these. */
const ON_BY_DEFAULT = new Set(["allowTyped", "attachToRecord", "everyRow"]);
/** Objects whose standard FirstName and LastName a Name field's parts map to as soon as one is chosen. */
const PERSON_OBJECTS = new Set(["contact", "lead"]);
const HOUR_FORMATS = [
  { label: "Respondent's locale", value: "auto" },
  { label: "12-hour (9:30 PM)", value: "12" },
  { label: "24-hour (21:30)", value: "24" }
];

/** The field's settings fold into sections; these start folded, and each builder's choice is remembered in the browser. */
const SECTION_IDS = ["content", "general", "image", "event", "gateway", "payment", "signature", "files", "rows", "name", "nameParts", "address", "addressParts", "options", "phone", "date", "time", "layout", "mapping", "validation", "logic"];
const FOLDED_BY_DEFAULT = new Set(["nameParts", "addressParts", "phone", "date", "time", "layout", "mapping", "validation", "logic"]);
const SECTIONS_KEY = "jform.propertySections";
/** Per panel: the section map and the openSections it was built from. Not reactive state. */
const sectionCache = new WeakMap();

/** Right-hand properties panel for the selected field or page. */
export default class JformProperties extends LightningElement {
  @api definition;
  _selection;
  @api
  get selection() {
    return this._selection;
  }
  set selection(value) {
    const kind = value?.kind;
    if (kind !== this._selection?.kind || value?.sectionIndex !== this._selection?.sectionIndex || value?.fieldIndex !== this._selection?.fieldIndex) {
      this.screenDrafts = {};
      this.redirectOpen = false;
      this.newButton = null;
    }
    this._selection = value;
  }
  /**
   * Values typed on the welcome and thank-you screens that cannot be saved yet (a link still being typed,
   * a button without a label): autosave checks the whole form, so only valid values are committed.
   */
  @track screenDrafts = {};
  redirectOpen = false;
  /** The button being added on the thank-you screen: { label, url }, or null. */
  @track newButton = null;
  @api targetObjects = [];
  /**
   * Whether the gateway's test and live payments are set up, for the Payment block's Gateway group. Read when the panel
   * first shows a Payment block, so secrets saved on the Setup tab show, and forms without one never ask.
   */
  paymentStatus;
  paymentStatusRead = false;

  /** Sections the builder opened or folded: { id: open }. */
  @track openSections = {};

  connectedCallback() {
    try {
      this.openSections = JSON.parse(window.localStorage.getItem(SECTIONS_KEY) || "{}") || {};
    } catch {
      // storage blocked or unreadable: every section starts as it does by default
    }
  }
  async readPaymentStatus() {
    this.paymentStatusRead = true;
    try {
      this.paymentStatus = await getPaymentStatus();
    } catch (e) {
      // the gateway tiles then show no state, as before the status arrives
    }
  }

  @track fieldCache = {}; // objectApiName -> FieldOption[]
  loadingFieldsFor;
  patternChoice;

  // ------------------------------------------------------------ selection
  get field() {
    const s = this.selection;
    if (!s || s.kind !== "field") return null;
    return this.definition?.sections?.[s.sectionIndex]?.fields?.[s.fieldIndex] || null;
  }
  get page() {
    const s = this.selection;
    if (!s || s.kind !== "page") return null;
    return this.definition?.sections?.[s.sectionIndex] || null;
  }
  get hasField() {
    return Boolean(this.field);
  }
  get hasPage() {
    return Boolean(this.page);
  }
  get nothingSelected() {
    return !this.field && !this.page && !this.hasWelcome && !this.hasEnding;
  }

  // ------------------------------------------------------------ sections
  /**
   * Per section, for c/jformPropertySection: whether it is open, and when folded a short summary of what it holds.
   * The template reads this many times a render, so the map is built again only when a section opens or folds, and
   * a summary is worked out only when its own section reads it.
   */
  get sec() {
    // the open state changes only with openSections; the summaries read the field when the template asks for them
    const hit = sectionCache.get(this);
    if (hit && hit.openSections === this.openSections) return hit.sec;
    const out = {};
    for (const id of SECTION_IDS) {
      const open = this.isSectionOpen(id);
      const panel = this;
      out[id] = {
        open,
        get summary() {
          return open || !panel.field ? "" : panel.sectionSummary(id);
        }
      };
    }
    sectionCache.set(this, { openSections: this.openSections, sec: out });
    return out;
  }
  isSectionOpen(id) {
    return this.openSections[id] ?? !FOLDED_BY_DEFAULT.has(id);
  }
  sectionSummary(id) {
    switch (id) {
      case "layout": {
        const rows = rowSpanOf(this.field);
        return `${this.widthValue}% wide${rows > 1 ? `, ${rows} rows` : ""}`;
      }
      case "mapping": {
        const main = this.mainStep;
        if (!main) return "Not saved to a record";
        if (this.isAddress) {
          if (this.mappedAddress) return `${main.object}.${this.mappedAddress}`;
          const prefix = `${this.field.key}.`;
          if (!(main.fields || []).some((m) => m.source?.type === "field" && String(m.source.key).startsWith(prefix))) return "Not mapped";
          // mapped, but which address is known only once the object's fields load: say nothing until then
          return this.fieldCache[this.mappingObject]?.length ? main.object : "";
        }
        if (this.isName) return this.nameMappings.some((m) => m.value) ? main.object : "Not mapped";
        return this.mappedObjectField ? `${main.object}.${this.mappedObjectField}` : "Not mapped";
      }
      case "validation":
        return Object.keys(this.validation).length ? "On" : "None";
      case "logic":
        return this.ruleSentence ? "Has a rule" : "None";
      case "nameParts":
        return this.namePartItems.map((p) => p.title).join(", ");
      case "addressParts":
        return `${this.addressPartItems.length} parts`;
      case "phone":
        return this.hasCountryPicker ? "Country code picker" : "Typed freely";
      case "files":
        return fileRuleText(this.field) || "Any allowed file";
      case "options": {
        if (this.isTable) return `${(this.field.options || []).length} columns`;
        const n = (this.field.options || []).length;
        const limit = choiceLimitText(this.field);
        return `${n} ${n === 1 ? "choice" : "choices"}${this.hasOther ? ` + ${otherLabel(this.field)}` : ""}${limit ? `, ${limit}` : ""}`;
      }
      default:
        return "";
    }
  }
  handleSection(event) {
    const id = event.currentTarget.dataset.sec;
    this.openSections = { ...this.openSections, [id]: !this.isSectionOpen(id) };
    try {
      window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(this.openSections));
    } catch {
      // the choice then lasts until the panel is closed
    }
  }

  // ------------------------------------------------------------ welcome screen
  get hasWelcome() {
    return this.selection?.kind === "welcome" && Boolean(this.definition);
  }
  get welcomeRaw() {
    return this.definition?.settings?.welcome || {};
  }
  get welcome() {
    return welcomeOf(this.definition);
  }
  get welcomeModeButtons() {
    return this.segButtons(WELCOME_MODES, this.welcome.mode);
  }
  get welcomeModeHelp() {
    return WELCOME_MODE_HELP[this.welcome.mode];
  }
  get welcomeIsScreen() {
    return this.welcome.mode === "screen";
  }
  get welcomeHasText() {
    return this.welcome.mode !== "off";
  }
  get welcomeTextLabel() {
    return this.welcomeIsScreen ? "Text" : "Message";
  }
  get formTitle() {
    return this.definition?.label || this.definition?.name || "";
  }
  get welcomeImageValue() {
    return this.screenDrafts.imageUrl ?? (this.welcomeRaw.imageUrl || "");
  }
  get welcomeImageProblem() {
    const v = this.screenDrafts.imageUrl;
    return v !== undefined && v.trim() && !safeImage(v) ? "Use an https:// link or a path on your site." : "";
  }
  get welcomeMinutesValue() {
    return this.screenDrafts.minutes ?? (this.welcomeRaw.minutes ?? "");
  }
  get estimatedMinutes() {
    return String(estimateMinutes(this.definition));
  }
  get estimateHelp() {
    const n = questionCount(this.definition);
    const minutes = estimateMinutes(this.definition);
    return `About ${minutes} minute${minutes === 1 ? "" : "s"} for ${n} question${n === 1 ? "" : "s"}. Leave the box empty to keep this estimate up to date.`;
  }
  get welcomeEditorMode() {
    return this.screenEditorMode("welcomeMessage");
  }
  get thankYouEditorMode() {
    return this.screenEditorMode("thankYouMessage");
  }
  screenEditorMode(prop) {
    return this.definition?.settings?.editors?.[prop] === "html" ? "html" : "visual";
  }
  handleWelcomeMode(event) {
    this.patchWelcome({ mode: event.currentTarget.dataset.value });
  }
  handleWelcomeText(event) {
    const prop = event.target.dataset.prop;
    const max = prop === "title" ? TITLE_MAX : LABEL_MAX;
    this.patchWelcome({ [prop]: String(event.detail.value || "").slice(0, max) || undefined });
  }
  handleWelcomeToggle(event) {
    this.patchWelcome({ [event.target.dataset.prop]: event.target.checked || undefined });
  }
  handleWelcomeMinutes(event) {
    const raw = String(event.detail.value ?? "").trim();
    const n = Number(raw);
    if (!raw) {
      this.setDraft("minutes", undefined);
      this.patchWelcome({ minutes: undefined });
    } else if (Number.isInteger(n) && n >= 1 && n <= MAX_MINUTES) {
      this.setDraft("minutes", undefined);
      this.patchWelcome({ minutes: n });
    } else {
      this.setDraft("minutes", raw);
    }
  }
  handleWelcomeImage(event) {
    const raw = String(event.detail.value || "");
    if (!raw.trim() || safeImage(raw)) {
      this.setDraft("imageUrl", undefined);
      this.patchWelcome({ imageUrl: raw.trim() || undefined });
    } else {
      this.setDraft("imageUrl", raw);
    }
  }
  async handleWelcomeImageUploaded(event) {
    const file = event.detail?.files?.[0];
    if (!file) return;
    this.imageError = "";
    this.imageBusy = true;
    try {
      const link = await createPublicLink({ contentDocumentId: file.documentId });
      this.setDraft("imageUrl", undefined);
      this.patchWelcome({ imageUrl: link.url });
    } catch (e) {
      this.imageError = e?.body?.message || e?.message || "The upload could not be turned into a public link.";
    } finally {
      this.imageBusy = false;
    }
  }
  handleClearWelcomeImage() {
    this.setDraft("imageUrl", undefined);
    this.patchWelcome({ imageUrl: undefined });
  }
  patchWelcome(patch) {
    this.patchScreen("welcome", patch);
  }

  // ------------------------------------------------------------ thank-you screen
  get hasEnding() {
    return this.selection?.kind === "ending" && Boolean(this.definition);
  }
  get endingRaw() {
    return this.definition?.settings?.ending || {};
  }
  get endingTitle() {
    return this.endingRaw.title || "";
  }
  get endingSubmitAnother() {
    return this.endingRaw.submitAnother === true;
  }
  /** Saved buttons, each with what is being typed into it and whether that can be saved. */
  get endingButtonRows() {
    const saved = Array.isArray(this.endingRaw.buttons) ? this.endingRaw.buttons : [];
    return saved.map((b, index) => {
      const label = this.screenDrafts[`label${index}`] ?? b.label ?? "";
      const url = this.screenDrafts[`url${index}`] ?? b.url ?? "";
      return {
        index,
        key: `button${index}`,
        label,
        url,
        labelProblem: label.trim() ? "" : "A button needs a label.",
        urlProblem: safeLink(url) ? "" : LINK_HELP,
        removeLabel: `Remove the ${label || "button"} button`
      };
    });
  }
  get canAddButton() {
    return this.endingButtonRows.length < MAX_BUTTONS && !this.newButton;
  }
  get newButtonReady() {
    return Boolean(this.newButton && this.newButton.label.trim() && safeLink(this.newButton.url));
  }
  get newButtonNotReady() {
    return !this.newButtonReady;
  }
  get newButtonUrlProblem() {
    const url = this.newButton?.url || "";
    return url.trim() && !safeLink(url) ? LINK_HELP : "";
  }
  get redirectOn() {
    return Boolean(this.endingRaw.redirectUrl) || this.redirectOpen;
  }
  get redirectValue() {
    return this.screenDrafts.redirectUrl ?? (this.endingRaw.redirectUrl || "");
  }
  get redirectProblem() {
    const v = this.screenDrafts.redirectUrl;
    return v !== undefined && v.trim() && !safeLink(v) ? LINK_HELP : "";
  }
  get redirectDelayButtons() {
    const current = String(this.endingRaw.redirectDelay ?? 0);
    return this.segButtons(REDIRECT_DELAYS, REDIRECT_DELAYS.some(([v]) => v === current) ? current : "0");
  }
  handleEndingText(event) {
    this.patchEnding({ title: String(event.detail.value || "").slice(0, TITLE_MAX) || undefined });
  }
  handleEndingToggle(event) {
    this.patchEnding({ submitAnother: event.target.checked || undefined });
  }
  handleButtonEdit(event) {
    const index = Number(event.target.dataset.index);
    const prop = event.target.dataset.prop;
    const value = String(event.detail.value || "");
    const buttons = (this.endingRaw.buttons || []).map((b) => ({ ...b }));
    const ok = prop === "label" ? Boolean(value.trim()) : Boolean(safeLink(value));
    if (!ok || !buttons[index]) {
      this.setDraft(`${prop}${index}`, value);
      return;
    }
    this.setDraft(`${prop}${index}`, undefined);
    buttons[index][prop] = prop === "label" ? value.slice(0, LABEL_MAX) : value.trim();
    this.patchEnding({ buttons });
  }
  handleRemoveButton(event) {
    const index = Number(event.currentTarget.dataset.index);
    const buttons = (this.endingRaw.buttons || []).filter((b, i) => i !== index);
    // what was typed into the rows is keyed by position, which just changed
    this.screenDrafts = {};
    this.patchEnding({ buttons: buttons.length ? buttons : undefined });
  }
  handleStartNewButton() {
    this.newButton = { label: "", url: "" };
  }
  handleNewButtonText(event) {
    this.newButton = { ...this.newButton, [event.target.dataset.prop]: String(event.detail.value || "") };
  }
  handleAddButton() {
    if (!this.newButtonReady) return;
    const buttons = [...(this.endingRaw.buttons || []), { label: this.newButton.label.trim().slice(0, LABEL_MAX), url: this.newButton.url.trim() }];
    this.newButton = null;
    this.patchEnding({ buttons });
  }
  handleCancelNewButton() {
    this.newButton = null;
  }
  handleRedirectToggle(event) {
    if (event.target.checked) {
      this.redirectOpen = true;
      return;
    }
    this.redirectOpen = false;
    this.setDraft("redirectUrl", undefined);
    this.patchEnding({ redirectUrl: undefined, redirectDelay: undefined });
  }
  handleRedirectUrl(event) {
    const raw = String(event.detail.value || "");
    if (safeLink(raw)) {
      this.setDraft("redirectUrl", undefined);
      this.patchEnding({ redirectUrl: raw.trim() });
    } else {
      this.setDraft("redirectUrl", raw);
    }
  }
  handleRedirectDelay(event) {
    if (!this.endingRaw.redirectUrl) return;
    this.patchEnding({ redirectDelay: Number(event.currentTarget.dataset.value) || undefined });
  }
  patchEnding(patch) {
    this.patchScreen("ending", patch);
  }

  // ------------------------------------------------------------ both screens
  handleScreenMessage(event) {
    this.dispatchEvent(new CustomEvent("formchange", { detail: { patch: { [event.target.dataset.prop]: event.detail.value } } }));
  }
  handleScreenMessageMode(event) {
    const prop = event.target.dataset.prop;
    const editors = { ...(this.definition?.settings?.editors || {}) };
    if (event.detail.mode === "html") editors[prop] = "html";
    else delete editors[prop];
    const settings = { ...(this.definition?.settings || {}) };
    if (Object.keys(editors).length) settings.editors = editors;
    else delete settings.editors;
    this.dispatchEvent(new CustomEvent("formchange", { detail: { patch: { settings } } }));
  }
  /** Merge a change into settings.welcome or settings.ending; undefined removes a value, and an empty object the screen's settings. */
  patchScreen(screen, patch) {
    const next = { ...(this.definition?.settings?.[screen] || {}), ...patch };
    Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
    const settings = { ...(this.definition?.settings || {}) };
    if (Object.keys(next).length) settings[screen] = next;
    else delete settings[screen];
    this.dispatchEvent(new CustomEvent("formchange", { detail: { patch: { settings } } }));
  }
  setDraft(key, value) {
    const drafts = { ...this.screenDrafts };
    if (value === undefined) delete drafts[key];
    else drafts[key] = value;
    this.screenDrafts = drafts;
  }
  get typeInfo() {
    return getType(this.field?.type);
  }
  get typeLabel() {
    return this.typeInfo.label;
  }
  get typeIconUrl() {
    return iconUrl(this.field?.type);
  }
  get typeOptions() {
    return Object.entries(FIELD_TYPES)
      // a retired type stays listed for the field that still has it, so the box shows it and can switch away
      .filter(([value, t]) => t.supported !== false && (!t.hiddenInPalette || value === this.field?.type))
      .map(([value, t]) => ({ label: `${t.label} (${t.group})`, value }));
  }

  // ------------------------------------------------------------ group visibility
  get isLayoutField() {
    return isLayout(this.field?.type);
  }
  get isRichText() {
    return this.field?.type === "richtext";
  }
  get isHeading() {
    return this.field?.type === "heading";
  }
  get isDivider() {
    return this.field?.type === "divider";
  }
  get isHidden() {
    return this.field?.type === "hidden";
  }
  get isConsent() {
    return this.field?.type === "consent";
  }
  get isImage() {
    return this.field?.type === "image";
  }
  get isEvent() {
    return this.field?.type === "event";
  }
  get isSignature() {
    return this.field?.type === "signature";
  }
  get isTable() {
    return this.field?.type === "table";
  }
  get isFileUpload() {
    return this.field?.type === "fileupload";
  }
  get isPayment() {
    return this.field?.type === "payment";
  }
  get isName() {
    return this.field?.type === "name";
  }
  get isAddress() {
    return this.field?.type === "address";
  }
  /** Width and rows: every field except a divider (a line), a hidden field (never shown) and a table (always full width). */
  get showLayout() {
    return this.field && !this.isDivider && !this.isHidden && !this.isTable;
  }
  get showImage() {
    return this.isImage;
  }
  get showEvent() {
    return this.isEvent;
  }
  get labelLabel() {
    if (this.isImage) return "Name (shown only in the builder)";
    if (this.isEvent) return "Event title";
    return "Label";
  }
  get showHelpText() {
    return !this.isEvent;
  }
  get helpLabel() {
    return this.isImage ? "Caption" : "Help text";
  }
  get showGeneral() {
    return this.field && !this.isDivider && !this.isRichText;
  }
  get showPlaceholder() {
    return PLACEHOLDER_TYPES.has(this.field?.type) || this.isCustomPrice;
  }
  /** A Name field's parts have their own placeholders and default values (Name parts group); an Address field starts in its default country. */
  get showDefault() {
    return this.field && !this.isLayoutField && !this.isConsent && !needsOptions(this.field.type) && !["fileupload", "signature", "rating", "nps", "yesno", "payment", "name", "address"].includes(this.field.type);
  }
  /** A Payment block is never optional: its price decides whether there is anything to pay. */
  get showRequired() {
    return this.field && !this.isLayoutField && !this.isHidden && !this.isPayment;
  }
  get showOptions() {
    return needsOptions(this.field?.type);
  }
  /**
   * A signature is a file, not a value for a record field; it can be added to the record's Files instead.
   * A table's rows are mapped one by one in the Automate tab. A payment reaches records through the
   * Automate tab's response values (payment status, amount, currency, reference).
   */
  get showMapping() {
    return this.field && !this.isLayoutField && !this.isSignature && !this.isTable && !this.isPayment;
  }
  get showValidation() {
    return this.field && (LENGTH_TYPES.has(this.field.type) || NUMBER_TYPES.has(this.field.type));
  }
  get showLength() {
    return LENGTH_TYPES.has(this.field?.type) && !this.hasCountryPicker;
  }
  get showNumberRange() {
    return NUMBER_TYPES.has(this.field?.type);
  }
  get showPattern() {
    return LENGTH_TYPES.has(this.field?.type) && this.field.type !== "comment" && !this.hasCountryPicker;
  }
  get showLogic() {
    return this.field && !this.isHidden;
  }
  get showDateOptions() {
    return this.field?.type === "date";
  }
  get showPhoneOptions() {
    return this.field?.type === "phone";
  }
  /** Picker phones are checked by their country's rules, so format and length settings do not apply. */
  get hasCountryPicker() {
    return this.field?.type === "phone" && this.config.countryPicker === true;
  }
  get countryOptions() {
    return COUNTRIES.map((c) => ({ label: c.name, value: c.iso, detail: `+${c.dial}` }));
  }
  get defaultCountryValue() {
    return this.config.defaultCountry || localeCountry(LOCALE);
  }
  /** Turning the picker on starts in the builder's country and follows the visitor's. */
  handleCountryPicker(event) {
    if (event.target.checked) {
      this.patchConfig({ countryPicker: true, defaultCountry: this.defaultCountryValue, detectCountry: true });
    } else {
      this.patchConfig({ countryPicker: undefined, defaultCountry: undefined, detectCountry: undefined, strictNumber: undefined, mobileOnly: undefined });
    }
  }
  handleDefaultCountry(event) {
    this.patchConfig({ defaultCountry: event.detail.value || undefined });
  }
  get showTimeOptions() {
    return this.field?.type === "time";
  }

  // ------------------------------------------------------------ type-specific config
  get config() {
    return this.field?.config || {};
  }
  get weekdayOptions() {
    return WEEKDAYS;
  }
  /** The days a respondent may pick: everything not listed in config.disabledDays. */
  get allowedDays() {
    const off = (this.config.disabledDays || []).map(String);
    return WEEKDAYS.map((d) => d.value).filter((v) => !off.includes(v));
  }
  get timeStepOptions() {
    return TIME_STEPS;
  }
  get timeStepValue() {
    return String(this.config.step || 15);
  }
  get hourFormatOptions() {
    return HOUR_FORMATS;
  }
  get hourFormatValue() {
    return String(this.config.hourFormat || "auto");
  }
  handleConfigText(event) {
    const prop = event.target.dataset.prop;
    const raw = event.target.value;
    this.patchConfig({ [prop]: raw === "" || raw === null ? undefined : raw });
  }
  handleConfigChecked(event) {
    this.patchConfig({ [event.target.dataset.prop]: event.target.checked ? true : undefined });
  }
  /** For ON_BY_DEFAULT settings: only false is stored. */
  handleConfigOnByDefault(event) {
    this.patchConfig({ [event.target.dataset.prop]: event.target.checked ? undefined : false });
  }
  get signatureTypingOn() {
    return this.config.allowTyped !== false;
  }
  get signatureToRecordOn() {
    return this.config.attachToRecord !== false;
  }
  handleAllowedDays(event) {
    const allowed = new Set((event.detail.value || []).map(String));
    const off = WEEKDAYS.map((d) => Number(d.value)).filter((d) => !allowed.has(String(d)));
    this.patchConfig({ disabledDays: off.length ? off : undefined });
  }
  handleTimeStep(event) {
    const n = Number(event.detail.value);
    this.patchConfig({ step: n && n !== 15 ? n : undefined });
  }
  handleHourFormat(event) {
    const v = event.detail.value;
    this.patchConfig({ hourFormat: v && v !== "auto" ? v : undefined });
  }
  // ------------------------------------------------------------ rows, image and event
  get rowButtons() {
    const current = String(rowSpanOf(this.field));
    return Array.from({ length: MAX_ROW_SPAN }, (_, i) => String(i + 1)).map((value) => ({
      value,
      label: value,
      checked: value === current ? "true" : "false",
      cls: `pr-seg-btn${value === current ? " pr-seg-on" : ""}`
    }));
  }
  handleRows(event) {
    const n = Number(event.currentTarget.dataset.value);
    this.patchConfig({ rowSpan: n > 1 ? n : undefined });
  }
  segButtons(options, current) {
    return options.map(([value, label]) => ({ value, label, checked: value === current ? "true" : "false", cls: `pr-seg-btn${value === current ? " pr-seg-on" : ""}` }));
  }
  get fitButtons() {
    return this.segButtons([["cover", "Fill"], ["contain", "Fit"]], this.config.fit === "contain" ? "contain" : "cover");
  }
  get heightButtons() {
    return this.segButtons([["small", "Small"], ["medium", "Medium"], ["large", "Large"]], ["small", "large"].includes(this.config.height) ? this.config.height : "medium");
  }
  get showOptionColumns() {
    return OPTION_LIST_TYPES.has(this.field?.type);
  }
  /** Options per row: the field's own choice, else what the form design does (cards fit the width, a list stacks). */
  get optionColumnButtons() {
    const current = String(this.config.optionColumns ?? defaultChoiceColumns(this.definition?.theme));
    return this.segButtons([["auto", "Auto"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]], current);
  }
  handleConfigSeg(event) {
    const { prop, value } = event.currentTarget.dataset;
    this.patchConfig({ [prop]: value });
  }

  // ------------------------------------------------------------ name parts
  get nameLayoutButtons() {
    return this.segButtons([["inline", "Inline"], ["stacked", "Stacked"]], this.config.layout === "stacked" ? "stacked" : "inline");
  }
  /** Settings for each part, first name then last name. */
  get namePartItems() {
    const max = MAX_NAME_PART_LENGTH;
    return nameParts(this.field).map((p) => {
      const stored = this.config.parts?.[p.key] || {};
      return {
        key: p.key,
        title: NAME_PARTS.find((d) => d.key === p.key).label,
        label: stored.label ?? p.label,
        placeholder: p.placeholder,
        defaultValue: p.defaultValue,
        maxLength: p.maxLength,
        maxAllowed: max
      };
    });
  }
  /** Change one part's settings in config.parts (a Name or Address field); empty settings are dropped. */
  patchPart(key, changes) {
    const parts = { ...(this.config.parts || {}) };
    const merged = { ...(parts[key] || {}), ...changes };
    for (const k of Object.keys(merged)) if (merged[k] === undefined || merged[k] === null || merged[k] === "") delete merged[k];
    parts[key] = merged;
    this.patchConfig({ parts });
  }
  handleNamePartText(event) {
    const { part, prop } = event.target.dataset;
    const raw = event.detail?.value ?? event.target.value;
    if (prop === "maxLength") {
      const n = Math.round(Number(raw));
      this.patchPart(part, { maxLength: raw === "" || !Number.isFinite(n) || n < 1 ? undefined : Math.min(n, MAX_NAME_PART_LENGTH) });
      return;
    }
    this.patchPart(part, { [prop]: raw });
  }

  // ------------------------------------------------------------ address
  /** The countries and states (JFormAddressService.Lists), read by the workspace; null until then. */
  @api addressLists = null;
  get addressPurposeButtons() {
    return this.segButtons(ADDRESS_PURPOSES.map((p) => [p.value, p.value ? p.label.replace(" address", "") : "Address"]), addressPurpose(this.field));
  }
  /** The purpose sets the browser's autofill section and the record address; a label still at a purpose's default follows it. */
  handleAddressPurpose(event) {
    const purpose = event.currentTarget.dataset.value;
    const before = addressPurpose(this.field);
    const key = this.field.key;
    const obj = this.mappingObject;
    const label = String(this.field.label || "").trim();
    if (!label || ADDRESS_PURPOSES.some((p) => p.label === label)) this.patch({ label: ADDRESS_PURPOSES.find((p) => p.value === purpose).label });
    this.patchConfig({ purpose: purpose || undefined });
    // a field still on the old purpose's address moves to the new one's; an address chosen in Saves to stays
    if (!obj || (purpose || "") === before) return;
    const ready = this.fieldCache[obj] ? Promise.resolve() : this.loadFields(obj);
    ready.then(() => {
      if (this.field?.key !== key || this.mappingObject !== obj) return;
      const was = defaultAddressTarget(before, this.fieldCache[obj]);
      const next = defaultAddressTarget(purpose, this.fieldCache[obj]);
      if (was && next && was.name !== next.name && this.mappedAddress === was.name) this.mapAddress(next);
    });
  }
  get addressCountryOptions() {
    return (this.addressLists?.countries || []).map((c) => ({ label: c.name, value: c.code, detail: c.code }));
  }
  get addressDefaultCountry() {
    return String(this.config.defaultCountry || "").toUpperCase();
  }
  /** The default country must be offered. */
  handleAddressDefaultCountry(event) {
    const code = event.detail.value || undefined;
    const offered = this.config.countries || [];
    const changes = { defaultCountry: code };
    if (code && offered.length && !offered.includes(code)) changes.countries = [...offered, code];
    this.patchConfig(changes);
  }
  get addressEveryCountry() {
    return !(this.config.countries || []).length;
  }
  /** The country choosing starts from: the default one, else the first listed; "" until the lists arrive. */
  get addressFirstCountry() {
    return this.addressDefaultCountry || this.addressCountryOptions[0]?.value || "";
  }
  /** With no country to start from, switching off would store none, which is every country again: wait for the lists. */
  get addressCannotChooseCountries() {
    return this.addressEveryCountry && !this.addressFirstCountry;
  }
  /** Choosing countries starts from the default one. */
  handleAddressEveryCountry(event) {
    if (event.target.checked) this.patchConfig({ countries: undefined });
    else if (this.addressFirstCountry) this.patchConfig({ countries: [this.addressFirstCountry] });
  }
  get addressChoosesCountries() {
    return !this.addressEveryCountry;
  }
  get addressCountriesValue() {
    return this.config.countries || [];
  }
  /** None chosen offers every country again; a default that is no longer offered moves to the first that is. */
  handleAddressCountries(event) {
    const countries = [...(event.detail.value || [])];
    const changes = { countries: countries.length ? countries : undefined };
    if (countries.length && !countries.includes(this.addressDefaultCountry)) changes.defaultCountry = countries[0];
    this.patchConfig(changes);
  }
  /** Settings for each part, country first: label and placeholder. */
  get addressPartItems() {
    return addressParts(this.field).map((p) => ({
      key: p.key,
      title: ADDRESS_PARTS.find((d) => d.key === p.key).label,
      label: this.config.parts?.[p.key]?.label ?? p.label,
      placeholder: p.placeholder
    }));
  }
  handleAddressPartText(event) {
    const { part, prop } = event.target.dataset;
    this.patchPart(part, { [prop]: event.detail?.value ?? event.target.value });
  }
  /** The chosen object's addresses, for "Saves to": [{ label, value }], Not mapped first. */
  get addressTargetOptions() {
    const targets = addressTargets(this.fieldCache[this.mappingObject] || []);
    return [{ label: "Not mapped", value: "" }, ...targets.map((t) => ({ label: `${t.label} (${t.name})`, value: t.name }))];
  }
  /** The address this field's parts are saved to on the main step, or "". */
  get mappedAddress() {
    const prefix = `${this.field.key}.`;
    const mapped = new Set((this.mainStep?.fields || []).filter((m) => m.source?.type === "field" && String(m.source.key).startsWith(prefix)).map((m) => String(m.field).toLowerCase()));
    const target = addressTargets(this.fieldCache[this.mappingObject] || []).find((t) => Object.values(t.fields).some((f) => mapped.has(f.toLowerCase())));
    return target ? target.name : "";
  }
  /** Map every part of the field onto one address (or none): parts the address has no field for are left unmapped. */
  mapAddress(target, field = this.field) {
    const mappings = answerFieldsOf(field).map((a) => ({ fieldKey: a.key, objectField: target?.fields[a.part] || null }));
    this.dispatchEvent(new CustomEvent("mappingchange", { detail: { object: this.mappingObjectName, mappings } }));
  }
  handleAddressTarget(event) {
    const name = event.detail.value;
    this.mapAddress(addressTargets(this.fieldCache[this.mappingObject] || []).find((t) => t.name === name) || null);
  }
  get formId() {
    return this.definition?.id || null;
  }
  get imageTypes() {
    return [".png", ".jpg", ".jpeg", ".gif", ".webp"]; // matches JFormImageService.IMAGE_EXTENSIONS
  }
  get imagePreview() {
    const url = String(this.config.url || "").trim();
    return /^(https:\/\/|\/(?!\/))/i.test(url) ? url : "";
  }
  imageBusy = false;
  imageError = "";
  /** lightning-file-upload stored the file on the form; turn it into a public link the form can show. */
  async handleImageUploaded(event) {
    const file = event.detail?.files?.[0];
    if (!file) return;
    this.imageError = "";
    this.imageBusy = true;
    try {
      const link = await createPublicLink({ contentDocumentId: file.documentId });
      this.patchConfig({ url: link.url });
    } catch (e) {
      this.imageError = e?.body?.message || e?.message || "The upload could not be turned into a public link.";
    } finally {
      this.imageBusy = false;
    }
  }
  /** lightning-input time values look like 09:00:00.000; the event keeps HH:MM. */
  handleEventTime(event) {
    const raw = String(event.target.value || "");
    this.patchConfig({ [event.target.dataset.prop]: /^\d{1,2}:\d{2}/.test(raw) ? raw.slice(0, 5) : undefined });
  }
  get showCalendarLinks() {
    return !this.config.hideCalendar;
  }
  handleCalendarLinks(event) {
    this.patchConfig({ hideCalendar: event.target.checked ? undefined : true });
  }

  // ------------------------------------------------------------ payment block
  get pricingOptions() {
    return PRICING_OPTIONS;
  }
  get paymentPricing() {
    return pricingOf(this.field);
  }
  get isFixedPrice() {
    return this.isPayment && this.paymentPricing === "fixed";
  }
  get isChoicePrice() {
    return this.isPayment && this.paymentPricing === "choice";
  }
  get isQuantityPrice() {
    return this.isPayment && this.paymentPricing === "quantity";
  }
  get isCustomPrice() {
    return this.isPayment && this.paymentPricing === "custom";
  }
  get usesPaymentSource() {
    return this.isChoicePrice || this.isQuantityPrice;
  }
  get paymentCurrency() {
    return paymentSettings(this.definition).currency;
  }
  /** One gateway per form, kept with the form's payment settings: the Settings tab shows the same choice. */
  /** Settings › Payments › Promotion codes, read-only here. */
  get promotionCodesText() {
    const settings = paymentSettings(this.definition);
    if (this.isCustomPrice) return `none ("pay what you want" takes no codes)`;
    if (settings.codes === "jform") return "codes defined in JForm";
    if (settings.codes === "gateway") return `codes defined in ${gatewayOf(settings.gateway)?.name || settings.gateway}`;
    return "none";
  }
  get paymentGateway() {
    return paymentSettings(this.definition).gateway;
  }
  get gatewayOptions() {
    return gatewayOptions(this.paymentStatus);
  }
  get itemHelp() {
    return `Shown on ${gatewayOf(this.paymentGateway)?.name || "the gateway"}'s payment page and receipt.`;
  }
  handleGateway(event) {
    const payments = { ...(this.definition?.settings?.payments || {}), gateway: event.detail.value };
    this.dispatchEvent(new CustomEvent("formchange", { detail: { patch: { settings: { ...(this.definition?.settings || {}), payments } } } }));
  }
  handleGoToPaymentSettings() {
    this.dispatchEvent(new CustomEvent("gotab", { detail: { tab: "settings", section: "payments" } }));
  }
  /** Zero-decimal currencies (JPY, VND) take whole amounts. */
  get priceStep() {
    return decimalsOf(this.paymentCurrency) === 0 ? "1" : "0.01";
  }
  get priceLabel() {
    return `Price (${this.paymentCurrency})`;
  }
  get unitPriceLabel() {
    return `Price each (${this.paymentCurrency})`;
  }
  get minimumLabel() {
    return `Minimum (${this.paymentCurrency}, optional)`;
  }
  get paymentNote() {
    return `Amounts are in ${this.paymentCurrency}, the form's currency.`;
  }
  get paymentSourceLabel() {
    return this.isQuantityPrice ? "Quantity from" : "Prices follow";
  }
  get paymentSourceOptions() {
    const types = this.isQuantityPrice ? ["number"] : CHOICE_SOURCES;
    return (this.definition?.sections || [])
      .flatMap((s) => s.fields || [])
      .filter((f) => types.includes(f.type))
      .map((f) => ({ label: f.label || f.key, value: f.key }));
  }
  get noPaymentSources() {
    return this.paymentSourceOptions.length === 0;
  }
  get noPaymentSourcesText() {
    return this.isQuantityPrice ? "Add a Number field for the quantity first." : "Add a Single choice, Dropdown or Checkboxes field first.";
  }
  /** One price per option of the field the prices follow; a blank price means the option is free. */
  get choicePrices() {
    const source = (this.definition?.sections || []).flatMap((s) => s.fields || []).find((f) => f.key === this.config.source);
    const prices = new Map((Array.isArray(this.config.prices) ? this.config.prices : []).map((p) => [String(p.value), p.amount]));
    return (source?.options || []).map((o, i) => {
      const value = String(o.value ?? o.label);
      return { key: `${i}-${value}`, value, label: o.label || value, amount: prices.get(value) ?? "" };
    });
  }
  handlePricing(event) {
    const pricing = event.detail.value;
    // a choice field cannot hold a quantity, nor a number field a choice
    const keep = (pricing === "choice" || pricing === "quantity") && pricing === this.paymentPricing;
    this.patchConfig({ pricing, source: keep ? this.config.source : undefined, prices: pricing === "choice" ? this.config.prices : undefined });
  }
  handlePriceInput(event) {
    const raw = event.target.value;
    this.patchConfig({ [event.target.dataset.prop]: raw === "" || raw === null || Number.isNaN(Number(raw)) ? undefined : Number(raw) });
  }
  handlePaymentSource(event) {
    this.patchConfig({ source: event.detail.value || undefined, prices: undefined });
  }
  handleChoicePrice(event) {
    const value = event.target.dataset.value;
    const raw = event.target.value;
    const amounts = new Map(this.choicePrices.map((c) => [c.value, c.amount]));
    amounts.set(value, raw === "" || Number.isNaN(Number(raw)) || Number(raw) <= 0 ? "" : Number(raw));
    const prices = this.choicePrices.filter((c) => amounts.get(c.value) !== "").map((c) => ({ value: c.value, amount: amounts.get(c.value) }));
    this.patchConfig({ prices: prices.length ? prices : undefined });
  }

  patchConfig(changes) {
    const merged = { ...this.config, ...changes };
    const out = {};
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== "" && (v !== false || ON_BY_DEFAULT.has(k))) out[k] = v;
    this.patch({ config: Object.keys(out).length ? out : undefined });
  }

  // ------------------------------------------------------------ values
  get widthValue() {
    return String(this.field?.width || 100);
  }
  get widthOptions() {
    return [
      { label: "25%", value: "25" },
      { label: "50%", value: "50" },
      { label: "75%", value: "75" },
      { label: "100%", value: "100" }
    ];
  }
  get options() {
    return (this.field?.options || []).map((o, i) => ({
      index: i,
      label: o.label,
      value: o.value ?? "",
      isFirst: i === 0,
      isLast: i === (this.field.options || []).length - 1
    }));
  }
  get validation() {
    return this.field?.validation || {};
  }
  get patternPresets() {
    return PATTERN_PRESETS.map(({ label, value }) => ({ label, value }));
  }
  get patternValue() {
    const current = this.validation.regexPattern || "";
    if (!current) return "none";
    const preset = PATTERN_PRESETS.find((p) => p.pattern === current);
    return preset ? preset.value : "custom";
  }
  get showCustomPattern() {
    return this.patternValue === "custom";
  }
  get ruleSentence() {
    const target = this.field || this.page;
    if (!target?.conditionalLogic) return null;
    return describeRule(target.conditionalLogic, (k) => this.labelFor(k), this.field ? "this field" : "this page");
  }
  labelFor(key) {
    for (const s of this.definition?.sections || []) {
      if (s.key === key) return s.label || s.name || key;
      for (const f of s.fields || []) if (f.key === key) return f.label || key;
    }
    return key;
  }

  // ------------------------------------------------------------ mapping (a shortcut into the form's main record step)
  pendingObject = "";
  get steps() {
    return this.definition?.settings?.automation?.steps || [];
  }
  get mainStep() {
    return mainStepOf(this.steps);
  }
  get mappingObject() {
    return String(this.mainStep?.object || this.pendingObject || "").toLowerCase();
  }
  get objectLocked() {
    return Boolean(this.mainStep);
  }
  get objectOptions() {
    const opts = (this.targetObjects || []).map((o) => ({ label: o.label, value: String(o.value).toLowerCase() }));
    if (this.mappingObject && !opts.some((o) => o.value === this.mappingObject)) {
      opts.unshift({ label: this.mainStep?.object || this.mappingObject, value: this.mappingObject });
    }
    return opts;
  }
  get objectFieldOptions() {
    const fields = this.fieldCache[this.mappingObject] || [];
    return fields.map((f) => ({ label: `${f.label} (${f.value})${f.required ? " *" : ""}`, value: f.value }));
  }
  /** Object field this answer feeds on the main step, if any. */
  get mappedObjectField() {
    const m = (this.mainStep?.fields || []).find((x) => x.source?.type === "field" && x.source.key === this.field?.key);
    return m ? m.field : "";
  }
  get mappedFieldInfo() {
    const fields = this.fieldCache[this.mappingObject] || [];
    return fields.find((f) => f.value === this.mappedObjectField);
  }
  /** A Name field maps each shown part on its own, "field.part": [{ key, label, value }]. */
  get nameMappings() {
    const mapped = this.mainStep?.fields || [];
    return nameParts(this.field).map((p) => {
      const key = `${this.field.key}.${p.key}`;
      const m = mapped.find((x) => x.source?.type === "field" && x.source.key === key);
      return { key, label: p.label, value: m ? m.field : "" };
    });
  }
  get mappingHint() {
    const main = this.mainStep;
    if (!main) return this.mappingObject ? "Choosing a field adds a record step on the Automate tab." : "Choose an object to create records in. Records are set up on the Automate tab; this is the quick way for one answer.";
    const n = this.steps.indexOf(main) + 1;
    if (this.isName) return `Each part is saved to ${main.object} by step ${n} on its own; a part left unmapped is still stored with the response.`;
    if (this.isAddress) {
      return this.mappedAddress
        ? `Saved to the ${main.object}'s address by step ${n}: street, city and postal code, and the state and country as codes where the org has State and Country/Territory Picklists. Map a single part to another field in the Automate tab.`
        : `Not mapped. Step ${n} (${main.object}) ignores this address; it is still stored with the response.`;
    }
    const info = this.mappedFieldInfo;
    if (!info) return `Not mapped. Step ${n} (${main.object}) ignores this answer; the answer is still stored.`;
    return `Saved to ${main.object} by step ${n}. Salesforce type: ${info.type}${info.required ? " (required on the object)" : ""}`;
  }
  get canLoadPicklist() {
    return this.showOptions && Boolean(this.mappedFieldInfo?.picklistValues?.length);
  }
  get loadingFields() {
    return this.loadingFieldsFor === this.mappingObject;
  }
  get noMappingObject() {
    return !this.mappingObject;
  }

  renderedCallback() {
    const obj = this.mappingObject;
    if (this.showMapping && obj && !this.fieldCache[obj] && this.loadingFieldsFor !== obj) {
      this.loadFields(obj);
    }
    if (this.isPayment && !this.paymentStatusRead) this.readPaymentStatus();
  }

  async loadFields(objectApiName) {
    this.loadingFieldsFor = objectApiName;
    try {
      const fields = await getObjectFields({ objectApiName });
      this.fieldCache = { ...this.fieldCache, [objectApiName]: fields };
    } catch (e) {
      this.fieldCache = { ...this.fieldCache, [objectApiName]: [] };
    } finally {
      if (this.loadingFieldsFor === objectApiName) this.loadingFieldsFor = undefined;
    }
  }

  // ------------------------------------------------------------ handlers
  handleType(event) {
    this.patch({ type: event.detail.value });
  }
  handleText(event) {
    const prop = event.target.dataset.prop;
    this.patch({ [prop]: event.target.value });
  }
  /** The label is finished (focus left it): the workspace may name the key after it and map it to a matching object field. */
  handleLabelDone() {
    if (this.field?.key) this.dispatchEvent(new CustomEvent("labelcommit", { detail: { key: this.field.key } }));
  }
  /** Display Text: the editor keeps its own draft while in use (see c/jformRichEditor); the mode is remembered on the field. */
  get richMode() {
    return this.field?.config?.editor === "html" ? "html" : "visual";
  }
  handleRichValue(event) {
    this.patch({ richtext: event.detail.value });
  }
  handleRichMode(event) {
    this.patchConfig({ editor: event.detail.mode === "html" ? "html" : undefined });
  }
  handleChecked(event) {
    this.patch({ [event.target.dataset.prop]: event.target.checked });
  }
  /** Width as a segmented control, the same style as the Design tab's: the selected option is a white pill. */
  get widthButtons() {
    const current = this.widthValue;
    return this.widthOptions.map((o) => ({ ...o, checked: o.value === current ? "true" : "false", cls: `pr-seg-btn${o.value === current ? " pr-seg-on" : ""}` }));
  }
  handleWidth(event) {
    const value = event.currentTarget?.dataset?.value ?? event.detail?.value;
    this.patch({ width: Number(value) });
  }
  handleObject(event) {
    if (this.objectLocked) return;
    this.pendingObject = event.detail.value;
    // a Name field on a Contact or Lead maps its parts to FirstName and LastName straight away
    if (this.isName && PERSON_OBJECTS.has(String(this.pendingObject).toLowerCase())) {
      const mappings = nameParts(this.field).map((p) => ({ fieldKey: `${this.field.key}.${p.key}`, objectField: p.objectField }));
      this.dispatchEvent(new CustomEvent("mappingchange", { detail: { object: this.mappingObjectName, mappings } }));
    }
    // an Address field goes onto the object's address for its purpose (Mailing, the Lead's Address, Billing or Shipping)
    // the field the object was chosen for, even when another is selected by the time the object's fields arrive
    if (this.isAddress) {
      const field = this.field;
      const obj = this.mappingObject;
      const ready = this.fieldCache[obj] ? Promise.resolve() : this.loadFields(obj);
      ready.then(() => {
        const target = defaultAddressTarget(addressPurpose(field), this.fieldCache[obj]);
        if (target && this.mappingObject === obj) this.mapAddress(target, field);
      });
    }
  }
  /** The chosen object's API name as the org spells it. */
  get mappingObjectName() {
    return this.mainStep?.object || (this.targetObjects || []).find((o) => String(o.value).toLowerCase() === this.mappingObject)?.value || this.mappingObject;
  }
  /** A Name part's combobox names its answer key ("field.part") in data-key. */
  handleTargetField(event) {
    const fieldKey = event.target.dataset.key || this.field.key;
    this.dispatchEvent(new CustomEvent("mappingchange", { detail: { fieldKey, object: this.mappingObjectName, objectField: event.detail.value || null } }));
  }
  handleValidationText(event) {
    const prop = event.target.dataset.prop;
    const raw = event.target.value;
    const numeric = ["minLength", "maxLength", "minValue", "maxValue"].includes(prop);
    const value = raw === "" ? undefined : numeric ? Number(raw) : raw;
    this.patch({ validation: this.cleanValidation({ ...this.validation, [prop]: value }) });
  }
  handlePattern(event) {
    const choice = event.detail.value;
    const preset = PATTERN_PRESETS.find((p) => p.value === choice);
    const regexPattern = choice === "custom" ? this.validation.regexPattern || "" : preset?.pattern || "";
    this.patch({ validation: this.cleanValidation({ ...this.validation, regexPattern: regexPattern || undefined }) });
  }
  cleanValidation(v) {
    const out = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined && val !== null && val !== "") out[k] = val;
    return Object.keys(out).length ? out : undefined;
  }

  // table rows
  @track pastedRows = "";
  get tableRowItems() {
    const rows = tableRows(this.field);
    return rows.map((r, i) => ({ ...r, index: i, isFirst: i === 0, isLast: i === rows.length - 1 }));
  }
  get rowsFull() {
    return tableRows(this.field).length >= MAX_TABLE_ROWS;
  }
  get answersPerRowButtons() {
    return this.segButtons([["one", "One"], ["several", "Several"]], this.config.multiple === true ? "several" : "one");
  }
  get everyRowOn() {
    return this.config.everyRow !== false;
  }
  get scaleOptions() {
    return TABLE_SCALES.map((s) => ({ label: s.label, value: s.key }));
  }
  get optionsGroupLabel() {
    return this.isTable ? "Columns" : "Choices";
  }
  get addOptionLabel() {
    return this.isTable ? "Add column" : "Add choice";
  }
  get optionsFull() {
    return this.isTable && (this.field?.options || []).length >= MAX_TABLE_COLUMNS;
  }
  // ------------------------------------------------------------ accepted files
  /** Only these was picked on this field and nothing is ticked yet: nothing is saved until something is. */
  filesOnlyKey;
  get fileModeButtons() {
    return this.segButtons([["any", "Any allowed file"], ["only", "Only these"]], this.filesOnlyThese ? "only" : "any");
  }
  get filesOnlyThese() {
    return chosenExtensions(this.field) !== null || (!!this.field && this.filesOnlyKey === this.field.key);
  }
  get fileKindsMissing() {
    return this.filesOnlyThese && (chosenExtensions(this.field) === null || !allowedExtensions(this.field).length);
  }
  /** One checkbox group per kind of file the field can take; a kind is ticked when any of its extensions is chosen. */
  get fileKindGroups() {
    const chosen = chosenExtensions(this.field) || [];
    return fileGroupsFor(this.field).map((g) => {
      const kinds = FILE_KINDS.filter((k) => k.group === g.key);
      return {
        key: g.key,
        label: g.label,
        options: kinds.map((k) => ({ label: `${k.label} (${k.extensions.map((e) => `.${e}`).join(", ")})`, value: k.key })),
        value: kinds.filter((k) => k.extensions.some((e) => chosen.includes(e))).map((k) => k.key)
      };
    });
  }
  handleFileMode(event) {
    const only = event.currentTarget.dataset.value === "only";
    this.filesOnlyKey = only ? this.field?.key : undefined;
    if (!only) this.patchConfig({ extensions: undefined });
  }
  /**
   * Saves the ticked kinds' extensions as config.extensions; with nothing ticked the field takes any allowed file.
   * Only the group just changed is rewritten: a kind already ticked keeps the extensions it has (one set through
   * the API may hold only .docx), a newly ticked kind takes all of its own.
   */
  handleFileKinds(event) {
    const ticked = new Set(event.detail.value || []);
    const changed = event.target.dataset.group;
    const offered = new Set(fileGroupsFor(this.field).map((g) => g.key));
    const chosen = chosenExtensions(this.field) || [];
    const extensions = FILE_KINDS.filter((k) => offered.has(k.group)).flatMap((k) => {
      const kept = k.extensions.filter((e) => chosen.includes(e));
      if (k.group !== changed) return kept;
      if (!ticked.has(k.key)) return [];
      return kept.length ? kept : k.extensions;
    });
    this.filesOnlyKey = this.field?.key;
    this.patchConfig({ extensions: extensions.length ? extensions : undefined });
  }
  get fileSizeButtons() {
    return this.segButtons([["1", "1 MB"], ["2", "2 MB"], ["3", "3 MB"]], String(fileLimits(this.field).maxSizeMb));
  }
  handleFileSize(event) {
    const mb = Number(event.currentTarget.dataset.value);
    this.patchConfig({ maxSizeMb: mb === MAX_FILE_MB ? undefined : mb });
  }
  get maxFilesValue() {
    return this.config.maxFiles ?? "";
  }
  get maxFilesDefault() {
    return String(MAX_FIELD_FILES);
  }
  handleMaxFiles(event) {
    const box = event.target;
    const raw = box.value;
    const n = raw === "" || raw === null || raw === undefined ? undefined : Number(raw);
    const bad = n !== undefined && (!Number.isInteger(n) || n < 1 || n > MAX_FIELD_FILES);
    box.setCustomValidity(bad ? `Enter a whole number from 1 to ${MAX_FIELD_FILES}.` : "");
    box.reportValidity();
    if (!bad) this.patchConfig({ maxFiles: n === MAX_FIELD_FILES ? undefined : n });
  }

  // ------------------------------------------------------------ Other choice and how many to choose
  get showOtherSetting() {
    return canOfferOther(this.field?.type);
  }
  get hasOther() {
    return offersOther(this.field);
  }
  get otherLabelValue() {
    return this.config.other?.label || "";
  }
  get otherPlaceholderValue() {
    return this.config.other?.placeholder || "";
  }
  get otherLabelDefault() {
    return OTHER_LABEL;
  }
  get otherPlaceholderDefault() {
    return OTHER_PLACEHOLDER;
  }
  get otherHelp() {
    const name = this.field?.label || this.field?.key;
    return `Respondents who pick ${otherLabel(this.field)} type their answer in a box. It is saved as its own answer, "${name}: ${otherLabel(this.field)}", which a record step can save to a field. The choice itself is saved as "${otherChoiceValue(this.field)}" whatever it is called, so renaming it keeps earlier answers and rules.`;
  }
  /** On: config.other = {} (the defaults) or { label, placeholder }; off removes it. */
  handleOtherToggle(event) {
    this.patchConfig({ other: event.target.checked ? { ...(this.config.other || {}) } : undefined });
  }
  handleOtherText(event) {
    const prop = event.target.dataset.prop;
    const value = String(event.target.value ?? "").trim();
    const other = { ...(this.config.other || {}) };
    if (value) other[prop] = value;
    else delete other[prop];
    this.patchConfig({ other });
  }
  get showChoiceLimits() {
    return isMultiple(this.field?.type);
  }
  get minChoicesValue() {
    return this.config.minChoices ?? "";
  }
  get maxChoicesValue() {
    return this.config.maxChoices ?? "";
  }
  /**
   * At least and At most: whole numbers from 1, no more than the choices (Other counts), and At least no more than
   * At most. Both boxes are checked on every change, as they read, so fixing one saves the other it was blocking.
   */
  handleChoiceLimit(event) {
    const edited = event.target.dataset.prop;
    const boxes = {};
    const values = {};
    for (const prop of ["minChoices", "maxChoices"]) {
      boxes[prop] = prop === edited ? event.target : this.template.querySelector(`lightning-input[data-prop="${prop}"]`);
      const raw = boxes[prop]?.value;
      values[prop] = raw === "" || raw === null || raw === undefined ? undefined : Number(raw);
    }
    const problems = this.choiceLimitProblems(values, edited);
    const changes = {};
    for (const [prop, box] of Object.entries(boxes)) {
      if (box) {
        box.setCustomValidity(problems[prop]);
        box.reportValidity();
      }
      if (!problems[prop]) changes[prop] = values[prop];
    }
    // a clash saves neither: the saved pair stays one that works
    if (!problems.conflict && Object.entries(changes).some(([k, v]) => v !== (this.config[k] ?? undefined))) this.patchConfig(changes);
  }
  /** What is wrong with each limit, "" for nothing; a clash between the two is put on the one just edited. */
  choiceLimitProblems(values, edited) {
    const count = choiceOptionsOf(this.field).length;
    const own = (n) => {
      if (n === undefined) return "";
      if (!Number.isInteger(n) || n < 1) return "Enter a whole number from 1.";
      return n > count ? `There ${count === 1 ? "is 1 choice" : `are ${count} choices`}.` : "";
    };
    const problems = { minChoices: own(values.minChoices), maxChoices: own(values.maxChoices), conflict: false };
    const { minChoices: least, maxChoices: most } = values;
    if (!problems.minChoices && !problems.maxChoices && least !== undefined && most !== undefined && least > most) {
      problems[edited] = edited === "minChoices" ? "More than At most." : "Less than At least.";
      problems.conflict = true;
    }
    return problems;
  }
  /** Rows keep the key they were given when added, so renaming one keeps its answers, rules and record mappings. */
  handleRowText(event) {
    const rows = tableRows(this.field);
    rows[Number(event.target.dataset.index)].label = event.target.value;
    this.patchConfig({ rows });
  }
  handleAddRow() {
    this.addRows([`Row ${tableRows(this.field).length + 1}`]);
  }
  handlePastedRows(event) {
    this.pastedRows = event.target.value;
  }
  handleAddPastedRows() {
    const labels = String(this.pastedRows || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!labels.length) return;
    this.addRows(labels);
    this.pastedRows = "";
  }
  addRows(labels) {
    const rows = tableRows(this.field);
    const used = new Set(rows.map((r) => r.key));
    for (const label of labels) {
      if (rows.length >= MAX_TABLE_ROWS) break;
      const key = rowKeyFor(label, rows.length + 1, used);
      used.add(key);
      rows.push({ key, label });
    }
    this.patchConfig({ rows });
  }
  handleRemoveRow(event) {
    const rows = tableRows(this.field);
    if (rows.length <= 1) return;
    rows.splice(Number(event.currentTarget.dataset.index), 1);
    this.patchConfig({ rows });
  }
  handleRowUp(event) {
    this.moveRow(Number(event.currentTarget.dataset.index), -1);
  }
  handleRowDown(event) {
    this.moveRow(Number(event.currentTarget.dataset.index), 1);
  }
  moveRow(i, dir) {
    const rows = tableRows(this.field);
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    this.patchConfig({ rows });
  }
  handleAnswersPerRow(event) {
    this.patchConfig({ multiple: event.currentTarget.dataset.value === "several" ? true : undefined });
  }
  /** Replace the columns with a scale; the words are the stored values. */
  handleScale(event) {
    const scale = TABLE_SCALES.find((s) => s.key === event.detail.value);
    if (scale) this.patch({ options: scale.columns.map((c) => ({ label: c, value: c })) });
  }

  // options
  handleOptionText(event) {
    const i = Number(event.target.dataset.index);
    const prop = event.target.dataset.prop;
    const options = this.cloneOptions();
    const previousLabel = options[i].label;
    options[i][prop] = event.target.value;
    // keep value in step with the label until the user sets a value of their own
    if (prop === "label" && (!options[i].value || options[i].value === previousLabel)) options[i].value = event.target.value;
    this.patch({ options });
  }
  handleAddOption() {
    if (this.optionsFull) return;
    const options = this.cloneOptions();
    const n = options.length + 1;
    options.push({ label: `Option ${n}`, value: `Option ${n}` });
    this.patch({ options });
  }
  handleRemoveOption(event) {
    const i = Number(event.currentTarget.dataset.index);
    const options = this.cloneOptions();
    if (options.length <= 1) return;
    options.splice(i, 1);
    this.patch({ options });
  }
  handleOptionUp(event) {
    this.moveOption(Number(event.currentTarget.dataset.index), -1);
  }
  handleOptionDown(event) {
    this.moveOption(Number(event.currentTarget.dataset.index), 1);
  }
  moveOption(i, dir) {
    const options = this.cloneOptions();
    const j = i + dir;
    if (j < 0 || j >= options.length) return;
    [options[i], options[j]] = [options[j], options[i]];
    this.patch({ options });
  }
  handleLoadPicklist() {
    const values = this.mappedFieldInfo?.picklistValues || [];
    this.patch({ options: values.map((v) => ({ label: v, value: v })) });
  }
  cloneOptions() {
    return (this.field?.options || []).map((o) => ({ ...o }));
  }

  // page
  handlePageText(event) {
    const prop = event.target.dataset.prop;
    const patch = { [prop]: event.target.value };
    if (prop === "label") patch.name = event.target.value;
    this.dispatchEvent(new CustomEvent("pagechange", { detail: { patch } }));
  }

  /** Open the Logic tab on this field's or page's rule (a new one when it has none). */
  handleGoToLogic() {
    const detail = this.field ? { kind: "field", key: this.field.key } : this.page ? { kind: "page", key: this.page.key } : {};
    this.dispatchEvent(new CustomEvent("gotologic", { detail }));
  }
  get logicButtonLabel() {
    return this.ruleSentence ? "Edit this rule" : "Add a rule";
  }

  patch(patch) {
    this.dispatchEvent(new CustomEvent("fieldchange", { detail: { patch } }));
  }
}
