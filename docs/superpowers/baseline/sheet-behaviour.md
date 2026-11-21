# Baseline sheet behaviour

Milestone 0, Task 0.3. Records how the unchanged baseline's sheet/panel
(`src/app/components/Panel.tsx`) actually behaves, measured with real input
(click, `page.mouse.wheel`, a one-finger touch drag) against the build in
`out/`, and compares it with the "Sheet spec" in
`docs/superpowers/specs/2026-11-20-render-performance-design.md`.

Recorder: `tests/parity/record-sheet.spec.ts` (`RECORD=1` only, skipped
otherwise). Run with:

```powershell
$env:RECORD='1'; $env:TARGET='baseline'; $env:STATIC_DIR='out'
npx playwright test tests/parity/record-sheet.spec.ts --workers=1 `
  --project=chromium-mobile --project=chromium-desktop
```

Output: `docs/superpowers/baseline/sheet-behaviour.json` (all 7 fields below),
plus screenshots in `bench/results/tmp/sheet-*.png` (git-ignored, described in
words in "Screenshots" since the owner cannot view images). Run twice; both
runs produced byte-identical JSON (see "Stability").

## Measured values (`sheet-behaviour.json`)

| Field | Value | Measured as |
|---|---|---|
| `peekHeightPx` | 231 | `viewportHeight(844) − sheetRect.y` at `/#dark`, mobile viewport 390×844, no interaction. |
| `expandedHeightPx` | 796 | Same measurement after clicking the handle once, at `/#css`. |
| `handleTogglesStops` | `true` | Click handle (peek→expanded), click again (expanded→peek): the second peek height matches the first within 2 px and the expanded height is more than 50 px taller. |
| `scrollsAtPeek` | `false` | At peek, `page.mouse.wheel(0, 300)` over the content: the sheet's own top edge moved by more than 20 px (it expanded), so no in-place scroll is counted. |
| `scrollsAtExpanded` | `true` | At expanded, the same wheel: the sheet's top edge stayed put and the text position inside the sheet shifted by more than 2 px. |
| `dragDismisses` | `true` | A single-finger CDP touch drag from the handle, 500 px down over 150 ms, from peek: `location.hash` became `""` and the handle was removed from the DOM. |
| `wideLeftPanelWidthPx` | 320 | Desktop viewport 4100×1000, `/#dark`: visible (on-screen, clipped) width of the panel rectangle. |

Full file:

```json
{
  "wideLeftPanelWidthPx": 320,
  "peekHeightPx": 231,
  "expandedHeightPx": 796,
  "handleTogglesStops": true,
  "scrollsAtPeek": false,
  "scrollsAtExpanded": true,
  "dragDismisses": true
}
```

`expandedHeightPx` was measurable (not `null`): the handle-click round trip
reliably reaches the expanded stop, so no field needed a `null` fallback.

### Stability

Ran the recorder twice against the same `out/` build. Both runs produced
byte-identical `sheet-behaviour.json` (`Compare-Object` of the two files
produced no output). All 6 applicable per-project tests passed both times
(6 skipped per run are the cross-project no-ops, e.g. the mobile-only tests
skipped on `chromium-desktop`).

## Differences vs. the Sheet spec

The Sheet spec is in `docs/superpowers/specs/2026-11-20-render-performance-design.md`,
section "Sheet spec" (as originally written). These differences were ruled on
instead of gating on `ask_user` (ruling R8); the design doc's end-of-file
section and its "Sheet spec" now follow the measured baseline.

| # | Spec says | Observed | Consequence |
|---|---|---|---|
| 1 | Expanded stop is `calc(100vh − 96px)` = 748 px at 390×844 (96 px off the top and bottom together). | Expanded stop is 796 px (48 px off the top only). Root cause: `Sheet.Content`'s class list has a **fixed** `h-[calc(100dvh_-_3em)]` (Panel.tsx:113), i.e. `100dvh − 48px`, which overrides `PANEL_HEIGHT_SNAPS[1]` (`"calc(100vh - 96px)"`, Panel.tsx:24-25) — that second snap-point string is never read, because `snapPoints` only ever passes `PANEL_HEIGHT_SNAPS[0]` (Panel.tsx:50), so the Sheet.Content CSS height, not the unused detent string, decides the real expanded height. | A rewrite that reimplements "Sheet spec" literally (`calc(100vh − 96px)` expanded) will render a visibly *shorter* expanded sheet than the current app. The rewrite must pick one: match the spec's 748 px, or match the baseline's 796 px, and say which. |
| 2 | "Content scrolling is enabled only at the expanded stop" (implies scrolling is simply unavailable/no-op at peek). | At peek, `scrollGesture` is indeed disabled (`activeSnap !== 2 ? false : "auto"`, Panel.tsx:126), but a wheel gesture over the content at peek does not merely do nothing — it falls through to the sheet's own travel/step mechanism and **expands the whole sheet to the next stop** (confirmed: the sheet's own top-edge position changed by the same amount as the tracked text, i.e. the content didn't scroll inside the sheet, the sheet itself moved). | A literal "scrolling disabled at peek" reimplementation (e.g. `overflow: hidden` with no other effect) would be a *behaviour change* from the baseline, where an inadvertent wheel-over-peek is a *de facto* "expand" gesture. The rewrite should decide, and say, whether this quirk is worth preserving. |
| 3 | (Implicit in "two scroll stops" plus the `activeSnap !== 2` dead-code note in the design doc's own "what the code does today" table: Silk is "passed only the first detent... `activeSnap !== 2` compares against an index that never occurs".) | `activeSnap !== 2` is **not** dead code: Silk auto-appends an extra, always-reachable detent beyond whatever is in the `detents` prop (see "Silk detent-index answer" below). For Panel.tsx's single-string `detents={snapPoints}` (Panel.tsx:101), there are two real, reachable Silk detent indices — 1 (the explicit "231px" peek) and 2 (Silk's auto "natural content size" detent, which resolves to the `Sheet.Content` CSS height, 796 px) — and clicking the handle genuinely reaches index 2, enabling `scrollGesture` and the `travelHandler`'s keyboard-dismiss effect (Panel.tsx:76-88, 126). | The design doc's premise for this fact ("index 2 never occurs") is incorrect; the observed 2-stop behaviour is real Silk behaviour, not a visual coincidence masking broken code. The rewrite's Silk integration (Task 1.13) needs to know "2 detents" is the *actual* detent count today (1 user-specified + 1 auto-appended), not 1. |
| 4 | (Not stated either way.) `toggleActiveSnap` (Panel.tsx:67-73) cycles with `(prev + 1) % snapPoints.length` — but `snapPoints` is a *string* (one CSS value), so `.length` is its character count (tens of characters), not the detent count (2). `activeSnap` also starts at `useState<number>(0)` (Panel.tsx:51), which is Silk's own "hidden" sentinel (see below), not a real detent. | Despite this, the sheet always opens at peek and the handle always toggles cleanly between peek and expanded in testing. This is explained by Silk's own `onActiveDetentChange={setActiveSnap}` (Panel.tsx:96) being a controlled two-way binding: Silk overwrites the app's local `activeSnap` state with its own real settled detent after every transition, so the app's buggy modulo arithmetic in `toggleActiveSnap` is cosmetically harmless — the click handler's own computed value is immediately replaced by Silk's callback before it visibly matters. | Not a user-visible difference from the spec, but worth carrying forward as a correctness note: a reimplementation that trusts `toggleActiveSnap`'s arithmetic (rather than Silk's own detent-cycling) would be copying masked-but-real bugged code. |

No other differences were found: peek height (231 px), the handle toggling between two stops, drag-to-dismiss below peek, and the wide 320 px left panel at >4096 px all match the spec exactly.

### Ruling

Ruling R8: where the spec had misread the code, the baseline's measured
behaviour wins (expanded stop `calc(100dvh − 3em)`; a wheel at peek expands
the sheet; Silk's two detents, 1 = peek, 2 = expanded, 0 = hidden). See the
design doc's "Baseline-observed differences" section for the owner-facing
summary; the owner may reverse this ruling later.

## Silk detent-index answer

**Question (Step 2):** are `@silk-hq/components` detent/snap indexes 1-based,
with `0` meaning "hidden"?

**Answer: yes.** `0` is the hidden/dismissed sentinel; real, reachable
detents are indexed `1..N`, where `N` = the number of entries Silk sees after
it silently appends one extra "fit to natural content size" detent to
whatever the `detents` prop specifies.

Evidence, `node_modules/@silk-hq/components/dist/types.d.ts`:

- Line 321: `type Detent = number;` — the type itself carries no documented
  0/1-based convention; the convention below comes from the runtime, not the
  type declarations.
- Lines 419-421 (on `SheetProps`): `defaultActiveDetent?: Detent; activeDetent?: Detent; onActiveDetentChange?: (detent: Detent) => void;`
- Line 450 (on `SheetViewProps`): `detents?: string | Array<string>;` — Panel.tsx
  passes a single string (one detent), not an array.

Evidence, `node_modules/@silk-hq/components/dist/module.mjs` (a minified
bundle on effectively one physical line — line/character offsets below are
from `content.indexOf(...)` on the raw file, since there are no meaningful
line numbers to cite):

- Offset ~63382 — the `detents` prop (`D`) is read and an extra detent is
  unconditionally appended:
  `eq=o(()=>D?"string"==typeof D?[D,"var(--silk-aF)"]:[...D,"var(--silk-aF)"]:["var(--silk-aF)"],[D])`
  — i.e. a single-string `detents` prop becomes the 2-element array
  `[D, "var(--silk-aF)"]`. `var(--silk-aF)` is Silk's internal CSS variable
  for the measured natural height/width of `Sheet.Content`. This is exactly
  why Panel.tsx's single-string `detents={snapPoints}` (Panel.tsx:101)
  produces **two** real Silk detents, not one.
- Offset ~63571 — the initial/fallback active detent:
  `eZ=o(()=>Number.isInteger(em)?em:Number.isInteger(ep)&&ep>0?ep:eJ.current?eJ.current:1,[ep,em])`
  — if no `defaultActiveDetent`/`activeDetent` is given, Silk's own fallback
  is the literal integer `1`, and `ep>0` is required for a passed-in
  `activeDetent` to count (so `activeDetent={0}`, which is Panel.tsx's own
  initial `useState<number>(0)`, Panel.tsx:51, is treated by Silk as "not a
  real starting detent" and ignored in favour of its own default).
- Offset ~74931 — the step/cycle function used when the handle (or a
  `Sheet.Trigger action="step"`) advances the active detent:
  `nc=m((e,t)=>{let n=tj.current[0],a=null!=t?t:null;if(null===a){var r,l;a="up"===(null!=e?e:"up")?(r=tj.current[0])<eq.length?r+1:1:(l=tj.current[0])>1?l-1:eq.length}return 0===a||a===n?null:a},[eq])`
  — stepping "up" goes `current+1`, wrapping to `1` past `eq.length`;
  stepping "down" goes `current−1`, wrapping to `eq.length` below `1`. The
  cycle **never produces or targets `0`**, and the function explicitly
  returns `null` (no-op) if the computed target is `0` — confirming `0` is
  reserved as the dismissed/hidden sentinel, never a normal step target, and
  that valid real detents are `1` through `eq.length` inclusive (1-based).

Combined with runtime behaviour observed in this task (dismissing the sheet
clears the URL hash and eventually removes the `Sheet.Content` DOM node,
consistent with a transition to the `0`/hidden state), this confirms the
0-based-hidden / 1-based-real-detents convention asked about in Step 2. This
matters for Task 1.13 (reimplementing the sheet against Silk's
controlled-detent API): the rewrite's `detents` array must plan for Silk's
auto-appended entry, and `activeDetent`/`onActiveDetentChange` integers must
treat `0` as "closed", not as "the first stop".

## Screenshots

Saved to `bench/results/tmp/sheet-*.png` (git-ignored). Descriptions below
since the owner cannot view images directly:

- `sheet-peek.png` — mobile viewport (390×844), `/#dark` open at the peek
  stop: a short bottom sheet showing the sticker title, a close (×) button,
  the drag handle, and the first line or two of the description, with the
  canvas still visible above it.
- `sheet-expanded.png` — same viewport, after clicking the handle once: the
  sheet now fills nearly the full viewport height (796 px of 844 px),
  showing the sticker image/preview and the full scrollable description.
- `sheet-dismissed.png` — same viewport, captured right after a hard
  downward drag from peek: the sheet is gone, only the bare sticker canvas
  is visible (the URL hash has cleared).
- `sheet-wide.png` — desktop viewport (4100×1000), `/#dark`: a 320 px-wide
  panel docked to the left edge of the (very wide) viewport, with the
  sticker canvas filling the remaining space to its right. No drag handle
  is present on this layout.

## Baseline input-recording note

Two gesture-isolation findings from building the recorder, in case they are
useful for Task 1.13's own interaction tests:

- Silk's `Sheet.View` only reacts to touch-type pointer events for its own
  drag/step gesture. A synthetic `page.mouse.down/move/up` drag on the
  handle or content has no effect at all; `tests/parity/record-sheet.spec.ts`
  uses a one-finger CDP `Input.dispatchTouchEvent` sequence instead (matching
  the convention already used by `tests/parity/replay.ts`'s touch-drag
  helper for mobile-profile drags).
- Mixing gesture types (a `page.mouse.wheel` followed later by a click or a
  CDP touch drag) on the *same* `page` was unreliable even across a full
  `page.goto` reload in between — occasionally the later gesture silently
  did not register. Each probe in the recorder therefore gets its own test
  (a fresh `page`) rather than being chained within one test.
