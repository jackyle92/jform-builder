import { LightningElement, api } from "lwc";
import createPublicLink from "@salesforce/apex/JFormImageService.createPublicLink";
import { loadPanelPrefs, savePanelPrefs, clampWidth, panelStyle, startPanelDrag, keyAction, PANEL_LIMITS } from "c/jformPanelResize";
import { resolveTheme, contrastRatio, onColor, normalizeHex, themeTokens, DEFAULT_THEME, FINISH_DEFAULTS, SHADOW_SIZES, SHADOW_LIMITS } from "c/jformTheme";
import { hasAddressField } from "c/jformAddressLists";

const IMAGE_TYPES = [".png", ".jpg", ".jpeg", ".gif", ".webp"]; // matches JFormImageService.IMAGE_EXTENSIONS
const BLOCKED_HINT =
  "This image could not be loaded. Salesforce only shows images from trusted domains: an uploaded image (a Salesforce Files public link) works everywhere; other sites need an admin to add them under Setup, CSP Trusted Sites.";

/** Keep in step with STYLES in the Apex class JFormDesignPresets, which the agent's Apply Design action uses. */
const PRESETS = [
  { id: "card", label: "Card", theme: { ...FINISH_DEFAULTS, preset: "card", primary: "#337418", background: "#f8f8f8", surface: "#ffffff", text: "#0f0f0f", labelColor: "", headingFont: "system", radius: "soft", fieldStyle: "outline", choiceStyle: "cards", buttonStyle: "filled" } },
  { id: "minimal", label: "Minimal", theme: { ...FINISH_DEFAULTS, preset: "minimal", primary: "#181818", background: "#ffffff", surface: "#ffffff", text: "#181818", labelColor: "", headingFont: "system", radius: "square", fieldStyle: "underline", choiceStyle: "list", buttonStyle: "outline" } },
  { id: "teal", label: "Teal", theme: { ...FINISH_DEFAULTS, preset: "teal", primary: "#0f766e", background: "#f1f5f4", surface: "#ffffff", text: "#1c2321", labelColor: "", headingFont: "serif", radius: "round", fieldStyle: "outline", choiceStyle: "cards", buttonStyle: "filled" } },
  { id: "dark", label: "Dark", theme: { ...FINISH_DEFAULTS, preset: "dark", primary: "#5dd62c", background: "#0f0f0f", surface: "#202020", text: "#f8f8f8", labelColor: "", headingFont: "system", radius: "soft", fieldStyle: "filled", choiceStyle: "cards", buttonStyle: "filled" } },
  { id: "warm", label: "Warm", theme: { ...FINISH_DEFAULTS, preset: "warm", primary: "#c2410c", background: "#fff7ed", surface: "#ffffff", text: "#7c2d12", labelColor: "", headingFont: "serif", radius: "round", fieldStyle: "filled", choiceStyle: "cards", buttonStyle: "filled" } },
  { id: "corporate", label: "Corporate", theme: { ...FINISH_DEFAULTS, preset: "corporate", primary: "#2a5bd7", background: "#eef4ff", surface: "#ffffff", text: "#0b2a66", labelColor: "#334155", headingFont: "system", radius: "square", fieldStyle: "outline", choiceStyle: "list", buttonStyle: "filled" } },
  { id: "drift", label: "Drift", theme: { ...FINISH_DEFAULTS, preset: "drift", primary: "#5b3df5", background: "#f6f5fb", surface: "#ffffff", text: "#14122b", labelColor: "", headingFont: "system", radius: "round", fieldStyle: "outline", choiceStyle: "cards", buttonStyle: "filled", backgroundStyle: "mesh", surfaceStyle: "glass", buttonShape: "pill", progressStyle: "segments", focusStyle: "spotlight", ...SHADOW_SIZES.strong } }
];

/** A small picture of a mesh background for a theme's thumbnail. */
function meshThumb(theme) {
  const k = themeTokens(theme);
  return `radial-gradient(circle at 15% 15%, ${k["--jf-mesh-a"]}, transparent 60%), radial-gradient(circle at 90% 30%, ${k["--jf-mesh-b"]}, transparent 60%), radial-gradient(circle at 50% 100%, ${k["--jf-mesh-c"]}, transparent 65%), ${k["--jf-bg"]}`;
}

const SEGMENTS = {
  labelPosition: [
    ["above", "Above"],
    ["left", "Left"]
  ],
  labelWidth: [
    ["25", "25%"],
    ["33", "33%"],
    ["40", "40%"]
  ],
  fieldStyle: [
    ["outline", "Outline"],
    ["filled", "Filled"],
    ["underline", "Underline"]
  ],
  choiceStyle: [
    ["cards", "Cards"],
    ["list", "List"]
  ],
  textSize: [
    ["small", "Small"],
    ["medium", "Medium"],
    ["large", "Large"]
  ],
  width: [
    ["narrow", "Narrow"],
    ["medium", "Medium"],
    ["wide", "Wide"]
  ],
  radius: [
    ["square", "Square"],
    ["soft", "Soft"],
    ["round", "Round"]
  ],
  buttonStyle: [
    ["filled", "Filled"],
    ["outline", "Outline"]
  ],
  buttonAlign: [
    ["right", "Right"],
    ["left", "Left"],
    ["center", "Center"],
    ["full", "Full width"]
  ],
  buttonSize: [
    ["default", "Default"],
    ["large", "Large"]
  ],
  titleAlign: [
    ["left", "Left"],
    ["center", "Centered"]
  ],
  titlePlacement: [
    ["page", "Above the card"],
    ["card", "Inside the card"]
  ],
  logoSize: [
    ["small", "Small"],
    ["medium", "Medium"],
    ["large", "Large"]
  ],
  coverHeight: [
    ["short", "Short"],
    ["medium", "Medium"],
    ["tall", "Tall"]
  ],
  sideImagePosition: [
    ["left", "Left"],
    ["right", "Right"]
  ],
  backgroundStyle: [
    ["solid", "Solid"],
    ["mesh", "Mesh"]
  ],
  surfaceStyle: [
    ["solid", "Solid"],
    ["glass", "Glass"]
  ],
  buttonShape: [
    ["corners", "Match corners"],
    ["pill", "Pill"]
  ],
  progressStyle: [
    ["bar", "Bar"],
    ["segments", "Segments"]
  ],
  focusStyle: [
    ["none", "Off"],
    ["spotlight", "On"]
  ]
};

const IMAGE_ROWS = [
  ["coverUrl", "Cover image", "https://…/cover.jpg", "A banner above the title, or the top edge of the card when the title is inside it. Try 1600 × 500 px.", "coverHeight", "Cover height", "Upload a cover image"],
  ["sideImageUrl", "Side image", "https://…/photo.jpg", "Shown beside the form when there is room (720 px and wider) and as a banner on phones. Try 1200 × 1600 px.", "sideImagePosition", "Image side", "Upload a side image"],
  ["backgroundImageUrl", "Page image", "https://…/background.jpg", "Behind the whole form area, over the page color; the form keeps its own color. Try 1920 × 1080 px.", null, null, "Upload a page image"]
];

const SHADOW_LABELS = { none: "None", soft: "Soft", medium: "Medium", strong: "Strong" };
const SHADOW_SLIDERS = [
  ["shadowBlur", "Blur", "px"],
  ["shadowDistance", "Distance", "px"],
  ["shadowStrength", "Strength", "%"]
];

const DEVICES = [
  ["desktop", "Desktop"],
  ["tablet", "Tablet"],
  ["phone", "Phone"]
];

/**
 * The design panel's categories, listed under the themes on its home view. Each opens on its own with the
 * settings most forms need; the rest wait under More options. The last category open is remembered per browser.
 */
const SECTIONS = [
  ["colors", "Colors", "utility:color_swatch"],
  ["background", "Background", "utility:image"],
  ["fonts", "Fonts", "utility:text"],
  ["fields", "Fields", "utility:form"],
  ["buttons", "Buttons", "utility:button_choice"],
  ["header", "Logo and header", "utility:company"],
  ["layout", "Layout", "utility:layout"]
];
const SECTION_KEY = "jform.designSection";

/** Color fields, in pairs: page and form, text and labels, then buttons. */
const COLORS = [
  ["background", "Page color", "Behind the form"],
  ["surface", "Form color", "The form card and inputs"],
  ["text", "Text color", "Titles, answers, body text"],
  ["labelColor", "Label color", "Field labels"],
  ["primary", "Button color", "Buttons, focus, selected choices"]
];

/**
 * Color schemes: one click sets the five colors and nothing else (themes also set fonts and styles).
 * Each pairs a button color that carries white or black text at 4.5:1 with readable text on its card.
 */
const SCHEMES = [
  ["green", "JForm green", "#337418", "#f8f8f8", "#ffffff", "#0f0f0f"],
  ["mono", "Black and white", "#181818", "#ffffff", "#ffffff", "#181818"],
  ["teal", "Teal", "#0f766e", "#f1f5f4", "#ffffff", "#1c2321"],
  ["blue", "Blue", "#2a5bd7", "#eef4ff", "#ffffff", "#0b2a66"],
  ["purple", "Purple", "#6d28d9", "#f5f3ff", "#ffffff", "#2e1065"],
  ["rose", "Rose", "#be123c", "#fff1f2", "#ffffff", "#4c0519"],
  ["orange", "Orange", "#c2410c", "#fff7ed", "#ffffff", "#7c2d12"],
  ["sand", "Sand", "#92400e", "#faf5ec", "#fffdf8", "#3f2a14"],
  ["night", "Night", "#5dd62c", "#0f0f0f", "#202020", "#f8f8f8"],
  ["navy", "Navy", "#60a5fa", "#0f172a", "#1e293b", "#f1f5f9"]
].map(([id, label, primary, background, surface, text]) => ({ id, label, colors: { primary, background, surface, text, labelColor: "" } }));

const FONTS = [
  ["system", "System sans"],
  ["salesforce", "Salesforce Sans"],
  ["serif", "Serif (Georgia)"],
  ["mono", "Monospace"]
];

/** Design & preview tab: live preview of the draft beside the design settings (themes, then a category at a time). */
export default class JformDesignTab extends LightningElement {
  @api definition;
  /** Set by the workspace when it has a fixed height: preview and settings scroll separately. */
  @api contained = false;
  device = "desktop";
  /** Width and collapsed state of the design panel, remembered per browser (shared store with the workspace). */
  panelPrefs = {};
  /** The countries and states Address fields offer, read by the workspace and handed to Preview with the draft. */
  @api addressLists = null;
  draggingPanel = false;
  /** The open category, or null for the home view (themes and the category list). */
  section = null;
  /** Categories whose More options are open. */
  moreSections = [];
  /** Where focus goes after the next render: the category heading, or the home row just left. */
  pendingFocus;
  /** Image problems by theme key: true when the thumbnail failed to load, or a message from an upload. */
  imageErrors = {};
  /** Theme keys with an upload whose public link is being created. */
  uploading = {};
  /** Shadow slider values while they are dragged, before the theme takes them. */
  shadowDraft = {};

  get theme() {
    return resolveTheme(this.definition?.theme);
  }
  get rawTheme() {
    return this.definition?.theme || {};
  }

  // ------------------------------------------------------------ categories
  get isHome() {
    return !this.section;
  }
  get isColors() {
    return this.section === "colors";
  }
  get isBackground() {
    return this.section === "background";
  }
  get isFonts() {
    return this.section === "fonts";
  }
  get isFields() {
    return this.section === "fields";
  }
  get isButtons() {
    return this.section === "buttons";
  }
  get isHeader() {
    return this.section === "header";
  }
  get isLayout() {
    return this.section === "layout";
  }
  get sectionLabel() {
    return (SECTIONS.find(([id]) => id === this.section) || [])[1];
  }
  /** Home rows: each category with what it is set to now, so most changes start from the right place. */
  get sections() {
    return SECTIONS.map(([id, label, icon]) => ({ id, label, icon, summary: this.summaryOf(id) }));
  }
  summaryOf(id) {
    const t = this.theme;
    const word = (prop) => (SEGMENTS[prop].find(([value]) => value === String(t[prop])) || [])[1] || "";
    switch (id) {
      case "colors":
        return `Button ${normalizeHex(t.primary, DEFAULT_THEME.primary).toUpperCase()}, page ${normalizeHex(t.background, DEFAULT_THEME.background).toUpperCase()}`;
      case "background":
        // a page image takes the mesh's place
        return `${t.backgroundImageUrl ? "Page image" : `${word("backgroundStyle")} page`}, ${word("surfaceStyle").toLowerCase()} card`;
      case "fonts":
        return `${(FONTS.find(([value]) => value === t.headingFont) || [])[1] || t.headingFont}, ${word("textSize").toLowerCase()} text`;
      case "fields":
        return `${word("fieldStyle")}, ${word("choiceStyle").toLowerCase()}, ${word("radius").toLowerCase()} corners`;
      case "buttons":
        return `${word("buttonStyle")}, ${t.buttonShape === "pill" ? "pill" : "matching corners"}`;
      case "header":
        return `${t.logoUrl ? "Logo" : "No logo"}, title ${t.titleAlign === "center" ? "centered" : "on the left"}`;
      default:
        return `${word("width")} width, ${t.progressStyle === "segments" ? "segmented" : "bar"} progress`;
    }
  }
  handleSection(event) {
    this.openSection(event.currentTarget.dataset.id);
    this.pendingFocus = ".ds-title-section";
  }
  handleBack() {
    const left = this.section;
    this.openSection(null);
    this.pendingFocus = `.ds-nav-row[data-id="${left}"]`;
  }
  openSection(id) {
    this.section = SECTIONS.some(([s]) => s === id) ? id : null;
    try {
      if (this.section) window.localStorage.setItem(SECTION_KEY, this.section);
      else window.localStorage.removeItem(SECTION_KEY);
    } catch (e) {
      /* storage blocked: the category is kept for this page view */
    }
  }
  get moreOpen() {
    return this.moreSections.includes(this.section);
  }
  get moreExpanded() {
    return this.moreOpen ? "true" : "false";
  }
  get moreLabel() {
    return this.moreOpen ? "Fewer options" : "More options";
  }
  get moreIcon() {
    return this.moreOpen ? "utility:chevrondown" : "utility:chevronright";
  }
  handleMore() {
    this.moreSections = this.moreOpen ? this.moreSections.filter((id) => id !== this.section) : [...this.moreSections, this.section];
  }
  renderedCallback() {
    if (!this.pendingFocus) return;
    const target = this.template.querySelector(this.pendingFocus);
    this.pendingFocus = undefined;
    if (target) target.focus();
  }

  // ------------------------------------------------------------ color schemes
  get schemes() {
    const t = this.theme;
    const same = (a, b) => normalizeHex(a) === normalizeHex(b);
    return SCHEMES.map((sc) => {
      const c = sc.colors;
      const on = same(t.primary, c.primary) && same(t.background, c.background) && same(t.surface, c.surface) && same(t.text, c.text) && !normalizeHex(this.rawTheme.labelColor);
      return {
        id: sc.id,
        label: sc.label,
        pressed: on ? "true" : "false",
        cls: `ds-scheme${on ? " ds-scheme-on" : ""}`,
        style: `background:${c.background}`,
        cardStyle: `background:${c.surface};color:${c.text}`,
        barStyle: `background:${c.primary}`
      };
    });
  }
  handleScheme(event) {
    const sc = SCHEMES.find((x) => x.id === event.currentTarget.dataset.id);
    if (sc) this.emit({ ...sc.colors });
  }

  // ------------------------------------------------------------ presets
  get presets() {
    return PRESETS.map((p) => ({
      ...p,
      cls: `ds-preset${this.rawTheme.preset === p.id ? " ds-preset-on" : ""}`,
      pressed: this.rawTheme.preset === p.id ? "true" : "false",
      thumbStyle: `background:${p.theme.backgroundStyle === "mesh" ? meshThumb(p.theme) : p.theme.background}`,
      cardStyle: `background:${p.theme.surface}`,
      barAStyle: `background:${p.theme.labelColor || p.theme.text}`,
      barBStyle: `background:${p.theme.primary}`
    }));
  }

  // ------------------------------------------------------------ segmented controls
  get seg() {
    const t = this.theme;
    const out = {};
    for (const [prop, options] of Object.entries(SEGMENTS)) {
      out[prop] = options.map(([value, label]) => {
        const on = String(t[prop]) === value;
        return { key: `${prop}-${value}`, prop, value, label, pressed: on ? "true" : "false", cls: `ds-seg-btn${on ? " ds-seg-on" : ""}` };
      });
    }
    return out;
  }
  /** The shadow sizes; one shows as chosen while the blur, distance and strength match it. */
  get shadowSizes() {
    const t = this.theme;
    return Object.entries(SHADOW_SIZES).map(([id, values]) => {
      const on = Object.entries(values).every(([k, v]) => t[k] === v);
      return { key: `shadow-${id}`, id, label: SHADOW_LABELS[id], pressed: on ? "true" : "false", cls: `ds-seg-btn${on ? " ds-seg-on" : ""}` };
    });
  }
  /** Blur, distance and strength; while a slider is dragged its number follows, and the theme changes when it is let go. */
  get shadowSliders() {
    return SHADOW_SLIDERS.map(([prop, label, unit]) => {
      const value = this.shadowDraft[prop] ?? this.theme[prop];
      return { prop, label, max: SHADOW_LIMITS[prop], value, display: `${value}${unit}` };
    });
  }
  get shadowColor() {
    const value = normalizeHex(this.theme.shadowColor, "#000000");
    return { value, hex: value.toUpperCase(), custom: Boolean(this.theme.shadowColor) };
  }
  get devices() {
    return DEVICES.map(([value, label]) => ({
      value,
      label,
      pressed: this.device === value ? "true" : "false",
      cls: `ds-seg-btn${this.device === value ? " ds-seg-on" : ""}`
    }));
  }
  get isLeftLabels() {
    return this.theme.labelPosition === "left";
  }

  // ------------------------------------------------------------ header and images
  get logo() {
    return this.imageState("logoUrl");
  }
  /** The page image sits with the page color; the cover and side images with the layout. */
  get pageImageRows() {
    return this.imageRows.filter((row) => row.prop === "backgroundImageUrl");
  }
  get layoutImageRows() {
    return this.imageRows.filter((row) => row.prop !== "backgroundImageUrl");
  }
  get imageRows() {
    const seg = this.seg;
    return IMAGE_ROWS.map(([prop, label, placeholder, hint, segProp, segLabel, uploadLabel]) => ({
      ...this.imageState(prop),
      prop,
      label,
      placeholder,
      hint,
      uploadLabel,
      hasSeg: Boolean(segProp),
      seg: segProp ? seg[segProp] : [],
      segLabel
    }));
  }
  imageState(prop) {
    const problem = this.imageErrors[prop];
    return {
      url: this.rawTheme[prop] || "",
      error: Boolean(problem),
      errorText: typeof problem === "string" ? problem : BLOCKED_HINT,
      busy: Boolean(this.uploading[prop])
    };
  }
  get formId() {
    return this.definition?.id;
  }
  get imageTypes() {
    return IMAGE_TYPES;
  }

  // ------------------------------------------------------------ preview page picker
  /** Pages the preview reports ({ key, number, label, hidden }), the one on screen, and whether Next checks required fields. */
  previewPages = [];
  previewCurrent;
  previewMultiPage = false;
  /** The form opens on a start screen: the page picker offers a Welcome stop. */
  previewWelcome = false;
  previewNotOpen = false;
  previewClosed = false;
  previewCheckRequired = false;
  get previewSkipChecks() {
    return !this.previewCheckRequired;
  }
  handlePreviewState(event) {
    const { pages, current, multiPage, welcome, notOpen, closed } = event.detail || {};
    const turned = this.previewCurrent !== undefined && current !== this.previewCurrent;
    this.previewPages = pages || [];
    this.previewCurrent = current;
    this.previewMultiPage = Boolean(multiPage);
    this.previewWelcome = Boolean(welcome);
    this.previewNotOpen = Boolean(notOpen);
    this.previewClosed = Boolean(closed);
    if (turned) this.showPreviewTop();
  }
  /**
   * A new page starts at its top: the preview panel scrolls back without animation, and the window moves
   * only when the preview's top is out of sight (the uncontained layout scrolls the page instead).
   */
  showPreviewTop() {
    const stage = this.template.querySelector(".ds-stage");
    if (!stage) return;
    stage.scrollTop = 0;
    if (stage.getBoundingClientRect().top < 0 && typeof stage.scrollIntoView === "function") stage.scrollIntoView({ block: "start" });
  }
  handlePreviewPage(event) {
    const renderer = this.template.querySelector(".ds-renderer");
    if (renderer) renderer.showPage(event.detail.key);
  }
  handlePreviewCheck(event) {
    this.previewCheckRequired = event.detail.checked === true;
  }

  // ------------------------------------------------------------ colors
  get colors() {
    const t = this.theme;
    const text = normalizeHex(t.text, "#0f0f0f");
    return COLORS.map(([prop, label, hint]) => {
      const isLabel = prop === "labelColor";
      const value = isLabel ? normalizeHex(t.labelColor, text) : normalizeHex(t[prop], "#000000");
      const custom = isLabel && Boolean(normalizeHex(this.rawTheme.labelColor));
      return {
        prop,
        label,
        pickerLabel: `${label} picker`,
        hint: isLabel && !custom ? "Same as text" : hint,
        value,
        hex: value.toUpperCase(),
        canReset: custom
      };
    });
  }
  get contrastChecks() {
    const t = this.theme;
    const surface = normalizeHex(t.surface, "#ffffff");
    const text = normalizeHex(t.text, "#0f0f0f");
    const label = normalizeHex(t.labelColor, text);
    const primary = normalizeHex(t.primary, "#337418");
    const checks = [
      ["Text", contrastRatio(text, surface)],
      ["Labels", contrastRatio(label, surface)],
      ["Button", contrastRatio(onColor(primary), primary)]
    ];
    return checks.map(([name, ratio]) => {
      const ok = ratio >= 4.5;
      return { name, ratio: `${ratio.toFixed(1)}:1`, cls: `ds-check ${ok ? "ds-check-ok" : "ds-check-warn"}`, verdict: ok ? "AA" : "Low" };
    });
  }

  // ------------------------------------------------------------ fonts
  get headingFonts() {
    return this.fontOptions(this.theme.headingFont);
  }
  get bodyFonts() {
    return this.fontOptions(this.theme.bodyFont);
  }
  fontOptions(current) {
    return FONTS.map(([value, label]) => ({ value, label, selected: value === current }));
  }

  // ------------------------------------------------------------ preview
  /** The draft Preview shows, with the Address lists a published form gets from the server. */
  get previewDefinition() {
    return this.addressLists && hasAddressField(this.definition) ? { ...this.definition, addressLists: this.addressLists } : this.definition;
  }
  get rootClass() {
    return `ds${this.contained ? " ds-contained" : ""}${this.draggingPanel ? " ds-dragging" : ""}`;
  }

  // ------------------------------------------------------------ panel size
  connectedCallback() {
    this.panelPrefs = loadPanelPrefs();
    try {
      const saved = window.localStorage.getItem(SECTION_KEY);
      if (SECTIONS.some(([id]) => id === saved)) this.section = saved;
    } catch (e) {
      /* storage blocked: start on the home view */
    }
  }
  get panelPref() {
    return this.panelPrefs.design || {};
  }
  setPanel(patch) {
    this.panelPrefs = { ...this.panelPrefs, design: { ...this.panelPref, ...patch } };
    savePanelPrefs(this.panelPrefs);
  }
  get panelOpen() {
    return !this.panelPref.collapsed;
  }
  get panelStyle() {
    return panelStyle(this.panelPref.width);
  }
  get resizerClass() {
    return `ds-resizer${this.panelOpen ? "" : " ds-resizer-collapsed"}`;
  }
  get toggleIcon() {
    return this.panelOpen ? "utility:chevronright" : "utility:chevronleft";
  }
  get toggleTitle() {
    return this.panelOpen ? "Hide the design panel" : "Show the design panel";
  }
  panelWidth() {
    const el = this.template.querySelector(".ds-panel");
    const measured = el ? Math.round(el.getBoundingClientRect().width) : 0;
    return this.panelPref.width || measured || PANEL_LIMITS.design.min;
  }
  handlePanelDrag(event) {
    if (event.button !== 0 || this.panelPref.collapsed) return;
    this.draggingPanel = true;
    startPanelDrag(event, {
      panel: "design",
      width: this.panelWidth(),
      side: "right",
      onResize: (width) => this.setPanel({ width }),
      onEnd: () => {
        this.draggingPanel = false;
      }
    });
  }
  handlePanelReset() {
    this.setPanel({ width: undefined });
  }
  handlePanelToggle(event) {
    event.stopPropagation();
    this.setPanel({ collapsed: !this.panelPref.collapsed });
  }
  handlePanelKey(event) {
    const action = keyAction(event, "right");
    if (!action) return;
    event.preventDefault();
    if (action.type === "toggle") this.setPanel({ collapsed: !this.panelPref.collapsed });
    else if (action.type === "reset") this.setPanel({ width: undefined });
    else if (!this.panelPref.collapsed) this.setPanel({ width: clampWidth("design", this.panelWidth() + action.delta) });
  }
  stopDrag(event) {
    event.stopPropagation();
  }
  get previewClass() {
    return `ds-preview ds-preview-${this.device}`;
  }

  // ------------------------------------------------------------ handlers
  handlePreset(event) {
    const p = PRESETS.find((x) => x.id === event.currentTarget.dataset.id);
    if (p) this.emit({ ...p.theme });
  }
  handleSeg(event) {
    const { prop, value } = event.currentTarget.dataset;
    this.emit({ [prop]: value });
  }
  handleShadowSize(event) {
    const values = SHADOW_SIZES[event.currentTarget.dataset.id];
    if (values) this.emit({ ...values });
  }
  handleShadowInput(event) {
    this.shadowDraft = { ...this.shadowDraft, [event.target.dataset.prop]: Number(event.target.value) };
  }
  handleShadowChange(event) {
    const prop = event.target.dataset.prop;
    const next = { ...this.shadowDraft };
    delete next[prop];
    this.shadowDraft = next;
    this.emit({ [prop]: Number(event.target.value) });
  }
  handleDevice(event) {
    this.device = event.currentTarget.dataset.value;
  }
  handleColor(event) {
    this.emit({ [event.target.dataset.prop]: normalizeHex(event.target.value) });
  }
  handleHex(event) {
    const prop = event.target.dataset.prop;
    const value = normalizeHex(event.target.value);
    if (value) {
      this.emit({ [prop]: value });
    } else {
      const fallback = prop === "labelColor" ? normalizeHex(this.theme.text) : prop === "shadowColor" ? "#000000" : "";
      event.target.value = normalizeHex(this.theme[prop], fallback).toUpperCase();
    }
  }
  handleResetColor(event) {
    this.emit({ [event.currentTarget.dataset.prop]: "" });
  }
  handleFont(event) {
    this.emit({ [event.target.dataset.prop]: event.target.value });
  }
  handleText(event) {
    const prop = event.target.dataset.prop;
    this.clearImageError(prop);
    this.emit({ [prop]: event.target.value.trim() || undefined });
  }
  handleClearImage(event) {
    const prop = event.currentTarget.dataset.prop;
    this.clearImageError(prop);
    this.emit({ [prop]: undefined });
  }
  handleImageError(event) {
    this.imageErrors = { ...this.imageErrors, [event.target.dataset.prop]: true };
  }
  /** lightning-file-upload stored the file; turn it into a public link and use it. */
  async handleUploaded(event) {
    const prop = event.target.dataset.prop;
    const file = (event.detail && event.detail.files && event.detail.files[0]) || null;
    if (!prop || !file) return;
    this.clearImageError(prop);
    this.uploading = { ...this.uploading, [prop]: true };
    try {
      const link = await createPublicLink({ contentDocumentId: file.documentId });
      this.emit({ [prop]: link.url });
    } catch (e) {
      const message = (e && e.body && e.body.message) || (e && e.message) || "The upload could not be turned into a public link.";
      this.imageErrors = { ...this.imageErrors, [prop]: message };
    } finally {
      const next = { ...this.uploading };
      delete next[prop];
      this.uploading = next;
    }
  }
  handleImageLoad(event) {
    this.clearImageError(event.target.dataset.prop);
  }
  clearImageError(prop) {
    if (this.imageErrors[prop]) {
      const next = { ...this.imageErrors };
      delete next[prop];
      this.imageErrors = next;
    }
  }
  handleToggle(event) {
    this.emit({ [event.target.dataset.prop]: event.target.checked });
  }
  handleReset() {
    this.dispatchEvent(new CustomEvent("themechange", { detail: { patch: null } }));
  }
  emit(patch) {
    this.dispatchEvent(new CustomEvent("themechange", { detail: { patch } }));
  }
}
