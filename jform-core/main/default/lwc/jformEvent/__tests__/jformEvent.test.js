import { parseDate, parseTime, eventRange, eventView, googleCalendarUrl, icsText, icsFileName } from "c/jformEvent";

describe("c/jformEvent", () => {
  const config = { date: "2026-11-15", startTime: "09:00", endTime: "12:30", location: "WestTiger Dojo, 12 Main St", description: "Bring water; wear loose clothes.\nParking at the back." };

  it("reads dates and times, rejecting impossible ones", () => {
    expect(parseDate("2026-11-15").getDate()).toBe(15);
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("tomorrow")).toBeNull();
    expect(parseTime("09:30:00.000")).toEqual({ h: 9, m: 30 });
    expect(parseTime("25:00")).toBeNull();
  });

  it("builds a timed range, an all-day range and fixes an end before the start", () => {
    expect(eventRange(config)).toEqual({ allDay: false, start: "20261115T090000", end: "20261115T123000" });
    expect(eventRange({ date: "2026-12-31" })).toEqual({ allDay: true, start: "20261231", end: "20270101" });
    expect(eventRange({ date: "2026-11-15", startTime: "10:00", endTime: "09:00" }).end).toBe("20261115T110000");
    expect(eventRange({ startTime: "10:00" })).toBeNull();
  });

  it("shows the card's date badge, when, where and what", () => {
    const view = eventView(config, "Spring Clinic", "en-US");
    expect(view).toMatchObject({ hasDate: true, month: "NOV", day: "15", location: "WestTiger Dojo, 12 Main St", showCalendar: true });
    expect(view.when).toContain("Sunday, November 15, 2026");
    expect(view.when).toMatch(/9:00\s?AM – 12:30\s?PM/);
    expect(eventView({ ...config, hideCalendar: true }, "x", "en-US").showCalendar).toBe(false);
    expect(eventView({}, "x", "en-US")).toMatchObject({ hasDate: false, when: "", showCalendar: false, googleUrl: "" });
  });

  it("links to Google Calendar with the event filled in", () => {
    const url = new URL(googleCalendarUrl(config, "Spring Clinic"));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Spring Clinic");
    expect(url.searchParams.get("dates")).toBe("20261115T090000/20261115T123000");
    expect(url.searchParams.get("location")).toBe("WestTiger Dojo, 12 Main St");
  });

  it("writes a valid calendar file: escaped text, CRLF lines folded under 75 characters", () => {
    const ics = icsText(config, "Spring Clinic; Day 1", "abc@jform", new Date(Date.UTC(2026, 9, 21, 8, 5, 9)));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTAMP:20261021T080509Z");
    expect(ics).toContain("DTSTART:20261115T090000\r\nDTEND:20261115T123000");
    expect(ics).toContain("SUMMARY:Spring Clinic\; Day 1");
    expect(ics).toContain("LOCATION:WestTiger Dojo\\, 12 Main St");
    expect(ics).toContain("DESCRIPTION:Bring water\; wear loose clothes.\\nParking at the back.");
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
    expect(icsText({ date: "2026-12-31" }, "NYE")).toContain("DTSTART;VALUE=DATE:20261231");
    expect(icsText({}, "No date")).toBe("");
  });

  it("names the file after the event", () => {
    expect(icsFileName("Spring Clinic: Day 1")).toBe("spring-clinic-day-1.ics");
    expect(icsFileName("")).toBe("event.ics");
  });
});
