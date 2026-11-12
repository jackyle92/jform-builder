import { collectsAnswer } from "c/jformFieldRegistry";
import { opensText } from "c/jformDates";

/**
 * The welcome and thank-you screens: settings.welcome and settings.ending in the builder's draft, or the
 * cleaned welcome and ending objects the public form receives (JFormScreens in Apex keeps the same rules).
 * The not-yet-open and closed screens: settings.access.notOpen and .closed.
 */
export const WELCOME_MODES = ["off", "message", "screen"];
export const MAX_BUTTONS = 2;
export const MAX_DELAY = 30;
export const MAX_MINUTES = 120;
export const TITLE_MAX = 120;
export const LABEL_MAX = 40;
export const MESSAGE_MAX = 10000;
export const NOT_OPEN = "notOpen";
export const CLOSED = "closed";
/** Roughly how long one question takes, for "Takes about N minutes". */
const SECONDS_PER_QUESTION = 20;

const LINK = /^https?:\/\/[^\s"'<>]+$/i;
const IMAGE = /^(https:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i;

/** True when rich text holds words or an image, not just empty paragraphs. */
export function hasContent(html) {
  const s = String(html || "");
  return /<img\b/i.test(s) || s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}
/** Rich text as one short line of plain text, for summaries in the builder. */
export function plainText(html, max = 140) {
  const t = String(html || "")
    .replace(/<(br|\/p|\/li|\/h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
/** The link when it is http or https, else "". */
export function safeLink(url) {
  const u = String(url || "").trim();
  return u.length <= 1000 && LINK.test(u) ? u : "";
}
/** The image link when it is https or a path on the same site, else "". */
export function safeImage(url) {
  const u = String(url || "").trim();
  return u.length <= 1000 && IMAGE.test(u) ? u : "";
}
/** "example.com" for a link, for "Taking you to example.com". */
export function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ""));
  return m ? m[1].replace(/^www\./i, "") : "";
}
function whole(value) {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isInteger(n) ? n : null;
}
function text(value, max) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Questions people answer (layout blocks and hidden fields do not take time). */
export function questionCount(def) {
  let count = 0;
  for (const s of def?.sections || []) {
    for (const f of s.fields || []) {
      if (collectsAnswer(f.type) && f.type !== "hidden") count += 1;
    }
  }
  return count;
}
/** Minutes a form takes, at about 20 seconds a question; at least one. */
export function estimateMinutes(def) {
  return Math.max(1, Math.ceil((questionCount(def) * SECONDS_PER_QUESTION) / 60));
}

/** "Takes about N minutes" for the start screen, or "" when it does not show the time. */
export function timeTextOf(def) {
  const w = welcomeOf(def);
  if (!w.showTime) return "";
  const minutes = w.minutes || estimateMinutes(def);
  return minutes === 1 ? "Takes about 1 minute" : `Takes about ${minutes} minutes`;
}

/**
 * How the form opens: { mode, title, buttonLabel, showTime, minutes, imageUrl, showHeader }. Without a stored
 * mode a form with a welcome message keeps it above the form, as before the start screen existed. showHeader:
 * the form pages repeat the title, description and logo, which a start screen otherwise shows on its own.
 */
export function welcomeOf(def) {
  const raw = (def?.welcome || def?.settings?.welcome || {});
  const mode = WELCOME_MODES.includes(raw.mode) ? raw.mode : hasContent(def?.welcomeMessage) ? "message" : "off";
  const minutes = whole(raw.minutes);
  return {
    mode,
    title: text(raw.title, TITLE_MAX),
    buttonLabel: text(raw.buttonLabel, LABEL_MAX),
    showTime: raw.showTime === true,
    minutes: minutes !== null && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null,
    imageUrl: safeImage(raw.imageUrl),
    showHeader: raw.showHeader === true
  };
}

/** The thank-you screen's extras: { title, buttons [{label, url}], submitAnother, redirectUrl, redirectDelay }. */
export function endingOf(def) {
  const raw = (def?.ending || def?.settings?.ending || {});
  const buttons = (Array.isArray(raw.buttons) ? raw.buttons : [])
    .map((b) => ({ label: text(b?.label, LABEL_MAX), url: safeLink(b?.url) }))
    .filter((b) => b.label && b.url)
    .slice(0, MAX_BUTTONS);
  const redirectUrl = safeLink(raw.redirectUrl);
  const delay = whole(raw.redirectDelay);
  return {
    title: text(raw.title, TITLE_MAX),
    buttons,
    submitAnother: raw.submitAnother === true,
    redirectUrl,
    redirectDelay: redirectUrl ? Math.max(0, Math.min(MAX_DELAY, delay === null ? 0 : delay)) : 0
  };
}

/** The older plain-text closed message as the closed screen's rich text, as JFormScreens.availabilityView escapes it; "" when none. */
export function olderClosedHtml(message) {
  const older = typeof message === "string" ? message.trim().slice(0, MESSAGE_MAX) : "";
  return older ? `<p>${older.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : "";
}

/**
 * The not-yet-open or closed screen from the builder's draft, for the preview: { state, title, message, imageUrl,
 * opensText }, as JFormAvailability.publicView cleans it for the public form. The closed screen falls back to the
 * older plain-text closedMessage.
 */
export function availabilityOf(def, state) {
  const access = def?.settings?.access || {};
  const raw = access[state] || {};
  let message = hasContent(raw.message) ? String(raw.message).slice(0, MESSAGE_MAX) : "";
  if (state === CLOSED && !message) message = olderClosedHtml(access.closedMessage);
  return {
    state,
    title: text(raw.title, TITLE_MAX),
    message,
    imageUrl: safeImage(raw.imageUrl),
    opensText: state === NOT_OPEN ? opensText(access.openAt, access.timeZone) : ""
  };
}

/** Which of the two screens a draft can reach, so the preview offers them: { notOpen, closed }. */
export function availabilityStops(def) {
  const a = def?.settings?.access || {};
  return {
    notOpen: Boolean(a.openAt || a.notOpen),
    closed: Boolean(a.closeAt || a.closeDate || a.responseLimit || a.closed || a.closedMessage)
  };
}
