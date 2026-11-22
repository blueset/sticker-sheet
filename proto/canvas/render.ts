// Pathway B prototype: one viewport-sized 2D canvas under the transformed
// layer paints the background tile and every image sticker (rotation, clip,
// shadow sprite, hover scale). The DOM buttons stay where they are, so the
// browser keeps hit-testing their `clip-path`, `:hover`, focus and a11y;
// only their `<img>` is hidden and their live `drop-shadow` dropped once the
// canvas has drawn them. Content stickers stay DOM, above the canvas.
import type { Transform } from "../../src/lib/geometry";
import type { Controller } from "../../src/viewer/controller";
import { clipToCommands, type PathCmd } from "./clip";

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
}

export interface Renderer {
  readonly stats: ProtoStats;
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
  };

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

  for (const it of items) {
    it.img
      .decode()
      .then(() => {
        it.sprite = buildSprite(it);
        stats.spriteBytes += it.sprite.width * it.sprite.height * 4;
        it.ready = true;
        schedule();
      })
      .catch((e) => stats.errors.push(`${it.slug}: ${e}`));
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

  function draw(): void {
    const t0 = performance.now();
    const t: Transform = viewer.transform;
    const dpr = stats.dpr;
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
        ctx.drawImage(it.img, ...containRect(it.img, it.w, it.h));
        ctx.restore();
      } else {
        ctx.drawImage(it.img, ...containRect(it.img, it.w, it.h));
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
    stats.draws++;
    stats.lastDrawMs = performance.now() - t0;
    stats.maxDrawMs = Math.max(stats.maxDrawMs, stats.lastDrawMs);
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

  const offChange = viewer.onChange(() => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    draw();
  });

  const resizeObserver = new ResizeObserver(() => {
    size();
    draw();
  });
  resizeObserver.observe(root);

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
    hoverScale: (slug) => {
      const it = bySlug.get(slug);
      return it ? hoverScale(it, performance.now()) : 1;
    },
    draw,
    dispose() {
      offChange();
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
