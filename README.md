# JForm

A drag-and-drop form builder for Salesforce. Build surveys, registrations, bookings and lead-capture forms in Lightning, publish them on an Experience Cloud site or embed them in any web page, and get every response as Salesforce records.

JForm is free and open source under the MIT licence. Install the package as it is, or deploy the source and change it however you like.

## What it does

- **Form Workspace** with Build, Logic, Design, Settings and Responses tabs, autosave and versioned publishing.
- **Field types**: text, email, phone with a country code picker, address, date and time, choices, rating and NPS, file upload, signature, tables, payment and more.
- **Logic**: show, hide and require fields by answers.
- **Record steps**: each response can create, find or update Salesforce records, or run an autolaunched flow. Every response also publishes the `Submitted__e` platform event.
- **Welcome and thank-you screens**, opening and closing times, response limits.
- **Payments** through Stripe hosted checkout, with your own Stripe account: test and live payments, pricing options, promotion codes.
- **Spam protection**: honeypot, timing tokens and optional reCAPTCHA v3.
- **REST API** at `/services/apexrest/jform/v1` (package) or `/services/apexrest/v1` (source), and a local **MCP server** in `mcp/`.
- **Agentforce** (optional): a JForm Form Builder topic with actions in `jform-agent/`, and **Describe it**, which drafts a form from a sentence.

## Requirements

- Enterprise, Unlimited, Performance or Developer Edition. The package isn't security reviewed, so its Apex does not run in Group or Professional Edition.
- Digital Experiences (Experience Cloud) turned on, for the public form site.
- Agentforce pieces only: Einstein generative AI in the org.

## Install the package

No package version has been released yet. Deploy from source for now (see below).

Install it **for admins only**. Then open the **JForm** app and its **Setup** tab: **Core setup** walks you through builder access, the public site, guest access and publishing. Admins with the Salesforce CLI can run `scripts/setup-org.sh <org alias>` instead.

**Upgrade** by installing a newer version's link over the old one. Package code is locked: to change JForm, deploy it from source instead.

## Deploy from source

Use this to change JForm. You need the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`).

```bash
sf org login web -a my-org
scripts/deploy-source.sh my-org
```

`scripts/deploy-source.sh` works in any org, including a brand-new one. It:

1. Deploys `jform-core` and gives you the `ACCESS_FORM_BUILDER` permission set.
2. Deploys the `jform` site with your user as site owner. In a new org it leaves the guest profile out, because the site has to exist before its guest profile can be deployed.
3. Gives the site's guest user the `JForm_Guest` permission set.
4. Publishes the site. If the public page still redirects to the login page, publish once more with `sf community publish -o my-org --name jform`.

Add `--with-agent` to also deploy the Agentforce pieces (see below). The script is safe to run again after you change the code.

Notes:

- Every builder needs `ACCESS_FORM_BUILDER`, admins included: JForm runs in user mode and checks field-level security.
- To redeploy only the core after a change: `sf project deploy start -o my-org -d jform-core`.
- To redeploy the site by hand: run `scripts/site-owner.sh my-org`, then `sf project deploy start -o my-org -d jform-experience`, then `scripts/site-owner.sh --reset` before you commit. The repository keeps placeholder users in the site metadata.
- For a scratch org: `sf org create scratch -f config/project-scratch-def.json -a jform -y 7 -v <your Dev Hub>`.

**Agentforce (optional).** `jform-agent` holds the topic and its actions, plus the Models API client behind Describe it. It deploys only to an org with Einstein generative AI: `scripts/deploy-source.sh my-org --with-agent`. `jform-agent-script` holds a sample Agent Script agent that uses them.

Don't install the package and deploy the source into the same org: you'd get two copies of the app.

## Settings to turn on by hand

- **Design tab image uploads**: Setup → Content Deliveries and Public Links → enable them.
- **File upload and Signature fields**: Setup → Salesforce Files → General Settings → **Allow site guest users to upload files**.
- **reCAPTCHA and payments**: add your own keys on the JForm **Setup** tab, under Optional settings and Payments.

## Run the tests

```bash
npm ci
npm run test:unit
sf apex run test -o my-org --test-level RunLocalTests --wait 30
```

## MCP server

`mcp/` is a local MCP server that lets Claude Code and other MCP clients build and publish forms through the REST API.

```bash
cd mcp && npm install && npm run build
```

Register `node mcp/dist/index.js` with your MCP client and set `JFORM_SF_ORG` to your org alias (or make that org the CLI's default).

## Licence

MIT: see [LICENSE](LICENSE). Third-party parts and their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

JForm is provided as is, without warranty or support. Salesforce, Experience Cloud and Agentforce are trademarks of Salesforce, Inc. Stripe is a trademark of Stripe, Inc. JForm is not affiliated with either.
