import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const willChange = (page: Page) => page.evaluate(() => document.getElementById("canvas")!.style.willChange);

async function zoomOnce(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => "__viewer" in window);
  await page.evaluate(() => {
    const w = window as unknown as { __wc: string[] };
    w.__wc = [];
    const layer = document.getElementById("canvas")!;
    new MutationObserver(() => w.__wc.push(layer.style.willChange)).observe(layer, {
      attributes: true,
      attributeFilter: ["style"],
    });
  });
  await page.mouse.move(Math.round(page.viewportSize()!.width / 2), Math.round(page.viewportSize()!.height / 3));
  await page.mouse.wheel(0, -100);
}

test("default: will-change is set during a gesture and cleared after settle", async ({ page }) => {
  await zoomOnce(page, "");
  expect(await willChange(page)).toBe("transform");
  await expect.poll(() => willChange(page)).toBe("");
});

test("settle:none never sets will-change", async ({ page }) => {
  await zoomOnce(page, "?v=settle:none");
  await page.waitForFunction(() => document.getElementById("canvasWrapper")!.hasAttribute("data-gesture"));
  await expect.poll(() => page.evaluate(() => document.getElementById("canvasWrapper")!.hasAttribute("data-gesture"))).toBe(false);
  expect(await willChange(page)).toBe("");
  const log = await page.evaluate(() => (window as unknown as { __wc: string[] }).__wc);
  expect(log.filter((v) => v !== "")).toEqual([]);
});

test("button-style (programmatic) zoom sets will-change during the animation and clears it after", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__viewer" in window);
  await page.evaluate(() => {
    const w = window as unknown as { __wc: string[] };
    w.__wc = [];
    const layer = document.getElementById("canvas")!;
    new MutationObserver(() => w.__wc.push(layer.style.willChange)).observe(layer, {
      attributes: true,
      attributeFilter: ["style"],
    });
    window.__viewer!.zoomBy(Math.exp(0.5));
  });
  expect(await willChange(page)).toBe("transform");
  await expect.poll(() => willChange(page)).toBe("");
});

test("explicit cull is cleared at a programmatic motion start and re-applied at settle", async ({ page }) => {
  await page.goto("/?v=cull:explicit");
  await page.waitForFunction(() => "__viewer" in window);
  const culled = () => page.evaluate(() => document.querySelectorAll(".sticker[data-cull]").length);
  await page.evaluate(() => window.__viewer!.zoomBy(Math.exp(0.5)));
  await expect.poll(culled).toBeGreaterThan(0);
  const during = await page.evaluate(() => {
    window.__viewer!.zoomBy(Math.exp(-0.5));
    return document.querySelectorAll(".sticker[data-cull]").length;
  });
  expect(during).toBe(0);
  await expect.poll(culled).toBeGreaterThan(0);
});

test("onMotionStart fires once per idle-to-moving edge, for programmatic moves too", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__viewer" in window);
  const result = await page.evaluate(async () => {
    const v = window.__viewer!;
    let motion = 0;
    let user = 0;
    v.onMotionStart(() => motion++);
    v.onGestureStart(() => user++);
    v.zoomBy(2);
    v.zoomBy(1.2);
    const first = { motion, user };
    await new Promise<void>((r) => v.onSettle(() => r()));
    v.zoomBy(0.5);
    return { first, motion, user };
  });
  expect(result.first).toEqual({ motion: 1, user: 0 });
  expect(result.motion).toBe(2);
  expect(result.user).toBe(0);
});

test("the default build ships no variant snippet", () => {
  const html = fs.readFileSync(path.resolve(process.cwd(), process.env.STATIC_DIR ?? "dist", "index.html"), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head.includes("data-v-")).toBe(process.env.PUBLIC_VARIANTS === "1");
  for (const marker of ["data-sprite", "data-box", "--shadow:", "--box-radius:"]) {
    expect(html.includes(marker), marker).toBe(process.env.PUBLIC_VARIANTS === "1");
  }
});

type ShadowStyle = { slug: string; sprite: boolean; box: boolean; filter: string; boxShadow: string; before: string; beforeBg: string };

const shadowStyles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sticker")].map((el) => {
      const s = getComputedStyle(el);
      const b = getComputedStyle(el, "::before");
      return {
        slug: el.dataset.slug!,
        sprite: el.hasAttribute("data-sprite"),
        box: el.hasAttribute("data-box"),
        filter: s.filter,
        boxShadow: s.boxShadow,
        before: b.content,
        beforeBg: b.backgroundImage,
      } satisfies ShadowStyle;
    }),
  );

test("shadow s0 (default) is the live filter on every sticker", async ({ page }) => {
  await page.goto("/");
  const styles = await shadowStyles(page);
  expect(styles.length).toBeGreaterThan(0);
  for (const s of styles) {
    expect(s.filter, s.slug).toContain("drop-shadow");
    expect(s.boxShadow, s.slug).toBe("none");
    expect(s.before, s.slug).toBe("none");
  }
});

test("shadow s1 swaps the filter for a sprite on image stickers and keeps it on the rest", async ({ page }) => {
  test.skip(process.env.PUBLIC_VARIANTS !== "1", "needs a PUBLIC_VARIANTS=1 build");
  const sprites: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/shadows/")) sprites.push(r.url());
  });
  await page.goto("/?v=shadow:s1");
  const styles = await shadowStyles(page);
  expect(styles.filter((s) => s.sprite).length).toBeGreaterThan(40);
  expect(styles.some((s) => !s.sprite)).toBe(true);
  for (const s of styles) {
    if (s.sprite) {
      expect(s.filter, s.slug).toBe("none");
      expect(s.before, s.slug).toBe('""');
      expect(s.beforeBg, s.slug).toContain(`/shadows/${s.slug}.webp`);
    } else {
      expect(s.filter, s.slug).toContain("drop-shadow");
      expect(s.before, s.slug).toBe("none");
    }
    expect(s.boxShadow, s.slug).toBe("none");
  }
  await expect.poll(() => sprites.length).toBeGreaterThan(0);
});

test("shadow s2 uses box-shadow on box-shaped stickers and the live filter on the rest", async ({ page }) => {
  test.skip(process.env.PUBLIC_VARIANTS !== "1", "needs a PUBLIC_VARIANTS=1 build");
  await page.goto("/?v=shadow:s2");
  const styles = await shadowStyles(page);
  expect(styles.filter((s) => s.box).length).toBeGreaterThan(0);
  for (const s of styles) {
    if (s.box) {
      expect(s.filter, s.slug).toBe("none");
      expect(s.boxShadow, s.slug).toMatch(/rgba\(0, 0, 0, 0\.07\) 0px 4px 6px 0px, rgba\(0, 0, 0, 0\.06\) 0px 2px 4px 0px/);
    } else {
      expect(s.filter, s.slug).toContain("drop-shadow");
      expect(s.boxShadow, s.slug).toBe("none");
    }
    expect(s.before, s.slug).toBe("none");
  }
});

test("the default variant of a PUBLIC_VARIANTS build fetches no shadow sprite", async ({ page }) => {
  test.skip(process.env.PUBLIC_VARIANTS !== "1", "needs a PUBLIC_VARIANTS=1 build");
  const sprites: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/shadows/")) sprites.push(r.url());
  });
  await page.goto("/?v=shadow:bogus");
  await page.waitForFunction(() => "__viewer" in window);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-v-shadow"))).toBe("s0");
  expect(sprites).toEqual([]);
});

test("PUBLIC_VARIANTS builds set html[data-v-*] before DOMContentLoaded", async ({ page }) => {
  test.skip(process.env.PUBLIC_VARIANTS !== "1", "needs a PUBLIC_VARIANTS=1 build");
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __atDcl: string | null }).__atDcl = document.documentElement.getAttribute("data-v-bg");
    });
  });
  await page.goto("/?v=bg:gradient");
  expect(await page.evaluate(() => (window as unknown as { __atDcl: string | null }).__atDcl)).toBe("gradient");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("canvas")!).backgroundImage)).toContain("linear-gradient");
});

// The baseline's `.bg-grid` (baseline-m0 src/app/globals.css) on a probe
// element is the reference for what `bg:gradient` must paint.
const BASELINE_BG_GRID = `
  --vertex-color: light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04));
  --large-scale-color: light-dark(#f2f2f2, #0d0d0d);
  --cross-hair-color: light-dark(#aaa, #555);
  --grid-color: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  background: linear-gradient(-90deg, var(--grid-color) 1px, transparent 1px),
    linear-gradient(var(--grid-color) 1px, transparent 1px),
    linear-gradient(-90deg, var(--vertex-color) 1px, transparent 1px),
    linear-gradient(var(--vertex-color) 1px, transparent 1px),
    linear-gradient(transparent 3px, var(--large-scale-color) 3px, var(--large-scale-color) 98px, transparent 98px),
    linear-gradient(-90deg, var(--cross-hair-color) 1px, transparent 1px),
    linear-gradient(-90deg, transparent 3px, var(--large-scale-color) 3px, var(--large-scale-color) 98px, transparent 98px),
    linear-gradient(var(--cross-hair-color) 1px, transparent 1px),
    var(--large-scale-color);
  background-size: 10px 10px, 10px 10px, 100px 100px, 100px 100px, 100px 100px,
    100px 100px, 100px 100px, 100px 100px;`;

for (const scheme of ["light", "dark"] as const) {
  test(`bg:gradient matches the baseline .bg-grid (${scheme})`, async ({ page }) => {
    test.skip(process.env.PUBLIC_VARIANTS !== "1", "needs a PUBLIC_VARIANTS=1 build");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/?v=bg:gradient");
    const { actual, expected } = await page.evaluate((css) => {
      const probe = document.createElement("div");
      probe.setAttribute("style", css);
      document.body.append(probe);
      const pick = (el: Element) => {
        const s = getComputedStyle(el);
        return [s.backgroundImage, s.backgroundSize, s.backgroundColor];
      };
      return { actual: pick(document.getElementById("canvas")!), expected: pick(probe) };
    }, BASELINE_BG_GRID);
    expect(actual).toEqual(expected);
    expect(actual[1].split(",")).toHaveLength(8);
  });
}
