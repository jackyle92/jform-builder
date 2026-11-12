import { LightningElement, api } from "lwc";
import { getType, collectsAnswer, validateValue, isEmptyValue, acceptFor, fileRuleText, fileProblem, fileLimits, tableRows, tableProblem, unansweredRows, nameParts, nameProblems,
  addressParts, addressProblems, addressStates, addressShowsState, addressPartNeeded, addressCountryOf, addressDefaultCountry, offeredCountries,
  choiceOptionsOf, offersOther, otherLabel, picksOther, choiceLimits, choiceLimitText, MAX_OTHER_LENGTH, OTHER_PLACEHOLDER } from "c/jformFieldRegistry";
import { displayHtml } from "c/jformRichtext";
import { safeImageUrl, CHOICE_COLUMNS } from "c/jformTheme";
import { eventView, icsText, icsFileName } from "c/jformEvent";
import { customAmountProblem } from "c/jformPayment";
import LANG from "@salesforce/i18n/lang";

const IMAGE_HEIGHTS = new Set(["small", "medium", "large"]);

const INPUT_TYPES = { text: "text", email: "email", phone: "tel", number: "number" };
/** Dates and times have their own controls (c/jformDatePicker, c/jformTimePicker). */
const PICKER_TYPES = new Set(["date", "time"]);
const AUTOCOMPLETE = { email: "email", phone: "tel" };
const INPUT_MODES = { phone: "tel", email: "email", number: "decimal" };

let instance = 0;
/** Below this width a field stacks its label above the control, even with left labels. */
const COMPACT_WIDTH = 440;

/**
 * Renders one field of a form definition with native inputs so that every
 * part (label, control, choice, help, error) is styled by the theme's CSS
 * custom properties.
 *
 *  - mode="fill": respondent input; fires `change` with { key, value } and
 *    exposes validate(), focus() and getFiles(). A choice with Other adds `other`,
 *    the text typed under it (undefined once Other is no longer picked).
 *  - mode="edit": identical visuals, controls inert; used by the builder canvas
 *
 * Layout (label above or to the left) is driven by --jf-field-cols from the theme.
 */
export default class JformField extends LightningElement {
  @api field = {};
  @api value;
  @api mode = "fill";
  /** Effective required flag after conditional logic. Falls back to the definition. */
  @api required;
  @api disabled = false;
  /** Payment block only: what it shows (c/jformPayment paymentView), from the canvas or the renderer. */
  @api payment;
  /** Address fields only: the countries and states to choose from (JFormAddressService.Lists). */
  @api addressLists;
  /** Choice fields with Other only: the text typed under it (the "field.other" answer). */
  @api otherValue;

  error;
  touched = false;
  compact = false;
  pendingFiles = [];
  /** Why the files just picked were refused; shown until the next pick or the next check. */
  fileRefusal = null;
  /** Other was just picked with a mouse, pen or touch: its box takes the focus once drawn. */
  focusOther = false;
  /** The next choice change comes from a pointer, not from arrow keys moving through the choices. */
  pointerPick = false;
  /** Other was just picked: its text isn't asked for until something is typed in the box or the form is sent. */
  otherPending = false;
  uid = `jf${++instance}`;

  // ------------------------------------------------------------ ids (scoped by LWC)
  get controlId() {
    return `${this.uid}-control`;
  }
  get labelId() {
    return `${this.uid}-label`;
  }
  get descId() {
    return `${this.uid}-desc`;
  }
  get groupName() {
    return `${this.uid}-group`;
  }

  // ------------------------------------------------------------ kind
  get type() {
    return (this.field?.type || "text").toLowerCase();
  }
  get isEdit() {
    return this.mode === "edit";
  }
  get isDisabled() {
    return this.disabled === true || this.isEdit;
  }
  get isRequired() {
    if (this.required === true || this.required === "true") return true;
    if (this.required === false || this.required === "false") return false;
    return this.field?.required === true;
  }
  get isTextInput() {
    return Object.prototype.hasOwnProperty.call(INPUT_TYPES, this.type);
  }
  get isDatePicker() {
    return this.type === "date";
  }
  get isTimePicker() {
    return this.type === "time";
  }
  get isPicker() {
    return PICKER_TYPES.has(this.type);
  }
  /** A phone field with the country picker (c/jformPhoneInput); without it, a plain tel box. */
  get isPhonePicker() {
    return this.type === "phone" && this.fieldConfig.countryPicker === true;
  }
  /** The visitor's country is guessed only on the live form, never in the builder. */
  get detectCountry() {
    return !this.isEdit;
  }
  get isComment() {
    return this.type === "comment";
  }
  get isSelect() {
    return this.type === "picklist";
  }
  get isFile() {
    return this.type === "fileupload";
  }
  get isSignature() {
    return this.type === "signature";
  }
  /** Limits the file picker to the types the server accepts (JFormUploadPolicy). */
  get fileAccept() {
    return acceptFor(this.field);
  }
  /** What the field takes, under the box: "PDF, Excel or CSV, up to 2 MB, at most 3 files". */
  get fileRules() {
    return this.isFile ? fileRuleText(this.field) : "";
  }
  get fileMultiple() {
    return fileLimits(this.field).maxFiles > 1;
  }
  get isRadio() {
    return this.type === "radio";
  }
  get isMultiChoice() {
    return this.type === "checkboxes" || this.type === "multiselect";
  }
  get isChoiceList() {
    return this.isRadio || this.isMultiChoice;
  }
  get isTable() {
    return this.type === "table";
  }
  get isName() {
    return this.type === "name";
  }
  get isAddress() {
    return this.type === "address";
  }
  get isYesNo() {
    return this.type === "yesno";
  }
  get isNps() {
    return this.type === "nps";
  }
  get isRating() {
    return this.type === "rating";
  }
  get isConsent() {
    return this.type === "consent" || this.type === "checkbox";
  }
  get isHidden() {
    return this.type === "hidden";
  }
  get isRichText() {
    return this.type === "richtext";
  }
  /** The stored Quill markup with its indentation made explicit, see c/jformRichtext. */
  get richtextHtml() {
    return displayHtml(this.field?.richtext);
  }
  get isHeading() {
    return this.type === "heading";
  }
  get isDivider() {
    return this.type === "divider";
  }
  get isImage() {
    return this.type === "image";
  }
  get isEvent() {
    return this.type === "event";
  }
  get isPayment() {
    return this.type === "payment";
  }
  get paymentView() {
    return this.payment || { lines: [], totalText: "", note: "", test: false, custom: false };
  }
  get hasPaymentLines() {
    return this.paymentView.lines?.length > 0;
  }
  // promotion code box (codes defined in JForm); the renderer checks the code and passes the outcome back in `payment`
  codeInput = "";
  get codeId() {
    return `${this.controlId}-code`;
  }
  get codeErrorId() {
    return `${this.controlId}-code-error`;
  }
  get codeDisabled() {
    return this.isDisabled || this.isEdit || this.paymentView.codeBusy === true;
  }
  get applyDisabled() {
    return this.codeDisabled || !this.codeInput.trim();
  }
  get applyLabel() {
    return this.paymentView.codeBusy ? "Checking…" : "Apply";
  }
  get codeInvalid() {
    return this.paymentView.codeError ? "true" : "false";
  }
  handleCodeInput(event) {
    this.codeInput = event.target.value;
  }
  handleCodeKey(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      this.handleApplyCode();
    }
  }
  handleApplyCode() {
    const code = this.codeInput.trim();
    if (!code || this.applyDisabled) return;
    this.dispatchEvent(new CustomEvent("applycode", { detail: { key: this.field?.key, code } }));
  }
  handleRemoveCode() {
    this.codeInput = "";
    this.dispatchEvent(new CustomEvent("removecode", { detail: { key: this.field?.key } }));
  }
  /** Under the total on the form and in the preview; the canvas shows the gateway in the block's head instead. */
  get showCheckoutLine() {
    return Boolean(this.paymentView.gateway) && !this.paymentView.rules;
  }
  get fieldConfig() {
    return this.field?.config || {};
  }
  /** Only http(s) and site-relative image links reach the page (c/jformTheme.safeImageUrl). */
  get imageUrl() {
    return safeImageUrl(this.fieldConfig.url);
  }
  get imageAlt() {
    return typeof this.fieldConfig.alt === "string" ? this.fieldConfig.alt : "";
  }
  get imageClass() {
    const c = this.fieldConfig;
    return `jf-image jf-image-${IMAGE_HEIGHTS.has(c.height) ? c.height : "medium"}${c.fit === "contain" ? " jf-image-contain" : ""}`;
  }
  get eventInfo() {
    return eventView(this.fieldConfig, this.label, LANG);
  }
  /** Downloads the event as a calendar file. LWS allows a text/plain Blob; the .ics name makes calendars open it. */
  handleAddToCalendar() {
    const ics = icsText(this.fieldConfig, this.label, `${this.field?.key || "event"}@jform`);
    if (!ics) return;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFileName(this.label);
    a.click();
    URL.revokeObjectURL(url);
  }
  get isUnsupported() {
    return getType(this.type).supported === false;
  }
  /** Fields whose label is a <label for>. */
  get isLabelled() {
    return this.isTextInput || this.isPicker || this.isComment || this.isSelect || this.isFile || this.isSignature;
  }
  /** Fields whose label is a <span> referenced by aria-labelledby on a group. */
  get isGroup() {
    return this.isChoiceList || this.isYesNo || this.isNps || this.isRating;
  }
  get showHiddenChip() {
    return this.isHidden && this.isEdit;
  }

  // ------------------------------------------------------------ text
  get label() {
    return this.field?.label || getType(this.type).label;
  }
  get helpText() {
    return this.field?.helpText || "";
  }
  get placeholder() {
    return this.field?.placeholder || "";
  }
  get inputType() {
    return INPUT_TYPES[this.type] || "text";
  }
  get autocomplete() {
    return AUTOCOMPLETE[this.type] || "on";
  }
  get inputMode() {
    return INPUT_MODES[this.type] || null;
  }

  // ------------------------------------------------------------ values
  get stringValue() {
    if (this.value === null || this.value === undefined) return "";
    return Array.isArray(this.value) ? this.value.join("; ") : String(this.value);
  }
  get arrayValue() {
    if (Array.isArray(this.value)) return this.value.map(String);
    if (this.value === null || this.value === undefined || this.value === "") return [];
    return String(this.value)
      .split(";")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  get booleanValue() {
    return this.value === true || this.value === "true";
  }
  get fileNames() {
    return this.arrayValue.join(", ");
  }
  get tableRows() {
    return tableRows(this.field);
  }
  get tableMultiple() {
    return this.fieldConfig.multiple === true;
  }
  /** Rows the required error is about, marked in the table. */
  get missingRows() {
    if (!this.error || !this.isRequired) return [];
    return unansweredRows(this.field, this.value).map((r) => r.key);
  }
  /** A Name or Address answer: an object by part. */
  get partsValue() {
    return this.value && typeof this.value === "object" && !Array.isArray(this.value) ? this.value : {};
  }
  /** A Name field's parts, each with its own label, control and error; errors show once the field has one. */
  get nameView() {
    const answer = this.partsValue;
    const problems = this.error ? nameProblems(this.field, answer, this.isRequired) : {};
    return nameParts(this.field).map((p) => {
      const value = answer[p.key] === null || answer[p.key] === undefined ? "" : String(answer[p.key]);
      const error = problems[p.key] || null;
      const id = `${this.controlId}-${p.key}`;
      return {
        key: p.key,
        id,
        errorId: `${id}-error`,
        label: p.label,
        value,
        placeholder: p.placeholder,
        autocomplete: p.autocomplete,
        error,
        invalid: error ? "true" : "false",
        ariaRequired: this.isRequired ? "true" : "false",
        describedBy: error ? `${id}-error ${this.descId}` : this.descId,
        cls: `jf-name-part jf-name-part-${p.key}${error ? " jf-invalid" : ""}`
      };
    });
  }
  get namePartsClass() {
    return `jf-parts jf-name-parts jf-name-${this.fieldConfig.layout === "stacked" ? "stacked" : "inline"}`;
  }
  /**
   * An Address field's parts: the country, and the state where its country lists states, as lists; the street as
   * a box of three lines; the rest typed. With the org's picklists the state shows only for a country with states.
   * Each has its own label, control and error; errors show once the field has one.
   */
  get addressView() {
    // the builder canvas shows the country the form starts in
    const answer = this.isEdit && this.value === undefined ? { country: addressDefaultCountry(this.field) } : this.partsValue;
    const lists = this.addressLists;
    const problems = this.error ? addressProblems(this.field, answer, this.isRequired, lists) : {};
    const country = addressCountryOf(this.field, answer);
    const states = addressStates(this.field, lists, answer);
    const shown = addressParts(this.field).filter((p) => p.key !== "state" || addressShowsState(this.field, lists, answer));
    // City and State/Province share a row; every other part, or either of the two alone, takes the full width
    const paired = shown.some((p) => p.key === "city") && shown.some((p) => p.key === "state");
    return shown.map((p) => {
      const value = answer[p.key] === null || answer[p.key] === undefined ? "" : String(answer[p.key]);
      let options = null;
      if (p.key === "country") {
        options = offeredCountries(this.field, lists).map((c) => ({ value: c.code, label: c.name, selected: c.code === country }));
        // a country the lists do not have (not loaded yet, or turned off since) still shows
        if (country && !options.some((o) => o.selected)) options.unshift({ value: country, label: country, selected: true });
      } else if (p.key === "state" && states.length) {
        const current = value.toLowerCase();
        options = states.map((r) => ({ value: r.code, label: r.name, selected: r.code.toLowerCase() === current || String(r.name).toLowerCase() === current }));
      }
      const error = problems[p.key] || null;
      const id = `${this.controlId}-${p.key}`;
      const needed = this.isRequired && addressPartNeeded(p.key, states);
      return {
        key: p.key,
        id,
        errorId: `${id}-error`,
        label: p.label,
        value,
        placeholder: p.placeholder,
        autocomplete: p.autocomplete,
        isList: Boolean(options),
        isStreet: p.key === "street",
        options: options || [],
        noneSelected: !options || !options.some((o) => o.selected),
        listPlaceholder: p.placeholder || (p.key === "country" ? "Select a country" : "Select an option"),
        error,
        invalid: error ? "true" : "false",
        ariaRequired: needed ? "true" : "false",
        describedBy: error ? `${id}-error ${this.descId}` : this.descId,
        cls: `jf-address-part jf-address-part-${p.key}${paired && (p.key === "city" || p.key === "state") ? " jf-address-half" : ""}${error ? " jf-invalid" : ""}`
      };
    });
  }
  /** The parts carry their own invalid state, so the fieldset never marks every box. */
  get nameWrapperClass() {
    return `jf-field jf-kind-${this.type}${this.isEdit ? " jf-edit" : ""}${this.compact ? " jf-compact" : ""}`;
  }
  get options() {
    return choiceOptionsOf(this.field);
  }
  get selectOptions() {
    const current = this.stringValue;
    return this.options.map((o) => ({ ...o, selected: o.value === current }));
  }
  get selectPlaceholder() {
    return this.placeholder || "Select an option";
  }
  get choiceOptions() {
    const chosen = this.isMultiChoice ? new Set(this.arrayValue) : new Set([this.stringValue]);
    // at the most a Checkboxes field takes, the rest can't be ticked, so the limit shows without an error
    const { most } = choiceLimits(this.field);
    const full = this.isMultiChoice && most !== null && this.arrayValue.length >= most;
    return this.options.map((o, i) => {
      const checked = chosen.has(o.value);
      const atLimit = full && !checked && !this.isDisabled;
      const disabled = this.isDisabled || atLimit;
      return {
        key: `${i}-${o.value}`,
        label: o.label,
        value: o.value,
        checked,
        disabled,
        cls: `jf-choice${checked ? " jf-choice-on" : ""}${disabled ? " jf-choice-disabled" : ""}${atLimit ? " jf-choice-full" : ""}`
      };
    });
  }
  /** "Choose up to 3", "Choose 2 to 4", "Choose at least 2": shown under a Checkboxes field with limits. */
  get choiceLimitText() {
    const text = choiceLimitText(this.field);
    return text ? `Choose ${text}` : "";
  }
  // ------------------------------------------------------------ Other
  /** The box for what Other means, under the choices once Other is picked (never on the builder canvas). */
  get showOther() {
    return !this.isEdit && picksOther(this.field, this.value);
  }
  get otherText() {
    return this.otherValue === null || this.otherValue === undefined ? "" : String(this.otherValue);
  }
  get otherPlaceholder() {
    return String(this.field?.config?.other?.placeholder ?? "").trim() || OTHER_PLACEHOLDER;
  }
  get otherAriaLabel() {
    return `${this.label}: ${otherLabel(this.field)}`;
  }
  get otherMaxLength() {
    return MAX_OTHER_LENGTH;
  }
  /** The Other answer still needs its text: the field is required and Other is picked. */
  otherMissing(value, other) {
    return this.isRequired && !this.otherPending && picksOther(this.field, value) && !String(other ?? "").trim();
  }
  get otherInvalid() {
    return this.error && this.otherMissing(this.value, this.otherValue) ? "true" : "false";
  }
  /** A choice change keeps the Other text only while Other stays picked. */
  otherChange(value) {
    const byPointer = this.pointerPick;
    this.pointerPick = false;
    if (!offersOther(this.field)) return undefined;
    if (picksOther(this.field, value)) {
      // focus follows a click or tap only: arrow keys pick as they move, and must stay on the choices
      if (!picksOther(this.field, this.value)) {
        this.otherPending = true;
        this.focusOther = byPointer;
      }
      return undefined;
    }
    return { other: undefined };
  }
  handlePointerPick() {
    this.pointerPick = true;
  }
  handleKeyPick() {
    this.pointerPick = false;
  }
  handleOtherInput(event) {
    this.otherPending = false;
    this.emit(this.value, { other: event.target.value });
  }
  get choiceInputType() {
    return this.isMultiChoice ? "checkbox" : "radio";
  }
  get yesNoOptions() {
    const current = this.stringValue;
    return ["Yes", "No"].map((v) => ({
      value: v,
      label: v,
      checked: current === v ? "true" : "false",
      cls: `jf-seg-btn${current === v ? " jf-selected" : ""}`
    }));
  }
  get npsOptions() {
    const current = this.stringValue;
    return Array.from({ length: 11 }, (_, i) => ({
      value: String(i),
      label: String(i),
      checked: current === String(i) ? "true" : "false",
      cls: `jf-scale-btn${current === String(i) ? " jf-selected" : ""}`
    }));
  }
  get ratingOptions() {
    const current = Number(this.stringValue) || 0;
    return Array.from({ length: 5 }, (_, i) => {
      const n = i + 1;
      return {
        value: String(n),
        label: `${n} of 5`,
        checked: n === current ? "true" : "false",
        cls: `jf-star${n <= current ? " jf-selected" : ""}`
      };
    });
  }

  // ------------------------------------------------------------ state classes
  get hasError() {
    return Boolean(this.error);
  }
  get ariaInvalid() {
    return this.error ? "true" : "false";
  }
  get ariaRequired() {
    return this.isRequired ? "true" : "false";
  }
  get groupRole() {
    return this.isMultiChoice ? "group" : "radiogroup";
  }
  /**
   * The field's own options per row (config.optionColumns), else the form design's. A narrow field shows
   * at most two per row so options stay readable on phones.
   */
  get choicesStyle() {
    const chosen = String(this.fieldConfig.optionColumns ?? "");
    if (!CHOICE_COLUMNS[chosen]) return "";
    const columns = chosen !== "auto" && this.compact ? String(Math.min(Number(chosen), 2)) : chosen;
    return `--jf-choice-cols: ${CHOICE_COLUMNS[columns]}`;
  }
  get wrapperClass() {
    return `jf-field jf-kind-${this.type}${this.error ? " jf-invalid" : ""}${this.isEdit ? " jf-edit" : ""}${this.compact ? " jf-compact" : ""}`;
  }

  renderedCallback() {
    this.syncTextareas();
    this.observeWidth();
    if (this.focusOther) {
      const box = this.template.querySelector(".jf-other-input");
      if (box) {
        this.focusOther = false;
        box.focus();
      }
    }
  }
  /**
   * LWC sets value={...} on a textarea as an attribute, which a textarea ignores, so a Paragraph or Street created
   * with an answer (the field drawn again, a prefilled form) would look empty: copy it to the property. The one
   * being typed in already shows its text.
   */
  syncTextareas() {
    this.template.querySelectorAll("textarea").forEach((textarea) => {
      const answer = textarea.getAttribute("value") || "";
      if (textarea.value !== answer && textarea !== this.template.activeElement) textarea.value = answer;
    });
  }

  // ------------------------------------------------------------ own width (a container query in JS)
  observeWidth() {
    if (this.resizeObserver || typeof ResizeObserver === "undefined") return;
    const host = this.template.host;
    if (!host) return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || host.getBoundingClientRect().width;
      const compact = width > 0 && width < COMPACT_WIDTH;
      if (compact !== this.compact) this.compact = compact;
    });
    this.resizeObserver.observe(host);
  }
  disconnectedCallback() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
  }
  get consentClass() {
    return `jf-consent${this.booleanValue ? " jf-consent-on" : ""}`;
  }

  // ------------------------------------------------------------ events
  handleInput(event) {
    this.emit(event.target.value);
  }
  /** The date and time pickers report their stored value (ISO) in `detail.value`. */
  handlePickerChange(event) {
    this.emit(event.detail.value);
  }
  /** The signature pad reports a PNG data URL, or "" when cleared. */
  handleSignature(event) {
    this.touched = true;
    this.emit(event.detail.value);
  }
  /**
   * The table reports its whole answer, { rowKey: value }. Answering a row does not mark the field touched,
   * so the rows below are not reported missing while the respondent works down the table; leaving it does.
   */
  handleTable(event) {
    this.emit(event.detail.value);
  }
  /** A Name part changed: the field's answer is the object of all parts, { firstName: "Jane", ... }, trimmed when sent. */
  handleNamePart(event) {
    const current = this.value && typeof this.value === "object" && !Array.isArray(this.value) ? this.value : {};
    this.emit({ ...current, [event.target.dataset.part]: event.target.value });
  }
  /**
   * An Address part changed: the answer is the object of all parts, the country and a listed state as codes.
   * A new country clears a state that was chosen from, or is to be chosen from, a list.
   */
  handleAddressPart(event) {
    const part = event.target.dataset.part;
    const current = this.partsValue;
    const next = { ...current, [part]: event.target.value };
    if (part === "country" && next.country !== current.country) {
      const listed = addressStates(this.field, this.addressLists, current).length || addressStates(this.field, this.addressLists, next).length;
      if (listed) delete next.state;
    }
    this.emit(next);
  }
  /** Moving between the parts does not mark the field touched, so the next part is not reported missing yet; leaving the field does. */
  handlePartsBlur(event) {
    const parts = event.currentTarget;
    if (event.relatedTarget && parts && parts.contains(event.relatedTarget)) return;
    this.handleBlur();
  }
  /** The label cannot point into a picker's shadow root, so a click on it focuses the picker. */
  handleLabelClick() {
    const picker = this.template.querySelector("c-jform-date-picker, c-jform-time-picker, c-jform-phone-input, c-jform-signature-pad");
    if (picker) picker.focus();
  }
  handleSelect(event) {
    this.touched = true;
    this.emit(event.target.value, this.otherChange(event.target.value));
  }
  handleChoice(event) {
    if (this.isMultiChoice) this.handleCheckbox(event);
    else this.handleRadio(event);
  }
  handleRadio(event) {
    this.touched = true;
    this.emit(event.target.value, this.otherChange(event.target.value));
  }
  handleCheckbox(event) {
    const chosen = new Set(this.arrayValue);
    if (event.target.checked) chosen.add(event.target.value);
    else chosen.delete(event.target.value);
    this.touched = true;
    // keep the options' order, not click order
    const value = this.options.map((o) => o.value).filter((v) => chosen.has(v));
    this.emit(value, this.otherChange(value));
  }
  handleConsent(event) {
    this.touched = true;
    this.emit(event.target.checked === true);
  }
  handleScale(event) {
    if (this.isDisabled) return;
    const v = event.currentTarget.dataset.value;
    this.touched = true;
    this.emit(this.isRating && this.stringValue === v ? "" : v);
  }
  handleFile(event) {
    const picked = event.target.files ? Array.from(event.target.files) : [];
    // accept only hints to the file dialog: a file the field doesn't take is refused now, not on submit
    this.fileRefusal = fileProblem(this.field, picked);
    if (this.fileRefusal) event.target.value = "";
    this.pendingFiles = this.fileRefusal ? [] : picked;
    this.touched = true;
    // the renderer keeps the files: this component is destroyed when its page is left
    this.emit(this.pendingFiles.map((f) => f.name), { files: this.pendingFiles });
  }
  handleBlur() {
    if (this.isEdit) return;
    this.touched = true;
    this.error = this.computeError(this.value);
  }

  emit(value, extra) {
    // The parent passes the new value back on its next render; validate the fresh value now.
    const other = extra && "other" in extra ? extra.other : this.otherValue;
    if (this.touched || this.error) this.error = this.computeError(value, other);
    this.dispatchEvent(new CustomEvent("change", { detail: { key: this.field?.key, value, ...(extra || {}) } }));
  }

  computeError(value, other = this.otherValue) {
    if (this.isEdit || this.isHidden || !collectsAnswer(this.type)) return null;
    if (this.fileRefusal) return this.fileRefusal;
    // "pay what you want" is always asked for; other prices only report a problem with the answers they follow
    if (this.isPayment) {
      const view = this.paymentView;
      return view.custom ? customAmountProblem(value, this.field, view.currency) : view.problem || null;
    }
    if (this.isTable) {
      const problem = this.isRequired ? tableProblem(this.field, value) : null;
      return problem ? this.field?.validation?.requiredMessage || problem : null;
    }
    // each part shows its own problem (nameView); the field's error is the first, for the renderer and the invalid state
    if (this.isName) return Object.values(nameProblems(this.field, value, this.isRequired))[0] || null;
    if (this.isAddress) return Object.values(addressProblems(this.field, value, this.isRequired, this.addressLists))[0] || null;
    const empty = this.isConsent ? !(value === true || value === "true") : isEmptyValue(value);
    if (this.isRequired && empty) {
      return this.field?.validation?.requiredMessage || (this.isConsent ? "Please confirm to continue." : "Complete this field.");
    }
    if (this.otherMissing(value, other)) return "Please specify your answer.";
    return validateValue(this.field, value);
  }

  // ------------------------------------------------------------ public API
  @api
  validate() {
    this.touched = true;
    this.otherPending = false;
    // the refused files are gone; what counts now is whether the field has what it needs
    this.fileRefusal = null;
    this.error = this.computeError(this.value);
    return !this.error;
  }

  @api
  focus() {
    // a Name or Address field goes to the first part with a problem, a choice to its Other box when that is empty
    const el = this.problemControl() || this.template.querySelector("c-jform-choice-table, c-jform-date-picker, c-jform-time-picker, c-jform-phone-input, c-jform-signature-pad, input:not([type=hidden]), select, textarea, button");
    if (el && typeof el.focus === "function") el.focus();
  }

  /**
   * The part or Other box that holds the field's problem. Read from the field's state, not the invalid marks:
   * the renderer focuses straight after validate(), before those marks are drawn.
   */
  problemControl() {
    if (!this.error) return null;
    if (this.isName || this.isAddress) {
      const part = (this.isName ? this.nameView : this.addressView).find((p) => p.error);
      return part ? this.template.querySelector(`.jf-parts [data-part="${part.key}"]`) : null;
    }
    return this.otherMissing(this.value, this.otherValue) ? this.template.querySelector(".jf-other-input") : null;
  }

  /** Files chosen in a fileupload field, uploaded by the renderer after the submission exists. */
  @api
  getFiles() {
    return this.pendingFiles;
  }
}
