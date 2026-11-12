import LANG from "@salesforce/i18n/lang";
import TIME_ZONE from "@salesforce/i18n/timeZone";

/**
 * Dates in the user's UI language (not the locale): an English UI with a Vietnamese locale
 * showed "17 thg 10, 2026" next to English text. Times use the user's Salesforce time zone.
 */
const options = (extra) => {
  const o = { ...extra };
  if (TIME_ZONE) o.timeZone = TIME_ZONE;
  return o;
};
function dateFormat(extra) {
  try {
    return new Intl.DateTimeFormat(LANG || undefined, options(extra));
  } catch (e) {
    return new Intl.DateTimeFormat(undefined, extra);
  }
}
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Calendar day number of a date in the user's time zone. */
function dayNumber(d) {
  const parts = dateFormat({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86400000);
}

/** "Oct 17, 2026" */
export function shortDate(value) {
  const d = toDate(value);
  return d ? dateFormat({ year: "numeric", month: "short", day: "numeric" }).format(d) : "";
}

/** "Oct 31, 2027" for a date without a time (yyyy-mm-dd, as Apex sends a Date): never shifted a day by the time zone. */
export function calendarDate(value) {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return shortDate(value);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const o = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(LANG || undefined, o).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat(undefined, o).format(d);
  }
}

/** "Oct 17, 2026, 10:30 AM" */
export function dateTime(value) {
  const d = toDate(value);
  return d ? dateFormat({ year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) : "";
}

/** "Today", "Yesterday", "3 days ago" within a week, else the short date. */
export function friendlyDate(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return "";
  const days = dayNumber(now) - dayNumber(d);
  if (days < 0 || days > 6) return shortDate(d);
  try {
    const text = new Intl.RelativeTimeFormat(LANG || undefined, { numeric: "auto" }).format(-days, "day");
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch (e) {
    return shortDate(d);
  }
}

// ------------------------------------------------------------ a form's own time zone (opening and closing times)

/** The user's Salesforce time zone, the default for a form's opening and closing times. */
export const USER_TIME_ZONE = TIME_ZONE || "UTC";

/** The parts of a moment's wall clock in a zone, or null for an unknown zone. */
function zonedParts(d, zone, extra) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, ...extra }).formatToParts(d);
    return Object.fromEntries(parts.map((p) => [p.type, p.value]));
  } catch {
    return null;
  }
}
/** A moment's wall clock in a zone, as milliseconds read as if that clock were UTC. */
function wallClock(ms, zone) {
  const p = zonedParts(new Date(ms), zone, { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  if (!p) return ms;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
}

/** "Jan 12, 2027, 9:00 AM PST": a moment in a given zone, in the user's language. */
export function zonedDateTime(value, zone) {
  const d = toDate(value);
  if (!d) return "";
  const o = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat(LANG || undefined, { ...o, timeZone: zone || USER_TIME_ZONE }).format(d);
  } catch {
    return dateTime(d);
  }
}

/** "GMT+11:00", "GMT-08:00" or "GMT", as JFormAvailability.gmtOffset words it. */
function gmtOffset(offsetMs) {
  if (!offsetMs) return "GMT";
  const minutes = Math.round(Math.abs(offsetMs) / 60000);
  const pad = (n) => String(n).padStart(2, "0");
  return `GMT${offsetMs < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "Tuesday 12 January 2027 at 9:00 AM GMT-08:00", worded as JFormAvailability.opensText words it on the server. */
export function opensText(value, zone) {
  const d = toDate(value);
  const at = zone || USER_TIME_ZONE;
  const p = d && zonedParts(d, at, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  if (!p) return "";
  // whole seconds, as the stored times are: the wall clock drops the milliseconds
  const ms = Math.floor(d.getTime() / 1000) * 1000;
  return `${p.weekday} ${p.day} ${p.month} ${p.year} at ${p.hour}:${p.minute} ${p.dayPeriod} ${gmtOffset(wallClock(ms, at) - ms)}`;
}

/** "2027-01-12": the day a moment falls on in a zone, or "" when unreadable. */
export function zonedDay(value, zone) {
  const d = toDate(value);
  const p = d && zonedParts(d, zone || USER_TIME_ZONE, { year: "numeric", month: "2-digit", day: "2-digit" });
  return p ? `${p.year}-${p.month}-${p.day}` : "";
}

/** The same clock time in another zone: 9:00 AM in Los Angeles becomes 9:00 AM in Sydney. ISO 8601 in UTC. */
export function moveToZone(iso, from, to) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || !from || !to || from === to) return iso;
  const wall = wallClock(ms, from);
  // the moment whose clock in the new zone reads the same: two passes settle a daylight saving change
  let at = wall - (wallClock(wall, to) - wall);
  at = wall - (wallClock(at, to) - at);
  return new Date(at).toISOString();
}
