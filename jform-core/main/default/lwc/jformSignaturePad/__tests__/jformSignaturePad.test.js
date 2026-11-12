import { createElement } from "lwc";
import JformSignaturePad, { isSignatureImage, inkLength, inkBounds, exportScale, SIGNATURE_PREFIX } from "c/jformSignaturePad";

const PNG = `${SIGNATURE_PREFIX}iVBORw0KGgo=`;

// jsdom has no canvas: a context that records calls, and a fixed image
let ctx;
beforeEach(() => {
  ctx = new Proxy({ calls: [] }, {
    get: (target, prop) => (prop in target ? target[prop] : (...args) => {
      target.calls.push(prop);
      return prop === "measureText" ? { width: 120 } : undefined;
    }),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    }
  });
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
  HTMLCanvasElement.prototype.toDataURL = jest.fn(() => PNG);
});

function mount(props = {}) {
  const el = createElement("c-jform-signature-pad", { is: JformSignaturePad });
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}
const flush = () => Promise.resolve();
const pointer = (type, x, y) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });

function draw(canvas, points) {
  canvas.dispatchEvent(pointer("pointerdown", ...points[0]));
  points.slice(1).forEach((p) => canvas.dispatchEvent(pointer("pointermove", ...p)));
  canvas.dispatchEvent(pointer("pointerup", ...points[points.length - 1]));
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("c/jformSignaturePad helpers", () => {
  it("recognises a PNG data URL and nothing else", () => {
    expect(isSignatureImage(PNG)).toBe(true);
    expect(isSignatureImage(SIGNATURE_PREFIX)).toBe(false);
    expect(isSignatureImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSignatureImage("Signature.png")).toBe(false);
    expect(isSignatureImage(undefined)).toBe(false);
  });

  it("measures the ink and the box around it", () => {
    const strokes = [[{ x: 10, y: 10 }, { x: 40, y: 50 }], [{ x: 60, y: 20 }]];
    expect(inkLength(strokes)).toBe(50);
    expect(inkBounds(strokes, 5)).toEqual({ x: 5, y: 5, width: 60, height: 50 });
    expect(inkBounds([], 5)).toBeNull();
  });

  it("saves at twice the pad's scale, smaller when that passes the size limit", () => {
    expect(exportScale({ width: 300, height: 100 })).toBe(2);
    expect(exportScale({ width: 1200, height: 100 })).toBe(1);
    expect(exportScale({ width: 300, height: 600 })).toBe(1);
  });
});

describe("c-jform-signature-pad drawing", () => {
  it("turns strokes into a PNG trimmed to the ink, in dark ink whatever the theme", async () => {
    const el = mount({ ariaLabel: "Signature" });
    await flush();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    const canvas = el.shadowRoot.querySelector("canvas");
    expect(canvas.getAttribute("aria-label")).toBe("Signature. Draw your signature with a mouse, finger or pen, or choose Type to type your name.");
    expect(el.shadowRoot.querySelector(".jf-sig-hint")).not.toBeNull();

    draw(canvas, [[10, 20], [30, 40], [60, 30], [90, 50]]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ value: PNG });
    expect(ctx.fillStyle).toBe("#1b1f2a");
    expect(ctx.calls).toContain("quadraticCurveTo");
    await flush();
    expect(el.shadowRoot.querySelector(".jf-sig-hint")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-sig-clear").disabled).toBe(false);
  });

  it("treats a slip of the pen as no signature", async () => {
    const el = mount();
    await flush();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    draw(el.shadowRoot.querySelector("canvas"), [[10, 10], [13, 12]]);
    expect(handler.mock.calls[0][0].detail).toEqual({ value: "" });
  });

  it("ignores the pointer when disabled, as on the builder canvas", async () => {
    const el = mount({ disabled: true });
    await flush();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    draw(el.shadowRoot.querySelector("canvas"), [[10, 10], [80, 60]]);
    expect(handler).not.toHaveBeenCalled();
    expect(el.shadowRoot.querySelectorAll(".jf-sig-mode")[1].disabled).toBe(true);
  });

  it("sizes the pad from config.height", async () => {
    const el = mount({ config: { height: "large" } });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-sig-pad").style.height).toBe("220px");
  });
});

describe("c-jform-signature-pad typing", () => {
  it("draws a typed name into the image, labelled for screen readers", async () => {
    const el = mount({ ariaLabel: "Signature" });
    await flush();
    const handler = jest.fn();
    el.addEventListener("change", handler);
    el.shadowRoot.querySelectorAll(".jf-sig-mode")[1].click();
    await flush();
    const input = el.shadowRoot.querySelector(".jf-sig-typed-input");
    expect(input.getAttribute("aria-label")).toBe("Signature: type your full name");
    input.value = "Jordan Lee";
    input.dispatchEvent(new CustomEvent("input"));
    expect(handler.mock.calls[0][0].detail).toEqual({ value: PNG });
    expect(ctx.calls).toContain("fillText");

    el.value = PNG;
    await flush();
    expect(el.shadowRoot.querySelector(".jf-sig-image").alt).toBe("Signature: Jordan Lee");

    input.value = "  ";
    input.dispatchEvent(new CustomEvent("input"));
    expect(handler.mock.calls[1][0].detail).toEqual({ value: "" });
  });

  it("offers drawing only when typing is switched off", async () => {
    const el = mount({ config: { allowTyped: false } });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-sig-modes")).toBeNull();
    expect(el.shadowRoot.querySelector("canvas").getAttribute("aria-label")).toBe("Draw your signature with a mouse, finger or pen.");
  });
});

describe("c-jform-signature-pad returning to the page", () => {
  it("shows a saved signature as an image until it is cleared", async () => {
    const el = mount({ value: PNG, config: { statement: "By signing, I agree." } });
    await flush();
    expect(el.shadowRoot.querySelector("canvas")).toBeNull();
    expect(el.shadowRoot.querySelector(".jf-sig-image").getAttribute("src")).toBe(PNG);
    expect(el.shadowRoot.querySelector(".jf-sig-statement").textContent).toBe("By signing, I agree.");

    const handler = jest.fn();
    el.addEventListener("change", handler);
    el.shadowRoot.querySelector(".jf-sig-clear").click();
    expect(handler.mock.calls[0][0].detail).toEqual({ value: "" });
    el.value = "";
    await flush();
    expect(el.shadowRoot.querySelector(".jf-sig-image")).toBeNull();
    expect(el.shadowRoot.querySelector("canvas")).not.toBeNull();
  });

  it("never shows a value that is not a PNG data URL", async () => {
    const el = mount({ value: "javascript:alert(1)" });
    await flush();
    expect(el.shadowRoot.querySelector(".jf-sig-image")).toBeNull();
    expect(el.shadowRoot.querySelector("canvas")).not.toBeNull();
  });
});
