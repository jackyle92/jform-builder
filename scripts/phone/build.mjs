// Regenerates the phone number rules and flags used by the Phone field's country picker:
//   jform-core/main/default/lwc/jformPhoneLib/jformPhoneLib.js     libphonenumber-js core + rules for countries.json
//   jform-core/main/default/staticresources/jformFlags.png         one sprite with every country's flag
//
// usage (from this folder): npm ci && npx playwright install chromium && npm run build
//
// Only the countries in countries.json are offered. Their rules come from libphonenumber-js's "max"
// metadata (lengths, number ranges and number types), filtered to those countries; a country that
// shares a calling code keeps that code's main country too, which the library needs for formatting.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import ct from "countries-and-timezones";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const core = path.resolve(here, "../../jform-core/main/default");
const LIB_OUT = path.join(core, "lwc/jformPhoneLib/jformPhoneLib.js");
const FLAGS_OUT = path.join(core, "staticresources/jformFlags.png");
const FLAG_W = 20; // CSS pixels; drawn at twice the size for sharp screens
const FLAG_H = 15;
const FLAG_COLUMNS = 10;

// read from disk: not every package exports its package.json
const versionOf = (pkg) => JSON.parse(fs.readFileSync(path.join(here, "node_modules", pkg, "package.json"), "utf8")).version;
const countries = JSON.parse(fs.readFileSync(path.join(here, "countries.json"), "utf8"))
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name, "en"));
const isoSet = new Set(countries.map((c) => c.iso));

// ------------------------------------------------------------ rules
const max = require("libphonenumber-js/metadata.max.json");
const examples = require("libphonenumber-js/examples.mobile.json");
const keep = new Set(isoSet);
for (const iso of isoSet) {
  if (!max.countries[iso]) throw new Error(`libphonenumber-js has no rules for ${iso}`);
}
for (const list of Object.values(max.country_calling_codes)) {
  if (list.some((iso) => isoSet.has(iso))) keep.add(list[0]);
}
const metadata = { version: max.version, country_calling_codes: {}, countries: {} };
for (const [code, list] of Object.entries(max.country_calling_codes)) {
  const kept = list.filter((iso) => keep.has(iso));
  if (kept.length) metadata.country_calling_codes[code] = kept;
}
for (const iso of keep) metadata.countries[iso] = max.countries[iso];
const exampleNumbers = Object.fromEntries([...isoSet].filter((iso) => examples[iso]).map((iso) => [iso, examples[iso]]));

const COUNTRIES = countries.map((c, i) => ({ iso: c.iso, name: c.name, dial: String(max.countries[c.iso][0]), flag: i }));

// ------------------------------------------------------------ time zones (old names included: browsers still report some)
const TIME_ZONES = {};
for (const [name, zone] of Object.entries(ct.getAllTimezones({ deprecated: true }))) {
  const iso = (zone.countries || [])[0];
  if (isoSet.has(iso)) TIME_ZONES[name] = iso;
}

// ------------------------------------------------------------ library bundle
const entry = `
import { AsYouType, parsePhoneNumberFromString, validatePhoneNumberLength, getExampleNumber } from "libphonenumber-js/core";
const METADATA = ${JSON.stringify(metadata)};
const EXAMPLES = ${JSON.stringify(exampleNumbers)};
/** Offered countries by name: iso, name, dial (calling code without +) and flag (index in the jformFlags sprite). */
export const COUNTRIES = ${JSON.stringify(COUNTRIES)};
/** IANA time zone (current and old names) to the offered country it belongs to. */
export const TIME_ZONES = ${JSON.stringify(TIME_ZONES)};
/** Layout of the jformFlags sprite, in CSS pixels. */
export const FLAGS = ${JSON.stringify({ width: FLAG_W, height: FLAG_H, columns: FLAG_COLUMNS, rows: Math.ceil(COUNTRIES.length / FLAG_COLUMNS) })};
/** Formats a number as it is typed; country is the default for numbers typed without +. */
export function asYouType(country) {
  return new AsYouType(country || undefined, METADATA);
}
/** A PhoneNumber (number, country, isPossible(), isValid(), getType(), formatNational() …) or undefined. */
export function parsePhone(text, country) {
  return parsePhoneNumberFromString(String(text || ""), country ? { defaultCountry: country } : {}, METADATA);
}
/** undefined when the length can be right, else INVALID_COUNTRY, NOT_A_NUMBER, TOO_SHORT, TOO_LONG or INVALID_LENGTH. */
export function lengthProblem(text, country) {
  return validatePhoneNumberLength(String(text || ""), country ? { defaultCountry: country } : {}, METADATA);
}
/** The main country of a calling code without + ("1" gives "US"), or undefined when no offered country uses it. */
export function mainCountry(code) {
  return (METADATA.country_calling_codes[String(code)] || [])[0];
}
/** A sample mobile number for the country, or undefined. */
export function exampleNumber(country) {
  return getExampleNumber(country, EXAMPLES, METADATA);
}
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: here, sourcefile: "jformPhoneLib.entry.js", loader: "js" },
  bundle: true,
  format: "esm",
  target: "es2019",
  minify: true,
  legalComments: "none",
  write: false
});
const header = `/*
 * GENERATED by scripts/phone/build.mjs: do not edit. Change scripts/phone/countries.json and run \`npm run build\` there.
 *
 * Phone number formatting and checks for the ${COUNTRIES.length} countries the Phone field offers:
 * - libphonenumber-js ${versionOf("libphonenumber-js")}, MIT License, Copyright (c) 2016 @catamphetamine,
 *   https://gitlab.com/catamphetamine/libphonenumber-js
 * - its rules derive from Google's libphonenumber, Apache License 2.0, Copyright (C) The Libphonenumber Authors,
 *   https://github.com/google/libphonenumber
 * - time zones from countries-and-timezones ${versionOf("countries-and-timezones")}, MIT License, Copyright (c) 2020 Manuel de la Torre
 */
`;
fs.mkdirSync(path.dirname(LIB_OUT), { recursive: true });
fs.writeFileSync(LIB_OUT, header + bundle.outputFiles[0].text);
const meta = LIB_OUT.replace(/\.js$/, ".js-meta.xml");
if (!fs.existsSync(meta)) {
  fs.writeFileSync(meta, `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <isExposed>false</isExposed>
    <description>Generated phone number rules (libphonenumber-js) for the Phone field; see scripts/phone</description>
</LightningComponentBundle>
`);
}

// ------------------------------------------------------------ flag sprite
const flagDir = path.dirname(require.resolve("flag-icons/flags/4x3/vn.svg"));
const cells = COUNTRIES.map((c) => {
  const svg = fs.readFileSync(path.join(flagDir, `${c.iso.toLowerCase()}.svg`)).toString("base64");
  return `<img src="data:image/svg+xml;base64,${svg}" alt="">`;
}).join("");
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(`<style>body{margin:0}#s{display:grid;grid-template-columns:repeat(${FLAG_COLUMNS},${FLAG_W}px);grid-auto-rows:${FLAG_H}px;width:${FLAG_COLUMNS * FLAG_W}px}#s img{width:${FLAG_W}px;height:${FLAG_H}px;display:block}</style><div id="s">${cells}</div>`);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
await page.locator("#s").screenshot({ path: FLAGS_OUT, omitBackground: true });
await browser.close();
fs.writeFileSync(FLAGS_OUT.replace(/\.png$/, ".resource-meta.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Public</cacheControl>
    <contentType>image/png</contentType>
    <description>Country flags for the Phone field's country picker, drawn from flag-icons ${versionOf("flag-icons")} (MIT, Copyright (c) 2013 Panayiotis Lipiridis) by scripts/phone/build.mjs.</description>
</StaticResource>
`);

const kb = (file) => `${(fs.statSync(file).size / 1024).toFixed(1)} KB`;
console.log(`${COUNTRIES.length} countries (${keep.size - isoSet.size} more kept for shared calling codes), ${Object.keys(TIME_ZONES).length} time zones`);
console.log(`${path.relative(process.cwd(), LIB_OUT)}  ${kb(LIB_OUT)}`);
console.log(`${path.relative(process.cwd(), FLAGS_OUT)}  ${kb(FLAGS_OUT)}`);
