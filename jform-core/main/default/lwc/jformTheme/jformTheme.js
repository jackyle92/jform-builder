/**
 * Theme tokens -> CSS custom properties. The renderer sets the returned string
 * as the inline style of its root; c/jformField and the renderer CSS read the
 * var(--jf-*) values, so every label, input, choice, button and error message
 * follows the theme (including dark themes). A few SLDS styling hooks are kept
 * for the base components that remain (spinner, icons).
 */

/** Option columns for single choice and checkboxes: "auto" fits as many 11rem options as the width allows. */
export const CHOICE_COLUMNS = {
  auto: "repeat(auto-fill, minmax(11rem, 1fr))",
  1: "minmax(0, 1fr)",
  2: "repeat(2, minmax(0, 1fr))",
  3: "repeat(3, minmax(0, 1fr))",
  4: "repeat(4, minmax(0, 1fr))"
};

/** Options per row when a field does not choose: cards fit the width, a plain list stacks. */
export function defaultChoiceColumns(theme) {
  return resolveTheme(theme).choiceStyle === "cards" ? "auto" : "1";
}

/** The page and card finish every theme sets: plain on every theme but Drift. Keep in step with tokens() in the Apex class JFormDesignPresets. */
export const FINISH_DEFAULTS = {
  // a soft mesh of the button color behind the form, and a frosted card over it
  backgroundStyle: "solid",
  surfaceStyle: "solid",
  buttonShape: "corners",
  // "spotlight": the question being answered sits on a tinted panel
  focusStyle: "none",
  // the form card's shadow: blur and distance below the card in px, strength as a percent opacity, color "" for black
  shadowBlur: 2,
  shadowDistance: 1,
  shadowStrength: 4,
  shadowColor: ""
};

/** The Design tab's shadow sizes; each sets the blur, distance and strength together. Soft is the default. */
export const SHADOW_SIZES = {
  none: { shadowBlur: 0, shadowDistance: 0, shadowStrength: 0 },
  soft: { shadowBlur: 2, shadowDistance: 1, shadowStrength: 4 },
  medium: { shadowBlur: 24, shadowDistance: 12, shadowStrength: 12 },
  strong: { shadowBlur: 60, shadowDistance: 24, shadowStrength: 24 }
};
/** The highest value each shadow setting takes. */
export const SHADOW_LIMITS = { shadowBlur: 80, shadowDistance: 40, shadowStrength: 60 };

export const DEFAULT_THEME = {
  preset: "card",
  // JForm Green: white text on it is 5.8:1
  primary: "#337418",
  background: "#f8f8f8",
  surface: "#ffffff",
  text: "#0f0f0f",
  labelColor: "",
  headingFont: "system",
  bodyFont: "system",
  textSize: "medium",
  width: "medium",
  radius: "soft",
  buttonStyle: "filled",
  // footer buttons: where they sit and how big they are (phones always get a full-width main button)
  buttonAlign: "right",
  buttonSize: "default",
  labelPosition: "above",
  labelWidth: "33",
  fieldStyle: "outline",
  choiceStyle: "cards",
  poweredBy: true,
  // Header and images
  titleAlign: "left",
  titlePlacement: "page",
  logoUrl: "",
  logoSize: "medium",
  coverUrl: "",
  coverHeight: "medium",
  sideImageUrl: "",
  sideImagePosition: "left",
  backgroundImageUrl: "",
  // Multi-page progress: one bar, or a segment per page that fills as the page is answered. Layout, so themes leave it alone, except Drift
  progressStyle: "bar",
  ...FINISH_DEFAULTS
};

export const LABEL_POSITIONS = ["above", "left"];
export const BUTTON_ALIGNS = ["right", "left", "center", "full"];
export const BUTTON_SIZES = ["default", "large"];
export const FIELD_STYLES = ["outline", "filled", "underline"];
export const CHOICE_STYLES = ["cards", "list"];
export const TITLE_ALIGNS = ["left", "center"];
export const TITLE_PLACEMENTS = ["page", "card"];
export const IMAGE_SIDES = ["left", "right"];
export const LOGO_SIZES = ["small", "medium", "large"];
export const COVER_HEIGHTS = ["short", "medium", "tall"];
export const BACKGROUND_STYLES = ["solid", "mesh"];
export const SURFACE_STYLES = ["solid", "glass"];
export const BUTTON_SHAPES = ["corners", "pill"];
export const PROGRESS_STYLES = ["bar", "segments"];
export const FOCUS_STYLES = ["none", "spotlight"];
/** Side images sit beside the form when the renderer is at least this wide; below it they become a banner. */
export const SPLIT_MIN_WIDTH = 720;

const LOGO_HEIGHTS = { small: "2rem", medium: "3rem", large: "4.5rem" };
const COVER_SIZES = { short: "8rem", medium: "12rem", tall: "18rem" };

/**
 * Image URLs come from a text box, so only allow what an <img src> should load:
 * http(s) URLs and site-relative paths. Anything else (javascript:, data:,
 * blanks) renders nothing.
 */
export function safeImageUrl(url) {
  const value = String(url || "").trim();
  if (!value || /[\s"'<>\\]/.test(value)) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "";
}

const FONT_STACKS = {
  system: '-apple-system, "Segoe UI", system-ui, sans-serif',
  salesforce: '"Salesforce Sans", -apple-system, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace"
};

/** Font family names only: the theme JSON can come from the API, and the tokens end up in an inline style. */
const FONT_NAME = /^[\w\s,"'-]+$/;
function fontStack(value) {
  if (FONT_STACKS[value]) return FONT_STACKS[value];
  return typeof value === "string" && value.trim() && FONT_NAME.test(value) ? value : FONT_STACKS.system;
}

const RADII = { square: "0px", soft: "8px", round: "16px" };
const SMALL_RADII = { square: "0px", soft: "6px", round: "10px" };
const WIDTHS = { narrow: "560px", medium: "680px", wide: "880px" };
const SCALES = { small: "0.9375", medium: "1", large: "1.125" };

export function hexToRgb(hex) {
  if (!hex) return null;
  let h = String(hex).trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Normalise any 3 or 6 digit hex to lowercase #rrggbb, or return the fallback. */
export function normalizeHex(hex, fallback = "") {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : fallback;
}

/** Mix color toward another by t in [0,1]. */
export function mix(hex, towardHex, t) {
  const a = hexToRgb(hex);
  const b = hexToRgb(towardHex);
  if (!a || !b) return hex;
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

/** Turn a color round the color wheel by deg, keeping its saturation and lightness. */
export function rotateHue(hex, deg) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return rgbToHex(c);
  const sat = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * sat;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const [r1, g1, b1] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbToHex({ r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 });
}

export const darken = (hex, t = 0.12) => mix(hex, "#000000", t);
export const lighten = (hex, t = 0.9) => mix(hex, "#ffffff", t);

export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio between two colors. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black text, whichever reads better on the color. */
export function onColor(hex) {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#181818") ? "#ffffff" : "#181818";
}

export function isDarkSurface(hex) {
  return luminance(hex) < 0.2;
}

function rgba(hex, alpha) {
  const c = hexToRgb(hex) || { r: 1, g: 118, b: 211 };
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

export function resolveTheme(theme) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  if (!LABEL_POSITIONS.includes(t.labelPosition)) t.labelPosition = "above"; // e.g. legacy "floating"
  if (!FIELD_STYLES.includes(t.fieldStyle)) t.fieldStyle = "outline";
  if (!CHOICE_STYLES.includes(t.choiceStyle)) t.choiceStyle = "cards";
  if (!TITLE_ALIGNS.includes(t.titleAlign)) t.titleAlign = "left";
  if (!TITLE_PLACEMENTS.includes(t.titlePlacement)) t.titlePlacement = "page";
  if (!IMAGE_SIDES.includes(t.sideImagePosition)) t.sideImagePosition = "left";
  if (!LOGO_SIZES.includes(t.logoSize)) t.logoSize = "medium";
  if (!COVER_HEIGHTS.includes(t.coverHeight)) t.coverHeight = "medium";
  if (!BUTTON_ALIGNS.includes(t.buttonAlign)) t.buttonAlign = "right";
  if (!BUTTON_SIZES.includes(t.buttonSize)) t.buttonSize = "default";
  if (!BACKGROUND_STYLES.includes(t.backgroundStyle)) t.backgroundStyle = "solid";
  if (!SURFACE_STYLES.includes(t.surfaceStyle)) t.surfaceStyle = "solid";
  if (!BUTTON_SHAPES.includes(t.buttonShape)) t.buttonShape = "corners";
  if (!PROGRESS_STYLES.includes(t.progressStyle)) t.progressStyle = "bar";
  if (!FOCUS_STYLES.includes(t.focusStyle)) t.focusStyle = "none";
  for (const [key, max] of Object.entries(SHADOW_LIMITS)) {
    const n = Number(t[key]);
    t[key] = Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : FINISH_DEFAULTS[key];
  }
  t.shadowColor = normalizeHex(t.shadowColor);
  return t;
}

/** All derived token values, exposed for tests and the Design tab. */
export function themeTokens(theme) {
  const t = resolveTheme(theme);
  const primary = normalizeHex(t.primary, DEFAULT_THEME.primary);
  const text = normalizeHex(t.text, DEFAULT_THEME.text);
  const background = normalizeHex(t.background, DEFAULT_THEME.background);
  const surface = normalizeHex(t.surface, DEFAULT_THEME.surface);
  const label = normalizeHex(t.labelColor, text);
  const dark = isDarkSurface(surface);
  const radius = RADII[t.radius] || RADII.soft;
  const radiusSm = SMALL_RADII[t.radius] || SMALL_RADII.soft;
  const onPrimary = onColor(primary);
  const outlineButton = t.buttonStyle === "outline";

  // Fields
  const field = t.fieldStyle;
  const raisedSurface = dark ? mix(surface, text, 0.06) : surface;
  const filledBg = mix(surface, text, dark ? 0.1 : 0.05);
  const lineColor = mix(text, surface, dark ? 0.62 : 0.72);
  const inputBg = field === "underline" ? "transparent" : field === "filled" ? filledBg : raisedSurface;
  const inputBorder = field === "filled" ? "transparent" : lineColor;
  const inputBorderHover = field === "filled" ? mix(text, surface, 0.7) : mix(text, surface, dark ? 0.4 : 0.5);
  const inputBorderWidth = field === "underline" ? "0 0 1.5px 0" : "1px";
  const inputRadius = field === "underline" ? "0px" : radiusSm;
  const inputPadX = field === "underline" ? "0.125rem" : "0.75rem";
  const focusRing = field === "underline" ? "transparent" : rgba(primary, dark ? 0.45 : 0.25);

  // Labels
  const left = t.labelPosition === "left";
  const labelWidth = ["25", "33", "40"].includes(String(t.labelWidth)) ? `${t.labelWidth}%` : "33%";

  // Choices
  const cards = t.choiceStyle === "cards";
  const primaryTint = dark ? mix(surface, primary, 0.24) : lighten(primary, 0.9);

  const error = dark ? "#ff8f84" : "#ba0517";

  // Mesh: three soft spots of the button color and two neighbours on the color wheel, faded into the page color
  const meshStrength = dark ? 0.38 : 0.3;
  const meshSpot = (deg) => mix(background, deg ? rotateHue(primary, deg) : primary, meshStrength);
  // Glass: the card lets the page show through, blurred; text stays on a card at least 80% opaque
  const glass = t.surfaceStyle === "glass";

  return {
    "--jf-primary": primary,
    "--jf-primary-hover": dark ? lighten(primary, 0.12) : darken(primary, 0.12),
    "--jf-primary-tint": primaryTint,
    "--jf-on-primary": onPrimary,
    "--jf-bg": background,
    "--jf-surface": surface,
    "--jf-text": text,
    "--jf-label": label,
    "--jf-muted": mix(text, surface, 0.42),
    "--jf-placeholder": mix(text, surface, 0.55),
    "--jf-border": mix(text, surface, dark ? 0.75 : 0.82),
    "--jf-error": error,
    "--jf-error-ring": rgba(error, 0.25),
    "--jf-color-scheme": dark ? "dark" : "light",
    "--jf-radius": radius,
    "--jf-radius-sm": radiusSm,
    "--jf-font-heading": fontStack(t.headingFont),
    "--jf-font-body": fontStack(t.bodyFont),
    "--jf-max-width": WIDTHS[t.width] || WIDTHS.medium,
    "--jf-scale": SCALES[t.textSize] || SCALES.medium,

    "--jf-title-align": t.titleAlign === "center" ? "center" : "left",
    "--jf-header-items": t.titleAlign === "center" ? "center" : "flex-start",
    "--jf-logo-h": LOGO_HEIGHTS[t.logoSize] || LOGO_HEIGHTS.medium,
    "--jf-cover-h": COVER_SIZES[t.coverHeight] || COVER_SIZES.medium,

    "--jf-input-bg": inputBg,
    "--jf-input-border": inputBorder,
    "--jf-input-border-hover": inputBorderHover,
    "--jf-input-border-width": inputBorderWidth,
    "--jf-input-radius": inputRadius,
    "--jf-input-padx": inputPadX,
    "--jf-focus-ring": focusRing,

    "--jf-field-cols": left ? `minmax(7rem, ${labelWidth}) minmax(0, 1fr)` : "minmax(0, 1fr)",
    "--jf-left-spacer": left ? "block" : "none",

    "--jf-choice-cols": CHOICE_COLUMNS[cards ? "auto" : 1],
    "--jf-choice-border": cards ? (field === "filled" ? "transparent" : lineColor) : "transparent",
    "--jf-choice-border-width": cards ? "1px" : "0px",
    "--jf-choice-bg": cards ? (field === "filled" ? filledBg : raisedSurface) : "transparent",
    "--jf-choice-on-bg": cards ? primaryTint : "transparent",
    "--jf-choice-on-shadow": cards ? `inset 0 0 0 1px ${primary}` : "none",
    "--jf-choice-pad": cards ? "0.625rem 0.875rem" : "0.25rem 0",
    "--jf-choice-min-h": cards ? "2.75rem" : "2rem",

    "--jf-btn-bg": outlineButton ? "transparent" : primary,
    "--jf-btn-bg-hover": outlineButton ? primaryTint : dark ? lighten(primary, 0.12) : darken(primary, 0.12),
    "--jf-btn-text": outlineButton ? primary : onPrimary,
    "--jf-btn-border": primary,
    "--jf-btn2-text": text,
    "--jf-btn2-border": lineColor,
    "--jf-btn2-bg-hover": mix(surface, text, dark ? 0.12 : 0.05),
    "--jf-btn-radius": t.buttonShape === "pill" ? "999px" : inputRadius,

    // read only by .jf-glass .jf-card, so a solid card has none
    ...(glass
      ? {
          "--jf-card-bg": rgba(surface, dark ? 0.8 : 0.82),
          "--jf-card-border": dark ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.9)",
          "--jf-card-blur": "blur(18px) saturate(1.4)"
        }
      : {}),
    "--jf-card-shadow": t.shadowStrength ? `0 ${t.shadowDistance}px ${t.shadowBlur}px ${rgba(t.shadowColor || "#000000", t.shadowStrength / 100)}` : "none",
    "--jf-mesh-a": meshSpot(0),
    "--jf-mesh-b": meshSpot(60),
    "--jf-mesh-c": meshSpot(-70),

    // SLDS hooks for the base components still in use
    "--slds-c-button-brand-color-background": outlineButton ? "transparent" : primary,
    "--slds-c-button-brand-color-border": primary,
    "--slds-c-button-brand-text-color": outlineButton ? primary : onPrimary,
    "--slds-c-icon-color-foreground-default": mix(text, surface, 0.35),
    "--slds-c-spinner-color-background": primary
  };
}

/** Inline style string for the renderer root. */
export function themeToStyle(theme) {
  return Object.entries(themeTokens(theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
