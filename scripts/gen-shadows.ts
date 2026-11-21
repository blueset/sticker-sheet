// Shadow sprites for the `?v=shadow:s1` candidate, and the box measurements for `shadow:s2`.
// Run `npm run shadows [--force]` after a build (Node 22.18+ strips the types itself).
//
// Every sticker is rendered from the built page (`$STATIC_DIR`, default `dist`) in Chromium at
// DPR 2, alone on a transparent page, unrotated and unscaled:
//
// - Image stickers, with `filter: url(#shadow-only)`: an SVG filter that reproduces the two
//   `drop-shadow-md` layers of `.sticker` without merging `SourceGraphic`, so the output is the
//   shadow alone (silhouette and clip-path included). It is cropped to the box plus the smallest
//   uniform padding that holds every non-zero pixel and written to `public/shadows/<slug>.webp`;
//   `src/data/shadows.json` records `{ pad, hash }`.
// - Every unclipped sticker, without a filter: the silhouette's alpha decides whether the sticker
//   is a (rounded) rectangle that `box-shadow` can shadow exactly. `src/data/shadow-boxes.json`
//   records `{ radius, hash }`, `radius: null` meaning "not box-shaped".
//
// Content (MDX) stickers get no sprite: their silhouette is whatever the prerendered markup paints,
// so S1 keeps the live filter on them (S3).
//
// `shadowsAreStale()` and the hashes are pure and import-light so a unit test can fail on drift
// without a browser. A rerun only renders stale entries (`--force` renders all). Sprites and both
// manifests are written atomically; a run killed between a sprite and its manifest entry leaves a
// hash mismatch, which the next run (and the unit test) reports as stale.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { parse } from "yaml";
import type { StickerRecord } from "../src/lib/stickers";
import { atomicWriteFileSync, hashBytes } from "./optimize-assets.ts";

// Bump when the render setup or the filter changes, so every sprite turns stale.
export const GENERATOR_VERSION = 1;
export const SPRITE_DPR = 2;

const STICKER_DATA_DIR = "src/data/stickers";
const PUBLIC_DIR = "public";
export const SHADOWS_DIR = "public/shadows";
export const SHADOWS_MANIFEST = "src/data/shadows.json";
export const BOXES_MANIFEST = "src/data/shadow-boxes.json";
// Room around the box while rendering, in CSS px; a sprite's pad must stay well inside it.
const RENDER_PAD = 32;

export type ShadowManifest = Record<string, { pad: number; hash: string }>;
export type BoxManifest = Record<string, { radius: number | null; hash: string }>;

// The `.sticker` filter (Tailwind `drop-shadow-md`) without the source graphic: the second
// drop-shadow sees the first one's output, so its blur input is `SourceGraphic over d1`.
export const SHADOW_ONLY_FILTER = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">
  <filter id="shadow-only" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="b1"/>
    <feOffset in="b1" dy="4" result="o1"/>
    <feFlood flood-color="#000" flood-opacity="0.07"/>
    <feComposite in2="o1" operator="in" result="d1"/>
    <feComposite in="SourceGraphic" in2="d1" operator="over" result="f1"/>
    <feGaussianBlur in="f1" stdDeviation="2" result="b2"/>
    <feOffset in="b2" dy="2" result="o2"/>
    <feFlood flood-color="#000" flood-opacity="0.06"/>
    <feComposite in2="o2" operator="in" result="d2"/>
    <feComposite in="d1" in2="d2" operator="over"/>
  </filter>
</svg>`;

export function readStickers(dir = STICKER_DATA_DIR): StickerRecord[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => ({ ...(parse(fs.readFileSync(path.join(dir, f), "utf8")) as object), slug: f.slice(0, -".yaml".length) }) as StickerRecord);
}

const hasArea = (s: StickerRecord) => s.width > 0 && s.height > 0;
export const needsSprite = (s: StickerRecord): boolean => Boolean(s.image) && hasArea(s);
export const needsBox = (s: StickerRecord): boolean => !s.clipPath && hasArea(s);

// The files the page can paint for an image: the image and its WebP sibling, if any.
function imageFiles(image: string): string[] {
  const full = path.join(PUBLIC_DIR, image);
  const webp = full.replace(/\.(png|jpe?g)$/i, ".webp");
  return [full, ...(webp !== full && fs.existsSync(webp) ? [webp] : [])];
}

// Text images may be checked out with CRLF (core.autocrlf); hash them as LF so the
// manifest does not go stale across platforms.
function imageBytes(file: string): Buffer {
  const bytes = fs.readFileSync(file);
  return /\.svg$/i.test(file) ? Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1") : bytes;
}

export function spriteHash(s: StickerRecord): string {
  const meta = JSON.stringify({ v: GENERATOR_VERSION, image: s.image, clipPath: s.clipPath ?? null, w: s.width, h: s.height });
  return hashBytes(Buffer.from(meta), ...(s.image ? imageFiles(s.image).map(imageBytes) : []));
}

export function boxHash(s: StickerRecord): string {
  if (s.image) return spriteHash(s);
  const meta = JSON.stringify({ v: GENERATOR_VERSION, content: s.content ?? null, clipPath: s.clipPath ?? null, w: s.width, h: s.height });
  return hashBytes(Buffer.from(meta));
}

function readJson<T>(file: string): T {
  return (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}) as T;
}

function writeJson(file: string, data: Record<string, unknown>): void {
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  atomicWriteFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

// Slugs whose sprite or box measurement is missing, outdated or orphaned; `[]` when all is current.
export function shadowsAreStale(stickers = readStickers()): string[] {
  const sprites = readJson<ShadowManifest>(SHADOWS_MANIFEST);
  const boxes = readJson<BoxManifest>(BOXES_MANIFEST);
  const stale = new Set<string>();
  const wantSprite = new Set<string>();
  const wantBox = new Set<string>();
  for (const s of stickers) {
    if (needsSprite(s)) {
      wantSprite.add(s.slug);
      if (sprites[s.slug]?.hash !== spriteHash(s) || !fs.existsSync(path.join(SHADOWS_DIR, `${s.slug}.webp`))) {
        stale.add(s.slug);
      }
    }
    if (needsBox(s)) {
      wantBox.add(s.slug);
      if (boxes[s.slug]?.hash !== boxHash(s)) stale.add(`${s.slug} (box)`);
    }
  }
  for (const slug of Object.keys(sprites)) if (!wantSprite.has(slug)) stale.add(slug);
  for (const slug of Object.keys(boxes)) if (!wantBox.has(slug)) stale.add(`${slug} (box)`);
  const files = fs.existsSync(SHADOWS_DIR) ? fs.readdirSync(SHADOWS_DIR) : [];
  for (const f of files) if (!wantSprite.has(f.replace(/\.webp$/, ""))) stale.add(`${f} (orphan file)`);
  return [...stale].sort();
}

// ---- rendering (lazy imports below this line) ----

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

// Isolates one sticker (`.__t`) at a known spot on a transparent page.
const ISOLATE_CSS = `
html, body, body > div, #canvasWrapper, #canvas { background: transparent !important; }
#canvas { transform: translate(var(--gx), var(--gy)) !important; }
body > *:not(:has(#canvasWrapper)), #canvasWrapper ~ *, .sticker:not(.__t) { visibility: hidden !important; }
.__t { rotate: none !important; scale: none !important; transition: none !important; content-visibility: visible !important; }
html.__sprite .__t { filter: url(#shadow-only) !important; }
html.__silhouette .__t { filter: none !important; }
`;

async function loadDeps() {
  const [sharp, playwright] = await Promise.all([import("sharp"), import("@playwright/test")]);
  return { sharp: sharp.default, chromium: playwright.chromium };
}
type Deps = Awaited<ReturnType<typeof loadDeps>>;

// Serves `staticDir` at http://sheet.test/ inside `context`.
export async function routeStatic(context: BrowserContext, staticDir: string): Promise<void> {
  await context.route("http://sheet.test/**", (route) => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.join(staticDir, rel);
    if (!path.resolve(file).startsWith(path.resolve(staticDir)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fulfill({
      status: 200,
      body: fs.readFileSync(file),
      contentType: CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    });
  });
}

async function openSheet(deps: Deps, staticDir: string, scheme: "light" | "dark", viewport: number) {
  const browser = await deps.chromium.launch();
  const context = await browser.newContext({
    colorScheme: scheme,
    deviceScaleFactor: SPRITE_DPR,
    viewport: { width: viewport, height: viewport },
  });
  await routeStatic(context, staticDir);
  const page = await context.newPage();
  await page.goto("http://sheet.test/");
  await page.evaluate(
    async ({ css, svg }) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      document.body.insertAdjacentHTML("beforeend", svg);
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
    },
    { css: ISOLATE_CSS, svg: SHADOW_ONLY_FILTER },
  );
  return { page, close: () => browser.close() };
}

// Renders `s` with its box at (RENDER_PAD, RENDER_PAD); returns RGBA at SPRITE_DPR.
async function renderSticker(page: Page, deps: Deps, s: StickerRecord, mode: "sprite" | "silhouette") {
  await page.evaluate(
    async ({ slug, pad, mode }) => {
      const root = document.documentElement;
      root.classList.remove("__sprite", "__silhouette");
      root.classList.add(`__${mode}`);
      document.querySelector(".__t")?.classList.remove("__t");
      const el = document.querySelector<HTMLElement>(`.sticker[data-slug="${slug}"]`)!;
      el.classList.add("__t");
      root.style.setProperty("--gx", `${pad - el.offsetLeft}px`);
      root.style.setProperty("--gy", `${pad - el.offsetTop}px`);
      await Promise.all([...el.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    { slug: s.slug, pad: RENDER_PAD, mode },
  );
  const png = await page.screenshot({
    omitBackground: true,
    animations: "disabled",
    clip: { x: 0, y: 0, width: s.width + 2 * RENDER_PAD, height: s.height + 2 * RENDER_PAD },
  });
  const { data, info } = await deps.sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

type Raster = Awaited<ReturnType<typeof renderSticker>>;

// The smallest uniform pad (CSS px) around the box that holds every non-zero alpha pixel.
function spritePad(r: Raster, s: StickerRecord): number {
  const k = SPRITE_DPR;
  const x0 = RENDER_PAD * k;
  const y0 = RENDER_PAD * k;
  const x1 = x0 + s.width * k;
  const y1 = y0 + s.height * k;
  let out = 0;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[(y * r.width + x) * 4 + 3] === 0) continue;
      out = Math.max(out, x0 - x, x + 1 - x1, y0 - y, y + 1 - y1);
    }
  }
  const pad = Math.ceil(out / k);
  if (pad >= RENDER_PAD - 2) throw new Error(`${s.slug}: shadow reaches the render edge (pad ${pad})`);
  return pad;
}

function cropSprite(r: Raster, s: StickerRecord, pad: number) {
  const k = SPRITE_DPR;
  const left = (RENDER_PAD - pad) * k;
  const width = (s.width + 2 * pad) * k;
  const height = (s.height + 2 * pad) * k;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // The shadow is pure black; zeroed colour channels compress best.
      out[(y * width + x) * 4 + 3] = r.data[((y + left) * r.width + x + left) * 4 + 3]!;
    }
  }
  return { data: out, width, height };
}

// Fraction of the device pixel (px, py) covered by a w x h rounded rect of corner radius rad.
function coverage(px: number, py: number, w: number, h: number, rad: number): number {
  const N = 4;
  let inside = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = px + (i + 0.5) / N;
      const y = py + (j + 0.5) / N;
      const dx = Math.max(rad - x, x - (w - rad), 0);
      const dy = Math.max(rad - y, y - (h - rad), 0);
      if (dx * dx + dy * dy <= rad * rad) inside++;
    }
  }
  return inside / (N * N);
}

export interface BoxFit {
  radius: number | null;
  meanErr: number;
  maxErr: number;
}

// Eligibility for `box-shadow`: the silhouette must be a rectangle with equal rounded corners.
// Pass: mean |alpha - coverage| <= 0.002 over the box and no pixel off by more than 0.4 (anti-
// aliasing of the art and of this 4x4 supersampled model differ by less than that).
export const BOX_TOLERANCE = { mean: 0.002, max: 0.4 } as const;

export function fitBox(alpha: (x: number, y: number) => number, w: number, h: number): BoxFit {
  // Estimate the radius from the top-left diagonal: a radius-R corner leaves R(1 - 1/sqrt2) on each axis.
  let d = 0;
  while (d < Math.min(w, h) / 2 && alpha(d, d) < 0.5) d++;
  const estimate = d / (1 - Math.SQRT1_2);
  let best: BoxFit = { radius: null, meanErr: Infinity, maxErr: Infinity };
  const candidates = new Set<number>([0]);
  for (let r = Math.max(0, Math.floor(estimate) - 3); r <= Math.min(Math.ceil(estimate) + 3, Math.min(w, h) / 2); r++) {
    candidates.add(r);
  }
  for (const rad of candidates) {
    let sum = 0;
    let max = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nearCorner = (x < rad + 1 || x >= w - rad - 1) && (y < rad + 1 || y >= h - rad - 1);
        const err = Math.abs(alpha(x, y) - (nearCorner ? coverage(x, y, w, h, rad) : 1));
        sum += err;
        if (err > max) max = err;
      }
    }
    const meanErr = sum / (w * h);
    if (meanErr < best.meanErr) best = { radius: rad, meanErr, maxErr: max };
  }
  const ok = best.meanErr <= BOX_TOLERANCE.mean && best.maxErr <= BOX_TOLERANCE.max;
  return ok ? best : { ...best, radius: null };
}

function boxFitOf(r: Raster, s: StickerRecord): BoxFit {
  const k = SPRITE_DPR;
  const o = RENDER_PAD * k;
  const fit = fitBox((x, y) => r.data[((y + o) * r.width + x + o) * 4 + 3]! / 255, s.width * k, s.height * k);
  return fit.radius === null ? fit : { ...fit, radius: fit.radius / k };
}

const fmt = (n: number) => n.toFixed(4);

async function main(argv: string[]) {
  const force = argv.includes("--force");
  const staticDir = process.env.STATIC_DIR ?? "dist";
  if (!fs.existsSync(path.join(staticDir, "index.html"))) {
    throw new Error(`${staticDir}/index.html is missing: build first (npm run build).`);
  }
  const stickers = readStickers();
  const sprites = readJson<ShadowManifest>(SHADOWS_MANIFEST);
  const boxes = readJson<BoxManifest>(BOXES_MANIFEST);
  const spriteTodo = stickers.filter((s) => needsSprite(s) && (force || sprites[s.slug]?.hash !== spriteHash(s) || !fs.existsSync(path.join(SHADOWS_DIR, `${s.slug}.webp`))));
  const boxTodo = stickers.filter((s) => needsBox(s) && (force || boxes[s.slug]?.hash !== boxHash(s)));

  // Orphans first, so a sticker that lost its image loses its sprite too.
  for (const slug of Object.keys(sprites)) {
    if (!stickers.some((s) => s.slug === slug && needsSprite(s))) delete sprites[slug];
  }
  for (const slug of Object.keys(boxes)) {
    if (!stickers.some((s) => s.slug === slug && needsBox(s))) delete boxes[slug];
  }
  fs.mkdirSync(SHADOWS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SHADOWS_DIR)) {
    if (!sprites[f.replace(/\.webp$/, "")] && !spriteTodo.some((s) => `${s.slug}.webp` === f)) fs.rmSync(path.join(SHADOWS_DIR, f));
  }
  writeJson(SHADOWS_MANIFEST, sprites);
  writeJson(BOXES_MANIFEST, boxes);
  if (spriteTodo.length === 0 && boxTodo.length === 0) {
    console.log("All shadow sprites and box measurements are up to date.");
    return;
  }

  const deps = await loadDeps();
  const viewport = Math.max(...stickers.map((s) => Math.max(s.width, s.height))) + 2 * RENDER_PAD;
  const light = await openSheet(deps, staticDir, "light", viewport);
  const dark = await openSheet(deps, staticDir, "dark", viewport);
  let total = 0;
  try {
    for (const s of spriteTodo) {
      const raster = await renderSticker(light.page, deps, s, "sprite");
      const pad = spritePad(raster, s);
      const sprite = cropSprite(raster, s, pad);
      const webp = await deps.sharp(sprite.data, { raw: { width: sprite.width, height: sprite.height, channels: 4 } })
        .webp({ lossless: true, effort: 6 })
        .toBuffer();
      // The sprite is drawn in both schemes; report if the dark silhouette would cast another shadow.
      const darkRaster = await renderSticker(dark.page, deps, s, "sprite");
      let maxDark = 0;
      for (let i = 3; i < raster.data.length; i += 4) maxDark = Math.max(maxDark, Math.abs(raster.data[i]! - darkRaster.data[i]!));
      atomicWriteFileSync(path.join(SHADOWS_DIR, `${s.slug}.webp`), webp);
      sprites[s.slug] = { pad, hash: spriteHash(s) };
      writeJson(SHADOWS_MANIFEST, sprites);
      total += webp.length;
      console.log(`sprite ${s.slug.padEnd(20)} pad ${String(pad).padStart(2)}px  ${String(webp.length).padStart(6)} B  dark-vs-light max alpha diff ${maxDark}/255`);
    }
    for (const s of boxTodo) {
      const fitLight = boxFitOf(await renderSticker(light.page, deps, s, "silhouette"), s);
      const fitDark = boxFitOf(await renderSticker(dark.page, deps, s, "silhouette"), s);
      // Both schemes must agree on one box shape.
      const radius = fitLight.radius !== null && fitLight.radius === fitDark.radius ? fitLight.radius : null;
      boxes[s.slug] = { radius, hash: boxHash(s) };
      writeJson(BOXES_MANIFEST, boxes);
      console.log(
        `box    ${s.slug.padEnd(20)} ${radius === null ? "not a box" : `radius ${radius}px`}  light mean ${fmt(fitLight.meanErr)} max ${fmt(fitLight.maxErr)}  dark mean ${fmt(fitDark.meanErr)} max ${fmt(fitDark.maxErr)}`,
      );
    }
  } finally {
    await Promise.all([light.close(), dark.close()]);
  }
  if (spriteTodo.length > 0) console.log(`\n${spriteTodo.length} sprite(s) written, ${(total / 1024).toFixed(1)} KB`);
  console.log(`${Object.values(boxes).filter((b) => b.radius !== null).length} box-shaped sticker(s) of ${Object.keys(boxes).length} unclipped`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
