import { LightningElement, api, track } from "lwc";

/**
 * Rich text for Display Text blocks and the welcome and thank-you messages: the visual editor
 * (lightning-input-rich-text) or the same HTML in a plain text area, for formatting the visual
 * editor cannot express (tables, inline styles, non-breaking spaces).
 *
 * While the editor is being used it shows what the user typed. The host may hold the server's
 * rewrite of that HTML after an autosave (entities, spacing); feeding that back into a focused
 * editor resets the caret and undoes keystrokes in flight. The stored copy is taken again when
 * the editor is left.
 *
 * Fires `change` ({ value }) on every edit and `modechange` ({ mode: "visual" | "html" }) when
 * the user switches; the host persists the mode so a block authored as HTML reopens as HTML.
 */
/** One block per line when the HTML is shown; browsers ignore the added line breaks between blocks. */
export function prettyHtml(html) {
  if (!html || typeof html !== "string" || html.includes("\n")) return html || "";
  return html
    .replace(/(<\/(?:p|li|ul|ol|h[1-6]|div|blockquote|table|thead|tbody|tr|td|th|pre)>)/gi, "$1\n")
    .replace(/(<(?:ul|ol|table|thead|tbody|tr)\b[^>]*>)/gi, "$1\n")
    .replace(/\n+$/, "");
}

export default class JformRichEditor extends LightningElement {
  @api label = "Text";
  /** Name of the value this editor edits, for hosts that manage several editors. */
  @api name;

  _value;
  _mode = "visual";
  @track localMode = "visual";
  @track draft; // undefined when the stored value is shown

  @api
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v;
  }
  @api
  get mode() {
    return this._mode;
  }
  set mode(v) {
    this._mode = v === "html" ? "html" : "visual";
    this.localMode = this._mode;
  }

  get isHtml() {
    return this.localMode === "html";
  }
  get editorValue() {
    return this.draft !== undefined ? this.draft : this._value;
  }
  get htmlValue() {
    return this.draft !== undefined ? this.draft : prettyHtml(this._value);
  }
  get toggleLabel() {
    return this.isHtml ? "Back to the visual editor" : "Edit as HTML";
  }

  /** A textarea's value cannot be bound in the template; set it after render, without disturbing the caret while typing. */
  renderedCallback() {
    const area = this.template.querySelector("textarea.re-html");
    if (area && area.value !== this.htmlValue) area.value = this.htmlValue;
  }

  handleChange(event) {
    this.emitValue(event.target.value);
  }
  handleHtmlInput(event) {
    this.emitValue(event.target.value);
  }
  emitValue(value) {
    this.draft = value;
    this.dispatchEvent(new CustomEvent("change", { detail: { value } }));
  }
  handleBlur() {
    this.draft = undefined;
  }
  handleToggle() {
    const mode = this.isHtml ? "visual" : "html";
    this.draft = undefined;
    this.localMode = mode;
    this.dispatchEvent(new CustomEvent("modechange", { detail: { mode } }));
  }

  @api
  focus() {
    const el = this.template.querySelector("textarea, lightning-input-rich-text");
    if (el && typeof el.focus === "function") el.focus();
  }
}
