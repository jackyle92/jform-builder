/**
 * Rich text (Display Text blocks, welcome and thank-you messages) is authored with
 * lightning-input-rich-text, which is Quill underneath. Quill writes most formatting
 * inline (bold, alignment, colour, size) but expresses indentation as a class,
 * `ql-indent-1` … `ql-indent-8`, and relies on its own stylesheet to turn that into
 * padding. The builder page has that stylesheet; the public site does not, and
 * lightning-formatted-rich-text keeps the markup inside its own shadow root where
 * component CSS cannot reach it. So the class is translated to inline padding at
 * display time; storage keeps Quill's markup so the editor still recognises it.
 */

/** Quill's own indent step, per level. */
const INDENT_EM = 3;
const OPEN_TAG = /<(p|li|h[1-6]|div|blockquote|pre)\b([^>]*)>/gi;
const INDENT_CLASS = /\bql-indent-([1-8])\b/;
const STYLE_ATTR = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i;

const BLOCK_START = /^<(p|li|h[1-6]|div|blockquote|td|th|br)\b[^>]*>$/i;
const PRE_OPEN = /^<pre\b/i;
const PRE_CLOSE = /^<\/pre>/i;

/**
 * Spaces typed at the start of a paragraph, or several in a row, are shown by the editor but
 * collapsed by every browser once the HTML is rendered. Make them non-breaking the way editors
 * do on export, so what was typed is what respondents see. Text inside <pre> is left alone.
 */
export function preserveSpaces(html) {
  if (!html || typeof html !== "string" || !/ {2}|> /.test(html)) return html;
  const parts = html.split(/(<[^>]+>)/);
  let afterBlockStart = true;
  let inPre = 0;
  return parts
    .map((part) => {
      if (part.startsWith("<")) {
        if (PRE_OPEN.test(part)) inPre++;
        else if (PRE_CLOSE.test(part)) inPre = Math.max(0, inPre - 1);
        afterBlockStart = BLOCK_START.test(part);
        return part;
      }
      if (!part || inPre) return part;
      let text = part;
      if (afterBlockStart) text = text.replace(/^ +/, (m) => "&nbsp;".repeat(m.length));
      text = text.replace(/ {2,}/g, (m) => " " + "&nbsp;".repeat(m.length - 1));
      afterBlockStart = false;
      return text;
    })
    .join("");
}

/** HTML ready for lightning-formatted-rich-text: typed spacing kept, indent classes given the padding they stand for. */
export function displayHtml(html) {
  if (!html || typeof html !== "string") return html;
  html = preserveSpaces(html);
  if (html.indexOf("ql-indent-") < 0) return html;
  return html.replace(OPEN_TAG, (tag, name, attrs) => {
    const level = INDENT_CLASS.exec(attrs);
    if (!level) return tag;
    const padding = `padding-left: ${Number(level[1]) * INDENT_EM}em;`;
    const style = STYLE_ATTR.exec(attrs);
    if (style) {
      const existing = (style[2] ?? style[3] ?? "").trim();
      const merged = existing && !/;\s*$/.test(existing) ? `${existing}; ${padding}` : `${existing} ${padding}`.trim();
      return `<${name}${attrs.replace(STYLE_ATTR, ` style="${merged}"`)}>`;
    }
    return `<${name}${attrs} style="${padding}">`;
  });
}
