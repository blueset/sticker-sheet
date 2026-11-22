// Pathway B (canvas-hybrid prototype) capture for the benches.
//
// The prototype's sources are no longer in the tree; they are archived at the
// local git tag `pathway-b-m3` (e.g. `git show pathway-b-m3:proto/build.mjs`).
// It was a post-process of Pathway A's build (`node proto/build.mjs` wrote
// `dist-proto/`) and exposed `window.__proto.stats` (`ProtoStats` in
// `pathway-b-m3:proto/canvas/render.ts`). This module stays so the committed
// `bench/results/m3-*.json` can be read and reproduced from that tag. On
// Pathway A `window.__proto` is undefined, the readers below return null and
// nothing is added to the result, so A's numbers are measured exactly as
// before. Everything here is additive.
//
// The summaries are flat numbers (plus the LOD path strings) so that
// `summarize.ts statsOf` aggregates them like any other result field.

// The subset of `pathway-b-m3:proto/canvas/render.ts` ProtoStats read here.
// Kept structural so bench/ does not import the archived prototype.
export interface ProtoStatsLike {
  dpr: number;
  backingBytes: number;
  spriteBytes: number;
  attachedAt: number;
  bgAt: number;
  firstStickerAt: number;
  allStickersAt: number;
  draws: number;
  maxDrawMs: number;
  unclipped: string[];
  errors: string[];
  lod: {
    path: string;
    mainVia: string;
    cap: number;
    bytes: number;
    peakBytes: number;
    count: number;
    hits: number;
    misses: number;
    renders: number;
    mainRenders: number;
    workerRenders: number;
    renderMsTotal: number;
    maxRenderMs: number;
    evictions: number;
    skippedExact: number;
    staleStores: number;
    errors: string[];
  };
  gesture: ProtoGesture | null;
  gestures: ProtoGesture[];
  prefetch: { queued: number; rendered: number; maxJobMs: number; startedAt: number; finishedAt: number } | null;
  settle: ProtoSettle | null;
  settles: ProtoSettle[];
}

interface ProtoGesture {
  startedAt: number;
  endedAt: number;
  frames: number;
  exact: number;
  lod: number;
  fallback: number;
  raster: number;
  held: number;
  maxDrawMs: number;
}

interface ProtoSettle {
  seq: number;
  reason: string;
  eff: number;
  visibleSvg: number;
  jobs: number;
  renderMs: number;
  readyMs: number;
  paintMs: number;
  sinceMotionMs: number;
  exactDrawn: number;
  lodDrawn: number;
  fallbackDrawn: number;
}

// Runs in the page (self-contained: Playwright serialises it). A structured
// clone of `window.__proto.stats`, or null when the served build has no
// prototype (Pathway A).
export function readProtoStats(): unknown {
  const p = (window as unknown as { __proto?: { stats?: unknown } }).__proto;
  return p?.stats ? JSON.parse(JSON.stringify(p.stats)) : null;
}

// Which build answered the bench: "proto" when the prototype attached,
// otherwise "dom" (Pathway A). Recorded per run as the served-build check.
export const servedBuild = (stats: unknown): "proto" | "dom" => (stats ? "proto" : "dom");

export interface ProtoLoadSummary {
  lodPath: string;
  mainVia: string;
  dpr: number;
  attachedAt: number;
  bgAt: number;
  firstStickerAt: number;
  allStickersAt: number;
  // Canvas takeover after A's DOM first paint (FCP: every sticker is in the
  // prerendered DOM at FCP): first / last sticker handed to the canvas.
  handoffFirstMs: number | null;
  handoffAllMs: number | null;
  initialSettleReadyMs: number | null;
  initialSettlePaintMs: number | null;
  initialSettleRenderMs: number | null;
  initialSettleJobs: number | null;
  backingBytes: number;
  spriteBytes: number;
  lodBytes: number;
  lodPeakBytes: number;
  // Computed from stats (w x h x 4 B), not measured engine memory.
  canvasBytes: number;
  lodRenders: number;
  lodRenderMsTotal: number;
  lodMaxRenderMs: number;
  maxDrawMs: number;
  errors: number;
  unclipped: number;
}

export function protoLoadSummary(stats: ProtoStatsLike, fcp: number): ProtoLoadSummary {
  const initial = stats.settles.find((s) => s.reason === "initial") ?? null;
  const since = (t: number) => (t > 0 ? t - fcp : null);
  return {
    lodPath: stats.lod.path,
    mainVia: stats.lod.mainVia,
    dpr: stats.dpr,
    attachedAt: stats.attachedAt,
    bgAt: stats.bgAt,
    firstStickerAt: stats.firstStickerAt,
    allStickersAt: stats.allStickersAt,
    handoffFirstMs: since(stats.firstStickerAt),
    handoffAllMs: since(stats.allStickersAt),
    initialSettleReadyMs: initial?.readyMs ?? null,
    initialSettlePaintMs: initial?.paintMs ?? null,
    initialSettleRenderMs: initial?.renderMs ?? null,
    initialSettleJobs: initial?.jobs ?? null,
    backingBytes: stats.backingBytes,
    spriteBytes: stats.spriteBytes,
    lodBytes: stats.lod.bytes,
    lodPeakBytes: stats.lod.peakBytes,
    canvasBytes: stats.backingBytes + stats.spriteBytes + stats.lod.bytes,
    lodRenders: stats.lod.renders,
    lodRenderMsTotal: stats.lod.renderMsTotal,
    lodMaxRenderMs: stats.lod.maxRenderMs,
    maxDrawMs: stats.maxDrawMs,
    errors: stats.errors.length + stats.lod.errors.length,
    unclipped: stats.unclipped.length,
  };
}

export interface ProtoGestureSummary {
  lodPath: string;
  mainVia: string;
  dpr: number;
  // Prototype gestures (first transform change after a settle -> next
  // onSettle) that started at or after the bench's start marker, summed.
  gestures: number;
  frames: number;
  exactDraws: number;
  lodDraws: number;
  // Synchronous SVG rasterisation inside a gesture frame (no cached bitmap).
  fallbackDraws: number;
  fallbackGestures: number;
  rasterDraws: number;
  heldDraws: number;
  maxDrawMs: number;
  // The last settle (reason "settle") after the start marker: B's canvas
  // crispness, i.e. the draw that painted the exact-scale bitmaps.
  // sinceMotionMs runs from B's last transform write to that draw (it
  // includes the controller's 100 ms idle wait); null if B never settled.
  settles: number;
  settleSinceMotionMs: number | null;
  settlePaintMs: number | null;
  settleReadyMs: number | null;
  settleRenderMs: number | null;
  settleJobs: number | null;
  settleExactDrawn: number | null;
  settleLodDrawn: number | null;
  settleFallbackDrawn: number | null;
  // LOD cache activity between the two snapshots.
  lodRenders: number;
  lodRenderMs: number;
  evictions: number;
  staleStores: number;
  hits: number;
  misses: number;
  skippedExact: number;
  // Session-cumulative values at the end snapshot.
  lodMaxRenderMs: number;
  lodBytes: number;
  lodPeakBytes: number;
  // Computed from stats (w x h x 4 B), not measured engine memory.
  canvasBytes: number;
  canvasPeakBytes: number;
  prefetchQueued: number | null;
  prefetchRendered: number | null;
  prefetchMaxJobMs: number | null;
  prefetchFinished: number | null;
  errors: number;
}

export function protoGestureSummary(
  before: ProtoStatsLike,
  after: ProtoStatsLike,
  sinceMs: number
): ProtoGestureSummary {
  const all = [...after.gestures];
  if (after.gesture && !after.gesture.endedAt) all.push(after.gesture);
  const gestures = all.filter((g) => g.startedAt >= sinceMs);
  const sum = (k: keyof ProtoGesture) => gestures.reduce((n, g) => n + g[k], 0);
  const beforeSeq = before.settles.reduce((m, s) => Math.max(m, s.seq), 0);
  const settles = after.settles.filter((s) => s.seq > beforeSeq && s.reason === "settle");
  const last = settles[settles.length - 1] ?? null;
  const d = (k: keyof ProtoStatsLike["lod"]) => (after.lod[k] as number) - (before.lod[k] as number);
  const p = after.prefetch && after.prefetch.startedAt >= sinceMs ? after.prefetch : null;
  return {
    lodPath: after.lod.path,
    mainVia: after.lod.mainVia,
    dpr: after.dpr,
    gestures: gestures.length,
    frames: sum("frames"),
    exactDraws: sum("exact"),
    lodDraws: sum("lod"),
    fallbackDraws: sum("fallback"),
    fallbackGestures: gestures.filter((g) => g.fallback > 0).length,
    rasterDraws: sum("raster"),
    heldDraws: sum("held"),
    maxDrawMs: gestures.reduce((m, g) => Math.max(m, g.maxDrawMs), 0),
    settles: settles.length,
    settleSinceMotionMs: last?.sinceMotionMs ?? null,
    settlePaintMs: last?.paintMs ?? null,
    settleReadyMs: last?.readyMs ?? null,
    settleRenderMs: last?.renderMs ?? null,
    settleJobs: last?.jobs ?? null,
    settleExactDrawn: last?.exactDrawn ?? null,
    settleLodDrawn: last?.lodDrawn ?? null,
    settleFallbackDrawn: last?.fallbackDrawn ?? null,
    lodRenders: d("renders"),
    lodRenderMs: d("renderMsTotal"),
    evictions: d("evictions"),
    staleStores: d("staleStores"),
    hits: d("hits"),
    misses: d("misses"),
    skippedExact: d("skippedExact"),
    lodMaxRenderMs: after.lod.maxRenderMs,
    lodBytes: after.lod.bytes,
    lodPeakBytes: after.lod.peakBytes,
    canvasBytes: after.backingBytes + after.spriteBytes + after.lod.bytes,
    canvasPeakBytes: after.backingBytes + after.spriteBytes + after.lod.peakBytes,
    prefetchQueued: p?.queued ?? null,
    prefetchRendered: p?.rendered ?? null,
    prefetchMaxJobMs: p?.maxJobMs ?? null,
    prefetchFinished: p ? (p.finishedAt > 0 ? 1 : 0) : null,
    errors: after.errors.length + after.lod.errors.length - before.errors.length - before.lod.errors.length,
  };
}
