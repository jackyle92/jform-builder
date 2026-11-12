import { LightningElement, api } from "lwc";

/** Shown first, in this order, before every other object A to Z. */
const COMMON = ["lead", "contact", "case", "account", "opportunity", "campaign"];
const MAX_RESULTS = 60;

/**
 * Object picker with type-to-search, a drop-in for lightning-combobox: same `value`, `options`
 * ({ label, value }) and `change` event with `detail.value`. Orgs can have hundreds of objects,
 * so common ones come first and typing filters by label or API name.
 */
export default class JformObjectPicker extends LightningElement {
  @api label = "Object";
  @api placeholder = "Search objects";
  @api disabled = false;
  @api required = false;
  /** Lets the parent show "None": an empty choice at the top. */
  @api allowNone = false;
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

  get selected() {
    const v = String(this._value || "").toLowerCase();
    return v ? this._options.find((o) => String(o.value).toLowerCase() === v) : undefined;
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
  get hasValue() {
    return Boolean(this.selected) && !this.disabled;
  }

  /** Matching options: common objects first when the query is empty, then A to Z; capped. */
  get matches() {
    const q = this.query.trim().toLowerCase();
    const all = this._options;
    const hit = (o) => !q || String(o.label).toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q);
    const commonOf = (o) => COMMON.indexOf(String(o.value).toLowerCase());
    const common = all.filter((o) => commonOf(o) >= 0 && hit(o)).sort((a, b) => commonOf(a) - commonOf(b));
    const rest = all.filter((o) => commonOf(o) < 0 && hit(o)).sort((a, b) => String(a.label).localeCompare(String(b.label)));
    return { common, rest, total: common.length + rest.length };
  }
  get groups() {
    const { common, rest } = this.matches;
    const out = [];
    let i = 0;
    const row = (o, group) => {
      const index = i++;
      const isSelected = this.selected && this.selected.value === o.value;
      return {
        key: `${group}-${o.value}`,
        value: o.value,
        label: o.label,
        apiName: o.value,
        index,
        selected: isSelected ? "true" : "false",
        cls: `op-option${index === this.activeIndex ? " op-active" : ""}${isSelected ? " op-selected" : ""}`
      };
    };
    if (this.allowNone && !this.query.trim()) out.push({ key: "none", label: "", items: [{ ...row({ value: "", label: "None" }, "none"), apiName: "" }] });
    if (common.length) out.push({ key: "common", label: "Common", items: common.map((o) => row(o, "c")) });
    const shown = rest.slice(0, Math.max(0, MAX_RESULTS - common.length));
    if (shown.length) out.push({ key: "all", label: this.query.trim() ? "Matches" : "All objects", items: shown.map((o) => row(o, "a")) });
    return out;
  }
  get flatItems() {
    return this.groups.flatMap((g) => g.items);
  }
  /** Header rows and option rows in display order, for the template's single keyed list. */
  get rows() {
    return this.groups.flatMap((g) => [
      ...(g.label ? [{ key: `group-${g.key}`, header: "true", label: g.label, cls: "op-group", role: "presentation" }] : []),
      ...g.items.map((o) => ({ ...o, role: "option" }))
    ]);
  }
  get moreText() {
    const { total } = this.matches;
    const shown = this.flatItems.filter((x) => x.value).length;
    return total > shown ? `${total - shown} more: keep typing to narrow the list.` : "";
  }
  get noMatches() {
    return this.open && this.flatItems.length === 0;
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
    this.activeIndex = this.flatItems.length ? 0 : -1;
  }
  handleBlur() {
    // a click on an option fires mousedown first, which picks before the list closes
    this.open = false;
    this.query = "";
  }
  handleKeydown(event) {
    const items = this.flatItems;
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
  handleClear(event) {
    event.preventDefault();
    this.pick("");
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
