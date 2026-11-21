import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { contract } from "../contract.ts";

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
