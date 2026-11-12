import { shortDate, dateTime, friendlyDate, calendarDate, zonedDateTime, opensText, moveToZone, USER_TIME_ZONE } from "c/jformDates";

// Jest resolves @salesforce/i18n/lang to "en" and timeZone to America/Los_Angeles
describe("c/jformDates", () => {
  const now = new Date("2026-10-17T19:00:00Z"); // Oct 17, 12:00 in Los Angeles

  it("formats in the UI language and the user's time zone", () => {
    expect(shortDate("2026-10-12T19:00:00Z")).toBe("Oct 12, 2026");
    expect(dateTime("2026-10-12T17:30:00Z")).toMatch(/^Oct 12, 2026,? 10:30\sAM$/);
  });

  it("says Today, Yesterday and N days ago within a week, then the date", () => {
    expect(friendlyDate("2026-10-17T16:00:00Z", now)).toBe("Today");
    expect(friendlyDate("2026-10-16T16:00:00Z", now)).toBe("Yesterday");
    expect(friendlyDate("2026-10-14T16:00:00Z", now)).toBe("3 days ago");
    expect(friendlyDate("2026-10-01T16:00:00Z", now)).toBe("Oct 1, 2026");
  });

  it("uses the user's calendar day, not UTC's", () => {
    // 03:00 UTC on Oct 17 is still Oct 16 in Los Angeles
    expect(friendlyDate("2026-10-17T03:00:00Z", now)).toBe("Yesterday");
  });

  it("shows a date without a time as that day in every time zone", () => {
    // UTC midnight of Oct 31 is still Oct 30 in Los Angeles; the day itself must not move
    expect(calendarDate("2027-10-31")).toBe("Oct 31, 2027");
    expect(calendarDate(null)).toBe("");
  });

  it("returns nothing for empty or invalid values", () => {
    expect(shortDate(null)).toBe("");
    expect(friendlyDate("not a date", now)).toBe("");
  });
});

describe("c/jformDates in a form's own time zone", () => {
  it("words the opening time as the server does, in the form's zone", () => {
    expect(opensText("2027-01-12T17:00:00Z", "America/Los_Angeles")).toBe("Tuesday 12 January 2027 at 9:00 AM GMT-08:00");
    expect(opensText("2027-07-12T16:30:00Z", "America/Los_Angeles")).toBe("Monday 12 July 2027 at 9:30 AM GMT-07:00");
    // the same words as JFormAvailabilityTest: the builder reads what respondents read
    expect(opensText("2027-01-12T17:00:00Z", "Australia/Sydney")).toBe("Wednesday 13 January 2027 at 4:00 AM GMT+11:00");
    expect(opensText("2027-07-12T17:00:00.000Z", "Asia/Kolkata")).toBe("Monday 12 July 2027 at 10:30 PM GMT+05:30");
    expect(opensText("2027-07-12T17:00:00Z", "UTC")).toBe("Monday 12 July 2027 at 5:00 PM GMT");
    expect(opensText("", "America/Los_Angeles")).toBe("");
    expect(opensText("2027-01-12T17:00:00Z", "Mars/Base")).toBe("");
    expect(zonedDateTime("2027-01-12T17:00:00Z", "America/Los_Angeles")).toBe("Jan 12, 2027, 9:00 AM PST");
    expect(USER_TIME_ZONE).toBe("America/Los_Angeles");
  });

  it("keeps the clock time when the zone changes, across daylight saving", () => {
    // 9:00 AM in Los Angeles in January is 9:00 AM in Sydney, in its summer time
    expect(moveToZone("2027-01-12T17:00:00.000Z", "America/Los_Angeles", "Australia/Sydney")).toBe("2027-01-11T22:00:00.000Z");
    // 9:00 AM in Los Angeles in July (PDT) is 9:00 AM in London (BST)
    expect(moveToZone("2027-07-12T16:00:00.000Z", "America/Los_Angeles", "Europe/London")).toBe("2027-07-12T08:00:00.000Z");
    expect(moveToZone("2027-07-12T16:00:00.000Z", "Europe/London", "Europe/London")).toBe("2027-07-12T16:00:00.000Z");
    expect(moveToZone("soon", "Europe/London", "UTC")).toBe("soon");
  });
});

