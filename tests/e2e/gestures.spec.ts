import { devices, expect, test, type CDPSession, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { contract } from "../contract.ts";
import {
  BETWEEN_OPS_QUIET_MS,
  DRAG_STEP_MS,
  loadFresh,
  readTransform,
  replay,
  settled,
  type GoldenFile,
  type GoldenProfile,
  type Op,
  type Transform,
} from "../parity/replay.ts";

const CANVAS = 3000;

const goldenFile: GoldenFile = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "tests/fixtures/rzpp-golden.json"), "utf8"),
);

function goldens(profile: GoldenProfile["profile"]): GoldenProfile {
  const found = goldenFile.profiles.find((p) => p.profile === profile);
  if (!found) throw new Error(`tests/fixtures/rzpp-golden.json has no ${profile} profile`);
  return found;
}

// The mobile goldens drag with CDP touch at the Pixel 7 profile they were
// recorded on; every other engine replays the desktop goldens with the mouse.
const isChromiumMobile = ({ browserName, isMobile }: { browserName: string; isMobile: boolean }) =>
  browserName === "chromium" && isMobile;

// Playwright refuses `mouse.wheel` in mobile WebKit ("Mouse wheel is not
// supported in mobile WebKit"), so on webkit-mobile the wheel-driven tests run
// in a desktop context (1280 x 800, mouse) of the same WebKit browser.
const it = test.extend<{ mousePage: Page }>({
  mousePage: async ({ page, browser, browserName, isMobile, baseURL }, use, testInfo) => {
    if (!(browserName === "webkit" && isMobile)) {
      await use(page);
      return;
    }
    testInfo.annotations.push({
      type: "context",
      description: "desktop WebKit context (1280x800, mouse): Playwright has no mouse.wheel in mobile WebKit",
    });
    // browser.newContext() inherits the project's device options; override them.
    const context = await browser.newContext({
      ...devices["Desktop Safari"],
      baseURL,
      viewport: { width: 1280, height: 800 },
    });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

function expectTransform(actual: Transform, want: Transform, label: string, px = 1, scale = 0.01): void {
  const ok =
    Math.abs(actual.x - want.x) <= px &&
    Math.abs(actual.y - want.y) <= px &&
    Math.abs(actual.scale - want.scale) <= scale;
  expect(ok, `${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)} (±${px} px, ±${scale})`).toBe(
    true,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const gestureOf = (page: Page) => page.locator(contract.viewer).getAttribute("data-gesture");

const viewportOf = (page: Page) => page.evaluate(() => ({ w: innerWidth, h: innerHeight }));

// The position limits for `scale`, from the page's own size: the canvas is
// centred on an axis where it is smaller than the viewport, otherwise its
// edges may not enter the viewport.
function clampTo(t: Transform, w: number, h: number): Transform {
  const axis = (value: number, view: number) => {
    const free = view - CANVAS * t.scale;
    return free >= 0 ? free / 2 : Math.min(0, Math.max(free, value));
  };
  return { x: axis(t.x, w), y: axis(t.y, h), scale: t.scale };
}

// Longer than the longest rest the controller still reads as a slow stream
// rather than a hold before the lift (200 ms).
const HOLD_BEFORE_LIFT_MS = 300;

// A mouse drag that ends with a hold, so it never starts inertia.
async function holdDrag(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
  steps = 4,
  stepMs = 0,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    if (stepMs && i > 1) await sleep(stepMs);
    await page.mouse.move(Math.round(from.x + (by.x * i) / steps), Math.round(from.y + (by.y * i) / steps));
  }
  await sleep(HOLD_BEFORE_LIFT_MS);
  await page.mouse.up();
}

// A visible sticker with room around it, hit-tested at its centre.
async function pickSticker(page: Page, margin = 80): Promise<{ slug: string; x: number; y: number }> {
  const found = await page.evaluate((m) => {
    for (const el of document.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      if (x < m || y < m || x > innerWidth - m || y > innerHeight - m) continue;
      if (document.elementFromPoint(x, y)?.closest("button.sticker") !== el) continue;
      if (document.elementFromPoint(x + 40, y)?.closest("#controls")) continue;
      return { slug: el.dataset.slug as string, x, y };
    }
    return null;
  }, margin);
  if (!found) throw new Error("no sticker is fully inside the viewport");
  return found;
}

async function countClicks(page: Page, slug: string): Promise<() => Promise<number>> {
  await page.evaluate((s) => {
    const w = window as unknown as { __clicks: number; __counted?: WeakSet<Element> };
    w.__clicks = 0;
    w.__counted ??= new WeakSet();
    const el = document.querySelector(`button.sticker[data-slug="${s}"]`)!;
    if (w.__counted.has(el)) return;
    w.__counted.add(el);
    el.addEventListener("click", () => {
      w.__clicks += 1;
    });
  }, slug);
  return () => page.evaluate(() => (window as unknown as { __clicks: number }).__clicks);
}

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

test.describe("replays the baseline goldens", () => {
  test.describe("desktop profile (mouse)", () => {
    it.skip(
      ({ browserName, isMobile }) => isChromiumMobile({ browserName, isMobile }),
      "chromium-mobile replays the mobile-profile goldens (CDP touch at Pixel 7)",
    );
    const { viewport, entries } = goldens("desktop");
    for (const entry of entries) {
      it(`desktop ${entry.name}`, async ({ mousePage: page }) => {
        await loadFresh(page, viewport);
        await replay(page, entry.ops, { input: "mouse" });
        await settled(page);
        expectTransform(await readTransform(page), entry.expected, `desktop ${entry.name}`);
      });
    }
  });

  test.describe("mobile profile (CDP touch)", () => {
    test.skip(
      ({ browserName, isMobile }) => !isChromiumMobile({ browserName, isMobile }),
      "mobile-profile drags need CDP touch at the Pixel 7 profile (chromium-mobile only); this engine replays the desktop profile",
    );
    const { viewport, entries } = goldens("mobile");
    for (const entry of entries) {
      test(`mobile ${entry.name}`, async ({ page }) => {
        await loadFresh(page, viewport);
        await replay(page, entry.ops, { input: "touch" });
        await settled(page);
        expectTransform(await readTransform(page), entry.expected, `mobile ${entry.name}`);
      });
    }
  });
});

// The same pixel deltas delivered LATE_STEP_MS apart instead of DRAG_STEP_MS,
// as a busy page or a slow automation channel delivers them (Firefox measured
// 30-400 ms). The release speed must not drop with the delivery rate, so the
// saturating flicks still reach the bound.
const LATE_STEP_MS = 80;

async function lateDrag(page: Page, cdp: CDPSession | null, op: Extract<Op, { t: "drag" }>, stepMs: number) {
  const [fx, fy] = op.from;
  const steps = Math.max(1, Math.round(op.ms / DRAG_STEP_MS));
  const at = (i: number) => ({ x: Math.round(fx + (op.by[0] * i) / steps), y: Math.round(fy + (op.by[1] * i) / steps) });
  if (cdp) await touch(cdp, "touchStart", [{ x: fx, y: fy, id: 0 }]);
  else {
    await page.mouse.move(fx, fy);
    await page.mouse.down();
  }
  for (let i = 1; i <= steps; i++) {
    if (cdp) await touch(cdp, "touchMove", [{ ...at(i), id: 0 }]);
    else await page.mouse.move(at(i).x, at(i).y);
    await sleep(stepMs);
  }
  if (cdp) await touch(cdp, "touchEnd", []);
  else await page.mouse.up();
}

test.describe("late input delivery", () => {
  for (const name of ["flick-left", "flick-up"]) {
    it(`a saturating ${name} still saturates when its moves arrive ${LATE_STEP_MS} ms apart`, async ({
      mousePage: page,
      browserName,
      isMobile,
    }) => {
      // chromium-mobile replays its own profile's golden with CDP touch.
      const mobile = isChromiumMobile({ browserName, isMobile });
      const { viewport, entries } = goldens(mobile ? "mobile" : "desktop");
      const entry = entries.find((e) => e.name === name)!;
      await loadFresh(page, viewport);
      const cdp = mobile ? await page.context().newCDPSession(page) : null;
      try {
        for (const [i, op] of entry.ops.entries()) {
          if (op.t !== "drag") throw new Error(`${name} is expected to be drags only`);
          if (i > 0) await settled(page, BETWEEN_OPS_QUIET_MS);
          await lateDrag(page, cdp, op, LATE_STEP_MS);
        }
      } finally {
        await cdp?.detach();
      }
      await settled(page);
      expectTransform(await readTransform(page), entry.expected, `${mobile ? "mobile" : "desktop"} ${name}, late`);
    });
  }

  test("a held drag does not glide, even when its moves arrive 150 ms apart", async ({ page }) => {
    await loadFresh(page);
    const before = await readTransform(page);
    const { w, h } = await viewportOf(page);
    // 60 px per step is a flick per frame; the 300 ms rest before the lift is
    // what makes it a hold, however slowly the moves came.
    await holdDrag(page, { x: Math.round((w * 3) / 4), y: Math.round(h / 3) }, { x: -240, y: 0 }, 4, 150);
    await settled(page);
    expectTransform(await readTransform(page), { ...before, x: before.x - 240 }, "held drag");
  });
});

test("one transform write per frame", async ({ page }) => {
  await loadFresh(page);
  const result = await page.evaluate(async (selector) => {
    const viewer = window.__viewer;
    if (!viewer) throw new Error("window.__viewer is missing");
    const root = document.querySelector<HTMLElement>(selector)!;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    await frame();
    const start = { ...viewer.transform };
    const writes = viewer.writes;
    let changes = 0;
    const off = viewer.onChange(() => {
      changes += 1;
    });
    const anchor = { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 3) };
    for (let i = 0; i < 60; i++) {
      root.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -10,
          clientX: anchor.x,
          clientY: anchor.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    const sync = viewer.writes - writes;
    await frame();
    const firstFrame = viewer.writes - writes;
    const firstChanges = changes;
    await frame();
    await frame();
    off();
    return { start, anchor, sync, firstFrame, firstChanges, later: viewer.writes - writes, state: { ...viewer.transform } };
  }, contract.viewer);

  expect(result.sync, "handlers must not write the transform").toBe(0);
  expect(result.firstFrame, "writes in the frame after 60 wheel events").toBe(1);
  expect(result.firstChanges, "onChange calls in that frame").toBe(1);
  expect(result.later, "no further writes while the burst is idle").toBe(1);

  // No event may be dropped: the 60 steps of 0.01 compose about the anchor.
  let want: Transform = result.start;
  for (let i = 0; i < 60; i++) {
    const scale = Math.round((want.scale + 0.01) * 1000) / 1000;
    const ratio = scale / want.scale;
    want = {
      x: result.anchor.x - (result.anchor.x - want.x) * ratio,
      y: result.anchor.y - (result.anchor.y - want.y) * ratio,
      scale,
    };
  }
  expect(want.scale).toBeCloseTo(1.6, 9);
  expectTransform(result.state, want, "controller transform", 0.01, 1e-9);
  expectTransform(await readTransform(page), want, "painted transform", 0.05, 1e-6);

  await settled(page);
  expect(await page.evaluate(() => window.__viewer!.writes)).toBeGreaterThan(0);
  expectTransform(await readTransform(page), want, "after the wheel stop", 0.05, 1e-6);
});

it("data-gesture is set while active and cleared after settle", async ({ mousePage: page }) => {
  await loadFresh(page);
  await page.evaluate((selector) => {
    const root = document.querySelector(selector)!;
    const log: (string | null)[] = [];
    (window as unknown as { __gestureLog: (string | null)[] }).__gestureLog = log;
    new MutationObserver(() => log.push(root.getAttribute("data-gesture"))).observe(root, {
      attributes: true,
      attributeFilter: ["data-gesture"],
    });
  }, contract.viewer);
  const { w, h } = await viewportOf(page);
  const at = { x: Math.round(w / 2), y: Math.round(h / 3) };

  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -100);
  expect(await gestureOf(page)).toBe("zoom");
  await expect.poll(() => gestureOf(page)).toBeNull();

  await page.mouse.down();
  for (let i = 1; i <= 3; i++) await page.mouse.move(at.x + 10 * i, at.y + 7 * i);
  expect(await gestureOf(page)).toBe("pan");
  await sleep(300);
  expect(await gestureOf(page), "a held drag is still a pan").toBe("pan");
  await page.mouse.up();
  await expect.poll(() => gestureOf(page)).toBeNull();

  const log = await page.evaluate(() => (window as unknown as { __gestureLog: (string | null)[] }).__gestureLog);
  expect(log).toEqual(["zoom", null, "pan", null]);
});

it("ctrl-wheel (trackpad pinch) may overshoot the minimum scale and realigns after the burst", async ({
  mousePage: page,
}) => {
  await loadFresh(page);
  await page.evaluate(() => {
    const w = window as unknown as { __minScale: number };
    w.__minScale = Infinity;
    window.__viewer!.onChange((t) => {
      w.__minScale = Math.min(w.__minScale, t.scale);
    });
  });
  const { w, h } = await viewportOf(page);
  await page.mouse.move(Math.round(w / 4), Math.round(h / 4));
  await page.keyboard.down("Control");
  try {
    // Large steps: Chromium at a 2.625 DPR delivers deltaY / DPR.
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 1500);
  } finally {
    await page.keyboard.up("Control");
  }
  await settled(page);
  const lowest = await page.evaluate(() => (window as unknown as { __minScale: number }).__minScale);
  expect(lowest, "the burst dips below 0.1").toBeLessThan(0.1);
  expectTransform(
    await readTransform(page),
    { x: (w - CANVAS * 0.1) / 2, y: (h - CANVAS * 0.1) / 2, scale: 0.1 },
    "realigned to 0.1, centred",
  );
});

test("drag of 40px starting on a sticker does not open the sheet; a 3px tap does", async ({ page }) => {
  await loadFresh(page);
  const target = await pickSticker(page);
  const clicks = await countClicks(page, target.slug);
  const before = await readTransform(page);

  await holdDrag(page, target, { x: 40, y: 0 });
  expect(await clicks(), "clicks after a 40 px drag that started on the sticker").toBe(0);

  // WebKit may run no frame for a few hundred ms after the layer is promoted
  // for the gesture; aim the tap below once the pan is painted.
  const want = { ...before, x: before.x + 40 };
  await expect
    .poll(
      async () => {
        const t = await readTransform(page);
        return Math.abs(t.x - want.x) <= 1 && Math.abs(t.y - want.y) <= 1;
      },
      { message: "the 40 px pan is painted", intervals: [10], timeout: 5000 },
    )
    .toBe(true);

  // The swallow is one-shot: the next real tap on the same sticker (now under
  // the pointer) clicks straight away. Selection re-centres the view, so the
  // pan is checked first.
  await settled(page);
  expectTransform(await readTransform(page), want, "a drag on a sticker pans like one on the canvas");

  await page.mouse.click(target.x + 40, target.y);
  expect(await clicks(), "a tap right after the drag").toBe(1);
  await settled(page);

  const again = await pickSticker(page);
  const tapClicks = await countClicks(page, again.slug);
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x + 3, again.y);
  await page.mouse.up();
  await sleep(500);
  expect(await tapClicks(), "a 3 px tap").toBe(1);
});

test("a touch tap on a sticker clicks it once", async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "this project has no touchscreen");
  await loadFresh(page);
  const target = await pickSticker(page);
  const clicks = await countClicks(page, target.slug);
  await page.touchscreen.tap(target.x, target.y);
  await sleep(500);
  expect(await clicks()).toBe(1);
  expect(await gestureOf(page)).toBeNull();
});

test("second finger down on a sticker cancels the tap and keeps pinching", async ({ page, browserName, isMobile }) => {
  test.skip(
    !isChromiumMobile({ browserName, isMobile }),
    "multi-touch needs CDP Input.dispatchTouchEvent at a touch profile (chromium-mobile only); WebKit pinch is on the Task 2.4 device checklist",
  );
  await loadFresh(page);
  const target = await pickSticker(page, 120);
  const clicks = await countClicks(page, target.slug);
  const start = await readTransform(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    const first = { x: target.x, y: target.y, id: 0 };
    await touch(cdp, "touchStart", [first]);
    await sleep(40);
    await touch(cdp, "touchStart", [first, { x: target.x, y: target.y + 40, id: 1 }]);
    for (let i = 1; i <= 8; i++) {
      await touch(cdp, "touchMove", [first, { x: target.x, y: target.y + 40 + 10 * i, id: 1 }]);
      await sleep(16);
    }
    expect(await gestureOf(page)).toBe("zoom");
    const pinched = await page.evaluate(() => window.__viewer!.transform.scale);
    expect(pinched).toBeCloseTo(start.scale * 3, 2);
    // CDP diffs the active points: a touchMove without id 1 lifts that finger
    // (touchEnd may not carry points).
    await touch(cdp, "touchMove", [first]);
    await sleep(40);
    await touch(cdp, "touchEnd", []);
    await settled(page);

    expect(await clicks(), "clicks on the sticker the first finger started on").toBe(0);
    expect(await gestureOf(page), "no gesture state left after both fingers lift").toBeNull();
    const after = await readTransform(page);
    expect(after.scale).toBeCloseTo(3, 2);

    // A fresh one-finger drag pans by exactly its distance: no pinch is stuck.
    await sleep(250);
    const from = { x: 200, y: 400 };
    await touch(cdp, "touchStart", [{ ...from, id: 2 }]);
    for (let i = 1; i <= 6; i++) {
      await touch(cdp, "touchMove", [{ x: from.x - 10 * i, y: from.y, id: 2 }]);
      await sleep(16);
    }
    expect(await gestureOf(page)).toBe("pan");
    await sleep(HOLD_BEFORE_LIFT_MS);
    await touch(cdp, "touchEnd", []);
    await settled(page);
    expectTransform(await readTransform(page), { ...after, x: after.x - 60 }, "one-finger drag after the pinch");
    expect(await gestureOf(page)).toBeNull();
  } finally {
    await cdp.detach();
  }
});

test("resize re-clamps the transform", async ({ page }) => {
  await loadFresh(page);
  // 1 -> 0.61 -> 0.37 -> 0.22: the 660 px canvas is smaller than the viewport
  // on at least one axis, so the bounds depend on the viewport size.
  for (let i = 0; i < 3; i++) {
    await page.locator(contract.controls.zoomOut).click();
    await settled(page, 400);
  }
  const start = await viewportOf(page);
  await holdDrag(page, { x: Math.round(start.w / 2), y: Math.round(start.h / 3) }, { x: 300, y: 300 });
  await settled(page);
  const before = await readTransform(page);
  expect(before.scale).toBeCloseTo(0.22, 5);

  const frames = (n: number) =>
    page.evaluate(async (count) => {
      for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    }, n);

  let current = before;
  for (const size of [
    { width: Math.round(start.w * 0.75), height: Math.round(start.h * 0.6) },
    { width: 4200, height: 900 },
    { width: start.w, height: start.h },
  ]) {
    const label = `${size.width}x${size.height}`;
    const precondition = clampTo(current, size.width, size.height);
    expect(
      Math.abs(precondition.x - current.x) + Math.abs(precondition.y - current.y),
      `${label}: the old transform must be outside the new bounds`,
    ).toBeGreaterThan(1);

    await page.setViewportSize(size);
    const { w, h } = await viewportOf(page);
    const want = clampTo(current, w, h);
    await frames(3);
    expectTransform(await readTransform(page), want, `${label} in the next frames`, 0.05, 1e-6);
    await settled(page);
    current = await readTransform(page);
    expectTransform(current, want, `${label} after settling`, 0.05, 1e-6);
  }
});

test("a double-click that starts on a sticker zooms like on the canvas and leaves no state", async ({ page }) => {
  await loadFresh(page);
  const target = await pickSticker(page);
  const before = await readTransform(page);
  await page.mouse.dblclick(target.x, target.y);
  await settled(page);
  const after = await readTransform(page);
  const scale = 2.01;
  expectTransform(
    after,
    clampTo(
      {
        x: target.x - (target.x - before.x) * scale,
        y: target.y - (target.y - before.y) * scale,
        scale,
      },
      ...(Object.values(await viewportOf(page)) as [number, number]),
    ),
    "double-click zoom about the pointer",
  );
  expect(await gestureOf(page)).toBeNull();
});

test("a cancelled pointer, a window blur or a hidden page ends the gesture", async ({ page }) => {
  await loadFresh(page);
  const { w, h } = await viewportOf(page);
  const at = { x: Math.round(w / 2), y: Math.round(h / 3) };
  await page.evaluate((selector) => {
    document.querySelector(selector)!.addEventListener("pointerdown", (e) => {
      (window as unknown as { __pid: number }).__pid = (e as PointerEvent).pointerId;
    });
  }, contract.viewer);

  for (const end of ["pointercancel", "blur", "hidden"] as const) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 3; i++) await page.mouse.move(at.x + 10 * i, at.y);
    expect(await gestureOf(page), end).toBe("pan");
    await page.evaluate(
      ([kind, selector]) => {
        if (kind === "blur") {
          window.dispatchEvent(new Event("blur"));
          return;
        }
        if (kind === "hidden") {
          // A hidden page runs no frames, so the end must not wait for one.
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
          const left = document.querySelector(selector)!.getAttribute("data-gesture");
          delete (document as unknown as { visibilityState?: string }).visibilityState;
          if (left !== null) throw new Error(`data-gesture="${left}" survived the page being hidden`);
          return;
        }
        const pointerId = (window as unknown as { __pid: number }).__pid;
        document.querySelector(selector)!.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true }));
      },
      [end, contract.viewer] as const,
    );
    await expect.poll(() => gestureOf(page), { message: end }).toBeNull();
    const stopped = await readTransform(page);
    await page.mouse.move(at.x + 120, at.y + 40);
    await sleep(100);
    expectTransform(await readTransform(page), stopped, `${end}: moves after the cancel do not pan`, 0.01, 1e-9);
    await page.mouse.up();
    await settled(page, 300);
    expect(await gestureOf(page), end).toBeNull();
  }
});

test("hiding an idle page leaves a deep-linked view past the bounds alone", async ({ page }) => {
  // Wide enough that centring on an edge sticker leaves the canvas past a bound.
  await loadFresh(page, [2400, 1600]);
  // The sticker furthest left: centring on it puts the canvas past its left bound.
  const slug = await page.evaluate((selector) => {
    let best = { slug: "", left: Infinity };
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const left = el.getBoundingClientRect().left;
      if (left < best.left) best = { slug: el.dataset.slug as string, left };
    }
    return best.slug;
  }, contract.stickers);
  await page.goto("about:blank");
  await page.goto(`/#${slug}`);
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await settled(page);
  const { w, h } = await viewportOf(page);
  const before = await readTransform(page);
  expect(clampTo(before, w, h), `#${slug} is past the bounds`).not.toEqual(before);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });
  await sleep(150);
  expectTransform(await readTransform(page), before, "the view after hiding", 0, 0);
  expect(await gestureOf(page)).toBeNull();
});

test("a throwing localStorage does not break the controller", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loadFresh(page);
  expect(await page.evaluate(() => typeof window.__viewer)).toBe("object");
  const before = await readTransform(page);
  const { w, h } = await viewportOf(page);
  await holdDrag(page, { x: Math.round(w / 2), y: Math.round(h / 3) }, { x: -50, y: -30 });
  await settled(page);
  expectTransform(await readTransform(page), { ...before, x: before.x - 50, y: before.y - 30 }, "drag");
  expect(errors).toEqual([]);
});

test("onGestureStart, onChange and onSettle fire as documented", async ({ page }) => {
  await loadFresh(page);
  await page.evaluate(() => {
    const viewer = window.__viewer!;
    const log: string[] = [];
    (window as unknown as { __events: string[] }).__events = log;
    viewer.onGestureStart(() => log.push("start"));
    viewer.onChange(() => {
      if (log[log.length - 1] !== "change") log.push("change");
    });
    viewer.onSettle((t) => log.push(`settle ${t.scale}`));
    const off = viewer.onSettle(() => log.push("unsubscribed"));
    off();
  });
  const { w, h } = await viewportOf(page);
  await holdDrag(page, { x: Math.round(w / 2), y: Math.round(h / 3) }, { x: -40, y: 0 });
  await settled(page);
  await page.locator(contract.controls.zoomIn).click();
  await settled(page);
  const log = await page.evaluate(() => (window as unknown as { __events: string[] }).__events);
  // Buttons are not user gestures on the canvas, so they do not fire onGestureStart.
  expect(log).toEqual(["start", "change", "settle 1", "change", "settle 1.65"]);
});

test("dispose() removes the listeners and the resize observer", async ({ page }) => {
  await loadFresh(page);
  const before = await readTransform(page);
  const disposed = await page.evaluate((selector) => {
    const viewer = window.__viewer!;
    viewer.dispose();
    const root = document.querySelector(selector)!;
    const wheel = new WheelEvent("wheel", { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    root.dispatchEvent(wheel);
    return { prevented: wheel.defaultPrevented, exposed: "__viewer" in window, gesture: root.hasAttribute("data-gesture") };
  }, contract.viewer);
  expect(disposed).toEqual({ prevented: false, exposed: false, gesture: false });

  const { w, h } = await viewportOf(page);
  // Selection (src/viewer/interactions.ts) is not part of the viewer, so keep
  // the pointer off the stickers: a click on one re-centres the view.
  const free = await page.evaluate(() => {
    const clear = (x: number, y: number) => !document.elementFromPoint(x, y)?.closest("button, #controls");
    for (let y = 160; y < innerHeight - 100; y += 20) {
      for (let x = 200; x < innerWidth - 100; x += 20) if (clear(x, y) && clear(x - 80, y - 40)) return { x, y };
    }
    return null;
  });
  expect(free, "a pointer spot clear of stickers").not.toBeNull();
  await holdDrag(page, free!, { x: -80, y: -40 });
  await page.mouse.dblclick(free!.x, free!.y);
  // A live observer would centre the canvas (narrower than 3200 px) here.
  await page.setViewportSize({ width: 3200, height: h });
  await sleep(300);
  expectTransform(await readTransform(page), before, "transform after dispose", 0.01, 1e-9);
});
