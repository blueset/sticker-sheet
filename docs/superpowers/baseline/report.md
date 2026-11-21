# Milestone 0 baseline: measured numbers and suspect verdicts

Recorded 2026-11-21 on the unchanged app (Next 16 static export, `out/`, 63 stickers, copied to `.baseline-site`). Nothing under `src/` was touched. Raw data: `bench/results/baseline-mobile.json`, `bench/results/baseline-desktop.json` (every run is embedded under `raw`), `bench/results/baseline-probes.json` (suspect probes), `bench/results/probe-no-filter-{mobile,desktop}.json` (filter A/B).

Machine: Windows 11, Ryzen 9 9950X (32 threads), Chromium 159 headless shell (software compositing), Playwright 1.65.1, Node 26. Mobile profile: Pixel 7 emulation, 4× CPU, Fast 4G (165 ms, 1,012,500 B/s down, 168,750 B/s up). Desktop: 1280×800, no throttling. Each number is the median of 5 fresh-context cold-cache runs (`median / p95`) unless noted.

## Headline numbers

First render:

| Metric | Mobile | Desktop |
|---|---|---|
| FCP (ms) | 724 / 756 | 164 / 212 |
| LCP (ms) | **2,772 / 3,020** | 324 / 376 |
| TBT, FCP→TTI proxy (ms) | 726 / 928 | 0 / 0 |
| CLS | 0 / 0 | 0 / 0 |
| First sticker visible (ms) | 2,044 / 2,159 | 176 / 211 |
| Live (dynamic) sticker shows today's date (ms) | 2,529 / 2,842 | 209 / 261 |
| All 63 stickers painted, images decoded (ms) | 5,659 / 5,859 | 291 / 345 |
| Critical-path JS, gzip-9 of bodies finished before LCP (B) | **473,458** | 473,458 |
| Transferred: JS / CSS / img / font / html (B) | 439,685 / 79,846 / 2,313,268 / 490,076 / 35,446 | same |
| Image bytes received before LCP (B) | 21,399 | n/a |

Gestures (median / p95). `frames over 16.7` is a count per gesture, `busy` is renderer-main-thread `RunTask` time inside the gesture, `crisp` is the proxy defined below, `input delay` is the worst event lateness.

| Scenario | Profile | p95 frame (ms) | frames >16.7 / >33 | busy (ms) | raster (ms) | crisp (ms) | input delay (ms) | peak JS heap (MB) |
|---|---|---|---|---|---|---|---|---|
| wheel-zoom | mobile | 16.667 / 16.667 | 0 / 0 | 348 / 410 | 70 / 89 | **477 / 482** | 42 / 46 | 11.3 |
| drag-inertia | mobile | 16.667 / 16.667 | 0 / 0 | 275 / 320 | 73 / 91 | 541 / 559 | 35 / 48 | 11.5 |
| pinch | mobile | 16.667 / 16.667 | 0 / 0 | 301 / 323 | 75 / 93 | 351 / 374 | 35 / 40 | 11.6 |
| button-zoom | mobile | 16.667 / 16.667 | 1 / 1 | 518 / 553 | 85 / 109 | 455 / 467 | **96 / 106** | 11.8 |
| wheel-zoom | desktop | 16.667 / 16.667 | 0 / 0 | 83 / 84 | 121 / 128 | 496 / 513 | 48 / 52 | 10.5 |
| drag-inertia | desktop | 16.667 / 16.667 | 0 / 0 | 57 / 58 | 33 / 35 | 524 / 529 | 15 / 17 | 9.8 |
| button-zoom | desktop | 16.667 / 16.667 | 0 / 0 | 81 / 83 | 47 / 51 | 470 / 475 | 3.6 / 4.0 | 9.7 |
| pinch | desktop | skipped (needs touch; absent from the JSON) | | | | | | |

Frame counts per gesture: 50–93. Wheel-zoom reaches ×2.8 on mobile (60 events) and clamps at ×5 on desktop. Pinch reaches ×3.5, button-zoom ×5, drag-inertia moves about 440 px on mobile.

Reading the table:

- **The baseline already meets the p95-frame (16.7 ms) and zero-layout-shift budgets in this harness.** Every scenario shows p95 = one vsync and CLS = 0. The gap to the budgets is in first render (LCP, JS size), settle (crisp) and, for button-zoom on mobile, input delay (96 ms median, 106 ms p95, right at the 100 ms line).
- Software raster and a 32-thread host flatter frame time. CPU throttling slows the main thread only; raster workers are not throttled. Treat frame-time results as a floor, and `busy` (main-thread ms, which *is* throttled) as the more telling figure: mobile wheel-zoom keeps the main thread busy for 348 ms of a ~1.0 s gesture.

## Suspect verdicts (spec "What the code does today")

1. **Empty first paint: CONFIRMED.** `out/index.html` has 0 sticker buttons and 0 `<img>`; with JS disabled the page still has 0. On mobile FCP is 724 ms but the first sticker appears at 2,044 ms (stickersAtFcp = 0 in all 5 runs), 396 ms after the 1.18 MB main chunk finishes downloading (1,648 ms) and hydrates.
2. **Runtime MDX compiler: CONFIRMED.** The main chunk (`aa5a262c…js`, 1,175,398 B raw, 331,510 B gzip-9) carries the MDX stack (mdast/micromark/mdxJsx/hast, `next-mdx-remote` serialize, acorn) in a 444–812 KB band, about 31% of the chunk. It runs at load: JS coverage shows 30.6% of that band executed, and the mobile CPU profile attributes a median 355 ms (3 loads) of self time to the band, 19% of all 1,860 ms JS self time. Dynamic stickers lag the first sticker by 485 ms on mobile (2,529 − 2,044) and 33 ms on desktop.
3. **Live filters on every sticker: CONFIRMED as a raster cost, but not what limits frames or crispness here.** All 63 stickers compute `filter: drop-shadow(…) drop-shadow(…)`. Forcing `filter: none` on all stickers (A/B, 3 runs per scenario) cuts raster time by 57% (wheel-zoom, mobile 70 → 30 ms), 58% (drag 73 → 30), 76% (pinch 75 → 18), 60% (button-zoom 85 → 34); desktop wheel-zoom 121 → 50 ms (−59%). p95 frame stays at 16.667 ms and crisp moves by 10 ms or less on mobile (31 ms on desktop wheel-zoom, 496 → 465). So filters double raster work but the baseline frame cadence is gated elsewhere in this harness.
4. **Re-raster on settle: CONFIRMED.** `Canvas.tsx` adds `zooming` (→ `will-change: transform`) on `onTransformed` and drops it 100 ms after the last one. Trace of a 40-wheel gesture (3 runs per profile): the class flips off at +139–141 ms desktop (+226–327 ms mobile), is re-added 1 ms (desktop) to 10 ms (mobile) later, and finally goes off at +450–465 ms desktop (+617–1,007 ms mobile). On desktop 24 `RasterTask`s (46 ms) start 1.3 ms after that last `will-change: auto` flip and finish at +500–513 ms; the last in-gesture raster ends 455–481 ms before the final wheel event. Mobile: 40 tasks, 120–141 ms of raster after the last input. This is the `crispAfterMs` of 351–541 ms (budget 150 ms). The "100 ms" is not the real delay: the zoom animation tail and the double toggle make it 4–10× longer.
5. **Per-event React work: CONFIRMED for the hover tooltip, REFUTED during pan/zoom.** Moving the mouse over a sticker costs 4.0 React commits per `mousemove` (0.02 over empty canvas), 2.03 ms task time and 1.99 style recalcs per move at 1× CPU (0.41 ms, 0 recalcs over empty canvas); at 4× CPU 13.9 ms vs 2.2 ms per move, which is most of a 16.7 ms frame. During a wheel-zoom gesture React commits only 1–2 times in total (and twice after it), so there is no per-frame React work in pan/zoom. INCONCLUSIVE half: whether all 63 `Sticker`s re-render. A commit count cannot show breadth; the source uses `useShallow` selectors and the 0.47 ms script time per move (1×) argues against 63 re-renders.
6. **Eager payload: CONFIRMED, with one correction.** 56 image requests, 2,313,268 B of images and 490,076 B of fonts, but only 21,399 B of images arrive before LCP and all stickers are painted at 5,659 ms on mobile. None of the 55 sticker `<img>`s has `loading`, `decoding`, `fetchpriority` or `width`/`height`. `public/stickers` is 62 files, 4,054,493 B. Correction: the ~100 KB of sticker YAML (63 files, 102,850 B) is **not** in a JS chunk. It ships as an inline RSC flight payload in `index.html` (one script of 83,533 B; the page is 129,451 B raw, 28,135 B brotli), and the 55 `/stickers/*` image paths appear in `index.html`, not in any chunk. The 4-embedded-raster-SVG claim was not re-measured.
7. **Render-blocking third-party CSS: CONFIRMED, small effect on FCP, larger on LCP.** `<head>` has 5 stylesheets, 2 third-party (`rsms.me/inter/inter.css`, cdnjs `cc-icons`), finishing at 528–529 ms on mobile. They are not the gating sheet for FCP (the local `394c817a…css` ends at 637 ms). A/B on mobile, 5 alternating loads each (third-party sheets fulfilled empty): FCP 668 → 656 ms (−12 ms), LCP 2,744 → 2,488 ms (−256 ms, −9%). The LCP gain is probably the 490 KB of Inter font files no longer competing for bandwidth, not the blocking. The probe uses its own FCP/LCP observer, so its absolute values differ slightly from the bench table.
8. **Heavy dependency set: CONFIRMED (only some on the critical path).** Before LCP the page loads 11 scripts, 473,458 B gzip-9 (438,760 B transferred). `b905cd92…` (React DOM + Next runtime) is 69,953 B gzip; the main chunk is 331,510 B and holds the MDX stack, Silk (band 258–386 KB, 7.5% executed), Radix and `react-zoom-pan-pinch`. Only 21.9% of the main chunk's bytes execute during load. Leaflet is a separate 155 KB chunk that is not requested before LCP. `vaul` (imported only by the unused `ui/drawer.tsx`), `framer-motion` (not imported in `src/`), `tweakpane` (`DebugTools`, rendered only when `NODE_ENV === "development"`) and `react-scan` (devDependency) leave no marker in any shipped chunk. `@mantine/hooks` (`useMediaQuery` in `CursorTooltip`/`Panel`) and `zustand` are too small to fingerprint in minified code: INCONCLUSIVE on their size, they are imported.

## Variance

Headline metrics are stable: mobile LCP spread 10.5%, mobile FCP 5.5%, critical JS 0%, byte counts ≤ 0.03%, p95 frame 0% in every scenario, crisp 4–7% (mobile) and 2–5% (desktop). Spread here means (max − min) / median over the 5 runs. Less stable: gesture `busy` 12–21% on mobile (1–5% desktop) and input delay 15–45% on mobile (drag-inertia 45%), 14–39% on desktop.

Flagged, kept in the data and not discarded:

- **Mobile TBT spread 31.8%** (>30%): one run at 928 ms against 697–739 ms for the other four. The median (726 ms) is the number to use.
- Small absolute values or counts show large relative spread: desktop FCP 61% (164 vs 212 ms p95; `stickersAtFcp` is 0 or 63 across runs because FCP can land before or after the first sticker batch on a fast host), desktop LCP 19.8%, desktop wheel-zoom input delay 38.5%, button-zoom `over16/over33` counts 1–2 (100% on a count of 1), `traceOver33` and `rasterAfterInputMs` (120% on a ~15 ms value).
- Desktop first render is so fast (LCP 324 ms) that 50 ms of noise is 15%. Relative comparisons on desktop first render should use the median of at least 5 runs and a margin.

## Definitions

- **TBT** = Σ over long tasks (renderer main thread, > 50 ms) of (task duration clipped to the window − 50 ms), window = FCP → TTI proxy. TTI proxy = Lighthouse-style: starting from FCP, the first point where a 5 s window contains no long task, taking the end of the last long task before it.
- **CLS** = sum of all layout-shift entries without recent input.
- **allStickersPaintedMs** = first time ≥ 63 stickers exist, every one passes `checkVisibility`, and every `<img>` is `complete && naturalWidth > 0`. **liveCurrentMs** = time today's `en-GB` date (`dd MMM yyyy`) appears in the page text, `null` on timeout (caveats: ICU's "Sept", midnight rollover).
- **criticalPathJsGzip** = gzip level 9 of the decoded bodies of scripts whose resource-timing `responseEnd` ≤ LCP. The static server uses brotli, so transferred bytes are smaller (main chunk 292,983 B transferred vs 331,510 B gzip-9).
- **Frames / p95 / over16 / over33**: deltas between consecutive `requestAnimationFrame` timestamps from the first input event to the last frame whose layer transform changed. rAF timestamps are coarsened to 0.1 ms, so deltas within 0.4 ms of one vsync are snapped to 16.667 ms; anything longer is kept as measured. "Over" means > 16.7 / > 33 ms. These are main-thread frame cadence; compositor-only work is not visible.
- **traceOver16 / traceOver33** (extra, not the headline): gaps between consecutive renderer `DrawFrame` events inside the gesture window. `DrawFrame` is emitted only for frames with damage (58 `DrawFrame` vs 126 `BeginFrame` on a drag) and jitters ±2 ms, so these counts are an upper bound (mobile wheel-zoom: 24 over 16.7, 2 over 33). This needs two extra trace categories, `devtools.timeline.frame` and `disabled-by-default-devtools.timeline.frame`, in addition to the brief's two.
- **mainBusyMs** = Σ renderer-main (`CrRendererMain`) `RunTask` durations, µs→ms, clipped to the window. **rasterMs** = Σ `RasterTask` durations in the window, on raster threads.
- **crispAfterMs (PROXY)** = last input event → end of the last `RasterTask`, clamped at 0. It includes the inertia/animation tail and the page's settle timers and does not prove the pixels are sharp, only that raster work stopped.
- **Peak heap** = max over 100 ms CDP `Performance.getMetrics` samples of `JSHeapUsedSize` (JS heap only; no GPU, decoded-image or compositor memory).
- **inputDelayMs** = worst (`performance.now()` when a capture-phase window listener ran) − `event.timeStamp` over the gesture's input events.
- **Pinch** uses CDP `Input.dispatchTouchEvent` with two touch points, mobile profile only.

## Caveats

- Software compositing and unthrottled raster workers: raster ms and `crisp` are not GPU- or phone-representative. Frame cadence on a real mid-range phone is likely worse than the 16.7 ms measured here; the owner's devices remain part of the acceptance check.
- The two third-party stylesheets and the Inter font files come from the real network, not a mock, in all runs.
- `hover` and `settle` probes (`bench/probes.ts`) use baseline internals (`#canvasWrapper.zooming`, a React DevTools hook stub) and cannot run on the rewrite. The contract bench (`first-render` / `gestures`) can.
- `cpu` profile uses mobile throttling with 250 µs sampling; the MDX/Silk bands come from marker strings and are approximate (±tens of KB).

## Reproduce

```powershell
npx serve out -l 4173 --no-clipboard     # or let playwright's webServer do it
$env:BENCH='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'
npx playwright test bench --project=chromium-mobile  --reporter=list   # 25 tests, ~5.4 min
npx playwright test bench --project=chromium-desktop --reporter=list   # 20 + 5 skipped (pinch), ~2.2 min
node bench/probes.ts                                                   # TARGET=baseline; all probes
```

A/B for suspect 3: `BENCH_LABEL=probe-no-filter BENCH_RUNS=3 BENCH_PROBE_CSS='{stickers}{filter:none !important}'` with `bench/gestures`.
