/**
 * Resizable side panels for the workspace: a pointer drag on a handle, keyboard steps,
 * limits per panel, and the widths and collapsed state remembered per browser.
 */
const STORE_KEY = "jform.workspace.panels";
export const KEY_STEP = 16;

/** Limits in pixels; max is also capped at half the window at drag time. */
export const PANEL_LIMITS = {
  palette: { min: 180, max: 480 },
  props: { min: 280, max: 640 },
  design: { min: 320, max: 720 }
};

export function loadPanelPrefs() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    return prefs && typeof prefs === "object" ? prefs : {};
  } catch (e) {
    return {};
  }
}

export function savePanelPrefs(prefs) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch (e) {
    /* private mode or blocked storage: the width still applies for this page */
  }
}

export function clampWidth(panel, width) {
  const limits = PANEL_LIMITS[panel];
  const max = Math.min(limits.max, Math.floor((window.innerWidth || limits.max * 2) * 0.5));
  return Math.max(limits.min, Math.min(Math.max(max, limits.min), Math.round(width)));
}

/** Inline style that pins a panel to a width; empty when the panel uses its default flex sizing. */
export function panelStyle(width) {
  return width ? `flex:0 0 ${width}px;width:${width}px;max-width:none` : "";
}

/**
 * Start a pointer drag. `side` is where the panel sits: a left panel grows as the pointer moves
 * right, a right panel grows as it moves left. onResize gets each clamped width; onEnd fires once.
 */
export function startPanelDrag(event, { panel, width, side, onResize, onEnd }) {
  const startX = event.clientX;
  const startWidth = width;
  const move = (e) => {
    const delta = e.clientX - startX;
    onResize(clampWidth(panel, side === "left" ? startWidth + delta : startWidth - delta));
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    if (onEnd) onEnd();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  event.preventDefault();
}

/** Keyboard on a handle: arrows resize by a step (direction follows the panel's side), Home resets, Enter or Space toggles. Returns an action or null. */
export function keyAction(event, side) {
  const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
  const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
  if (event.key === grow) return { type: "resize", delta: KEY_STEP };
  if (event.key === shrink) return { type: "resize", delta: -KEY_STEP };
  if (event.key === "Home") return { type: "reset" };
  if (event.key === "Enter" || event.key === " ") return { type: "toggle" };
  return null;
}
