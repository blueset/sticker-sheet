import { describe, expect, it } from "vitest";
import { stat, statsOf, summarizeRuns } from "./summarize.ts";
import type { FirstRenderResult, GestureResult } from "./results.ts";

describe("stat", () => {
  it("reports median, p95, range and relative spread", () => {
    const s = stat([3, 1, 2, 5, 4]);
    expect(s).toMatchObject({ n: 5, nulls: 0, median: 3, p95: 5, min: 1, max: 5 });
    expect(s.spreadPct).toBeCloseTo(133.33, 1);
  });

  it("excludes nulls from the statistics but counts them", () => {
    const s = stat([10, null, 30, null]);
    expect(s).toMatchObject({ n: 2, nulls: 2, p95: 30, min: 10, max: 30 });
  });

  it("is all-null when no run produced a value", () => {
    expect(stat([null, null])).toMatchObject({
      n: 0,
      nulls: 2,
      median: null,
      p95: null,
      spreadPct: null,
    });
  });
});

describe("statsOf", () => {
  it("recurses into nested objects and skips non-numeric fields", () => {
    const tree = statsOf([
      { a: 1, bytes: { js: 10 }, name: "x", list: [1] },
      { a: 3, bytes: { js: 30 }, name: "x", list: [2] },
      { a: 2, bytes: { js: 20 }, name: "x", list: [3] },
    ]);
    expect(tree).toHaveProperty("a.median", 2);
    expect(tree).toHaveProperty("bytes.js.median", 20);
    expect(tree).not.toHaveProperty("name");
    expect(tree).not.toHaveProperty("list");
  });
});

describe("summarizeRuns", () => {
  const first = (lcp: number): FirstRenderResult => ({
    fcp: lcp / 2,
    lcp,
    tbt: 0,
    cls: 0,
    allStickersPaintedMs: lcp,
    liveCurrentMs: null,
    criticalPathJsGzip: 1000,
    bytes: { js: 1, css: 2, img: 3, font: 4, html: 5, other: 6 },
  });
  const gesture = (name: GestureResult["name"], p95: number): GestureResult => ({
    name,
    frames: 60,
    over16: 1,
    over33: 0,
    p95FrameMs: p95,
    mainBusyMs: 100,
    crispAfterMs: null,
    peakHeapMb: 50,
  });

  it("groups gesture runs by scenario and embeds every raw run", () => {
    const s = summarizeRuns({
      label: "baseline",
      profile: "mobile",
      meta: null,
      firstRender: [first(1000), first(3000), first(2000)],
      gestures: [
        gesture("wheel-zoom", 20),
        gesture("wheel-zoom", 40),
        gesture("button-zoom", 10),
      ],
    });
    expect(s.firstRender).toHaveProperty("lcp.median", 2000);
    expect(s.firstRender).toHaveProperty("liveCurrentMs.nulls", 3);
    expect(s.gestures["wheel-zoom"]).toHaveProperty("p95FrameMs.p95", 40);
    expect(s.gestures["button-zoom"]).toHaveProperty("frames.median", 60);
    expect(s.runs).toEqual({
      firstRender: 3,
      gestures: { "wheel-zoom": 2, "button-zoom": 1 },
    });
    expect(s.raw.firstRender).toHaveLength(3);
    expect(s.raw.gestures).toHaveLength(3);
  });
});
