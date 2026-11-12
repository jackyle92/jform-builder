import { createElement } from "lwc";
import JformNewForm from "c/jformNewForm";

const mockNavigate = jest.fn();
jest.mock("lightning/navigation", () => {
  const Navigate = Symbol("Navigate");
  const NavigationMixin = (Base) =>
    class extends Base {
      [Navigate](ref, replace) {
        mockNavigate(ref, replace);
      }
    };
  NavigationMixin.Navigate = Navigate;
  return { NavigationMixin };
});

describe("c-jform-new-form", () => {
  it("opens the workspace's New form dialog in place of the New page", () => {
    document.body.appendChild(createElement("c-jform-new-form", { is: JformNewForm }));
    expect(mockNavigate).toHaveBeenCalledWith({ type: "standard__navItemPage", attributes: { apiName: "JForm_Workspace" }, state: { c__action: "new" } }, true);
  });
});
