// Asset pipeline for public/stickers. Run `npm run optimize-assets [--dry-run] [file ...]`
// (Node 22.18+ strips the types itself).
//
// - `*.svg` except Bitmap.svg and logo.svg: SVGO (multipass, default preset minus a few plugins,
//   IDs kept) and every embedded PNG/JPEG data URI re-encoded as WebP. SVGs stay SVGs.
// - `*.png`: a sibling `*.webp` of the same pixel size. The PNG stays as the fallback.
//
// Every change is rendered in Chromium (light and dark scheme, 1x and 2x) next to the original and
// compared with pixelmatch. A file whose difference exceeds `GATE.maxDiffRatio` is not touched.
// A rerun changes nothing: what the pipeline wrote is recorded in `optimized-assets.json` (a hash
// of the files that define the settled state), and a recorded file is never processed again, so
// repeated runs cannot add up to more than one gated change.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import type { WebpOptions } from "sharp";
import type { Config, PluginConfig } from "svgo";

const RASTER_EXT = /\.(png|jpe?g)$/i;

// Pure and import-light: the Astro component calls it at build time.
export function webpSibling(imagePath: string, existing: ReadonlySet<string>): string | null {
  if (!RASTER_EXT.test(imagePath)) return null;
  const sibling = imagePath.replace(RASTER_EXT, ".webp");
  return existing.has(sibling) ? sibling : null;
}

// 0.05% of the pixels of a scene may differ at pixelmatch's per-pixel threshold of 0.1.
export const GATE = { maxDiffRatio: 0.0005, threshold: 0.1 } as const;

const SKIPPED_SVGS = new Set(["Bitmap.svg", "logo.svg"]);
const MANIFEST_PATH = "scripts/optimized-assets.json";
const STICKERS_DIR = "public/stickers";
const STICKER_DATA_DIR = "src/data/stickers";
// Longest side of a rendered scene in CSS px; keeps 2x renders of large files small.
const MAX_SCENE_SIDE = 1024;

// The smallest rung whose render passes the gate wins. Lossy WebP is far smaller on photographic
// art but bleeds chroma at hard edges, near-lossless keeps edges (level 60 is libwebp's usual
// "visually lossless" pick, 40 leaves margin below the first level that fails on sui-dau.png).
const WEBP_RUNGS: { label: string; options: WebpOptions }[] = [
  { label: "lossy q90", options: { quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true } },
  { label: "near-lossless 40", options: { nearLossless: true, quality: 40, effort: 6 } },
  { label: "lossless", options: { lossless: true, effort: 6 } },
];

// IDs stay: `<use>`, masks and `url(#...)` references must keep resolving (and cleanupIds saves
// only 0.4% here). inlineStyles stays off: it drops `@media (prefers-color-scheme)` blocks, which
// `mdx.svg` and `xkjd27c.svg` rely on. makeArcs stays off: it replaces curves by approximating
// arcs, which moves the rounded corners of `mdx.svg` by sub-pixel amounts for a few bytes.
// The first rung keeps SVGO's 3 decimals; a file that only passes the render gate with more digits
// (`typography.svg` glyph outlines, `double-lariat.svg`'s tiny `scale()` on a 722px bitmap) takes the second.
const SVGO_RUNGS: { label: string; overrides: Record<string, unknown> }[] = [
  { label: "svgo", overrides: {} },
  {
    label: "svgo precision 6",
    overrides: {
      convertPathData: { makeArcs: false, floatPrecision: 6 },
      convertTransform: { floatPrecision: 6, transformPrecision: 8 },
    },
  },
];

function svgoConfig(rung: (typeof SVGO_RUNGS)[number]): Config {
  return {
    multipass: true,
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: { cleanupIds: false, inlineStyles: false, convertPathData: { makeArcs: false }, ...rung.overrides },
        },
      } as PluginConfig,
    ],
  };
}

type Mime = "image/svg+xml" | "image/png" | "image/webp";

interface Candidate {
  label: string;
  bytes: Buffer;
}

interface Scene {
  width: number;
  height: number;
  dprs: (1 | 2)[];
}

async function loadDeps() {
  const [sharp, svgo, pixelmatch, playwright, yaml] = await Promise.all([
    import("sharp"),
    import("svgo"),
    import("pixelmatch"),
    import("@playwright/test"),
    import("yaml"),
  ]);
  return {
    sharp: sharp.default,
    optimize: svgo.optimize,
    pixelmatch: pixelmatch.default,
    chromium: playwright.chromium,
    parseYaml: yaml.parse,
  };
}
type Deps = Awaited<ReturnType<typeof loadDeps>>;

function svgIntrinsicSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const attr = (name: string) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']([0-9.]+)(?:px)?["']`, "i").exec(tag);
    return m ? Number(m[1]) : null;
  };
  const viewBox = /\sviewBox\s*=\s*["']\s*\S+[\s,]+\S+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(tag);
  const width = attr("width") ?? (viewBox ? Number(viewBox[1]) : null);
  const height = attr("height") ?? (viewBox ? Number(viewBox[2]) : null);
  return width && height ? { width, height } : null;
}

function fit(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, MAX_SCENE_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

// `/stickers/x.svg` -> the size the sticker is displayed at, so scenes match production.
function displaySizes(deps: Deps): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const file of fs.readdirSync(STICKER_DATA_DIR).filter((f) => f.endsWith(".yaml"))) {
    const data = deps.parseYaml(fs.readFileSync(path.join(STICKER_DATA_DIR, file), "utf8")) as {
      image?: string;
      width?: number;
      height?: number;
    };
    if (data.image && data.width && data.height) sizes.set(data.image, { width: data.width, height: data.height });
  }
  return sizes;
}

const DATA_URI = /data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)/g;

async function reencodeEmbedded(svg: string, rung: (typeof WEBP_RUNGS)[number], deps: Deps): Promise<string> {
  let out = "";
  let last = 0;
  for (const match of svg.matchAll(DATA_URI)) {
    const webp = await deps
      .sharp(Buffer.from(match[1] ?? "", "base64"))
      .webp(rung.options)
      .toBuffer();
    out += svg.slice(last, match.index) + `data:image/webp;base64,${webp.toString("base64")}`;
    last = match.index + match[0].length;
  }
  return out + svg.slice(last);
}

async function svgCandidates(text: string, deps: Deps): Promise<Candidate[]> {
  const sources = [{ label: "", text }];
  if (new RegExp(DATA_URI.source).test(text)) {
    for (const rung of WEBP_RUNGS) {
      sources.push({ label: ` + embedded ${rung.label}`, text: await reencodeEmbedded(text, rung, deps) });
    }
  }
  return sources.flatMap((source) =>
    SVGO_RUNGS.map((rung) => ({
      label: `${rung.label}${source.label}`,
      bytes: Buffer.from(deps.optimize(source.text, svgoConfig(rung)).data, "utf8"),
    })),
  );
}

async function webpCandidates(png: Buffer, deps: Deps): Promise<Candidate[]> {
  return Promise.all(
    WEBP_RUNGS.map(async (rung) => ({ label: rung.label, bytes: await deps.sharp(png).webp(rung.options).toBuffer() })),
  );
}

type Renderer = Awaited<ReturnType<typeof createRenderer>>;

async function createRenderer(deps: Deps) {
  const browser = await deps.chromium.launch();
  const served = new Map<string, { body: Buffer; contentType: string }>();
  let counter = 0;
  const pages = new Map<string, Page>();

  // The page that loads the image is created once per (scheme, dpr); assets are served from memory.
  for (const scheme of ["light", "dark"] as const) {
    for (const dpr of [1, 2] as const) {
      const context = await browser.newContext({ colorScheme: scheme, deviceScaleFactor: dpr });
      await context.route("http://assets.test/**", (route) => {
        const url = new URL(route.request().url());
        const hit = served.get(url.pathname);
        if (hit) return route.fulfill({ status: 200, body: hit.body, contentType: hit.contentType });
        const { w, h, bg, src } = Object.fromEntries(url.searchParams);
        const html = `<!doctype html><body style="margin:0;background:${bg}"><img src="${src}" style="display:block;width:${w}px;height:${h}px;object-fit:contain">`;
        return route.fulfill({ status: 200, body: html, contentType: "text/html" });
      });
      pages.set(`${scheme}@${dpr}`, await context.newPage());
    }
  }

  async function render(
    scheme: "light" | "dark",
    dpr: 1 | 2,
    body: Buffer,
    mime: Mime,
    width: number,
    height: number,
  ): Promise<Buffer> {
    const page = pages.get(`${scheme}@${dpr}`)!;
    const src = `/asset/${counter++}`;
    served.set(src, { body, contentType: mime });
    await page.setViewportSize({ width, height });
    const bg = scheme === "light" ? "#ffffff" : "#000000";
    await page.goto(`http://assets.test/scene?w=${width}&h=${height}&bg=${encodeURIComponent(bg)}&src=${src}`);
    await page.evaluate(async () => {
      await document.images[0]!.decode();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const shot = await page.screenshot({ animations: "disabled" });
    served.delete(src);
    return shot;
  }

  return { render, close: () => browser.close() };
}

async function decode(png: Buffer, deps: Deps) {
  const { data, info } = await deps.sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

interface Verdict {
  ok: boolean;
  worst: number;
  worstScene: string;
}

// Renders `original` and `candidate` in every scene; the verdict is the worst scene's ratio.
async function compare(
  renderer: Renderer,
  deps: Deps,
  original: { bytes: Buffer; mime: Mime },
  candidate: { bytes: Buffer; mime: Mime },
  scenes: Scene[],
): Promise<Verdict> {
  let worst = 0;
  let worstScene = "";
  let sawContent = false;
  for (const scene of scenes) {
    for (const dpr of scene.dprs) {
      for (const scheme of ["light", "dark"] as const) {
        // One page per (scheme, dpr): the two renders must not overlap.
        const a = await renderer.render(scheme, dpr, original.bytes, original.mime, scene.width, scene.height);
        let b: Buffer;
        try {
          b = await renderer.render(scheme, dpr, candidate.bytes, candidate.mime, scene.width, scene.height);
        } catch {
          return { ok: false, worst: 1, worstScene: "candidate does not decode" };
        }
        const [ra, rb] = await Promise.all([decode(a, deps), decode(b, deps)]);
        if (ra.width !== rb.width || ra.height !== rb.height) {
          return { ok: false, worst: 1, worstScene: `size mismatch ${scene.width}x${scene.height}@${dpr}x` };
        }
        const bg = ra.data.subarray(0, 4);
        for (let i = 4; i < ra.data.length && !sawContent; i += 4) {
          sawContent = ra.data[i] !== bg[0] || ra.data[i + 1] !== bg[1] || ra.data[i + 2] !== bg[2];
        }
        const differing = deps.pixelmatch(ra.data, rb.data, undefined, ra.width, ra.height, {
          threshold: GATE.threshold,
        });
        const ratio = differing / (ra.width * ra.height);
        if (ratio >= worst) {
          worst = ratio;
          worstScene = `${scene.width}x${scene.height}@${dpr}x ${scheme}`;
        }
      }
    }
  }
  // A blank render of the original would make any candidate "match".
  if (!sawContent) throw new Error("original rendered blank in every scene");
  return { ok: worst <= GATE.maxDiffRatio, worst, worstScene };
}

interface Outcome {
  file: string;
  kind: "svg" | "webp";
  // The file that is read (SVG or PNG) and the one that ends up served (SVG or its WebP sibling).
  before: number;
  after: number;
  status: string;
  worst: number | null;
  detail: string;
}

type Manifest = Record<string, string>;

function readManifest(): Manifest {
  return fs.existsSync(MANIFEST_PATH) ? (JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest) : {};
}

function writeManifest(manifest: Manifest): void {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

// Line endings are normalised so a CRLF checkout hashes like the committed bytes.
function hashOf(...paths: string[]): string {
  const hash = createHash("sha256");
  for (const file of paths) {
    hash.update(fs.readFileSync(file).toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  }
  return hash.digest("hex");
}

// What defines a settled asset: the SVG itself, or a PNG together with its WebP sibling.
function settledPaths(file: string): string[] {
  const full = path.join(STICKERS_DIR, file);
  if (file.endsWith(".svg")) return [full];
  const sibling = full.replace(RASTER_EXT, ".webp");
  return fs.existsSync(sibling) ? [full, sibling] : [full];
}

async function processFile(
  file: string,
  renderer: () => Promise<Renderer>,
  deps: Deps,
  displays: Map<string, { width: number; height: number }>,
  manifest: Manifest,
  dryRun: boolean,
): Promise<Outcome> {
  const isSvg = file.endsWith(".svg");
  const full = path.join(STICKERS_DIR, file);
  const original = fs.readFileSync(full);
  const target = isSvg ? full : full.replace(RASTER_EXT, ".webp");
  const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const outcome: Outcome = {
    file: path.basename(target),
    kind: isSvg ? "svg" : "webp",
    before: original.length,
    after: isSvg ? original.length : (current?.length ?? 0),
    status: "unchanged",
    worst: null,
    detail: "",
  };
  const settle = () => {
    if (!dryRun) manifest[path.basename(target)] = hashOf(...settledPaths(file));
  };

  if (manifest[outcome.file] === hashOf(...settledPaths(file))) {
    outcome.status = "up to date";
    return outcome;
  }

  const all = isSvg ? await svgCandidates(original.toString("utf8"), deps) : await webpCandidates(original, deps);
  // An SVG only ever shrinks; a WebP has to beat the PNG it replaces.
  const candidates = all.filter((c) => c.bytes.length < original.length).sort((a, b) => a.bytes.length - b.bytes.length);
  if (candidates.length === 0) {
    outcome.status = isSvg ? "unchanged (nothing smaller)" : "skipped (no WebP smaller than the PNG)";
    return outcome;
  }

  const display = displays.get(`/stickers/${file}`);
  const scenes: Scene[] = [];
  if (isSvg) {
    const natural = svgIntrinsicSize(original.toString("utf8"));
    for (const size of [display, natural]) {
      if (size) scenes.push({ ...fit(size.width, size.height), dprs: [1, 2] });
    }
  } else {
    const meta = await deps.sharp(original).metadata();
    if (display) scenes.push({ ...fit(display.width, display.height), dprs: [1, 2] });
    // Natural size is the strictest case for a codec: one source pixel per device pixel.
    scenes.push({ width: meta.width, height: meta.height, dprs: [1] });
  }
  const unique = scenes.filter((s, i) => scenes.findIndex((o) => o.width === s.width && o.height === s.height) === i);

  const hadViewBox = /<svg\b[^>]*\sviewBox=/i.test(original.toString("utf8"));
  const rejected: string[] = [];
  for (const candidate of candidates) {
    if (isSvg && hadViewBox && !/<svg\b[^>]*\sviewBox=/i.test(candidate.bytes.toString("utf8"))) {
      rejected.push(`${candidate.label}: lost viewBox`);
      continue;
    }
    const verdict = await compare(
      await renderer(),
      deps,
      { bytes: original, mime: isSvg ? "image/svg+xml" : "image/png" },
      { bytes: candidate.bytes, mime: isSvg ? "image/svg+xml" : "image/webp" },
      unique,
    );
    outcome.worst = verdict.worst;
    if (!verdict.ok) {
      rejected.push(`${candidate.label}: ${(verdict.worst * 100).toFixed(4)}% at ${verdict.worstScene}`);
      continue;
    }
    const changed = !current?.equals(candidate.bytes);
    if (changed && !dryRun) fs.writeFileSync(target, candidate.bytes);
    outcome.after = candidate.bytes.length;
    outcome.status = `${changed ? (dryRun ? "would write" : "written") : "unchanged"} (${candidate.label})`;
    outcome.detail = rejected.length > 0 ? `rejected first: ${rejected.join("; ")}` : "";
    settle();
    return outcome;
  }
  outcome.status = "REJECTED by render gate, nothing written";
  outcome.detail = rejected.join("; ");
  return outcome;
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

async function main(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const only = new Set(argv.filter((a) => !a.startsWith("--")));
  const files = fs
    .readdirSync(STICKERS_DIR)
    .filter((f) => (f.endsWith(".svg") && !SKIPPED_SVGS.has(f)) || /\.png$/i.test(f))
    .filter((f) => only.size === 0 || only.has(f))
    .sort();

  const deps = await loadDeps();
  const displays = displaySizes(deps);
  const manifest = readManifest();
  let renderer: Renderer | undefined;
  const getRenderer = async () => (renderer ??= await createRenderer(deps));

  const outcomes: Outcome[] = [];
  try {
    for (const file of files) {
      let outcome: Outcome;
      try {
        outcome = await processFile(file, getRenderer, deps, displays, manifest, dryRun);
      } catch (error) {
        process.exitCode = 1;
        outcome = {
          file,
          kind: file.endsWith(".svg") ? "svg" : "webp",
          before: 0,
          after: 0,
          status: `ERROR ${error instanceof Error ? error.message : String(error)}`,
          worst: null,
          detail: "",
        };
      }
      outcomes.push(outcome);
      const worst = outcome.worst === null ? "-" : `${(outcome.worst * 100).toFixed(4)}%`;
      console.log(
        `${outcome.file.padEnd(22)} ${String(outcome.before).padStart(8)} -> ${String(outcome.after).padStart(8)}  diff ${worst.padStart(9)}  ${outcome.status}${outcome.detail ? `  [${outcome.detail}]` : ""}`,
      );
    }
  } finally {
    await renderer?.close();
    if (!dryRun) writeManifest(manifest);
  }

  const total = (kind: Outcome["kind"], key: "before" | "after") =>
    outcomes.filter((o) => o.kind === kind).reduce((sum, o) => sum + o[key], 0);
  console.log(`\nSVG: ${kb(total("svg", "before"))} -> ${kb(total("svg", "after"))}`);
  console.log(`PNG ${kb(total("webp", "before"))} -> WebP sibling ${kb(total("webp", "after"))} (the PNG stays as the fallback)`);
  const rejected = outcomes.filter((o) => o.status.startsWith("REJECTED"));
  if (rejected.length > 0) {
    console.log(`\nRejected by the render gate: ${rejected.map((o) => o.file).join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
