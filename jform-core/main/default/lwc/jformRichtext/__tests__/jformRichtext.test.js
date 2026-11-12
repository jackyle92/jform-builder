import { displayHtml, preserveSpaces } from "c/jformRichtext";

describe("displayHtml", () => {
  it("turns Quill's indent class into the padding it stands for", () => {
    expect(displayHtml('<p class="ql-indent-1">The Brisbane clinic</p>')).toBe('<p class="ql-indent-1" style="padding-left: 3em;">The Brisbane clinic</p>');
    expect(displayHtml('<p class="ql-indent-3">Deep</p>')).toBe('<p class="ql-indent-3" style="padding-left: 9em;">Deep</p>');
  });

  it("merges with alignment and other inline styles already on the block", () => {
    expect(displayHtml('<p class="ql-indent-1" style="text-align: center;">Centred</p>')).toBe(
      '<p class="ql-indent-1" style="text-align: center; padding-left: 3em;">Centred</p>'
    );
    expect(displayHtml("<p style='color: red' class=\"ql-indent-2\">Red</p>")).toBe('<p style="color: red; padding-left: 6em;" class="ql-indent-2">Red</p>');
  });

  it("handles list items and leaves everything else alone", () => {
    const html = '<p>Plain</p><ul><li class="ql-indent-1">Nested</li><li>Top</li></ul><p class="ql-align-center">Centred</p>';
    expect(displayHtml(html)).toBe(
      '<p>Plain</p><ul><li class="ql-indent-1" style="padding-left: 3em;">Nested</li><li>Top</li></ul><p class="ql-align-center">Centred</p>'
    );
  });

  it("passes through empty values and markup without indents unchanged", () => {
    expect(displayHtml(undefined)).toBeUndefined();
    expect(displayHtml("")).toBe("");
    const plain = "<p>The <strong>Brisbane</strong> clinic</p>";
    expect(displayHtml(plain)).toBe(plain);
  });
});

describe("preserveSpaces", () => {
  it("keeps spaces typed at the start of a paragraph and runs of spaces", () => {
    expect(preserveSpaces("<p>   The Brisbane clinic</p>")).toBe("<p>&nbsp;&nbsp;&nbsp;The Brisbane clinic</p>");
    expect(preserveSpaces("<p>Two  spaces   here</p>")).toBe("<p>Two &nbsp;spaces &nbsp;&nbsp;here</p>");
    expect(preserveSpaces("<ul><li>  item</li></ul><p>a<br>  b</p>")).toBe("<ul><li>&nbsp;&nbsp;item</li></ul><p>a<br>&nbsp;&nbsp;b</p>");
  });
  it("leaves single spaces, inline tags and preformatted text alone", () => {
    expect(preserveSpaces("<p>The <strong>Brisbane</strong> clinic</p>")).toBe("<p>The <strong>Brisbane</strong> clinic</p>");
    expect(preserveSpaces("<p><strong>Bold</strong> then text</p>")).toBe("<p><strong>Bold</strong> then text</p>");
    expect(preserveSpaces("<pre>  keep   me</pre>")).toBe("<pre>  keep   me</pre>");
    expect(preserveSpaces("")).toBe("");
    expect(preserveSpaces(undefined)).toBeUndefined();
  });
  it("runs inside displayHtml together with the indent padding", () => {
    expect(displayHtml('<p class="ql-indent-1">  Deep</p>')).toBe('<p class="ql-indent-1" style="padding-left: 3em;">&nbsp;&nbsp;Deep</p>');
  });
});
