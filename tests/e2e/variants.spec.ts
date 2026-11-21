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

test("the default build ships no variant snippet", () => {
  const html = fs.readFileSync(path.resolve(process.cwd(), process.env.STATIC_DIR ?? "dist", "index.html"), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head.includes("data-v-")).toBe(process.env.PUBLIC_VARIANTS === "1");
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
