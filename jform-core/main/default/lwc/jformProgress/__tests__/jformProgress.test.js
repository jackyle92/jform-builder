import { createElement } from "lwc";
import JformProgress from "c/jformProgress";

const flush = () => Promise.resolve();

function mount(props) {
  const el = createElement("c-jform-progress", { is: JformProgress });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-progress", () => {
  it("shows the step and one bar as wide as the percent", async () => {
    const el = mount({ step: 2, steps: 4, label: "Contact", percent: 50, segments: null });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-progress-text").textContent).toBe("Step 2 of 4 · Contact50%");
    expect(el.shadowRoot.querySelector(".jf-progress-fill").style.width).toBe("50%");
    expect(el.shadowRoot.querySelector(".jf-progress-track").getAttribute("aria-valuenow")).toBe("50");
    expect(el.shadowRoot.querySelector(".jf-progress-segments")).toBeNull();
  });

  it("shows a segment per page when it is given segments", async () => {
    const segments = [
      { key: "seg0", style: "width:100%" },
      { key: "seg1", style: "width:40%" },
      { key: "seg2", style: "width:0%" }
    ];
    const el = mount({ step: 2, steps: 3, label: "Details", percent: 47, segments });
    await flush();
    expect([...el.shadowRoot.querySelectorAll(".jf-progress-seg-fill")].map((f) => f.style.width)).toEqual(["100%", "40%", "0%"]);
    expect(el.shadowRoot.querySelector(".jf-progress-segments").getAttribute("aria-valuenow")).toBe("47");
    expect(el.shadowRoot.querySelector(".jf-progress-track")).toBeNull();
  });
});
