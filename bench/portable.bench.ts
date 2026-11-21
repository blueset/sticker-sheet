// Portable gesture probe for engines without CDP (WebKit, Firefox). BENCH=1
// only; no throttling, no trace, so it is a regression check, not a budget
// measurement.
//
//   $env:BENCH='1'; $env:BENCH_LABEL='m2-control'; $env:BENCH_QUERY='?v=...'
//   npx playwright test bench/portable --project=webkit-mobile --project=firefox-desktop
//
// Per run: fresh context, `BENCH_QUERY` appended to `/`, page loaded with every
// image decoded and the transform quiet, then one scenario with real
// Playwright input:
//   - wheel-zoom: 30 mouse wheel events (deltaY -80), one per ~16 ms, at the
//     viewer centre (mobile WebKit: untrusted WheelEvents, see `wheelInput`);
//   - drag-release: a 250 ms mouse drag by (-30 %, -25 %) of the viewer,
//     released while moving (inertia where the build has it).
// Recorded in the page:
//   - frames / over16 / p95FrameMs: rAF deltas from the first input event to
//     the last frame whose transform changed, snapped to one vsync within
//     0.4 ms as in gestures.bench.ts;
//   - settleMs: from the last input event to the first rAF callback after
//     `data-gesture` was removed from the viewer (settle plus one frame), by
//     performance.now(); null if it never settled.
// mainBusyMs, heap and raster are not available here.
//
// Results: raw runs in bench/results/tmp/<label>-portable-<project>/, summary
// in bench/results/<label>-portable-<project>.json.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { contract } from "../tests/contract.ts";
import { replay, settled } from "../tests/parity/replay.ts";
import { BENCH_RUNS, STICKER_COUNT, benchEnabled, benchQuery, benchUrl, sleep } from "./harness.ts";
import { percentile } from "./metrics.ts";
import { benchLabel, resultsDir } from "./results.ts";
import { statsOf } from "./summarize.ts";
import { FRAME_OVER_16_MS } from "./trace.ts";

const VSYNC_MS = 1000 / 60;
const RAF_TOLERANCE_MS = 0.4;

type ScenarioName = "wheel-zoom" | "drag-release";

export interface PortableResult {
  name: ScenarioName;
  input: "real" | "synthetic";
  frames: number;
  over16: number;
  p95FrameMs: number;
  settleMs: number | null;
  motionMs: number;
  scaleChange: number;
  maxMove: number;
}

interface ProbeState {
  frames: number[];
  lastMotionAt: number;
  firstInputAt: number | null;
  lastInputAt: number | null;
  settledAt: number | null;
  settleFrameAt: number | null;
  scaleMin: number;
  scaleMax: number;
  maxMove: number;
  stop: boolean;
}

function startProbe(selectors: { layer: string; viewer: string }): void {
  const layer = document.querySelector(selectors.layer) as Element;
  const viewer = document.querySelector(selectors.viewer) as Element;
  const read = () => {
    const m = new DOMMatrix(getComputedStyle(layer).transform);
    return { x: m.e, y: m.f, scale: m.a };
  };
  const start = read();
  const g: ProbeState = {
    frames: [],
    lastMotionAt: 0,
    firstInputAt: null,
    lastInputAt: null,
    settledAt: null,
    settleFrameAt: null,
    scaleMin: start.scale,
    scaleMax: start.scale,
    maxMove: 0,
    stop: false,
  };
  (window as unknown as { __p: ProbeState }).__p = g;
  for (const type of ["wheel", "pointerdown", "pointermove", "pointerup", "mousedown", "mousemove", "mouseup"]) {
    window.addEventListener(
      type,
      () => {
        const now = performance.now();
        g.firstInputAt ??= now;
        g.lastInputAt = now;
      },
      { capture: true, passive: true },
    );
  }
  new MutationObserver(() => {
    if (!viewer.hasAttribute("data-gesture")) {
      g.settledAt = performance.now();
      g.settleFrameAt = null;
    }
  }).observe(viewer, { attributes: true, attributeFilter: ["data-gesture"] });
  let last = getComputedStyle(layer).transform;
  const tick = (t: number) => {
    g.frames.push(t);
    const current = getComputedStyle(layer).transform;
    if (current !== last) {
      last = current;
      g.lastMotionAt = t;
      const now = read();
      g.scaleMin = Math.min(g.scaleMin, now.scale);
      g.scaleMax = Math.max(g.scaleMax, now.scale);
      g.maxMove = Math.max(g.maxMove, Math.hypot(now.x - start.x, now.y - start.y));
    }
    if (g.settledAt !== null && g.settleFrameAt === null) g.settleFrameAt = performance.now();
    if (!g.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const readProbe = () => ({ ...(window as unknown as { __p: ProbeState }).__p, now: performance.now() });

const scenarios: Array<{
  name: ScenarioName;
  run: (page: Page, box: { x: number; y: number; width: number; height: number }) => Promise<void>;
}> = [
  {
    name: "wheel-zoom",
    run: async (page, box) => {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      const started = Date.now();
      for (let i = 0; i < 30; i++) {
        await sleep(Math.max(0, started + i * 16 - Date.now()));
        if (wheelInput === "synthetic") {
          await page.evaluate(
            ([sel, cx, cy]) => {
              document.querySelector(sel as string)!.dispatchEvent(
                new WheelEvent("wheel", {
                  deltaY: -80,
                  clientX: cx as number,
                  clientY: cy as number,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            },
            [contract.layer, x, y] as const,
          );
        } else {
          await page.mouse.wheel(0, -80);
        }
      }
    },
  },
  {
    name: "drag-release",
    run: async (page, box) => {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await replay(
        page,
        [
          {
            t: "drag",
            from: [Math.round(cx + box.width * 0.15), Math.round(cy + box.height * 0.15)],
            by: [Math.round(-box.width * 0.3), Math.round(-box.height * 0.25)],
            ms: 250,
          },
        ],
        { input: "mouse" },
      );
    },
  },
];

const rawDir = (label: string, project: string) => path.join(resultsDir, "tmp", `${label}-portable-${project}`);

// Playwright has no mouse wheel in mobile WebKit; there the wheel scenario
// dispatches untrusted WheelEvents on the layer instead (recorded as `input`).
let wheelInput: "real" | "synthetic" = "real";

function writeSummary(label: string, project: string): void {
  const dir = rawDir(label, project);
  if (!fs.existsSync(dir)) return;
  const rows = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "meta.json")
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as PortableResult);
  const meta = fs.existsSync(path.join(dir, "meta.json"))
    ? JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"))
    : null;
  const gestures: Record<string, unknown> = {};
  for (const name of new Set(rows.map((r) => r.name))) {
    gestures[name] = statsOf(rows.filter((r) => r.name === name) as unknown as Record<string, unknown>[]);
  }
  const file = path.join(resultsDir, `${label}-portable-${project}.json`);
  fs.writeFileSync(file, JSON.stringify({ label, project, meta, gestures, raw: rows }, null, 2) + "\n");
}

test.describe("portable", () => {
  test.skip(!benchEnabled(), "set BENCH=1 to run benchmarks");
  const label = benchLabel();

  for (const scenario of scenarios) {
    for (let run = 1; run <= BENCH_RUNS; run++) {
      test(`${scenario.name} run ${run}`, async ({ page, browser, browserName, isMobile }, testInfo) => {
        test.setTimeout(120_000);
        wheelInput = browserName === "webkit" && isMobile ? "synthetic" : "real";
        const project = testInfo.project.name;
        const dir = rawDir(label, project);
        if (scenario.name === scenarios[0].name && run === 1) fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "meta.json"),
          JSON.stringify(
            {
              label,
              project,
              browserName,
              browser: browser.version(),
              runs: BENCH_RUNS,
              query: benchQuery(),
              recordedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        );

        await page.goto(benchUrl(), { waitUntil: "load" });
        await page.waitForFunction(
          ([selector, count]) =>
            document.querySelectorAll(selector as string).length >= (count as number) &&
            [...document.images].every((i) => i.complete && i.naturalWidth > 0),
          [contract.stickers, STICKER_COUNT] as const,
          { timeout: 60_000 },
        );
        await settled(page, 800, 30_000);
        // WebKit headless runs rAF sparsely for the first ~1.5 s after load.
        await sleep(2000);
        const box = await page.locator(contract.viewer).boundingBox();
        if (!box) throw new Error("viewer has no box");

        await page.evaluate(startProbe, { layer: contract.layer, viewer: contract.viewer });
        await scenario.run(page, box);

        const waitStart = Date.now();
        for (;;) {
          const g = await page.evaluate(readProbe);
          if ((g.now - g.lastMotionAt >= 700 && g.settleFrameAt !== null) || Date.now() - waitStart > 20_000) break;
          await sleep(100);
        }
        const g = await page.evaluate(readProbe);
        await page.evaluate(() => {
          (window as unknown as { __p: ProbeState }).__p.stop = true;
        });
        if (g.firstInputAt === null || g.lastInputAt === null || g.lastMotionAt === 0) {
          throw new Error(`${scenario.name}: no input reached the page or the layer never moved`);
        }
        const deltas: number[] = [];
        const inGesture = g.frames.filter((t) => t >= (g.firstInputAt as number) && t <= g.lastMotionAt);
        for (let i = 1; i < inGesture.length; i++) {
          const d = inGesture[i] - inGesture[i - 1];
          deltas.push(d <= VSYNC_MS + RAF_TOLERANCE_MS ? VSYNC_MS : d);
        }
        if (deltas.length === 0) throw new Error(`${scenario.name}: no frames recorded in the gesture`);
        const result: PortableResult = {
          name: scenario.name,
          input: scenario.name === "wheel-zoom" ? wheelInput : "real",
          frames: deltas.length,
          over16: deltas.filter((d) => d > FRAME_OVER_16_MS).length,
          p95FrameMs: percentile(deltas, 95),
          settleMs: g.settleFrameAt === null ? null : g.settleFrameAt - g.lastInputAt,
          motionMs: g.lastMotionAt - g.firstInputAt,
          scaleChange: g.scaleMax / g.scaleMin,
          maxMove: g.maxMove,
        };
        fs.writeFileSync(path.join(dir, `${scenario.name}-${run}.json`), JSON.stringify(result, null, 2));
        console.log(
          `[${label}/${project}] ${scenario.name} run ${run}: frames ${result.frames} p95 ${result.p95FrameMs.toFixed(1)} ` +
            `over16 ${result.over16} settle ${result.settleMs?.toFixed(0) ?? "null"} motion ${result.motionMs.toFixed(0)} ` +
            `scale x${result.scaleChange.toFixed(2)} move ${result.maxMove.toFixed(0)}`,
        );
        if (scenario.name === "wheel-zoom") expect(result.scaleChange).toBeGreaterThan(1.05);
        else expect(result.maxMove).toBeGreaterThan(30);
      });
    }
  }

  test.afterAll(() => writeSummary(label, test.info().project.name));
});
