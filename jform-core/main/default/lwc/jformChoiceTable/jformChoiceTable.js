import { LightningElement, api } from "lwc";

/** Below this width, or with more columns than this, each row becomes its own group of stacked options. */
export const NARROW_WIDTH = 480;
export const MAX_WIDE_COLUMNS = 7;

let instance = 0;

/**
 * The table field's control: rows are questions, columns are the answers. Each row is one radio
 * group (or a set of checkboxes with `multiple`), so arrow keys move within a row and Tab moves to
 * the next. The answer is an object keyed by row: { service: "Satisfied" } or { mon: ["am", "pm"] }.
 * Fires `change` with { value } and `blur`.
 */
export default class JformChoiceTable extends LightningElement {
  /** [{ key, label }] */
  @api rows = [];
  /** [{ label, value }] */
  @api columns = [];
  @api value;
  @api multiple = false;
  @api disabled = false;
  /** Row keys to mark as unanswered (a required error). */
  @api missingRows = [];
  @api ariaLabel;
  @api ariaDescribedby;

  width = 0;
  uid = `jft${++instance}`;

  get isMultiple() {
    return this.multiple === true || this.multiple === "true";
  }
  get inputType() {
    return this.isMultiple ? "checkbox" : "radio";
  }
  /** Narrow until the width is known, so a phone never flashes a table wider than the screen. */
  get narrow() {
    return (this.columns || []).length > MAX_WIDE_COLUMNS || this.width < NARROW_WIDTH;
  }
  get answers() {
    return this.value && typeof this.value === "object" && !Array.isArray(this.value) ? this.value : {};
  }

  /** The chosen values of one row, as strings. */
  chosenIn(rowKey) {
    const v = this.answers[rowKey];
    if (Array.isArray(v)) return v.map(String);
    return v === null || v === undefined || v === "" ? [] : [String(v)];
  }

  get viewColumns() {
    return (this.columns || []).map((c, i) => ({ key: `${i}-${c.value}`, label: c.label }));
  }

  get viewRows() {
    const missing = new Set(this.missingRows || []);
    return (this.rows || []).map((row) => {
      const chosen = new Set(this.chosenIn(row.key));
      const flagged = missing.has(row.key);
      return {
        key: row.key,
        label: row.label,
        name: `${this.uid}-${row.key}`,
        rowCls: `jf-tbl-tr${flagged ? " jf-tbl-missing" : ""}`,
        groupCls: `jf-tbl-group${flagged ? " jf-tbl-missing" : ""}`,
        cells: (this.columns || []).map((c, i) => {
          const value = String(c.value ?? c.label);
          const checked = chosen.has(value);
          return {
            key: `${i}-${value}`,
            label: c.label,
            value,
            checked,
            // read with the input on its own: "Service: Satisfied"
            srLabel: `${row.label}: ${c.label}`,
            choiceCls: `jf-choice${checked ? " jf-choice-on" : ""}${this.disabled ? " jf-choice-disabled" : ""}`
          };
        })
      };
    });
  }

  // ------------------------------------------------------------ own width
  renderedCallback() {
    if (this.resizeObserver || typeof ResizeObserver === "undefined") return;
    const host = this.template.host;
    if (!host) return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect?.width || host.getBoundingClientRect().width);
      if (width > 0 && width !== this.width) this.width = width;
    });
    this.resizeObserver.observe(host);
  }
  disconnectedCallback() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
  }

  // ------------------------------------------------------------ events
  handleChange(event) {
    if (this.disabled) return;
    const rowKey = event.target.dataset.row;
    const next = { ...this.answers };
    if (this.isMultiple) {
      const chosen = new Set(this.chosenIn(rowKey));
      if (event.target.checked) chosen.add(event.target.value);
      else chosen.delete(event.target.value);
      // keep the columns' order, not click order
      const ordered = (this.columns || []).map((c) => String(c.value ?? c.label)).filter((v) => chosen.has(v));
      if (ordered.length) next[rowKey] = ordered;
      else delete next[rowKey];
    } else {
      next[rowKey] = event.target.value;
    }
    this.dispatchEvent(new CustomEvent("change", { detail: { value: next } }));
  }
  /** Only when focus leaves the table, not when it moves to the next row. */
  handleBlur(event) {
    if (event.relatedTarget && this.template.contains(event.relatedTarget)) return;
    this.dispatchEvent(new CustomEvent("blur"));
  }

  @api
  focus() {
    const missing = new Set(this.missingRows || []);
    const inputs = Array.from(this.template.querySelectorAll("input"));
    const target = inputs.find((i) => missing.has(i.dataset.row)) || inputs[0];
    if (target) target.focus();
  }
}
