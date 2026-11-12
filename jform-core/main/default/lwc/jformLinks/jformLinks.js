import { qualify, stateKey } from "c/jformNamespace";

/** Page on the site that hosts the JForm Renderer, unless the form's publish settings name another. */
export const DEFAULT_PAGE_PATH = "/form";

/** The site a form's public link uses: the one chosen in its publish settings, else the first Experience site, else any site. */
export function selectedSite(definition, sites) {
  const list = sites || [];
  const siteId = definition?.settings?.publish?.siteId;
  return list.find((s) => s.id === siteId) || list.find((s) => s.isExperienceSite) || list[0];
}

export function pagePathOf(definition) {
  const path = definition?.settings?.publish?.pagePath || DEFAULT_PAGE_PATH;
  return path.startsWith("/") ? path : `/${path}`;
}

/** https://site/path/form?key=…, or "" when the form has no key or the org no site. */
export function publicUrlOf(definition, sites, key = definition?.publicKey) {
  const site = selectedSite(definition, sites);
  if (!key || !site || !site.baseUrl) return "";
  return `${site.baseUrl}${pagePathOf(definition)}?key=${key}`;
}

/** Internal preview inside Salesforce (login required). */
export function previewUrlOf(key) {
  return key ? `${window.location.origin}/lightning/n/${qualify("JForm_Preview")}?${stateKey("key")}=${key}` : "";
}
