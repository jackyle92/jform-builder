import { LightningElement, api } from "lwc";

/** Up to this many pages get a numbered button each; longer forms keep a dropdown. */
const MAX_PILLS = 8;

/** Stops before and after the pages, matching the renderer's preview keys. */
const WELCOME_STOP = "__welcome";
const ENDING_STOP = "__ending";
const NOT_OPEN_STOP = "__notOpen";
const CLOSED_STOP = "__closed";

/**
 * Preview controls for the builder: step through the welcome screen (when there is a start screen),
 * the pages (previous and next, or a numbered button per page, including pages a rule hides), the
 * thank-you screen and, when the form has opening or closing rules, its not-yet-open and closed screens, and choose whether Next and Submit check required fields. Fed by the renderer's
 * previewstate event; the parent passes picks back with renderer.showPage(key).
 */
export default class JformPreviewPages extends LightningElement {
  /** [{ key, number, label, hidden }] in form order. */
  @api pages = [];
  /** Key of the page on screen. */
  @api current;
  @api multiPage = false;
  @api checkRequired = false;
  /** The form opens on a start screen, so the preview can show it. */
  @api welcome = false;
  /** The form has an opening time (or a not-yet-open screen), so the preview can show that screen. */
  @api notOpen = false;
  /** The form can close (a closing time, a last day or a response limit), so the preview can show the closed screen. */
  @api closed = false;

  /** Every stop in order: [welcome], each page (or the whole form when it is one page), thank you, [not open yet], [closed]. */
  get list() {
    const pages = this.pages || [];
    const stops = [];
    if (this.welcome) stops.push({ key: WELCOME_STOP, number: "Welcome", label: "Welcome screen", screen: true });
    if (this.multiPage && pages.length > 1) stops.push(...pages);
    else if (pages.length) stops.push({ key: pages[0].key, number: "Form", label: "The form", screen: true });
    stops.push({ key: ENDING_STOP, number: "Thank you", label: "Thank-you screen", screen: true });
    if (this.notOpen) stops.push({ key: NOT_OPEN_STOP, number: "Not open yet", label: "Not-yet-open screen", screen: true });
    if (this.closed) stops.push({ key: CLOSED_STOP, number: "Closed", label: "Closed screen", screen: true });
    return stops;
  }
  get showPicker() {
    return this.list.length > 1 && (this.pages || []).length > 0;
  }
  get usePills() {
    return (this.pages || []).length <= MAX_PILLS;
  }
  /** Index of the page on screen (the first one until the renderer reports). */
  get at() {
    return Math.max(0, this.list.findIndex((p) => p.key === this.current));
  }
  get atFirst() {
    return this.at === 0;
  }
  get atLast() {
    return this.at >= this.list.length - 1;
  }
  get pills() {
    const total = (this.pages || []).length;
    return this.list.map((p, i) => {
      const on = i === this.at;
      const hidden = p.hidden ? ", hidden by a rule" : "";
      return {
        key: p.key,
        number: p.number,
        ariaCurrent: on ? "step" : null,
        ariaLabel: p.screen ? p.label : `Page ${p.number} of ${total}: ${p.label}${hidden}`,
        title: `${p.label}${p.hidden ? " (hidden by a rule)" : ""}`,
        cls: `pp-pill${on ? " pp-pill-on" : ""}${p.hidden ? " pp-pill-hidden" : ""}${p.screen ? " pp-pill-screen" : ""}`
      };
    });
  }
  get options() {
    return this.list.map((p, i) => ({
      key: p.key,
      text: p.screen ? p.label : `${p.number}. ${p.label}${p.hidden ? " (hidden by a rule)" : ""}`,
      selected: i === this.at
    }));
  }
  get currentPage() {
    return this.list[this.at] || {};
  }
  get currentName() {
    return this.currentPage.label || "";
  }
  get currentTitle() {
    return this.currentName;
  }
  get currentHidden() {
    return this.currentPage.hidden === true;
  }
  get position() {
    return `of ${(this.pages || []).length} pages`;
  }

  handlePrev() {
    if (!this.atFirst) this.go(this.list[this.at - 1].key);
  }
  handleNext() {
    if (!this.atLast) this.go(this.list[this.at + 1].key);
  }
  handlePill(event) {
    this.go(event.currentTarget.dataset.key);
  }
  handlePage(event) {
    this.go(event.target.value);
  }
  go(key) {
    this.dispatchEvent(new CustomEvent("pagechange", { detail: { key } }));
  }
  handleCheck(event) {
    this.dispatchEvent(new CustomEvent("checkchange", { detail: { checked: event.target.checked } }));
  }
}
