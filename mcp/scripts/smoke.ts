/**
 * End-to-end smoke test against a real org (the CLI's default org or JFORM_SF_ORG).
 *
 *   npm run smoke
 *
 * Creates a throwaway form, exercises every operation, then deletes what it created.
 * Also starts the MCP server over stdio and lists its tools through a real client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SalesforceClient } from "../src/salesforce.js";
import {
  addFields,
  cloneForm,
  createForm,
  deleteForm,
  describeObjectFields,
  addLogicRule,
  getForm,
  getResponseSummary,
  listForms,
  listSubmissions,
  listTargetObjects,
  publishForm,
  removeField,
  unpublishForm,
  updateFormSettings,
} from "../src/tools.js";

const client = new SalesforceClient();
const created: string[] = [];
const step = (name: string) => console.log(`\n== ${name}`);

async function main() {
  const auth = await client.getAuth();
  console.log(`Org: ${auth.alias ?? auth.username} ${auth.instanceUrl} (API ${auth.apiVersion})`);

  step("list_forms");
  const forms = await listForms(client, { limit: 5 });
  console.log(forms.map((f) => `${f.id} ${f.name} [${f.status ?? "-"}] sections=${f.sectionCount}`).join("\n"));

  step("list_target_objects / describe_object_fields(Lead)");
  const objects = await listTargetObjects(client);
  console.log(`${objects.length} objects, e.g. ${objects.slice(0, 5).map((o) => o.apiName).join(", ")}`);
  const lead = await describeObjectFields(client, "Lead", "email");
  console.log(lead.fields.map((f) => `${f.apiName}:${f.type}${f.required ? "*" : ""} -> ${f.suggestedFieldType}`).join(", "));

  step("create_form");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const form = await createForm(client, {
    name: `MCP Smoke ${stamp}`,
    description: "Created by the jform-mcp smoke test. Safe to delete.",
    targetObjectApiName: "Lead",
    welcomeMessage: "Welcome",
    thankYouMessage: "Thanks!",
    sections: [
      {
        key: "contact",
        name: "Contact details",
        fields: [
          { key: "intro", type: "richtext", richtext: "<h2>Tell us about you</h2>", required: false, width: 100 },
          { key: "first_name", type: "text", label: "First name", required: true, targetFieldApiName: "FirstName", width: 50 },
          { key: "last_name", type: "text", label: "Last name", required: true, targetFieldApiName: "LastName", width: 50 },
          { key: "email", type: "email", label: "Email", required: true, targetFieldApiName: "Email", width: 100 },
        ],
      },
      {
        key: "survey",
        name: "Survey",
        fields: [
          {
            key: "season",
            type: "picklist",
            label: "Which season did you attend?",
            required: true,
            width: 100,
            options: [{ label: "Summer" }, { label: "Autumn", value: "autumn" }],
          },
          {
            key: "why_summer",
            type: "comment",
            label: "What did you like about summer?",
            required: false,
            width: 100,
            conditionalLogic: { action: "show", match: "all", conditions: [{ field: "season", operator: "equals", value: "Summer" }] },
          },
        ],
      },
    ],
  });
  created.push(form.id);
  console.log(`created ${form.id} "${form.name}" sections=${form.sections.length} fields=${form.sections.reduce((n, s) => n + s.fields.length, 0)}`);
  console.log(form.builderUrl);

  step("get_form round-trip checks");
  const got = await getForm(client, form.id);
  const season = got.sections[1].fields.find((f) => f.key === "season");
  assert(got.displayStyle === "Multi-Page (Sections)", "displayStyle defaulted to Multi-Page");
  assert(season?.type === "picklist", "field type round-trips lowercase");
  assert(season?.options?.length === 2, "options stored");
  assert(season?.options?.[1].value === "autumn", "explicit option value kept");
  assert(got.sections[0].fields[1].width === 50, "width round-trips");
  assert(JSON.stringify(got.sections[1].fields[1].conditionalLogic).includes("Summer"), "conditional logic stored");

  step("add_fields (existing section) + remove_field");
  let updated = await addFields(client, form.id, [{ key: "phone", type: "phone", label: "Phone", required: false, width: 100 }], {});
  const phone = updated.sections.at(-1)!.fields.find((f) => f.key === "phone");
  assert(Boolean(phone), "phone appended to last section");
  updated = await removeField(client, form.id, phone!.id);
  assert(!updated.sections.at(-1)!.fields.some((f) => f.key === "phone"), "phone removed");

  step("add_fields (new section)");
  updated = await addFields(client, form.id, [{ type: "date", label: "Preferred date", required: false, width: 50 }], { newSection: { name: "Booking" } });
  assert(updated.sections.length === 3 && updated.sections[2].name === "Booking", "new section created");

  step("add_logic_rule (labels resolved to keys, choice matched)");
  const ruled = await addLogicRule(client, form.id, { target: "Preferred date", action: "require", when: "Which season did you attend?", value: "autumn" });
  console.log(`  ${ruled.ruleSentence}`);
  const dateField = ruled.sections[2].fields[0];
  assert(dateField.conditionalLogic?.conditions[0].field === "season", "rule references the season key");
  assert(dateField.conditionalLogic?.conditions[0].value === "autumn", "rule stores the option value");

  step("update_form_settings");
  updated = await updateFormSettings(client, form.id, { thankYouMessage: "See you soon" });
  assert(updated.thankYouMessage === "See you soon", "thank-you updated");

  step("clone_form");
  const clone = await cloneForm(client, form.id, { newName: `MCP Smoke Clone ${stamp}` });
  created.push(clone.form.id);
  assert(clone.form.sections.length === 3, "clone has same section count");
  assert(clone.form.sections[1].fields.find((f) => f.key === "season")?.options?.length === 2, "clone kept options");
  console.log(`cloned -> ${clone.form.id} "${clone.form.name}"`);

  step("publish_form / unpublish_form");
  const pub = await publishForm(client, clone.form.id, "smoke test");
  assert(pub.form.status === "Active" && pub.form.isActive && pub.versionNumber === 1 && pub.form.version === 1, "published as version 1 of the copy");
  assert(Boolean(pub.publicKey) && Boolean(pub.previewUrl?.includes(pub.publicKey)), "public key and preview link returned");
  console.log(`public: ${pub.publicUrl ?? "(none)"}\n${pub.publicUrlNote}`);
  if (pub.publicUrl) assert(Boolean(pub.embedSnippet?.includes(`${pub.publicUrl}&embed=1`)), "embed snippet uses the public link");
  const again = await publishForm(client, clone.form.id);
  assert(again.versionNumber === 2 && again.publicKey === pub.publicKey, "republish bumps the version and keeps the key");
  const unpub = await unpublishForm(client, clone.form.id);
  assert(unpub.status === "Inactive" && !unpub.isActive, "unpublished");

  step("list_submissions / get_response_summary");
  const subs = await listSubmissions(client, form.id, 5);
  assert(subs.length === 0, "no submissions on a new form");
  const summary = await getResponseSummary(client, form.id);
  assert(summary.total === 0, "summary total is 0");

  step("MCP stdio handshake");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const transport = new StdioClientTransport({ command: "node", args: [path.join(here, "..", "dist", "index.js")], stderr: "ignore" });
  const mcp = new Client({ name: "smoke", version: "0.0.0" });
  await mcp.connect(transport);
  const tools = await mcp.listTools();
  console.log(`server exposes ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);
  const res = await mcp.callTool({ name: "get_form", arguments: { formId: form.id } });
  const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  assert(text.includes(form.id), "get_form via MCP returns the form");
  const resources = await mcp.listResources();
  console.log(`resources: ${resources.resources.map((r) => r.uri).join(", ")}`);
  await mcp.close();

  console.log("\nALL CHECKS PASSED");
}

function assert(cond: boolean, what: string) {
  if (!cond) throw new Error(`Assertion failed: ${what}`);
  console.log(`  ok: ${what}`);
}

main()
  .catch((err) => {
    console.error("\nSMOKE FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    step("cleanup");
    for (const id of created) {
      try {
        await unpublishForm(client, id).catch(() => undefined);
        const r = await deleteForm(client, id);
        console.log(`deleted ${r.deleted} "${r.name}"`);
      } catch (e) {
        console.error(`could not delete ${id}: ${(e as Error).message}`);
      }
    }
  });
