import { createElement } from "lwc";
import JformPropertySection from "c/jformPropertySection";

const flush = () => Promise.resolve();

function mount(props) {
  const el = createElement("c-jform-property-section", { is: JformPropertySection });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c-jform-property-section", () => {
  it("shows its settings when open, without the summary", async () => {
    const el = mount({ label: "Layout", open: true, summary: "100% wide" });
    await flush();
    const head = el.shadowRoot.querySelector(".pp-sec-head");
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(head.querySelector(".pp-group").textContent).toBe("Layout");
    expect(head.querySelector(".pp-sec-sum")).toBeNull();
    expect(el.shadowRoot.querySelector(".pp-sec-body").hidden).toBe(false);
  });

  it("folds its settings away and shows the summary instead", async () => {
    const el = mount({ label: "Layout", open: false, summary: "100% wide" });
    await flush();
    expect(el.shadowRoot.querySelector(".pp-sec-head").getAttribute("aria-expanded")).toBe("false");
    expect(el.shadowRoot.querySelector(".pp-sec-sum").textContent).toBe("100% wide");
    expect(el.shadowRoot.querySelector(".pp-sec-body").hidden).toBe(true);
  });

  it("asks the panel to open or fold it when the header is clicked", async () => {
    const el = mount({ label: "Logic", open: false });
    const toggle = jest.fn();
    el.addEventListener("toggle", toggle);
    await flush();
    el.shadowRoot.querySelector(".pp-sec-head").click();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
