// Result shapes and raw-run storage shared by the benches and `summarize.ts`.
// No Playwright imports here: `summarize.ts` runs as a plain Node CLI.
import fs from "node:fs";
import path from "node:path";

export type ProfileName = "mobile" | "desktop";

export interface FirstRenderResult {
  fcp: number;
  lcp: number;
  // Total blocking time: see first-render.bench.ts for the exact definition.
  tbt: number;
  cls: number;
  allStickersPaintedMs: number;
  liveCurrentMs: number | null;
  // When the viewer entry finished wiring input (see first-render.bench.ts);
  // null for a build that never exposes the signal (the baseline).
  inputReadyMs?: number | null;
  // The eager viewer graph's first request start / last response end
  // (metrics.ts eagerGraphTiming); null when the build has no such files.
  entryStartMs?: number | null;
  entryEndMs?: number | null;
  // Gzip bytes of the script responses that finished before LCP.
  criticalPathJsGzip: number;
  // Libraries (metrics.ts PAYLOAD_MARKERS) found in those scripts.
  criticalPathMarkers?: string[];
  // Bytes transferred over the whole observation window, by resource type.
  bytes: ByteBreakdown;

  // Extras beyond the shared shape. Everything below is optional so runs
  // recorded without it (or by a different harness version) still summarise.
  bytesBeforeLcp?: ByteBreakdown;
  firstStickerMs?: number | null;
  // Sticker elements in the DOM at the last rAF at or before FCP (0 = the first
  // paint was an empty shell).
  stickersAtFcp?: number;
  ttiProxyMs?: number;
  longTaskCount?: number;
  // Wall time of a fixed 5M-iteration JS loop run after the page settled:
  // evidence that CPU throttling is in effect (about cpuSlowdown x slower).
  cpuProbeMs?: number;
  detail?: FirstRenderDetail;
}

export interface ByteBreakdown {
  js: number;
  css: number;
  img: number;
  font: number;
  html: number;
  other: number;
}

export interface FirstRenderDetail {
  lcp: { tag: string; url: string; size: number } | null;
  scripts: Array<{
    url: string;
    gzip: number;
    transferred: number;
    startMs?: number | null;
    endMs: number | null;
    beforeLcp: boolean;
    // PAYLOAD_MARKERS libraries in the body; null when the body was evicted.
    markers?: string[] | null;
  }>;
  stylesheets: Array<{
    url: string;
    startMs: number;
    endMs: number;
    renderBlocking: string | null;
  }>;
  imageCount: number;
  images?: Array<{ url: string; startMs: number; endMs: number }>;
  // [startMs, durationMs] of every long task seen.
  longTasks?: Array<[number, number]>;
}

export type GestureName =
  | "wheel-zoom"
  | "drag-inertia"
  | "pinch"
  | "button-zoom";

export interface GestureResult {
  name: GestureName;
  // Frames and frame times come from the in-page rAF loop (deltas between
  // consecutive rAF timestamps) between the first input and the end of motion.
  frames: number;
  over16: number;
  over33: number;
  p95FrameMs: number;
  mainBusyMs: number;
  crispAfterMs: number | null;
  peakHeapMb: number;

  // Optional extras (see gestures.bench.ts for definitions).
  motionMs?: number;
  traceOver16?: number;
  traceOver33?: number;
  rasterMs?: number;
  rasterAfterInputMs?: number;
  scriptMs?: number;
  layoutMs?: number;
  styleMs?: number;
  layoutCount?: number;
  styleRecalcCount?: number;
  inputDelayMs?: number | null;
  scaleChange?: number;
  // The five longest rAF deltas (ms) inside the gesture.
  worstFramesMs?: number[];
  // Settle decomposition (Task 2.3; absent in older runs). All ms, page clock
  // mapped to the trace clock where a raster end is involved.
  // - crispAfterMotionMs: end of the last RasterTask minus the last frame whose
  //   transform changed, clamped at 0 (null if no raster).
  // - motionAfterInputMs: last frame whose transform changed minus the last
  //   input event (the inertia / animation tail).
  // - settleAfterMotionMs: `data-gesture` removed from the viewer minus that
  //   last motion frame (the settle timer); null if it was never seen removed.
  // - rasterAfterSettleMs: end of the last RasterTask minus that removal
  //   (negative when raster ended before settle); null if either is missing.
  crispAfterMotionMs?: number | null;
  motionAfterInputMs?: number;
  settleAfterMotionMs?: number | null;
  rasterAfterSettleMs?: number | null;
}

export interface RunMeta {
  label: string;
  profile: ProfileName;
  chromium: string;
  node: string;
  os: string;
  cpu: string;
  cores: number;
  memGb: number;
  cpuSlowdown: number;
  network: unknown;
  runs: number;
  recordedAt: string;
  // Set only for A/B probe runs (BENCH_PROBE_CSS); absent for normal runs.
  probeCss?: string;
  // Set only for the image A/B (BENCH_PROBE_IMAGES = "stub" | "pass").
  probeImages?: string;
  // BENCH_QUERY appended to the page URL ("" for the plain page). Absent in
  // runs recorded before it existed.
  query?: string;
}

// Playwright, vitest and the CLI are all run from the repository root.
export const resultsDir = path.resolve("bench", "results");

export function benchLabel(): string {
  return process.env.BENCH_LABEL ?? process.env.TARGET ?? "new";
}

export function rawDir(label: string, profile: ProfileName): string {
  return path.join(resultsDir, "tmp", `${label}-${profile}`);
}

export function summaryPath(label: string, profile: ProfileName): string {
  return path.join(resultsDir, `${label}-${profile}.json`);
}

export function writeRaw(
  label: string,
  profile: ProfileName,
  file: string,
  data: unknown
): void {
  const dir = rawDir(label, profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
}

export function readRaw<T>(
  label: string,
  profile: ProfileName,
  prefix: string
): T[] {
  const dir = rawDir(label, profile);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T);
}

export function clearRaw(
  label: string,
  profile: ProfileName,
  prefix: string
): void {
  const dir = rawDir(label, profile);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(prefix) && f.endsWith(".json")) {
      fs.rmSync(path.join(dir, f));
    }
  }
}
