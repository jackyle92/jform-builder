import LOCALE from "@salesforce/i18n/locale";

/**
 * JForm Payments in the browser: the Payment block's pricing and money formatting.
 *
 * The rules are JFormPaymentPricing's in Apex, which prices every response again on the server, so a total
 * shown here is never trusted. Prices in the block's config and the "pay what you want" answer are in the
 * currency's main unit (45, 12.5); totals here are in the smallest unit (4500), as the server and Stripe
 * count them. Zero-decimal currencies such as JPY and VND have no smaller unit.
 */
export const FIELD_TYPE = "payment";

export const PRICING_OPTIONS = [
  { value: "fixed", label: "Fixed amount" },
  { value: "choice", label: "Price per choice" },
  { value: "quantity", label: "Quantity × price" },
  { value: "custom", label: "Pay what you want" }
];
const PRICING = new Set(PRICING_OPTIONS.map((o) => o.value));
/** Fields a price per choice can follow, and the ones that allow several answers. */
export const CHOICE_SOURCES = ["radio", "picklist", "checkboxes", "multiselect"];
const MULTI_SOURCES = new Set(["checkboxes", "multiselect"]);
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
/** Stripe's largest amount, in the smallest unit. */
export const MAX_AMOUNT = 99999999;
export const MAX_QUANTITY = 1000;
/**
 * The currencies forms can take, offered on the Settings tab and mirrored in JFormPaymentPricing.SUPPORTED, which
 * refuses any other code when a form is saved or published. Three-decimal currencies (BHD, JOD, KWD, OMR, TND) are
 * left out because Stripe rounds their amounts to tens.
 */
export const CURRENCIES = [
  "USD", "EUR", "GBP", "AUD", "CAD", "NZD", "SGD", "HKD", "JPY", "VND", "CHF", "SEK", "NOK", "DKK", "PLN",
  "CZK", "MXN", "BRL", "INR", "ZAR", "AED", "THB", "MYR", "PHP", "IDR", "KRW"
];

/**
 * The payment gateways JForm supports, in the order the Setup and Settings tabs list them. A form takes its
 * payments through one, kept in settings.payments.gateway (JFormPaymentService.GATEWAYS on the server).
 * c-jform-gateway-logo draws each one's logo.
 */
export const GATEWAYS = [
  {
    id: "stripe",
    name: "Stripe",
    summary: "Hosted checkout. Respondents pay with the cards, wallets and bank debits turned on in your Stripe dashboard.",
    hostedCheckout: true,
    dashboardUrl: "https://dashboard.stripe.com"
  }
];
export const DEFAULT_GATEWAY = "stripe";

/** The gateway with this id (blank means the default), or null for one JForm does not support. */
export function gatewayOf(id) {
  const key = String(id || DEFAULT_GATEWAY).trim().toLowerCase();
  return GATEWAYS.find((g) => g.id === key) || null;
}

/** The test banner on a Payment block. */
export function testBanner(gatewayName = "Stripe") {
  return `Test payments. Use a ${gatewayName} test card. No money is charged.`;
}

/**
 * The gateways as c-jform-gateway-picker options in the builder, each with a line per mode from
 * JFormWorkspaceController.getPaymentStatus (which reports Stripe, the only gateway so far).
 */
export function gatewayOptions(status) {
  return GATEWAYS.map((g) => ({
    id: g.id,
    name: g.name,
    states: status
      ? [
          status.testConnected ? { key: "test", text: "Test: ready", tone: "on" } : { key: "test", text: "Test: not set up yet", tone: "warn" },
          status.sandbox
            ? { key: "live", text: "Live: not in this org", tone: "off" }
            : status.liveConnected
              ? { key: "live", text: "Live: ready", tone: "on" }
              : { key: "live", text: "Live: not set up", tone: "off" }
        ]
      : []
  }));
}

/** The form's payment settings: the published form's `payments`, or the draft's settings.payments in the builder. */
export function paymentSettings(definition) {
  const p = definition?.payments || definition?.settings?.payments || {};
  return {
    gateway: String(p.gateway || DEFAULT_GATEWAY).trim().toLowerCase(),
    mode: String(p.mode || "").toLowerCase() === "live" ? "live" : "test",
    currency: currencyOf(p.currency) || "USD",
    openIn: p.openIn === "page" ? "page" : "popup",
    testSteps: p.testSteps !== false,
    codes: codesOf(p.codes),
    // the Email field whose answer is filled in on the gateway's page, on a form with several (JFormPaymentService.customerEmail)
    emailField: typeof p.emailField === "string" && p.emailField.trim() ? p.emailField.trim() : null,
    // the builder chose "Ask on the gateway's page": no answer is sent, even from the form's only Email field
    askEmail: p.askEmail === true,
    // the gateway's page always asks for a billing address, not only when the card needs one
    askBillingAddress: p.askBillingAddress === true,
    unavailable: typeof p.unavailable === "string" && p.unavailable ? p.unavailable : null
  };
}

/** The form's Email fields, in form order. */
export function emailFields(definition) {
  const out = [];
  for (const s of definition?.sections || []) {
    for (const f of s.fields || []) {
      if (String(f.type || "").toLowerCase() === "email") out.push(f);
    }
  }
  return out;
}

/** settings.payments.codes: who defines the promotion codes a form takes (JFormPromotionCodeService). */
export const CODE_KINDS = [
  { value: "none", label: "No promotion codes" },
  { value: "jform", label: "Codes defined in JForm" },
  { value: "gateway", label: "Codes defined in the gateway" }
];
/** What a refused code gets, whatever the reason (JFormPromotionCodeService.REFUSED). */
export const CODE_REFUSED = "This code isn't valid. Check it and try again.";

export function codesOf(value) {
  const v = String(value || "").trim().toLowerCase();
  return CODE_KINDS.some((k) => k.value === v) ? v : "none";
}

/**
 * The discount a promotion code takes off a subtotal, as the server works it out (JFormPaymentPricing.applyCode):
 * the percentage rounded half up to the smallest unit, or the fixed amount, and never more than the subtotal. A
 * total left between zero and the currency's minimum charge is raised to that minimum.
 * `code` is what checkPromotionCode answered: { code, discountType, percentOff, amountOff, minimumCharge }, the
 * amounts in the smallest unit; the minimum comes from the server's Payment Currency records.
 */
export function discountOf(subtotal, code) {
  if (!code || !(subtotal > 0)) return 0;
  const off = code.discountType === "Percent" ? Math.round((subtotal * Number(code.percentOff || 0)) / 100) : Number(code.amountOff || 0);
  const discount = Math.max(0, Math.min(off, subtotal));
  // a total the gateway cannot charge is raised to its minimum; a code that makes it free stays free
  const least = Number(code.minimumCharge || 0);
  return subtotal - discount > 0 && subtotal - discount < least ? Math.max(0, subtotal - least) : discount;
}

/** The form's Payment block, or null. A form has one at most. */
export function paymentBlock(definition) {
  for (const s of definition?.sections || []) {
    for (const f of s.fields || []) {
      if (String(f.type || "").toLowerCase() === FIELD_TYPE) return f;
    }
  }
  return null;
}

export function pricingOf(field) {
  const p = field?.config?.pricing;
  return PRICING.has(p) ? p : "fixed";
}

/** An upper-cased code from CURRENCIES, or null for one forms cannot take. */
export function currencyOf(code) {
  const c = String(code || "").trim().toUpperCase();
  return CURRENCIES.includes(c) ? c : null;
}

export function decimalsOf(currency) {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

/** "12.50", 12.5 or "1,250.00" as plain text; null when it is not a plain amount. */
function amountText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, "");
  return /^\d{1,12}(\.\d{1,4})?$/.test(text) ? text : null;
}

/** 12.5 USD -> 1250, without floating-point rounding; null when the amount has more decimals than the currency. */
export function toMinor(major, currency) {
  const text = amountText(major);
  if (text === null) return null;
  const digits = decimalsOf(currency);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.replace(/0+$/, "").length > digits) return null;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0").slice(0, digits) || "0");
}

/**
 * 1250 USD -> "$12.50" in the respondent's locale. `short` drops a zero fraction ("Pay $40 and submit").
 */
export function formatMoney(minor, currency, short = false) {
  const digits = decimalsOf(currency);
  const major = (Number(minor) || 0) / 10 ** digits;
  const fraction = short && Number(minor) % 10 ** digits === 0 ? 0 : digits;
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency, minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(major);
  } catch (e) {
    return `${major.toFixed(fraction)} ${currency}`;
  }
}

/** 12.5 USD -> "$12.50", for amounts the server sends in the main unit (Responses tab). */
export function formatMajor(major, currency) {
  const code = currencyOf(currency) || "USD";
  return formatMoney(Math.round(Number(major || 0) * 10 ** decimalsOf(code)), code);
}

function itemName(definition, block) {
  const item = String(block?.config?.item || "").trim();
  return item || String(definition?.label || definition?.name || "").trim() || "Payment";
}

/** prices [{ value, amount }] as a Map of value -> amount in the main unit; unusable entries are left out. */
export function pricesOf(block) {
  const prices = new Map();
  for (const p of Array.isArray(block?.config?.prices) ? block.config.prices : []) {
    const text = amountText(p?.amount);
    if (p && p.value !== undefined && p.value !== null && text !== null && Number(text) > 0) prices.set(String(p.value), text);
  }
  return prices;
}

/** The values the answer picks: each once, and one for a single-choice source, whatever a tampered answer holds. */
function chosenValues(answer, multiple) {
  let parts = [];
  if (Array.isArray(answer)) parts = answer.map(String);
  else if (answer !== null && answer !== undefined) parts = multiple ? String(answer).split(";").map((v) => v.trim()) : [String(answer)];
  const values = [];
  for (const part of parts) {
    if (part.trim() && !values.includes(part)) values.push(part);
    if (!multiple && values.length) break;
  }
  return values;
}

function fieldsByKey(definition) {
  const map = {};
  for (const s of definition?.sections || []) for (const f of s.fields || []) map[f.key] = f;
  return map;
}

/** The problem with a "pay what you want" amount, or null; the server gives the same messages. */
export function customAmountProblem(value, block, currency) {
  if (value === null || value === undefined || String(value).trim() === "") return "Enter the amount you want to pay.";
  const text = amountText(value);
  if (text === null || Number(text) <= 0) return "Enter the amount you want to pay as a number, such as 25 or 12.50.";
  const minimum = amountText(block?.config?.minimum);
  if (minimum !== null && Number(text) < Number(minimum)) return `The amount must be at least ${formatMoney(toMinor(minimum, currency), currency)}.`;
  if (toMinor(text, currency) === null) return decimalsOf(currency) === 0 ? "Enter the amount as a whole number." : "Enter the amount with at most two decimals.";
  return null;
}

/**
 * What the respondent owes now: { currency, amount, lines: [{ name, detail, quantity, unitAmount, amount }], problem },
 * or null when the form has no Payment block or a rule hides it. `visible` is the logic's visible map.
 */
export function quote(definition, answers = {}, visible = {}, code = null) {
  const block = paymentBlock(definition);
  if (!block || visible[block.key] === false) return null;
  const currency = paymentSettings(definition).currency;
  const config = block.config || {};
  const item = itemName(definition, block);
  const q = { currency, amount: 0, subtotal: 0, discount: 0, code: "", lines: [], problem: null, pricing: pricingOf(block) };
  const add = (name, detail, unitAmount, quantity) => {
    if (!unitAmount || unitAmount <= 0) return;
    q.lines.push({ name, detail, quantity, unitAmount, amount: unitAmount * quantity });
    q.amount += unitAmount * quantity;
  };
  const source = fieldsByKey(definition)[config.source];
  const sourceShown = source && visible[source.key] !== false;

  if (q.pricing === "fixed") {
    add(item, "", toMinor(config.amount, currency), 1);
  } else if (q.pricing === "choice") {
    if (sourceShown) {
      const prices = pricesOf(block);
      for (const chosen of chosenValues(answers[source.key], MULTI_SOURCES.has(source.type))) {
        if (prices.has(chosen)) add(item, optionLabel(source, chosen), toMinor(prices.get(chosen), currency), 1);
      }
    }
  } else if (q.pricing === "quantity") {
    if (sourceShown) {
      const answer = answers[source.key];
      if (answer !== null && answer !== undefined && String(answer).trim() !== "") {
        const text = amountText(answer);
        const name = source.label || source.key;
        if (text === null || !Number.isInteger(Number(text))) q.problem = `Enter a whole number for ${name}.`;
        else if (Number(text) > MAX_QUANTITY) q.problem = `${name} can be at most ${MAX_QUANTITY}.`;
        else add(item, "", toMinor(config.unitPrice, currency), Number(text));
      }
    }
  } else {
    const given = answers[block.key];
    const problem = customAmountProblem(given, block, currency);
    if (problem) q.problem = given === null || given === undefined || String(given).trim() === "" ? null : problem;
    else add(item, "", toMinor(given, currency), 1);
  }
  if (q.amount > MAX_AMOUNT) q.problem = "The total is more than this form can take in one payment.";
  q.subtotal = q.amount;
  if (code && q.pricing !== "custom") {
    q.discount = discountOf(q.subtotal, code);
    q.amount = q.subtotal - q.discount;
    q.code = String(code.code || "");
  }
  return q;
}

function optionLabel(source, value) {
  const o = (source.options || []).find((opt) => String(opt.value ?? opt.label) === value);
  return o ? o.label || value : value;
}

/**
 * What the Payment block shows. On the live form and in the preview: the lines and the total for the answers so
 * far. In the builder canvas (`rules`): the pricing rules, with a total only for a fixed amount.
 *   { lines: [{ key, name, detail, amountText }], totalText, amount, note, test, testText, custom, minimumText, currency,
 *     problem, rules, gateway, gatewayName, modeLabel }
 */
export function paymentView(definition, answers = {}, visible = {}, rules = false, code = null) {
  const block = paymentBlock(definition);
  if (!block) return null;
  const settings = paymentSettings(definition);
  const currency = settings.currency;
  const money = (minor) => formatMoney(minor, currency);
  const minimum = toMinor(block.config?.minimum, currency);
  const gatewayName = gatewayOf(settings.gateway)?.name || settings.gateway;
  const custom = pricingOf(block) === "custom";
  const view = {
    currency,
    rules,
    gateway: settings.gateway,
    gatewayName,
    modeLabel: settings.mode === "live" ? "Live" : "Test",
    test: settings.mode === "test",
    testText: testBanner(gatewayName),
    custom,
    minimumText: minimum > 0 ? `At least ${money(minimum)}` : "",
    lines: [],
    totalText: "",
    amount: 0,
    note: "",
    problem: null,
    // promotion codes: the box for codes defined in JForm, or a line saying the gateway's page takes them
    codes: settings.codes,
    showCodeBox: settings.codes === "jform" && !custom,
    gatewayCodesText: settings.codes === "gateway" && !custom ? `Have a promotion code? Enter it on ${gatewayName}'s payment page.` : "",
    codeApplied: "",
    discountText: ""
  };
  if (rules) return { ...view, ...rulesView(definition, block, currency) };

  const q = quote(definition, answers, visible, code) || { lines: [], amount: 0, subtotal: 0, discount: 0, code: "", problem: null };
  view.lines = q.lines.map((l, i) => ({
    key: `l${i}`,
    name: l.detail ? `${l.name} · ${l.detail}` : l.name,
    detail: l.quantity > 1 ? `${l.quantity} × ${money(l.unitAmount)}` : "",
    amountText: money(l.amount),
    cls: "jf-payment-line"
  }));
  if (q.discount > 0) {
    view.codeApplied = q.code;
    view.discountText = `−${money(q.discount)}`;
    view.lines.push({ key: "discount", name: `Code ${q.code}`, detail: "", amountText: view.discountText, cls: "jf-payment-line jf-payment-line-discount" });
  }
  view.amount = q.amount;
  view.totalText = money(q.amount);
  view.problem = q.problem;
  if (!q.lines.length && !q.problem) view.note = emptyNote(definition, block);
  return view;
}

function emptyNote(definition, block) {
  if (pricingOf(block) !== "choice" && pricingOf(block) !== "quantity") return "";
  const source = fieldsByKey(definition)[block.config?.source];
  return `The price follows your answer to ${source?.label || "the question above"}.`;
}

/** The canvas: what each rule charges, for the builder to check at a glance. */
function rulesView(definition, block, currency) {
  const config = block.config || {};
  const money = (major) => formatMoney(toMinor(major, currency) || 0, currency);
  const item = itemName(definition, block);
  const source = fieldsByKey(definition)[config.source];
  const pricing = pricingOf(block);
  if (pricing === "fixed") {
    const minor = toMinor(config.amount, currency) || 0;
    return { lines: [{ key: "l0", name: item, detail: "", amountText: formatMoney(minor, currency), cls: "jf-payment-line" }], totalText: formatMoney(minor, currency), amount: minor };
  }
  if (pricing === "choice") {
    const prices = pricesOf(block);
    const lines = (source?.options || [])
      .map((o, i) => ({ key: `l${i}`, name: o.label || String(o.value), detail: "", amountText: prices.has(String(o.value ?? o.label)) ? money(prices.get(String(o.value ?? o.label))) : "Free", cls: "jf-payment-line" }));
    return { lines, note: source ? `${item}: the price follows the answer to ${source.label || source.key}.` : "Choose the choice field the prices follow." };
  }
  if (pricing === "quantity") {
    const unit = amountText(config.unitPrice);
    return {
      lines: [{ key: "l0", name: item, detail: source ? `× ${source.label || source.key}` : "", amountText: unit === null ? "" : `${money(unit)} each`, cls: "jf-payment-line" }],
      note: source ? "" : "Choose the number field that holds the quantity."
    };
  }
  return { lines: [], note: `${item}: the respondent enters the amount.` };
}
