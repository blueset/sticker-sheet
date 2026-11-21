// Dev-only: measures the shadow candidates against the live filter (S0) on a PUBLIC_VARIANTS=1
// build. `node scripts/measure-shadows.ts [outDir] [slug …]` (Node strips the types itself).
//
// Each sticker is rendered in place (rotation kept) at DPR 2, alone on a transparent page, then
// composited over the canvas colour of the scheme. The "ring" is every pixel outside the
// sticker's own silhouette (and more than EDGE device px from it, which is edge antialiasing)
// where either shadow is non-zero; the metric is the mean absolute
// RGB difference there, in 1/255 units (Task 2.3 requires < 2). `insideMean` is the same over
// the opaque silhouette. Extra checks:
// - `cv`: S1 with `content-visibility: auto` (shipped) vs forced `visible` — non-zero would mean
//   paint containment cuts the sprite.
// - `nomargin`: the same with `overflow-clip-margin: 0`, to show the containment hazard is real.
// - `hover`: S0 vs S1 at the 1.1x hover scale.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { routeStatic } from "./gen-shadows.ts";

const DPR = 2;
const MARGIN = 40;
const EDGE = 2;
const DEFAULT_SLUGS = ["cpp", "dark", "typescript", "inter", "yyyy-mm-dd"];

const CSS = `
html, body, body > div, #canvasWrapper, #canvas { background: transparent !important; }
#canvas { transform: translate(var(--gx), var(--gy)) !important; }
body > *:not(:has(#canvasWrapper)), #canvasWrapper ~ *, .sticker:not(.__t) { visibility: hidden !important; }
.__t { transition: none !important; }
html.__hover .__t { scale: 1.1 !important; }
html.__sil .__t { filter: none !important; box-shadow: none !important; }
html.__sil .__t::before { display: none !important; }
html.__cvvis .__t { content-visibility: visible !important; }
html.__nomargin .__t { overflow-clip-margin: 0px !important; }
`;

type Shot = { data: Buffer; width: number; height: number };

async function main(argv: string[]) {
  const outDir = argv[0] ?? ".superpowers/sdd/2026-11-20-render-performance-rewrite/task-2.2-shots";
  const slugs = argv.length > 1 ? argv.slice(1) : DEFAULT_SLUGS;
  const staticDir = process.env.STATIC_DIR ?? "dist";
  const html = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
  if (!html.includes("data-sprite")) throw new Error(`${staticDir} is not a PUBLIC_VARIANTS=1 build`);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const results: Record<string, unknown>[] = [];
  try {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme, deviceScaleFactor: DPR, viewport: { width: 900, height: 900 } });
      await routeStatic(context, staticDir);
      // Whole first viewport per variant (unmodified page) and its mean difference from s0.
      const full: Record<string, Buffer> = {};
      for (const v of ["s0", "s1", "s2"]) {
        const p = await context.newPage();
        await p.setViewportSize({ width: 1280, height: 800 });
        await p.goto(`http://sheet.test/?v=shadow:${v}`);
        await p.waitForFunction(() => "__viewer" in window);
        await p.waitForLoadState("networkidle");
        await p.evaluate(() => document.fonts.ready);
        const file = path.join(outDir, `page-${scheme}-${v}.png`);
        await p.screenshot({ path: file, animations: "disabled" });
        full[v] = (await sharp(file).removeAlpha().raw().toBuffer()) as Buffer;
        await p.close();
        if (v !== "s0") {
          const a = full[v]!;
          const b = full.s0!;
          let sum = 0;
          let changed = 0;
          for (let i = 0; i < a.length; i++) {
            const d = Math.abs(a[i]! - b[i]!);
            sum += d;
            if (d > 0) changed++;
          }
          const row = { page: `page-${scheme}-${v}.png`, scheme, compare: `${v}-vs-s0`, meanAll: +(sum / a.length).toFixed(4), changedChannels: changed };
          results.push(row);
          console.log(JSON.stringify(row));
        }
      }
      const page = await context.newPage();
      await page.goto("http://sheet.test/");
      await page.waitForFunction(() => "__viewer" in window);
      const bg = await page.evaluate((css) => {
        const opaque = ["canvas", "canvasWrapper"]
          .map((id) => document.getElementById(id)!)
          .concat([document.body, document.documentElement])
          .map((el) => getComputedStyle(el).backgroundColor)
          .find((c) => !/^rgba\(.*,\s*0\)$/.test(c) && c !== "transparent");
        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
        return opaque ?? (document.documentElement.classList.contains("dark") ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
      }, CSS);
      const bgRgb = (bg.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      console.log(`${scheme}: compositing over ${bg}`);

      for (const slug of slugs) {
        const box = await page.evaluate(async (slug) => {
          document.querySelector(".__t")?.classList.remove("__t");
          const el = document.querySelector<HTMLElement>(`.sticker[data-slug="${slug}"]`)!;
          el.classList.add("__t");
          const side = Math.max(el.offsetWidth, el.offsetHeight);
          const root = document.documentElement;
          // Box centre at (side, side) in viewport px.
          root.style.setProperty("--gx", `${side - el.offsetLeft - el.offsetWidth / 2}px`);
          root.style.setProperty("--gy", `${side - el.offsetTop - el.offsetHeight / 2}px`);
          await Promise.all([...el.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
          return {
            side,
            sprite: el.hasAttribute("data-sprite"),
            box: el.hasAttribute("data-box"),
            rotate: getComputedStyle(el).rotate,
            cv: getComputedStyle(el).contentVisibility,
          };
        }, slug);
        const half = Math.round(box.side * 0.75 + MARGIN);
        const clip = { x: box.side - half, y: box.side - half, width: 2 * half, height: 2 * half };

        const shoot = async (variant: string, classes: string[] = []): Promise<Shot> => {
          await page.evaluate(
            async ({ variant, classes }) => {
              const root = document.documentElement;
              root.setAttribute("data-v-shadow", variant);
              for (const c of ["__hover", "__sil", "__cvvis", "__nomargin"]) root.classList.toggle(c, classes.includes(c));
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            },
            { variant, classes },
          );
          const png = await page.screenshot({ omitBackground: true, animations: "disabled", clip });
          const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          return { data, width: info.width, height: info.height };
        };
        const over = (s: Shot): Buffer => {
          const out = Buffer.alloc(s.width * s.height * 3);
          for (let i = 0, j = 0; i < s.data.length; i += 4, j += 3) {
            const a = s.data[i + 3]! / 255;
            for (let c = 0; c < 3; c++) out[j + c] = Math.round(s.data[i + c]! * a + bgRgb[c]! * (1 - a));
          }
          return out;
        };
        const save = async (name: string, s: Shot) => {
          await sharp(over(s), { raw: { width: s.width, height: s.height, channels: 3 } })
            .png()
            .toFile(path.join(outDir, `${slug}-${scheme}-${name}.png`));
        };
        const compare = async (name: string, a: Shot, b: Shot, sil: Shot) => {
          const A = over(a);
          const B = over(b);
          const heat = Buffer.alloc(A.length);
          let ringSum = 0;
          let ringN = 0;
          let ringMax = 0;
          let insideSum = 0;
          let insideN = 0;
          const W = a.width;
          const H = a.height;
          // Pixels within EDGE device px of the silhouette are edge antialiasing, not shadow.
          const near = new Uint8Array(W * H);
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              if (sil.data[(y * W + x) * 4 + 3] === 0) continue;
              for (let dy = -EDGE; dy <= EDGE; dy++) {
                for (let dx = -EDGE; dx <= EDGE; dx++) {
                  const yy = y + dy;
                  const xx = x + dx;
                  if (yy >= 0 && yy < H && xx >= 0 && xx < W) near[yy * W + xx] = 1;
                }
              }
            }
          }
          for (let p = 0; p < W * H; p++) {
            let d = 0;
            for (let c = 0; c < 3; c++) d += Math.abs(A[p * 3 + c]! - B[p * 3 + c]!);
            d /= 3;
            heat[p * 3] = heat[p * 3 + 1] = heat[p * 3 + 2] = Math.min(255, Math.round(d * 32));
            const silA = sil.data[p * 4 + 3]!;
            if (silA === 255) {
              insideSum += d;
              insideN++;
            } else if (!near[p] && (a.data[p * 4 + 3]! > 0 || b.data[p * 4 + 3]! > 0)) {
              ringSum += d;
              ringN++;
              ringMax = Math.max(ringMax, d);
            }
          }
          await sharp(heat, { raw: { width: a.width, height: a.height, channels: 3 } })
            .png()
            .toFile(path.join(outDir, `${slug}-${scheme}-diff-${name}.png`));
          const row = {
            slug,
            scheme,
            compare: name,
            rotate: box.rotate,
            cv: box.cv,
            ringMean: +(ringSum / Math.max(1, ringN)).toFixed(3),
            ringMax: +ringMax.toFixed(2),
            ringPx: ringN,
            insideMean: +(insideSum / Math.max(1, insideN)).toFixed(3),
          };
          results.push(row);
          console.log(JSON.stringify(row));
        };

        const sil = await shoot("s0", ["__sil"]);
        const s0 = await shoot("s0");
        const s1 = await shoot("s1");
        const s2 = await shoot("s2");
        await save("s0", s0);
        await save("s1", s1);
        await save("s2", s2);
        await compare("s1-vs-s0", s1, s0, sil);
        await compare("s2-vs-s0", s2, s0, sil);
        if (box.sprite) {
          await compare("s1-cv-auto-vs-visible", s1, await shoot("s1", ["__cvvis"]), sil);
          await compare("s1-nomargin-vs-s1", await shoot("s1", ["__nomargin"]), s1, sil);
          const silH = await shoot("s0", ["__sil", "__hover"]);
          const s0H = await shoot("s0", ["__hover"]);
          const s1H = await shoot("s1", ["__hover"]);
          await save("s0-hover", s0H);
          await save("s1-hover", s1H);
          await compare("s1-vs-s0-hover", s1H, s0H, silH);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(outDir, "metrics.json"), `${JSON.stringify(results, null, 2)}\n`);
}

await main(process.argv.slice(2));
