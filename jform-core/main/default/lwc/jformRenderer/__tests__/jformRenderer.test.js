import { createElement } from "lwc";
import JformRenderer from "c/jformRenderer";
import submitWithSource from "@salesforce/apex/JFormPublicController.submitWithSource";
import attachFile from "@salesforce/apex/JFormPublicController.attachFile";
import startSubmission from "@salesforce/apex/JFormPublicController.startSubmission";
import getPublishedDefinition from "@salesforce/apex/JFormPublicController.getPublishedDefinition";
import submitWithPayment from "@salesforce/apex/JFormPublicController.submitWithPayment";
import getPaymentStatus from "@salesforce/apex/JFormPublicController.getPaymentStatus";
import cancelPayment from "@salesforce/apex/JFormPublicController.cancelPayment";
import checkPromotionCode from "@salesforce/apex/JFormPublicController.checkPromotionCode";
import getAvailabilityScreen from "@salesforce/apex/JFormPublicController.getAvailabilityScreen";

jest.mock("@salesforce/apex/JFormPublicController.submitWithSource", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.attachFile", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.getPublishedDefinition", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.startSubmission", () => ({ default: jest.fn(() => Promise.resolve("")) }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.submitWithPayment", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.getPaymentStatus", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.cancelPayment", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.checkPromotionCode", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("@salesforce/apex/JFormPublicController.getAvailabilityScreen", () => ({ default: jest.fn(() => Promise.resolve(null)) }), { virtual: true });

const definition = {
  name: "Clinic",
  label: "Register for the clinic",
  displayStyle: "Single Page",
  theme: { primary: "#5fd4c4", surface: "#1f1f1e", background: "#141413", text: "#f5f5f4", labelPosition: "left", fieldStyle: "filled" },
  sections: [
    {
      key: "p1",
      name: "Page 1",
      fields: [
        { key: "transport", type: "radio", label: "How will you get here?", options: [{ label: "Driving" }, { label: "Walking" }] },
        { key: "parking", type: "yesno", label: "Parking permit?", conditionalLogic: { action: "show", match: "all", conditions: [{ field: "transport", operator: "equals", value: "Driving" }] } },
        { key: "first_name", type: "text", label: "First name", width: 50 }
      ]
    }
  ]
};

function mount() {
  const el = createElement("c-jform-renderer", { is: JformRenderer });
  el.definition = definition;
  el.previewMode = true;
  document.body.appendChild(el);
  return el;
}
const flush = () => Promise.resolve();

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-renderer", () => {
  it("applies the theme as CSS variables, including left labels and dark inputs", async () => {
    const el = mount();
    await flush();
    const style = el.shadowRoot.querySelector(".jf-root").getAttribute("style");
    expect(style).toContain("--jf-label:#f5f5f4");
    expect(style).toContain("--jf-field-cols:minmax(7rem, 33%) minmax(0, 1fr)");
    expect(style).toContain("--jf-color-scheme:dark");
    expect(el.shadowRoot.querySelector("h1.jf-title").textContent).toBe("Register for the clinic");
  });

  it("shows conditional fields as answers change", async () => {
    const el = mount();
    await flush();
    expect(el.shadowRoot.querySelectorAll("c-jform-field")).toHaveLength(2);
    el.shadowRoot.querySelector("c-jform-field").dispatchEvent(new CustomEvent("change", { detail: { key: "transport", value: "Driving" } }));
    await flush();
    expect(el.shadowRoot.querySelectorAll("c-jform-field")).toHaveLength(3);
  });

  it("uses themed native buttons instead of lightning-button", async () => {
    const el = mount();
    await flush();
    const submit = el.shadowRoot.querySelector("button.jf-btn-primary");
    expect(submit.textContent.trim()).toBe("Submit");
    expect(el.shadowRoot.querySelector("lightning-button")).toBeNull();
  });
});

describe("c-jform-renderer narrow layout", () => {
  let observers;
  beforeEach(() => {
    observers = [];
    global.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {}
    };
  });
  afterEach(() => {
    delete global.ResizeObserver;
  });

  it("puts a side image beside the form when wide and above it when narrow", async () => {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = { ...definition, theme: { ...definition.theme, sideImageUrl: "https://cdn.example.com/side.jpg", sideImagePosition: "right" } };
    el.previewMode = true;
    document.body.appendChild(el);
    await flush();
    const observer = observers.find((o) => o.target && o.target.classList && o.target.classList.contains("jf-root"));

    observer.target.getBoundingClientRect = () => ({ width: 1200 });
    observer.cb([]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-root").classList.contains("jf-split-right")).toBe(true);
    expect(el.shadowRoot.querySelector("aside.jf-side img").getAttribute("src")).toBe("https://cdn.example.com/side.jpg");
    expect(el.shadowRoot.querySelector("img.jf-cover")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-container").classList.contains("jf-narrow")).toBe(false);

    observer.target.getBoundingClientRect = () => ({ width: 900 });
    observer.cb([]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-container").classList.contains("jf-narrow")).toBe(true); // the form column is 7/12 of 900px

    observer.target.getBoundingClientRect = () => ({ width: 500 });
    observer.cb([]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-side")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-root").classList.contains("jf-split")).toBe(false);
    expect(el.shadowRoot.querySelector("img.jf-cover").getAttribute("src")).toBe("https://cdn.example.com/side.jpg");
  });

  it("switches to the narrow layout under 600px", async () => {
    const el = mount();
    await flush();
    const rendererObserver = observers.find((o) => o.target && o.target.classList && o.target.classList.contains("jf-root"));
    rendererObserver.target.getBoundingClientRect = () => ({ width: 390 });
    rendererObserver.cb([]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-container").classList.contains("jf-narrow")).toBe(true);
  });
});

describe("c-jform-renderer header and images", () => {
  const imageTheme = {
    titleAlign: "center",
    logoUrl: "https://cdn.example.com/logo.png",
    coverUrl: "https://cdn.example.com/cover.jpg",
    backgroundImageUrl: "https://cdn.example.com/bg.jpg"
  };
  function mountWith(theme, props = {}) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = { ...definition, theme: { ...definition.theme, ...theme } };
    el.previewMode = true;
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
  }

  it("centers the header and shows the logo, cover and background image", async () => {
    const el = mountWith(imageTheme);
    await flush();
    const root = el.shadowRoot.querySelector(".jf-root");
    expect(root.getAttribute("style")).toContain("--jf-title-align:center");
    expect(root.getAttribute("style")).toContain("--jf-header-items:center");
    expect(root.classList.contains("jf-has-bg")).toBe(true);
    expect(el.shadowRoot.querySelector("img.jf-logo").getAttribute("src")).toBe(imageTheme.logoUrl);
    expect(el.shadowRoot.querySelector("img.jf-cover").getAttribute("src")).toBe(imageTheme.coverUrl);
    expect(el.shadowRoot.querySelector("img.jf-bg-image").getAttribute("src")).toBe(imageTheme.backgroundImageUrl);
    expect(el.shadowRoot.querySelector(".jf-card .jf-header")).toBeNull();
  });

  it("moves the title and cover into the card when titlePlacement is card", async () => {
    const el = mountWith({ ...imageTheme, titlePlacement: "card" });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-card header.jf-header-card h1.jf-title").textContent).toBe("Register for the clinic");
    expect(el.shadowRoot.querySelector(".jf-card img.jf-cover-card")).not.toBeNull();
    expect(el.shadowRoot.querySelectorAll("header.jf-header")).toHaveLength(1);
  });

  it("moves the progress bar into the card with the title on multi-page forms", async () => {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = {
      ...definition,
      displayStyle: "Multi-Page (Sections)",
      theme: { ...definition.theme, titlePlacement: "card" },
      sections: [...definition.sections, { key: "p2", name: "Page 2", fields: [{ key: "notes", type: "comment", label: "Notes" }] }]
    };
    el.previewMode = true;
    document.body.appendChild(el);
    await flush();
    expect(el.shadowRoot.querySelectorAll(".jf-progress")).toHaveLength(1);
    expect(el.shadowRoot.querySelector(".jf-card c-jform-progress").shadowRoot.querySelector(".jf-progress-text").textContent).toContain("Step 1 of 2");
    expect(el.shadowRoot.querySelector(".jf-card header.jf-header-card")).not.toBeNull();
  });

  it("ignores image URLs that are not http(s) or site-relative", async () => {
    const el = mountWith({ logoUrl: "javascript:alert(1)", coverUrl: "data:image/png;base64,AAAA", backgroundImageUrl: "/sfsites/c/file-asset/brand.jpg" });
    await flush();
    expect(el.shadowRoot.querySelector("img.jf-logo")).toBeNull();
    expect(el.shadowRoot.querySelector("img.jf-cover")).toBeNull();
    expect(el.shadowRoot.querySelector("img.jf-bg-image").getAttribute("src")).toBe("/sfsites/c/file-asset/brand.jpg");
  });

  it("shows nothing but the card when embedded", async () => {
    const el = mountWith({ ...imageTheme, sideImageUrl: "https://cdn.example.com/side.jpg" }, { embedded: true });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-header")).toBeNull();
    expect(el.shadowRoot.querySelector("img.jf-cover")).toBeNull();
    expect(el.shadowRoot.querySelector("img.jf-bg-image")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-side")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-card")).not.toBeNull();
  });
});

describe("c-jform-renderer submission", () => {
  const twoPages = {
    name: "Jobs",
    label: "Apply",
    displayStyle: "Multi-Page (Sections)",
    theme: {},
    sections: [
      { key: "p1", name: "About you", label: "About you", fields: [{ key: "cv", type: "fileupload", label: "CV" }] },
      { key: "p2", name: "Role", label: "Role", fields: [{ key: "role", type: "text", label: "Role" }] }
    ]
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };
  function mountLive(def = twoPages) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = def;
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    return el;
  }
  const fieldOf = (el, key) => [...el.shadowRoot.querySelectorAll("c-jform-field")].find((f) => f.field?.key === key);
  const button = (el, text) => [...el.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));

  beforeEach(() => {
    submitWithSource.mockReset();
    attachFile.mockReset();
    attachFile.mockResolvedValue("069000000000001AAA");
    startSubmission.mockClear();
    startSubmission.mockResolvedValue("");
    delete window.grecaptcha;
  });

  it("keeps a file chosen on an earlier page and uploads it after submitting", async () => {
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    const el = mountLive();
    const submittedEvents = [];
    el.addEventListener("submitted", (e) => submittedEvents.push(e));
    await flush();
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    fieldOf(el, "cv").dispatchEvent(new CustomEvent("change", { detail: { key: "cv", value: ["cv.pdf"], files: [file] } }));
    await flush();
    button(el, "Next").click();
    await flush();
    expect(fieldOf(el, "cv")).toBeUndefined(); // page 1 and its field component are gone
    fieldOf(el, "role").dispatchEvent(new CustomEvent("change", { detail: { key: "role", value: "Coach" } }));
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();

    const sent = JSON.parse(submitWithSource.mock.calls[0][0].answersJson);
    expect(sent).toEqual({ cv: ["cv.pdf"], role: "Coach", __jf_honeypot: "", __jf_token: "" });
    expect(attachFile).toHaveBeenCalledTimes(1);
    expect(attachFile.mock.calls[0][0]).toMatchObject({ publicKey: "KEY123", submissionId: "a0X000000000001AAA", fieldKey: "cv", fileName: "cv.pdf" });
    expect(attachFile.mock.calls[0][0].base64Content).toBe(Buffer.from("%PDF").toString("base64"));
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
    // the page hears that a response was sent, but not the submission Id that attachFile trusts
    expect(submittedEvents).toHaveLength(1);
    expect(submittedEvents[0].detail).toBeNull();
    expect(submittedEvents[0].composed).toBe(false);
  });

  it("sends the honeypot to the server and attaches nothing when the server drops the submission", async () => {
    submitWithSource.mockResolvedValue(null);
    const el = mountLive();
    await flush();
    fieldOf(el, "cv").dispatchEvent(new CustomEvent("change", { detail: { key: "cv", value: ["cv.pdf"], files: [new File(["x"], "cv.pdf")] } }));
    const trap = el.shadowRoot.querySelector('input[name="jf_extra_field"]');
    trap.value = "http://spam.example";
    trap.dispatchEvent(new CustomEvent("input"));
    button(el, "Next").click();
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();

    expect(JSON.parse(submitWithSource.mock.calls[0][0].answersJson).__jf_honeypot).toBe("http://spam.example");
    expect(attachFile).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
  });

  it("refuses a file over 3 MB before anything is submitted", async () => {
    const el = mountLive();
    await flush();
    const big = new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.pdf");
    fieldOf(el, "cv").dispatchEvent(new CustomEvent("change", { detail: { key: "cv", value: ["big.pdf"], files: [big] } }));
    button(el, "Next").click();
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();

    expect(submitWithSource).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toContain("big.pdf is larger than 3 MB");
    expect(el.shadowRoot.querySelector("form")).not.toBeNull(); // the form stays: this is not an unavailable form
  });

  it("holds the files to the field's own rules before anything is submitted", async () => {
    const sheetOnly = {
      ...twoPages,
      sections: [{ ...twoPages.sections[0], fields: [{ key: "cv", type: "fileupload", label: "CV", config: { extensions: ["csv"], maxFiles: 1 } }] }, twoPages.sections[1]]
    };
    const el = mountLive(sheetOnly);
    await flush();
    const pdf = new File(["%PDF"], "cv.pdf");
    fieldOf(el, "cv").dispatchEvent(new CustomEvent("change", { detail: { key: "cv", value: ["cv.pdf"], files: [pdf] } }));
    button(el, "Next").click();
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();

    expect(submitWithSource).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toContain("cv.pdf can't be attached. This field takes CSV files.");
  });

  it("sends a signature drawn on an earlier page with the answers, and never takes one from the link", async () => {
    const PNG = "data:image/png;base64,iVBORw0KGgo=";
    HTMLCanvasElement.prototype.getContext = jest.fn(() => null); // jsdom has no canvas
    window.history.pushState({}, "", "/?sig=forged&name=Jo");
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    // link values apply to a form loaded by its key, as on the site
    getPublishedDefinition.mockResolvedValue(
      JSON.stringify({
        name: "Waiver",
        label: "Waiver",
        displayStyle: "Multi-Page (Sections)",
        theme: {},
        sections: [
          { key: "p1", name: "Sign", label: "Sign", fields: [{ key: "name", type: "text", label: "Name" }, { key: "sig", type: "signature", label: "Signature", required: true }] },
          { key: "p2", name: "Role", label: "Role", fields: [{ key: "role", type: "text", label: "Role" }] }
        ]
      })
    );
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    window.history.pushState({}, "", "/");
    await settle();
    expect(fieldOf(el, "name").value).toBe("Jo");
    expect(fieldOf(el, "sig").value).toBeUndefined();

    fieldOf(el, "sig").dispatchEvent(new CustomEvent("change", { detail: { key: "sig", value: PNG } }));
    await flush();
    button(el, "Next").click();
    await flush();
    button(el, "Back").click();
    await flush();
    expect(fieldOf(el, "sig").value).toBe(PNG); // the pad shows it again
    button(el, "Next").click();
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();
    expect(JSON.parse(submitWithSource.mock.calls[0][0].answersJson)).toMatchObject({ name: "Jo", sig: PNG });
    expect(attachFile).not.toHaveBeenCalled();
  });

  it("sends a table's answer keyed by row, shows fields that depend on one row, and never takes it from the link", async () => {
    window.history.pushState({}, "", "/?satisfaction=forged");
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    getPublishedDefinition.mockResolvedValue(
      JSON.stringify({
        name: "Survey",
        label: "Survey",
        displayStyle: "Single Page",
        theme: {},
        sections: [
          {
            key: "p1",
            name: "Survey",
            label: "Survey",
            fields: [
              { key: "satisfaction", type: "table", label: "How satisfied", width: 50, options: [{ label: "Poor" }, { label: "Good" }], config: { rows: [{ key: "price", label: "Price" }] } },
              { key: "why", type: "text", label: "Why?", conditionalLogic: { action: "show", match: "all", conditions: [{ field: "satisfaction.price", operator: "equals", value: "Poor" }] } }
            ]
          }
        ]
      })
    );
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    window.history.pushState({}, "", "/");
    await settle();
    expect(fieldOf(el, "satisfaction").value).toBeUndefined();
    expect(fieldOf(el, "why")).toBeUndefined();
    expect(fieldOf(el, "satisfaction").parentElement.className).toContain("jf-span-12"); // always the full width

    fieldOf(el, "satisfaction").dispatchEvent(new CustomEvent("change", { detail: { key: "satisfaction", value: { price: "Poor" } } }));
    await flush();
    expect(fieldOf(el, "why")).toBeTruthy();
    fieldOf(el, "why").dispatchEvent(new CustomEvent("change", { detail: { key: "why", value: "Too high" } }));
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();
    expect(JSON.parse(submitWithSource.mock.calls[0][0].answersJson)).toMatchObject({ satisfaction: { price: "Poor" }, why: "Too high" });
  });

  it("sends the text typed under Other as its own trimmed answer, only while Other is picked", async () => {
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    getPublishedDefinition.mockResolvedValue(
      JSON.stringify({
        name: "Survey",
        label: "Survey",
        displayStyle: "Single Page",
        theme: {},
        sections: [
          {
            key: "p1",
            name: "Survey",
            label: "Survey",
            fields: [
              { key: "industry", type: "radio", label: "Industry", options: [{ label: "Retail" }], config: { other: {} } },
              { key: "diet", type: "checkboxes", label: "Diet", options: [{ label: "Vegan" }], config: { other: {} } }
            ]
          }
        ]
      })
    );
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    await settle();

    fieldOf(el, "industry").dispatchEvent(new CustomEvent("change", { detail: { key: "industry", value: "Other" } }));
    fieldOf(el, "industry").dispatchEvent(new CustomEvent("change", { detail: { key: "industry", value: "Other", other: "  Fishing " } }));
    await flush();
    expect(fieldOf(el, "industry").otherValue).toBe("  Fishing ");
    fieldOf(el, "diet").dispatchEvent(new CustomEvent("change", { detail: { key: "diet", value: ["Other"], other: "Paleo" } }));
    fieldOf(el, "diet").dispatchEvent(new CustomEvent("change", { detail: { key: "diet", value: ["Vegan"], other: undefined } }));
    await flush();
    expect(fieldOf(el, "diet").otherValue).toBeUndefined();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();
    const sent = JSON.parse(submitWithSource.mock.calls[0][0].answersJson);
    expect(sent).toMatchObject({ industry: "Other", "industry.other": "Fishing", diet: ["Vegan"] });
    expect(sent).not.toHaveProperty("diet.other");
  });

  it("sends a Name answer as one trimmed object, starts from its defaults, and never takes it from the link", async () => {
    window.history.pushState({}, "", "/?name=forged&name.firstName=forged");
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    getPublishedDefinition.mockResolvedValue(
      JSON.stringify({
        name: "Sign-up",
        label: "Sign-up",
        displayStyle: "Single Page",
        theme: {},
        sections: [
          {
            key: "p1",
            name: "Sign-up",
            label: "Sign-up",
            fields: [
              {
                key: "name",
                type: "name",
                label: "Name",
                required: true,
                config: { layout: "inline", parts: { firstName: {}, lastName: { defaultValue: "Doe" } } }
              },
              { key: "practice", type: "text", label: "Practice", conditionalLogic: { action: "show", match: "all", conditions: [{ field: "name.lastName", operator: "equals", value: "Doe" }] } }
            ]
          }
        ]
      })
    );
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    window.history.pushState({}, "", "/");
    await settle();
    expect(fieldOf(el, "name").value).toEqual({ lastName: "Doe" });
    expect(fieldOf(el, "practice")).toBeTruthy(); // a rule on one part

    // a required name with a part missing stops the submit
    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();
    expect(submitWithSource).not.toHaveBeenCalled();

    fieldOf(el, "name").dispatchEvent(new CustomEvent("change", { detail: { key: "name", value: { firstName: "  Jane ", lastName: "Lee" } } }));
    await flush();
    expect(fieldOf(el, "practice")).toBeUndefined();
    fieldOf(el, "name").dispatchEvent(new CustomEvent("change", { detail: { key: "name", value: { firstName: "  Jane ", lastName: "Doe", middleName: "Q" } } }));
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();
    expect(JSON.parse(submitWithSource.mock.calls[0][0].answersJson).name).toEqual({ firstName: "Jane", lastName: "Doe" });
  });

  it("keeps the form on screen when the server rejects the answers", async () => {
    submitWithSource.mockRejectedValue({ body: { message: "Please answer: Role" } });
    const el = mountLive();
    await flush();
    button(el, "Next").click();
    await flush();

    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();

    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toContain("Please answer: Role");
    expect(el.shadowRoot.querySelector("form")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-unavailable")).toBeNull();
  });
});

describe("c-jform-renderer spam protection", () => {
  const onePage = { name: "Jobs", label: "Apply", displayStyle: "Single Page", theme: {}, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "role", type: "text", label: "Role" }] }] };
  const withCaptcha = { ...onePage, protection: { captcha: true, siteKey: "site-key-123" } };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };
  function mountLive(def) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = def;
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    return el;
  }
  const submit = (el) => el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
  it("shows indentation in the welcome and thank-you messages", async () => {
    const def = {
      ...onePage,
      welcomeMessage: '<p class="ql-indent-1">Welcome</p>',
      thankYouMessage: '<p class="ql-indent-2" style="text-align: center;">Thanks</p>'
    };
    const el = mountLive(def);
    await settle();
    expect(el.shadowRoot.querySelector("lightning-formatted-rich-text.jf-welcome").value).toBe('<p class="ql-indent-1" style="padding-left: 3em;">Welcome</p>');
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    const field = el.shadowRoot.querySelector("c-jform-field");
    field.dispatchEvent(new CustomEvent("change", { detail: { key: "role", value: "Coach" } }));
    submit(el);
    await settle();
    expect(el.shadowRoot.querySelector(".jf-thanks lightning-formatted-rich-text").value).toBe(
      '<p class="ql-indent-2" style="text-align: center; padding-left: 6em;">Thanks</p>'
    );
  });

  const sent = () => JSON.parse(submitWithSource.mock.calls[0][0].answersJson);

  let postMessage;
  let pageListener;
  /** Stands in for the site's head-markup script: answers token requests the way the real page does. */
  const installPageListener = (token, origin = window.location.origin) => {
    pageListener = (e) => {
      // jsdom's postMessage leaves origin empty, so the reply is dispatched with the origin a browser would set
      if (e.data?.type === "jform:captcha:execute") {
        window.dispatchEvent(new MessageEvent("message", { data: { type: "jform:captcha:token", requestId: e.data.requestId, token }, origin }));
      }
    };
    window.addEventListener("message", pageListener);
  };
  beforeEach(() => {
    submitWithSource.mockReset();
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    startSubmission.mockReset();
    postMessage = jest.spyOn(window, "postMessage");
  });
  afterEach(() => {
    postMessage.mockRestore();
    if (pageListener) window.removeEventListener("message", pageListener);
    pageListener = null;
  });

  it("asks the server for a timing token when the form opens and sends it back with the answers", async () => {
    startSubmission.mockResolvedValue("signed.token");
    const el = mountLive(onePage);
    await settle();
    expect(startSubmission).toHaveBeenCalledWith({ publicKey: "KEY123" });
    submit(el);
    await settle();
    expect(sent().__jf_token).toBe("signed.token");
    expect(sent().__jf_captcha).toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("never asks for a token in preview mode", async () => {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = onePage;
    el.previewMode = true;
    document.body.appendChild(el);
    await settle();
    expect(startSubmission).not.toHaveBeenCalled();
  });

  it("asks the page for reCAPTCHA with the public site key and sends the token the page hands back", async () => {
    startSubmission.mockResolvedValue("");
    installPageListener("captcha-token");
    const el = mountLive(withCaptcha);
    await settle();
    expect(postMessage.mock.calls[0][0]).toEqual({ type: "jform:captcha", siteKey: "site-key-123" });
    expect(el.shadowRoot.querySelector(".jf-recaptcha-notice")).not.toBeNull(); // Google's notice while the form is on screen
    submit(el);
    await settle();
    const request = postMessage.mock.calls.map((c) => c[0]).find((m) => m.type === "jform:captcha:execute");
    expect(request).toMatchObject({ siteKey: "site-key-123", action: "jform_submit" });
    expect(sent().__jf_captcha).toBe("captcha-token");
  });

  it("ignores a token posted from another origin", async () => {
    jest.useFakeTimers();
    startSubmission.mockResolvedValue("");
    installPageListener("forged-token", "https://evil.example.com");
    const el = mountLive(withCaptcha);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    submit(el);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    jest.advanceTimersByTime(9000);
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(300);
    }
    jest.useRealTimers();
    await settle();
    expect(sent().__jf_captcha).toBeUndefined();
  });

  it("still submits when the page never produces grecaptcha", async () => {
    jest.useFakeTimers();
    startSubmission.mockResolvedValue("signed.token");
    const el = mountLive(withCaptcha);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    submit(el);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    jest.advanceTimersByTime(9000); // nobody answers the token request
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(300);
    }
    jest.useRealTimers();
    await settle();
    expect(submitWithSource).toHaveBeenCalledTimes(1);
    expect(sent().__jf_token).toBe("signed.token");
    expect(sent().__jf_captcha).toBeUndefined();
  });

  it("goes on without a token when the server has no signing key", async () => {
    startSubmission.mockRejectedValue(new Error("down"));
    const el = mountLive(onePage);
    await settle();
    submit(el);
    await settle();
    expect(sent().__jf_token).toBe("");
    expect(el.shadowRoot.querySelector(".jf-recaptcha-notice")).toBeNull();
  });
});

describe("c-jform-renderer full-page background", () => {
  const def = { name: "Jobs", label: "Apply", displayStyle: "Single Page", theme: { background: "#112233", backgroundImageUrl: "https://cdn.example.com/bg.jpg" }, sections: [{ key: "p1", name: "Page 1", fields: [{ key: "role", type: "text", label: "Role" }] }] };
  function mountWith(props) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = def;
    el.publicKey = "KEY123";
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
  }

  it("paints a fixed backdrop behind the page when asked, moving the background image with it", async () => {
    const el = mountWith({ fullPage: true });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-backdrop")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-root").classList.contains("jf-full-page")).toBe(true);
    expect(el.shadowRoot.querySelector(".jf-full-page .jf-bg-image")).not.toBeNull();
  });

  it("stays inside its own box by default, in embeds and in the builder preview", async () => {
    for (const props of [{}, { fullPage: true, embedded: true }, { fullPage: true, previewMode: true }]) {
      const el = mountWith(props);
      await flush();
      expect(el.shadowRoot.querySelector(".jf-backdrop")).toBeNull();
      expect(el.shadowRoot.querySelector(".jf-root").classList.contains("jf-full-page")).toBe(false);
      document.body.removeChild(el);
    }
  });
});

describe("c-jform-renderer builder preview: pick a page", () => {
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const fourPages = {
    name: "Clinic",
    displayStyle: "Multi-Page (Sections)",
    sections: [
      { key: "p1", name: "About you", fields: [{ key: "name", type: "text", label: "Full name", required: true }, { key: "driving", type: "yesno", label: "Driving?" }] },
      { key: "p2", name: "Session", fields: [{ key: "session", type: "text", label: "Session" }] },
      { key: "p3", name: "Parking", conditionalLogic: { action: "show", match: "all", conditions: [{ field: "driving", operator: "equals", value: "Yes" }] }, fields: [{ key: "plate", type: "text", label: "Number plate" }] },
      { key: "p4", name: "Consent", fields: [{ key: "agree", type: "text", label: "Agree" }] }
    ]
  };
  const mountPreview = (props = {}) => {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = fourPages;
    el.previewMode = true;
    Object.assign(el, props);
    const states = [];
    el.addEventListener("previewstate", (e) => states.push(e.detail));
    document.body.appendChild(el);
    return { el, states };
  };
  const pageTitle = (el) => el.shadowRoot.querySelector("c-jform-field")?.field?.label;
  const button = (el, text) => [...el.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));

  it("reports every page, which a rule hides, and the one on screen", async () => {
    const { states } = mountPreview();
    await settle();
    const last = states[states.length - 1];
    expect(last.multiPage).toBe(true);
    expect(last.current).toBe("p1");
    expect(last.pages.map((p) => [p.number, p.label, p.hidden])).toEqual([
      [1, "About you", false],
      [2, "Session", false],
      [3, "Parking", true],
      [4, "Consent", false]
    ]);
  });

  it("moves on without required answers when checks are off, and stops when they are on", async () => {
    const off = mountPreview({ previewSkipChecks: true });
    await settle();
    button(off.el, "Next").click();
    await settle();
    expect(pageTitle(off.el)).toBe("Session");

    document.body.removeChild(off.el);
    const on = mountPreview({ previewSkipChecks: false });
    await settle();
    button(on.el, "Next").click();
    await settle();
    expect(pageTitle(on.el)).toBe("Full name"); // the required name stops it, as for respondents
  });

  it("never scrolls the page around the builder's preview when the page changes", async () => {
    const scroll = jest.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const { el } = mountPreview({ previewSkipChecks: true });
      await settle();
      el.showPage("p4");
      await settle();
      button(el, "Back").click();
      await settle();
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("jumps to any page, including one a rule hides, and goes on from there in form order", async () => {
    const { el, states } = mountPreview({ previewSkipChecks: true });
    await settle();
    el.showPage("p4");
    await settle();
    expect(pageTitle(el)).toBe("Agree");
    expect(states[states.length - 1].current).toBe("p4");

    el.showPage("p3"); // hidden: nobody said they are driving
    await settle();
    expect(pageTitle(el)).toBe("Number plate");
    expect(el.shadowRoot.querySelector(".jf-preview-hidden")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-progress")).toBeNull(); // not one of the respondent's steps
    expect(states[states.length - 1].current).toBe("p3");

    button(el, "Next").click();
    await settle();
    expect(pageTitle(el)).toBe("Agree");
    expect(el.shadowRoot.querySelector(".jf-preview-hidden")).toBeNull();

    el.showPage("p3");
    await settle();
    button(el, "Back").click();
    await settle();
    expect(pageTitle(el)).toBe("Session");
  });

  it("ignores page picks outside the builder preview", async () => {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = fourPages;
    document.body.appendChild(el);
    await settle();
    el.showPage("p3");
    await settle();
    expect(el.shadowRoot.querySelector("c-jform-field").field.label).toBe("Full name");
  });
});

describe("c-jform-renderer footer buttons", () => {
  const single = { name: "B", label: "B", displayStyle: "Single Page", sections: [{ key: "p1", name: "Page 1", fields: [{ key: "a", type: "text", label: "A" }] }] };
  const paged = { ...single, displayStyle: "Multi-Page (Sections)", sections: [single.sections[0], { key: "p2", name: "Page 2", fields: [{ key: "b", type: "text", label: "B" }] }] };
  async function render(def) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = def;
    el.previewMode = true;
    document.body.appendChild(el);
    await flush();
    return el;
  }
  const actions = (el) => el.shadowRoot.querySelector(".jf-actions");
  const primary = (el) => el.shadowRoot.querySelector(".jf-actions .jf-btn-primary");

  it("sits on the right with the standard words by default", async () => {
    const el = await render(single);
    expect(actions(el).className).toBe("jf-actions jf-actions-right");
    expect(primary(el).textContent.trim()).toBe("Submit");
  });

  it("follows the theme's alignment and size, and ignores values it does not know", async () => {
    let el = await render({ ...single, theme: { buttonAlign: "full", buttonSize: "large" } });
    expect(actions(el).className).toBe("jf-actions jf-actions-full jf-actions-large");
    document.body.removeChild(el);
    el = await render({ ...single, theme: { buttonAlign: "sideways", buttonSize: "huge" } });
    expect(actions(el).className).toBe("jf-actions jf-actions-right");
  });

  it("uses the form's button text: the public view's buttonLabels first, the draft's settings in the builder", async () => {
    let el = await render({ ...paged, settings: { buttons: { next: "Continue", submit: "Register now" } } });
    expect(primary(el).textContent.trim()).toBe("Continue");
    document.body.removeChild(el);
    el = await render({ ...single, buttonLabels: { submit: "Book my lesson" }, settings: { buttons: { submit: "ignored" } } });
    expect(primary(el).textContent.trim()).toBe("Book my lesson");
  });

  it("falls back to the standard word for blank text and caps long text at 40 characters", async () => {
    let el = await render({ ...single, settings: { buttons: { submit: "   " } } });
    expect(primary(el).textContent.trim()).toBe("Submit");
    document.body.removeChild(el);
    el = await render({ ...single, settings: { buttons: { submit: "x".repeat(60) } } });
    expect(primary(el).textContent.trim()).toHaveLength(40);
  });
});

describe("c-jform-renderer page and card finish", () => {
  const paged = {
    name: "D",
    label: "D",
    displayStyle: "Multi-Page (Sections)",
    sections: [
      { key: "p1", name: "Page 1", fields: [{ key: "a", type: "text", label: "A" }, { key: "b", type: "text", label: "B" }, { key: "note", type: "heading", label: "Note" }] },
      { key: "p2", name: "Page 2", fields: [{ key: "c", type: "text", label: "C" }] },
      { key: "p3", name: "Page 3", fields: [{ key: "d", type: "text", label: "D" }] }
    ]
  };
  async function render(def) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = def;
    el.previewMode = true;
    document.body.appendChild(el);
    await flush();
    return el;
  }
  const root = (el) => el.shadowRoot.querySelector(".jf-root");
  const progress = (el) => el.shadowRoot.querySelector("c-jform-progress").shadowRoot;
  const fills = (el) => [...progress(el).querySelectorAll(".jf-progress-seg-fill")].map((f) => f.style.width);
  const drift = (el) => el.shadowRoot.querySelector(".jf-mesh").getAttribute("style");
  const answer = async (el, key, value) => {
    [...el.shadowRoot.querySelectorAll("c-jform-field")].find((f) => f.field.key === key).dispatchEvent(new CustomEvent("change", { detail: { key, value } }));
    await flush();
  };

  it("keeps the plain look by default: no mesh, a bar, and no finish classes", async () => {
    const el = await render(paged);
    expect(el.shadowRoot.querySelector(".jf-mesh")).toBeNull();
    expect(progress(el).querySelector(".jf-progress-track")).not.toBeNull();
    expect(progress(el).querySelector(".jf-progress-segments")).toBeNull();
    expect(root(el).className).toBe("jf-root");
  });

  it("draws the mesh behind the form, unless a page image takes its place", async () => {
    let el = await render({ ...paged, theme: { backgroundStyle: "mesh" } });
    expect(el.shadowRoot.querySelectorAll(".jf-mesh .jf-blob")).toHaveLength(3);
    expect(drift(el)).toBe("--jf-drift:0");
    expect(root(el).getAttribute("style")).not.toContain("--jf-drift"); // an answer moves the spots, not the whole form's style
    document.body.removeChild(el);
    el = await render({ ...paged, theme: { backgroundStyle: "mesh", backgroundImageUrl: "https://cdn.example.com/bg.jpg" } });
    expect(el.shadowRoot.querySelector(".jf-mesh")).toBeNull();
  });

  it("marks glass, pill and spotlight on the root", async () => {
    const el = await render({ ...paged, theme: { backgroundStyle: "mesh", surfaceStyle: "glass", buttonShape: "pill", focusStyle: "spotlight" } });
    expect(root(el).className).toBe("jf-root jf-glass jf-pill jf-spotlight");
  });

  it("keeps the card solid when nothing is behind it to show through", async () => {
    let el = await render({ ...paged, theme: { surfaceStyle: "glass" } });
    expect(root(el).className).toBe("jf-root");
    document.body.removeChild(el);
    el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = { ...paged, theme: { backgroundStyle: "mesh", surfaceStyle: "glass" } };
    el.previewMode = true;
    el.embedded = true;
    document.body.appendChild(el);
    await flush();
    expect(root(el).className).not.toContain("jf-glass");
    expect(el.shadowRoot.querySelector(".jf-mesh")).toBeNull();
    expect(root(el).getAttribute("style")).not.toContain("--jf-drift");
  });

  it("does not count what a field starts with as an answer", async () => {
    const el = await render({
      ...paged,
      theme: { progressStyle: "segments" },
      sections: [
        {
          key: "p1",
          name: "Page 1",
          fields: [
            { key: "addr", type: "address", label: "Address" },
            { key: "who", type: "name", label: "Name" },
            { key: "ok", type: "checkbox", label: "OK" }
          ]
        },
        paged.sections[1]
      ]
    });
    await answer(el, "addr", { country: "US" });
    await answer(el, "ok", false);
    expect(fills(el)).toEqual(["0%", "0%"]);
    await answer(el, "addr", { country: "US", city: "Boston" });
    await answer(el, "ok", true);
    expect(fills(el)).toEqual(["67%", "0%"]);
  });

  it("leaves out Hidden fields and questions that start answered, and counts an unticked consent as unanswered", async () => {
    const el = await render({
      ...paged,
      theme: { progressStyle: "segments" },
      sections: [
        {
          key: "p1",
          name: "Page 1",
          fields: [
            { key: "src", type: "hidden", label: "Source" },
            { key: "agree", type: "consent", label: "I agree" },
            { key: "size", type: "text", label: "Size", defaultValue: "M" }
          ]
        },
        paged.sections[1]
      ]
    });
    expect(fills(el)).toEqual(["0%", "0%"]); // Size starts with M, so only the consent is left to answer
    await answer(el, "agree", true);
    expect(fills(el)).toEqual(["100%", "0%"]); // keeping the default fills the page
    await answer(el, "agree", false);
    expect(fills(el)).toEqual(["0%", "0%"]);
    await answer(el, "agree", true);
    await answer(el, "size", "L");
    expect(fills(el)).toEqual(["100%", "0%"]);
  });

  it("does not count a Payment block or a box ticked from the start", async () => {
    const el = await render({
      ...paged,
      theme: { progressStyle: "segments" },
      sections: [
        {
          key: "p1",
          name: "Page 1",
          fields: [
            { key: "email", type: "text", label: "Email" },
            { key: "pay", type: "payment", label: "Pay", config: { pricing: "fixed", amount: 10 } },
            { key: "news", type: "consent", label: "News", defaultValue: "true" }
          ]
        },
        paged.sections[1]
      ]
    });
    expect(fills(el)).toEqual(["0%", "0%"]);
    await answer(el, "email", "a@example.com");
    expect(fills(el)).toEqual(["100%", "0%"]); // only the email is asked: the Payment block is paid, and News starts ticked
    await answer(el, "news", false);
    expect(fills(el)).toEqual(["100%", "0%"]);
  });

  it("fills one segment per page as its questions are answered, and moves the mesh along", async () => {
    const el = await render({ ...paged, theme: { progressStyle: "segments", backgroundStyle: "mesh" } });
    expect(fills(el)).toEqual(["0%", "0%", "0%"]);
    await answer(el, "a", "yes");
    expect(fills(el)).toEqual(["50%", "0%", "0%"]); // the heading takes no answer, so it does not count
    expect(drift(el)).toBe("--jf-drift:0.17");
    expect(progress(el).querySelector(".jf-progress-segments").getAttribute("aria-valuenow")).toBe("17"); // what the segments show: half of page 1 of 3
    await answer(el, "b", "  ");
    expect(fills(el)).toEqual(["50%", "0%", "0%"]); // blank text is not an answer
    await answer(el, "b", "ok");
    el.shadowRoot.querySelector(".jf-actions .jf-btn-primary").click();
    await flush();
    expect(fills(el)).toEqual(["100%", "0%", "0%"]);
    expect(drift(el)).toBe("--jf-drift:0.33");
  });
});

describe("c-jform-renderer tall fields", () => {
  it("lets a field cover several rows beside the fields that follow it", async () => {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = { name: "T", displayStyle: "Single Page", sections: [{ key: "p1", name: "P", fields: [
      { key: "a", type: "text", label: "A", width: 50 },
      { key: "poster", type: "image", width: 50, config: { url: "https://x.example.com/p.png", rowSpan: 2 } },
      { key: "b", type: "text", label: "B", width: 50 }
    ] }] };
    el.previewMode = true;
    document.body.appendChild(el);
    await flush();
    const cells = [...el.shadowRoot.querySelectorAll(".jf-cell")].map((c) => c.className);
    expect(cells).toEqual(["jf-cell jf-span-6", "jf-cell jf-span-6 jf-tall jf-rows-2", "jf-cell jf-span-6"]);
  });
});

describe("c-jform-renderer welcome and thank-you screens", () => {
  const screens = (settings = {}, extra = {}) => ({
    name: "Clinic",
    label: "Register for the clinic",
    displayStyle: "Multi-Page (Sections)",
    welcomeMessage: "<p>Two minutes, promise.</p>",
    thankYouMessage: "<p>See you there.</p>",
    settings,
    sections: [
      { key: "p1", name: "About you", label: "About you", fields: [{ key: "first", type: "text", label: "First name" }] },
      { key: "p2", name: "Visit", label: "Visit", fields: [{ key: "day", type: "date", label: "Day" }] }
    ],
    ...extra
  });
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const button = (el, text) => [...el.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
  function mount(def, props = {}) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = def;
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
  }
  const originalLocation = window.location;
  beforeEach(() => {
    submitWithSource.mockReset();
    startSubmission.mockResolvedValue("");
  });
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    if (window.location !== originalLocation) Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("opens on the start screen, starts the form, and goes back to it from page 1", async () => {
    const el = mount(screens({ welcome: { mode: "screen", title: "Welcome!", buttonLabel: "Let's go", showTime: true } }), { previewMode: true });
    await settle();
    const welcome = el.shadowRoot.querySelector(".jf-welcome-screen");
    expect(welcome.querySelector(".jf-welcome-title").textContent).toBe("Welcome!");
    expect(welcome.querySelector(".jf-welcome-time").textContent.trim()).toBe("Takes about 1 minute");
    expect(el.shadowRoot.querySelector("form")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-welcome")).toBeNull(); // the message is on the start screen, not above the form

    button(el, "Let's go").click();
    await settle();
    expect(el.shadowRoot.querySelector(".jf-welcome-screen")).toBeNull();
    expect(el.shadowRoot.querySelector("form")).not.toBeNull();
    button(el, "Back").click();
    await settle();
    expect(el.shadowRoot.querySelector(".jf-welcome-screen")).not.toBeNull();
  });

  it("leaves the title, description and logo out of the form pages after a start screen, unless asked to repeat them", async () => {
    const title = (el) => el.shadowRoot.querySelector(".jf-header .jf-title");
    const plain = mount(screens({}, { description: "Book a visit" }), { previewMode: true });
    await settle();
    expect(title(plain).textContent).toBe("Register for the clinic"); // no start screen: the form keeps its header
    document.body.removeChild(plain);

    const started = mount(screens({ welcome: { mode: "screen" } }, { description: "Book a visit", theme: { logoUrl: "/logo.png" } }), { previewMode: true });
    await settle();
    expect(started.shadowRoot.querySelector(".jf-welcome-screen .jf-logo")).not.toBeNull();
    button(started, "Start").click();
    await settle();
    expect(title(started)).toBeNull();
    expect(started.shadowRoot.querySelector(".jf-description")).toBeNull();
    expect(started.shadowRoot.querySelector(".jf-header")).toBeNull(); // the logo stays on the start screen
    expect(started.shadowRoot.querySelector(".jf-logo")).toBeNull();
    expect(started.shadowRoot.querySelector("h1.jf-assistive").textContent).toBe("Register for the clinic"); // still announced
    document.body.removeChild(started);

    const repeated = mount(screens({ welcome: { mode: "screen", showHeader: true } }, { description: "Book a visit", theme: { logoUrl: "/logo.png" } }), { previewMode: true });
    await settle();
    expect(repeated.shadowRoot.querySelector(".jf-welcome-screen .jf-logo")).not.toBeNull();
    button(repeated, "Start").click();
    await settle();
    expect(title(repeated).textContent).toBe("Register for the clinic");
    expect(repeated.shadowRoot.querySelector(".jf-header .jf-logo")).not.toBeNull(); // a repeated header brings its logo
    expect(repeated.shadowRoot.querySelector(".jf-description").textContent).toBe("Book a visit");
    expect(repeated.shadowRoot.querySelector(".jf-assistive")).toBeNull();
  });

  it("leaves the logo out of the card header after a start screen too", async () => {
    const el = mount(screens({ welcome: { mode: "screen" } }, { theme: { logoUrl: "/logo.png", titlePlacement: "card" } }), { previewMode: true });
    await settle();
    button(el, "Start").click();
    await settle();
    expect(el.shadowRoot.querySelector("form .jf-header")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-logo")).toBeNull();
    expect(el.shadowRoot.querySelector("form .jf-progress")).not.toBeNull();
  });

  it("keeps today's welcome message above the form, and skips the start screen with ?start=1", async () => {
    const message = mount(screens());
    await settle();
    expect(message.shadowRoot.querySelector(".jf-welcome-screen")).toBeNull();
    expect(message.shadowRoot.querySelector(".jf-welcome")).not.toBeNull();
    document.body.removeChild(message);

    window.history.replaceState({}, "", "/?start=1");
    const skipped = mount(screens({ welcome: { mode: "screen" } }), { publicKey: "KEY123" });
    await settle();
    expect(skipped.shadowRoot.querySelector(".jf-welcome-screen")).toBeNull();
    expect(skipped.shadowRoot.querySelector("form")).not.toBeNull();
  });

  it("shows the thank-you screen's buttons and starts again on Submit another response", async () => {
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    const def = screens({
      welcome: { mode: "screen" },
      ending: { title: "Thanks!", buttons: [{ label: "Back to home", url: "https://example.com" }], submitAnother: true }
    }, { displayStyle: "Single Page" });
    const el = mount(def, { publicKey: "KEY123" });
    await settle();
    button(el, "Start").click();
    await settle();
    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();

    const thanks = el.shadowRoot.querySelector(".jf-thanks");
    expect(thanks.querySelector(".jf-thanks-title").textContent).toBe("Thanks!");
    const link = thanks.querySelector("a.jf-thanks-link");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_self");
    button(el, "Submit another response").click();
    await settle();
    expect(el.shadowRoot.querySelector(".jf-thanks")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-welcome-screen")).not.toBeNull();
  });

  it("counts down and redirects after submitting", async () => {
    jest.useFakeTimers();
    const micro = async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    };
    try {
      submitWithSource.mockResolvedValue("a0X000000000001AAA");
      const assign = jest.fn();
      Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, search: "", assign } });
      const el = mount(screens({ ending: { redirectUrl: "https://www.example.com/next", redirectDelay: 2 } }, { displayStyle: "Single Page" }), { publicKey: "KEY123" });
      await micro();
      el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
      await micro();
      expect(el.shadowRoot.querySelector(".jf-redirect").textContent).toContain("Taking you to example.com in 2 s.");
      jest.advanceTimersByTime(1000);
      await micro();
      expect(el.shadowRoot.querySelector(".jf-redirect").textContent).toContain("in 1 s.");
      expect(assign).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      expect(assign).toHaveBeenCalledWith("https://www.example.com/next");
    } finally {
      jest.useRealTimers();
    }
  });

  it("asks the embed snippet to redirect from inside a frame, with a Continue link as a fallback", async () => {
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    const post = jest.fn();
    const parent = window.parent;
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage: post } });
    try {
      const el = mount(screens({ ending: { redirectUrl: "https://example.com/next" } }, { displayStyle: "Single Page" }), { publicKey: "KEY123", embedded: true });
      await settle();
      el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
      await settle();
      expect(post).toHaveBeenCalledWith({ type: "jform:redirect", key: "KEY123", url: "https://example.com/next" }, "*");
      const link = el.shadowRoot.querySelector(".jf-redirect-link");
      expect(link.textContent).toBe("Continue to example.com");
      expect(link.getAttribute("target")).toBe("_top");
    } finally {
      Object.defineProperty(window, "parent", { configurable: true, value: parent });
    }
  });

  it("lets the builder preview both screens and never redirects there", async () => {
    const states = [];
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = screens({ welcome: { mode: "screen" }, ending: { redirectUrl: "https://example.com", redirectDelay: 3 } });
    el.previewMode = true;
    el.addEventListener("previewstate", (e) => states.push(e.detail));
    document.body.appendChild(el);
    await settle();
    expect(states[states.length - 1]).toMatchObject({ welcome: true, current: "__welcome" });

    el.showPage("__ending");
    await settle();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-redirect-preview").textContent).toBe("After 3 s, people go on to example.com. The preview stays here.");
    expect(states[states.length - 1].current).toBe("__ending");

    el.showPage("p2");
    await settle();
    expect(el.shadowRoot.querySelector(".jf-thanks")).toBeNull();
    expect(states[states.length - 1].current).toBe("p2");
  });
});

describe("c-jform-renderer payments", () => {
  const payForm = (payments = {}, extra = {}) => ({
    name: "Workshop",
    label: "Book the workshop",
    displayStyle: "Single Page",
    theme: {},
    payments: { mode: "test", currency: "USD", openIn: "popup", ...payments },
    sections: [
      {
        key: "p1",
        name: "Booking",
        fields: [
          { key: "session", type: "radio", label: "Session", options: [{ label: "6pm session", value: "6pm" }, { label: "8pm session", value: "8pm" }] },
          { key: "pay", type: "payment", label: "Payment", config: { pricing: "choice", item: "Workshop ticket", source: "session", prices: [{ value: "6pm", amount: 20 }, { value: "8pm", amount: 25 }] } }
        ]
      }
    ],
    ...extra
  });
  const started = { submissionId: "a0X000000000001AAA", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1", checkoutReference: "cs_test_1", mode: "test", amount: 20, currencyCode: "USD" };
  const micro = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const fieldOf = (el, key) => [...el.shadowRoot.querySelectorAll("c-jform-field")].find((f) => f.field?.key === key);
  const button = (el, text) => [...el.shadowRoot.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
  const submitButton = (el) => el.shadowRoot.querySelector('button[type="submit"]');
  function mount(def, props = { publicKey: "KEY123" }) {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = def;
    Object.assign(el, props);
    document.body.appendChild(el);
    return el;
  }
  async function choose(el, value) {
    fieldOf(el, "session").dispatchEvent(new CustomEvent("change", { detail: { key: "session", value } }));
    await micro();
  }
  async function submit(el) {
    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await micro();
  }
  const originalLocation = window.location;
  const originalOpen = window.open;
  let popup;
  beforeEach(() => {
    submitWithSource.mockReset();
    submitWithPayment.mockReset();
    getPaymentStatus.mockReset();
    cancelPayment.mockReset();
    checkPromotionCode.mockReset();
    getPublishedDefinition.mockReset();
    attachFile.mockReset();
    startSubmission.mockResolvedValue("");
    popup = { closed: false, close: jest.fn(), location: { href: "" } };
    window.open = jest.fn(() => popup);
    window.sessionStorage.clear();
  });
  afterEach(() => {
    jest.useRealTimers();
    window.open = originalOpen;
    window.history.replaceState({}, "", "/");
    if (window.location !== originalLocation) Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("totals the answers in the Payment block and puts the amount on the button", async () => {
    const el = mount(payForm());
    await micro();
    expect(submitButton(el).textContent).toBe("Submit");
    const block = fieldOf(el, "pay");
    expect(block.shadowRoot.querySelector(".jf-payment-test").textContent).toBe("Test payments. Use a Stripe test card. No money is charged.");
    expect(block.shadowRoot.querySelector(".jf-help").textContent).toBe("The price follows your answer to Session.");

    await choose(el, "8pm");
    expect(block.shadowRoot.querySelector(".jf-payment-name").textContent).toBe("Workshop ticket · 8pm session");
    expect(block.shadowRoot.querySelector(".jf-payment-total strong").textContent).toBe("$25.00");
    expect(submitButton(el).textContent).toBe("Pay $25 and submit");
  });

  it("opens Stripe's checkout in a popup from the click and shows the thank-you screen once paid", async () => {
    jest.useFakeTimers();
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValueOnce("open").mockResolvedValue("paid");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);

    expect(window.open).toHaveBeenCalledWith("", "jformPay", "popup,width=520,height=760");
    const args = submitWithPayment.mock.calls[0][0];
    expect(args).toMatchObject({ publicKey: "KEY123", returnUrl: "http://localhost/" });
    const sent = JSON.parse(args.answersJson);
    expect(sent).toMatchObject({ session: "6pm", __jf_honeypot: "" });
    expect("__jf_attempt" in sent).toBe(false);
    expect(popup.location.href).toBe(started.checkoutUrl);
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");
    expect(submitButton(el)).toBeNull();
    expect(fieldOf(el, "session").disabled).toBe(true);

    jest.advanceTimersByTime(3000);
    await micro();
    expect(getPaymentStatus).toHaveBeenLastCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1", confirm: false });
    expect(el.shadowRoot.querySelector(".jf-thanks")).toBeNull();

    jest.advanceTimersByTime(3000);
    await micro();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-pay-note")).toBeNull();
    expect(popup.close).toHaveBeenCalled();
    expect(submitWithSource).not.toHaveBeenCalled();
  });

  it("applies a promotion code the server accepts, prices the block with it and sends it with the answers", async () => {
    startSubmission.mockResolvedValue("tok_1");
    checkPromotionCode.mockResolvedValue({ valid: true, code: "SAVE10", discountType: "Percent", percentOff: 10 });
    submitWithPayment.mockResolvedValue({ ...started, amount: 18 });
    getPaymentStatus.mockResolvedValue("open");
    const el = mount(payForm({ codes: "jform" }));
    await micro();
    await choose(el, "6pm");
    const block = fieldOf(el, "pay");
    expect(block.payment).toMatchObject({ showCodeBox: true, codeApplied: "", totalText: "$20.00" });
    block.dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "save10" } }));
    await micro();
    expect(checkPromotionCode).toHaveBeenCalledWith({ publicKey: "KEY123", code: "save10", token: "tok_1" });
    expect(fieldOf(el, "pay").payment).toMatchObject({ codeApplied: "SAVE10", discountText: "−$2.00", totalText: "$18.00", codeError: "" });
    expect(submitButton(el).textContent).toBe("Pay $18 and submit");

    await submit(el);
    const sent = JSON.parse(submitWithPayment.mock.calls[0][0].answersJson);
    expect(sent.__jf_code).toBe("SAVE10");
  });

  it("sends a response a code made free through the Pay path, without opening a window", async () => {
    checkPromotionCode.mockResolvedValue({ valid: true, code: "FREE", discountType: "Percent", percentOff: 100 });
    submitWithPayment.mockResolvedValue({ submissionId: "a0X000000000001AAA", mode: "test", amount: 0, currencyCode: "USD" });
    const el = mount(payForm({ codes: "jform" }));
    await micro();
    await choose(el, "6pm");
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "FREE" } }));
    await micro();
    expect(fieldOf(el, "pay").payment).toMatchObject({ codeApplied: "FREE", totalText: "$0.00" });
    expect(submitButton(el).textContent).toBe("Submit");

    await submit(el);
    expect(submitWithSource).not.toHaveBeenCalled();
    expect(JSON.parse(submitWithPayment.mock.calls[0][0].answersJson).__jf_code).toBe("FREE");
    expect(window.open).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
  });

  it("prices a code down to the minimum charge the server sends, not below it", async () => {
    checkPromotionCode.mockResolvedValue({ valid: true, code: "BIG", discountType: "Percent", percentOff: 99, minimumCharge: 50 });
    const el = mount(payForm({ codes: "jform" }));
    await micro();
    await choose(el, "6pm");
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "BIG" } }));
    await micro();
    expect(fieldOf(el, "pay").payment).toMatchObject({ codeApplied: "BIG", discountText: "−$19.50", totalText: "$0.50" });
    expect(submitButton(el).textContent).toBe("Pay $0.50 and submit");
  });

  it("gives a refused code one message, and drops it when the Pay click finds it invalid", async () => {
    checkPromotionCode.mockResolvedValue({ valid: false });
    const el = mount(payForm({ codes: "jform" }));
    await micro();
    await choose(el, "6pm");
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "NOPE" } }));
    await micro();
    expect(fieldOf(el, "pay").payment).toMatchObject({ codeApplied: "", codeError: "This code isn't valid. Check it and try again.", totalText: "$20.00" });
    // the code was valid when applied, then used up before the Pay click: the server refuses, the block prices again without it
    // the server answers the amount in the smallest unit, as it prices
    checkPromotionCode.mockResolvedValue({ valid: true, code: "LAST", discountType: "Amount", amountOff: 500 });
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "LAST" } }));
    await micro();
    expect(fieldOf(el, "pay").payment).toMatchObject({ codeApplied: "LAST", totalText: "$15.00", codeError: "" });
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("removecode", { detail: { key: "pay" } }));
    await micro();
    expect(fieldOf(el, "pay").payment).toMatchObject({ codeApplied: "", totalText: "$20.00" });
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "LAST" } }));
    await micro();
    submitWithPayment.mockRejectedValue({ body: { message: "This code isn't valid. Check it and try again." } });
    await submit(el);
    expect(JSON.parse(submitWithPayment.mock.calls[0][0].answersJson).__jf_code).toBe("LAST");
    expect(fieldOf(el, "pay").payment).toMatchObject({ codeApplied: "", codeError: "This code isn't valid. Check it and try again.", totalText: "$20.00" });
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("This code isn't valid. Check it and try again.");
    expect(submitButton(el)).not.toBeNull();

    // a network failure reads the same as a refusal: nothing about the reason reaches the page
    checkPromotionCode.mockRejectedValue(new Error("boom"));
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "X" } }));
    await micro();
    expect(fieldOf(el, "pay").payment.codeError).toBe("This code isn't valid. Check it and try again.");
  });

  it("checks codes only on the published form, not in the builder preview", async () => {
    const el = mount(payForm({ codes: "jform" }), { previewMode: true });
    await micro();
    fieldOf(el, "pay").dispatchEvent(new CustomEvent("applycode", { detail: { key: "pay", code: "SAVE10" } }));
    await micro();
    expect(checkPromotionCode).not.toHaveBeenCalled();
    expect(fieldOf(el, "pay").payment.codeError).toBe("Promotion codes are checked on the published form.");
  });

  it("ends the wait once the checkout's hour is over, through the cancel path", async () => {
    jest.useFakeTimers();
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValue("open");
    cancelPayment.mockResolvedValue("expired");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);

    jest.advanceTimersByTime(65 * 60 * 1000);
    await micro();
    expect(cancelPayment).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");

    jest.advanceTimersByTime(3000);
    await micro();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1" });
    expect(el.shadowRoot.querySelector(".jf-pay-panel")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(submitButton(el).textContent).toBe("Pay $20 and submit");
    expect(popup.close).toHaveBeenCalled();
    const reads = getPaymentStatus.mock.calls.length;
    jest.advanceTimersByTime(9000);
    await micro();
    expect(getPaymentStatus.mock.calls.length).toBe(reads);
  });

  it("counts a payment made just before the wait ends", async () => {
    jest.useFakeTimers();
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValue("open");
    cancelPayment.mockResolvedValue("paid");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    jest.advanceTimersByTime(65 * 60 * 1000);
    await micro(); // the read in flight at the limit finishes first
    jest.advanceTimersByTime(3000);
    await micro();
    expect(cancelPayment).toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert")).toBeNull();
  });

  it("says so when the popup was closed, and offers to reopen it", async () => {
    jest.useFakeTimers();
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValue("open");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    popup.closed = true;
    jest.advanceTimersByTime(3000);
    await micro();
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("The payment window was closed.");
    expect(el.shadowRoot.querySelector(".jf-pay-text").textContent).toBe("Reopen it to finish paying, or cancel the payment.");
    expect(button(el, "Cancel payment")).not.toBeNull();

    const reopened = { closed: false, close: jest.fn(), location: { href: "" } };
    window.open.mockReturnValueOnce(reopened);
    button(el, "Reopen payment window").click();
    await micro();
    expect(window.open).toHaveBeenLastCalledWith(started.checkoutUrl, "jformPay", "popup,width=520,height=760");
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");
    expect(el.shadowRoot.querySelector(".jf-pay-text").textContent).toBe("This form updates as soon as you have paid.");
    jest.advanceTimersByTime(3000);
    await micro();
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");
  });

  it("opens Stripe's address when Lightning Web Security refuses the blank window", async () => {
    jest.useFakeTimers();
    // LWS (Winter '27 gate) throws for a same-origin page in a new window; Stripe's address is cross-origin
    window.open = jest.fn((url) => {
      if (url === "") throw new Error("Cannot open same-origin URL in a new browsing context.");
      return popup;
    });
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValue("paid");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    expect(window.open).toHaveBeenLastCalledWith(started.checkoutUrl, "jformPay", "popup,width=520,height=760");
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");

    jest.advanceTimersByTime(3000);
    await micro();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
    expect(popup.close).toHaveBeenCalled();
  });

  it("checks with Stripe at once when the popup says the respondent paid", async () => {
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValue("processing");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    window.dispatchEvent(new MessageEvent("message", { origin: "https://elsewhere.example", data: { type: "jform:payment", result: "success" } }));
    await micro();
    expect(getPaymentStatus).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: "jform:payment", result: "success" } }));
    await micro();
    expect(getPaymentStatus).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1", confirm: true });
    expect(el.shadowRoot.querySelector(".jf-pay-note").textContent).toBe("Your payment is processing. We'll confirm it by email.");
  });

  it("offers the payment page when the browser blocks the popup", async () => {
    // the blank window from the click, then Stripe's address once the server has it
    window.open = jest.fn().mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValue(popup);
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValue("open");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    expect(window.open).toHaveBeenNthCalledWith(2, started.checkoutUrl, "jformPay", "popup,width=520,height=760");
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("The payment window may not have opened.");
    expect(el.shadowRoot.querySelector(".jf-pay-text").textContent).toBe("If you don't see it, open the payment page. This form updates as soon as you have paid.");
    button(el, "Open payment page").click();
    await micro();
    expect(window.open).toHaveBeenLastCalledWith(started.checkoutUrl, "jformPay", "popup,width=520,height=760");
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");
  });

  it("cancels the checkout from the panel and keeps the answers for another try", async () => {
    submitWithPayment.mockResolvedValue(started);
    cancelPayment.mockResolvedValue("expired");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    button(el, "Cancel payment").click();
    await micro();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1" });
    expect(popup.close).toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(submitButton(el).textContent).toBe("Pay $20 and submit");
    expect(fieldOf(el, "session").value).toBe("6pm");
  });

  it("keeps the form locked when the checkout could not be cancelled, until Stripe ends it", async () => {
    jest.useFakeTimers();
    submitWithPayment.mockResolvedValue(started);
    cancelPayment.mockRejectedValue(new Error("The payment could not be cancelled. Please try again."));
    getPaymentStatus.mockResolvedValue("open");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    button(el, "Cancel payment").click();
    await micro();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1" });
    expect(popup.close).toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("The payment could not be cancelled.");
    expect(el.shadowRoot.querySelector(".jf-pay-text").textContent).toBe("You can still finish paying, or try cancelling again.");
    expect(button(el, "Reopen payment window")).not.toBeUndefined();
    expect(button(el, "Cancel payment")).not.toBeUndefined();
    expect(submitButton(el)).toBeNull();
    expect(fieldOf(el, "session").disabled).toBe(true);
    expect(el.shadowRoot.querySelector(".jf-alert")).toBeNull();

    // the checkout is read as before, and the message stays while it is open
    jest.advanceTimersByTime(3000);
    await micro();
    expect(getPaymentStatus).toHaveBeenLastCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1", confirm: false });
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("The payment could not be cancelled.");

    getPaymentStatus.mockResolvedValue("expired");
    jest.advanceTimersByTime(3000);
    await micro();
    expect(el.shadowRoot.querySelector(".jf-pay-panel")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(submitButton(el).textContent).toBe("Pay $20 and submit");
    expect(fieldOf(el, "session").value).toBe("6pm");
  });

  it("stays locked when the server answers that the checkout is still open, and unlocks when a later cancel ends it", async () => {
    submitWithPayment.mockResolvedValue(started);
    cancelPayment.mockResolvedValueOnce("open").mockResolvedValueOnce("expired");
    getPaymentStatus.mockResolvedValue("open");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    button(el, "Cancel payment").click();
    await micro();
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("The payment could not be cancelled.");
    expect(submitButton(el)).toBeNull();

    // reopening the window puts the usual message back; closing it again says so, not that the cancel failed
    const reopened = { closed: false, close: jest.fn(), location: { href: "" } };
    window.open.mockReturnValueOnce(reopened);
    button(el, "Reopen payment window").click();
    await micro();
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");

    button(el, "Cancel payment").click();
    await micro();
    expect(cancelPayment).toHaveBeenCalledTimes(2);
    expect(reopened.close).toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-pay-panel")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(submitButton(el).textContent).toBe("Pay $20 and submit");
  });

  it("counts a payment made before a failed cancel is tried again", async () => {
    submitWithPayment.mockResolvedValue(started);
    cancelPayment.mockResolvedValueOnce("open").mockResolvedValueOnce("paid");
    getPaymentStatus.mockResolvedValue("open");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    button(el, "Cancel payment").click();
    await micro();
    button(el, "Cancel payment").click();
    await micro();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert")).toBeNull();
  });

  it("back from Stripe's page, keeps the form locked with the payment page at hand when the checkout could not be cancelled", async () => {
    window.sessionStorage.setItem("jform:pay:KEY123", JSON.stringify({ reference: "cs_test_1", url: started.checkoutUrl, answers: { session: "8pm" }, pageIndex: 0 }));
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=cancel&jfref=jf_abc123");
    getPublishedDefinition.mockResolvedValue(JSON.stringify(payForm({ openIn: "page" })));
    cancelPayment.mockRejectedValue(new Error("The payment could not be cancelled. Please try again."));
    const el = mount(undefined, {});
    await micro();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "jf_abc123" });
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("The payment could not be cancelled.");
    expect(el.shadowRoot.querySelector(".jf-pay-text").textContent).toBe("You can still finish paying, or try cancelling again.");
    expect(button(el, "Reopen payment window")).toBeUndefined();
    const link = el.shadowRoot.querySelector(".jf-pay-actions a");
    expect(link.textContent).toBe("Open payment page");
    expect(link.getAttribute("href")).toBe(started.checkoutUrl);
    expect(button(el, "Cancel payment")).not.toBeUndefined();
    expect(fieldOf(el, "session").value).toBe("8pm");
    expect(fieldOf(el, "session").disabled).toBe(true);
    expect(submitButton(el)).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert")).toBeNull();
    expect(window.sessionStorage.getItem("jform:pay:KEY123")).not.toBeNull();
  });

  it("keeps waiting when the checkout is unknown, and ends the wait through the limit's cancel", async () => {
    jest.useFakeTimers();
    submitWithPayment.mockResolvedValue(started);
    getPaymentStatus.mockResolvedValue("unknown");
    cancelPayment.mockResolvedValue("unknown");
    const el = mount(payForm());
    await micro();
    await choose(el, "6pm");
    await submit(el);
    jest.advanceTimersByTime(3000);
    await micro();
    jest.advanceTimersByTime(3000);
    await micro();
    expect(getPaymentStatus).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("Complete your payment in the Stripe window");
    expect(submitButton(el)).toBeNull();

    jest.advanceTimersByTime(65 * 60 * 1000);
    await micro(); // the read in flight at the limit finishes first
    jest.advanceTimersByTime(3000);
    await micro();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1" });
    expect(el.shadowRoot.querySelector(".jf-pay-panel")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(submitButton(el).textContent).toBe("Pay $20 and submit");
  });

  it("back from Stripe's page with nothing kept, offers only another cancel when the checkout could not be cancelled", async () => {
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=cancel&jfref=jf_abc123");
    getPublishedDefinition.mockResolvedValue(JSON.stringify(payForm({ openIn: "page" })));
    cancelPayment.mockResolvedValue("open");
    const el = mount(undefined, {});
    await micro();
    expect(el.shadowRoot.querySelector(".jf-pay-title").textContent).toBe("The payment could not be cancelled.");
    expect(el.shadowRoot.querySelector(".jf-pay-text").textContent).toBe("Try cancelling again in a moment.");
    expect(el.shadowRoot.querySelector(".jf-pay-actions a")).toBeNull();
    expect(button(el, "Reopen payment window")).toBeUndefined();
    expect(button(el, "Cancel payment")).not.toBeUndefined();
    expect(submitButton(el)).toBeNull();
  });

  it("back from Stripe's success page with a reference no checkout has, says the payment wasn't completed instead of checking for an hour", async () => {
    window.sessionStorage.setItem("jform:pay:KEY123", JSON.stringify({ reference: "cs_test_1", url: started.checkoutUrl, answers: { session: "8pm" }, pageIndex: 0 }));
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=success&jfcs=cs_test_1");
    getPublishedDefinition.mockResolvedValue(JSON.stringify(payForm({ openIn: "page" })));
    getPaymentStatus.mockResolvedValue("unknown");
    const el = mount(undefined, {});
    await micro();
    expect(getPaymentStatus).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1", confirm: true });
    expect(el.shadowRoot.querySelector(".jf-pay-panel")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(fieldOf(el, "session").value).toBe("8pm");
    expect(fieldOf(el, "session").disabled).toBe(false);
    expect(submitButton(el)).not.toBeNull();
    expect(window.sessionStorage.getItem("jform:pay:KEY123")).toBeNull();
  });

  it("sends a response that owes nothing the usual way", async () => {
    submitWithSource.mockResolvedValue("a0X000000000001AAA");
    const el = mount(payForm());
    await micro();
    await submit(el);
    expect(window.open).not.toHaveBeenCalled();
    expect(submitWithPayment).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
  });

  it("goes to Stripe's page with the answers kept, and shows the thank-you screen on the way back", async () => {
    const assign = jest.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, href: "http://localhost/book?key=KEY123", search: "?key=KEY123", assign } });
    submitWithPayment.mockResolvedValue(started);
    const el = mount(payForm({ openIn: "page" }));
    await micro();
    await choose(el, "6pm");
    await submit(el);
    expect(window.open).not.toHaveBeenCalled();
    expect(submitWithPayment.mock.calls[0][0].returnUrl).toBe("http://localhost/book?key=KEY123");
    expect(assign).toHaveBeenCalledWith(started.checkoutUrl);
    expect(JSON.parse(window.sessionStorage.getItem("jform:pay:KEY123"))).toMatchObject({ reference: "cs_test_1", answers: { session: "6pm" } });
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    document.body.removeChild(el);

    // the success link carries Stripe's ID and JForm's own reference; the status is checked by Stripe's
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=success&jfref=jf_abc123&jfcs=cs_test_1");
    getPublishedDefinition.mockResolvedValue(JSON.stringify(payForm({ openIn: "page" })));
    getPaymentStatus.mockResolvedValue("paid");
    const back = mount(undefined, {});
    await micro();
    expect(getPaymentStatus).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1", confirm: true });
    expect(back.shadowRoot.querySelector(".jf-thanks")).not.toBeNull();
    expect(window.location.search).toBe("?key=KEY123");
    expect(window.sessionStorage.getItem("jform:pay:KEY123")).toBeNull();
  });

  it("comes back from a cancelled checkout on Stripe's page with the answers restored", async () => {
    window.sessionStorage.setItem("jform:pay:KEY123", JSON.stringify({ reference: "cs_test_1", answers: { session: "8pm" }, pageIndex: 0 }));
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=cancel&jfref=jf_abc123");
    getPublishedDefinition.mockResolvedValue(JSON.stringify(payForm({ openIn: "page" })));
    cancelPayment.mockResolvedValue("expired");
    const el = mount(undefined, {});
    await micro();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "jf_abc123" });
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(fieldOf(el, "session").value).toBe("8pm");
    expect(submitButton(el).textContent).toBe("Pay $25 and submit");
    expect(window.location.search).toBe("?key=KEY123");
  });

  it("ends a cancelled checkout from the link alone when the browser kept nothing, as an embedded form does", async () => {
    // a framed form went to Stripe's page and comes back as a page of its own: its sessionStorage is another partition
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=cancel&jfref=jf_abc123");
    getPublishedDefinition.mockResolvedValue(JSON.stringify(payForm({ openIn: "page" })));
    cancelPayment.mockResolvedValue("expired");
    const el = mount(undefined, {});
    await micro();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "jf_abc123" });
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toBe("Your response wasn't sent because the payment wasn't completed.");
    expect(fieldOf(el, "session").value).toBeFalsy();
    expect(submitButton(el)).not.toBeNull();
  });

  it("comes back from a link an old checkout made, without a reference, as a plain form", async () => {
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=cancel");
    getPublishedDefinition.mockResolvedValue(JSON.stringify(payForm({ openIn: "page" })));
    const el = mount(undefined, {});
    await micro();
    expect(cancelPayment).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-alert")).toBeNull();
    expect(window.location.search).toBe("?key=KEY123");
  });

  it("in the popup's return page, confirms the payment, tells the form and closes", async () => {
    const postMessage = jest.fn();
    const close = jest.spyOn(window, "close").mockImplementation(() => {});
    Object.defineProperty(window, "opener", { configurable: true, value: { postMessage } });
    try {
      window.history.replaceState({}, "", "/book?key=KEY123&jfpay=success&jfwin=1&jfcs=cs_test_1");
      getPaymentStatus.mockResolvedValue("paid");
      const el = mount(undefined, {});
      await micro();
      expect(getPublishedDefinition).not.toHaveBeenCalled();
      expect(getPaymentStatus).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1", confirm: true });
      expect(postMessage).toHaveBeenCalledWith({ type: "jform:payment", result: "success", status: "paid" }, window.location.origin);
      expect(close).toHaveBeenCalled();
      expect(el.shadowRoot.querySelector(".jf-pay-return .jf-title").textContent).toBe("Payment received");
    } finally {
      Object.defineProperty(window, "opener", { configurable: true, value: null });
      close.mockRestore();
    }
  });

  it("keeps the Pay button off when the form isn't taking payments", async () => {
    const el = mount(payForm({ mode: "live", unavailable: "This form isn't taking payments right now." }));
    await micro();
    await choose(el, "6pm");
    expect(submitButton(el).disabled).toBe(true);
    expect(el.shadowRoot.querySelector(".jf-alert-info").textContent).toBe("This form isn't taking payments right now.");
    expect(fieldOf(el, "pay").shadowRoot.querySelector(".jf-payment-test")).toBeNull();
  });

  it("never takes a payment in the builder preview", async () => {
    const el = mount(payForm(), { previewMode: true });
    await micro();
    await choose(el, "6pm");
    await submit(el);
    expect(window.open).not.toHaveBeenCalled();
    expect(submitWithPayment).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-alert-info").textContent).toContain("no payment is taken");
  });
});

describe("c-jform-renderer before it opens and after it closes", () => {
  // microtasks only: the Apex mocks and LWC's re-render both settle on them
  const settle = () => Array.from({ length: 20 }).reduce((p) => p.then(() => Promise.resolve()), Promise.resolve());
  const byKey = () => {
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    return el;
  };
  const text = (el, sel) => el.shadowRoot.querySelector(sel)?.textContent?.trim();
  const fieldOf = (el, key) => [...el.shadowRoot.querySelectorAll("c-jform-field")].find((f) => f.field?.key === key);
  const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();
  const closedView = JSON.stringify({ state: "closed", name: "Clinic", label: "Register for the clinic", theme: {}, title: "Bookings are closed", ending: { title: "You're booked" } });
  afterEach(() => {
    getPublishedDefinition.mockReset();
    getAvailabilityScreen.mockReset();
    getAvailabilityScreen.mockResolvedValue(null);
    getPaymentStatus.mockReset();
    cancelPayment.mockReset();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("shows the not-yet-open screen in place of the form, without the questions", async () => {
    getPublishedDefinition.mockRejectedValue({ body: { message: "This form is not open yet. It opens on Tuesday 12 January 2027 at 9:00 AM GMT-08:00." } });
    getAvailabilityScreen.mockResolvedValue(
      JSON.stringify({ state: "notOpen", name: "Clinic", label: "Register for the clinic", theme: {}, title: "Bookings open soon", message: "<p>See you then.</p>", opensText: "Tuesday 12 January 2027 at 9:00 AM GMT-08:00" })
    );
    const el = byKey();
    await settle();
    expect(getAvailabilityScreen).toHaveBeenCalledWith({ publicKey: "KEY123" });
    expect(text(el, ".jf-availability .jf-title")).toBe("Bookings open soon");
    expect(el.shadowRoot.querySelector(".jf-availability lightning-formatted-rich-text").value).toBe("<p>See you then.</p>");
    expect(text(el, ".jf-availability-when")).toBe("This form opens on Tuesday 12 January 2027 at 9:00 AM GMT-08:00.");
    expect(el.shadowRoot.querySelector("form")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-unavailable")).toBeNull();
  });

  it("falls back to the form's title and the standard closed text, and to the error when the form is simply not live", async () => {
    getPublishedDefinition.mockRejectedValue({ body: { message: "This form is no longer accepting responses." } });
    getAvailabilityScreen.mockResolvedValue(JSON.stringify({ state: "closed", name: "Clinic", label: "Register for the clinic", theme: {} }));
    const closed = byKey();
    await settle();
    expect(text(closed, ".jf-availability .jf-title")).toBe("Register for the clinic");
    expect(closed.shadowRoot.querySelector(".jf-availability lightning-formatted-rich-text").value).toBe("<p>This form is no longer accepting responses.</p>");
    expect(closed.shadowRoot.querySelector(".jf-availability-when")).toBeNull();

    getPublishedDefinition.mockRejectedValue({ body: { message: "This form is not available." } });
    getAvailabilityScreen.mockRejectedValue({ body: { message: "This form is not available." } });
    const gone = byKey();
    await settle();
    expect(text(gone, ".jf-unavailable")).toBe("This form is not available.");
    expect(gone.shadowRoot.querySelector(".jf-availability")).toBeNull();
  });

  it("shows the closed screen when a response is refused because the form closed meanwhile", async () => {
    submitWithSource.mockRejectedValue({ body: { message: "Bookings are closed." } });
    getAvailabilityScreen.mockResolvedValue(JSON.stringify({ state: "closed", title: "Bookings are closed" }));
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = { ...definition, mayClose: true };
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    await settle();
    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();
    expect(text(el, ".jf-availability .jf-title")).toBe("Bookings are closed");
    expect(el.shadowRoot.querySelector("form")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-alert")).toBeNull();
  });

  it("asks the server again when a cached copy of the form is past its closing time", async () => {
    getPublishedDefinition.mockResolvedValue(JSON.stringify({ ...definition, closesAt: inMinutes(-5) }));
    getAvailabilityScreen.mockResolvedValue(closedView);
    const closed = byKey();
    await settle();
    expect(getAvailabilityScreen).toHaveBeenCalledWith({ publicKey: "KEY123" });
    expect(text(closed, ".jf-availability .jf-title")).toBe("Bookings are closed");
    expect(closed.shadowRoot.querySelector("form")).toBeNull();

    // the builder moved the closing time since: the server says it's open, so the form shows
    getAvailabilityScreen.mockResolvedValue(null);
    const reopened = byKey();
    await settle();
    expect(reopened.shadowRoot.querySelector("form")).not.toBeNull();

    getAvailabilityScreen.mockClear();
    getPublishedDefinition.mockResolvedValue(JSON.stringify({ ...definition, closesAt: inMinutes(60) }));
    const open = byKey();
    await settle();
    expect(getAvailabilityScreen).not.toHaveBeenCalled();
    expect(open.shadowRoot.querySelector("form")).not.toBeNull();
  });

  it("back from Stripe's page after the form closed, confirms the payment and shows the thank-you screen", async () => {
    window.sessionStorage.setItem("jform:pay:KEY123", JSON.stringify({ reference: "cs_test_1", answers: { transport: "Walking" }, pageIndex: 0 }));
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=success&jfcs=cs_test_1");
    getPublishedDefinition.mockRejectedValue({ body: { message: "Bookings are closed." } });
    getAvailabilityScreen.mockResolvedValue(closedView);
    getPaymentStatus.mockResolvedValue("paid");
    const el = byKey();
    await settle();
    expect(getPaymentStatus).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "cs_test_1", confirm: true });
    expect(text(el, ".jf-thanks-title")).toBe("You're booked");
    expect(el.shadowRoot.querySelector(".jf-availability")).toBeNull();
    expect(window.sessionStorage.getItem("jform:pay:KEY123")).toBeNull();
  });

  it("a checkout cancelled after it took the last place gives it back, and the form comes back with the answers", async () => {
    window.sessionStorage.setItem("jform:pay:KEY123", JSON.stringify({ reference: "cs_test_1", answers: { transport: "Walking" }, pageIndex: 0 }));
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=cancel&jfref=jf_abc123");
    getPublishedDefinition.mockRejectedValueOnce({ body: { message: "Bookings are closed." } }).mockResolvedValueOnce(JSON.stringify(definition));
    getAvailabilityScreen.mockResolvedValue(closedView);
    cancelPayment.mockResolvedValue("expired");
    const el = byKey();
    await settle();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "jf_abc123" });
    expect(el.shadowRoot.querySelector(".jf-availability")).toBeNull();
    expect(fieldOf(el, "transport").value).toBe("Walking");
    expect(text(el, ".jf-alert")).toBe("Your response wasn't sent because the payment wasn't completed.");
  });

  it("a checkout cancelled on a form that is still shut keeps the closed screen", async () => {
    window.history.replaceState({}, "", "/book?key=KEY123&jfpay=cancel&jfref=jf_abc123");
    getPublishedDefinition.mockRejectedValue({ body: { message: "Bookings are closed." } });
    getAvailabilityScreen.mockResolvedValue(closedView);
    cancelPayment.mockResolvedValue("expired");
    const el = byKey();
    await settle();
    expect(cancelPayment).toHaveBeenCalledWith({ publicKey: "KEY123", checkoutReference: "jf_abc123" });
    expect(getPublishedDefinition).toHaveBeenCalledTimes(2);
    expect(text(el, ".jf-availability .jf-title")).toBe("Bookings are closed");
    expect(el.shadowRoot.querySelector("form")).toBeNull();
  });

  it("doesn't ask for a closed screen when the form can't close", async () => {
    submitWithSource.mockRejectedValue({ body: { message: "Please answer Email." } });
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = definition;
    el.publicKey = "KEY123";
    document.body.appendChild(el);
    await settle();
    el.shadowRoot.querySelector("form").dispatchEvent(new CustomEvent("submit", { cancelable: true }));
    await settle();
    expect(getAvailabilityScreen).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelector(".jf-alert").textContent).toContain("Please answer Email.");
  });

  it("lets the builder preview the draft's two screens", async () => {
    const states = [];
    const el = createElement("c-jform-renderer", { is: JformRenderer });
    el.definition = {
      ...definition,
      settings: { access: { openAt: "2027-01-12T17:00:00.000Z", timeZone: "America/Los_Angeles", notOpen: { title: "Soon", imageUrl: "http://plain.example/a.png" }, closedMessage: "No <more>." } }
    };
    el.previewMode = true;
    el.addEventListener("previewstate", (e) => states.push(e.detail));
    document.body.appendChild(el);
    await settle();
    expect(states[states.length - 1]).toMatchObject({ notOpen: true, closed: true });
    expect(el.shadowRoot.querySelector(".jf-availability")).toBeNull();

    el.showPage("__notOpen");
    await settle();
    expect(text(el, ".jf-availability .jf-title")).toBe("Soon");
    expect(text(el, ".jf-availability-when")).toBe("This form opens on Tuesday 12 January 2027 at 9:00 AM GMT-08:00.");
    expect(el.shadowRoot.querySelector(".jf-availability img.jf-welcome-image")).toBeNull(); // only https images
    expect(states[states.length - 1].current).toBe("__notOpen");

    el.showPage("__closed");
    await settle();
    expect(el.shadowRoot.querySelector(".jf-availability lightning-formatted-rich-text").value).toBe("<p>No &lt;more&gt;.</p>");
    expect(states[states.length - 1].current).toBe("__closed");

    el.showPage("p1");
    await settle();
    expect(el.shadowRoot.querySelector(".jf-availability")).toBeNull();
    expect(el.shadowRoot.querySelector("form")).not.toBeNull();
    expect(getAvailabilityScreen).not.toHaveBeenCalled();

    // the builder removes the opening time while the preview shows its screen: the form comes back
    el.showPage("__notOpen");
    await settle();
    el.definition = { ...definition, settings: { access: { closedMessage: "No <more>." } } };
    await settle();
    expect(el.shadowRoot.querySelector(".jf-availability")).toBeNull();
    expect(states[states.length - 1]).toMatchObject({ notOpen: false, closed: true });
    expect(states[states.length - 1].current).not.toBe("__notOpen");
  });
});

