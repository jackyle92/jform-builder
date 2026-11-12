import { holdsFiles, isTable, tableRows, rowKeyFor, unansweredRows, tableProblem, answerFieldsOf, isEmptyValue, TABLE_SCALES } from "c/jformFieldRegistry";
import { isName, nameParts, nameValue, nameDefaults, nameProblems, fullNameOf } from "c/jformFieldRegistry";
import { isAddress, isCompound, addressShowsState, addressParts, addressStoredParts, addressPurpose, offeredCountries, findCountry, addressStates } from "c/jformFieldRegistry";
import { addressDefaults, addressValue, addressStored, addressLine, addressProblems } from "c/jformFieldRegistry";
import { FIELD_TYPES, GROUPS, paletteGroups, iconUrl, defaultsFor, validateValue, isLayout, needsOptions, isMultiple, isSupported, acceptFor, allowedExtensions, fileLimits, fileRuleText, fileProblem } from "c/jformFieldRegistry";
import { canOfferOther, offersOther, otherLabel, otherKey, otherChoiceValue, choiceOptionsOf, picksOther, choiceLimits, choiceLimitText, choiceCountProblem } from "c/jformFieldRegistry";

describe("registry", () => {
  it("every type has a label, a known group and its own icon file", () => {
    const fs = require("fs");
    const path = require("path");
    const iconDir = path.join(__dirname, "../../../staticresources/jformFieldIcons");
    for (const [type, t] of Object.entries(FIELD_TYPES)) {
      expect(t.label).toBeTruthy();
      expect(GROUPS).toContain(t.group);
      expect(fs.existsSync(path.join(iconDir, `${type}.svg`))).toBe(true);
      expect(iconUrl(type)).toBe(`jformFieldIcons/${type}.svg`);
      expect(Array.isArray(t.props)).toBe(true);
      expect(type).toBe(type.toLowerCase());
    }
    expect(iconUrl("Email")).toBe("jformFieldIcons/email.svg");
    expect(iconUrl("no-such-type")).toBe("jformFieldIcons/text.svg");
    expect(paletteGroups()[0].items[0]).toEqual({ type: "text", label: "Text", fullLabel: "Text", iconUrl: "jformFieldIcons/text.svg" });
  });

  it("palette hides unsupported and internal types", () => {
    const all = paletteGroups().flatMap((g) => g.items.map((i) => i.type));
    expect(all).toContain("text");
    expect(all).toContain("nps");
    expect(all).not.toContain("lookup");
    expect(all).not.toContain("checkbox");
  });

  it("classifies types", () => {
    expect(isLayout("richtext")).toBe(true);
    expect(isLayout("text")).toBe(false);
    expect(needsOptions("picklist")).toBe(true);
    expect(isMultiple("checkboxes")).toBe(true);
    expect(isMultiple("radio")).toBe(false);
    expect(isSupported("lookup")).toBe(false);
    expect(isSupported("TEXT")).toBe(true);
    expect(holdsFiles("fileupload")).toBe(true);
    expect(holdsFiles("signature")).toBe(true);
    expect(holdsFiles("text")).toBe(false);
  });

  it("offers Signature among the basic fields", () => {
    const basic = paletteGroups().find((g) => g.group === "Basic").items.map((i) => i.type);
    expect(basic).toContain("signature");
    expect(defaultsFor("signature")).toEqual({ type: "signature", label: "Signature", required: false, width: 100 });
  });

  it("defaults give options and email validation", () => {
    expect(defaultsFor("picklist").options).toHaveLength(1);
    expect(defaultsFor("email").validation.regexPattern).toBeTruthy();
    expect(defaultsFor("text").width).toBe(100);
  });
});

describe("validateValue", () => {
  it("ignores empty values and layout fields", () => {
    expect(validateValue({ type: "email" }, "")).toBeNull();
    expect(validateValue({ type: "richtext" }, "anything")).toBeNull();
  });

  it("validates email, regex, lengths and numbers", () => {
    expect(validateValue({ type: "email" }, "nope")).toMatch(/valid email/);
    expect(validateValue({ type: "email" }, "a@b.co")).toBeNull();
    expect(validateValue({ type: "text", validation: { regexPattern: "^\\d+$", errorMessage: "Digits only" } }, "12a")).toBe("Digits only");
    expect(validateValue({ type: "text", validation: { minLength: 3 } }, "ab")).toMatch(/at least 3/);
    expect(validateValue({ type: "text", validation: { maxLength: 3 } }, "abcd")).toMatch(/no more than 3/);
    expect(validateValue({ type: "number" }, "x")).toMatch(/number/);
    expect(validateValue({ type: "number", validation: { minValue: 1, maxValue: 5 } }, "7")).toMatch(/at most 5/);
    expect(validateValue({ type: "nps" }, 9)).toBeNull();
  });

  it("never throws on a broken pattern", () => {
    expect(validateValue({ type: "text", validation: { regexPattern: "(" } }, "x")).toBeNull();
  });
});

describe("validateValue: dates and times", () => {
  it("checks dates against the field's config and times against the limits", () => {
    expect(validateValue({ type: "date", config: { minDate: "2026-10-10" } }, "2026-10-01")).toMatch(/on or after/);
    expect(validateValue({ type: "date", config: { disabledDays: [0, 6] } }, "2026-10-17")).toMatch(/Choose a Monday/);
    expect(validateValue({ type: "date" }, "17/10/2026")).toBe("Enter a valid date");
    expect(validateValue({ type: "date", config: { maxDate: "2026-12-31" } }, "2026-10-17")).toBeNull();
    expect(validateValue({ type: "date" }, "")).toBeNull(); // required-ness is the caller's call
    expect(validateValue({ type: "time", config: { minTime: "09:00" } }, "08:30")).toMatch(/at or after/);
    expect(validateValue({ type: "time", validation: { errorMessage: "Office hours only" }, config: { maxTime: "17:00" } }, "18:00")).toBe("Office hours only");
    expect(validateValue({ type: "time" }, "9:30 pm")).toBe("Enter a valid time");
    expect(validateValue({ type: "time" }, "21:30")).toBeNull();
  });

  describe("image, event and rows", () => {
    const { paletteGroups, rowSpanOf, defaultsFor, isLayout } = require("c/jformFieldRegistry");
    it("offers Image and Event in the Layout group as blocks that collect no answer", () => {
      const layout = paletteGroups().find((g) => g.group === "Layout").items.map((i) => i.type);
      expect(layout).toEqual(expect.arrayContaining(["image", "event"]));
      expect(isLayout("image")).toBe(true);
      expect(isLayout("event")).toBe(true);
    });
    it("reads rows from config.rowSpan, between 1 and 4", () => {
      expect(rowSpanOf({})).toBe(1);
      expect(rowSpanOf({ config: { rowSpan: 3 } })).toBe(3);
      expect(rowSpanOf({ config: { rowSpan: 9 } })).toBe(4);
      expect(rowSpanOf({ config: { rowSpan: "x" } })).toBe(1);
    });
    it("starts an event two weeks out, 9:00 to 12:00", () => {
      const ev = defaultsFor("event");
      expect(ev.label).toBe("Event title");
      expect(ev.config).toMatchObject({ startTime: "09:00", endTime: "12:00" });
      expect(ev.config.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(defaultsFor("image").config).toEqual({ fit: "cover", height: "medium" });
    });
  });
});


describe("phone fields", () => {
  it("new phone fields get the country picker in the builder's country", () => {
    // @salesforce/i18n/locale is en-US under Jest
    expect(defaultsFor("phone").config).toEqual({ countryPicker: true, detectCountry: true, defaultCountry: "US" });
  });

  it("checks picker phones by their country's rules and plain ones by the builder's format", () => {
    const picker = { type: "phone", config: { countryPicker: true, mobileOnly: true }, validation: { regexPattern: "^\\d+$" } };
    expect(validateValue(picker, "+84912345678")).toBeNull(); // the old digits-only pattern no longer applies
    expect(validateValue(picker, "+842838123456")).toBe("Enter a mobile number.");
    expect(validateValue({ ...picker, validation: { errorMessage: "Mobile please" } }, "+8491234")).toBe("Mobile please");
    expect(validateValue({ type: "phone", validation: { regexPattern: "^\\d+$" } }, "+84912345678")).toBe("The value does not match the expected format");
  });
});

describe("acceptFor", () => {
  it("lists the extensions of the field's file type", () => {
    expect(acceptFor({ type: "fileupload", fileType: "Image" }).split(",")).toEqual(expect.arrayContaining([".png", ".jpg"]));
    expect(acceptFor({ type: "fileupload", fileType: "Image" })).not.toContain(".pdf");
    expect(acceptFor({ type: "fileupload", fileType: "Audio" })).toContain(".mp3");
  });

  it("allows images, documents and audio when no type is set, never web content", () => {
    const accept = acceptFor({ type: "fileupload" });
    expect(accept).toContain(".png");
    expect(accept).toContain(".pdf");
    expect(accept).toContain(".mp3");
    for (const blocked of [".svg", ".html", ".js", ".exe"]) expect(accept.split(",")).not.toContain(blocked);
  });

  it("narrows to the builder's Only these, never wider than the file type's list", () => {
    expect(acceptFor({ type: "fileupload", config: { extensions: ["pdf", "xls", "xlsx", "csv"] } })).toBe(".pdf,.xls,.xlsx,.csv");
    expect(allowedExtensions({ type: "fileupload", config: { extensions: ["PDF", ".csv", "exe", "svg"] } })).toEqual(["pdf", "csv"]);
    expect(allowedExtensions({ type: "fileupload", fileType: "Image", config: { extensions: ["png", "pdf"] } })).toEqual(["png"]);
    // a broken setting takes nothing rather than everything
    expect(allowedExtensions({ type: "fileupload", config: { extensions: "pdf" } })).toEqual([]);
  });
});

describe("file rules", () => {
  const sheet = { type: "fileupload", config: { extensions: ["pdf", "xls", "xlsx", "csv"], maxSizeMb: 2, maxFiles: 3 } };
  const file = (name, size = 100) => ({ name, size });

  it("reads the limits, falling back to 3 MB and ten files", () => {
    expect(fileLimits(sheet)).toEqual({ maxSizeMb: 2, maxBytes: 2 * 1024 * 1024, maxFiles: 3 });
    expect(fileLimits({ type: "fileupload", config: { maxSizeMb: 9, maxFiles: 0 } })).toEqual({ maxSizeMb: 3, maxBytes: 3 * 1024 * 1024, maxFiles: 10 });
  });

  it("says what the field takes, and nothing while it has no rules of its own", () => {
    expect(fileRuleText(sheet)).toBe("PDF, Excel or CSV, up to 2 MB, at most 3 files");
    expect(fileRuleText({ type: "fileupload", config: { extensions: ["docx"], maxFiles: 1 } })).toBe("Word, up to 3 MB, one file");
    expect(fileRuleText({ type: "fileupload", config: { maxSizeMb: 1 } })).toBe("Any allowed file, up to 1 MB");
    expect(fileRuleText({ type: "fileupload" })).toBe("");
  });

  it("refuses too many files, a type the field doesn't take and a file that's too large, with the reason", () => {
    expect(fileProblem(sheet, [file("a.pdf"), file("b.csv")])).toBeNull();
    expect(fileProblem(sheet, [file("a.pdf"), file("b.pdf"), file("c.pdf"), file("d.pdf")])).toBe("Choose at most 3 files.");
    expect(fileProblem(sheet, [file("song.mp3")])).toBe("song.mp3 can't be attached. This field takes PDF, Excel or CSV files.");
    expect(fileProblem(sheet, [file("Report.XLSX", 3 * 1024 * 1024)])).toBe("Report.XLSX is larger than 2 MB. Please choose a smaller file.");
    expect(fileProblem({ type: "fileupload" }, [file("page.html")])).toBe("page.html can't be attached. Files of this type can't be attached.");
    expect(fileProblem({ type: "fileupload", config: { maxFiles: 1 } }, [file("a.pdf"), file("b.pdf")])).toBe("Choose one file.");
  });

  it("reads the extension from the name the server stores the file under", () => {
    // JFormUploadPolicy.safeFileName drops leading dots and trims, so ".pdf" has no extension and "a.pdf " is a PDF
    expect(fileProblem(sheet, [file(".pdf")])).toBe(".pdf can't be attached. This field takes PDF, Excel or CSV files.");
    expect(fileProblem(sheet, [file("a.pdf ")])).toBeNull();
  });
});

describe("table", () => {
  const table = {
    key: "satisfaction",
    type: "table",
    label: "How satisfied were you with",
    options: [{ label: "Poor", value: "Poor" }, { label: "Good", value: "Good" }],
    config: { rows: [{ key: "service", label: "Service" }, { key: "price", label: "Price" }, { label: "no key" }] }
  };

  it("is a Choice field with columns as options and starts with three rows on the Satisfaction scale", () => {
    expect(FIELD_TYPES.table).toMatchObject({ label: "Table", group: "Choice", answer: true, options: true });
    expect(isTable("table")).toBe(true);
    expect(needsOptions("table")).toBe(true);
    expect(paletteGroups().find((g) => g.group === "Choice").items.map((i) => i.type)).toContain("table");
    const fresh = defaultsFor("table");
    expect(fresh.options.map((o) => o.value)).toEqual(TABLE_SCALES[0].columns);
    expect(fresh.options.every((o) => o.label === o.value)).toBe(true); // the words are stored
    expect(tableRows(fresh).map((r) => r.key)).toEqual(["service", "price", "speed"]);
    expect(fresh.config).toMatchObject({ multiple: false, everyRow: true });
  });

  it("reads rows with keys only", () => {
    expect(tableRows(table)).toEqual([{ key: "service", label: "Service" }, { key: "price", label: "Price" }]);
    expect(tableRows({ type: "table" })).toEqual([]);
  });

  it("makes row keys from labels like the server does", () => {
    expect(rowKeyFor("Ease of use", 1, [])).toBe("ease_of_use");
    expect(rowKeyFor("24/7 support", 1, [])).toBe("r_24_7_support");
    expect(rowKeyFor("!!!", 3, [])).toBe("row_3");
    expect(rowKeyFor("A very long row label that goes on", 1, [])).toBe("a_very_long_row_labe");
    expect(rowKeyFor("Price", 2, new Set(["price", "price_2"]))).toBe("price_3");
  });

  it("asks for every row, or one when everyRow is off", () => {
    expect(tableProblem(table, {})).toBe("Answer every row.");
    expect(tableProblem(table, { service: "Good" })).toBe("Answer every row: Price.");
    expect(tableProblem(table, { service: "Good", price: "Poor" })).toBeNull();
    const oneIsEnough = { ...table, config: { ...table.config, everyRow: false } };
    expect(tableProblem(oneIsEnough, {})).toBe("Answer at least one row.");
    expect(tableProblem(oneIsEnough, { price: ["Poor"] })).toBeNull();
    expect(unansweredRows(table, { service: "", price: [] }).map((r) => r.key)).toEqual(["service", "price"]);
  });

  it("treats a table answer with no answered row as empty", () => {
    expect(isEmptyValue({})).toBe(true);
    expect(isEmptyValue({ service: "", price: [] })).toBe(true);
    expect(isEmptyValue({ service: "Good" })).toBe(false);
    expect(validateValue(table, { service: "Good" })).toBeNull();
  });

  it("gives each row as a question of its own for logic and record steps", () => {
    expect(answerFieldsOf(table)).toEqual([
      { key: "satisfaction.service", type: "radio", label: "How satisfied were you with: Service", options: table.options, table: "satisfaction" },
      { key: "satisfaction.price", type: "radio", label: "How satisfied were you with: Price", options: table.options, table: "satisfaction" }
    ]);
    expect(answerFieldsOf({ ...table, config: { ...table.config, multiple: true } })[0].type).toBe("checkboxes");
    const text = { key: "name", type: "text" };
    expect(answerFieldsOf(text)).toEqual([text]);
  });
});

describe("name", () => {
  const field = (config = {}, extra = {}) => {
    const fresh = defaultsFor("name");
    return { key: "name", label: "Name", ...fresh, ...extra, config: { ...fresh.config, ...config, parts: { ...fresh.config.parts, ...(config.parts || {}) } } };
  };

  it("is a Basic field that starts with first and last name, in that order, and no choices", () => {
    expect(FIELD_TYPES.name).toMatchObject({ label: "Name", group: "Basic", answer: true });
    expect(isName("name")).toBe(true);
    expect(isName("text")).toBe(false);
    expect(paletteGroups().find((g) => g.group === "Basic").items.map((i) => i.type)).toContain("name");
    const fresh = defaultsFor("name");
    expect(fresh.options).toBeUndefined();
    expect(fresh.config).toEqual({ layout: "inline", parts: { firstName: { label: "First name", maxLength: 40 }, lastName: { label: "Last name", maxLength: 80 } } });
    expect(nameParts(fresh).map((p) => [p.key, p.label, p.maxLength, p.autocomplete, p.objectField])).toEqual([
      ["firstName", "First name", 40, "given-name", "FirstName"],
      ["lastName", "Last name", 80, "family-name", "LastName"]
    ]);
    expect(validateValue(fresh, { firstName: "Jane" })).toBeNull(); // parts are checked by nameProblems
  });

  it("always shows first name then last name, whatever an older definition says", () => {
    const old = field({ order: "last_first", parts: { salutation: { enabled: true, label: "Salutation" } } }, { options: [{ label: "Dr.", value: "Dr." }] });
    expect(nameParts(old).map((p) => p.key)).toEqual(["firstName", "lastName"]);
  });

  it("fills in blank labels and lengths, and caps lengths at 255", () => {
    const parts = nameParts(field({ parts: { firstName: { label: "  ", maxLength: "" }, lastName: { label: "Surname", maxLength: 999, placeholder: "e.g. Lee", defaultValue: " Lee " } } }));
    expect(parts[0]).toMatchObject({ label: "First name", maxLength: 40 });
    expect(parts[1]).toMatchObject({ label: "Surname", maxLength: 255, placeholder: "e.g. Lee", defaultValue: "Lee" });
  });

  it("needs first and last name when required, and checks lengths after trimming", () => {
    const f = field({ parts: { firstName: { maxLength: 3 } } });
    expect(nameProblems(f, {}, true)).toEqual({ firstName: "Complete this field.", lastName: "Complete this field." });
    expect(nameProblems(f, { firstName: "   ", lastName: "Doe" }, true)).toEqual({ firstName: "Complete this field." });
    expect(nameProblems(f, { firstName: "  Jan  ", lastName: "Doe" }, true)).toEqual({});
    expect(nameProblems(f, { firstName: "Jane", lastName: "Doe" }, true)).toEqual({ firstName: "Enter no more than 3 characters" });
    expect(nameProblems(f, {}, false)).toEqual({});
    expect(nameProblems(f, "Jane Doe", false)).toEqual({}); // not an object: treated as empty
  });

  it("sends the parts trimmed, without empty or unknown ones, and builds the full name first then last", () => {
    const f = field();
    expect(nameValue(f, { salutation: "Dr.", firstName: " Jane ", lastName: "Doe", middleName: "Q" })).toEqual({ firstName: "Jane", lastName: "Doe" });
    expect(nameValue(f, { firstName: "  ", lastName: "" })).toEqual({});
    expect(fullNameOf(f, { salutation: "Dr.", firstName: "Jane", lastName: "Doe" })).toBe("Jane Doe");
    expect(fullNameOf(f, { firstName: " Jane ", lastName: "  " })).toBe("Jane");
    expect(fullNameOf(f, null)).toBe("");
  });

  it("starts from the parts' default values", () => {
    expect(nameDefaults(field())).toBeUndefined();
    expect(nameDefaults(field({ parts: { lastName: { defaultValue: "Doe" } } }))).toEqual({ lastName: "Doe" });
  });

  it("gives each part as a question of its own for logic and record steps", () => {
    expect(answerFieldsOf(field())).toEqual([
      { key: "name.firstName", type: "text", label: "Name: First name", name: "name", part: "firstName", objectField: "FirstName" },
      { key: "name.lastName", type: "text", label: "Name: Last name", name: "name", part: "lastName", objectField: "LastName" }
    ]);
  });
});

describe("address", () => {
  const LISTS = {
    fromOrg: true,
    countries: [
      { code: "AU", name: "Australia", states: [{ code: "NSW", name: "New South Wales" }] },
      { code: "NZ", name: "New Zealand", states: [] }
    ]
  };
  const field = (config = {}) => ({ key: "home", type: "address", label: "Home", config: { defaultCountry: "AU", ...config } });

  it("is a compound type in the Advanced group, starting in the builder's country", () => {
    expect(isAddress("Address")).toBe(true);
    expect(isCompound("address")).toBe(true);
    expect(isCompound("name")).toBe(true);
    expect(isCompound("text")).toBe(false);
    expect(FIELD_TYPES.address.group).toBe("Advanced");
    const fresh = defaultsFor("address");
    expect(fresh.config.detectCountry).toBe(true);
    expect(fresh.config.defaultCountry).toMatch(/^[A-Z]{2}$/);
    expect(validateValue(fresh, { city: "x".repeat(500) })).toBeNull();
  });

  it("lists every part with its label and placeholder, prefixing autocomplete for a purpose", () => {
    // older drafts may carry hidden and optional; every part shows
    const parts = addressParts(field({ purpose: "shipping", parts: { city: { label: "Suburb", placeholder: "e.g. Bondi" }, state: { hidden: true }, postalCode: { optional: true } } }));
    expect(parts.map((p) => [p.key, p.label, p.placeholder, p.autocomplete])).toEqual([
      ["country", "Country", "", "shipping country"],
      ["street", "Street", "", "shipping street-address"],
      ["city", "Suburb", "e.g. Bondi", "shipping address-level2"],
      ["state", "State/Province", "", "shipping address-level1"],
      ["postalCode", "Zip/Postal code", "", "shipping postal-code"]
    ]);
    expect(addressPurpose(field({ purpose: "Gift" }))).toBe("");
  });

  it("stores every part and the codes, and gives every stored part to the Logic and Automate tabs", () => {
    const f = field();
    expect(addressStoredParts(f).map((p) => p.key)).toEqual(["country", "street", "city", "state", "postalCode", "stateCode", "countryCode"]);
    const answers = answerFieldsOf(f);
    expect(answers[0]).toEqual({ key: "home.country", type: "text", label: "Home: Country", address: "home", part: "country", purpose: "", derived: false });
    expect(answers.filter((a) => a.derived).map((a) => a.label)).toEqual(["Home: State/Province code", "Home: Country code"]);
  });

  it("offers the chosen countries and finds one by code or name", () => {
    expect(offeredCountries(field({ countries: ["nz"] }), LISTS).map((c) => c.code)).toEqual(["NZ"]);
    expect(offeredCountries(field(), LISTS)).toHaveLength(2);
    expect(findCountry(field(), LISTS, " australia ").code).toBe("AU");
    expect(findCountry(field({ countries: ["NZ"] }), LISTS, "AU")).toBeNull();
    expect(addressStates(field(), LISTS, { country: "AU" }).map((s) => s.code)).toEqual(["NSW"]);
    expect(addressStates(field(), LISTS, {})).toEqual([]);
    // with the org's picklists the state shows only as a list; typed states always show
    expect(addressShowsState(field(), LISTS, { country: "AU" })).toBe(true);
    expect(addressShowsState(field(), LISTS, { country: "NZ" })).toBe(false);
    expect(addressShowsState(field(), LISTS, {})).toBe(false);
    expect(addressShowsState(field(), { ...LISTS, fromOrg: false }, { country: "NZ" })).toBe(true);
    expect(addressShowsState(field(), null, { country: "NZ" })).toBe(true);
  });

  it("starts in the visitor's country when it is offered, else the default", () => {
    expect(addressDefaults(field({ detectCountry: true }), LISTS, "NZ")).toEqual({ country: "NZ" });
    expect(addressDefaults(field({ detectCountry: true }), LISTS, "FR")).toEqual({ country: "AU" });
    expect(addressDefaults(field(), LISTS, "NZ")).toEqual({ country: "AU" });
    expect(addressDefaults(field({ defaultCountry: "" }), LISTS, null)).toBeUndefined();
  });

  it("sends the parts trimmed, and resolves names and codes as the server stores them", () => {
    const f = field();
    const value = { country: "AU", street: " 1 George St \n Level 2 ", city: "Sydney", state: "nsw", postalCode: "2000", extra: "x" };
    expect(addressValue(f, value, LISTS)).toEqual({ country: "AU", street: "1 George St \n Level 2", city: "Sydney", state: "nsw", postalCode: "2000" });
    expect(addressStored(f, value, LISTS)).toEqual({ country: "Australia", countryCode: "AU", street: "1 George St \n Level 2", city: "Sydney", state: "New South Wales", stateCode: "NSW", postalCode: "2000" });
    expect(addressLine(field(), { ...value }, LISTS)).toBe("1 George St, Level 2, Sydney, NSW 2000, Australia");
    // the country the form starts in is no answer on its own
    expect(addressValue(f, { country: "AU" }, LISTS)).toEqual({});
    expect(addressStored(f, { country: "AU" }, LISTS)).toEqual({});
    // a state the country cannot have in the org's picklists is not sent; a typed one is
    expect(addressValue(f, { country: "NZ", city: "Auckland", state: "Otago" }, LISTS)).toEqual({ country: "NZ", city: "Auckland" });
    expect(addressValue(f, { country: "NZ", city: "Auckland", state: "Otago" }, { ...LISTS, fromOrg: false })).toEqual({ country: "NZ", city: "Auckland", state: "Otago" });
  });

  it("reports problems by part", () => {
    const f = field({ parts: { street: { optional: true } } });
    // the postal code is never required: many countries have none
    expect(addressProblems(f, { country: "AU" }, true, LISTS)).toEqual({ street: "Complete this field.", city: "Complete this field.", state: "Complete this field." });
    expect(addressProblems(f, { country: "NZ", street: "1 Queen St", city: "Auckland" }, true, LISTS)).toEqual({});
    expect(addressProblems(f, { country: "NZ", street: "1 Queen St", city: "Auckland" }, true, { ...LISTS, fromOrg: false })).toEqual({});
    expect(addressProblems(f, { country: "FR" }, false, LISTS)).toEqual({ country: "Choose an option from the list." });
    expect(addressProblems(f, { country: "AU", state: "Texas" }, false, LISTS)).toEqual({ state: "Choose an option from the list." });
    expect(addressProblems(f, { postalCode: "1".repeat(21) }, false, null)).toEqual({ postalCode: "Enter no more than 20 characters" });
  });
});

describe("Other choice and choice limits", () => {
  const industry = (config, type = "radio") => ({ key: "industry", type, label: "Industry", options: [{ label: "Retail" }, { label: "Farming", value: "farm" }], config });

  it("adds Other last, with its own label, only to choice types that offer it", () => {
    expect(["radio", "checkboxes", "picklist", "multiselect"].every(canOfferOther)).toBe(true);
    expect(canOfferOther("text")).toBe(false);
    expect(offersOther(industry())).toBe(false);
    expect(offersOther({ ...industry({ other: {} }), type: "text" })).toBe(false);
    expect(choiceOptionsOf(industry())).toEqual([{ label: "Retail", value: "Retail" }, { label: "Farming", value: "farm" }]);
    expect(choiceOptionsOf(industry({ other: {} }))).toEqual([
      { label: "Retail", value: "Retail" },
      { label: "Farming", value: "farm" },
      { label: "Other", value: "Other", other: true }
    ]);
    expect(otherLabel(industry({ other: { label: "  Something else " } }))).toBe("Something else");
    expect(otherKey(industry({ other: {} }))).toBe("industry.other");
  });

  it("stores Other as \"Other\" whatever it is called, so renaming it keeps earlier answers", () => {
    const renamed = industry({ other: { label: "Something else" } });
    expect(otherChoiceValue(renamed)).toBe("Other");
    expect(choiceOptionsOf(renamed)[2]).toEqual({ label: "Something else", value: "Other", other: true });
    expect(picksOther(renamed, "Other")).toBe(true);
    expect(picksOther(renamed, "Something else")).toBe(false);
    // an option already holding the value becomes the Other choice instead of a second one
    const listed = { ...industry({ other: {} }), options: [{ label: "Retail" }, { label: "Other" }] };
    expect(choiceOptionsOf(listed)).toEqual([{ label: "Retail", value: "Retail" }, { label: "Other", value: "Other", other: true }]);
  });

  it("knows when an answer picks Other: a single choice whole, Checkboxes as a list or joined values", () => {
    const f = industry({ other: {} }, "checkboxes");
    expect(picksOther(f, "Other")).toBe(true);
    expect(picksOther(f, ["Retail", "Other"])).toBe(true);
    expect(picksOther(f, "Retail; Other")).toBe(true);
    expect(picksOther(f, ["Retail"])).toBe(false);
    expect(picksOther(f, undefined)).toBe(false);
    expect(picksOther(industry(), "Other")).toBe(false);
    expect(picksOther(industry({ other: {} }), "Retail; Other")).toBe(false); // a single choice is never split
    const semicolon = industry({ other: { value: "Other; please say" } });
    expect(picksOther(semicolon, "Other; please say")).toBe(true);
  });

  it("gives the Other text to the Logic and Automate tabs as its own answer", () => {
    const f = industry({ other: {} });
    expect(answerFieldsOf(f)).toEqual([f, { key: "industry.other", type: "text", label: "Industry: Other", other: "industry" }]);
    expect(answerFieldsOf(industry())).toEqual([industry()]);
  });

  it("counts Checkboxes answers against At least and At most, letting an empty answer pass", () => {
    const f = { ...industry({ minChoices: 2, maxChoices: "3" }, "checkboxes"), options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }] };
    expect(choiceLimits(f)).toEqual({ least: 2, most: 3 });
    expect(choiceLimits(industry({ minChoices: 0, maxChoices: 1.5 }, "checkboxes"))).toEqual({ least: null, most: null });
    expect(choiceLimits(industry({ minChoices: 2 }, "radio"))).toEqual({ least: null, most: null });
    expect(choiceCountProblem(f, [])).toBeNull();
    expect(choiceCountProblem(f, ["a"])).toBe("Choose at least 2.");
    expect(choiceCountProblem(f, "a; b")).toBeNull();
    expect(choiceCountProblem(f, ["a", "b", "c", "d"])).toBe("Choose no more than 3.");
    expect(validateValue(f, ["a"])).toBe("Choose at least 2.");
    expect(validateValue({ ...f, type: "multiselect" }, "a;b;c;d")).toBe("Choose no more than 3.");
    expect(validateValue(industry({}, "checkboxes"), ["a", "b"])).toBeNull();
  });

  it("fits limits saved before choices were removed to the choices left", () => {
    // two choices left: At least 4 asks for both, At most 3 no longer limits anything
    const shrunk = industry({ minChoices: 4, maxChoices: 3 }, "checkboxes");
    expect(choiceLimits(shrunk)).toEqual({ least: 2, most: null });
    expect(choiceCountProblem(shrunk, ["Retail", "farm"])).toBeNull();
    // At least never passes At most
    const crossed = { ...industry({ minChoices: 3, maxChoices: 2 }, "checkboxes"), options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }] };
    expect(choiceLimits(crossed)).toEqual({ least: 2, most: 2 });
  });

  it("puts the limits in words", () => {
    const four = (config) => ({ ...industry(config, "checkboxes"), options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }] });
    expect(choiceLimitText(four({ minChoices: 2, maxChoices: 3 }))).toBe("2 to 3");
    expect(choiceLimitText(four({ minChoices: 2, maxChoices: 2 }))).toBe("2");
    expect(choiceLimitText(four({ minChoices: 2 }))).toBe("at least 2");
    expect(choiceLimitText(four({ maxChoices: 3 }))).toBe("up to 3");
    expect(choiceLimitText(four({ minChoices: 1 }))).toBe("");
  });
});
