import { LightningElement, api } from "lwc";
import { paletteGroups, getType, iconUrl } from "c/jformFieldRegistry";
import { guideFor, searchText, sampleOf } from "c/jformFieldGuide";

/** Pause before the preview card opens on hover, so moving across the palette does not flash it. */
const OPEN_DELAY = 350;
/** Time the pointer has to travel from a tile to the card before it closes. */
const CLOSE_DELAY = 200;
/** Card distance from the palette's right edge: the panel padding, the resize handle and some air. */
const CARD_GAP = 28;
const CARD_WIDTH = 360;
const EDGE = 12;

/** A keyboard focus ring, not the focus a mouse click leaves behind. */
function focusVisible(el) {
  try {
    return el.matches(":focus-visible");
  } catch (e) {
    return true;
  }
}

/** The guide's drawing of a table as rows of cells, the picked column filled; read out as one sentence. */
function pictureOf(p) {
  const rows = p.rows.map((r) => r.label);
  return {
    label: p.label,
    ariaLabel: `${p.label}: a table with the rows ${rows.join(", ")} and the columns ${p.columns.join(", ")}`,
    columns: p.columns.map((c) => ({ key: c, label: c })),
    rows: p.rows.map((r) => ({
      key: r.label,
      label: r.label,
      cells: p.columns.map((c) => ({ key: c, cls: c === r.pick ? "pal-pic-dot pal-pic-on" : "pal-pic-dot" }))
    }))
  };
}

/**
 * Field type palette. Pointing at an item, clicking it or tabbing to it opens a card beside the palette:
 * what the field is, an example as respondents see it, when to use it, the fields people confuse it with,
 * and an Add button. A field is added only from that button or by dragging the item onto a page, so a
 * click meant to find out what a type is never changes the form.
 */
export default class JformPalette extends LightningElement {
  @api search = "";
  /** One column of full-width items (the workspace's compact layout gives the palette 200px). */
  @api compact = false;
  _query = "";
  /** The preview card's content, or null when it is closed. */
  card = null;
  /** Where the card goes, in viewport pixels: beside the palette, level with the tile. */
  anchor = null;
  placed = true;
  hovering = false;
  openTimer;
  closeTimer;
  /** Touch-first devices have no hover: the card opens only for keyboard focus there. */
  hoverPreview = true;

  connectedCallback() {
    try {
      this.hoverPreview = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    } catch (e) {
      this.hoverPreview = true;
    }
    this.onViewportChange = () => this.closeCard();
  }

  disconnectedCallback() {
    this.closeCard();
  }

  renderedCallback() {
    if (this.card && !this.placed) {
      this.placed = true;
      this.placeCard();
    }
  }

  get groups() {
    const q = (this._query || "").trim().toLowerCase();
    const active = this.card?.type;
    return paletteGroups()
      .map((g) => ({
        group: g.group,
        items: g.items
          .filter((i) => !q || searchText(i.type).includes(q))
          .map((i) => ({
            ...i,
            desc: guideFor(i.type).desc,
            expanded: i.type === active ? "true" : "false",
            cls: `pal-item${i.type === active ? " pal-item-active" : ""}`
          }))
      }))
      .filter((g) => g.items.length);
  }

  get noMatches() {
    return Boolean((this._query || "").trim()) && this.groups.length === 0;
  }

  get gridClass() {
    return `pal-grid${this.compact ? " pal-grid-one" : ""}`;
  }

  handleSearch(event) {
    this._query = event.target.value;
    this.closeCard();
  }

  /** A click (or tap, where there is no hover) opens the card at once; adding is the card's job. */
  handleClick(event) {
    const el = event.currentTarget;
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.openCard(el.dataset.type, el);
  }

  /** Enter or Space opens the card and moves to its Add button, so the keyboard can add without dragging. */
  handleKey(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const el = event.currentTarget;
      clearTimeout(this.closeTimer);
      this.openCard(el.dataset.type, el);
      // after the card renders
      Promise.resolve().then(() => this.template.querySelector(".pal-add")?.focus());
    } else if (event.key === "Escape" && this.card) {
      event.stopPropagation();
      this.closeCard();
    }
  }

  handleDragStart(event) {
    this.closeCard();
    const type = event.currentTarget.dataset.type;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", `jform-type:${type}`);
    // drag data is unreadable until the drop, but type names are not: the canvas sizes its drop placeholder from this one
    event.dataTransfer.setData(`application/x-jform-type-${type}`, type);
  }

  // ------------------------------------------------------------ preview card
  handleItemEnter(event) {
    const el = event.currentTarget;
    this.hovering = true;
    clearTimeout(this.closeTimer);
    clearTimeout(this.openTimer);
    if (this.card) {
      this.openCard(el.dataset.type, el);
    } else if (this.hoverPreview) {
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      this.openTimer = setTimeout(() => this.openCard(el.dataset.type, el), OPEN_DELAY);
    }
  }

  handleItemLeave() {
    this.hovering = false;
    clearTimeout(this.openTimer);
    this.scheduleClose();
  }

  handleItemFocus(event) {
    const el = event.currentTarget;
    if (this.returningFocus) {
      // focus coming back from the card after Escape: the card was just closed on purpose
      this.returningFocus = false;
      return;
    }
    if (!focusVisible(el)) return;
    clearTimeout(this.closeTimer);
    clearTimeout(this.openTimer);
    this.openCard(el.dataset.type, el);
  }

  handleItemBlur() {
    this.scheduleClose();
  }

  handleCardEnter() {
    this.hovering = true;
    clearTimeout(this.closeTimer);
  }

  handleCardLeave() {
    this.hovering = false;
    this.scheduleClose();
  }

  handleCardFocus() {
    clearTimeout(this.closeTimer);
  }

  handleCardBlur() {
    this.scheduleClose();
  }

  /** Escape closes the card and returns to its tile. */
  handleCardKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      const type = this.card?.type;
      this.closeCard();
      const tile = this.template.querySelector(`.pal-item[data-type="${type}"]`);
      if (tile) {
        this.returningFocus = true;
        tile.focus();
        this.returningFocus = false;
      }
    }
  }

  /** Show a look-alike field in the same card, so the two can be compared. */
  handleCompare(event) {
    const type = event.currentTarget.dataset.type;
    this.card = this.cardFor(type);
    this.placed = false;
  }

  handleCardAdd() {
    if (this.card) this.emit(this.card.type);
  }

  openCard(type, el) {
    if (!type || !el) return;
    const tile = el.getBoundingClientRect();
    const pal = this.template.querySelector(".pal")?.getBoundingClientRect() || tile;
    const left = Math.max(EDGE, Math.min(pal.right + CARD_GAP, window.innerWidth - CARD_WIDTH - EDGE));
    this.anchor = { left, top: tile.top - 8 };
    if (this.card?.type !== type) this.card = this.cardFor(type);
    this.placed = false;
    if (!this.listening) {
      this.listening = true;
      window.addEventListener("scroll", this.onViewportChange, true);
      window.addEventListener("resize", this.onViewportChange);
    }
  }

  closeCard() {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.card = null;
    this.anchor = null;
    if (this.listening) {
      this.listening = false;
      window.removeEventListener("scroll", this.onViewportChange, true);
      window.removeEventListener("resize", this.onViewportChange);
    }
  }

  scheduleClose() {
    clearTimeout(this.closeTimer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.closeTimer = setTimeout(() => {
      if (this.hovering || this.template.activeElement?.closest?.(".pal-card")) return;
      this.closeCard();
    }, CLOSE_DELAY);
  }

  cardFor(type) {
    const t = getType(type);
    const g = guideFor(type);
    const sample = sampleOf(type);
    return {
      type,
      label: t.label,
      group: t.group,
      iconUrl: iconUrl(type),
      desc: g.desc,
      when: g.when,
      field: sample.field,
      value: sample.value,
      addressLists: sample.addressLists,
      note: sample.note,
      picture: sample.picture ? pictureOf(sample.picture) : undefined,
      hasCompare: g.compare.length > 0,
      compare: g.compare.map((c) => ({ type: c, label: getType(c).label, iconUrl: iconUrl(c) })),
      addLabel: `Add ${t.label}`,
      regionLabel: `About ${t.label}`
    };
  }

  /**
   * Put the card level with its tile, kept inside the window. position: fixed is relative to the window
   * unless an ancestor has a transform, so the card is measured once and moved by any difference.
   */
  placeCard() {
    const card = this.template.querySelector(".pal-card");
    if (!card || !this.anchor) return;
    card.style.left = `${this.anchor.left}px`;
    card.style.top = `${this.anchor.top}px`;
    const got = card.getBoundingClientRect();
    const dx = got.left - this.anchor.left;
    const dy = got.top - this.anchor.top;
    const top = Math.max(EDGE, Math.min(this.anchor.top, window.innerHeight - EDGE - got.height));
    card.style.left = `${this.anchor.left - dx}px`;
    card.style.top = `${top - dy}px`;
  }

  emit(type) {
    this.closeCard();
    this.dispatchEvent(new CustomEvent("insert", { detail: { type } }));
  }
}
