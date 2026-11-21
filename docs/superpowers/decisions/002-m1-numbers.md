# Milestone 1 numbers: the Astro rewrite against the Milestone 0 baseline

Status: recorded. First render meets every budget with a wide margin. Settle (`crispAfterMs`) misses on most gestures, and button-zoom input delay sits on the 100 ms line. Both go to Milestone 2. No product code changed in this task.

Build under test: `dist/` from `npm run build` at the Task 1.13 head (Astro 7 static output, vanilla-TS viewer, React islands `Controls` and `Sheet` at `client:idle`), served by `npx serve dist -l 4173` (Playwright `webServer`, `TARGET=new`).

Baseline: `.baseline-site`, the unchanged Next 16 static export, numbers from `docs/superpowers/baseline/report.md` and `bench/results/baseline-{mobile,desktop}.json`.

Raw data: `bench/results/m1-mobile.json` and `bench/results/m1-desktop.json`. Each holds the first-render and gesture runs for one profile; every run is embedded under `raw`.

Machine and method are the same as the baseline:
- Windows 11, Ryzen 9 9950X, Chromium 159.0.8154.6 headless shell (software compositing), Playwright 1.65.1, Node 26.12.1.
- Mobile: Pixel 7 emulation, 4× CPU, Fast 4G (165 ms, 1,012,500 B/s down). Desktop: 1280×800, no throttling.
- 5 fresh-context, cold-cache runs per test. Numbers are `median / p95`; spread is (max − min) / median.

## First render (median / p95)

| Metric | Mobile new | Mobile baseline | Desktop new | Desktop baseline |
|---|---|---|---|---|
| FCP (ms) | 732 / 748 | 724 / 756 | 132 / 140 | 164 / 212 |
| LCP (ms) | **792 / 844** | 2,772 / 3,020 | 132 / 140 | 324 / 376 |
| TBT, FCP→TTI proxy (ms) | **0 / 2** | 726 / 928 | 0 / 0 | 0 / 0 |
| CLS | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| First sticker in DOM (ms) | 535 / 551 | 2,044 / 2,159 | 44 / 56 | 176 / 211 |
| Stickers present at FCP | 63 | 0 | 63 | 0–63 |
| Live sticker shows today's date (ms) | 719 / 735 | 2,529 / 2,842 | 78 / 84 | 209 / 261 |
| All 63 stickers painted, images decoded (ms) | 2,502 / 2,534 | 5,659 / 5,859 | 84 / 113 | 291 / 345 |
| Critical-path JS, gzip-9 of bodies finished before LCP (B) | **0 / 0** | 473,458 | 7,950 / 40,697 | 473,458 |
| Transferred: JS / CSS / img / font / html (B) | 170,677 / 20,327 / 733,627 / 141,714 / 16,186 | 439,685 / 79,846 / 2,313,268 / 490,076 / 35,446 | same as mobile (JS 170,771) | same |
| Bytes before LCP: JS / CSS / img / font (B) | 0 / 15,717 / 54,197 / 73,220 | 438,760 / – / 21,399 / – | 8,940 / 15,717 / 732,070 / 139,788 | – |
| Long tasks per load (median) | 1 | 4 | 0 | 1 |

The LCP element is the `eana.svg` sticker image in both builds (52,900 px² on mobile, 104,468 px² on desktop).

Spreads:
- Mobile: LCP 12.6%, FCP 7.1%, all-painted 2.5%, live 8.8%, byte counts 0%.
- Desktop: all-painted 49% and first sticker 103%, both on values under 115 ms. Desktop critical JS 412%; see "Payload" below.

## Gestures (median / p95)

| Scenario | Profile | p95 frame (ms) | frames >16.7 / >33 | frames | busy (ms) | raster (ms) | crisp (ms) | input delay (ms) | peak JS heap (MB) |
|---|---|---|---|---|---|---|---|---|---|
| wheel-zoom | mobile | 16.667 / 16.667 | 0 / 0 | 60 (60) | 353 / 370 (348) | 94 / 110 (70) | **267 / 277** (477) | 44 / 53 (42) | 5.2 (11.3) |
| drag-inertia | mobile | 16.667 / 16.667 | 0 / 0 | 83 (76) | 338 / 371 (275) | 107 / 118 (73) | **922 / 924** (541) | 34 / 37 (35) | 5.4 (11.5) |
| pinch | mobile | 16.667 / 16.667 | 0 / 0 | 65 (93) | 260 / 264 (301) | 94 / 103 (75) | **143 / 157** (351) | 39 / 41 (35) | 5.3 (11.6) |
| button-zoom | mobile | 16.667 / 16.667 | 2 / 2 (1 / 1) | 89 (90) | 511 / 536 (518) | 112 / 125 (85) | **462 / 478** (455) | **97.5 / 119** (96) | 6.0 (11.8) |
| wheel-zoom | desktop | 16.667 / 16.667 | 0 / 0 | 50 (50) | 81 / 91 (83) | 222 / 243 (121) | 133 / 147 (496) | 49 / 51 (48) | 5.2 (10.5) |
| drag-inertia | desktop | 16.667 / 16.667 | 0 / 0 | 97 (57) | 95 / 102 (57) | 117 / 142 (33) | **1,168 / 1,179** (524) | 16 / 18 (15) | 5.5 (9.8) |
| button-zoom | desktop | 16.667 / 16.667 | 0 / 0 | 84 (84) | 83 / 87 (81) | 127 / 145 (47) | 480 / 480 (470) | 3.4 / 4.1 (3.6) | 5.4 (9.7) |
| pinch | desktop | skipped (needs touch; absent from the JSON) | | | | | | | |

How to read the table:
- Baseline medians are in parentheses.
- `frames` is the number of rAF frames from the first input to motion end.
- Every scenario reaches the same zoom as the baseline (×2.8, ×1, ×3.5, ×5 on mobile; ×5 on desktop).
- Gesture spreads: crisp 0.6–7% except pinch at 18%; busy 7–12% on mobile; input delay 11–32%.

## Budgets

| Budget (mobile unless noted) | Result | Verdict |
|---|---|---|
| LCP ≤ 1.38 s (ruling) / ≤ 1.5 s (spec) | 792 ms median, 844 ms p95, 852 ms worst run | PASS |
| At least 2× better than baseline | LCP 3.5×, TBT 726 → 0, live 3.5×, all-painted 2.3×, first sticker 3.8×; crisp: pinch 2.5×, wheel-zoom 1.8×, button-zoom 1.0×, drag-inertia 0.59× (worse) | PASS on first render; MISS on settle |
| Critical JS ≤ 100 KB gzip | 0 B on mobile in all 5 runs; desktop 7,950 B median, 40,697 B max | PASS |
| No Silk / Radix / Leaflet / React DOM / `baseline-status` bytes before LCP | none on mobile in all 5 runs (asserted); desktop showed `radix` in 1 of 5 runs (reported, not asserted) | PASS (mobile) |
| Zero layout shift | CLS 0 in every run, both profiles | PASS |
| p95 frame ≤ 16.7 ms | 16.667 ms in every scenario, both profiles | PASS (harness floor; see limits) |
| Crisp ≤ 150 ms | mobile pinch 143 (p95 157); wheel-zoom 267; button-zoom 462; drag-inertia 922. Desktop wheel-zoom 133; button-zoom 480; drag-inertia 1,168 | MISS (except pinch and desktop wheel-zoom) |
| Input delay < 100 ms | button-zoom 97.5 ms median, 119 ms p95 (baseline 96 / 106); all others ≤ 53 ms | MISS at p95 (on the line at the median) |
| TBT (target: vs baseline 726 ms; no spec budget, spec asks it be minimal) | 0 ms median, 2 ms p95 | PASS (726 → 0) |
| Time to input readiness (no spec budget; baseline first sticker 2,044 ms, interactive on hydration) | no earlier than ~2.56–2.60 s (last eager file's `responseEnd`) | not a PASS: no better than baseline; owned by Task 1.15 |
| Inline boot-head ≤ 600 B gzip | 350 B | PASS |
| Inline boot-view ≤ 1,500 B gzip | 645 B | PASS |

The other inline scripts in `dist/index.html`, gzip-9:
- CJK font loader: 249 B.
- `live-exprs` JSON: 161 B.
- Astro's idle directive: 228 B.
- Astro's island runtime: 1,929 B.

## Payload (critical-path JS and the eager graph)

The first-render bench now records which libraries are present in each script body. `bench/metrics.ts` `PAYLOAD_MARKERS` matches these content markers, chosen by inspecting `dist/_astro/*.js`:

| Library | Marker(s) | Found in |
|---|---|---|
| react-dom | `__reactContainer$`, `__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` | `client.*.js`, `react-dom.*.js` |
| radix | `data-radix-` | `Controls.*.js` |
| silk | `data-silk` | `Sheet.*.js` |
| leaflet | `leaflet-container` | `PlusCodeMapInner.*.js` |
| baseline-status | `baseline-status` | `BaselineStatus.*.js` |

The bare string `react-dom` is not a marker: the eager entry's `__vite__mapDeps` names `react-dom.*.js` as a dynamic dependency.

Check on the baseline (3 runs, label `livecheck`, not committed): the markers find `baseline-status`, `radix`, `react-dom` and `silk` in its 473,458 B critical path. Leaflet is absent, which matches the baseline report.

The gate runs after each first-render run is recorded, unless `BENCH_PAYLOAD_GATE=0`, which is needed for `TARGET=baseline`. The rule is `criticalJsGateValue` in `bench/metrics.ts`:
- **Mobile, every run:** `criticalPathJsGzip ≤ 102,400 B` and `criticalPathMarkers` empty.
- **Desktop, median of the profile's runs:** the last run reads every recorded run and asserts that the median `criticalPathJsGzip` (nearest rank, the same median as `summarize.ts`) is ≤ 102,400 B. The per-run values are still in the raw JSON and the log, and the desktop markers are logged, not asserted.

Tolerance: `criticalPathJsGzip` is race-sensitive, because it counts only scripts whose response ends before LCP.
- On mobile it reads 0 B in all 5 runs. Even the eager entry finishes at ~2.3 s, well after the ~0.8 s LCP (see the per-run table below). Earlier runs read 0 or 421 B depending on whether the deep-link or island chunk finished first. Mobile has no tolerance: a single run over budget, or any marker, fails.
- On desktop it read 7,950 B (the eager graph) in 4 runs and 40,697 B in 1. In that run `Controls.*.js` (Radix, 29,000 B) ended at 124 ms, the same millisecond as LCP.
- If all of `client` (56,381 B), `Sheet` (39,282 B), `Controls` and the MDX chunk land before a desktop LCP, that run's total is about 136 KB. Such a run is expected and is not a defect: it is idle hydration finishing before a ~130 ms LCP on an unthrottled host. That is why desktop is gated on the median: one or two racing runs out of five cannot fail it, but a build whose eager path itself exceeded the budget would.
- For the same reason the desktop marker result is reported, not asserted.

Eager request graph for `/` (from `dist/index.html`; one `<script type="module" src>`, no modulepreload):

| File | Raw (B) | gzip-9 (B) |
|---|---|---|
| `index.astro_astro_type_script_index_0_lang.CF64j2FX.js` (viewer `main`) | 14,805 | 5,972 |
| `appState.B-aHSmqp.js` | 1,864 | 884 |
| `preload-helper.DAljqb9w.js` | 2,178 | 1,094 |
| **Total, 3 requests** | 18,847 | **7,950** |

This is unchanged from Task 1.13.

Recommendation on `preload-helper`: do not spend Milestone 2 effort on inlining it.
- It is a separate chunk only because the `Sheet` island and the deep-link path share it. Folding it into `main` (Rolldown `advancedChunks`/`manualChunks`) would save one request and about 1 KB.
- On mobile `main` is requested at ~270–290 ms and ends at ~2.3 s. `appState` and `preload-helper` are static imports discovered only when `main` arrives, so they are requested at ~2.3 s and end at ~2.5–2.6 s (per-run table below). That second hop costs ~0.2–0.3 s, but a `modulepreload` for the two imports would remove it without changing the chunking, and inlining `preload-helper` alone would leave `appState` as the same late hop.
- Our working explanation is that `main`'s ~2 s download is set by bandwidth shared with the 55 sticker images rather than by round trips. **This is inferred, not yet isolated**: it rests on the timings below, not on an experiment. The isolating A/B is Task 1.15 step 2. Revisit the chunking only after that result, and check that the Sheet chunk does not then duplicate the helper.

## Idle hydration and long tasks (mobile)

Per-run long tasks (start, duration), from `detail.longTasks`:

| Run | Before FCP | After FCP |
|---|---|---|
| 1 | 559 ms, 181 ms | 2,746 ms, 52 ms |
| 2 | 542 ms, 182 ms | none |
| 3 | 537 ms, 149 ms | none |
| 4 | 540 ms, 154 ms | none |
| 5 | 546 ms, 195 ms | none |

- **The 150–195 ms task at ~540 ms** is parsing, style and layout of the prerendered page under 4× CPU. It ends just before FCP, so TBT, which starts at FCP, does not count it. It is part of what FCP waits for. It matches the baseline's FCP of 724 ms because that is now the whole first render, not an empty shell.
- **Idle hydration showed up as a long task in only 1 run of 5**: a 52 ms task at 2,746 ms, giving the 2 ms TBT p95. In the other runs it splits into tasks under 50 ms.
- Island chunk timing:
  - `Controls`, `Sheet` and `client` (React DOM) are requested at ~770–920 ms, right after the idle callback that follows FCP/LCP.
  - They finish at ~2.4–2.5 s. The shared `react`, `react-dom`, `button`, `ui-strings` and `theme-hook` chunks finish at ~2.7 s, and hydration runs after that.
- On desktop there are no long tasks at all.

Per-run request timings on mobile, from the committed `bench/results/m1-mobile.json` (`raw.firstRender[i]`). Script and image times are resource-timing `startTime`/`responseEnd` in ms from navigation start (`detail.scripts`, `detail.images`). "Images" covers the 55 `/stickers/` responses.

| Run | `main` start / end | `appState` start / end | `preload-helper` start / end | first / last image end | images ended ≤ LCP | LCP | `liveCurrentMs` | `Controls` start / end | `Sheet` start / end | `client` start / end |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 289 / 2,336 | 2,340 / 2,525 | 2,341 / 2,600 | 456 / 2,522 | 12 | 844 | 734 | 914 / 2,414 | 916 / 2,507 | 915 / 2,523 |
| 2 | 274 / 2,313 | 2,320 / 2,489 | 2,321 / 2,561 | 458 / 2,491 | 9 | 792 | 719 | 810 / 2,405 | 848 / 2,487 | 811 / 2,484 |
| 3 | 269 / 2,335 | 2,337 / 2,507 | 2,337 / 2,569 | 438 / 2,459 | 9 | 760 | 672 | 765 / 2,412 | 768 / 2,507 | 766 / 2,491 |
| 4 | 277 / 2,283 | 2,292 / 2,463 | 2,293 / 2,601 | 455 / 2,461 | 9 | 744 | 676 | 765 / 2,415 | 767 / 2,507 | 765 / 2,476 |
| 5 | 285 / 2,338 | 2,344 / 2,512 | 2,344 / 2,587 | 461 / 2,516 | 9 | 800 | 735 | 800 / 2,432 | 802 / 2,509 | 801 / 2,513 |

The JSON does not record when the viewer's module actually executed or when its listeners were attached; the readiness times below are therefore "no earlier than the last eager file's `responseEnd`", not a measured first-input time.

- **First-interaction window.**
  - The viewer entry, which owns pan, zoom and clicks, cannot run before its last eager file arrives at ~2.56–2.60 s (`preload-helper`, table above). The page cannot respond to input until then, even though everything is painted at ~0.8 s.
  - Hydration lands at ~2.7–2.8 s, just after the viewer comes alive, so a user who acts at 2.6–2.8 s can meet one task of up to 52 ms. That is within the 100 ms input-delay budget.
  - The gestures bench starts after load and idle, so it does not measure this window.
- **Cause: inferred, not yet isolated.** `main` is requested at ~280 ms and takes ~2 s to arrive while all 55 sticker images (734 KB) download in the same window; its end falls 124–186 ms before the last image end in every run, i.e. inside the image download, not before it. That is consistent with the images starving the 6 KB entry on Fast 4G, but no experiment has de-prioritised the images to prove it. The isolating A/B is Task 1.15 step 2.
- **Not better than the baseline on time to input.** The baseline's first sticker appears at 2,044 ms and it is interactive when it hydrates, so it can respond to input from roughly the moment there is anything to touch. The new build paints at ~0.8 s but cannot respond before ~2.6 s. Time to input readiness is not a spec budget, but this is **not a PASS**: it is owned by plan Task 1.15 ("Input readiness under bandwidth contention", after 1.14, before Milestone 2).

## Bounded idle prefetch (mobile)

- **Sticker images.** All 55 sticker images are requested by the HTML parser before LCP: every one starts by ~0.8 s. They are prerendered `<img>`s, not prefetch.
  - Only 9–12 finish before LCP (54 KB of 734 KB), and the last ends at ~2.5 s.
  - They share Fast 4G with the eager JS and fonts. We infer that this is why the 6 KB entry takes ~2 s to arrive; that is not yet isolated (Task 1.15 step 2).
- **Description chunks.** Requests to `en.*.js` plus `provider.*.js` start only after hydration and the MDX chunk: the first at ~2.8 s, after LCP, after the last image and after the islands.
  - They then come three at a time, one batch per ~200 ms round trip, 13 requests in all, ending at ~3.6 s.
- **Result: none of them happens before LCP, and prefetch does not compete with first paint.**
- The competition that matters is likely images against the eager JS, not prefetch (inferred, not yet isolated).
- On desktop the same sequence completes by ~260 ms, all after LCP except as noted under Payload.

## Live values (`liveCurrentMs`)

- The live sticker's date is written at first paint by `boot-view.ts` `fillLive()`, from the build-time `#live-exprs` table.
- The probe now reports 719 ms median on mobile. That is ≥ the first sticker in DOM (535 ms), and it is the last rAF before the FCP paint at 732 ms (rAF runs before the paint of its frame).
- On desktop it reports 78 ms, against a first sticker at 44 ms.
- No stale or placeholder value paints: unfilled `[data-live]` spans are `visibility:hidden`.

## Visual comparison

Run: `TARGET=new STATIC_DIR=dist VISUAL_MAX_DIFF=0.01`, against the committed baseline snapshots, which were not updated.

- chromium-desktop: 9 passed, 1 skipped.
  - Passed: the six `initial` scenes (light and dark, en / zh-Hans / ja), `desktop-light-en-hash-dark`, `desktop-light-en-hover-clip` and `desktop-light-en-tooltip`.
  - Skipped: `mobile sheet: peek and expanded`, which is mobile only.
- chromium-mobile: 1 passed (`mobile sheet: peek and expanded`), 9 skipped by design (desktop scenes).
- Every scene passes at 0.01. No scene needed the 0.02 allowance, so there are no accepted differences to record.

## Harness fixes made in this task

1. **Hover-clip predicate** (`tests/visual/baseline.spec.ts`).
   - The baseline enlarges a hovered sticker through `transform`. The rewrite uses the individual `scale` property (`.sticker:has(.clip:hover){scale:1.1}`).
   - The scene now polls `` `${transform}|${scale}` `` and requires it to change.
   - Proof that it still catches a miss: aiming at 0.95 r along the diagonal, which is outside the circle clip-path, made the poll time out (`Expected: not "none|none"`). The change was reverted.
2. **Live probe** (`bench/first-render.bench.ts`).
   - The MutationObserver now also watches attributes.
   - The probe also stays dirty while the date is in `textContent` but not yet in `innerText`.
   - Root cause on the new build: stickers have `content-visibility: auto`. On the first frame after `fillLive()`, the filled span is not yet in `innerText`. The next frame it is, with no DOM mutation in between, so the old dirty gate skipped it until an unrelated mutation at ~2.6 s.
   - Before the fix: 2,573–2,628 ms. After: 672–735 ms.
   - The extra cost is one `innerText` per rAF only while the date is in the DOM but not rendered, usually one or two frames.
   - Baseline semantics are unchanged. The condition is the same, and re-checking more often can only find it earlier. Three baseline runs gave 2,640 / 2,517 / 2,573 ms against the tracked median of 2,529 and p95 of 2,842. The tracked baseline JSON was not touched.
3. **Payload gate and recorded detail** (`bench/first-render.bench.ts`, `bench/metrics.ts`, `bench/results.ts`). Markers and gate are as above. Each run's detail now also stores per-script start time and markers, image request timings and the long-task list. A unit test covers `payloadMarkers`.
4. **WebKit frame sampling in two e2e specs.**
   - The specs are `interactions.spec.ts` "#dark selects without pushing…" and `first-paint.spec.ts` "no layout shift".
   - Headless WebKit runs rAF only every ~150–280 ms for the first ~1–1.5 s after load. This happens on the baseline build too, while a blank page runs at 60 fps.
   - So "> 5 frames" after a fixed sleep failed 2–8 times in 10 under parallel load.
   - Both now `expect.poll` for more than 5 samples (5 s timeout) after the existing wait. The assertions themselves are unchanged.

## Known issues / carried to Milestone 2

- **Drag-inertia settle**, confirmed with 5 runs: crisp 922 ms mobile (baseline 541) and 1,168 ms desktop (baseline 524).
  - Motion lasts longer: 1,397 vs 1,277 ms mobile and 1,625 vs 962 ms desktop, with 83 / 97 frames vs 76 / 57.
  - The inertia tail is longer and slower to stop, and raster continues to its end.
  - This is the headline Milestone 2 settle target.
- **Pinch frame count.** The new pinch moves 65 frames (motion 1,100 ms) against the baseline's 93 (1,552 ms), for the same ×3.5. The gesture bench still shows it.
- **Raster work is higher in every scenario.**
  - Mobile is +30–45%. Desktop wheel-zoom is 222 vs 121 ms, button-zoom 127 vs 47 and drag 117 vs 33.
  - Sticker drop-shadow filters are kept for visual parity; the baseline A/B showed they double raster.
  - Frame cadence is not affected in this harness.
- **Button-zoom input delay** is 97.5 ms median and 119 ms p95 on mobile. That is unchanged from the baseline (96 / 106) and on the budget line.
- **Mobile time to input readiness, no earlier than ~2.6 s** (per-run table under Idle hydration). Now owned by plan Task 1.15 ("Input readiness under bandwidth contention", added after 1.14, before Milestone 2).
  - The 6 KB `main` takes ~2 s to arrive while 55 eagerly requested sticker images download, and `appState`/`preload-helper` add a second ~0.25 s hop after it.
  - The image-contention cause is **inferred, not yet isolated**; the isolating A/B is Task 1.15 step 2. Candidate levers, after that: `loading`/`fetchpriority` on off-screen images, a higher priority for the entry, `modulepreload` for its two imports.
  - Baseline reference: the baseline's first sticker appears at 2,044 ms and it is interactive on hydration, so the new build is not better than the baseline on time to input. This is not a PASS.
- **Silk's `unload` listener.** Chromium logs "Permissions policy violation: unload" as a console error whenever the sheet opens.
  - It cannot be mitigated on GitHub Pages, which allows no response headers.
  - The e2e `watchErrors` ignores that exact message.
  - Follow-up: check for a Silk version without the listener.
- **Firefox and wheel-driven sheet travel.** Firefox does not notice wheel-driven sheet travel, the same as the baseline.
- **Sheet unmount after close.** The sheet stays mounted for ~4 s after a Back or hash close.
- **English aria-labels before hydration.** The static markup shows English aria-labels until hydration for non-English users.
- **Deep-link LCP ≈ 1.48 s.** This is within the 1.5 s spec budget but over the 1.38 s ruling. `fetchpriority` for the hashed sticker's images is the candidate fix.
- **Cached canvas origin.** The cached `getBoundingClientRect` origin assumes `#canvasWrapper` never moves without resizing.
- **`criticalPathJsGzip` is race-sensitive** (see Payload for the tolerance: per run on mobile, median on desktop). Read it next to the eager-graph table, not alone.
- **The desktop marker result is not asserted.** Radix landed before LCP in 1 of 5 desktop runs.

## What Milestone 2 should tune first

1. **Drag-inertia settle**: 922 / 1,168 ms against 150 ms, and worse than the baseline. This is the only gesture that regressed. Shorten or end the inertia tail and stop raster at motion end.
2. **Settle on wheel-zoom and button-zoom**: 267 and 462 ms on mobile. Look at the settle timer and the re-raster after the final transform; pinch (143 ms) shows the budget is reachable.
3. **Button-zoom input delay**: 119 ms p95. Work in the click handler or the zoom animation start.
4. **Mobile time to input readiness, no earlier than ~2.6 s**, not better than the baseline (first sticker at 2,044 ms, interactive on hydration). Now owned by plan Task 1.15 ("Input readiness under bandwidth contention", before Milestone 2). The image-contention cause is inferred, not yet isolated; Task 1.15 step 2 is the isolating A/B, and the fix follows from it. LCP (792 ms) has room to absorb de-prioritising off-screen images if that is the answer.
5. **Raster cost**: about 2× on desktop. Try a cheaper shadow, such as a pre-baked shadow or `box-shadow` on clip-free stickers, measured with the `BENCH_PROBE_CSS` A/B.
6. **Deep-link LCP**: 1.48 s against the 1.38 s ruling.

## Known harness limits

- **Software compositing and unthrottled raster workers.** Raster ms and `crisp` are not GPU- or phone-representative, and frame cadence on a real mid-range phone is likely worse than the 16.7 ms measured here. Treat frame-time results as a floor and `busy` (main-thread ms, which *is* throttled) as the more telling figure. The owner's devices remain part of the acceptance check.
- **`crispAfterMs` is a PROXY**: last input event → end of the last `RasterTask`, clamped at 0. It includes the inertia/animation tail and the page's settle timers, and does not prove the pixels are sharp, only that raster work stopped.
- **Machine state.** The baseline and these numbers were recorded in different sessions on the same machine. Small absolute values (desktop first render, counts of 1–2) show large relative spread.
- **WebKit-headless rAF throttling** affects only e2e timing (see harness fix 4), not these Chromium benches.
- **Third-party resources.** In the baseline the Inter font and the other third-party stylesheets came from the real network. The new build references no third-party origin (fonts are self-hosted), so part of its byte and LCP gain comes from that, and the two builds do not share network conditions exactly.
