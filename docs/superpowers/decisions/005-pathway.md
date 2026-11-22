# 005: Pathway decision (Task 4.1)

**Decision: Pathway A (lean DOM) is the product. Pathway B (canvas hybrid)
does not qualify under the decision rule and is archived at the local git tag
`pathway-b-m3`.**

No new benchmarking was done for this record. Every figure below comes from
the committed result files in `bench/results/` (`m3-*.json`, `audit-*.json`)
and the evidence record
[`005a-pathway-b-results.md`](005a-pathway-b-results.md), and was re-read from
the JSON medians with a read-only script before it was cited. Figures from the
Task 3.1/3.2 implementer reports that no committed file reproduces are
labelled **uncommitted scratch**.

## The rule

From the spec (`docs/superpowers/specs/2026-11-20-render-performance-design.md`,
"Decision rule"):

> Both A and B are measured with the same harness (below) on the same
> machines. **A is chosen unless it misses a budget on the mobile profile and
> B meets it by a margin that justifies B's complexity.** The outcome is
> recorded in the repo. If B wins, the final architecture is "A's foundation
> plus B's renderer", not a second rewrite.

The plan left "the margin that justifies B" to the owner (`ask_user`). That
step was replaced by rulings that fix the margin numerically:

- **R6.** A wins by default. B justifies its complexity only with a result
  that is ≥ 30 % better on a metric A missed on mobile, with no WebKit or
  Firefox regression.
- **R26** (how R6 is applied). A candidate row counts for B only if all of
  these hold:
  - **(a)** it is a metric A **missed on mobile** in
    [`004-parity.md`](004-parity.md), and B is ≥ 30 % better;
  - **(b)** the metric is **comparable** between A and B per 005a (rows
    marked "not comparable", such as `rasterMs`, or "≠", such as B's settle
    paint against A's `crispAfterMotionMs`, cannot count);
  - **(c)** the delta holds against **both** the m3 re-run of A **and** the
    audit A (005a note 8: A's own run-to-run drift on mobile is up to about
    30 %, so a delta inside it is noise);
  - **(d)** it holds in the **GPU-mode** set as well as in the default set;
  - **(e)** there is **no WebKit/Firefox regression** (005a portable tables;
    rows inside the noise band are noted, not counted either way).

## Candidate rows

Every mobile budget that A missed in 004 is listed. Conventions:

- Each figure is the median of 5 runs (`m3-a-*` = A re-run, `m3-b-*` = B,
  `audit-*` = A in 004).
- **Δ = (B − A) / A.** For every row except pinch frame count, **lower is
  better**, so a negative Δ favours B and (a) needs Δ ≤ −30 %. For pinch frame
  count, **higher is better**, so (a) needs Δ ≥ +30 %.
- "vs audit" is (B − audit A) / audit A, using the B figure of the same set.
- "def" is the default (software-canvas) set; "gpu" is `BENCH_GPU=1`
  (005a notes 1–2).

### Main-thread `RunTask` per gesture (A missed all four; targets ≤ 174 / 137 / 150 / 259 ms)

Lower is better.

| gesture | A def | B def | Δ def | A gpu | B gpu | Δ gpu | audit A | B def / gpu vs audit | (a) | (b) | (c) | (d) | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wheel-zoom | 404 | 4,771 | +1,082 % | 291 | 1,008 | +246 % | 342 | +1,296 % / +195 % | fail | pass | fail | fail | **B worse** |
| drag-inertia | 346 | 4,404 | +1,174 % | 303 | 1,514 | +400 % | 348 | +1,164 % / +335 % | fail | pass | fail | fail | **B worse** |
| pinch | 315 | 6,237 | +1,882 % | 225 | 1,529 | +580 % | 243 | +2,469 % / +530 % | fail | pass | fail | fail | **B worse** |
| button-zoom | 465 | 2,219 | +377 % | 589 | 1,551 | +164 % | 471 | +371 % / +229 % | fail | pass | fail | fail | **B worse** |

B's busy window is longer (005a note 5) because its slow frames stretch the
motion (mobile default wheel motion 4,786 ms for B vs 1,010 ms for A).
That is a consequence of B's per-frame cost, not a measurement artefact in
A's favour. B also leaves more work after motion
(`mainBusyAfterMotionMs`, wheel default 3,382 vs 373).

### Input delay, 2× targets (A missed all four gestures and sheet-open)

Lower is better. Targets: wheel ≤ 21, drag ≤ 17, pinch ≤ 17, button ≤ 48,
sheet-open ≤ 17 ms.

| row | A def | B def | Δ def | A gpu | B gpu | Δ gpu | audit A | B def / gpu vs audit | (a) | (b) | (c) | (d) | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wheel-zoom | 50.1 | 3,616.9 | +7,119 % | 34.1 | 119.2 | +250 % | 38.3 | +9,344 % / +211 % | fail | pass | fail | fail | **B worse** |
| drag-inertia | 33.8 | 307.6 | +810 % | 34.0 | 70.7 | +108 % | 33.9 | +807 % / +109 % | fail | pass | fail | fail | **B worse** |
| pinch | 36.1 | 415.0 | +1,050 % | 35.7 | 114.4 | +220 % | 42.0 | +888 % / +172 % | fail | pass | fail | fail | **B worse** |
| button-zoom | 63.8 | 267.6 | +319 % | 74.8 [60.3–88.4] | 59.0 [50.7–114.6] | **−21.1 %** | 59.0 | +354 % / **0.0 %** | fail (−21 % is short of −30 %) | pass | fail (0 % vs audit) | fail (default +319 %) | **no qualifying gain** (005a ‡: inside A's drift band) |
| sheet-open (default only) | 29.1 [19.4–41.0] | 33.3 [23.1–300.5] | +14.4 % | — | — | — | 30.9 | +7.8 % / — | fail | pass | fail | not measured in GPU mode | **B worse** |

The only negative Δ in the whole candidate set is GPU button-zoom input
delay. It fails three criteria: its size (−21.1 %) is below the 30 % margin,
it is 0.0 % against audit A (59.0 = 59.0) with overlapping ranges, and the
same row is +319 % in the default set.

### First render: deep-link LCP `#riddler` (A missed; target ≤ 1,380 ms)

Lower is better. Measured in the default set only.

| row | A def | B def | Δ def | audit A | B vs audit | (a) | (b) | (c) | (d) | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| deep-link LCP | 1,660 [1,644–1,688] | 1,660 [1,640–1,684] | 0.0 % | 1,652 | +0.5 % | fail | pass | fail | not measured in GPU mode | **no change** |

B shares A's prerendered DOM until handoff, so the LCP element is the same.
B's deep-link TBT (529 vs 81, +553 %) and all-painted (4,489 vs 2,688, +67 %)
are worse.

### Mobile raster ≈ 2× baseline (A missed: 94–117 vs 70–85 ms)

Trace `RasterTask` ms per gesture. Lower is better.

| gesture | A def | B def | Δ def | A gpu | B gpu | Δ gpu | audit A | (a) | (b) | (c) | (d) | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wheel-zoom | 104.3 | 8.1 | −92.3 % | 14.3 | 0.9 | −93.7 % | 107.3 | numerically | **fail: not comparable** | — | — | **cannot count** |
| drag-inertia | 88.4 | 6.8 | −92.3 % | 2.3 | 0.8 | −64.2 % | 116.8 | numerically | **fail: not comparable** | — | — | **cannot count** |
| pinch | 105.7 | 6.5 | −93.8 % | 1.8 | 0.7 | −61.5 % | 93.8 | numerically | **fail: not comparable** | — | — | **cannot count** |
| button-zoom | 96.9 | 9.0 | −90.7 % | 2.1 | 1.0 | −53.9 % | 109.0 | numerically | **fail: not comparable** | — | — | **cannot count** |

005a note 6: B paints stickers with Canvas 2D on the main thread, so its
sticker raster is not in `rasterMs`. That cost is inside B's `mainBusyMs`
(the table above, +164 % to +1,882 %) and `proto.lodRenderMs`. These rows
show where the raster moved, not that it got cheaper.

### Pinch frame count (A missed: 64 vs baseline 93)

**Higher is better.**

| row | A def | B def | Δ def | A gpu | B gpu | Δ gpu | audit A | B def / gpu vs audit | (a) | (b) | (c) | (d) | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pinch frames | 66 | 72 | +9.1 % | 63 | 61 | −3.2 % | 64 | +12.5 % / −4.7 % | fail (+9 % < +30 %) | doubtful (B's pinch motion is 6,458 vs 1,111 ms) | fail | fail (GPU is worse) | **no qualifying gain** |

B's default figure is higher only because its motion lasts almost six times
as long. Neither set reaches the 93-frame baseline.

### Missed budgets that are not candidates

- **Desktop wheel crisp (156 ms) and desktop raster ≈ 2×.** These are desktop
  misses, and the rule asks about the mobile profile. They would fail (b)
  anyway: B's desktop "crisp" is `proto.settleSinceMotionMs` (≠, 005a note 4;
  default 112.4 vs 152.8, GPU 127.8 vs 102.4, so the sign flips between sets)
  and B's `rasterMs` is not comparable (note 6).
- **Modulepreload cost and English aria-labels before hydration.** These
  belong to the shared foundation, which B reuses unchanged (critical-path JS
  8,011 B for both). B cannot move them.

### Result of R26 (a)–(d)

**No row passes.** On every comparable mobile metric that A missed, B is
either worse (busy ×4, input delay ×3 plus sheet-open), unchanged (deep-link
LCP), or better by less than 30 % in one set only and not at all against
audit A (GPU button-zoom input delay; default pinch frames). The only large
negative deltas (`rasterMs`) are not comparable.

The spec's literal precondition also fails. No comparable row has B
*meeting* the missed budget: B's best busy figure (GPU button, 1,551 ms) is
far above ≤ 259 ms, GPU button input delay (59.0) is above ≤ 48, sheet-open
(33.3) is above ≤ 17, deep-link LCP (1,660) is above ≤ 1,380, and pinch
frames (72 / 61) are below 93.

## WebKit / Firefox regression check (R26 e)

Portable bench, no throttle, no trace (005a). Lower is better for every row
here. Headless WebKit runs rAF at about 6 Hz, so only `settleMs` is usable on
WebKit.

| engine / gesture | metric | A | B | Δ | audit A | B vs audit | reading |
|---|---|---|---|---|---|---|---|
| webkit-mobile wheel | settleMs | 108 [107–124] | 135 [111–157] | +25.0 % | 121 | +11.6 % | ranges overlap: **noise band, not counted** |
| webkit-mobile drag-release | settleMs | 1,340 [1,305–1,521] | 913 [884–945] | −31.9 % | 1,297 | −29.6 % | **unexplained** (005a); not counted as a win |
| firefox-desktop wheel | p95 frame | 83.3 | 33.3 [33.3–50] | −60.0 % | 67.6 | −50.7 % | B better |
| firefox-desktop wheel | over16 frames | 29 | 8 | −72.4 % | 30 | −73.3 % | B better |
| firefox-desktop wheel | settleMs | 108 [104–111] | 112 [109–116] | +3.7 % | 107 | +4.7 % | noise band |
| firefox-desktop drag-release | p95 frame | 50.0 | 33.3 | −33.4 % | 49.7 | −32.9 % | B better |
| firefox-desktop drag-release | settleMs | 1,144 | 1,140 | −0.3 % | 1,137 | +0.3 % | noise band |

No counted WebKit or Firefox regression. Criterion (e) is therefore met, but
it cannot rescue B because no row passes (a)–(d). The Firefox frame gains
are desktop, unthrottled frame-pacing figures, not a mobile budget A
missed. (WebKit `over16` rises for B, +50 % wheel and +64 % drag, but 005a
rules WebKit frame figures not meaningful at 6 Hz, so they are noted, not
counted.)

## B's non-numeric findings

These weigh on "B's complexity" even though the numeric rule already decides
the outcome.

- **No off-main-thread SVG raster in any engine.** The spec's main case for
  B was re-rasterising SVGs off the main thread (OffscreenCanvas in a worker
  into an `ImageBitmap` LOD cache). `createImageBitmap(svgBlob)` is rejected
  by Chromium, WebKit and Firefox (Task 3.2 report, **uncommitted scratch**
  for the per-engine error text). The committed runs confirm the outcome:
  `proto.lodPath` is `"main"` in every B result file (chromium mobile default
  and GPU, chromium desktop, webkit-mobile, firefox-desktop). The worker path
  is opt-in (`?lod=worker`) and was never benchmarked. Every LOD and exact
  render costs main-thread time, which is what the busy and input-delay rows
  show.
- **Correctness gaps (listed in 005a, not solved):**
  - the `shape()` clip is not applied: `pedantic` is drawn unclipped
    (`proto.unclipped` = 1 in every chromium run);
  - five content-over-image overlaps paint in the wrong z-order (`24h` /
    `karaoke`, `bad-translations` / `yofukashi`, `css-is-awesome` / `mdx`,
    `css-is-awesome` / `vscode`, `dd-mmm-yyyy` / `earth`);
  - no accessibility or hit-test rewrite: B relies on A's DOM buttons, and
    its hover figures are A's DOM path (desktop hover 6.74 vs 5.14 ms,
    +31 %);
  - the background tile lags a scheme change by 2 frames, and WebKit themed
    SVGs disagree with the scheme under emulated dark;
  - exact renders are not tiled; synchronous fallback draws occur
    (`fallbackDraws` 5 in mobile default drag); every SVG is fetched and
    decoded twice (48 extra `fetch` requests, +4 image requests).
- **DPR cap.** B paints its canvas at DPR ≤ 2 (`proto.dpr` = 2 on both mobile
  profiles), so on the DPR 2.625 and DPR 3 profiles it paints fewer pixels
  than A and looks softer. Its mobile figures are therefore flattered, not
  penalised, by the cap.
- **Memory and the iOS canvas limit: UNMEASURED real-device concern.** Only
  the JS heap was measured (A 6.2–6.3 MB, B 6.2–7.1 MB per mobile gesture).
  B's canvas memory is **computed** from its own stats: 19.8 MB after load on
  mobile, with a gesture peak of 83.4–86.3 MB against a 96 MiB LOD cap. The
  iOS Safari canvas limit could not be measured. This is a risk, not a
  finding.
- **Handoff delay.** From A's DOM first paint to the canvas owning every
  sticker: 4,272 ms mobile default, 3,542 ms mobile GPU, 183 / 191 ms desktop
  (`proto.handoffAllMs`). During that window the page is A's DOM.
- **Load cost.** Mobile default TBT 2,807 ms vs 3 (GPU 99 vs 6), 34 long
  tasks vs 2, a TTI proxy of 8,641 vs 2,813 ms, +17,320 B of JS (off the
  critical path), sheet visible after tap 908 vs 348 ms.

## Decision and reasoning

**A.** The rule makes A the default and asks B for a decisive (≥ 30 %),
comparable, drift-proof, GPU-robust gain on a mobile budget A missed,
without a WebKit/Firefox regression. B has none:

1. On the busy and input-delay budgets that motivated B, it is several times
   *worse* in both sets, because the canvas raster that was meant to leave
   the main thread runs on it in every engine.
2. The only favourable deltas are either not comparable (`rasterMs`), inside
   A's own drift (GPU button input delay: −21 % vs re-run, 0 % vs audit), or
   contradicted by the other set (pinch frames).
3. Its non-numeric costs (correctness gaps, softer DPR-capped output, a
   multi-second mobile handoff, a heavy load and an unmeasured iOS memory
   risk) add complexity rather than offset it.

The real-device checklist in 005a (a mid-range Android with a GPU canvas)
could narrow the default-vs-GPU gap, but even B's GPU set, run on a desktop
GPU, is +164 % to +580 % on mobile busy. No plausible device result turns
that into a ≥ 30 % gain. The decision does not wait on it.

A's missed budgets remain missed. They are recorded in
[`004-parity.md`](004-parity.md) and stay open against A; this record does
not change them.

## What this means for the repo

- **A is the product.** `src/` (Astro static + vanilla-TS viewer + React
  islands) is the shipped architecture. There is no "A's foundation plus B's
  renderer" follow-up.
- **B is archived** at the local tag `pathway-b-m3` (commit `2d798d7`, the
  last commit with `proto/`; same local-only convention as `baseline-m0`).
  `proto/` (including its tests), the untracked `dist-proto/` build output
  and the `/dist-proto/` `.gitignore` line are removed in the following
  commit.
- **Kept as evidence:** every `bench/results/m3-*.json` and
  [`005a-pathway-b-results.md`](005a-pathway-b-results.md).
- **Kept as inert capture code:** `bench/proto.ts` and `bench/proto.test.ts`,
  and the `proto` fields that `bench/*.bench.ts` and `bench/results.ts` read.
  They are additive: on A `window.__proto` is undefined and they record
  `servedBuild: "dom"` only. Task 4.3's dead-code pass may remove them.

## Reproducing B

The tag is local; it exists only in the clone where it was created.

- Read any prototype file: `git show pathway-b-m3:proto/canvas/render.ts`
  (also `proto/build.mjs`, `proto/vite.config.ts`, `proto/canvas/{clip,lod,entry,raster.worker}.ts`
  and the two `*.test.ts`).
- Rebuild and re-bench B: check the tag out in a separate worktree
  (`git worktree add ..\sticker-sheet-pathway-b pathway-b-m3`), then in it run
  `npm ci`, `$env:TARGET='new'; npm run build`, and `node proto/build.mjs`,
  which copies `dist/` to `dist-proto/` and adds the canvas bundle. The
  benches then run with `STATIC_DIR=dist-proto` as described in 005a ("How
  the numbers were produced").
