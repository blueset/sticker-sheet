# Sticker Sheet

![Banner](docs/banner.png)

**Sticker Sheet** is an innovative About-me page, but full of interactive stickers. Create a personalized canvas with stickers that represent your identity, interests, and skills.

## Features

- A sticker canvas with zooming and panning support.
- Dark / light mode
- Fully localizable: name, description, and even stickers themselves
- Dynamic stickers running JavaScript logic
- MDX and React components in descriptions

## Getting Started

### Prerequisites

- Node.js 22.18 or later (`npm run optimize-assets` runs `scripts/optimize-assets.ts` with Node's built-in type stripping; CI uses Node 22), npm
- [Deno](https://deno.com), only to rebuild the baseline app (see "Baseline vs new")

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/blueset/sticker-sheet.git
   cd sticker-sheet
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:4321](http://localhost:4321) in your browser to see the result.

## Architecture

The site is a static [Astro 7](https://astro.build) build (`output: "static"`) for GitHub Pages: `npm run build` writes plain files to `dist/`, with no server code.

- **First paint without JavaScript.** `src/pages/index.astro` prerenders every sticker (`src/components/Sticker.astro`) as positioned DOM with its image, title and clip path.
- **Inline boot scripts.** Small inline scripts from `src/inline/` run before first paint:
  - `boot-head.ts` sets the theme and language.
  - `boot-view.ts` computes the initial view (centring a `/#slug` sticker) and fills the live (date) values.
  - `boot-fonts.ts` loads the CJK fonts.
- **Viewer.** `src/viewer/` is framework-free TypeScript:
  - `main.ts` is the only eager module script. A build step (`scripts/modulepreload.ts`) links it and its static imports from the head with `modulepreload`.
  - `controller.ts` handles pan, zoom and inertia.
  - `interactions.ts` handles clicks and hit-testing that agrees with each sticker's clip path.
  - `deeplink.ts` handles `/#slug`.
  - `prefetch.ts` does a bounded idle prefetch of descriptions.
- **React islands.** `src/islands/` has two islands, both hydrated at `client:idle`:
  - `Controls.tsx`: zoom, theme and language buttons (Radix).
  - `Sheet.tsx`: the description sheet (Silk).
- **Build-time stickers and MDX.**
  - `src/lib/stickers.ts` loads `src/data/stickers/*.yaml` at build time.
  - `src/lib/mdx/` compiles each description to its own lazily loaded chunk per language through a Vite plugin (`vite-plugin.ts`), including the dynamic (live) expressions.
  - Shared state and helpers live in `src/lib/`; styles in `src/styles/`.
- **Asset pipeline.** `npm run optimize-assets [--dry-run] [file ...]` (`scripts/optimize-assets.ts`) minifies `public/stickers/*.svg` and re-encodes embedded rasters to WebP, and writes WebP siblings for PNGs. Every change is gated by a pixel comparison and recorded in `scripts/optimized-assets.json`. See "Adding Your Own Stickers".
- **Dev tools.** `src/dev/` is wired in by the Astro integration `src/dev/integration.ts` under `astro dev` only. See "Dev tools".

Design and numbers: `docs/superpowers/specs/2026-11-20-render-performance-design.md`, `docs/superpowers/decisions/`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Astro dev server on http://localhost:4321 |
| `npm run build` | Static build to `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run check` | `astro check` (type check) |
| `npm run test:e2e` | Playwright e2e on all four projects (`chromium-desktop`, `chromium-mobile`, `webkit-mobile`, `firefox-desktop`); build first. It serves `STATIC_DIR` (default `dist`) on port 4173 |
| `npm run optimize-assets` | Asset pipeline for `public/stickers/` (see "Adding Your Own Stickers") |

The tests and benches read these environment variables:
- `TARGET` (`new`, the default, or `baseline`) picks the selector contract (`tests/contract.ts`).
- `STATIC_DIR` picks the directory to serve (`playwright.config.ts`).
- `VISUAL_MAX_DIFF` sets the screenshot tolerance (default 0, an exact match; `playwright.config.ts`).
- `BENCH` and `BENCH_GPU` are read by `playwright.config.ts` too; see "Benchmarks".

Playwright reuses a server that is already listening on port 4173 (`reuseExistingServer`). When you switch `STATIC_DIR`, stop the old server first, or you test the wrong build.

### Visual comparison

`tests/visual/baseline.spec.ts` compares the page with screenshots recorded from the baseline app (`tests/visual/__snapshots__`). The `initial`, hash, hover and tooltip scenes run on `chromium-desktop`; the "mobile sheet: peek and expanded" scene runs on `chromium-mobile`.

The default tolerance is an exact match, and the new build is not pixel-identical to the baseline, so a run at the default fails. In the `initial` scenes a few hundred pixels of font anti-aliasing differ (330–344 px after the Task 1.8 asset pass, measured with pixelmatch, `docs/superpowers/decisions/assets.md`). In the mobile sheet scene, 811 px differ because the sheet handle keeps a focus outline after it is clicked. That is a known, accepted parity difference: the baseline moves focus into the sheet on expand (R34, `docs/superpowers/decisions/006-final-verification.md` §2). The supported comparison uses `VISUAL_MAX_DIFF=0.01`. Never pass `--update-snapshots`.

```powershell
$env:TARGET='new'; $env:STATIC_DIR='dist'; $env:VISUAL_MAX_DIFF='0.01'
npx playwright test tests/visual --project=chromium-desktop
npx playwright test tests/visual --project=chromium-mobile
```

## Dev tools

Under `npm run dev` only, the Astro integration `src/dev/integration.ts` adds two tools:

- **Placement editor.** It appears on the main page (http://localhost:4321) as a Tweakpane panel at the top right.
  - Pick a sticker in the panel, or select one on the canvas; the panel follows the selection.
  - Edit rotation, x/y, width and height; the sticker moves on the live page. With the x/y control focused, the arrow keys nudge it by 5 px.
  - **Copy YAML** copies the `x`, `y`, `width`, `height` and `rotation` lines for `src/data/stickers/<slug>.yaml` and logs them to the console. Nothing is saved; paste the lines into the YAML.
- **SVG → CSS `shape()` workbench.** It is at http://localhost:4321/dev/svg-shape, and the panel's "SVG → CSS shape" button opens it. It converts a path from an SVG into a CSS `shape()` value for a sticker's `clipPath`.

`npm run build` contains neither. `tests/e2e/prod-clean.spec.ts` fails if any trace of them reaches the build:

```powershell
$env:TARGET='new'; npm run build; $env:STATIC_DIR='dist'; npx playwright test tests/e2e/prod-clean.spec.ts --project=chromium-desktop
```

## Benchmarks

The benches are Playwright files in `bench/`. They run only with `BENCH=1`: `playwright.config.ts` then adds `bench/**/*.bench.ts` and uses one worker. Build first and select the build with `TARGET` and `STATIC_DIR`, as for the e2e tests.

| File | Projects | Measures | Summary file |
|---|---|---|---|
| `bench/first-render.bench.ts` | `chromium-mobile`, `chromium-desktop` (CDP throttling) | FCP, LCP, CLS, TBT, critical-path JS, input readiness, all stickers painted, live value current | `bench/results/<label>-<profile>.json` |
| `bench/gestures.bench.ts` | `chromium-mobile`, `chromium-desktop` (Chromium only; `pinch` on mobile only) | frame times, main-thread `RunTask` per gesture, input delay, raster, crisp after settle | the same file as first-render |
| `bench/interaction.bench.ts` | `chromium-desktop` (hover), `chromium-mobile` (sheet-open) | hover cost per `mousemove`, sheet-open input delay | `bench/results/<label>-interaction-<TARGET>-<profile>.json` |
| `bench/portable.bench.ts` | `webkit-mobile`, `firefox-desktop` (no CDP, no throttling) | wheel and drag frames and settle time; a cross-engine regression check, not a budget measurement | `bench/results/<label>-portable-<project>.json` |

`<profile>` is `mobile` or `desktop`. Each first-render profile takes about a minute, each gestures profile a few minutes.

```powershell
$env:BENCH='1'; $env:TARGET='new'; $env:STATIC_DIR='dist'; $env:BENCH_LABEL='my-run'
npx playwright test bench/first-render.bench.ts --project=chromium-mobile
npx playwright test bench/gestures.bench.ts --project=chromium-mobile
# first-render and gestures: same again with --project=chromium-desktop
npx playwright test bench/interaction.bench.ts --project=chromium-desktop
npx playwright test bench/interaction.bench.ts --project=chromium-mobile
npx playwright test bench/portable.bench.ts --project=webkit-mobile --project=firefox-desktop
```

Environment variables (`bench/harness.ts`, `bench/results.ts`, and the bench headers):

- `BENCH=1` enables the benches.
- `TARGET` (`new` or `baseline`) picks the selector contract, so the same benches measure either app. The interaction bench also puts it in its file name.
- `BENCH_LABEL` names the output. Default: `TARGET`, then `new`.
- `BENCH_RUNS`: runs per profile or scenario (default 5).
- `BENCH_RUN_FROM`: first run number (default 1). Above 1, the label's earlier runs are kept, so two arms can alternate one run per invocation (`BENCH_RUNS=1`).
- `BENCH_QUERY` is appended to `/` in `page.goto`. For example, `'#riddler'` gives the deep-link first render (`audit-deeplink-*.json`).
- `BENCH_GPU=1` launches the Chromium projects with a hardware GPU (`--enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist`). Without it, headless Chromium rasterises in software (SwiftShader).
- `BENCH_PAYLOAD_GATE=0` turns off the first-render payload gate (critical-path JS ≤ 100 KB gzip and no library markers; checked on every mobile run and on the desktop median). The baseline needs it.
- `BENCH_PROBE_CSS` (gestures) injects CSS after load (`{stickers}` and `{layer}` expand to the contract selectors). `BENCH_PROBE_IMAGES=stub|pass` (first-render) replaces or routes the sticker image requests. Both are A/B probes; never set them for a real measurement.

Results:

- Raw runs go to the gitignored `bench/results/tmp/<label>-<profile>/` (portable: `tmp/<label>-portable-<project>/`).
- Each bench writes its summary itself when it finishes. `node bench/summarize.ts <label> <profile>` re-summarises the first-render and gestures runs.
- The tracked `bench/results/*.json` files are evidence cited by the decision records. Do not overwrite them: always pick a new `BENCH_LABEL`. Restore an overwritten file with `git checkout -- bench/results/<file>`.

## Baseline vs new

- **The baseline.** The rewrite is measured against the previous Next.js app at commit `c4ab84c`, which has the local tag `baseline-m0`. Tags are not pushed, so use the hash where the tag is missing.
  - `.baseline-site/` (git-ignored) is a copy of that app's unchanged static export (`out/` from `next build`).
  - To recreate it from the repository root (the baseline's YAML step needs [Deno](https://deno.com)), run the commands below. Delete an old `.baseline-site` first.

    ```powershell
    git worktree add ..\baseline baseline-m0   # or: git worktree add ..\baseline c4ab84c
    Push-Location ..\baseline; npm ci; npm run yaml -- --once; npm run build; Pop-Location
    Copy-Item -Recurse ..\baseline\out .baseline-site
    git worktree remove --force ..\baseline   # clean up; .baseline-site is all you need
    ```

  - Serve and test it with `TARGET=baseline` and `STATIC_DIR=.baseline-site`. For the first-render bench also set `BENCH_PAYLOAD_GATE=0`, because the baseline fails the payload gate by design. Example: `$env:BENCH='1'; $env:TARGET='baseline'; $env:STATIC_DIR='.baseline-site'; $env:BENCH_PAYLOAD_GATE='0'; $env:BENCH_LABEL='baseline-rerun'`.
- **Baseline results.** `bench/results/baseline-{mobile,desktop}.json` are the tracked Milestone 0 numbers (`docs/superpowers/baseline/report.md`). A bench run with `TARGET=baseline` and no `BENCH_LABEL` writes to the same names, so always set a `BENCH_LABEL`.
- **New-build results.**
  - `bench/results/m1-{mobile,desktop}.json` are the numbers at the end of Milestone 1 (`docs/superpowers/decisions/002-m1-numbers.md`).
  - `bench/results/audit-*.json` are the Milestone 2 audit, the source of the budget table (`docs/superpowers/decisions/004-parity.md` §3).
  - `bench/results/final-{mobile,desktop}.json` are the final first-render check (`docs/superpowers/decisions/006-final-verification.md` §3).

### Pathway B (archived)

A canvas-hybrid renderer (Pathway B) was prototyped and benchmarked against the DOM renderer (Pathway A) in Milestone 3. It is archived at commit `2d798d7` (local tag `pathway-b-m3`). A won by the spec's decision rule: on every comparable mobile metric that A missed, B was worse, unchanged, or better by less than the required 30 %. See `docs/superpowers/decisions/005-pathway.md` and `005a-pathway-b-results.md`. `bench/proto.ts` is kept so the benches still read B's capture fields and the committed `bench/results/m3-*.json` stay reproducible from that commit.

### Performance

These are 5-run medians in Chromium. "Mobile" is Pixel 7 emulation with 4× CPU and Fast 4G throttling. Baseline: `bench/results/baseline-*.json`. Final: `bench/results/final-*.json` (006 §3).

| Metric | Budget | Baseline | Final |
|---|---|---|---|
| Mobile LCP | ≤ 1,380 ms | 2,772 ms | 836 ms |
| Desktop LCP | ≤ 162 ms | 324 ms | 136 ms |
| Critical-path JS (gzip) | ≤ 100 KB | 473,458 B | mobile 8,011 B; desktop median 80,421 B¹ |
| TBT (mobile) | no regression | 726 ms | 0 ms |
| CLS | 0 | 0 | 0 |
| Input readiness (mobile) | ≤ 1.5 s | not measured | 546.3 ms |

¹ The desktop figure counts JS that finishes before the desktop LCP (136 ms median). Whether an island chunk lands first varies per run (006 §3). The eager graph is the 8,011 B of the mobile figure.

Gesture, settle and interaction numbers come from the Milestone 2 audit (004 §3) and were not re-run. Several budgets were missed:

- mobile main-thread time per gesture;
- desktop drag-inertia main-thread time (90 vs 57 ms, worse than the baseline);
- the 2× input-delay targets;
- desktop wheel input delay (70.3 vs 48.0 ms, worse than the baseline);
- desktop wheel crisp;
- deep-link LCP;
- desktop raster time;
- pinch frame count;
- the modulepreload cost;
- English aria-labels before hydration.

The full table is in the spec's "Final status (Milestone 4)" section and in 004 §3. Nothing has been measured on a real device; see `docs/superpowers/decisions/manual-device-checklist.md`.

## Adding Your Own Stickers

Stickers are defined in YAML files in the `src/data/stickers` directory. They are loaded directly at build time; there is no separate compile step.

To add a new sticker:

1. Create `src/data/stickers/<slug>.yaml`. The file name is the slug (used in `/#slug` links); stickers paint in ascending slug order.
1. Add your sticker image (if any) to `public/stickers/`.
1. Run `npm run optimize-assets` (or `npm run optimize-assets -- <file>` for just the new file, a name in `public/stickers/`). Commit the changed files and `scripts/optimized-assets.json`.
1. Place it with the placement editor (see "Dev tools"); `x` and `y` are the sticker's centre relative to the centre of the 3000 × 3000 canvas.

`optimize-assets` does not run during `npm run build` or the deploy; run it by hand when you add or change an image.

- It minifies SVGs with SVGO and re-encodes their embedded PNG/JPEG data URIs as WebP. For a PNG it writes a smaller `.webp` sibling; the PNG stays as the fallback, and `Sticker.astro` serves the WebP through `<picture>`.
- Each change is rendered in Chromium and compared with the original. A change that differs by more than 0.05 % of the pixels is not written.
- `scripts/optimized-assets.json` records a hash of each processed file, so a rerun skips files that are up to date. To re-optimise a file, restore its original from git and delete its manifest entry.
- `--dry-run` reports without writing anything.
- `Bitmap.svg` and `logo.svg` are skipped.

Details: `docs/superpowers/decisions/assets.md`.

The parity tests pin the 63 baseline stickers (`src/lib/stickers.test.ts` against `tests/fixtures/stickers.baseline.json`, and the sticker count in the e2e specs and `bench/harness.ts`). Adding a sticker makes them fail until they are updated.

Example `src/data/stickers/my-sticker.yaml`:

```yaml
x: 500
y: 300
width: 200
height: 200
rotation: 10 # degrees clockwise
image: /stickers/my-sticker.svg
title: 
  en: "My Sticker"
  ja: "私のステッカー"
description:
  en: "This is my custom sticker"
  ja: "これは私のカスタムステッカーです"
```

## License

MIT License.
