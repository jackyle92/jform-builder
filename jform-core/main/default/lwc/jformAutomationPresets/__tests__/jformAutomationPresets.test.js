import { PRESETS, buildPreset, suggestField, convertLegacy, convertLegacyInPlace, defaultStep, mainStepOf, dropFieldReferences, dropRetypedEmailField, suggestObjectField, renameFieldReferences } from "c/jformAutomationPresets";

const supportFields = [
  { key: "first_name", label: "First name" }, { key: "last_name", label: "Last name" }, { key: "email", label: "Your email" },
  { key: "company", label: "Company" }, { key: "subject", label: "Subject" }, { key: "description", label: "Describe the problem" },
  { key: "priority", label: "Priority", options: [{ label: "Low" }, { label: "Normal" }, { label: "Urgent" }] }
];

describe("jformAutomationPresets", () => {
  it("matches object fields to form fields by key and label", () => {
    expect(suggestField("Email", supportFields).key).toBe("email");
    expect(suggestField("Description", supportFields).key).toBe("description");
    expect(suggestField("LastName", [{ key: "f1", label: "Surname" }]).key).toBe("f1");
    expect(suggestField("Phone", supportFields)).toBeNull();
  });

  it("builds the support case preset with linked steps and an urgent task", () => {
    const steps = buildPreset("support_case", supportFields);
    expect(steps.map((s) => s.key)).toEqual(["account", "contact", "case", "task"]);
    expect(steps[0].match).toEqual({ field: "Name", source: { type: "field", key: "company" } });
    expect(steps[1].fields.find((m) => m.field === "AccountId").source).toEqual({ type: "step", step: "account", path: "Id" });
    const kase = steps[2];
    expect(kase.primary).toBe(true);
    expect(kase.fields.find((m) => m.field === "Subject").source.value).toBe("{{subject}}");
    expect(kase.fields.find((m) => m.field === "AccountId").source).toEqual({ type: "step", step: "contact", path: "AccountId" });
    expect(steps[3].condition.conditions[0]).toEqual({ field: "priority", operator: "equals", value: "Urgent" });
  });

  it("falls back safely when a form lacks fields", () => {
    const steps = buildPreset("lead_capture", [{ key: "name", label: "Name" }, { key: "msg", label: "Message" }]);
    const lead = steps[0];
    expect(lead.action).toBe("create");
    expect(lead.fields.find((m) => m.field === "LastName").source).toEqual({ type: "field", key: "name" });
    expect(lead.fields.find((m) => m.field === "Company").source).toEqual({ type: "value", value: "Unknown" });
    expect(lead.fields.find((m) => m.field === "Description").source).toEqual({ type: "field", key: "msg" });
    expect(buildPreset("support_case", [{ key: "email", label: "Email" }]).map((s) => s.key)).toEqual(["contact", "case"]);
  });

  it("every preset builds valid-looking steps for a typical form", () => {
    for (const p of PRESETS) {
      const steps = p.build(supportFields);
      expect(steps.length).toBeGreaterThan(0);
      const keys = new Set();
      steps.forEach((s, i) => {
        expect(keys.has(s.key)).toBe(false);
        keys.add(s.key);
        expect(["create", "find", "find_or_create", "update"]).toContain(s.action);
        if (s.action !== "create") expect(s.match).toBeTruthy();
        for (const m of s.fields) {
          if (m.source.type === "step") expect([...keys].indexOf(m.source.step)).toBeLessThan(i);
        }
      });
    }
  });

  it("converts a legacy target into one step", () => {
    const def = {
      targetObjectApiName: "Lead",
      settings: { target: { strategy: "update_or_create", matchField: "Email" } },
      sections: [{ fields: [{ key: "email", targetFieldApiName: "Email" }, { key: "last", targetFieldApiName: "LastName" }, { key: "x" }] }]
    };
    const [step] = convertLegacy(def);
    expect(step.action).toBe("find_or_create");
    expect(step.match).toEqual({ field: "Email", source: { type: "field", key: "email" } });
    expect(step.fields).toHaveLength(2);
    expect(convertLegacy({})).toEqual([]);
    expect(convertLegacy({ targetObjectApiName: "Lead", settings: { target: { strategy: "none" } }, sections: [] })).toEqual([]);
  });

  it("builds a default step by name when nothing is mapped, and converts a definition in place", () => {
    const def = { targetObjectApiName: "Lead", settings: { target: { strategy: "create" } }, sections: [{ fields: [{ key: "email", label: "Email", type: "email" }, { key: "name", label: "Your name", type: "text" }] }] };
    const [step] = convertLegacy(def);
    expect(step.action).toBe("find_or_create");
    expect(step.match).toEqual({ field: "Email", source: { type: "field", key: "email" } });
    expect(step.fields.find((m) => m.field === "LastName").source).toEqual({ type: "field", key: "name" });

    expect(convertLegacyInPlace(def)).toBe(false); // a bare object is left for the server to match by name
    const explicit = { ...def, sections: [{ fields: [{ key: "email", label: "Email", type: "email", targetFieldApiName: "Email" }] }] };
    expect(convertLegacyInPlace(explicit)).toBe(true);
    expect(explicit.settings.automation.steps).toHaveLength(1);
    expect(explicit.settings.target).toBeUndefined();
    expect(explicit.sections[0].fields[0].targetFieldApiName).toBeUndefined();
    expect(explicit.targetObjectApiName).toBe("Lead");
    expect(convertLegacyInPlace(explicit)).toBe(false);
    expect(mainStepOf([{ key: "a", action: "find" }, { key: "b", action: "create" }]).key).toBe("b");
    const account = defaultStep("Account", [{ key: "company", label: "Company" }], [{ value: "Name", label: "Account Name", required: true }, { value: "Phone", label: "Phone" }]);
    expect(account.fields).toEqual([{ field: "Name", source: { type: "field", key: "company" } }]);
    expect(account.action).toBe("create");
  });

  it("drops step and rule references when a form field is deleted", () => {
    const def = {
      settings: { automation: { steps: [
        { key: "contact", action: "find_or_create", object: "Contact", match: { field: "Email", source: { type: "field", key: "email" } }, fields: [{ field: "Email", source: { type: "field", key: "email" } }, { field: "LastName", source: { type: "field", key: "last" } }], condition: { match: "all", conditions: [{ field: "email", operator: "is_not_empty" }] } }
      ] } },
      sections: [{ key: "p1", conditionalLogic: { action: "show", match: "all", conditions: [{ field: "email", operator: "is_not_empty" }] }, fields: [
        { key: "email" }, { key: "last", conditionalLogic: { action: "show", match: "any", conditions: [{ field: "email", operator: "is_not_empty" }, { field: "last", operator: "is_empty" }] } }
      ] }]
    };
    dropFieldReferences(def, "email");
    const step = def.settings.automation.steps[0];
    expect(step.fields).toEqual([{ field: "LastName", source: { type: "field", key: "last" } }]);
    expect(step.match).toBeUndefined();
    expect(step.action).toBe("create");
    expect(step.condition).toBeUndefined();
    expect(def.sections[0].conditionalLogic).toBeUndefined();
    expect(def.sections[0].fields[1].conditionalLogic.conditions).toEqual([{ field: "last", operator: "is_empty" }]);
  });
});

describe("mapping by label and renaming keys", () => {
  const LEAD = [
    { label: "Last Name", value: "LastName" },
    { label: "Company", value: "Company" },
    { label: "Email", value: "Email" },
    { label: "Mobile Phone", value: "MobilePhone" }
  ];

  it("finds the object field with the same label or API name, else a synonym", () => {
    expect(suggestObjectField({ key: "text_2", label: "Company" }, LEAD).value).toBe("Company");
    expect(suggestObjectField({ key: "text", label: "last name" }, LEAD).value).toBe("LastName");
    expect(suggestObjectField({ key: "text_3", label: "Organisation" }, LEAD).value).toBe("Company");
    expect(suggestObjectField({ key: "text", label: "Text" }, LEAD)).toBeNull();
  });

  it("skips object fields that are already mapped", () => {
    expect(suggestObjectField({ key: "email_2", label: "Email" }, LEAD, new Set(["email"]))).toBeNull();
  });

  it("moves rules and record steps to the new key, including {{key}} text", () => {
    const d = {
      settings: {
        automation: {
          steps: [
            {
              key: "record",
              fields: [
                { field: "Company", source: { type: "field", key: "text_2" } },
                { field: "Description", source: { type: "value", value: "From {{text_2}} and {{ text_2 }}, not {{text_22}}" } }
              ],
              match: { field: "Company", source: { type: "field", key: "text_2" } },
              condition: { conditions: [{ field: "text_2", operator: "isNotEmpty" }] }
            }
          ]
        }
      },
      sections: [{ key: "p1", conditionalLogic: { conditions: [{ field: "text_2" }] }, fields: [{ key: "x", conditionalLogic: { conditions: [{ field: "text_2" }] } }] }]
    };
    renameFieldReferences(d, "text_2", "company");
    const step = d.settings.automation.steps[0];
    expect(step.fields[0].source.key).toBe("company");
    expect(step.fields[1].source.value).toBe("From {{company}} and {{company}}, not {{text_22}}");
    expect(step.match.source.key).toBe("company");
    expect(step.condition.conditions[0].field).toBe("company");
    expect(d.sections[0].conditionalLogic.conditions[0].field).toBe("company");
    expect(d.sections[0].fields[0].conditionalLogic.conditions[0].field).toBe("company");
  });
});

describe("Name field parts", () => {
  const CONTACT = [
    { label: "Salutation", value: "Salutation" },
    { label: "First Name", value: "FirstName" },
    { label: "Last Name", value: "LastName" },
    { label: "Full name (custom)", value: "Full_Name__c" }
  ];
  const parts = [
    { key: "name.firstName", type: "text", label: "Name: First name", name: "name", part: "firstName", objectField: "FirstName" },
    { key: "name.lastName", type: "text", label: "Your name: Surname", name: "name", part: "lastName", objectField: "LastName" }
  ];

  it("never takes a part for an object's Name: an Account gets the full name as text", () => {
    expect(suggestField("Name", parts)).toBeNull(); // "name.firstName" contains "name", but is no Account Name
    const account = defaultStep("Account", [{ key: "email", type: "email", label: "Email" }, ...parts], [{ label: "Account Name", value: "Name", required: true }]);
    expect(account.fields).toEqual([{ field: "Name", source: { type: "value", value: "{{name}}" } }]);
    const withCompany = defaultStep("Account", [{ key: "company", type: "text", label: "Company" }, ...parts], [{ label: "Account Name", value: "Name", required: true }]);
    expect(withCompany.fields.find((m) => m.field === "Name").source).toEqual({ type: "value", value: "{{name}}" });
    const lead = defaultStep("Lead", parts, [{ value: "FirstName" }, { value: "LastName" }]);
    expect(lead.fields).toEqual([
      { field: "FirstName", source: { type: "field", key: "name.firstName" } },
      { field: "LastName", source: { type: "field", key: "name.lastName" } }
    ]);
  });

  it("sends each part to the standard field it is made for", () => {
    expect(parts.map((p) => suggestObjectField(p, CONTACT)?.value)).toEqual(["FirstName", "LastName"]);
    expect(suggestObjectField(parts[0], CONTACT, new Set(["firstname"]))).toBeNull(); // already mapped
    expect(suggestField("LastName", [{ key: "last_name", label: "Last name" }, ...parts]).key).toBe("name.lastName");
    expect(suggestField("Email", parts)).toBeNull();
  });

  it("drops and renames a part's references, and the whole field's", () => {
    const def = () => ({
      settings: { automation: { steps: [{
        key: "record",
        action: "find_or_create",
        match: { field: "LastName", source: { type: "field", key: "name.lastName" } },
        fields: [
          { field: "FirstName", source: { type: "field", key: "name.firstName" } },
          { field: "LastName", source: { type: "field", key: "name.lastName" } },
          { field: "Description", source: { type: "value", value: "Hi {{name}} ({{ name.lastName }}), not {{names}}" } }
        ],
        condition: { conditions: [{ field: "name.firstName", operator: "is_not_empty" }] }
      }] } },
      sections: [{ key: "p1", fields: [{ key: "x", conditionalLogic: { conditions: [{ field: "name.lastName" }, { field: "names" }] } }] }]
    });

    const one = def();
    dropFieldReferences(one, "name.firstName");
    expect(one.settings.automation.steps[0].fields.map((m) => m.field)).toEqual(["LastName", "Description"]);
    expect(one.settings.automation.steps[0].condition).toBeUndefined();
    expect(one.settings.automation.steps[0].match).toBeDefined();

    const all = def();
    dropFieldReferences(all, "name");
    const step = all.settings.automation.steps[0];
    expect(step.fields.map((m) => m.field)).toEqual(["Description"]);
    expect(step.match).toBeUndefined();
    expect(step.action).toBe("create");
    expect(all.sections[0].fields[0].conditionalLogic.conditions).toEqual([{ field: "names" }]); // only the field's own answers

    const renamed = def();
    renameFieldReferences(renamed, "name", "your_name");
    const s = renamed.settings.automation.steps[0];
    expect(s.fields.map((m) => m.source.key || m.source.value)).toEqual(["your_name.firstName", "your_name.lastName", "Hi {{your_name}} ({{your_name.lastName}}), not {{names}}"]);
    expect(s.match.source.key).toBe("your_name.lastName");
    expect(s.condition.conditions[0].field).toBe("your_name.firstName");
    expect(renamed.sections[0].fields[0].conditionalLogic.conditions).toEqual([{ field: "your_name.lastName" }, { field: "names" }]);
  });
});

describe("the payment page's Email field", () => {
  const form = () => ({ settings: { payments: { currency: "EUR", emailField: "billing" } }, sections: [{ key: "p1", fields: [{ key: "billing", type: "email" }] }] });

  it("is cleared when that field goes away, and kept for any other", () => {
    const other = form();
    dropFieldReferences(other, "email");
    expect(other.settings.payments).toEqual({ currency: "EUR", emailField: "billing" });
    const gone = form();
    dropFieldReferences(gone, "billing");
    expect(gone.settings.payments).toEqual({ currency: "EUR" });
    dropFieldReferences({ sections: [] }, "billing"); // no settings at all
  });

  it("follows the field when its key is renamed", () => {
    const d = form();
    renameFieldReferences(d, "billing", "billing_email");
    expect(d.settings.payments.emailField).toBe("billing_email");
    renameFieldReferences(d, "bill", "x"); // only the exact key
    expect(d.settings.payments.emailField).toBe("billing_email");
  });

  it("matches a stored value with spaces around it, as the server reads it", () => {
    const padded = () => ({ settings: { payments: { emailField: " billing " } }, sections: [] });
    const gone = padded();
    dropFieldReferences(gone, "billing");
    expect(gone.settings.payments).toEqual({});
    const renamed = padded();
    renameFieldReferences(renamed, "billing", "work");
    expect(renamed.settings.payments.emailField).toBe("work");
  });

  it("is cleared when its field stops being an Email field", () => {
    const d = form();
    dropRetypedEmailField(d, "billing", "Email");
    expect(d.settings.payments.emailField).toBe("billing");
    dropRetypedEmailField(d, "other", "text");
    expect(d.settings.payments.emailField).toBe("billing");
    dropRetypedEmailField(d, "billing", "text");
    expect(d.settings.payments).toEqual({ currency: "EUR" });
    dropRetypedEmailField({ sections: [] }, "billing", "text"); // no settings at all
  });
});
