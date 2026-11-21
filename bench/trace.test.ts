import { describe, expect, it } from "vitest";
import { analyzeTrace, rasterMs, type TraceEvent } from "./trace.ts";

const MAIN = { pid: 1, tid: 10 };
const WORKER = { pid: 1, tid: 20 };
const COMPOSITOR = { pid: 1, tid: 30 };
const OTHER_PROCESS_MAIN = { pid: 2, tid: 10 };

const thread = (t: { pid: number; tid: number }, name: string): TraceEvent => ({
  ph: "M",
  name: "thread_name",
  ...t,
  ts: 0,
  args: { name },
});

// ms -> trace microseconds
const task = (
  t: { pid: number; tid: number },
  name: "RunTask" | "RasterTask",
  startMs: number,
  durMs: number
): TraceEvent => ({
  ph: "X",
  name,
  cat: "disabled-by-default-devtools.timeline",
  ...t,
  ts: startMs * 1000,
  dur: durMs * 1000,
});

const drawFrame = (atMs: number): TraceEvent => ({
  ph: "I",
  name: "DrawFrame",
  cat: "disabled-by-default-devtools.timeline.frame",
  ...COMPOSITOR,
  ts: atMs * 1000,
});

const meta = [
  thread(MAIN, "CrRendererMain"),
  thread(WORKER, "CompositorTileWorker1"),
  thread(COMPOSITOR, "Compositor"),
  thread(OTHER_PROCESS_MAIN, "CrBrowserMain"),
];

const window = { startMs: 0, endMs: 100 };

describe("analyzeTrace mainBusyMs", () => {
  it("sums RunTask durations on the renderer main thread inside the window", () => {
    const events = [
      ...meta,
      task(MAIN, "RunTask", 5, 10),
      task(MAIN, "RunTask", 40, 30),
      task(MAIN, "RunTask", 150, 20),
    ];
    expect(analyzeTrace(events, window).mainBusyMs).toBe(40);
  });

  it("clips tasks that straddle the window edges", () => {
    const events = [
      ...meta,
      task(MAIN, "RunTask", -10, 20),
      task(MAIN, "RunTask", 90, 30),
    ];
    expect(analyzeTrace(events, window).mainBusyMs).toBe(20);
  });

  it("ignores other threads and processes", () => {
    const events = [
      ...meta,
      task(MAIN, "RunTask", 10, 10),
      task(WORKER, "RunTask", 10, 50),
      task(OTHER_PROCESS_MAIN, "RunTask", 10, 50),
    ];
    expect(analyzeTrace(events, window).mainBusyMs).toBe(10);
  });

  it("is zero when the trace has no renderer main thread", () => {
    expect(analyzeTrace([task(MAIN, "RunTask", 10, 10)], window).mainBusyMs).toBe(0);
  });
});

describe("analyzeTrace lastRasterEndMs", () => {
  it("is the end of the last RasterTask starting in or after the window", () => {
    const events = [
      ...meta,
      task(WORKER, "RasterTask", -50, 5),
      task(WORKER, "RasterTask", 20, 5),
      task(WORKER, "RasterTask", 130, 8),
    ];
    expect(analyzeTrace(events, window).lastRasterEndMs).toBe(138);
  });

  it("is null when no raster work starts in or after the window", () => {
    const events = [...meta, task(WORKER, "RasterTask", -50, 5)];
    expect(analyzeTrace(events, window).lastRasterEndMs).toBeNull();
  });
});

describe("analyzeTrace frames over", () => {
  it("counts DrawFrame gaps inside the window above 16.7 ms and 33 ms", () => {
    // gaps: 16.6, 17, 33.5, 50 -> over16: 3, over33: 2
    const events = [
      ...meta,
      ...[10, 26.6, 43.6, 77.1, 127.1].map(drawFrame),
    ];
    const result = analyzeTrace(events, { startMs: 0, endMs: 200 });
    expect(result.framesOver16).toBe(3);
    expect(result.framesOver33).toBe(2);
  });

  it("ignores DrawFrame events outside the window and other processes", () => {
    const events = [
      ...meta,
      drawFrame(-100),
      drawFrame(10),
      drawFrame(26),
      drawFrame(500),
      { ...drawFrame(60), pid: 2 },
    ];
    const result = analyzeTrace(events, window);
    expect(result.framesOver16).toBe(0);
    expect(result.framesOver33).toBe(0);
  });
});

describe("rasterMs", () => {
  it("sums RasterTask durations that start inside the window", () => {
    const events = [
      ...meta,
      task(WORKER, "RasterTask", 10, 5),
      task(WORKER, "RasterTask", 30, 7),
      task(WORKER, "RasterTask", 300, 9),
    ];
    expect(rasterMs(events, window)).toBe(12);
  });
});
