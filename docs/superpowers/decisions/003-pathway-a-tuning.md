# 003 — Pathway A tuning matrix (Task 2.3)

Status: decided. **No candidate won; every factor keeps its control value**:
`shadow: s0` (live `filter: drop-shadow`), `settle: drop-will-change`
(`will-change: transform` only while `data-gesture` is set), `cull: cv`
(`content-visibility: auto`), `bg: png`. The `?v=` variant plumbing and every
losing variant were deleted, so the shipped viewer is the Milestone-1 viewer
(source trees `src/`, `scripts/`, `public/` and `package.json` are identical to
`2b75b40`).

Raw results: `bench/results/m2-*.json` (commit `b272aa5`). The input is the
Milestone-2 ranking in [002](002-m1-numbers.md).

## How it was measured

- One factor at a time from the defaults. Control plus 7 candidates:
  `shadow:s1`, `shadow:s2`, `settle:retoggle-on-scale-change`, `settle:none`,
  `cull:none`, `cull:explicit`, `bg:gradient`.
- **R15 (running variants).** The benches and the crisp spec append the env
  `BENCH_QUERY` (for example `?v=settle:none`) to their `page.goto` URL. It is
  empty by default and recorded in `runMeta.benchQuery`. One variants build
  (`PUBLIC_VARIANTS=1 TARGET=new astro build --outDir dist-variants`, which is
  git-ignored) served every label with `STATIC_DIR=dist-variants`. The control
  is that same build with no `?v=`. Before each batch, port 4173 was checked
  free and the served HTML was checked for the variants snippet.
- **Benches.**
  - `gestures.bench.ts` ran on chromium-mobile (4x CPU, Fast 4G) and also on
    chromium-desktop as a secondary table.
  - `first-render.bench.ts` ran on chromium-mobile.
  - The new `portable.bench.ts` (R15c) ran on webkit-mobile and
    firefox-desktop. It has no throttling and uses real Playwright input,
    recording in-page rAF deltas and `settleMs`.
  - All benches did 5 runs per label, labelled `m2-<factor>-<value>`.
- **Decomposition (R15d).** `gestures.bench.ts` gains the additive field
  `crispAfterMotionMs`: the last RasterTask end minus the last frame whose
  transform changed. It also gains a decomposition of `crispAfterMs` into:
  - `tail`: the inertia or animation tail after the last input;
  - `settle`: the settle timer;
  - `raster`: the time from settle to the last raster.
- **Rule.** The brief's rule, with ruling R15b:
  - **Discriminating metrics.** `p95FrameMs` is 16.7 ms (the vsync floor) in
    every chromium run, so `mainBusyMs` and `crispAfterMs` are the
    discriminating metrics, judged per gesture.
  - **What counts as a gesture win.** A gesture win is ≥ 10 % better and beyond
    the control's own 5-run spread, (max−min)/median. A margin between 10 % and
    twice the spread triggers a 10-run rerun of both control and variant.
  - **What counts as a factor win.** A factor value wins when at least 2 of the
    4 mobile gestures win and none regresses by more than 5 % beyond the
    spread.
  - **Other browsers.** Nothing may be more than 5 % worse on webkit-mobile or
    firefox-desktop.
  - **Shadow variants.** These also need a penumbra ring diff < 2/255.
  - **Settle variants.** These must pass the crisp spec.

## Matrix — chromium-mobile gestures (5-run medians, Δ vs control)

Control medians (spread = (max−min)/median):

| gesture | mainBusyMs | crispAfterMs | crispAfterMotionMs | p95FrameMs | input delay p95 | tail | settle | raster |
|---|---|---|---|---|---|---|---|---|
| wheel-zoom | 363 (±23%) | 264 (±9%) | 219 | 16.7 | 58 | 44 | 195 | 25 |
| drag-inertia | 354 (±8%) | 930 (±1%) | 117 | 16.7 | 37 | 811 | 89 | 28 |
| pinch | 269 (±21%) | 147 (±11%) | 135 | 16.7 | 47 | 11 | 120 | 18 |
| button-zoom | 500 (±16%) | 465 (±1%) | 120 | 16.7 | 114 | 346 | 88 | 32 |

Candidates (mainBusyMs Δ / crispAfterMs Δ; p95FrameMs 16.7 everywhere):

| variant | wheel | drag-inertia | pinch | button | wins / regressions |
|---|---|---|---|---|---|
| shadow-s1 | +6.1 / −3.7 | +7.3 / −1.1 | +9.5 / −8.1 | +13.4 / −1.9 | 0 / 0 |
| shadow-s2 | −8.2 / −0.6 | +2.2 / −0.7 | +2.6 / +1.9 | +11.4 / +0.7 | 0 / 0 |
| settle-retoggle | −7.1 / −0.3 | +3.5 / **−91.8** (930→76) | −5.2 / +4.4 | +12.4 / −1.2 | 1 / 0 |
| settle-none | **+25.0** / −82.4 | **+41.4** / −13.3 | **+22.6** / −98.0 | **+37.7** / −27.3 | 4 / 4 |
| cull-none | −6.7 / +2.7 | −6.3 / −0.5 | −5.4 / +2.9 | −2.2 / −1.4 | 0 / 0 |
| cull-explicit | −7.2 / +6.6 | −13.1 (rerun band) / +0.3 | −14.6 (within spread) / +1.6 | −4.4 / +3.0 | 0 / 0 (5-run) |
| bg-gradient | −1.4 / −0.8 | −0.6 / −0.8 | +5.8 / −3.5 | +11.4 / −1.9 | 0 / 0 |

The button-zoom `mainBusyMs` deltas of +11 to +13 % all sit inside the
control's ±16 % spread. In this table, regressions that exceed the spread are
shown in bold.

### R15b rerun (10 runs, chromium-mobile): cull-explicit

| gesture | control busy | cull-explicit busy | control crisp | cull-explicit crisp |
|---|---|---|---|---|
| wheel-zoom | 331 (±44%) | +15.6% | 263 | +5.3% |
| drag-inertia | 364 (±16%) | −4.6% | 922 | ~0 |
| pinch | 266 | ~0 | 140 (±21%) | **+23.1%** (173) |
| button-zoom | 586 (±74%) | −6.4% | 463 | +3.3% |

The 5-run drag gain of −13 % shrinks to −4.6 % at 10 runs, and pinch
`crispAfterMs` regresses. Result: 0 wins and 1 regression, so it loses. The
10-run control also shows the button-zoom input delay p95 at 241 ms (114 ms in
the 5-run set), so that metric is very noisy.

## Matrix — first render (chromium-mobile, 5-run medians)

| label | fcp | lcp | inputReadyMs | allStickersPaintedMs | img bytes |
|---|---|---|---|---|---|
| control | 760 (±6%) | 868 (±11%) | 564 (±2%) | 2653 (±3%) | 733,627 |
| shadow-s1 | +10.0% | **3348 (+285.7%)** | +0.8% | 0.0% | **930,721** |
| shadow-s2 | −2.1% | −2.3% | −0.8% | +1.0% | = |
| settle-retoggle | −0.5% | +0.5% | +0.3% | −0.2% | = |
| settle-none | −0.5% | +0.9% | −0.1% | +0.5% | = |
| cull-none | +5.3% | −1.4% | **816 (+44.7%)** | −0.4% | = |
| cull-explicit | +4.7% | +0.5% | **816 (+44.7%)** | −1.5% | = |
| bg-gradient | +2.1% | −0.5% | −1.5% | +0.3% | = |

Under S1 the sprites become the LCP candidate, and the extra sprite bytes trip
the bench's critical-JS gate. The sprites total 181,912 B, and the run's image
bytes rise by about 197 KB.

## Matrix — portable probe (R15c, 5-run medians)

**WebKit (webkit-mobile).** Headless WebKit delivers rAF at about 6 Hz: about
8 frames per gesture and p95 near 170 ms for every label, control included.
That makes `p95FrameMs` and `over16` meaningless there. As R15c allows, the
fallback is `settleMs`, which is stable (±7–9 %).

| label | wheel settleMs | drag-release settleMs | note |
|---|---|---|---|
| control | 232 (±7%) | 1392 (±9%) | |
| shadow-s1 | 0.0% | −37.8% | more rAF delivered (14/23 frames) |
| shadow-s2 | +0.4% | −15.1% | |
| settle-retoggle | −6.0% | −7.4% | |
| settle-none | −6.9% | −8.7% | |
| cull-none | −1.7% | −6.8% | |
| cull-explicit | 0.0% | −9.5% | |
| bg-gradient | **+80.2%** | **+119.3%** | also p95 +114 to +117 % → REGRESS |

**Firefox (firefox-desktop).** Control: wheel p95 81.5 ms (±38 %, noisy); drag
p95 49.1 ms (±2 %); drag over16 23; settleMs 210 / 1142.

| label | wheel p95 | drag p95 | drag over16 | verdict |
|---|---|---|---|---|
| shadow-s1 | −57.5% | −66.1% | −82.6% | strong gain |
| shadow-s2 | −0.7% | −0.7% | 0.0% | – |
| settle-retoggle | 0.0% | +0.9% | +13.0% | marginal regress (over16 23→26) |
| settle-none | −1.5% | +0.1% | 0.0% | – |
| cull-none | −0.3% | +0.2% | −13.0% | – |
| cull-explicit | −17.7% (in noise) | −1.1% | −8.7% | – |
| bg-gradient | +35.2% | **+67.9%** | **+69.6%** | REGRESS |

## Matrix — chromium-desktop gestures (secondary, 5-run medians)

Control: wheel busy 85, crisp 144; drag busy 87, crisp 1170; button busy 78,
crisp 476.

Notable candidate results:
- **settle-retoggle:** drag crisp is 64 ms (−94.5 %), with everything else
  within ±4 %.
- **settle-none:** wheel `mainBusyMs` is 786 (+822 %) and p95 is 66.7 ms (17
  frames over 16 ms); button p95 is 66.6 ms.
- **shadow-s1:** wheel busy −20.5 % and crisp −39.2 %, but drag busy +14.9 %.
- **cull-none and cull-explicit:** busy −7 to −12 %, within the desktop control
  spread (±9 to ±24 %).
- **bg-gradient:** neutral.

## Shadow fidelity

These are the ring-diff figures against s0 (per channel, out of 255), using the
ring metric of Task 2.2.

- **Chromium, Task 2.2 shots, scale 1.**
  - s1: max ringMean 0.978 (light) / 0.035 (dark), max ringMax 3.
  - s2: max ringMean 0.928 / 0.043.
  - Both are under 2/255.
- **Chromium, settled at 4x (S1 deep-zoom softness).** s1 ringMean is cpp
  1.048 (ringMax 4), dark 0.477, typescript 0.806 and inter 0.813 (light);
  dark scheme ≤ 0.035. The DPR-2 bitmap scaled 4x stays under 2/255, so
  softness alone would not have disqualified S1.
- **WebKit, scale 1 (the S1 hazard).**
  - `CSS.supports('overflow-clip-margin', '…')` is false, so WebKit clips the
    sprite `::before` at the sticker's box.
  - Shadow pixels in s1 vs s0: cpp 1,667 vs 3,651; dark 2,360 vs 4,869;
    typescript 0 vs 6,715; inter 0 vs 8,510.
  - Light-scheme ringMean is cpp 2.37, dark 2.91, typescript 6.06 and inter
    6.10, all above 2/255.
  - Forcing `content-visibility: visible` does not restore the ring, which
    points to the clip rather than the containment.
  - **The S1 penumbra is cut on Safari, so S1 cannot win.**

## Crisp spec (`tests/e2e/settle-crisp.spec.ts`)

- **What it does.** The spec wheel-zooms the first unrotated SVG sticker to
  about 4x and waits for settle. It then compares the sticker to a reference
  `<img>` drawn at 4x box size on a blank page at the same DPR, using
  `pixelDiffRatio`; the test passes below 0.02.
- **Sticker choice (deviation).** No sticker is both unrotated and unclipped,
  so the spec uses `dark` (`clip-path: circle(50%)`), which is unrotated.
- **Default build.** It passes at 0.0000 on chromium-desktop (×4.00, 220×220
  px), chromium-mobile (×3.95, 197×197) and firefox-desktop. It is skipped on
  webkit-mobile, which has no mouse wheel.
- **Variants.** Every settle variant (drop-will-change, retoggle, none) passes
  on `dist-variants`.
- **Failing first.**
  - Forcing `will-change: transform` on the layer still passes, because
    Chromium re-rasters at the new scale anyway.
  - The deliberately blurry condition
    `BENCH_PROBE_CSS='{stickers} img{filter:blur(0.5px) !important}'` fails,
    with 0.0695 (desktop) and 0.0729 (mobile).
  - This shows the spec can fail.

## Decisions per factor

| factor | winner | deciding clause |
|---|---|---|
| shadow | **s0** (control) | s1: 0 gesture wins, LCP +286 %, +182 KB of sprites, and the WebKit penumbra cut (ring up to 6.1/255) fails the fidelity gate. s2: no gesture moves by 10 %. |
| settle | **drop-will-change** (control) | retoggle: only 1 of 4 gestures wins (2 needed), and Firefox drag over16 is +13 %. none: all 4 gestures regress `mainBusyMs` by 23–41 % (desktop wheel +822 %, p95 66.7 ms). |
| cull | **cv** (control) | none: 0 wins and inputReady +45 %. explicit: 0 wins after the R15b 10-run rerun, pinch crisp +23 %, and inputReady +45 %. |
| bg | **png** (control) | gradient: 0 wins; WebKit settleMs +80 to +119 % and Firefox drag p95 +68 %. |

**Combined confirmation (R15e).** The combination of winners is the control
itself, so there is no combined variant to confirm. The control's 5-run and
10-run sets above serve as the reference.

**settle-retoggle.** This is the strongest lead for Task 2.3b. It cuts
drag-inertia `crispAfterMs` from 930 to 76 ms on mobile and from 1170 to 64 ms
on desktop. It re-rasters at each scale change rather than once after settle,
and a pan has no scale change, so the drag tail is already crisp. It fails the
rule only because the other three gestures are neutral.

## What was deleted (R15f)

- **Variant plumbing:** `src/viewer/variants.ts`, `src/viewer/settle.ts` (with
  its test), `src/viewer/cull.ts`, `src/inline/boot-variants.ts`, and the
  `PUBLIC_VARIANTS` branches in `src/pages/index.astro`,
  `src/components/Sticker.astro` and `src/inline/bundle.ts`.
- **Shadow variants:** `src/styles/shadow-variants.css`,
  `scripts/measure-shadows.ts`, `scripts/gen-shadows.ts` (with its test),
  `public/shadows/`, `src/data/shadows.json`, `src/data/shadow-boxes.json` and
  the `shadows` npm script.
- **Controller hook and tests:** the controller hook `onMotionStart`, which no
  kept strategy uses, and `tests/e2e/variants.spec.ts`.
- **Plan file table:** the gen-shadows row in the plan's file table no longer
  applies.

What was kept or added:
- **Settle behaviour.** The M1 rule `#canvasWrapper[data-gesture] #canvas {
  will-change: transform }` *is* drop-will-change. `data-gesture` is set on
  every idle→moving edge, programmatic moves included, and is removed at
  settle.
- **New e2e.** The new `tests/e2e/settle.spec.ts` covers this without `?v=`:
  - `will-change` is `transform` during a wheel zoom and `auto` after settle;
  - a programmatic `zoomBy` promotes the layer only while animating;
  - every sticker keeps its live `drop-shadow` filter and has no `::before`.
- **`BENCH_QUERY`.** The hook stays in the benches and the crisp spec. It is
  empty by default and no longer used by the site.
- **Build output.** `dist/index.html` changed from SHA-256 `7DEB5457…5C21CBA`
  to `484158E7…36498DD` (71,999 B). The change is only in chunk hashes and the
  removed variant snippet; behaviour equals M1.

## What still misses budget after Task 2.3

The control is unchanged, so these are the M1 misses re-measured. All figures
are 5-run medians on chromium-mobile (4x CPU), and the settle budget is
150 ms.

| miss | value | decomposition (tail after last input / settle timer / settle→last raster) |
|---|---|---|
| drag-inertia crispAfterMs | **930 ms** | 811 inertia tail / 89 settle / 28 raster |
| button-zoom crispAfterMs | **465 ms** | 346 zoom-animation tail / 88 settle / 32 raster |
| wheel-zoom crispAfterMs | **264 ms** | 44 tail / 195 settle (wheel-burst timer) / 25 raster |
| pinch crispAfterMs | 147 ms | 11 / 120 / 18; within budget, but with no margin (±11 %) |
| button-zoom input delay p95 | **114 ms** (241 ms in the 10-run set) | budget < 100 ms; noisy |
| desktop raster time | about 2x the baseline | see [002](002-m1-numbers.md); untouched by every variant |

Measured from the last moving frame (`crispAfterMotionMs`), the crisp delay is
only 117–219 ms. The misses are dominated by the length of the inertia and
animation tails and by the wheel settle timer, not by raster. These are timing
constants, which Task 2.3 does not change; Task 2.3b should tune them and
re-evaluate settle-retoggle for the drag tail.

## What to look for on real devices

- **iOS Safari.**
  - Confirm that the live `drop-shadow` is acceptable when panning a dense
    viewport. Headless WebKit could not give frame timing.
  - The S1 sprite would need a fix for the clip if it is ever revisited.
- **Firefox.** Its frame times are the worst of the three engines in the
  portable probe (drag p95 about 49 ms). Pre-baked shadows (S1) cut that by
  about 66 %, so real-device Firefox jank under pans is the signal that would
  justify revisiting shadows.
- **Android Chrome, mid-tier.** Check the about-1 s blur-to-crisp delay after a
  flick (the drag-inertia miss). It is the most user-visible remaining issue.
