import { createElement } from "lwc";
import JformField from "c/jformField";

function mount(field, props = {}) {
  const el = createElement("c-jform-field", { is: JformField });
  el.field = field;
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}
const flush = () => Promise.resolve();

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-field rich text blocks", () => {
  it("shows an indented paragraph with explicit padding, so the public site needs no editor stylesheet", async () => {
    const el = mount({ key: "intro", type: "richtext", richtext: '<p class="ql-indent-1">The Brisbane clinic</p><p>Plain</p>' });
    await flush();
    const rich = el.shadowRoot.querySelector("lightning-formatted-rich-text.jf-richtext");
    expect(rich.value).toBe('<p class="ql-indent-1" style="padding-left: 3em;">The Brisbane clinic</p><p>Plain</p>');
  });
});

describe("c-jform-field dates and times", () => {
  it("renders the date picker, relays its value under the field key and validates the limits", async () => {
    const el = mount({ key: "visit", type: "date", label: "Visit date", required: true, config: { minDate: "2026-10-10" } });
    await flush();
    const picker = el.shadowRoot.querySelector("c-jform-date-picker");
    expect(picker).not.toBeNull();
    expect(el.shadowRoot.querySelector("input")).toBeNull(); // the native input is gone
    expect(picker.config).toEqual({ minDate: "2026-10-10" });
    expect(picker.ariaLabel).toBe("Visit date");
    const seen = [];
    el.addEventListener("change", (e) => seen.push(e.detail));
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "2026-10-01" } }));
    expect(seen).toEqual([{ key: "visit", value: "2026-10-01" }]);
    el.value = "2026-10-01";
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("Choose a date on or after");
    el.value = "2026-10-12";
    await flush();
    expect(el.validate()).toBe(true);
    el.value = "";
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("Complete this field");
  });

  it("renders the time picker with the field's config and marks it invalid outside the limits", async () => {
    const el = mount({ key: "slot", type: "time", label: "Arrival", config: { step: 30, minTime: "09:00" }, validation: { errorMessage: "Pick an opening time" } });
    await flush();
    const picker = el.shadowRoot.querySelector("c-jform-time-picker");
    expect(picker.config).toEqual({ step: 30, minTime: "09:00" });
    el.value = "08:00";
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("Pick an opening time");
    expect(picker.ariaInvalid).toBe("true");
    el.value = "09:30";
    await flush();
    expect(el.validate()).toBe(true);
  });

  it("keeps the pickers inert on the builder canvas", async () => {
    const el = mount({ key: "visit", type: "date", label: "Visit date" }, { mode: "edit" });
    await flush();
    expect(el.shadowRoot.querySelector("c-jform-date-picker").disabled).toBe(true);
  });
});

describe("c-jform-field text inputs", () => {
  it("renders a native input wired to its label", async () => {
    const el = mount({ key: "email", type: "email", label: "Email", required: true, helpText: "We only use this to confirm" });
    await flush();
    const label = el.shadowRoot.querySelector("label.jf-label");
    const input = el.shadowRoot.querySelector("input.jf-input");
    expect(label.textContent).toContain("Email");
    expect(label.textContent).toContain("*");
    expect(input.type).toBe("email");
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute("aria-describedby")).toBe(el.shadowRoot.querySelector(".jf-desc").id);
    expect(el.shadowRoot.querySelector(".jf-help").textContent).toBe("We only use this to confirm");
    expect(el.shadowRoot.querySelector("lightning-input")).toBeNull();
  });

  it("validates required and format, showing a themed error", async () => {
    const el = mount({ key: "email", type: "email", label: "Email", required: true });
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("Complete this field");
    expect(el.shadowRoot.querySelector("input").getAttribute("aria-invalid")).toBe("true");

    el.value = "nope";
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("valid email");

    el.value = "a@b.co";
    expect(el.validate()).toBe(true);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error")).toBeNull();
  });

  it("emits change with key and value as the user types", async () => {
    const el = mount({ key: "first_name", type: "text", label: "First name" });
    const handler = jest.fn();
    el.addEventListener("change", handler);
    await flush();
    const input = el.shadowRoot.querySelector("input");
    input.value = "Noah";
    input.dispatchEvent(new CustomEvent("input"));
    expect(handler.mock.calls[0][0].detail).toEqual({ key: "first_name", value: "Noah" });
  });

  it("uses a textarea for long text and a select for dropdowns", async () => {
    const el = mount({ key: "notes", type: "comment", label: "Notes" });
    await flush();
    expect(el.shadowRoot.querySelector("textarea.jf-input")).not.toBeNull();
    // a textarea drawn with an answer shows it, and follows a change made elsewhere
    const answered = mount({ key: "notes", type: "comment", label: "Notes" }, { value: "Ground floor" });
    await flush();
    expect(answered.shadowRoot.querySelector("textarea").value).toBe("Ground floor");
    answered.value = "";
    await flush();
    expect(answered.shadowRoot.querySelector("textarea").value).toBe("");

    const sel = mount({ key: "season", type: "picklist", label: "Season", options: [{ label: "Summer" }, { label: "Autumn", value: "autumn" }] }, { value: "autumn" });
    await flush();
    const options = sel.shadowRoot.querySelectorAll("option");
    expect(options).toHaveLength(3); // placeholder + 2
    expect(options[2].selected).toBe(true);
  });
});

describe("c-jform-field choices", () => {
  const field = { key: "season", type: "radio", label: "Season", options: [{ label: "Summer" }, { label: "Autumn" }, { label: "Winter" }] };

  it("renders radio cards in a labelled group and emits the picked value", async () => {
    const el = mount(field);
    const handler = jest.fn();
    el.addEventListener("change", handler);
    await flush();
    const group = el.shadowRoot.querySelector('[role="radiogroup"]');
    const label = el.shadowRoot.querySelector("span.jf-label");
    expect(group.getAttribute("aria-labelledby")).toBe(label.id);
    const radios = el.shadowRoot.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(3);
    expect(new Set([...radios].map((r) => r.name)).size).toBe(1);
    radios[1].click();
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { key: "season", value: "Autumn" } }));
  });

  it("marks the selected choice", async () => {
    const el = mount(field, { value: "Winter" });
    await flush();
    const on = el.shadowRoot.querySelector(".jf-choice-on");
    expect(on.textContent).toContain("Winter");
  });

  it("keeps checkbox answers in option order", async () => {
    const el = mount({ ...field, type: "checkboxes" }, { value: ["Winter"] });
    const handler = jest.fn();
    el.addEventListener("change", handler);
    await flush();
    expect(el.shadowRoot.querySelector('[role="group"]')).not.toBeNull();
    el.shadowRoot.querySelectorAll('input[type="checkbox"]')[0].click();
    expect(handler.mock.calls[0][0].detail.value).toEqual(["Summer", "Winter"]);
  });

  it("supports yes/no, NPS and consent", async () => {
    const yn = mount({ key: "parking", type: "yesno", label: "Parking?" });
    const ynHandler = jest.fn();
    yn.addEventListener("change", ynHandler);
    await flush();
    yn.shadowRoot.querySelectorAll('button[role="radio"]')[0].click();
    expect(ynHandler.mock.calls[0][0].detail.value).toBe("Yes");

    const nps = mount({ key: "nps", type: "nps", label: "Recommend?" }, { value: "9" });
    await flush();
    const nine = nps.shadowRoot.querySelectorAll(".jf-scale-btn")[9];
    expect(nine.getAttribute("aria-checked")).toBe("true");

    const consent = mount({ key: "consent", type: "consent", label: "I agree", required: true });
    await flush();
    expect(consent.validate()).toBe(false);
    await flush();
    expect(consent.shadowRoot.querySelector(".jf-error").textContent).toContain("confirm");
    consent.value = true;
    expect(consent.validate()).toBe(true);
  });

  it("starts a consent checkbox at the field's left edge, with no label column beside it when labels sit on the left", async () => {
    const consent = mount({ key: "waiver", type: "consent", label: "I accept the waiver", required: true });
    const text = mount({ key: "name", type: "text", label: "Name" });
    await flush();
    const wrapper = consent.shadowRoot.querySelector(".jf-field");
    // jformField.css gives .jf-kind-consent one column, so the left-label grid does not apply
    expect(wrapper.classList).toContain("jf-kind-consent");
    expect(wrapper.querySelector(".jf-label-spacer")).toBeNull();
    expect(wrapper.firstElementChild.classList).toContain("jf-body");
    expect(wrapper.querySelector(".jf-consent-text").textContent).toContain("I accept the waiver");
    // other fields keep their label column
    expect(text.shadowRoot.querySelector(".jf-field .jf-label")).not.toBeNull();
  });
});

describe("c-jform-field edit mode", () => {
  it("renders the same controls but inert", async () => {
    const el = mount({ key: "first_name", type: "text", label: "First name", required: true }, { mode: "edit" });
    await flush();
    expect(el.shadowRoot.querySelector("input").disabled).toBe(true);
    expect(el.validate()).toBe(true); // never blocks the builder
    const hidden = mount({ key: "utm", type: "hidden", label: "UTM" }, { mode: "edit" });
    await flush();
    expect(hidden.shadowRoot.textContent).toContain("Hidden field: UTM");
  });
});

describe("c-jform-field width awareness", () => {
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

  it("stacks the label above the control when the field is narrow", async () => {
    const el = mount({ key: "first_name", type: "text", label: "First name" });
    await flush();
    const grid = () => el.shadowRoot.querySelector(".jf-field");
    expect(grid().classList.contains("jf-compact")).toBe(false);
    observers[0].cb([{ contentRect: { width: 300 } }]);
    await flush();
    expect(grid().classList.contains("jf-compact")).toBe(true);
    observers[0].cb([{ contentRect: { width: 700 } }]);
    await flush();
    expect(grid().classList.contains("jf-compact")).toBe(false);
  });
});

describe("c-jform-field file upload", () => {
  it("hands the chosen files to the renderer with the change", async () => {
    const el = mount({ key: "cv", type: "fileupload", label: "CV" });
    await flush();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    const input = el.shadowRoot.querySelector('input[type="file"]');
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[0][0].detail).toEqual({ key: "cv", value: ["cv.pdf"], files: [file] });
    expect(el.getFiles()).toEqual([file]);
  });
});

describe("c-jform-field signature", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("hands the pad its settings and relays the image under the field key", async () => {
    const el = mount({ key: "sig", type: "signature", label: "Signature", required: true, config: { statement: "I agree.", height: "small" } });
    await flush();
    const pad = el.shadowRoot.querySelector("c-jform-signature-pad");
    expect(pad.config).toEqual({ statement: "I agree.", height: "small" });
    expect(pad.ariaLabel).toBe("Signature");
    expect(pad.disabled).toBe(false);
    const handler = jest.fn();
    el.addEventListener("change", handler);
    pad.dispatchEvent(new CustomEvent("change", { detail: { value: PNG } }));
    expect(handler.mock.calls[0][0].detail).toEqual({ key: "sig", value: PNG });
  });

  it("asks for a signature when a required pad is cleared", async () => {
    const el = mount({ key: "sig", type: "signature", label: "Signature", required: true }, { value: PNG });
    await flush();
    expect(el.validate()).toBe(true);
    el.shadowRoot.querySelector("c-jform-signature-pad").dispatchEvent(new CustomEvent("change", { detail: { value: "" } }));
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("Complete this field.");
  });

  it("keeps the pad inert on the builder canvas", async () => {
    const el = mount({ key: "sig", type: "signature", label: "Signature" }, { mode: "edit" });
    await flush();
    expect(el.shadowRoot.querySelector("c-jform-signature-pad").disabled).toBe(true);
  });
});

describe("c-jform-field table", () => {
  const table = {
    key: "satisfaction",
    type: "table",
    label: "How satisfied were you with",
    required: true,
    options: [{ label: "Poor" }, { label: "Good", value: "Good" }],
    config: { rows: [{ key: "service", label: "Service" }, { key: "price", label: "Price" }], multiple: true }
  };

  it("hands the table its rows, columns and answer, and relays the answer under the field key", async () => {
    const el = mount(table, { value: { service: ["Good"] } });
    await flush();
    const grid = el.shadowRoot.querySelector("c-jform-choice-table");
    expect(grid.rows).toEqual([{ key: "service", label: "Service" }, { key: "price", label: "Price" }]);
    expect(grid.columns).toEqual([{ label: "Poor", value: "Poor" }, { label: "Good", value: "Good" }]);
    expect(grid.value).toEqual({ service: ["Good"] });
    expect(grid.multiple).toBe(true);
    expect(grid.ariaLabel).toBe("How satisfied were you with");
    expect(el.shadowRoot.querySelector(".jf-field").classList.contains("jf-kind-table")).toBe(true);
    const handler = jest.fn();
    el.addEventListener("change", handler);
    grid.dispatchEvent(new CustomEvent("change", { detail: { value: { service: ["Good"], price: ["Poor"] } } }));
    expect(handler.mock.calls[0][0].detail).toEqual({ key: "satisfaction", value: { service: ["Good"], price: ["Poor"] } });
  });

  it("names and marks the rows a required table is missing, without nagging while it is filled in", async () => {
    const el = mount(table, { value: {} });
    await flush();
    const grid = el.shadowRoot.querySelector("c-jform-choice-table");
    grid.dispatchEvent(new CustomEvent("change", { detail: { value: { service: ["Good"] } } }));
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error")).toBeNull(); // still working down the table

    el.value = { service: ["Good"] };
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("Answer every row: Price.");
    expect(grid.missingRows).toEqual(["price"]);

    el.value = { service: ["Good"], price: ["Poor"] };
    expect(el.validate()).toBe(true);
  });

  it("is happy with one row when every row is not needed, and with none when optional", async () => {
    let el = mount({ ...table, config: { ...table.config, everyRow: false } }, { value: { price: ["Poor"] } });
    await flush();
    expect(el.validate()).toBe(true);
    document.body.removeChild(el);
    el = mount({ ...table, required: false }, { value: {} });
    await flush();
    expect(el.validate()).toBe(true);
  });

  it("keeps the table inert on the builder canvas", async () => {
    const el = mount(table, { mode: "edit" });
    await flush();
    expect(el.shadowRoot.querySelector("c-jform-choice-table").disabled).toBe(true);
  });
});

describe("c-jform-field image and event blocks", () => {
  it("shows a safe image with its alt text and caption, and nothing for an unsafe link", async () => {
    let el = mount({ key: "img", type: "image", label: "Poster", helpText: "Spring 2026", config: { url: "https://org.file.force.com/a.png", alt: "Clinic poster", fit: "contain", height: "large" } });
    await flush();
    const img = el.shadowRoot.querySelector("img.jf-image-img");
    expect(img.getAttribute("src")).toBe("https://org.file.force.com/a.png");
    expect(img.getAttribute("alt")).toBe("Clinic poster");
    expect(el.shadowRoot.querySelector("figure").className).toBe("jf-image jf-image-large jf-image-contain");
    expect(el.shadowRoot.querySelector("figcaption").textContent).toBe("Spring 2026");
    document.body.removeChild(el);
    el = mount({ key: "img", type: "image", config: { url: "javascript:alert(1)" } });
    await flush();
    expect(el.shadowRoot.querySelector("img")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-image-empty")).toBeNull(); // respondents see nothing
    document.body.removeChild(el);
    el = mount({ key: "img", type: "image", config: {} }, { mode: "edit" });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-image-empty").textContent).toContain("Add an image");
  });

  it("shows the event card with its date badge, details and calendar links", async () => {
    const el = mount({ key: "ev", type: "event", label: "Spring Clinic", config: { date: "2026-11-15", startTime: "09:00", endTime: "12:00", location: "WestTiger Dojo", description: "Bring water" } });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-event-month").textContent).toBe("NOV");
    expect(el.shadowRoot.querySelector(".jf-event-day").textContent).toBe("15");
    expect(el.shadowRoot.querySelector(".jf-event-title").textContent).toBe("Spring Clinic");
    expect(el.shadowRoot.querySelector(".jf-event-where").textContent).toBe("WestTiger Dojo");
    const google = el.shadowRoot.querySelector("a.jf-event-link");
    expect(google.getAttribute("href")).toContain("https://calendar.google.com/calendar/render?");
    expect(google.getAttribute("href")).toContain("dates=20261115T090000%2F20261115T120000");

    const created = jest.fn(() => "blob:ics");
    URL.createObjectURL = created;
    URL.revokeObjectURL = jest.fn();
    const clicks = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    el.shadowRoot.querySelector("button.jf-event-link").click();
    expect(created).toHaveBeenCalledTimes(1);
    const blob = created.mock.calls[0][0];
    expect(blob.type).toBe("text/plain");
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(clicks.mock.instances[0].download).toBe("spring-clinic.ics");
    clicks.mockRestore();
  });

  it("leaves the calendar links out when switched off or without a date", async () => {
    let el = mount({ key: "ev", type: "event", label: "E", config: { date: "2026-11-15", hideCalendar: true } });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-event-links")).toBeNull();
    document.body.removeChild(el);
    el = mount({ key: "ev", type: "event", label: "E", config: {} });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-event-badge")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-event-links")).toBeNull();
  });
});

describe("c-jform-field phone numbers", () => {
  it("uses the country picker when the field has it, validating the number for its country", async () => {
    const el = mount({ key: "mobile", type: "phone", label: "Mobile", config: { countryPicker: true, defaultCountry: "VN" } });
    await flush();
    const picker = el.shadowRoot.querySelector("c-jform-phone-input");
    expect(picker).not.toBeNull();
    expect(picker.detect).toBe(true);
    expect(picker.ariaLabel).toBe("Mobile");
    const seen = [];
    el.addEventListener("change", (e) => seen.push(e.detail));
    picker.dispatchEvent(new CustomEvent("change", { detail: { value: "+8491234" } }));
    expect(seen).toEqual([{ key: "mobile", value: "+8491234" }]);
    el.value = "+8491234";
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("too short for Vietnam");
    el.value = "+84912345678";
    await flush();
    expect(el.validate()).toBe(true);
  });

  it("keeps a plain phone box without the picker, and no country guess in the builder", async () => {
    const plain = mount({ key: "phone", type: "phone", label: "Phone" });
    await flush();
    expect(plain.shadowRoot.querySelector("c-jform-phone-input")).toBeNull();
    expect(plain.shadowRoot.querySelector("input").type).toBe("tel");
    const canvas = mount({ key: "mobile", type: "phone", label: "Mobile", config: { countryPicker: true } }, { mode: "edit" });
    await flush();
    const picker = canvas.shadowRoot.querySelector("c-jform-phone-input");
    expect(picker.detect).toBe(false);
    expect(picker.disabled).toBe(true);
    expect(picker.inert).toBe(true);
  });
});

describe("c-jform-field file upload", () => {
  it("limits the file picker to the field's allowed types", async () => {
    const el = mount({ key: "photo", type: "fileupload", label: "Photo", fileType: "Image" });
    await flush();
    const input = el.shadowRoot.querySelector("input.jf-file");
    expect(input.getAttribute("accept")).toContain(".png");
    expect(input.getAttribute("accept")).not.toContain(".pdf");
    expect(el.shadowRoot.querySelector(".jf-file-rules")).toBeNull();
  });

  const sheet = { key: "sheet", type: "fileupload", label: "Timesheet", config: { extensions: ["pdf", "xls", "xlsx", "csv"], maxSizeMb: 2, maxFiles: 3 } };
  const pick = (el, files) => {
    const input = el.shadowRoot.querySelector("input.jf-file");
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new CustomEvent("change"));
    return input;
  };

  it("narrows the picker and says what the field takes under the box", async () => {
    const el = mount(sheet);
    await flush();
    const input = el.shadowRoot.querySelector("input.jf-file");
    expect(input.getAttribute("accept")).toBe(".pdf,.xls,.xlsx,.csv");
    expect(input.multiple).toBe(true);
    expect(el.shadowRoot.querySelector(".jf-file-rules").textContent).toBe("PDF, Excel or CSV, up to 2 MB, at most 3 files");
  });

  it("refuses a wrong file when it's picked, with the reason, and keeps none of the pick", async () => {
    const el = mount(sheet);
    await flush();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    pick(el, [new File(["%PDF"], "hours.pdf"), new File(["ID3"], "song.mp3")]);
    await flush();
    expect(handler.mock.calls[0][0].detail).toEqual({ key: "sheet", value: [], files: [] });
    expect(el.getFiles()).toEqual([]);
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("song.mp3 can't be attached. This field takes PDF, Excel or CSV files.");

    pick(el, [new File(["a"], "a.csv"), new File(["b"], "b.csv"), new File(["c"], "c.csv"), new File(["d"], "d.csv")]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("Choose at most 3 files.");

    const big = new File(["x"], "big.xlsx");
    Object.defineProperty(big, "size", { value: 2 * 1024 * 1024 + 1 });
    pick(el, [big]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toContain("big.xlsx is larger than 2 MB.");

    const ok = new File(["1,2"], "hours.csv");
    pick(el, [ok]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error")).toBeNull();
    expect(el.getFiles()).toEqual([ok]);
  });

  it("clears a refusal on the next check, so an optional field can be sent without a file", async () => {
    const el = mount(sheet);
    await flush();
    pick(el, [new File(["ID3"], "song.mp3")]);
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error")).not.toBeNull();
    el.value = [];
    expect(el.validate()).toBe(true);
  });

  it("takes one file at a time when the field allows one", async () => {
    const el = mount({ key: "cv", type: "fileupload", label: "CV", config: { maxFiles: 1 } });
    await flush();
    expect(el.shadowRoot.querySelector("input.jf-file").multiple).toBe(false);
    expect(el.shadowRoot.querySelector(".jf-file-rules").textContent).toBe("Any allowed file, up to 3 MB, one file");
  });
});

describe("c-jform-field options per row", () => {
  const choices = (el) => el.shadowRoot.querySelector(".jf-choices");
  const field = (config) => ({ key: "status", type: "radio", label: "Patient status", options: [{ label: "New", value: "New" }, { label: "Returning", value: "Returning" }], config });

  it("leaves the columns to the form design when the field does not choose", async () => {
    const el = mount(field(undefined));
    await flush();
    expect(choices(el).getAttribute("style") || "").not.toContain("--jf-choice-cols");
  });

  it("uses the field's own options per row, in the builder too", async () => {
    const el = mount(field({ optionColumns: "3" }), { mode: "edit" });
    await flush();
    expect(choices(el).getAttribute("style")).toBe("--jf-choice-cols: repeat(3, minmax(0, 1fr))");
  });

  it("shows at most two per row in a narrow field", async () => {
    let report;
    global.ResizeObserver = class {
      constructor(cb) {
        report = cb;
      }
      observe() {}
      disconnect() {}
    };
    try {
      const el = mount({ ...field({ optionColumns: "4" }), type: "checkboxes" });
      await flush();
      report([{ contentRect: { width: 320 } }]);
      await flush();
      expect(choices(el).getAttribute("style")).toBe("--jf-choice-cols: repeat(2, minmax(0, 1fr))");
    } finally {
      delete global.ResizeObserver;
    }
  });
});

describe("c-jform-field payment block", () => {
  const block = { key: "pay", type: "payment", label: "Payment" };
  const view = (more) => ({ gateway: "stripe", gatewayName: "Stripe", modeLabel: "Test", test: false, lines: [], totalText: "$0.00", note: "", ...more });

  it("shows the form's gateway and mode in the block's head on the canvas, with no checkout line", async () => {
    const el = mount(block, { mode: "edit", payment: view({ rules: [] }) });
    await flush();
    const badge = el.shadowRoot.querySelector(".jf-payment-head .jf-payment-gateway");
    expect(badge.querySelector("c-jform-gateway-logo").gateway).toBe("stripe");
    expect(badge.querySelector(".jf-payment-mode").textContent).toBe("Test");
    expect(el.shadowRoot.querySelector(".jf-payment-by")).toBeNull();
  });

  it("tells respondents who takes the payment under the total", async () => {
    const el = mount(block, { payment: view() });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-payment-gateway")).toBeNull();
    const by = el.shadowRoot.querySelector(".jf-payment-by");
    expect(by.textContent).toContain("Secure checkout by");
    const logo = by.querySelector("c-jform-gateway-logo");
    expect([logo.gateway, logo.monochrome]).toEqual(["stripe", true]);
  });

  it("takes a promotion code and asks the renderer to check it", async () => {
    const el = mount(block, { payment: view({ showCodeBox: true, codes: "jform", totalText: "$40.00" }) });
    await flush();
    const apply = jest.fn();
    el.addEventListener("applycode", apply);
    const input = el.shadowRoot.querySelector(".jf-payment-code-input");
    const button = el.shadowRoot.querySelector(".jf-payment-code-btn");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Apply");
    input.value = " save10 ";
    input.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect(button.disabled).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(apply.mock.calls[0][0].detail).toEqual({ key: "pay", code: "save10" });
    button.click();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot.querySelector(".jf-error")).toBeNull();

    // the server refused it: one message under the box, the input marked invalid
    el.payment = view({ showCodeBox: true, codeError: "This code isn't valid. Check it and try again." });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-error").textContent).toBe("This code isn't valid. Check it and try again.");
    expect(el.shadowRoot.querySelector(".jf-payment-code-input").getAttribute("aria-invalid")).toBe("true");
    // while the server checks: the button says so and nothing can be sent twice
    el.payment = view({ showCodeBox: true, codeBusy: true });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-payment-code-btn").textContent).toBe("Checking…");
    expect(el.shadowRoot.querySelector(".jf-payment-code-input").disabled).toBe(true);
  });

  it("shows the applied code with its discount line, and lets the respondent remove it", async () => {
    const lines = [
      { key: "l0", name: "Seat", detail: "", amountText: "$40.00", cls: "jf-payment-line" },
      { key: "discount", name: "Code SAVE10", detail: "", amountText: "−$4.00", cls: "jf-payment-line jf-payment-line-discount" }
    ];
    const el = mount(block, { payment: view({ showCodeBox: true, codeApplied: "SAVE10", discountText: "−$4.00", lines, totalText: "$36.00" }) });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-payment-code-input")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-payment-code-applied").textContent).toContain("Code SAVE10 applied");
    expect(el.shadowRoot.querySelector("li.jf-payment-line-discount").textContent).toContain("−$4.00");
    const remove = jest.fn();
    el.addEventListener("removecode", remove);
    el.shadowRoot.querySelector(".jf-payment-code-link").click();
    expect(remove.mock.calls[0][0].detail).toEqual({ key: "pay" });
  });

  it("keeps the code box off the canvas and points gateway codes at the gateway's page", async () => {
    const canvas = mount(block, { mode: "edit", payment: view({ rules: [], showCodeBox: true }) });
    await flush();
    expect(canvas.shadowRoot.querySelector(".jf-payment-code-input").disabled).toBe(true);
    const gateway = mount(block, { payment: view({ gatewayCodesText: "Have a promotion code? Enter it on Stripe's payment page." }) });
    await flush();
    expect(gateway.shadowRoot.querySelector(".jf-payment-code-input")).toBeNull();
    expect(gateway.shadowRoot.querySelector(".jf-payment-codes-note").textContent).toBe("Have a promotion code? Enter it on Stripe's payment page.");
  });
});

describe("c-jform-field name", () => {
  const nameField = (config = {}, extra = {}) => ({
    key: "name",
    type: "name",
    label: "Name",
    required: true,
    helpText: "As on your ID",
    ...extra,
    config: {
      layout: "inline",
      ...config,
      parts: { firstName: { label: "First name", maxLength: 40 }, lastName: { label: "Last name", maxLength: 80 }, ...(config.parts || {}) }
    }
  });
  const inputs = (el) => [...el.shadowRoot.querySelectorAll(".jf-name-parts input")];
  const errors = (el) => [...el.shadowRoot.querySelectorAll(".jf-name-part .jf-error")].map((e) => e.textContent.trim());

  it("groups the parts in a fieldset named by the label, each with its own label and autocomplete", async () => {
    const el = mount(nameField());
    await flush();
    const fieldset = el.shadowRoot.querySelector("fieldset.jf-field.jf-kind-name");
    expect(fieldset.querySelector("legend").textContent).toContain("Name");
    expect(fieldset.querySelector("legend").textContent).toContain("*");
    expect(el.shadowRoot.querySelector("select")).toBeNull();
    const [first, last] = inputs(el);
    const labels = [...el.shadowRoot.querySelectorAll("label.jf-sublabel")];
    expect(labels.map((l) => l.textContent)).toEqual(["First name", "Last name"]);
    expect(labels[0].htmlFor).toBe(first.id);
    expect(labels[1].htmlFor).toBe(last.id);
    expect(first.getAttribute("autocomplete")).toBe("given-name");
    expect(last.getAttribute("autocomplete")).toBe("family-name");
    expect(first.getAttribute("aria-required")).toBe("true");
    expect(first.getAttribute("aria-describedby")).toBe(el.shadowRoot.querySelector(".jf-desc").id);
    expect(el.shadowRoot.querySelector(".jf-help").textContent).toBe("As on your ID");
    expect(el.shadowRoot.querySelector(".jf-name-parts").classList.contains("jf-name-inline")).toBe(true);
  });

  it("stacks the parts, always first name then last name", async () => {
    // an older definition may still carry an order or a salutation; neither is shown
    const old = nameField({ layout: "stacked", order: "last_first", parts: { salutation: { enabled: true }, lastName: { label: "Surname", placeholder: "e.g. Lee" } } }, { options: [{ label: "Dr.", value: "Dr." }] });
    const el = mount(old, { value: { firstName: "Jane", lastName: "Doe" } });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-name-parts").classList.contains("jf-name-stacked")).toBe(true);
    expect(el.shadowRoot.querySelector("select")).toBeNull();
    const [first, second] = inputs(el);
    expect(first.dataset.part).toBe("firstName");
    expect(first.value).toBe("Jane");
    expect(second.value).toBe("Doe");
    expect(second.placeholder).toBe("e.g. Lee");
    expect([...el.shadowRoot.querySelectorAll("label.jf-sublabel")].map((l) => l.textContent)).toEqual(["First name", "Surname"]);
  });

  it("emits the whole name as one object as each part changes", async () => {
    const el = mount(nameField(), { value: { lastName: "Doe" } });
    const handler = jest.fn();
    el.addEventListener("change", handler);
    await flush();
    const first = inputs(el).find((i) => i.dataset.part === "firstName");
    first.value = "Jane";
    first.dispatchEvent(new CustomEvent("input"));
    expect(handler.mock.calls[0][0].detail).toEqual({ key: "name", value: { lastName: "Doe", firstName: "Jane" } });
  });

  it("shows each missing or too long part under that part", async () => {
    const el = mount(nameField({ parts: { firstName: { label: "First name", maxLength: 3 } } }), { value: {} });
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(errors(el)).toEqual(["Complete this field.", "Complete this field."]);
    const [first, last] = inputs(el);
    expect(first.getAttribute("aria-invalid")).toBe("true");
    const errorId = first.closest(".jf-name-part").querySelector(".jf-error").id;
    expect(first.getAttribute("aria-describedby").split(" ")).toEqual([errorId, el.shadowRoot.querySelector(".jf-desc").id]);

    el.value = { firstName: "Jane", lastName: "   " };
    expect(el.validate()).toBe(false);
    await flush();
    expect(errors(el)).toEqual(["Enter no more than 3 characters", "Complete this field."]);
    expect(last.getAttribute("aria-invalid")).toBe("true");

    el.value = { firstName: " Jan ", lastName: "Doe" };
    expect(el.validate()).toBe(true);
    await flush();
    expect(errors(el)).toEqual([]);
    expect(el.shadowRoot.querySelector("fieldset").classList.contains("jf-invalid")).toBe(false);
  });

  it("lets an optional name stay empty, and still checks the length", async () => {
    const el = mount(nameField({}, { required: false }), { value: {} });
    await flush();
    expect(el.validate()).toBe(true);
    expect(inputs(el)[0].getAttribute("aria-required")).toBe("false");
    el.value = { lastName: "x".repeat(81) };
    expect(el.validate()).toBe(false);
    await flush();
    expect(errors(el)).toEqual(["Enter no more than 80 characters"]);
  });

  it("waits until focus leaves the whole name before asking for the next part", async () => {
    const el = mount(nameField(), { value: {} });
    await flush();
    const [first, last] = inputs(el);
    first.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: last }));
    await flush();
    expect(errors(el)).toEqual([]);
    last.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: null }));
    await flush();
    expect(errors(el)).toEqual(["Complete this field.", "Complete this field."]);
  });

  it("keeps the parts inert on the builder canvas", async () => {
    const el = mount(nameField(), { mode: "edit" });
    await flush();
    expect(inputs(el).every((i) => i.disabled)).toBe(true);
    expect(el.validate()).toBe(true);
  });
});

describe("c-jform-field address", () => {
  const LISTS = {
    fromOrg: true,
    countries: [
      { code: "AU", name: "Australia", states: [{ code: "NSW", name: "New South Wales" }, { code: "VIC", name: "Victoria" }] },
      { code: "NZ", name: "New Zealand", states: [] },
      { code: "US", name: "United States", states: [{ code: "CA", name: "California" }] }
    ]
  };
  const addressField = (config = {}, extra = {}) => ({ key: "address", type: "address", label: "Address", required: true, ...extra, config: { defaultCountry: "AU", ...config } });
  const control = (el, part) => el.shadowRoot.querySelector(`[data-part="${part}"]`);
  const errors = (el) => [...el.shadowRoot.querySelectorAll(".jf-address-part .jf-error")].map((e) => e.textContent.trim());
  const changes = (el) => {
    const handler = jest.fn();
    el.addEventListener("change", handler);
    return handler;
  };

  it("shows the country, street, city, state and postal code in a fieldset, each with its own label and autocomplete", async () => {
    const el = mount(addressField({ purpose: "billing" }), { addressLists: LISTS, value: { country: "AU" } });
    await flush();
    const fieldset = el.shadowRoot.querySelector("fieldset.jf-field.jf-kind-address");
    expect(fieldset.querySelector("legend").textContent).toContain("Address");
    expect([...el.shadowRoot.querySelectorAll("label.jf-sublabel")].map((l) => l.textContent)).toEqual(["Country", "Street", "City", "State/Province", "Zip/Postal code"]);
    expect(control(el, "country").tagName).toBe("SELECT");
    expect(control(el, "street").tagName).toBe("TEXTAREA");
    // only city and state share a row; the postal code takes the full width
    const half = (part) => control(el, part).closest(".jf-address-part").classList.contains("jf-address-half");
    expect(["country", "street", "city", "state", "postalCode"].map(half)).toEqual([false, false, true, true, false]);
    expect(control(el, "state").tagName).toBe("SELECT");
    expect(control(el, "city").getAttribute("autocomplete")).toBe("billing address-level2");
    expect(control(el, "country").getAttribute("autocomplete")).toBe("billing country");
    const countries = [...control(el, "country").querySelectorAll("option")];
    expect(countries.map((o) => o.textContent)).toEqual(["Select a country", "Australia", "New Zealand", "United States"]);
    expect(countries.find((o) => o.selected).value).toBe("AU");
    expect([...control(el, "state").querySelectorAll("option")].map((o) => o.value)).toEqual(["", "NSW", "VIC"]);
  });

  it("leaves the state out for a country without states in the org's picklists, and offers only the chosen countries", async () => {
    const el = mount(addressField({ countries: ["NZ", "AU"] }), { addressLists: LISTS, value: { country: "NZ", state: "Otago" } });
    await flush();
    // Salesforce refuses a state for a country it lists none for
    expect(control(el, "state")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-address-half")).toBeNull(); // the city alone takes the full width
    expect([...control(el, "country").querySelectorAll("option")].map((o) => o.value)).toEqual(["", "AU", "NZ"]);
  });

  it("types the state where the org has no picklists, and shows every part whatever older settings say", async () => {
    const el = mount(addressField({ parts: { country: { hidden: true }, state: { hidden: true } } }), { addressLists: { ...LISTS, fromOrg: false }, value: { country: "NZ", state: "Otago" } });
    await flush();
    expect([...el.shadowRoot.querySelectorAll(".jf-address-part")].map((p) => p.querySelector("[data-part]").dataset.part)).toEqual(["country", "street", "city", "state", "postalCode"]);
    expect(control(el, "state").tagName).toBe("INPUT");
    expect(control(el, "state").value).toBe("Otago");
  });

  it("emits the address as one object, and a new country clears a state from the old list", async () => {
    const el = mount(addressField(), { addressLists: LISTS, value: { country: "AU", state: "NSW", city: "Sydney" } });
    const handler = changes(el);
    await flush();
    const city = control(el, "city");
    city.value = "Newcastle";
    city.dispatchEvent(new CustomEvent("input"));
    expect(handler.mock.calls[0][0].detail).toEqual({ key: "address", value: { country: "AU", state: "NSW", city: "Newcastle" } });
    const country = control(el, "country");
    country.value = "US";
    country.dispatchEvent(new CustomEvent("change"));
    expect(handler.mock.calls[1][0].detail.value).toEqual({ country: "US", city: "Sydney" });
  });

  it("needs every part but the postal code when required, the state only where the country lists states", async () => {
    const el = mount(addressField(), { addressLists: LISTS, value: { country: "AU" } });
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(errors(el)).toEqual(["Complete this field.", "Complete this field.", "Complete this field."]);
    expect(control(el, "postalCode").getAttribute("aria-required")).toBe("false");
    expect(control(el, "state").getAttribute("aria-invalid")).toBe("true");

    el.value = { country: "NZ", city: "Auckland" };
    expect(el.validate()).toBe(false);
    el.value = { country: "NZ", street: "1 Queen St", city: "Auckland" };
    expect(el.validate()).toBe(true);
    await flush();
    expect(errors(el)).toEqual([]);

    // a typed state is never required: many countries have none
    el.addressLists = { ...LISTS, fromOrg: false };
    await flush();
    expect(el.validate()).toBe(true);
    expect(control(el, "state").getAttribute("aria-required")).toBe("false");
  });

  it("refuses a state that is not in the country's list, and a too long part", async () => {
    const el = mount(addressField({}, { required: false }), { addressLists: LISTS, value: { country: "AU", state: "Texas", city: "x".repeat(41) } });
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(errors(el)).toEqual(["Enter no more than 40 characters", "Choose an option from the list."]);
  });

  it("goes to the first part with a problem", async () => {
    const el = mount(addressField(), { addressLists: LISTS, value: { country: "AU", street: "1 George St" } });
    await flush();
    expect(control(el, "street").value).toBe("1 George St"); // a street drawn with an answer shows it
    const city = control(el, "city");
    city.focus = jest.fn();
    // the renderer focuses straight after validating, before the invalid marks are drawn
    el.validate();
    el.focus();
    expect(city.focus).toHaveBeenCalled();
  });

  it("keeps the parts inert on the builder canvas, and shows a country the lists lack by its code", async () => {
    const el = mount(addressField({ defaultCountry: "FR" }), { mode: "edit", value: { country: "FR" } });
    await flush();
    expect([...el.shadowRoot.querySelectorAll(".jf-address-part [data-part]")].every((c) => c.disabled)).toBe(true);
    expect([...control(el, "country").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Select a country", "FR"]);
    expect(el.validate()).toBe(true);
  });
});

describe("c-jform-field Other choice", () => {
  const industry = (type = "radio", extra = {}) => ({ key: "industry", type, label: "Industry", options: [{ label: "Retail" }, { label: "Farming" }], config: { other: { placeholder: "Your industry" } }, ...extra });
  const otherBox = (el) => el.shadowRoot.querySelector(".jf-other-input");

  it("adds Other last and shows its box only once Other is picked", async () => {
    const el = mount(industry());
    const seen = [];
    el.addEventListener("change", (e) => seen.push(e.detail));
    await flush();
    const radios = el.shadowRoot.querySelectorAll('input[type="radio"]');
    expect([...radios].map((r) => r.value)).toEqual(["Retail", "Farming", "Other"]);
    expect(otherBox(el)).toBeNull();
    radios[2].click();
    expect(seen.pop()).toEqual({ key: "industry", value: "Other" });
    el.value = "Other";
    await flush();
    expect(otherBox(el).placeholder).toBe("Your industry");
    expect(otherBox(el).maxLength).toBe(255);
    expect(otherBox(el).getAttribute("aria-label")).toBe("Industry: Other");
    otherBox(el).value = "Fishing";
    otherBox(el).dispatchEvent(new CustomEvent("input"));
    expect(seen.pop()).toEqual({ key: "industry", value: "Other", other: "Fishing" });
  });

  it("drops the text when Other is unpicked", async () => {
    const el = mount(industry("checkboxes"), { value: ["Other"], otherValue: "Fishing" });
    const seen = [];
    el.addEventListener("change", (e) => seen.push(e.detail));
    await flush();
    expect(otherBox(el).value).toBe("Fishing");
    el.shadowRoot.querySelectorAll('input[type="checkbox"]')[2].click();
    expect(seen.pop()).toEqual({ key: "industry", value: [], other: undefined });
  });

  it("shows the box under a dropdown too", async () => {
    const el = mount(industry("picklist"), { value: "Other" });
    await flush();
    expect([...el.shadowRoot.querySelectorAll("option")].map((o) => o.value)).toContain("Other");
    expect(otherBox(el)).not.toBeNull();
  });

  it("asks for the text when the field is required and Other is picked", async () => {
    const el = mount(industry("radio", { required: true }), { value: "Other" });
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.textContent).toContain("Please specify your answer.");
    expect(otherBox(el).getAttribute("aria-invalid")).toBe("true");
    el.otherValue = "Fishing";
    expect(el.validate()).toBe(true);
  });

  it("asks for the text only once something was typed in the box, or on sending", async () => {
    const el = mount(industry("radio", { required: true }));
    await flush();
    el.shadowRoot.querySelectorAll('input[type="radio"]')[2].click();
    el.value = "Other";
    await flush();
    otherBox(el).dispatchEvent(new CustomEvent("blur"));
    await flush();
    expect(el.shadowRoot.textContent).not.toContain("Please specify your answer.");
    otherBox(el).value = "";
    otherBox(el).dispatchEvent(new CustomEvent("input"));
    await flush();
    expect(el.shadowRoot.textContent).toContain("Please specify your answer.");
  });

  it("moves the focus to the box when Other is clicked, but not when arrow keys move onto it", async () => {
    const pick = async (how) => {
      const el = mount(industry());
      await flush();
      const choices = el.shadowRoot.querySelector(".jf-choices");
      choices.dispatchEvent(new CustomEvent(how === "pointer" ? "pointerdown" : "keydown"));
      el.shadowRoot.querySelectorAll('input[type="radio"]')[2].click();
      el.value = "Other";
      await flush();
      return el.shadowRoot.activeElement === otherBox(el);
    };
    expect(await pick("pointer")).toBe(true);
    expect(await pick("keyboard")).toBe(false);
  });

  it("goes to the empty Other box when sending, before the invalid marks are drawn", async () => {
    const el = mount(industry("radio", { required: true }), { value: "Other" });
    await flush();
    otherBox(el).focus = jest.fn();
    expect(el.validate()).toBe(false);
    el.focus();
    expect(otherBox(el).focus).toHaveBeenCalled();
  });

  it("lets an optional Other go without text, and never shows the box on the canvas", async () => {
    const el = mount(industry(), { value: "Other" });
    await flush();
    expect(el.validate()).toBe(true);
    const canvas = mount(industry(), { value: "Other", mode: "edit" });
    await flush();
    expect(otherBox(canvas)).toBeNull();
  });
});

describe("c-jform-field choice limits", () => {
  const toppings = (config) => ({ key: "toppings", type: "checkboxes", label: "Toppings", options: [{ label: "Ham" }, { label: "Olives" }, { label: "Basil" }, { label: "Chilli" }], config });
  const boxes = (el) => [...el.shadowRoot.querySelectorAll('input[type="checkbox"]')];

  it("says how many to choose", async () => {
    const limitText = async (config) => {
      const el = mount(toppings(config));
      await flush();
      return el.shadowRoot.querySelector(".jf-choice-limit")?.textContent;
    };
    expect(await limitText({ maxChoices: 3 })).toBe("Choose up to 3");
    expect(await limitText({ minChoices: 2, maxChoices: 3 })).toBe("Choose 2 to 3");
    expect(await limitText({ minChoices: 2, maxChoices: 2 })).toBe("Choose 2");
    expect(await limitText({ minChoices: 2 })).toBe("Choose at least 2");
    expect(await limitText({ minChoices: 1 })).toBeUndefined();
    expect(await limitText({})).toBeUndefined();
  });

  it("disables the boxes left once the most are ticked", async () => {
    const el = mount(toppings({ maxChoices: 2 }), { value: ["Ham", "Basil"] });
    await flush();
    expect(boxes(el).map((b) => b.disabled)).toEqual([false, true, false, true]);
    expect(boxes(el)[1].closest("label").className).toContain("jf-choice-full");
    el.value = ["Ham"];
    await flush();
    expect(boxes(el).some((b) => b.disabled)).toBe(false);
  });

  it("reports too few choices, but not an empty optional answer", async () => {
    const el = mount(toppings({ minChoices: 2 }), { value: ["Ham"] });
    await flush();
    expect(el.validate()).toBe(false);
    await flush();
    expect(el.shadowRoot.textContent).toContain("Choose at least 2.");
    el.value = [];
    expect(el.validate()).toBe(true);
  });
});
