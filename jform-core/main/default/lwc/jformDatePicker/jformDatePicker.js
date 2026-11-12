import { LightningElement, api, track } from "lwc";
import {
  parseISODate, todayISO, addDays, addMonths, toISODate, parseDateText, formatDate, formatDateLong, localeDatePattern,
  firstDayOfWeek, weekdayNames, monthNames, monthGrid, dateLimits, disabledDays, weekdayOf, prefersNativePicker, currentLocale
} from "c/jformDateTime";

const YEARS_BACK = 100;
const YEARS_AHEAD = 20;

/**
 * A date field: a text box that accepts the respondent's own date format plus a calendar
 * popover in the form's theme. The value in and out is always "YYYY-MM-DD". On touch-first
 * devices the platform's own date control is used instead, with the same limits.
 *
 * Fires `change` ({ value }) when the date changes and `blur` when focus leaves the control.
 */
export default class JformDatePicker extends LightningElement {
  @api value = "";
  @api config;
  @api placeholder;
  @api disabled = false;
  @api ariaLabel;
  @api ariaRequired;
  @api ariaInvalid;
  @api ariaDescribedby;
  /** Overrides device detection; used by tests and the builder canvas. */
  @api forceNative;

  @track open = false;
  @track text = "";
  @track viewYear;
  @track viewMonth;
  @track focusIso;
  locale = currentLocale();
  firstDay = firstDayOfWeek(this.locale);
  weekdays = weekdayNames(this.locale, this.firstDay);
  lastValue;
  pendingFocus;

  // ------------------------------------------------------------ rendering
  get native() {
    return this.forceNative === true || (this.forceNative !== false && prefersNativePicker());
  }
  /** iOS shows nothing in an empty native control, so the placeholder is drawn over it. */
  get nativeEmpty() {
    return !parseISODate(this.value);
  }
  get nativeClass() {
    return `jf-input jf-native${this.nativeEmpty ? " jf-native-empty" : ""}`;
  }
  get rootClass() {
    return `jf-dp${this.open ? " jf-dp-open" : ""}`;
  }
  get placeholderText() {
    return this.placeholder || localeDatePattern(this.locale);
  }
  get limits() {
    return dateLimits(this.config);
  }
  get minAttr() {
    return this.limits.min || undefined;
  }
  get maxAttr() {
    return this.limits.max || undefined;
  }
  get months() {
    return monthNames(this.locale).map((m) => ({ ...m, selected: m.value === this.viewMonth }));
  }
  get years() {
    const { min, max } = this.limits;
    const now = Number(todayISO().slice(0, 4));
    let from = min ? Number(min.slice(0, 4)) : now - YEARS_BACK;
    let to = max ? Number(max.slice(0, 4)) : now + YEARS_AHEAD;
    if (this.viewYear < from) from = this.viewYear;
    if (this.viewYear > to) to = this.viewYear;
    const out = [];
    for (let y = from; y <= to; y++) out.push({ value: y, label: String(y), selected: y === this.viewYear });
    return out;
  }
  get gridLabel() {
    const m = this.months.find((x) => x.value === this.viewMonth);
    return `${m ? m.label : ""} ${this.viewYear}`;
  }
  get rows() {
    const today = todayISO();
    const { min, max } = this.limits;
    const off = disabledDays(this.config);
    const selected = parseISODate(this.value) ? this.value : null;
    const focus = this.focusIso;
    return monthGrid(this.viewYear, this.viewMonth, this.firstDay).map((row, r) => ({
      key: `r${r}`,
      cells: row.map((c) => {
        const blocked = (min && c.iso < min) || (max && c.iso > max) || off.includes(c.weekday);
        const isSelected = c.iso === selected;
        return {
          iso: c.iso,
          day: c.day,
          selected: isSelected,
          disabled: blocked,
          tabindex: c.iso === focus ? "0" : "-1",
          current: c.iso === today ? "date" : undefined,
          label: formatDateLong(c.iso, this.locale),
          cls: `jf-dp-day${c.inMonth ? "" : " jf-dp-out"}${isSelected ? " jf-dp-selected" : ""}${c.iso === today ? " jf-dp-today" : ""}`
        };
      })
    }));
  }
  get todayDisabled() {
    return this.problemWith(todayISO()) !== null;
  }
  problemWith(iso) {
    const { min, max } = this.limits;
    if (min && iso < min) return "min";
    if (max && iso > max) return "max";
    if (disabledDays(this.config).includes(weekdayOf(iso))) return "day";
    return null;
  }

  connectedCallback() {
    this.syncText();
  }
  renderedCallback() {
    if (this.value !== this.lastValue) this.syncText();
    if (this.pendingFocus) {
      const target = this.template.querySelector(`button[data-iso="${this.pendingFocus}"]`);
      this.pendingFocus = undefined;
      if (target) target.focus();
    }
  }
  /** The text box shows the stored value in the locale's format, unless the respondent is mid-typing. */
  syncText() {
    this.lastValue = this.value;
    if (!this.typing) this.text = parseISODate(this.value) ? formatDate(this.value, this.locale) : this.value || "";
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
    const iso = parseDateText(raw, this.locale);
    if (iso) {
      this.text = formatDate(iso, this.locale);
      this.emit(iso);
    } else {
      // keep what was typed so the error can say "Enter a valid date" against it
      this.emit(raw);
    }
  }
  handleInputKeydown(event) {
    if (event.key === "ArrowDown" || (event.altKey && event.key === "ArrowDown")) {
      event.preventDefault();
      this.show(true);
    } else if (event.key === "Escape" && this.open) {
      event.preventDefault();
      this.hide();
    }
  }

  // ------------------------------------------------------------ popover
  handleToggle() {
    if (this.open) this.hide();
    else this.show(true);
  }
  show(focusDay) {
    const start = parseISODate(this.value) ? this.value : this.firstAllowed(todayISO());
    const p = parseISODate(start);
    this.viewYear = p.y;
    this.viewMonth = p.m;
    this.focusIso = start;
    this.open = true;
    if (focusDay) this.pendingFocus = start;
  }
  hide(refocus) {
    this.open = false;
    if (refocus) {
      const input = this.template.querySelector(".jf-dp-input");
      if (input) input.focus();
    }
  }
  /** The first selectable date at or after `iso` (within a year), else `iso` itself. */
  firstAllowed(iso) {
    let cursor = iso;
    const { min } = this.limits;
    if (min && cursor < min) cursor = min;
    for (let i = 0; i < 366; i++) {
      if (!this.problemWith(cursor)) return cursor;
      cursor = addDays(cursor, 1);
    }
    return iso;
  }
  handleFocusOut(event) {
    const next = event.relatedTarget;
    if (next && this.template.querySelector(".jf-dp")?.contains(next)) return;
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
  handlePrevMonth() {
    this.moveView(-1);
  }
  handleNextMonth() {
    this.moveView(1);
  }
  moveView(months) {
    const next = addMonths(toISODate(this.viewYear, this.viewMonth, 1), months);
    const p = parseISODate(next);
    this.viewYear = p.y;
    this.viewMonth = p.m;
    if (parseISODate(this.focusIso)?.m !== p.m) this.focusIso = next;
  }
  handleMonthSelect(event) {
    this.viewMonth = Number(event.target.value);
    this.focusIso = toISODate(this.viewYear, this.viewMonth, 1);
  }
  handleYearSelect(event) {
    this.viewYear = Number(event.target.value);
    this.focusIso = toISODate(this.viewYear, this.viewMonth, 1);
  }
  handleDayClick(event) {
    this.choose(event.currentTarget.dataset.iso);
  }
  handleDayKeydown(event) {
    const iso = event.currentTarget.dataset.iso;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target;
    if (moves[event.key] !== undefined) target = addDays(iso, moves[event.key]);
    else if (event.key === "Home") target = addDays(iso, -((weekdayOf(iso) - this.firstDay + 7) % 7));
    else if (event.key === "End") target = addDays(iso, 6 - ((weekdayOf(iso) - this.firstDay + 7) % 7));
    else if (event.key === "PageUp") target = addMonths(iso, event.shiftKey ? -12 : -1);
    else if (event.key === "PageDown") target = addMonths(iso, event.shiftKey ? 12 : 1);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!this.problemWith(iso)) this.choose(iso);
      return;
    } else return;
    event.preventDefault();
    const p = parseISODate(target);
    this.viewYear = p.y;
    this.viewMonth = p.m;
    this.focusIso = target;
    this.pendingFocus = target;
  }
  choose(iso) {
    this.typing = false;
    this.text = formatDate(iso, this.locale);
    this.emit(iso);
    this.hide(true);
  }
  handleClear() {
    this.typing = false;
    this.text = "";
    this.emit("");
    this.hide(true);
  }
  handleToday() {
    this.choose(todayISO());
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
