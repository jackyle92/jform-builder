import { LightningElement, api } from "lwc";

const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Payment gateways as a radio group: each option shows the gateway's logo and a line per mode saying whether
 * it is ready. Tiles on the Setup tab's Payments page and the form's Settings tab; one row per gateway in the
 * Payment block's properties (`variant="row"`). Arrow keys move the choice, as in any radio group.
 *   options: [{ id, name, states: [{ key, text, tone: on | warn | off }] }]
 * Fires `change` with { value } when another gateway is chosen.
 */
export default class JformGatewayPicker extends LightningElement {
  @api label = "Payment gateway";
  @api value;
  @api options = [];
  @api variant = "tile";

  get isRow() {
    return this.variant === "row";
  }
  get groupCls() {
    return `gw-group ${this.isRow ? "gw-rows" : "gw-tiles"}`;
  }
  get logoSize() {
    return this.isRow ? "small" : "medium";
  }
  get items() {
    const options = this.options || [];
    const known = options.some((o) => o.id === this.value);
    return options.map((o, i) => {
      const on = o.id === this.value;
      return {
        ...o,
        on,
        checked: on ? "true" : "false",
        // one stop in the tab order: the chosen gateway, or the first when none is
        tabindex: on || (!known && i === 0) ? "0" : "-1",
        cls: `gw-option${on ? " gw-option-on" : ""}`,
        states: (o.states || []).map((s) => ({ ...s, cls: `gw-state gw-state-${s.tone || "off"}` }))
      };
    });
  }
  handleClick(event) {
    this.choose(event.currentTarget.dataset.id);
  }
  handleKeyDown(event) {
    const step = STEP[event.key];
    const ids = (this.options || []).map((o) => o.id);
    const at = ids.indexOf(event.target.dataset?.id);
    if (!step || at < 0) return;
    event.preventDefault();
    const next = ids[(at + step + ids.length) % ids.length];
    this.choose(next);
    this.template.querySelector(`[data-id="${next}"]`)?.focus();
  }
  choose(id) {
    if (!id || id === this.value) return;
    this.dispatchEvent(new CustomEvent("change", { detail: { value: id } }));
  }
}
