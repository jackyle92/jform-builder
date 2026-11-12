import { clampWidth, keyAction, startPanelDrag, panelStyle, loadPanelPrefs, savePanelPrefs, PANEL_LIMITS } from "c/jformPanelResize";

describe("jformPanelResize", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps widths between each panel's minimum and half the window", () => {
    window.innerWidth = 1400;
    expect(clampWidth("palette", 50)).toBe(PANEL_LIMITS.palette.min);
    expect(clampWidth("props", 5000)).toBe(PANEL_LIMITS.props.max);
    window.innerWidth = 800;
    expect(clampWidth("design", 700)).toBe(400); // half the window beats the panel's own maximum
    expect(panelStyle(320)).toBe("flex:0 0 320px;width:320px;max-width:none");
    expect(panelStyle(undefined)).toBe("");
  });

  it("maps keys by the panel's side and offers reset and toggle", () => {
    expect(keyAction({ key: "ArrowRight" }, "left")).toEqual({ type: "resize", delta: 16 });
    expect(keyAction({ key: "ArrowRight" }, "right")).toEqual({ type: "resize", delta: -16 });
    expect(keyAction({ key: "Home" }, "left")).toEqual({ type: "reset" });
    expect(keyAction({ key: " " }, "left")).toEqual({ type: "toggle" });
    expect(keyAction({ key: "Tab" }, "left")).toBeNull();
  });

  it("follows the pointer while dragging and lets go on pointerup", () => {
    window.innerWidth = 1400;
    const widths = [];
    const onEnd = jest.fn();
    startPanelDrag({ clientX: 500, preventDefault() {} }, { panel: "props", width: 300, side: "right", onResize: (w) => widths.push(w), onEnd });
    window.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 460 })); // a right panel grows as the pointer moves left
    window.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 900 }));
    window.dispatchEvent(new Event("pointerup"));
    window.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 100 }));
    expect(widths).toEqual([340, PANEL_LIMITS.props.min]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("remembers preferences per browser and survives bad storage", () => {
    savePanelPrefs({ props: { width: 400, collapsed: false } });
    expect(loadPanelPrefs()).toEqual({ props: { width: 400, collapsed: false } });
    window.localStorage.setItem("jform.workspace.panels", "{not json");
    expect(loadPanelPrefs()).toEqual({});
  });
});
