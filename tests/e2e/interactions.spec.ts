import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { contract } from "../contract.ts";
import { viewTransformFor } from "../../src/lib/geometry.ts";
import { loadFresh, readTransform, settled, type Transform } from "../parity/replay.ts";

// Tooltip, selection, hash anchors and description prefetch (Task 1.11). There
// is no Sheet yet, so selection is observed through `location.hash` and the
// read-only `window.__app` diagnostic; Task 1.13 adds the close button and the
// e2e that clicks it.

const CANVAS = 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isChromiumMobile = ({ browserName, isMobile }: { browserName: string; isMobile: boolean }) =>
  browserName === "chromium" && isMobile;

const selected = (page: Page) => page.evaluate(() => window.__app!.selectedSlug);
const hashOf = (page: Page) => page.evaluate(() => location.hash);
const gestureOf = (page: Page) => page.locator(contract.viewer).getAttribute("data-gesture");

// Errors a page raised: uncaught exceptions, unhandled rejections and console
// errors. A blocked request is logged by the browser itself, so those lines
// (and only those) are filtered out for the tests that block chunks. Silk (the
// sheet) registers a window "unload" listener, which Chromium reports as a
// permissions-policy console error; that line is always filtered.
const SILK_UNLOAD = /Permissions policy violation: unload/;
function watchErrors(page: Page, ignore: RegExp | null = null) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (SILK_UNLOAD.test(m.text())) return;
    if (ignore && ignore.test(`${m.text()} ${m.location().url}`)) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const recordRejections = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __rejections: string[] };
    w.__rejections = [];
    window.addEventListener("unhandledrejection", (e) => w.__rejections.push(String(e.reason)));
  });

const rejections = (page: Page) => page.evaluate(() => (window as unknown as { __rejections: string[] }).__rejections);

const viewportOf = (page: Page) => page.evaluate(() => ({ w: innerWidth, h: innerHeight }));

const centreOf = (page: Page, slug: string) =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(`button.sticker[data-slug="${s}"]`)!;
    return { x: +el.dataset.cx!, y: +el.dataset.cy! };
  }, slug);

// The position limits for `scale`: the canvas is centred on an axis where it
// is smaller than the viewport, otherwise its edges may not enter the viewport.
function clampTo(t: Transform, w: number, h: number): Transform {
  const axis = (value: number, view: number) => {
    const free = view - CANVAS * t.scale;
    return free >= 0 ? free / 2 : Math.min(0, Math.max(free, value));
  };
  return { x: axis(t.x, w), y: axis(t.y, h), scale: t.scale };
}

function expectTransform(actual: Transform, want: Transform, label: string, px = 1): void {
  const ok = Math.abs(actual.x - want.x) <= px && Math.abs(actual.y - want.y) <= px && Math.abs(actual.scale - want.scale) <= 0.01;
  expect(ok, `${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)} (±${px} px)`).toBe(true);
}

// Settles, then expects the view to be the sticker centred in the panel-free
// part of the viewport at `scale`.
async function expectCentred(page: Page, slug: string, scale: number, label: string): Promise<void> {
  await settled(page, 300);
  const { w, h } = await viewportOf(page);
  const want = clampTo(viewTransformFor(await centreOf(page, slug), scale, { w, h }), w, h);
  expectTransform(await readTransform(page), want, label);
}

// A point inside a sticker's clipped region: the browser's hit test names the
// sticker's `.clip`, so it is exactly where a user can hover or click.
async function pointInside(page: Page, slug: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate((s) => {
    const btn = document.querySelector<HTMLElement>(`button.sticker[data-slug="${s}"]`)!;
    const r = btn.getBoundingClientRect();
    for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        const x = Math.round(r.left + r.width * fx);
        const y = Math.round(r.top + r.height * fy);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest("button.sticker") === btn && hit.closest(".clip")) return { x, y };
      }
    }
    return null;
  }, slug);
  if (!found) throw new Error(`no hit-testable point inside ${slug}`);
  return found;
}

// A point inside a sticker's box but outside its clip-path: the hit test
// names the button itself.
async function pointOutsideClip(page: Page, slug: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate((s) => {
    const btn = document.querySelector<HTMLElement>(`button.sticker[data-slug="${s}"]`)!;
    const r = btn.getBoundingClientRect();
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const x = Math.round(r.left + 2 + ((r.width - 4) * i) / 8);
        const y = Math.round(r.top + 2 + ((r.height - 4) * j) / 8);
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        if (document.elementFromPoint(x, y) === btn) return { x, y };
      }
    }
    return null;
  }, slug);
  if (!found) throw new Error(`${slug} has no point inside its box but outside its clip-path`);
  return found;
}

// A viewport point over no sticker and no control.
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(() => {
    for (let x = 20; x < innerWidth - 20; x += 40) {
      for (let y = 20; y < innerHeight - 20; y += 40) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest("button.sticker") && !hit.closest("#controls")) return { x, y };
      }
    }
    return null;
  });
  if (!found) throw new Error("no empty point in the viewport");
  return found;
}

// A visible sticker with room around it, hit-tested at its centre.
async function pickSticker(page: Page, margin = 80, not: string[] = []): Promise<{ slug: string; x: number; y: number }> {
  const found = await page.evaluate(
    ([m, skip]) => {
      for (const el of document.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
        if ((skip as string[]).includes(el.dataset.slug as string)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) continue;
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        if (x < (m as number) || y < (m as number) || x > innerWidth - (m as number) || y > innerHeight - (m as number)) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest("button.sticker") !== el || !hit.closest(".clip")) continue;
        if (document.elementFromPoint(x + 40, y)?.closest("#controls")) continue;
        return { slug: el.dataset.slug as string, x, y };
      }
      return null;
    },
    [margin, not] as const,
  );
  if (!found) throw new Error("no sticker is fully inside the viewport");
  return found;
}

async function activate(page: Page, hasTouch: boolean, at: { x: number; y: number }): Promise<void> {
  if (hasTouch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

// A drag that ends with a hold, so it never starts inertia.
async function holdDrag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(Math.round(from.x + (by.x * i) / 4), Math.round(from.y + (by.y * i) / 4));
  }
  await sleep(300);
  await page.mouse.up();
}

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

const tipOf = (page: Page) => page.getByRole("tooltip");

// The tooltip's left edge is at the cursor and its bottom edge 10 px above it.
async function expectTipAt(page: Page, cursor: { x: number; y: number }): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await tipOf(page).boundingBox();
        return box ? Math.max(Math.abs(box.x - cursor.x), Math.abs(box.y + box.height - (cursor.y - 10))) : Infinity;
      },
      { message: "tooltip placement relative to the cursor (max error in px)" },
    )
    .toBeLessThanOrEqual(2);
}

test.describe("tooltip", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, "hover tooltips need a mouse; the touch projects have none");
  });

  test("follows the cursor and shows the localised title; created lazily, not prerendered", async ({ page, request }) => {
    const html = await (await request.get("/")).text();
    expect(html, "the tooltip is not in the prerendered HTML").not.toContain('id="tip"');

    await loadFresh(page);
    await expect(page.locator("#tip"), "nothing before the first hover").toHaveCount(0);

    const p = await pointInside(page, "dd-mmm-yyyy");
    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toBeVisible();
    await expect(tipOf(page)).toHaveText("DD MMM YYYY");
    await expectTipAt(page, p);

    const moved = { x: p.x + 17, y: p.y + 9 };
    await page.mouse.move(moved.x, moved.y);
    await expectTipAt(page, moved);

    const facts = await page.evaluate(() => {
      const tip = document.getElementById("tip")!;
      const cs = getComputedStyle(tip);
      return {
        parent: tip.parentElement === document.body,
        left: tip.style.left,
        top: tip.style.top,
        position: cs.position,
        pointerEvents: cs.pointerEvents,
        background: cs.backgroundColor,
        color: cs.color,
        radius: cs.borderTopLeftRadius,
        fontSize: cs.fontSize,
        padding: `${cs.paddingTop} ${cs.paddingRight}`,
      };
    });
    // Positioned by transform only; the shadcn tooltip's colours and shape.
    expect(facts).toEqual({
      parent: true,
      left: "",
      top: "",
      position: "fixed",
      pointerEvents: "none",
      background: "rgb(23, 23, 23)",
      color: "rgb(250, 250, 250)",
      radius: "6px",
      fontSize: "12px",
      padding: "6px 12px",
    });
  });

  test("shows the saved language's title", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("language", "ja"));
    await loadFresh(page);
    const p = await pointInside(page, "dark");
    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toHaveText("ダークモード");
  });

  test("is clamped inside the viewport", async ({ page }) => {
    await loadFresh(page);
    // Stickers cover the right edge of the 1280 px viewport? Use the title's
    // own width: the cursor over the sticker nearest the right edge.
    const { w } = await viewportOf(page);
    const target = await page.evaluate(() => {
      let best: { slug: string; right: number } | null = null;
      for (const el of document.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.right > innerWidth - 2 || r.right < 0) continue;
        if (!best || r.right > best.right) best = { slug: el.dataset.slug!, right: r.right };
      }
      return best;
    });
    expect(target).not.toBeNull();
    const p = await pointInside(page, target!.slug);
    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toBeVisible();
    await expect
      .poll(async () => {
        const box = (await tipOf(page).boundingBox())!;
        return box.x >= 0 && box.x + box.width <= w + 0.5 && box.y >= 0;
      })
      .toBe(true);
  });

  test("hover only inside the clipped region scales the sticker", async ({ page }) => {
    await loadFresh(page);
    const sticker = page.locator('button.sticker[data-slug="dark"]');
    const scaleOf = () => sticker.evaluate((el) => getComputedStyle(el).scale);

    const corner = await pointOutsideClip(page, "dark");
    await page.mouse.move(corner.x, corner.y);
    await sleep(250);
    expect(await scaleOf(), "pointer in the clipped-out corner").toBe("none");
    await expect(tipOf(page), "no tooltip in the clipped-out corner").toBeHidden();

    const inside = await pointInside(page, "dark");
    await page.mouse.move(inside.x, inside.y);
    await expect.poll(scaleOf).toBe("1.1");
    await expect(tipOf(page)).toHaveText("Dark mode");

    await page.mouse.move(corner.x, corner.y);
    await expect.poll(scaleOf).toBe("none");
    await expect(tipOf(page)).toBeHidden();
  });

  test("rapid hover across two stickers: the text follows", async ({ page }) => {
    await loadFresh(page);
    const a = await pointInside(page, "dd-mmm-yyyy");
    const b = await pointInside(page, "yyyy-mm-dd");
    await page.mouse.move(a.x, a.y);
    await expect(tipOf(page)).toHaveText("DD MMM YYYY");
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await expect(tipOf(page)).toHaveText("YYYY-MM-DD");
    await expectTipAt(page, b);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await expect(tipOf(page)).toHaveText("DD MMM YYYY");
    await expectTipAt(page, a);
  });

  test("never intercepts pointer events", async ({ page }) => {
    await loadFresh(page);
    const p = await pointInside(page, "dd-mmm-yyyy");
    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toBeVisible();
    // The tip sits above the cursor; the points it covers still hit what is under it.
    const covered = await page.evaluate(() => {
      const tip = document.getElementById("tip")!;
      const r = tip.getBoundingClientRect();
      const points = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 2, r.top + 2],
        [r.right - 2, r.bottom - 2],
      ];
      return points.map(([x, y]) => document.elementFromPoint(x, y)?.id === "tip");
    });
    expect(covered).toEqual([false, false, false]);
  });

  test("hides on mouseout, when the pointer leaves the window and on window blur", async ({ page }) => {
    await loadFresh(page);
    const p = await pointInside(page, "dd-mmm-yyyy");
    const empty = await emptyPoint(page);

    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toBeVisible();
    await page.mouse.move(empty.x, empty.y);
    await expect(tipOf(page), "pointer moved off the sticker").toBeHidden();

    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toBeVisible();
    await page.mouse.move(-20, -20);
    await expect(tipOf(page), "pointer left the window").toBeHidden();

    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(tipOf(page), "window blurred").toBeHidden();
    // Back in the window, the next move over the sticker shows it again.
    await page.mouse.move(p.x + 3, p.y);
    await expect(tipOf(page)).toBeVisible();
  });

  test("hides when a gesture starts and returns on the next move over the sticker", async ({ page }) => {
    await loadFresh(page);
    const p = await pointInside(page, "dd-mmm-yyyy");
    await page.mouse.move(p.x, p.y);
    await expect(tipOf(page)).toBeVisible();

    // A wheel zoom under a stationary pointer.
    await page.mouse.wheel(0, -120);
    await expect(tipOf(page), "wheel zoom started").toBeHidden();
    await expect.poll(() => gestureOf(page), { timeout: 5000 }).toBeNull();
    const again = await pointInside(page, "dd-mmm-yyyy");
    await page.mouse.move(again.x, again.y);
    await expect(tipOf(page), "first move over the sticker after the gesture").toBeVisible();

    // A pan that starts on the sticker.
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    await page.mouse.move(again.x + 30, again.y + 12, { steps: 4 });
    await expect(tipOf(page), "pan started").toBeHidden();
    await sleep(300);
    await page.mouse.up();
    await expect.poll(() => gestureOf(page), { timeout: 5000 }).toBeNull();
    const after = await pointInside(page, "dd-mmm-yyyy");
    await page.mouse.move(after.x + 2, after.y + 1);
    await expect(tipOf(page)).toBeVisible();
  });
});

test("coarse pointer shows no tooltip", async ({ page, hasTouch, browserName, isMobile }) => {
  test.skip(
    !isChromiumMobile({ browserName, isMobile }),
    "(pointer: coarse) is only emulated by the chromium-mobile profile; the other projects have a fine or no pointer",
  );
  expect(hasTouch).toBe(true);
  await loadFresh(page);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  const target = await pickSticker(page);
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(() => selected(page)).toBe(target.slug);
  await sleep(300);
  await expect(tipOf(page)).toBeHidden();
  expect(await page.evaluate(() => document.getElementById("tip")?.hidden ?? true)).toBe(true);
});

test.describe("selection", () => {
  test("click selects, #slug is pushed and going back clears it", async ({ page, hasTouch }) => {
    // The close button arrives with the Sheet (Task 1.13), which adds the e2e
    // that clicks it; this covers the same history path through Back.
    await loadFresh(page);
    const errors = watchErrors(page);
    const target = await pickSticker(page);
    const lengthBefore = await page.evaluate(() => history.length);
    expect(await selected(page)).toBeNull();

    await activate(page, hasTouch, target);
    await expect.poll(() => selected(page)).toBe(target.slug);
    expect(await hashOf(page)).toBe(`#${target.slug}`);
    expect(await page.evaluate(() => history.length)).toBe(lengthBefore + 1);
    await expectCentred(page, target.slug, 1, "selected sticker is centred");

    await page.goBack();
    await expect.poll(() => selected(page)).toBeNull();
    expect(await hashOf(page)).toBe("");
    expect(errors).toEqual([]);
  });

  test("a mouse or tap outside the clip-path, inside the box, does not select", async ({ page, hasTouch }) => {
    await loadFresh(page);
    const corner = await pointOutsideClip(page, "dark");
    await activate(page, hasTouch, corner);
    await sleep(400);
    expect(await selected(page)).toBeNull();
    expect(await hashOf(page)).toBe("");

    const inside = await pointInside(page, "dark");
    await activate(page, hasTouch, inside);
    await expect.poll(() => selected(page)).toBe("dark");
  });

  test("selecting re-centres at the current zoom", async ({ page, hasTouch }) => {
    await loadFresh(page);
    await page.locator('[data-action="zoom-in"]').click();
    await settled(page, 300);
    await page.locator('[data-action="zoom-in"]').click();
    await settled(page, 300);
    const zoomed = await readTransform(page);
    expect(zoomed.scale).toBeGreaterThan(2);

    const target = await pickSticker(page, 40);
    await activate(page, hasTouch, target);
    await expect.poll(() => selected(page)).toBe(target.slug);
    await expectCentred(page, target.slug, zoomed.scale, "centred at the zoom it was selected at");
    expect((await readTransform(page)).scale).toBeCloseTo(zoomed.scale, 3);
  });

  test("keyboard: focus a sticker, Enter and Space each select it", async ({ page }) => {
    await loadFresh(page);
    const first = await pickSticker(page);
    await page.locator(`button.sticker[data-slug="${first.slug}"]`).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => selected(page)).toBe(first.slug);
    expect(await hashOf(page)).toBe(`#${first.slug}`);
    await expectCentred(page, first.slug, 1, "Enter centres the sticker");

    const second = await pickSticker(page, 80, [first.slug]);
    await page.locator(`button.sticker[data-slug="${second.slug}"]`).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => selected(page)).toBe(second.slug);
    expect(await hashOf(page)).toBe(`#${second.slug}`);
    await expectCentred(page, second.slug, 1, "Space centres the sticker");
  });

  test("focusing an off-screen sticker does not scroll the viewer", async ({ page }) => {
    await loadFresh(page);
    const slug = await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
        const r = el.getBoundingClientRect();
        if (r.width > 20 && (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight)) return el.dataset.slug!;
      }
      return null;
    });
    expect(slug, "an off-screen sticker").not.toBeNull();
    const before = await readTransform(page);
    await page.locator(`button.sticker[data-slug="${slug}"]`).focus();
    await sleep(100);
    const scroll = await page.locator(contract.viewer).evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
    expect(scroll).toEqual({ left: 0, top: 0 });
    expectTransform(await readTransform(page), before, "transform after focusing an off-screen sticker");
  });

  test("a drag that ends on a sticker does not select it", async ({ page, hasTouch, browserName, isMobile }) => {
    await loadFresh(page);
    const target = await pickSticker(page, 100);
    if (isChromiumMobile({ browserName, isMobile })) {
      const cdp = await page.context().newCDPSession(page);
      try {
        await touch(cdp, "touchStart", [{ x: target.x, y: target.y, id: 0 }]);
        for (let i = 1; i <= 6; i++) {
          await touch(cdp, "touchMove", [{ x: target.x + 6 * i, y: target.y, id: 0 }]);
          await sleep(16);
        }
        await sleep(300);
        await touch(cdp, "touchEnd", []);
      } finally {
        await cdp.detach();
      }
    } else {
      await holdDrag(page, target, { x: 24, y: 0 });
    }
    await settled(page, 300);
    await sleep(500);
    expect(await selected(page), "the click that ends a drag").toBeNull();
    expect(await hashOf(page)).toBe("");

    // The swallow is one-shot: the next plain click selects.
    const again = await pickSticker(page, 60);
    await activate(page, hasTouch, again);
    await expect.poll(() => selected(page)).toBe(again.slug);
  });

  test("a second finger (pinch) does not select, and the next click does", async ({ page, browserName, isMobile }) => {
    test.skip(
      !isChromiumMobile({ browserName, isMobile }),
      "multi-touch needs CDP Input.dispatchTouchEvent at a touch profile (chromium-mobile only); WebKit pinch is on the Task 2.4 device checklist",
    );
    await loadFresh(page);
    const target = await pickSticker(page, 120);
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
      await touch(cdp, "touchEnd", [first]);
      await sleep(40);
      await touch(cdp, "touchEnd", []);
    } finally {
      await cdp.detach();
    }
    await settled(page, 300);
    await sleep(500);
    expect(await selected(page)).toBeNull();
    expect(await hashOf(page)).toBe("");

    // A mouse click, not a tap: after a CDP two-finger gesture Chromium
    // sometimes emits no click for the next touch tap, even on a page with no
    // script (about 4 in 10 on a bare page), which would say nothing about
    // the viewer. The tap after a drag is covered by the drag test above.
    const next = await pickSticker(page, 40);
    await page.mouse.click(next.x, next.y);
    await expect.poll(() => selected(page)).toBe(next.slug);
  });

  test("resizing across 4096 px flips the panel side used to re-centre", async ({ page, isMobile }) => {
    test.skip(isMobile, "re-sizing the viewport is meaningful on the desktop projects; the mobile projects are fixed-size devices");
    await loadFresh(page);
    // At scale 1 the canvas is narrower than these viewports, so x is pinned
    // to the canvas centre; the y offset still shows the docking side: the
    // panel's 135 px bottom sheet at <= 4096 px, nothing at > 4096 px.
    const cases: { width: number; slug: string; y: number }[] = [
      { width: 4096, slug: "dark", y: (800 - 135) / 2 - 1260 },
      { width: 4097, slug: "typescript", y: 800 / 2 - 1455 },
      { width: 1000, slug: "eana", y: (800 - 135) / 2 - 1500 },
    ];
    for (const { width, slug, y } of cases) {
      await page.setViewportSize({ width, height: 800 });
      await page.locator('[data-action="center"]').click();
      await settled(page, 300);
      const p = await pointInside(page, slug);
      await page.mouse.click(p.x, p.y);
      await expect.poll(() => selected(page)).toBe(slug);
      await settled(page, 300);
      expect((await readTransform(page)).y, `y at ${width} px`).toBeCloseTo(y, 0);
      await expectCentred(page, slug, 1, `centred at ${width} px`);
    }
  });
});

test.describe("hash anchors", () => {
  const defaultView = async (page: Page): Promise<Transform> => {
    const { w, h } = await viewportOf(page);
    return { x: (w - CANVAS) / 2, y: (h - CANVAS) / 2, scale: 1 };
  };

  test("#dark selects without pushing and without a second move", async ({ page }) => {
    const views: string[] = [];
    await page.exposeFunction("__view", (s: string) => views.push(s));
    await page.addInitScript(() => {
      const tick = () => {
        const wrapper = document.getElementById("canvasWrapper");
        const canvas = document.getElementById("canvas");
        if (wrapper && canvas && getComputedStyle(wrapper).visibility === "visible") {
          const m = new DOMMatrix(getComputedStyle(canvas).transform);
          (window as unknown as { __view(s: string): void }).__view(
            JSON.stringify({ x: m.e, y: m.f, scale: m.a, gesture: wrapper.hasAttribute("data-gesture") }),
          );
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.addInitScript(() => {
      (window as unknown as { __len0: number }).__len0 = history.length;
    });
    const errors = watchErrors(page);
    await page.goto("/#dark", { waitUntil: "load" });
    await sleep(900);

    const { w, h } = await viewportOf(page);
    const want = viewTransformFor(await centreOf(page, "dark"), 1, { w, h });
    expect(views.length).toBeGreaterThan(5);
    const parsed = views.map((v) => JSON.parse(v) as Transform & { gesture: boolean });
    expect(parsed.filter((f) => Math.abs(f.x - want.x) > 0.01 || Math.abs(f.y - want.y) > 0.01 || f.scale !== 1)).toEqual([]);
    expect(parsed.filter((f) => f.gesture), "no animation runs: the deep link is not re-centred").toEqual([]);
    expect(await selected(page)).toBe("dark");
    expect(await hashOf(page)).toBe("#dark");
    const lengths = await page.evaluate(() => [(window as unknown as { __len0: number }).__len0, history.length]);
    expect(lengths[1], "the load added no history entry").toBe(lengths[0]);
    expect(errors).toEqual([]);
  });

  for (const hash of ["#nope", "#", "#%E0%A4%A", "#DARK", "#dark/x", "#dark%2Fx", "#dark%20"]) {
    test(`${hash} selects nothing and logs no error (load)`, async ({ page }) => {
      const errors = watchErrors(page);
      await recordRejections(page);
      await page.goto(`/${hash}`, { waitUntil: "load" });
      await expect(page.locator(contract.stickers)).toHaveCount(63);
      await settled(page, 300);
      expect(await selected(page)).toBeNull();
      expectTransform(await readTransform(page), await defaultView(page), "default view");
      expect(await gestureOf(page)).toBeNull();
      expect(await rejections(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`${hash} selects nothing and logs no error (hashchange)`, async ({ page }) => {
      await recordRejections(page);
      await loadFresh(page);
      const errors = watchErrors(page);
      const before = await readTransform(page);
      await page.evaluate((h) => {
        location.hash = h;
      }, hash);
      await sleep(400);
      expect(await selected(page)).toBeNull();
      expectTransform(await readTransform(page), before, "view unchanged");
      expect(await gestureOf(page)).toBeNull();
      expect(await rejections(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("a hash change selects and re-centres; an unknown hash clears the selection and moves nothing", async ({ page }) => {
    await loadFresh(page);
    await page.evaluate(() => {
      location.hash = "#riddler";
    });
    await expect.poll(() => selected(page)).toBe("riddler");
    await expectCentred(page, "riddler", 1, "hashchange re-centres");

    const at = await readTransform(page);
    await page.evaluate(() => {
      location.hash = "#nope";
    });
    await expect.poll(() => selected(page)).toBeNull();
    await sleep(400);
    expectTransform(await readTransform(page), at, "an unknown hash moves nothing");
  });

  test("back and forward walk the selection history", async ({ page, hasTouch }) => {
    await loadFresh(page);
    const errors = watchErrors(page);
    const a = await pickSticker(page);
    await activate(page, hasTouch, a);
    await expect.poll(() => selected(page)).toBe(a.slug);
    await settled(page, 300);
    const b = await pickSticker(page, 60, [a.slug]);
    await activate(page, hasTouch, b);
    await expect.poll(() => selected(page)).toBe(b.slug);
    await expectCentred(page, b.slug, 1, "second selection centred");

    await page.goBack();
    await expect.poll(() => selected(page)).toBe(a.slug);
    expect(await hashOf(page)).toBe(`#${a.slug}`);
    await expectCentred(page, a.slug, 1, "back re-centres the first selection");

    await page.goBack();
    await expect.poll(() => selected(page)).toBeNull();
    expect(await hashOf(page)).toBe("");

    await page.goForward();
    await expect.poll(() => selected(page)).toBe(a.slug);
    await expectCentred(page, a.slug, 1, "forward re-centres the first selection");

    await page.goForward();
    await expect.poll(() => selected(page)).toBe(b.slug);
    await expectCentred(page, b.slug, 1, "forward re-centres the second selection");
    expect(errors).toEqual([]);
  });
});

test.describe("description prefetch", () => {
  const CHUNK = /\/_astro\/.+\.js(\?|$)/;
  // Strings only one description's compiled chunk contains.
  const MARK = {
    darkEn: "Try out dark mode",
    darkJa: "ダークモードを試す",
    eanaEn: "pseudonym I go with online",
    riddlerEn: "youtube.com/@RIDDLER_nazo",
  };

  function trackChunks(page: Page) {
    const urls: string[] = [];
    const bodies = new Map<string, Promise<string>>();
    page.on("request", (r) => {
      if (CHUNK.test(r.url())) urls.push(r.url());
    });
    // How many requests so far were for the chunk containing `marker`.
    const count = async (marker: string) => {
      let n = 0;
      for (const url of [...urls]) {
        if (!bodies.has(url)) bodies.set(url, page.request.get(url).then((res) => res.text()));
        if ((await bodies.get(url)!).includes(marker)) n += 1;
      }
      return n;
    };
    return { urls, count, has: async (marker: string) => (await count(marker)) > 0 };
  }

  const saveData = (page: Page) =>
    page.addInitScript(() => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } }));

  test("hovering a sticker requests its description chunk before any click; a repeat requests nothing", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover needs a mouse; the keyboard-focus path is covered by the next test");
    await saveData(page);
    await loadFresh(page);
    await sleep(2600);
    const { urls, count } = trackChunks(page);

    const p = await pointInside(page, "dark");
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => count(MARK.darkEn), { message: "the dark/en description chunk is requested by hover" }).toBe(1);
    expect(await selected(page), "no click happened").toBeNull();
    expect(await hashOf(page)).toBe("");

    const requests = urls.length;
    const empty = await emptyPoint(page);
    for (let i = 0; i < 2; i++) {
      await page.mouse.move(empty.x, empty.y);
      await page.mouse.move(p.x, p.y);
    }
    await sleep(500);
    expect(urls.length, "a repeat hover requests nothing").toBe(requests);

    const q = await pointInside(page, "eana");
    await page.mouse.move(q.x, q.y);
    await expect.poll(() => count(MARK.eanaEn), { message: "another sticker is a new request" }).toBe(1);
  });

  test("focusing a sticker requests its description chunk once", async ({ page }) => {
    await saveData(page);
    await loadFresh(page);
    await sleep(2600);
    const { urls, count } = trackChunks(page);
    const dark = page.locator('button.sticker[data-slug="dark"]');
    await dark.focus();
    await expect.poll(() => count(MARK.darkEn)).toBe(1);
    expect(await selected(page), "focus alone selects nothing").toBeNull();
    await page.locator('button.sticker[data-slug="eana"]').focus();
    await expect.poll(() => count(MARK.eanaEn)).toBe(1);
    const requests = urls.length;
    await dark.focus();
    await sleep(500);
    expect(urls.length, "re-focusing requests nothing").toBe(requests);
  });

  test("the saved language's chunk is the one requested", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover needs a mouse");
    await saveData(page);
    await page.addInitScript(() => localStorage.setItem("language", "ja"));
    await loadFresh(page);
    await sleep(2600);
    const { has } = trackChunks(page);
    const p = await pointInside(page, "dark");
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => has(MARK.darkJa)).toBe(true);
    expect(await has(MARK.darkEn), "no English chunk for a Japanese page").toBe(false);
  });

  test.describe("idle pass", () => {
    // A small viewport puts `riddler` clearly outside the first view; the
    // default 1280 x 800 reaches its top edge.
    test.use({ viewport: { width: 500, height: 400 } });

    test("loads the initial viewport's descriptions, not far-away ones", async ({ page }) => {
      const { has } = trackChunks(page);
      await loadFresh(page);
      await expect.poll(() => has(MARK.eanaEn), { timeout: 20000, message: "eana is in the initial viewport" }).toBe(true);
      await sleep(500);
      expect(await has(MARK.riddlerEn), "riddler is outside the initial viewport").toBe(false);
    });
  });

  test("idle prefetch is skipped when the user saves data", async ({ page }) => {
    await saveData(page);
    const { urls } = trackChunks(page);
    await loadFresh(page);
    const before = urls.length;
    // requestIdleCallback fires soon after load; the fallback timer is 2 s.
    await sleep(3000);
    expect(urls.slice(before), "no chunk requests after load").toEqual([]);
  });

  test("a failing description request never surfaces and does not break hover or selection", async ({ page, isMobile }) => {
    await recordRejections(page);
    await saveData(page);
    await loadFresh(page);
    const errors = watchErrors(page, /Failed to load resource|ERR_FAILED|ERR_BLOCKED|NetworkError|dynamically imported module/i);
    let failed = 0;
    page.on("requestfailed", (r) => {
      if (CHUNK.test(r.url())) failed += 1;
    });
    await page.route(CHUNK, (route) => route.abort());

    const target = await pickSticker(page);
    if (!isMobile) {
      await page.mouse.move(target.x, target.y);
      await expect(tipOf(page)).toBeVisible();
    }
    await page.locator(`button.sticker[data-slug="${target.slug}"]`).focus();
    await expect.poll(() => failed, { message: "the chunk request was attempted and failed" }).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect.poll(() => selected(page)).toBe(target.slug);
    await sleep(300);
    expect(await rejections(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("storage and viewport robustness", () => {
  test("a throwing localStorage breaks neither hover, click nor hash selection", async ({ page, hasTouch, isMobile }) => {
    await recordRejections(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("denied", "SecurityError");
        },
      });
    });
    const errors = watchErrors(page);
    await loadFresh(page);

    if (!isMobile) {
      const p = await pointInside(page, "dd-mmm-yyyy");
      await page.mouse.move(p.x, p.y);
      await expect(tipOf(page)).toHaveText("DD MMM YYYY");
    }
    const target = await pickSticker(page);
    await activate(page, hasTouch, target);
    await expect.poll(() => selected(page)).toBe(target.slug);
    await expectCentred(page, target.slug, 1, "selected with storage blocked");

    await page.goto("/#dark", { waitUntil: "load" });
    await expect.poll(() => selected(page)).toBe("dark");
    expect(await rejections(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
