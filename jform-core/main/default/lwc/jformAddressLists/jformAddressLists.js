import getAddressLists from "@salesforce/apex/JFormWorkspaceController.getAddressLists";
import { isAddress } from "c/jformFieldRegistry";

let pending;

/**
 * The countries and states Address fields offer, for the builder's canvas, Preview and properties panel: the org's
 * State and Country/Territory Picklists, or JForm's own countries (JFormAddressService.Lists). Read once per page;
 * a failed read is tried again next time. A published form gets them with its definition instead.
 */
export function loadAddressLists() {
  if (!pending) {
    pending = getAddressLists().catch(() => {
      pending = undefined;
      return null;
    });
  }
  return pending;
}

/** Whether a form definition has an Address field. */
export function hasAddressField(definition) {
  return (definition?.sections || []).some((s) => (s.fields || []).some((f) => isAddress(f.type)));
}
