import { LightningElement, api } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { qualify, stateKey } from "c/jformNamespace";

/** The Form record's Edit action: opens the form in the workspace, the one place a form is edited. */
export default class JformEditForm extends NavigationMixin(LightningElement) {
  @api recordId;

  @api invoke() {
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Workspace") }, state: { [stateKey("formid")]: this.recordId } });
  }
}
