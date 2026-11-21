import { expect, test, type Page } from "@playwright/test";

// The canvas layer is promoted (`will-change: transform`) while the viewer
// reports motion (`data-gesture`). At settle the promotion is dropped, so the
// layer re-rasters crisply at rest, only when the scale changed since the last
// raster: a pan keeps it promoted (Task 2.3b, decision 003).
const willChange = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById("canvas")!).willChange);
const moving = (page: Page) => page.evaluate(() => document.getElementById("canvasWrapper")!.hasAttribute("data-gesture"));

test("will-change is set during a wheel zoom and cleared after settle", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, "mobile WebKit has no mouse wheel input in Playwright");
  await page.goto("/");
  await page.waitForFunction(() => "__viewer" in window);
  expect(await willChange(page)).toBe("auto");
  const vp = page.viewportSize()!;
  await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 3));
  await page.mouse.wheel(0, -100);
  await expect.poll(() => moving(page)).toBe(true);
  expect(await willChange(page)).toBe("transform");
  await expect.poll(() => moving(page)).toBe(false);
  expect(await willChange(page)).toBe("auto");
});

test("a programmatic (button) zoom promotes the layer during the animation only", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => "__viewer" in window);
  const during = await page.evaluate(() => {
    window.__viewer!.zoomBy(Math.exp(0.5));
    return getComputedStyle(document.getElementById("canvas")!).willChange;
  });
  expect(during).toBe("transform");
  await expect.poll(() => moving(page)).toBe(false);
  expect(await willChange(page)).toBe("auto");
});

test("a pan-only drag keeps the layer promoted after settle", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, "mobile WebKit has no mouse input in Playwright");
  await page.goto("/");
  await page.waitForFunction(() => "__viewer" in window);
  const before = await page.evaluate(() => window.__viewer!.transform);
  const vp = page.viewportSize()!;
  const from = { x: Math.round(vp.width / 2), y: Math.round(vp.height / 3) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x - 10 * i, from.y - 6 * i);
  expect(await willChange(page)).toBe("transform");
  // Rest before lifting: no inertia.
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(() => moving(page)).toBe(false);
  const after = await page.evaluate(() => window.__viewer!.transform);
  expect(after.scale).toBe(before.scale);
  expect(after.x).not.toBe(before.x);
  expect(await willChange(page)).toBe("transform");
});

test("a wheel notch after settle re-promotes the layer", async ({ page, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, "mobile WebKit has no mouse wheel input in Playwright");
  await page.goto("/");
  await page.waitForFunction(() => "__viewer" in window);
  const vp = page.viewportSize()!;
  await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 3));
  await page.mouse.wheel(0, -100);
  await expect.poll(() => moving(page)).toBe(true);
  await expect.poll(() => moving(page)).toBe(false);
  expect(await willChange(page)).toBe("auto");
  await page.mouse.wheel(0, -100);
  await expect.poll(() => moving(page)).toBe(true);
  expect(await willChange(page)).toBe("transform");
  await expect.poll(() => moving(page)).toBe(false);
  expect(await willChange(page)).toBe("auto");
});

test("every sticker keeps the live drop-shadow filter", async ({ page }) => {
  await page.goto("/");
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sticker")].map((el) => ({
      slug: el.dataset.slug!,
      filter: getComputedStyle(el).filter,
      before: getComputedStyle(el, "::before").content,
    })),
  );
  expect(styles.length).toBeGreaterThan(0);
  for (const s of styles) {
    expect(s.filter, s.slug).toContain("drop-shadow");
    expect(s.before, s.slug).toBe("none");
  }
});
