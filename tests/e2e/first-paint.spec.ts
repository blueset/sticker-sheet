import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { contract } from "../contract.ts";
import { viewTransformFor } from "../../src/lib/geometry.ts";

interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: string;
}

const placement: Record<string, Placement> = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "tests/fixtures/placement.json"), "utf8"),
);

const SLUGS = Object.keys(placement);

// `stickerBox` differs from the baseline's layout maths by up to 0.5 px for 29
// stickers, so placement is compared within 1 px.
const PLACEMENT_TOLERANCE_PX = 1;

function sticker(page: Page, slug: string) {
  return page.locator(`button.sticker[data-slug="${slug}"]`);
}

const content = (slug: string) => `button.sticker[data-slug="${slug}"] .clip > [data-l]`;
const title = (slug: string) => `button.sticker[data-slug="${slug}"] [data-title-group] > [data-l]`;

// Computed `display` of each variant, so the check does not depend on layout
// (off-screen stickers are skipped by `content-visibility`).
async function variantDisplays(page: Page, selector: string): Promise<Record<string, string>> {
  return page.evaluate((sel) => {
    const out: Record<string, string> = {};
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      out[el.dataset.l ?? ""] = getComputedStyle(el).display;
    }
    return out;
  }, selector);
}

async function shownVariants(page: Page, selector: string): Promise<string[]> {
  const displays = await variantDisplays(page, selector);
  return Object.keys(displays).filter((lang) => displays[lang] !== "none");
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("no-JS: all 63 stickers painted at baseline positions", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(contract.stickers)).toHaveCount(63);

    const state = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("button.sticker[data-slug]")).map((el) => {
        const cs = getComputedStyle(el);
        const img = el.querySelector("img");
        return {
          slug: el.dataset.slug!,
          left: parseFloat(cs.left),
          top: parseFloat(cs.top),
          width: parseFloat(cs.width),
          height: parseFloat(cs.height),
          rotate: cs.rotate,
          position: cs.position,
          visibility: cs.visibility,
          image: img ? { complete: img.complete, naturalWidth: img.naturalWidth } : null,
        };
      }),
    );

    expect(state.map((s) => s.slug).sort()).toEqual([...SLUGS].sort());
    for (const s of state) {
      const want = placement[s.slug]!;
      expect(s.position, s.slug).toBe("absolute");
      expect(s.visibility, s.slug).toBe("visible");
      expect(Math.abs(s.left - want.left), `${s.slug} left`).toBeLessThanOrEqual(PLACEMENT_TOLERANCE_PX);
      expect(Math.abs(s.top - want.top), `${s.slug} top`).toBeLessThanOrEqual(PLACEMENT_TOLERANCE_PX);
      expect(Math.abs(s.width - want.width), `${s.slug} width`).toBeLessThanOrEqual(PLACEMENT_TOLERANCE_PX);
      expect(Math.abs(s.height - want.height), `${s.slug} height`).toBeLessThanOrEqual(PLACEMENT_TOLERANCE_PX);
      expect(s.rotate, `${s.slug} rotate`).toBe(want.rotate);
      if (s.image) {
        expect(s.image.complete, `${s.slug} image complete`).toBe(true);
        expect(s.image.naturalWidth, `${s.slug} image decoded`).toBeGreaterThan(0);
      }
    }
    expect(state.filter((s) => s.image).length).toBe(55);

    const liveVisible = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-live]")).filter(
          (n) => getComputedStyle(n).visibility !== "hidden",
        ).length,
    );
    expect(liveVisible, "[data-live] nodes visible without JS").toBe(0);
  });

  test("no-JS: a deep link does not hide the canvas", async ({ page }) => {
    await page.goto("/#riddler");
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-deep"))).toBe(false);
    await expect(page.locator(contract.viewer)).toHaveCSS("visibility", "visible");
  });
});

test("raster stickers are served as WebP through <picture>, SVGs stay plain", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined))));

  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>("button.sticker .clip img")).map((img) => ({
      src: img.getAttribute("src") ?? "",
      picture: img.parentElement?.tagName ?? "",
      sources: Array.from(img.parentElement?.querySelectorAll("source") ?? [], (s) => ({
        type: s.type,
        srcset: s.getAttribute("srcset"),
      })),
      currentSrc: new URL(img.currentSrc).pathname,
      naturalWidth: img.naturalWidth,
      width: img.getAttribute("width"),
      height: img.getAttribute("height"),
    })),
  );

  const png = images.filter((i) => i.src.endsWith(".png"));
  expect(png.length).toBe(7);
  for (const i of png) {
    const webp = i.src.replace(/\.png$/, ".webp");
    expect(i.picture, i.src).toBe("PICTURE");
    expect(i.sources, i.src).toEqual([{ type: "image/webp", srcset: webp }]);
    expect(i.currentSrc, i.src).toBe(webp);
    expect(i.naturalWidth, i.src).toBeGreaterThan(0);
  }

  const svg = images.filter((i) => i.src.endsWith(".svg"));
  expect(svg.length).toBe(48);
  for (const i of svg) {
    expect(i.picture, i.src).not.toBe("PICTURE");
    expect(i.currentSrc, i.src).toBe(i.src);
  }
  // The size attributes that reserve the layout are the same with or without the wrapper.
  for (const i of images) expect([i.width, i.height], i.src).not.toContain(null);
});

test("zero-area sticker is out of the tab order", async ({ page }) => {
  await page.goto("/");
  const zero = sticker(page, "test-1");
  await expect(zero).toHaveAttribute("tabindex", "-1");
  await expect(zero).toHaveAttribute("aria-hidden", "true");
  await expect(sticker(page, "react")).not.toHaveAttribute("tabindex", /.*/);
  await expect(sticker(page, "react")).not.toHaveAttribute("aria-hidden", /.*/);
});

test("language fallback with no JS framework", async ({ page }) => {
  await page.goto("/");
  const setLang = (lang: string) => page.evaluate((l) => document.documentElement.setAttribute("lang", l), lang);

  // Content in every language: only the active one is shown, for content and title alike.
  for (const lang of ["en", "zh-Hans", "ja"]) {
    await setLang(lang);
    expect(await shownVariants(page, content("bad-translations")), `bad-translations in ${lang}`).toEqual([lang]);
    expect(await shownVariants(page, title("bad-translations")), `bad-translations title in ${lang}`).toEqual([lang]);
  }

  // en-only content and title: the en variant stays shown in ja.
  await setLang("ja");
  expect(await shownVariants(page, content("dd-mmm-yyyy"))).toEqual(["en"]);
  expect(await shownVariants(page, title("dd-mmm-yyyy"))).toEqual(["en"]);

  // Content and title in en and ja only: ja shows ja, zh-Hans falls back to en.
  expect(await shownVariants(page, content("css-is-awesome"))).toEqual(["ja"]);
  await setLang("zh-Hans");
  expect(await shownVariants(page, content("css-is-awesome"))).toEqual(["en"]);
  expect(await shownVariants(page, title("css-is-awesome"))).toEqual(["en"]);

  // Title and content languages are independent: 24h has a ja title but en-only content.
  await setLang("ja");
  expect(await shownVariants(page, content("24h"))).toEqual(["en"]);
  expect(await shownVariants(page, title("24h"))).toEqual(["ja"]);

  // An image sticker has no content variants and its en-only title shows in ja.
  expect(await variantDisplays(page, content("react"))).toEqual({});
  expect(await shownVariants(page, title("react"))).toEqual(["en"]);

  // The accessible name is the localized title, not the content text.
  await expect(page.getByRole("button", { name: "誤字と変な翻訳", exact: true })).toHaveCount(1);
  await setLang("en");
  await expect(page.getByRole("button", { name: "Typos and weird translations", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "DD MMM YYYY", exact: true })).toHaveCount(1);
});

test("no third-party CSS or fonts", async ({ page, baseURL }) => {
  const requests: { url: string; type: string }[] = [];
  page.on("request", (req) => requests.push({ url: req.url(), type: req.resourceType() }));
  await page.goto("/", { waitUntil: "networkidle" });

  expect(requests.filter(({ url }) => /rsms\.me|cdnjs/.test(url))).toEqual([]);
  const origin = new URL(baseURL!).origin;
  expect(
    requests.filter(({ url, type }) => (type === "stylesheet" || type === "font") && new URL(url).origin !== origin),
  ).toEqual([]);
});

// The CJK (Noto Sans SC/JP) faces are large, so `boot-fonts.ts` only requests
// `cjk-fonts.css` (and the font files it references) once `html[lang]` is
// something other than "en" (see boot-fonts.ts). These specs guard that
// property directly: "no third-party CSS or fonts" above only filters by
// cross-origin `url` and would stay green even if the same-origin CJK
// stylesheet were requested unconditionally for `en`.
const isCjkStylesheet = (url: string) => /\/cjk-fonts\.[^/]*\.css(?:\?|$)/.test(url);
const isNotoCjkFont = (url: string) => /\/noto-sans-(?:jp|sc)-[^/]*\.woff2(?:\?|$)/.test(url);

test("en fresh load requests no CJK stylesheet or font", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  await page.goto("/", { waitUntil: "networkidle" });

  expect(requests.filter(isCjkStylesheet), "cjk-fonts.css requested for en").toEqual([]);
  expect(requests.filter(isNotoCjkFont), "a Noto Sans JP/SC file requested for en").toEqual([]);
});

for (const lang of ["ja", "zh-Hans"] as const) {
  test(`${lang} via localStorage requests the CJK stylesheet`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem("language", l), lang);
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));
    await page.goto("/", { waitUntil: "networkidle" });

    expect(requests.filter(isCjkStylesheet), `cjk-fonts.css requested for ${lang}`).not.toEqual([]);
  });
}

test("no layout shift", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __frames: number; __seen: Record<string, string[]> };
    w.__cls = 0;
    w.__frames = 0;
    w.__seen = {};
    // Not every engine reports layout-shift entries, so every box is also
    // sampled on every frame. Elements are tracked from the frame they first
    // exist (the parser streams the document in), and each must keep one rect.
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Unsupported entry type.
    }
    const sample = () => {
      const tracked: [string, Element][] = [];
      for (const selector of ["#canvas", "#controls"]) {
        const el = document.querySelector(selector);
        if (el) tracked.push([selector, el]);
      }
      for (const el of document.querySelectorAll("button.sticker[data-slug]")) {
        tracked.push([(el as HTMLElement).dataset.slug as string, el]);
      }
      if (tracked.length > 0) w.__frames += 1;
      for (const [key, el] of tracked) {
        const r = el.getBoundingClientRect();
        const rect = `${r.x},${r.y},${r.width},${r.height}`;
        const seen = (w.__seen[key] ??= []);
        if (!seen.includes(rect)) seen.push(rect);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined)));
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  // WebKit headless runs rAF at ~5 Hz for about a second after load while it
  // rasterises the sticker images (the baseline does the same): wait for
  // enough sampled frames rather than trusting the fixed 500 ms.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __frames: number }).__frames), { timeout: 5000 })
    .toBeGreaterThan(5);

  const { cls, frames, seen } = await page.evaluate(() => {
    const w = window as unknown as { __cls: number; __frames: number; __seen: Record<string, string[]> };
    return { cls: w.__cls, frames: w.__frames, seen: w.__seen };
  });
  expect(cls).toBe(0);
  expect(frames).toBeGreaterThan(5);
  expect(Object.keys(seen)).toHaveLength(65);
  expect(
    Object.entries(seen).filter(([, rects]) => rects.length > 1),
    "boxes moved between frames",
  ).toEqual([]);
});

// The parser may yield, and the browser paint, at any point while the stickers
// stream in. The frame sampler above only hits that window by chance, so this
// parks the parser right after the last sticker (a script that never answers
// until released) and requires the canvas to already sit where it ends up.
test("canvas is at its final position while the parser is parked after the stickers", async ({ page }) => {
  const marker = '<script type="application/json" id="live-exprs"';
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));

  await page.route("**/__hold.js", async (route) => {
    await released;
    await route.fulfill({ contentType: "text/javascript", body: "" });
  });
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const html = await (await route.fetch()).text();
      expect(html).toContain(marker);
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: html.replace(marker, `<script src="/__hold.js"></script>${marker}`),
      });
    },
  );

  const measure = () =>
    page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return {
        stickers: document.querySelectorAll("button.sticker").length,
        canvas: rect("#canvas"),
        react: rect('button.sticker[data-slug="react"]'),
      };
    });

  const held = page.waitForRequest("**/__hold.js");
  const navigation = page.goto("/", { waitUntil: "load" });
  try {
    await held;
    const parked = await measure();
    release();
    await navigation;
    const final = await measure();

    expect(parked.stickers).toBe(63);
    expect(parked.canvas).toEqual(final.canvas);
    expect(parked.react).toEqual(final.react);
  } finally {
    release();
    await navigation.catch(() => undefined);
  }
});

test("live nodes never show a stale value", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __live: { slug: string; text: string; expected: string }[] };
    w.__live = [];
    const expectedFor = (slug: string): string => {
      const now = new Date();
      if (slug === "dd-mmm-yyyy") {
        return now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      }
      if (slug === "yyyy-mm-dd") {
        return now.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
      }
      return "";
    };
    const sample = () => {
      for (const node of document.querySelectorAll<HTMLElement>("[data-live]")) {
        const slug = node.closest<HTMLElement>("[data-slug]")?.dataset.slug ?? "";
        const variant = node.closest<HTMLElement>("[data-l]");
        const shown =
          getComputedStyle(node).visibility === "visible" && !!variant && getComputedStyle(variant).display !== "none";
        if (shown) w.__live.push({ slug, text: node.textContent ?? "", expected: expectedFor(slug) });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));

  const samples = await page.evaluate(
    () => (window as unknown as { __live: { slug: string; text: string; expected: string }[] }).__live,
  );
  expect(new Set(samples.map((s) => s.slug))).toEqual(new Set(["dd-mmm-yyyy", "yyyy-mm-dd"]));
  for (const s of samples) {
    expect(s.text, `${s.slug} showed ${JSON.stringify(s.text)}`).toBe(s.expected);
  }

  for (const slug of ["dd-mmm-yyyy", "yyyy-mm-dd"]) {
    const node = sticker(page, slug).locator("[data-live]");
    await expect(node).toHaveAttribute("data-filled", "");
    await expect(node).toHaveText(samples.find((s) => s.slug === slug)!.expected);
  }
});

test("first frame uses the saved theme", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("language", "ja");
    requestAnimationFrame(() => {
      const root = document.documentElement;
      (window as unknown as { __first: unknown }).__first = {
        dark: root.classList.contains("dark"),
        colorScheme: root.style.colorScheme,
        lang: root.lang,
      };
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => "__first" in window);
  const first = await page.evaluate(() => (window as unknown as { __first: unknown }).__first);
  expect(first).toEqual({ dark: true, colorScheme: "dark", lang: "ja" });
});

test("a saved system theme follows the OS scheme without a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "system");
    requestAnimationFrame(() => {
      (window as unknown as { __firstDark: boolean }).__firstDark = document.documentElement.classList.contains("dark");
    });
  });
  const scheme = () =>
    page.evaluate(() => ({
      dark: document.documentElement.classList.contains("dark"),
      colorScheme: document.documentElement.style.colorScheme,
    }));

  await page.goto("/", { waitUntil: "load" });
  await page.waitForFunction(() => "__firstDark" in window);
  expect(await page.evaluate(() => (window as unknown as { __firstDark: boolean }).__firstDark)).toBe(true);
  expect(await scheme()).toEqual({ dark: true, colorScheme: "dark" });

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(scheme).toEqual({ dark: false, colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(scheme).toEqual({ dark: true, colorScheme: "dark" });
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("system");
});

test.describe("deep link", () => {
  interface Frame {
    visibility: string;
    x: number;
    y: number;
    scale: number;
  }

  // Records the wrapper's visibility and the canvas transform on every frame
  // from the one the canvas first exists in.
  const recordFrames = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __frames: Frame[]; __cls: number };
      w.__frames = [];
      w.__cls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
            if (!entry.hadRecentInput) w.__cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch {
        // Unsupported entry type; the frame samples still apply.
      }
      const sample = () => {
        const wrapper = document.getElementById("canvasWrapper");
        const canvas = document.getElementById("canvas");
        if (wrapper && canvas) {
          const m = new DOMMatrix(getComputedStyle(canvas).transform);
          w.__frames.push({ visibility: getComputedStyle(wrapper).visibility, x: m.e, y: m.f, scale: m.a });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

  const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);

  async function settle(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  function expectView(frame: Frame | undefined, want: { x: number; y: number; scale: number }, label: string): void {
    expect(frame, `${label}: no visible frame`).toBeDefined();
    expect(Math.abs(frame!.x - want.x), `${label} x ${frame!.x} vs ${want.x}`).toBeLessThanOrEqual(0.01);
    expect(Math.abs(frame!.y - want.y), `${label} y ${frame!.y} vs ${want.y}`).toBeLessThanOrEqual(0.01);
    expect(frame!.scale, `${label} scale`).toBe(want.scale);
  }

  // Same parking technique as the canvas spec above: the parser stops after
  // the last sticker, before `boot-view` centres on the hashed sticker.
  test("the canvas stays hidden until the hashed view is applied", async ({ page }) => {
    const slug = "riddler";
    const marker = '<script type="application/json" id="live-exprs"';
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));

    await recordFrames(page);
    await page.route("**/__hold.js", async (route) => {
      await released;
      await route.fulfill({ contentType: "text/javascript", body: "" });
    });
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        const html = await (await route.fetch()).text();
        expect(html).toContain(marker);
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: html.replace(marker, `<script src="/__hold.js"></script>${marker}`),
        });
      },
    );

    const held = page.waitForRequest("**/__hold.js");
    const navigation = page.goto(`/#${slug}`, { waitUntil: "load" });
    try {
      await held;
      const parked = await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          deep: document.documentElement.hasAttribute("data-deep"),
          wrapper: getComputedStyle(document.getElementById("canvasWrapper")!).visibility,
          controls: getComputedStyle(document.getElementById("controls") ?? document.body).visibility,
          stickers: document.querySelectorAll("button.sticker").length,
        };
      });
      release();
      await navigation;
      await settle(page);

      expect(parked).toEqual({ deep: true, wrapper: "hidden", controls: "visible", stickers: 63 });

      const { center, viewport, deep } = await page.evaluate((s) => {
        const el = document.querySelector<HTMLElement>(`[data-slug="${s}"]`)!;
        return {
          center: { x: +el.dataset.cx!, y: +el.dataset.cy! },
          viewport: { w: innerWidth, h: innerHeight },
          deep: document.documentElement.hasAttribute("data-deep"),
        };
      }, slug);
      expect(Math.hypot(center.x - 1500, center.y - 1500), "the slug must be far from the centre").toBeGreaterThan(300);
      expect(deep).toBe(false);

      const want = viewTransformFor(center, 1, viewport);
      const sampled = await frames(page);
      const visible = sampled.filter((f) => f.visibility === "visible");
      expectView(visible[0], want, "first visible frame");
      expect(
        visible.filter((f) => Math.abs(f.x - want.x) > 0.01 || Math.abs(f.y - want.y) > 0.01 || f.scale !== 1),
        "visible frames away from the hashed view",
      ).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0);
    } finally {
      release();
      await navigation.catch(() => undefined);
    }
  });

  for (const hash of ["#no-such-sticker", "#%E0%A4%A", "#"]) {
    test(`${hash} ends visible at the default view`, async ({ page }) => {
      await recordFrames(page);
      await page.goto(`/${hash}`, { waitUntil: "load" });
      await settle(page);
      const state = await page.evaluate(() => ({
        deep: document.documentElement.hasAttribute("data-deep"),
        visibility: getComputedStyle(document.getElementById("canvasWrapper")!).visibility,
        viewport: { w: innerWidth, h: innerHeight },
      }));
      expect(state.deep, "boot-view clears the gate").toBe(false);
      expect(state.visibility).toBe("visible");
      const want = { x: (state.viewport.w - 3000) / 2, y: (state.viewport.h - 3000) / 2, scale: 1 };
      const visible = (await frames(page)).filter((f) => f.visibility === "visible");
      expectView(visible[0], want, "first visible frame");
      expectView(visible[visible.length - 1], want, "last frame");
    });
  }
});
