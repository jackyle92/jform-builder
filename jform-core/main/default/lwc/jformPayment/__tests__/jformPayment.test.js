import { paymentSettings, paymentBlock, emailFields, currencyOf, toMinor, formatMoney, formatMajor, customAmountProblem, quote, paymentView, gatewayOf, gatewayOptions, codesOf, discountOf, CODE_KINDS, CODE_REFUSED } from "c/jformPayment";

const form = (block, extra = {}, payments = {}) => ({
  name: "Workshop",
  label: "Book the workshop",
  payments: { mode: "test", currency: "USD", ...payments },
  sections: [
    {
      key: "p1",
      fields: [
        { key: "session", type: "radio", label: "Session", options: [{ label: "6pm session", value: "6pm" }, { label: "8pm session", value: "8pm" }] },
        { key: "extras", type: "checkboxes", label: "Extras", options: [{ label: "Lunch", value: "lunch" }, { label: "Notes", value: "notes" }] },
        { key: "seats", type: "number", label: "Seats" },
        { key: "pay", type: "payment", label: "Payment", config: block }
      ]
    }
  ],
  ...extra
});

describe("c/jformPayment", () => {
  it("reads the published payments, or the draft settings in the builder", () => {
    expect(paymentSettings({ payments: { gateway: "Stripe", mode: "LIVE", currency: "eur", openIn: "page", unavailable: "Not now." } })).toEqual({
      gateway: "stripe",
      mode: "live",
      currency: "EUR",
      codes: "none",
      openIn: "page",
      testSteps: true,
      emailField: null,
      askEmail: false,
      askBillingAddress: false,
      unavailable: "Not now."
    });
    expect(paymentSettings({ settings: { payments: { testSteps: false, currency: "KWD", emailField: " work_email " } } })).toEqual({
      gateway: "stripe",
      mode: "test",
      currency: "USD",
      codes: "none",
      openIn: "popup",
      testSteps: false,
      emailField: "work_email",
      askEmail: false,
      askBillingAddress: false,
      unavailable: null
    });
    expect(paymentSettings({ settings: { payments: { emailField: "" } } }).emailField).toBeNull();
    expect(paymentSettings({ settings: { payments: { askEmail: true } } }).askEmail).toBe(true);
    expect(paymentSettings({ settings: { payments: { askEmail: "yes" } } }).askEmail).toBe(false);
    expect(paymentSettings({ settings: { payments: { askBillingAddress: true } } }).askBillingAddress).toBe(true);
    expect(emailFields({ sections: [{ fields: [{ key: "a", type: "text" }, { key: "e1", type: "Email" }] }, { fields: [{ key: "e2", type: "email" }] }] }).map((f) => f.key)).toEqual(["e1", "e2"]);
    expect(emailFields({})).toEqual([]);
    // only the codes the Settings tab offers count, like JFormPaymentPricing.SUPPORTED on the server
    expect(paymentSettings({ settings: { payments: { currency: "ARS" } } }).currency).toBe("USD");
    expect(paymentSettings({ settings: { payments: { currency: " jpy " } } }).currency).toBe("JPY");
    expect(paymentBlock(form({ pricing: "fixed", amount: 10 })).key).toBe("pay");
    expect(paymentBlock({ sections: [{ fields: [{ key: "a", type: "text" }] }] })).toBeNull();
  });

  it("knows the gateways JForm supports and whether each mode is set up", () => {
    expect(gatewayOf()).toMatchObject({ id: "stripe", name: "Stripe", hostedCheckout: true });
    expect(gatewayOf(" STRIPE ").id).toBe("stripe");
    expect(gatewayOf("paypal")).toBeNull();
    expect(gatewayOptions(undefined)).toEqual([{ id: "stripe", name: "Stripe", states: [] }]);
    expect(gatewayOptions({ testConnected: true, liveConnected: false, sandbox: false })[0].states.map((s) => [s.text, s.tone])).toEqual([
      ["Test: ready", "on"],
      ["Live: not set up", "off"]
    ]);
    expect(gatewayOptions({ testConnected: false, liveConnected: true, sandbox: true })[0].states.map((s) => s.text)).toEqual(["Test: not set up yet", "Live: not in this org"]);
  });

  it("takes three-letter codes forms can charge in", () => {
    expect(currencyOf(" gbp ")).toBe("GBP");
    expect(currencyOf("BHD")).toBeNull();
    expect(currencyOf("dollars")).toBeNull();
  });

  it("converts amounts to the smallest unit without rounding errors", () => {
    expect(toMinor(12.5, "USD")).toBe(1250);
    expect(toMinor("0.29", "USD")).toBe(29);
    expect(toMinor("1,250.00", "USD")).toBe(125000);
    expect(toMinor("19.990", "USD")).toBe(1999);
    expect(toMinor("19.999", "USD")).toBeNull();
    expect(toMinor(5000, "JPY")).toBe(5000);
    expect(toMinor("5000.5", "JPY")).toBeNull();
    expect(toMinor("-5", "USD")).toBeNull();
    expect(toMinor("ten", "USD")).toBeNull();
  });

  it("formats money for the currency, short on the button", () => {
    expect(formatMoney(4500, "USD")).toBe("$45.00");
    expect(formatMoney(4500, "USD", true)).toBe("$45");
    expect(formatMoney(4550, "USD", true)).toBe("$45.50");
    expect(formatMoney(5000, "JPY")).toBe("¥5,000");
    expect(formatMajor(12.5, "usd")).toBe("$12.50");
  });

  it("charges a fixed amount, named after the item or the form", () => {
    const q = quote(form({ pricing: "fixed", amount: 45, item: "Workshop ticket" }));
    expect(q).toMatchObject({ currency: "USD", amount: 4500, problem: null, pricing: "fixed" });
    expect(q.lines).toEqual([{ name: "Workshop ticket", detail: "", quantity: 1, unitAmount: 4500, amount: 4500 }]);
    expect(quote(form({ pricing: "fixed", amount: 45 })).lines[0].name).toBe("Book the workshop");
  });

  it("charges the price of each choice picked", () => {
    const def = form({ pricing: "choice", source: "extras", prices: [{ value: "lunch", amount: 12.5 }, { value: "notes", amount: "5" }, { value: "x", amount: 0 }] });
    expect(quote(def, {}).amount).toBe(0);
    const q = quote(def, { extras: "lunch;notes" });
    expect(q.amount).toBe(1750);
    expect(q.lines.map((l) => l.detail)).toEqual(["Lunch", "Notes"]);
    expect(quote(def, { extras: ["notes"] }).amount).toBe(500);
    expect(quote(def, { extras: "lunch" }, { extras: false }).amount).toBe(0);
    // a tampered answer repeating a value is charged once, as the server charges it
    expect(quote(def, { extras: ["notes", "notes"] }).amount).toBe(500);
    expect(quote(def, { extras: "lunch; notes; lunch" }).lines.map((l) => l.detail)).toEqual(["Lunch", "Notes"]);
  });

  it("prices one answer for a single-choice source", () => {
    const def = form({ pricing: "choice", source: "session", prices: [{ value: "6pm", amount: 20 }, { value: "8pm", amount: 30 }] });
    expect(quote(def, { session: "8pm" }).amount).toBe(3000);
    expect(quote(def, { session: "6pm;8pm" }).amount).toBe(0);
    const q = quote(def, { session: ["6pm", "8pm", "6pm"] });
    expect(q.amount).toBe(2000);
    expect(q.lines.map((l) => l.detail)).toEqual(["6pm session"]);
  });

  it("multiplies the unit price by a whole quantity", () => {
    const def = form({ pricing: "quantity", source: "seats", unitPrice: 20 });
    expect(quote(def, { seats: 3 })).toMatchObject({ amount: 6000, problem: null });
    expect(quote(def, { seats: 3 }).lines[0]).toMatchObject({ quantity: 3, unitAmount: 2000 });
    expect(quote(def, { seats: "2.5" })).toMatchObject({ amount: 0, problem: "Enter a whole number for Seats." });
    expect(quote(def, { seats: 1001 }).problem).toBe("Seats can be at most 1000.");
    expect(quote(def, { seats: "" })).toMatchObject({ amount: 0, problem: null });
  });

  it("takes the amount the respondent enters, at or above the minimum", () => {
    const def = form({ pricing: "custom", minimum: 5 });
    expect(quote(def, {})).toMatchObject({ amount: 0, problem: null });
    expect(quote(def, { pay: "12.50" })).toMatchObject({ amount: 1250, problem: null });
    expect(quote(def, { pay: "2" }).problem).toBe("The amount must be at least $5.00.");
    expect(customAmountProblem("", def.sections[0].fields[3], "USD")).toBe("Enter the amount you want to pay.");
    expect(customAmountProblem("abc", def.sections[0].fields[3], "USD")).toBe("Enter the amount you want to pay as a number, such as 25 or 12.50.");
    expect(customAmountProblem("12.345", def.sections[0].fields[3], "USD")).toBe("Enter the amount with at most two decimals.");
    expect(customAmountProblem("500.5", { config: {} }, "JPY")).toBe("Enter the amount as a whole number.");
  });

  it("charges nothing when a rule hides the block, and refuses totals Stripe can't take", () => {
    expect(quote(form({ pricing: "fixed", amount: 45 }), {}, { pay: false })).toBeNull();
    expect(quote({ sections: [] })).toBeNull();
    expect(quote(form({ pricing: "quantity", source: "seats", unitPrice: 999999 }), { seats: 1000 }).problem).toBe(
      "The total is more than this form can take in one payment."
    );
  });

  it("shows the respondent the lines and the total so far", () => {
    const def = form({ pricing: "quantity", source: "seats", unitPrice: 20, item: "Seat" });
    const empty = paymentView(def, {});
    expect(empty).toMatchObject({ test: true, custom: false, lines: [], totalText: "$0.00", note: "The price follows your answer to Seats." });
    expect(empty).toMatchObject({ rules: false, gateway: "stripe", gatewayName: "Stripe", testText: "Test payments. Use a Stripe test card. No money is charged." });
    const view = paymentView(def, { seats: 2 });
    expect(view.lines).toEqual([{ key: "l0", name: "Seat", detail: "2 × $20.00", amountText: "$40.00", cls: "jf-payment-line" }]);
    expect(view).toMatchObject({ amount: 4000, totalText: "$40.00", note: "" });
    expect(paymentView(form({ pricing: "custom", minimum: 5 }), {}, {}, false).minimumText).toBe("At least $5.00");
  });

  it("reads who defines the promotion codes, and takes the discount off like the server", () => {
    expect(CODE_KINDS.map((k) => k.value)).toEqual(["none", "jform", "gateway"]);
    expect(codesOf("JForm")).toBe("jform");
    expect(codesOf("paypal")).toBe("none");
    expect(codesOf(undefined)).toBe("none");
    expect(paymentSettings({ payments: { codes: "gateway" } }).codes).toBe("gateway");
    expect(CODE_REFUSED).toBe("This code isn't valid. Check it and try again.");
    // a percent rounds half up to the smallest unit; an amount is capped at the subtotal
    expect(discountOf(4000, { discountType: "Percent", percentOff: 10 })).toBe(400);
    expect(discountOf(1005, { discountType: "Percent", percentOff: 12.5 })).toBe(126);
    expect(discountOf(4000, { discountType: "Amount", amountOff: 1000 })).toBe(1000);
    expect(discountOf(500, { discountType: "Amount", amountOff: 1000 })).toBe(500);
    expect(discountOf(0, { discountType: "Percent", percentOff: 10 })).toBe(0);
    expect(discountOf(4000, null)).toBe(0);
    // a total below the minimum charge the server sent is raised to it; free stays free
    const usd = { minimumCharge: 50 };
    expect(discountOf(1000, { discountType: "Percent", percentOff: 96, ...usd })).toBe(950);
    expect(discountOf(1000, { discountType: "Percent", percentOff: 100, ...usd })).toBe(1000);
    expect(discountOf(30, { discountType: "Percent", percentOff: 50, ...usd })).toBe(0);
    expect(discountOf(1000, { discountType: "Amount", amountOff: 980, minimumCharge: 50 })).toBe(950);
  });

  it("prices the block with the applied code, and shows the discount as its own line", () => {
    const def = form({ pricing: "quantity", source: "seats", unitPrice: 20, item: "Seat" }, {}, { codes: "jform" });
    const code = { code: "SAVE10", discountType: "Percent", percentOff: 10 };
    expect(quote(def, { seats: 2 }, {}, code)).toMatchObject({ subtotal: 4000, discount: 400, amount: 3600, code: "SAVE10" });
    expect(quote(def, { seats: 2 })).toMatchObject({ subtotal: 4000, discount: 0, amount: 4000, code: "" });
    const view = paymentView(def, { seats: 2 }, {}, false, code);
    expect(view).toMatchObject({ codes: "jform", showCodeBox: true, gatewayCodesText: "", codeApplied: "SAVE10", discountText: "−$4.00", amount: 3600, totalText: "$36.00" });
    expect(view.lines[1]).toEqual({ key: "discount", name: "Code SAVE10", detail: "", amountText: "−$4.00", cls: "jf-payment-line jf-payment-line-discount" });
    // a code worth more than the subtotal takes the total to zero
    expect(quote(def, { seats: 1 }, {}, { code: "FREE", discountType: "Amount", amountOff: 9000 })).toMatchObject({ discount: 2000, amount: 0 });
    // nothing to discount yet: no discount line, no applied code
    expect(paymentView(def, {}, {}, false, code)).toMatchObject({ codeApplied: "", discountText: "", lines: [] });
  });

  it("points gateway codes at the gateway's page, and keeps codes off pay-what-you-want pricing", () => {
    const gateway = paymentView(form({ pricing: "fixed", amount: 45 }, {}, { codes: "gateway" }), {});
    expect(gateway).toMatchObject({ codes: "gateway", showCodeBox: false, gatewayCodesText: "Have a promotion code? Enter it on Stripe's payment page." });
    const custom = paymentView(form({ pricing: "custom", minimum: 5 }, {}, { codes: "jform" }), { pay: "20" }, {}, false, { code: "SAVE10", discountType: "Percent", percentOff: 10 });
    expect(custom).toMatchObject({ showCodeBox: false, gatewayCodesText: "", codeApplied: "", amount: 2000 });
    expect(paymentView(form({ pricing: "fixed", amount: 45 }), {})).toMatchObject({ codes: "none", showCodeBox: false, gatewayCodesText: "" });
  });

  it("shows the builder each rule on the canvas", () => {
    const choice = paymentView(form({ pricing: "choice", source: "session", prices: [{ value: "6pm", amount: 20 }] }, {}, { mode: "live" }), {}, {}, true);
    expect(choice).toMatchObject({ test: false, rules: true, gateway: "stripe", modeLabel: "Live" });
    expect(choice.lines.map((l) => [l.name, l.amountText])).toEqual([
      ["6pm session", "$20.00"],
      ["8pm session", "Free"]
    ]);
    expect(choice.note).toBe("Book the workshop: the price follows the answer to Session.");
    expect(paymentView(form({ pricing: "choice" }), {}, {}, true).note).toBe("Choose the choice field the prices follow.");
    expect(paymentView(form({ pricing: "quantity", unitPrice: 20 }), {}, {}, true)).toMatchObject({ note: "Choose the number field that holds the quantity." });
    expect(paymentView(form({ pricing: "quantity", source: "seats", unitPrice: 20 }), {}, {}, true).lines[0]).toMatchObject({ detail: "× Seats", amountText: "$20.00 each" });
    expect(paymentView(form({ pricing: "fixed", amount: 45 }), {}, {}, true)).toMatchObject({ totalText: "$45.00", amount: 4500 });
    expect(paymentView(form({ pricing: "custom" }), {}, {}, true).note).toBe("Book the workshop: the respondent enters the amount.");
  });
});
