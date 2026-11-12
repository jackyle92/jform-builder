import { themeToStyle, resolveTheme, contrastRatio, onColor, mix, hexToRgb, themeTokens, safeImageUrl, rotateHue } from "c/jformTheme";

describe("jformTheme", () => {
  it("resolves defaults", () => {
    expect(resolveTheme(null).primary).toBe("#337418");
    expect(resolveTheme({ primary: "#0f766e" }).radius).toBe("soft");
  });

  it("parses and mixes colors", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("nope")).toBeNull();
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("computes contrast and picks readable text", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(onColor("#0f766e")).toBe("#ffffff");
    expect(onColor("#f1f5f4")).toBe("#181818");
  });

  it("emits CSS variables and SLDS hooks", () => {
    const style = themeToStyle({ primary: "#0f766e", radius: "round", width: "wide", buttonStyle: "outline", headingFont: "serif" });
    expect(style).toContain("--jf-primary:#0f766e");
    expect(style).toContain("--jf-radius:16px");
    expect(style).toContain("--jf-max-width:880px");
    expect(style).toContain("--slds-c-button-brand-color-background:transparent");
    expect(style).toContain("--slds-c-button-brand-text-color:#0f766e");
    expect(style).toContain("--jf-font-heading:Georgia");
  });

  it("falls back on invalid colors", () => {
    expect(themeToStyle({ primary: "blue-ish" })).toContain("--jf-primary:#337418");
  });
});

describe("field and label tokens", () => {
  const { themeTokens, normalizeHex } = require("c/jformTheme");

  it("labels follow the text color unless a label color is set", () => {
    expect(themeTokens({ text: "#f5f5f4", surface: "#1f1f1e" })["--jf-label"]).toBe("#f5f5f4");
    expect(themeTokens({ text: "#181818", labelColor: "#334155" })["--jf-label"]).toBe("#334155");
    expect(themeTokens({ labelColor: "not-a-color" })["--jf-label"]).toBe("#0f0f0f"); // the default text, JForm ink
  });

  it("switches to dark-friendly inputs and errors on a dark card", () => {
    const dark = themeTokens({ surface: "#1f1f1e", text: "#f5f5f4", primary: "#5fd4c4" });
    expect(dark["--jf-color-scheme"]).toBe("dark");
    expect(dark["--jf-error"]).toBe("#ff8f84");
    expect(dark["--jf-input-bg"]).not.toBe("#1f1f1e");
    const light = themeTokens({});
    expect(light["--jf-color-scheme"]).toBe("light");
    expect(light["--jf-error"]).toBe("#ba0517");
  });

  it("puts labels in a left column when labelPosition is left", () => {
    expect(themeTokens({ labelPosition: "left", labelWidth: "40" })["--jf-field-cols"]).toBe("minmax(7rem, 40%) minmax(0, 1fr)");
    expect(themeTokens({ labelPosition: "left" })["--jf-left-spacer"]).toBe("block");
    expect(themeTokens({ labelPosition: "above" })["--jf-field-cols"]).toBe("minmax(0, 1fr)");
    expect(themeTokens({ labelPosition: "floating" })["--jf-field-cols"]).toBe("minmax(0, 1fr)");
  });

  it("styles inputs by field style", () => {
    expect(themeTokens({ fieldStyle: "underline" })["--jf-input-border-width"]).toBe("0 0 1.5px 0");
    expect(themeTokens({ fieldStyle: "underline" })["--jf-input-bg"]).toBe("transparent");
    expect(themeTokens({ fieldStyle: "filled" })["--jf-input-border"]).toBe("transparent");
    expect(themeTokens({ fieldStyle: "outline" })["--jf-input-border-width"]).toBe("1px");
  });

  it("styles choices as cards or a plain list", () => {
    expect(themeTokens({ choiceStyle: "cards" })["--jf-choice-border-width"]).toBe("1px");
    expect(themeTokens({ choiceStyle: "list" })["--jf-choice-border-width"]).toBe("0px");
    expect(themeTokens({ choiceStyle: "list" })["--jf-choice-on-shadow"]).toBe("none");
  });

  it("normalises hex colors", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("zzz", "#000000")).toBe("#000000");
  });
});

describe("header and image tokens", () => {
  it("aligns the header and sizes the logo and cover", () => {
    const t = themeTokens({ titleAlign: "center", logoSize: "large", coverHeight: "tall" });
    expect(t["--jf-title-align"]).toBe("center");
    expect(t["--jf-header-items"]).toBe("center");
    expect(t["--jf-logo-h"]).toBe("4.5rem");
    expect(t["--jf-cover-h"]).toBe("18rem");
    expect(themeTokens({})["--jf-title-align"]).toBe("left");
    expect(themeTokens({})["--jf-header-items"]).toBe("flex-start");
    expect(resolveTheme({ titlePlacement: "banner", sideImagePosition: "top", logoSize: "huge" })).toMatchObject({ titlePlacement: "page", sideImagePosition: "left", logoSize: "medium" });
  });

  it("only lets font names through to the inline style", () => {
    expect(themeTokens({ headingFont: "serif" })["--jf-font-heading"]).toBe('Georgia, "Times New Roman", serif');
    expect(themeTokens({ bodyFont: 'Inter, "Helvetica Neue", sans-serif' })["--jf-font-body"]).toBe('Inter, "Helvetica Neue", sans-serif');
    const system = themeTokens({})["--jf-font-body"];
    expect(themeTokens({ bodyFont: "x;background:url(https://evil.example/p.gif)" })["--jf-font-body"]).toBe(system);
    expect(themeTokens({ bodyFont: "Arial) format(woff" })["--jf-font-body"]).toBe(system);
    expect(themeTokens({ bodyFont: "" })["--jf-font-body"]).toBe(system);
  });

  it("only accepts http(s) and site-relative image URLs", () => {
    expect(safeImageUrl(" https://cdn.example.com/a.png ")).toBe("https://cdn.example.com/a.png");
    expect(safeImageUrl("/sfsites/c/file-asset/logo.png")).toBe("/sfsites/c/file-asset/logo.png");
    expect(safeImageUrl("//evil.example.com/a.png")).toBe("");
    expect(safeImageUrl("javascript:alert(1)")).toBe("");
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBe("");
    expect(safeImageUrl('https://x.example.com/a.png" onerror="x')).toBe("");
    expect(safeImageUrl(undefined)).toBe("");
  });
});

describe("footer buttons in the theme", () => {
  it("defaults to the right at the standard size and rejects unknown values", () => {
    expect(resolveTheme({})).toMatchObject({ buttonAlign: "right", buttonSize: "default" });
    expect(resolveTheme({ buttonAlign: "full", buttonSize: "large" })).toMatchObject({ buttonAlign: "full", buttonSize: "large" });
    expect(resolveTheme({ buttonAlign: "middle", buttonSize: 3 })).toMatchObject({ buttonAlign: "right", buttonSize: "default" });
  });
});


describe("page and card finish", () => {
  it("defaults to a plain page and card, and rejects unknown values", () => {
    expect(resolveTheme({})).toMatchObject({ backgroundStyle: "solid", surfaceStyle: "solid", buttonShape: "corners", progressStyle: "bar", focusStyle: "none" });
    expect(resolveTheme({ backgroundStyle: "stars", surfaceStyle: "frosted", buttonShape: "round", progressStyle: "dots", focusStyle: "on" })).toMatchObject({
      backgroundStyle: "solid",
      surfaceStyle: "solid",
      buttonShape: "corners",
      progressStyle: "bar",
      focusStyle: "none"
    });
  });

  it("turns colors round the color wheel", () => {
    expect(rotateHue("#ff0000", 120)).toBe("#00ff00");
    expect(rotateHue("#ff0000", -120)).toBe("#0000ff");
    expect(rotateHue("#808080", 90)).toBe("#808080"); // grey has no hue
  });

  it("makes a translucent, blurred card for glass and a solid one otherwise", () => {
    const solid = themeTokens({ surface: "#ffffff" });
    expect(solid).not.toHaveProperty("--jf-card-bg"); // the solid card uses the form color itself
    expect(solid).not.toHaveProperty("--jf-card-blur");
    const glass = themeTokens({ surface: "#ffffff", surfaceStyle: "glass" });
    expect(glass["--jf-card-bg"]).toBe("rgba(255, 255, 255, 0.82)");
    expect(glass["--jf-card-blur"]).toContain("blur(");
  });

  it("gives the card a soft shadow by default and builds it from blur, distance, strength and color", () => {
    expect(themeTokens({})["--jf-card-shadow"]).toBe("0 1px 2px rgba(0, 0, 0, 0.04)");
    expect(themeTokens({ shadowBlur: 24, shadowDistance: 12, shadowStrength: 12, shadowColor: "#5b3df5" })["--jf-card-shadow"]).toBe("0 12px 24px rgba(91, 61, 245, 0.12)");
    expect(themeTokens({ shadowStrength: 0 })["--jf-card-shadow"]).toBe("none");
    expect(themeTokens({ surfaceStyle: "glass" })["--jf-card-shadow"]).toBe("0 1px 2px rgba(0, 0, 0, 0.04)"); // glass keeps the form's shadow
  });

  it("keeps the shadow settings in range", () => {
    expect(resolveTheme({ shadowBlur: 500, shadowDistance: -3, shadowStrength: "12.6", shadowColor: "red" })).toMatchObject({ shadowBlur: 80, shadowDistance: 0, shadowStrength: 13, shadowColor: "" });
    expect(resolveTheme({ shadowBlur: "lots" }).shadowBlur).toBe(2);
  });

  it("rounds buttons fully for pill and follows the field corners otherwise", () => {
    expect(themeTokens({ buttonShape: "pill" })["--jf-btn-radius"]).toBe("999px");
    expect(themeTokens({ radius: "round" })["--jf-btn-radius"]).toBe("10px");
  });

  it("fades the mesh spots into the page color", () => {
    const k = themeTokens({ primary: "#5b3df5", background: "#f6f5fb", backgroundStyle: "mesh" });
    expect(k["--jf-mesh-a"]).toBe(mix("#f6f5fb", "#5b3df5", 0.3));
    expect(k["--jf-mesh-b"]).not.toBe(k["--jf-mesh-a"]);
    expect(contrastRatio(k["--jf-mesh-a"], "#14122b")).toBeGreaterThan(7); // text stays readable over the page
  });
});
