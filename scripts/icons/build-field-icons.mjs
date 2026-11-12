// Builds the JForm field type icons (static resource jformFieldIcons): one solid SVG per field type,
// in one color with white details and a small drop shadow. The drawings live here; edit them and run
//   node scripts/icons/build-field-icons.mjs
// The file names are the field types, so c/jformFieldRegistry.iconUrl() needs no change.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COLOR = "#287A74";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../jform-core/main/default/staticresources/jformFieldIcons");

/** Rounded rectangle path on the 24 x 24 grid. */
function rr(x, y, w, h, r) {
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;
}
function ci(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z`;
}

/**
 * Layers per icon: "c" solid in the icon color, "w" solid white, "cut" a white line,
 * "faint" the icon color at 35 %, "line" a line in the icon color. Same drawings as the review canvas.
 */
const ICONS = {
  text: ["Text", [["c", rr(3, 5, 18, 14, 3)], ["cut", "M8 9v6M6.5 9h3M6.5 15h3", 2], ["cut", "M12.5 12h5", 2]]],
  name: ["Name", [["c", rr(2.5, 5, 19, 14, 2.5)], ["w", ci(8.5, 10.2, 2)], ["w", "M5 16.6c0-2.1 1.6-3.4 3.5-3.4s3.5 1.3 3.5 3.4z"], ["cut", "M14.5 10h4M14.5 14h2.8", 1.8]]],
  email: ["Email", [["c", rr(2.5, 5, 19, 14, 2.5)], ["cut", "M6 9l6 4.5 6-4.5", 2]]],
  phone: ["Phone", [["c", "M6.6 2.9c.6-.3 1.3-.1 1.6.5l1.8 3.3c.3.5.2 1.2-.3 1.6L8.3 9.4c1.1 2.5 3.3 4.7 5.8 5.8l1.1-1.4c.4-.5 1.1-.6 1.6-.3l3.3 1.8c.6.3.8 1 .5 1.6l-1 2c-.4.8-1.3 1.3-2.2 1.1C10.4 18.9 5.1 13.6 3.9 6.6c-.2-.9.3-1.8 1.1-2.2z"]]],
  comment: ["Long text", [["c", rr(3, 3, 18, 18, 3)], ["cut", "M7 8h10M7 12h10M7 16h6", 2]]],
  number: ["Number", [["c", rr(3, 3, 18, 18, 3)], ["cut", "M10.2 7.5l-1.2 9M15 7.5l-1.2 9M7.5 10.5h9.5M7 13.8h9.5", 1.8]]],
  picklist: ["Dropdown", [["c", rr(3, 6, 18, 12, 3)], ["cut", "M6.5 12h6", 2], ["cut", "M15.25 11l1.75 1.75L18.75 11", 2]]],
  date: ["Date", [["c", rr(3, 5, 18, 16, 3)], ["c", rr(6, 2.5, 2.2, 5, 1.1) + rr(15.8, 2.5, 2.2, 5, 1.1)], ["cut", "M3.5 10h17", 1.6], ["cut", "M7.5 13.5h.01M12 13.5h.01M16.5 13.5h.01M7.5 17h.01M12 17h.01", 2.6]]],
  time: ["Time", [["c", ci(12, 12, 9.5)], ["cut", "M12 7v5.3l3.3 2", 2]]],
  fileupload: ["File upload", [["c", "M7.2 19.5A4.7 4.7 0 0 1 6.4 10.2 6 6 0 0 1 17.8 8.9a5.3 5.3 0 0 1-.1 10.6z"], ["cut", "M12 17.5v-6M9.5 14L12 11.5l2.5 2.5", 2]]],
  radio: ["Single choice", [["c", ci(12, 12, 9.5) + ci(12, 12, 7) + ci(12, 12, 4)]]],
  checkboxes: ["Checkboxes", [["c", rr(3, 3, 18, 18, 4)], ["cut", "M7.5 12.3l3 3 6-6.3", 2.4]]],
  rating: ["Rating", [["c", "M12 2.6l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.04l-5.66 2.97 1.08-6.3-4.57-4.46 6.32-.92z"]]],
  nps: ["NPS", [["c", "M2.5 16.5a9.5 9.5 0 0 1 19 0c0 .83-.67 1.5-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z"], ["cut", "M6.3 12.4l.9.5M12 8v1M17.7 12.4l-.9.5", 1.6], ["cut", "M12 16l3.6-5", 2], ["w", ci(12, 16, 1.6)]]],
  yesno: ["Yes / No", [["c", rr(2, 6.5, 20, 11, 5.5)], ["w", ci(16.5, 12, 3.6)]]],
  richtext: ["Rich text", [["c", "M10.6 4H19.5v2.3h-1.9V20h-2.3V6.3h-1.6V20h-2.3v-7.2h-.8a4.4 4.4 0 0 1 0-8.8z"]]],
  heading: ["Heading", [["c", "M5 4h3.2v6.4h7.6V4H19v16h-3.2v-6.4H8.2V20H5z"]]],
  divider: ["Divider", [["faint", rr(4, 5, 11, 2.2, 1.1)], ["c", rr(2.5, 10.75, 19, 2.5, 1.25)], ["faint", rr(4, 16.8, 14, 2.2, 1.1)]]],
  image: ["Image", [["c", rr(3, 4, 18, 16, 3)], ["w", ci(8.5, 9, 1.9)], ["w", "M5.5 17.5l4.2-4.6 2.8 2.8 2.6-3 3.4 4.8z"]]],
  event: ["Event details", [["c", "M5.5 5h13a2.5 2.5 0 0 1 2.5 2.5v2.2a2.3 2.3 0 0 0 0 4.6v2.2a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-2.2a2.3 2.3 0 0 0 0-4.6V7.5A2.5 2.5 0 0 1 5.5 5z"], ["cut", "M15 7.6v1.4M15 11.3v1.4M15 15v1.4", 1.8], ["cut", "M6.8 10.5h4.6M6.8 13.6h3", 1.8]]],
  address: ["Address", [["c", "M12 2.2a7.3 7.3 0 0 1 7.3 7.3c0 5.1-5.6 10.6-6.6 11.6a1 1 0 0 1-1.4 0c-1-1-6.6-6.5-6.6-11.6A7.3 7.3 0 0 1 12 2.2z"], ["w", ci(12, 9.5, 2.7)]]],
  hidden: ["Hidden", [["c", "M2.3 9.6c2.4 4.1 5.7 6.3 9.7 6.3s7.3-2.2 9.7-6.3a1 1 0 0 1 1.6 1.1c-2.8 4.7-6.7 7.3-11.3 7.3S3.5 15.4.7 10.7a1 1 0 0 1 1.6-1.1z"], ["line", "M5.6 15.2l-1.5 2.3M12 17.1v2.7M18.4 15.2l1.5 2.3", 2.2]]],
  consent: ["Consent", [["c", "M12 2.5l7.5 2.8v5.9c0 4.6-3.1 8.5-7.5 10.3-4.4-1.8-7.5-5.7-7.5-10.3V5.3z"], ["cut", "M8.5 12l2.4 2.4 4.6-4.9", 2.2]]],
  multiselect: ["Multi-select", [["c", rr(3, 4, 6.5, 6.5, 1.6) + rr(3, 13.5, 6.5, 6.5, 1.6)], ["cut", "M4.7 7.3l1.3 1.3 2-2.2M4.7 16.8l1.3 1.3 2-2.2", 1.4], ["c", rr(11.5, 6, 9.5, 2.5, 1.25) + rr(11.5, 15.5, 9.5, 2.5, 1.25)]]],
  checkbox: ["Checkbox", [["c", rr(3, 3, 18, 18, 4)], ["cut", "M7.5 12.3l3 3 6-6.3", 2.4]]],
  payment: ["Payment", [["c", rr(2.5, 5, 19, 14, 2.5)], ["cut", "M4.2 9.6h15.6", 2.4], ["cut", "M6.5 15h4", 1.8]]],
  lookup: ["Lookup", [["c", ci(10.5, 10.5, 7) + ci(10.5, 10.5, 4.2)], ["c", "M15.4 13.6l5.4 5.4a1.5 1.5 0 0 1-2.1 2.1l-5.4-5.4z"]]],
  // field types still being built on their own branches; drawn now so the set stays in one style
  signature: ["Signature", [["c", "M16.6 2.6a2 2 0 0 1 2.8 0l1.6 1.6a2 2 0 0 1 0 2.8L10.4 17.6H6.4v-4z"], ["cut", "M14.7 4.5l4.4 4.4", 1.4], ["line", "M3 21.2c1.6-1.4 3-1.4 4.2 0s2.6 1.4 4 0 2.8-1.4 4 0", 1.8]]],
  table: ["Table", [["c", rr(3, 4, 18, 16, 2.5)], ["cut", "M3.5 9.5h17M3.5 14.75h17M9 9.5v10M15 9.5v10", 1.6]]]
};

function layer([kind, d, width]) {
  if (kind === "cut" || kind === "line") {
    const stroke = kind === "cut" ? "#fff" : COLOR;
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const fill = kind === "w" ? "#fff" : COLOR;
  const opacity = kind === "faint" ? ' fill-opacity="0.35"' : "";
  return `<path d="${d}" fill="${fill}"${opacity} fill-rule="evenodd"/>`;
}

// The drawing sits on a 24 x 24 grid; the view box adds room around it (more below) so the shadow is not cut off.
function svg(label, layers) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.5 -1 27 27" width="27" height="27" role="img" aria-label="${label}">`,
    `  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1.5" stdDeviation="1" flood-color="#000" flood-opacity="0.32"/></filter></defs>`,
    `  <g filter="url(#s)">`,
    ...layers.map((l) => `    ${layer(l)}`),
    `  </g>`,
    `</svg>`,
    ""
  ].join("\n");
}

mkdirSync(OUT, { recursive: true });
for (const [type, [label, layers]] of Object.entries(ICONS)) {
  writeFileSync(join(OUT, `${type}.svg`), svg(label, layers));
}
console.log(`${Object.keys(ICONS).length} icons written to ${OUT}`);
