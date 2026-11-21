import { expect, test, type Page } from "@playwright/test";
import { contract } from "../contract.ts";
import { loadFresh } from "../parity/replay.ts";

// The controls island (Task 1.12): menus, persistence, and the zoom/centre
// buttons that must keep working through `main.ts` without the island.

const hydrated = (page: Page) => expect(page.locator("astro-island[ssr]")).toHaveCount(0);

const scaleOf = (page: Page) => page.evaluate(() => window.__viewer!.transform.scale);

function watchErrors(page: Page, ignore: RegExp | null = null) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (ignore && ignore.test(`${m.text()} ${m.location().url}`)) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const storedLanguage = (page: Page) => page.evaluate(() => localStorage.getItem("language"));
const storedTheme = (page: Page) => page.evaluate(() => localStorage.getItem("theme"));

// A point inside a sticker's clipped region, where hover works.
async function pointInside(page: Page, slug: string) {
  return page.evaluate((s) => {
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
    throw new Error(`no hit point for ${s}`);
  }, slug);
}

test("language menu switches stickers, UI strings and persists", async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await loadFresh(page);
  await hydrated(page);

  await page.locator(contract.controls.language).click();
  await page.getByRole("menuitemradio", { name: "日本語" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  expect(await storedLanguage(page)).toBe("ja");
  await expect(page.getByRole("button", { name: "拡大" })).toBeVisible();
  await expect(page.getByRole("button", { name: "テーマを切り替え" })).toBeVisible();
  await expect(page.getByRole("button", { name: "言語を変更" })).toBeVisible();

  const visible = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('button.sticker[data-slug="dark"]')!;
    return JSON.parse(el.dataset.titles!).ja as string;
  });
  expect(visible).toBe("ダークモード");

  if (!isMobile) {
    const p = await pointInside(page, "dark");
    await page.mouse.move(p.x, p.y);
    await expect(page.locator("#tip")).toHaveText("ダークモード");
  }

  await page.reload();
  await expect(page.locator(contract.stickers)).toHaveCount(63);
  await hydrated(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("button", { name: "拡大" })).toBeVisible();
  expect(errors, "a saved ja must hydrate without a mismatch error").toEqual([]);
});

test("theme menu sets class and color-scheme and persists", async ({ page }) => {
  await loadFresh(page);
  await hydrated(page);
  const html = page.locator("html");
  const colorScheme = () => page.evaluate(() => document.documentElement.style.colorScheme);

  await page.locator(contract.controls.theme).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(html).toHaveClass(/\bdark\b/);
  await expect.poll(colorScheme).toBe("dark");
  expect(await storedTheme(page)).toBe("dark");

  await page.locator(contract.controls.theme).click();
  await page.getByRole("menuitem", { name: "Light" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(html).not.toHaveClass(/\bdark\b/);
  await expect.poll(colorScheme).toBe("light");

  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(contract.controls.theme).click();
  await page.getByRole("menuitem", { name: "System" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await storedTheme(page)).toBe("system");
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveClass(/\bdark\b/);
  await expect.poll(colorScheme).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).not.toHaveClass(/\bdark\b/);
  await expect.poll(colorScheme).toBe("light");

  await page.reload();
  await hydrated(page);
  expect(await storedTheme(page)).toBe("system");
});

test("menus work from the keyboard", async ({ page, isMobile, browserName }) => {
  test.skip(isMobile === true, "keyboard navigation needs a physical keyboard; the touch projects have none");
  test.skip(browserName === "webkit", "WebKit does not tab to buttons by default");
  await loadFresh(page);
  await hydrated(page);

  const theme = page.locator(contract.controls.theme);
  await theme.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Light" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Dark" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.locator(contract.controls.language)).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "简体中文" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.getByRole("button", { name: "放大" })).toBeVisible();
});

test("zoom buttons work when the Controls chunk is blocked", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  const urls = new Set<string>();
  for (const m of html.matchAll(/(?:component-url|renderer-url)="([^"]+)"/g)) urls.add(m[1]!);
  expect(urls.size, "the built page names its island chunks").toBeGreaterThan(0);

  const errors = watchErrors(page, /Failed to load resource|ERR_FAILED|ERR_BLOCKED|NS_ERROR|net::/i);
  const blocked: string[] = [];
  page.on("requestfailed", (r) => urls.forEach((u) => r.url().endsWith(u) && blocked.push(r.url())));
  for (const url of urls) await page.route(`**${new URL(url, "http://x").pathname}`, (route) => route.abort());
  await loadFresh(page);

  for (const key of ["zoomIn", "zoomOut", "center", "theme", "language"] as const) {
    await expect(page.locator(contract.controls[key])).toHaveCount(1);
  }
  const before = await scaleOf(page);
  await page.locator(contract.controls.zoomIn).click();
  await expect.poll(() => scaleOf(page)).toBeGreaterThan(before);
  expect(blocked.length, "the island chunks were really blocked").toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("invalid saved preferences fall back cleanly", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("language", "fr");
    localStorage.setItem("theme", "blue");
  });
  await loadFresh(page);
  await hydrated(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a control tooltip shows localised text", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "hover tooltips need a mouse; the touch projects have none");
  await page.addInitScript(() => localStorage.setItem("language", "ja"));
  await loadFresh(page);
  await hydrated(page);
  await page.locator('[data-action="zoom-in"]').hover();
  await expect(page.getByRole("tooltip").filter({ hasText: "拡大" }).first()).toBeVisible();
});

