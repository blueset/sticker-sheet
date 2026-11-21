// Recorder for the Panel/Sheet baseline behaviour. Not part of the normal
// suite: it only runs with RECORD=1 against the unchanged baseline build.
//
//   $env:RECORD='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'
//   npx playwright test tests/parity/record-sheet.spec.ts --workers=1 `
//     --project=chromium-mobile --project=chromium-desktop
//
// Writes docs/superpowers/baseline/sheet-behaviour.json (fields are merged in:
// the mobile project supplies the bottom-sheet fields, the desktop project
// supplies wideLeftPanelWidthPx -- both projects must run for a complete
// file) and screenshots to bench/results/tmp/sheet-*.png (git-ignored).
//
// Real input only: page.mouse.wheel for scroll probes, a one-finger CDP touch
// drag for the sheet handle (mobile project only). A synthetic page.mouse
// drag on the handle has no effect on the baseline -- Silk's Sheet.View only
// reacts to touch-type pointer events -- so dragging must use CDP touch, the
// same technique replay.ts uses for mobile-profile drags.
//
// Each probe below reloads the page first (matching replay.ts's loadFresh
// convention): wheeling over the sheet at peek turns out to move the whole
// sheet (see sheet-behaviour.md), so probes cannot be chained without one
// contaminating the next.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { contract, target } from "../contract.ts";

const outPath = path.resolve(
  process.cwd(),
  "docs/superpowers/baseline/sheet-behaviour.json"
);
const screensDir = path.resolve(process.cwd(), "bench/results/tmp");

interface SheetBehaviour {
  peekHeightPx: number;
  expandedHeightPx: number | null;
  handleTogglesStops: boolean;
  scrollsAtPeek: boolean;
  scrollsAtExpanded: boolean;
  dragDismisses: boolean;
  wideLeftPanelWidthPx: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One-finger CDP touch drag, mirroring replay.ts's touchDrag.
async function touchDrag(
  page: Page,
  from: [number, number],
  by: [number, number],
  ms: number
) {
  const cdp = await page.context().newCDPSession(page);
  const [fx, fy] = from;
  const [bx, byy] = by;
  const steps = Math.max(1, Math.round(ms / 16));
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: fx, y: fy }],
    });
    for (let i = 1; i <= steps; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: Math.round(fx + (bx * i) / steps),
            y: Math.round(fy + (byy * i) / steps),
          },
        ],
      });
      await sleep(ms / steps);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

// Sheet.Content keeps a fixed CSS height; only its `y` (top) position moves
// between detents, so visible height is `viewportHeight - rect.y`. The
// handle only exists on the mobile layout, so fall back to the always-present
// close button to locate Sheet.Content on the wide/desktop layout.
async function sheetRect(page: Page) {
  return page.evaluate((handleSelector) => {
    const start =
      document.querySelector(handleSelector) ??
      document.querySelector('[aria-label="Close"]');
    let el: Element | null = start;
    while (
      el &&
      !(el instanceof HTMLElement && el.className.includes("rounded-t-"))
    ) {
      el = el.parentElement;
    }
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, contract.sheetHandle);
}

// Position of the first text node inside <main>, relative to the sheet's own
// top edge. If a wheel event moves the sheet itself, this stays constant
// (the text moved only because the sheet carried it along); if the sheet
// stays put and the content scrolls inside it, this changes.
async function textOffsetWithinSheet(page: Page): Promise<number | null> {
  const rect = await sheetRect(page);
  if (!rect) return null;
  const textY = await page.evaluate(() => {
    const p = document.querySelector("main")?.querySelector("p, li, h1, h2, h3");
    return p ? p.getBoundingClientRect().y : null;
  });
  return textY === null ? null : textY - rect.y;
}

function readBehaviour(): Partial<SheetBehaviour> {
  if (!fs.existsSync(outPath)) return {};
  return JSON.parse(fs.readFileSync(outPath, "utf8"));
}

function writeBehaviour(patch: Partial<SheetBehaviour>) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const merged = { ...readBehaviour(), ...patch };
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
}

test.describe("baseline sheet recorder", () => {
  test.skip(process.env.RECORD !== "1", "recorder: set RECORD=1 to run");
  test.skip(target !== "baseline", "recorder: set TARGET=baseline");

  // Each probe below gets its own test (a fresh page, with exactly one kind
  // of gesture on it) rather than being chained in one test. Reusing a page
  // across gesture types was unreliable here even after a full page.goto
  // reload: a page.mouse.wheel that preceded a later click/CDP-touch
  // occasionally made that later gesture silently not register (the click
  // never expanded the sheet; the touch drag never dismissed it), which a
  // fresh test's fresh page does not reproduce. Chromium appears to track
  // some "last active pointer gesture" state per page/tab, not per document.

  test("bottom sheet: peek height (390x844)", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "bottom sheet needs the mobile viewport; recorded on chromium-mobile only"
    );
    fs.mkdirSync(screensDir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/#dark");
    await expect(page.locator(contract.sheetHandle)).toHaveCount(1);
    await page.waitForTimeout(500);
    const peekDark = await sheetRect(page);
    if (!peekDark) throw new Error("sheet rect not found at /#dark");
    const peekHeightPx = Math.round(844 - peekDark.y);
    expect(peekHeightPx).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(screensDir, "sheet-peek.png") });

    console.log("bottom sheet peek height (390x844):", { peekHeightPx });
    writeBehaviour({ peekHeightPx });
  });

  test("bottom sheet: handle toggles stops (390x844)", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "bottom sheet needs the mobile viewport; recorded on chromium-mobile only"
    );
    fs.mkdirSync(screensDir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });

    // Click the handle: peek -> expanded, then click again: expanded -> peek
    // (a round trip, proving the handle toggles between the two stops).
    await page.goto("/#css");
    await expect(page.locator(contract.sheetHandle)).toHaveCount(1);
    await page.waitForTimeout(500);
    const peekBeforeToggle = await sheetRect(page);
    if (!peekBeforeToggle) throw new Error("sheet rect not found at /#css (peek)");
    const peekHeightPx = Math.round(844 - peekBeforeToggle.y);

    await page.locator(contract.sheetHandle).click();
    await page.waitForTimeout(600);
    const expandedRect = await sheetRect(page);
    if (!expandedRect) throw new Error("sheet rect not found after expanding");
    const expandedHeightPx = Math.round(844 - expandedRect.y);
    await page.screenshot({ path: path.join(screensDir, "sheet-expanded.png") });

    await page.locator(contract.sheetHandle).click();
    await page.waitForTimeout(600);
    const peekAfterToggle = await sheetRect(page);
    if (!peekAfterToggle) throw new Error("sheet rect not found after collapsing");
    const peekAgainHeightPx = Math.round(844 - peekAfterToggle.y);

    const handleTogglesStops =
      Math.abs(peekAgainHeightPx - peekHeightPx) <= 2 &&
      expandedHeightPx - peekHeightPx > 50;

    console.log("bottom sheet handle toggle (390x844):", {
      expandedHeightPx,
      handleTogglesStops,
    });
    writeBehaviour({ expandedHeightPx, handleTogglesStops });
  });

  test("bottom sheet: scroll at peek (390x844)", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "bottom sheet needs the mobile viewport; recorded on chromium-mobile only"
    );
    await page.setViewportSize({ width: 390, height: 844 });

    // Wheeling at peek turns out to move the *sheet*, not the content (see
    // sheet-behaviour.md), so this is measured relative to the sheet's own
    // top edge, and a big sheet-position change is treated as "not a scroll".
    await page.goto("/#css");
    await expect(page.locator(contract.sheetHandle)).toHaveCount(1);
    await page.waitForTimeout(500);
    const sheetYBefore = (await sheetRect(page))?.y ?? null;
    const offsetBefore = await textOffsetWithinSheet(page);
    await page.mouse.move(195, 700);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
    const sheetYAfter = (await sheetRect(page))?.y ?? null;
    const offsetAfter = await textOffsetWithinSheet(page);
    const sheetMoved =
      sheetYBefore !== null &&
      sheetYAfter !== null &&
      Math.abs(sheetYAfter - sheetYBefore) > 20;
    const scrollsAtPeek =
      !sheetMoved &&
      offsetBefore !== null &&
      offsetAfter !== null &&
      Math.abs(offsetAfter - offsetBefore) > 2;

    console.log("bottom sheet scroll at peek (390x844):", {
      scrollsAtPeek,
      sheetMoved,
    });
    writeBehaviour({ scrollsAtPeek });
  });

  test("bottom sheet: scroll at expanded (390x844)", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "bottom sheet needs the mobile viewport; recorded on chromium-mobile only"
    );
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/#css");
    await expect(page.locator(contract.sheetHandle)).toHaveCount(1);
    await page.waitForTimeout(500);
    await page.locator(contract.sheetHandle).click();
    await page.waitForTimeout(600);
    const sheetYBefore = (await sheetRect(page))?.y ?? null;
    const offsetBefore = await textOffsetWithinSheet(page);
    await page.mouse.move(195, 700);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
    const sheetYAfter = (await sheetRect(page))?.y ?? null;
    const offsetAfter = await textOffsetWithinSheet(page);
    const sheetMoved =
      sheetYBefore !== null &&
      sheetYAfter !== null &&
      Math.abs(sheetYAfter - sheetYBefore) > 20;
    const scrollsAtExpanded =
      !sheetMoved &&
      offsetBefore !== null &&
      offsetAfter !== null &&
      Math.abs(offsetAfter - offsetBefore) > 2;

    console.log("bottom sheet scroll at expanded (390x844):", {
      scrollsAtExpanded,
      sheetMoved,
    });
    writeBehaviour({ scrollsAtExpanded });
  });

  test("bottom sheet: drag dismisses (390x844)", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-mobile",
      "drag-dismiss needs touch input; recorded on chromium-mobile only"
    );
    fs.mkdirSync(screensDir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/#css");
    await expect(page.locator(contract.sheetHandle)).toHaveCount(1);
    await page.waitForTimeout(500);
    const beforeDrag = await sheetRect(page);
    if (!beforeDrag) throw new Error("sheet rect not found before dismiss drag");
    await touchDrag(page, [195, Math.round(beforeDrag.y) + 21], [0, 500], 150);
    await expect(page.locator(contract.sheetHandle), {
      message: "handle removed from the DOM after a hard downward drag from peek",
    }).toHaveCount(0, { timeout: 6000 });
    const hashAfterDismiss = await page.evaluate(() => location.hash);
    const dragDismisses = hashAfterDismiss === "";
    await page.screenshot({ path: path.join(screensDir, "sheet-dismissed.png") });

    console.log("bottom sheet drag-dismiss (390x844):", { dragDismisses });
    writeBehaviour({ dragDismisses });
  });

  test("wide left panel (4100x1000)", async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium-desktop",
      "wide panel recorded on chromium-desktop only"
    );
    fs.mkdirSync(screensDir, { recursive: true });

    await page.setViewportSize({ width: 4100, height: 1000 });
    await page.goto("/#dark");
    await expect(page.locator('[aria-label="Close"]')).toHaveCount(1);
    await expect(page.locator(contract.sheetHandle)).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screensDir, "sheet-wide.png") });

    const rect = await sheetRect(page);
    if (!rect) throw new Error("panel rect not found at 4100x1000");
    // Sheet.Content is wider than the "320px" detent (capped by its own
    // max-w-lg) and overflows to the left of the viewport; only the detent's
    // worth is actually revealed on screen.
    const visibleLeft = Math.max(rect.x, 0);
    const visibleRight = Math.min(rect.x + rect.width, 4100);
    const wideLeftPanelWidthPx = Math.round(visibleRight - visibleLeft);
    expect(wideLeftPanelWidthPx).toBeGreaterThan(0);

    console.log("wide left panel (4100x1000):", { wideLeftPanelWidthPx });
    writeBehaviour({ wideLeftPanelWidthPx });
  });
});
