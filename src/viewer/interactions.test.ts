// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appStore } from "../lib/appState";
import { type Transform, viewTransformFor } from "../lib/geometry";
import { initInteractions, placeTip } from "./interactions";
import { prefetchDescription } from "./prefetch";

vi.mock("./prefetch", () => ({ prefetchDescription: vi.fn() }));

const TIP = { w: 120, h: 30 };
const SLUGS = new Set(["dark", "eana"]);

describe("placeTip", () => {
  const view = { w: 1000, h: 600 };

  it("puts the left edge at the cursor and the bottom edge 10px above it", () => {
    expect(placeTip({ x: 300, y: 200 }, TIP, view)).toEqual({ x: 300, y: 160 });
  });

  it("keeps the tip inside the viewport on every side", () => {
    expect(placeTip({ x: 990, y: 200 }, TIP, view).x).toBe(880);
    expect(placeTip({ x: 300, y: 12 }, TIP, view).y).toBe(0);
    expect(placeTip({ x: 300, y: 5000 }, TIP, view).y).toBe(570);
    expect(placeTip({ x: -40, y: 200 }, TIP, view).x).toBe(0);
  });

  it("pins a tip wider than the viewport to the origin", () => {
    expect(placeTip({ x: 50, y: 50 }, { w: 2000, h: 900 }, view)).toEqual({ x: 0, y: 0 });
  });
});

describe("initInteractions", () => {
  let canvas: HTMLElement;
  let dispose: () => void;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let coarse: { matches: boolean };
  let gestureStart: (() => void) | undefined;
  let settle: ((t: Transform) => void) | undefined;
  let controller: Parameters<typeof initInteractions>[0]["controller"];
  const setTransform = vi.fn();

  const dark = () => canvas.querySelector<HTMLElement>('[data-slug="dark"]')!;
  const eana = () => canvas.querySelector<HTMLElement>('[data-slug="eana"]')!;
  const clip = (b: HTMLElement) => b.querySelector<HTMLElement>(".clip")!;
  const tip = () => document.getElementById("tip");

  const fire = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  const hover = (el: HTMLElement, x = 400, y = 300, from: HTMLElement | null = null) =>
    fire(el, "mouseover", { clientX: x, clientY: y, relatedTarget: from });
  const move = (el: EventTarget, x: number, y: number) => fire(el, "pointermove", { clientX: x, clientY: y });
  const frame = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(0);
  };
  const setHash = (hash: string) => history.replaceState(null, "", `/${hash}`);
  const navigate = (hash: string) => {
    setHash(hash);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const start = () => (dispose = initInteractions({ canvas, controller, slugs: SLUGS }));
  const expected = (slug: string) => {
    const b = slug === "dark" ? { x: 1285, y: 1260 } : { x: 1500, y: 1500 };
    return viewTransformFor(b, 1, { w: innerWidth, h: innerHeight });
  };

  beforeEach(() => {
    document.body.innerHTML = `<div id="canvas">
      <button class="sticker" data-slug="dark" data-cx="1285" data-cy="1260" data-titles='{"en":"Dark mode","ja":"ダークモード"}'><span class="clip"><i></i></span><span class="sr-only">Dark mode</span></button>
      <button class="sticker" data-slug="eana" data-cx="1500" data-cy="1500" data-titles='{"en":"Eana"}'><span class="clip"><i></i></span></button>
      <button class="sticker" data-slug="ghost" data-cx="10" data-cy="10" data-titles='{"en":"Ghost"}'><span class="clip"><i></i></span></button>
    </div>`;
    canvas = document.getElementById("canvas")!;

    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.set(++nextFrame, cb);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    coarse = { matches: false };
    vi.stubGlobal("matchMedia", () => coarse);
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(TIP.w);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(TIP.h);

    gestureStart = settle = undefined;
    setTransform.mockClear();
    vi.mocked(prefetchDescription).mockClear();
    controller = {
      transform: { x: 0, y: 0, scale: 1 },
      setTransform,
      onGestureStart: (cb) => ((gestureStart = cb), () => (gestureStart = undefined)),
      onSettle: (cb) => ((settle = cb), () => (settle = undefined)),
    };

    setHash("");
    appStore.setState({ language: "en", selectedSlug: null });
  });

  afterEach(() => {
    dispose?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  describe("tooltip", () => {
    it("does not exist until the first hover", () => {
      start();
      expect(tip()).toBeNull();
      hover(clip(dark()));
      expect(tip()).not.toBeNull();
    });

    it("shows the localised title at the cursor and moves by transform only", () => {
      start();
      hover(clip(dark()), 400, 300);
      const el = tip()!;
      expect(el.getAttribute("role")).toBe("tooltip");
      expect(el.parentElement).toBe(document.body);
      expect(el.hidden).toBe(false);
      expect(el.textContent).toBe("Dark mode");
      expect(el.style.transform).toBe("translate(400px, 260px)");
      expect(el.style.left).toBe("");
      expect(el.style.top).toBe("");
    });

    it("writes the position once per frame, from the latest pointer", () => {
      start();
      hover(clip(dark()), 400, 300);
      const writes = vi.spyOn(tip()!.style, "transform", "set");
      move(clip(dark()), 410, 310);
      move(clip(dark()), 420, 320);
      move(clip(dark()), 430, 330);
      expect(writes).not.toHaveBeenCalled();
      frame();
      expect(writes).toHaveBeenCalledTimes(1);
      expect(tip()!.style.transform).toBe("translate(430px, 290px)");
    });

    it("follows a rapid hover from one sticker to the next", () => {
      start();
      hover(clip(dark()));
      hover(clip(eana()), 600, 300, clip(dark()));
      expect(tip()!.textContent).toBe("Eana");
      expect(tip()!.hidden).toBe(false);
      expect(vi.mocked(prefetchDescription)).toHaveBeenCalledWith("dark", "en");
      expect(vi.mocked(prefetchDescription)).toHaveBeenCalledWith("eana", "en");
    });

    it("hides when the pointer leaves the clip, and not when it moves within it", () => {
      start();
      hover(clip(dark()));
      fire(clip(dark()), "mouseout", { relatedTarget: clip(dark()).firstElementChild });
      expect(tip()!.hidden).toBe(false);
      fire(clip(dark()), "mouseout", { relatedTarget: document.body });
      expect(tip()!.hidden).toBe(true);
    });

    it("hides when a pointermove finds the pointer over something else", () => {
      start();
      hover(clip(dark()));
      move(document.body, 900, 700);
      expect(tip()!.hidden).toBe(true);
    });

    it("hides when the window loses focus", () => {
      start();
      hover(clip(dark()));
      window.dispatchEvent(new Event("blur"));
      expect(tip()!.hidden).toBe(true);
    });

    it("stays hidden for a coarse pointer, evaluated at event time", () => {
      start();
      coarse.matches = true;
      hover(clip(dark()));
      expect(tip()).toBeNull();
      coarse.matches = false;
      hover(clip(dark()));
      expect(tip()!.hidden).toBe(false);
      coarse.matches = true;
      move(clip(dark()), 405, 300);
      hover(clip(eana()), 600, 300, clip(dark()));
      expect(tip()!.hidden).toBe(true);
    });

    it("ignores touch pointers", () => {
      start();
      hover(clip(dark()));
      const touch = new MouseEvent("pointermove", { bubbles: true, clientX: 900, clientY: 700 });
      Object.defineProperty(touch, "pointerType", { value: "touch" });
      document.body.dispatchEvent(touch);
      expect(tip()!.hidden).toBe(false);
    });

    it("hides on a gesture and comes back on the first move after it settles", () => {
      start();
      hover(clip(dark()));
      gestureStart!();
      expect(tip()!.hidden).toBe(true);
      move(clip(dark()), 410, 300);
      expect(tip()!.hidden).toBe(true);
      settle!(controller.transform);
      move(clip(dark()), 412, 300);
      expect(tip()!.hidden).toBe(false);
      expect(tip()!.textContent).toBe("Dark mode");
    });

    it("refreshes the text when the language changes while visible, and on the next hover", () => {
      start();
      hover(clip(dark()));
      appStore.setState({ language: "ja" });
      expect(tip()!.textContent).toBe("ダークモード");
      fire(clip(dark()), "mouseout", { relatedTarget: document.body });
      appStore.setState({ language: "en" });
      expect(tip()!.hidden).toBe(true);
      hover(clip(dark()));
      expect(tip()!.textContent).toBe("Dark mode");
    });

    it("falls back to English for a sticker without the language", () => {
      appStore.setState({ language: "ja" });
      start();
      hover(clip(eana()));
      expect(tip()!.textContent).toBe("Eana");
    });

    it("does not show for broken titles", () => {
      eana().dataset.titles = "{oops";
      start();
      hover(clip(eana()));
      expect(tip()?.hidden ?? true).toBe(true);
    });

    it("is not shown for keyboard focus, but warms the description", () => {
      start();
      fire(dark(), "focusin");
      expect(tip()).toBeNull();
      expect(vi.mocked(prefetchDescription)).toHaveBeenCalledWith("dark", "en");
    });
  });

  describe("selection", () => {
    it("selects, pushes the hash and re-centres once on a click inside the clip", () => {
      start();
      const before = history.length;
      fire(clip(dark()).firstElementChild!, "click", { detail: 1 });
      expect(appStore.getState().selectedSlug).toBe("dark");
      expect(location.hash).toBe("#dark");
      expect(history.length).toBe(before + 1);
      expect(setTransform).toHaveBeenCalledTimes(1);
      expect(setTransform).toHaveBeenCalledWith(expected("dark"));
    });

    it("re-centres at the current scale and for the current viewport side", () => {
      controller.transform.scale = 2;
      start();
      fire(clip(eana()), "click", { detail: 1 });
      expect(setTransform).toHaveBeenLastCalledWith(viewTransformFor({ x: 1500, y: 1500 }, 2, { w: 1280, h: 800 }));
      vi.stubGlobal("innerWidth", 5000);
      fire(clip(dark()), "click", { detail: 1 });
      const wide = setTransform.mock.lastCall![0];
      expect(wide).toEqual(viewTransformFor({ x: 1285, y: 1260 }, 2, { w: 5000, h: 800 }));
      expect(wide.x).toBe(320 + (5000 - 320) / 2 - 1285 * 2);
    });

    it("ignores a mouse click on the sticker box outside its clip", () => {
      start();
      fire(dark(), "click", { detail: 1 });
      expect(appStore.getState().selectedSlug).toBeNull();
      expect(setTransform).not.toHaveBeenCalled();
    });

    it("selects from the keyboard, where the click targets the button", () => {
      start();
      fire(dark(), "click", { detail: 0 });
      expect(appStore.getState().selectedSlug).toBe("dark");
      expect(location.hash).toBe("#dark");
    });

    it("ignores a sticker that is not in the slug set", () => {
      start();
      fire(clip(canvas.querySelector<HTMLElement>('[data-slug="ghost"]')!), "click", { detail: 1 });
      expect(appStore.getState().selectedSlug).toBeNull();
      expect(location.hash).toBe("");
    });

    it("ignores clicks that are not on a sticker", () => {
      start();
      fire(canvas, "click", { detail: 1 });
      expect(appStore.getState().selectedSlug).toBeNull();
    });
  });

  describe("hash", () => {
    it("selects a deep link on load without moving the view", () => {
      setHash("#dark");
      start();
      expect(appStore.getState().selectedSlug).toBe("dark");
      expect(setTransform).not.toHaveBeenCalled();
    });

    it("re-centres once for the popstate and hashchange of one navigation", () => {
      start();
      navigate("#eana");
      expect(appStore.getState().selectedSlug).toBe("eana");
      expect(setTransform).toHaveBeenCalledTimes(1);
      expect(setTransform).toHaveBeenCalledWith(expected("eana"));
    });

    it("follows back and forward to the hash and to none", () => {
      start();
      navigate("#dark");
      navigate("#eana");
      navigate("");
      expect(appStore.getState().selectedSlug).toBeNull();
      expect(setTransform).toHaveBeenCalledTimes(2);
      navigate("#dark");
      expect(setTransform).toHaveBeenCalledTimes(3);
    });

    it.each(["#nope", "#", "#%E0%A4%A", "#DARK", "#a/b", "#dark/"])("selects nothing for %s and stays quiet", (hash) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      setHash(hash);
      start();
      expect(appStore.getState().selectedSlug).toBeNull();
      navigate(hash);
      expect(appStore.getState().selectedSlug).toBeNull();
      expect(setTransform).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("removes the tooltip and every listener", () => {
      start();
      hover(clip(dark()));
      dispose();
      expect(tip()).toBeNull();
      expect(gestureStart).toBeUndefined();
      expect(settle).toBeUndefined();
      hover(clip(dark()));
      fire(clip(dark()), "click", { detail: 1 });
      navigate("#eana");
      appStore.setState({ language: "ja" });
      expect(tip()).toBeNull();
      expect(appStore.getState().selectedSlug).toBeNull();
      expect(setTransform).not.toHaveBeenCalled();
    });
  });
});
