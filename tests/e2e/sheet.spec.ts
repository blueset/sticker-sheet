import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { contract } from "../contract.ts";
import { readTransform, settled, type Transform } from "../parity/replay.ts";

// The Sheet island (Task 1.13): a Silk bottom sheet with two stops (peek
// 231 px, expanded calc(100dvh - 3em)) up to 4096 px wide, a 320 px left panel
// beyond. Numbers match docs/superpowers/baseline/sheet-behaviour.json.

const PEEK = 231;
const NARROW: [number, number] = [390, 844];
const WIDE: [number, number] = [4100, 1000];
// Short enough that the CSS sticker's description overflows the expanded sheet
// in every engine's fonts, so there is something to scroll.
const SHORT: [number, number] = [390, 600];

const sheet = (page: Page) => page.locator("#sheet");
const handle = (page: Page) => page.locator(contract.sheetHandle);
const title = (page: Page) => sheet(page).getByRole("heading");
const description = (page: Page) => page.locator("#sheet-description");
const hydrated = (page: Page) => expect(page.locator("astro-island[ssr]")).toHaveCount(0);
const selected = (page: Page) => page.evaluate(() => window.__app!.selectedSlug);
const hashOf = (page: Page) => page.evaluate(() => location.hash);
// Silk's scroller is the first element in the sheet that clips its overflow;
// `set` scrolls it programmatically.
const scrollTopOf = (page: Page, set?: number) =>
  page.evaluate((set) => {
    const scroller = [...document.querySelectorAll("#sheet *")].find((el) => getComputedStyle(el).overflowY !== "visible")!;
    if (set !== undefined) scroller.scrollTop = set;
    return scroller.scrollTop;
  }, set);
const pace = (page: Page, ms: number) => page.waitForTimeout(ms); // gesture timing, not a wait

const isChromiumMobile = ({ browserName, isMobile }: { browserName: string; isMobile: boolean }) =>
  browserName === "chromium" && isMobile;
const NO_WHEEL = "page.mouse.wheel is not supported on mobile WebKit";

// Silk registers a window "unload" listener; Chromium reports it as a console
// error under its default unload permissions policy. That is Silk's, not ours.
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
const BLOCKED = /Failed to load resource|ERR_FAILED|ERR_BLOCKED|NS_ERROR|net::|dynamically imported module|module script failed|Error hydrating/i;

// On-screen rectangle of the sheet, clipped to the viewport.
const visible = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector("#sheet")!.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      height: Math.round(Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)),
      width: Math.round(Math.min(r.right, innerWidth) - Math.max(r.left, 0)),
      right: Math.round(r.right),
    };
  });

const near = (actual: number, want: number, px = 2) => Math.abs(actual - want) <= px;

async function expectHeight(page: Page, want: number) {
  await expect.poll(async () => (await visible(page)).height, { message: `sheet height ≈ ${want}` }).toBeGreaterThanOrEqual(want - 2);
  await expect.poll(async () => (await visible(page)).height, { message: `sheet height ≈ ${want}` }).toBeLessThanOrEqual(want + 2);
  await rests(page);
}

// Silk moves the sheet by scrolling its own container: clicking (which
// scrolls the target into view) mid-travel would fight that, so wait for rest.
const rests = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(async () => {
          const top = () => document.querySelector("#sheet")!.getBoundingClientRect().top;
          const before = top();
          for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
          return top() === before;
        }),
      { message: "sheet at rest" },
    )
    .toBe(true);

// Opens `/#slug` at `size` and waits until the sheet rests at its first stop.
async function open(page: Page, slug: string, size: [number, number] = NARROW) {
  await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto(`/#${slug}`);
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await hydrated(page);
  await expect(sheet(page)).toBeVisible();
  if (size[0] > 4096) await expect.poll(async () => (await visible(page)).width).toBe(320);
  else await expectHeight(page, PEEK);
  await rests(page);
}

async function expanded(page: Page) {
  const { h } = await page.evaluate(() => ({ h: innerHeight }));
  return h - 48;
}

async function wheelOver(page: Page, at: { x: number; y: number }, dy: number) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, dy);
}

// Firefox keeps a wheel transaction on its first target for a moment, so a
// wheel right after the sheet expanded may still go to the old target. Each
// retry waits out the transaction (mousewheel.transaction.timeout, 1.5 s).
// Firefox wheel scrolling is smooth, so also wait for it to come to rest.
async function expectWheelScrolls(page: Page) {
  await expect(async () => {
    await wheelOver(page, await insideSheet(page), 300);
    expect(await scrollTopOf(page)).toBeGreaterThan(0);
  }).toPass({ intervals: [1600], timeout: 10_000 });
  await expect
    .poll(async () => {
      const before = await scrollTopOf(page);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return (await scrollTopOf(page)) - before;
    })
    .toBe(0);
}

// A point over the sheet's text, below the title.
const insideSheet = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector("#sheet")!.getBoundingClientRect();
    const bottom = Math.min(r.bottom, innerHeight);
    return { x: Math.round(Math.max(r.left, 0) + Math.min(r.width, innerWidth) / 2), y: Math.round(Math.max(r.top, 0) + (bottom - Math.max(r.top, 0)) * 0.7) };
  });

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", x?: number, y?: number) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: x === undefined ? [] : [{ x, y: y! }] });
}

async function touchDrag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  const steps = Math.max(1, Math.round(ms / 16));
  try {
    await touch(cdp, "touchStart", from.x, from.y);
    for (let i = 1; i <= steps; i++) {
      await touch(cdp, "touchMove", Math.round(from.x + (by.x * i) / steps), Math.round(from.y + (by.y * i) / steps));
      await pace(page, ms / steps);
    }
    await touch(cdp, "touchEnd");
  } finally {
    await cdp.detach();
  }
}

async function mouseDrag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(Math.round(from.x + (by.x * i) / 6), Math.round(from.y + (by.y * i) / 6));
    await pace(page, 16);
  }
  await page.mouse.up();
}

function expectSameTransform(after: Transform, before: Transform, label: string) {
  const same = near(after.x, before.x, 0.5) && near(after.y, before.y, 0.5) && Math.abs(after.scale - before.scale) < 0.001;
  expect(same, `${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`).toBe(true);
}

// A visible sticker with room around it that the sheet does not cover.
async function pickSticker(page: Page) {
  const found = await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      if (x < 80 || y < 80 || x > innerWidth - 80 || y > innerHeight - 300) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit?.closest("button.sticker") !== el || !hit.closest(".clip")) continue;
      return { slug: el.dataset.slug!, x, y };
    }
    return null;
  });
  if (!found) throw new Error("no sticker is fully inside the viewport");
  return found;
}

const sheetUrl = async (page: Page) => {
  const html = await (await page.request.get("/")).text();
  const island = [...html.matchAll(/<astro-island\b[^>]*>/g)].map((m) => m[0]).find((tag) => /Sheet/.test(tag));
  const url = island?.match(/component-url="([^"]+)"/)?.[1];
  if (!url) throw new Error("no Sheet island in the page");
  return { url, html };
};

test("peek stop is 231px and content does not scroll in place", async ({ page, browserName, isMobile }) => {
  await open(page, "css", SHORT);
  expect((await visible(page)).height).toBeGreaterThanOrEqual(PEEK - 2);
  await expect(title(page)).toHaveText("CSS");
  test.skip(browserName === "webkit" && isMobile, NO_WHEEL);
  await wheelOver(page, await insideSheet(page), 300);
  await expectHeight(page, await expanded(page));
  expect(await scrollTopOf(page)).toBe(0);
});

test("handle toggles to expanded and back", async ({ page, browserName, isMobile }) => {
  // kagami's body is long plain text: css embeds iframes whose late loads make
  // Silk re-measure, and a step tapped during that re-measure can be dropped.
  await open(page, "kagami", SHORT);
  await handle(page).click();
  await expectHeight(page, await expanded(page));
  if (!(browserName === "webkit" && isMobile)) await expectWheelScrolls(page);
  await handle(page).click();
  await expectHeight(page, PEEK);
  await handle(page).click();
  await expectHeight(page, await expanded(page));
});

test("dragging the sheet below peek dismisses it", async ({ page, browserName, isMobile }) => {
  test.skip(!isChromiumMobile({ browserName, isMobile }), "Silk drags only on touch; CDP touch input is chromium-only");
  await open(page, "dark");
  const box = (await handle(page).boundingBox())!;
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: 0, y: 500 }, 150);
  await expect.poll(() => selected(page)).toBeNull();
  expect(await hashOf(page)).toBe("");
  await expect(sheet(page)).toHaveCount(0);
});

test("close button and Escape dismiss the sheet", async ({ page }) => {
  await open(page, "dark");
  const before = await page.evaluate(() => history.length);
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(await selected(page)).toBeNull();
  expect(await hashOf(page)).toBe("");
  expect(await page.evaluate(() => history.length)).toBe(before + 1);

  await page.goBack();
  await expect(sheet(page)).toBeVisible();
  expect(await selected(page)).toBe("dark");
  await expectHeight(page, PEEK);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  expect(await hashOf(page)).toBe("");
});

test("wide viewport shows a 320px left panel and offsets centring", async ({ page }) => {
  await open(page, "dark", WIDE);
  const rect = await visible(page);
  // Baseline parity (R8): the 512px-wide content slides in from the left with
  // only the 320px detent revealed, so its right edge sits at 320.
  expect(rect.width).toBe(320);
  expect(rect.right).toBe(320);
  await expect(handle(page)).toHaveCount(0);
  await settled(page);
  const t = await readTransform(page);
  const cx = await page.evaluate(() => +document.querySelector<HTMLElement>('button.sticker[data-slug="dark"]')!.dataset.cx!);
  expect(near(t.x + cx * t.scale, 320 + (WIDE[0] - 320) / 2), `dark centre x ${t.x + cx * t.scale}`).toBe(true);
});

test("crossing 4096px swaps the stop set", async ({ page }) => {
  await open(page, "dark", [4096, 900]);
  await expect(handle(page)).toBeVisible();
  await page.setViewportSize({ width: 4097, height: 900 });
  await expect(handle(page)).toHaveCount(0);
  await expect.poll(async () => (await visible(page)).width).toBe(320);
  expect((await visible(page)).right).toBe(320);
  expect(await selected(page)).toBe("dark");
  await expect(title(page)).toHaveText("Dark mode");

  await page.setViewportSize({ width: 4096, height: 900 });
  await expect(handle(page)).toBeVisible();
  await expectHeight(page, PEEK);
  expect(await selected(page)).toBe("dark");
});

test("rotation keeps the sheet at peek", async ({ page }) => {
  await open(page, "dark");
  await page.setViewportSize({ width: NARROW[1], height: NARROW[0] });
  await expect.poll(async () => (await visible(page)).top).toBe(NARROW[0] - PEEK);
  await page.setViewportSize({ width: NARROW[0], height: NARROW[1] });
  await expect.poll(async () => (await visible(page)).top).toBe(NARROW[1] - PEEK);
  expect(await selected(page)).toBe("dark");
});

test("wheel inside the sheet does not move the canvas", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, NO_WHEEL);
  await open(page, "css", SHORT);
  await settled(page);
  const before = await readTransform(page);
  await wheelOver(page, await insideSheet(page), 300);
  await expectHeight(page, await expanded(page));
  // Firefox: Silk does not notice wheel-driven travel, so its stop stays at
  // peek and the body is not scrollable yet; the baseline behaves the same (R8).
  if (browserName !== "firefox") await expectWheelScrolls(page);
  await settled(page, 400);
  expectSameTransform(await readTransform(page), before, "wheel over the sheet");
});

test("dragging inside the sheet does not move the canvas", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, "touch drags need CDP, which WebKit lacks; mouse input on mobile WebKit is not a drag");
  await open(page, "css");
  await settled(page);
  const before = await readTransform(page);
  const at = await insideSheet(page);
  if (isMobile) await touchDrag(page, at, { x: 120, y: 0 }, 200);
  else await mouseDrag(page, at, { x: 120, y: -60 });
  await settled(page, 400);
  expectSameTransform(await readTransform(page), before, "drag inside the sheet");
  expect(await selected(page)).toBe("css");
});

test("a gesture starting on a sticker opens the sheet only when it is a tap", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, "touch drags need CDP, which WebKit lacks");
  const load = async (p: Page) => {
    await p.setViewportSize({ width: NARROW[0], height: NARROW[1] });
    await p.goto("/");
    await expect(p.locator(contract.stickers)).toHaveCount(63);
    await hydrated(p);
    await settled(p);
  };
  await load(page);
  const s = await pickSticker(page);
  if (isMobile) await touchDrag(page, s, { x: 60, y: 60 }, 200);
  else await mouseDrag(page, s, { x: 60, y: 60 });
  await settled(page, 400);
  expect(await selected(page)).toBeNull();
  await expect(sheet(page)).toHaveCount(0);

  // Emulated touch stops synthesising clicks on a page after a CDP drag, so
  // the tap gets a fresh page (one gesture type per page).
  const tapPage = await page.context().newPage();
  await load(tapPage);
  const again = await pickSticker(tapPage);
  if (isMobile) await tapPage.touchscreen.tap(again.x, again.y);
  else await tapPage.mouse.click(again.x, again.y);
  await expect(sheet(tapPage)).toBeVisible();
  expect(await selected(tapPage)).toBe(again.slug);
});

test("tapping another sticker swaps the content and keeps the stop", async ({ page }) => {
  await open(page, "dark");
  await handle(page).click();
  await expectHeight(page, await expanded(page));
  await page.evaluate(() => (location.hash = "#eana"));
  await expect(title(page)).not.toHaveText("Dark mode");
  await expect(description(page)).toContainText("pseudonym I go with online");
  await expectHeight(page, await expanded(page));
});

test("scroll position resets when the selected sticker changes", async ({ page }) => {
  await open(page, "css", SHORT);
  await handle(page).click();
  await expectHeight(page, await expanded(page));
  await expect.poll(() => scrollTopOf(page, 200)).toBeGreaterThan(0);
  await page.evaluate(() => (location.hash = "#kagami"));
  await expect(title(page)).toContainText("mirror reflecting");
  await expect(description(page)).toHaveAttribute("aria-busy", "false");
  expect(await scrollTopOf(page)).toBe(0);
  // ...and not because the new body is too short to scroll.
  await expect.poll(() => scrollTopOf(page, 200)).toBeGreaterThan(0);
});

test("double-click on a sticker still zooms with the sheet open", async ({ page, isMobile }) => {
  test.skip(isMobile, "double-click is a mouse gesture");
  const errors = watchErrors(page);
  await open(page, "dark", [1280, 800]);
  await settled(page);
  const s = await pickSticker(page);
  await page.mouse.dblclick(s.x, s.y);
  await expect.poll(async () => (await readTransform(page)).scale).toBeGreaterThan(1);
  await expect(sheet(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("language change while open updates title and description", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "dark", [1000, 844]);
  await expect(title(page)).toHaveText("Dark mode");
  await expect(description(page)).toContainText("Try out dark mode");
  await page.locator(contract.controls.language).click();
  await page.getByRole("menuitemradio", { name: "日本語" }).click();
  await expect(title(page)).toHaveText("ダークモード");
  await expect(description(page)).toContainText("ダークモードを試す");
  await expect(description(page)).not.toContainText("Try out dark mode");
  await expect(sheet(page).getByRole("button", { name: "パネルサイズを切り替え" })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "閉じる" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("failed description chunk shows the title only", async ({ page }) => {
  const errors = watchErrors(page, BLOCKED);
  let aborted = 0;
  await page.route("**/_astro/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("Try out dark mode")) {
      aborted++;
      await route.abort();
    } else await route.fulfill({ response, body });
  });
  await open(page, "dark");
  await expect(title(page)).toHaveText("Dark mode");
  await expect.poll(() => aborted).toBeGreaterThan(0);
  await expect(description(page)).toHaveAttribute("aria-busy", "false");
  await expect(description(page)).toHaveText("");

  const scale = (await readTransform(page)).scale;
  await page.locator(contract.controls.zoomIn).click();
  await expect.poll(async () => (await readTransform(page)).scale).toBeGreaterThan(scale);
  expect(errors).toEqual([]);
});

test("a failed Sheet chunk leaves the page usable", async ({ page }) => {
  const errors = watchErrors(page, BLOCKED);
  const { url } = await sheetUrl(page);
  const failed: string[] = [];
  page.on("requestfailed", (r) => failed.push(r.url()));
  await page.route((u) => u.pathname === url, (route) => route.abort());
  await page.setViewportSize({ width: NARROW[0], height: NARROW[1] });
  await page.goto("/#dark");
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await expect.poll(() => failed.some((u) => new URL(u).pathname === url)).toBe(true);
  await expect(page.locator(contract.controls.zoomIn)).toBeVisible();
  await settled(page);
  const scale = (await readTransform(page)).scale;
  await page.locator(contract.controls.zoomIn).click();
  await expect.poll(async () => (await readTransform(page)).scale).toBeGreaterThan(scale);
  await expect(sheet(page)).toHaveCount(0);
  expect(await selected(page)).toBe("dark");
  expect(errors).toEqual([]);
});

test("deep link opens the sheet without waiting for idle", async ({ page }) => {
  const { url, html } = await sheetUrl(page);
  expect(html).not.toContain('id="sheet"');
  expect(html).not.toContain("Toggle panel size");

  // Holds every idle callback until the test releases them, so hydration and
  // main.ts's idle prefetch cannot be what loads the chunks.
  await page.addInitScript(() => {
    const w = window as unknown as { __held: IdleRequestCallback[] | null; __release: () => void };
    w.__held = [];
    window.requestIdleCallback = (cb) => {
      if (w.__held) w.__held.push(cb);
      else setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }));
      return 0;
    };
    w.__release = () => {
      const held = w.__held!;
      w.__held = null;
      for (const cb of held) setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }));
    };
  });
  let sheetChunk = false;
  let descriptionChunk = false;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === url) sheetChunk = true;
  });
  page.on("response", async (r) => {
    if (!r.url().endsWith(".js")) return;
    if ((await r.text().catch(() => "")).includes("Try out dark mode")) descriptionChunk = true;
  });

  await page.setViewportSize({ width: NARROW[0], height: NARROW[1] });
  await page.goto("/#dark");
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await expect.poll(() => sheetChunk, { message: "Sheet chunk requested before idle" }).toBe(true);
  await expect.poll(() => descriptionChunk, { message: "description chunk loaded before idle" }).toBe(true);
  expect(await page.locator("astro-island[ssr]").count()).toBeGreaterThan(0);
  await expect(sheet(page)).toHaveCount(0);
  await expect(handle(page)).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await hydrated(page);
  await expect(sheet(page)).toBeVisible();
  await expect(title(page)).toHaveText("Dark mode");
  await expect(description(page)).toContainText("Try out dark mode");
  // The [slug] effect ran with the content mounted: unscrolled, focus inside.
  expect(await scrollTopOf(page)).toBe(0);
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("#sheet")))).toBe(true);
});

test("a failed or stalled Silk stylesheet still lets the sheet open", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "one engine is enough for a network-failure fallback");
  const errors = watchErrors(page, BLOCKED);
  const silkCss = "**/_astro/main-unlayered.*.css";
  await page.route(silkCss, (route) => route.abort());
  await page.setViewportSize({ width: NARROW[0], height: NARROW[1] });
  await page.goto("/#dark");
  await hydrated(page);
  await expect(title(page)).toHaveText("Dark mode");
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect.poll(() => selected(page)).toBeNull();

  // A request that never answers: the sheet opens after the timeout.
  const stalled = await page.context().newPage();
  const stalledErrors = watchErrors(stalled, BLOCKED);
  let requested = false;
  await stalled.route(silkCss, () => void (requested = true));
  await stalled.setViewportSize({ width: NARROW[0], height: NARROW[1] });
  await stalled.goto("/#dark");
  await hydrated(stalled);
  await expect.poll(() => requested).toBe(true);
  await expect(title(stalled)).toHaveText("Dark mode", { timeout: 10_000 });
  expect(errors).toEqual([]);
  expect(stalledErrors).toEqual([]);
});

test("a description that failed in one language renders after switching language", async ({ page }) => {
  // The ja body throws while rendering (the error boundary's path); en loads.
  const errors = watchErrors(page, /description render failure/);
  await page.route("**/_astro/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("ダークモードを試す"))
      // A thrown string, so every engine's console text names it.
      await route.fulfill({ response, body: 'export default function MDXContent() { throw "description render failure"; }' });
    else await route.fulfill({ response, body });
  });
  await page.addInitScript(() => localStorage.setItem("language", "ja"));
  await open(page, "dark", [1000, 844]);
  await expect(title(page)).toHaveText("ダークモード");
  await expect(description(page)).toHaveAttribute("aria-busy", "false");
  await expect(description(page)).toHaveText("");
  await page.getByRole("button", { name: "言語を変更" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(title(page)).toHaveText("Dark mode");
  await expect(description(page)).toContainText("Try out dark mode");
  expect(errors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Back and Forward close and reopen the sheet without adding history", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: NARROW[0], height: NARROW[1] });
  await page.goto("/");
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await hydrated(page);
  await settled(page);
  const s = await pickSticker(page);
  if (isMobile) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
  await expect(sheet(page)).toBeVisible();
  await expectHeight(page, PEEK);
  const length = await page.evaluate(() => history.length);

  await page.goBack();
  await closedFromOutside(page);
  expect(await selected(page)).toBeNull();
  expect(await page.evaluate(() => history.length)).toBe(length);

  await page.goForward();
  await expect(sheet(page)).toBeVisible();
  expect(await selected(page)).toBe(s.slug);
  expect(await hashOf(page)).toBe(`#${s.slug}`);
  await expectHeight(page, PEEK);
  expect(await page.evaluate(() => history.length)).toBe(length);

  // Clearing the hash closes the sheet; the browser adds that one entry
  // itself, and closing the sheet must not push another.
  await page.evaluate(() => (location.hash = ""));
  await closedFromOutside(page);
  expect(await selected(page)).toBeNull();
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
});

// A close that does not come from Silk (Back, a hash change) slides the sheet
// out at once, but Silk unmounts it only after about 4 s; history is checked
// after that, so a late onPresentedChange(false) would have pushed by then.
async function closedFromOutside(page: Page) {
  await expect(sheet(page)).not.toBeInViewport();
  await expect(sheet(page)).toHaveCount(0, { timeout: 10_000 });
}
