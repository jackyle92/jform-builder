import { LightningElement, api, track } from "lwc";
import { NavigationMixin } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getSummary from "@salesforce/apex/JFormResponsesController.getSummary";
import getSubmissions from "@salesforce/apex/JFormResponsesController.getSubmissions";
import exportCsv from "@salesforce/apex/JFormResponsesController.exportCsv";
import reprocess from "@salesforce/apex/JFormResponsesController.reprocess";
import { dateTime } from "c/jformDates";
import { formatMajor } from "c/jformPayment";

const PAGE_SIZE = 25;
/** Typing pauses this long before the search runs. */
const SEARCH_DEBOUNCE_MS = 350;

/** Responses tab: KPI tiles, choice summaries, paged table, CSV export, reprocess. */
/** Records made by the form's record steps for one response, from Action_Results_JSON__c. */
function parseActionResults(json) {
  if (!json) return [];
  try {
    const list = JSON.parse(json);
    return (Array.isArray(list) ? list : [])
      .filter((r) => r.recordId)
      .map((r, i) => ({ id: `${r.key || i}`, recordId: r.recordId, label: r.objectApiName || "Record", outcome: r.outcome }));
  } catch (e) {
    return [];
  }
}

export default class JformResponsesTab extends NavigationMixin(LightningElement) {
  @api formId;
  @api formName;

  @track summary;
  @track page;
  loading = true;
  error;
  offset = 0;
  statusFilter = "";
  /** Payment forms: "" (paid, or nothing to pay), paid, unpaid or test (JFormResponsesController.getSubmissions). */
  paymentFilter = "";
  /** Payment forms: responses whose payment used a promotion code containing this text. */
  codeFilter = "";
  exporting = false;
  /** Search and filters: they narrow the table and the count; the CSV export ignores them. */
  search = "";
  fromDate = "";
  toDate = "";
  fieldKey = "";
  fieldValue = "";
  searchTimer;

  connectedCallback() {
    this.refresh();
  }

  @api
  async refresh() {
    this.loading = true;
    this.error = undefined;
    try {
      const [summary, page] = await Promise.all([
        getSummary({ formId: this.formId }),
        getSubmissions({
          formId: this.formId,
          pageSize: PAGE_SIZE,
          offset: this.offset,
          maxColumns: 4,
          status: this.statusFilter || null,
          search: this.search.trim() || null,
          fromDate: this.fromDate || null,
          toDate: this.toDate || null,
          fieldKey: this.fieldKey || null,
          fieldValue: this.fieldKey ? this.fieldValue.trim() || null : null,
          payment: this.paymentFilter || null,
          code: this.codeFilter.trim() || null
        })
      ]);
      this.summary = summary;
      this.page = page;
    } catch (e) {
      this.error = this.messageOf(e);
    } finally {
      this.loading = false;
    }
  }

  // ------------------------------------------------------------ derived
  get hasResponses() {
    return (this.summary?.total || 0) + (this.summary?.spam || 0) > 0;
  }
  get tiles() {
    const s = this.summary || {};
    return [
      { id: "total", value: s.total ?? 0, label: "Responses" },
      { id: "week", value: s.last7Days ?? 0, label: "Last 7 days" },
      { id: "records", value: s.withTargetRecord ?? 0, label: "Records created or updated" },
      { id: "errors", value: s.errors ?? 0, label: "Errors to review", cls: s.errors ? "rt-tile rt-tile-warn" : "rt-tile" },
      { id: "spam", value: s.spam ?? 0, label: "Flagged as spam", cls: "rt-tile rt-tile-muted" },
      ...(s.payments ? this.paymentTiles : [])
    ].map((t) => ({ ...t, cls: t.cls || "rt-tile" }));
  }
  /** Paid and unpaid responses, and live money collected net of refunds; test payments never count as money. */
  get paymentTiles() {
    const s = this.summary || {};
    const collected = (s.collected || []).map((t) => formatMajor(t.amount, t.currencyCode)).join(" · ");
    return [
      { id: "paid", value: s.paid ?? 0, label: "Paid" },
      { id: "unpaid", value: s.unpaid ?? 0, label: "Unpaid (not counted above)", cls: "rt-tile rt-tile-muted" },
      { id: "collected", value: collected || "—", label: "Collected (live payments)" }
    ];
  }
  get showPayments() {
    return this.summary?.payments === true;
  }
  get paymentOptions() {
    return [
      { label: "Paid or nothing to pay", value: "" },
      { label: "Paid", value: "paid" },
      { label: "Unpaid", value: "unpaid" },
      { label: "Test payments", value: "test" }
    ];
  }
  get choices() {
    return (this.summary?.choices || [])
      .filter((c) => c.counts?.length)
      .map((c) => {
        const total = c.counts.reduce((n, x) => n + x.count, 0) || 1;
        return {
          key: c.fieldKey,
          label: c.label || c.fieldKey,
          rows: c.counts.map((x) => ({
            value: x.value,
            count: x.count,
            pct: Math.round((x.count / total) * 100),
            style: `width:${Math.round((x.count / total) * 100)}%`
          }))
        };
      });
  }
  get hasChoices() {
    return this.choices.length > 0;
  }
  get columns() {
    return (this.page?.columns || []).map((c, i) => ({ id: i, label: c }));
  }
  get rows() {
    return (this.page?.rows || []).map((r) => ({
      id: r.id,
      submittedAt: r.submittedAt,
      submittedText: dateTime(r.submittedAt),
      status: r.status || "New",
      statusClass: `rt-pill rt-pill-${(r.status || "new").toLowerCase()}`,
      targetRecordId: r.targetRecordId,
      hasTarget: Boolean(r.targetRecordId),
      records: parseActionResults(r.actionResults),
      hasRecords: parseActionResults(r.actionResults).length > 0,
      isError: r.status === "Error",
      isSpam: r.status === "Spam",
      statusTitle: r.status === "Spam" ? r.spamReason || "Flagged as spam" : r.errorMessage || "",
      errorMessage: r.errorMessage,
      cells: (r.cells || []).map((c, i) => ({ id: i, value: c || "" })),
      payment: r.paymentStatus
        ? {
            status: r.paymentStatus,
            cls: `rt-pill rt-pill-pay-${r.paymentStatus.toLowerCase().replace(/\s+/g, "-")}`,
            test: r.paymentMode === "Test",
            amount: r.paymentAmount !== null && r.paymentAmount !== undefined ? formatMajor(r.paymentAmount, r.paymentCurrency) : "",
            // Stripe charged another amount than the form priced: the amount is what was charged, the note what was priced
            expected: r.paymentExpected !== null && r.paymentExpected !== undefined ? `priced ${formatMajor(r.paymentExpected, r.paymentExpectedCurrency)}` : "",
            // the promotion code and what it took off, under the amount charged
            code: r.promotionCode
              ? r.discountAmount !== null && r.discountAmount !== undefined
                ? `${r.promotionCode} · −${formatMajor(r.discountAmount, r.paymentCurrency)}`
                : r.promotionCode
              : "",
            url: r.paymentUrl || ""
          }
        : null
    }));
  }
  get total() {
    return this.page?.total || 0;
  }
  get hasFilters() {
    return Boolean(this.search.trim() || this.fromDate || this.toDate || (this.fieldKey && this.fieldValue.trim()));
  }
  get rangeText() {
    if (!this.total) return this.hasFilters ? "No matching responses" : "No responses yet";
    const from = this.offset + 1;
    const to = Math.min(this.offset + PAGE_SIZE, this.total);
    return `${from} to ${to} of ${this.total}${this.hasFilters ? " matching" : ""}`;
  }
  get fieldOptions() {
    return [{ label: "Any field", value: "" }, ...(this.page?.fields || []).map((f) => ({ label: f.label, value: f.key }))];
  }
  get fieldChoices() {
    const f = (this.page?.fields || []).find((x) => x.key === this.fieldKey);
    return (f?.options || []).map((o) => ({ label: o, value: o }));
  }
  get prevDisabled() {
    return this.offset === 0;
  }
  get nextDisabled() {
    return this.offset + PAGE_SIZE >= this.total;
  }
  get statusOptions() {
    return [
      { label: "All statuses", value: "" },
      { label: "Processed", value: "Processed" },
      { label: "Error", value: "Error" },
      { label: "New", value: "New" },
      { label: "Spam", value: "Spam" }
    ];
  }

  // ------------------------------------------------------------ handlers
  handleSearch(event) {
    this.search = event.target.value || "";
    this.refreshFiltered();
  }
  handleDate(event) {
    this[event.target.dataset.prop] = event.target.value || "";
    this.refreshFiltered(0);
  }
  handleFieldKey(event) {
    this.fieldKey = event.detail.value || "";
    this.fieldValue = "";
    if (!this.fieldKey) this.refreshFiltered(0);
  }
  handleFieldValue(event) {
    this.fieldValue = event.detail.value || "";
    this.refreshFiltered(0);
  }
  handleFieldValueTyped(event) {
    this.fieldValue = event.target.value || "";
    this.refreshFiltered();
  }
  handleClearFilters() {
    this.search = "";
    this.fromDate = "";
    this.toDate = "";
    this.fieldKey = "";
    this.fieldValue = "";
    this.refreshFiltered(0);
  }
  /** Filters restart at the first page; typing waits for a pause so each keystroke does not query. */
  refreshFiltered(delay = SEARCH_DEBOUNCE_MS) {
    this.offset = 0;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!delay) {
      this.refresh();
      return;
    }
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.searchTimer = setTimeout(() => this.refresh(), delay);
  }
  disconnectedCallback() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.codeTimer) clearTimeout(this.codeTimer);
  }
  handlePayment(event) {
    this.paymentFilter = event.detail.value || "";
    this.offset = 0;
    this.refresh();
  }
  handleCode(event) {
    this.codeFilter = event.detail.value || "";
    this.offset = 0;
    if (this.codeTimer) clearTimeout(this.codeTimer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.codeTimer = setTimeout(() => this.refresh(), 300);
  }
  /** The payment in Stripe's dashboard opens in a new tab, not the response. */
  handleOpenPayment(event) {
    event.stopPropagation();
  }
  handleStatus(event) {
    this.statusFilter = event.detail.value;
    this.offset = 0;
    this.refresh();
  }
  handlePrev() {
    this.offset = Math.max(0, this.offset - PAGE_SIZE);
    this.refresh();
  }
  handleNext() {
    this.offset += PAGE_SIZE;
    this.refresh();
  }
  handleOpenSubmission(event) {
    this.navigateTo(event.currentTarget.dataset.id);
  }
  handleOpenTarget(event) {
    event.stopPropagation();
    this.navigateTo(event.currentTarget.dataset.id);
  }
  navigateTo(recordId) {
    this[NavigationMixin.Navigate]({ type: "standard__recordPage", attributes: { recordId, actionName: "view" } });
  }
  async handleReprocess(event) {
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    try {
      const r = await reprocess({ submissionId: id });
      this.toast(r.status === "Processed" ? "Reprocessed" : "Still failing", r.status === "Processed" ? "The record was created." : r.errorMessage, r.status === "Processed" ? "success" : "warning");
      this.refresh();
    } catch (e) {
      this.toast("Reprocess failed", this.messageOf(e), "error");
    }
  }
  async handleExport() {
    this.exporting = true;
    try {
      const csv = await exportCsv({ formId: this.formId, includeSpam: this.statusFilter === "Spam", payment: this.paymentFilter || null, code: this.codeFilter.trim() || null });
      // Lightning Web Security permits only a few Blob MIME types (text/plain among them, text/csv not) and no
      // parameters such as charset; the .csv file name below still makes spreadsheets open it. The BOM keeps UTF-8 intact in Excel.
      const blob = new Blob(["\uFEFF" + csv], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(this.formName || "responses").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-responses.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.toast("Export failed", this.messageOf(e), "error");
    } finally {
      this.exporting = false;
    }
  }
  handleRefresh() {
    this.refresh();
  }

  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
  messageOf(e) {
    if (!e) return "Unknown error";
    if (typeof e === "string") return e;
    if (e.body?.message) return e.body.message;
    return e.message || "Unknown error";
  }
}
