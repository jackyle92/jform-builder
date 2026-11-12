import { LightningElement, api } from "lwc";
import { DEFAULT_PAGE_PATH, selectedSite, pagePathOf, publicUrlOf, previewUrlOf } from "c/jformLinks";
import { loadScript } from "lightning/platformResourceLoader";
import QRCODE from "@salesforce/resourceUrl/jformQrcode";

const TABS = [
  { id: "link", label: "Link" },
  { id: "embed", label: "Embed" },
  { id: "qr", label: "QR code" },
  { id: "site", label: "Site page" }
];

/**
 * Share dialog: public link, embed snippet, QR code and site page settings.
 * URLs are assembled from the chosen Experience site and the form's publish
 * settings; the public key never changes, so links survive republishing.
 */
/** Text for an HTML attribute in the copied snippet: a form name like `Q&A "beta" <2>` must not break or extend the markup. */
function escapeAttribute(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default class JformShareModal extends LightningElement {
  @api definition;
  @api sites = [];
  tab = "link";
  qrLoaded = false;
  qrDataUrl;
  qrSvg;
  qrFor;
  copied;

  // ------------------------------------------------------------ state
  get publishSettings() {
    return this.definition?.settings?.publish || {};
  }
  get selectedSite() {
    return selectedSite(this.definition, this.sites);
  }
  get selectedSiteId() {
    return this.selectedSite?.id || "";
  }
  get pagePath() {
    return pagePathOf(this.definition);
  }
  get publicKey() {
    return this.definition?.publicKey;
  }
  get isLive() {
    return Boolean(this.definition?.isActive && this.publicKey);
  }
  get hasSite() {
    return Boolean(this.selectedSite);
  }
  get publicUrl() {
    return publicUrlOf(this.definition, this.sites);
  }
  get embedUrl() {
    return this.publicUrl ? `${this.publicUrl}&embed=1` : "";
  }
  get previewUrl() {
    return previewUrlOf(this.publicKey);
  }
  get title() {
    return this.definition?.label || this.definition?.name || "Form";
  }
  get embedSnippet() {
    if (!this.embedUrl) return "";
    const id = `jform-${this.publicKey}`;
    let origin = "";
    try {
      origin = new URL(this.embedUrl).origin;
    } catch (e) {
      origin = "";
    }
    // only messages from the site that serves the form may resize the frame, or move the page after the
    // thank-you screen (jform:redirect: a frame cannot reliably navigate the page around it)
    const originCheck = origin ? `e.origin==="${origin}"&&` : "";
    return (
      `<iframe id="${id}" src="${this.embedUrl}" title="${escapeAttribute(this.title)}" style="width:100%;border:0;min-height:600px" loading="lazy"></iframe>\n` +
      `<script>window.addEventListener("message",function(e){var d=e.data;if(${originCheck}d&&d.key==="${this.publicKey}"){` +
      `if(d.type==="jform:height"){var f=document.getElementById("${id}");if(f)f.style.height=(d.height+8)+"px";}` +
      `else if(d.type==="jform:redirect"&&/^https?:/i.test(d.url)){window.location.href=d.url;}}});</script>`
    );
  }
  get statusText() {
    const d = this.definition || {};
    if (d.isActive) return `Live, version ${d.version || 1}`;
    return d.version ? "Unpublished: respondents see the closed message" : "Draft: publish to get a link";
  }
  get statusClass() {
    const d = this.definition || {};
    return `sh-chip${d.isActive ? " sh-chip-live" : d.version ? " sh-chip-closed" : ""}`;
  }
  get tabs() {
    return TABS.map((t) => ({ ...t, cls: `sh-tab${this.tab === t.id ? " sh-tab-active" : ""}`, selected: this.tab === t.id ? "true" : "false" }));
  }
  get isLink() {
    return this.tab === "link";
  }
  get isEmbed() {
    return this.tab === "embed";
  }
  get isQr() {
    return this.tab === "qr";
  }
  get isSite() {
    return this.tab === "site";
  }
  get siteOptions() {
    return (this.sites || []).map((s) => ({ label: `${s.label} (${s.baseUrl})`, value: s.id }));
  }
  get noSites() {
    return !(this.sites || []).length;
  }
  get qrFileName() {
    return `${this.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr`;
  }
  get copiedText() {
    return this.copied ? "Copied" : "Copy";
  }

  // ------------------------------------------------------------ QR
  renderedCallback() {
    if (this.isQr && this.publicUrl && this.qrFor !== this.publicUrl) {
      this.makeQr(this.publicUrl);
    }
  }
  async makeQr(url) {
    this.qrFor = url;
    try {
      if (!this.qrLoaded) {
        await loadScript(this, QRCODE);
        this.qrLoaded = true;
      }
      // eslint-disable-next-line no-undef
      const qr = window.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      this.qrDataUrl = qr.createDataURL(8, 4);
      this.qrSvg = qr.createSvgTag(8, 4);
    } catch (e) {
      this.qrDataUrl = undefined;
    }
  }
  handleDownloadPng() {
    this.download(this.qrDataUrl, `${this.qrFileName}.png`);
  }
  handleDownloadSvg() {
    if (!this.qrSvg) return;
    const blob = new Blob([this.qrSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    this.download(url, `${this.qrFileName}.svg`);
    URL.revokeObjectURL(url);
  }
  download(href, name) {
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  }

  // ------------------------------------------------------------ handlers
  handleTab(event) {
    this.tab = event.currentTarget.dataset.tab;
  }
  async handleCopy(event) {
    const what = event.currentTarget.dataset.copy;
    const text = what === "embed" ? this.embedSnippet : what === "preview" ? this.previewUrl : this.publicUrl;
    try {
      await navigator.clipboard.writeText(text);
      this.copied = what;
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      setTimeout(() => (this.copied = undefined), 1500);
    } catch (e) {
      /* clipboard unavailable: the text is selectable */
    }
  }
  handleSite(event) {
    this.emitChannel({ siteId: event.detail.value });
  }
  handlePath(event) {
    this.emitChannel({ pagePath: event.target.value || DEFAULT_PAGE_PATH });
  }
  emitChannel(patch) {
    const settings = { ...(this.definition?.settings || {}), publish: { ...this.publishSettings, ...patch } };
    this.dispatchEvent(new CustomEvent("channelchange", { detail: { patch: { settings } } }));
  }
  handlePublish() {
    this.dispatchEvent(new CustomEvent("publish"));
  }
  handleClose() {
    this.dispatchEvent(new CustomEvent("close"));
  }
  handleSelectAll(event) {
    event.target.select();
  }
}
