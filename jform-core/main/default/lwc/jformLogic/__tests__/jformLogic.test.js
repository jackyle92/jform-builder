import { evaluate, matches, testCondition, describeRule, answerFor } from "c/jformLogic";

const cond = (field, operator, value) => ({ field, operator, value });

// Same fixture as JFormTestDataFactory.sampleDefinition
const definition = {
  sections: [
    {
      key: "contact",
      fields: [
        { key: "intro", type: "richtext" },
        { key: "first_name", type: "text", required: true },
        { key: "email", type: "email", required: false, conditionalLogic: { action: "require", match: "all", conditions: [cond("nps", "less_than", "7")] } }
      ]
    },
    {
      key: "survey",
      conditionalLogic: { action: "hide", match: "all", conditions: [cond("first_name", "equals", "skip")] },
      fields: [
        { key: "season", type: "picklist", required: true },
        { key: "why_summer", type: "comment", required: true, conditionalLogic: { action: "show", match: "all", conditions: [cond("season", "equals", "Summer")] } },
        { key: "nps", type: "nps" }
      ]
    }
  ]
};

describe("testCondition", () => {
  it("compares case-insensitively and treats lists as 'contains element'", () => {
    expect(testCondition(cond("a", "equals", "summer"), "Summer")).toBe(true);
    expect(testCondition(cond("a", "equals", "Summer"), "Autumn")).toBe(false);
    expect(testCondition(cond("a", "equals", "Vegan"), ["None", "Vegan"])).toBe(true);
    expect(testCondition(cond("a", "not_equals", "Summer"), "Autumn")).toBe(true);
    expect(testCondition(cond("a", "not_equals", "Summer"), null)).toBe(true);
    expect(testCondition(cond("a", "contains", "sum"), "Summer")).toBe(true);
    expect(testCondition(cond("a", "contains", "x"), "Summer")).toBe(false);
  });

  it("handles empty checks and numbers", () => {
    expect(testCondition(cond("a", "is_empty"), "")).toBe(true);
    expect(testCondition(cond("a", "is_empty"), [])).toBe(true);
    expect(testCondition(cond("a", "is_empty"), "x")).toBe(false);
    expect(testCondition(cond("a", "is_not_empty"), "x")).toBe(true);
    expect(testCondition(cond("a", "greater_than", "5"), 9)).toBe(true);
    expect(testCondition(cond("a", "greater_than", "5"), "9")).toBe(true);
    expect(testCondition(cond("a", "greater_than", "5"), "3")).toBe(false);
    expect(testCondition(cond("a", "less_than", "5"), 3)).toBe(true);
    expect(testCondition(cond("a", "less_than", "5"), "abc")).toBe(false);
    expect(testCondition(cond("a", "equals", "true"), true)).toBe(true);
  });
});

describe("matches", () => {
  const conditions = [cond("a", "equals", "1"), cond("b", "equals", "2")];
  it("all / any", () => {
    expect(matches({ action: "show", match: "all", conditions }, { a: "1", b: "2" })).toBe(true);
    expect(matches({ action: "show", match: "all", conditions }, { a: "1", b: "3" })).toBe(false);
    expect(matches({ action: "show", match: "any", conditions }, { a: "1", b: "3" })).toBe(true);
    expect(matches({ action: "show", match: "any", conditions }, { a: "0", b: "3" })).toBe(false);
    expect(matches(null, {})).toBe(true);
  });
});

describe("evaluate", () => {
  it("applies show and require rules", () => {
    const r = evaluate(definition, { season: "Summer", nps: 4 });
    expect(r.visible.why_summer).toBe(true);
    expect(r.required.why_summer).toBe(true);
    expect(r.required.email).toBe(true);
    expect(r.visible.intro).toBe(true);
  });

  it("hides and un-requires when rules do not match", () => {
    const r = evaluate(definition, { season: "autumn", nps: 9 });
    expect(r.visible.why_summer).toBe(false);
    expect(r.required.why_summer).toBe(false);
    expect(r.required.email).toBe(false);
  });

  it("hides every field of a hidden page", () => {
    const r = evaluate(definition, { first_name: "skip", season: "Summer" });
    expect(r.sectionVisible.survey).toBe(false);
    expect(r.visible.season).toBe(false);
    expect(r.visible.why_summer).toBe(false);
    expect(r.visible.first_name).toBe(true);
  });

  it("tolerates missing answers and definitions", () => {
    expect(evaluate(definition, null).visible.first_name).toBe(true);
    expect(evaluate({}, {})).toEqual({ visible: {}, required: {}, sectionVisible: {} });
  });

  it("never requires a Payment block, whatever its flag or rule says", () => {
    const requireRule = { action: "require", match: "all", conditions: [cond("nps", "less_than", "7")] };
    const r = evaluate(
      { sections: [{ key: "p", fields: [{ key: "pay", type: "payment", required: true, conditionalLogic: requireRule }, { key: "note", type: "text", conditionalLogic: requireRule }] }] },
      { nps: 4 }
    );
    expect(r.visible.pay).toBe(true);
    expect(r.required.pay).toBe(false);
    expect(r.required.note).toBe(true);
  });
});

describe("describeRule", () => {
  it("writes a sentence", () => {
    const rule = { action: "show", match: "all", conditions: [cond("season", "equals", "Summer"), cond("nps", "is_not_empty")] };
    expect(describeRule(rule, (k) => ({ season: "Season", nps: "NPS" })[k], "Why summer?")).toBe('Show Why summer? when Season equals "Summer" and NPS is not empty');
  });
});

describe("table rows", () => {
  it("reads a row inside the table's answer, or the row's own answer as the server stores it", () => {
    expect(answerFor({ satisfaction: { price: "Poor" } }, "satisfaction.price")).toBe("Poor");
    expect(answerFor({ "satisfaction.price": "Fair" }, "satisfaction.price")).toBe("Fair");
    expect(answerFor({ satisfaction: { price: "Poor" } }, "satisfaction.speed")).toBeUndefined();
    expect(answerFor({ satisfaction: "x" }, "satisfaction.price")).toBeUndefined();
    expect(answerFor({ name: "Jo" }, "name")).toBe("Jo");
  });

  it("shows a field when one row has a given answer", () => {
    const def = {
      sections: [
        {
          key: "p1",
          fields: [
            { key: "satisfaction", type: "table", config: { rows: [{ key: "price", label: "Price" }] } },
            { key: "why", type: "text", conditionalLogic: { action: "show", match: "all", conditions: [cond("satisfaction.price", "equals", "Poor")] } }
          ]
        }
      ]
    };
    expect(evaluate(def, { satisfaction: { price: "Poor" } }).visible.why).toBe(true);
    expect(evaluate(def, { satisfaction: { price: "Good" } }).visible.why).toBe(false);
    expect(evaluate(def, { "satisfaction.price": "Poor" }).visible.why).toBe(true);
    expect(matches({ conditions: [cond("satisfaction.price", "is_empty")] }, { satisfaction: {} })).toBe(true);
  });
});
