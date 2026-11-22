# 006: Final verification (Task 4.3, part b)

This records the final checks on the post-cleanup HEAD `a7789e4`
("chore: mark shadcn config as non-RSC for the Astro app"). No production
code, test or config was changed for it. The rulings that apply are R19/R20
(misses and known flakes are recorded, not tuned), R30 (where and how this
runs) and R32 (the audit numbers in `004-parity.md` stand; the final benches
are a drift check only).

Machine: Windows 10.0.26300, AMD Ryzen 9 9950X, Node v26.12.1, npm 12.2.0,
Playwright 1.65.1, Chromium 159.0.8154.6 (from the bench metadata). CI uses
Node 22.

## 1. Unit tests, build, type check

| command | result |
|---|---|
| `npm test` | `Test Files 24 passed (24)`, `Tests 268 passed (268)` |
| `$env:TARGET='new'; npm run build` | `1 page(s) built`, `Complete!`; 516 files in `dist` |
| `npm run check` | `6 errors`, `0 warnings`; all 6 in `bench/probes.ts` (lines 266, 327, 343, 344, 394 ×2), the known set |

## 2. End-to-end, all four projects

Commands (one project per run, against the build above; port 4173 had no
listener before each run, so Playwright started a fresh `serve dist`):

```
$env:TARGET='new'; $env:STATIC_DIR='dist'; $env:VISUAL_MAX_DIFF='0.01'; npx playwright test --project=chromium-desktop
$env:TARGET='new'; $env:STATIC_DIR='dist'; npx playwright test --project=chromium-mobile
$env:TARGET='new'; $env:STATIC_DIR='dist'; npx playwright test --project=webkit-mobile
$env:TARGET='new'; $env:STATIC_DIR='dist'; npx playwright test --project=firefox-desktop
```

Each project now lists 189 tests; 004 §1 listed 185. The four new tests are
the three `prod-clean.spec.ts` tests (Task 4.2; filesystem checks that run on
chromium-desktop only and skip elsewhere) and `interactions.spec.ts`
"pointer cursor on hover-capable devices; no hover scale without
(hover: hover)" (commit `3c7828d`, added in the 2.4 fix round after the 004
counts were taken; it runs on every project).

| project | 004 §1 (passed / skipped / failed) | final | expected from the new tests | difference explained |
|---|---|---|---|---|
| chromium-desktop | 143 / 42 / 0 | **147 / 42 / 0** | +4 passed | yes |
| chromium-mobile | 127 / 58 / 0 | **127 / 61 / 1** | +1 passed, +3 skipped | 1 failure, see below |
| webkit-mobile | 111 / 74 / 0 | **112 / 77 / 0** | +1 passed, +3 skipped | yes |
| firefox-desktop | 130 / 52 / 3 | **134 / 55 / 0** | +1 passed, +3 skipped | the 3 known Firefox failures all passed this run |

### chromium-mobile: `tests/visual/baseline.spec.ts:342` "visual baselines › mobile sheet: peek and expanded"

- Error: `expect(page).toHaveScreenshot(expected) failed`, `811 pixels
  (ratio 0.01 of all image pixels) are different`, snapshot
  `mobile-light-en-sheet-expanded.png`. The peek screenshot in the same test
  matched.
- The diff image shows the difference is confined to the sheet handle and the
  sheet's top edge: in the new screenshot the handle has a dark outline
  (a focus ring after the `handle.click()`); the committed baseline snapshot
  has none. 811 / (390 × 844) ≈ 0.25 % of the pixels.
- Re-run alone once (R19), same command with
  `tests/visual/baseline.spec.ts:342`: **failed again**, same snapshot. It is
  deterministic on this machine, not a flake.
- Diagnostic run (not part of the counts above), same test with
  `$env:VISUAL_MAX_DIFF='0.01'`, the R12 tolerance for new-vs-baseline
  comparisons: `1 passed`.
- It is not caused by a production change since the audit. In the
  temporary worktree (§4), the build of `ef581f0~1` (`d166b58`) and the
  build of HEAD are byte-identical (516 files, 0 SHA-256 differences in the
  same checkout path). The test file and the snapshot are unchanged since
  the audit commit `3c1b300`.
- Follow-up (R33). These runs are uncommitted scratch; the commands and
  outputs are in the task-4.3 report.
  - **Deterministic.** HEAD failed 3 out of 3 single runs (`-g "mobile sheet"
    --project=chromium-mobile`) and 3 out of 3 with
    `--workers=1 --repeat-each=3`. Every run had exactly 811 px different.
  - **No commit passes.** I built `d5b2b9e` (audit) and `3c1b300` (the 004
    record) in a temporary worktree after `npm ci`, and ran the test with each
    commit's own spec and config. Both failed with 811 px. Those two builds
    are byte-identical to each other (516 files). They match HEAD's `dist`
    apart from the astro-island uids, which differ between the checkouts
    (the cause was not traced).
    The browser is the same (Playwright 1.65.1 from the same lockfile,
    Chromium 159.0.8154.6 per the audit bench JSONs). So the "0 failed" in
    004 §1 is not reproducible from any of the three builds tested.
  - Not verified: the env of the 004 chromium-mobile run. Neither 004 nor
    the task-2.4 report records `VISUAL_MAX_DIFF` for it. The most likely
    explanation is that it ran at `0.01`: earlier tasks ran this mobile scene
    at 0.01 (Task 1.14 in `progress.md`), and the test passes at 0.01.
  - **What holds focus.** I diagnosed this with a scratch Playwright script:
    Pixel 7 context, 390×844, `/#dark`, light, en.
    - Before the click, in both the rewrite and the baseline Next site
      (`.baseline-site` on :4190), the handle `<button aria-label="Toggle panel
      size">` is `document.activeElement` and matches `:focus-visible`. The
      sources suggest the focus is programmatic and set when the sheet opens
      (inferred, not traced). The peek snapshot has the same ring on both
      sides, which is consistent with it matching.
    - After `handle.click()` on HEAD, the handle (`data-silk="a16"`) still
      holds focus and still matches `:focus-visible`. Its computed outline is
      `auto 1px rgb(16,16,16)` and its box-shadow is `none`.
    - After the same click on the baseline, focus has moved to the Silk view
      `<div data-silk="a1 …" aria-labelledby aria-describedby>`. The handle
      is not focus-visible and has `outline-style: none`.
  - **Which rule draws the ring.** No author stylesheet rule with a focus
    selector matches the handle; I scanned every same-origin `cssRules`,
    including the rules nested in `@layer`. Together with the computed
    `auto 1px` value, this points to Chromium's UA default
    `:focus-visible { outline: auto 1px -webkit-focus-ring-color }` rather
    than Silk, Tailwind or `src/` CSS. This is an inference; the UA
    stylesheet was not inspected directly.
  - **Why focus differs.** This is inferred from the source; I did not trace
    it at runtime.
    - The baseline `Panel.tsx` (`baseline-m0:src/app/components/Panel.tsx`,
      identical to the copy at `a929f5b^`: the lines quoted here are
      unchanged, and `git diff a929f5b^ baseline-m0` on the file is empty)
      toggles the stop with a plain `onClick` → `setActiveSnap`. The
      controlled detent therefore becomes 2 before the travel, and its
      `onTravel` handler (active only when `activeSnap === 2`) calls
      `viewRef.focus()` while `progress < 0.999` during the expand travel.
    - The rewrite (`src/islands/Sheet.tsx`, since `5e193e0`) uses
      `<Silk.Trigger action="step">`. Its `onTravel` guard `detent === 2` is
      the same, but `detent` only becomes 2 through `onActiveDetentChange`,
      evidently too late for the handler to fire during this travel. Focus
      stays on the handle.
  - **Real touch.** With a `hasTouch` context and `page.touchscreen.tap` on
    the handle, HEAD behaves exactly like the click: the handle keeps focus,
    `:focus-visible` is true and the ring is visible. The baseline moves
    focus to the view with no ring. A likely explanation, not traced, is
    that the tap does not re-focus an already-focused element, so the
    focus-visible state persists. Scratch screenshots confirmed both. No
    real device was tested.
- Classification: **repo-caused, not environmental**. It is a deterministic
  focus-handling difference from the baseline. It is present in the three
  builds tested (`d5b2b9e`, `3c1b300`, HEAD). Its origin in the sheet island
  (`5e193e0`) is inferred from the source; that commit was not built. 004's
  "0 failed" most likely came from an unrecorded `VISUAL_MAX_DIFF=0.01`
  (not verified).
  - As a product matter it is a minor parity regression, not a functional
    defect. After expanding with a tap, the UA focus ring stays on the
    handle, where the baseline moves focus into the sheet. The ring also
    shows at peek on both sides, which is pre-existing behaviour.
  - It is within the R12 comparison tolerance. It is not one of the known
    three. Nothing was changed; the controller decides.

### firefox-desktop

`settle.spec.ts:57`, `interactions.spec.ts:456` and `sheet.spec.ts:209`
(the Firefox sheet-handle-after-content-wheel gap, R20) all passed in this
one run. This does not change their classification in 004: all three are
intermittent, and one passing run is consistent with the rates recorded
there.

## 3. Final first-render benches vs the audit

Commands (port 4173 free before each run; no `BENCH_PROBE_*`, no
`BENCH_GPU`, as in the audit metadata):

```
$env:BENCH='1'; $env:TARGET='new'; $env:STATIC_DIR='dist'; $env:BENCH_LABEL='final'; $env:BENCH_RUNS='5'; npx playwright test bench/first-render.bench.ts --project=chromium-mobile
(same) --project=chromium-desktop
```

Both passed (`5 passed`). The desktop payload gate passed on the median
(`critJS median 80421 over [8011, 147389, 80421, 147389, 8011]`), so
`BENCH_PAYLOAD_GATE=0` was not needed. The benches wrote the summaries
themselves (`writeSummary`, the same code as `node bench/summarize.ts final
<profile>`). Files: `bench/results/final-mobile.json`,
`bench/results/final-desktop.json`, against `audit-mobile.json` and
`audit-desktop.json`. Both sides: 5 runs, Chromium 159.0.8154.6, same
profiles (mobile: 4× CPU, 165 ms latency, 1,012,500 B/s down; desktop: no
throttling).

5-run medians, p95 in brackets, ms unless stated:

| metric | mobile audit | mobile final | Δ | desktop audit | desktop final | Δ |
|---|---|---|---|---|---|---|
| LCP | 852 (864) | 836 (896) | −1.9 % | 124 (140) | 136 (152) | +9.7 % |
| FCP | 696 (700) | 708 (744) | +1.7 % | 124 (140) | 136 (152) | +9.7 % |
| First sticker visible | 535.5 | 545.3 | +1.8 % | 49.1 | 46.5 | −5.3 % |
| All stickers painted | 2,641.4 | 2,635.9 | −0.2 % | 82.5 | 104.4 | +26.5 % |
| Live value current | 676.2 | 695.4 | +2.8 % | 82.4 | 84.2 | +2.2 % |
| Input readiness | 527 (548.6) | 546.3 (568.8) | +3.7 % | 94.9 | 96.2 | +1.4 % |
| Critical-path JS (gzip, B) | 8,011 | 8,011 | 0 | 41,139 (147,389) | 80,421 (147,389) | +95.5 % |
| TBT | 0 (0) | 0 (14) | — | 0 | 0 | — |
| TTI proxy | 696 | 2,832 | +306.9 % | 124 | 136 | +9.7 % |
| CLS | 0 | 0 | — | 0 | 0 | — |
| Stickers at FCP | 63 | 63 | 0 | 63 | 63 | 0 |
| Total wire bytes (B, sum of `bytes.*` medians) | 1,083,059 | 1,083,059 | 0 | 1,083,153 | 1,083,153 | 0 |
| CPU probe (throttling check) | 37.8 | 37.0 | −2.1 % | 7.6 | 7.7 | +1.3 % |

Drift commentary:

- **Within the ~30 % run-to-run drift:** every mobile timing except the TTI
  proxy (all within ±4 %), and desktop LCP/FCP, first sticker, live value,
  input readiness and "all stickers painted" (+26.5 %, on an 82 ms base;
  per-run spread is 49–63 % on both sides). The bytes per resource type are
  identical to the audit, so the served payload did not change.
- **Desktop critical-path JS** (+95.5 % on the median) is the known race
  footnoted in 004 §3: the eager graph is the same 8,011 B; whether an
  island chunk (80,421 B or 147,389 B) finishes before a ~130 ms LCP varies
  per run. Audit runs: 8,011 / 11,758 / 147,389 / 147,389 / 41,139; final:
  8,011 / 147,389 / 80,421 / 147,389 / 8,011. The median is still under the
  100 KB gate.
- **Mobile TTI proxy** (696 → 2,832, outside the drift).
  - In final runs 3, 4 and 5, a second long task appeared at about 2.8 s,
    just after all stickers finished painting (2.6 s). The entries are
    `[start ms, duration ms]`:
    - run 3: `[2789, 64]`
    - run 4: `[2778, 54]`
    - run 5: `[2804, 50]`
  - Final runs 1 and 2 and all five audit runs have only the first task, at
    about 530–580 ms.
  - Source: the committed `bench/results/final-mobile.json` and
    `audit-mobile.json`, at `raw.firstRender[i].detail.longTasks`.
  - The TTI proxy jumps to the end of the late task. The TBT median stays 0
    (p95 14 ms).
  - The build bytes are unchanged. The cause was not investigated (R19);
    machine state or timing is likely but not verified.
  - Input readiness, the plan's readiness budget, is unaffected
    (546 ms ≤ 1.5 s).
- Budget status from 004 §3 is unchanged: mobile LCP ≤ 1,380 ms, desktop
  LCP ≤ 162 ms, CLS 0, TBT no regression, input readiness ≤ 1.5 s all still
  met; critical-path JS met on the mobile runs and on the desktop median.

## 4. Deploy dry run

In a temporary detached worktree (R30), Node v26.12.1, npm 12.2.0, no
`TARGET` set, following `.github/workflows/deploy.yml` in order:

```
git worktree add --detach $env:TEMP\sticker-sheet-deploy-dry HEAD   # HEAD is now at a7789e4
npm ci        # exit 0; npm 12 warned that esbuild@0.28.2's postinstall was blocked (allowScripts)
npm test      # Test Files 24 passed (24), Tests 268 passed (268)
npm run build # exit 0, "1 page(s) built", "Complete!"
```

**Build determinism.** The temporary worktree's `dist` and the main
worktree's `dist` (`TARGET=new`) both have 516 files with the same paths.
515 files are byte-identical (SHA-256). Only `index.html` differs (69,808
vs 69,810 bytes): the two `<astro-island uid="…">` values (`k6isM`,
`iPg8E` vs `1fPHTP`, `ZlgBUF`). After replacing the uids the files are
equal. `TARGET` has no effect on the build: nothing in the build reads it
(only `tests/contract.ts` and `bench/results.ts` do), and rebuilding the
temporary worktree with `TARGET=new`, then without it, gave the same uids
(`1fPHTP`, `ZlgBUF`) and a byte-identical `dist` each time. So the island
uids differ between the two checkouts and are stable across rebuilds in
the same checkout and across `TARGET` values. The cause was not traced:
Astro's derivation of the uid was not examined. The difference is not
expected to affect behaviour, since the uids only pair each island with its
own children; this was not tested on the dry-run build beyond §4's checks.

**Serving.** `npx serve dist -l 4180 --no-clipboard` from the temporary
worktree (listener PID 16732; `GET /` → 200, 69,810 bytes).

- Text search of the served `index.html`: 63 `<button … class="sticker" …
  data-slug=…>` elements and 63 `data-slug="` attributes.
- Real page (a small scratch Node script with the repo's
  `@playwright/test` Chromium, 1280×800, JS enabled, deleted afterwards):
  `stickers=63` (`button.sticker[data-slug]`), 55 sticker `<img>` elements
  (the other 8 stickers have no `<img>`), `imgsNotDecoded=0` (every one
  `complete` with `naturalWidth > 0`), `window.__app` set (viewer wired).
- Opening a sticker: setting `#dark` requested `/_astro/en.DCdUDETz.js` →
  200 (1,104 B, the `dark` description, contains "dark mode"), and the
  sheet title "Dark mode" became visible. The Sheet chunk
  `/_astro/Sheet.ybdl7SCV.js` → 200 was already loaded at idle before the
  open (response 66 of 90; the open began at 86), so the open itself did
  not request it. A real click on the `kagami` sticker set the hash to
  `#kagami`.
- 90 responses, none ≥ 400; 0 page errors. Console: exactly one message,
  `error: Permissions policy violation: unload is not allowed in this
  document. @ http://localhost:4180/_astro/Sheet.ybdl7SCV.js:1`, the known
  Silk `unload` listener (002 §"Silk's `unload` listener"; the e2e specs
  allow it as `SILK_UNLOAD`).

Cleanup: the listener process was gone by the time `Stop-Process -Id 16732`
ran (it reported no such process); port 4180 had no listener afterwards. The
temporary worktree was then also used for the `ef581f0~1` build in §2
before `git worktree remove --force` and `git worktree prune`;
`git worktree list` shows the same three worktrees as before, and ports
4173 and 4180 have no listener.

Limitations:

- Node v26.12.1 / npm 12.2.0 locally, CI uses Node 22 (and its bundled npm).
  npm 12 blocked esbuild's postinstall; the build and tests still passed.
  Node 22 was not installed.
- Local `serve` is not GitHub Pages: headers, caching, compression and 404
  handling differ.
- The Astro config sets no `site` or `base`, so the build assumes it is
  served from the domain root. If Pages serves the repository under a
  project path, the absolute `/_astro/…` URLs would break; this was not
  tested.
- No real-device run; the device checklist
  (`manual-device-checklist.md`) remains open.

## 5. Not re-run (R32)

Production `src/`, `public/`, `scripts/` and configs are unchanged since the
audit except `ef581f0`, whose production build is byte-identical (§2). So
these audit results stand and were not re-measured:

- the gesture benches (`bench/gestures.bench.ts`);
- the interaction benches (`bench/interaction.bench.ts`) and the deep-link
  first render;
- the portable bench (WebKit and Firefox);
- the 5× visual comparison against the baseline.
