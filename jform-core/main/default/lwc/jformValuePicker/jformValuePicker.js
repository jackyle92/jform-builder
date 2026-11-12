import { LightningElement, api } from "lwc";

const MAX_RESULTS = 80;

/**
 * Searchable picker over grouped options ({ label, value, group, detail }), a drop-in for
 * lightning-combobox: same `value` and `change` event with `detail.value`. Groups show in the
 * order they first appear in `options`; typing filters by label or detail.
 */
export default class JformValuePicker extends LightningElement {
  @api label = "Value";
  @api placeholder = "Choose a value";
  @api variant = "standard";
  @api disabled = false;
  _options = [];
  _value = "";
  query = "";
  open = false;
  activeIndex = -1;

  @api
  get options() {
    return this._options;
  }
  set options(v) {
    this._options = Array.isArray(v) ? v : [];
  }
  @api
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v || "";
    if (!this.open) this.query = "";
  }

  get labelClass() {
    return `slds-form-element__label${this.variant === "label-hidden" ? " slds-assistive-text" : ""}`;
  }
  get selected() {
    return this._value ? this._options.find((o) => o.value === this._value) : undefined;
  }
  get inputValue() {
    if (this.open) return this.query;
    return this.selected ? this.selected.label : "";
  }
  get inputPlaceholder() {
    return this.selected && this.open ? this.selected.label : this.placeholder;
  }
  get expandedText() {
    return this.open ? "true" : "false";
  }

  get matches() {
    const q = this.query.trim().toLowerCase();
    if (!q) return this._options;
    return this._options.filter((o) => String(o.label).toLowerCase().includes(q) || String(o.detail || "").toLowerCase().includes(q));
  }
  /** Header rows and option rows in display order, for one flat keyed list. */
  get rows() {
    const out = [];
    const seen = new Set();
    let index = 0;
    for (const o of this.matches.slice(0, MAX_RESULTS)) {
      const group = o.group || "";
      if (group && !seen.has(group)) {
        seen.add(group);
        out.push({ key: `group-${group}`, header: "true", label: group, cls: "vp-group", role: "presentation" });
      }
      const isSelected = o.value === this._value;
      out.push({
        key: `${group}-${o.value}`,
        value: o.value,
        label: o.label,
        detail: o.detail || "",
        index: index,
        role: "option",
        selected: isSelected ? "true" : "false",
        cls: `vp-option${index === this.activeIndex ? " vp-active" : ""}${isSelected ? " vp-selected" : ""}`
      });
      index++;
    }
    return out;
  }
  get items() {
    return this.rows.filter((r) => !r.header);
  }
  get moreText() {
    const total = this.matches.length;
    return total > MAX_RESULTS ? `${total - MAX_RESULTS} more: keep typing to narrow the list.` : "";
  }
  get noMatches() {
    return this.open && this.items.length === 0;
  }

  handleFocus() {
    if (this.disabled) return;
    this.open = true;
    this.query = "";
    this.activeIndex = -1;
  }
  handleInput(event) {
    this.query = event.target.value;
    this.open = true;
    this.activeIndex = this.items.length ? 0 : -1;
  }
  handleBlur() {
    // a click on an option fires mousedown first, which picks before the list closes
    this.open = false;
    this.query = "";
  }
  handleKeydown(event) {
    const items = this.items;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.open = true;
      this.activeIndex = Math.min(items.length - 1, this.activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = Math.max(0, this.activeIndex - 1);
    } else if (event.key === "Enter") {
      if (this.open && items[this.activeIndex]) {
        event.preventDefault();
        this.pick(items[this.activeIndex].value);
      }
    } else if (event.key === "Escape") {
      this.open = false;
      this.query = "";
    }
  }
  handlePick(event) {
    event.preventDefault(); // keeps focus in the input, also on a header row
    if (event.currentTarget.dataset.header) return;
    this.pick(event.currentTarget.dataset.value);
  }
  pick(value) {
    this._value = value || "";
    this.open = false;
    this.query = "";
    const input = this.template.querySelector("input");
    if (input) input.blur();
    this.dispatchEvent(new CustomEvent("change", { detail: { value: this._value } }));
  }
}
