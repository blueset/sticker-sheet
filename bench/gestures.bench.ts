// Gesture bench. Chromium only (CDP throttling and tracing), BENCH=1 only.
//
//   $env:BENCH='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'
//   npx playwright test bench/gestures --project=chromium-mobile
//
// Scenarios use real input only (mouse wheel, mouse or CDP touch drag with
// release, CDP two-finger touch pinch, taps/clicks on the zoom buttons) and
// only `contract` selectors, so the same file benchmarks any build served via
// TARGET/STATIC_DIR. `pinch` needs touch, so it only runs on the mobile
// profile; on desktop it is skipped and absent from the JSON.
//
// A/B probes: BENCH_LABEL=<name> BENCH_RUNS=<n> BENCH_PROBE_CSS='<css>' injects
// the CSS after load (placeholders `{stickers}` and `{layer}` expand to the
// contract selectors) and writes bench/results/<name>-<profile>.json. Used once
// at Milestone 0 to remove the sticker drop-shadow filters; never set for a
// real baseline.
//
// Per run: fresh context, profile throttling, page fully loaded and idle, then
//   - an in-page rAF loop records frame timestamps, the layer's computed
//     transform (to find when motion stops) and input-event lateness;
//   - a Chrome trace (devtools.timeline + the two *.timeline.frame
//     categories) runs from a `console.timeStamp` marker until after the last
//     raster; a paired performance.now() reading maps page time to trace time;
//   - CDP Performance.getMetrics is sampled every 100 ms for the JS heap.
//
// Definitions:
// - frames / over16 / over33 / p95FrameMs: deltas between consecutive rAF
//   timestamps from the first input event to the last frame whose transform
//   changed ("motion end"). A delta is "over 16" / "over 33" when it exceeds
//   16.7 / 33 ms. rAF timestamps are coarsened to 0.1 ms, so deltas within
//   RAF_TOLERANCE_MS of one vsync are snapped to one vsync (see below); this
//   is main-thread frame cadence. Compositor-only work is not visible to it,
//   and the trace-derived `traceOver16/33` (gaps between consecutive DrawFrame
//   events, see trace.ts) are recorded alongside. DrawFrame times jitter by
//   about +/-2 ms around the vsync and are only emitted when there is damage,
//   so those counts are an upper-bound signal, not the headline.
// - mainBusyMs: sum of renderer main-thread RunTask time between the first
//   input and motion end (trace.ts).
// - crispAfterMs: PROXY. Gap from the last input event to the end of the last
//   RasterTask after the gesture started, clamped at 0 (null if no raster).
//   It includes any animation/inertia tail and the page's own settle timers;
//   it does not prove the final pixels are sharp, only that raster work has
//   stopped.
// - peakHeapMb: maximum CDP Performance.getMetrics JSHeapUsedSize sampled every
//   100 ms from before the gesture until the trace stops. JS heap only: GPU
//   textures, decoded images and compositor memory are not included.
// - inputDelayMs: worst (performance.now() when a capture-phase window listener
//   ran) - (event.timeStamp) over wheel/pointer/touch/mouse/click events.
import { test, expect } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";
import { contract } from "../tests/contract.ts";
import { replay, settled } from "../tests/parity/replay.ts";
import { PROFILES } from "./profiles.ts";
import {
  BENCH_RUNS,
  STICKER_COUNT,
  applyProfile,
  benchEnabled,
  probeCss,
  profileOf,
  runMeta,
  sleep,
} from "./harness.ts";
import { percentile } from "./metrics.ts";
import {
  FRAME_OVER_16_MS,
  FRAME_OVER_33_MS,
  analyzeTrace,
  markerMs,
  rasterMs,
  type TraceEvent,
} from "./trace.ts";
import {
  benchLabel,
  clearRaw,
  writeRaw,
  type GestureName,
  type GestureResult,
  type ProfileName,
} from "./results.ts";
import { writeSummary } from "./summarize.ts";

const VSYNC_MS = 1000 / 60;
// rAF timestamps are coarsened to 0.1 ms, so a healthy 16.667 ms frame reads
// 16.6-16.8. Deltas within this tolerance of one vsync are snapped to exactly
// one vsync; anything longer is kept as measured.
const RAF_TOLERANCE_MS = 0.4;
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.frame",
];

interface GestureState {
  frames: number[];
  lastMotionAt: number;
  firstInputAt: number | null;
  lastInputAt: number | null;
  maxInputDelay: number;
  start: { x: number; y: number; scale: number };
  scaleMin: number;
  scaleMax: number;
  maxMove: number;
  stop: boolean;
}

// Runs in the page right before the gesture. Self-contained: Playwright
// serialises it. Returns performance.now() at the trace marker.
function startRecorder(layerSelector: string): number {
  const layer = document.querySelector(layerSelector) as Element;
  const w = window as unknown as { __g: GestureState };
  const read = () => {
    const m = new DOMMatrix(getComputedStyle(layer).transform);
    return { x: m.e, y: m.f, scale: m.a };
  };
  const start = read();
  const g: GestureState = {
    frames: [],
    lastMotionAt: 0,
    firstInputAt: null,
    lastInputAt: null,
    maxInputDelay: 0,
    start,
    scaleMin: start.scale,
    scaleMax: start.scale,
    maxMove: 0,
    stop: false,
  };
  w.__g = g;

  for (const type of [
    "wheel",
    "pointerdown",
    "pointermove",
    "pointerup",
    "touchstart",
    "touchmove",
    "touchend",
    "mousedown",
    "mouseup",
    "click",
  ]) {
    window.addEventListener(
      type,
      (e) => {
        g.firstInputAt ??= e.timeStamp;
        g.lastInputAt = e.timeStamp;
        g.maxInputDelay = Math.max(g.maxInputDelay, performance.now() - e.timeStamp);
      },
      { capture: true, passive: true }
    );
  }

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
      g.maxMove = Math.max(
        g.maxMove,
        Math.hypot(now.x - start.x, now.y - start.y)
      );
    }
    if (!g.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const at = performance.now();
  console.timeStamp("bench:start");
  return at;
}

const readGesture = () => {
  const w = window as unknown as { __g: GestureState };
  return { ...w.__g, now: performance.now() };
};

const stopRecorder = () => {
  (window as unknown as { __g: GestureState }).__g.stop = true;
};

interface Metrics {
  heapMb: number;
  counters: Record<string, number>;
}

async function readMetrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const counters: Record<string, number> = {};
  for (const m of metrics) counters[m.name] = m.value;
  return { heapMb: (counters.JSHeapUsedSize ?? 0) / 1048576, counters };
}

type Scenario = {
  name: GestureName;
  needsTouch: boolean;
  // Minimum evidence that the scenario really did something.
  expect: "zoom" | "pan";
  run: (ctx: {
    page: Page;
    cdp: CDPSession;
    profile: ProfileName;
    viewer: { x: number; y: number; width: number; height: number };
  }) => Promise<void>;
};

const paced = async (count: number, everyMs: number, send: (i: number) => Promise<void>) => {
  const started = Date.now();
  const pending: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    await sleep(Math.max(0, started + i * everyMs - Date.now()));
    pending.push(send(i));
  }
  await Promise.all(pending);
};

const scenarios: Scenario[] = [
  {
    name: "wheel-zoom",
    needsTouch: false,
    expect: "zoom",
    // One continuous zoom-in ramp: 60 wheel events, one per frame.
    run: async ({ page, viewer }) => {
      await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + viewer.height / 2);
      await paced(60, 16, () => page.mouse.wheel(0, -80));
    },
  },
  {
    name: "drag-inertia",
    needsTouch: false,
    expect: "pan",
    // A quick flick with release: touch on mobile, mouse on desktop.
    run: async ({ page, profile, viewer }) => {
      const cx = viewer.x + viewer.width / 2;
      const cy = viewer.y + viewer.height / 2;
      await replay(
        page,
        [
          {
            t: "drag",
            from: [Math.round(cx + viewer.width * 0.15), Math.round(cy + viewer.height * 0.15)],
            by: [Math.round(-viewer.width * 0.3), Math.round(-viewer.height * 0.25)],
            ms: 250,
          },
        ],
        { input: profile === "mobile" ? "touch" : "mouse" }
      );
    },
  },
  {
    name: "pinch",
    needsTouch: true,
    expect: "zoom",
    // Two fingers spread from 80 px to 280 px apart over ~0.5 s.
    run: async ({ cdp, viewer }) => {
      const cx = viewer.x + viewer.width / 2;
      const cy = viewer.y + viewer.height / 2;
      const points = (half: number) => [
        { id: 1, x: cx - half, y: cy },
        { id: 2, x: cx + half, y: cy },
      ];
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: points(40),
      });
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: points(40 + (100 * i) / steps),
        });
        await sleep(16);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    },
  },
  {
    name: "button-zoom",
    needsTouch: false,
    expect: "zoom",
    // Four zoom-in presses, 350 ms apart (mouse click on desktop, tap on mobile).
    run: async ({ page, profile }) => {
      const box = await page.locator(contract.controls.zoomIn).boundingBox();
      if (!box) throw new Error("zoom-in control has no box");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      for (let i = 0; i < 4; i++) {
        if (profile === "mobile") await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await sleep(350);
      }
    },
  },
];

const loadTimeoutMs = (profile: ProfileName) =>
  profile === "mobile" ? 150_000 : 45_000;

test.describe("gestures", () => {
  test.skip(!benchEnabled(), "set BENCH=1 to run benchmarks");
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "CDP throttling and tracing are Chromium only"
  );

  const label = benchLabel();

  for (const scenario of scenarios) {
    for (let run = 1; run <= BENCH_RUNS; run++) {
      test(`${scenario.name} run ${run}`, async ({ page, context, browser }, testInfo) => {
        const profile = profileOf(testInfo.project.name);
        test.skip(profile === null, "bench runs on the chromium projects");
        test.skip(
          scenario.needsTouch && profile !== "mobile",
          `${scenario.name} needs touch input: mobile profile only`
        );
        if (profile === null) return;
        test.setTimeout(loadTimeoutMs(profile) + 120_000);
        if (scenario.name === scenarios[0].name && run === 1) {
          clearRaw(label, profile, "gesture-");
        }
        writeRaw(label, profile, "meta.json", runMeta(label, profile, browser));

        const cdp = await context.newCDPSession(page);
        await applyProfile(cdp, PROFILES[profile]);
        await cdp.send("Performance.enable");

        await page.goto("/", { waitUntil: "load" });
        await page.waitForFunction(
          ([selector, count]) =>
            document.querySelectorAll(selector as string).length >= (count as number) &&
            [...document.images].every((i) => i.complete && i.naturalWidth > 0),
          [contract.stickers, STICKER_COUNT] as const,
          { timeout: loadTimeoutMs(profile) }
        );
        await settled(page, 800, 30_000);
        const css = probeCss(contract);
        if (css) {
          await page.addStyleTag({ content: css });
          await settled(page, 800, 30_000);
        }
        await sleep(2000);

        const viewerBox = await page.locator(contract.viewer).boundingBox();
        if (!viewerBox) throw new Error("viewer has no box");

        const before = await readMetrics(cdp);
        let peakHeapMb = before.heapMb;
        let sampling = true;
        const sampler = (async () => {
          while (sampling) {
            await sleep(100);
            if (!sampling) break;
            try {
              peakHeapMb = Math.max(peakHeapMb, (await readMetrics(cdp)).heapMb);
            } catch {
              // Page busy or closing: keep the last peak.
            }
          }
        })();

        await browser.startTracing(page, { categories: TRACE_CATEGORIES });
        const markerPage = await page.evaluate(startRecorder, contract.layer);

        await scenario.run({ page, cdp, profile, viewer: viewerBox });

        // Wait for motion to stop (0.7 s without a transform change), then
        // leave time for the final raster to land inside the trace.
        const waitStart = Date.now();
        for (;;) {
          const g = await page.evaluate(readGesture);
          if (g.now - g.lastMotionAt >= 700 || Date.now() - waitStart > 20_000) break;
          await sleep(100);
        }
        await sleep(profile === "mobile" ? 2500 : 1500);
        const g = await page.evaluate(readGesture);
        await page.evaluate(stopRecorder);
        sampling = false;
        await sampler;
        const after = await readMetrics(cdp);
        peakHeapMb = Math.max(peakHeapMb, after.heapMb);
        const traceBuffer = await browser.stopTracing();
        const events = JSON.parse(traceBuffer.toString()).traceEvents as TraceEvent[];

        const markerTrace = markerMs(events, "bench:start");
        if (markerTrace === null) throw new Error("bench:start marker missing from trace");
        const toTrace = (pageMs: number) => pageMs + (markerTrace - markerPage);

        if (g.firstInputAt === null || g.lastInputAt === null || g.lastMotionAt === 0) {
          throw new Error(
            `${scenario.name}: no input reached the page or the layer never moved ` +
              `(firstInput=${g.firstInputAt}, motion=${g.lastMotionAt})`
          );
        }
        const scaleChange = g.scaleMax / g.scaleMin;
        if (scenario.expect === "zoom" && scaleChange < 1.05) {
          throw new Error(`${scenario.name}: scale only changed by x${scaleChange.toFixed(3)}`);
        }
        if (scenario.expect === "pan" && g.maxMove < 30) {
          throw new Error(`${scenario.name}: layer only moved ${g.maxMove.toFixed(1)} px`);
        }

        const deltas: number[] = [];
        const inGesture = g.frames.filter(
          (t) => t >= (g.firstInputAt as number) && t <= g.lastMotionAt
        );
        for (let i = 1; i < inGesture.length; i++) {
          const d = inGesture[i] - inGesture[i - 1];
          deltas.push(d <= VSYNC_MS + RAF_TOLERANCE_MS ? VSYNC_MS : d);
        }
        if (deltas.length === 0) throw new Error(`${scenario.name}: no frames recorded in the gesture`);

        const windowTrace = {
          startMs: toTrace(g.firstInputAt),
          endMs: toTrace(g.lastMotionAt),
        };
        const analysis = analyzeTrace(events, windowTrace);
        const inputEndTrace = toTrace(g.lastInputAt);
        const crispAfterMs =
          analysis.lastRasterEndMs === null
            ? null
            : Math.max(0, analysis.lastRasterEndMs - inputEndTrace);
        const traceEnd = events.reduce(
          (m, e) => Math.max(m, (e.ts + (e.dur ?? 0)) / 1000),
          0
        );
        if (analysis.lastRasterEndMs !== null && traceEnd - analysis.lastRasterEndMs < 300) {
          console.warn(
            `[${scenario.name} run ${run}] raster may extend past the trace end (tail ${(
              traceEnd - analysis.lastRasterEndMs
            ).toFixed(0)} ms)`
          );
        }

        const delta = (name: string) =>
          ((after.counters[name] ?? 0) - (before.counters[name] ?? 0));
        const result: GestureResult = {
          name: scenario.name,
          frames: deltas.length,
          over16: deltas.filter((d) => d > FRAME_OVER_16_MS).length,
          over33: deltas.filter((d) => d > FRAME_OVER_33_MS).length,
          p95FrameMs: percentile(deltas, 95),
          mainBusyMs: analysis.mainBusyMs,
          crispAfterMs,
          peakHeapMb,
          motionMs: g.lastMotionAt - g.firstInputAt,
          traceOver16: analysis.framesOver16,
          traceOver33: analysis.framesOver33,
          rasterMs: rasterMs(events, windowTrace),
          rasterAfterInputMs: rasterMs(events, {
            startMs: inputEndTrace,
            endMs: Number.POSITIVE_INFINITY,
          }),
          scriptMs: delta("ScriptDuration") * 1000,
          layoutMs: delta("LayoutDuration") * 1000,
          styleMs: delta("RecalcStyleDuration") * 1000,
          layoutCount: delta("LayoutCount"),
          styleRecalcCount: delta("RecalcStyleCount"),
          inputDelayMs: g.maxInputDelay,
          scaleChange,
          worstFramesMs: [...deltas].sort((a, b) => b - a).slice(0, 5),
        };
        writeRaw(label, profile, `gesture-${scenario.name}-${run}.json`, result);
        console.log(
          `[${label}/${profile}] ${scenario.name} run ${run}: frames ${result.frames} p95 ${result.p95FrameMs.toFixed(1)} ` +
            `over16 ${result.over16} over33 ${result.over33} busy ${result.mainBusyMs.toFixed(0)} ` +
            `crisp ${crispAfterMs?.toFixed(0) ?? "null"} heap ${peakHeapMb.toFixed(1)} ` +
            `scale x${scaleChange.toFixed(2)} move ${g.maxMove.toFixed(0)}`
        );
        expect(result.frames).toBeGreaterThan(0);
      });
    }
  }

  test.afterAll(() => {
    const profile = profileOf(test.info().project.name);
    if (profile) writeSummary(label, profile);
  });
});
