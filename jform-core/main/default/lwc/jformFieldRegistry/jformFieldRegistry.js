import { dateProblem, timeProblem, listOf } from "c/jformDateTime";
import FIELD_ICONS from "@salesforce/resourceUrl/jformFieldIcons";
import { phoneProblem, localeCountry } from "c/jformPhone";
import LOCALE from "@salesforce/i18n/locale";
/**
 * The single catalog of field types. Palette, properties panel, renderer and
 * validation all read from here, so adding a type is one entry plus a template
 * branch in c/jformField.
 */

export const GROUPS = ["Basic", "Choice", "Layout", "Advanced"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * answer:   collects a value from the respondent
 * options:  needs an options list
 * file:     the answer is saved as Files on the response, so it is no condition or record field value
 * supported: renderable by c/jformField today
 * single:   a form has one at most
 * props:    property groups shown in the builder's panel
 * Each type's icon is jformFieldIcons/<type>.svg (see iconUrl).
 */
export const FIELD_TYPES = {
  text: { label: "Text", group: "Basic", answer: true, props: ["general", "mapping", "validation", "logic"] },
  // first and last name in one field; each part is its own answer, "field.part", mapped and tested by part
  name: { label: "Name", group: "Basic", answer: true, props: ["general", "name", "mapping", "logic"] },
  email: { label: "Email", group: "Basic", answer: true, props: ["general", "mapping", "validation", "logic"] },
  phone: { label: "Phone", group: "Basic", answer: true, props: ["general", "mapping", "validation", "logic"] },
  comment: { label: "Long text", short: "Paragraph", group: "Basic", answer: true, props: ["general", "mapping", "validation", "logic"] },
  number: { label: "Number", group: "Basic", answer: true, props: ["general", "mapping", "validation", "logic"] },
  picklist: { label: "Dropdown", group: "Basic", answer: true, options: true, props: ["general", "options", "mapping", "logic"] },
  // retired: respondents saw the same ticks as Checkboxes and the answers map the same way; kept so existing forms keep working
  multiselect: { label: "Multi-select", group: "Basic", answer: true, options: true, multiple: true, props: ["general", "options", "mapping", "logic"], hiddenInPalette: true },
  date: { label: "Date", group: "Basic", answer: true, props: ["general", "mapping", "logic"] },
  time: { label: "Time", group: "Basic", answer: true, props: ["general", "mapping", "logic"] },
  fileupload: { label: "File upload", group: "Basic", answer: true, file: true, props: ["general", "logic"] },
  signature: { label: "Signature", group: "Basic", answer: true, file: true, props: ["general", "signature", "logic"] },

  radio: { label: "Single choice", short: "Choice", group: "Choice", answer: true, options: true, props: ["general", "options", "mapping", "logic"] },
  checkboxes: { label: "Checkboxes", group: "Choice", answer: true, options: true, multiple: true, props: ["general", "options", "mapping", "logic"] },
  rating: { label: "Rating", group: "Choice", answer: true, props: ["general", "mapping", "logic"] },
  nps: { label: "NPS", group: "Choice", answer: true, props: ["general", "mapping", "logic"] },
  yesno: { label: "Yes / No", short: "Yes/No", group: "Choice", answer: true, props: ["general", "mapping", "logic"] },
  // questions in rows, the options as columns; each row is its own answer, mapped and tested by row
  table: { label: "Table", group: "Choice", answer: true, options: true, props: ["general", "table", "options", "logic"] },
  checkbox: { label: "Checkbox", group: "Choice", answer: true, props: ["general", "mapping", "logic"], hiddenInPalette: true },

  richtext: { label: "Rich text", group: "Layout", answer: false, props: ["content", "logic"] },
  heading: { label: "Heading", group: "Layout", answer: false, props: ["general", "logic"] },
  divider: { label: "Divider", group: "Layout", answer: false, props: ["logic"] },
  image: { label: "Image", group: "Layout", answer: false, props: ["general", "image", "layout", "logic"] },
  event: { label: "Event details", short: "Event", group: "Layout", answer: false, props: ["general", "event", "layout", "logic"] },

  // country, street, city, state and postal code in one field; each part is its own answer, "field.part", mapped by address
  address: { label: "Address", group: "Advanced", answer: true, props: ["general", "address", "mapping", "logic"] },
  hidden: { label: "Hidden", group: "Advanced", answer: true, props: ["general", "mapping"] },
  consent: { label: "Consent", group: "Advanced", answer: true, props: ["general", "mapping", "logic"] },
  // the price and the Pay button (c/jformPayment); its answer is the total, worked out again on the server
  payment: { label: "Payment", group: "Advanced", answer: true, single: true, props: ["general", "payment", "mapping", "logic"] },
  lookup: { label: "Lookup", group: "Advanced", answer: true, props: ["general", "mapping", "logic"], supported: false }
};

export function getType(type) {
  return FIELD_TYPES[(type || "text").toLowerCase()] || FIELD_TYPES.text;
}

/** How many grid rows a field covers (config.rowSpan, 1 to 4): a tall image or event card beside stacked fields. */
export const MAX_ROW_SPAN = 4;
export function rowSpanOf(field) {
  const n = Math.round(Number(field?.config?.rowSpan));
  return Number.isFinite(n) && n > 1 ? Math.min(n, MAX_ROW_SPAN) : 1;
}

export function isLayout(type) {
  return getType(type).answer === false;
}

export function collectsAnswer(type) {
  return getType(type).answer !== false;
}

export function needsOptions(type) {
  return getType(type).options === true;
}

export function holdsFiles(type) {
  return getType(type).file === true;
}

export function isMultiple(type) {
  return getType(type).multiple === true;
}

// ------------------------------------------------------------ choices: Other, and how many to choose
/** Choice fields that can offer an "Other" choice with a text box (config.other = { label, placeholder }). */
const OTHER_TYPES = new Set(["radio", "checkboxes", "picklist", "multiselect"]);
/** A stored answer holds 255 characters; JFormOtherChoice.MAX_LENGTH. */
export const MAX_OTHER_LENGTH = 255;
export const OTHER_LABEL = "Other";
export const OTHER_PLACEHOLDER = "Please specify";

export function canOfferOther(type) {
  return OTHER_TYPES.has(String(type || "").toLowerCase());
}
export function offersOther(field) {
  const other = field?.config?.other;
  return canOfferOther(field?.type) && Boolean(other) && typeof other === "object";
}
/** What the Other choice shows: "Other" unless the builder named it. Mirrors JFormOtherChoice.label. */
export function otherLabel(field) {
  return String(field?.config?.other?.label ?? "").trim() || OTHER_LABEL;
}
/**
 * What picking Other stores: "Other", whatever the choice is called, so renaming it keeps earlier answers, rules and
 * record steps (config.other.value, which the panel never sets, overrides it). Mirrors JFormOtherChoice.value.
 */
export function otherChoiceValue(field) {
  return String(field?.config?.other?.value ?? "").trim() || OTHER_LABEL;
}
/** The answer key of the text typed under Other: "industry.other". */
export function otherKey(field) {
  return `${field?.key}.other`;
}
/** The options a respondent picks from: the field's own, then Other when offered (or an option already holding its value). */
export function choiceOptionsOf(field) {
  const options = (field?.options || []).map((o) => ({ label: o.label, value: String(o.value ?? o.label) }));
  if (!offersOther(field)) return options;
  const value = otherChoiceValue(field);
  const same = options.find((o) => o.value === value);
  if (same) same.other = true;
  else options.push({ label: otherLabel(field), value, other: true });
  return options;
}
/**
 * Whether a choice answer picks Other: a single choice's whole value, a list's items, or values joined with "; " for
 * Checkboxes. Mirrors JFormOtherChoice.picked.
 */
export function picksOther(field, value) {
  if (!offersOther(field) || value === null || value === undefined) return false;
  const other = otherChoiceValue(field);
  if (Array.isArray(value)) return value.some((v) => String(v).trim() === other);
  const text = String(value).trim();
  if (text === other) return true;
  return isMultiple(field.type) && text.split(";").some((v) => v.trim() === other);
}
/**
 * Checkboxes' At least and At most (config.minChoices, config.maxChoices) as they apply: whole numbers from 1, or null.
 * Saved limits can outgrow the choices when some are removed later, so At least never asks for more than there are,
 * At most stops counting once it reaches them, and At least never passes At most. Mirrors JFormAnswerValidator.limits.
 */
export function choiceLimits(field) {
  const whole = (raw) => {
    const n = Number(raw);
    return raw !== null && raw !== undefined && raw !== "" && Number.isInteger(n) && n >= 1 ? n : null;
  };
  if (!isMultiple(field?.type)) return { least: null, most: null };
  const count = choiceOptionsOf(field).length;
  let least = whole(field?.config?.minChoices);
  let most = whole(field?.config?.maxChoices);
  if (most !== null && most >= count) most = null;
  if (least !== null) least = Math.min(least, most ?? count);
  return { least: least !== null && least > 1 ? least : null, most };
}
/** The limits in words, "2 to 3", "at least 2", "up to 3" or "2", or "" without any. */
export function choiceLimitText(field) {
  const { least, most } = choiceLimits(field);
  if (least && most) return least === most ? String(least) : `${least} to ${most}`;
  if (least) return `at least ${least}`;
  return most ? `up to ${most}` : "";
}
/** Too few or too many choices, or null. An empty answer passes; whether one is needed is the required check's. Mirrors JFormAnswerValidator.countProblem. */
export function choiceCountProblem(field, value) {
  const { least, most } = choiceLimits(field);
  const count = Array.isArray(value) ? value.length : value === null || value === undefined || value === "" ? 0 : String(value).split(";").filter((v) => v.trim()).length;
  if (!count) return null;
  if (least && count < least) return `Choose at least ${least}.`;
  if (most && count > most) return `Choose no more than ${most}.`;
  return null;
}

export function isTable(type) {
  return String(type || "").toLowerCase() === "table";
}

export function isName(type) {
  return String(type || "").toLowerCase() === "name";
}

export function isAddress(type) {
  return String(type || "").toLowerCase() === "address";
}

/** A field answered as one object by part and stored, tested and mapped by part: Name and Address. */
export function isCompound(type) {
  return isName(type) || isAddress(type);
}

export function isSingle(type) {
  return getType(type).single === true;
}

export function isSupported(type) {
  const t = FIELD_TYPES[(type || "").toLowerCase()];
  return Boolean(t) && t.supported !== false;
}

/**
 * A type's icon: one SVG per type, named by type, in the jformFieldIcons static resource (a solid
 * shape in JForm teal with white details and a small shadow, built by scripts/icons/build-field-icons.mjs).
 * Unknown types get the Text icon.
 */
export function iconUrl(type) {
  const key = String(type || "").toLowerCase();
  return `${FIELD_ICONS}/${Object.prototype.hasOwnProperty.call(FIELD_TYPES, key) ? key : "text"}.svg`;
}

/** Palette contents: [{ group, items: [{ type, label, fullLabel, iconUrl }] }]; label is the short palette name where one exists. */
export function paletteGroups() {
  return GROUPS.map((group) => ({
    group,
    items: Object.entries(FIELD_TYPES)
      .filter(([, t]) => t.group === group && !t.hiddenInPalette && t.supported !== false)
      .map(([type, t]) => ({ type, label: t.short || t.label, fullLabel: t.label, iconUrl: iconUrl(type) }))
  }));
}

/** Table limits; JFormTableService enforces the same. */
export const MAX_TABLE_ROWS = 20;
export const MAX_TABLE_COLUMNS = 10;
export const MAX_ROW_KEY_LENGTH = 20;

/** Column presets for tables. The words are the stored values, so responses, filters and summaries read as the respondent saw them. */
export const TABLE_SCALES = [
  { key: "satisfaction", label: "Satisfaction", columns: ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"] },
  { key: "agreement", label: "Agreement", columns: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"] },
  { key: "frequency", label: "Frequency", columns: ["Never", "Rarely", "Sometimes", "Often", "Always"] },
  { key: "quality", label: "Quality", columns: ["Poor", "Fair", "Good", "Very good", "Excellent"] },
  { key: "importance", label: "Importance", columns: ["Not important", "Slightly important", "Moderately important", "Important", "Very important"] },
  { key: "yesno", label: "Yes / No / N/A", columns: ["Yes", "No", "N/A"] }
];

/** A table's rows (config.rows): [{ key, label }]. */
export function tableRows(field) {
  const rows = field?.config?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && typeof r === "object" && r.key).map((r) => ({ key: String(r.key), label: String(r.label ?? r.key) }));
}

/**
 * A row key made from its label ("Ease of use" -> ease_of_use), unique among `used`. Made once, when the
 * row is added, and never changed, so renaming a row keeps its answers. Mirrors JFormTableService.normaliseRows.
 */
export function rowKeyFor(label, position, used) {
  let key = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) key = `row_${position}`;
  else if (!/^[a-z]/.test(key)) key = `r_${key}`;
  key = key.slice(0, MAX_ROW_KEY_LENGTH).replace(/_$/, "");
  const taken = used instanceof Set ? used : new Set(used || []);
  let candidate = key;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = `_${n}`;
    candidate = key.slice(0, MAX_ROW_KEY_LENGTH - suffix.length) + suffix;
  }
  return candidate;
}

/**
 * A Name field's parts, always first name then last name. The respondent's answer is one object,
 * { firstName, lastName }; the server stores and maps each part as its own answer, "field.part", and the full
 * name under the field's key. config.parts holds each part's settings by part key. Mirrors JFormNameService.
 */
export const NAME_PARTS = [
  { key: "firstName", label: "First name", autocomplete: "given-name", objectField: "FirstName", maxLength: 40 },
  { key: "lastName", label: "Last name", autocomplete: "family-name", objectField: "LastName", maxLength: 80 }
];
/** The longest a part's max length can be set; a stored answer holds 255 characters. */
export const MAX_NAME_PART_LENGTH = 255;

function namePartSettings(field, key) {
  const s = field?.config?.parts?.[key];
  return s && typeof s === "object" ? s : {};
}

function nameAnswer(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const trimmedText = (v) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * The parts a Name field shows, first name then last name, with their settings filled in:
 * [{ key, label, placeholder, defaultValue, maxLength, autocomplete, objectField }].
 */
export function nameParts(field) {
  return NAME_PARTS.map((part) => {
    const s = namePartSettings(field, part.key);
    const max = Math.round(Number(s.maxLength));
    return {
      key: part.key,
      label: trimmedText(s.label) || part.label,
      placeholder: typeof s.placeholder === "string" ? s.placeholder : "",
      defaultValue: trimmedText(s.defaultValue),
      maxLength: Number.isFinite(max) && max > 0 ? Math.min(max, MAX_NAME_PART_LENGTH) : part.maxLength,
      autocomplete: part.autocomplete,
      objectField: part.objectField
    };
  });
}

/** The answer the renderer sends: the shown parts, trimmed, without the empty ones. */
export function nameValue(field, value) {
  const answer = nameAnswer(value);
  const out = {};
  for (const p of nameParts(field)) {
    const v = trimmedText(answer[p.key]);
    if (v) out[p.key] = v;
  }
  return out;
}

/** The starting answer from the parts' default values, or undefined when no part has one. */
export function nameDefaults(field) {
  const out = {};
  for (const p of nameParts(field)) if (p.defaultValue) out[p.key] = p.defaultValue;
  return Object.keys(out).length ? out : undefined;
}

/**
 * What is wrong with a Name answer, by part: { lastName: "Complete this field." }; empty when nothing is.
 * A required field needs its first and last name. Whitespace alone counts as empty, and the length is
 * measured without the spaces around the name.
 */
export function nameProblems(field, value, required) {
  const answer = nameAnswer(value);
  const problems = {};
  for (const p of nameParts(field)) {
    const v = trimmedText(answer[p.key]);
    if (!v) {
      if (required) problems[p.key] = "Complete this field.";
    } else if (p.maxLength && v.length > p.maxLength) {
      problems[p.key] = `Enter no more than ${p.maxLength} characters`;
    }
  }
  return problems;
}

/** The full name for display: the shown parts in display order, empty ones left out ("Jane Doe"). Mirrors JFormNameService.fullName. */
export function fullNameOf(field, value) {
  const answer = nameAnswer(value);
  return nameParts(field)
    .map((p) => trimmedText(answer[p.key]))
    .filter(Boolean)
    .join(" ");
}

/**
 * An Address field's parts in display order, the country first since it decides the state list. The answer is one
 * object, { country, street, city, state, postalCode }: the country as its code, the state as its code when it is
 * chosen from a list. The server stores each part as "field.part" with the country and state names, their codes as
 * "field.countryCode" and "field.stateCode", and the one-line address under the field's key. config.parts holds
 * each part's label and placeholder; every part always shows. Mirrors JFormAddressService.
 */
export const ADDRESS_PARTS = [
  { key: "country", label: "Country", autocomplete: "country" },
  { key: "street", label: "Street", autocomplete: "street-address", maxLength: 255 },
  { key: "city", label: "City", autocomplete: "address-level2", maxLength: 40 },
  { key: "state", label: "State/Province", autocomplete: "address-level1", maxLength: 80 },
  { key: "postalCode", label: "Zip/Postal code", autocomplete: "postal-code", maxLength: 20 }
];
/** What an address is for: it sets the default label, the browser's autofill section and the record address. */
export const ADDRESS_PURPOSES = [
  { value: "", label: "Address" },
  { value: "billing", label: "Billing address" },
  { value: "shipping", label: "Shipping address" }
];

export function addressPurpose(field) {
  const p = String(field?.config?.purpose || "").trim().toLowerCase();
  return ADDRESS_PURPOSES.some((x) => x.value && x.value === p) ? p : "";
}

/**
 * An Address field's parts in display order with their settings filled in:
 * [{ key, label, placeholder, maxLength, autocomplete }]. Billing and shipping
 * addresses prefix the autocomplete tokens ("billing street-address").
 */
export function addressParts(field) {
  const purpose = addressPurpose(field);
  return ADDRESS_PARTS.map((part) => {
    const s = namePartSettings(field, part.key);
    return {
      key: part.key,
      label: trimmedText(s.label) || part.label,
      placeholder: typeof s.placeholder === "string" ? s.placeholder : "",
      maxLength: part.maxLength,
      autocomplete: purpose ? `${purpose} ${part.autocomplete}` : part.autocomplete
    };
  });
}

/** Every part the server stores: the parts, then the codes ("State/Province code"). */
export function addressStoredParts(field) {
  const all = addressParts(field);
  const state = all.find((p) => p.key === "state");
  return [...all, { key: "stateCode", label: `${state.label} code`, derived: true }, { key: "countryCode", label: `${all[0].label} code`, derived: true }];
}

/** config.countries as upper-case codes; empty when the field offers every country. */
function chosenCountries(field) {
  const raw = field?.config?.countries;
  return new Set(Array.isArray(raw) ? raw.map((c) => trimmedText(c).toUpperCase()).filter(Boolean) : []);
}

/**
 * The countries a field offers, in list order: [{ code, name, states: [{ code, name }] }]. `lists` is
 * JFormAddressService.Lists: the org's State and Country/Territory Picklists, or JForm's own countries.
 */
export function offeredCountries(field, lists) {
  const all = Array.isArray(lists?.countries) ? lists.countries : [];
  const chosen = chosenCountries(field);
  return chosen.size ? all.filter((c) => chosen.has(c.code)) : all;
}

/** An offered country by code or name, ignoring case, or null. */
export function findCountry(field, lists, raw) {
  const needle = trimmedText(raw).toLowerCase();
  if (!needle) return null;
  return offeredCountries(field, lists).find((c) => c.code.toLowerCase() === needle || String(c.name).toLowerCase() === needle) || null;
}

/** The default country's code, or "". */
export function addressDefaultCountry(field) {
  return trimmedText(field?.config?.defaultCountry).toUpperCase();
}

/** The country an answer is in, as its code. */
export function addressCountryOf(field, value) {
  return trimmedText(nameAnswer(value).country).toUpperCase();
}

/** The states the answer's country lists; empty when it has none, or the lists are not loaded. */
export function addressStates(field, lists, value) {
  return findCountry(field, lists, addressCountryOf(field, value))?.states || [];
}

/**
 * Whether State/Province shows: always where states are typed, but with the org's State and Country/Territory
 * Picklists only as a list for a country that has states, since Salesforce refuses a state for any other.
 */
export function addressShowsState(field, lists, value) {
  return !lists?.fromOrg || addressStates(field, lists, value).length > 0;
}

/**
 * The answer the renderer sends: the shown parts, trimmed, without the empty ones. A country alone is no answer:
 * it is filled in before the respondent starts.
 */
export function addressValue(field, value, lists) {
  const answer = nameAnswer(value);
  const out = {};
  for (const p of addressParts(field)) {
    const v = trimmedText(answer[p.key]);
    if (v && (p.key !== "state" || addressShowsState(field, lists, value))) out[p.key] = v;
  }
  return Object.keys(out).some((k) => k !== "country") ? out : {};
}

/**
 * The starting answer: the visitor's country when `detected` is offered and the field starts there
 * (config.detectCountry), else the default country; undefined when the field has no start.
 */
export function addressDefaults(field, lists, detected) {
  const found = field?.config?.detectCountry === true && detected ? findCountry(field, lists, detected) : null;
  const start = found ? found.code : addressDefaultCountry(field);
  return start ? { country: start } : undefined;
}

/** Whether a required Address field needs a part: not the postal code, which many countries do not have, and the state only from a list. */
export function addressPartNeeded(key, states) {
  return key !== "postalCode" && (key !== "state" || states.length > 0);
}

/**
 * What is wrong with an Address answer, by part: { city: "Complete this field." }; empty when nothing is.
 * A required field needs every part but the postal code, the state only when its country lists states; one line
 * of the street is enough.
 * The country, and a state where the country lists states, must be in the lists.
 */
export function addressProblems(field, value, required, lists) {
  const answer = nameAnswer(value);
  const states = addressStates(field, lists, value);
  const listed = (list, v) => list.some((x) => x.code.toLowerCase() === v.toLowerCase() || String(x.name).toLowerCase() === v.toLowerCase());
  const problems = {};
  for (const p of addressParts(field)) {
    const v = trimmedText(answer[p.key]);
    if (!v) {
      if (required && addressPartNeeded(p.key, states)) problems[p.key] = "Complete this field.";
    } else if ((p.key === "country" && lists && !listed(offeredCountries(field, lists), v)) || (p.key === "state" && states.length && !listed(states, v))) {
      // a value the list no longer has, such as a link's or a draft's
      problems[p.key] = "Choose an option from the list.";
    } else if (p.maxLength && v.length > p.maxLength) {
      problems[p.key] = `Enter no more than ${p.maxLength} characters`;
    }
  }
  return problems;
}

/**
 * What the server stores for an answer, by stored part key: the country and a listed state as names, with their
 * codes as countryCode and stateCode. Logic rules test these, as the server does. Mirrors JFormAddressService.resolve.
 */
export function addressStored(field, value, lists) {
  const out = addressValue(field, value, lists);
  const code = out.country;
  const country = code ? findCountry(field, lists, code) : null;
  delete out.country;
  if (country) {
    out.country = country.name;
    out.countryCode = country.code;
    const state = out.state && (country.states || []).find((r) => r.code.toLowerCase() === out.state.toLowerCase() || String(r.name).toLowerCase() === out.state.toLowerCase());
    if (state) {
      out.state = state.name;
      out.stateCode = state.code;
    }
  } else if (code) {
    out.country = code;
  }
  return out;
}

/** One line for people: "1 George St, Sydney, NSW 2000, Australia", empty parts left out. Mirrors JFormAddressService.oneLine. */
export function addressLine(field, value, lists) {
  const s = addressStored(field, value, lists);
  const street = trimmedText(s.street)
    .split(/\s*\r?\n\s*/)
    .filter(Boolean)
    .join(", ");
  return [street, s.city, `${s.stateCode || s.state || ""} ${s.postalCode || ""}`.trim(), s.country].filter(Boolean).join(", ");
}

/**
 * The answers a field gives, as fields, for the Logic and Automate tabs: a table gives one per row
 * ({ key: "field.row", type: "radio" or "checkboxes", label: "Field: Row", options, table: field key }),
 * a Name field one per part ({ key: "field.part", type: "text", label: "Field: Part", name: field key,
 * part, objectField }), an Address field one per stored part ({ key, type: "text", label, address: field key,
 * part, purpose, derived } where derived marks the codes). A choice field with Other gives itself, then the text typed
 * under Other ({ key: "field.other", type: "text", label: "Field: Other", other: field key }). Any other field gives itself.
 */
export function answerFieldsOf(field) {
  if (offersOther(field)) return [field, { key: otherKey(field), type: "text", label: `${field.label || field.key}: ${otherLabel(field)}`, other: field.key }];
  if (isAddress(field?.type)) {
    const label = field.label || field.key;
    const purpose = addressPurpose(field);
    return addressStoredParts(field).map((p) => ({
      key: `${field.key}.${p.key}`,
      type: "text",
      label: `${label}: ${p.label}`,
      address: field.key,
      part: p.key,
      purpose,
      derived: p.derived === true
    }));
  }
  if (isName(field?.type)) {
    const label = field.label || field.key;
    return nameParts(field).map((p) => ({
      key: `${field.key}.${p.key}`,
      type: "text",
      label: `${label}: ${p.label}`,
      name: field.key,
      part: p.key,
      objectField: p.objectField
    }));
  }
  if (!isTable(field?.type)) return [field];
  const type = field.config?.multiple === true ? "checkboxes" : "radio";
  const name = field.label || field.key;
  return tableRows(field).map((r) => ({ key: `${field.key}.${r.key}`, type, label: `${name}: ${r.label}`, options: field.options || [], table: field.key }));
}

/** The rows of a table answer ({ rowKey: value }) that have no answer yet. */
export function unansweredRows(field, value) {
  const answers = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return tableRows(field).filter((r) => isEmptyValue(answers[r.key]));
}

/** Why a required table is not answered enough, or null. Every row must be answered unless config.everyRow is false. */
export function tableProblem(field, value) {
  const rows = tableRows(field);
  const missing = unansweredRows(field, value);
  const everyRow = field?.config?.everyRow !== false;
  if (rows.length && missing.length === rows.length) return everyRow ? "Answer every row." : "Answer at least one row.";
  if (everyRow && missing.length) return `Answer every row: ${missing.map((r) => r.label).join(", ")}.`;
  return null;
}

/** Defaults for a freshly added field of a type. */
export function defaultsFor(type) {
  const t = getType(type);
  const field = { type: (type || "text").toLowerCase(), label: t.label, required: false, width: 100 };
  if (t.options) field.options = [{ label: "Option 1", value: "Option 1" }];
  if (type === "richtext") field.richtext = "<p>Your text here</p>";
  if (type === "image") field.config = { fit: "cover", height: "medium" };
  if (type === "payment") field.config = { pricing: "fixed", amount: 10 };
  if (type === "event") {
    const day = new Date();
    day.setDate(day.getDate() + 14);
    const pad = (n) => String(n).padStart(2, "0");
    field.label = "Event title";
    field.config = { date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`, startTime: "09:00", endTime: "12:00" };
  }
  if (type === "table") {
    field.label = "How satisfied were you with";
    field.options = TABLE_SCALES[0].columns.map((c) => ({ label: c, value: c }));
    field.config = { rows: [{ key: "service", label: "Service" }, { key: "price", label: "Price" }, { key: "speed", label: "Speed" }], multiple: false, everyRow: true };
  }
  if (type === "name") {
    field.config = {
      layout: "inline",
      parts: { firstName: { label: "First name", maxLength: 40 }, lastName: { label: "Last name", maxLength: 80 } }
    };
  }
  // like Phone, a new Address field starts in the visitor's country, else the builder's
  if (type === "address") field.config = { defaultCountry: localeCountry(LOCALE), detectCountry: true };
  if (type === "email") field.validation = { regexPattern: EMAIL_PATTERN.source, errorMessage: "Enter a valid email address" };
  // new phone fields get the country picker, starting in the builder's country
  if (type === "phone") field.config = { countryPicker: true, detectCountry: true, defaultCountry: localeCountry(LOCALE) };
  return field;
}

/**
 * Validate a single answer against the field definition. Required-ness is
 * decided by the caller (it depends on logic). Returns an error message or null.
 */
export function validateValue(field, value) {
  // a table only offers its own columns; its required rule is tableProblem(); Name and Address are checked by part
  if (!collectsAnswer(field.type) || isTable(field.type) || isCompound(field.type)) return null;
  const empty = value === null || value === undefined || (Array.isArray(value) ? value.length === 0 : String(value).trim() === "");
  if (empty) return null;
  const v = field.validation || {};
  const str = Array.isArray(value) ? value.join("; ") : String(value);
  const msg = v.errorMessage || null;

  if (isMultiple(field.type)) return choiceCountProblem(field, value);
  if (field.type === "email" && !EMAIL_PATTERN.test(str)) return msg || "Enter a valid email address";
  // with the country picker the answer is an international number, checked by the country's rules alone
  if (field.type === "phone" && field.config?.countryPicker === true) {
    const problem = phoneProblem(str, field.config);
    return problem ? msg || problem : null;
  }
  if (v.regexPattern) {
    try {
      if (!new RegExp(v.regexPattern).test(str)) return msg || "The value does not match the expected format";
    } catch (e) {
      /* invalid pattern authored in the builder: do not block the respondent */
    }
  }
  if (v.minLength !== undefined && v.minLength !== null && str.length < v.minLength) return msg || `Enter at least ${v.minLength} characters`;
  if (v.maxLength !== undefined && v.maxLength !== null && str.length > v.maxLength) return msg || `Enter no more than ${v.maxLength} characters`;
  if (field.type === "date") {
    const problem = dateProblem(str, field.config);
    return problem ? msg || problem : null;
  }
  if (field.type === "time") {
    const problem = timeProblem(str, field.config);
    return problem ? msg || problem : null;
  }
  if (field.type === "number" || field.type === "nps" || field.type === "rating") {
    const n = Number(str);
    if (!Number.isFinite(n)) return msg || "Enter a number";
    if (v.minValue !== undefined && v.minValue !== null && n < v.minValue) return msg || `Enter a value of at least ${v.minValue}`;
    if (v.maxValue !== undefined && v.maxValue !== null && n > v.maxValue) return msg || `Enter a value of at most ${v.maxValue}`;
  }
  return null;
}

/**
 * The kinds of file a File upload field can take, in the order the builder lists them. Each kind's extensions are
 * on JFormUploadPolicy's allowlist for its group; the builder's Only these stores the ticked kinds' extensions.
 */
export const FILE_KINDS = [
  { key: "pdf", label: "PDF", group: "document", extensions: ["pdf"] },
  { key: "word", label: "Word", group: "document", extensions: ["doc", "docx"] },
  { key: "excel", label: "Excel", group: "document", extensions: ["xls", "xlsx"] },
  { key: "csv", label: "CSV", group: "document", extensions: ["csv"] },
  { key: "powerpoint", label: "PowerPoint", group: "document", extensions: ["ppt", "pptx"] },
  { key: "opendocument", label: "OpenDocument", group: "document", extensions: ["odt", "ods", "odp"] },
  { key: "rtf", label: "Rich text", group: "document", extensions: ["rtf"] },
  { key: "txt", label: "Plain text", group: "document", extensions: ["txt"] },
  { key: "jpeg", label: "JPEG", group: "image", extensions: ["jpg", "jpeg"] },
  { key: "png", label: "PNG", group: "image", extensions: ["png"] },
  { key: "gif", label: "GIF", group: "image", extensions: ["gif"] },
  { key: "webp", label: "WebP", group: "image", extensions: ["webp"] },
  { key: "heic", label: "HEIC", group: "image", extensions: ["heic", "heif"] },
  { key: "bmp", label: "BMP", group: "image", extensions: ["bmp"] },
  { key: "tiff", label: "TIFF", group: "image", extensions: ["tif", "tiff"] },
  { key: "mp3", label: "MP3", group: "audio", extensions: ["mp3"] },
  { key: "wav", label: "WAV", group: "audio", extensions: ["wav"] },
  { key: "aac", label: "M4A and AAC", group: "audio", extensions: ["m4a", "aac"] },
  { key: "ogg", label: "OGG", group: "audio", extensions: ["ogg", "oga"] },
  { key: "flac", label: "FLAC", group: "audio", extensions: ["flac"] }
];
export const FILE_GROUPS = [
  { key: "document", label: "Documents" },
  { key: "image", label: "Images" },
  { key: "audio", label: "Audio" }
];
/** The most Apex takes in one upload, and the most files a field takes. Mirror JFormUploadPolicy. */
export const MAX_FILE_MB = 3;
export const MAX_FIELD_FILES = 10;

/** The groups a field offers: the one its fileType names (set through the API), or all of them. */
export function fileGroupsFor(field) {
  const fileType = String(field?.fileType || "").toLowerCase();
  return FILE_GROUPS.some((g) => g.key === fileType) ? FILE_GROUPS.filter((g) => g.key === fileType) : FILE_GROUPS;
}

/** config.extensions, lower case without dots; null when the field takes any allowed file. Mirrors JFormUploadPolicy. */
export function chosenExtensions(field) {
  const raw = field?.config?.extensions;
  if (raw === undefined || raw === null) return null;
  return Array.isArray(raw) ? raw.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim().replace(/^\./, "").toLowerCase()) : [];
}

/** Extensions a file upload field takes: its group's, narrowed to config.extensions. Mirrors JFormUploadPolicy, which enforces them. */
export function allowedExtensions(field) {
  const groups = new Set(fileGroupsFor(field).map((g) => g.key));
  const all = FILE_KINDS.filter((k) => groups.has(k.group)).flatMap((k) => k.extensions);
  const chosen = chosenExtensions(field);
  return chosen ? all.filter((e) => chosen.includes(e)) : all;
}

/** The file input's accept list for a field, e.g. ".jpg,.png". */
export function acceptFor(field) {
  return allowedExtensions(field).map((extension) => `.${extension}`).join(",");
}

/** A whole number from 1 to most, or most. */
function fileLimit(raw, most) {
  const n = Number(raw);
  return raw !== undefined && raw !== null && raw !== "" && Number.isInteger(n) && n >= 1 && n <= most ? n : most;
}

/** The field's largest file (MB, and bytes) and its number of files. Mirrors JFormUploadPolicy.maxSizeMb and maxFiles. */
export function fileLimits(field) {
  const maxSizeMb = fileLimit(field?.config?.maxSizeMb, MAX_FILE_MB);
  return { maxSizeMb, maxBytes: maxSizeMb * 1024 * 1024, maxFiles: fileLimit(field?.config?.maxFiles, MAX_FIELD_FILES) };
}

/** What a narrowed field takes, by kind ("PDF, Excel or CSV"); "" when it takes any allowed file. */
export function fileTypesText(field) {
  if (!chosenExtensions(field)) return "";
  const allowed = allowedExtensions(field);
  const labels = FILE_KINDS.filter((k) => k.extensions.some((e) => allowed.includes(e))).map((k) => k.label);
  return listOf(labels);
}

/** The line under the box: "PDF, Excel or CSV, up to 2 MB, at most 3 files"; "" while the field has no rules of its own. */
export function fileRuleText(field) {
  const types = fileTypesText(field);
  const { maxSizeMb, maxFiles } = fileLimits(field);
  if (!types && maxSizeMb === MAX_FILE_MB && maxFiles === MAX_FIELD_FILES) return "";
  const parts = [types || "Any allowed file", `up to ${maxSizeMb} MB`];
  if (maxFiles < MAX_FIELD_FILES) parts.push(maxFiles === 1 ? "one file" : `at most ${maxFiles} files`);
  return parts.join(", ");
}

/** The name a file is stored under: JFormUploadPolicy.safeFileName, so its extension is the one the server checks. */
function storedName(name) {
  const last = name.replace(/\\/g, "/").split("/").pop();
  return last.replace(/[:*?"<>|\p{Cc}]/gu, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
}

/** Why files picked for a field can't be attached (too many, a type it doesn't take, too large), or null. */
export function fileProblem(field, files) {
  const list = Array.from(files || []);
  const { maxSizeMb, maxBytes, maxFiles } = fileLimits(field);
  if (list.length > maxFiles) return maxFiles === 1 ? "Choose one file." : `Choose at most ${maxFiles} files.`;
  const allowed = allowedExtensions(field);
  for (const file of list) {
    const name = String(file?.name || "");
    const stored = storedName(name);
    const extension = stored.includes(".") ? stored.split(".").pop().toLowerCase() : "";
    if (!allowed.includes(extension)) {
      const types = fileTypesText(field);
      return `${name} can't be attached. ${types ? `This field takes ${types} files.` : "Files of this type can't be attached."}`;
    }
    if (file.size > maxBytes) return `${name} is larger than ${maxSizeMb} MB. Please choose a smaller file.`;
  }
  return null;
}

export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  // a table's answer is empty until one of its rows is answered
  if (typeof value === "object") return Object.values(value).every(isEmptyValue);
  return String(value).trim() === "";
}
