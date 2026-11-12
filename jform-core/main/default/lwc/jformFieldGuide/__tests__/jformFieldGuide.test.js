import { guideFor, searchText, sampleOf } from "c/jformFieldGuide";
import { paletteGroups, FIELD_TYPES } from "c/jformFieldRegistry";

const paletteTypes = paletteGroups().flatMap((g) => g.items.map((i) => i.type));

describe("c/jformFieldGuide", () => {
  it.each(paletteTypes)("explains %s and offers an example, a picture or a note", (type) => {
    const g = guideFor(type);
    expect(g.desc).toBeTruthy();
    expect(g.when).toBeTruthy();
    g.compare.forEach((other) => expect(FIELD_TYPES[other]).toBeDefined());
    const sample = sampleOf(type);
    expect([sample.field, sample.picture, sample.note].filter(Boolean)).toHaveLength(1);
    if (sample.field) expect(sample.field.type).toBe(type);
  });

  it("draws the table rather than showing the live field, which would stack in the card", () => {
    const { picture } = sampleOf("table");
    expect(picture.columns).toEqual(["Poor", "Okay", "Great"]);
    picture.rows.forEach((r) => expect(picture.columns).toContain(r.pick));
  });

  it("builds examples on the builder's defaults", () => {
    const phone = sampleOf("phone").field;
    expect(phone.label).toBe("Mobile");
    expect(phone.config.countryPicker).toBe(true);
    const choice = sampleOf("radio");
    expect(choice.field.options.map((o) => o.value)).toEqual(["Email", "Phone call", "Text message"]);
    expect(choice.value).toBe("Email");
    const event = sampleOf("event").field;
    expect(event.config.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(event.config.location).toBe("Main campus, Building A");
  });

  it("searches names, descriptions and extra words", () => {
    expect(searchText("picklist")).toContain("dropdown");
    expect(searchText("picklist")).toContain("country");
    expect(searchText("hidden")).toContain("utm");
    expect(guideFor("nope").desc).toBe("");
  });
});
