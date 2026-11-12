/**
 * Preset record steps and field matching for the Automate tab. A preset builds
 * steps for a specific form: object fields are matched to the form's fields by
 * key and label synonyms, and required fields fall back to safe text.
 */
import { paymentSettings } from "c/jformPayment";

const SYNONYMS = {
  FirstName: ["first_name", "firstname", "first", "given_name", "forename"],
  LastName: ["last_name", "lastname", "surname", "family_name", "last"],
  Email: ["email", "e_mail", "email_address", "work_email", "your_email"],
  Phone: ["phone", "phone_number", "telephone", "mobile", "mobile_number", "contact_number", "tel"],
  MobilePhone: ["mobile", "mobile_number", "cell", "cell_phone"],
  Company: ["company", "company_name", "organisation", "organization", "business", "employer", "club_or_school", "school", "club", "account"],
  Title: ["job_title", "title", "position", "role"],
  Website: ["website", "web_site", "url", "company_website"],
  Industry: ["industry", "sector"],
  Description: ["description", "message", "details", "comments", "notes", "question", "describe_the_problem", "problem", "enquiry", "inquiry", "anything_else", "tell_us_more", "how_can_we_help", "cover_letter", "feedback"],
  Subject: ["subject", "topic", "issue", "reason", "request_type", "category", "service", "product"],
  Priority: ["priority", "urgency"],
  Street: ["street", "address", "address_line_1", "street_address"],
  City: ["city", "town"],
  PostalCode: ["postcode", "zip", "postal_code", "zip_code"],
  Country: ["country"],
  State: ["state", "county", "region", "province"],
  NumberOfEmployees: ["employees", "number_of_employees", "company_size", "headcount"],
  Rating: ["rating", "score", "nps", "how_likely"],
  Date: ["date", "preferred_date", "appointment_date", "booking_date", "event_date", "start_date", "when"],
  Name: ["name", "full_name", "your_name"]
};

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * The form field best matching an object field: a Name field's part made for it (objectField, e.g. its
 * first name for FirstName), else by synonym on key then label, exact then contains. A Name part is only
 * ever matched by its objectField: "name.firstName" contains "name", but a first name is no Account Name.
 * Address parts are never matched here: they map by address (addressMappings), so "address" is no Street.
 */
export function suggestField(objectField, formFields) {
  const part = (formFields || []).find((f) => f?.objectField && f.objectField === objectField);
  if (part) return part;
  const candidates = SYNONYMS[objectField] || [norm(objectField)];
  const fields = (formFields || []).filter((f) => f && !f.name && !f.address).map((f) => ({ f, key: norm(f.key), label: norm(f.label) }));
  for (const c of candidates) {
    const hit = fields.find((x) => x.key === c || x.label === c);
    if (hit) return hit.f;
  }
  for (const c of candidates) {
    if (c.length < 4) continue;
    const hit = fields.find((x) => x.key.includes(c) || x.label.includes(c));
    if (hit) return hit.f;
  }
  return null;
}

const field = (key) => ({ type: "field", key });

/** The address a record fills for an Address field, by purpose, before any other it has. Mirrors JFormAddressService. */
const ADDRESS_PREFERENCE = {
  "": ["MailingAddress", "Address", "BillingAddress"],
  billing: ["BillingAddress", "MailingAddress", "Address"],
  shipping: ["ShippingAddress", "MailingAddress", "Address"]
};

/**
 * An object's addresses from its fields as getObjectFields gives them (addressName, addressLabel, addressPart):
 * [{ name: "MailingAddress", label: "Mailing Address", fields: { city: "MailingCity", countryCode: "MailingCountryCode", ... } }].
 * Where the org has State and Country/Territory Picklists the codes are there instead of the names.
 */
export function addressTargets(objectFields) {
  const byName = new Map();
  for (const f of objectFields || []) {
    if (!f?.addressName || !f.addressPart) continue;
    if (!byName.has(f.addressName)) byName.set(f.addressName, { name: f.addressName, label: f.addressLabel || f.addressName, fields: {} });
    byName.get(f.addressName).fields[f.addressPart] = f.value;
  }
  return [...byName.values()];
}

/** The address an Address field fills by default: by purpose Mailing, the Lead's Address, Billing or Shipping, else the first. */
export function defaultAddressTarget(purpose, objectFields) {
  const targets = addressTargets(objectFields);
  for (const name of ADDRESS_PREFERENCE[purpose] || ADDRESS_PREFERENCE[""]) {
    const hit = targets.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  return targets[0] || null;
}

/**
 * Mappings of one Address field's answers (answerFieldsOf: "field.part" with address and part) to an address's
 * fields, [{ field, source }], leaving out object fields in `taken`.
 */
export function addressMappings(answerFields, target, taken = new Set()) {
  if (!target) return [];
  return (answerFields || [])
    .filter((a) => a?.address && target.fields[a.part] && !taken.has(target.fields[a.part].toLowerCase()))
    .map((a) => ({ field: target.fields[a.part], source: field(a.key) }));
}

/** Step mappings with each Address field in formFields added on its default address, where those object fields are still free. */
export function withAddressMappings(mappings, formFields, objectFields) {
  const out = [...(mappings || [])];
  const taken = new Set(out.map((m) => String(m.field).toLowerCase()));
  const byAddress = new Map();
  for (const f of formFields || []) {
    if (!f?.address) continue;
    if (!byAddress.has(f.address)) byAddress.set(f.address, []);
    byAddress.get(f.address).push(f);
  }
  for (const answers of byAddress.values()) {
    if (out.some((m) => m.source?.type === "field" && answers.some((a) => a.key === m.source.key))) continue;
    for (const m of addressMappings(answers, defaultAddressTarget(answers[0].purpose, objectFields), taken)) {
      taken.add(m.field.toLowerCase());
      out.push(m);
    }
  }
  return out;
}
const text = (value) => ({ type: "value", value });
const fromStep = (step, path = "Id") => ({ type: "step", step, path });
const submission = (path) => ({ type: "submission", path });

/** Map an object field from the best form field, else a fallback source, else nothing. */
function pick(objectField, formFields, fallback) {
  const f = suggestField(objectField, formFields);
  if (f) return { field: objectField, source: field(f.key) };
  return fallback ? { field: objectField, source: fallback } : null;
}
const compact = (list) => list.filter(Boolean);
/** The key of the form's first Name field, whose {{key}} in text gives the full name, or null. */
const fullNameKey = (formFields) => (formFields || []).find((f) => f?.name)?.name || null;
const tplKey = (formFields, ...objectFields) => {
  for (const of of objectFields) {
    const f = suggestField(of, formFields);
    if (f) return `{{${f.key}}}`;
    if (of === "Name" && fullNameKey(formFields)) return `{{${fullNameKey(formFields)}}}`;
  }
  return "";
};

/** A single "Name" answer stands in for LastName when there is no last-name field. */
function lastNameFallback(formFields, defaultText) {
  const name = suggestField("Name", formFields);
  return name ? field(name.key) : text(defaultText);
}

function personFields(formFields, opts = {}) {
  return compact([
    pick("FirstName", formFields),
    pick("LastName", formFields, lastNameFallback(formFields, opts.lastName || "Unknown")),
    pick("Email", formFields),
    pick("Phone", formFields),
    opts.title ? pick("Title", formFields) : null
  ]);
}

function emailMatch(formFields) {
  const f = suggestField("Email", formFields);
  return f ? { field: "Email", source: field(f.key) } : null;
}

function contactStep(formFields, extra = {}) {
  const match = emailMatch(formFields);
  return {
    key: "contact",
    label: "Find or create the contact",
    action: match ? "find_or_create" : "create",
    object: "Contact",
    match: match || undefined,
    updateExisting: false,
    fields: compact([...personFields(formFields, { title: true }), extra.accountStep ? { field: "AccountId", source: fromStep(extra.accountStep) } : null]),
    ...extra.props
  };
}

function accountStep(formFields) {
  const company = suggestField("Company", formFields);
  if (!company) return null;
  return {
    key: "account",
    label: "Find or create the account",
    action: "find_or_create",
    object: "Account",
    match: { field: "Name", source: field(company.key) },
    updateExisting: false,
    fields: compact([{ field: "Name", source: field(company.key) }, pick("Website", formFields), pick("Industry", formFields), pick("Phone", formFields)])
  };
}

function urgentTask(formFields, whatStep, whoStep) {
  const priority = suggestField("Priority", formFields);
  if (!priority) return null;
  const urgentValue = (priority.options || []).map((o) => o.value ?? o.label).find((v) => /urgent|high|critical/i.test(v)) || "Urgent";
  return {
    key: "task",
    label: "Alert the team for urgent requests",
    action: "create",
    object: "Task",
    condition: { match: "all", conditions: [{ field: priority.key, operator: "equals", value: urgentValue }] },
    fields: compact([
      { field: "Subject", source: text(`Urgent: ${tplKey(formFields, "Subject") || "new request"}`) },
      whatStep ? { field: "WhatId", source: fromStep(whatStep) } : null,
      whoStep ? { field: "WhoId", source: fromStep(whoStep) } : null,
      { field: "Priority", source: text("High") },
      { field: "Status", source: text("Not Started") }
    ])
  };
}

export const PRESETS = [
  {
    id: "lead_capture",
    label: "Lead capture",
    description: "Find or create a Lead by email; update it when the same person submits again.",
    build(formFields) {
      const match = emailMatch(formFields);
      return [{
        key: "lead", label: "Find or create the lead", action: match ? "find_or_create" : "create", object: "Lead", match: match || undefined, updateExisting: true, primary: true,
        fields: compact([...personFields(formFields, { title: true }), pick("Company", formFields, text("Unknown")), pick("Website", formFields), pick("Industry", formFields), pick("Description", formFields), { field: "LeadSource", source: text("Web") }])
      }];
    }
  },
  {
    id: "contact_us",
    label: "Contact us",
    description: "Lead capture plus a follow-up Task for the sales team.",
    build(formFields) {
      const [lead] = PRESETS[0].build(formFields);
      return [lead, {
        key: "task", label: "Follow up", action: "create", object: "Task",
        fields: compact([
          { field: "Subject", source: text(`Follow up: ${tplKey(formFields, "Subject") || tplKey(formFields, "FirstName", "Name") || "web enquiry"}`) },
          { field: "WhoId", source: fromStep("lead") },
          pick("Description", formFields),
          { field: "Status", source: text("Not Started") },
          { field: "ActivityDate", source: submission("submittedAt") }
        ])
      }];
    }
  },
  {
    id: "support_case",
    label: "Support case",
    description: "Find or create the Contact (and Account), create a Case linked to both, alert the team when it is urgent.",
    build(formFields) {
      const account = accountStep(formFields);
      const contact = contactStep(formFields, { accountStep: account ? "account" : null });
      const kase = {
        key: "case", label: "Create the case", action: "create", object: "Case", primary: true,
        fields: compact([
          { field: "Subject", source: text(tplKey(formFields, "Subject") ? `${tplKey(formFields, "Subject")}` : `Support request from ${tplKey(formFields, "FirstName", "Name") || "the website"}`) },
          pick("Description", formFields),
          pick("Priority", formFields),
          { field: "Origin", source: text("Web") },
          { field: "ContactId", source: fromStep("contact") },
          { field: "AccountId", source: fromStep("contact", "AccountId") }
        ])
      };
      return compact([account, contact, kase, urgentTask(formFields, "case", "contact")]);
    }
  },
  {
    id: "event_registration",
    label: "Event registration",
    description: "Find or create the Contact and add them to a Campaign as a member who responded.",
    build(formFields) {
      return [contactStep(formFields, { props: { primary: true } }), {
        key: "member", label: "Add to the campaign", action: "create", object: "CampaignMember",
        fields: [
          { field: "CampaignId", source: text("") },
          { field: "ContactId", source: fromStep("contact") },
          { field: "Status", source: text("Responded") }
        ]
      }];
    }
  },
  {
    id: "newsletter",
    label: "Newsletter signup",
    description: "Find or create a Lead by email, marked as a newsletter subscriber.",
    build(formFields) {
      const match = emailMatch(formFields);
      return [{
        key: "lead", label: "Subscribe the lead", action: match ? "find_or_create" : "create", object: "Lead", match: match || undefined, updateExisting: true, primary: true,
        fields: compact([pick("FirstName", formFields), pick("LastName", formFields, lastNameFallback(formFields, "Subscriber")), pick("Email", formFields), { field: "Company", source: text("Newsletter subscriber") }, { field: "LeadSource", source: text("Newsletter") }, { field: "Description", source: submission("formName") }])
      }];
    }
  },
  {
    id: "booking",
    label: "Appointment booking",
    description: "Find or create the Contact and create a calendar Event for the requested date.",
    build(formFields) {
      const date = suggestField("Date", formFields);
      return [contactStep(formFields), {
        key: "event", label: "Create the appointment", action: "create", object: "Event", primary: true,
        fields: compact([
          { field: "Subject", source: text(`Booking: ${tplKey(formFields, "Subject") || tplKey(formFields, "FirstName", "Name") || "web request"}`) },
          { field: "ActivityDateTime", source: date ? field(date.key) : submission("submittedAt") },
          { field: "DurationInMinutes", source: text("60") },
          { field: "WhoId", source: fromStep("contact") },
          pick("Description", formFields)
        ])
      }];
    }
  },
  {
    id: "quote_request",
    label: "Quote request",
    description: "Find or create the Account and Contact, then open an Opportunity for the request.",
    build(formFields) {
      const account = accountStep(formFields);
      const contact = contactStep(formFields, { accountStep: account ? "account" : null });
      return compact([account, contact, {
        key: "opportunity", label: "Open the opportunity", action: "create", object: "Opportunity", primary: true,
        fields: compact([
          { field: "Name", source: text(`${tplKey(formFields, "Company") || tplKey(formFields, "LastName", "Name") || "Web"} - ${tplKey(formFields, "Subject") || "quote request"}`) },
          account ? { field: "AccountId", source: fromStep("account") } : null,
          { field: "StageName", source: text("Prospecting") },
          { field: "CloseDate", source: submission("submittedAt") },
          { field: "LeadSource", source: text("Web") },
          pick("Description", formFields)
        ])
      }]);
    }
  },
  {
    id: "partner_onboarding",
    label: "Partner or vendor onboarding",
    description: "Find or create the Account from the company name and a Contact linked to it.",
    build(formFields) {
      const account = accountStep(formFields) || { key: "account", label: "Create the account", action: "create", object: "Account", fields: [{ field: "Name", source: text("New partner") }] };
      account.updateExisting = true;
      account.primary = true;
      account.fields = compact([...account.fields, pick("Street", formFields), pick("City", formFields), pick("PostalCode", formFields), pick("Country", formFields), pick("NumberOfEmployees", formFields)]);
      return [account, contactStep(formFields, { accountStep: "account" })];
    }
  },
  {
    id: "feedback",
    label: "Customer feedback",
    description: "Look up the Contact if they are known and log the feedback as a low-priority Case.",
    build(formFields) {
      const match = emailMatch(formFields);
      return compact([
        match ? { key: "contact", label: "Look up the contact", action: "find", object: "Contact", match, required: false, fields: [] } : null,
        {
          key: "case", label: "Log the feedback", action: "create", object: "Case", primary: true,
          fields: compact([
            { field: "Subject", source: text(`Feedback${tplKey(formFields, "Rating") ? `: ${tplKey(formFields, "Rating")}` : ""} from ${tplKey(formFields, "FirstName", "Name", "Email") || "the website"}`) },
            pick("Description", formFields),
            { field: "Origin", source: text("Web") },
            { field: "Priority", source: text("Low") },
            match ? { field: "ContactId", source: fromStep("contact") } : null
          ])
        }
      ]);
    }
  },
  {
    id: "job_application",
    label: "Job application",
    description: "Find or create the Contact and create a Task to review the application.",
    build(formFields) {
      return [contactStep(formFields), {
        key: "review", label: "Review the application", action: "create", object: "Task",
        fields: compact([
          { field: "Subject", source: text(`Review application: ${tplKey(formFields, "FirstName", "Name")} ${tplKey(formFields, "LastName")}${tplKey(formFields, "Title") ? ` for ${tplKey(formFields, "Title")}` : ""}`.replace(/\s+/g, " ").trim()) },
          { field: "WhoId", source: fromStep("contact") },
          pick("Description", formFields),
          { field: "Status", source: text("Not Started") }
        ])
      }];
    }
  }
];

export function buildPreset(id, formFields) {
  const p = PRESETS.find((x) => x.id === id);
  return p ? p.build(formFields) : [];
}

/**
 * The step whose record is the response's main record: the one marked primary, else the first that
 * creates or updates, else the first. Flow steps make no record of their own, so they never are.
 */
export function mainStepOf(steps) {
  const list = (steps || []).filter((s) => s.action !== "flow");
  return list.find((s) => s.primary) || list.find((s) => s.action !== "find") || list[0] || null;
}

/** A single step for an object with the form's fields matched by name, de-duplicated by email when both sides have one. */
export function defaultStep(object, formFields, objectFields) {
  const known = objectFields ? new Set(objectFields.map((f) => f.value.toLowerCase())) : null;
  const has = (name) => !known || known.has(name.toLowerCase());
  // Address fields first, by address; then the object's well-known fields by name
  const fields = withAddressMappings([], formFields, objectFields);
  const byAddress = new Set(fields.map((m) => m.field.toLowerCase()));
  fields.push(...compact(Object.keys(SYNONYMS).filter((of) => of !== "Date" && of !== "Rating" && of !== "Name" && has(of) && !byAddress.has(of.toLowerCase())).map((of) => pick(of, formFields))));
  const mapped = new Set(fields.map((m) => m.field.toLowerCase()));
  if (has("LastName") && !mapped.has("lastname")) fields.push({ field: "LastName", source: lastNameFallback(formFields, "Unknown") });
  if (has("Company") && !mapped.has("company") && (objectFields || []).find((f) => f.value === "Company")?.required) fields.push({ field: "Company", source: text("Unknown") });
  if (has("Name") && !mapped.has("name") && (String(object).toLowerCase() === "account" || (objectFields || []).find((f) => f.value === "Name")?.required)) {
    // a Name field gives its full name as text: it is never mapped whole
    const nameHit = suggestField("Name", formFields);
    const company = nameHit ? null : suggestField("Company", formFields);
    const fullName = fullNameKey(formFields);
    fields.push({ field: "Name", source: nameHit ? field(nameHit.key) : fullName ? text(`{{${fullName}}}`) : company ? field(company.key) : text("Unknown") });
  }
  const email = fields.find((m) => m.field === "Email");
  return {
    key: "record",
    label: `${email ? "Find or create" : "Create"} the ${object}`,
    action: email ? "find_or_create" : "create",
    object,
    match: email ? { field: "Email", source: email.source } : undefined,
    updateExisting: Boolean(email),
    primary: true,
    fields
  };
}

/**
 * Turn a form's single target object and per-field mappings into one step. With nothing
 * mapped, fields are matched by name, which needs the object's fields to stay valid.
 */
export function convertLegacy(definition, objectFields) {
  const object = definition?.targetObjectApiName;
  if (!object) return [];
  const target = definition?.settings?.target || {};
  if (target.strategy === "none") return [];
  const fields = [];
  for (const s of definition.sections || []) {
    for (const f of s.fields || []) {
      if (f.targetFieldApiName && (!f.targetObjectApiName || f.targetObjectApiName.toLowerCase() === object.toLowerCase())) fields.push({ field: f.targetFieldApiName, source: field(f.key) });
    }
  }
  if (!fields.length) {
    const formFields = (definition.sections || []).flatMap((s) => s.fields || []);
    return [defaultStep(object, formFields, objectFields)];
  }
  const matchMapping = target.strategy === "update_or_create" && target.matchField ? fields.find((m) => m.field.toLowerCase() === target.matchField.toLowerCase()) : null;
  return [{
    key: "record",
    label: `${matchMapping ? "Find or create" : "Create"} the ${object}`,
    action: matchMapping ? "find_or_create" : "create",
    object,
    match: matchMapping ? { field: matchMapping.field, source: matchMapping.source } : undefined,
    updateExisting: Boolean(matchMapping),
    primary: true,
    fields
  }];
}

/**
 * Convert a legacy target with explicit per-field mappings in place; returns whether anything
 * changed. A bare object name is left for the server, which matches fields by name on save.
 */
export function convertLegacyInPlace(definition) {
  const steps = definition?.settings?.automation?.steps || [];
  if (steps.length || !definition?.targetObjectApiName) return false;
  const explicit = (definition.sections || []).some((s) => (s.fields || []).some((f) => f.targetFieldApiName));
  if (!explicit && (definition.settings?.target?.strategy || "create") !== "none") return false;
  const converted = convertLegacy(definition);
  definition.settings = { ...(definition.settings || {}), automation: { ...(definition.settings?.automation || {}), steps: converted } };
  delete definition.settings.target;
  for (const s of definition.sections || []) {
    for (const f of s.fields || []) {
      delete f.targetFieldApiName;
      delete f.targetObjectApiName;
    }
  }
  const main = mainStepOf(converted);
  definition.targetObjectApiName = main ? main.object : undefined;
  return true;
}

/** Whether settings.payments.emailField names the key, read as c/jformPayment reads it (trimmed). */
const namesEmailField = (definition, key) => Boolean(key) && paymentSettings({ settings: definition?.settings }).emailField === key;

/**
 * A field that was keyed `key` is now of `type`: when it is no longer an Email field, it stops filling in the
 * payment page's email. Mirrors JFormPaymentService.normaliseEmailField, which does the same on save.
 */
export function dropRetypedEmailField(definition, key, type) {
  if (key && String(type || "").toLowerCase() !== "email" && namesEmailField(definition, key)) delete definition.settings.payments.emailField;
}

/** Whether a reference names the key, or one of its answers ("key.part" of a Name field or "key.row" of a table). */
const refersTo = (ref, key) => ref === key || (typeof ref === "string" && ref.startsWith(`${key}.`));

/**
 * A form field (or one answer of it, "key.part") is going away: drop every step mapping, match, step condition and
 * logic rule condition that uses it, and the payment page's Email field when it is that field.
 */
export function dropFieldReferences(definition, key) {
  if (!definition || !key) return;
  const steps = definition.settings?.automation?.steps || [];
  for (const s of steps) {
    s.fields = (s.fields || []).filter((m) => !(m.source?.type === "field" && refersTo(m.source.key, key)));
    if (s.match?.source?.type === "field" && refersTo(s.match.source.key, key)) {
      delete s.match;
      if (s.action !== "create") s.action = "create";
    }
    if (s.condition) {
      s.condition.conditions = (s.condition.conditions || []).filter((c) => !refersTo(c.field, key));
      if (!s.condition.conditions.length) delete s.condition;
    }
  }
  const prune = (owner) => {
    if (!owner.conditionalLogic) return;
    owner.conditionalLogic.conditions = (owner.conditionalLogic.conditions || []).filter((c) => !refersTo(c.field, key));
    if (!owner.conditionalLogic.conditions.length) delete owner.conditionalLogic;
  };
  for (const s of definition.sections || []) {
    prune(s);
    for (const f of s.fields || []) prune(f);
  }
  if (namesEmailField(definition, key)) delete definition.settings.payments.emailField;
}

/**
 * The object field one form field should save to: same label or API name (ignoring case and
 * punctuation), else a known synonym of a standard field. Object fields already mapped are skipped.
 * `objectFields` are { label, value } as returned by getObjectFields.
 */
export function suggestObjectField(formField, objectFields, takenFields = new Set()) {
  const label = norm(formField?.label);
  const key = norm(formField?.key);
  if (!label && !key) return null;
  const free = (objectFields || []).filter((of) => of && of.value && !takenFields.has(String(of.value).toLowerCase()));
  // a Name field's part goes to the standard field it is made for (FirstName, LastName)
  if (formField?.objectField) {
    const standard = free.find((of) => String(of.value).toLowerCase() === formField.objectField.toLowerCase());
    if (standard) return standard;
  }
  const exact = free.find((of) => norm(of.label) === label || norm(of.value) === label);
  if (exact) return exact;
  return free.find((of) => (SYNONYMS[of.value] || []).some((s) => s === label || s === key)) || null;
}

/**
 * Point every reference to a field key, and to its answers ("key.part"), at a new key: record steps (sources,
 * {{key}} text, match, conditions), logic rules and the payment page's Email field.
 */
export function renameFieldReferences(definition, oldKey, newKey) {
  if (!definition || !oldKey || !newKey || oldKey === newKey) return;
  const placeholder = new RegExp(`\\{\\{\\s*${oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.[A-Za-z0-9_]+)?\\s*\\}\\}`, "g");
  const renamed = (ref) => (ref === oldKey ? newKey : `${newKey}${ref.slice(oldKey.length)}`);
  const renameSource = (src) => {
    if (!src) return;
    if (src.type === "field" && refersTo(src.key, oldKey)) src.key = renamed(src.key);
    if (src.type === "value" && typeof src.value === "string") src.value = src.value.replace(placeholder, (m, part) => `{{${newKey}${part || ""}}}`);
  };
  const renameConditions = (rule) => {
    for (const c of rule?.conditions || []) if (refersTo(c.field, oldKey)) c.field = renamed(c.field);
  };
  for (const s of definition.settings?.automation?.steps || []) {
    for (const m of s.fields || []) renameSource(m.source);
    renameSource(s.match?.source);
    renameConditions(s.condition);
  }
  for (const s of definition.sections || []) {
    renameConditions(s.conditionalLogic);
    for (const f of s.fields || []) renameConditions(f.conditionalLogic);
  }
  if (namesEmailField(definition, oldKey)) definition.settings.payments.emailField = newKey;
}
