import { LightningElement, api, track } from "lwc";
import { parseISOTime, toISOTime, parseTimeText, formatTime, timeSlots, timeStep, timeLimits, usesTwelveHours, prefersNativePicker, currentLocale } from "c/jformDateTime";

let instance = 0;

/**
 * A time field: a text box that accepts "9:30", "9.30pm" or "21:30", plus a scrollable list of
 * times at the field's step, in the form's theme. The value in and out is always "HH:mm".
 * Touch-first devices get the platform's own time control with the same limits and step.
 *
 * Fires `change` ({ value }) when the time changes and `blur` when focus leaves the control.
 */
export default class JformTimePicker extends LightningElement {
  @api value = "";
  @api config;
  @api placeholder;
  @api disabled = false;
  @api ariaLabel;
  @api ariaRequired;
  @api ariaInvalid;
  @api ariaDescribedby;
  @api forceNative;

  @track open = false;
  @track text = "";
  @track active; // "HH:mm" highlighted in the list
  locale = currentLocale();
  listId = `jf-tp-list-${++instance}`;
  lastValue;
  pendingScroll;

  get native() {
    return this.forceNative === true || (this.forceNative !== false && prefersNativePicker());
  }
  /** iOS shows nothing in an empty native control, so the placeholder is drawn over it. */
  get nativeEmpty() {
    return parseISOTime(this.value) === null;
  }
  get nativeClass() {
    return `jf-input jf-native${this.nativeEmpty ? " jf-native-empty" : ""}`;
  }
  get rootClass() {
    return `jf-tp${this.open ? " jf-tp-open" : ""}`;
  }
  get placeholderText() {
    return this.placeholder || (usesTwelveHours(this.config, this.locale) ? "h:mm am/pm" : "HH:mm");
  }
  get minAttr() {
    return this.config?.minTime && parseISOTime(this.config.minTime) !== null ? this.config.minTime : undefined;
  }
  get maxAttr() {
    return this.config?.maxTime && parseISOTime(this.config.maxTime) !== null ? this.config.maxTime : undefined;
  }
  get stepAttr() {
    return timeStep(this.config) * 60;
  }
  get slots() {
    const selected = parseISOTime(this.value) === null ? null : toISOTime(parseISOTime(this.value));
    return timeSlots(this.config, this.locale).map((s) => ({
      ...s,
      id: `${this.listId}-${s.value.replace(":", "")}`,
      selected: s.value === selected,
      cls: `jf-tp-slot${s.value === selected ? " jf-tp-selected" : ""}${s.value === this.active ? " jf-tp-active" : ""}`
    }));
  }
  get activeId() {
    return this.open && this.active ? `${this.listId}-${this.active.replace(":", "")}` : undefined;
  }

  connectedCallback() {
    this.syncText();
  }
  renderedCallback() {
    if (this.value !== this.lastValue) this.syncText();
    if (this.pendingScroll) {
      const el = this.template.querySelector(`li[data-value="${this.pendingScroll}"]`);
      this.pendingScroll = undefined;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    }
  }
  syncText() {
    this.lastValue = this.value;
    if (!this.typing) this.text = parseISOTime(this.value) === null ? this.value || "" : formatTime(this.value, this.config, this.locale);
  }

  // ------------------------------------------------------------ native control
  handleNativeChange(event) {
    this.emit(event.target.value);
  }
  handleNativeBlur() {
    this.dispatchEvent(new CustomEvent("blur"));
  }

  // ------------------------------------------------------------ typed entry
  handleTyping(event) {
    this.typing = true;
    this.text = event.target.value;
  }
  handleTyped(event) {
    this.typing = false;
    const raw = event.target.value.trim();
    if (!raw) {
      this.text = "";
      this.emit("");
      return;
    }
    const iso = parseTimeText(raw);
    if (iso) {
      this.text = formatTime(iso, this.config, this.locale);
      this.emit(iso);
    } else {
      this.emit(raw);
    }
  }
  handleInputKeydown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!this.open) {
        this.show();
        return;
      }
      this.moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && this.open && this.active) {
      event.preventDefault();
      this.choose(this.active);
    } else if (event.key === "Escape" && this.open) {
      event.preventDefault();
      this.hide();
    } else if (event.key === "Tab" && this.open) {
      this.open = false;
    }
  }
  moveActive(delta) {
    const values = this.slots.map((s) => s.value);
    if (!values.length) return;
    const i = values.indexOf(this.active);
    const next = i < 0 ? (delta > 0 ? 0 : values.length - 1) : Math.min(values.length - 1, Math.max(0, i + delta));
    this.active = values[next];
    this.pendingScroll = this.active;
  }

  // ------------------------------------------------------------ list
  handleToggle() {
    if (this.open) this.hide(true);
    else {
      this.show();
      const input = this.template.querySelector(".jf-tp-input");
      if (input) input.focus();
    }
  }
  show() {
    const current = parseISOTime(this.value);
    const values = this.slots.map((s) => s.value);
    let start = current === null ? null : toISOTime(current);
    if (!values.includes(start)) {
      // nearest slot at or after the value, else the first daytime slot, else the first
      const { min } = timeLimits(this.config);
      const seek = current === null ? Math.max(min, 9 * 60) : current;
      start = values.find((v) => parseISOTime(v) >= seek) || values[0];
    }
    this.active = start;
    this.pendingScroll = start;
    this.open = true;
  }
  hide(refocus) {
    this.open = false;
    if (refocus) {
      const input = this.template.querySelector(".jf-tp-input");
      if (input) input.focus();
    }
  }
  handleListMousedown(event) {
    // keep focus in the text box while a slot is clicked, so focusout does not close the list first
    event.preventDefault();
  }
  handleSlotClick(event) {
    this.choose(event.currentTarget.dataset.value);
  }
  choose(iso) {
    this.typing = false;
    this.text = formatTime(iso, this.config, this.locale);
    this.emit(iso);
    this.hide(true);
  }
  handleFocusOut(event) {
    const next = event.relatedTarget;
    if (next && this.template.querySelector(".jf-tp")?.contains(next)) return;
    if (this.open) this.open = false;
    this.dispatchEvent(new CustomEvent("blur"));
  }
  handleRootKeydown(event) {
    if (event.key === "Escape" && this.open) {
      event.preventDefault();
      event.stopPropagation();
      this.hide(true);
    }
  }

  emit(value) {
    this.dispatchEvent(new CustomEvent("change", { detail: { value } }));
  }

  @api
  focus() {
    const el = this.template.querySelector("input");
    if (el) el.focus();
  }
}
