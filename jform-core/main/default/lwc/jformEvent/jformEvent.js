/**
 * The Event details block: what its card shows, a calendar file (.ics) and a Google Calendar link,
 * from the field's config { date: "YYYY-MM-DD", startTime: "HH:MM", endTime: "HH:MM", location,
 * description, hideCalendar }. Times are the event's own clock times, kept as written (no time zone
 * conversion): calendars add them at that local time. Without a start time the event is all day.
 */
const pad = (n) => String(n).padStart(2, "0");
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export const MAX_LOCATION = 200;
export const MAX_DESCRIPTION = 1000;

/** "2026-11-15" -> a local Date at midnight, or null. */
export function parseDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.getMonth() === Number(m[2]) - 1 ? date : null; // rejects 2026-02-31
}

/** "09:30" or "09:30:00.000" -> { h, m }, or null. */
export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

function clock(time, locale) {
  return new Date(2000, 0, 1, time.h, time.m).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}
function stamp(date, time) {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return time ? `${day}T${pad(time.h)}${pad(time.m)}00` : day;
}

/** Start and end in calendar format, or null without a date. An end at or before the start becomes an hour later. */
export function eventRange(config = {}) {
  const date = parseDate(config.date);
  if (!date) return null;
  const start = parseTime(config.startTime);
  if (!start) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return { allDay: true, start: stamp(date), end: stamp(next) };
  }
  let end = parseTime(config.endTime);
  if (!end || end.h * 60 + end.m <= start.h * 60 + start.m) end = { h: Math.min(23, start.h + 1), m: start.h >= 23 ? 59 : start.m };
  return { allDay: false, start: stamp(date, start), end: stamp(date, end) };
}

/** Everything the card shows. */
export function eventView(config = {}, title = "", locale = undefined) {
  const date = parseDate(config.date);
  const start = parseTime(config.startTime);
  const end = parseTime(config.endTime);
  const parts = [];
  if (date) parts.push(date.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  if (start) parts.push(end && end.h * 60 + end.m > start.h * 60 + start.m ? `${clock(start, locale)} – ${clock(end, locale)}` : clock(start, locale));
  return {
    hasDate: Boolean(date),
    month: date ? date.toLocaleDateString(locale, { month: "short" }).toUpperCase() : "",
    day: date ? String(date.getDate()) : "",
    when: parts.join(" · "),
    location: text(config.location, MAX_LOCATION),
    description: text(config.description, MAX_DESCRIPTION),
    showCalendar: Boolean(date) && !config.hideCalendar,
    googleUrl: date ? googleCalendarUrl(config, title) : ""
  };
}

/** A Google Calendar "add event" link. */
export function googleCalendarUrl(config = {}, title = "") {
  const range = eventRange(config);
  if (!range) return "";
  const params = new URLSearchParams({ action: "TEMPLATE", text: text(title, 200) || "Event", dates: `${range.start}/${range.end}` });
  const details = text(config.description, MAX_DESCRIPTION);
  const location = text(config.location, MAX_LOCATION);
  if (details) params.set("details", details);
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const icsEscape = (value) => String(value).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** RFC 5545 lines stay under 75 characters: longer ones continue on the next line after a space. */
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

/** The calendar file for one event (iCalendar, works in Apple Calendar, Outlook and Google), or "" without a date. */
export function icsText(config = {}, title = "", uid = "event@jform", now = new Date()) {
  const range = eventRange(config);
  if (!range) return "";
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JForm//Event details//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    range.allDay ? `DTSTART;VALUE=DATE:${range.start}` : `DTSTART:${range.start}`,
    range.allDay ? `DTEND;VALUE=DATE:${range.end}` : `DTEND:${range.end}`,
    `SUMMARY:${icsEscape(text(title, 200) || "Event")}`
  ];
  const location = text(config.location, MAX_LOCATION);
  const details = text(config.description, MAX_DESCRIPTION);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (details) lines.push(`DESCRIPTION:${icsEscape(details)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** "Spring Clinic: Day 1" -> "spring-clinic-day-1.ics". */
export function icsFileName(title) {
  const slug = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "event"}.ics`;
}
