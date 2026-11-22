// Interaction bench: the two interaction budgets the gesture bench does not
// measure. Chromium only (CDP throttling and metrics), BENCH=1 only.
//
//   $env:BENCH='1'; $env:TARGET='new'; $env:STATIC_DIR='dist'; $env:BENCH_LABEL='audit'
//   npx playwright test bench/interaction.bench.ts --project=chromium-desktop   (hover)
//   npx playwright test bench/interaction.bench.ts --project=chromium-mobile    (sheet-open)
//
// Writes bench/results/<label>-interaction-<TARGET>-<profile>.json. Only
// `contract` selectors and real input, so TARGET=baseline (the unchanged Next
// export) runs the same scenarios.
//
// - hover (desktop profile, 1280x800, CPU forced to 4x like the Milestone 0
//   hover probe in bench/probes.ts): per run, 3 trials of 160 mouse moves on a
//   16 px circle inside a sticker's clipped region, then the same over empty
//   canvas. Per move: CDP Performance.getMetrics TaskDuration (main-thread task
//   time, the budget's "<= 7 ms"), ScriptDuration, style recalcs, layouts, and
//   React commits (a React DevTools hook stub counts onCommitFiberRoot).
//   Divided by the `mousemove` events the page saw, median over the 3 trials.
// - sheet-open (mobile profile: 4x CPU, Fast 4G): page loaded and idle, one
//   touch tap on a visible sticker. inputDelayMs = worst (performance.now() in
//   a capture-phase window listener) - event.timeStamp over the tap's
//   pointer/touch/mouse/click events (the same definition as the gesture
//   bench). sheetVisibleMs = first rAF where the sheet handle has a box, minus
//   the touchstart timeStamp.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";
import { contract, target } from "../tests/contract.ts";
import { settled } from "../tests/parity/replay.ts";
import { PROFILES } from "./profiles.ts";
import { BENCH_RUNS, STICKER_COUNT, applyProfile, benchEnabled, benchUrl, profileOf, runMeta, sleep } from "./harness.ts";
import { percentile } from "./metrics.ts";
import { benchLabel, resultsDir, type ProfileName } from "./results.ts";
import { statsOf } from "./summarize.ts";
import { readProtoStats, servedBuild } from "./proto.ts";

const HOVER_CPU_SLOWDOWN = 4;
const HOVER_MOVES = 160;
const HOVER_TRIALS = 3;

const INIT_SCRIPT = `(() => {
  const hook = {
    supportsFiber: true,
    commits: 0,
    inject() { return 1; },
    onCommitFiberRoot() { this.commits++; },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook, configurable: true });
  window.__moves = 0;
  window.addEventListener("mousemove", () => { window.__moves++; }, true);
})();`;

const round = (n: number, digits = 3) => Number(n.toFixed(digits));
const rawDir = (label: string, profile: ProfileName) =>
  path.join(resultsDir, "tmp", `${label}-interaction-${target}-${profile}`);

function writeSummary(label: string, profile: ProfileName): void {
  const dir = rawDir(label, profile);
  if (!fs.existsSync(dir)) return;
  const rows = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "meta.json")
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>);
  const meta = fs.existsSync(path.join(dir, "meta.json"))
    ? JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"))
    : null;
  const scenarios: Record<string, unknown> = {};
  for (const name of new Set(rows.map((r) => r.name as string))) {
    scenarios[name] = statsOf(rows.filter((r) => r.name === name).map(({ name: _, ...rest }) => rest));
  }
  const file = path.join(resultsDir, `${label}-interaction-${target}-${profile}.json`);
  fs.writeFileSync(file, JSON.stringify({ label, target, profile, meta, scenarios, raw: rows }, null, 2) + "\n");
}

// A point inside a sticker's clipped region (elementFromPoint hits its
// clipped child, which alone hovers and selects: `.clip` on the new build, the
// clip-path div on the baseline) with a ring of the given radius also inside
// it, away from the edges and the bottom-right controls. Largest visible
// sticker first.
const CLIP = target === "new" ? ".clip" : "button.absolute > div";
function pickStickerPoint(args: { sticker: string; radius: number; clip: string }) {
  const vw = innerWidth;
  const vh = innerHeight;
  const ring = (cx: number, cy: number, r: number) =>
    [{ x: cx, y: cy }].concat(
      Array.from({ length: 16 }, (_, i) => ({
        x: cx + r * Math.cos((i / 16) * 2 * Math.PI),
        y: cy + r * Math.sin((i / 16) * 2 * Math.PI),
      }))
    );
  const candidates = [...document.querySelectorAll(args.sticker)]
    .map((el) => ({ el: el as HTMLElement, r: el.getBoundingClientRect() }))
    .map((c) => ({
      ...c,
      area:
        Math.max(0, Math.min(c.r.right, vw) - Math.max(c.r.left, 0)) *
        Math.max(0, Math.min(c.r.bottom, vh) - Math.max(c.r.top, 0)),
    }))
    .filter((c) => c.area > 0)
    .sort((a, b) => b.area - a.area);
  for (const { el, r } of candidates) {
    for (let a = 0; a < 9; a++) {
      for (let b = 0; b < 9; b++) {
        const cx = r.left + (r.width * (a + 0.5)) / 9;
        const cy = r.top + (r.height * (b + 0.5)) / 9;
        if (cx < 30 || cy < 30 || cx > vw - 30 || cy > vh - 30) continue;
        if (cx > vw - 220 && cy > vh - 120) continue;
        const ok = ring(cx, cy, args.radius).every((p) => {
          const hit = document.elementFromPoint(p.x, p.y);
          return !!hit && el.contains(hit) && !!hit.closest(args.clip);
        });
        if (ok) return { x: cx, y: cy, r: args.radius, slug: el.dataset.slug ?? el.getAttribute("aria-label") ?? "" };
      }
    }
  }
  return null;
}

function pickEmptyPoint(args: { sticker: string; viewer: string; radius: number }) {
  const viewer = document.querySelector(args.viewer);
  const empty = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    return !!hit && !!viewer?.contains(hit) && !hit.closest(args.sticker);
  };
  for (let a = 1; a < 20; a++) {
    for (let b = 1; b < 20; b++) {
      const cx = (innerWidth * a) / 20;
      const cy = (innerHeight * b) / 20;
      const pts = [{ x: cx, y: cy }].concat(
        Array.from({ length: 16 }, (_, i) => ({
          x: cx + args.radius * Math.cos((i / 16) * 2 * Math.PI),
          y: cy + args.radius * Math.sin((i / 16) * 2 * Math.PI),
        }))
      );
      if (pts.every((p) => empty(p.x, p.y))) return { x: cx, y: cy, r: args.radius };
    }
  }
  return null;
}

async function loadIdle(page: Page, profile: ProfileName) {
  const timeout = profile === "mobile" ? 150_000 : 45_000;
  await page.goto(benchUrl(), { waitUntil: "load" });
  await page.waitForFunction(
    ([selector, count]) =>
      document.querySelectorAll(selector as string).length >= (count as number) &&
      [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    [contract.stickers, STICKER_COUNT] as const,
    { timeout }
  );
  await settled(page, 800, 30_000);
  await sleep(2000);
}

async function counters(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

const pageState = () => {
  const w = window as unknown as { __moves: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: { commits: number } };
  return { moves: w.__moves, commits: w.__REACT_DEVTOOLS_GLOBAL_HOOK__.commits };
};

async function hoverRun(page: Page, cdp: CDPSession) {
  const sticker = await page.evaluate(pickStickerPoint, { sticker: contract.stickers, radius: 16, clip: CLIP });
  const empty = await page.evaluate(pickEmptyPoint, { sticker: contract.stickers, viewer: contract.viewer, radius: 16 });
  if (!sticker || !empty) throw new Error(`no hover areas found: ${JSON.stringify({ sticker, empty })}`);
  const trials: { target: "sticker" | "empty"; moves: number; perMove: Record<string, number> }[] = [];
  for (let trial = 0; trial < HOVER_TRIALS; trial++) {
    for (const where of ["sticker", "empty"] as const) {
      const area = where === "sticker" ? sticker : empty;
      await page.mouse.move(area.x + area.r, area.y);
      await sleep(500);
      const before = await counters(cdp);
      const s0 = await page.evaluate(pageState);
      for (let i = 0; i < HOVER_MOVES; i++) {
        const angle = (i / 16) * 2 * Math.PI;
        await page.mouse.move(area.x + area.r * Math.cos(angle), area.y + area.r * Math.sin(angle));
        await sleep(6);
      }
      await sleep(300);
      const after = await counters(cdp);
      const s1 = await page.evaluate(pageState);
      const moves = s1.moves - s0.moves;
      expect(moves, "the page saw the mouse moves").toBeGreaterThan(HOVER_MOVES / 2);
      trials.push({
        target: where,
        moves,
        perMove: {
          taskMs: ((after.TaskDuration - before.TaskDuration) * 1000) / moves,
          scriptMs: ((after.ScriptDuration - before.ScriptDuration) * 1000) / moves,
          reactCommits: (s1.commits - s0.commits) / moves,
          styleRecalcs: (after.RecalcStyleCount - before.RecalcStyleCount) / moves,
          layouts: (after.LayoutCount - before.LayoutCount) / moves,
        },
      });
    }
  }
  const med = (where: string, key: string) =>
    round(percentile(trials.filter((t) => t.target === where).map((t) => t.perMove[key]), 50));
  return {
    name: "hover",
    stickerSlug: sticker.slug,
    taskMsPerMove: med("sticker", "taskMs"),
    scriptMsPerMove: med("sticker", "scriptMs"),
    reactCommitsPerMove: med("sticker", "reactCommits"),
    styleRecalcsPerMove: med("sticker", "styleRecalcs"),
    layoutsPerMove: med("sticker", "layouts"),
    emptyTaskMsPerMove: med("empty", "taskMs"),
    emptyReactCommitsPerMove: med("empty", "reactCommits"),
    trials,
  };
}

interface TapState {
  firstInputAt: number | null;
  maxInputDelay: number;
  delays: Record<string, number>;
  visibleAt: number | null;
}

function startTapRecorder(args: { handle: string }) {
  const w = window as unknown as { __tap: TapState };
  const s: TapState = { firstInputAt: null, maxInputDelay: 0, delays: {}, visibleAt: null };
  w.__tap = s;
  for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click"]) {
    window.addEventListener(
      type,
      (e) => {
        if (type === "touchstart" || type === "pointerdown") s.firstInputAt ??= e.timeStamp;
        const delay = performance.now() - e.timeStamp;
        s.delays[type] = Math.max(s.delays[type] ?? 0, delay);
        s.maxInputDelay = Math.max(s.maxInputDelay, delay);
      },
      { capture: true, passive: true }
    );
  }
  const tick = (t: number) => {
    const handle = document.querySelector(args.handle);
    const box = handle?.getBoundingClientRect();
    if (box && box.width > 0 && box.height > 0 && box.top < innerHeight) {
      s.visibleAt = t;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function sheetOpenRun(page: Page) {
  const point = await page.evaluate(pickStickerPoint, { sticker: contract.stickers, radius: 4, clip: CLIP });
  if (!point) throw new Error("no tappable sticker found");
  expect(await page.locator(contract.sheetHandle).count(), "sheet is not open before the tap").toBe(0);
  await page.evaluate(startTapRecorder, { handle: contract.sheetHandle });
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForFunction(() => (window as unknown as { __tap: TapState }).__tap.visibleAt !== null, null, {
    timeout: 30_000,
  });
  await sleep(500);
  const s = await page.evaluate(() => (window as unknown as { __tap: TapState }).__tap);
  if (s.firstInputAt === null || s.visibleAt === null) throw new Error("tap or sheet not observed");
  return {
    name: "sheet-open",
    stickerSlug: point.slug,
    inputDelayMs: round(s.maxInputDelay, 1),
    clickDelayMs: s.delays.click === undefined ? null : round(s.delays.click, 1),
    sheetVisibleMs: round(s.visibleAt - s.firstInputAt, 1),
    delays: s.delays,
  };
}

test.describe("interaction", () => {
  test.skip(!benchEnabled(), "set BENCH=1 to run benchmarks");
  test.skip(({ browserName }) => browserName !== "chromium", "CDP throttling and metrics are Chromium only");
  const label = benchLabel();

  for (let run = 1; run <= BENCH_RUNS; run++) {
    test(`interaction run ${run}`, async ({ page, context, browser }, testInfo) => {
      const profile = profileOf(testInfo.project.name);
      test.skip(profile === null, "bench runs on the chromium projects");
      if (profile === null) return;
      test.setTimeout(300_000);
      const dir = rawDir(label, profile);
      if (run === 1) fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const meta = runMeta(label, profile, browser);
      if (profile === "desktop") meta.cpuSlowdown = HOVER_CPU_SLOWDOWN;
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ ...meta, target }, null, 2));

      if (profile === "desktop") await page.addInitScript(INIT_SCRIPT);
      const cdp = await context.newCDPSession(page);
      await applyProfile(cdp, profile === "desktop" ? { ...PROFILES.desktop, cpuSlowdown: HOVER_CPU_SLOWDOWN } : PROFILES.mobile);
      await cdp.send("Performance.enable");
      await loadIdle(page, profile);

      const result = profile === "desktop" ? await hoverRun(page, cdp) : await sheetOpenRun(page);
      // Task 3.3: which build answered ("proto" = Pathway B's canvas prototype).
      const served = servedBuild(await page.evaluate(readProtoStats));
      fs.writeFileSync(
        path.join(dir, `${result.name}-${String(run).padStart(2, "0")}.json`),
        JSON.stringify({ ...result, servedBuild: served }, null, 2),
      );
    });
  }

  test.afterAll(() => {
    const profile = profileOf(test.info().project.name);
    if (profile) writeSummary(label, profile);
  });
});
