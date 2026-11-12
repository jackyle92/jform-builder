import { createElement } from "lwc";
import JformEditForm from "c/jformEditForm";

const mockNavigate = jest.fn();
jest.mock("lightning/navigation", () => {
  const Navigate = Symbol("Navigate");
  const NavigationMixin = (Base) =>
    class extends Base {
      [Navigate](ref) {
        mockNavigate(ref);
      }
    };
  NavigationMixin.Navigate = Navigate;
  return { NavigationMixin };
});

describe("c-jform-edit-form", () => {
  it("opens the record's form in the workspace", () => {
    const el = createElement("c-jform-edit-form", { is: JformEditForm });
    el.recordId = "a001";
    document.body.appendChild(el);
    el.invoke();
    expect(mockNavigate).toHaveBeenCalledWith({ type: "standard__navItemPage", attributes: { apiName: "JForm_Workspace" }, state: { c__formid: "a001" } });
  });
});
