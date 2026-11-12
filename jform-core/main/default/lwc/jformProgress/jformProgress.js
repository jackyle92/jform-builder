import { LightningElement, api } from "lwc";

/**
 * A multi-page form's progress for c/jformRenderer, above the card or inside it: "Step 2 of 3", the percent, and
 * one bar, or a segment per page when the theme asks for segments. Colors come from the renderer's --jf-* tokens.
 */
export default class JformProgress extends LightningElement {
  @api step;
  @api steps;
  /** The current page's name. */
  @api label;
  @api percent = 0;
  /** A segment per page ({ key, style }), or null for one bar. */
  @api segments;

  get segmented() {
    return Array.isArray(this.segments);
  }
  get barStyle() {
    return `width:${this.percent}%`;
  }
}
