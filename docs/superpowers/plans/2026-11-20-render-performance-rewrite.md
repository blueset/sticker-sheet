# Sticker Sheet render-performance rewrite: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Sticker Sheet SPA so first render, panning and zooming are measurably faster (at least 2× the baseline and inside the spec's budgets) with every current feature preserved.

**Architecture:** Milestone 0 captures the current app (golden fixtures, screenshots, benchmark numbers). Milestone 1 builds the foundation as framework-neutral modules (build-time data and MDX, prerendered DOM, inline boot scripts, a custom gesture controller) under a thin static-site shell, with the Silk sheet and Radix controls as lazy React islands. Milestone 2 tunes Pathway A (lean DOM) by trace. Milestone 3 prototypes Pathway B (canvas hybrid) on the same harness. Milestone 4 applies the spec's decision rule and finishes.

**Tech Stack:** Astro (static, default; a spike in Task 1.1 can switch it to Next.js export), TypeScript, vanilla viewer, React 19 islands, `@mdx-js/mdx`, Tailwind 3, Silk, Radix, Vitest (+jsdom), Playwright (Chromium, WebKit, Firefox), sharp, SVGO.

**Spec:** `docs/superpowers/specs/2026-11-20-render-performance-design.md` (read it first; this plan only records decisions the spec leaves open).

## Global Constraints

- Still a web app on static GitHub Pages; `.github/workflows/deploy.yml` stays green. The built site must contain no server code.
- Browser support: evergreen Chromium, Safari and Firefox (`light-dark()`, `text-autospace`, `field-sizing`, `word-break: auto-phrase` stay in use). No Chromium-only optimisation that regresses WebKit or Firefox.
- Authoring contract unchanged: one `src/data/stickers/<slug>.yaml` per sticker plus an image; MDX strings with `_provideComponents()`, `export function`, JSX and `<style>`. Adding a sticker must not get harder.
- Canvas is 3000×3000, sticker `x`/`y` are centre-origin, box `left = x + (3000 − width)/2`, `top = y + (3000 − height)/2`. Placement must match the baseline within 1 px.
- Zoom range 0.1–5. Languages `en`, `zh-Hans`, `ja` with `localize()` fallback `source[lang] || source.en || first value`. Persisted keys: `localStorage.language` and `localStorage.theme` (`light` | `dark` | `system`), unchanged so saved preferences survive.
- Sheet: viewports ≤ 4096 px wide use a bottom sheet with two stops, peek `PANEL_HEIGHT + 96` = 231 px and expanded `calc(100dvh − 3em)` (796 px at 844; measured on the baseline, ruling R8), scrolling only at expanded (a wheel at peek expands the sheet, as Silk does by default). Wider viewports use a 320 px left panel (one stop). Centring offsets: `PANEL_HEIGHT` = 135 px (narrow), `PANEL_WIDTH` = 320 px (wide).
- Z-order: ascending slug (plain code-point comparison, not `localeCompare`). Hover scales a sticker but never reorders it.
- Budgets (mobile profile = Chromium mobile emulation, 4× CPU, "Fast 4G"): LCP ≤ 1.5 s for stickers in the initial viewport; critical-path JS ≤ 100 KB gzip; zero layout shift from sticker placement; p95 frame ≤ 16.7 ms; crisp re-raster ≤ 150 ms after gesture end; hover and sheet-open input delay < 100 ms; at least 2× better than baseline on each. M0 may tighten these, never loosen them without telling the owner.
- Anti-goals: no visible stale or placeholder value in a live sticker; no flash of the wrong language or theme; custom hit-testing must never disagree with the browser's `clip-path`; no feature silently regressing.
- `mdx.svg` and `xkjd27c.svg` keep following the OS `prefers-color-scheme` inside `<img>` (existing behaviour, kept).
- Commits: every commit uses two `-m` flags, the subject then `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`. Shell is Windows PowerShell: no heredocs, `;` not `&&` before PowerShell keywords. Screenshots go to files (the owner reads via CLI and cannot see images); report their paths. Never batch a browser page change with a screenshot in one parallel call.

## Review Focus

Inputs the spec implies but the feature tests would not otherwise hit, most likely first. Each is pinned by a test in the named task.

1. **Corrupt or blocked saved preferences** (`localStorage.language = "fr"`, `theme = "blue"`, or `localStorage` throwing in Safari private mode): fall back to `en` and `system`, no exception, no flash. Tasks 1.4, 1.12.
2. **Bad or stale hash** (`#nope`, `#`) gives the default view with no sheet and no error; back/forward after select then close walks the selection history. Task 1.11.
3. **Viewport changes** (resize, rotation, crossing 4096 px) while the sheet is open or after centring: bounds re-clamp, the sheet switches stop set, nothing is stuck off-canvas. Tasks 1.10, 1.13.
4. **A gesture that starts on a sticker** (drag ≥ 10 px, or a second finger down) never opens the sheet and does not drop the gesture; wheel or drag inside the sheet never moves the canvas. Tasks 1.10, 1.13.
5. **Partial failure**: JavaScript disabled, or the Controls, Sheet or description chunk fails to load. The 63 stickers still paint in the right place, the zoom buttons still work, and the sheet shows the title without crashing. Tasks 1.7, 1.12, 1.13.

## File Structure (after Milestone 1)

| Path | Responsibility |
|---|---|
| `src/lib/stickers.ts` | Parse YAML into `StickerRecord[]`, sorted by slug. Replaces `utils/compileYaml.ts`. |
| `src/lib/{localize,ui-strings,geometry,theme,appState}.ts` | Pure helpers, UI strings, canvas and sheet geometry, theme application, vanilla store. |
| `src/lib/mdx/{compile,recma-live,prerender,provider,vite-plugin}.ts(x)` | Build-time MDX, live-expression marking, component map, virtual modules. |
| `src/inline/{boot-head,boot-view,bundle}.ts` | Inline scripts (language and theme, initial transform, live fill) bundled to strings with esbuild. |
| `src/viewer/{math,controller,settle,variants,interactions,deeplink,main}.ts` | Framework-free gesture controller, settle strategies, tooltip, selection, hash, entry. |
| `src/islands/{Controls,Sheet}.tsx` | Lazy React islands. |
| `src/pages/index.astro`, `src/components/Sticker.astro` | Prerendered page. Only files that change if Task 1.1 picks Next.js. |
| `scripts/{optimize-assets,gen-shadows}.ts` | Contributor-run asset and shadow-sprite generators. |
| `bench/`, `tests/{e2e,parity,visual,fixtures}/` | Harness, fixtures, Playwright specs. |
| `docs/superpowers/{baseline,decisions}/` | Captured facts and measured decisions. |

---

## Milestone 0: baseline and parity capture (no product code changes)

### Task 0.1: Toolchain, selector contract, baseline served

**Files:**
- Modify: `package.json` (devDependencies: `@playwright/test`, `vitest`, `jsdom`, `serve`, `pixelmatch`, `pngjs`, `@types/pngjs`), `.gitignore` (add `test-results/`, `playwright-report/`, `bench/results/tmp/`, `.baseline-site/`)
- Create: `playwright.config.ts`, `vitest.config.ts` (alias `@` → `src`, `include: ['src/**/*.test.ts','bench/**/*.test.ts','scripts/**/*.test.ts','proto/**/*.test.ts']`), `tests/contract.ts`, `bench/profiles.ts`, `tests/smoke.spec.ts`

**Interfaces:**
- Produces `tests/contract.ts`:
  ```ts
  export type Target = 'baseline' | 'new';
  export interface Contract {
    viewer: string; layer: string; stickers: string; sheetHandle: string;
    controls: { zoomIn: string; zoomOut: string; center: string; theme: string; language: string };
  }
  export const target: Target; // process.env.TARGET, default 'new'
  export const contract: Contract;
  ```
  Baseline values: viewer `#canvasWrapper`, layer `#canvasWrapper > .react-transform-component` (confirm in the DOM), stickers `#canvasWrapper button.absolute`, controls inside `div.absolute.bottom-4.right-4` (theme trigger, language trigger, a `span` holding zoom-in then zoom-out, centre), sheet handle `[aria-label="Toggle panel size"]`. New-app values: viewer `#canvasWrapper`, layer `#canvas`, stickers `button.sticker[data-slug]`, controls `[aria-label="Zoom in"|"Zoom out"|"Center view"|"Toggle theme"|"Change language"]` (English strings from `ui-strings`), handle `[aria-label="Toggle panel size"]`.
- Produces `bench/profiles.ts`: `PROFILES = { mobile: { device: 'Pixel 7', cpuSlowdown: 4, network: <DevTools "Fast 4G" preset values> }, desktop: { cpuSlowdown: 1, network: null } }`.
- Produces `playwright.config.ts`: projects `chromium-desktop` (1280×800), `chromium-mobile` (`devices['Pixel 7']`), `webkit-mobile` (`devices['iPhone 14']`), `firefox-desktop`. `webServer` runs `npx serve $STATIC_DIR -l 4173 --no-clipboard`, `reuseExistingServer: true`. `testMatch` is `tests/**/*.spec.ts`, plus `bench/**/*.bench.ts` only when `BENCH=1` (otherwise ignored). `snapshotPathTemplate: 'tests/visual/__snapshots__/{arg}{ext}'` (platform-independent; visual tests run locally only).

- [ ] **Step 1: Build the unchanged app**

  Run: `npm ci; npm run yaml -- --once; npm run build`
  Expected: `out\index.html` exists.

- [ ] **Step 2: Install tooling and browsers**

  Run: `npm i -D @playwright/test vitest jsdom serve pixelmatch pngjs @types/pngjs; npx playwright install chromium webkit firefox`

- [ ] **Step 3: Write the failing smoke spec** `tests/smoke.spec.ts`

  ```ts
  import { test, expect } from '@playwright/test';
  import { contract } from './contract';
  test('every sticker renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(contract.stickers)).toHaveCount(63);
  });
  ```
  Run: `$env:TARGET='baseline'; $env:STATIC_DIR='out'; npx playwright test tests/smoke.spec.ts --project=chromium-desktop`
  Expected: FAIL before `playwright.config.ts` and `contract.ts` exist; fix until PASS.

- [ ] **Step 4: Commit** `chore: add test and benchmark toolchain` (`git add package.json package-lock.json .gitignore playwright.config.ts vitest.config.ts tests bench`).

### Task 0.2: Parity fixtures captured from the baseline

**Files:**
- Create: `bench/export-fixtures.ts`, `tests/parity/record-golden.spec.ts` (runs only with `RECORD=1`), `tests/fixtures/{stickers.baseline.json,placement.json,rzpp-golden.json}`, `docs/superpowers/baseline/{rzpp-defaults.md,z-order.md}`

**Interfaces:**
- Produces `stickers.baseline.json`: `StickerRecord[]` exactly as the baseline app consumes them (`js-yaml.load` of the generated `src/data/stickers.yaml`, original array order).
- Produces `placement.json`: `Record<slug, { left: number; top: number; width: number; height: number; rotate: string }>`, read from the baseline DOM (`offsetLeft/Top/Width/Height`, computed `rotate`).
- Produces `rzpp-golden.json`: `{ profile: 'desktop'|'mobile'; viewport: [number, number]; entries: { name: string; ops: Op[]; expected: { x: number; y: number; scale: number } }[] }` where `Op` is `{ t: 'wheel'; at: [number, number]; deltaY: number } | { t: 'drag'; from: [number, number]; by: [number, number]; ms: number } | { t: 'dblclick'; at: [number, number] } | { t: 'click'; control: 'zoomIn'|'zoomOut'|'center' } | { t: 'resize'; to: [number, number] }`. Entries cover: initial centred state; wheel zoom-in ramp; wheel zoom-out to the minimum; slow drag; fast flick followed by inertia; drag far past every edge at scales 0.1, 1 and 5 (bounds probes named `bounds-*`, each also recording `push`, `scale`, `viewport` so Task 1.9 can replay them as pure maths); double-click; each control button. `expected` is read after the transform has been unchanged for 600 ms.

- [ ] **Step 1: Export stickers.** `node bench/export-fixtures.ts stickers` writes `stickers.baseline.json` (Node 26 strips types: use `.ts` import extensions, no enums).

- [ ] **Step 2: Record placement.** In `record-golden.spec.ts` (`RECORD=1`), zip the baseline DOM order with `stickers.baseline.json` slugs, assert each rect equals the formula in Global Constraints, write `placement.json`.

- [ ] **Step 3: Record gesture goldens** on `chromium-desktop` and `chromium-mobile` using real input (`page.mouse`, CDP touch for pinch). Run the recorder twice; the two `rzpp-golden.json` outputs must agree within 1 px and 0.001 scale.
  Run: `$env:RECORD='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'; npx playwright test tests/parity/record-golden.spec.ts --project=chromium-desktop`

- [ ] **Step 4: Write `rzpp-defaults.md`.** Read `node_modules/react-zoom-pan-pinch` and tabulate, with file and line: wheel step and smooth factor, pinch step, double-click mode, step and animation time, panning velocity sensitivity, animation time and easing, `limitToBounds`, `centerZoomedOut`, padding, default `setTransform` animation time and easing, `centerOnInit` behaviour.

- [ ] **Step 5: Write `z-order.md`.** Compute overlapping sticker pairs (rotated-rectangle test), compare the baseline DOM order with ascending-slug order, and list every pair whose paint order differs. If none differ, say so. Flag the finding for the owner (Task 0.3).

- [ ] **Step 6: Commit** `test: capture baseline parity fixtures`.

### Task 0.3: Record the real sheet behaviour and clear the owner gate

**Files:**
- Create: `tests/parity/record-sheet.spec.ts` (`RECORD=1`), `docs/superpowers/baseline/sheet-behaviour.{json,md}`

**Interfaces:** Produces `sheet-behaviour.json`: `{ peekHeightPx: number; expandedHeightPx: number | null; handleTogglesStops: boolean; scrollsAtPeek: boolean; scrollsAtExpanded: boolean; dragDismisses: boolean; wideLeftPanelWidthPx: number }`, measured on the baseline at 390×844 and 4100×1000.

- [ ] **Step 1: Record.** Open `/#dark`, then `/#css` (long description). Measure the sheet rectangle, click the handle, wheel-scroll the content at each stop, drag the handle down. Save screenshots under `bench/results/tmp/sheet-*.png` and list their paths in the `.md`.
- [ ] **Step 2: Compare against the "Sheet spec" in the design doc.** Silk detent indexes may be 1-based with 0 meaning hidden, which would explain the old code's `activeSnap !== 2`; confirm against the installed `@silk-hq/components` types.
- [ ] **Step 3: Gate.** Use `ask_user` once with: (a) any difference between the running app and the Sheet spec (choices: keep spec, or adopt observed behaviour), and (b) the `z-order.md` findings (choices: slug order is fine, or add a `z` field in a later change). Do not start Milestone 1 until answered. Update the design doc with the answers and commit `docs: record baseline sheet behaviour and owner decisions`.

### Task 0.4: Visual baselines

**Files:**
- Create: `tests/visual/baseline.spec.ts`, `tests/visual/__snapshots__/*`

**Interfaces:** Snapshot names are `<viewport>-<theme>-<lang>-<scene>.png`. Scenes: `initial` (desktop 1440×900), `hash-dark` (`#dark`), `sheet-peek` and `sheet-expanded` (mobile 390×844, if two stops exist), `hover-clip` (mouse over the inside edge of the circle-clipped `dark` sticker), `tooltip` (mouse at a fixed point over `dd-mmm-yyyy`). Matrix: light and dark × `en`, `zh-Hans`, `ja` for `initial`; one theme and language for the others.

- [ ] **Step 1: Write the spec.** Set `localStorage.language` and `.theme` with `page.addInitScript`; await `document.fonts.ready` and decoded images; disable animations; mask `dd-mmm-yyyy` and `yyyy-mm-dd` (they show today's date).
- [ ] **Step 2: Capture against the baseline.** `$env:TARGET='baseline'; $env:STATIC_DIR='out'; npx playwright test tests/visual --project=chromium-desktop --update-snapshots`, then the mobile scenes with `--project=chromium-mobile`. Run again without `--update-snapshots`; Expected: PASS (determinism).
- [ ] **Step 3: Commit** `test: capture baseline screenshots`.

### Task 0.5: Benchmark harness and baseline numbers

**Files:**
- Create: `bench/{metrics.ts,trace.ts,metrics.test.ts,trace.test.ts,summarize.ts,first-render.bench.ts,gestures.bench.ts}`, `bench/results/baseline-*.json`, `docs/superpowers/baseline/report.md`
- Modify: the spec's "Proposed budgets" section

**Interfaces:**
- `metrics.ts`: `percentile(values: number[], p: number): number`, `gzipBytes(buf: Uint8Array): number`.
- `trace.ts`: `analyzeTrace(events: TraceEvent[], window: { startMs: number; endMs: number }): { mainBusyMs: number; lastRasterEndMs: number | null; framesOver16: number; framesOver33: number }` (main thread = renderer `CrRendererMain`; busy = sum of `RunTask` durations clipped to the window).
- Result shapes written to JSON:
  ```ts
  interface FirstRenderResult { fcp: number; lcp: number; tbt: number; cls: number; allStickersPaintedMs: number;
    liveCurrentMs: number | null; criticalPathJsGzip: number;
    bytes: { js: number; css: number; img: number; font: number; html: number; other: number } }
  interface GestureResult { name: 'wheel-zoom' | 'drag-inertia' | 'pinch' | 'button-zoom'; frames: number; over16: number;
    over33: number; p95FrameMs: number; mainBusyMs: number; crispAfterMs: number | null; peakHeapMb: number }
  ```

- [ ] **Step 1: Failing unit tests** `metrics.test.ts`, `trace.test.ts` (synthetic trace fixture):
  ```ts
  expect(percentile([1,2,3,4,5,6,7,8,9,10], 95)).toBe(10);
  expect(percentile([5], 50)).toBe(5);
  // trace: two RunTask events of 10 ms and 30 ms inside the window, one outside
  expect(analyzeTrace(events, { startMs: 0, endMs: 100 }).mainBusyMs).toBe(40);
  ```
  Run: `npx vitest run bench` Expected: FAIL, then implement until PASS.
- [ ] **Step 2: First-render bench** (`BENCH=1`, Chromium only for throttling). Throttle with CDP `Emulation.setCPUThrottlingRate` and `Network.emulateNetworkConditions` from `PROFILES`. `allStickersPaintedMs` = first rAF at which every `contract.stickers` element is visible and every `img` is `complete && naturalWidth > 0`. `liveCurrentMs` = first moment `document.body.innerText` contains `new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})`. `criticalPathJsGzip` = gzip bytes of JS responses finished before LCP.
- [ ] **Step 3: Gesture bench.** Use only real input (wheel ramp, drag with release, touch pinch via CDP, the zoom buttons) so it works on any target. Record per-frame deltas with an in-page rAF loop, plus CDP tracing (`devtools.timeline,disabled-by-default-devtools.timeline`) fed to `analyzeTrace`. `crispAfterMs` is the gap from gesture end to the last `RasterTask` (a proxy; say so in the report).
- [ ] **Step 4: Run on the baseline**, 5 runs each: `$env:BENCH='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'; npx playwright test bench --project=chromium-mobile` then `--project=chromium-desktop`. `summarize.ts` writes medians and p95 to `bench/results/baseline-{mobile,desktop}.json`.
- [ ] **Step 5: Write `report.md`.** Confirm or refute each suspect in the design doc's "What the code does today" list with a trace-backed line. Tighten (never loosen) the spec's budgets from the numbers. Copy the unchanged build: `Copy-Item out .baseline-site -Recurse` (local, gitignored; later runs serve it with `STATIC_DIR=.baseline-site`).
- [ ] **Step 6: Commit and tag.** `git add bench docs; git commit ... "test: add benchmark harness and baseline numbers"; git tag baseline-m0`.

---

## Milestone 1: foundation

### Task 1.1: Stack spike and decision

**Files:**
- Create (throwaway, deleted before commit): `spike/astro/`, `spike/next/`
- Create: `docs/superpowers/decisions/001-stack.md`

**Interfaces:** Produces the decision record: chosen stack, critical-path JS gzip and mobile LCP for each, and any blocker found.

- [ ] **Step 1: Build both spikes.** Each prerenders the 63 stickers (box, `<img>`, per-sticker data from the YAML) and one lazily hydrated React island, and compiles the `dark` en description at build with `compile(source, { outputFormat: 'program', providerImportSource: '#mdx-provider' })` so that `_provideComponents()` and `<Button>` inside an `export function` both resolve.
- [ ] **Step 2: Measure** with `first-render.bench.ts` (`TARGET=new`, `STATIC_DIR` pointing at each build output).
- [ ] **Step 3: Decide.** Astro wins unless (a) a blocker appears (the `_provideComponents()` plus exported-function MDX does not run at build, the island cannot hydrate lazily, or an inline script cannot run before first paint) or (b) Next.js critical-path JS gzip is ≤ Astro's. Write the record.
- [ ] **Step 4: If Next.js wins,** apply this mapping for the rest of the plan: `src/pages/index.astro` → `src/app/page.tsx` plus `layout.tsx`; `astro.config.mjs` → `next.config.ts` with `output: 'export'`; the Vite virtual-module plugin → a webpack/turbopack loader with the same exports; `dist/` → `out/`. Everything under `src/lib`, `src/viewer`, `src/inline`, `scripts`, `tests`, `bench` is unchanged.
- [ ] **Step 5: Delete `spike/` and commit** `docs: record stack decision`.

### Task 1.2: Scaffold the new project, data loader, CI

**Files:**
- Modify: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `.gitignore`, `.github/workflows/deploy.yml`, `README.md`
- Create: `astro.config.mjs`, `src/lib/stickers.ts`, `src/lib/stickers.test.ts`, `src/pages/index.astro` (placeholder)
- Move: `src/app/fonts/*` → `src/assets/fonts/`, `src/app/background*.png` → `src/assets/`; `src/components/ui/{button,dropdown-menu,tooltip}.tsx` and `src/lib/{utils,svgToCssShape}.ts` stay
- Delete: `utils/compileYaml.ts`, `deno.lock`, `next.config.ts`, `eslint.config.mjs`, `src/app/**` except what is moved, `src/types/next-yaml.d.ts`, `src/lib/i18n.ts`, `src/components/ui/{drawer,theme-provider}.tsx` (history keeps them; they are replaced in later tasks)

**Interfaces:**
- Produces:
  ```ts
  export type Localized = Record<string, string | undefined>;
  export interface StickerRecord { slug: string; x: number; y: number; width: number; height: number; rotation?: number;
    image?: string; clipPath?: string; content?: Localized; title: Localized; description?: Localized }
  export const CANVAS = { width: 3000, height: 3000 } as const;
  export function parseSticker(slug: string, raw: string): StickerRecord; // uses the `yaml` package (same parser as the old Deno step)
  export function loadStickers(): StickerRecord[]; // import.meta.glob('/src/data/stickers/*.yaml', { query: '?raw', import: 'default', eager: true }), sorted ascending by slug
  ```
- Scripts: `dev` `astro dev`, `build` `astro build`, `preview` `astro preview`, `check` `astro check`, `test` `vitest run`, `test:e2e` `playwright test`, `optimize-assets`, `shadows` (the last two added later).
- Dependencies removed: `next`, `eslint-config-next`, `next-themes`, `next-mdx-remote`, `react-zoom-pan-pinch`, `i18next`, `react-i18next`, `yaml-loader`, `@use-gesture/react`, `@mantine/hooks`, `framer-motion`, `vaul`, `react-scan`, `@radix-ui/react-dialog`. Added: `astro`, `@astrojs/react`, `@mdx-js/mdx`, `yaml`, `sharp`, `svgo`, `esbuild` (explicit), `@fontsource-variable/inter`, `@fontsource-variable/noto-sans-sc`, `@fontsource-variable/noto-sans-jp`. Tailwind custom variants `panning` and `zooming` are dropped (replaced by `[data-gesture]`); `can-hover`, `no-hover`, `title` stay.

- [ ] **Step 1: Write the failing test** `src/lib/stickers.test.ts`
  ```ts
  import baseline from '../../tests/fixtures/stickers.baseline.json';
  import { loadStickers, parseSticker } from './stickers';
  test('matches the data the baseline app rendered, ordered by slug', () => {
    const want = [...baseline].sort((a, b) => (a.slug < b.slug ? -1 : 1));
    expect(loadStickers()).toEqual(want);
  });
  test('slugs are unique and ascending', () => {
    const slugs = loadStickers().map((s) => s.slug);
    expect(new Set(slugs).size).toBe(63);
    expect(slugs).toEqual([...slugs].sort());
  });
  test('parseSticker names the slug when the document is not an object', () => {
    expect(() => parseSticker('x', '- 1')).toThrow(/x/);
  });
  ```
  Run: `npx vitest run src/lib/stickers.test.ts` Expected: FAIL (module missing).
- [ ] **Step 2: Implement `stickers.ts` and the Astro scaffold** (`astro.config.mjs`: `output: 'static'`, React integration, Tailwind through the existing PostCSS config, alias `@` → `src`). Run the test; Expected: PASS.
- [ ] **Step 3: Update CI.** `deploy.yml`: remove the Deno setup and `Build data` steps, add `npm test` before `npm run build`, upload `dist` instead of `out`. Update the README's prerequisites (no Deno) and commands.
- [ ] **Step 4: Verify** `npm test; npm run build` Expected: tests pass and `dist\index.html` exists.
- [ ] **Step 5: Commit** `refactor: replace Next.js scaffold with Astro and build-time sticker loading`.

### Task 1.3: Pure libraries (localize, UI strings, geometry)

**Files:**
- Create: `src/lib/{localize,ui-strings,geometry}.ts` and `*.test.ts` for each

**Interfaces:**
- `localize(source: Localized | undefined, lang: string): string | undefined`; `LANGS = ['en','zh-Hans','ja'] as const`; `type Lang`; `isLang(x: unknown): x is Lang`.
- `ui-strings.ts`: `t(lang: Lang, key: UiKey): string`, `UiKey` = the keys of the old `i18n.ts` resources (`changeLanguage`, `theme.toggleTheme`, `theme.light`, `theme.dark`, `theme.system`, `zoomIn`, `zoomOut`, `centerView`, `togglePanelSize`), same three-language strings, unknown language falls back to `en`.
- `geometry.ts`: `PANEL_HEIGHT = 135`, `PANEL_WIDTH = 320`, `PANEL_BREAKPOINT = 4096`, `SHEET_PEEK_PX = PANEL_HEIGHT + 96`, `SHEET_EXPANDED = 'calc(100dvh - 3em)'`; `interface Transform { x: number; y: number; scale: number }`; `stickerBox(s: Pick<StickerRecord,'x'|'y'|'width'|'height'>): { left: number; top: number; width: number; height: number }`; `stickerCenter(s): { x: number; y: number }` (`x + 1500`, `y + 1500`); `viewTransformFor(point: {x:number;y:number}, scale: number, viewport: {w:number;h:number}): Transform` (port of `convertToCanvasCoordinates`: narrow = `w <= 4096`); `isInitialViewport(s, view?: {w:number;h:number}): boolean` (default 1440×900 centred on the canvas centre; true when the sticker box intersects it).

- [ ] **Step 1: Failing tests**
  ```ts
  expect(localize({ en: 'A', ja: 'B' }, 'ja')).toBe('B');
  expect(localize({ en: 'A' }, 'ja')).toBe('A');
  expect(localize({ ja: 'B' }, 'zh-Hans')).toBe('B');
  expect(localize({ en: '' }, 'en')).toBeUndefined();
  expect(localize(undefined, 'en')).toBeUndefined();
  expect(t('ja', 'zoomIn')).toBe('拡大');
  expect(t('xx' as Lang, 'zoomIn')).toBe('Zoom in');
  expect(stickerBox({ x: 225, y: -290, width: 180, height: 50 })).toEqual({ left: 1635, top: 1185, width: 180, height: 50 });
  expect(viewTransformFor({ x: 1500, y: 1500 }, 1, { w: 390, h: 844 })).toEqual({ x: -1305, y: -1145.5, scale: 1 });
  expect(viewTransformFor({ x: 1500, y: 1500 }, 2, { w: 5000, h: 1000 })).toEqual({ x: -340, y: -2500, scale: 2 });
  expect(viewTransformFor({ x: 0, y: 0 }, 1, { w: 4096, h: 800 }).y).toBe((800 - 135) / 2); // 4096 is still narrow
  expect(viewTransformFor({ x: 0, y: 0 }, 1, { w: 4097, h: 800 }).x).toBe(320 + (4097 - 320) / 2);
  expect(isInitialViewport({ x: 225, y: -290, width: 180, height: 50 })).toBe(true);
  expect(isInitialViewport({ x: 1400, y: 0, width: 100, height: 100 })).toBe(false);
  ```
  Run: `npx vitest run src/lib` Expected: FAIL.
- [ ] **Step 2: Implement the three modules.** Run again; Expected: PASS.
- [ ] **Step 3: Commit** `feat: add localize, UI strings and geometry helpers`.

### Task 1.4: App state, theme and inline boot scripts

**Files:**
- Create: `src/lib/{appState,theme}.ts`, `src/inline/{boot-head,boot-view,bundle}.ts`, and `appState.test.ts`, `theme.test.ts`, `boot.test.ts` (jsdom: first line `// @vitest-environment jsdom`)

**Interfaces:**
- `theme.ts`: `resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark'`; `applyTheme(choice: ThemeChoice): void` (toggles `.dark` on `<html>`, sets `style.colorScheme`, listens to `prefers-color-scheme` while `system`).
- `appState.ts` (zustand/vanilla): `type ThemeChoice = 'light'|'dark'|'system'`; `appStore: StoreApi<{ language: Lang; theme: ThemeChoice; selectedSlug: string | null }>`; `setLanguage(l: Lang)` (persists `localStorage.language`, sets `document.documentElement.lang`); `setTheme(t: ThemeChoice)` (persists `localStorage.theme`, calls `applyTheme`); `select(slug: string | null, opts?: { push?: boolean })` (push `#slug`, or `location.pathname` when closing); `initFromHash(knownSlugs: ReadonlySet<string>)` (unknown or empty hash selects nothing); every `localStorage` access is wrapped in try/catch.
- `bundle.ts`: `bundleInline(entry: string): Promise<string>` (esbuild `build`, `bundle`, `minify`, `format: 'iife'`, `write: false`).
- `boot-head.ts`: self-contained; reads saved language and theme, validates against `LANGS` and `ThemeChoice`, sets `<html lang>`, `.dark` and `colorScheme`.
- `boot-view.ts`: runs once the canvas is parsed. Reads the hash; if it names an element `[data-slug]`, sets `#canvas` `style.transform` to `translate(xpx, ypx) scale(1)` from `viewTransformFor(centre from data-cx/data-cy, 1, viewport)`; otherwise centres the canvas (`x = (vw − 3000)/2`, `y = (vh − 3000)/2`, the old `centerOnInit`). Stores the result in `window.__boot = { x, y, scale }`. Then fills live nodes (Task 1.6).

- [ ] **Step 1: Failing tests**
  ```ts
  // boot.test.ts: run bundled scripts with new Function against jsdom
  it('applies saved ja + dark before paint', () => { /* storage language=ja, theme=dark */
    expect(html.lang).toBe('ja'); expect(html.classList.contains('dark')).toBe(true); expect(html.style.colorScheme).toBe('dark'); });
  it('falls back to en + system for invalid values', () => { /* language=fr, theme=blue, matchMedia dark=false */
    expect(html.lang).toBe('en'); expect(html.classList.contains('dark')).toBe(false); });   // Review Focus 1
  it('survives a throwing localStorage', () => { /* getItem throws */ expect(() => runBootHead()).not.toThrow(); expect(html.lang).toBe('en'); }); // Review Focus 1
  it('system theme follows prefers-color-scheme', () => { /* matchMedia dark=true */ expect(html.style.colorScheme).toBe('dark'); });
  it('centres on the hashed sticker', () => { /* #dark, 390x844 */ expect(window.__boot).toEqual(viewTransformFor({ x: cx, y: cy }, 1, { w: 390, h: 844 })); });
  it('unknown hash leaves the default centred view', () => { /* #nope */ expect(window.__boot).toEqual({ x: (390 - 3000) / 2, y: (844 - 3000) / 2, scale: 1 }); }); // Review Focus 2
  it('inline scripts stay small', async () => { expect(gzipBytes(await bundleInline('boot-head'))).toBeLessThanOrEqual(600); expect(gzipBytes(await bundleInline('boot-view'))).toBeLessThanOrEqual(1500); });
  // appState.test.ts
  it('select pushes #slug and closing pushes the bare path', ...); it('initFromHash ignores unknown slugs', ...); it('setLanguage persists and sets lang', ...);
  ```
  Run: `npx vitest run src/lib src/inline` Expected: FAIL.
- [ ] **Step 2: Implement.** Run the tests; Expected: PASS.
- [ ] **Step 3: Commit** `feat: add app state, theme and inline boot scripts`.

### Task 1.5: Build-time MDX pipeline

**Files:**
- Create: `src/lib/mdx/{compile.ts,provider.tsx,vite-plugin.ts}`, `src/lib/mdx/compile.test.ts`
- Move: `src/app/components/{Typography,PlusCodeMap,PlusCodeMapInner}.tsx` → `src/components/mdx/` (via `git mv`)
- Create: `src/lib/theme-hook.ts` (`useTheme(): { theme: ThemeChoice; resolvedTheme: 'light'|'dark'; setTheme(t: ThemeChoice): void }` over `appStore` with `useSyncExternalStore`; server snapshot is `system`)

**Interfaces:**
- `compileMdx(source: string, opts?: { markLive?: boolean }): Promise<{ code: string; liveExprs: string[] }>`: `@mdx-js/mdx` `compile` with `outputFormat: 'program'`, `providerImportSource: '#mdx-provider'`, `remarkPlugins: [remarkGfm]`, `jsxImportSource: 'react'`. `_provideComponents` in authored MDX resolves to the provider's `useMDXComponents`.
- `provider.tsx` exports `useMDXComponents(): Record<string, unknown>` returning `{ React, Button, Link (a plain anchor), h1..h4, p, blockquote, ul, code, pre, a, Abbr, Lead, Large, Muted, Small, useTheme, PlusCodeMap, CanIUse, BaselineStatus }`. `PlusCodeMap`, `CanIUse` and `BaselineStatus` are `React.lazy` so Leaflet and the web component stay out of description chunks.
- Vite plugin `stickerMdx()` provides `virtual:sticker-mdx`:
  ```ts
  type Loader = () => Promise<{ default: React.ComponentType<Record<string, never>>; __liveExprs?: string[] }>;
  export const description: Record<string, Partial<Record<Lang, Loader>>>;
  export const content: Record<string, Partial<Record<Lang, Loader>>>;
  ```
  Each (slug, language) is its own dynamic-import module, so each becomes its own lazy chunk. Register the plugin in `astro.config.mjs` and `vitest.config.ts`; add a `.d.ts` for the virtual module.

- [ ] **Step 1: Failing tests** `compile.test.ts`
  ```ts
  import { renderToStaticMarkup } from 'react-dom/server';
  import { description } from 'virtual:sticker-mdx';
  it('renders dark/en including <Button> inside an exported function', async () => {
    const { default: C } = await description['dark'].en!();
    const html = renderToStaticMarkup(React.createElement(C));
    expect(html).toContain('Try out dark mode'); expect(html).toContain('<button');
  });
  it('compiles every description in every language', async () => {
    for (const [slug, langs] of Object.entries(description)) for (const load of Object.values(langs)) await expect(load!()).resolves.toBeDefined();
  });
  it('supports GFM', async () => { expect((await compileMdx('~~x~~')).code).toContain('del'); });
  it('lazy components do not load at import time', async () => { /* import map.yaml en description; assert leaflet was not imported */ });
  ```
  Run: `npx vitest run src/lib/mdx` Expected: FAIL.
- [ ] **Step 2: Implement** compile, provider, theme hook and plugin. Run; Expected: PASS.
- [ ] **Step 3: Commit** `feat: compile sticker MDX at build time`.

### Task 1.6: Live-sticker classification and content prerender

**Files:**
- Create: `src/lib/mdx/{recma-live.ts,prerender.ts}`, `src/lib/mdx/live.test.ts`
- Modify: `src/lib/mdx/compile.ts` (honour `markLive`), `src/inline/boot-view.ts` (the fill)

**Interfaces:**
- `recma-live.ts`: a recma plugin used only when `markLive` is set. It wraps every JSX child expression container whose source references the identifier `Date` in `<span data-live="i">{expr}</span>`, records the plain-JS source of each expression, and exports `__liveExprs: string[]`. It throws unless the expression's free identifiers are within `Date, Intl, Math, Number, String, Array, Object`.
- `prerender.ts`:
  ```ts
  export type LiveKind = 'static' | 'date' | 'interactive';
  export interface Prerendered { html: string; kind: LiveKind; exprs: string[] }
  export function prerenderContent(slug: string, lang: Lang): Promise<Prerendered>;
  export function prerenderContentFrom(mdxSource: string): Promise<Prerendered>; // same classification for an ad-hoc source (tests); prerenderContent loads the sticker's source and delegates
  ```
  `kind` is `interactive` when the source calls React hooks (`React.use*` or `use(State|Effect|Layout|Ref|Memo)`); else `date` when rendering with a mocked `Date` at `2020-01-01T00:00:00Z` and at `2031-12-31T23:59:59Z` gives different HTML; else `static`. If the two renders differ but `exprs` is empty, throw a build error naming the sticker and language (the author must put the date use in a plain `{…}` expression).
- Inline fill (in `boot-view`): for each `[data-live]` node, evaluate `new Function('return (' + expr + ')')()`, set `textContent`, set `data-filled`. The expression table is emitted by the page as `<script type="application/json" id="live-exprs">{"slug":{"lang":["expr",…]}}</script>`. CSS `[data-live]:not([data-filled]){visibility:hidden}` guarantees no stale frame.

- [ ] **Step 1: Failing tests**
  ```ts
  it('static content has no live nodes', async () => { expect((await prerenderContentFrom('<div>hello</div>')).kind).toBe('static'); });
  it('date expression is wrapped and extracted', async () => {
    const r = await prerenderContentFrom('<div>{new Date().getFullYear()}</div>');
    expect(r.kind).toBe('date'); expect(r.exprs).toEqual(['new Date().getFullYear()']); expect(r.html).toContain('data-live="0"'); });
  it('rejects a runtime difference it cannot extract', async () => {
    await expect(prerenderContentFrom('export const y = new Date().getFullYear()\n\n<div>{y}</div>')).rejects.toThrow(/live/i); });
  it('hooks classify as interactive', async () => { expect((await prerenderContent('test-1', 'en')).kind).toBe('interactive'); });
  it('the real stickers classify as expected', async () => {
    // loop `prerenderContent(slug, 'en')` over the slugs that have `content`
    expect(kinds).toEqual(/* verify against the data, then pin: dd-mmm-yyyy: date, yyyy-mm-dd: date, test-1: interactive, the other five: static */);
  });
  ```
  The last assertion is pinned from the actual run; if the real classification differs from the spec's list, report the difference to the owner rather than forcing it.
  Run: `npx vitest run src/lib/mdx/live.test.ts` Expected: FAIL.
- [ ] **Step 2: Implement** and add a jsdom test that the fill sets text and `data-filled` (extend `boot.test.ts`). Run `npx vitest run`; Expected: PASS.
- [ ] **Step 3: Commit** `feat: classify and prerender live stickers`.

### Task 1.7: Prerendered page

**Files:**
- Create: `src/pages/index.astro`, `src/components/Sticker.astro`, `src/styles/global.css`, `src/lib/lang-css.ts`, `src/lib/lang-css.test.ts`, `tests/e2e/first-paint.spec.ts`

**Interfaces:**
- DOM contract (every later task and the test `contract.ts` relies on it):
  - `#canvasWrapper` is the viewer root (`touch-action: none; overflow: hidden`), `#canvas` the 3000×3000 layer (`transform-origin: 0 0`, class `bg-grid-png`, dark variant under `.dark`).
  - One `button.sticker` per sticker in slug order with `data-slug`, `data-cx`, `data-cy`, `data-titles` (JSON of the title map) and `data-has` (space-separated languages present in `content`). Style: `left/top/width/height` from `stickerBox`, `rotate`, `content-visibility: auto; contain-intrinsic-size`, and the baseline shadow `filter: drop-shadow(0 4px 3px rgb(0 0 0 / .07)) drop-shadow(0 2px 2px rgb(0 0 0 / .06))` (Tailwind `drop-shadow-md`). Shadows stay as baseline until Milestone 2.
  - Inside: `span.clip` (the `clip-path`, the hover target, `cursor: pointer` under `@media (hover: hover)`) containing `<img width height decoding="async" loading="eager" fetchpriority alt="">` and per-language `div[data-l="<lang>"]` content variants (the fallback variant also carries `data-fb`); plus visually hidden `span[data-l]` title variants (the button's accessible name).
  - Zero-area stickers (`test-1`, `width: 0`) render with `tabindex="-1"` and `aria-hidden="true"`.
  - `#controls` holds `button[data-action="zoom-in"|"zoom-out"|"center"]` (aria-labelled) and the two menu triggers; `main.ts` (Task 1.10) wires `data-action` so zoom works without React.
  - Hover: `@media (hover: hover){ .sticker:has(.clip:hover){ scale: 1.1 } }` with `transition: scale 100ms`.
- `lang-css.ts`: `variantCss(langs: readonly Lang[]): string` emits, per language `L`: `html[lang="L"] [data-has~="L"] > [data-l]:not([data-l="L"]){display:none}` and `html[lang="L"] :not([data-has~="L"]) > [data-l]:not([data-fb]){display:none}`.
- `index.astro`: inline `boot-head` in `<head>`; `boot-view` plus the live-expression table immediately after `#canvas`; Inter via `@fontsource-variable/inter` (preload the Latin file, `font-display: swap`; the CSS `font-family` becomes `"Inter Variable"` with the same `font-feature-settings`), Geist and CC Symbols local, Noto Sans SC/JP via fontsource variable packages (unicode-range slices load only when needed); keep the `:lang()` body font rules. No request to `rsms.me` or `cdnjs`. Drop cc-icons if the built HTML and all descriptions contain no `cc-` class (a repo-wide grep found none in the YAML); otherwise load it lazily in the Sheet island.
- Image priority: `fetchpriority="high"` when `isInitialViewport(sticker)`, otherwise `fetchpriority="low"`; never `loading="lazy"` (it would pop in during pan).

- [ ] **Step 1: Failing tests**
  ```ts
  // lang-css.test.ts
  expect(variantCss(['en','ja'])).toContain('html[lang="ja"] [data-has~="ja"] > [data-l]:not([data-l="ja"])');
  // first-paint.spec.ts (chromium-desktop, webkit-mobile, firefox-desktop)
  test('no-JS: all 63 stickers painted at baseline positions', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false }); // Review Focus 5
    /* each button.sticker rect matches tests/fixtures/placement.json within 1px; each img decoded; no [data-live] visible */ });
  test('zero-area sticker is out of the tab order', /* test-1: tabindex -1, aria-hidden */);
  test('language fallback with no JS framework', /* set html lang=ja: bad-translations shows its ja variant; a sticker lacking ja shows en */);
  test('no third-party CSS or fonts', /* no request to rsms.me or cdnjs */);
  test('no layout shift', /* CLS observed after load === 0 */);
  test('live nodes never show a stale value', /* rAF sampler from document start: whenever a [data-live] is visibility:visible its text equals today's formatted date */);
  test('first frame uses the saved theme', /* localStorage theme=dark via addInitScript: <html>.dark and colorScheme set at the first rAF */);
  ```
  Run: `$env:TARGET='new'; $env:STATIC_DIR='dist'; npm run build; npx playwright test tests/e2e/first-paint.spec.ts --project=chromium-desktop` Expected: FAIL.
- [ ] **Step 2: Implement** the page, the `Sticker` component and CSS.
- [ ] **Step 3: Run the same spec on `webkit-mobile` and `firefox-desktop`.** Expected: PASS on all three.
- [ ] **Step 4: Commit** `feat: prerender the sticker sheet at build time`.

### Task 1.8: Asset pipeline

**Files:**
- Create: `scripts/optimize-assets.ts`, `scripts/optimize-assets.test.ts`, `docs/superpowers/decisions/assets.md`
- Modify: `public/stickers/*` (in place), `src/components/Sticker.astro`, `package.json` (`optimize-assets`)

**Interfaces:**
- `npm run optimize-assets` is idempotent. For each `public/stickers/*.svg` except `Bitmap.svg` and `logo.svg` it runs SVGO losslessly (`multipass`, keep `viewBox`, no ID or attribute removal that changes rendering) and re-encodes embedded raster data URIs (`karaoke`, `double-lariat`) as visually lossless WebP. For each `*.png` it writes a sibling `*.webp` (same pixel size, visually lossless). SVGs stay SVG.
- It renders original and optimised versions in Chromium at 1× and 2× and compares with `pixelmatch`; it writes nothing for a file whose difference exceeds 0.05% of pixels at per-pixel threshold 0.1.
- `Sticker.astro` emits `<picture><source type="image/webp" srcset="x.webp"><img src="x.png"></picture>` when a sibling `.webp` exists at build time. The YAML `image:` field is unchanged.
- `export function webpSibling(imagePath: string, existing: ReadonlySet<string>): string | null` (pure, used by the component).

- [ ] **Step 1: Failing test** `scripts/optimize-assets.test.ts`
  ```ts
  expect(webpSibling('/stickers/yurucom.png', new Set(['/stickers/yurucom.webp']))).toBe('/stickers/yurucom.webp');
  expect(webpSibling('/stickers/gif.svg', new Set(['/stickers/gif.svg']))).toBeNull();
  ```
  Run: `npx vitest run scripts` Expected: FAIL, then PASS after implementing.
- [ ] **Step 2: Run the optimiser** `npm run optimize-assets`; record before and after bytes (total and per file) in `assets.md`. Spot-check the four embedded-raster SVGs and `sui-dau.png` visually via saved screenshots.
- [ ] **Step 3: Rebuild and rerun** `tests/e2e/first-paint.spec.ts` and `tests/visual` against `dist` (tolerance `maxDiffPixelRatio: 0.01` for the new target); Expected: PASS.
- [ ] **Step 4: Commit** `perf: optimise sticker assets and serve WebP where available`.

### Task 1.9: Gesture controller math

**Files:**
- Create: `src/viewer/math.ts`, `src/viewer/math.test.ts`

**Interfaces:**
- ```ts
  export const MIN_SCALE = 0.1, MAX_SCALE = 5;
  export interface Size { w: number; h: number }
  export function boundsFor(viewport: Size, content: Size, scale: number): { minX: number; maxX: number; minY: number; maxY: number };
  export function clampTransform(t: Transform, viewport: Size, content: Size): Transform; // clamps scale to [MIN,MAX] then position to bounds
  export function zoomAt(t: Transform, anchor: { x: number; y: number }, nextScale: number): Transform; // keeps the anchor fixed
  export function centerTransform(viewport: Size, content: Size, scale: number): Transform;
  export function wheelScale(scale: number, deltaY: number, ctrlKey: boolean): number; // parity with rzpp-defaults.md
  export function inertia(velocity: { x: number; y: number }, dtMs: number): { dx: number; dy: number; done: boolean };
  ```
  `boundsFor` and `inertia` follow `docs/superpowers/baseline/rzpp-defaults.md`.

- [ ] **Step 1: Failing tests**
  ```ts
  expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 100 }, 2)).toEqual({ x: -100, y: -100, scale: 2 });
  expect(clampTransform({ x: 9999, y: 9999, scale: 1 }, VIEW, CONTENT).x).toBe(boundsFor(VIEW, CONTENT, 1).maxX);
  expect(clampTransform({ x: 0, y: 0, scale: 50 }, VIEW, CONTENT).scale).toBe(5);
  expect(clampTransform({ x: 0, y: 0, scale: 0.001 }, VIEW, CONTENT).scale).toBe(0.1);
  // bounds probes recorded in Task 0.2
  for (const probe of boundsProbes) expect(clampTransform({ x: probe.push[0], y: probe.push[1], scale: probe.scale }, probe.viewport, CONTENT)).toMatchObject(probe.expected);
  // zoomAt is a no-op for an unchanged scale; inertia eventually reports done
  ```
  Run: `npx vitest run src/viewer/math.test.ts` Expected: FAIL.
- [ ] **Step 2: Implement** with no DOM access. Run; Expected: PASS.
- [ ] **Step 3: Commit** `feat: add viewer transform math`.

### Task 1.10: Gesture controller (DOM binding) and entry

**Files:**
- Create: `src/viewer/{controller.ts,main.ts}`, `tests/e2e/gestures.spec.ts`
- Modify: `src/pages/index.astro` (load `main.ts` as a module script)

**Interfaces:**
- ```ts
  export interface Controller {
    readonly transform: Transform;
    setTransform(t: Transform, opts?: { animateMs?: number }): void; // clamped; default animation per rzpp-defaults.md for programmatic moves
    zoomBy(factor: number, anchor?: { x: number; y: number }): void;
    center(): void;
    onGestureStart(fn: () => void): () => void;
    onChange(fn: (t: Transform) => void): () => void; // at most once per animation frame
    onSettle(fn: (t: Transform) => void): () => void; // gesture and inertia idle for 100 ms
    resize(): void; // recompute bounds
    dispose(): void;
  }
  export function createController(root: HTMLElement, layer: HTMLElement, opts: { content: Size; initial?: Transform }): Controller;
  ```
  The controller writes only `layer.style.transform = translate3d(x,y,0) scale(s)` per frame, sets `root.dataset.gesture = 'pan' | 'zoom'` while active (CSS keys off it, replacing the old `panning`/`zooming` classes), caches viewport size (`ResizeObserver`, no layout reads per frame), starts from `window.__boot`, uses `touch-action: none`, pointer capture while dragging, `ctrlKey` wheel as pinch, `gesturestart` `preventDefault` (Safari), and exposes itself as `window.__viewer` for tests. After a drag of ≥ 10 px in either axis it swallows the next `click` (capture phase). A second pointer down turns the gesture into a pinch and cancels the pending tap.
- `main.ts` creates the controller, wires `[data-action]` buttons, and exports nothing else yet.

- [ ] **Step 1: Failing e2e** `gestures.spec.ts` (chromium-desktop, chromium-mobile, webkit-mobile)
  ```ts
  test('replays the baseline goldens', async ({ page }) => {
    for (const e of goldens(profile)) { await replay(page, e.ops); await settled(page);
      expect(await readTransform(page)).toMatchObject({ x: closeTo(e.expected.x, 1), y: closeTo(e.expected.y, 1), scale: closeTo(e.expected.scale, 0.01) }); } });
  test('one transform write per frame', /* 60 wheel events inside one frame => window.__viewer write counter +1 */);
  test('data-gesture is set while active and cleared after settle', ...);
  test('drag of 40px starting on a sticker does not open the sheet; a 3px tap does', ...); // Review Focus 4
  test('second finger down on a sticker cancels the tap and keeps pinching', /* chromium-mobile, CDP touch */); // Review Focus 4
  test('resize re-clamps the transform', /* setViewportSize smaller after panning to an edge: transform inside new bounds */); // Review Focus 3
  ```
  Run: `$env:TARGET='new'; $env:STATIC_DIR='dist'; npm run build; npx playwright test tests/e2e/gestures.spec.ts --project=chromium-desktop` Expected: FAIL.
- [ ] **Step 2: Implement** the controller and `main.ts`. Iterate until the goldens match; if a golden cannot be matched within tolerance, adjust constants from `rzpp-defaults.md`, not the tolerance.
- [ ] **Step 3: Run on all three projects.** Pinch on WebKit is not automatable; note it for the device checklist (Task 2.4).
- [ ] **Step 4: Commit** `feat: add framework-free gesture controller`.

### Task 1.11: Interactions: tooltip, selection, hash anchors

**Files:**
- Create: `src/viewer/{interactions.ts,prefetch.ts}`, `tests/e2e/interactions.spec.ts`
- Modify: `src/viewer/main.ts`, `src/styles/global.css` (tooltip styles from the shadcn tooltip: `bg-primary text-primary-foreground`, rounded, `text-xs`)

**Interfaces:**
- `prefetch.ts`: `prefetchDescription(slug: string, lang: Lang): void`. It does `import('virtual:sticker-mdx')` and calls `description[slug]?.[lang]?.()` once per (slug, lang), swallowing errors (a failed prefetch must never surface; the Sheet reports its own failure). `interactions.ts` calls it on the first `mouseover` or `focusin` of a sticker, and `main.ts` prefetches the saved language's `description` for the stickers in `isInitialViewport` from `requestIdleCallback` (fallback `setTimeout 2000`), so opening a visible sticker rarely waits. Spec: "prefetched on hover or idle".
- `initInteractions(ctx: { canvas: HTMLElement; controller: Controller; slugs: ReadonlySet<string> }): () => void`. One delegated listener set on `#canvas` (no per-sticker listeners): `mouseover`/`mouseout` on `.clip` (the browser's own `clip-path` hit-testing decides the target) drives one `div#tip[role="tooltip"]`, repositioned in `requestAnimationFrame` from `pointermove`: left edge at the cursor X, bottom edge 10 px above the cursor Y, clamped inside the viewport; text is `localize(JSON.parse(btn.dataset.titles), lang)`; hidden when `matchMedia('(pointer: coarse)').matches`. Click on `.clip` (after the controller's suppression) or `click` with `detail === 0` on the button (keyboard) calls `select(slug, { push: true })` and re-centres with `controller.setTransform(viewTransformFor(stickerCenter, controller.transform.scale, viewport))`. `hashchange` and `popstate` call `initFromHash`-style selection without pushing; unknown slugs are ignored. On load with a valid `#slug` it selects without pushing.

- [ ] **Step 1: Failing e2e**
  ```ts
  test('tooltip follows the cursor and shows the localised title', /* hover dd-mmm-yyyy at fixed point: tip.left≈clientX (±2), tip.bottom≈clientY-10 (±2); set lang ja: text changes */);
  test('hover only inside the clipped region scales the sticker', /* circle sticker 'dark': pointer in the clipped-out corner => scale 1; inside => 1.1 */);
  test('coarse pointer shows no tooltip', /* chromium-mobile */);
  test('click selects, #slug is pushed, close clears it', ...);
  test('keyboard: focus a sticker, Enter and Space each open it', ...);
  test('hovering a sticker requests its description chunk before any click', /* network log: the chunk request precedes the click; repeat hover requests nothing new */);
  test('deep link #dark centres before first paint', /* transform at first rAF equals viewTransformFor(...) */);
  test('#nope and # do nothing', /* default centre, no sheet, no console error */); // Review Focus 2
  test('back/forward walk selection history', /* select dark, close, back => dark open; forward => closed */); // Review Focus 2
  test('selecting re-centres at the current zoom', ...);
  ```
  Run: `npx playwright test tests/e2e/interactions.spec.ts --project=chromium-desktop` Expected: FAIL.
- [ ] **Step 2: Implement.** Selection state goes through `appStore` only; the Sheet island (Task 1.13) subscribes to it.
- [ ] **Step 3: Run on `chromium-mobile` and `firefox-desktop`.** Expected: PASS.
- [ ] **Step 4: Commit** `feat: add tooltip, selection and hash anchors`.

### Task 1.12: Controls island

**Files:**
- Create: `src/islands/Controls.tsx`, `tests/e2e/controls.spec.ts`
- Modify: `src/pages/index.astro` (`<Controls client:idle />`), `src/components/ui/{tooltip,dropdown-menu,button}.tsx` (remove the `@/lib/i18n` import; take strings from `ui-strings` and `appStore`)

**Interfaces:** Renders the same bar as the old `Controls.tsx` (theme menu light/dark/system, language radio menu English/简体中文/日本語, zoom in/out, centre), server-rendered by Astro so the markup exists before hydration, hydrated at idle. Menus call `setTheme`/`setLanguage`. Zoom and centre buttons keep `data-action` and work through `main.ts` even if the island never loads.

- [ ] **Step 1: Failing e2e**
  ```ts
  test('language menu switches stickers, UI strings and persists', /* choose 日本語: html lang=ja, localStorage.language=ja, a ja variant visible, tooltip text localised */);
  test('theme menu sets class and color-scheme and persists', /* dark; then system with emulated colorScheme light/dark updates live */);
  test('menus work from the keyboard', /* Tab, Enter, Arrow, Enter */);
  test('zoom buttons work when the Controls chunk is blocked', /* page.route aborts the Controls chunk; click Zoom in => scale grows */); // Review Focus 5
  test('invalid saved preferences fall back cleanly', /* storage language=fr, theme=blue: en + system, no console error */); // Review Focus 1
  ```
  Run: `npx playwright test tests/e2e/controls.spec.ts --project=chromium-desktop` Expected: FAIL.
- [ ] **Step 2: Implement.** Run on `chromium-mobile` and `firefox-desktop`; Expected: PASS.
- [ ] **Step 3: Commit** `feat: add lazy controls island`.

### Task 1.13: Sheet island

**Files:**
- Create: `src/islands/Sheet.tsx`, `src/viewer/deeplink.ts`, `tests/e2e/sheet.spec.ts`
- Modify: `src/pages/index.astro` (`<Sheet client:idle />`; `deeplink.ts` as a plain `<script type="module">` in `<head>`, which is deferred by default so the DOM is parsed when it runs), `src/styles/global.css` (Silk styles via `@silk-hq/components/unlayered-styles`)

**Interfaces:**
- `Sheet.tsx` subscribes to `appStore.selectedSlug` and `language`; presented when a slug is selected. Narrow viewport (`matchMedia('(max-width: 4096px)')`): `Sheet.View contentPlacement="bottom"` with `detents={[`${SHEET_PEEK_PX}px`]}` exactly as the baseline does (Silk appends a content-size detent, so there are two stops) and `Sheet.Content` height `SHEET_EXPANDED`; `activeDetent` is controlled with 1 = peek, 2 = expanded, 0 = closed (see `docs/superpowers/baseline/sheet-behaviour.md`); the handle `button[aria-label="Toggle panel size"]` steps with Silk's own step action (not index arithmetic); `Scroll.View scrollGesture` is on only at the expanded stop, and a wheel at peek is left to Silk, which expands the sheet as in the baseline. Wide viewport: `contentPlacement="left"`, `detents={[`${PANEL_WIDTH}px`]}`. Title, close button and the sticker preview (image, or `content[slug][lang]()` rendered with React so interactive content works) behave as in the old `Panel.tsx`. The description loads with `description[slug][lang]()` inside `Suspense` and an error boundary that leaves the title and an empty body on failure. Changing language while open reloads the description for the new language. Closing calls `select(null, { push: true })`.
- `deeplink.ts` (< 1 KB gzip, so it must not statically import the description map): if `location.hash` names an existing `button.sticker[data-slug]`, immediately start the dynamic import of the Sheet chunk and call `prefetchDescription(slug, lang)` (Task 1.11), so the sheet opens without waiting. (This replaces the spec's "head script preloads the chunk": chunk names are hashed and unknown at HTML render time. The effect is the same; note it in the decision log.)
- The sheet is never part of first paint, even on `#slug`.

- [ ] **Step 1: Failing e2e** (`chromium-mobile` 390×844 unless stated; expected numbers also match `sheet-behaviour.json`)
  ```ts
  test('peek stop is 231px and content does not scroll in place', /* open #css: sheet height 231±2; wheel over content => content scrollTop stays 0 (the sheet itself expands, as in the baseline) */);
  test('handle toggles to expanded and back', /* height 844-48=796±2 and scrollTop increases after wheel; click again => 231 */);
  test('dragging the sheet below peek dismisses it', /* selectedSlug null, hash cleared */);
  test('wide viewport shows a 320px left panel and offsets centring', /* 4100x1000: panel width 320, sticker centre x ≈ 320 + (4100-320)/2 */); // Review Focus 3
  test('crossing 4096px swaps the stop set', /* resize 4096 -> 4097 with the sheet open */); // Review Focus 3
  test('dragging inside the sheet does not move the canvas', ...); // Review Focus 4
  test('language change while open updates title and description', ...);
  test('failed description chunk shows the title only', /* route abort on the chunk; no pageerror */); // Review Focus 5
  test('deep link opens the sheet without waiting for idle', /* /#dark: sheet presented, first paint had no sheet */);
  ```
  Run: `npx playwright test tests/e2e/sheet.spec.ts --project=chromium-mobile` Expected: FAIL.
- [ ] **Step 2: Implement.** Confirm Silk's detent indexing against its types (see Task 0.3) rather than assuming.
- [ ] **Step 3: Run `webkit-mobile` and `firefox-desktop`.** Expected: PASS.
- [ ] **Step 4: Commit** `feat: add lazy bottom-sheet island with two stops`.

### Task 1.14: Milestone 1 exit

**Files:**
- Create: `docs/superpowers/decisions/002-m1-numbers.md`
- Modify: `README.md` (architecture, authoring, commands, how to run baseline vs new benches)

- [ ] **Step 1: Run everything.** `npm test; npm run build; $env:TARGET='new'; $env:STATIC_DIR='dist'; npx playwright test tests/e2e --project=chromium-desktop; ...` for each project. Expected: PASS.
- [ ] **Step 2: Payload check.** From the first-render bench, assert no Silk, Radix, Leaflet, React DOM or `baseline-status` bytes appear in critical-path JS (`criticalPathJsGzip` ≤ 100 KB, expected far lower).
- [ ] **Step 3: Benchmark** (`BENCH=1`, mobile and desktop, 5 runs) against `bench/results/baseline-*.json`; write the comparison and any missed budget in `002-m1-numbers.md`.
- [ ] **Step 4: Visual comparison** `npx playwright test tests/visual --project=chromium-desktop` with `maxDiffPixelRatio: 0.02`; investigate every diff (shadow, font, pattern) and record accepted ones.
- [ ] **Step 5: Commit** `docs: record milestone 1 results`.

---

### Task 1.15: Input readiness under bandwidth contention

Added by controller ruling after the Task 1.14 benchmark. On the mobile profile the page paints at about 0.8 s, but the eager viewer graph (`main` + `appState` + `preload-helper`, about 8 KB gzip, requested at about 270 ms) only finishes at about 2.3 s, because it shares Fast 4G with about 55 sticker images (2.3 MB). Pan, zoom, tooltips and clicks are dead until then, and the islands hydrate at about 2.7 s. The baseline's first sticker appears at 2.04 s and it is interactive on hydration, so the new build is not better than the baseline on time to input. That defeats the point of a fast first render.

**Files:**
- Create: `docs/superpowers/decisions/002-m1-numbers.md` gains a "Input readiness" section (append; do not rewrite earlier sections)
- Modify: `bench/first-render.bench.ts` (+ `bench/results.ts`, `bench/summarize.ts`, `bench/metrics.ts` if needed) for the new `inputReadyMs` metric; whichever of `src/pages/index.astro`, `src/components/Sticker.astro`, `src/lib/*`, `scripts/*` the chosen fix needs; `tests/e2e/first-paint.spec.ts`

**Interfaces:**
- `inputReadyMs`: the first time the viewer can handle input, taken from the earliest signal the build already exposes (`window.__viewer` defined with its controller wired and `data-action` / pointer listeners attached; the implementer picks and documents the exact signal). Recorded per run by the first-render bench, summarised as median/p95 beside LCP, TBT and `allStickersPaintedMs`, and written to the run JSON.
- Budget: `inputReadyMs` ≤ 1.5 s on the mobile profile (the same line as LCP). LCP stays ≤ 1.38 s, CLS stays 0.
- Candidate levers, applied and measured one at a time (not all at once), from cheapest to riskiest: (a) `<link rel="modulepreload">` with `fetchpriority="high"` for the eager viewer graph, in the head; (b) `fetchpriority="low"` and `decoding="async"` on sticker `<img>`s that are outside the initial viewport (decide how "outside" is computed at build time, for example by distance from the canvas centre against the smallest supported viewport, and say what happens for a viewport that is larger); (c) `loading="lazy"` for far stickers (risk: pop-in while panning; only keep if a pan test and `allStickersPaintedMs` show none); (d) anything the trace shows, such as font priority. The deep-link path and the Sheet chunk keep their current priority.
- Decision rule: a lever is adopted if mobile `inputReadyMs` improves by at least 50 % (median of 5 runs) AND LCP does not regress by more than 10 % (and stays ≤ 1.38 s) AND `allStickersPaintedMs` does not regress by more than 15 % AND desktop LCP does not regress by more than 10 % AND the visual `initial` scenes still pass at `VISUAL_MAX_DIFF=0.01`. If no lever meets the rule, record the numbers and the best partial result in 002 and say what Milestone 2 should try.

- [ ] **Step 1: Failing test and metric.** Add `inputReadyMs` to the first-render bench (with a unit test for any new pure helper in `bench/metrics.ts`). Run the mobile bench (5 runs) on the current build to record the 'before' number, and confirm it is at or near the 2.3 s the Task 1.14 report describes. Add a structural e2e test in `tests/e2e/first-paint.spec.ts` for the chosen lever (for example: the built HTML has the modulepreload link with `fetchpriority="high"`, or the far stickers' `<img>` carry `fetchpriority="low"` and the near ones do not). It must fail before the fix.
- [ ] **Step 2: Isolate the cause.** Run an A/B on the mobile profile (3 to 5 runs per arm, alternating, `BENCH_LABEL`/`BENCH_PROBE_*` style like the baseline's third-party-CSS A/B): sticker image requests fulfilled with empty bodies versus normal. Record the entry's request start, end and `inputReadyMs` per run. This confirms or refutes "images starve the entry" before any fix is written. If refuted, write down the real cause (for example HTTP/1.1 connection queueing in `serve`, or the font fetches) and choose levers accordingly.
- [ ] **Step 3: Apply levers one at a time** per the decision rule; run the mobile and desktop first-render bench (5 runs) after each; keep the winners only. Re-run the e2e matrix (`chromium-desktop`, `chromium-mobile`, `webkit-mobile`, `firefox-desktop`) and the visual scenes at 0.01.
- [ ] **Step 4: Record** the per-lever table, the A/B, the winner(s), and the new mobile numbers in the new section of `002-m1-numbers.md`, and update its Milestone-2 ranking (remove or demote the readiness item if it is fixed).
- [ ] **Step 5: Commit** `perf: prioritise the viewer entry over sticker images`.

---

## Milestone 2: Pathway A tuned by trace

### Task 2.1: Variant switches and settle strategies

**Files:**
- Create: `src/viewer/{settle.ts,variants.ts,settle.test.ts}`
- Modify: `src/viewer/main.ts`, `src/styles/global.css`

**Interfaces:**
- ```ts
  export interface SettleCtx { root: HTMLElement; layer: HTMLElement; transform: Transform }
  export interface SettleStrategy { name: string; onGestureStart(c: SettleCtx): void; onChange?(c: SettleCtx): void; onSettle(c: SettleCtx): void }
  export const settleStrategies: Record<'drop-will-change' | 'retoggle-on-scale-change' | 'none', SettleStrategy>;
  ```
  `drop-will-change` reproduces the old behaviour (`will-change: transform` on at the first change, removed 100 ms after the last). `retoggle-on-scale-change` drops it only when the scale differs from the last rastered scale. `none` never sets it.
- `variants.ts` reads `?v=shadow:s0,settle:none,cull:cv,bg:png` (all builds during Milestone 2) and sets `html[data-v-<factor>]`; CSS selectors key on those attributes. Defaults equal the current behaviour (`s0`, `drop-will-change`, `cv` = `content-visibility: auto`, `png`).

- [ ] **Step 1: Failing unit tests** (fake `layer.style`, fake timers)
  ```ts
  s.onGestureStart(c); expect(layer.style.willChange).toBe('transform');
  s.onSettle(c); expect(layer.style.willChange).toBe('');
  // retoggle-on-scale-change: pan-only gesture leaves willChange untouched at settle; scale change clears it
  ```
  Run: `npx vitest run src/viewer/settle.test.ts` Expected: FAIL.
- [ ] **Step 2: Implement** and wire `main.ts` (`controller.onGestureStart/onSettle`). Run; Expected: PASS.
- [ ] **Step 3: Commit** `feat: add settle strategies and variant switches`.

### Task 2.2: Shadow candidates

**Files:**
- Create: `scripts/gen-shadows.ts`, `scripts/gen-shadows.test.ts`, `public/shadows/*.webp`, `src/data/shadows.json`
- Modify: `src/components/Sticker.astro`, `src/styles/global.css`, `package.json` (`shadows`)

**Interfaces:**
- S2 (`box-shadow`, unclipped stickers only, 30 of them): `0 4px 6px rgb(0 0 0/.07), 0 2px 4px rgb(0 0 0/.06)`. A `box-shadow` blur radius is twice the equivalent `drop-shadow` deviation, so the blur values double; confirm by pixel diff against S0 in Task 2.3.
- S3: `filter: drop-shadow(...)` kept on chosen stickers only.
- S1: `npm run shadows` renders each image sticker's button in Chromium at DPR 2 on a transparent page with `filter: url(#shadow-only)`, an SVG filter that reproduces the two `drop-shadow-md` layers without merging `SourceGraphic`, so the output is the shadow alone, silhouette and clip-path included. It crops to box plus padding and writes `public/shadows/<slug>.webp` and `src/data/shadows.json` as `Record<slug, { pad: number; hash: string }>` where `hash` covers the image bytes, clip-path, size and generator version. The sprite renders as a `::before` inside the same rotated, hover-scaled button, so it follows rotation and the 1.1× hover. Sprites are committed; `shadowsAreStale(): string[]` (pure, compares hashes) lets a unit test fail when they drift, with no browser in CI. `spriteHash(s: StickerRecord): string` is the pure hash function.

- [ ] **Step 1: Failing test**
  ```ts
  expect(shadowsAreStale()).toEqual([]); // fails while sprites are missing
  expect(spriteHash(stickerA)).not.toBe(spriteHash({ ...stickerA, clipPath: 'circle(40%)' }));
  ```
  Run: `npx vitest run scripts/gen-shadows.test.ts` Expected: FAIL.
- [ ] **Step 2: Implement the generator and the S1/S2/S3 CSS** behind `data-v-shadow`. Run `npm run shadows`; rerun the test; Expected: PASS.
- [ ] **Step 3: Commit** `feat: add shadow variants and sprite generator`.

### Task 2.3: Tuning matrix and decision

**Files:**
- Create: `tests/e2e/settle-crisp.spec.ts`, `docs/superpowers/decisions/003-pathway-a-tuning.md`
- Modify: whatever removes the losing variants and the `?v=` plumbing

**Interfaces:** One-factor-at-a-time matrix from the defaults. Factors: shadow `s0 | s1 | s2+s3`, settle `drop-will-change | retoggle-on-scale-change | none`, cull `cv | none | explicit` (a pass hiding off-screen stickers at settle), background `png | gradient` (the existing `bg-grid` CSS). Metrics per variant: gesture `p95FrameMs`, `over16`, `mainBusyMs`, `crispAfterMs`, `peakHeapMb`, first-render `lcp`, plus mean absolute pixel difference of the shadow ring versus S0 (< 2/255).
**Winner rule (decided here so the result is checkable):** a variant wins a factor if it improves chromium-mobile `p95FrameMs` or `mainBusyMs` by ≥ 10 % without regressing any metric by > 5 % on `webkit-mobile` and `firefox-desktop` (run unthrottled there as a regression check only).

- [ ] **Step 1: Failing crispness test** `settle-crisp.spec.ts`
  ```ts
  test('vector sticker is crisp after a zoom settles', async ({ page }) => {
    // pick the first SVG sticker with rotation 0 and no clipPath; zoom to ~4x via wheel; wait for settle
    // reference: a blank page with the same <img> at 4x the box size, same DPR; screenshot both
    expect(pixelDiffRatio(settledShot, referenceShot)).toBeLessThan(0.02);
  });
  ```
  Run: `npx playwright test tests/e2e/settle-crisp.spec.ts --project=chromium-desktop` Expected: PASS for `drop-will-change` (it must not regress); FAIL for any variant that stays blurry.
- [ ] **Step 2: Run the matrix** (`BENCH=1`, 5 runs per variant, mobile profile). Apply the winner rule per factor.
- [ ] **Step 3: Finalise.** Keep only the winners; delete the `?v=` plumbing, loser CSS and, if S1 lost, the generator, sprites and `shadows.json`. If S1 won, the sprite also stands in as the placeholder behind a not-yet-loaded image (no separate placeholder asset unless traces show visible pop-in).
- [ ] **Step 4: Write `003-pathway-a-tuning.md`** (matrix, winners, rejected variants and why) and run `npm test; npx playwright test tests/e2e`; Expected: PASS.
- [ ] **Step 5: Commit** `perf: adopt tuned shadow, settle, culling and background strategies`.

### Task 2.4: Parity audit and budgets

**Files:**
- Create: `docs/superpowers/decisions/004-parity.md`, `docs/superpowers/decisions/manual-device-checklist.md`

- [ ] **Step 1: Full run on every engine.** `npx playwright test --project=chromium-desktop; ... chromium-mobile; webkit-mobile; firefox-desktop`. Expected: PASS everywhere.
- [ ] **Step 2: Parity table.** One row per item of the design doc's "Feature parity checklist" with the spec file and test name that proves it and its status; any gap becomes a failing test first, then a fix.
- [ ] **Step 3: Budgets.** Benchmark mobile and desktop (5 runs); record each budget as met or missed, with numbers against baseline.
- [ ] **Step 4: Device checklist.** Write the owner's manual list (iOS Safari and Android Chrome: pinch, flick inertia, sheet drag at both stops, rotate with the sheet open, language and theme switch, memory after zooming to 5×, live date stickers). It cannot be run by the agent; list it as an open item for the owner.
- [ ] **Step 5: Commit** `docs: record parity audit and Pathway A budgets`.

---

## Milestone 3: Pathway B prototype (throwaway, time-boxed)

### Task 3.1: Canvas renderer with DOM hit regions

**Files:**
- Create: `proto/canvas/{clip.ts,clip.test.ts,render.ts,entry.ts}`, `proto/vite.config.ts` (separate build, not part of the shipped site)

**Interfaces:**
- `clip.ts`: `type PathCmd = ['M', number, number] | ['L', number, number] | ['A', number, number, number, number, number, number, number] | ['Z']`; `clipToCommands(clip: string, w: number, h: number): PathCmd[] | null` for `polygon()`, `circle()`, `ellipse()` and `path()` (px and % units, reference box = the sticker box). `shape()` returns `null` and the sticker is drawn unclipped in the prototype and listed in the report.
- `render.ts`: hides the DOM `<img>` (`visibility: hidden`; buttons keep `opacity: 0` so the browser still hit-tests `clip-path`, hover and a11y), inserts one viewport-sized `<canvas>` under the buttons, and on every `controller.onChange` draws each visible image sticker (rotation, clip, shadow sprite from `public/shadows` or generated on the fly if S1 was dropped) with `drawImage`. Content stickers stay DOM above the canvas; overlapping pairs from `z-order.md` where a content sticker should sit below an image sticker are listed in the report, not solved.
- Hover: the canvas mirrors the CSS 1.1× hover scale (about the sticker centre, shadow included) from delegated `mouseover`/`mouseout` on `.clip` and redraws; record any lag or mismatch against Pathway A.
- First paint is Pathway A's DOM; the canvas takes over after images decode, and that handoff is measured.

- [ ] **Step 1: Failing tests** `clip.test.ts`
  ```ts
  expect(clipToCommands('circle(50% at 50% 50%)', 100, 100)).toEqual(/* arc commands, centre (50,50), radius 50 */);
  expect(clipToCommands('polygon(0 0, 100% 0, 50% 100%)', 200, 100)).toEqual([['M',0,0],['L',200,0],['L',100,100],['Z']]);
  expect(clipToCommands('shape(from 0 0, line to 10px 0)', 10, 10)).toBeNull();
  ```
  Run: `npx vitest run proto` Expected: FAIL.
- [ ] **Step 2: Implement** `clip.ts` then `render.ts`/`entry.ts`. Verify visually against Pathway A at three transforms (saved screenshots, paths reported).
- [ ] **Step 3: Commit** `proto: canvas-hybrid renderer for image stickers`.

### Task 3.2: LOD cache on settle

**Files:**
- Create: `proto/canvas/{lod.ts,lod.test.ts}`; Modify: `proto/canvas/render.ts`

**Interfaces:** `snapScale(scale: number): number` (nearest power of two not below `scale`, clamped to [0.125, 8]); `getBitmap(slug: string, scale: number): ImageBitmap | null` returns the cached bitmap for the snapped scale, scheduling a render if absent. During a gesture the canvas draws the nearest cached LOD scaled; on settle it renders the visible SVGs at the exact scale (OffscreenCanvas transferred to the main thread). If `createImageBitmap` on an SVG blob fails in a worker in either engine, decode through `img.decode()` on the main thread and `drawImage` into an OffscreenCanvas; record which path each engine took.

- [ ] **Step 1: Failing test** `lod.test.ts`
  ```ts
  expect(snapScale(0.7)).toBe(1); expect(snapScale(1)).toBe(1); expect(snapScale(1.01)).toBe(2);
  expect(snapScale(0.01)).toBe(0.125); expect(snapScale(50)).toBe(8);
  ```
  Run: `npx vitest run proto/canvas/lod.test.ts` Expected: FAIL.
- [ ] **Step 2: Implement** `lod.ts` and wire it into `render.ts`. Run; Expected: PASS.
- [ ] **Step 3: Commit** `proto: LOD bitmap cache for settled scale`.

### Task 3.3: Benchmark B against A

**Files:** Create: `docs/superpowers/decisions/005a-pathway-b-results.md`

- [ ] **Step 1: Run the identical bench** (`first-render` and `gestures`) on `proto` and on Pathway A: mobile and desktop, 5 runs, plus `webkit-mobile` regression check.
- [ ] **Step 2: Write the table** (all budgets, memory, handoff delay, correctness gaps found: z-order, `shape()`, iOS canvas memory risk).
- [ ] **Step 3: Commit** `docs: record Pathway B prototype results`.

---

## Milestone 4: decision and finish

### Task 4.1: Apply the decision rule

**Files:** Create: `docs/superpowers/decisions/005-pathway.md`

- [ ] **Step 1: Apply the rule** (spec: A unless it misses a budget on the mobile profile and B meets it by a margin that justifies B's complexity). If A meets every mobile budget, A wins; delete `proto/`. If A misses a budget and B meets it, show the owner the numbers with `ask_user` (the margin that justifies B is the owner's call).
- [ ] **Step 2: If B is chosen,** stop here, commit the record, and write a follow-up plan (`superpowers:writing-plans`) to productionise "A's foundation plus B's renderer". The remaining tasks apply to the A outcome.
- [ ] **Step 3: Commit** `docs: record pathway decision`.

### Task 4.2: Port dev tooling

**Files:**
- Create: `src/dev/{PlacementEditor.tsx,SvgShapeWorkbench.tsx}`, `src/dev/integration.ts`, `tests/e2e/prod-clean.spec.ts`
- Reference: `src/lib/svgToCssShape.ts` stays in place; the old `DebugTools.tsx` and `src/app/dev/svg-shape/*` come from git history

**Interfaces:** `integration.ts` is an Astro integration that calls `injectRoute` for `/dev/svg-shape` and the placement editor only when `command === 'dev'`. The placement editor (Tweakpane) edits the selected sticker's `left/top/width/height/rotate` on the live DOM and prints the YAML fields to copy. Neither tool is in the production output.

- [ ] **Step 1: Failing test** `prod-clean.spec.ts`: after `npm run build`, `dist` has no `dev` route and no file containing `tweakpane`. Run it; Expected: FAIL until the integration exists (add the tools first so the test is meaningful).
- [ ] **Step 2: Port both tools,** run `npm run dev`, open each page and confirm it works (saved screenshots, paths reported). Rebuild; Expected: `prod-clean` PASS.
- [ ] **Step 3: Commit** `feat: port dev tools as dev-only routes`.

### Task 4.3: Cleanup and final verification

**Files:** Modify: `package.json`, `README.md`, the spec's budgets section (final numbers)

- [ ] **Step 1: Remove dead dependencies** (`npx knip` or equivalent; delete anything with no import) and dead files. Re-run `npm test; npm run build`.
- [ ] **Step 2: Full verification.** `npm test; npm run build; npx playwright test` on all four projects; final benches. Update the README (architecture, how to add a sticker, `optimize-assets`, benchmarks, baseline re-measure via `git worktree add ..\baseline baseline-m0`).
- [ ] **Step 3: Deploy dry run.** Run the workflow's steps locally in order (`npm ci; npm test; npm run build`) and confirm `dist` serves under `npx serve dist` with all 63 stickers.
- [ ] **Step 4: Summary for the owner,** listing open items: the device checklist, the z-order outcome, the Silk behaviour outcome, any missed budget. Then follow `superpowers:finishing-a-development-branch`.
