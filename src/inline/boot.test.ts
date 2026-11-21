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

describe("boot-view live fill", () => {
  type Table = Record<string, Record<string, string[]>>;

  const variant = (lang: string, ...indexes: number[]) =>
    `<div data-l="${lang}">${indexes.map((i) => `<span data-live="${i}">stale</span>`).join(" ")}</div>`;
  const sticker = (slug: string, ...variants: string[]) =>
    `<button class="sticker" data-slug="${slug}">${variants.join("")}</button>`;
  const mount = (canvas: string, table?: Table | string) => {
    const json = typeof table === "string" ? table : JSON.stringify(table);
    document.body.innerHTML =
      `<div id="canvas">${canvas}</div>` +
      (table === undefined ? "" : `<script type="application/json" id="live-exprs">${json}</script>`);
  };
  const live = () => [...document.querySelectorAll<HTMLElement>("[data-live]")];
  const filled = (node: Element) => node.hasAttribute("data-filled");

  it("sets the text and marks the node filled", () => {
    mount(sticker("date", variant("en", 0)), { date: { en: ["new Date(0).getUTCFullYear()"] } });
    runBootView();
    const [node] = live();
    expect(node.textContent).toBe("1970");
    expect(node.getAttribute("data-filled")).toBe("");
  });

  it("fills every language variant, hidden ones included, from its own table entry", () => {
    mount(
      sticker("date", variant("en", 0, 1), variant("ja", 0)).replace('data-l="ja"', 'data-l="ja" hidden'),
      { date: { en: ["'en0'", "'en1'"], ja: ["'ja0'"] } },
    );
    runBootView();
    expect(live().map((n) => n.textContent)).toEqual(["en0", "en1", "ja0"]);
    expect(live().every(filled)).toBe(true);
  });

  it("looks each node up by its own sticker, language and index", () => {
    mount(sticker("a", variant("en", 1)) + sticker("b", variant("en", 0), variant("zh-Hans", 0)), {
      a: { en: ["'a0'", "'a1'"] },
      b: { en: ["'b-en'"], "zh-Hans": ["'b-zh'"] },
    });
    runBootView();
    expect(live().map((n) => n.textContent)).toEqual(["a1", "b-en", "b-zh"]);
  });

  it("fills without a canvas step to depend on", () => {
    document.body.innerHTML =
      sticker("date", variant("en", 0)) +
      `<script type="application/json" id="live-exprs">{"date":{"en":["1 + 1"]}}</script>`;
    runBootView();
    expect(live()[0].textContent).toBe("2");
  });

  it("fills alongside the hash centring", () => {
    mount(sticker("date", variant("en", 0)).replace(">", ' data-cx="1725" data-cy="1210">'), {
      date: { en: ["40 + 2"] },
    });
    history.replaceState(null, "", "/#date");
    runBootView();
    expect(live()[0].textContent).toBe("42");
    expect(window.__boot).toBeDefined();
  });

  it("leaves nodes hidden without throwing when the table is missing or malformed", () => {
    for (const table of [undefined, "{not json", "", "null", '{"date":null}']) {
      mount(sticker("date", variant("en", 0)), table as Table | string | undefined);
      expect(() => runBootView()).not.toThrow();
      expect(live().some(filled)).toBe(false);
      expect(live()[0].textContent).toBe("stale");
    }
  });

  it("leaves a node with no table entry unfilled and fills the rest", () => {
    mount(sticker("date", variant("en", 0, 5), variant("ja", 0)), {
      date: { en: ["'ok'"] },
    });
    runBootView();
    expect(live().map(filled)).toEqual([true, false, false]);
    expect(live().map((n) => n.textContent)).toEqual(["ok", "stale", "stale"]);
  });

  it("leaves a node with no sticker or language ancestor unfilled", () => {
    mount('<span data-live="0">stale</span>' + sticker("date", '<span data-live="0">stale</span>'), {
      date: { en: ["'no'"] },
    });
    runBootView();
    expect(live().some(filled)).toBe(false);
  });

  it("keeps a node unfilled when its expression throws, and still fills the next one", () => {
    mount(sticker("date", variant("en", 0, 1, 2)), {
      date: { en: ["missing.value", "'ok'", "(1 +"] },
    });
    expect(() => runBootView()).not.toThrow();
    expect(live().map(filled)).toEqual([false, true, false]);
    expect(live().map((n) => n.textContent)).toEqual(["stale", "ok", "stale"]);
  });
});
