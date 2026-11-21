// Visual baselines for Milestone 0 (Task 0.4): deterministic screenshots of
// the CURRENT (unchanged) app, served from `out/` via TARGET=baseline. Later
// tasks run this SAME spec against the rewrite (TARGET=new) and diff against
// these PNGs at maxDiffPixelRatio: 0.02 -- so this spec uses only the
// selector contract (../contract.ts) plus ARIA/web-standard semantics
// (role="tooltip"), never baseline-only DOM internals, and the snapshots
// captured here are an exact-match self-check (no tolerance override; see
// "Tolerance" below).
//
// Scene -> (viewport, theme, lang) matrix (11 shots total):
//
//   scene            viewport        theme          lang(s)
//   ---------------  --------------  -------------  -----------------
//   initial          desktop 1440x900 light + dark  en, zh-Hans, ja  (6)
//   hash-dark        desktop 1440x900 light          en
//   hover-clip       desktop 1440x900 light          en
//   tooltip          desktop 1440x900 light          en
//   sheet-peek       mobile 390x844   light          en
//   sheet-expanded   mobile 390x844   light          en
//
// File naming: <viewport>-<theme>-<lang>-<scene>.png, written (via the
// project-wide snapshotPathTemplate in playwright.config.ts) to
// tests/visual/__snapshots__/<name>.png with no per-project/platform suffix.
//
// Determinism:
//  - toHaveScreenshot() defaults to animations: "disabled", caret: "hide".
//  - document.fonts.ready and every <img>.decode() are awaited before each
//    shot (gotoWithPrefs), plus settled() (tests/parity/replay.ts) for the
//    canvas transform and waitRectSettled() (below) for the sheet handle's
//    position -- the sheet's peek<->expanded slide is Silk-driven, not a
//    plain CSS transition, so it needs its own quiet-period wait.
//  - `dd-mmm-yyyy` and `yyyy-mm-dd` render `new Date()` (today's date): both
//    are masked in every shot, including scenes where they are unlikely to
//    be visible, since masking a non-visible locator is harmless.
//
// Tolerance: ruling R2's maxDiffPixelRatio: 0.02 is for later new-vs-baseline
// comparisons only. This spec intentionally does not set it anywhere, so the
// determinism self-check (capture, then re-run twice more) runs at
// Playwright's exact-match default.
import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { contract } from "../contract.ts";
import { settled } from "../parity/replay.ts";

type Theme = "light" | "dark";
type Lang = "en" | "zh-Hans" | "ja";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

// DOM order is alphabetical-by-slug (confirmed identical between the
// baseline and the rewrite in Task 0.2), so indices looked up from the
// fixture are safe to reuse across TARGET=baseline and TARGET=new.
const stickersFixture: { slug: string }[] = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "tests/fixtures/stickers.baseline.json"),
    "utf8"
  )
);
function stickerIndex(slug: string): number {
  const i = stickersFixture.findIndex((s) => s.slug === slug);
  if (i === -1) throw new Error(`sticker not found in fixture: ${slug}`);
  return i;
}
const DARK_IDX = stickerIndex("dark");
const DD_MMM_YYYY_IDX = stickerIndex("dd-mmm-yyyy");
const YYYY_MM_DD_IDX = stickerIndex("yyyy-mm-dd");

function dateMasks(page: Page): Locator[] {
  const all = page.locator(contract.stickers);
  return [all.nth(DD_MMM_YYYY_IDX), all.nth(YYYY_MM_DD_IDX)];
}

// Sets theme/language before the app's own scripts run (next-themes reads
// localStorage.theme in a blocking head script; language is applied by a
// post-hydration effect that also sets document.documentElement.lang -- our
// signal to know the switch has completed), then waits for fonts and every
// sticker image to finish decoding. Does NOT wait for the canvas transform
// to settle -- callers do that last, after any scene-specific interaction,
// so a hash-driven pan/center started slightly after load isn't missed.
async function gotoWithPrefs(
  page: Page,
  { theme, lang, path: route = "/" }: { theme: Theme; lang: Lang; path?: string }
): Promise<void> {
  await page.addInitScript(
    ([t, l]) => {
      window.localStorage.setItem("theme", t);
      window.localStorage.setItem("language", l);
    },
    [theme, lang] as [Theme, Lang]
  );
  await page.goto(route);
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe(lang);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark"))
    )
    .toBe(theme === "dark");
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.decode().catch(() => undefined)
      )
    );
  });
}

// Mirrors settled() (tests/parity/replay.ts) but watches a selector's own
// getBoundingClientRect().top instead of a computed transform: the sheet's
// peek<->expanded slide is Silk/requestAnimationFrame-driven, so it is not
// covered by settled()'s canvas-transform check or by toHaveScreenshot's
// animations: "disabled".
async function waitRectSettled(
  page: Page,
  selector: string,
  quietMs = 400,
  timeoutMs = 10000
): Promise<void> {
  await page.evaluate(
    ([sel, quiet, timeout]) =>
      new Promise<void>((resolve, reject) => {
        const el = document.querySelector(sel as string);
        if (!el) return reject(new Error(`element not found: ${sel}`));
        const started = performance.now();
        let last = el.getBoundingClientRect().top;
        let changedAt = started;
        const tick = () => {
          const now = performance.now();
          const current = el.getBoundingClientRect().top;
          if (current !== last) {
            last = current;
            changedAt = now;
          }
          if (now - changedAt >= (quiet as number)) return resolve();
          if (now - started > (timeout as number)) {
            return reject(new Error("rect never settled"));
          }
          setTimeout(tick, 20);
        };
        tick();
      }),
    [selector, quietMs, timeoutMs] as const
  );
}

// Finds a point within `locator`'s true (possibly rotated) hit-test shape
// near the top of its bounding box, via document.elementFromPoint -- not a
// hard-coded pixel or the box's centre, and not thrown off by a
// neighbouring, overlapping sticker (elementFromPoint only matches points
// where our own locator is the topmost hit). Used for the `tooltip` scene:
// `dd-mmm-yyyy` is rotated 30deg, so its centre sits far from its top edge;
// hovering near the top (rather than the centre) pushes CursorTooltip's
// rendered bubble -- which Radix opens above-right of the cursor -- clear of
// the sticker's own bounding box, so the date mask (which covers that whole
// box) does not also hide the tooltip behind it.
async function findHoverPointNearTop(
  page: Page,
  locator: Locator
): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("locator has no bounding box");
  const handle = await locator.elementHandle();
  const point = await page.evaluate(
    ({ box, handle }) => {
      for (let dy = 1; dy < box.height; dy += 1) {
        const y = box.y + dy;
        for (let dx = 1; dx < box.width; dx += 1) {
          const x = box.x + dx;
          const el = document.elementFromPoint(x, y);
          if (el && (el === handle || handle.contains(el))) {
            return { x, y };
          }
        }
      }
      return null;
    },
    { box, handle }
  );
  if (!point) {
    throw new Error("no hoverable point found near top of bounding box");
  }
  return point;
}

test.describe("visual baselines", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const lang of ["en", "zh-Hans", "ja"] as const) {
      const name = `desktop-${theme}-${lang}-initial`;
      test(name, async ({ page }, info) => {
        test.skip(
          info.project.name !== "chromium-desktop",
          "desktop scene; runs on chromium-desktop only"
        );
        await page.setViewportSize(VIEWPORTS.desktop);
        await gotoWithPrefs(page, { theme, lang });
        await settled(page);
        await expect(page).toHaveScreenshot([`${name}.png`], {
          mask: dateMasks(page),
        });
      });
    }
  }

  test("desktop-light-en-hash-dark", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-desktop",
      "desktop scene; runs on chromium-desktop only"
    );
    await page.setViewportSize(VIEWPORTS.desktop);
    await gotoWithPrefs(page, { theme: "light", lang: "en", path: "/#dark" });
    await expect(page.locator(contract.sheetHandle)).toHaveCount(1);
    await waitRectSettled(page, contract.sheetHandle);
    await settled(page);
    await expect(page).toHaveScreenshot(["desktop-light-en-hash-dark.png"], {
      mask: dateMasks(page),
    });
  });

  test("desktop-light-en-hover-clip", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-desktop",
      "desktop scene; runs on chromium-desktop only"
    );
    await page.setViewportSize(VIEWPORTS.desktop);
    await gotoWithPrefs(page, { theme: "light", lang: "en" });
    await settled(page);

    const darkSticker = page.locator(contract.stickers).nth(DARK_IDX);
    const box = await darkSticker.boundingBox();
    if (!box) throw new Error("dark sticker has no bounding box");
    // `dark`'s clip-path is circle(50% at 50% 50%) over a square box: the
    // inscribed circle's radius is half the side. A point 0.6r along the
    // diagonal (distance 0.6r*sqrt(2) ~= 0.85r from the centre) stays well
    // inside the circle even if the box measurement is slightly off, while
    // landing clear of the button's un-clipped corners.
    const radius = box.width / 2;
    const offset = Math.round(radius * 0.6);
    const hoverPoint = {
      x: box.x + box.width / 2 + offset,
      y: box.y + box.height / 2 + offset,
    };

    const transformBefore = await darkSticker.evaluate(
      (el) => getComputedStyle(el).transform
    );
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    // Fail loudly rather than silently snapshot a no-op: if the computed
    // point missed the circle, the CSS hover scale never applies and this
    // assertion times out instead of passing.
    await expect
      .poll(() => darkSticker.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(transformBefore);

    await settled(page);
    await expect(page).toHaveScreenshot(["desktop-light-en-hover-clip.png"], {
      mask: dateMasks(page),
    });
  });

  test("desktop-light-en-tooltip", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-desktop",
      "desktop scene; runs on chromium-desktop only"
    );
    await page.setViewportSize(VIEWPORTS.desktop);
    await gotoWithPrefs(page, { theme: "light", lang: "en" });
    await settled(page);

    const dateSticker = page.locator(contract.stickers).nth(DD_MMM_YYYY_IDX);
    const box = await dateSticker.boundingBox();
    if (!box) throw new Error("dd-mmm-yyyy sticker has no bounding box");
    const hoverPoint = await findHoverPointNearTop(page, dateSticker);
    await page.mouse.move(hoverPoint.x, hoverPoint.y);

    // role="tooltip" is ARIA/web-standard semantics (Radix's TooltipContent),
    // not a baseline-only DOM detail, so this holds under TARGET=new too.
    const tooltipDescription = page.getByRole("tooltip");
    await expect(tooltipDescription).toBeVisible();

    // Radix renders role="tooltip" on a visually-hidden accessible
    // description span; the rendered bubble people actually see is its
    // parent. Assert that bubble doesn't land back inside dd-mmm-yyyy's own
    // (mask-covered) bounding box -- fail loudly here instead of silently
    // snapshotting a tooltip hidden behind the date mask.
    const bubbleBox = await tooltipDescription.locator("xpath=..").boundingBox();
    if (!bubbleBox) throw new Error("tooltip bubble has no bounding box");
    const overlapsStickerMask =
      bubbleBox.x < box.x + box.width &&
      bubbleBox.x + bubbleBox.width > box.x &&
      bubbleBox.y < box.y + box.height &&
      bubbleBox.y + bubbleBox.height > box.y;
    expect(
      overlapsStickerMask,
      "tooltip bubble must render outside dd-mmm-yyyy's masked bounding box"
    ).toBe(false);

    await settled(page);
    await expect(page).toHaveScreenshot(["desktop-light-en-tooltip.png"], {
      mask: dateMasks(page),
    });
  });

  test("mobile sheet: peek and expanded", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "mobile scene; runs on chromium-mobile only"
    );
    await page.setViewportSize(VIEWPORTS.mobile);
    await gotoWithPrefs(page, { theme: "light", lang: "en", path: "/#dark" });
    await expect(page.locator(contract.sheetHandle)).toHaveCount(1);
    await waitRectSettled(page, contract.sheetHandle);
    await settled(page);

    const handle = page.locator(contract.sheetHandle);
    const peekBox = await handle.boundingBox();
    if (!peekBox) throw new Error("sheet handle has no bounding box at peek");
    await expect(page).toHaveScreenshot(["mobile-light-en-sheet-peek.png"], {
      mask: dateMasks(page),
    });

    await handle.click();
    await waitRectSettled(page, contract.sheetHandle);
    await settled(page);
    const expandedBox = await handle.boundingBox();
    if (!expandedBox) throw new Error("sheet handle has no bounding box after expand");
    // Fail loudly if the click didn't actually expand the sheet (mirrors
    // docs/superpowers/baseline/sheet-behaviour.md's own >50px check).
    expect(peekBox.y - expandedBox.y).toBeGreaterThan(50);

    await expect(page).toHaveScreenshot(
      ["mobile-light-en-sheet-expanded.png"],
      { mask: dateMasks(page) }
    );
  });
});
