import { createElement } from "lwc";
import JformAskAgent from "c/jformAskAgent";

function mount(props = {}) {
  const el = createElement("c-jform-ask-agent", { is: JformAskAgent });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

const flush = () => Promise.resolve();

describe("c-jform-ask-agent", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
    jest.useFakeTimers();
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.useRealTimers();
  });

  it("uses the latest form name in the prompts", () => {
    const el = mount({ latestFormName: "Summer Clinic 2026" });
    const texts = [...el.shadowRoot.querySelectorAll(".ask-text")].map((n) => n.textContent);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toBe('Build a form like "Summer Clinic 2026" and call it "Autumn Clinic 2026". Show me the outline.');
    expect(texts[3]).toContain('"Summer Clinic 2026"');
  });

  it("falls back to a generic description without forms", () => {
    const el = mount();
    expect(el.shadowRoot.querySelector(".ask-text").textContent).toContain("our latest Summer form");
  });

  it("copies a prompt and shows Copied for two seconds", async () => {
    const el = mount({ latestFormName: "Summer" });
    const buttons = el.shadowRoot.querySelectorAll(".ask-copy");
    buttons[1].click();
    await flush();
    await flush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("booking request form"));
    expect(el.shadowRoot.querySelectorAll(".ask-copy")[1].label).toBe("Copied");
    jest.advanceTimersByTime(2000);
    await flush();
    expect(el.shadowRoot.querySelectorAll(".ask-copy")[1].label).toBe("Copy prompt");
  });

  it("still marks the prompt copied when the clipboard is blocked", async () => {
    navigator.clipboard.writeText = jest.fn().mockRejectedValue(new Error("denied"));
    const el = mount();
    el.shadowRoot.querySelector(".ask-copy").click();
    await flush();
    await flush();
    expect(el.shadowRoot.querySelector(".ask-copy").label).toBe("Copied");
  });

  it("hides and remembers the choice, and can be shown again", async () => {
    const el = mount();
    el.shadowRoot.querySelector("lightning-button-icon").click();
    await flush();
    expect(el.shadowRoot.querySelector(".ask")).toBeNull();
    expect(window.localStorage.getItem("jform.askAgent.hidden")).toBe("1");

    const second = mount();
    expect(second.shadowRoot.querySelector(".ask")).toBeNull();
    second.shadowRoot.querySelector(".ask-show").click();
    await flush();
    expect(second.shadowRoot.querySelector(".ask")).not.toBeNull();
    expect(window.localStorage.getItem("jform.askAgent.hidden")).toBeNull();
  });
});
