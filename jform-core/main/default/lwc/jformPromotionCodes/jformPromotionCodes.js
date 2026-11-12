import { LightningElement, api } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import listPromotionCodes from "@salesforce/apex/JFormWorkspaceController.listPromotionCodes";
import savePromotionCode from "@salesforce/apex/JFormWorkspaceController.savePromotionCode";
import generatePromotionCodes from "@salesforce/apex/JFormWorkspaceController.generatePromotionCodes";
import deletePromotionCode from "@salesforce/apex/JFormWorkspaceController.deletePromotionCode";
import exportPromotionCodes from "@salesforce/apex/JFormWorkspaceController.exportPromotionCodes";
import { formatMajor } from "c/jformPayment";

const DISCOUNT_OPTIONS = [
  { label: "Percent", value: "Percent" },
  { label: "Amount", value: "Amount" }
];

/** The codes a form defines in JForm (Settings › Payments › Promotion codes). */
export default class JformPromotionCodes extends LightningElement {
  @api formId;
  /** The form's currency, for Amount codes. */
  @api currency;

  codes = [];
  loading = true;
  busy = false;
  /** "add" or "generate" while the dialog is open. */
  dialog = null;
  draft = {};
  dialogError = "";
  /** The id of the code whose delete is being confirmed inline. */
  confirmingId = null;
  discountOptions = DISCOUNT_OPTIONS;

  connectedCallback() {
    this.refresh();
  }

  async refresh() {
    if (!this.formId) return;
    try {
      this.codes = (await listPromotionCodes({ formId: this.formId })) || [];
    } catch (e) {
      this.toast("Couldn't load the promotion codes", messageOf(e), "error");
    } finally {
      this.loading = false;
    }
  }

  get rows() {
    return this.codes.map((c) => {
      const state = c.state || "Active";
      return {
        ...c,
        discountText: discountTextOf(c),
        validText: validTextOf(c),
        usesText: c.maxUses ? `${c.uses} / ${c.maxUses}` : `${c.uses}`,
        pauseLabel: c.active ? "Pause" : "Resume",
        stateCls: `pc-state pc-state-${state.toLowerCase().replace(/\s+/g, "-")}`,
        cls: c.active ? "" : "pc-paused",
        confirming: this.confirmingId === c.id
      };
    });
  }
  get isEmpty() {
    return this.codes.length === 0;
  }
  get countText() {
    const n = this.codes.length;
    return n === 0 ? "" : n === 1 ? "1 code" : `${n} codes`;
  }
  get exportDisabled() {
    return this.busy || this.codes.length === 0;
  }
  get isGenerate() {
    return this.dialog === "generate";
  }
  get isPercent() {
    return this.draft.discountType !== "Amount";
  }
  get dialogTitle() {
    return this.isGenerate ? "Generate codes" : "Add code";
  }
  get dialogAction() {
    return this.isGenerate ? "Generate" : "Add";
  }
  get amountLabel() {
    return this.currency ? `Amount off (${this.currency})` : "Amount off";
  }

  openAdd() {
    this.draft = { discountType: "Percent", code: "", note: "" };
    this.dialogError = "";
    this.dialog = "add";
  }
  openGenerate() {
    this.draft = { discountType: "Percent", count: 20, prefix: "", note: "" };
    this.dialogError = "";
    this.dialog = "generate";
  }
  closeDialog() {
    this.dialog = null;
  }
  handleDraft(event) {
    const prop = event.target.dataset.prop;
    const value = event.detail ? event.detail.value : event.target.value;
    this.draft = { ...this.draft, [prop]: value };
    this.dialogError = "";
  }

  async handleSubmit() {
    const d = this.draft;
    const terms = {
      discountType: d.discountType || "Percent",
      percentOff: d.discountType === "Amount" ? null : numberOf(d.percentOff),
      amountOff: d.discountType === "Amount" ? numberOf(d.amountOff) : null,
      validFrom: d.validFrom || null,
      validUntil: d.validUntil || null,
      note: (d.note || "").trim() || null
    };
    if (terms.discountType === "Percent" && !(terms.percentOff > 0)) {
      this.dialogError = "Enter how many percent the code takes off.";
      return;
    }
    if (terms.discountType === "Amount" && !(terms.amountOff > 0)) {
      this.dialogError = "Enter the amount the code takes off.";
      return;
    }
    this.busy = true;
    try {
      if (this.isGenerate) {
        const count = numberOf(d.count);
        if (!(count >= 1 && count <= 500)) {
          this.dialogError = "Generate between 1 and 500 codes at a time.";
          return;
        }
        const made = await generatePromotionCodes({
          formId: this.formId,
          requestJson: JSON.stringify({ ...terms, count, prefix: (d.prefix || "").trim().toUpperCase() })
        });
        this.toast(`${made.length} codes generated`, "Each can be used once. Export the list to share them.", "success");
      } else {
        const code = (d.code || "").trim().toUpperCase();
        if (!code) {
          this.dialogError = "Enter the code.";
          return;
        }
        await savePromotionCode({
          formId: this.formId,
          codeJson: JSON.stringify({ ...terms, code, maxUses: numberOf(d.maxUses) || null, active: true })
        });
        this.toast(`${code} added`, "", "success");
      }
      this.dialog = null;
      await this.refresh();
    } catch (e) {
      this.dialogError = messageOf(e);
    } finally {
      this.busy = false;
    }
  }

  async handleTogglePause(event) {
    const code = this.codes.find((c) => c.id === event.target.dataset.id);
    if (!code) return;
    this.busy = true;
    try {
      await savePromotionCode({ formId: this.formId, codeJson: JSON.stringify({ ...code, active: !code.active }) });
      await this.refresh();
    } catch (e) {
      this.toast("Couldn't update the code", messageOf(e), "error");
    } finally {
      this.busy = false;
    }
  }
  handleAskDelete(event) {
    this.confirmingId = event.target.dataset.id;
  }
  handleKeep() {
    this.confirmingId = null;
  }
  async handleDelete(event) {
    const id = event.target.dataset.id;
    this.busy = true;
    try {
      await deletePromotionCode({ formId: this.formId, codeId: id });
      this.confirmingId = null;
      await this.refresh();
    } catch (e) {
      this.toast("Couldn't delete the code", messageOf(e), "error");
    } finally {
      this.busy = false;
    }
  }

  async handleExport() {
    this.busy = true;
    try {
      const csv = await exportPromotionCodes({ formId: this.formId });
      // Lightning Web Security permits only a few Blob MIME types (text/plain among them, text/csv not);
      // the BOM makes Excel read it as UTF-8. Same approach as the Responses export.
      const blob = new Blob(["\uFEFF" + csv], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "promotion-codes.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.toast("Couldn't export the codes", messageOf(e), "error");
    } finally {
      this.busy = false;
    }
  }

  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}

function discountTextOf(c) {
  if (c.discountType === "Amount") return `−${formatMajor(c.amountOff, c.currencyCode)}`;
  return `${c.percentOff}% off`;
}

function validTextOf(c) {
  const from = c.validFrom ? shortDate(c.validFrom) : "";
  const until = c.validUntil ? shortDate(c.validUntil) : "";
  // each date stays on one line; a narrow table breaks the range after the dash
  if (from && until) return `${from} –\u2002${until}`;
  if (from) return `from ${from}`;
  if (until) return `until ${until}`;
  return "always";
}

function shortDate(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }).replace(/ /g, "\u00a0");
}

function numberOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function messageOf(e) {
  return (e && e.body && e.body.message) || (e && e.message) || String(e);
}
