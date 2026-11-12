import { NAMESPACE, NAMESPACE_PREFIX, qualify, stateKey, readState } from "c/jformNamespace";

describe("jformNamespace (source deploy, no namespace)", () => {
  it("adds nothing to names and uses c__ for page state", () => {
    expect(NAMESPACE).toBe("");
    expect(NAMESPACE_PREFIX).toBe("");
    expect(qualify("Form_Changed__e")).toBe("Form_Changed__e");
    expect(stateKey("formid")).toBe("c__formid");
    expect(readState({ c__formid: "a00" }, "formid")).toBe("a00");
    expect(readState(undefined, "formid")).toBeUndefined();
  });
});
