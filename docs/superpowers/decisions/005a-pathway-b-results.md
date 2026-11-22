# 005a: Pathway B prototype results (Task 3.3)

This file records evidence only. It compares the Pathway B prototype (canvas
hybrid, `proto/`, built into `dist-proto/`) with Pathway A (`dist/`) using the
same benches, in one session, on the same machine. It contains no verdict.
Task 4.1 applies the spec's decision rule
(`docs/superpowers/specs/2026-11-20-render-performance-design.md`, "Decision
rule") to these numbers.

## How the numbers were produced

- **Build.** A and B come from one HEAD (`2ef4cf0` plus the harness commits
  below): `$env:TARGET='new'; npm run build; node proto/build.mjs`.
- **Pairing (R23).** Each step ran A (`STATIC_DIR=dist`) and then B
  (`STATIC_DIR=dist-proto`) back to back. The steps were also interleaved by
  project. Labels:
  - `m3-a`, `m3-b`: default mode;
  - `m3-a-deeplink`, `m3-b-deeplink`: `BENCH_QUERY='#riddler'`;
  - `m3-a-gpu`, `m3-b-gpu`: GPU mode, see "Fairness".
- **Runs.** `BENCH_RUNS=5` per scenario, with `BENCH=1`.
- **Profiles.** mobile is Pixel 7 emulation (DPR 2.625, 412×915), 4× CPU,
  Fast 4G. desktop is 1280×800 with no throttling. Both are unchanged from
  `PROFILES`.
- **Served build.** The runner checked that nothing listened on port 4173
  before each step and that the port was free again afterwards. Every raw run
  records `servedBuild`: `"proto"` when `window.__proto` exists, otherwise
  `"dom"`. All A runs recorded `dom` and all B runs recorded `proto` in every
  result file below.
- **Engine.** Every chromium meta records `meta.gpuFeatures`.
- **Harness changes are additive.** A is measured exactly as before:
  - `c7fa269`: `bench/proto.ts` captures `window.__proto.stats` into the
    `proto` fields of the results and adds `servedBuild`, `requests` and
    `mainBusyAfterMotionMs`.
  - `4cb6b75`: records `meta.gpuFeatures` and adds an opt-in `BENCH_GPU=1`.
  - Without `BENCH_GPU` the launch arguments are unchanged.
- **Committed results** (`15d267c`), all in `bench/results/`:
  - `m3-{a,b}-{mobile,desktop}.json`
  - `m3-{a,b}-gpu-{mobile,desktop}.json`
  - `m3-{a,b}-deeplink-mobile.json`
  - `m3-{a,b}-interaction-new-{mobile,desktop}.json`
  - `m3-{a,b}-portable-{webkit-mobile,firefox-desktop}.json`
- **Table conventions.** Each figure is the median of 5 runs, with
  [min–max] where shown. Δ is (B − A) / A. "audit" is the A reference column
  from `audit-*.json` (004), measured in an earlier session.

## Fairness and validity notes (read before the tables)

1. **Software canvas in default headless Chromium.** Playwright's headless
   Chromium 159 runs SwiftShader. `meta.gpuFeatures` reports:
   - `2d_canvas: unavailable_software`
   - `rasterization: disabled_software`
   - `gpu_compositing: disabled_software`
   - `multiple_raster_threads: enabled_on`

   As a result:
   - B's Canvas 2D drawing (sprites, LOD bitmaps, `drawImage`) rasterises in
     software on the renderer main thread. CDP's 4× CPU throttle slows that
     thread.
   - A's DOM raster runs on raster worker threads, which the throttle does not
     slow.

   So the default mobile set penalises B more than a phone with a GPU canvas
   would.
2. **GPU mode (`*-gpu`).** These runs use `BENCH_GPU=1`, which launches
   Chromium with `--enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist`.
   `meta.gpuFeatures` then reports `2d_canvas: enabled`,
   `rasterization: enabled` and `gpu_compositing: enabled` for both A and B.
   - It runs on a desktop GPU (AMD Ryzen 9 9950X host, Windows, D3D11), not a
     phone GPU.
   - A changes too: its `rasterMs` drops to about 1–14 ms because raster
     moves to the GPU.
   - Both sets are reported. Neither is the one true mobile number: a real
     phone has a GPU canvas but a genuinely slow CPU.
3. **DPR cap.** B caps its canvas at DPR 2. The mobile profile is DPR 2.625
   (Pixel 7) and WebKit is DPR 3 (iPhone 14), so B paints fewer pixels than A
   there and looks softer. `proto.dpr` is 2 on both mobile profiles. Desktop
   and Firefox use DPR 1, so the cap does not apply.
4. **Crisp metric (`crispAfterMotionMs`) differs between A and B.**
   - **A:** `gestures.bench.ts` measures the end of the last `RasterTask` in
     the trace minus the end of motion. That is valid for A's DOM raster.
   - **B:** the stickers are drawn on a canvas after handoff. The canvas
     exact repaint is Canvas 2D work on the main thread, not the trailing
     `RasterTask` the probe keys on. For B, `crispAfterMotionMs` therefore
     only reflects whatever DOM or layer raster happens last. **It is not B's
     time to crisp and is not reported as such.**
   - **B's own figure, `proto.settleSinceMotionMs`**, is measured from B's
     last transform write to the draw that painted the exact-scale bitmaps for
     the settled view. It includes B's 100 ms settle idle. It comes from
     `window.__proto.stats` (`bench/proto.ts`, `protoGestureSummary`).
   - The two metrics are **not identical**. Both appear in the tables, marked
     ≠.
5. **The busy window differs in length.** `mainBusyMs` is the main-thread
   `RunTask` time from the first input to the end of motion.
   - B's slow frames stretch its tweens and inertia (mobile default wheel
     motion is 4.8 s vs 1.0 s for A), so B's window is longer.
   - `mainBusyAfterMotionMs` (motion end to trace end) is recorded beside it.
6. **`rasterMs` measures different work.** It is trace `RasterTask` time. B
   draws stickers with Canvas 2D on the main thread, so B's `rasterMs` covers
   only the remaining DOM raster. B's sticker raster cost is inside
   `mainBusyMs` and `proto.lodRenderMs`.
7. **Desktop critical-path JS.** The A desktop runs failed the payload gate:
   the median was 147,389 B against the 100 KB budget, in both the default and
   the GPU set. This is the known race from 004, footnote ¹: on a ~130 ms
   desktop LCP the idle island chunks sometimes land before LCP.
   - B's desktop figure (24,481 B) is lower only because its extra main-thread
     work delays those islands past LCP.
   - Neither desktop figure measures the eager graph, which is 8,011 B for
     both (see mobile).
   - The runs still wrote their results.
8. **Drift of the A re-run from `audit-*`.** This is machine-state drift,
   which is why A was re-run beside B (R23).
   - Mobile busy: wheel 404 vs 342 (+18 %), pinch 315 vs 243 (+30 %).
   - Mobile gesture input delay (A re-run vs audit A): default wheel 50.1 vs
     38.3 (+31 %), pinch 36.1 vs 42.0 (−14 %), button 63.8 vs 59.0 (+8 %),
     drag 33.8 vs 33.9 (0 %); GPU wheel 34.1 (−11 %), pinch 35.7 (−15 %),
     button 74.8 [60.3–88.4] (+27 %), drag 34.0 (0 %). **A's own run-to-run
     drift on mobile input delay is about the size of the 30 % threshold.**
   - Desktop hover: 5.14 vs 4.06 ms (one 10.9 ms outlier run).
   - Firefox wheel p95: 83.3 vs 67.6.
   - LCP, TBT, input readiness and crisp are within a few %.
   - The pan-and-zoom tables carry an "audit A" column so this drift is
     visible beside each delta.

## Full budget table: chromium-mobile (Pixel 7, 4× CPU, Fast 4G)

Missed A budgets from 004 are marked **(A missed)**.

### First render

| budget (target) | A default | B default | Δ | A gpu | B gpu | Δ gpu | audit A |
|---|---|---|---|---|---|---|---|
| LCP (≤ 1,380 ms) | 872 [824–920] | 860 [836–896] | −1 % | 860 [828–1056] | 836 [812–1012] | −3 % | 852 |
| Deep-link LCP `#riddler` (≤ 1,380) **(A missed)** | 1,660 [1644–1688] | 1,660 [1640–1684] | 0 % | — | — | — | 1,652 |
| Critical-path JS gzip (≤ 100 KB) | 8,011 B | 8,011 B | 0 % | 8,011 | 8,011 | 0 % | 8,011 |
| TBT (no regression vs 726 baseline) | 3 [0–7] | **2,807** [2445–3225] | +93,467 % | 6 [0–32] | 99 [58–495] | +1,550 % | 0 |
| Deep-link TBT | 81 [67–119] | 529 [399–1231] | +553 % | — | — | — | 90 |
| CLS (0) | 0 | 0 | — | 0 | 0 | — | 0 |
| Input readiness (≤ 1.5 s) | 560 [533–567] | 555 [529–573] | −1 % | 560 [549–589] | 547 [536–549] | −2 % | 527 |
| First sticker visible | 558 [531–569] | 554 [534–565] | −1 % | 563 [545–585] | 555 [543–563] | −1 % | 536 |
| All stickers painted (recorded) | 2,642 [2597–2702] | 2,501 [2498–4609] | −5 % | 2,663 | 2,677 [2497–4460] | +1 % | 2,641 |
| Deep-link all painted | 2,688 | 4,489 [4352–4555] | +67 % | — | — | — | 2,719 |
| Long tasks during load | 2 [1–2] | 34 [33–39] | +1,600 % | 2 | 5 [4–12] | +150 % | 1 |
| JS bytes transferred | 171,078 B (25 req) | 188,398 B (26 req) | +10 % | same | same | | 171,078 |
| Image bytes / requests | 733,627 B / 56 | 733,627 B / 60 | 0 % / +7 % | same | same | | |
| Other (`fetch`) bytes / requests | 0 / 0 | 5,424 B / 48 | +48 req | same | same | | |
| B handoff: FCP → first sticker on canvas | — | 2,029 [1929–2044] | | — | 1,937 [1850–2033] | | |
| B handoff: FCP → all stickers on canvas | — | **4,272** [3900–4619] | | — | **3,542** [3500–3802] | | |
| Deep-link handoff, all | — | 4,018 [3870–4361] | | | | | |

**Second SVG fetch (carry-in 1).** B fetches every SVG's text again to
rasterise it. This shows up as 48 extra `fetch` requests (`requests.other`)
and 4 extra image requests. They transfer only 5,424 B (8,428 B in one run)
because the browser's HTTP cache serves them. The
cost is therefore requests plus a second decode, not wire bytes. It is not
neutralised: it is included in every B figure. The proto module adds 17,320 B
of transferred JS, but it is not on the critical path (8,011 B for both).

**Load cost and handoff (carry-in 2).** B's long tasks and TBT come from:

- building 55 shadow sprites on the main thread after decode;
- the first LOD renders (51 renders, 206 ms of LOD render time on mobile
  default);
- the prefetch trickle, which continues until ~8–9 s (TTI proxy 8,641 ms
  vs 2,813 ms for A).

The handoff runs from A's DOM first paint to the canvas taking over every
sticker. It is 4.27 s on mobile default, 3.54 s on mobile GPU, 183 ms on
desktop default and 191 ms on desktop GPU (from `proto.handoff*Ms`). The
~225–257 ms seen in the 3.1/3.2 scratch matches the unthrottled desktop
figure, not the mobile profile.

### Pan and zoom

Columns are A / B, with Δ. `busy` is main-thread `RunTask` from the first
input to motion end. Crisp is A's `crispAfterMotionMs` ≠ B's
`proto.settleSinceMotionMs` (note 4). "audit A" is the `audit-mobile.json`
median for p95 / busy / input delay / crisp, from an earlier session (note 8);
it applies to both tables.

**Default (software canvas)**

| gesture | p95 frame (≤ 16.7) | busy **(A missed: ≤174/137/150/259)** | busy after motion | input delay (< 100; 2×: ≤21/17/17/48) **(A missed 2×)** | crisp from motion end (≤ 150) | frames | audit A: p95 / busy / input delay / crisp |
|---|---|---|---|---|---|---|---|
| wheel-zoom | 16.7 / **200.1** [200–233] (+1,101 %) | 404 / 4,771 (+1,082 %) | 373 / 3,382 | 50.1 [34.0–52.2] / **3,617** (+7,119 %) | 119.9 ≠ 626 [586–646] (+422 %) | 60 / 30 | 16.7 / 342 / 38.3 / 118.5 |
| drag-inertia | 16.7 / 166.6 [133–183] (+900 %) | 346 / 4,404 (+1,174 %) | 334 / 3,016 | 33.8 [32.5–35.4] / 307.6 (+810 %) | 0 ≠ 216 [123–277] | 82 / 52 | 16.7 / 348 / 33.9 / 0 |
| pinch | 16.7 / 200.0 [200–217] (+1,100 %) | 315 / 6,237 (+1,882 %) | 411 / 3,116 | 36.1 [34.8–41.0] / 415.0 (+1,050 %) | 150.4 ≠ 386 [338–479] (+157 %) | 66 / 72 | 16.7 / 243 / 42.0 / 135.1 |
| button-zoom | 16.7 / 166.6 [150–183] (+900 %) | 465 / 2,219 (+377 %) | 358 / 3,239 | 63.8 [44.4–81.9] / 267.6 (+319 %) | 120.3 ≠ 320 [250–353] (+166 %) | 90 / 23 | 16.7 / 471 / 59.0 / 119.7 |

**GPU mode**

| gesture | p95 frame | busy | busy after motion | input delay | crisp from motion end | frames | audit A: p95 / busy / input delay / crisp |
|---|---|---|---|---|---|---|---|
| wheel-zoom | 16.7 [16.7–83.3] / 50.1 [50–67] (+201 %) | 291 / 1,008 (+246 %) | 294 / 1,190 | 34.1 [33.4–194.9] / 119.2 (+250 %) | 106.5 ≠ 153 [147–178] (+44 %) | 60 / 27 | 16.7 / 342 / 38.3 / 118.5 |
| drag-inertia | 16.7 / 50.0 [33–50] (+200 %) | 303 / 1,514 (+400 %) | 278 / 767 | 34.0 [33.2–35.0] / 70.7 (+108 %) | 0 ≠ 178 [170–188] | 82 / 57 | 16.7 / 348 / 33.9 / 0 |
| pinch | 16.7 / 66.7 [50–83] (+300 %) | 225 / 1,529 (+580 %) | 406 / 1,313 | 35.7 [34.3–43.9] / 114.4 (+220 %) | 123.9 ≠ 208 [200–228] (+68 %) | 63 / 61 | 16.7 / 243 / 42.0 / 135.1 |
| button-zoom | 16.7 / 66.7 [50–67] (+300 %) | 589 / 1,551 (+164 %) | 437 / 1,247 | 74.8 [60.3–88.4] / 59.0 [50.7–114.6] (−21 % vs re-run A; 0 % vs audit A 59.0) ‡ | 107.0 ≠ 191 [183–202] (+79 %) | 90 / 44 | 16.7 / 471 / 59.0 / 119.7 |

‡ **GPU button-zoom input delay is inside A's drift/noise band.** The −21 %
is against this session's A re-run (74.8, +27 % above audit A). Against audit
A (59.0) the delta is 0 %, and the A and B ranges ([60.3–88.4] vs
[50.7–114.6]) overlap. A's own drift on mobile input delay is −15 % to +31 %
(note 8), the same size as the 30 % threshold. Do not read this row as a
robust B improvement.

**Raster time ≈ 2× baseline (A missed on mobile, 004: "mobile 94–117 vs
70–85").** Trace `RasterTask` ms per gesture. **Not comparable between A and
B (note 6):** B's sticker raster is Canvas 2D on the main thread and is not
in B's `rasterMs`; it is inside `mainBusyMs` and `proto.lodRenderMs`. The Δ is
shown only so it is not mistaken for a win.

| gesture | A default | B default | Δ (not comparable, note 6) | A gpu | B gpu | Δ gpu (not comparable, note 6) | audit A |
|---|---|---|---|---|---|---|---|
| wheel-zoom | 104.3 [95.1–116.8] | 8.1 [6.9–14.3] | −92 % | 14.3 | 0.9 | −94 % | 107.3 |
| drag-inertia | 88.4 [80.4–105.9] | 6.8 [5.4–7.8] | −92 % | 2.3 | 0.8 | −64 % | 116.8 |
| pinch | 105.7 [77.1–122.1] | 6.5 [6.3–11.9] | −94 % | 1.8 | 0.7 | −61 % | 93.8 |
| button-zoom | 96.9 [80.2–114.0] | 9.0 [8.0–9.8] | −91 % | 2.1 | 1.0 | −54 % | 109.0 |

A's literal `crispAfterMs` (last input → last raster), mobile default:
wheel 164, drag 84, pinch 152, button 464. B's figures for the same metric
(wheel 4,070, drag 0, pinch 250, button 807) are listed in the result files
but are not B's crisp time, per note 4.

Pinch frame count **(A missed: 64 vs baseline 93)**:

- default: A 66, B 72 (+9 %), but B's pinch motion lasts 6,458 ms vs 1,111 ms
  for A;
- GPU: A 63, B 61 (−3 %).

### Interaction (default mode only)

| budget | A | B | Δ | audit A |
|---|---|---|---|---|
| Sheet-open input delay, mobile (< 100; 2×: ≤ 17) **(A missed 2×)** | 29.1 [19.4–41.0] | 33.3 [23.1–300.5] | +14 % | 30.9 |
| Sheet visible after tap, mobile (recorded) | 348 | 908 [764–948] | +161 % | 293 |

## chromium-desktop (1280×800, no throttle)

| budget (target) | A default | B default | Δ | A gpu | B gpu | Δ gpu | audit A |
|---|---|---|---|---|---|---|---|
| LCP (≤ 162) | 132 [128–136] | 144 [132–168] | +9 % | 128 [116–480] | 136 [128–496] | +6 % | 124 |
| TBT | 0 | 0 | — | 0 | 62 [37–136] | — | 0 |
| CLS | 0 | 0 | — | 0 | 0 | — | 0 |
| Critical JS (note 7) | 147,389 | 24,481 | n/a | 156,357 | 24,481 | n/a | 41,139 |
| Input readiness | 92 [65–106] | 106 [98–126] | +15 % | 99 | 103 | +4 % | 95 |
| First sticker visible | 49 | 19 [15–77] | −61 % | 53 | 59 | +12 % | 49 |
| All stickers painted | 78 | 116 [110–136] | +48 % | 84 | 93 | +11 % | 83 |
| B handoff, all | — | 183 [170–223] | | — | 191 [135–242] | | |
| wheel p95 frame (≤ 16.7) | 16.7 | 33.4 (+100 %) | | 16.7 | 33.3 (+100 %) | | 16.7 |
| drag p95 frame | 16.7 | 16.7 (0 %) | | 16.7 | 16.7 (0 %) | | 16.7 |
| button p95 frame | 16.7 | 33.3 (+100 %) | | 16.7 | 16.7 [16.7–33.3] (0 %) | | 16.7 |
| wheel busy | 90.5 | 838 (+827 %) | | 65.5 | 588 (+797 %) | | 79 |
| drag busy | 93.1 | 683 (+634 %) | | 90.5 | 637 (+604 %) | | 90 |
| button busy | 79.8 | 1,249 (+1,465 %) | | 74.6 | 802 (+975 %) | | 78 |
| wheel input delay (no regression vs 48.0) | 68.0 | 104.4 (+54 %) | | 33.6 | 110.1 (+228 %) | | 70.3 |
| drag input delay | 17.0 | 16.3 (−4 %) | | 15.2 | 17.1 (+13 %) | | 16.5 |
| button input delay | 2.7 | 2.5 (−7 %) | | 2.5 | 2.8 (+12 %) | | 2.4 |
| **wheel crisp from motion end (≤ 150) (A missed)** | 152.8 [149–161] | ≠ 112.4 [109–128] (−26 %, different metric) | | 102.4 | ≠ 127.8 (+25 %, different metric) | | 155.9 |
| drag crisp | 0 | ≠ 117.1 | | 0 | ≠ 124.0 | | 0 |
| button crisp (≤ 150) | 148.7 | ≠ 117.0 (−21 %, different metric) | | 102.2 | ≠ 128.3 (+26 %, different metric) | | 149.6 |
| **Raster time ≈ 2× baseline (A missed)**: wheel / button / drag `rasterMs` | 227 / 119 / 112 | 19.6 / 9.5 / 10.5 (−91 to −92 %; note 6, not comparable) | | 3.5 / 1.8 / 0.9 | 0.9 / 1.1 / 0.3 | | 218 / 106 / 135 |
| Hover cost per `mousemove` (4× CPU, ≤ 7 ms) | 5.14 [4.35–10.93] | 6.74 [5.96–7.00] | +31 % | — | — | | 4.06 |
| Hover with no sticker under cursor | 2.62 | 3.45 | +32 % | — | — | | 2.06 |

Per move, hover takes 0 React commits, 0.99 style recalcs and 0 layouts for
both A and B. B's hover still uses A's DOM `.clip` path. There is no canvas
hit-testing.

## Cross-engine regression check (portable bench, no throttle, no trace)

There are no CDP traces here, so busy, heap and raster are not available.
Headless WebKit runs rAF at about 6 Hz, so **only `settleMs` is usable on
WebKit**; its frame figures are recorded but not meaningful. `settleMs` runs
from the last input to the first rAF after `data-gesture` is removed. A's
viewer still drives that attribute in B, so it is comparable. B's own exact
paint time (`proto.settleSinceMotionMs`) is listed beside it.

| engine / gesture | metric | A | B | Δ | audit A |
|---|---|---|---|---|---|
| webkit-mobile (iPhone 14, DPR 3 → B 2) wheel | settleMs | 108 [107–124] | 135 [111–157] | +25 % | 121 |
| webkit-mobile drag-release | settleMs | 1,340 [1305–1521] | 913 [884–945] | −32 % | 1,297 |
| webkit-mobile | B `proto.settleSinceMotionMs` wheel / drag | — | 115 / 124 | | |
| firefox-desktop wheel | p95 frame | 83.3 | 33.3 [33.3–50] | −60 % | 67.6 |
| firefox-desktop wheel | over16 frames | 29 | 8 | −72 % | 30 |
| firefox-desktop wheel | settleMs | 108 [104–111] | 112 [109–116] | +4 % | 107 |
| firefox-desktop drag-release | p95 frame | 50.0 | 33.3 [16.7–33.3] | −33 % | 49.7 |
| firefox-desktop drag-release | settleMs | 1,144 | 1,140 | 0 % | 1,137 |
| firefox-desktop | B `proto.settleSinceMotionMs` wheel / drag | — | 126 / 121 | | |

**WebKit rows are not a robust win or regression.** This is headless
Playwright WebKit, whose rAF cadence in this bench is about 6 Hz, so its
timing is not representative of a device. The wheel +25 % has overlapping A/B
ranges ([107–124] vs [111–157]) and is treated as inside the noise band. The
drag-release −32 % (1,340 vs 913, non-overlapping ranges) is **unexplained**:
both builds use A's viewer to drive `data-gesture`, and no mechanism for B
ending the drag inertia sooner was identified. Neither row should be read as
a WebKit win or regression for B without a real-device or headed-WebKit
check.

### Which LOD path each engine took (carry-in 4)

`createImageBitmap(svgBlob)` is rejected in all three engines, so SVG
re-rasterisation runs on the main thread. The worker path (`?lod=worker`) is
off by default and was not benchmarked.

| engine | `proto.lodPath` | `proto.mainVia` | `proto.dpr` |
|---|---|---|---|
| chromium-mobile (default and GPU) | `main` | `offscreen` | 2 |
| chromium-desktop | `main` | `offscreen` | 1 |
| webkit-mobile | `main` | `canvas+createImageBitmap` (no OffscreenCanvas) | 2 |
| firefox-desktop | `main` | `offscreen` | 1 |

## LOD churn during gestures (carry-in 3)

Figures from `window.__proto.stats`, as deltas over one gesture (medians, from
the `proto` fields of the results).

| set / gesture | LOD renders | LOD render ms | evictions | stale stores | fallback draws | misses | prefetch rendered |
|---|---|---|---|---|---|---|---|
| mobile default wheel | 59 | 428 | 27 | 0 | 0 | 331 | 19 |
| mobile default drag | 29 | 104 | 0 | 0 | 5 [0–5] | 7 | 21 |
| mobile default pinch | 62 | 366 | 25 | 0 | 0 | 246 | 25 |
| mobile default button | 65 | 331 | 27 | 0 | 0 | 138 | 28 |
| mobile GPU wheel | 65 | 64 | 27 | 0 | 0 | 147 | 25 |
| mobile GPU drag | 19 | 23 | 0 | 0 | 0 | — | — |
| mobile GPU pinch | 62 | 73 | 25 | 0 | 0 | — | — |
| mobile GPU button | 67 | 74 | 33 | 0 | 0 | — | — |
| desktop default wheel / button | 75 / 80 | 61 / 51 | 20 / 20 | 0 | 0 | — | — |
| webkit-mobile wheel / drag | 39 / 20 | 13 / 7 | 21 / 0 | 0 | 0 / 1 | 50 / 10 | 9 / 9 |
| firefox-desktop wheel / drag | 75 / 0 | 107 / 0 | 13 / 0 | 0 | 0 | 272 / 0 | 0 |

Intermediate LOD levels during tweens cause the evictions.

- **Default mode:** the single largest JS draw is small (`proto.maxDrawMs`
  3.5–5.6 ms per mobile gesture, 6.0 on first render).
- **GPU mode:** `proto.maxDrawMs` is 41–56 ms on every mobile gesture (wheel
  52.3, drag 41.4, pinch 55.6, button 51.3) and 50.1 on first render. This is
  **unexplained**; a GPU flush or readback inside the timed draw is a
  possibility, not a finding.
- **Where frame cost goes (reasoned, not proven).** In default mode the frame
  cost appears to be dominated by software canvas raster and LOD renders on
  the throttled main thread (notes 1 and 6). The default→GPU contrast supports
  this (mobile wheel `proto.lodRenderMs` 428 → 64, B busy 4,771 → 1,008), but
  no per-task attribution was captured, so it is an explanation, not a
  measurement.

## Memory (carry-in 5)

| figure | how | A | B |
|---|---|---|---|
| Peak JS heap during a gesture, mobile (per-gesture medians) | **measured** (CDP `JSHeapUsedSize`) | 6.2–6.3 MB | 6.2–7.1 MB |
| Peak JS heap, desktop (per-gesture medians) | **measured** | 6.1–6.3 MB | 6.9–7.0 MB |
| Canvas backing store, mobile | **computed** from `proto.backingBytes` (W × H × DPR² × 4) | — | 5.53 MB |
| Shadow sprites (55), mobile | **computed** (`proto.spriteBytes`) | — | 5.31 MB |
| LOD cache after load, mobile | **computed** (`proto.lodBytes`) | — | 8.97 MB |
| Canvas total after load, mobile / desktop | **computed** (`proto.canvasBytes`) | — | 19.8 MB / 12.1 MB |
| Canvas peak during a gesture, mobile default | **computed** (`proto.canvasPeakBytes`) | — | wheel 83.4 MB, pinch 83.5 MB, button 70.3 MB, drag 21.4 MB |
| Canvas peak, mobile GPU | **computed** | — | wheel 86.0 MB, pinch 83.5 MB, button 86.3 MB |
| LOD cache cap | prototype constant | — | 96 MiB (100.7 MB); wheel peak LOD up to 78.4 MB in one run |
| GPU / decoded-image / compositor memory | **not measured** | — | — |

At 390×844 and DPR 3 (an iPhone 14 class device), the canvas would need about
5.3 MB of backing store at B's capped DPR 2. Sprites and LOD bitmaps come on
top, so the peak total reaches about 84–86 MB with the cache below its cap.
**The iOS Safari canvas memory limit cannot be measured here.** No device
figure is cited. It is on the real-device checklist below. Only the JS heap
was measured. `Performance.getMetrics` has no canvas or GPU memory counter,
and no other GPU or backing-store memory source was captured, so the canvas
rows are computed from B's own stats.

## Known B correctness gaps (carry-in 7, listed, not solved)

- **`shape()` clip.** `pedantic` uses a `shape()` clip and is drawn
  unclipped (`proto.unclipped` = 1 in every chromium run).
- **Z-order.** Five content-over-image overlaps paint in the wrong order:
  - `24h` / `karaoke`
  - `bad-translations` / `yofukashi`
  - `css-is-awesome` / `mdx`
  - `css-is-awesome` / `vscode`
  - `dd-mmm-yyyy` / `earth`
- **No a11y or hit-test rewrite.** B relies on A's DOM buttons, and the
  hover figures above are A's DOM path.
- **Background tile lags the scheme by 2 frames.**
- **WebKit themed SVGs.** Under emulated dark, WebKit's own `<img>` disagrees
  with B's scheme-resolved theme SVG rendering, and the result is unstable.
- **No OffscreenCanvas in Playwright WebKit.** B falls back to canvas plus
  `createImageBitmap(canvas)` (see the table above).
- **No SVG rasterisation off the main thread.** `createImageBitmap(svgBlob)`
  is rejected in every engine, and the worker is opt-in only.
- **Exact renders are not tiled.** The 3.1/3.2 scratch measured single exact
  jobs of 122–139 ms at 5× and a base job of ~36 ms at 4× CPU.
- **Synchronous fallback draws.** A sticker that scrolls in before its base
  prefetch lands is drawn synchronously (`fallbackDraws`: 5 in mobile default
  drag, 1 in WebKit drag).
- **Each SVG is fetched and decoded twice** (see first render).
- **Chromium-first.** B was built and checked mainly in Chromium.

## Engine coverage of these runs

| project | first-render | gestures | interaction | portable | modes |
|---|---|---|---|---|---|
| chromium-mobile (Pixel 7 emulation) | ✓ (+ deep link) | ✓ | sheet-open | — | default, GPU (deep link and interaction: default only) |
| chromium-desktop | ✓ | ✓ | hover | — | default, GPU (interaction: default only) |
| webkit-mobile (Playwright WebKit, iPhone 14 emulation) | — | — | — | ✓ (settleMs only) | default |
| firefox-desktop | — | — | — | ✓ | default |

No real iOS Safari, Android Chrome or physical GPU-phone runs were made.

## Real-device checklist (not measurable here)

- B's canvas and LOD memory against the iOS Safari canvas limit (peak
  computed ~86 MB at DPR 2, cap 96 MiB). Check for canvas loss or crashes on
  long pan/zoom sweeps.
- Frame time, busy and handoff on a mid-range Android phone with a real GPU
  canvas. That device sits between the default (software canvas) and GPU
  (desktop GPU) sets here.
- Sharpness of B at DPR 3 with the DPR-2 cap.
- WebKit themed SVG rendering under real dark mode.
