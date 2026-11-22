# 004: Parity audit and Pathway A budgets (Task 2.4, closes Milestone 2)

This audit covers the build at the end of Task 2.3c. It checks every item of
the spec's "Feature parity checklist", "Sheet spec", z-order and anti-goals
against the test that proves it, and it records every budget as met or
missed, with numbers against the Milestone 0 baseline.

The rulings that apply are R8, R12, R16, R17 and R19. Under R8, the baseline
wins where it differs from the spec. Under R19, misses are recorded, not
tuned. The spec is `docs/superpowers/specs/2026-11-20-render-performance-design.md`.

## 1. End-to-end run (all four projects)

Command (one project per run, fresh build):

```
$env:TARGET='new'; npm run build
$env:TARGET='new'; $env:STATIC_DIR='dist'; npx playwright test --project=<project>
```

On chromium-desktop, the project that runs the visual scenes, the run also
set `$env:VISUAL_MAX_DIFF='0.01'`.

| project | passed | skipped | failed | notes |
|---|---|---|---|---|
| chromium-desktop | 143 | 42 | 0 | includes the visual `initial` scenes at `VISUAL_MAX_DIFF=0.01` (R12); no scene needed 0.02 |
| chromium-mobile (Pixel 7) | 127 | 58 | 0 | |
| webkit-mobile (iPhone 14) | 111 | 74 | 0 | |
| firefox-desktop | 130 | 52 | 3 | 2 load-dependent timing flakes, 1 real (intermittent) gap; see below |

Every skip is a documented engine or profile limit, for example:

- the visual scenes run on chromium-desktop only (R12);
- `page.mouse.wheel` is not supported on mobile WebKit;
- CDP touch is available on Chromium only;
- the coarse-pointer cases need a touch profile.

The baseline recorders (`tests/parity/record-*.spec.ts`) were not run. They
target the baseline site only.

### Firefox failures

All of the evidence in notes 1–3 and in the probe table is an **uncommitted
scratch observation, not reproducible from the repo**. The scratch specs and
probes were deleted after use. Only the three failures in the full run are
reproducible, with the command in §1.

| test | verdict | evidence |
|---|---|---|
| `settle.spec.ts:57` "a wheel notch after settle re-promotes the layer" | **flake (test timing)** | See note 1. |
| `interactions.spec.ts:456` "keyboard: focus a sticker, Enter and Space each select it" | **flake (load)** | See note 2. |
| `sheet.spec.ts:209` "handle toggles to expanded and back" | **gap (Firefox only, intermittent)** | See note 3. |

1. **`settle.spec.ts:57`.** (Uncommitted scratch observation, not
   reproducible from the repo.)
   - A scratch MutationObserver timeline shows the correct behaviour: the wheel sets
     `data-gesture=zoom` with `will-change: transform`, and both clear after
     about 107 ms.
   - Firefox's zoom window is shorter than one `expect.poll` round trip under
     parallel load, so the poll misses it.
   - It passed 9 of 10 serial runs and failed 3 of 5 runs with the default
     workers.
2. **`interactions.spec.ts:456`.** (Uncommitted scratch observation, not
   reproducible from the repo.)
   - It passed 10 of 10 runs with `--workers=1` and failed 1 of 5 runs under
     parallel load.
   - The failing run selected `08n` instead of `bad-translations`: focus
     landed on the neighbouring sticker while the page was still busy.
3. **`sheet.spec.ts:209`.** (Uncommitted scratch observation, not
   reproducible from the repo, apart from the failure in the full run.)
   - After a wheel scroll of the expanded content, the next handle click is
     sometimes dropped. The sheet stays expanded at 552 px (600 − 48 at
     390×600).
   - It failed 6 of 10 serial runs, then 1 of 10 and 0 of 4 in later sessions.
   - The probe below measured both builds. Both drop the click shortly after a
     content wheel. The baseline's dead window is about 100–250 ms. The new
     build's is intermittently up to about 1 s.

Scratch probe (uncommitted scratch observation, not reproducible from the
repo; small samples): `/#kagami` at 390×600 on firefox-desktop with
`--workers=1`. Expand the
sheet, wheel 300 px over the content, wait GAP, click the handle, then check
that the sheet is back at peek.

| build | GAP | dropped clicks |
|---|---|---|
| new | 1600 ms | 0 / 10 |
| new | 1000 ms | 3 / 8 |
| new | 700 ms | 1 / 8 |
| new | 400 ms | 4 / 10 |
| baseline | 400 ms | 0 / 10 |
| baseline | 250 ms | 0 / 8 |
| baseline | 100 ms | 6 / 8 |
| both, no wheel | 1000 ms | 0 / 8 |

What is the same in both builds:

- The Silk version is 0.9.3.
- The `Sheet.tsx` config matches the baseline `Panel.tsx`:
  - `Scroll.View scrollGestureTrap` is `yEnd`;
  - the scroll gesture is enabled only at detent 2;
  - `inertOutside` is false.

The root cause is not found. No fix of one file or less is known, and the
failure is intermittent, so no deterministic failing test can be written
first (R19). It is recorded as a **gap** and is on the manual checklist. It
affects Firefox desktop only, at narrow widths, when the handle is clicked
within about 1 s of a wheel over the sheet content. Chromium and WebKit pass
the same test in every run.

## 2. Parity table

Key:

- **cd**: chromium-desktop.
- **cm**: chromium-mobile.
- **wk**: webkit-mobile.
- **ff**: firefox-desktop.
- **unit**: vitest (`npm test`), engine-independent.
- **manual**: on `manual-device-checklist.md`.

### Feature parity checklist

| item | proved by | engines | status |
|---|---|---|---|
| Wheel zoom to cursor | `gestures.spec.ts` golden replays (`mobile ${entry.name}` and the desktop wheel entries) recorded from the baseline; `math.test.ts` "wheelScale reproduces rzpp's smooth wheel step…", "… replays through wheelScale, zoomAt and clampTransform" | cd cm ff, unit (no wheel on wk) | proven |
| Pinch | golden pinch replay; `gestures.spec.ts` "second finger down on a sticker cancels the tap and keeps pinching" | cm (CDP touch), unit | proven in Chromium; **manual** on iOS/Android |
| Drag with inertia | golden drag replays; "a held drag does not glide…"; `math.test.ts` inertia tests incl. "inertia matches rzpp's flick distance at 60 Hz" and "…same distance at 120 Hz, 60 Hz and 30 Hz" | cd cm wk ff, unit | proven; real-touch threshold **manual** |
| Double-click zoom | golden dblclick replays; "a double-click that starts on a sticker zooms like on the canvas…"; `math.test.ts` "double click zooms about the pointer like the baseline" | cd cm wk ff | proven; iOS double-tap **manual** |
| Zoom range 0.1–5, bounded panning, centring when smaller | `math.test.ts` "boundsFor matches the worked examples…", "content smaller than the viewport collapses the bounds to the centre", "clampTransform clamps scale to [MIN, MAX]…", "a plain wheel clamps to [MIN, MAX]; ctrl … may dip below MIN"; `gestures.spec.ts` "resize re-clamps the transform" | unit, all four | proven |
| `+`/`−`/centre buttons, animated programmatic moves | golden button replays; `math.test.ts` "… zooms about the viewport centre like the baseline", "centerTransform reproduces centerOnInit and the centre button"; `controls.spec.ts` "zoom buttons work when the Controls chunk is blocked" | all four | proven |
| One transform write per frame, no React per frame | `gestures.spec.ts` "one transform write per frame" | all four | proven |
| Vectors re-render sharp after settle | `settle-crisp.spec.ts` "vector sticker is crisp after a zoom settles", "… stays crisp after a pan at the zoomed scale" (diff 0.0000 against a fresh reference); `settle.spec.ts` will-change suite | cd cm wk ff (ff: settle.spec:57 timing flake, above) | proven |
| Dynamic stickers with variable content on first render | `first-paint.spec.ts` "live nodes never show a stale value"; `boot.test.ts` fill tests; `live.test.ts` | all four, unit | proven; real clock across midnight **manual** |
| Drop shadows follow the clipped silhouette | `settle.spec.ts` "every sticker keeps the live drop-shadow filter"; visual scenes `initial`, `desktop-light-en-hover-clip` | cd (visual), all four (filter) | proven |
| Hover clips to the shape, scales 1.1× with shadow, pointer cursor, hover-capable only | `interactions.spec.ts` "hover only inside the clipped region scales the sticker" (clip, 1.1× scale); "pointer cursor on hover-capable devices; no hover scale without (hover: hover)" (added in fix round 1: `cursor: pointer` on `.clip` where `(hover: hover)` matches; on a `(hover: none)` device a tap leaves the scale at `none`); visual `desktop-light-en-hover-clip` (shadow) | hover: cd ff; cursor: cd; hover gating: cm | proven. The cursor is `pointer` on every device: Tailwind's preflight `button{cursor:pointer}` applies to the sticker button. A cursor is not visible on touch, so the hover-only part of the cursor is not observable and is not tested. |
| Bottom sheet | see "Sheet spec" below | | |
| Content by language with `en` fallback, persisted | `controls.spec.ts` "language menu switches stickers, UI strings and persists", "invalid saved preferences fall back cleanly"; `first-paint.spec.ts` "language fallback with no JS framework"; `sheet.spec.ts` "language change while open updates title and description"; `localize.test.ts`, `lang-css.test.ts`, `ui-strings.test.ts` | all four, unit | proven |
| Light, dark, system theme; background has light and dark variants | `controls.spec.ts` "theme menu sets class and color-scheme and persists"; `first-paint.spec.ts` "first frame uses the saved theme", "a saved system theme follows the OS scheme without a reload"; `theme.test.ts`, `boot.test.ts` "system theme follows prefers-color-scheme" | all four, unit | proven |
| Hover tooltips follow the cursor, hidden on coarse pointers | `interactions.spec.ts` tooltip suite (lines 201–389): "follows the cursor and shows the localised title…", "is clamped inside the viewport", "rapid hover across two stickers…", "never intercepts pointer events", "hides on mouseout…", "coarse pointer shows no tooltip"; visual `desktop-light-en-tooltip` | cd ff; coarse: cm only (skipped elsewhere: only chromium-mobile emulates `(pointer: coarse)`) | proven |
| Hash anchors: select and centre on load and `hashchange`, select pushes `#slug`, close clears it | `interactions.spec.ts` "click selects, #slug is pushed and going back clears it", "a hash change selects and re-centres…", "back and forward walk the selection history", "#dark selects without pushing…"; `first-paint.spec.ts` "the canvas stays hidden until the hashed view is applied"; `appState.test.ts` hash tests | all four, unit | proven |
| Sheet content: MDX with the full component set | `compile.test.ts` "compiles every description and content in every language", "renders dark/en including <Button> inside an exported function", "lets authored functions use React from the provider". A scratch browser check in this task (not committed) passed 16 of 16 on all four projects: `#map` renders a `.leaflet-container`; `#css` renders `<baseline-status>` and the CanIUse `iframe`; `#dark` renders its `<style>` block and the exported-function `<button>`; `#xkjd27c` renders its exported function | unit; all four (scratch) | proven; no committed e2e for Leaflet/CanIUse |
| Keyboard and a11y: focusable sticker buttons open the sheet on Enter/Space; controls keyboard-operable | `interactions.spec.ts` "keyboard: focus a sticker, Enter and Space each select it", "focusing an off-screen sticker does not scroll the viewer"; `controls.spec.ts` "menus work from the keyboard", "keyboard focus on a zoom button still opens its tooltip"; `first-paint.spec.ts` "zero-area sticker is out of the tab order" | all four (ff: :456 load flake) | proven; Safari Tab-to-button **manual** |
| Dev tooling (placement editor, SVG→CSS workbench) | — | — | **deferred to Task 4.2** (ported last, outside the budgets) |

### Sheet spec

| item | proved by | engines | status |
|---|---|---|---|
| Peek = 231 px | `sheet.spec.ts` "peek stop is 231px and content does not scroll in place"; visual "mobile sheet: peek and expanded" | cd cm ff (wk skips: no wheel) | proven |
| Expanded = `calc(100dvh − 3em)`, 796 px at 390×844 (R8) | `sheet.spec.ts` "handle toggles to expanded and back" (asserts `innerHeight − 48`); visual "mobile sheet: peek and expanded" at 390×844 | cd cm wk; ff **gap** (handle after wheel, §1) | proven, except the Firefox gap |
| Content scrolls only at expanded; wheel at peek expands (R8) | "peek stop is 231px and content does not scroll in place" | cd cm ff | proven; touch swipe at peek **manual** |
| Handle toggles; drag snaps and dismisses below peek | "handle toggles to expanded and back"; "dragging the sheet below peek dismisses it" (CDP touch); "close button and Escape dismiss the sheet" | toggle: all four (ff gap); drag: cm | proven; real-touch drag **manual** |
| Sheet gestures do not move the canvas | "wheel inside the sheet does not move the canvas", "dragging inside the sheet does not move the canvas" | cd cm ff / cm | proven |
| > 4096 px: 320 px left panel, one stop | "wide viewport shows a 320px left panel and offsets centring", "crossing 4096px swaps the stop set" | all four | proven |
| Re-centre with the panel offsets at the current zoom | `interactions.spec.ts` "selecting re-centres at the current zoom", "resizing across 4096 px flips the panel side used to re-centre"; `geometry.test.ts` viewTransformFor tests | all four, unit | proven |
| Rotation keeps the sheet at peek | "rotation keeps the sheet at peek" | all four | proven in emulation; real rotation **manual** |
| Sheet not in the first paint, even on `#slug` | `sheet.spec.ts` "deep link opens the sheet without waiting for idle"; `first-paint.spec.ts` "no-JS: a deep link does not hide the canvas" | all four | proven |
| Hashed sticker's description chunk preloaded | "deep link opens the sheet without waiting for idle"; `prefetch.test.ts` "warms the deep-linked sticker first, then the visible ones" | all four, unit | proven |
| Back/Forward close and reopen | "Back and Forward close and reopen the sheet without adding history" | all four | proven |

### Z-order and anti-goals

| item | proved by | engines | status |
|---|---|---|---|
| Z-order ascending slug, hover does not reorder | `stickers.test.ts` "slugs are unique and ascending", "matches the data the baseline app rendered, ordered by slug"; visual `initial` scenes (DOM order vs baseline screenshot) | unit, cd | proven |
| No stale or placeholder live value on any visible frame | `first-paint.spec.ts` "live nodes never show a stale value"; `boot.test.ts` fill tests | all four | proven |
| No flash of English or the wrong theme | "first frame uses the saved theme", "a saved system theme follows the OS scheme without a reload", `boot.test.ts` "applies saved ja + dark before paint" | all four, unit | proven for visible text and theme; **open**: aria-labels are English before hydration for non-English users (002, carry-forward) |
| Hit-testing agrees with `clip-path` | `interactions.spec.ts` "a mouse or tap outside the clip-path, inside the box, does not select", "hover only inside the clipped region scales the sticker"; `interactions.test.ts` "ignores a mouse click on the sticker box outside its clip" | all four | proven (browser hit-testing, no custom hit-tester) |
| `mdx.svg` and `xkjd27c.svg` follow the OS scheme | asset gate in `scripts/optimize-assets.ts` keeps their `@media (prefers-color-scheme)` rules (`docs/superpowers/baseline/assets.md`) | build | build-time only, no in-app e2e; **manual** |
| No engine traded for another | portable bench on WebKit and Firefox (§3); full e2e on four projects | wk ff | met in the bench. The Firefox handle gap (§1) is a parity regression in one engine. |
| Screenshot sharpness at settled zoom (carry-forward) | `settle-crisp.spec.ts` compares against a fresh in-build reference at 4×, not against the baseline at 5× | cd cm wk ff | **open**: not attempted. It needs a new visual scene that settles at 5× on both builds, and that is outside a docs-only audit. It is on the manual checklist. |

## 3. Budgets

5-run medians (p95 in brackets) on chromium-mobile (Pixel 7, 4× CPU,
Fast 4G) and chromium-desktop. "Baseline" is the Milestone 0 median from
`bench/results/baseline-*.json` (`docs/superpowers/baseline/report.md`).

The rule is the stricter of the absolute figure and 2× better than the
baseline (spec, "Proposed budgets"). Crisp is measured from the end of motion
(`crispAfterMotionMs`, R16). The literal `crispAfterMs` is reported beside
it.

Result files:

- `audit-mobile.json`, `audit-desktop.json`: the first-render and gestures
  benches;
- `audit-interaction-{new,baseline}-{mobile,desktop}.json`:
  `bench/interaction.bench.ts`;
- `audit-deeplink-mobile.json` and `audit-deeplink-baseline-mobile.json`:
  first render with `BENCH_QUERY='#riddler'`;
- `audit-portable-{webkit-mobile,firefox-desktop}.json`: the portable bench.

All are in `bench/results/`.

### First render

| budget | target | baseline | audit | status | file |
|---|---|---|---|---|---|
| Mobile LCP | ≤ 1,380 ms | 2,772 | **852** (864) | met | audit-mobile |
| Desktop LCP | ≤ 162 ms | 324 | **124** (140) | met | audit-desktop |
| Critical-path JS (gzip) | ≤ 100 KB | 473,458 B | mobile **8,011 B**; desktop median 41,139 B (p95 147,389¹) | met (median) | audit-mobile / -desktop |
| CLS | 0 | 0 | **0** (both) | met | both |
| No JS for first paint of non-live stickers | stickers in the HTML | 0 at FCP, first sticker 2,044 ms | **63 at FCP**, first sticker 535 ms; `first-paint.spec` "no-JS: all 63 stickers painted at baseline positions" | met | audit-mobile |
| TBT (mobile) | no regression | 726 | **0** | met | audit-mobile |
| Input readiness (mobile) | ≤ 1.5 s (plan, Global Constraints; added in Task 1.15) | not measured | **527 ms** (549) | met | audit-mobile (`firstRender.inputReadyMs`) |
| All stickers painted (mobile) | — | 5,659 | 2,641 | recorded | audit-mobile |
| Live value current (mobile) | — | 2,529 | 676 | recorded | audit-mobile |
| **Deep-link LCP** (`/#riddler`, mobile) | ≤ 1,380 ms (ruling) | 3,572 (same scenario, this task) | **1,652** (1,680) | **missed** (also over the original 1.5 s; met 2× vs its baseline, ≤ 1,786) | audit-deeplink(-baseline)-mobile |

¹ The desktop critical-path figure counts JS that finishes before LCP.
Desktop LCP is about 124 ms, so in some runs an island chunk lands before it.
The eager graph itself is the 8 KB of the mobile figure.

### Pan and zoom (mobile, main-thread `RunTask` per gesture)

| gesture | target | baseline | audit | status |
|---|---|---|---|---|
| p95 frame time, every scenario | ≤ 16.7 ms | 16.667 | **16.667** in all 4 (mobile and desktop) | met |
| wheel-zoom busy | ≤ 174 ms | 348 | **342** (380) | **missed** (−2 %) |
| drag-inertia busy | ≤ 137 ms | 275 | **348** (367) | **missed**, worse than baseline (+27 %) |
| pinch busy | ≤ 150 ms | 301 | **243** (252) | **missed** (−19 %) |
| button-zoom busy | ≤ 259 ms | 518 | **471** (502) | **missed** (−9 %) |
| Pinch frame count (carry-forward) | no regression | 93 | **64** | **missed** (motion ends sooner for the same ×3.5, 1,100 vs 1,552 ms in 002) |

All from audit-mobile.

Desktop busy figures for reference (audit-desktop vs the baseline):

- wheel 79 vs 83;
- button 78 vs 81;
- drag 90 vs 57, worse than baseline.

### Settle (≤ 150 ms from end of motion, R16)

| gesture | baseline literal | audit `crispAfterMotionMs` | audit literal `crispAfterMs` | status |
|---|---|---|---|---|
| mobile wheel | 477 | **118.5** (141.9) | 164 (188) | met |
| mobile drag-inertia | 541 | **0** (a pan keeps the promoted layer, 2.3b) | 222 (233) | met |
| mobile pinch | 351 | **135.1** (153.1) | 140 (157) | met (p95 over) |
| mobile button | 455 | **119.7** (122.9) | 467 (475) | met |
| desktop wheel | 496 | **155.9** (167.2) | 36 (37)² | **missed** |
| desktop drag-inertia | 524 | **0** | 60 (62) | met |
| desktop button | 470 | **149.6** (156.8) | 473 (488) | met at the median, no margin (p95 over) |

² On desktop the bench's wheel events go on for about 120 ms after the last
moving frame. The literal crisp figure, measured from the last input, is
therefore smaller than the figure measured from the end of motion. In 2.3b
and earlier, desktop `crispAfterMotionMs` was 236–256 ms (m2-*-desktop), so
this miss is smaller than before. It was never tuned for desktop.

Mobile files: audit-mobile. Desktop files: audit-desktop.

### Interaction

| budget | target | baseline | audit | status | file |
|---|---|---|---|---|---|
| Hover cost per `mousemove` (desktop, 4× CPU) | ≤ 7 ms (2×: ≤ 6.5) | 12.93 ms (13.43); 4.0 React commits, 2.0 style recalcs per move; M0 13.9 | **4.06 ms**; 0 React commits, 1.0 style recalc, 0 layouts per move | met | audit-interaction-{baseline,new}-desktop |
| Sheet-open input delay (mobile) | < 100 ms; 2× rule vs the new baseline: ≤ 17 | 34.4 (37.6), measured here | **30.9** (47.6) | met < 100; **2× rule missed** (spec: "keeps the 100 ms budget and gets its baseline when bench adds it") | audit-interaction-{baseline,new}-mobile |
| Sheet visible after tap (mobile, recorded) | — | 415 | 293 | recorded | same |
| wheel-zoom input delay (mobile) | < 100; ≤ 21 | 42.4 | **38.3** (43.3) | < 100 met; **2× missed** | audit-mobile |
| drag-inertia input delay | < 100; ≤ 17 | 34.8 | **33.9** (35.3) | < 100 met; **2× missed** | audit-mobile |
| pinch input delay | < 100; ≤ 17 | 34.9 | **42.0** (44.3) | < 100 met; **2× missed**, worse than baseline | audit-mobile |
| button-zoom input delay | < 100; ≤ 48 | 96.4 (106.3) | **59.0** (72.1); 2.3c 10-run p95 85.0 (R17)³ | < 100 met; **2× missed** | audit-mobile; m2c-candidate-mobile |
| Desktop wheel input delay (no spec row) | no regression | 48.0 | **70.3** (75.6) | regression (+46 %) | audit-desktop |

³ The 2.3c 10-run figure has a thin margin, and its slowest run is the cold
run 1. It is quoted, not re-tuned (R17).

### Carry-forward misses (from 002 and 003)

| item | value | status |
|---|---|---|
| Desktop raster time ≈ 2× the baseline | wheel 218 vs 121 ms, button 106 vs 47, drag 135 vs 33 (audit-desktop); mobile 94–117 vs 70–85 | **missed** (untouched by every 2.3 variant) |
| Deep-link LCP | 1,652 ms now (M1: about 1.48 s) vs 1.38 s; the cause is image download contention for the far sticker (task 1.10), and `fetchpriority` for the hashed sticker is the candidate | **missed** |
| Modulepreload cost | +64 ms LCP and +166 ms all-painted for earlier input readiness (002) | **missed** (accepted trade-off, not re-measured) |
| Pinch frame count | 64 vs 93 | **missed** (see above) |
| English aria-labels before hydration for non-English users | open (002) | **missed** (no test) |
| Silk `unload` console error in Chromium | Silk's own listener; filtered in tests | open, third-party |
| Firefox wheel-driven sheet travel | same as baseline (Task 1.13) | parity |

### Cross-engine (portable bench; no Milestone 0 portable baseline)

The comparison is with the Milestone 2 control and the 2.3b candidate files.

- **WebKit (webkit-mobile).**
  - wheel `settleMs`: 121 here, 122 for the 2.3b candidate, 232 for the
    control;
  - drag `settleMs`: 1,297 here, 1,354 for the 2.3b candidate.
- **Firefox (firefox-desktop).**
  - wheel `settleMs`: 107 here, 111 for the 2.3b candidate, 210 for the
    control;
  - wheel p95 frame: 67.6 ms here (75.4 / 81.5);
  - drag p95 frame: 49.7 ms here (49.6).

Neither engine is worse than the 2.3b candidate beyond spread. Files:
audit-portable-webkit-mobile, audit-portable-firefox-desktop.

## 4. Summary

Parity: every checklist, sheet-spec, z-order and anti-goal item is proven by
a test, with these exceptions:

- **gap**: the Firefox handle click after a content wheel (§1);
- **open**: English aria-labels before hydration;
- **manual**: real-touch pinch, flick and drag, the iOS double-tap, Safari
  Tab, the OS scheme of `mdx.svg` and `xkjd27c.svg`, and screenshot sharpness
  at 5× against the baseline;
- **deferred to 4.2**: the dev tooling.

Budgets met:

- first render (mobile and desktop LCP, JS, CLS, no-JS paint, input
  readiness 527 ms against 1.5 s);
- p95 frame;
- crisp after motion on every mobile gesture;
- hover cost;
- every input delay under 100 ms.

Budgets missed:

- mobile `RunTask` per gesture, all four gestures (drag is worse than
  baseline);
- the 2× input-delay targets, all four gestures and sheet-open (pinch is
  worse than baseline);
- desktop wheel crisp 156 ms;
- deep-link LCP 1.65 s;
- desktop raster about 2×;
- pinch frame count;
- the modulepreload cost;
- English aria-labels before hydration.

The owner's real-device items are in `manual-device-checklist.md`.
