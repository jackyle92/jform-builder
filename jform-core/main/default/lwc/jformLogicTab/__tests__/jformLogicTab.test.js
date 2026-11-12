import { createElement } from "lwc";
import JformLogicTab, { opWord, operatorsFor, answersFor } from "c/jformLogicTab";

const rule = (action, match, conditions) => ({ action, match, conditions });
function form() {
  return {
    sections: [
      {
        key: "p1", name: "Page 1", label: "About you",
        fields: [
          { key: "gender", type: "radio", label: "Gender", options: [{ label: "Female", value: "Female" }, { label: "Male", value: "Male" }] },
          { key: "age", type: "number", label: "Age" },
          { key: "due", type: "date", label: "Due date", conditionalLogic: rule("show", "all", [{ field: "gender", operator: "equals", value: "Female" }]) },
          { key: "intro", type: "heading", label: "Welcome" },
          { key: "consent", type: "consent", label: "I agree" },
          { key: "topics", type: "checkboxes", label: "Topics", options: [{ label: "Swim" }, { label: "Run" }] }
        ]
      },
      {
        key: "p2", name: "Page 2", label: "Medical",
        conditionalLogic: rule("hide", "any", [{ field: "age", operator: "less_than", value: "18" }]),
        fields: [
          { key: "doctor", type: "text", label: "Doctor", conditionalLogic: rule("require", "all", [{ field: "age", operator: "greater_than", value: "65" }]) },
          { key: "later", type: "text", label: "Later answer" }
        ]
      }
    ]
  };
}
function mount(def = form(), addressLists = null) {
  const el = createElement("c-jform-logic-tab", { is: JformLogicTab });
  el.definition = def;
  el.addressLists = addressLists;
  document.body.appendChild(el);
  return el;
}
const flush = () => Promise.resolve();
const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const text = (n) => n.textContent.replace(/\s+/g, " ").trim();
/** The visible tokens of a line, which sit side by side without spaces. */
const words = (n) => [...n.children].map(text).filter(Boolean).join(" ");
const byAlt = (root, alt) => [...root.querySelectorAll("lightning-button-icon")].filter((b) => b.alternativeText === alt);
const card = (el, key) => $(el, `.lg-card[data-key="${key}"]`);
const button = (el, action) => $(el, `lightning-button[data-action="${action}"]`);
const change = (node, value) => node.dispatchEvent(new CustomEvent("change", { detail: { value } }));
const lastRule = (handler) => handler.mock.calls[handler.mock.calls.length - 1][0].detail;

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-logic-tab words", () => {
  it("words operators and offers answers by question type", () => {
    expect(opWord("equals", "consent")).toBe("is checked");
    expect(opWord("equals", "checkboxes")).toBe("includes");
    expect(opWord("is_not_empty", "text")).toBe("is answered");
    expect(operatorsFor("number")).toContain("greater_than");
    expect(operatorsFor("text")).toContain("contains");
    expect(operatorsFor("radio")).not.toContain("contains");
    expect(answersFor({ type: "yesno" }).map((o) => o.value)).toEqual(["Yes", "No"]);
    expect(answersFor({ type: "nps" })).toHaveLength(11);
    expect(answersFor({ type: "text" })).toBeNull();
  });
});

describe("c-jform-logic-tab list", () => {
  it("shows rules as sentences grouped by the page they act on", async () => {
    const el = mount();
    await flush();
    expect(text($(el, ".lg-summary"))).toBe("3 rules: 2 questions and 1 page react to answers");
    expect($$(el, ".lg-group-title").map(text)).toEqual(["Page 1About you", "Page 2Medical"]);
    const due = card(el, "due");
    expect(words(due.querySelector(".lg-line"))).toBe("When Gender is Female");
    expect(words(due.querySelector(".lg-then"))).toBe("→ Show Due date");
    expect(text(due.querySelector(".slds-assistive-text"))).toBe("When Gender is Female, show Due date.");
    expect(due.querySelector(".lg-action").className).toContain("lg-action-show");
    expect(words(card(el, "p2").querySelector(".lg-line"))).toBe("When Age is less than 18");
    expect(words(card(el, "p2").querySelector(".lg-then"))).toBe("→ Hide Page 2 · Medical");
    expect(words(card(el, "doctor").querySelector(".lg-then"))).toBe("→ Require Doctor");
    expect($(el, ".lg-issue")).toBeNull();
  });

  it("filters the rules with the search box", async () => {
    const el = mount();
    await flush();
    const search = $(el, ".lg-search");
    search.value = "doctor";
    search.dispatchEvent(new CustomEvent("change"));
    await flush();
    expect($$(el, ".lg-card").map((c) => c.dataset.key)).toEqual(["doctor"]);
    search.value = "nothing like it";
    search.dispatchEvent(new CustomEvent("change"));
    await flush();
    expect(text($(el, ".lg-nomatch"))).toBe('No rule mentions "nothing like it".');
  });

  it("flags answers that come later and questions that were removed", async () => {
    const def = form();
    def.sections[0].fields[2].conditionalLogic = rule("show", "all", [{ field: "later", operator: "is_not_empty" }]);
    def.sections[1].fields[0].conditionalLogic = rule("show", "all", [{ field: "gone", operator: "equals", value: "x" }]);
    def.sections[1].conditionalLogic = rule("show", "all", [{ field: "gender", operator: "equals", value: "Other" }]);
    const el = mount(def);
    await flush();
    expect(text(card(el, "due").querySelector(".lg-issue"))).toBe("Later answer comes later in the form, so it is answered after");
    expect(card(el, "due").classList.contains("lg-card-issue")).toBe(true);
    expect(text(card(el, "doctor").querySelector(".lg-issue"))).toBe("Uses a question that was removed");
    expect(card(el, "doctor").querySelector(".lg-chip-gone")).not.toBeNull();
    expect(text(card(el, "p2").querySelector(".lg-issue"))).toBe('"Other" is no longer an answer to Gender');
    expect(text($(el, ".lg-summary-issue"))).toBe("3 to check");
  });

  it("deletes a rule, or copies it to another question", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await flush();
    byAlt(card(el, "doctor"), "Delete rule")[0].click();
    expect(lastRule(handler)).toEqual({ kind: "field", key: "doctor", rule: null });

    byAlt(card(el, "due"), "Copy to another question")[0].click();
    await flush();
    expect(text($(el, ".lg-ed-title"))).toBe("New rule");
    expect($(el, 'c-jform-value-picker[data-role="target"]').value).toBe("");
    expect($(el, ".lg-cond c-jform-value-picker").value).toBe("gender");
  });
});

describe("c-jform-logic-tab editor", () => {
  it("edits a rule with answers that fit the question and saves it", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await flush();
    card(el, "due").click();
    await flush();
    expect(card(el, "due").getAttribute("aria-pressed")).toBe("true");
    expect(text($(el, ".lg-ed-title"))).toBe("Edit rule");
    expect(text($(el, ".lg-preview"))).toBe("When Gender is Female, show Due date.");
    const [comparison, answer] = $$(el, ".lg-cond lightning-combobox");
    expect(comparison.options.map((o) => o.label)).toEqual(["is", "is not", "is answered", "is not answered"]);
    expect(answer.options).toEqual([{ label: "Female", value: "Female" }, { label: "Male", value: "Male" }]);
    change(answer, "Male");
    await flush();
    expect(text($(el, ".lg-preview"))).toBe("When Gender is Male, show Due date.");
    button(el, "save").click();
    expect(lastRule(handler)).toEqual({ kind: "field", key: "due", rule: { action: "show", match: "all", conditions: [{ field: "gender", operator: "equals", value: "Male" }] } });
    await flush();
    expect($(el, ".lg-editor")).toBeNull();
  });

  it("moves a rule to another question in one change", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await flush();
    card(el, "due").click();
    await flush();
    change($(el, 'c-jform-value-picker[data-role="target"]'), "field:later");
    await flush();
    button(el, "save").click();
    expect(lastRule(handler)).toMatchObject({ kind: "field", key: "later", from: { kind: "field", key: "due" } });
  });

  it("checks a new rule before saving and warns when it replaces another", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await flush();
    button(el, "new").click();
    await flush();
    button(el, "save").click();
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(text($(el, ".lg-ed-section .lg-error"))).toBe("Choose or type an answer.");
    expect($$(el, ".lg-error").map(text)).toContain("Choose what this rule shows, hides or requires.");

    change($(el, 'c-jform-value-picker[data-role="target"]'), "field:doctor");
    await flush();
    expect(text($(el, ".lg-notes"))).toContain("Doctor already has a rule. Saving replaces it.");
    change($(el, 'c-jform-value-picker[data-role="target"]'), "field:later");
    change($$(el, ".lg-cond lightning-combobox")[1], "Female");
    await flush();
    button(el, "save").click();
    expect(lastRule(handler)).toEqual({ kind: "field", key: "later", rule: { action: "show", match: "all", conditions: [{ field: "gender", operator: "equals", value: "Female" }] } });
  });

  it("fits the comparison to the question: checkboxes include, consent is checked", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await flush();
    card(el, "due").click();
    await flush();
    const question = $(el, ".lg-cond c-jform-value-picker");
    change(question, "topics");
    await flush();
    expect($$(el, ".lg-cond lightning-combobox")[0].options.map((o) => o.label)).toEqual(["includes", "does not include", "is answered", "is not answered"]);
    change(question, "consent");
    await flush();
    expect($$(el, ".lg-cond lightning-combobox")[0].options.map((o) => o.label)).toEqual(["is checked", "is not checked"]);
    expect($$(el, ".lg-cond lightning-combobox")).toHaveLength(1);
    expect($(el, ".lg-cond lightning-input")).toBeNull();
    button(el, "save").click();
    expect(lastRule(handler).rule.conditions).toEqual([{ field: "consent", operator: "equals", value: "true" }]);
  });

  it("joins conditions with all or any, and removes them", async () => {
    const el = mount();
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await flush();
    card(el, "due").click();
    await flush();
    expect($(el, ".lg-match")).toBeNull();
    button(el, "add-condition").click();
    await flush();
    expect($(el, ".lg-match")).not.toBeNull();
    expect(text($(el, ".lg-join-pill"))).toBe("and");
    change($(el, ".lg-match"), "any");
    await flush();
    expect(text($(el, ".lg-join-pill"))).toBe("or");
    byAlt(el.shadowRoot, "Remove condition")[1].click();
    await flush();
    expect($$(el, ".lg-cond")).toHaveLength(1);
  });

  it("offers Require only for questions, not pages, layout blocks or the Payment block", async () => {
    const def = form();
    def.sections[1].fields.push({ key: "pay", type: "payment", label: "Payment", config: { pricing: "fixed", amount: 10 } });
    const el = mount(def);
    await flush();
    card(el, "doctor").click();
    await flush();
    expect($(el, ".lg-actions").options.map((o) => o.value)).toEqual(["show", "hide", "require"]);
    change($(el, 'c-jform-value-picker[data-role="target"]'), "page:p1");
    await flush();
    expect($(el, ".lg-actions").options.map((o) => o.value)).toEqual(["show", "hide"]);
    expect($(el, ".lg-actions").value).toBe("show");
    change($(el, 'c-jform-value-picker[data-role="target"]'), "field:intro");
    await flush();
    expect($(el, ".lg-actions").options.map((o) => o.value)).toEqual(["show", "hide"]);
    // a Payment block is never optional: its price decides whether there is anything to pay
    change($(el, 'c-jform-value-picker[data-role="target"]'), "field:doctor");
    await flush();
    change($(el, ".lg-actions"), "require");
    await flush();
    expect($(el, ".lg-actions").value).toBe("require");
    change($(el, 'c-jform-value-picker[data-role="target"]'), "field:pay");
    await flush();
    expect($(el, ".lg-actions").options.map((o) => o.value)).toEqual(["show", "hide"]);
    expect($(el, ".lg-actions").value).toBe("show");
  });

  it("asks before dropping unsaved changes when another rule is opened", async () => {
    const el = mount();
    await flush();
    card(el, "due").click();
    await flush();
    change($$(el, ".lg-cond lightning-combobox")[1], "Male");
    await flush();
    card(el, "doctor").click();
    await flush();
    expect($(el, ".lg-confirm")).not.toBeNull();
    button(el, "keep").click();
    await flush();
    expect($(el, ".lg-confirm")).toBeNull();
    expect(text($(el, ".lg-preview"))).toContain("Gender is Male");
    card(el, "doctor").click();
    await flush();
    button(el, "discard").click();
    await flush();
    expect(text($(el, ".lg-preview"))).toBe("When Age is more than 65, require Doctor.");
  });

  it("opens the rule of a field asked for from elsewhere, or a new one for it", async () => {
    const el = mount();
    await flush();
    el.focus = { kind: "field", key: "doctor", at: 1 };
    await flush();
    expect(text($(el, ".lg-ed-title"))).toBe("Edit rule");
    expect(text($(el, ".lg-preview"))).toBe("When Age is more than 65, require Doctor.");
    button(el, "cancel").click();
    await flush();
    el.focus = { kind: "field", key: "later", at: 2 };
    await flush();
    expect(text($(el, ".lg-ed-title"))).toBe("New rule");
    expect($(el, 'c-jform-value-picker[data-role="target"]').value).toBe("field:later");
  });
});

describe("c-jform-logic-tab try your rules", () => {
  it("shows what a respondent gets for sample answers", async () => {
    const el = mount();
    await flush();
    const results = () => Object.fromEntries($$(el, ".lg-result").map((r) => [text(r.querySelector(".lg-result-label")), text(r.querySelector(".lg-state"))]));
    expect($$(el, ".lg-trial-input").map((n) => n.querySelector("[data-key]").dataset.key)).toEqual(["gender", "age"]);
    expect(results()).toEqual({ "Due date": "Hidden", "Page 2 · Medical": "Shown", Doctor: "Optional" });

    change($(el, '[data-key="gender"]'), "Female");
    const age = $(el, '[data-key="age"]');
    age.value = "70";
    age.dispatchEvent(new CustomEvent("change", { detail: { value: "70" } }));
    await flush();
    expect(results()).toEqual({ "Due date": "Shown", "Page 2 · Medical": "Shown", Doctor: "Required" });

    age.dispatchEvent(new CustomEvent("change", { detail: { value: "10" } }));
    await flush();
    expect(results()).toEqual({ "Due date": "Shown", "Page 2 · Medical": "Skipped", Doctor: "Page skipped" });

    button(el, "clear-trial").click();
    await flush();
    expect(results()["Due date"]).toBe("Hidden");
  });
});

describe("c-jform-logic-tab empty", () => {
  it("starts from an example rule", async () => {
    const def = form();
    delete def.sections[0].fields[2].conditionalLogic;
    delete def.sections[1].conditionalLogic;
    delete def.sections[1].fields[0].conditionalLogic;
    const el = mount(def);
    await flush();
    expect($$(el, ".lg-recipe")).toHaveLength(3);
    expect($(el, ".lg-guide")).not.toBeNull();
    $(el, '.lg-recipe[data-id="skip_page"]').click();
    await flush();
    expect($(el, 'c-jform-value-picker[data-role="target"]').value).toBe("page:p2");
    expect($(el, ".lg-actions").value).toBe("hide");
  });

  it("sends people to the Build tab when there is nothing to test", async () => {
    const el = mount({ sections: [{ key: "p1", name: "Page 1", fields: [{ key: "intro", type: "heading", label: "Hi" }] }] });
    const handler = jest.fn();
    el.addEventListener("gotab", handler);
    await flush();
    expect(text($(el, ".lg-empty .lg-h3"))).toBe("Add questions first");
    expect(button(el, "new")).toBeNull();
    button(el, "build").click();
    expect(handler.mock.calls[0][0].detail).toEqual({ tab: "build" });
  });
});

describe("c-jform-logic-tab table rows", () => {
  function withTable() {
    const def = form();
    def.sections[0].fields.push({
      key: "satisfaction",
      type: "table",
      label: "How satisfied",
      options: [{ label: "Poor", value: "Poor" }, { label: "Good", value: "Good" }],
      config: { rows: [{ key: "service", label: "Service" }, { key: "price", label: "Price" }] }
    });
    return def;
  }

  it("offers each row as a question with the columns as answers, and saves the row's key", async () => {
    const el = mount(withTable());
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await flush();
    card(el, "due").click();
    await flush();
    const question = $(el, ".lg-cond c-jform-value-picker");
    const rows = question.options.filter((o) => o.value.startsWith("satisfaction"));
    expect(rows.map((o) => [o.value, o.label, o.detail])).toEqual([
      ["satisfaction.service", "How satisfied: Service", "Table row"],
      ["satisfaction.price", "How satisfied: Price", "Table row"]
    ]);
    change(question, "satisfaction.price");
    await flush();
    const answer = $$(el, ".lg-cond lightning-combobox")[1];
    expect(answer.options.map((o) => o.value)).toEqual(["Poor", "Good"]);
    change(answer, "Poor");
    await flush();
    button(el, "save").click();
    expect(lastRule(handler).rule.conditions).toEqual([{ field: "satisfaction.price", operator: "equals", value: "Poor" }]);
  });

  it("names the row in the rule's sentence", async () => {
    const def = withTable();
    def.sections[1].fields[1].conditionalLogic = rule("show", "all", [{ field: "satisfaction.price", operator: "equals", value: "Poor" }]);
    const el = mount(def);
    await flush();
    expect(text(card(el, "later"))).toContain("How satisfied: Price");
    expect(text(card(el, "later"))).not.toContain("removed");
  });
});

describe("c-jform-logic-tab address parts", () => {
  const LISTS = {
    fromOrg: true,
    countries: [
      { code: "AU", name: "Australia", states: [{ code: "NSW", name: "New South Wales" }, { code: "WA", name: "Western Australia" }] },
      { code: "US", name: "United States", states: [{ code: "WA", name: "Washington" }] },
      { code: "NZ", name: "New Zealand", states: [] }
    ]
  };
  function withAddress(config = {}) {
    const def = form();
    def.sections[0].fields.push({ key: "home", type: "address", label: "Home", config });
    return def;
  }
  const answerFor = async (el, part) => {
    change($(el, ".lg-cond c-jform-value-picker"), `home.${part}`);
    await flush();
    return $$(el, ".lg-cond lightning-combobox")[1] || null;
  };
  const settle = async () => {
    await flush();
    await flush();
  };

  it("chooses the country by the name answers hold, from the countries the field offers", async () => {
    const el = mount(withAddress({ countries: ["AU", "NZ"] }), LISTS);
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await settle();
    card(el, "due").click();
    await flush();
    const answer = await answerFor(el, "country");
    expect(answer.options.map((o) => o.value)).toEqual(["Australia", "New Zealand"]);
    change(answer, "Australia");
    await flush();
    button(el, "save").click();
    expect(lastRule(handler).rule.conditions).toEqual([{ field: "home.country", operator: "equals", value: "Australia" }]);
  });

  it("lists the states of the offered countries, named by country when there are several", async () => {
    const el = mount(withAddress(), LISTS);
    await settle();
    card(el, "due").click();
    await flush();
    const answer = await answerFor(el, "state");
    expect(answer.options.map((o) => [o.label, o.value])).toEqual([
      ["New South Wales (Australia)", "New South Wales"],
      ["Western Australia (Australia)", "Western Australia"],
      ["Washington (United States)", "Washington"]
    ]);
  });

  it("keeps the state typed where the offered countries list none", async () => {
    const el = mount(withAddress({ countries: ["NZ"] }), LISTS);
    await settle();
    card(el, "due").click();
    await flush();
    expect(await answerFor(el, "state")).toBeNull();
    expect($(el, ".lg-cond lightning-input")).not.toBeNull();
  });

  it("tests part of the country with contains in a text box", async () => {
    const el = mount(withAddress(), LISTS);
    const handler = jest.fn();
    el.addEventListener("rulechange", handler);
    await settle();
    card(el, "due").click();
    await flush();
    await answerFor(el, "country");
    const operator = () => $$(el, ".lg-cond lightning-combobox")[0];
    change(operator(), "contains");
    await flush();
    expect($$(el, ".lg-cond lightning-combobox")).toHaveLength(1);
    change(operator(), "equals");
    await flush();
    expect($$(el, ".lg-cond lightning-combobox")[1].options.map((o) => o.value)).toContain("Australia");

    change(operator(), "contains");
    await flush();
    const typed = $(el, ".lg-cond lightning-input");
    typed.value = "United";
    typed.dispatchEvent(new CustomEvent("change", { detail: { value: "United" } }));
    await flush();
    button(el, "save").click();
    expect(lastRule(handler).rule.conditions).toEqual([{ field: "home.country", operator: "contains", value: "United" }]);
  });

  it("does not flag a contains rule on the country", async () => {
    const def = withAddress();
    def.sections[1].fields[1].conditionalLogic = rule("show", "all", [{ field: "home.country", operator: "contains", value: "United" }]);
    const el = mount(def, LISTS);
    await settle();
    expect(card(el, "later").querySelector(".lg-issue")).toBeNull();
  });

  it("flags a rule that tests the country by its code", async () => {
    const def = withAddress();
    def.sections[1].fields[1].conditionalLogic = rule("show", "all", [{ field: "home.country", operator: "equals", value: "AU" }]);
    const el = mount(def, LISTS);
    await settle();
    expect(text(card(el, "later").querySelector(".lg-issue"))).toBe('"AU" is no longer an answer to Home: Country');
  });
});

describe("c-jform-logic-tab Other choice", () => {
  function withOther() {
    const def = form();
    def.sections[0].fields[0].config = { other: { label: "Something else" } };
    return def;
  }

  it("offers Other as an answer, stored as Other whatever it is called", () => {
    const gender = withOther().sections[0].fields[0];
    expect(answersFor(gender)).toEqual([
      { label: "Female", value: "Female" },
      { label: "Male", value: "Male" },
      { label: "Something else", value: "Other" }
    ]);
  });

  it("offers the text typed under Other as a question of its own", async () => {
    const el = mount(withOther());
    await flush();
    card(el, "due").click();
    await flush();
    const question = $(el, ".lg-cond c-jform-value-picker");
    const other = question.options.find((o) => o.value === "gender.other");
    expect([other.label, other.detail]).toEqual(["Gender: Something else", "Other text"]);
  });
});
