import { LightningElement, wire } from "lwc";
import { qualify, stateKey, formListPage } from "c/jformNamespace";
import { NavigationMixin, CurrentPageReference } from "lightning/navigation";
import getOverview from "@salesforce/apex/JFormHomeController.getOverview";
import { friendlyDate, dateTime } from "c/jformDates";

/** How long a clicked row stays in its "Opening…" state if the workspace never arrives (a failed navigation). */
const OPENING_TIMEOUT = 10000;

/** JForm home: overview numbers, recent forms, Agentforce prompts and quick actions. */
export default class JformHome extends NavigationMixin(LightningElement) {
  overview;
  loading = true;
  error;
  /** The form whose row was clicked: it shows "Opening…" until the workspace page replaces this one. */
  openingId = null;
  openingTimer;
  /** Another page has been shown since Home last loaded; coming back reloads the overview. */
  awayFromHome = false;

  connectedCallback() {
    this.load();
  }

  disconnectedCallback() {
    this.clearOpening();
  }

  /**
   * Lightning keeps this page alive while the workspace is open, so coming back is not a new mount:
   * the page reference changing back to anything but the workspace puts the clicked row to rest,
   * and coming back to Home reloads the numbers and recent forms (a form may have been made meanwhile).
   */
  @wire(CurrentPageReference)
  wiredPageRef(ref) {
    if (!ref) return;
    const apiName = ref.attributes?.apiName || "";
    if (this.openingId && !apiName.endsWith("JForm_Workspace")) this.clearOpening();
    const onHome = ref.type === "standard__namedPage" && ref.attributes?.pageName === "home";
    if (onHome && this.awayFromHome) this.load(true);
    this.awayFromHome = !onHome;
  }

  clearOpening() {
    if (this.openingTimer) clearTimeout(this.openingTimer);
    this.openingTimer = undefined;
    this.openingId = null;
  }

  /** A quiet load keeps the overview on screen while it refreshes. */
  async load(quiet = false) {
    if (!quiet || !this.overview) this.loading = true;
    this.error = undefined;
    try {
      this.overview = await getOverview({ recentLimit: 8 });
    } catch (e) {
      this.error = (e && e.body && e.body.message) || (e && e.message) || "The overview could not be loaded.";
    } finally {
      this.loading = false;
    }
  }

  get stats() {
    const o = this.overview || {};
    return [
      { key: "forms", label: "Forms", value: o.formCount ?? "–", hint: o.liveCount !== undefined ? `${o.liveCount} live` : "" },
      { key: "responses", label: "Responses", value: o.responsesTotal ?? "–", hint: o.spamCount ? `all time, ${o.spamCount} spam filtered` : "all time" },
      { key: "week", label: "Last 7 days", value: o.responses7Days ?? "–", hint: "responses" },
      { key: "errors", label: "To review", value: o.errorCount ?? "–", hint: o.errorCount ? "responses with errors" : "no errors", warn: Boolean(o.errorCount) }
    ].map((s) => ({ ...s, cls: `stat${s.warn ? " stat-warn" : ""}` }));
  }
  get recent() {
    return (this.overview?.recent || []).map((f) => {
      const live = f.isActive;
      const closed = !live && f.status === "Inactive";
      const responses = f.responseCount || 0;
      const week = f.responses7Days || 0;
      const opening = f.id === this.openingId;
      return {
        ...f,
        opening,
        // while one row opens, the others wait: a second click must not start another navigation
        disabled: Boolean(this.openingId),
        rowClass: `form-row${opening ? " form-row-opening" : this.openingId ? " form-row-waiting" : ""}`,
        statusLabel: live ? `Live v${f.version || 1}` : closed ? "Closed" : "Draft",
        statusClass: `pill${live ? " pill-live" : closed ? " pill-closed" : ""}`,
        lastModifiedText: friendlyDate(f.lastModified),
        lastModifiedFull: dateTime(f.lastModified),
        responseText: responses === 0 ? "No responses" : `${responses} response${responses === 1 ? "" : "s"}${week ? `, ${week} this week` : ""}`
      };
    });
  }
  /** Before the first form, the four tiles would all say 0: a "create your first form" panel takes their place. */
  get hasAnyForm() {
    return !this.overview || (this.overview.formCount || 0) > 0;
  }
  get hasForms() {
    return this.recent.length > 0;
  }
  /** While setup is unfinished, Open Setup is the one filled button; New form steps back until then. */
  get newFormVariant() {
    return this.setupPending ? "neutral" : "brand";
  }
  get setupPending() {
    const o = this.overview;
    return Boolean(o && o.setupTotal && o.setupDone !== null && o.setupDone !== undefined && o.setupDone < o.setupTotal);
  }
  get setupText() {
    const o = this.overview || {};
    return `${o.setupDone} of ${o.setupTotal} steps done. A public site and guest access are needed before respondents can open a form.`;
  }
  handleOpenSetup() {
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Setup") } });
  }
  get agentInstalled() {
    return this.overview?.agentInstalled === true;
  }
  get emptyHint() {
    return this.agentInstalled ? "Create your first form, or ask Agentforce to build one from a description." : "Create your first form with New form.";
  }
  get latestFormName() {
    return this.recent.length ? this.recent[0].name : undefined;
  }

  handleNewForm() {
    this.goToWorkspace({ [stateKey("action")]: "new" });
  }
  /** "All forms": the Forms list view. The workspace only opens one form. */
  handleAllForms() {
    this[NavigationMixin.Navigate](formListPage());
  }
  /**
   * The workspace page takes a moment to arrive the first time (Lightning fetches its components before
   * anything of it shows), so the clicked row answers at once and stays that way until the page swaps.
   */
  handleOpenForm(event) {
    if (this.openingId) return;
    const id = event.currentTarget.dataset.id;
    this.openingId = id;
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.openingTimer = setTimeout(() => this.clearOpening(), OPENING_TIMEOUT);
    this.goToWorkspace({ [stateKey("formid")]: id });
  }
  handleRefresh() {
    this.load();
  }
  goToWorkspace(state) {
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Workspace") }, state });
  }
}
