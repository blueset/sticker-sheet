// Pathway B prototype: one viewport-sized 2D canvas under the transformed
// layer paints the background tile and every image sticker (rotation, clip,
// shadow sprite, hover scale). The DOM buttons stay where they are, so the
// browser keeps hit-testing their `clip-path`, `:hover`, focus and a11y;
// only their `<img>` is hidden and their live `drop-shadow` dropped once the
// canvas has drawn them. Content stickers stay DOM, above the canvas.
import type { Transform } from "../../src/lib/geometry";
import type { Controller } from "../../src/viewer/controller";
import { clipToCommands, type PathCmd } from "./clip";
import {
  createLodCache,
  LOD_MAX_SIDE,
  lodLevel,
  resolveScheme,
  Trickle,
  type LodCache,
  type LodSource,
  type LodStats,
  type Rect,
} from "./lod";

// Backing-store density cap: DPR 3 phones draw at 2 (iOS canvas memory).
export const DPR_CAP = 2;
// Shadow sprites are rasterized once per sticker at this many px per CSS px.
export const SPRITE_SCALE = 1;
// Room around the sticker box for both shadows (offset + 3 sigma, chained).
const SPRITE_MARGIN = 16;
// global.css `.sticker`: Tailwind's `drop-shadow-md`, two chained drop-shadows.
const SHADOWS = [
  { dy: 4, blur: 3, color: "rgb(0 0 0 / 0.07)" },
  { dy: 2, blur: 2, color: "rgb(0 0 0 / 0.06)" },
] as const;
// global.css hover: `scale: 1.1` with `transition: scale 100ms cubic-bezier(0.4, 0, 0.2, 1)`.
const HOVER_SCALE = 1.1;
const HOVER_MS = 100;
const OFFSCREEN = 100000;
// Device px per CSS px of the base LOD pre-rendered for off-screen SVGs
// (<= CULL_KEEP_LEVEL, so settle culls keep it).
const BASE_LOD = 1;

interface Item {
  slug: string;
  button: HTMLElement;
  clipEl: HTMLElement;
  img: HTMLImageElement;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  clip: Path2D | null;
  clipSource: string | null;
  sprite: HTMLCanvasElement | null;
  ready: boolean;
  handedOff: boolean;
  hover: { from: number; to: number; start: number };
  // SVG stickers go through the LOD cache once decoded (`rect` set).
  svg: boolean;
  rect: Rect | null;
  // Set for SVGs once registered with the LOD cache.
  src: LodSource | null;
}

// Image draws accumulated over one gesture: first transform change after a
// settle -> the next onSettle. `fallback` counts synchronous SVG rasterization
// (direct drawImage of an SVG with no cached bitmap).
export interface GestureStat {
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

// Deferred base-LOD prefetch of off-screen SVGs, started after a settle paints.
export interface PrefetchStat {
  queued: number;
  rendered: number;
  maxJobMs: number;
  startedAt: number;
  finishedAt: number;
}

// One settle: from the controller's onSettle (or load / resize / OS scheme
// change) until the draw that paints the exact-scale bitmaps.
export interface SettleStat {
  seq: number;
  reason: string;
  scale: number;
  // Device px per CSS px the bitmaps were rendered at (scale x dpr).
  eff: number;
  visibleSvg: number;
  jobs: number;
  // Rasterization time spent between settle and ready (all jobs, worker or main).
  renderMs: number;
  // onSettle -> all bitmaps cached.
  readyMs: number;
  // onSettle -> the draw that painted them.
  paintMs: number;
  // Last transform change -> that draw (includes the controller's 100 ms settle wait).
  sinceMotionMs: number;
  exactDrawn: number;
  lodDrawn: number;
  fallbackDrawn: number;
  bytes: number;
}

export interface ProtoStats {
  dpr: number;
  backingWidth: number;
  backingHeight: number;
  backingBytes: number;
  spriteBytes: number;
  attachedAt: number;
  bgAt: number;
  firstStickerAt: number;
  allStickersAt: number;
  draws: number;
  lastDrawMs: number;
  maxDrawMs: number;
  lastVisible: number;
  unclipped: string[];
  errors: string[];
  lod: LodStats;
  // Per-draw counts of how image stickers were painted (the last draw).
  exactDraws: number;
  lodDraws: number;
  fallbackDraws: number;
  rasterDraws: number;
  // The current (live) or last gesture, and the last 20 finished gestures.
  gesture: GestureStat | null;
  gestures: GestureStat[];
  prefetch: PrefetchStat | null;
  settle: SettleStat | null;
  settles: SettleStat[];
  themed: string[];
}

export interface Renderer {
  readonly stats: ProtoStats;
  readonly lod: LodCache;
  getBitmap(slug: string, scale: number): ImageBitmap | null;
  hoverScale(slug: string): number;
  draw(): void;
  dispose(): void;
}

function ease(t: number): number {
  // cubic-bezier(0.4, 0, 0.2, 1): solve x(u) = t by bisection, return y(u).
  const bez = (u: number, p1: number, p2: number) => 3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, 0.4, 0.2) < t) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, 0, 1);
}

function toPath2D(cmds: PathCmd[]): Path2D {
  const p = new Path2D();
  for (const c of cmds) {
    if (c[0] === "M") p.moveTo(c[1], c[2]);
    else if (c[0] === "L") p.lineTo(c[1], c[2]);
    else if (c[0] === "A") p.ellipse(c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    else p.closePath();
  }
  return p;
}

// The raw `clip-path:` declaration from the `.clip` span's style attribute
// (the CSSOM would re-serialize it).
function rawClip(el: HTMLElement): string | null {
  const style = el.getAttribute("style") ?? "";
  const m = /clip-path\s*:\s*([\s\S]+?)\s*;?\s*$/.exec(style);
  return m ? m[1] : null;
}

// `object-fit: contain` inside the w x h box.
function containRect(img: HTMLImageElement, w: number, h: number): [number, number, number, number] {
  const nw = img.naturalWidth || w;
  const nh = img.naturalHeight || h;
  const k = Math.min(w / nw, h / nh);
  const dw = nw * k;
  const dh = nh * k;
  return [(w - dw) / 2, (h - dh) / 2, dw, dh];
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// Paints only the shadow of `src`: the source itself lands far off-canvas.
function shadowOnly(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, s: (typeof SHADOWS)[number]): void {
  ctx.save();
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur * SPRITE_SCALE;
  ctx.shadowOffsetX = OFFSCREEN;
  ctx.shadowOffsetY = s.dy * SPRITE_SCALE;
  ctx.drawImage(src, -OFFSCREEN, 0);
  ctx.restore();
}

// CSS `filter: drop-shadow(a) drop-shadow(b)` on the clipped sticker is
// A over L1 over L2, where L1 = shadow_a(A) and L2 = shadow_b(A over L1).
// The sprite holds L1 over L2; the crisp sticker A is drawn on top each frame.
function buildSprite(it: Item): HTMLCanvasElement {
  const k = SPRITE_SCALE;
  const W = (it.w + 2 * SPRITE_MARGIN) * k;
  const H = (it.h + 2 * SPRITE_MARGIN) * k;
  const a = canvas(W, H);
  const actx = a.getContext("2d")!;
  actx.setTransform(k, 0, 0, k, SPRITE_MARGIN * k, SPRITE_MARGIN * k);
  if (it.clip) actx.clip(it.clip);
  actx.drawImage(it.img, ...containRect(it.img, it.w, it.h));

  const r1 = canvas(W, H);
  const rctx = r1.getContext("2d")!;
  shadowOnly(rctx, a, SHADOWS[0]);
  rctx.drawImage(a, 0, 0);

  const s = canvas(W, H);
  const sctx = s.getContext("2d")!;
  shadowOnly(sctx, r1, SHADOWS[1]);
  shadowOnly(sctx, a, SHADOWS[0]);
  a.width = a.height = r1.width = r1.height = 0;
  return s;
}

const STYLE = `
#canvasWrapper > canvas[data-proto] { position: absolute; left: 0; top: 0; pointer-events: none; }
#canvasWrapper[data-proto-bg] #canvas { background: none; }
.sticker[data-cv] { filter: none; }
.sticker[data-cv] .clip img { visibility: hidden; }
`;

export function createRenderer(root: HTMLElement, layer: HTMLElement, viewer: Controller): Renderer {
  const stats: ProtoStats = {
    dpr: 1,
    backingWidth: 0,
    backingHeight: 0,
    backingBytes: 0,
    spriteBytes: 0,
    attachedAt: performance.now(),
    bgAt: 0,
    firstStickerAt: 0,
    allStickersAt: 0,
    draws: 0,
    lastDrawMs: 0,
    maxDrawMs: 0,
    lastVisible: 0,
    unclipped: [],
    errors: [],
    lod: undefined as unknown as LodStats,
    exactDraws: 0,
    lodDraws: 0,
    fallbackDraws: 0,
    rasterDraws: 0,
    gesture: null,
    gestures: [],
    prefetch: null,
    settle: null,
    settles: [],
    themed: [],
  };
  const lod = createLodCache(() => schedule());
  stats.lod = lod.stats;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const cv = document.createElement("canvas");
  cv.dataset.proto = "";
  cv.setAttribute("aria-hidden", "true");
  root.prepend(cv);
  const ctx = cv.getContext("2d")!;
  let vw = 0;
  let vh = 0;

  function size(): void {
    vw = root.clientWidth;
    vh = root.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    cv.width = Math.round(vw * dpr);
    cv.height = Math.round(vh * dpr);
    cv.style.width = `${vw}px`;
    cv.style.height = `${vh}px`;
    stats.dpr = dpr;
    stats.backingWidth = cv.width;
    stats.backingHeight = cv.height;
    stats.backingBytes = cv.width * cv.height * 4;
  }
  size();

  const items: Item[] = [];
  for (const button of layer.querySelectorAll<HTMLElement>("button.sticker[data-slug]")) {
    const clipEl = button.querySelector<HTMLElement>(":scope > .clip");
    const img = clipEl?.querySelector<HTMLImageElement>(":scope > img, :scope > picture > img");
    if (!clipEl || !img) continue;
    const w = parseFloat(button.style.width);
    const h = parseFloat(button.style.height);
    if (!(w > 0 && h > 0)) continue;
    const clipSource = rawClip(clipEl);
    const cmds = clipSource ? clipToCommands(clipSource, w, h) : null;
    if (clipSource && !cmds) stats.unclipped.push(button.dataset.slug!);
    items.push({
      slug: button.dataset.slug!,
      button,
      clipEl,
      img,
      cx: Number(button.dataset.cx),
      cy: Number(button.dataset.cy),
      w,
      h,
      rot: ((parseFloat(button.style.rotate) || 0) * Math.PI) / 180,
      clip: cmds ? toPath2D(cmds) : null,
      clipSource,
      sprite: null,
      ready: false,
      handedOff: false,
      hover: { from: 1, to: 1, start: 0 },
      svg: /\.svg(?:[?#]|$)/i.test(img.currentSrc || img.src),
      rect: null,
      src: null,
    });
  }
  const bySlug = new Map(items.map((it) => [it.slug, it]));
  const byClip = new Map(items.map((it) => [it.clipEl, it]));

  // Background tile: read the themed URL from a probe (the layer's own
  // background is turned off once the canvas paints it).
  const probe = document.createElement("div");
  probe.className = "bg-grid-png";
  probe.hidden = true;
  root.append(probe);
  let bg: CanvasPattern | null = null;
  let bgUrl = "";
  function loadBg(): void {
    const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(probe).backgroundImage);
    if (!m || m[1] === bgUrl) return;
    const url = m[1];
    bgUrl = url;
    const tile = new Image();
    tile.src = url;
    tile
      .decode()
      .then(() => {
        if (bgUrl !== url) return;
        bg = ctx.createPattern(tile, "repeat");
        schedule();
      })
      .catch((e) => stats.errors.push(`bg: ${e}`));
  }
  loadBg();
  const themeObserver = new MutationObserver(loadBg);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  let settled = 0;
  // Themed SVGs: both scheme-resolved copies (see LodSource.resolved) are
  // decoded up front, so a scheme change swaps copies synchronously.
  const themedSrcs: { src: LodSource; copies: { light?: HTMLImageElement; dark?: HTMLImageElement } }[] = [];
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function decodeCopy(slug: string, text: string, dark: boolean): Promise<HTMLImageElement | undefined> {
    const url = URL.createObjectURL(new Blob([resolveScheme(text, dark)], { type: "image/svg+xml" }));
    const img = new Image();
    img.src = url;
    return img
      .decode()
      .then(() => img)
      .catch((e) => {
        stats.errors.push(`resolve ${slug} ${dark ? "dark" : "light"}: ${e}`);
        return undefined;
      })
      .finally(() => URL.revokeObjectURL(url));
  }
  function pickCopies(): void {
    for (const t of themedSrcs) t.src.resolved = darkQuery.matches ? t.copies.dark : t.copies.light;
  }
  for (const it of items) {
    const text = it.svg ? fetch(it.img.currentSrc || it.img.src).then((r) => r.text()) : Promise.resolve("");
    it.img
      .decode()
      .then(() => (it.svg ? text : ""))
      .then(async (svgText) => {
        if (it.svg) {
          const [x, y, w, h] = containRect(it.img, it.w, it.h);
          it.rect = { x, y, w, h };
          const themed = svgText.includes("prefers-color-scheme");
          const src: LodSource = { slug: it.slug, img: it.img, rect: it.rect, themed };
          if (themed) {
            stats.themed.push(it.slug);
            const [light, dark] = await Promise.all([
              decodeCopy(it.slug, svgText, false),
              decodeCopy(it.slug, svgText, true),
            ]);
            const entry = { src, copies: { light, dark } };
            themedSrcs.push(entry);
            src.resolved = darkQuery.matches ? dark : light;
          }
          lod.register(src);
          it.src = src;
        }
        // SVGs hand off only once registered (and themed copies decoded):
        // until then the DOM `<img>` keeps showing, in the right scheme.
        it.sprite = buildSprite(it);
        stats.spriteBytes += it.sprite.width * it.sprite.height * 4;
        it.ready = true;
        schedule();
      })
      .catch((e) => stats.errors.push(`${it.slug}: ${e}`))
      .finally(() => {
        if (++settled === items.length) settlePass("initial");
      });
  }

  function hoverScale(it: Item, now: number): number {
    const { from, to, start } = it.hover;
    if (from === to) return to;
    // A CSS transition starts at the next style update, so the mirror starts
    // at the first draw after the event.
    if (Number.isNaN(start)) return from;
    const t = (now - start) / HOVER_MS;
    if (t >= 1) {
      it.hover = { from: to, to, start: 0 };
      return to;
    }
    return from + (to - from) * ease(t);
  }

  // The part of the sticker box (local, unrotated CSS px) inside the viewport,
  // as an axis-aligned box; null when none of it is.
  function visibleLocal(it: Item, t: Transform, hs: number, margin = 0): Rect | null {
    const left = -t.x / t.scale - margin;
    const top = -t.y / t.scale - margin;
    const right = left + vw / t.scale + 2 * margin;
    const bottom = top + vh / t.scale + 2 * margin;
    const cos = Math.cos(-it.rot);
    const sin = Math.sin(-it.rot);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [px, py] of [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ]) {
      const dx = px - it.cx;
      const dy = py - it.cy;
      const lx = (dx * cos - dy * sin) / hs + it.w / 2;
      const ly = (dx * sin + dy * cos) / hs + it.h / 2;
      x0 = Math.min(x0, lx);
      y0 = Math.min(y0, ly);
      x1 = Math.max(x1, lx);
      y1 = Math.max(y1, ly);
    }
    // Clamp to the sticker box.
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(it.w, x1);
    y1 = Math.min(it.h, y1);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  const covers = (outer: Rect, inner: Rect) =>
    inner.x >= outer.x - 0.01 &&
    inner.y >= outer.y - 0.01 &&
    inner.x + inner.w <= outer.x + outer.w + 0.01 &&
    inner.y + inner.h <= outer.y + outer.h + 0.01;

  const effScale = (t: Transform) => t.scale * stats.dpr;

  // Paints the sticker's image in sticker-local CSS px (clip already set).
  // SVGs: the exact-scale bitmap if it matches and covers the visible part,
  // else the nearest cached LOD, else (no bitmap yet) the `<img>` directly.
  let frame = { exact: 0, lod: 0, fallback: 0, raster: 0, held: 0 };
  function paintImage(it: Item, t: Transform, hs: number): void {
    if (it.svg && it.rect) {
      const eff = effScale(t);
      const ex = lod.exact(it.slug);
      if (ex && ex.scale === eff) {
        const vis = visibleLocal(it, t, hs);
        if (!vis || covers(ex.rect, vis)) {
          ctx.drawImage(ex.bitmap, ex.rect.x, ex.rect.y, ex.bitmap.width / ex.scale, ex.bitmap.height / ex.scale);
          frame.exact++;
          return;
        }
      }
      const l = lod.nearest(it.slug, eff);
      if (l) {
        ctx.drawImage(l.bitmap, l.rect.x, l.rect.y, l.bitmap.width / l.scale, l.bitmap.height / l.scale);
        frame.lod++;
        return;
      }
      if (it.src?.themed && !it.src.resolved) {
        // No copy in the current scheme (decode failed): draw nothing rather
        // than the raw `<img>`, which some engines rasterize in the wrong scheme.
        frame.held++;
        return;
      }
      frame.fallback++;
    } else {
      frame.raster++;
    }
    // Synchronous rasterization for SVGs (no bitmap cached yet).
    ctx.drawImage(it.src?.resolved || it.img, ...containRect(it.img, it.w, it.h));
  }

  // ---- settle: exact-scale bitmaps for the visible SVG stickers ----
  let settleSeq = 0;
  let lastChangeAt = performance.now();
  let lastScale = viewer.transform.scale;
  let settling: {
    seq: number;
    reason: string;
    at: number;
    scale: number;
    eff: number;
    visibleSvg: number;
    jobs: number;
    left: number;
    renderMs0: number;
    readyAt: number;
  } | null = null;

  function settlePass(reason: string): void {
    const seq = ++settleSeq;
    lod.cancel(seq);
    const t = viewer.transform;
    const eff = effScale(t);
    const margin = (0.1 * Math.max(vw, vh)) / t.scale;
    const visible = items.filter((it) => it.svg && it.rect && visibleLocal(it, t, 1));
    const keep = new Set(visible.map((it) => it.slug));
    // Never keep exact bitmaps of off-screen stickers or of another scale.
    lod.dropExact((slug) => keep.has(slug) && lod.exact(slug)?.scale === eff);
    // Large LODs requested mid-tween for stickers now off-screen.
    lod.cullLod(keep);
    const s = {
      seq,
      reason,
      at: performance.now(),
      scale: t.scale,
      eff,
      visibleSvg: visible.length,
      jobs: 0,
      left: 1,
      renderMs0: lod.stats.renderMsTotal,
      readyAt: 0,
    };
    settling = s;
    const done = () => {
      if (settling !== s || --s.left > 0) return;
      s.readyAt = performance.now();
      schedule();
    };
    for (const it of visible) {
      const r = it.rect!;
      if (lodLevel(eff, r.w, r.h, LOD_MAX_SIDE) === eff) {
        // A power-of-two scale: the LOD bitmap is the exact render.
        if (lod.ensureLod(it.slug, eff, done)) {
          s.left++;
          s.jobs++;
        }
        continue;
      }
      const need = visibleLocal(it, t, 1)!;
      const ex = lod.exact(it.slug);
      if (ex && ex.scale === eff && covers(ex.rect, need)) continue;
      s.left++;
      s.jobs++;
      lod.renderExact(it.slug, eff, visibleLocal(it, t, 1, margin)!, seq, done);
    }
    // A small base LOD (kept by cullLod) for every off-screen SVG, so a
    // sticker entering view mid-gesture draws a bitmap, not a sync raster.
    // Deferred until this settle has painted, then one render per idle slot
    // (settlePainted -> prefetchStep), so it never delays the visible bitmaps.
    prefetchTrickle.stop();
    prefetchScale = Math.min(eff, BASE_LOD);
    prefetchList = items.filter((it) => it.svg && it.rect && !keep.has(it.slug)).map((it) => it.slug);
    done();
  }

  const prefetchTrickle = new Trickle<string>();
  let prefetchList: string[] = [];
  let prefetchScale = BASE_LOD;
  const idle: (fn: () => void) => void =
    typeof requestIdleCallback === "function"
      ? (fn) => requestIdleCallback(fn, { timeout: 250 })
      : (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
  let prefetchRun = 0;
  function startPrefetch(): void {
    const run = prefetchTrickle.start(prefetchList);
    prefetchRun = run;
    prefetchList = [];
    const p = { queued: prefetchTrickle.pending, rendered: 0, maxJobMs: 0, startedAt: performance.now(), finishedAt: 0 };
    stats.prefetch = p;
    idle(() => prefetchStep(run, p));
  }
  function prefetchStep(run: number, p: PrefetchStat): void {
    for (let slug = prefetchTrickle.next(run); slug !== undefined; slug = prefetchTrickle.next(run)) {
      const issued = lod.ensureLod(slug, prefetchScale, () => {
        p.rendered++;
        p.maxJobMs = Math.max(p.maxJobMs, lod.stats.lastRenderMs);
        idle(() => prefetchStep(run, p));
      });
      if (issued) return;
    }
    if (run === prefetchRun && !p.finishedAt) p.finishedAt = performance.now();
  }

  function settlePainted(): void {
    const s = settling;
    if (!s || !s.readyAt) return;
    settling = null;
    const now = performance.now();
    const entry: SettleStat = {
      seq: s.seq,
      reason: s.reason,
      scale: s.scale,
      eff: s.eff,
      visibleSvg: s.visibleSvg,
      jobs: s.jobs,
      renderMs: lod.stats.renderMsTotal - s.renderMs0,
      readyMs: s.readyAt - s.at,
      paintMs: now - s.at,
      sinceMotionMs: now - lastChangeAt,
      exactDrawn: frame.exact,
      lodDrawn: frame.lod,
      fallbackDrawn: frame.fallback,
      bytes: lod.stats.bytes,
    };
    stats.settle = entry;
    stats.settles.push(entry);
    if (stats.settles.length > 20) stats.settles.shift();
    startPrefetch();
  }

  function draw(): void {
    const t0 = performance.now();
    const t: Transform = viewer.transform;
    const dpr = stats.dpr;
    frame = { exact: 0, lod: 0, fallback: 0, raster: 0, held: 0 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // Downscaled rasters: closest to the DOM's mipmapped image filtering.
    ctx.imageSmoothingQuality = "high";
    const base = new DOMMatrix([dpr * t.scale, 0, 0, dpr * t.scale, dpr * t.x, dpr * t.y]);
    if (bg) {
      ctx.setTransform(base);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 3000, 3000);
      ctx.imageSmoothingEnabled = true;
      if (!stats.bgAt) {
        stats.bgAt = performance.now();
        root.dataset.protoBg = "";
      }
    }
    // Viewport in canvas coordinates.
    const left = -t.x / t.scale;
    const top = -t.y / t.scale;
    const right = left + vw / t.scale;
    const bottom = top + vh / t.scale;
    let visible = 0;
    let animating = false;
    for (const it of items) {
      if (!it.ready || !it.sprite) continue;
      if (Number.isNaN(it.hover.start)) it.hover.start = t0;
      const hs = hoverScale(it, t0);
      if (it.hover.from !== it.hover.to) animating = true;
      const r = (Math.hypot(it.w, it.h) / 2 + SPRITE_MARGIN) * Math.max(hs, 1);
      if (it.cx + r < left || it.cx - r > right || it.cy + r < top || it.cy - r > bottom) continue;
      visible++;
      ctx.setTransform(base);
      ctx.translate(it.cx, it.cy);
      if (it.rot) ctx.rotate(it.rot);
      if (hs !== 1) ctx.scale(hs, hs);
      ctx.translate(-it.w / 2, -it.h / 2);
      ctx.drawImage(it.sprite, -SPRITE_MARGIN, -SPRITE_MARGIN, it.w + 2 * SPRITE_MARGIN, it.h + 2 * SPRITE_MARGIN);
      if (it.clip) {
        ctx.save();
        ctx.clip(it.clip);
        paintImage(it, t, hs);
        ctx.restore();
      } else {
        paintImage(it, t, hs);
      }
    }
    // Hand off in the same task as the draw, so no frame shows both or neither.
    let handed = 0;
    for (const it of items) {
      if (it.ready && !it.handedOff) {
        it.handedOff = true;
        it.button.dataset.cv = "";
        if (!stats.firstStickerAt) stats.firstStickerAt = performance.now();
      }
      if (it.handedOff) handed++;
    }
    if (handed === items.length && !stats.allStickersAt) stats.allStickersAt = performance.now();
    stats.lastVisible = visible;
    stats.exactDraws = frame.exact;
    stats.lodDraws = frame.lod;
    stats.fallbackDraws = frame.fallback;
    stats.rasterDraws = frame.raster;
    settlePainted();
    stats.draws++;
    stats.lastDrawMs = performance.now() - t0;
    stats.maxDrawMs = Math.max(stats.maxDrawMs, stats.lastDrawMs);
    const g = stats.gesture;
    if (g && !g.endedAt) {
      g.frames++;
      g.exact += frame.exact;
      g.lod += frame.lod;
      g.fallback += frame.fallback;
      g.raster += frame.raster;
      g.held += frame.held;
      g.maxDrawMs = Math.max(g.maxDrawMs, stats.lastDrawMs);
    }
    if (animating) schedule();
  }

  let raf = 0;
  function schedule(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  const offChange = viewer.onChange((t) => {
    lastChangeAt = performance.now();
    prefetchTrickle.stop();
    if (!stats.gesture || stats.gesture.endedAt) {
      stats.gesture = {
        startedAt: lastChangeAt,
        endedAt: 0,
        frames: 0,
        exact: 0,
        lod: 0,
        fallback: 0,
        raster: 0,
        held: 0,
        maxDrawMs: 0,
      };
    }
    // Motion resumed: abandon the pending settle; a new scale invalidates
    // every exact bitmap (a pan keeps them for the covered area).
    if (settling) {
      settling = null;
      lod.cancel(++settleSeq);
    }
    if (t.scale !== lastScale) {
      lastScale = t.scale;
      lod.dropExact();
    }
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    draw();
  });
  const offSettle = viewer.onSettle(() => {
    const g = stats.gesture;
    if (g && !g.endedAt) {
      g.endedAt = performance.now();
      stats.gestures.push(g);
      if (stats.gestures.length > 20) stats.gestures.shift();
    }
    settlePass("settle");
  });

  const resizeObserver = new ResizeObserver(() => {
    size();
    draw();
    if (settled === items.length) settlePass("resize");
  });
  resizeObserver.observe(root);

  // SVG `<img>`s follow the OS colour scheme: cached rasters go stale. Swap
  // themed copies synchronously, so the next frame never shows the old
  // scheme; in-flight renders from the old copies are rejected by store().
  const scheme = darkQuery;
  const onScheme = () => {
    pickCopies();
    lod.clear();
    settlePass("scheme");
    schedule();
  };
  scheme.addEventListener("change", onScheme);

  const canHover = window.matchMedia("(hover: hover)");
  function setHover(it: Item | undefined, on: boolean): void {
    if (!it || !canHover.matches) return;
    const now = performance.now();
    const current = hoverScale(it, now);
    const to = on ? HOVER_SCALE : 1;
    if (it.hover.to === to) return;
    it.hover = { from: current, to, start: NaN };
    schedule();
  }
  const clipOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(".clip") : null);
  const listeners = new AbortController();
  layer.addEventListener("mouseover", (e) => setHover(byClip.get(clipOf(e.target)!), true), {
    signal: listeners.signal,
  });
  layer.addEventListener(
    "mouseout",
    (e) => {
      const from = clipOf(e.target);
      const to = clipOf(e.relatedTarget);
      if (from && from !== to) setHover(byClip.get(from), false);
    },
    { signal: listeners.signal },
  );

  schedule();

  return {
    stats,
    lod,
    getBitmap: (slug, scale) => lod.getBitmap(slug, scale),
    hoverScale: (slug) => {
      const it = bySlug.get(slug);
      return it ? hoverScale(it, performance.now()) : 1;
    },
    draw,
    dispose() {
      offChange();
      offSettle();
      scheme.removeEventListener("change", onScheme);
      lod.dispose();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      listeners.abort();
      cancelAnimationFrame(raf);
      for (const it of items) delete it.button.dataset.cv;
      delete root.dataset.protoBg;
      cv.remove();
      probe.remove();
      style.remove();
    },
  };
}
