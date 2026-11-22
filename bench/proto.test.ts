import { describe, expect, it } from "vitest";
import { protoGestureSummary, protoLoadSummary, servedBuild, type ProtoStatsLike } from "./proto.ts";

const lod = (o: Partial<ProtoStatsLike["lod"]> = {}): ProtoStatsLike["lod"] => ({
  path: "main",
  mainVia: "offscreen",
  cap: 100,
  bytes: 0,
  peakBytes: 0,
  count: 0,
  hits: 0,
  misses: 0,
  renders: 0,
  mainRenders: 0,
  workerRenders: 0,
  renderMsTotal: 0,
  maxRenderMs: 0,
  evictions: 0,
  skippedExact: 0,
  staleStores: 0,
  errors: [],
  ...o,
});

const gesture = (startedAt: number, endedAt: number, fallback = 0) => ({
  startedAt,
  endedAt,
  frames: 10,
  exact: 1,
  lod: 2,
  fallback,
  raster: 0,
  held: 0,
  maxDrawMs: startedAt / 100,
});

const settle = (seq: number, reason: string, sinceMotionMs: number) => ({
  seq,
  reason,
  eff: 1,
  visibleSvg: 3,
  jobs: 2,
  renderMs: 5,
  readyMs: 6,
  paintMs: 7,
  sinceMotionMs,
  exactDrawn: 3,
  lodDrawn: 0,
  fallbackDrawn: 0,
});

const stats = (o: Partial<ProtoStatsLike> = {}): ProtoStatsLike => ({
  dpr: 2,
  backingBytes: 1000,
  spriteBytes: 200,
  attachedAt: 50,
  bgAt: 60,
  firstStickerAt: 300,
  allStickersAt: 400,
  draws: 1,
  maxDrawMs: 3,
  unclipped: [],
  errors: [],
  lod: lod(),
  gesture: null,
  gestures: [],
  prefetch: null,
  settle: null,
  settles: [],
  ...o,
});

describe("servedBuild", () => {
  it("reports the prototype only when its stats exist", () => {
    expect(servedBuild(null)).toBe("dom");
    expect(servedBuild(stats())).toBe("proto");
  });
});

describe("protoLoadSummary", () => {
  it("measures the canvas handoff from FCP and picks the initial settle", () => {
    const s = protoLoadSummary(
      stats({ settles: [settle(1, "initial", 0), settle(2, "settle", 120)], lod: lod({ bytes: 30 }) }),
      100
    );
    expect(s.handoffFirstMs).toBe(200);
    expect(s.handoffAllMs).toBe(300);
    expect(s.initialSettlePaintMs).toBe(7);
    expect(s.canvasBytes).toBe(1230);
  });

  it("leaves the handoff null when no sticker was handed off", () => {
    const s = protoLoadSummary(stats({ firstStickerAt: 0, allStickersAt: 0 }), 100);
    expect(s.handoffFirstMs).toBeNull();
    expect(s.handoffAllMs).toBeNull();
    expect(s.initialSettleReadyMs).toBeNull();
  });
});

describe("protoGestureSummary", () => {
  it("keeps only gestures and settles from the measured window", () => {
    const before = stats({
      settles: [settle(1, "initial", 0)],
      lod: lod({ renders: 5, evictions: 1, renderMsTotal: 50 }),
    });
    const after = stats({
      gestures: [gesture(100, 150, 9), gesture(1000, 1500, 2)],
      gesture: gesture(2000, 0, 1),
      settles: [settle(1, "initial", 0), settle(2, "settle", 180), settle(3, "settle", 220)],
      lod: lod({ renders: 8, evictions: 4, renderMsTotal: 80, peakBytes: 40 }),
    });
    const s = protoGestureSummary(before, after, 900);
    expect(s.gestures).toBe(2);
    expect(s.fallbackDraws).toBe(3);
    expect(s.fallbackGestures).toBe(2);
    expect(s.maxDrawMs).toBe(20);
    expect(s.settles).toBe(2);
    expect(s.settleSinceMotionMs).toBe(220);
    expect(s.lodRenders).toBe(3);
    expect(s.evictions).toBe(3);
    expect(s.lodRenderMs).toBe(30);
    expect(s.canvasPeakBytes).toBe(1240);
  });

  it("reports no settle when the prototype never settled after the marker", () => {
    const s = protoGestureSummary(stats(), stats({ gestures: [gesture(1000, 0)] }), 900);
    expect(s.settleSinceMotionMs).toBeNull();
    expect(s.prefetchQueued).toBeNull();
  });
});
