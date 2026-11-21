// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createController, type Controller } from "./controller";

// WHEEL_STOP_MS in controller.ts: the quiet time that ends a wheel burst.
const WHEEL_STOP_MS = 100;
// One fake animation frame (fake-timers runs rAF every 16 ms).
const FRAME = 16;

describe("controller settle timing", () => {
  let root: HTMLElement;
  let layer: HTMLElement;
  let viewer: Controller;
  let settles: number[];
  let t0: number;

  const at = () => performance.now() - t0;
  const wheel = (deltaY = -100) =>
    root.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
  const pointer = (target: EventTarget, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, isPrimary: true, pointerType: "mouse", buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, bubbles: true }),
    );
  const gesture = () => root.hasAttribute("data-gesture");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    root = document.createElement("div");
    layer = document.createElement("div");
    root.append(layer);
    document.body.append(root);
    Object.defineProperty(root, "clientWidth", { value: 800 });
    Object.defineProperty(root, "clientHeight", { value: 600 });
    root.setPointerCapture = () => {};
    root.hasPointerCapture = () => false;
    root.releasePointerCapture = () => {};
    viewer = createController(root, layer, { content: { w: 3000, h: 3000 }, initial: { x: -1100, y: -1200, scale: 1 } });
    vi.advanceTimersByTime(100);
    settles = [];
    viewer.onSettle(() => settles.push(at()));
    t0 = performance.now();
  });

  afterEach(() => {
    viewer.dispose();
    root.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("settles within one frame of the wheel stop when no align is needed", () => {
    wheel();
    expect(gesture()).toBe(true);
    vi.advanceTimersByTime(WHEEL_STOP_MS + FRAME);
    expect(settles).toHaveLength(1);
    expect(settles[0]).toBeLessThanOrEqual(WHEEL_STOP_MS + FRAME);
    expect(gesture()).toBe(false);
  });

  it("a further wheel notch inside the window cancels the settle", () => {
    wheel();
    vi.advanceTimersByTime(60);
    wheel();
    vi.advanceTimersByTime(WHEEL_STOP_MS - 10);
    expect(settles).toEqual([]);
    expect(gesture()).toBe(true);
    vi.advanceTimersByTime(10 + FRAME);
    expect(settles).toHaveLength(1);
    expect(settles[0]).toBeGreaterThanOrEqual(60 + WHEEL_STOP_MS);
    expect(settles[0]).toBeLessThanOrEqual(60 + WHEEL_STOP_MS + FRAME);
  });

  it("a pan-only gesture keeps the layer promoted at settle (no re-raster)", () => {
    pointer(root, "pointerdown", 400, 300);
    for (let i = 1; i <= 5; i++) {
      pointer(window, "pointermove", 400 - 10 * i, 300 - 5 * i);
      vi.advanceTimersByTime(FRAME);
    }
    // Rest before lifting: no inertia.
    vi.advanceTimersByTime(300);
    pointer(window, "pointerup", 350, 275);
    vi.advanceTimersByTime(1000);
    expect(settles).toHaveLength(1);
    expect(viewer.transform.scale).toBe(1);
    expect(layer.style.willChange).toBe("transform");
  });

  it("a gesture that changed the scale drops the promotion at settle (re-raster)", () => {
    pointer(root, "pointerdown", 400, 300);
    pointer(window, "pointermove", 380, 290);
    vi.advanceTimersByTime(300);
    pointer(window, "pointerup", 380, 290);
    vi.advanceTimersByTime(1000);
    expect(layer.style.willChange).toBe("transform");

    wheel();
    vi.advanceTimersByTime(1000);
    expect(viewer.transform.scale).not.toBe(1);
    expect(settles).toHaveLength(2);
    expect(layer.style.willChange).toBe("");

    // The new scale is what is rastered now: a pan at it keeps the promotion.
    viewer.center();
    vi.advanceTimersByTime(1000);
    expect(settles).toHaveLength(3);
    expect(layer.style.willChange).toBe("transform");
  });
});
