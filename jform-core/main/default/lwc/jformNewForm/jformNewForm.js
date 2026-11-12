import { LightningElement } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { qualify, stateKey } from "c/jformNamespace";

/** Form's New (through jformNewFormOverride): the workspace's New form dialog, replacing the New page in the history. */
export default class JformNewForm extends NavigationMixin(LightningElement) {
  connectedCallback() {
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Workspace") }, state: { [stateKey("action")]: "new" } }, true);
  }
}
