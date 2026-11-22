// First-render bench. Chromium only (CDP throttling), BENCH=1 only.
//
//   $env:BENCH='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'
//   npx playwright test bench/first-render --project=chromium-mobile
//
// Each run is a fresh browser context (cold cache) with the profile's CPU and
// network throttling applied before the first navigation. Only `contract`
// selectors and passive observers are used, so the same file benchmarks any
// build served via TARGET/STATIC_DIR.
//
// Definitions (all times in ms from navigation start):
// - fcp / lcp: PerformanceObserver `paint` / `largest-contentful-paint` (the
//   last LCP candidate seen before the observation window closed; no input is
//   ever sent, so Chrome never finalises it early).
// - cls: sum of every `layout-shift` value without recent input. This is the
//   strictest reading (no session-window maximum), matching "zero layout shift".
// - ttiProxyMs: Lighthouse-style quiet-window TTI without the network-quiet
//   condition. Start at FCP; while the next long task (>50 ms, `longtask`
//   observer) starts less than 5 s after the end of the current candidate,
//   move the candidate to that task's end. Result is the candidate.
// - tbt: Lighthouse total blocking time over [FCP, ttiProxyMs]: each long
//   task is clipped to the window and contributes (clipped duration - 50 ms).
// - allStickersPaintedMs: first rAF at which every `contract.stickers` element
//   is visible (checkVisibility) and every img element in the document is
//   `complete && naturalWidth > 0`, with at least STICKER_COUNT stickers.
// - liveCurrentMs: first rAF at which `document.body.innerText` contains
//   today's `toLocaleDateString('en-GB', {day:'2-digit', month:'short',
//   year:'numeric'})`; null if that never happens before the deadline. The
//   check runs on the first rAF, on every rAF after any DOM mutation (child
//   list, text or attribute), and on every rAF while the date is in
//   `textContent` but not yet in `innerText`, so a value revealed by an
//   attribute or a rendering change alone (content-visibility) is not missed.
// - inputReadyMs: performance.now() at the assignment of `window.__app`,
//   recorded by an accessor installed at document start. The viewer entry
//   (src/viewer/main.ts) makes that assignment last, in the same task that
//   created the controller (pointer, wheel and key listeners), attached the
//   `[data-action]` click listener and ran initInteractions (tooltip,
//   selection, hash anchors), so no input can be handled before it and every
//   input is handled after it. Null for a build without the signal.
// - entryStartMs / entryEndMs: first request start and last responseEnd of
//   the eager viewer graph (metrics.ts EAGER_GRAPH_PATTERNS), from resource
//   timing; null when no file matches.
// - criticalPathJsGzip: gzip level 9 of the decoded body of every `Script`
//   response whose resource-timing responseEnd is <= LCP. Inline scripts are
//   part of the HTML document and are counted under `bytes.html` only.
// - criticalPathMarkers: names of the libraries (metrics.ts PAYLOAD_MARKERS:
//   react-dom, radix, silk, leaflet, baseline-status) whose content markers
//   occur in those same before-LCP script bodies. Gate: on mobile every run
//   needs criticalPathJsGzip <= 100 KB and no markers; on desktop the last
//   run checks the median criticalPathJsGzip of the recorded runs <= 100 KB
//   and markers are only logged (BENCH_PAYLOAD_GATE=0 disables it, e.g. for
//   TARGET=baseline).
// - bytes: `Network.loadingFinished.encodedDataLength` (what crossed the wire,
//   including headers) per CDP resource type, over the whole run.
// - BENCH_QUERY (e.g. '#vocaloid') is appended to the page URL.
import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";
import { contract } from "../tests/contract.ts";
import { PROFILES } from "./profiles.ts";
import {
  BENCH_RUNS,
  BENCH_RUN_FROM,
  STICKER_COUNT,
  applyProfile,
  benchEnabled,
  benchUrl,
  profileOf,
  runMeta,
  sleep,
} from "./harness.ts";
import {
  CRITICAL_JS_BUDGET,
  criticalJsGateValue,
  eagerGraphTiming,
  gzipBytes,
  payloadMarkers,
  QUIET_WINDOW_MS,
  totalBlockingTime,
  ttiProxy,
} from "./metrics.ts";
import {
  benchLabel,
  clearRaw,
  readRaw,
  writeRaw,
  type ByteBreakdown,
  type FirstRenderDetail,
  type FirstRenderResult,
  type ProfileName,
} from "./results.ts";
import { writeSummary } from "./summarize.ts";
import { protoLoadSummary, readProtoStats, servedBuild, type ProtoStatsLike } from "./proto.ts";

interface RecorderState {
  fcp: number | null;
  lcp: { time: number; tag: string; url: string; size: number } | null;
  cls: number;
  lastShiftAt: number;
  longTasks: Array<[number, number]>;
  firstStickerMs: number | null;
  // [rAF time, sticker element count], appended whenever the count changes.
  stickerCounts: Array<[number, number]>;
  allPaintedMs: number | null;
  liveMs: number | null;
  inputReadyMs: number | null;
}

interface Snapshot extends RecorderState {
  now: number;
}

interface ResourceTiming {
  url: string;
  start: number;
  end: number;
  transferSize: number;
  renderBlocking: string | null;
}

// Runs in the page at document start. Self-contained: Playwright serialises it.
function installRecorder(opts: { stickers: string; count: number }) {
  if (window.top !== window) return;
  const w = window as unknown as { __bench: RecorderState };
  const b: RecorderState = {
    fcp: null,
    lcp: null,
    cls: 0,
    lastShiftAt: 0,
    longTasks: [],
    firstStickerMs: null,
    stickerCounts: [],
    allPaintedMs: null,
    liveMs: null,
    inputReadyMs: null,
  };
  w.__bench = b;

  // The viewer entry assigns `window.__app` last, in the same task that
  // attached the controller's pointer/wheel listeners, the `[data-action]`
  // click listener and the sticker interactions: the first moment it can
  // handle input. A pass-through accessor records that time exactly.
  let app: unknown;
  try {
    Object.defineProperty(window, "__app", {
      configurable: true,
      enumerable: true,
      get: () => app,
      set: (v: unknown) => {
        app = v;
        if (v !== undefined && b.inputReadyMs === null) b.inputReadyMs = performance.now();
      },
    });
  } catch {
    // Not definable: inputReadyMs stays null.
  }

  const observe = (type: string, cb: (entries: PerformanceEntry[]) => void) => {
    try {
      new PerformanceObserver((list) => cb(list.getEntries())).observe({
        type,
        buffered: true,
      });
    } catch {
      // Unsupported entry type: the field stays null.
    }
  };
  observe("paint", (entries) => {
    for (const e of entries) {
      if (e.name === "first-contentful-paint" && b.fcp === null) {
        b.fcp = e.startTime;
      }
    }
  });
  observe("largest-contentful-paint", (entries) => {
    for (const e of entries as unknown as Array<
      PerformanceEntry & { element?: Element | null; url?: string; size: number }
    >) {
      b.lcp = {
        time: e.startTime,
        tag: e.element?.tagName ?? "",
        url: e.url ?? "",
        size: e.size,
      };
    }
  });
  observe("layout-shift", (entries) => {
    for (const e of entries as unknown as Array<
      PerformanceEntry & { value: number; hadRecentInput: boolean }
    >) {
      if (!e.hadRecentInput) {
        b.cls += e.value;
        b.lastShiftAt = e.startTime;
      }
    }
  });
  observe("longtask", (entries) => {
    for (const e of entries) b.longTasks.push([e.startTime, e.duration]);
  });

  const dateText = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  // The innerText check only re-runs after a DOM mutation. Attributes count:
  // a live value can be written while hidden and revealed later by an
  // attribute alone (the rewrite's `[data-live]:not([data-filled])` CSS, or a
  // class/attribute gate on an ancestor), which childList/characterData miss.
  let dirty = true;
  new MutationObserver(() => {
    dirty = true;
  }).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });

  const tick = (t: number) => {
    const els = document.querySelectorAll(opts.stickers);
    const seen = b.stickerCounts[b.stickerCounts.length - 1];
    if (!seen || seen[1] !== els.length) b.stickerCounts.push([t, els.length]);
    if (b.firstStickerMs === null && els.length > 0) b.firstStickerMs = t;
    if (b.allPaintedMs === null && els.length >= opts.count) {
      let ok = true;
      const imgs = document.images;
      for (let i = 0; i < imgs.length && ok; i++) {
        ok = imgs[i].complete && imgs[i].naturalWidth > 0;
      }
      for (let i = 0; i < els.length && ok; i++) {
        ok = els[i].checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      }
      if (ok) b.allPaintedMs = t;
    }
    if (b.liveMs === null && dirty && document.body) {
      // textContent is a cheap prefilter; innerText (layout) confirms. While
      // the text is in the DOM but not rendered, stay dirty: rendering can
      // change without any mutation (e.g. `content-visibility: auto` deciding
      // a sticker is relevant one frame after it was filled).
      if (document.body.textContent?.includes(dateText)) {
        if (document.body.innerText.includes(dateText)) b.liveMs = t;
      } else {
        dirty = false;
      }
    }
    if (b.allPaintedMs === null || b.liveMs === null) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

const snapshot = (): Snapshot => {
  const w = window as unknown as { __bench?: RecorderState };
  return { ...(w.__bench as RecorderState), now: performance.now() };
};

const resourceTimings = (): ResourceTiming[] =>
  (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(
    (r) => ({
      url: r.name,
      start: r.startTime,
      end: r.responseEnd,
      transferSize: r.transferSize,
      renderBlocking:
        (r as PerformanceResourceTiming & { renderBlockingStatus?: string })
          .renderBlockingStatus ?? null,
    })
  );

// Sticker elements present at the last rAF at or before `atMs`.
function stickersAt(counts: Array<[number, number]>, atMs: number): number {
  let n = 0;
  for (const [t, count] of counts) {
    if (t > atMs) break;
    n = count;
  }
  return n;
}

const bucketOf = (type: string): keyof ByteBreakdown => {
  switch (type) {
    case "Document":
      return "html";
    case "Script":
      return "js";
    case "Stylesheet":
      return "css";
    case "Image":
      return "img";
    case "Font":
      return "font";
    default:
      return "other";
  }
};

const emptyBytes = (): ByteBreakdown => ({
  js: 0,
  css: 0,
  img: 0,
  font: 0,
  html: 0,
  other: 0,
});

interface Tracked {
  url: string;
  type: string;
  encoded: number;
  finished: boolean;
}

function trackNetwork(cdp: CDPSession) {
  const reqs = new Map<string, Tracked>();
  cdp.on("Network.responseReceived", (e) => {
    reqs.set(e.requestId, {
      url: e.response.url,
      type: e.type,
      encoded: 0,
      finished: false,
    });
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.encoded = e.encodedDataLength;
      r.finished = true;
    }
  });
  return reqs;
}

// Time budget for one run, measured from navigation start.
const deadlineMs = (profile: ProfileName) =>
  profile === "mobile" ? 120_000 : 40_000;

test.describe("first render", () => {
  test.skip(!benchEnabled(), "set BENCH=1 to run benchmarks");
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "CDP throttling and tracing are Chromium only"
  );

  const label = benchLabel();

  for (let run = BENCH_RUN_FROM; run < BENCH_RUN_FROM + BENCH_RUNS; run++) {
    test(`run ${run}`, async ({ page, context, browser }, testInfo) => {
      const profileName = profileOf(testInfo.project.name);
      test.skip(profileName === null, "bench runs on the chromium projects");
      if (profileName === null) return;
      const deadline = deadlineMs(profileName);
      test.setTimeout(deadline + 120_000);
      if (run === 1) clearRaw(label, profileName, "first-render-");
      writeRaw(label, profileName, "meta.json", runMeta(label, profileName, browser));

      await page.addInitScript(installRecorder, {
        stickers: contract.stickers,
        count: STICKER_COUNT,
      });
      const cdp = await context.newCDPSession(page);
      await applyProfile(cdp, PROFILES[profileName]);
      await cdp.send("Network.enable", {
        maxTotalBufferSize: 200 * 1024 * 1024,
        maxResourceBufferSize: 50 * 1024 * 1024,
      });
      const reqs = trackNetwork(cdp);
      await routeImageProbe(page);

      await page.goto(benchUrl(), { waitUntil: "commit" });

      let last: Snapshot | null = null;
      for (;;) {
        await sleep(500);
        let snap: Snapshot;
        try {
          snap = await page.evaluate(snapshot);
        } catch {
          continue; // navigation still committing
        }
        if (!snap.longTasks) continue;
        last = snap;
        if (snap.now >= deadline) break;
        const lastLongTaskEnd = snap.longTasks.reduce(
          (m, [s, d]) => Math.max(m, s + d),
          0
        );
        const quietSince = Math.max(
          snap.fcp ?? 0,
          snap.lcp?.time ?? 0,
          snap.lastShiftAt,
          lastLongTaskEnd,
          snap.allPaintedMs ?? 0,
          snap.liveMs ?? 0,
          snap.inputReadyMs ?? 0
        );
        const painted = snap.allPaintedMs !== null;
        // The live date is waited for until the deadline; everything else
        // must have been quiet for QUIET_WINDOW_MS.
        if (painted && snap.liveMs !== null && snap.now - quietSince >= QUIET_WINDOW_MS) {
          break;
        }
      }
      if (!last || last.fcp === null || last.lcp === null) {
        throw new Error("page never produced FCP/LCP");
      }
      if (last.allPaintedMs === null) {
        throw new Error(
          `stickers never all painted within ${deadline} ms (stickers=${contract.stickers})`
        );
      }
      const final = await page.evaluate(snapshot);
      const protoStats = (await page.evaluate(readProtoStats)) as ProtoStatsLike | null;
      const timings = await page.evaluate(resourceTimings);
      const cpuProbeMs = await page.evaluate(() => {
        const t = performance.now();
        let x = 0;
        for (let i = 0; i < 5_000_000; i++) x += Math.sqrt(i);
        return performance.now() - t + (x < 0 ? 1 : 0);
      });

      const fcp = final.fcp as number;
      const lcp = final.lcp as { time: number; tag: string; url: string; size: number };
      const tti = ttiProxy(fcp, final.longTasks);
      const timingByUrl = new Map(timings.map((t) => [t.url, t]));

      const bytes = emptyBytes();
      const requests = emptyBytes();
      const bytesBeforeLcp = emptyBytes();
      let imageCount = 0;
      const scripts: FirstRenderDetail["scripts"] = [];
      let criticalJs = 0;
      const criticalMarkers = new Set<string>();
      for (const r of reqs.values()) {
        if (!r.finished) continue;
        const bucket = bucketOf(r.type);
        bytes[bucket] += r.encoded;
        requests[bucket]++;
        if (r.type === "Image") imageCount++;
        const timing = timingByUrl.get(r.url);
        if (timing && timing.end <= lcp.time) {
          bytesBeforeLcp[bucket] += timing.transferSize || r.encoded;
        }
      }
      for (const [requestId, r] of reqs) {
        if (r.type !== "Script" || !r.finished) continue;
        let gzip = r.encoded;
        let markers: string[] | null = null;
        try {
          const { body, base64Encoded } = await cdp.send(
            "Network.getResponseBody",
            { requestId }
          );
          const buf = Buffer.from(body, base64Encoded ? "base64" : "utf8");
          gzip = gzipBytes(buf);
          markers = payloadMarkers(buf.toString("utf8"));
        } catch {
          // Body evicted: fall back to the bytes that crossed the wire.
        }
        const timing = timingByUrl.get(r.url);
        const beforeLcp = !!timing && timing.end <= lcp.time;
        if (beforeLcp) {
          criticalJs += gzip;
          if (markers === null) criticalMarkers.add("unknown (body evicted)");
          for (const m of markers ?? []) criticalMarkers.add(m);
        }
        scripts.push({
          url: r.url,
          gzip,
          transferred: r.encoded,
          startMs: timing ? Math.round(timing.start) : null,
          endMs: timing ? Math.round(timing.end) : null,
          beforeLcp,
          markers,
        });
      }

      const sortedScripts = scripts.sort((a, b) => (a.endMs ?? 0) - (b.endMs ?? 0));
      const entry = eagerGraphTiming(sortedScripts);
      const result: FirstRenderResult = {
        fcp,
        lcp: lcp.time,
        tbt: totalBlockingTime(fcp, tti, final.longTasks),
        cls: final.cls,
        allStickersPaintedMs: final.allPaintedMs as number,
        liveCurrentMs: final.liveMs,
        inputReadyMs: final.inputReadyMs,
        entryStartMs: entry?.startMs ?? null,
        entryEndMs: entry?.endMs ?? null,
        criticalPathJsGzip: criticalJs,
        criticalPathMarkers: [...criticalMarkers].sort(),
        bytes,
        bytesBeforeLcp,
        firstStickerMs: final.firstStickerMs,
        stickersAtFcp: stickersAt(final.stickerCounts, fcp),
        ttiProxyMs: tti,
        longTaskCount: final.longTasks.length,
        cpuProbeMs,
        detail: {
          lcp: { tag: lcp.tag, url: lcp.url, size: lcp.size },
          scripts: sortedScripts,
          stylesheets: timings
            .filter((t) => timingUrlIsStylesheet(reqs, t.url))
            .map((t) => ({
              url: t.url,
              startMs: Math.round(t.start),
              endMs: Math.round(t.end),
              renderBlocking: t.renderBlocking,
            })),
          imageCount,
          images: timings
            .filter((t) => timingUrlIsType(reqs, t.url, "Image"))
            .map((t) => ({
              url: t.url,
              startMs: Math.round(t.start),
              endMs: Math.round(t.end),
            })),
          longTasks: final.longTasks.map(
            ([s, d]) => [Math.round(s), Math.round(d)] as [number, number]
          ),
        },
        servedBuild: servedBuild(protoStats),
        requests,
        ...(protoStats ? { proto: protoLoadSummary(protoStats, fcp) } : {}),
      };
      writeRaw(label, profileName, `first-render-${run}.json`, result);
      console.log(
        `[${label}/${profileName}] run ${run}: fcp ${fcp.toFixed(0)} lcp ${lcp.time.toFixed(0)} ` +
          `tbt ${result.tbt.toFixed(0)} cls ${result.cls.toFixed(4)} painted ${result.allStickersPaintedMs.toFixed(0)} ` +
          `live ${result.liveCurrentMs?.toFixed(0) ?? "null"} ` +
          `input ${result.inputReadyMs?.toFixed(0) ?? "null"} entry ${result.entryStartMs ?? "-"}/${result.entryEndMs ?? "-"} ` +
          `critJS ${criticalJs} ` +
          `markers [${result.criticalPathMarkers?.join(",")}]` +
          (result.proto
            ? ` | proto ${result.proto.lodPath} handoff ${result.proto.handoffAllMs?.toFixed(0) ?? "null"}`
            : ` | ${result.servedBuild}`)
      );
      // Payload gate (Milestone 1 exit), checked after the run is recorded so a
      // failure keeps its data (metrics.ts criticalJsGateValue). Mobile, the
      // budget profile, gates every run: critical JS within 100 KB gzip and no
      // library markers. On desktop the idle islands can finish before a
      // ~130 ms LCP in some runs, which is expected, so the last run gates the
      // median critical JS of the profile's recorded runs and the markers are
      // only reported. BENCH_PAYLOAD_GATE=0 turns the gate off (the baseline
      // target fails it by design).
      if (process.env.BENCH_PAYLOAD_GATE !== "0") {
        if (profileName === "mobile") {
          expect(criticalJsGateValue("mobile", [criticalJs]), "critical-path JS gzip (B)")
            .toBeLessThanOrEqual(CRITICAL_JS_BUDGET);
          expect(result.criticalPathMarkers, "libraries in critical-path JS").toEqual([]);
        } else if (run === BENCH_RUN_FROM + BENCH_RUNS - 1) {
          const runs = readRaw<FirstRenderResult>(label, profileName, "first-render-").map(
            (r) => r.criticalPathJsGzip
          );
          const median = criticalJsGateValue("desktop", runs);
          console.log(`[${label}/${profileName}] critJS median ${median} over [${runs.join(", ")}]`);
          expect(median, "median critical-path JS gzip (B)").toBeLessThanOrEqual(CRITICAL_JS_BUDGET);
        }
      }
    });
  }

  test.afterAll(() => {
    const profileName = profileOf(test.info().project.name);
    if (profileName) writeSummary(label, profileName);
  });
});

// Image A/B (BENCH_PROBE_IMAGES): "stub" answers every `/stickers/` image
// request from the harness with a 1x1 image, so sticker images take no
// bandwidth or connection time; "pass" routes them the same way but lets them
// through to the server, so both arms pay the same interception cost.
// Unset: no route at all.
const STUB_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const STUB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

async function routeImageProbe(page: Page): Promise<void> {
  const mode = process.env.BENCH_PROBE_IMAGES;
  if (!mode) return;
  if (mode !== "stub" && mode !== "pass") {
    throw new Error(`BENCH_PROBE_IMAGES must be "stub" or "pass", got ${mode}`);
  }
  await page.route(/\/stickers\/[^?]*\.(svg|png|webp|jpe?g|gif)(\?|$)/, (route) => {
    if (mode === "pass") return route.fallback();
    const svg = /\.svg(\?|$)/.test(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: svg ? "image/svg+xml" : "image/png",
      body: svg ? STUB_SVG : STUB_PNG,
    });
  });
}

function timingUrlIsStylesheet(reqs: Map<string, Tracked>, url: string) {
  return timingUrlIsType(reqs, url, "Stylesheet");
}

function timingUrlIsType(reqs: Map<string, Tracked>, url: string, type: string) {
  for (const r of reqs.values()) {
    if (r.url === url) return r.type === type;
  }
  return false;
}
