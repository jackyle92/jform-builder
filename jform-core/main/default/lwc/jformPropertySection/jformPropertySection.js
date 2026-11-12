import { LightningElement, api } from "lwc";

/**
 * A folding group of settings in c/jformProperties: the group's name with a chevron, a summary while folded, and
 * the settings in the slot. The panel keeps which groups are open; a click on the header sends "toggle".
 */
export default class JformPropertySection extends LightningElement {
  @api label;
  @api open = false;
  /** What the group holds, shown only while it is folded. */
  @api summary;

  get expanded() {
    return this.open ? "true" : "false";
  }
  get closed() {
    return !this.open;
  }
  get chevron() {
    return this.open ? "utility:chevrondown" : "utility:chevronright";
  }
  get showSummary() {
    return !this.open && Boolean(this.summary);
  }
  handleClick() {
    this.dispatchEvent(new CustomEvent("toggle"));
  }
}
