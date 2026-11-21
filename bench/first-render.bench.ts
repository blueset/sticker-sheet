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
//   year:'numeric'})`; null if that never happens before the deadline.
// - criticalPathJsGzip: gzip level 9 of the decoded body of every `Script`
//   response whose resource-timing responseEnd is <= LCP. Inline scripts are
//   part of the HTML document and are counted under `bytes.html` only.
// - bytes: `Network.loadingFinished.encodedDataLength` (what crossed the wire,
//   including headers) per CDP resource type, over the whole run.
import { test } from "@playwright/test";
import type { CDPSession } from "@playwright/test";
import { contract } from "../tests/contract.ts";
import { PROFILES } from "./profiles.ts";
import {
  BENCH_RUNS,
  STICKER_COUNT,
  applyProfile,
  benchEnabled,
  profileOf,
  runMeta,
  sleep,
} from "./harness.ts";
import { gzipBytes, QUIET_WINDOW_MS, totalBlockingTime, ttiProxy } from "./metrics.ts";
import {
  benchLabel,
  clearRaw,
  writeRaw,
  type ByteBreakdown,
  type FirstRenderDetail,
  type FirstRenderResult,
  type ProfileName,
} from "./results.ts";
import { writeSummary } from "./summarize.ts";

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
  };
  w.__bench = b;

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
  let dirty = true;
  new MutationObserver(() => {
    dirty = true;
  }).observe(document, { subtree: true, childList: true, characterData: true });

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
      dirty = false;
      // textContent is a cheap prefilter; innerText (layout) confirms.
      if (
        document.body.textContent?.includes(dateText) &&
        document.body.innerText.includes(dateText)
      ) {
        b.liveMs = t;
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

  for (let run = 1; run <= BENCH_RUNS; run++) {
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

      await page.goto("/", { waitUntil: "commit" });

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
          snap.liveMs ?? 0
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
      const bytesBeforeLcp = emptyBytes();
      let imageCount = 0;
      const scripts: FirstRenderDetail["scripts"] = [];
      let criticalJs = 0;
      for (const r of reqs.values()) {
        if (!r.finished) continue;
        const bucket = bucketOf(r.type);
        bytes[bucket] += r.encoded;
        if (r.type === "Image") imageCount++;
        const timing = timingByUrl.get(r.url);
        if (timing && timing.end <= lcp.time) {
          bytesBeforeLcp[bucket] += timing.transferSize || r.encoded;
        }
      }
      for (const [requestId, r] of reqs) {
        if (r.type !== "Script" || !r.finished) continue;
        let gzip = r.encoded;
        try {
          const { body, base64Encoded } = await cdp.send(
            "Network.getResponseBody",
            { requestId }
          );
          gzip = gzipBytes(Buffer.from(body, base64Encoded ? "base64" : "utf8"));
        } catch {
          // Body evicted: fall back to the bytes that crossed the wire.
        }
        const timing = timingByUrl.get(r.url);
        const beforeLcp = !!timing && timing.end <= lcp.time;
        if (beforeLcp) criticalJs += gzip;
        scripts.push({
          url: r.url,
          gzip,
          transferred: r.encoded,
          endMs: timing ? Math.round(timing.end) : null,
          beforeLcp,
        });
      }

      const result: FirstRenderResult = {
        fcp,
        lcp: lcp.time,
        tbt: totalBlockingTime(fcp, tti, final.longTasks),
        cls: final.cls,
        allStickersPaintedMs: final.allPaintedMs as number,
        liveCurrentMs: final.liveMs,
        criticalPathJsGzip: criticalJs,
        bytes,
        bytesBeforeLcp,
        firstStickerMs: final.firstStickerMs,
        stickersAtFcp: stickersAt(final.stickerCounts, fcp),
        ttiProxyMs: tti,
        longTaskCount: final.longTasks.length,
        cpuProbeMs,
        detail: {
          lcp: { tag: lcp.tag, url: lcp.url, size: lcp.size },
          scripts: scripts.sort((a, b) => (a.endMs ?? 0) - (b.endMs ?? 0)),
          stylesheets: timings
            .filter((t) => timingUrlIsStylesheet(reqs, t.url))
            .map((t) => ({
              url: t.url,
              startMs: Math.round(t.start),
              endMs: Math.round(t.end),
              renderBlocking: t.renderBlocking,
            })),
          imageCount,
        },
      };
      writeRaw(label, profileName, `first-render-${run}.json`, result);
      console.log(
        `[${label}/${profileName}] run ${run}: fcp ${fcp.toFixed(0)} lcp ${lcp.time.toFixed(0)} ` +
          `tbt ${result.tbt.toFixed(0)} cls ${result.cls.toFixed(4)} painted ${result.allStickersPaintedMs.toFixed(0)} ` +
          `live ${result.liveCurrentMs?.toFixed(0) ?? "null"} critJS ${criticalJs}`
      );
    });
  }

  test.afterAll(() => {
    const profileName = profileOf(test.info().project.name);
    if (profileName) writeSummary(label, profileName);
  });
});

function timingUrlIsStylesheet(reqs: Map<string, Tracked>, url: string) {
  for (const r of reqs.values()) {
    if (r.url === url) return r.type === "Stylesheet";
  }
  return false;
}
