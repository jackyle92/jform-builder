import { LightningElement, api } from "lwc";
import { getType, iconUrl, rowSpanOf, isTable, paletteGroups } from "c/jformFieldRegistry";
import { guideFor, searchText } from "c/jformFieldGuide";
import { CHOICE_COLUMNS, defaultChoiceColumns, resolveTheme, safeImageUrl, themeTokens } from "c/jformTheme";
import { welcomeOf, endingOf, hasContent, timeTextOf, hostOf } from "c/jformScreens";
import { displayHtml } from "c/jformRichtext";
import { paymentView } from "c/jformPayment";

const COLS = { 25: 3, 50: 6, 75: 9, 100: 12 };
/** Rough height of a new field on the canvas, so the drop placeholder takes about the room the field will. */
const PLACEHOLDER_HEIGHT = { payment: 132, comment: 132, fileupload: 112, signature: 236, table: 220, name: 100, radio: 150, checkboxes: 150, rating: 96, nps: 96, yesno: 92, checkbox: 56, consent: 56, richtext: 64, heading: 44, divider: 28 };
const DEFAULT_PLACEHOLDER_HEIGHT = 76;
const TYPE_PREFIX = "application/x-jform-type-";
/** Design tokens the welcome and thank-you cards borrow from the form, as the renderer's screens use them. */
const SCREEN_TOKENS = {
  "--cv-screen-btn-bg": "--jf-btn-bg",
  "--cv-screen-btn-text": "--jf-btn-text",
  "--cv-screen-btn-border": "--jf-btn-border",
  "--cv-screen-radius": "--jf-input-radius",
  "--cv-screen-font": "--jf-font-heading",
  "--cv-screen-check": "--jf-primary"
};
const PLACEHOLDER_KEY = "jf-drop-placeholder";

/**
 * The editable form canvas: pages with their fields, selection, inline page
 * titles, insert points, drag and drop. Emits intents; the workspace mutates.
 */
export default class JformCanvas extends LightningElement {
  @api definition;
  @api selection; // { kind: 'field'|'page', sectionIndex, fieldIndex }
  /** Where a dragged field would land: { key, si, index, label, iconUrl, height, span }, or null. */
  drop = null;
  /** The canvas field being moved: { si, fi, label, height, span }, or null. */
  dragging = null;
  /**
   * The key of the page whose "Add field here" menu is open, or null; and the menu's search words. Kept by key,
   * not position, so the menu stays on its page when pages are moved, deleted or undone.
   */
  menuKey = null;
  menuQuery = "";
  focusMenu = false;
  /** The countries and states Address fields show (JFormAddressService.Lists), read by the workspace; null until then. */
  @api addressLists = null;

  connectedCallback() {
    // a drag from the palette that ends anywhere else (Escape, dropped outside) must not leave a placeholder behind
    this.clearDropListener = () => this.clearDrop();
    window.addEventListener("dragend", this.clearDropListener);
    window.addEventListener("drop", this.clearDropListener);
  }
  disconnectedCallback() {
    window.removeEventListener("dragend", this.clearDropListener);
    window.removeEventListener("drop", this.clearDropListener);
  }

  get pages() {
    const sections = this.definition?.sections || [];
    const sel = this.selection || {};
    return sections.map((s, si) => {
      const pageSelected = sel.kind === "page" && sel.sectionIndex === si;
      const fields = (s.fields || []).map((f, fi) => {
        const selected = sel.kind === "field" && sel.sectionIndex === si && sel.fieldIndex === fi;
        const moving = this.dragging && this.dragging.si === si && this.dragging.fi === fi;
        return {
          key: f.key || `f${si}_${fi}`,
          si,
          fi,
          field: f,
          // the Payment block shows its pricing rules in the builder
          payment: f.type === "payment" ? paymentView(this.definition, {}, {}, true) : null,
          typeLabel: getType(f.type).label,
          selected,
          isFirst: fi === 0,
          isLast: fi === (s.fields || []).length - 1,
          draggable: "true",
          cls: `cv-cell cv-span-${(!isTable(f.type) && COLS[f.width]) || 12}${rowSpanOf(f) > 1 ? ` cv-tall cv-rows-${rowSpanOf(f)}` : ""}${selected ? " cv-selected" : ""}${moving ? " cv-dragging" : ""}`
        };
      });
      const pageKey = s.key || `p${si}`;
      const items = [...fields];
      const drop = this.drop && this.drop.key === pageKey ? this.drop : null;
      if (drop) {
        items.splice(Math.min(drop.index, items.length), 0, {
          key: PLACEHOLDER_KEY,
          isPlaceholder: true,
          draggable: "false",
          label: drop.label,
          iconUrl: drop.iconUrl,
          style: `height: ${drop.height}px`,
          cls: `cv-placeholder cv-span-${drop.span}`
        });
      }
      return {
        key: s.key || `p${si}`,
        si,
        number: si + 1,
        label: s.label || s.name || `Page ${si + 1}`,
        description: s.description,
        fieldCount: fields.length,
        fields,
        items,
        isEmpty: fields.length === 0,
        showEmpty: fields.length === 0 && !drop,
        menuOpen: this.menuKey === pageKey,
        isFirst: si === 0,
        isLast: si === sections.length - 1,
        cannotDelete: sections.length <= 1,
        hasRule: Boolean(s.conditionalLogic),
        cls: `cv-page${pageSelected ? " cv-page-selected" : ""}${drop ? " cv-dragover" : ""}`
      };
    });
  }

  /** The field types for the "Add field here" menu, grouped as in the palette and narrowed by the search words. */
  get menuGroups() {
    const q = this.menuQuery.trim().toLowerCase();
    return paletteGroups()
      .map((g) => ({
        group: g.group,
        items: g.items.filter((i) => !q || searchText(i.type).includes(q)).map((i) => ({ ...i, desc: guideFor(i.type).desc }))
      }))
      .filter((g) => g.items.length);
  }
  get menuEmpty() {
    return this.menuGroups.length === 0;
  }

  renderedCallback() {
    // the menu's page was deleted
    if (this.menuKey !== null && !this.pages.some((p) => p.key === this.menuKey)) this.closeMenu(false);
    if (this.focusMenu) {
      this.focusMenu = false;
      this.template.querySelector(".cv-menu lightning-input")?.focus();
    }
  }

  /** Bring the selected field or page into view inside the scrolling canvas column. */
  @api
  scrollToSelection() {
    const el = this.template.querySelector(".cv-selected") || this.template.querySelector(".cv-page-selected");
    // (the welcome and thank-you cards use the page's selected style too)
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  /** Options per row follow the form design here too, so choices sit as they will in the preview. */
  get canvasStyle() {
    return `--jf-choice-cols: ${CHOICE_COLUMNS[defaultChoiceColumns(this.definition?.theme)]}`;
  }

  get isMultiPage() {
    return (this.definition?.sections || []).length > 1;
  }

  // ------------------------------------------------------------ welcome and thank-you cards
  /**
   * The form's buttons, heading font and title alignment, so both cards look like the renderer's screens (the
   * canvas otherwise keeps the builder's own colors).
   */
  get screenLook() {
    const theme = resolveTheme(this.definition?.theme);
    const tokens = themeTokens(this.definition?.theme);
    return {
      theme,
      style: Object.entries(SCREEN_TOKENS)
        .filter(([, token]) => tokens[token])
        .map(([name, token]) => `${name}: ${tokens[token]}`)
        .join("; "),
      center: theme.titleAlign === "center"
    };
  }
  /** The card above the first page, drawn like the renderer's start screen or welcome message. Selecting it shows its settings. */
  get welcomeCard() {
    const d = this.definition || {};
    const w = welcomeOf(d);
    const look = this.screenLook;
    const selected = this.selection?.kind === "welcome";
    const isScreen = w.mode === "screen";
    const hasText = hasContent(d.welcomeMessage);
    return {
      selected,
      cls: `cv-page cv-screen${selected ? " cv-page-selected" : ""}${w.mode === "off" ? " cv-screen-off" : ""}`,
      style: look.style,
      bodyCls: `cv-screen-body${isScreen && look.center ? " cv-screen-center" : ""}`,
      mode: { off: "Off", message: "Message above the form", screen: "Start screen" }[w.mode],
      isOff: w.mode === "off",
      isScreen,
      title: w.title || d.label || d.name || "",
      html: hasText ? displayHtml(d.welcomeMessage) : "",
      startLabel: w.buttonLabel || "Start",
      timeText: timeTextOf(d),
      imageUrl: isScreen ? w.imageUrl || safeImageUrl(look.theme.coverUrl) || null : null,
      logoUrl: isScreen ? safeImageUrl(look.theme.logoUrl) || null : null,
      empty: w.mode === "message" && !hasText
    };
  }
  /** The card after the last page, drawn like the renderer's thank-you screen. */
  get endingCard() {
    const d = this.definition || {};
    const e = endingOf(d);
    const selected = this.selection?.kind === "ending";
    // as on the thank-you screen: the first link is the main button, the others and Submit another are secondary
    const buttons = e.buttons.map((b, i) => ({ key: `b${i}`, label: b.label, cls: `cv-screen-button${i === 0 ? "" : " cv-screen-button-plain"}` }));
    if (e.submitAnother) buttons.push({ key: "another", label: "Submit another response", cls: "cv-screen-button cv-screen-button-plain" });
    return {
      selected,
      cls: `cv-page cv-screen${selected ? " cv-page-selected" : ""}`,
      style: this.screenLook.style,
      title: e.title,
      html: hasContent(d.thankYouMessage) ? displayHtml(d.thankYouMessage) : "<p>Thank you. Your response has been recorded.</p>",
      buttons,
      hasButtons: buttons.length > 0,
      redirect: e.redirectUrl ? `Then goes to ${hostOf(e.redirectUrl)}${e.redirectDelay ? ` after ${e.redirectDelay} s` : ""}` : ""
    };
  }
  handleSelectWelcome(event) {
    event.stopPropagation();
    this.emit("select", { kind: "welcome" });
  }
  handleSelectEnding(event) {
    event.stopPropagation();
    this.emit("select", { kind: "ending" });
  }
  handleScreenKey(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  }

  // ------------------------------------------------------------ selection
  handleSelectField(event) {
    event.stopPropagation();
    const { si, fi } = event.currentTarget.dataset;
    if (fi === undefined) return; // the drop placeholder
    this.emit("select", { kind: "field", sectionIndex: Number(si), fieldIndex: Number(fi) });
  }
  handleSelectPage(event) {
    const si = Number(event.currentTarget.dataset.si);
    this.emit("select", { kind: "page", sectionIndex: si, fieldIndex: null });
  }
  handleClearSelection() {
    this.emit("select", { kind: null });
  }

  // ------------------------------------------------------------ field actions
  /** "Add field here" opens a menu of field types at the end of the page; picking one adds it there. */
  handleInsertHere(event) {
    event.stopPropagation();
    this.menuKey = event.currentTarget.dataset.key;
    this.menuQuery = "";
    this.focusMenu = true;
  }
  handleMenuSearch(event) {
    this.menuQuery = event.target.value || "";
  }
  /** A pick adds the field at the end of the menu's page, wherever that page is now, and puts the keyboard back on its button. */
  handleMenuPick(event) {
    event.stopPropagation();
    const page = this.pages.find((p) => p.key === this.menuKey);
    this.closeMenu(true);
    if (page) this.emit("insert", { sectionIndex: page.si, index: page.fieldCount, type: event.currentTarget.dataset.type });
  }
  handleMenuClose(event) {
    event.stopPropagation();
    this.closeMenu(true);
  }
  handleMenuKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      this.closeMenu(true);
    }
  }
  /** Clicks inside the menu stay there: they would clear the selection on the canvas behind it. */
  handleMenuClick(event) {
    event.stopPropagation();
  }
  /** Cancelling or picking puts the keyboard back on the page's "Add field here" button. */
  closeMenu(refocus) {
    const key = this.menuKey;
    this.menuKey = null;
    this.menuQuery = "";
    if (refocus) {
      Promise.resolve().then(() => [...this.template.querySelectorAll(".cv-insert")].find((b) => b.dataset.key === key)?.focus());
    }
  }
  handleMoveUp(event) {
    event.stopPropagation();
    const { si, fi } = event.currentTarget.dataset;
    this.emit("movefield", { sectionIndex: Number(si), fieldIndex: Number(fi), direction: -1 });
  }
  handleMoveDown(event) {
    event.stopPropagation();
    const { si, fi } = event.currentTarget.dataset;
    this.emit("movefield", { sectionIndex: Number(si), fieldIndex: Number(fi), direction: 1 });
  }
  handleDuplicate(event) {
    event.stopPropagation();
    const { si, fi } = event.currentTarget.dataset;
    this.emit("duplicatefield", { sectionIndex: Number(si), fieldIndex: Number(fi) });
  }
  handleDelete(event) {
    event.stopPropagation();
    const { si, fi } = event.currentTarget.dataset;
    this.emit("deletefield", { sectionIndex: Number(si), fieldIndex: Number(fi) });
  }

  // ------------------------------------------------------------ page actions
  handleAddPage() {
    this.emit("addpage", {});
  }
  handleDeletePage(event) {
    event.stopPropagation();
    this.emit("deletepage", { sectionIndex: Number(event.currentTarget.dataset.si) });
  }
  handlePageUp(event) {
    event.stopPropagation();
    this.emit("movepage", { sectionIndex: Number(event.currentTarget.dataset.si), direction: -1 });
  }
  handlePageDown(event) {
    event.stopPropagation();
    this.emit("movepage", { sectionIndex: Number(event.currentTarget.dataset.si), direction: 1 });
  }
  handlePageTitle(event) {
    const si = Number(event.target.dataset.si);
    this.emit("pagechange", { sectionIndex: si, patch: { label: event.target.value, name: event.target.value } });
  }
  stop(event) {
    event.stopPropagation();
  }

  // ------------------------------------------------------------ drag and drop
  handleFieldDragStart(event) {
    const { si, fi } = event.currentTarget.dataset;
    if (fi === undefined) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `jform-move:${si}:${fi}`);
    const field = this.definition.sections[Number(si)].fields[Number(fi)];
    const height = event.currentTarget.getBoundingClientRect().height;
    this.dragging = {
      si: Number(si),
      fi: Number(fi),
      label: field.label || getType(field.type).label,
      iconUrl: iconUrl(field.type),
      height: Math.round(height) || DEFAULT_PLACEHOLDER_HEIGHT,
      span: (!isTable(field.type) && COLS[field.width]) || 12
    };
  }
  handleFieldDragEnd() {
    this.clearDrop();
  }
  /** What is being dragged, from the canvas itself or (by type name) from the palette; null for anything else. */
  incoming(event) {
    if (this.dragging) return this.dragging;
    const types = Array.from(event.dataTransfer?.types || []);
    const tag = types.find((t) => String(t).startsWith(TYPE_PREFIX));
    if (!tag) return null;
    const type = tag.slice(TYPE_PREFIX.length);
    const t = getType(type);
    return { label: t.short || t.label, iconUrl: iconUrl(type), height: PLACEHOLDER_HEIGHT[type] || DEFAULT_PLACEHOLDER_HEIGHT, span: 12 };
  }
  /**
   * Insertion index for a pointer over a page, in reading order over the real fields: above a row it goes
   * before the row; inside a row it goes before the first field whose middle the pointer has not passed
   * (left/right half for fields sharing a row, top/bottom half for full-width ones).
   */
  indexAt(section, x, y) {
    const placeholder = section.querySelector(".cv-placeholder");
    if (placeholder && this.drop) {
      const r = placeholder.getBoundingClientRect();
      if (r.height && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) return this.drop.index; // no flicker over the placeholder
    }
    const grid = section.querySelector(".cv-grid");
    const gridWidth = grid ? grid.getBoundingClientRect().width : 0;
    const cells = Array.from(section.querySelectorAll(".cv-cell"));
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i].getBoundingClientRect();
      if (y < r.top) return i;
      if (y <= r.bottom) {
        const fullRow = !gridWidth || r.width > gridWidth * 0.7;
        if (fullRow ? y < r.top + r.height / 2 : x < r.left + r.width / 2) return i;
      }
    }
    return cells.length;
  }
  handleDragOver(event) {
    const what = this.incoming(event);
    if (!what) return; // not a JForm drag: leave the page alone
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.dragging ? "move" : "copy";
    const section = event.currentTarget;
    const si = Number(section.dataset.si);
    const index = this.indexAt(section, event.clientX, event.clientY);
    const key = section.dataset.key;
    if (this.drop && this.drop.key === key && this.drop.index === index) return;
    this.drop = { key, si, index, label: what.label, iconUrl: what.iconUrl, height: what.height, span: what.span };
  }
  handleDragLeave(event) {
    // dragleave also fires when the pointer crosses into a child: only a real exit from the page counts
    const r = event.currentTarget.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x <= r.left || x >= r.right || y <= r.top || y >= r.bottom) {
      if (this.drop && this.drop.key === event.currentTarget.dataset.key) this.drop = null;
    }
  }
  handleDropOnPage(event) {
    event.preventDefault();
    event.stopPropagation();
    const section = event.currentTarget;
    const si = Number(section.dataset.si);
    const index = this.drop && this.drop.si === si ? this.drop.index : this.indexAt(section, event.clientX, event.clientY);
    const data = event.dataTransfer ? event.dataTransfer.getData("text/plain") : "";
    this.clearDrop();
    this.applyDrop(data, si, index);
  }
  clearDrop() {
    if (this.drop) this.drop = null;
    if (this.dragging) this.dragging = null;
  }
  applyDrop(data, sectionIndex, index) {
    if (!data) return;
    if (data.startsWith("jform-type:")) {
      this.emit("insert", { sectionIndex, index, type: data.slice("jform-type:".length) });
    } else if (data.startsWith("jform-move:")) {
      const [, fromSi, fromFi] = data.split(":");
      this.emit("movefieldto", { from: { sectionIndex: Number(fromSi), fieldIndex: Number(fromFi) }, to: { sectionIndex, index } });
    }
  }

  /** Anything done elsewhere on the canvas (selecting a field or page, moving, deleting) closes the "Add field here" menu. */
  emit(name, detail) {
    if (this.menuKey !== null) this.closeMenu(false);
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
