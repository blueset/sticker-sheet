// Pathway B prototype: an LRU (by bytes) of ImageBitmaps of SVG stickers.
// Two kinds of entry:
// - LOD: the whole image at a power-of-two device-pixel scale (snapScale,
//   capped so the longest side fits LOD_MAX_SIDE). Drawn, scaled, while a
//   gesture runs; never rasterized in the draw loop.
// - exact: at settle, the visible part (plus a margin) of a sticker at the
//   exact device-pixel scale. Only for visible stickers; dropped at the next
//   scale change or settle.
// Rasterization runs in a Worker (fetch -> createImageBitmap(svgBlob) ->
// OffscreenCanvas) when the engine can decode SVG blobs there, else on the
// main thread (the decoded `<img>` drawn into an OffscreenCanvas,
// transferToImageBitmap), in budgeted tasks outside the draw loop.
// Everything above `createLodCache` is pure and unit-tested.

export const MIN_LEVEL = 0.125;
export const MAX_LEVEL = 8;
// A 4 GB phone's Safari tab gets a few hundred MB of canvas/bitmap memory in
// total; the backing store (5.3 MB) and shadow sprites (5.3 MB) come on top.
export const CACHE_BYTES = 96 * 1024 * 1024;
// Longest side of one LOD bitmap (16 MB at 2048x2048).
export const LOD_MAX_SIDE = 2048;
// iOS Safari's per-canvas area limit (4096 x 4096).
export const MAX_AREA = 4096 * 4096;

// Smallest power of two not below `scale`, clamped to [0.125, 8].
export function snapScale(scale: number): number {
  if (!(scale > MIN_LEVEL)) return MIN_LEVEL;
  if (scale >= MAX_LEVEL) return MAX_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, 2 ** Math.ceil(Math.log2(scale))));
}

// The LOD level for a w x h (CSS px) image: snapScale, halved until the
// bitmap's longest side fits `maxSide`.
export function lodLevel(scale: number, w: number, h: number, maxSide: number): number {
  let level = snapScale(scale);
  while (level > MIN_LEVEL && Math.max(w, h) * level > maxSide) level /= 2;
  return level;
}

// The cached level to draw for `want`: itself, else the closest higher one
// (downscaling stays sharp), else the closest lower one.
export function nearestLevel(levels: Iterable<number>, want: number): number | null {
  let up = Infinity;
  let down = -Infinity;
  for (const l of levels) {
    if (l === want) return l;
    if (l > want) up = Math.min(up, l);
    else down = Math.max(down, l);
  }
  if (up !== Infinity) return up;
  return down !== -Infinity ? down : null;
}

// Least-recently-used map with a byte budget. `onEvict` runs for every value
// that leaves (eviction, replacement, delete, or refusal of an oversize set).
export class ByteLru<V> {
  private map = new Map<string, { value: V; bytes: number }>();
  bytes = 0;
  peakBytes = 0;
  hits = 0;
  misses = 0;

  constructor(
    readonly cap: number,
    private onEvict: (key: string, value: V) => void = () => {},
  ) {}

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V, bytes: number): boolean {
    this.delete(key);
    if (bytes > this.cap) {
      this.onEvict(key, value);
      return false;
    }
    while (this.bytes + bytes > this.cap) {
      const [oldest] = this.map.keys();
      this.delete(oldest);
    }
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
    return true;
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.bytes -= e.bytes;
    this.onEvict(key, e.value);
  }

  deleteWhere(pred: (key: string, value: V) => boolean): void {
    for (const [key, e] of [...this.map]) if (pred(key, e.value)) this.delete(key);
  }
}

// Store acceptance: a job is stamped when queued; a result that lands after
// clear() (any job) or after an exact drop/cancel (exact jobs) is stale.
export interface Stamp {
  clear: number;
  exact: number | null;
}
export class Generations {
  private c = 0;
  private e = 0;
  stamp(exact = false): Stamp {
    return { clear: this.c, exact: exact ? this.e : null };
  }
  fresh(s: Stamp): boolean {
    return s.clear === this.c && (s.exact === null || s.exact === this.e);
  }
  bumpClear(): void {
    this.c++;
  }
  bumpExact(): void {
    this.e++;
  }
}

// Settle-time cull: a LOD key (`slug|src@level`) above `keepLevel` is dropped
// unless its sticker is visible; exact keys are handled by dropExact.
export const CULL_KEEP_LEVEL = 2;
export function lodCullable(key: string, visible: ReadonlySet<string>, keepLevel = CULL_KEEP_LEVEL): boolean {
  const at = key.lastIndexOf("@");
  const level = Number(key.slice(at + 1));
  if (!Number.isFinite(level) || level <= keepLevel) return false;
  return !visible.has(key.slice(0, key.indexOf("|")));
}

// ---- DOM / Worker side ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LodSource {
  slug: string;
  img: HTMLImageElement;
  // object-fit: contain rect of the image inside the sticker box (CSS px).
  rect: Rect;
  // The SVG follows prefers-color-scheme (rasterized on the main thread).
  themed?: boolean;
  // Themed SVGs: a copy with the scheme media queries resolved against the
  // page (Firefox's canvas drawImage ignores the page scheme), used instead
  // of `img` for rasterizing.
  resolved?: HTMLImageElement;
}

// Rewrites `@media (prefers-color-scheme: X)` to `@media all` / `@media not
// all` for the given page scheme, so the SVG renders the same everywhere.
export function resolveScheme(svg: string, dark: boolean): string {
  return svg.replace(
    /@media\s*\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/gi,
    (_, v: string) => (v.toLowerCase() === (dark ? "dark" : "light") ? "@media all" : "@media not all"),
  );
}

export interface Cached {
  bitmap: ImageBitmap;
  // Device px per CSS px.
  scale: number;
  // Sticker-local CSS px area the bitmap covers.
  rect: Rect;
  exact: boolean;
}

export type LodPath = "probing" | "worker" | "main";

export interface LodStats {
  path: LodPath;
  workerError: string;
  // Main-thread rasterizer: OffscreenCanvas, or a DOM canvas + createImageBitmap.
  mainVia: string;
  forced: string;
  cap: number;
  bytes: number;
  peakBytes: number;
  count: number;
  exactCount: number;
  hits: number;
  misses: number;
  queue: number;
  inflight: number;
  renders: number;
  workerRenders: number;
  mainRenders: number;
  renderMsTotal: number;
  lastRenderMs: number;
  maxRenderMs: number;
  evictions: number;
  skippedExact: number;
  // Results rejected by store() as stale (generation / source changed).
  staleStores: number;
  errors: string[];
}

interface Job {
  key: string;
  src: LodSource;
  scale: number;
  rect: Rect;
  exact: boolean;
  seq: number;
  stamp: Stamp;
  done?: () => void;
}

interface WorkerReply {
  id: number;
  bitmap?: ImageBitmap;
  error?: string;
  ms?: number;
}

const MAIN_BUDGET_MS = 6;
const WORKER_INFLIGHT = 4;

export interface LodCache {
  readonly stats: LodStats;
  register(src: LodSource): void;
  getBitmap(slug: string, scale: number): ImageBitmap | null;
  nearest(slug: string, scale: number): Cached | null;
  exact(slug: string): Cached | null;
  // Queue an exact-scale render of `rect`; `done` runs once it is cached (or failed).
  renderExact(slug: string, scale: number, rect: Rect, seq: number, done: () => void): void;
  ensureLod(slug: string, scale: number, done: () => void): boolean;
  cancel(seqBelow: number): void;
  dropExact(keep?: (slug: string) => boolean): void;
  // Drop LOD levels above CULL_KEEP_LEVEL for stickers not in `visible`.
  cullLod(visible: ReadonlySet<string>): void;
  clear(): void;
  dispose(): void;
}

function lodKey(s: LodSource, level: number): string {
  return `${s.slug}|${s.img.currentSrc}@${level}`;
}

function exactKey(s: LodSource): string {
  return `${s.slug}|${s.img.currentSrc}@exact`;
}

export function createLodCache(onReady: () => void): LodCache {
  const forced = new URLSearchParams(location.search).get("lod") ?? "";
  const stats: LodStats = {
    path: forced === "worker" || forced === "worker-all" ? "probing" : "main",
    workerError: "",
    mainVia: "",
    forced,
    cap: CACHE_BYTES,
    bytes: 0,
    peakBytes: 0,
    count: 0,
    exactCount: 0,
    hits: 0,
    misses: 0,
    queue: 0,
    inflight: 0,
    renders: 0,
    workerRenders: 0,
    mainRenders: 0,
    renderMsTotal: 0,
    lastRenderMs: 0,
    maxRenderMs: 0,
    evictions: 0,
    skippedExact: 0,
    staleStores: 0,
    errors: [],
  };
  const lru = new ByteLru<Cached>(CACHE_BYTES, (_key, v) => {
    v.bitmap.close();
    stats.evictions++;
  });
  const sources = new Map<string, LodSource>();
  // Levels cached per slug (keys of `lru` carry them too; this avoids a scan).
  const levels = new Map<string, Set<number>>();
  const queue: Job[] = [];
  // Key -> the job currently responsible for it (queued or in flight).
  const queued = new Map<string, Job>();
  const gens = new Generations();
  const pending = new Map<number, Job>();
  let nextId = 1;
  let inMain = 0;
  let pumpTimer = 0;
  let disposed = false;

  function sync(): void {
    stats.bytes = lru.bytes;
    stats.peakBytes = lru.peakBytes;
    stats.count = lru.size;
    stats.hits = lru.hits;
    stats.misses = lru.misses;
    stats.queue = queue.length;
    stats.inflight = pending.size + inMain;
    let exact = 0;
    for (const k of lru.keys()) if (k.endsWith("@exact")) exact++;
    stats.exactCount = exact;
  }

  function store(job: Job, bitmap: ImageBitmap, ms: number, via: "worker" | "main"): void {
    stats.renders++;
    if (via === "worker") stats.workerRenders++;
    else stats.mainRenders++;
    stats.renderMsTotal += ms;
    stats.lastRenderMs = ms;
    stats.maxRenderMs = Math.max(stats.maxRenderMs, ms);
    const src = sources.get(job.src.slug);
    // Stale: the image source changed while the job ran, or the cache was
    // cleared / exact bitmaps dropped after the job was queued.
    if (!src || src.img.currentSrc !== job.src.img.currentSrc || disposed || !gens.fresh(job.stamp)) {
      stats.staleStores++;
      bitmap.close();
      return;
    }
    const ok = lru.set(job.key, { bitmap, scale: job.scale, rect: job.rect, exact: job.exact }, bitmap.width * bitmap.height * 4);
    if (ok && !job.exact) {
      let set = levels.get(job.src.slug);
      if (!set) levels.set(job.src.slug, (set = new Set()));
      set.add(job.scale);
    }
    sync();
  }

  function finish(job: Job): void {
    if (queued.get(job.key) === job) queued.delete(job.key);
    job.done?.();
    sync();
    onReady();
  }

  // Output size and where the image lands in it, for a job.
  function geometry(job: Job) {
    const s = job.scale;
    const r = job.src.rect;
    return {
      pw: Math.max(1, Math.ceil(job.rect.w * s)),
      ph: Math.max(1, Math.ceil(job.rect.h * s)),
      ox: (r.x - job.rect.x) * s,
      oy: (r.y - job.rect.y) * s,
      iw: r.w * s,
      ih: r.h * s,
    };
  }

  function renderMain(job: Job): void {
    // A themed SVG is only rasterized from its scheme-resolved copy (the raw
    // `<img>` draws the wrong scheme in Firefox).
    if (job.src.themed && !job.src.resolved) return finish(job);
    const t0 = performance.now();
    const g = geometry(job);
    const paint = (c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
      c.imageSmoothingQuality = "high";
      c.drawImage(job.src.resolved ?? job.src.img, g.ox, g.oy, g.iw, g.ih);
    };
    try {
      if (typeof OffscreenCanvas !== "undefined") {
        stats.mainVia = "offscreen";
        const oc = new OffscreenCanvas(g.pw, g.ph);
        paint(oc.getContext("2d")!);
        store(job, oc.transferToImageBitmap(), performance.now() - t0, "main");
      } else {
        // No OffscreenCanvas (Playwright's WebKit build): a detached canvas,
        // then an async createImageBitmap of it.
        stats.mainVia = "canvas+createImageBitmap";
        const c = document.createElement("canvas");
        c.width = g.pw;
        c.height = g.ph;
        paint(c.getContext("2d")!);
        const ms = performance.now() - t0;
        inMain++;
        createImageBitmap(c)
          .then((b) => store(job, b, ms, "main"))
          .catch((e) => stats.errors.push(`main ${job.key}: ${e}`))
          .finally(() => {
            c.width = c.height = 0;
            inMain--;
            finish(job);
          });
        return;
      }
    } catch (e) {
      stats.errors.push(`main ${job.key}: ${e}`);
    }
    finish(job);
  }

  // ---- worker ----
  let worker: Worker | null = null;
  function onWorker(e: MessageEvent<WorkerReply>): void {
    const job = pending.get(e.data.id);
    if (!job) {
      e.data.bitmap?.close();
      return;
    }
    pending.delete(e.data.id);
    if (e.data.bitmap) {
      store(job, e.data.bitmap, e.data.ms ?? 0, "worker");
      finish(job);
    } else {
      stats.errors.push(`worker ${job.key}: ${e.data.error}`);
      // Retry on the main thread.
      renderMain(job);
    }
    pump();
  }

  function post(job: Job): void {
    const g = geometry(job);
    const id = nextId++;
    pending.set(id, job);
    worker!.postMessage({ id, url: job.src.img.currentSrc, ...g });
  }

  function useWorker(src: LodSource): boolean {
    if (stats.path !== "worker" || !worker) return false;
    return !src.themed || forced === "worker-all";
  }

  function pump(): void {
    pumpTimer = 0;
    if (disposed || stats.path === "probing") return;
    const t0 = performance.now();
    // Exact (settle) jobs first.
    queue.sort((a, b) => Number(b.exact) - Number(a.exact));
    for (let i = 0; i < queue.length; ) {
      const job = queue[i];
      if (!gens.fresh(job.stamp)) {
        queue.splice(i, 1);
        finish(job);
        continue;
      }
      if (useWorker(job.src)) {
        if (pending.size >= WORKER_INFLIGHT) {
          i++;
          continue;
        }
        queue.splice(i, 1);
        post(job);
        continue;
      }
      if (performance.now() - t0 > MAIN_BUDGET_MS) break;
      queue.splice(i, 1);
      renderMain(job);
    }
    sync();
    if (queue.some((j) => !useWorker(j.src))) kick();
  }

  function kick(): void {
    if (!pumpTimer && !disposed) pumpTimer = window.setTimeout(pump, 0);
  }

  function enqueue(job: Job): void {
    const prev = queued.get(job.key);
    const same =
      prev &&
      gens.fresh(prev.stamp) &&
      prev.scale === job.scale &&
      prev.rect.x === job.rect.x &&
      prev.rect.y === job.rect.y &&
      prev.rect.w === job.rect.w &&
      prev.rect.h === job.rect.h;
    if (prev && same) {
      // Keep the newest callback chain (a settle waiting on an in-flight LOD).
      if (job.done) {
        const a = prev.done;
        const b = job.done;
        prev.done = () => {
          a?.();
          b();
        };
        if (job.exact) prev.seq = Math.max(prev.seq, job.seq);
      }
      return;
    }
    if (prev) {
      // Stale or different request for the same key: replace it.
      const i = queue.indexOf(prev);
      if (i >= 0) queue.splice(i, 1);
    }
    queued.set(job.key, job);
    queue.push(job);
    sync();
    kick();
  }

  // Probe: one small worker render of the first SVG registered. The path is
  // decided once per page load.
  function probe(src: LodSource): void {
    // All three engines reject SVG blobs in createImageBitmap (task-3.2
    // report §3), so the worker is opt-in (`?lod=worker` / `?lod=worker-all`):
    // the default skips the up-to-3 s probe window entirely.
    const optIn = forced === "worker" || forced === "worker-all";
    if (!optIn || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
      stats.path = "main";
      stats.workerError = !optIn
        ? forced === "main"
          ? "forced ?lod=main"
          : "not probed (opt in with ?lod=worker)"
        : typeof Worker === "undefined"
          ? "no Worker"
          : "no OffscreenCanvas (the worker could not crop or transfer)";
      kick();
      return;
    }
    try {
      worker = new Worker(new URL("./raster.worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      stats.path = "main";
      stats.workerError = `new Worker: ${e}`;
      kick();
      return;
    }
    const id = nextId++;
    const timer = window.setTimeout(() => decide(`probe timeout`), 3000);
    function decide(err: string): void {
      clearTimeout(timer);
      worker!.removeEventListener("message", first);
      if (err) {
        stats.path = "main";
        stats.workerError = err;
        worker!.terminate();
        worker = null;
      } else {
        stats.path = "worker";
        worker!.addEventListener("message", onWorker);
      }
      kick();
    }
    function first(e: MessageEvent<WorkerReply>): void {
      if (e.data.id !== id) return;
      e.data.bitmap?.close();
      decide(e.data.bitmap ? "" : (e.data.error ?? "no bitmap"));
    }
    worker.addEventListener("message", first);
    worker.addEventListener("error", (e) => decide(`worker error: ${e.message}`));
    worker.postMessage({ id, url: src.img.currentSrc, pw: 8, ph: 8, ox: 0, oy: 0, iw: 8, ih: 8 });
  }

  const cache: LodCache = {
    stats,
    register(src) {
      if (!sources.size) probe(src);
      sources.set(src.slug, src);
    },
    getBitmap(slug, scale) {
      const src = sources.get(slug);
      if (!src) return null;
      const level = lodLevel(scale, src.rect.w, src.rect.h, LOD_MAX_SIDE);
      const key = lodKey(src, level);
      const hit = lru.get(key);
      if (hit) return hit.bitmap;
      enqueue({ key, src, scale: level, rect: src.rect, exact: false, seq: 0, stamp: gens.stamp() });
      return null;
    },
    nearest(slug, scale) {
      const src = sources.get(slug);
      if (!src) return null;
      const want = lodLevel(scale, src.rect.w, src.rect.h, LOD_MAX_SIDE);
      if (cache.getBitmap(slug, scale)) return lru.peek(lodKey(src, want)) ?? null;
      const set = levels.get(slug);
      if (!set) return null;
      for (const l of [...set]) if (!lru.peek(lodKey(src, l))) set.delete(l);
      const l = nearestLevel(set, want);
      return l === null ? null : (lru.peek(lodKey(src, l)) ?? null);
    },
    exact(slug) {
      const src = sources.get(slug);
      return src ? (lru.peek(exactKey(src)) ?? null) : null;
    },
    renderExact(slug, scale, rect, seq, done) {
      const src = sources.get(slug);
      if (!src) return done();
      if (Math.ceil(rect.w * scale) * Math.ceil(rect.h * scale) > MAX_AREA) {
        stats.skippedExact++;
        return done();
      }
      enqueue({ key: exactKey(src), src, scale, rect, exact: true, seq, done, stamp: gens.stamp(true) });
    },
    ensureLod(slug, scale, done) {
      const src = sources.get(slug);
      if (!src) return false;
      const level = lodLevel(scale, src.rect.w, src.rect.h, LOD_MAX_SIDE);
      const key = lodKey(src, level);
      if (lru.peek(key)) return false;
      enqueue({ key, src, scale: level, rect: src.rect, exact: false, seq: 0, done, stamp: gens.stamp() });
      return true;
    },
    cancel(seqBelow) {
      // In-flight exact jobs (incl. WebKit's async createImageBitmap) go stale too.
      gens.bumpExact();
      for (let i = queue.length - 1; i >= 0; i--) {
        const j = queue[i];
        if (j.exact && j.seq < seqBelow) {
          queue.splice(i, 1);
          if (queued.get(j.key) === j) queued.delete(j.key);
        }
      }
      sync();
    },
    dropExact(keep) {
      gens.bumpExact();
      lru.deleteWhere((key) => key.endsWith("@exact") && !(keep && keep(key.slice(0, key.indexOf("|")))));
      sync();
    },
    cullLod(visible) {
      lru.deleteWhere((key) => lodCullable(key, visible));
      sync();
    },
    clear() {
      // Anything still in flight (worker or async main) is rejected by store().
      gens.bumpClear();
      queue.length = 0;
      queued.clear();
      for (const id of [...pending.keys()]) pending.delete(id);
      lru.deleteWhere(() => true);
      levels.clear();
      sync();
    },
    dispose() {
      disposed = true;
      cache.clear();
      clearTimeout(pumpTimer);
      worker?.terminate();
    },
  };
  return cache;
}
