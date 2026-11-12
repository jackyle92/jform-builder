import { welcomeOf, endingOf, estimateMinutes, questionCount, safeLink, safeImage, hostOf, hasContent, timeTextOf } from "c/jformScreens";

const def = (extra = {}) => ({
  sections: [{ key: "p1", fields: [{ key: "a", type: "text" }, { key: "h", type: "heading" }, { key: "x", type: "hidden" }, { key: "b", type: "email" }, { key: "c", type: "radio" }, { key: "d", type: "date" }] }],
  ...extra
});

describe("c/jformScreens", () => {
  it("keeps a form's welcome message above the form until a mode is chosen", () => {
    expect(welcomeOf(def()).mode).toBe("off");
    expect(welcomeOf(def({ welcomeMessage: "<p>Hi</p>" })).mode).toBe("message");
    expect(welcomeOf(def({ welcomeMessage: "<p><br></p>" })).mode).toBe("off");
    expect(welcomeOf(def({ welcomeMessage: "<p>Hi</p>", settings: { welcome: { mode: "screen" } } })).mode).toBe("screen");
  });

  it("reads the public welcome object first and cleans what it holds", () => {
    const w = welcomeOf(def({ welcome: { mode: "screen", title: "  Hello   there ", minutes: "4", showTime: true, imageUrl: "javascript:x" } }));
    expect(w).toMatchObject({ mode: "screen", title: "Hello there", minutes: 4, showTime: true, imageUrl: "" });
    expect(welcomeOf(def({ settings: { welcome: { minutes: 500 } } })).minutes).toBeNull();
  });

  it("keeps only usable thank-you buttons and a safe redirect", () => {
    const e = endingOf(
      def({
        settings: {
          ending: {
            buttons: [{ label: "Home", url: "https://example.com" }, { label: "", url: "https://x.com" }, { label: "Bad", url: "javascript:alert(1)" }, { label: "Two", url: "http://two.example" }],
            redirectUrl: "https://example.com/next",
            redirectDelay: 99,
            submitAnother: true
          }
        }
      })
    );
    expect(e.buttons.map((b) => b.label)).toEqual(["Home", "Two"]);
    expect(e.redirectDelay).toBe(30);
    expect(e.submitAnother).toBe(true);
    expect(endingOf(def({ ending: { redirectUrl: "ftp://x", redirectDelay: 5 } }))).toMatchObject({ redirectUrl: "", redirectDelay: 0 });
  });

  it("estimates time from the questions people answer", () => {
    expect(questionCount(def())).toBe(4); // not the heading or the hidden field
    expect(estimateMinutes(def())).toBe(2);
    expect(estimateMinutes({ sections: [] })).toBe(1);
    expect(timeTextOf(def({ welcome: { mode: "screen" } }))).toBe("");
    expect(welcomeOf(def({ welcome: { mode: "screen" } })).showHeader).toBe(false);
    expect(welcomeOf(def({ welcome: { mode: "screen", showHeader: true } })).showHeader).toBe(true);
    expect(timeTextOf(def({ welcome: { mode: "screen", showTime: true } }))).toBe("Takes about 2 minutes");
    expect(timeTextOf(def({ welcome: { mode: "screen", showTime: true, minutes: 1 } }))).toBe("Takes about 1 minute");
  });

  it("checks links and images", () => {
    expect(safeLink("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeLink("example.com")).toBe("");
    expect(safeImage("/sfsites/c/img.png")).toBe("/sfsites/c/img.png");
    expect(safeImage("//evil.example/x.png")).toBe("");
    expect(hostOf("https://www.example.com/path")).toBe("example.com");
    expect(hasContent("<p><img src='/x.png'></p>")).toBe(true);
  });
});
