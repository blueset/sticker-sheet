// Chrome trace analysis for the gesture bench.
//
// Input is the `traceEvents` array of a Chrome trace recorded with the
// categories `devtools.timeline`, `disabled-by-default-devtools.timeline` and
// the two `*.timeline.frame` categories. Event times (`ts`, `dur`) are in
// microseconds on the trace clock; the window is in milliseconds on that same
// clock (see `markerMs` for how the bench pins the window to the trace).
//
// Events used:
// - `thread_name` metadata events (ph "M") name each thread. The main thread
//   is the one called `CrRendererMain`; its process is "the renderer".
// - `RunTask` complete events (ph "X") on the main thread: busy time.
// - `RasterTask` complete events on any thread: raster work and the end of the
//   last raster. These are emitted on the tile worker threads, which have no
//   stable name, so they are not filtered by thread.
// - `DrawFrame` instant events on a renderer process (category
//   `disabled-by-default-devtools.timeline.frame`): one per compositor frame
//   drawn. The "frame time" of a frame is the gap since the previous
//   `DrawFrame`, which is how the DevTools frame model measures it. Gaps are
//   only counted when both frames fall inside the window.

export interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  pid: number;
  tid: number;
  cat?: string;
  dur?: number;
  args?: Record<string, unknown>;
}

export interface TraceWindow {
  startMs: number;
  endMs: number;
}

export interface TraceAnalysis {
  mainBusyMs: number;
  lastRasterEndMs: number | null;
  framesOver16: number;
  framesOver33: number;
}

// Thresholds are slightly above the 60 Hz interval (16.667 ms) and above two
// vsyncs (33.33 ms), so a frame on time is never counted and a missed vsync is.
export const FRAME_OVER_16_MS = 16.7;
export const FRAME_OVER_33_MS = 33;

const MAIN_THREAD = "CrRendererMain";

function rendererThreads(events: TraceEvent[]) {
  const mainThreads = new Set<string>();
  const rendererPids = new Set<number>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name" && e.args?.name === MAIN_THREAD) {
      mainThreads.add(`${e.pid}:${e.tid}`);
      rendererPids.add(e.pid);
    }
  }
  return { mainThreads, rendererPids };
}

export function analyzeTrace(
  events: TraceEvent[],
  window: TraceWindow
): TraceAnalysis {
  const startUs = window.startMs * 1000;
  const endUs = window.endMs * 1000;
  const { mainThreads, rendererPids } = rendererThreads(events);

  let busyUs = 0;
  let lastRasterEndUs: number | null = null;
  const draws: number[] = [];

  for (const e of events) {
    if (e.ph === "X" && e.name === "RunTask" && mainThreads.has(`${e.pid}:${e.tid}`)) {
      const from = Math.max(e.ts, startUs);
      const to = Math.min(e.ts + (e.dur ?? 0), endUs);
      if (to > from) busyUs += to - from;
    } else if (e.ph === "X" && e.name === "RasterTask" && e.ts >= startUs) {
      const end = e.ts + (e.dur ?? 0);
      if (lastRasterEndUs === null || end > lastRasterEndUs) lastRasterEndUs = end;
    } else if (
      e.name === "DrawFrame" &&
      rendererPids.has(e.pid) &&
      e.ts >= startUs &&
      e.ts <= endUs
    ) {
      draws.push(e.ts);
    }
  }

  draws.sort((a, b) => a - b);
  let framesOver16 = 0;
  let framesOver33 = 0;
  for (let i = 1; i < draws.length; i++) {
    const gapMs = (draws[i] - draws[i - 1]) / 1000;
    if (gapMs > FRAME_OVER_16_MS) framesOver16++;
    if (gapMs > FRAME_OVER_33_MS) framesOver33++;
  }

  return {
    mainBusyMs: busyUs / 1000,
    lastRasterEndMs: lastRasterEndUs === null ? null : lastRasterEndUs / 1000,
    framesOver16,
    framesOver33,
  };
}

// Total RasterTask time (all threads) for tasks that start inside the window.
export function rasterMs(events: TraceEvent[], window: TraceWindow): number {
  const startUs = window.startMs * 1000;
  const endUs = window.endMs * 1000;
  let us = 0;
  for (const e of events) {
    if (e.ph === "X" && e.name === "RasterTask" && e.ts >= startUs && e.ts < endUs) {
      us += e.dur ?? 0;
    }
  }
  return us / 1000;
}

// Trace-clock time (ms) of a `console.timeStamp(label)` call. The bench calls
// console.timeStamp from the page at the start and end of a gesture so the
// window can be expressed on the trace clock.
export function markerMs(events: TraceEvent[], label: string): number | null {
  for (const e of events) {
    if (e.name !== "TimeStamp") continue;
    const data = e.args?.data as { message?: string } | undefined;
    if (data?.message === label) return e.ts / 1000;
  }
  return null;
}
