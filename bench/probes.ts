// Baseline-only suspect probes for docs/superpowers/baseline/report.md.
//
// These are NOT part of the contract bench: they look at baseline internals
// (bundle layout, the `zooming` class, a React commit counter) that the rewrite
// will not have, and were run once at Milestone 0. The contract bench
// (first-render / gestures) is what later builds are compared with.
//
//   npx serve out -l 4173 --no-clipboard        (leave it running)
//   node bench/probes.ts static dom cpu coverage hover settle third-party
//
// Probes (each merges its result into bench/results/baseline-probes.json):
//   static       index.html facts, per-chunk size/gzip/dependency markers, the
//                MDX-compiler and Silk byte bands in the main chunk, and where
//                the sticker YAML data ended up in the bundle.
//   dom          JS-disabled sticker count, <img> hints, computed `filter` and
//                content-visibility on the stickers (desktop profile).
//   cpu          CDP CPU profile of a mobile-profile load: self time per
//                script, per main-chunk band, and the top functions.
//   coverage     JS coverage of a desktop load: bytes executed per chunk/band.
//   hover        mousemove cost over a sticker vs over empty canvas, with a
//                React commit counter (React DevTools hook stub).
//   settle       wheel zoom: when `.zooming` is removed and what raster work
//                follows the last input.
//   third-party  mobile-profile FCP/LCP with and without the two third-party
//                stylesheets (fulfilled empty to remove them).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { chromium, devices } from "playwright-core";
import type { Browser, CDPSession, Page } from "playwright-core";
import { contract } from "../tests/contract.ts";
import { PROFILES } from "./profiles.ts";
import { STICKER_COUNT, applyProfile, sleep } from "./harness.ts";
import { gzipBytes, percentile } from "./metrics.ts";
import { markerMs, type TraceEvent } from "./trace.ts";

const BASE = process.env.PROBE_URL ?? "http://localhost:4173/";
const OUT_DIR = "out";
const CHUNK_DIR = path.join(OUT_DIR, "_next", "static", "chunks");
const RESULT_PATH = path.resolve("bench", "results", "baseline-probes.json");
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.frame",
];

type ProfileName = "mobile" | "desktop";

const median = (values: number[]) => percentile(values, 50);
const round = (n: number, digits = 1) => Number(n.toFixed(digits));

// Counts React commits (and the `mousemove` events the page saw). React calls
// onCommitFiberRoot on the DevTools hook in production builds too.
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

interface Session {
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  close: () => Promise<void>;
}

async function openPage(
  browser: Browser,
  profile: ProfileName,
  options: { cpuSlowdown?: number; javaScriptEnabled?: boolean; init?: boolean } = {}
): Promise<Session> {
  const context = await browser.newContext(
    profile === "mobile"
      ? { ...devices["Pixel 7"], javaScriptEnabled: options.javaScriptEnabled ?? true }
      : {
          ...devices["Desktop Chrome"],
          viewport: { width: 1280, height: 800 },
          javaScriptEnabled: options.javaScriptEnabled ?? true,
        }
  );
  const page = await context.newPage();
  if (options.init !== false && options.javaScriptEnabled !== false) {
    await page.addInitScript(INIT_SCRIPT);
  }
  const cdp = await context.newCDPSession(page);
  await applyProfile(cdp, {
    ...PROFILES[profile],
    cpuSlowdown: options.cpuSlowdown ?? PROFILES[profile].cpuSlowdown,
  });
  return { browser, page, cdp, close: () => context.close() };
}

async function waitReady(page: Page, profile: ProfileName) {
  await page.waitForFunction(
    ([selector, count]) =>
      document.querySelectorAll(selector as string).length >= (count as number) &&
      [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    [contract.stickers, STICKER_COUNT] as const,
    { timeout: profile === "mobile" ? 150_000 : 45_000 }
  );
}

function mergeResult(name: string, value: unknown, browser?: Browser) {
  const all = fs.existsSync(RESULT_PATH)
    ? JSON.parse(fs.readFileSync(RESULT_PATH, "utf8"))
    : {};
  all[name] = value;
  all._meta = {
    chromium: browser?.version() ?? all._meta?.chromium,
    node: process.version,
    url: BASE,
    recordedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
  fs.writeFileSync(RESULT_PATH, JSON.stringify(all, null, 2) + "\n");
}

const chunkFiles = () =>
  fs.readdirSync(CHUNK_DIR).filter((f) => f.endsWith(".js"));

const mainChunkName = () =>
  chunkFiles()
    .map((f) => ({ f, size: fs.statSync(path.join(CHUNK_DIR, f)).size }))
    .sort((a, b) => b.size - a.size)[0].f;

function offsetsOf(text: string, needles: string[]): number[] {
  const offsets: number[] = [];
  for (const needle of needles) {
    let i = -1;
    while ((i = text.indexOf(needle, i + 1)) !== -1) offsets.push(i);
  }
  return offsets.sort((a, b) => a - b);
}

// Byte bands of the main chunk, found from marker strings that survive
// minification. Approximate: bundlers keep each package's modules mostly
// contiguous, so the span of a package's markers is a good stand-in for its
// extent. Used by the cpu and coverage probes.
interface Bands {
  file: string;
  size: number;
  mdx: { start: number; end: number };
  silk: { start: number; end: number };
}

function mainChunkBands(): Bands {
  const file = mainChunkName();
  const text = fs.readFileSync(path.join(CHUNK_DIR, file), "utf8");
  const mdx = offsetsOf(text, [
    "mdxJsxFlowElement",
    "mdxJsxTextElement",
    "mdxFlowExpression",
    "mdxjsEsm",
    "micromark",
    "mdast-util",
    "next-mdx-remote",
    "hast",
    "recma",
  ]);
  const silk = offsetsOf(text, ["data-silk", "silk"]);
  return {
    file,
    size: text.length,
    mdx: { start: mdx[0], end: mdx[mdx.length - 1] },
    silk: { start: silk[0], end: silk[silk.length - 1] },
  };
}

function bandOf(offset: number, bands: Bands): "mdx" | "silk" | "other" {
  if (offset >= bands.mdx.start && offset <= bands.mdx.end) return "mdx";
  if (offset >= bands.silk.start && offset <= bands.silk.end) return "silk";
  return "other";
}

// ---------------------------------------------------------------- static

const DEPENDENCY_MARKERS: Record<string, string[]> = {
  "mdx compiler (mdast/micromark/mdxJsx)": ["mdxJsxFlowElement", "mdxFlowExpression", "micromark", "mdast-util"],
  "next-mdx-remote serialize": ["[next-mdx-remote] error compiling MDX"],
  acorn: ["acorn"],
  "silk (sheet)": ["data-silk"],
  "radix (dialog/dropdown/tooltip)": ["data-radix-"],
  "react-zoom-pan-pinch": ["react-transform-component"],
  leaflet: ["leaflet-container", "leaflet-"],
  tweakpane: ["tp-lblv", "tweakpane"],
  vaul: ["data-vaul"],
  "react-scan": ["react-scan"],
  "react-dom": ["__reactFiber", "react-dom"],
  "next runtime": ["__next_f", "next-route-announcer"],
};

function staticProbe() {
  const html = fs.readFileSync(path.join(OUT_DIR, "index.html"), "utf8");
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  const stylesheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  const stickerData = stickerYamlInBundle();
  const chunks = chunkFiles().map((file) => {
    const buffer = fs.readFileSync(path.join(CHUNK_DIR, file));
    const text = buffer.toString("utf8");
    const markers: string[] = [];
    for (const [label, needles] of Object.entries(DEPENDENCY_MARKERS)) {
      if (needles.some((n) => text.includes(n))) markers.push(label);
    }
    return {
      file,
      rawBytes: buffer.length,
      gzipBytes: gzipBytes(buffer),
      referencedByIndexHtml: html.includes(file),
      markers,
    };
  });
  return {
    indexHtml: {
      bytes: Buffer.byteLength(html),
      stickerButtonsInHtml: count(/<button[^>]*class="[^"]*\babsolute\b/g),
      imgTags: count(/<img\b/g),
      imgWithLoading: count(/<img\b[^>]*\bloading=/g),
      scriptTags: count(/<script\b/g),
      preloadLinks: count(/<link[^>]+rel="preload"/g),
      stylesheets,
    },
    chunks: chunks.sort((a, b) => b.rawBytes - a.rawBytes),
    mainChunkBands: mainChunkBands(),
    stickerYamlInBundle: stickerData,
  };
}

// Where the sticker data (all languages) ships. Each sticker's `image:` path is
// a unique string, so counting `/stickers/<file>` references per output file
// shows which file carries the data. In the baseline it is the inline RSC
// payload in index.html (self.__next_f.push scripts), not a JS chunk.
function stickerYamlInBundle() {
  const dir = path.join("src", "data", "stickers");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  const yamlBytes = files.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
  const refs = (text: string) => (text.match(/\/stickers\/[\w-]+\.(?:svg|png)/g) ?? []).length;
  const html = fs.readFileSync(path.join(OUT_DIR, "index.html"), "utf8");
  const carriers: Record<string, number> = {};
  if (refs(html)) carriers["index.html"] = refs(html);
  for (const file of chunkFiles()) {
    const n = refs(fs.readFileSync(path.join(CHUNK_DIR, file), "utf8"));
    if (n) carriers[file] = n;
  }
  const flightScripts = [...html.matchAll(/<script>(self\.__next_f\.push[\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((s) => s.includes("/stickers/"));
  const flightBytes = flightScripts.reduce((a, s) => a + Buffer.byteLength(s), 0);
  return {
    yamlFiles: files.length,
    yamlBytes,
    filesCarryingStickerImagePaths: carriers,
    inlineFlightScriptsWithStickerData: flightScripts.length,
    inlineFlightBytes: flightBytes,
    indexHtmlRawBytes: Buffer.byteLength(html),
    indexHtmlBrotliBytes: zlib.brotliCompressSync(html).length,
    indexHtmlGzipBytes: gzipBytes(html),
  };
}

// ------------------------------------------------------------------- dom

async function domProbe(browser: Browser) {
  const noJs = await openPage(browser, "desktop", { javaScriptEnabled: false });
  await noJs.page.goto(BASE, { waitUntil: "load" });
  const html = await noJs.page.content();
  const withoutScript = {
    stickerButtons: (html.match(/<button[^>]*class="[^"]*\babsolute\b/g) ?? []).length,
    imgTags: (html.match(/<img\b/g) ?? []).length,
  };
  await noJs.close();

  const session = await openPage(browser, "desktop");
  await session.page.goto(BASE, { waitUntil: "load" });
  await waitReady(session.page, "desktop");
  await sleep(1500);
  const facts = await session.page.evaluate((selector) => {
    const buttons = [...document.querySelectorAll(selector)] as HTMLElement[];
    const imgs = [...document.querySelectorAll(`${selector} img`)] as HTMLImageElement[];
    const filters = new Map<string, number>();
    let contentVisibilityAuto = 0;
    for (const b of buttons) {
      const cs = getComputedStyle(b);
      filters.set(cs.filter, (filters.get(cs.filter) ?? 0) + 1);
      if (cs.contentVisibility === "auto") contentVisibilityAuto++;
    }
    return {
      stickerButtons: buttons.length,
      computedFilters: Object.fromEntries(filters),
      contentVisibilityAuto,
      imgs: imgs.length,
      imgLoadingAttr: imgs.filter((i) => i.hasAttribute("loading")).length,
      imgDecodingAttr: imgs.filter((i) => i.hasAttribute("decoding")).length,
      imgFetchPriorityAttr: imgs.filter((i) => i.hasAttribute("fetchpriority")).length,
      imgSizeAttrs: imgs.filter((i) => i.hasAttribute("width") && i.hasAttribute("height")).length,
      layerWillChangeIdle: getComputedStyle(
        document.querySelector("#canvasWrapper > .react-transform-component") as Element
      ).willChange,
    };
  }, contract.stickers);
  await session.close();
  return { withoutScript, withScript: facts };
}

// ------------------------------------------------------------------- cpu

interface CpuNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
}

async function cpuProbe(browser: Browser, runs: number) {
  const bands = mainChunkBands();
  const mainText = fs.readFileSync(path.join(CHUNK_DIR, bands.file), "utf8");
  const lineStarts = [0];
  for (let i = 0; i < mainText.length; i++) if (mainText[i] === "\n") lineStarts.push(i + 1);

  const perRun = [];
  for (let run = 0; run < runs; run++) {
    const session = await openPage(browser, "mobile");
    await session.cdp.send("Profiler.enable");
    await session.cdp.send("Profiler.setSamplingInterval", { interval: 250 });
    await session.cdp.send("Profiler.start");
    await session.page.goto(BASE, { waitUntil: "load" });
    await waitReady(session.page, "mobile");
    await sleep(3000);
    const { profile } = await session.cdp.send("Profiler.stop");
    await session.close();

    const nodes = new Map<number, CpuNode>(
      (profile.nodes as CpuNode[]).map((n) => [n.id, n])
    );
    const selfMs = new Map<number, number>();
    const samples: number[] = profile.samples;
    const deltas: number[] = profile.timeDeltas;
    for (let i = 0; i < samples.length; i++) {
      selfMs.set(samples[i], (selfMs.get(samples[i]) ?? 0) + (deltas[i + 1] ?? deltas[i]) / 1000);
    }
    const byUrl = new Map<string, number>();
    const byBand = { mdx: 0, silk: 0, other: 0 };
    const special = { idle: 0, program: 0, gc: 0 };
    const functions: { ms: number; label: string; band: string }[] = [];
    for (const [id, ms] of selfMs) {
      const { functionName, url, lineNumber, columnNumber } = nodes.get(id)!.callFrame;
      if (functionName === "(idle)") special.idle += ms;
      else if (functionName === "(program)") special.program += ms;
      else if (functionName === "(garbage collector)") special.gc += ms;
      else {
        const tail = url ? url.split("/").pop()! : "(native)";
        byUrl.set(tail, (byUrl.get(tail) ?? 0) + ms);
        let band = "n/a";
        if (tail === bands.file) {
          const offset = (lineStarts[lineNumber] ?? 0) + columnNumber;
          band = bandOf(offset, bands);
          byBand[band as "mdx" | "silk" | "other"] += ms;
          functions.push({
            ms,
            band,
            label: `${functionName || "(anonymous)"} @${Math.round(offset / 1024)}KB: ${mainText
              .slice(offset, offset + 70)
              .replace(/\s+/g, " ")}`,
          });
        } else {
          functions.push({ ms, band, label: `${functionName || "(anonymous)"} ${tail}:${lineNumber}:${columnNumber}` });
        }
      }
    }
    const busy = [...byUrl.values()].reduce((a, b) => a + b, 0);
    perRun.push({
      busyMs: round(busy),
      idleMs: round(special.idle),
      programMs: round(special.program),
      gcMs: round(special.gc),
      mainChunkMs: round(byUrl.get(bands.file) ?? 0),
      bands: { mdx: round(byBand.mdx), silk: round(byBand.silk), other: round(byBand.other) },
      byScript: Object.fromEntries(
        [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, round(v)])
      ),
      topFunctions: functions
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12)
        .map((f) => ({ ms: round(f.ms), band: f.band, fn: f.label })),
    });
  }
  const pick = (f: (r: (typeof perRun)[number]) => number) => median(perRun.map(f));
  return {
    profile: "mobile (Pixel 7, 4x CPU, Fast 4G); CDP Profiler, 250 us sampling, load until all stickers painted + 3 s",
    bands: { file: bands.file, mdxKB: [round(bands.mdx.start / 1024), round(bands.mdx.end / 1024)], silkKB: [round(bands.silk.start / 1024), round(bands.silk.end / 1024)] },
    median: {
      busyMs: pick((r) => r.busyMs),
      mainChunkMs: pick((r) => r.mainChunkMs),
      mdxBandMs: pick((r) => r.bands.mdx),
      silkBandMs: pick((r) => r.bands.silk),
      otherMainBandMs: pick((r) => r.bands.other),
      gcMs: pick((r) => r.gcMs),
    },
    runs: perRun,
  };
}

// -------------------------------------------------------------- coverage

async function coverageProbe(browser: Browser) {
  const bands = mainChunkBands();
  const session = await openPage(browser, "desktop");
  await session.page.coverage.startJSCoverage({ resetOnNavigation: false });
  await session.page.goto(BASE, { waitUntil: "load" });
  await waitReady(session.page, "desktop");
  await sleep(3000);
  const entries = await session.page.coverage.stopJSCoverage();
  await session.close();

  const scripts = [];
  for (const entry of entries) {
    if (!entry.url.includes("/_next/static/chunks/") || !entry.source) continue;
    const text = entry.source;
    const ranges: { start: number; end: number; used: boolean; order: number }[] = [];
    let order = 0;
    for (const fn of entry.functions) {
      for (const r of fn.ranges) {
        ranges.push({ start: r.startOffset, end: r.endOffset, used: r.count > 0, order: order++ });
      }
    }
    // Outer ranges first so nested (block) ranges override them.
    ranges.sort((a, b) => a.start - b.start || b.end - a.end || a.order - b.order);
    const mask = new Uint8Array(text.length);
    for (const r of ranges) mask.fill(r.used ? 1 : 0, r.start, r.end);
    const sum = (from: number, to: number) => {
      let used = 0;
      for (let i = from; i < Math.min(to, text.length); i++) used += mask[i];
      return used;
    };
    const file = entry.url.split("/").pop()!;
    const row: Record<string, unknown> = {
      file,
      totalBytes: text.length,
      usedBytes: sum(0, text.length),
      usedPct: round((100 * sum(0, text.length)) / text.length),
    };
    if (file === bands.file) {
      const band = (b: { start: number; end: number }) => ({
        totalBytes: b.end - b.start,
        usedBytes: sum(b.start, b.end),
        usedPct: round((100 * sum(b.start, b.end)) / (b.end - b.start)),
      });
      row.mdxBand = band(bands.mdx);
      row.silkBand = band(bands.silk);
    }
    scripts.push(row);
  }
  return {
    profile: "desktop, JS coverage via Playwright (function + block ranges), load until all stickers painted + 3 s",
    scripts: scripts.sort((a, b) => (b.totalBytes as number) - (a.totalBytes as number)),
  };
}

// ----------------------------------------------------------------- hover

function pickHoverAreas(selectors: { sticker: string; viewer: string }) {
  type Pt = { x: number; y: number };
  const stickers = [...document.querySelectorAll(selectors.sticker)] as HTMLElement[];
  const vw = innerWidth;
  const vh = innerHeight;
  const insideSticker = (x: number, y: number, button: HTMLElement) => {
    const el = document.elementFromPoint(x, y);
    return !!el && button.contains(el);
  };
  const circle = (cx: number, cy: number, r: number): Pt[] =>
    Array.from({ length: 16 }, (_, i) => ({
      x: cx + r * Math.cos((i / 16) * 2 * Math.PI),
      y: cy + r * Math.sin((i / 16) * 2 * Math.PI),
    }));
  const fits = (cx: number, cy: number, r: number, ok: (x: number, y: number) => boolean) =>
    ok(cx, cy) && circle(cx, cy, r).every((p) => ok(p.x, p.y));

  let sticker: { cx: number; cy: number; r: number } | null = null;
  let bestArea = 0;
  for (const button of stickers) {
    const r = button.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (area <= bestArea) continue;
    for (const radius of [16, 10, 6, 3]) {
      let found: { cx: number; cy: number } | null = null;
      for (let a = 0; a < 9 && !found; a++) {
        for (let b = 0; b < 9 && !found; b++) {
          const cx = r.left + (r.width * (a + 0.5)) / 9;
          const cy = r.top + (r.height * (b + 0.5)) / 9;
          if (cx > 30 && cy > 30 && cx < vw - 30 && cy < vh - 30 &&
              fits(cx, cy, radius, (x, y) => insideSticker(x, y, button))) found = { cx, cy };
        }
      }
      if (found) {
        sticker = { ...found, r: radius };
        bestArea = area;
        break;
      }
    }
  }
  let empty: { cx: number; cy: number; r: number } | null = null;
  const viewer = document.querySelector(selectors.viewer);
  const isEmpty = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return !!el && !!viewer?.contains(el) && !el.closest(selectors.sticker);
  };
  for (let a = 1; a < 20 && !empty; a++) {
    for (let b = 1; b < 20 && !empty; b++) {
      const cx = (vw * a) / 20;
      const cy = (vh * b) / 20;
      if (fits(cx, cy, 16, isEmpty)) empty = { cx, cy, r: 16 };
    }
  }
  return { sticker, empty };
}

async function hoverProbe(browser: Browser) {
  const results: Record<string, unknown> = {};
  for (const cpuSlowdown of [1, 4]) {
    const session = await openPage(browser, "desktop", { cpuSlowdown });
    const { page, cdp } = session;
    await cdp.send("Performance.enable");
    await page.goto(BASE, { waitUntil: "load" });
    await waitReady(page, "desktop");
    await sleep(2000);
    const areas = await page.evaluate(pickHoverAreas, {
      sticker: contract.stickers,
      viewer: contract.viewer,
    });
    if (!areas.sticker || !areas.empty) {
      await session.close();
      results[`cpu${cpuSlowdown}x`] = { error: "no hover areas found", areas };
      continue;
    }
    const metrics = async () => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    };
    const trials: { target: string; perMove: Record<string, number>; moves: number }[] = [];
    for (let trial = 0; trial < 3; trial++) {
      for (const target of ["sticker", "empty"] as const) {
        const area = areas[target]!;
        await page.mouse.move(area.cx + area.r, area.cy);
        await sleep(500);
        const before = await metrics();
        const state0 = await page.evaluate(() => {
          const w = window as unknown as { __moves: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: { commits: number } };
          return { moves: w.__moves, commits: w.__REACT_DEVTOOLS_GLOBAL_HOOK__.commits };
        });
        for (let i = 0; i < 160; i++) {
          const angle = (i / 16) * 2 * Math.PI;
          await page.mouse.move(area.cx + area.r * Math.cos(angle), area.cy + area.r * Math.sin(angle));
          await sleep(6);
        }
        await sleep(300);
        const after = await metrics();
        const state1 = await page.evaluate(() => {
          const w = window as unknown as { __moves: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: { commits: number } };
          return { moves: w.__moves, commits: w.__REACT_DEVTOOLS_GLOBAL_HOOK__.commits };
        });
        const moves = state1.moves - state0.moves;
        trials.push({
          target,
          moves,
          perMove: {
            scriptMs: round(((after.ScriptDuration - before.ScriptDuration) * 1000) / moves, 3),
            taskMs: round(((after.TaskDuration - before.TaskDuration) * 1000) / moves, 3),
            reactCommits: round((state1.commits - state0.commits) / moves, 3),
            styleRecalcs: round((after.RecalcStyleCount - before.RecalcStyleCount) / moves, 3),
            layouts: round((after.LayoutCount - before.LayoutCount) / moves, 3),
          },
        });
      }
    }
    const summarize = (target: string) => {
      const rows = trials.filter((t) => t.target === target);
      const med = (key: string) => median(rows.map((r) => r.perMove[key]));
      return {
        movesPerTrial: rows.map((r) => r.moves),
        scriptMsPerMove: med("scriptMs"),
        taskMsPerMove: med("taskMs"),
        reactCommitsPerMove: med("reactCommits"),
        styleRecalcsPerMove: med("styleRecalcs"),
        layoutsPerMove: med("layouts"),
      };
    };
    results[`cpu${cpuSlowdown}x`] = {
      overSticker: summarize("sticker"),
      overEmptyCanvas: summarize("empty"),
      trials,
    };
    await session.close();
  }
  return results;
}

// ---------------------------------------------------------------- settle

function startSettleRecorder(selectors: { viewer: string; layer: string }): number {
  const w = window as unknown as Record<string, unknown>;
  const viewer = document.querySelector(selectors.viewer) as Element;
  const layer = document.querySelector(selectors.layer) as Element;
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: { commits: number } })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const log: { t: number; what: string; commits: number }[] = [];
  let zooming = viewer.classList.contains("zooming");
  new MutationObserver(() => {
    const now = viewer.classList.contains("zooming");
    if (now === zooming) return;
    zooming = now;
    log.push({
      t: performance.now(),
      what: `${now ? "zooming-on" : "zooming-off"} will-change=${getComputedStyle(layer).willChange}`,
      commits: hook.commits,
    });
  }).observe(viewer, { attributes: true, attributeFilter: ["class"] });
  w.__settleLog = log;
  w.__lastWheel = 0;
  w.__firstWheel = 0;
  window.addEventListener(
    "wheel",
    (e) => {
      if (!w.__firstWheel) {
        w.__firstWheel = e.timeStamp;
        w.__commitsAtStart = hook.commits;
      }
      w.__lastWheel = e.timeStamp;
      w.__commitsAtLastWheel = hook.commits;
    },
    { capture: true, passive: true }
  );
  const at = performance.now();
  console.timeStamp("probe:start");
  return at;
}

async function settleProbe(browser: Browser) {
  const out: Record<string, unknown> = {};
  for (const profile of ["desktop", "mobile"] as ProfileName[]) {
    const runs = [];
    for (let run = 0; run < 3; run++) {
      const session = await openPage(browser, profile);
      const { page } = session;
      await page.goto(BASE, { waitUntil: "load" });
      await waitReady(page, profile);
      await sleep(2500);
      const box = await page.locator(contract.viewer).boundingBox();
      if (!box) throw new Error("viewer has no box");
      await browser.startTracing(page, { categories: TRACE_CATEGORIES });
      const markerPage = await page.evaluate(startSettleRecorder, {
        viewer: contract.viewer,
        layer: contract.layer,
      });
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const started = Date.now();
      const sends: Promise<void>[] = [];
      for (let i = 0; i < 40; i++) {
        await sleep(Math.max(0, started + i * 16 - Date.now()));
        sends.push(page.mouse.wheel(0, -80));
      }
      await Promise.all(sends);
      await sleep(profile === "mobile" ? 3500 : 2000);
      const state = await page.evaluate(() => {
        const w = window as unknown as {
          __settleLog: { t: number; what: string; commits: number }[];
          __lastWheel: number;
          __firstWheel: number;
          __commitsAtStart: number;
          __commitsAtLastWheel: number;
          __REACT_DEVTOOLS_GLOBAL_HOOK__: { commits: number };
        };
        return {
          log: w.__settleLog,
          lastWheel: w.__lastWheel,
          firstWheel: w.__firstWheel,
          commitsAtStart: w.__commitsAtStart,
          commitsAtLastWheel: w.__commitsAtLastWheel,
          commitsNow: w.__REACT_DEVTOOLS_GLOBAL_HOOK__.commits,
        };
      });
      const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents as TraceEvent[];
      await session.close();

      const markerTrace = markerMs(events, "probe:start");
      if (markerTrace === null) throw new Error("probe:start marker missing");
      const toTrace = (pageMs: number) => pageMs + (markerTrace - markerPage);
      const lastWheel = toTrace(state.lastWheel);
      const off = state.log.find((l) => l.what.startsWith("zooming-off"));
      const zoomOff = off ? toTrace(off.t) : null;
      const rasters = events
        .filter((e) => e.name === "RasterTask" && e.ph === "X")
        .map((e) => ({ start: e.ts / 1000, end: (e.ts + (e.dur ?? 0)) / 1000, dur: (e.dur ?? 0) / 1000 }));
      const summarizeRaster = (from: number, to: number) => {
        const set = rasters.filter((r) => r.start >= from && r.start < to);
        return {
          tasks: set.length,
          totalMs: round(set.reduce((a, r) => a + r.dur, 0), 2),
          firstStartAfterMs: set.length ? round(Math.min(...set.map((r) => r.start)) - lastWheel) : null,
          lastEndAfterMs: set.length ? round(Math.max(...set.map((r) => r.end)) - lastWheel) : null,
        };
      };
      const countNames = (from: number) => {
        const names = ["Layerize", "PrePaint", "Paint", "UpdateLayoutTree", "Layout", "ImageDecodeTask", "DrawFrame"];
        return Object.fromEntries(
          names.map((n) => [n, events.filter((e) => e.name === n && e.ts / 1000 >= from).length])
        );
      };
      runs.push({
        zoomingOffAfterLastWheelMs: zoomOff === null ? null : round(zoomOff - lastWheel),
        zoomingLog: state.log.map((l) => ({ afterLastWheelMs: round(toTrace(l.t) - lastWheel), what: l.what })),
        rasterDuringGesture: summarizeRaster(toTrace(state.firstWheel), lastWheel),
        rasterAfterLastWheel: summarizeRaster(lastWheel, Number.POSITIVE_INFINITY),
        rasterAfterZoomingOff: zoomOff === null ? null : summarizeRaster(zoomOff, Number.POSITIVE_INFINITY),
        eventsAfterLastWheel: countNames(lastWheel),
        reactCommits: {
          duringGesture: state.commitsAtLastWheel - state.commitsAtStart,
          afterLastWheel: state.commitsNow - state.commitsAtLastWheel,
        },
      });
    }
    out[profile] = runs;
  }
  return out;
}

// ----------------------------------------------------------- third-party

const FCP_LCP_SCRIPT = `(() => {
  window.__fcp = 0; window.__lcp = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__fcp = e.startTime; })
    .observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; })
    .observe({ type: "largest-contentful-paint", buffered: true });
})();`;

async function thirdPartyProbe(browser: Browser, runs: number) {
  const samples: Record<string, { fcp: number; lcp: number }[]> = { "with-3p-css": [], "without-3p-css": [] };
  for (let i = 0; i < runs; i++) {
    for (const variant of Object.keys(samples)) {
      const session = await openPage(browser, "mobile", { init: false });
      const { page } = session;
      await page.addInitScript(FCP_LCP_SCRIPT);
      if (variant === "without-3p-css") {
        await page.route(/rsms\.me|cdnjs\.cloudflare\.com/, (route) =>
          route.fulfill({ status: 200, contentType: "text/css", body: "" })
        );
      }
      await page.goto(BASE, { waitUntil: "load" });
      await waitReady(page, "mobile");
      await sleep(1000);
      const t = await page.evaluate(() => {
        const w = window as unknown as { __fcp: number; __lcp: number };
        return { fcp: w.__fcp, lcp: w.__lcp };
      });
      samples[variant].push({ fcp: round(t.fcp), lcp: round(t.lcp) });
      await session.close();
    }
  }
  const stat = (rows: { fcp: number; lcp: number }[], key: "fcp" | "lcp") => ({
    median: median(rows.map((r) => r[key])),
    min: Math.min(...rows.map((r) => r[key])),
    max: Math.max(...rows.map((r) => r[key])),
  });
  return {
    profile: "mobile (Pixel 7, 4x CPU, Fast 4G); the two third-party stylesheets are fulfilled with an empty body in the `without` variant",
    withThirdPartyCss: { fcp: stat(samples["with-3p-css"], "fcp"), lcp: stat(samples["with-3p-css"], "lcp"), runs: samples["with-3p-css"] },
    withoutThirdPartyCss: { fcp: stat(samples["without-3p-css"], "fcp"), lcp: stat(samples["without-3p-css"], "lcp"), runs: samples["without-3p-css"] },
  };
}

// ------------------------------------------------------------------ main

const ALL = ["static", "dom", "cpu", "coverage", "hover", "settle", "third-party"];

async function main() {
  const requested = process.argv.slice(2);
  const probes = requested.length ? requested : ALL;
  const browser = await chromium.launch();
  try {
    for (const name of probes) {
      console.log(`probe ${name} ...`);
      let result: unknown;
      if (name === "static") result = staticProbe();
      else if (name === "dom") result = await domProbe(browser);
      else if (name === "cpu") result = await cpuProbe(browser, 3);
      else if (name === "coverage") result = await coverageProbe(browser);
      else if (name === "hover") result = await hoverProbe(browser);
      else if (name === "settle") result = await settleProbe(browser);
      else if (name === "third-party") result = await thirdPartyProbe(browser, 5);
      else throw new Error(`unknown probe ${name} (known: ${ALL.join(", ")})`);
      mergeResult(name, result, browser);
      console.log(JSON.stringify(result, null, 1).slice(0, 4000));
    }
  } finally {
    await browser.close();
  }
}

await main();
