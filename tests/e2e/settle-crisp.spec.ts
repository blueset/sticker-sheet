// After a zoom settles, a vector sticker must be re-rastered at the new scale,
// not left as the stretched bitmap of the scale it was promoted at.
//
// BENCH_QUERY is appended to the URL (see bench/harness.ts); BENCH_PROBE_CSS
// injects CSS after load (`{stickers}` and `{layer}` expand to the contract
// selectors), e.g. '{stickers} img{filter:blur(0.5px) !important}' to show
// that the test fails on a soft sticker.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { benchUrl, probeCss } from "../../bench/harness.ts";
import { contract } from "../contract.ts";
import { settled } from "../parity/replay.ts";

const TARGET_SCALE = 4;

// Share of pixels that differ by pixelmatch's default per-pixel threshold
// (anti-aliased pixels are not counted).
function pixelDiffRatio(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    throw new Error(`screenshot sizes differ: ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`);
  }
  return pixelmatch(pa.data, pb.data, undefined, pa.width, pa.height, { threshold: 0.1 }) / (pa.width * pa.height);
}

// The first SVG sticker with rotation 0 and no clip-path. No sticker has both
// today, so the first unrotated SVG sticker whose clip-path is the
// scale-invariant `circle(50% …)` is the fallback; only the square inscribed
// well inside the circle is compared, so neither the clip edge, the shadow nor
// the canvas background is in the shot.
async function pickSticker(page: Page): Promise<string> {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll<HTMLElement>("button.sticker[data-slug]")].filter((el) => {
      const img = el.querySelector("img");
      return !el.style.rotate && img && /\.svg(\?|$)/.test(img.getAttribute("src") ?? "") && el.offsetWidth > 0;
    });
    const clip = (el: HTMLElement) => el.querySelector<HTMLElement>(".clip")!.style.clipPath;
    const pick =
      candidates.find((el) => !clip(el)) ?? candidates.find((el) => /^circle\(50%( at 50% 50%)?\)$/.test(clip(el)));
    if (!pick) throw new Error("no unrotated SVG sticker");
    return pick.dataset.slug!;
  });
}

const gestureRunning = (page: Page) =>
  page.evaluate(() => document.getElementById("canvasWrapper")!.hasAttribute("data-gesture"));

// Loads the page, brings the first unrotated SVG sticker to the viewport
// centre and wheel-zooms about it to about TARGET_SCALE, then waits for settle.
async function zoomOnSticker(page: Page): Promise<string> {
  await page.goto(benchUrl());
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await settled(page, 400);
  const css = probeCss(contract);
  if (css) await page.addStyleTag({ content: css });

  const slug = await pickSticker(page);
  // Bring the sticker to the viewport centre at the current scale, then zoom
  // in with the wheel about that point.
  await page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(`button.sticker[data-slug="${s}"]`)!;
    const v = window.__viewer!;
    const t = v.transform;
    const root = document.getElementById("canvasWrapper")!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    v.setTransform(
      {
        x: t.x + root.x + root.width / 2 - (r.x + r.width / 2),
        y: t.y + root.y + root.height / 2 - (r.y + r.height / 2),
        scale: t.scale,
      },
      { animateMs: 0 },
    );
  }, slug);
  await settled(page, 400);
  const root = (await page.locator(contract.viewer).boundingBox())!;
  await page.mouse.move(root.x + root.width / 2, root.y + root.height / 2);
  for (let i = 0; i < 200; i++) {
    const scale = await page.evaluate(() => window.__viewer!.transform.scale);
    if (scale >= TARGET_SCALE - 0.05) break;
    await page.mouse.wheel(0, -Math.min(100, Math.round((TARGET_SCALE - scale) * 1000)));
    await page.waitForTimeout(16);
  }
  await expect.poll(() => gestureRunning(page)).toBe(false);
  await settled(page, 400);
  return slug;
}

// Waits for the raster to land, then compares the centre of the sticker to a
// reference `<img>` drawn at the same size on a blank page at the same DPR.
async function crispRatio(page: Page, context: BrowserContext, slug: string, what: string): Promise<number> {
  await page.waitForTimeout(500);
  const scale = await page.evaluate(() => window.__viewer!.transform.scale);
  expect(scale).toBeGreaterThan(TARGET_SCALE - 0.1);

  const img = page.locator(`button.sticker[data-slug="${slug}"]`).locator("img");
  const rect = await img.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  // Central square, half the side of the image box: inside the circle clip.
  const side = Math.floor(Math.min(rect.width, rect.height) / 2);
  const clip = {
    x: Math.round(rect.x + rect.width / 2 - side / 2),
    y: Math.round(rect.y + rect.height / 2 - side / 2),
    width: side,
    height: side,
  };
  const viewport = page.viewportSize()!;
  expect(clip.x).toBeGreaterThanOrEqual(0);
  expect(clip.y).toBeGreaterThanOrEqual(0);
  expect(clip.x + clip.width).toBeLessThanOrEqual(viewport.width);
  expect(clip.y + clip.height).toBeLessThanOrEqual(viewport.height);
  const settledShot = await page.screenshot({ clip });

  // Reference: the same image alone on a blank page, laid out at the settled
  // size and position (same context, so the same DPR).
  const src = await img.evaluate((el) => (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src);
  const ref = await context.newPage();
  await ref.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
      `<body style="margin:0;background:#fff">` +
      `<img src="${src}" style="position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px">` +
      `</body></html>`,
  );
  await ref.waitForFunction(() => document.images[0]!.complete && document.images[0]!.naturalWidth > 0);
  const referenceShot = await ref.screenshot({ clip });
  await ref.close();

  const ratio = pixelDiffRatio(settledShot, referenceShot);
  const variant = new URL(page.url()).search;
  test.info().annotations.push({ type: "crisp", description: `${what}: ${slug} at x${scale.toFixed(2)}: diff ${ratio.toFixed(4)}` });
  console.log(
    `[settle-crisp] ${what}: ${slug} x${scale.toFixed(2)} ${clip.width}x${clip.height} [${variant || "default"}]: diff ratio ${ratio.toFixed(4)}`,
  );
  return ratio;
}

test("vector sticker is crisp after a zoom settles", async ({ page, context, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, "mobile WebKit has no mouse wheel input in Playwright");
  test.setTimeout(60_000);
  const slug = await zoomOnSticker(page);
  expect(await crispRatio(page, context, slug, "zoom")).toBeLessThan(0.02);
});

// A pan keeps the scale, so the viewer may keep the layer promoted at settle
// instead of re-rastering it (Task 2.3b): the sticker must still be sharp.
test("vector sticker stays crisp after a pan at the zoomed scale", async ({ page, context, browserName, isMobile }) => {
  test.skip(browserName === "webkit" && isMobile, "mobile WebKit has no mouse wheel input in Playwright");
  test.setTimeout(60_000);
  const slug = await zoomOnSticker(page);
  const before = await page.evaluate(() => window.__viewer!.transform);
  const root = (await page.locator(contract.viewer).boundingBox())!;
  const from = { x: root.x + root.width / 2, y: root.y + root.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(from.x - 8 * i, from.y - 5 * i);
    await page.waitForTimeout(16);
  }
  // Rest before lifting: no inertia, so the pan ends where it was dropped.
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(() => gestureRunning(page)).toBe(false);
  await settled(page, 400);
  const after = await page.evaluate(() => window.__viewer!.transform);
  expect(after.scale).toBe(before.scale);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(30);
  expect(await crispRatio(page, context, slug, "pan")).toBeLessThan(0.02);
});
