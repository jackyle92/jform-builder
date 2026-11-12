import { createElement } from "lwc";
import JformHome from "c/jformHome";
import getOverview from "@salesforce/apex/JFormHomeController.getOverview";
import { CurrentPageReference } from "lightning/navigation";

const mockNavigate = jest.fn();
jest.mock("lightning/navigation", () => {
  const { createTestWireAdapter } = require("@salesforce/wire-service-jest-util");
  const Navigate = Symbol("Navigate");
  const NavigationMixin = (Base) =>
    class extends Base {
      [Navigate](ref) {
        mockNavigate(ref);
      }
    };
  NavigationMixin.Navigate = Navigate;
  NavigationMixin.GenerateUrl = Symbol("GenerateUrl");
  return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});
jest.mock("@salesforce/apex/JFormHomeController.getOverview", () => ({ default: jest.fn() }), { virtual: true });

const overview = {
  formCount: 3,
  liveCount: 1,
  responsesTotal: 12,
  responses7Days: 4,
  errorCount: 1,
  agentInstalled: true,
  setupDone: 6,
  setupTotal: 6,
  recent: [
    { id: "a001", name: "Summer Clinic", status: "Active", isActive: true, version: 3, lastModified: "2026-10-13T10:00:00.000Z", responseCount: 12, responses7Days: 4 },
    { id: "a002", name: "Autumn Clinic", status: "Draft", isActive: false, lastModified: "2026-10-12T10:00:00.000Z", responseCount: 0, responses7Days: 0 }
  ]
};

function mount() {
  const el = createElement("c-jform-home", { is: JformHome });
  document.body.appendChild(el);
  return el;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  jest.clearAllMocks();
});

describe("c-jform-home", () => {
  it("shows the overview numbers and recent forms", async () => {
    getOverview.mockResolvedValue(overview);
    const el = mount();
    await flush();
    expect(getOverview).toHaveBeenCalledWith({ recentLimit: 8 });
    const values = [...el.shadowRoot.querySelectorAll(".stat-value")].map((n) => n.textContent);
    expect(values).toEqual(["3", "12", "4", "1"]);
    expect(el.shadowRoot.querySelector(".stat-warn")).not.toBeNull();
    const rows = [...el.shadowRoot.querySelectorAll(".form-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".pill").textContent).toBe("Live v3");
    expect(rows[0].querySelector(".form-meta").textContent).toBe("12 responses, 4 this week");
    expect(rows[1].querySelector(".pill").textContent).toBe("Draft");
    expect(rows[1].querySelector(".form-meta").textContent).toBe("No responses");
    expect(el.shadowRoot.querySelector("c-jform-ask-agent").latestFormName).toBe("Summer Clinic");
  });

  it("shows an empty state and keeps the prompts generic without forms", async () => {
    getOverview.mockResolvedValue({ ...overview, formCount: 0, recent: [] });
    const el = mount();
    await flush();
    expect(el.shadowRoot.querySelector(".home-first")).not.toBeNull(); // first-form panel instead of four zero tiles
    expect(el.shadowRoot.querySelector(".home-stats")).toBeNull();
    expect(el.shadowRoot.querySelector("c-jform-ask-agent").latestFormName).toBeUndefined();
  });

  it("offers Agentforce prompts only when JForm Agent is installed", async () => {
    getOverview.mockResolvedValue({ ...overview, formCount: 0, recent: [], agentInstalled: false });
    const el = mount();
    await flush();
    expect(el.shadowRoot.querySelector("c-jform-ask-agent")).toBeNull();
    expect(el.shadowRoot.querySelector(".home-first").textContent).not.toContain("Agentforce");
    expect(el.shadowRoot.querySelector(".howto").textContent).not.toContain("Agentforce");
  });

  it("points to Setup until every step is done", async () => {
    getOverview.mockResolvedValue({ ...overview, setupDone: 2, setupTotal: 6 });
    const el = mount();
    await flush();
    const banner = el.shadowRoot.querySelector(".home-setup");
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("2 of 6 steps done");
    const newForm = () => [...el.shadowRoot.querySelectorAll("lightning-button")].find((b) => b.label === "New form");
    expect(newForm().variant).toBe("neutral"); // Open Setup is the one filled button until setup is done

    getOverview.mockResolvedValue(overview);
    el.shadowRoot.querySelector("lightning-button-icon").click();
    await flush();
    expect(el.shadowRoot.querySelector(".home-setup")).toBeNull();
    expect(newForm().variant).toBe("brand");
  });

  it("shows Draft, Live and Closed as distinct status pills", async () => {
    getOverview.mockResolvedValue({
      ...overview,
      recent: [
        { id: "a1", name: "Live one", status: "Active", isActive: true, version: 2 },
        { id: "a2", name: "Closed one", status: "Inactive", isActive: false, version: 1 },
        { id: "a3", name: "Draft one", status: "Draft", isActive: false }
      ]
    });
    const el = mount();
    await flush();
    const pills = [...el.shadowRoot.querySelectorAll(".form-row .pill")].map((p) => [p.textContent, p.className]);
    expect(pills).toEqual([
      ["Live v2", "pill pill-live"],
      ["Closed", "pill pill-closed"],
      ["Draft", "pill"]
    ]);
  });

  it("reports a load failure and can retry", async () => {
    getOverview.mockRejectedValueOnce({ body: { message: "No access" } }).mockResolvedValueOnce(overview);
    const el = mount();
    await flush();
    expect(el.shadowRoot.querySelector(".home-alert").textContent).toBe("No access");
    el.shadowRoot.querySelector("lightning-button-icon").click();
    await flush();
    expect(el.shadowRoot.querySelector(".home-alert")).toBeNull();
    expect(el.shadowRoot.querySelectorAll(".form-row")).toHaveLength(2);
  });
});

describe("c-jform-home All forms", () => {
  const FORM_LIST = { type: "standard__objectPage", attributes: { objectApiName: "Form__c", actionName: "list" }, state: { filterName: "All" } };

  it("opens the Forms list view, not the workspace", async () => {
    getOverview.mockResolvedValue(overview);
    const el = mount();
    await flush();
    [...el.shadowRoot.querySelectorAll("button.link")].find((b) => b.textContent.trim() === "All forms").click();
    expect(mockNavigate).toHaveBeenCalledWith(FORM_LIST);
  });

  it("puts All forms next to New form in the header", async () => {
    getOverview.mockResolvedValue(overview);
    const el = mount();
    await flush();
    const buttons = [...el.shadowRoot.querySelectorAll(".home-actions lightning-button")];
    expect(buttons.map((b) => b.label)).toEqual(["New form", "All forms"]);
    buttons[1].click();
    expect(mockNavigate).toHaveBeenCalledWith(FORM_LIST);
  });
});

describe("c-jform-home opening a form", () => {
  it("marks the clicked row as opening, quiets the others and navigates once", async () => {
    getOverview.mockResolvedValue(overview);
    const el = mount();
    await flush();
    const rows = () => [...el.shadowRoot.querySelectorAll(".form-row")];
    rows()[0].click();
    await flush();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls[0][0]).toEqual({ type: "standard__navItemPage", attributes: { apiName: "JForm_Workspace" }, state: { c__formid: "a001" } });
    const [opening, waiting] = rows();
    expect(opening.classList.contains("form-row-opening")).toBe(true);
    expect(opening.getAttribute("aria-busy")).toBe("true");
    expect(opening.querySelector(".form-opening").textContent).toBe("Opening…");
    expect(opening.querySelector(".form-date")).toBeNull(); // the spinner takes the date's place
    expect(waiting.classList.contains("form-row-waiting")).toBe(true);
    expect(waiting.querySelector(".form-date")).not.toBeNull();
    expect(rows().every((r) => r.disabled)).toBe(true);
    // a second click while the first navigation is on its way changes nothing
    waiting.click();
    opening.click();
    await flush();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("puts the row back when the page comes back to Home, not while the workspace opens", async () => {
    getOverview.mockResolvedValue(overview);
    const el = mount();
    await flush();
    el.shadowRoot.querySelector(".form-row").click();
    await flush();
    CurrentPageReference.emit({ type: "standard__navItemPage", attributes: { apiName: "JForm_Workspace" }, state: { c__formid: "a001" } });
    await flush();
    expect(el.shadowRoot.querySelector(".form-row-opening")).not.toBeNull();
    CurrentPageReference.emit({ type: "standard__namedPage", attributes: { pageName: "home" } });
    await flush();
    expect(el.shadowRoot.querySelector(".form-row-opening")).toBeNull();
    expect(el.shadowRoot.querySelector(".form-row-waiting")).toBeNull();
    expect([...el.shadowRoot.querySelectorAll(".form-row")].some((r) => r.disabled)).toBe(false);
  });

  it("gives up the opening state after the timeout if the workspace never arrives", async () => {
    jest.useFakeTimers();
    getOverview.mockResolvedValue(overview);
    const el = mount();
    await Promise.resolve();
    await Promise.resolve();
    el.shadowRoot.querySelector(".form-row").click();
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".form-row-opening")).not.toBeNull();
    jest.advanceTimersByTime(10000);
    await Promise.resolve();
    expect(el.shadowRoot.querySelector(".form-row-opening")).toBeNull();
    jest.useRealTimers();
  });
});

describe("c-jform-home coming back", () => {
  it("reloads the overview when Home shows again, keeping the old list on screen meanwhile", async () => {
    getOverview.mockResolvedValue(overview);
    const el = mount();
    CurrentPageReference.emit({ type: "standard__namedPage", attributes: { pageName: "home" } });
    await flush();
    expect(getOverview).toHaveBeenCalledTimes(1);
    CurrentPageReference.emit({ type: "standard__navItemPage", attributes: { apiName: "JForm_Workspace" }, state: { c__formid: "a003" } });
    await flush();
    expect(getOverview).toHaveBeenCalledTimes(1);
    let resolve;
    const fresh = { ...overview, formCount: 4, recent: [{ ...overview.recent[1], id: "a003", name: "Winter Clinic" }, ...overview.recent] };
    getOverview.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    CurrentPageReference.emit({ type: "standard__namedPage", attributes: { pageName: "home" } });
    await flush();
    expect(getOverview).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot.querySelector(".home-loading")).toBeNull();
    expect(el.shadowRoot.querySelectorAll(".form-row").length).toBe(2);
    resolve(fresh);
    await flush();
    expect(el.shadowRoot.querySelectorAll(".form-row").length).toBe(3);
    expect(el.shadowRoot.querySelector(".form-row").textContent).toContain("Winter Clinic");
  });
});

describe("c-jform-home banner", () => {
  it("shows the form picture, with the Agentforce badge when JForm Agent is installed", async () => {
    getOverview.mockResolvedValue(overview);
    const el = mount();
    await flush();
    const art = el.shadowRoot.querySelector(".home-art");
    expect(art.getAttribute("aria-hidden")).toBe("true");
    expect(art.querySelector(".art-form")).not.toBeNull();
    expect(art.querySelector(".art-record-name").textContent).toBe("Jordan Lee");
    expect(art.querySelector(".art-badge")).not.toBeNull();
    // the banner keeps two actions; Agentforce prompts stay in their own card
    expect([...el.shadowRoot.querySelectorAll(".home-actions lightning-button")].map((b) => b.label)).toEqual(["New form", "All forms"]);
  });

  it("leaves the Agentforce badge out without JForm Agent", async () => {
    getOverview.mockResolvedValue({ ...overview, agentInstalled: false });
    const el = mount();
    await flush();
    expect(el.shadowRoot.querySelector(".home-art .art-form")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".art-badge")).toBeNull();
  });
});
