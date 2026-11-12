import { LightningElement, track, wire } from "lwc";
import { NavigationMixin, CurrentPageReference } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { subscribe as subscribeToEvents, unsubscribe as unsubscribeFromEvents, onError as onEventError, isEmpEnabled } from "lightning/empApi";
import getDefinition from "@salesforce/apex/JFormWorkspaceController.getDefinition";
import saveDefinition from "@salesforce/apex/JFormWorkspaceController.saveDefinition";
import publishForm from "@salesforce/apex/JFormWorkspaceController.publish";
import unpublishForm from "@salesforce/apex/JFormWorkspaceController.unpublish";
import createForm from "@salesforce/apex/JFormWorkspaceController.createForm";
import describeForm from "@salesforce/apex/JFormWorkspaceController.describeForm";
import createDescribedForm from "@salesforce/apex/JFormWorkspaceController.createDescribedForm";
import getGenerationStatus from "@salesforce/apex/JFormWorkspaceController.getGenerationStatus";
import getTargetObjects from "@salesforce/apex/JFormWorkspaceController.getTargetObjects";
import getObjectFields from "@salesforce/apex/JFormWorkspaceController.getObjectFields";
import { convertLegacyInPlace, mainStepOf, dropFieldReferences, dropRetypedEmailField, suggestObjectField, renameFieldReferences, withAddressMappings } from "c/jformAutomationPresets";
import getSites from "@salesforce/apex/JFormWorkspaceController.getSites";
import getPaymentStatus from "@salesforce/apex/JFormWorkspaceController.getPaymentStatus";
import LOADER_IMAGE from "@salesforce/resourceUrl/jformLoadingAvatar";
import { FormStore, clone, allKeys, keyFromLabel } from "c/jformStore";
import { loadPanelPrefs, savePanelPrefs, clampWidth, panelStyle, startPanelDrag, keyAction, PANEL_LIMITS } from "c/jformPanelResize";
import { defaultsFor, needsOptions, collectsAnswer, tableRows, isSingle, getType, isName, isAddress, answerFieldsOf } from "c/jformFieldRegistry";
import { qualify, stateKey, readState, formListPage } from "c/jformNamespace";
import { loadAddressLists, hasAddressField } from "c/jformAddressLists";
import { publicUrlOf, previewUrlOf } from "c/jformLinks";
import { paymentBlock, paymentSettings } from "c/jformPayment";

const AUTOSAVE_MS = 1500;
/** Platform event published by every save, publish and unpublish (JFormChangeEvents). */
const CHANGE_CHANNEL = `/event/${qualify("Form_Changed__e")}`;
/** Event field names, namespaced in the package. */
const EVENT_FIELDS = { formId: qualify("Form_Id__c"), revision: qualify("Revision__c"), change: qualify("Change__c"), clientId: qualify("Client_Id__c") };
/** Prefix the controller puts on a refused stale save. */
const CONFLICT_PREFIX = "CONFLICT: ";

/** A name for this tab: its own change events are ignored, everyone else's reload the form. */
function newClientId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (e) {
    /* fall through */
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const FULLSCREEN_KEY = "jform.workspace.fullscreen";
/** Below this window width the panels stack and the page scrolls normally (phones). */
const CONTAINED_MIN_WIDTH = 600;
/** Below this width (and above CONTAINED_MIN_WIDTH) the properties open as a drawer over the canvas and the header folds its icon buttons into a menu. */
const COMPACT_MAX_WIDTH = 1100;
const CONTAINED_MIN_HEIGHT = 480;
const TABS = [
  { id: "build", label: "Build" },
  { id: "logic", label: "Logic" },
  { id: "automate", label: "Automate" },
  { id: "design", label: "Design & preview" },
  { id: "settings", label: "Settings" },
  { id: "responses", label: "Responses" }
];

const EDITOR_TAGS = new Set(["input", "textarea", "select"]);
/** Base components whose editable element sits behind their own shadow root, where composedPath() cannot see it. */
const EDITOR_HOSTS = /^lightning-(input|textarea|combobox|dual-listbox|record-picker|select)/;
/**
 * Whether a key press came from something the user types into. Inside an editor Cmd+Z
 * belongs to that editor (the rich text editor keeps its own history); the workspace
 * only undoes form edits when the key was pressed elsewhere.
 */
function keyFromEditor(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  return path.some((node) => {
    const tag = (node?.tagName || "").toLowerCase();
    return EDITOR_TAGS.has(tag) || node?.isContentEditable === true || EDITOR_HOSTS.test(tag);
  });
}

/**
 * The form workspace: header, tabs, autosave, undo and redo, and the glue
 * between the canvas, palette, properties, logic and design panels.
 */
export default class JformWorkspace extends NavigationMixin(LightningElement) {
  formId;
  store;
  @track definition;
  @track selection = { kind: null };
  targetObjects = [];
  sites = [];
  showShare = false;
  fullscreen = false;
  /** Height that fits the workspace in the visible window, so only the panels scroll. */
  availableHeight = null;
  /** The Lightning tab's padding the builder fills, [top, right, bottom, left], or null. */
  bleed = null;
  measured = false;
  activeTab = "build";
  /** { kind, key, at } for the Logic tab to open when the field panel asks for it. */
  logicFocus = null;
  /** The Settings tab's section to open first, when another tab sends the builder there. */
  settingsSection = null;
  saveState = "saved"; // saved | dirty | saving | error
  /** Side panel widths and collapsed state, remembered per browser: { palette: {width, collapsed}, props: {...} }. */
  panelPrefs = {};
  draggingPanel = null;
  saveError;
  loading = false;
  /** False until the page state arrives, so a tab opened for a form shows the loader meanwhile. */
  pageRead = false;
  loaderImage = LOADER_IMAGE;
  loadError;
  showPublish = false;
  publishNote = "";
  paymentOrg;
  publishing = false;
  publishResult;
  showNewForm = false;
  newFormName = "";
  newFormObject = "";
  creating = false;
  /** New form dialog: "blank" (today's path) or "describe" (pages and fields drafted from a description). */
  newFormMode = "blank";
  newFormDescription = "";
  describing = false;
  describeError = "";
  /** The previewed draft from describeForm; nothing is saved until "Create form". */
  draft = null;
  /** Whether forms can be described (JFormGenerationService), read when the New form dialog first opens. */
  generationStatus;
  saveTimer;
  savePending = false;
  /** The save request in flight, if any. */
  saving = null;
  unsubscribe;
  /** Live updates: this tab's id, the event subscription, and a change made elsewhere that waits for a decision. */
  clientId = newClientId();
  eventSubscription;
  @track externalChange = null; // { revision, by, change }
  /** Object fields per object (promises), for mapping answers by label. */
  objectFieldsCache = new Map();
  /** Window width, for the compact layout (drawer and header menu). */
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  /** The selection whose properties drawer the user closed; any other selection opens it again. */
  drawerDismissed = null;

  @wire(CurrentPageReference)
  wiredPageRef(ref) {
    const state = ref?.state || {};
    this.pageRead = true;
    const id = readState(state, "formid") || state.c__formId || state.formId;
    // Home's "New form" button: open the dialog whatever is on screen, even a form left open in this tab
    const wantsNew = !id && readState(state, "action") === "new";
    if (id && id !== this.formId) {
      this.openForm(id);
    } else if (!id && !this.formId && !wantsNew && !this.showNewForm) {
      // the workspace edits one form; with none to open, the forms are in the Forms list view
      this.goToFormList(true);
    }
    if (wantsNew) {
      this.resetNewForm();
      this.readGenerationStatus();
      this.showNewForm = true;
      this.clearNewAction();
    }
  }
  /**
   * Take "action=new" out of the address once the dialog is open. Lightning keeps this tab alive,
   * so the next "New form" click must arrive as a changed page state to reach wiredPageRef again.
   */
  clearNewAction() {
    const state = this.formId ? { [stateKey("formid")]: this.formId } : {};
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Workspace") }, state }, true);
  }

  connectedCallback() {
    try {
      this.fullscreen = window.localStorage.getItem(FULLSCREEN_KEY) === "1";
    } catch (e) {
      this.fullscreen = false;
    }
    this.panelPrefs = loadPanelPrefs();
    this.onWindowResize = () => {
      this.viewportWidth = window.innerWidth;
      this.measure();
    };
    window.addEventListener("resize", this.onWindowResize);
    this.listenForChanges();
  }

  // ------------------------------------------------------------ read on first use
  // Opening a form reads only its definition; what a few parts of the builder need is read when one first shows.
  /** The objects a form can feed: Automate, the New form dialog, and a field's "Saves to" while no record step fixes the object. */
  readTargetObjects() {
    if (this.targetObjectsRead) return;
    this.targetObjectsRead = true;
    getTargetObjects()
      .then((r) => (this.targetObjects = r || []))
      .catch(() => (this.targetObjects = []));
  }
  get needsTargetObjects() {
    if (this.isAutomate || this.showNewForm) return true;
    return this.isBuild && this.selection?.kind === "field" && !mainStepOf(this.definition?.settings?.automation?.steps);
  }
  /** The org's sites, for the Share dialog and the public link after publishing. */
  readSites() {
    if (this.sitesRead) return;
    this.sitesRead = true;
    getSites()
      .then((r) => (this.sites = r || []))
      .catch(() => (this.sites = []));
  }
  readGenerationStatus() {
    if (this.generationStatus) return;
    getGenerationStatus()
      .then((r) => (this.generationStatus = r || {}))
      .catch(() => (this.generationStatus = {}));
  }

  disconnectedCallback() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.onWindowResize) window.removeEventListener("resize", this.onWindowResize);
    if (this.eventSubscription) {
      unsubscribeFromEvents(this.eventSubscription, () => undefined);
      this.eventSubscription = undefined;
    }
  }

  // ------------------------------------------------------------ live updates
  /** Subscribe to form change events; when the streaming API is unavailable the tab still learns of conflicts on save. */
  listenForChanges() {
    Promise.resolve(isEmpEnabled())
      .then((enabled) => {
        if (enabled === false) return undefined;
        onEventError(() => undefined);
        return subscribeToEvents(CHANGE_CHANNEL, -1, (message) => this.handleChangeEvent(message));
      })
      .then((subscription) => {
        if (subscription) this.eventSubscription = subscription;
      })
      .catch(() => undefined);
  }
  handleChangeEvent(message) {
    const payload = message?.data?.payload || {};
    if (!this.formId || payload[EVENT_FIELDS.formId] !== this.formId) return;
    if (payload[EVENT_FIELDS.clientId] && payload[EVENT_FIELDS.clientId] === this.clientId) return;
    const change = { revision: payload[EVENT_FIELDS.revision], by: payload[EVENT_FIELDS.clientId] ? "Another tab" : "Agentforce", change: payload[EVENT_FIELDS.change] };
    if (this.store && (this.store.dirty || this.saving || this.saveState === "error")) {
      this.externalChange = change;
      return;
    }
    this.saveState = "updating";
    this.reloadFromServer().then((ok) => {
      if (ok) this.toast("Updated", `${change.by} ${change.change === "published" ? "published" : change.change === "unpublished" ? "unpublished" : "updated"} this form. You are looking at the latest version.`, "success");
    });
  }
  /** Take the server's copy of the open form; history is kept, the selection too when its field still exists. */
  async reloadFromServer({ resetHistory = false } = {}) {
    const formId = this.formId;
    try {
      const json = await getDefinition({ formId });
      if (formId !== this.formId || !this.store) return false;
      const def = JSON.parse(json);
      const selectedKey = this.selection?.kind === "field" ? this.selectedFieldKey() : null;
      this.store.replace(def, { markSaved: true, resetHistory });
      this.definition = this.store.state;
      this.saveState = "saved";
      this.saveError = undefined;
      this.externalChange = null;
      if (selectedKey && !allKeys(def).has(selectedKey)) this.selection = { kind: null };
      return true;
    } catch (e) {
      if (this.saveState === "updating") this.saveState = this.store?.dirty ? "dirty" : "saved";
      this.toast("Could not reload the form", this.messageOf(e), "error");
      return false;
    }
  }
  selectedFieldKey() {
    const s = this.selection || {};
    return this.definition?.sections?.[s.sectionIndex]?.fields?.[s.fieldIndex]?.key || null;
  }
  get externalChangeText() {
    if (!this.externalChange) return "";
    const what = this.externalChange.change === "published" ? "published" : this.externalChange.change === "unpublished" ? "unpublished" : "updated";
    return `${this.externalChange.by} ${what} this form while you have unsaved edits.`;
  }
  handleReloadExternal() {
    this.reloadFromServer({ resetHistory: true });
  }
  /** Keep this tab's edits: adopt the newer revision so the next save is accepted, and save now. */
  handleKeepMine() {
    if (!this.store) return;
    const revision = this.externalChange?.revision;
    this.externalChange = null;
    if (revision !== undefined && revision !== null) this.store.replace({ ...this.store.state, revision }, { markSaved: false });
    this.definition = this.store.state;
    this.saveState = "dirty";
    this.save();
  }

  renderedCallback() {
    if (this.hasForm && !this.measured) {
      this.measured = true;
      this.measure();
    } else if (!this.hasForm) {
      this.measured = false;
    }
    if (!this.targetObjectsRead && this.needsTargetObjects) this.readTargetObjects();
  }

  /**
   * Size the workspace to the space between its top edge and the bottom of the
   * window, so the page itself does not scroll and each panel (palette, canvas,
   * properties, design preview and settings) scrolls on its own.
   */
  measure() {
    const el = this.template.querySelector(".ws");
    if (!el || this.fullscreen) return;
    const bleed = this.tabPadding();
    if (String(bleed) !== String(this.bleed)) this.bleed = bleed;
    if (window.innerWidth < CONTAINED_MIN_WIDTH) {
      this.availableHeight = null;
      return;
    }
    // the host stays put when the workspace bleeds (it is its own formatting context), so measure from it
    const top = this.template.host.getBoundingClientRect().top + (window.scrollY || 0) - (bleed ? bleed[0] : 0);
    const height = Math.max(CONTAINED_MIN_HEIGHT, Math.floor(window.innerHeight - top - (bleed ? 0 : 12)));
    if (height !== this.availableHeight) this.availableHeight = height;
  }

  /**
   * A Lightning tab puts its component in a padded container (slds-template_default: 12 or 16 px,
   * depending on the org's theme), a few wrappers up. Its padding as [top, right, bottom, left], so the
   * builder can fill it and meet the navigation bar and the window edges. Only through wrappers the
   * builder fills on its own; null anywhere else, such as beside other components on an App Page.
   */
  tabPadding() {
    try {
      const host = this.template.host;
      const box = host.getBoundingClientRect();
      let node = host.parentElement;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        if (node.classList.contains("slds-template_default")) {
          const style = window.getComputedStyle(node);
          const padding = ["Top", "Right", "Bottom", "Left"].map((side) => parseFloat(style[`padding${side}`]) || 0);
          return padding.some((p) => p > 0) ? padding : null;
        }
        const wrapper = node.getBoundingClientRect();
        if (Math.abs(wrapper.left - box.left) > 1 || Math.abs(wrapper.width - box.width) > 1) return null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------ loading
  async openForm(id) {
    this.loading = true;
    this.loadError = undefined;
    try {
      const json = await getDefinition({ formId: id });
      this.adopt(JSON.parse(json));
      this.formId = id;
    } catch (e) {
      this.loadError = this.messageOf(e);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Back to the Forms list view. Edits are saved first; a form whose edits can't be saved stays open,
   * so nothing is lost.
   */
  async closeForm() {
    const formId = this.formId;
    await this.flushSave().catch(() => undefined); // a failed save is checked below: the form stays dirty or in conflict
    if (formId !== this.formId) return;
    if (this.externalChange || this.store?.dirty || this.saveState === "error" || this.saveState === "conflict") {
      this.toast("Your changes aren't saved", "The form stays open so you can save or reload it first.", "error");
      return;
    }
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = undefined;
    this.store = undefined;
    this.definition = undefined;
    this.formId = undefined;
    this.selection = { kind: null };
    this.activeTab = "build";
    this.logicFocus = null;
    this.settingsSection = null;
    this.drawerDismissed = null;
    this.saveState = "saved";
    this.saveError = undefined;
    this.externalChange = null;
    this.loadError = undefined;
    this.goToFormList();
  }
  goToFormList(replace = false) {
    this[NavigationMixin.Navigate](formListPage(), replace);
  }

  adopt(definition) {
    if (hasAddressField(definition)) this.readAddressLists();
    if (this.unsubscribe) this.unsubscribe();
    // a pending autosave belongs to the form being left; its in-flight request is ignored when it returns
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.savePending = false;
    this.store = new FormStore(definition);
    this.definition = this.store.state;
    this.selection = { kind: null };
    this.saveState = "saved";
    this.externalChange = null;
    this.unsubscribe = this.store.subscribe((state, reason) => {
      this.definition = state;
      // an Address field added, retyped, brought back by undo or by another tab's change
      if (!this.addressLists && hasAddressField(state)) this.readAddressLists();
      if (reason === "edit" || reason === "undo" || reason === "redo") {
        this.saveState = "dirty";
        this.scheduleSave();
      }
    });
    // Steps are the single model: a form saved with the old single target gets its step now.
    // The store's saved snapshot is the legacy shape, so the conversion counts as a change and autosaves;
    // it replaces the state rather than committing, so it is not an undo entry.
    const converted = clone(definition);
    if (convertLegacyInPlace(converted)) {
      this.store.replace(converted, { resetHistory: true });
      this.saveState = "dirty";
      this.scheduleSave();
    }
  }
  /** "Saves to" on a field: map the answer onto the main record step, creating the step on first use. */
  handleMappingChange(event) {
    const { fieldKey, object, objectField } = event.detail;
    // several at once: a Name field's parts, [{ fieldKey, objectField }]
    const mappings = event.detail.mappings || [{ fieldKey, objectField }];
    this.commit((d) => {
      d.settings = d.settings || {};
      d.settings.automation = d.settings.automation || { steps: [] };
      const steps = d.settings.automation.steps || (d.settings.automation.steps = []);
      let main = mainStepOf(steps);
      if (!main) {
        if (!object) return;
        main = { key: "record", label: `Create the ${object}`, action: "create", object, primary: true, fields: [] };
        steps.push(main);
      }
      for (const m of mappings) {
        main.fields = (main.fields || []).filter((x) => !(x.source?.type === "field" && x.source.key === m.fieldKey) && (!m.objectField || String(x.field).toLowerCase() !== String(m.objectField).toLowerCase()));
        if (m.objectField) main.fields.push({ field: m.objectField, source: { type: "field", key: m.fieldKey } });
      }
      d.targetObjectApiName = main.object;
    });
  }

  // ------------------------------------------------------------ autosave
  scheduleSave() {
    if (this.externalChange) return; // nothing is written over someone else's change until the user decides
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.saveTimer = setTimeout(() => this.save(), AUTOSAVE_MS);
  }

  save() {
    if (this.externalChange) return Promise.resolve(); // a timer armed before the change arrived must not write either
    if (!this.store || !this.store.dirty) {
      if (this.saveState === "dirty") this.saveState = "saved";
      return Promise.resolve();
    }
    if (this.saving) {
      this.savePending = true;
      return this.saving;
    }
    this.saving = this.sendSave(this.store).finally(() => {
      this.saving = null;
      if (this.savePending) {
        this.savePending = false;
        this.scheduleSave();
      }
    });
    return this.saving;
  }

  /** Save one store's state. If another form was opened meanwhile, the response is dropped: it belongs to the old store. */
  async sendSave(store) {
    this.saveState = "saving";
    const sent = store.state;
    try {
      const saved = JSON.parse(await saveDefinition({ definitionJson: JSON.stringify(sent), clientId: this.clientId }));
      if (store !== this.store) return;
      store.markSaved(saved, sent);
      this.definition = store.state;
      this.saveState = store.dirty ? "dirty" : "saved";
      this.saveError = undefined;
    } catch (e) {
      if (store !== this.store) return;
      const message = this.messageOf(e);
      if (message.startsWith(CONFLICT_PREFIX)) {
        // someone saved first; the change event may not have arrived (or the streaming API is off)
        this.saveState = "conflict";
        this.saveError = message.slice(CONFLICT_PREFIX.length);
        if (!this.externalChange) this.externalChange = { revision: undefined, by: "Someone else", change: "changed" };
        this.fetchLatestRevision();
        return;
      }
      this.saveState = "error";
      this.saveError = message;
    }
  }

  /** After a refused save: learn the current revision so "Keep mine" can overwrite deliberately. */
  async fetchLatestRevision() {
    const formId = this.formId;
    try {
      const latest = JSON.parse(await getDefinition({ formId }));
      if (formId !== this.formId || !this.externalChange) return;
      this.externalChange = { ...this.externalChange, revision: latest.revision };
    } catch (e) {
      /* the banner still offers Reload */
    }
  }

  /** Everything saved before publishing: wait for the save in flight, then save whatever changed since. */
  async flushSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.saving) await this.saving;
    await this.save();
    if (this.saveState === "error" || this.saveState === "conflict") throw new Error(this.saveError);
  }

  // ------------------------------------------------------------ derived
  get hasForm() {
    return Boolean(this.definition) && !this.loading;
  }
  /** A form that could not be opened: its error, and the way back to the forms. */
  get showLoadError() {
    return Boolean(this.loadError) && !this.definition && !this.showLoader;
  }
  get showLoader() {
    return this.loading || !this.pageRead;
  }
  get loaderText() {
    return this.loading ? "Opening your form…" : "Loading…";
  }
  get tabs() {
    const rules = this.ruleCount;
    return TABS.map((t) => ({
      ...t,
      cls: `ws-tab${this.activeTab === t.id ? " ws-tab-active" : ""}`,
      badge: t.id === "logic" && rules ? String(rules) : t.id === "automate" && this.stepCount ? String(this.stepCount) : null,
      selected: this.activeTab === t.id ? "true" : "false"
    }));
  }
  get ruleCount() {
    let n = 0;
    for (const s of this.definition?.sections || []) {
      if (s.conditionalLogic) n++;
      for (const f of s.fields || []) if (f.conditionalLogic) n++;
    }
    return n;
  }
  get isBuild() {
    return this.activeTab === "build";
  }
  get stepCount() {
    return (this.definition?.settings?.automation?.steps || []).length;
  }
  get isAutomate() {
    return this.activeTab === "automate";
  }
  get isLogic() {
    return this.activeTab === "logic";
  }
  get isDesign() {
    return this.activeTab === "design";
  }
  get isSettings() {
    return this.activeTab === "settings";
  }
  get isResponses() {
    return this.activeTab === "responses";
  }
  get isContained() {
    return this.fullscreen || (this.hasForm && this.availableHeight !== null);
  }
  get rootClass() {
    return `ws${this.isContained ? " ws-contained" : ""}${this.isCompact ? " ws-compact" : ""}${this.fullscreen ? " ws-fullscreen" : ""}${this.draggingPanel ? " ws-dragging" : ""}`;
  }
  /** Mid-size windows (a laptop with a side panel open): properties as a drawer, header icons in a menu. */
  get isCompact() {
    return this.viewportWidth >= CONTAINED_MIN_WIDTH && this.viewportWidth < COMPACT_MAX_WIDTH;
  }
  get showUnpublishButton() {
    return !this.isCompact;
  }
  get selectionSignature() {
    const s = this.selection || {};
    return s.kind ? `${s.kind}:${s.sectionIndex}:${s.fieldIndex}` : null;
  }
  /** Wide: the properties panel unless hidden. Compact: a drawer shown while something is selected, until closed. */
  get propsVisible() {
    if (!this.isCompact) return this.propsOpen;
    const sig = this.selectionSignature;
    return Boolean(sig) && this.drawerDismissed !== sig;
  }
  handleCloseDrawer() {
    this.drawerDismissed = this.selectionSignature;
  }
  handleHeaderMenu(event) {
    switch (event.detail.value) {
      case "undo":
        this.handleUndo();
        break;
      case "redo":
        this.handleRedo();
        break;
      case "fullscreen":
        this.handleToggleFullscreen();
        break;
      case "unpublish":
        this.handleUnpublish();
        break;
      default:
    }
  }

  // ------------------------------------------------------------ side panels
  panelPref(panel) {
    return this.panelPrefs[panel] || {};
  }
  setPanel(panel, patch) {
    this.panelPrefs = { ...this.panelPrefs, [panel]: { ...this.panelPref(panel), ...patch } };
    savePanelPrefs(this.panelPrefs);
  }
  get paletteOpen() {
    return !this.panelPref("palette").collapsed;
  }
  get propsOpen() {
    return !this.panelPref("props").collapsed;
  }
  /** The palette stays in the page when hidden, so hiding and showing it can animate. */
  get paletteClass() {
    return `ws-palette${this.paletteOpen ? "" : " ws-panel-closed"}`;
  }
  /** Side by side the properties panel stays in the page and animates like the palette; compact screens open it as a drawer only when needed. */
  get propsRendered() {
    return this.isCompact ? this.propsVisible : true;
  }
  get propsClass() {
    return `ws-props${!this.isCompact && !this.propsOpen ? " ws-panel-closed" : ""}`;
  }
  get paletteStyle() {
    return panelStyle(this.panelPref("palette").width);
  }
  get propsStyle() {
    return panelStyle(this.panelPref("props").width);
  }
  get paletteResizerClass() {
    return `ws-resizer ws-resizer-left${this.paletteOpen ? "" : " ws-resizer-collapsed"}`;
  }
  get propsResizerClass() {
    return `ws-resizer ws-resizer-right${this.propsOpen ? "" : " ws-resizer-collapsed"}`;
  }
  get paletteToggleIcon() {
    return this.paletteOpen ? "utility:chevronleft" : "utility:chevronright";
  }
  get propsToggleIcon() {
    return this.propsOpen ? "utility:chevronright" : "utility:chevronleft";
  }
  get paletteToggleTitle() {
    return this.paletteOpen ? "Hide the field palette" : "Show the field palette";
  }
  get propsToggleTitle() {
    return this.propsOpen ? "Hide the properties panel" : "Show the properties panel";
  }
  /** The panel's current width: the remembered one, else as rendered, else its minimum (nothing rendered yet). */
  panelWidth(panel) {
    const el = this.template.querySelector(`.ws-${panel}`);
    const measured = el ? Math.round(el.getBoundingClientRect().width) : 0;
    return this.panelPref(panel).width || measured || PANEL_LIMITS[panel].min;
  }
  handlePanelDrag(event) {
    const panel = event.currentTarget.dataset.panel;
    if (event.button !== 0 || this.panelPref(panel).collapsed) return;
    this.draggingPanel = panel;
    startPanelDrag(event, {
      panel,
      width: this.panelWidth(panel),
      side: panel === "palette" ? "left" : "right",
      onResize: (width) => this.setPanel(panel, { width }),
      onEnd: () => {
        this.draggingPanel = null;
      }
    });
  }
  handlePanelReset(event) {
    this.setPanel(event.currentTarget.dataset.panel, { width: undefined });
  }
  handlePanelToggle(event) {
    event.stopPropagation();
    const panel = event.currentTarget.dataset.panel;
    this.setPanel(panel, { collapsed: !this.panelPref(panel).collapsed });
  }
  handlePanelKey(event) {
    const panel = event.currentTarget.dataset.panel;
    const action = keyAction(event, panel === "palette" ? "left" : "right");
    if (!action) return;
    event.preventDefault();
    if (action.type === "toggle") this.setPanel(panel, { collapsed: !this.panelPref(panel).collapsed });
    else if (action.type === "reset") this.setPanel(panel, { width: undefined });
    else if (!this.panelPref(panel).collapsed) this.setPanel(panel, { width: clampWidth(panel, this.panelWidth(panel) + action.delta) });
  }
  stopDrag(event) {
    event.stopPropagation(); // the toggle button sits on the handle; a click on it is not a drag
  }
  get rootStyle() {
    if (this.fullscreen || !this.hasForm) return "";
    const parts = [];
    if (this.isContained) parts.push(`height:${this.availableHeight}px`);
    if (this.bleed) parts.push(`margin:${this.bleed.map((p) => `-${p}px`).join(" ")}`);
    return parts.join(";");
  }
  get fullscreenIcon() {
    return this.fullscreen ? "utility:contract_alt" : "utility:expand_alt";
  }
  get fullscreenLabel() {
    return this.fullscreen ? "Exit full screen (Esc)" : "Full screen";
  }
  get anyModalOpen() {
    return this.showPublish || this.showShare || this.showNewForm;
  }
  get statusChipClass() {
    const d = this.definition || {};
    return `ws-chip${d.isActive ? " ws-chip-live" : d.version ? " ws-chip-closed" : ""}`;
  }
  get statusChipText() {
    const d = this.definition || {};
    if (d.isActive) return `Live · v${d.version || 1}`;
    return d.version ? "Closed" : "Draft";
  }
  get saveText() {
    switch (this.saveState) {
      case "saving":
        return "Saving…";
      case "dirty":
        return "Unsaved changes";
      case "error":
        return `Save failed: ${this.saveError}`;
      case "updating":
        return "Updating…";
      case "conflict":
        return "Updated elsewhere";
      default:
        return "Saved";
    }
  }
  get saveClass() {
    return `ws-save ws-save-${this.saveState}`;
  }
  get canUndo() {
    return !this.store?.canUndo;
  }
  get canRedo() {
    return !this.store?.canRedo;
  }
  get isLive() {
    return Boolean(this.definition?.isActive);
  }
  get previewUrl() {
    return previewUrlOf(this.publishResult?.publicKey || this.definition?.publicKey);
  }
  /** The link respondents use, from the form's site settings; empty when the org has no site. */
  get publicUrl() {
    return publicUrlOf(this.definition, this.sites, this.publishResult?.publicKey || this.definition?.publicKey);
  }
  get hasPublicUrl() {
    return Boolean(this.publicUrl);
  }
  /**
   * Whether the draft differs from the live version: unsaved edits, or saves since the last publish
   * (every save bumps the revision; the live version records the revision it was published at).
   */
  get hasUnpublishedChanges() {
    const d = this.definition;
    if (!d?.isActive) return true;
    if (this.store?.dirty || (this.saveState !== "saved" && this.saveState !== "updating")) return true;
    return d.publishedRevision === undefined || d.publishedRevision === null || (d.revision ?? 0) > d.publishedRevision;
  }
  get hasFields() {
    return (this.definition?.sections || []).some((s) => (s.fields || []).length);
  }
  get publishDisabled() {
    return this.publishing || !this.hasFields || (this.isLive && !this.hasUnpublishedChanges);
  }
  get publishTitle() {
    if (!this.hasFields) return "Add a field before publishing";
    if (this.isLive && !this.hasUnpublishedChanges) return `No changes since version ${this.definition?.version || 1}`;
    return "";
  }
  get newFormDisabled() {
    return this.creating || !this.newFormName.trim();
  }

  // ------------------------------------------------------------ new form: describe it
  get describeAvailable() {
    return this.generationStatus?.available === true;
  }
  get isDescribeMode() {
    return this.describeAvailable && this.newFormMode === "describe";
  }
  get isBlankMode() {
    return !this.isDescribeMode;
  }
  get blankModeClass() {
    return `ws-seg-btn${this.isBlankMode ? " ws-seg-on" : ""}`;
  }
  get describeModeClass() {
    return `ws-seg-btn${this.isDescribeMode ? " ws-seg-on" : ""}`;
  }
  get describePlaceholder() {
    return 'Booking form with name, email, preferred date (weekdays only) and a store dropdown with London and Leeds; email required. Second page: how will you get here, and a number plate only when the answer is Driving.';
  }
  get describeDisabled() {
    return this.describing || this.creating || !this.newFormName.trim() || !this.newFormDescription.trim();
  }
  get createDescribedDisabled() {
    return this.describing || this.creating || !this.draft || !this.newFormName.trim();
  }
  get draftSummary() {
    if (!this.draft) return "";
    const pages = this.draft.pages?.length || 0;
    const fields = this.draft.fieldCount || 0;
    return `${pages} ${pages === 1 ? "page" : "pages"}, ${fields} ${fields === 1 ? "field" : "fields"}`;
  }
  /** The draft's pages and fields with keys for the template and a one-line description per field. */
  get draftPages() {
    return (this.draft?.pages || []).map((p, pi) => ({
      key: `p${pi}`,
      name: p.name,
      rule: p.rule,
      fields: (p.fields || []).map((f, fi) => ({
        key: `p${pi}f${fi}`,
        label: f.label,
        rule: f.rule,
        meta: `${f.type}${f.required ? ", required" : ""}${f.options ? `: ${f.options}` : ""}`
      }))
    }));
  }
  handleNewFormMode(event) {
    this.newFormMode = event.currentTarget.dataset.mode;
    this.describeError = "";
  }
  handleNewFormDescription(event) {
    this.newFormDescription = event.target.value;
  }
  async handleDescribe() {
    this.describing = true;
    this.describeError = "";
    try {
      const json = await describeForm({ description: this.newFormDescription.trim(), name: this.newFormName.trim(), targetObjectApiName: this.newFormObject || null });
      this.draft = JSON.parse(json);
    } catch (e) {
      // a stale preview under an error reads as if it were still on offer
      this.draft = null;
      this.describeError = this.messageOf(e);
    } finally {
      this.describing = false;
    }
  }
  async handleCreateDescribed() {
    if (!this.draft) return;
    this.creating = true;
    this.describeError = "";
    try {
      // the name may have been edited after the preview; the preview's definition carries the old one
      const def = JSON.parse(this.draft.definitionJson);
      def.name = this.newFormName.trim();
      def.label = def.name;
      const json = await createDescribedForm({ definitionJson: JSON.stringify(def), targetObjectApiName: this.newFormObject || null, clientId: this.clientId });
      this.openCreated(json);
    } catch (e) {
      this.describeError = this.messageOf(e);
    } finally {
      this.creating = false;
    }
  }
  resetNewForm() {
    this.newFormMode = "blank";
    this.newFormDescription = "";
    this.describeError = "";
    this.describing = false;
    this.draft = null;
  }
  get objectOptions() {
    return (this.targetObjects || []).map((o) => ({ label: o.label, value: String(o.value).toLowerCase() }));
  }

  // ------------------------------------------------------------ header actions
  /** "Forms": the Forms list view; the form closes once its edits are saved. */
  handleBack() {
    this.closeForm();
  }
  handleGoToForms() {
    this.goToFormList();
  }
  handleToggleFullscreen() {
    this.fullscreen = !this.fullscreen;
    if (!this.fullscreen) {
      // re-measure once the fixed overlay is gone and the workspace is back in the page
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      setTimeout(() => this.measure(), 0);
    }
    try {
      window.localStorage.setItem(FULLSCREEN_KEY, this.fullscreen ? "1" : "0");
    } catch (e) {
      /* storage unavailable: the toggle still works for this session */
    }
  }
  handleTab(event) {
    this.activeTab = event.currentTarget.dataset.tab;
    this.logicFocus = null;
    this.settingsSection = null;
  }
  /** From the field panel: open the Logic tab on that field's or page's rule. */
  handleGoToLogic(event) {
    const detail = event?.detail;
    this.logicFocus = detail?.key ? { kind: detail.kind || "field", key: detail.key, at: Date.now() } : null;
    this.activeTab = "logic";
  }
  /** A tab asks to open another one, e.g. Settings > Responses opens Automate. */
  handleGoTab(event) {
    const tab = event.detail?.tab;
    if (TABS.some((t) => t.id === tab)) this.activeTab = tab;
    // the Payment block's properties open the Settings tab on its Payments section
    this.settingsSection = tab === "settings" ? event.detail?.section || null : null;
    // Settings' "Edit the welcome screen" and "Edit the thank-you screen" open that card on the Build tab
    const select = event.detail?.select;
    if (select === "welcome" || select === "ending") {
      this.selection = { kind: select };
      this.drawerDismissed = null;
      this.revealSelection();
    }
  }
  handleUndo() {
    this.store?.undo();
  }
  handleRedo() {
    this.store?.redo();
  }
  handleName(event) {
    const name = event.target.value.trim();
    if (!name) return;
    this.commit((d) => {
      if (d.label === d.name || !d.label) d.label = name;
      d.name = name;
    });
  }
  handleKeydown(event) {
    const inEditor = keyFromEditor(event);
    if (event.key === "Escape" && this.isCompact && this.propsVisible && !this.anyModalOpen) {
      this.handleCloseDrawer();
      return;
    }
    if (event.key === "Escape" && this.fullscreen && !this.anyModalOpen) {
      this.handleToggleFullscreen();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      this.flushSave().catch(() => undefined);
    } else if (event.key.toLowerCase() === "z" && !inEditor) {
      event.preventDefault();
      if (event.shiftKey) this.store?.redo();
      else this.store?.undo();
    }
  }

  // share
  handleOpenShare() {
    this.readSites();
    this.showShare = true;
  }
  handleCloseShare() {
    this.showShare = false;
  }
  handleChannelChange(event) {
    const patch = event.detail.patch;
    this.commit((d) => Object.assign(d, patch));
  }
  handlePublishedShare() {
    this.showPublish = false;
    this.showShare = true;
  }
  handleShareThenPublish() {
    this.showShare = false;
    this.handleOpenPublish();
  }

  // publish
  handleOpenPublish() {
    this.publishResult = undefined;
    this.publishNote = "";
    this.readSites();
    this.showPublish = true;
    if (paymentBlock(this.definition) && !this.paymentOrg) this.readPaymentOrg();
  }
  handleClosePublish() {
    this.showPublish = false;
  }
  /** Whether this org takes test payments only (a sandbox or scratch org), for the publish dialog's payment line. */
  async readPaymentOrg() {
    try {
      this.paymentOrg = await getPaymentStatus();
    } catch (e) {
      /* the line follows what the form is set to */
    }
  }
  /**
   * The publish dialog says which payments this version takes: live ones charge real cards, except in a sandbox or
   * scratch org, which takes test payments whatever the form says (JFormPaymentService.modeOf).
   */
  get publishPayments() {
    if (!paymentBlock(this.definition)) return null;
    if (paymentSettings(this.definition).mode !== "live") {
      return { text: "This version takes test payments. Respondents see a test banner and no money is charged.", cls: "ws-publish-pay" };
    }
    if (this.paymentOrg?.sandbox) {
      return { text: "This version is set to live payments, but this org is a sandbox or scratch org, so it takes test payments: respondents see a test banner and no money is charged.", cls: "ws-publish-pay" };
    }
    return { text: "This version takes live payments. Real cards will be charged.", cls: "ws-publish-pay ws-publish-live" };
  }
  handlePublishNote(event) {
    this.publishNote = event.target.value;
  }
  async handlePublish() {
    this.publishing = true;
    try {
      await this.flushSave();
      const result = await publishForm({ formId: this.formId, note: this.publishNote, clientId: this.clientId });
      this.publishResult = result;
      // the publish bumped the save counter; without it the next autosave would be refused as a stale copy
      const revision = result.revision ?? this.store.state.revision;
      this.store.replace(
        { ...this.store.state, status: "Active", isActive: true, version: result.versionNumber, publicKey: result.publicKey, revision, publishedRevision: revision },
        { markSaved: true }
      );
      this.definition = this.store.state;
      this.toast("Published", `Version ${result.versionNumber} is live.`, "success");
    } catch (e) {
      this.toast("Publish failed", this.messageOf(e), "error");
    } finally {
      this.publishing = false;
    }
  }
  async handleUnpublish() {
    try {
      const result = await unpublishForm({ formId: this.formId, clientId: this.clientId });
      this.store.replace({ ...this.store.state, status: "Inactive", isActive: false, revision: result.revision ?? this.store.state.revision }, { markSaved: true });
      this.definition = this.store.state;
      this.publishResult = undefined;
      this.toast("Unpublished", `The form is closed to respondents (key ${result.publicKey || ""} kept).`, "info");
    } catch (e) {
      this.toast("Unpublish failed", this.messageOf(e), "error");
    }
  }
  handleCopyLink(event) {
    const which = event?.currentTarget?.dataset?.link === "public" ? "public" : "preview";
    const url = which === "public" ? this.publicUrl : this.previewUrl;
    if (navigator.clipboard && url) {
      navigator.clipboard.writeText(url).then(() => this.toast("Copied", which === "public" ? "Public link copied." : "Preview link copied.", "success"));
    }
  }
  handleOpenSetup() {
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Setup") } });
  }

  /** Closing the New form dialog with no form open goes to the forms; there is nothing to edit here. */
  handleCloseNewForm() {
    this.showNewForm = false;
    this.resetNewForm();
    if (!this.formId) this.goToFormList(true);
  }
  handleNewFormName(event) {
    this.newFormName = event.target.value;
  }
  handleNewFormObject(event) {
    this.newFormObject = event.detail.value;
  }
  async handleCreateForm() {
    this.creating = true;
    try {
      const json = await createForm({ name: this.newFormName.trim(), targetObjectApiName: this.newFormObject || null, clientId: this.clientId });
      this.openCreated(json);
    } catch (e) {
      this.toast("Could not create the form", this.messageOf(e), "error");
    } finally {
      this.creating = false;
    }
  }

  /** A freshly created form (blank or described): close the dialog and open it in the workspace. */
  openCreated(json) {
    const def = JSON.parse(json);
    this.showNewForm = false;
    this.resetNewForm();
    this.formId = def.id;
    this.adopt(def);
    this[NavigationMixin.Navigate]({ type: "standard__navItemPage", attributes: { apiName: qualify("JForm_Workspace") }, state: { [stateKey("formid")]: def.id } });
  }

  // ------------------------------------------------------------ canvas events
  handleSelect(event) {
    const next = { ...event.detail };
    const prev = this.selection || {};
    const changed = next.kind !== prev.kind || next.sectionIndex !== prev.sectionIndex || next.fieldIndex !== prev.fieldIndex;
    this.selection = next;
    this.drawerDismissed = null; // selecting (even the same field again) opens the drawer
    if (changed) {
      // show the top of the properties for the newly selected item
      const props = this.template.querySelector(".ws-props");
      if (props) props.scrollTop = 0;
    }
  }
  /** Scroll the canvas so the selected field or page is visible (after an insert, duplicate or new page). */
  revealSelection() {
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    setTimeout(() => {
      const canvas = this.template.querySelector("c-jform-canvas");
      if (canvas) canvas.scrollToSelection();
    }, 0);
  }
  handlePaletteInsert(event) {
    const type = event.detail.type;
    const sel = this.selection;
    const sections = this.definition?.sections || [];
    let si = sections.length - 1;
    let index = (sections[si]?.fields || []).length;
    if (sel.kind === "field") {
      si = sel.sectionIndex;
      index = sel.fieldIndex + 1;
    } else if (sel.kind === "page") {
      si = sel.sectionIndex;
      index = (sections[si]?.fields || []).length;
    }
    this.insertField(si, index, type);
  }
  handleInsert(event) {
    const { sectionIndex, index, type } = event.detail;
    this.insertField(sectionIndex, index, type || "text");
  }
  insertField(si, index, type) {
    if (si < 0) return;
    const existing = isSingle(type) && this.findFieldOfType(type);
    if (existing) {
      this.selection = { kind: "field", sectionIndex: existing.si, fieldIndex: existing.fi };
      this.activeTab = "build";
      this.revealSelection();
      this.toast("One per form", `This form already has a ${getType(type).label} block.`, "info");
      return;
    }
    let key;
    let country;
    this.commit((d) => {
      const field = defaultsFor(type);
      field.key = keyFromLabel(field.label, allKeys(d), type);
      key = field.key;
      if (isAddress(type)) country = this.dropUnlistedCountry(field);
      d.sections[si].fields.splice(index, 0, field);
    });
    if (country) this.checkCountryWhenListed(key, country);
    this.selection = { kind: "field", sectionIndex: si, fieldIndex: index };
    this.activeTab = "build";
    this.revealSelection();
    if (key) this.autoMap(key); // an Email field on a Lead form saves to Lead Email straight away
  }

  // ------------------------------------------------------------ address default country
  /** The org's countries (JFormAddressService.Lists), read once the form has an Address field; null until they arrive. */
  addressLists = null;
  readAddressLists() {
    if (this.readingAddressLists) return;
    this.readingAddressLists = true;
    loadAddressLists().then((lists) => {
      this.readingAddressLists = false; // a failed read is tried again on the next change
      if (lists) this.addressLists = lists;
    });
  }
  /**
   * A new Address field starts in the builder's country, which the org may not list; the server refuses a default it
   * doesn't. Drops it when the lists are here and lack it. Returns the default left to check, or undefined.
   */
  dropUnlistedCountry(field) {
    const code = field.config?.defaultCountry;
    if (!code || !this.addressLists) return code;
    if (!this.listsCountry(code)) delete field.config.defaultCountry;
    return undefined;
  }
  listsCountry(code) {
    return (this.addressLists?.countries || []).some((c) => c.code === code);
  }
  /** Lists that arrive after the field was added: drop its default then, unless the builder changed it meanwhile. */
  checkCountryWhenListed(key, code) {
    if (!code || this.addressLists) return;
    loadAddressLists().then((lists) => {
      if (!lists) return;
      this.addressLists = lists;
      if (this.listsCountry(code)) return;
      this.commit((d) => {
        const field = this.locateField(d, key)?.field;
        if (!field || !isAddress(field.type) || field.config?.defaultCountry !== code) return false;
        delete field.config.defaultCountry;
        return true;
      });
    });
  }

  // ------------------------------------------------------------ keys and mapping from labels
  findFieldOfType(type) {
    const sections = this.definition?.sections || [];
    for (let si = 0; si < sections.length; si++) {
      const fi = (sections[si].fields || []).findIndex((f) => f.type === type);
      if (fi >= 0) return { si, fi };
    }
    return null;
  }
  /** Where a field sits: { si, fi, field }, or null. */
  locateField(definition, key) {
    const sections = definition?.sections || [];
    for (let si = 0; si < sections.length; si++) {
      const fields = sections[si].fields || [];
      for (let fi = 0; fi < fields.length; fi++) if (fields[fi].key === key) return { si, fi, field: fields[fi] };
    }
    return null;
  }
  /** A key the workspace generated from the type's default label (text, text_2), not one a person or the API chose. */
  isGeneratedKey(field) {
    const base = keyFromLabel(defaultsFor(field.type).label, new Set(), field.type);
    return field.key === base || new RegExp(`^${base}_\\d+$`).test(field.key);
  }
  /**
   * A label was finished. While the form has never been published (no responses carry its keys yet),
   * a generated key follows the label: "text_2" becomes "company", and rules and record steps follow.
   * Then the answer is mapped to a matching field of the record step's object, if it is not mapped yet.
   */
  handleLabelCommit(event) {
    let key = event.detail?.key;
    const d = this.definition;
    const hit = this.locateField(d, key);
    if (!hit) return;
    const { field } = hit;
    const neverPublished = !d.publicKey && !d.version;
    if (neverPublished && collectsAnswer(field.type) && String(field.label || "").trim() && this.isGeneratedKey(field)) {
      const others = allKeys(d);
      others.delete(key);
      const next = keyFromLabel(field.label, others, field.type);
      if (next !== key) {
        const oldKey = key;
        this.commit((dd) => {
          const target = this.locateField(dd, oldKey);
          if (!target) return false;
          target.field.key = next;
          renameFieldReferences(dd, oldKey, next);
          return true;
        });
        key = next;
      }
    }
    this.autoMap(key);
  }
  objectFieldsOf(object) {
    const k = String(object || "").toLowerCase();
    if (!k) return Promise.resolve([]);
    if (!this.objectFieldsCache.has(k)) {
      this.objectFieldsCache.set(
        k,
        getObjectFields({ objectApiName: object })
          .then((r) => r || [])
          .catch(() => [])
      );
    }
    return this.objectFieldsCache.get(k);
  }
  /**
   * Map one answer (each part of a Name field) onto the main record step's object when a field there has the same
   * label or API name; an Address field's parts onto one of the object's addresses.
   */
  async autoMap(key) {
    const main = mainStepOf(this.definition?.settings?.automation?.steps || []);
    if (!main?.object) return;
    const formId = this.formId;
    const objectFields = await this.objectFieldsOf(main.object);
    if (formId !== this.formId || !this.store) return;
    const d = this.definition;
    const step = mainStepOf(d?.settings?.automation?.steps || []);
    const hit = this.locateField(d, key);
    if (!step || !hit || !collectsAnswer(hit.field.type) || String(step.object).toLowerCase() !== String(main.object).toLowerCase()) return;
    const adds = isAddress(hit.field.type) ? this.addressAutoMappings(step, hit.field, objectFields) : this.answerAutoMappings(step, hit.field, objectFields);
    if (!adds.length) return;
    this.commit((dd) => {
      const s = mainStepOf(dd.settings?.automation?.steps || []);
      if (!s) return false;
      s.fields = s.fields || [];
      s.fields.push(...adds);
      return true;
    });
  }
  /** An answer's mapping by label or API name; a Name field's parts each (to FirstName and LastName where the object has them). */
  answerAutoMappings(step, field, objectFields) {
    const answers = isName(field.type) ? answerFieldsOf(field) : [field];
    const taken = new Set((step.fields || []).map((m) => String(m.field).toLowerCase()));
    const adds = [];
    for (const answer of answers) {
      if ((step.fields || []).some((m) => m.source?.type === "field" && m.source.key === answer.key)) continue;
      const target = suggestObjectField(answer, objectFields, taken);
      if (!target) continue;
      taken.add(String(target.value).toLowerCase());
      adds.push({ field: target.value, source: { type: "field", key: answer.key } });
    }
    return adds;
  }
  /** An Address field's parts on the object's address for its purpose (Mailing, Billing, ...), unless a part is mapped already. */
  addressAutoMappings(step, field, objectFields) {
    const existing = step.fields || [];
    return withAddressMappings(existing, answerFieldsOf(field), objectFields).slice(existing.length);
  }
  handleMoveField(event) {
    const { sectionIndex: si, fieldIndex: fi, direction } = event.detail;
    const j = fi + direction;
    this.commit((d) => {
      const fields = d.sections[si].fields;
      if (j < 0 || j >= fields.length) return false;
      [fields[fi], fields[j]] = [fields[j], fields[fi]];
      return true;
    });
    this.selection = { kind: "field", sectionIndex: si, fieldIndex: j };
  }
  handleMoveFieldTo(event) {
    const { from, to } = event.detail;
    let target = to.index;
    this.commit((d) => {
      const [field] = d.sections[from.sectionIndex].fields.splice(from.fieldIndex, 1);
      if (from.sectionIndex === to.sectionIndex && from.fieldIndex < to.index) target -= 1;
      d.sections[to.sectionIndex].fields.splice(target, 0, field);
    });
    this.selection = { kind: "field", sectionIndex: to.sectionIndex, fieldIndex: target };
  }
  handleDuplicateField(event) {
    const { sectionIndex: si, fieldIndex: fi } = event.detail;
    const type = this.definition?.sections?.[si]?.fields?.[fi]?.type;
    if (isSingle(type)) {
      this.toast("One per form", `A form can have one ${getType(type).label} block.`, "info");
      return;
    }
    this.commit((d) => {
      const copy = clone(d.sections[si].fields[fi]);
      delete copy.id;
      for (const o of copy.options || []) delete o.id;
      copy.key = keyFromLabel(copy.label || copy.type, allKeys(d), copy.type);
      d.sections[si].fields.splice(fi + 1, 0, copy);
    });
    this.selection = { kind: "field", sectionIndex: si, fieldIndex: fi + 1 };
    this.revealSelection();
  }
  handleDeleteField(event) {
    const { sectionIndex: si, fieldIndex: fi } = event.detail;
    this.commit((d) => {
      const [removed] = d.sections[si].fields.splice(fi, 1);
      if (removed) dropFieldReferences(d, removed.key); // rules and record steps must not point at a missing field
    });
    this.selection = { kind: null };
  }
  handleAddPage() {
    let index = 0;
    this.commit((d) => {
      index = d.sections.length;
      const key = keyFromLabel(`page_${index + 1}`, allKeys(d), "page");
      d.sections.push({ key, name: `Page ${index + 1}`, label: `Page ${index + 1}`, fields: [] });
    });
    this.selection = { kind: "page", sectionIndex: index, fieldIndex: null };
    this.revealSelection();
  }
  handleDeletePage(event) {
    const si = event.detail.sectionIndex;
    const page = this.definition.sections[si];
    if (this.definition.sections.length <= 1) return;
    // eslint-disable-next-line no-alert
    if ((page.fields || []).length && !window.confirm(`Delete "${page.label || page.name}" and its ${page.fields.length} fields?`)) return;
    this.commit((d) => {
      const [removed] = d.sections.splice(si, 1);
      for (const f of removed?.fields || []) dropFieldReferences(d, f.key);
    });
    this.selection = { kind: null };
  }
  handleMovePage(event) {
    const { sectionIndex: si, direction } = event.detail;
    const j = si + direction;
    this.commit((d) => {
      if (j < 0 || j >= d.sections.length) return false;
      [d.sections[si], d.sections[j]] = [d.sections[j], d.sections[si]];
      return true;
    });
    this.selection = { kind: "page", sectionIndex: j, fieldIndex: null };
  }
  handlePageChange(event) {
    const si = event.detail.sectionIndex ?? this.selection.sectionIndex;
    const patch = event.detail.patch;
    this.commit((d) => Object.assign(d.sections[si], patch));
  }

  // ------------------------------------------------------------ panel events
  handleFieldChange(event) {
    const sel = this.selection;
    if (sel.kind !== "field") return;
    const patch = event.detail.patch;
    let retyped;
    this.commit((d) => {
      const field = d.sections[sel.sectionIndex].fields[sel.fieldIndex];
      const answerKeys = () => answerFieldsOf(field).map((a) => a.key);
      const before = answerKeys();
      Object.assign(field, patch);
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete field[k];
      if (patch.type === "table") {
        // a table starts with the default rows and scale, and always takes the full width
        const table = defaultsFor("table");
        if (!(field.options || []).length) field.options = table.options;
        if (!tableRows(field).length) field.config = { ...(field.config || {}), rows: table.config.rows };
        if (field.config) delete field.config.rowSpan;
        field.width = 100;
      }
      if (patch.type) {
        if (needsOptions(patch.type) && !(field.options || []).length) field.options = [{ label: "Option 1", value: "Option 1" }];
        if (!needsOptions(patch.type)) delete field.options;
        if (patch.type === "richtext" && !field.richtext) field.richtext = "<p>Your text here</p>";
      }
      if (patch.type === "name") {
        // a Name field starts with its parts
        const name = defaultsFor("name");
        if (!field.config?.parts) field.config = { ...(field.config || {}), ...name.config };
      }
      if (patch.type === "address" && !field.config?.defaultCountry) {
        // an Address field starts in the visitor's country, else the builder's, as a new one does
        field.config = { ...(field.config || {}), ...defaultsFor("address").config };
        this.dropUnlistedCountry(field);
        retyped = field;
      }
      // an answer the field no longer gives (a removed table row, another type) leaves no rules or record steps pointing at it
      const after = new Set(answerKeys());
      for (const key of before) if (!after.has(key)) dropFieldReferences(d, key);
      // a field that is no longer an Email field can't fill in the payment page's email (keys change only on label commit)
      if (patch.type) dropRetypedEmailField(d, field.key, field.type);
    });
    if (retyped) this.checkCountryWhenListed(retyped.key, retyped.config?.defaultCountry);
  }
  /** Set or clear the rule on a field or page; `from` moves a rule to another target in the same change. */
  handleRuleChange(event) {
    const { kind, key, rule, from } = event.detail;
    const place = (d, k, ky, value) => {
      for (const s of d.sections) {
        if (k === "page" && s.key === ky) {
          if (value) s.conditionalLogic = value;
          else delete s.conditionalLogic;
          return true;
        }
        for (const f of s.fields || []) {
          if (k === "field" && f.key === ky) {
            if (value) f.conditionalLogic = value;
            else delete f.conditionalLogic;
            return true;
          }
        }
      }
      return false;
    };
    this.commit((d) => {
      const moved = from ? place(d, from.kind, from.key, null) : false;
      return place(d, kind, key, rule) || moved;
    });
  }
  handleThemeChange(event) {
    const patch = event.detail.patch;
    this.commit((d) => {
      if (patch === null) delete d.theme;
      else d.theme = { ...(d.theme || {}), ...patch };
    });
  }
  handleFormChange(event) {
    const patch = event.detail.patch;
    this.commit((d) => Object.assign(d, patch));
  }

  // ------------------------------------------------------------ helpers
  commit(mutator) {
    if (!this.store) return;
    this.store.commit(mutator);
  }
  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
  messageOf(e) {
    if (!e) return "Unknown error";
    if (typeof e === "string") return e;
    if (e.body?.message) return e.body.message;
    if (Array.isArray(e.body) && e.body[0]?.message) return e.body[0].message;
    return e.message || "Unknown error";
  }
}
