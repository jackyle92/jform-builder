import {
  parseISODate, toISODate, todayISO, weekdayOf, addDays, addMonths, localeDateOrder, localeDatePattern, formatDate,
  parseDateText, firstDayOfWeek, weekdayNames, monthGrid, dateLimits, dateProblem,
  parseISOTime, toISOTime, usesTwelveHours, formatTime, parseTimeText, timeStep, timeSlots, timeProblem, prefersNativePicker
} from "c/jformDateTime";

describe("dates", () => {
  it("parses and formats ISO dates without time zone drift", () => {
    expect(parseISODate("2026-10-15")).toEqual({ y: 2026, m: 10, d: 15 });
    expect(parseISODate("2026-02-30")).toBeNull();
    expect(parseISODate("15/10/2026")).toBeNull();
    expect(toISODate(2026, 1, 5)).toBe("2026-01-05");
    expect(weekdayOf("2026-10-15")).toBe(4); // Thursday
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-10");
    expect(formatDate("2026-10-15", "en-US")).toBe("Oct 15, 2026");
    expect(formatDate("2026-10-15", "en-GB")).toBe("15 Oct 2026");
    expect(formatDate("", "en-GB")).toBe("");
    expect(todayISO(new Date(2026, 9, 15, 23, 30))).toBe("2026-10-15");
  });

  it("knows the locale's numeric order and placeholder pattern", () => {
    expect(localeDateOrder("en-US")).toEqual(["m", "d", "y"]);
    expect(localeDateOrder("en-GB")).toEqual(["d", "m", "y"]);
    expect(localeDateOrder("ja-JP")).toEqual(["y", "m", "d"]);
    expect(localeDatePattern("en-GB")).toBe("DD/MM/YYYY");
    expect(localeDatePattern("en-US")).toBe("MM/DD/YYYY");
    expect(localeDatePattern("de-DE")).toBe("DD.MM.YYYY");
  });

  it("reads what people type in their own order", () => {
    expect(parseDateText("2026-10-15", "en-GB")).toBe("2026-10-15");
    expect(parseDateText("15/10/2026", "en-GB")).toBe("2026-10-15");
    expect(parseDateText("10/15/2026", "en-US")).toBe("2026-10-15");
    expect(parseDateText("15.10.26", "de-DE")).toBe("2026-10-15");
    expect(parseDateText("2026/10/15", "en-US")).toBe("2026-10-15"); // the four-digit number is the year wherever it is
    expect(parseDateText("15 Oct 2026", "en-GB")).toBe("2026-10-15");
    expect(parseDateText("October 15, 2026", "en-US")).toBe("2026-10-15");
    expect(parseDateText("31/02/2026", "en-GB")).toBeNull();
    expect(parseDateText("soon", "en-GB")).toBeNull();
    expect(parseDateText("", "en-GB")).toBeNull();
  });

  it("builds a calendar grid starting on the locale's first weekday", () => {
    expect(firstDayOfWeek("en-US")).toBe(0);
    expect(firstDayOfWeek("en-GB")).toBe(1);
    expect(firstDayOfWeek("fr-FR")).toBe(1);
    expect(weekdayNames("en-US", 0).map((d) => d.short)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayNames("en-GB", 1)[0]).toMatchObject({ day: 1, short: "Mon", long: "Monday" });
    const grid = monthGrid(2026, 10, 1);
    expect(grid).toHaveLength(6);
    expect(grid[0][0]).toMatchObject({ iso: "2026-09-28", inMonth: false, weekday: 1 });
    expect(grid[0][3]).toMatchObject({ iso: "2026-10-01", day: 1, inMonth: true });
    expect(grid[4][6]).toMatchObject({ iso: "2026-11-01", inMonth: false });
  });

  it("applies limits and weekday rules", () => {
    const now = new Date(2026, 9, 15);
    expect(dateLimits({ noPast: true }, now)).toEqual({ min: "2026-10-15", max: null });
    expect(dateLimits({ minDate: "2026-01-01", noPast: true }, now)).toEqual({ min: "2026-10-15", max: null });
    expect(dateLimits({ minDate: "2027-01-01", noPast: true }, now)).toEqual({ min: "2027-01-01", max: null });
    expect(dateLimits({ maxDate: "2026-12-31", noFuture: true }, now)).toEqual({ min: null, max: "2026-10-15" });
    expect(dateProblem("2026-10-14", { noPast: true }, "en-GB", now)).toBe("Choose a date on or after 15 Oct 2026");
    expect(dateProblem("2027-01-02", { maxDate: "2027-01-01" }, "en-GB", now)).toBe("Choose a date on or before 1 Jan 2027");
    expect(dateProblem("2026-10-17", { disabledDays: [0, 6] }, "en-GB", now)).toBe("Choose a Monday, Tuesday, Wednesday, Thursday or Friday");
    expect(dateProblem("2026-10-16", { disabledDays: [0, 6], noPast: true }, "en-GB", now)).toBeNull();
    expect(dateProblem("nope", {}, "en-GB", now)).toBe("Enter a valid date");
  });
});

describe("times", () => {
  it("parses, formats and respects the hour format", () => {
    expect(parseISOTime("13:05")).toBe(785);
    expect(parseISOTime("13:05:00")).toBe(785);
    expect(parseISOTime("24:00")).toBeNull();
    expect(toISOTime(785)).toBe("13:05");
    expect(usesTwelveHours({}, "en-US")).toBe(true);
    expect(usesTwelveHours({}, "de-DE")).toBe(false);
    expect(usesTwelveHours({ hourFormat: "24" }, "en-US")).toBe(false);
    expect(usesTwelveHours({ hourFormat: "12" }, "de-DE")).toBe(true);
    expect(formatTime("13:05", {}, "en-US")).toBe("1:05 PM");
    expect(formatTime("13:05", {}, "de-DE")).toBe("13:05");
    expect(formatTime("09:00", { hourFormat: "24" }, "en-US")).toBe("09:00");
  });

  it("reads typed times", () => {
    expect(parseTimeText("9")).toBe("09:00");
    expect(parseTimeText("9:30")).toBe("09:30");
    expect(parseTimeText("9.30pm")).toBe("21:30");
    expect(parseTimeText("9:30 PM")).toBe("21:30");
    expect(parseTimeText("12am")).toBe("00:00");
    expect(parseTimeText("12 pm")).toBe("12:00");
    expect(parseTimeText("21:30")).toBe("21:30");
    expect(parseTimeText("0930")).toBe("09:30");
    expect(parseTimeText("noon")).toBe("12:00");
    expect(parseTimeText("25:00")).toBeNull();
    expect(parseTimeText("13pm")).toBeNull();
  });

  it("offers slots within the field's limits and step", () => {
    expect(timeStep({})).toBe(15);
    expect(timeStep({ step: 30 })).toBe(30);
    expect(timeStep({ step: 0 })).toBe(15);
    const slots = timeSlots({ step: 30, minTime: "09:00", maxTime: "10:30" }, "en-US");
    expect(slots.map((s) => s.value)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(slots[0].label).toBe("9:00 AM");
    expect(timeSlots({ step: 60 }, "en-GB")).toHaveLength(24);
    expect(timeProblem("08:00", { minTime: "09:00" }, "en-US")).toBe("Choose a time at or after 9:00 AM");
    expect(timeProblem("18:00", { maxTime: "17:00" }, "en-GB")).toBe("Choose a time at or before 17:00");
    expect(timeProblem("12:00", { minTime: "09:00", maxTime: "17:00" }, "en-GB")).toBeNull();
    expect(timeProblem("x", {}, "en-GB")).toBe("Enter a valid time");
  });

  it("falls back to the popover when the device cannot say", () => {
    expect(prefersNativePicker()).toBe(false); // jsdom has no matchMedia
  });
});
