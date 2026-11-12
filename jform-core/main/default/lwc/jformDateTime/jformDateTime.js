/**
 * Dates and times for the pickers and for validation. Stored values never change:
 * a date is "YYYY-MM-DD" and a time is "HH:mm" (24-hour), exactly what the native
 * inputs produced before. Everything locale-aware (display, typed entry, week start)
 * lives here, so the components stay about markup and keyboard handling.
 *
 * Field config (JSON "config" on the field, see Config_JSON__c):
 *   date: { minDate, maxDate: "YYYY-MM-DD", noPast, noFuture: boolean, disabledDays: [0..6] (0 = Sunday) }
 *   time: { step: minutes, minTime, maxTime: "HH:mm", hourFormat: "auto" | "12" | "24" }
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
/** Locales whose week starts on Sunday when Intl cannot say (the common ones). */
const SUNDAY_FIRST = /^(en-(US|CA|AU|NZ|IN|ZA|PH)|ja|ko|zh|he|pt-BR|es-(US|MX)|fil|th|ar)/i;
const SATURDAY_FIRST = /^(ar-(EG|SA|AE|KW|QA|BH|OM)|fa|ps)/i;
export const DEFAULT_TIME_STEP = 15;

export function currentLocale() {
  try {
    return (typeof navigator !== "undefined" && (navigator.language || navigator.languages?.[0])) || "en-US";
  } catch (e) {
    return "en-US";
  }
}

/** Touch-first devices get the platform pickers, which beat any web popover on a phone. */
export function prefersNativePicker() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches === true;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------ dates
const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → { y, m (1-12), d } when it names a real day, else null. */
export function parseISODate(value) {
  const match = ISO_DATE.exec(String(value || "").trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}
export function toISODate(y, m, d) {
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function todayISO(now = new Date()) {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
/** 0 = Sunday … 6 = Saturday, for an ISO date. */
export function weekdayOf(iso) {
  const p = parseISODate(iso);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : null;
}
export function addDays(iso, n) {
  const p = parseISODate(iso);
  if (!p) return iso;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return toISODate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function addMonths(iso, n) {
  const p = parseISODate(iso);
  if (!p) return iso;
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toISODate(y, m, Math.min(p.d, daysInMonth(y, m)));
}
export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The order of day, month and year in the locale's numeric dates, e.g. ["d", "m", "y"]. */
export function localeDateOrder(locale = currentLocale()) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(2001, 11, 25));
    const order = parts.filter((p) => ["day", "month", "year"].includes(p.type)).map((p) => p.type[0]);
    if (order.length === 3) return order;
  } catch (e) {
    /* fall through */
  }
  return ["m", "d", "y"];
}
/** The pattern hint shown as a placeholder, e.g. "DD/MM/YYYY". */
export function localeDatePattern(locale = currentLocale()) {
  const names = { d: "DD", m: "MM", y: "YYYY" };
  let sep = "/";
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(2001, 11, 25));
    const lit = parts.find((p) => p.type === "literal");
    if (lit && lit.value.trim()) sep = lit.value.trim();
  } catch (e) {
    /* keep "/" */
  }
  return localeDateOrder(locale).map((k) => names[k]).join(sep);
}

/** "2026-10-15" → "15 Oct 2026" (locale medium), "" for nothing, the raw text when not a date. */
export function formatDate(iso, locale = currentLocale(), options = { year: "numeric", month: "short", day: "numeric" }) {
  const p = parseISODate(iso);
  if (!p) return iso ? String(iso) : "";
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
  } catch (e) {
    return iso;
  }
}
export function formatDateLong(iso, locale = currentLocale()) {
  return formatDate(iso, locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/**
 * Typed entry → ISO. Accepts ISO itself, the locale's numeric order with any separator
 * ("15/10/2026", "15.10.26"), and "15 Oct 2026" / "Oct 15, 2026" style text. Null when unsure.
 */
export function parseDateText(text, locale = currentLocale()) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (ISO_DATE.test(raw)) return parseISODate(raw) ? raw : null;
  const nums = raw.match(/\d+/g);
  if (nums && nums.length === 3 && !/[a-z]/i.test(raw)) {
    const order = localeDateOrder(locale);
    const parts = {};
    // a four-digit number is the year wherever it sits
    const yearAt = nums.findIndex((n) => n.length === 4);
    if (yearAt >= 0) {
      const rest = nums.filter((_, i) => i !== yearAt);
      const dm = order.filter((k) => k !== "y");
      parts.y = Number(nums[yearAt]);
      parts[dm[0]] = Number(rest[0]);
      parts[dm[1]] = Number(rest[1]);
    } else {
      order.forEach((k, i) => (parts[k] = Number(nums[i])));
      if (parts.y < 100) parts.y += parts.y < 70 ? 2000 : 1900;
    }
    const iso = toISODate(parts.y, parts.m, parts.d);
    return parseISODate(iso) ? iso : null;
  }
  // month names: try the locale's and English short/long names
  const monthIndex = monthFromName(raw, locale);
  if (monthIndex !== null) {
    const digits = raw.replace(/[a-z]+\.?/gi, " ").match(/\d+/g) || [];
    if (digits.length === 2) {
      let y = Number(digits.find((n) => n.length === 4) ?? digits[1]);
      const d = Number(digits.find((n) => n.length !== 4) ?? digits[0]);
      if (y < 100) y += 2000;
      const iso = toISODate(y, monthIndex + 1, d);
      return parseISODate(iso) ? iso : null;
    }
  }
  return null;
}
function monthFromName(text, locale) {
  const lower = text.toLowerCase();
  const candidates = [];
  for (const loc of new Set([locale, "en-US"])) {
    for (const month of ["long", "short"]) {
      try {
        const f = new Intl.DateTimeFormat(loc, { month, timeZone: "UTC" });
        for (let i = 0; i < 12; i++) candidates.push({ i, name: f.format(new Date(Date.UTC(2001, i, 1))).toLowerCase().replace(/\.$/, "") });
      } catch (e) {
        /* skip */
      }
    }
  }
  const hit = candidates.sort((a, b) => b.name.length - a.name.length).find((c) => c.name.length >= 3 && lower.includes(c.name));
  return hit ? hit.i : null;
}

export function firstDayOfWeek(locale = currentLocale()) {
  try {
    const info = typeof Intl.Locale === "function" ? new Intl.Locale(locale) : null;
    const week = info && (typeof info.getWeekInfo === "function" ? info.getWeekInfo() : info.weekInfo);
    if (week && week.firstDay) return week.firstDay % 7; // Intl: 1 = Monday … 7 = Sunday
  } catch (e) {
    /* fall through */
  }
  if (SATURDAY_FIRST.test(locale)) return 6;
  return SUNDAY_FIRST.test(locale) ? 0 : 1;
}
/** Weekday captions starting on the locale's first day: [{ day, short, long }]. */
export function weekdayNames(locale = currentLocale(), firstDay = firstDayOfWeek(locale)) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const day = (firstDay + i) % 7;
    const date = new Date(Date.UTC(2023, 0, 1 + day)); // 2023-01-01 was a Sunday
    let short = String("SMTWTFS"[day]);
    let long = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
    try {
      short = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date).replace(/\.$/, "").slice(0, 3);
      long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
    } catch (e) {
      /* defaults */
    }
    out.push({ day, short, long });
  }
  return out;
}
export function monthNames(locale = currentLocale()) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    let name = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][i];
    try {
      name = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2001, i, 1)));
    } catch (e) {
      /* default */
    }
    out.push({ value: i + 1, label: name });
  }
  return out;
}

/** The six-week grid shown for a month: rows of { iso, day, inMonth, weekday }. */
export function monthGrid(y, m, firstDay = 1) {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() - firstDay + 7) % 7;
  const start = addDays(toISODate(y, m, 1), -lead);
  const rows = [];
  let cursor = start;
  for (let r = 0; r < 6; r++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      const p = parseISODate(cursor);
      row.push({ iso: cursor, day: p.d, inMonth: p.m === m && p.y === y, weekday: (firstDay + c) % 7 });
      cursor = addDays(cursor, 1);
    }
    rows.push(row);
  }
  return rows;
}

/** The effective limits of a date field: { min, max } as ISO or null. */
export function dateLimits(config, now = new Date()) {
  const c = config || {};
  const today = todayISO(now);
  let min = parseISODate(c.minDate) ? c.minDate : null;
  let max = parseISODate(c.maxDate) ? c.maxDate : null;
  if (c.noPast === true && (!min || min < today)) min = today;
  if (c.noFuture === true && (!max || max > today)) max = today;
  return { min, max };
}
export function disabledDays(config) {
  const raw = config?.disabledDays;
  return Array.isArray(raw) ? raw.map(Number).filter((n) => n >= 0 && n <= 6) : [];
}
/** Why an ISO date cannot be chosen, or null when it can. */
export function dateProblem(iso, config, locale = currentLocale(), now = new Date()) {
  if (!parseISODate(iso)) return "Enter a valid date";
  const { min, max } = dateLimits(config, now);
  if (min && iso < min) return `Choose a date on or after ${formatDate(min, locale)}`;
  if (max && iso > max) return `Choose a date on or before ${formatDate(max, locale)}`;
  const off = disabledDays(config);
  if (off.length && off.includes(weekdayOf(iso))) {
    const names = weekdayNames(locale, 0);
    const allowed = names.filter((n) => !off.includes(n.day)).map((n) => n.long);
    return allowed.length ? `Choose a ${listOf(allowed)}` : "No day of the week is available";
  }
  return null;
}
/** "A, B or C". */
export function listOf(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// ------------------------------------------------------------------ times
/** "HH:mm" (seconds tolerated) → minutes since midnight, or null. */
export function parseISOTime(value) {
  const match = ISO_TIME.exec(String(value || "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
export function toISOTime(minutes) {
  const total = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
/** Whether the locale writes times with am/pm, unless the field says otherwise. */
export function usesTwelveHours(config, locale = currentLocale()) {
  const f = config?.hourFormat;
  if (f === "12" || f === 12) return true;
  if (f === "24" || f === 24) return false;
  try {
    const parts = new Intl.DateTimeFormat(locale, { hour: "numeric" }).formatToParts(new Date(2001, 0, 1, 13));
    return parts.some((p) => p.type === "dayPeriod");
  } catch (e) {
    return false;
  }
}
/** "13:05" → "1:05 PM" or "13:05" per the locale and config. */
export function formatTime(iso, config, locale = currentLocale()) {
  const mins = parseISOTime(iso);
  if (mins === null) return iso ? String(iso) : "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: usesTwelveHours(config, locale), timeZone: "UTC" }).format(new Date(Date.UTC(2001, 0, 1, h, m)));
  } catch (e) {
    return iso;
  }
}
/** Typed entry → "HH:mm": "9", "9:30", "9.30pm", "21:30", "0930", "noon". Null when unsure. */
export function parseTimeText(text) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "noon" || raw === "midday") return "12:00";
  if (raw === "midnight") return "00:00";
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*([ap])?\.?\s*m?\.?$/.exec(raw.replace(/\s+/g, " "));
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2] || 0);
  const period = match[3];
  if (m > 59) return null;
  if (period) {
    if (h < 1 || h > 12) return null;
    if (period === "a" && h === 12) h = 0;
    if (period === "p" && h < 12) h += 12;
  } else if (h > 23) {
    return null;
  }
  return toISOTime(h * 60 + m);
}
export function timeStep(config) {
  const n = Number(config?.step);
  return Number.isFinite(n) && n >= 1 && n <= 720 ? Math.round(n) : DEFAULT_TIME_STEP;
}
export function timeLimits(config) {
  const min = parseISOTime(config?.minTime);
  const max = parseISOTime(config?.maxTime);
  return { min: min === null ? 0 : min, max: max === null ? 1439 : max };
}
/** The choices offered by the picker: [{ value: "HH:mm", label }]. */
export function timeSlots(config, locale = currentLocale()) {
  const step = timeStep(config);
  const { min, max } = timeLimits(config);
  const out = [];
  for (let t = min; t <= max; t += step) {
    const value = toISOTime(t);
    out.push({ value, label: formatTime(value, config, locale) });
  }
  return out;
}
/** Why a time cannot be chosen, or null when it can. */
export function timeProblem(iso, config, locale = currentLocale()) {
  const mins = parseISOTime(iso);
  if (mins === null) return "Enter a valid time";
  const { min, max } = timeLimits(config);
  if (mins < min) return `Choose a time at or after ${formatTime(toISOTime(min), config, locale)}`;
  if (mins > max) return `Choose a time at or before ${formatTime(toISOTime(max), config, locale)}`;
  return null;
}
