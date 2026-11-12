import { LightningElement, api } from "lwc";

/** The answer a signature field sends: a PNG as a data URL. JFormSignatureService checks it again on the server. */
export const SIGNATURE_PREFIX = "data:image/png;base64,";
/** Pad heights by config.height, in CSS pixels. */
const PAD_HEIGHTS = { small: 120, medium: 160, large: 220 };
const LINE_WIDTH = 2.5;
/** Strokes shorter than this in total (CSS pixels) are a slip, not a signature. */
const MIN_INK_LENGTH = 12;
/** The saved image is drawn at up to twice the pad's scale, and never larger than this. */
const MAX_EXPORT = { width: 1200, height: 600 };
const EXPORT_MARGIN = 8;
/** The saved image is always dark ink on a transparent background, whatever the form's theme. */
const EXPORT_INK = "#1b1f2a";
const TYPED_FONT = '"Segoe Script", "Bradley Hand", "Snell Roundhand", "Brush Script MT", cursive';
const TYPED_SIZE = 44;
const MAX_TYPED_LENGTH = 100;

export function isSignatureImage(value) {
  return typeof value === "string" && value.startsWith(SIGNATURE_PREFIX) && value.length > SIGNATURE_PREFIX.length;
}

/** Total length of the strokes, in the strokes' own units. */
export function inkLength(strokes) {
  let total = 0;
  for (const points of strokes || []) {
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** The box around every point, widened by margin on each side, or null without ink. */
export function inkBounds(strokes, margin = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const points of strokes || []) {
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX === Infinity) return null;
  return { x: minX - margin, y: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 };
}

/** Scale for the saved image: twice the pad's, smaller when that would pass the size limit. */
export function exportScale(bounds) {
  if (!bounds) return 2;
  return Math.min(2, MAX_EXPORT.width / bounds.width, MAX_EXPORT.height / bounds.height);
}

/** Draws strokes as smooth curves through the midpoints of their points; a single point is a dot. */
function traceStrokes(ctx, strokes, lineWidth, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const points of strokes) {
    if (!points.length) continue;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

/**
 * A signature: drawn with a mouse, finger or pen on a canvas, or typed (config.allowTyped, on unless
 * false) for people who cannot draw. Either way the value is a PNG data URL of dark ink on a
 * transparent background, trimmed to the ink. A value that arrives without strokes (the respondent
 * came back to the page) is shown as an image until it is cleared.
 *
 * Fires `change` ({ value }) with the image, or "" when cleared.
 */
export default class JformSignaturePad extends LightningElement {
  @api value = "";
  @api config;
  @api disabled = false;
  @api ariaLabel;
  @api ariaRequired;
  @api ariaInvalid;
  @api ariaDescribedby;

  mode = "draw";
  typedName = "";
  strokes = [];
  drawing = false;
  canvas;
  resizeObserver;

  // ------------------------------------------------------------ rendering
  get settings() {
    return this.config || {};
  }
  get allowTyped() {
    return this.settings.allowTyped !== false;
  }
  get isTyping() {
    return this.allowTyped && this.mode === "type";
  }
  get hasStrokes() {
    return this.strokes.length > 0;
  }
  get hasImage() {
    return isSignatureImage(this.value);
  }
  /** Typed names and returning answers show as the saved image; drawing shows the live canvas. */
  get showImage() {
    return this.hasImage && (this.isTyping || !this.hasStrokes);
  }
  get showCanvas() {
    return !this.isTyping && !this.showImage;
  }
  get showHint() {
    return !this.hasImage && !this.hasStrokes && !this.isTyping;
  }
  get padHeight() {
    return PAD_HEIGHTS[this.settings.height] || PAD_HEIGHTS.medium;
  }
  get padStyle() {
    return `height: ${this.padHeight}px`;
  }
  get rootClass() {
    return `jf-sig${this.disabled ? " jf-sig-disabled" : ""}`;
  }
  get padClass() {
    const invalid = this.ariaInvalid === "true" || this.ariaInvalid === true;
    return `jf-sig-pad${invalid ? " jf-sig-invalid" : ""}${this.showImage ? " jf-sig-pad-image" : ""}`;
  }
  get modeButtons() {
    return [
      ["draw", "Draw"],
      ["type", "Type"]
    ].map(([value, label]) => ({
      value,
      label,
      checked: this.mode === value ? "true" : "false",
      cls: `jf-sig-mode${this.mode === value ? " jf-sig-mode-on" : ""}`
    }));
  }
  get canvasLabel() {
    const how = this.allowTyped ? "Draw your signature with a mouse, finger or pen, or choose Type to type your name." : "Draw your signature with a mouse, finger or pen.";
    return this.ariaLabel ? `${this.ariaLabel}. ${how}` : how;
  }
  get typedLabel() {
    return this.ariaLabel ? `${this.ariaLabel}: type your full name` : "Type your full name";
  }
  get imageAlt() {
    if (this.isTyping && this.typedName.trim()) return `Signature: ${this.typedName.trim()}`;
    return "Your signature";
  }
  get statement() {
    return typeof this.settings.statement === "string" ? this.settings.statement.trim() : "";
  }
  get clearDisabled() {
    return this.disabled || (!this.hasImage && !this.hasStrokes && !this.typedName);
  }
  get maxTypedLength() {
    return MAX_TYPED_LENGTH;
  }

  // ------------------------------------------------------------ canvas size
  renderedCallback() {
    const canvas = this.template.querySelector(".jf-sig-canvas");
    if (canvas === this.canvas) return;
    this.canvas = canvas;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
    if (!canvas) return;
    this.fitCanvas();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.fitCanvas());
      this.resizeObserver.observe(canvas);
    }
  }
  disconnectedCallback() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
    this.canvas = undefined;
  }

  /** Match the canvas's pixels to its size on screen (and the screen's density), then redraw. */
  fitCanvas() {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (width && height && (canvas.width !== width || canvas.height !== height)) {
      canvas.width = width;
      canvas.height = height;
    }
    this.redraw();
  }

  redraw() {
    const canvas = this.canvas;
    const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // on screen the ink follows the theme's text colour; the saved image does not
    traceStrokes(ctx, this.strokes, LINE_WIDTH, getComputedStyle(canvas).color || EXPORT_INK);
  }

  // ------------------------------------------------------------ drawing
  pointOf(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  handlePointerDown(event) {
    if (this.disabled || !this.canvas || (event.button !== undefined && event.button > 0)) return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch (e) {
      /* capture is a nicety: strokes still end on pointerup */
    }
    this.drawing = true;
    this.strokes = [...this.strokes, [this.pointOf(event)]];
    this.redraw();
  }
  handlePointerMove(event) {
    if (!this.drawing) return;
    event.preventDefault();
    const current = this.strokes[this.strokes.length - 1];
    // a pen or fast finger reports several positions per frame; keep them all for a smooth line
    const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    for (const sample of samples.length ? samples : [event]) current.push(this.pointOf(sample));
    this.redraw();
  }
  handlePointerUp() {
    if (!this.drawing) return;
    this.drawing = false;
    this.emit(inkLength(this.strokes) >= MIN_INK_LENGTH ? this.drawnImage() : "");
  }

  /** The strokes as a PNG data URL: trimmed to the ink, dark ink on a transparent background. */
  drawnImage() {
    const bounds = inkBounds(this.strokes, EXPORT_MARGIN);
    if (!bounds) return "";
    const scale = exportScale(bounds);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(bounds.width * scale));
    out.height = Math.max(1, Math.round(bounds.height * scale));
    const ctx = out.getContext ? out.getContext("2d") : null;
    if (!ctx) return "";
    ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
    traceStrokes(ctx, this.strokes, LINE_WIDTH, EXPORT_INK);
    return out.toDataURL("image/png");
  }

  /** The typed name in a handwriting font, as a PNG data URL. */
  typedImage(name) {
    const out = document.createElement("canvas");
    const ctx = out.getContext ? out.getContext("2d") : null;
    if (!ctx) return "";
    const scale = 2;
    const font = `${TYPED_SIZE}px ${TYPED_FONT}`;
    ctx.font = font;
    const width = Math.min(MAX_EXPORT.width / scale, Math.ceil(ctx.measureText(name).width) + EXPORT_MARGIN * 2);
    const height = Math.round(TYPED_SIZE * 1.6);
    out.width = Math.round(width * scale);
    out.height = Math.round(height * scale);
    // resizing a canvas resets its context
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.font = font;
    ctx.fillStyle = EXPORT_INK;
    ctx.textBaseline = "middle";
    ctx.fillText(name, EXPORT_MARGIN, height / 2, width - EXPORT_MARGIN * 2);
    return out.toDataURL("image/png");
  }

  // ------------------------------------------------------------ controls
  handleMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (this.disabled || mode === this.mode) return;
    this.mode = mode;
    // a drawn and a typed signature never mix: switching starts again
    this.strokes = [];
    this.typedName = "";
    if (this.hasImage) this.emit("");
  }
  handleTyped(event) {
    this.typedName = String(event.target.value || "").slice(0, MAX_TYPED_LENGTH);
    const name = this.typedName.trim();
    this.emit(name ? this.typedImage(name) : "");
  }
  handleClear() {
    if (this.disabled) return;
    this.strokes = [];
    this.typedName = "";
    this.redraw();
    this.emit("");
  }
  handleBlur() {
    this.dispatchEvent(new CustomEvent("blur"));
  }

  emit(value) {
    this.dispatchEvent(new CustomEvent("change", { detail: { value } }));
  }

  @api
  focus() {
    const target = this.template.querySelector(".jf-sig-typed-input, .jf-sig-mode-on, .jf-sig-pad");
    if (target) target.focus();
  }
}
