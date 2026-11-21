// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { viewTransformFor } from "../lib/geometry";

const html = document.documentElement;

// Bundled in Node by ./test-bundles.setup.ts: esbuild cannot run under jsdom.
const { bootHead, bootView } = inject("inlineBundles");

const run = (code: string) => new Function(code)();
const runBootHead = () => run(bootHead);
const runBootView = () => run(bootView);

function stubMatchMedia(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: dark, media: query }));
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  html.removeAttribute("lang");
  html.className = "";
  html.style.cssText = "";
  document.body.innerHTML = "";
  delete window.__boot;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("boot-head", () => {
  it("applies saved ja + dark before paint", () => {
    localStorage.setItem("language", "ja");
    localStorage.setItem("theme", "dark");
    stubMatchMedia(false);
    runBootHead();
    expect(html.lang).toBe("ja");
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
  });

  it("lets an explicit light theme beat a dark system preference", () => {
    localStorage.setItem("language", "zh-Hans");
    localStorage.setItem("theme", "light");
    stubMatchMedia(true);
    runBootHead();
    expect(html.lang).toBe("zh-Hans");
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });

  it("falls back to en + system for invalid values", () => {
    localStorage.setItem("language", "fr");
    localStorage.setItem("theme", "blue");
    stubMatchMedia(false);
    runBootHead();
    expect(html.lang).toBe("en");
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });

  it("falls back to en + system when nothing is saved", () => {
    stubMatchMedia(false);
    runBootHead();
    expect(html.lang).toBe("en");
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("survives a throwing localStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    stubMatchMedia(false);
    expect(() => runBootHead()).not.toThrow();
    expect(html.lang).toBe("en");
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("survives a localStorage getter that throws", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(() => runBootHead()).not.toThrow();
      expect(html.lang).toBe("en");
    } finally {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("system theme follows prefers-color-scheme", () => {
    stubMatchMedia(true);
    runBootHead();
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
  });

  it("treats a missing matchMedia as light", () => {
    vi.stubGlobal("matchMedia", undefined);
    runBootHead();
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });
});

describe("boot-view", () => {
  const viewport = { w: 390, h: 844 };
  const cx = 1725;
  const cy = 1210;

  function mountCanvas(attrs = `data-cx="${cx}" data-cy="${cy}"`, slug = "dark") {
    document.body.innerHTML = `<div id="canvas"><a data-slug="css" data-cx="1500" data-cy="1500"></a><a data-slug="${slug}" ${attrs}></a></div>`;
    vi.stubGlobal("innerWidth", viewport.w);
    vi.stubGlobal("innerHeight", viewport.h);
  }

  const defaultView = {
    x: (viewport.w - 3000) / 2,
    y: (viewport.h - 3000) / 2,
    scale: 1,
  };

  it("centres on the hashed sticker", () => {
    mountCanvas();
    history.replaceState(null, "", "/#dark");
    runBootView();
    const expected = viewTransformFor({ x: cx, y: cy }, 1, viewport);
    expect(window.__boot).toEqual(expected);
    expect(document.getElementById("canvas")!.style.transform).toBe(
      `translate(${expected.x}px, ${expected.y}px) scale(1)`
    );
  });

  it("decodes a percent-encoded hash", () => {
    mountCanvas(undefined, "a b");
    history.replaceState(null, "", "/#a%20b");
    runBootView();
    expect(window.__boot).toEqual(viewTransformFor({ x: cx, y: cy }, 1, viewport));
  });

  it("centres the canvas when there is no hash", () => {
    mountCanvas();
    runBootView();
    expect(window.__boot).toEqual(defaultView);
    expect(document.getElementById("canvas")!.style.transform).toBe(
      `translate(${defaultView.x}px, ${defaultView.y}px) scale(1)`
    );
  });

  it("unknown hash leaves the default centred view", () => {
    mountCanvas();
    history.replaceState(null, "", "/#nope");
    runBootView();
    expect(window.__boot).toEqual(defaultView);
  });

  it("malformed percent escape leaves the default centred view", () => {
    mountCanvas();
    history.replaceState(null, "", "/#%E0%A4%A");
    expect(() => runBootView()).not.toThrow();
    expect(window.__boot).toEqual(defaultView);
  });

  it("missing or non-numeric centre data leaves the default centred view", () => {
    history.replaceState(null, "", "/#dark");
    for (const attrs of ["", 'data-cx="abc" data-cy="1210"', 'data-cx="1725" data-cy=""']) {
      mountCanvas(attrs);
      delete window.__boot;
      expect(() => runBootView()).not.toThrow();
      expect(window.__boot).toEqual(defaultView);
    }
  });

  it("returns quietly without a canvas", () => {
    history.replaceState(null, "", "/#dark");
    expect(() => runBootView()).not.toThrow();
    expect(window.__boot).toBeUndefined();
  });
});
