import { LightningElement, api } from "lwc";
import { gatewayOf } from "c/jformPayment";

const SIZES = new Set(["small", "medium", "large"]);

/**
 * A payment gateway's logo, drawn inline so nothing loads from the gateway: it works the same in Lightning,
 * on the site and in namespaced orgs, and adds no third-party resource for the security review. A gateway
 * without a drawing shows its name. `decorative` hides the logo from screen readers when the name is written
 * next to it; `monochrome` draws it in the surrounding text colour (the respondent's form theme).
 */
export default class JformGatewayLogo extends LightningElement {
  @api gateway;
  @api size = "medium";
  @api decorative = false;
  @api monochrome = false;

  get isStripe() {
    return gatewayOf(this.gateway)?.id === "stripe";
  }
  get name() {
    return gatewayOf(this.gateway)?.name || String(this.gateway || "");
  }
  get cls() {
    return `logo logo-${SIZES.has(this.size) ? this.size : "medium"}${this.monochrome ? " logo-mono" : ""}`;
  }
  get role() {
    return this.decorative ? null : "img";
  }
  get label() {
    return this.decorative ? null : this.name;
  }
  get hidden() {
    return this.decorative ? "true" : null;
  }
}
