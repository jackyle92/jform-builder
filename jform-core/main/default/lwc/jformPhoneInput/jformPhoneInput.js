import { LightningElement, api } from "lwc";
import FLAG_SPRITE from "@salesforce/resourceUrl/jformFlags";
import { COUNTRIES, FLAGS, OTHER, countryOf, startCountry, cleanNumber, formatTyping, toAnswer, readAnswer, examplePlaceholder } from "c/jformPhone";
import { prefersNativePicker } from "c/jformDateTime";

const OTHER_ROW = { iso: OTHER, name: "Other country", dial: "" };
/** Input types that put a whole number in the box at once; such a number may bring its own country. */
const WHOLE_NUMBER_INPUTS = new Set(["insertFromPaste", "insertFromDrop", "insertReplacementText", ""]);

let instance = 0;

function searchable(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * A phone number with its country code: a country button (flag and calling code) that opens a
 * searchable list, next to a number box formatted as it is typed. The value in and out is the
 * international number (+84912345678); see c/jformPhone for the rules and the config settings.
 *
 * Fires `change` ({ value }) as the number changes and `blur` when focus leaves the control.
 */
export default class JformPhoneInput extends LightningElement {
  @api value = "";
  @api placeholder;
  @api disabled = false;
  /** Start an empty answer in the visitor's country when the field allows it (off in the builder). */
  @api detect = false;
  /** On the builder canvas: disabled, but drawn like the live control rather than faded. */
  @api inert = false;
  @api ariaLabel;
  @api ariaRequired;
  @api ariaInvalid;
  @api ariaDescribedby;

  open = false;
  iso;
  text = "";
  query = "";
  activeIndex = 0;
  /** The respondent chose a country: it no longer follows the field's default. */
  picked = false;
  /** The value last read from the parent, and the one last sent: only a new value that is not ours is read. */
  seenValue;
  sentValue;
  connected = false;
  _config;
  pendingFocus;
  scrollActive = false;
  /** A document listener closes the list on presses elsewhere while it is open. */
  watching = false;
  pressInside = false;
  uid = `jfph${++instance}`;

  /** Field settings; while the answer is empty and no country was chosen, a new default applies at once. */
  @api
  get config() {
    return this._config;
  }
  set config(value) {
    this._config = value;
    if (this.connected && !this.picked && !this.text) this.iso = this.startIso;
  }

  // ------------------------------------------------------------ value in
  connectedCallback() {
    this.connected = true;
    this.sync();
  }
  disconnectedCallback() {
    this.connected = false;
    this.watchOutside(false);
  }
  renderedCallback() {
    if (this.value !== this.seenValue) {
      if (this.value === this.sentValue) this.seenValue = this.value;
      else this.sync();
    }
    if (this.pendingFocus) {
      const el = this.template.querySelector(this.pendingFocus);
      this.pendingFocus = undefined;
      if (el) el.focus();
    }
    if (this.scrollActive) {
      this.scrollActive = false;
      const row = this.template.querySelector(`.jf-ph-option[data-index="${this.activeIndex}"]`);
      if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    }
  }
  get startIso() {
    return startCountry(this.config, this.detect);
  }
  sync() {
    this.seenValue = this.value;
    const read = readAnswer(this.value, this.picked ? this.iso : this.startIso);
    this.iso = read.iso;
    this.text = read.text;
    // a number without its code (a default or prefilled value) is stored in international format
    const answer = toAnswer(this.text, this.iso);
    if (!this.disabled && this.value && answer !== this.value && !String(this.value).trim().startsWith("+")) this.emit(answer);
  }

  // ------------------------------------------------------------ rendering
  get rootClass() {
    return `jf-ph${this.open ? " jf-ph-open" : ""}`;
  }
  get controlClass() {
    const look = this.inert ? " jf-ph-inert" : this.disabled ? " jf-ph-disabled" : "";
    return `jf-ph-control${this.ariaInvalid === "true" || this.ariaInvalid === true ? " jf-ph-invalid" : ""}${look}`;
  }
  get country() {
    return this.iso === OTHER ? OTHER_ROW : countryOf(this.iso) || OTHER_ROW;
  }
  get isOther() {
    return this.country.iso === OTHER;
  }
  get dialText() {
    return this.isOther ? "+" : `+${this.country.dial}`;
  }
  get flagStyle() {
    return this.flagStyleOf(this.country);
  }
  get countryButtonLabel() {
    return this.isOther ? "Country code: other country" : `Country code: ${this.country.name} +${this.country.dial}`;
  }
  get expanded() {
    return this.open ? "true" : "false";
  }
  get listId() {
    return `${this.uid}-list`;
  }
  get placeholderText() {
    return this.placeholder || examplePlaceholder(this.iso);
  }
  flagStyleOf(country) {
    if (!country || country.flag === undefined) return "";
    const col = country.flag % FLAGS.columns;
    const row = Math.floor(country.flag / FLAGS.columns);
    return (
      `background-image:url("${FLAG_SPRITE}");background-size:${FLAGS.columns * FLAGS.width}px ${FLAGS.rows * FLAGS.height}px;` +
      `background-position:-${col * FLAGS.width}px -${row * FLAGS.height}px`
    );
  }

  /** Countries matching the search by name, code or calling code, then "Other country". */
  get matches() {
    const q = searchable(this.query);
    if (!q) return [...COUNTRIES, OTHER_ROW];
    const digits = /^\+?\d+$/.test(q) ? q.replace("+", "") : null;
    const found = COUNTRIES.filter((c) => (digits ? c.dial.startsWith(digits) : searchable(c.name).includes(q) || c.iso.toLowerCase() === q));
    return [...found, OTHER_ROW];
  }
  get rows() {
    return this.matches.map((c, index) => {
      const selected = c.iso === this.iso;
      const active = index === this.activeIndex;
      return {
        iso: c.iso,
        index,
        id: `${this.uid}-opt-${c.iso}`,
        name: c.name,
        dialText: c.dial ? `+${c.dial}` : "",
        isOther: c.iso === OTHER,
        flagStyle: this.flagStyleOf(c),
        selected: selected ? "true" : "false",
        cls: `jf-ph-option${active ? " jf-ph-active" : ""}${selected ? " jf-ph-selected" : ""}`
      };
    });
  }
  get activeId() {
    const row = this.rows[this.activeIndex];
    return row ? row.id : undefined;
  }
  get noMatches() {
    return this.matches.length === 1 && Boolean(searchable(this.query));
  }

  // ------------------------------------------------------------ country list
  /**
   * A tap on a touch screen opens the list without focusing the search box, so the on-screen keyboard
   * does not cover it; a click with a mouse or Enter/Space (click detail 0) goes straight to search.
   */
  handleToggle(event) {
    if (this.disabled) return;
    if (this.open) this.close("button");
    else this.openList("", !event || event.detail === 0 || !prefersNativePicker());
  }
  openList(query, focusSearch = true) {
    this.query = query;
    this.open = true;
    const current = this.matches.findIndex((c) => c.iso === this.iso);
    this.activeIndex = query ? 0 : Math.max(0, current);
    if (focusSearch) this.pendingFocus = ".jf-ph-search";
    this.scrollActive = true;
    this.watchOutside(true);
  }
  close(focusTarget) {
    this.open = false;
    this.query = "";
    this.watchOutside(false);
    if (focusTarget === "button") this.pendingFocus = ".jf-ph-country";
  }
  /**
   * Closes the list on a press anywhere else; needed where a tapped button never takes focus (Safari).
   * A press inside is marked on the way up and the document hears it afterwards, so no element identity
   * is compared (Lightning Web Security can hand the document listener different references).
   */
  handleRootPointerDown() {
    this.pressInside = true;
  }
  handleOutside = () => {
    if (this.pressInside) this.pressInside = false;
    else this.close();
  };
  watchOutside(on) {
    if (on === this.watching) return;
    this.watching = on;
    this.pressInside = false;
    if (on) document.addEventListener("pointerdown", this.handleOutside);
    else document.removeEventListener("pointerdown", this.handleOutside);
  }
  handleButtonKeydown(event) {
    if (this.disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.openList("");
    } else if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); // typing on the button starts a search
      this.openList(event.key);
    }
  }
  handleSearch(event) {
    this.query = event.target.value;
    this.activeIndex = 0;
    this.scrollActive = true;
  }
  handleSearchKeydown(event) {
    const last = this.matches.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.activeIndex = Math.min(last, this.activeIndex + 1);
      this.scrollActive = true;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = Math.max(0, this.activeIndex - 1);
      this.scrollActive = true;
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      this.activeIndex = event.key === "Home" ? 0 : last;
      this.scrollActive = true;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = this.matches[this.activeIndex];
      if (row) this.pick(row.iso);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close("button");
    } else if (event.key === "Tab") {
      this.close();
    }
  }
  /** Keeps focus in the search box while the list is clicked or scrolled. */
  handlePopMouseDown(event) {
    if (!event.target.classList || !event.target.classList.contains("jf-ph-search")) event.preventDefault();
  }
  handleOptionClick(event) {
    this.pick(event.currentTarget.dataset.iso);
  }
  /** A new country re-reads the national digits in it; a number in another calling code is cleared. */
  pick(iso) {
    this.picked = true;
    const clean = cleanNumber(this.text);
    let text;
    if (iso === OTHER) {
      const current = toAnswer(this.text, this.iso);
      text = current || "+";
    } else if (clean.startsWith("+")) {
      const read = readAnswer(clean, iso);
      text = read.iso === iso ? read.text : "";
    } else {
      text = formatTyping(clean, iso);
    }
    this.iso = iso;
    this.text = text;
    this.close();
    this.pendingFocus = ".jf-ph-input";
    this.emit(toAnswer(text, iso));
  }

  // ------------------------------------------------------------ number box
  handleInput(event) {
    const input = event.target;
    const raw = input.value;
    const clean = cleanNumber(raw);
    let iso = this.iso;
    let text = raw;
    if (clean.startsWith("+")) {
      // a whole international number (pasted or autofilled) switches to its country
      if (WHOLE_NUMBER_INPUTS.has(event.inputType || "")) {
        const read = readAnswer(clean, iso);
        if (read.iso !== OTHER || iso === OTHER) {
          iso = read.iso;
          text = read.text;
        }
      }
    } else {
      const deleting = String(event.inputType || "").startsWith("delete");
      const atEnd = input.selectionStart === null || input.selectionStart === undefined || input.selectionStart >= raw.length;
      if (!deleting && atEnd) text = formatTyping(raw, iso);
    }
    this.iso = iso;
    this.text = text;
    if (text !== raw) input.value = text;
    this.emit(toAnswer(text, iso));
  }
  /** Tidy the number when the box is left: national format, or a number with + moved to its country. */
  handleNumberBlur() {
    const clean = cleanNumber(this.text);
    if (!clean || clean === "+") return;
    if (clean.startsWith("+")) {
      const read = readAnswer(clean, this.iso);
      this.iso = read.iso;
      this.text = read.text;
    } else if (this.isOther) {
      this.text = `+${clean}`;
    } else {
      this.text = formatTyping(clean, this.iso);
    }
  }
  handleFocusOut(event) {
    const next = event.relatedTarget;
    const root = this.template.querySelector(".jf-ph");
    if (next && root && root.contains(next)) return;
    if (this.open) this.close();
    this.dispatchEvent(new CustomEvent("blur"));
  }

  emit(value) {
    this.sentValue = value;
    this.dispatchEvent(new CustomEvent("change", { detail: { value } }));
  }

  @api
  focus() {
    const el = this.template.querySelector(".jf-ph-input");
    if (el) el.focus();
  }
}
