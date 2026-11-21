# react-zoom-pan-pinch: defaults, baseline options and quirks

Source of truth: `node_modules/react-zoom-pan-pinch` **3.7.0**, file
`dist/index.esm.js` (the only source shipped; every `L<n>` below is a line in
that file). Baseline options come from `src/app` (`Canvas.tsx`, `Controls.tsx`,
`HashNavigator.tsx`, `Sticker.tsx`, `Panel.tsx`, `utils/coordinates.ts`).

The goldens in `tests/fixtures/rzpp-golden.json` were recorded with real input
only (`page.mouse`, `page.mouse.wheel`, CDP `Input.dispatchTouchEvent`), never
by calling the library API, so they capture the behaviour below as a user sees
it.

## 1. How the baseline configures the library

`TransformWrapper` (`Canvas.tsx` L65-L71) passes exactly five props:

| Prop | `src/app` | Notes |
| --- | --- | --- |
| `initialScale={1}` | `Canvas.tsx:66` | `createState` L730 |
| `minScale={0.1}` | `Canvas.tsx:67` | |
| `maxScale={5}` | `Canvas.tsx:68` | |
| `smooth` | `Canvas.tsx:69` | already the default (L668) |
| `centerOnInit` | `Canvas.tsx:70` | default is `false` (L666) |
| `onTransformed={handleTransformed}` | `Canvas.tsx:71` | adds a `zooming` class to the wrapper for 100 ms after each state change (`Canvas.tsx:51-62`) |

Everything else is the library default. `wheel`, `panning`, `pinch`,
`doubleClick`, `zoomAnimation`, `alignmentAnimation` and `velocityAnimation`
are not passed, so they equal `initialSetup` (L656-L725). Nested objects are
shallow-merged by `createSetup` (L739-L757).

Programmatic calls the app makes (all with library-default animation):

| Call | `src/app` | Library default |
| --- | --- | --- |
| `zoomIn()` | `Controls.tsx:108` | step 0.5, 300 ms, easeOut (L849-L856) |
| `zoomOut()` | `Controls.tsx:121` | step 0.5, 300 ms, easeOut (L857-L864) |
| `centerView()` | `Controls.tsx:131` | current scale, 200 ms, easeOut (L889-L899) |
| `setTransform(x, y, scale)` | `Canvas.tsx:83` (sticker click), `HashNavigator.tsx:52` | 300 ms, easeOut (L865-L881) |

`setTransform` targets come from `convertToCanvasCoordinates`
(`utils/coordinates.ts:9-16`): `x = xOffset + (innerWidth - xOffset)/2 - x*scale`,
`y = (innerHeight - yOffset)/2 - y*scale`, with `xOffset = PANEL_WIDTH` (320)
and `yOffset = 0` on wide viewports, `xOffset = 0` and `yOffset = PANEL_HEIGHT`
(135) when `innerWidth <= PANEL_BREAKPOINT` (4096; `Panel.tsx:21-23`).

## 2. Defaults and effective values

"Effective" is what the baseline actually runs with.

| Setting | Library default (line) | Baseline passes | Effective |
| --- | --- | --- | --- |
| `minScale` | 1 (L662) | 0.1 (`Canvas.tsx:67`) | **0.1** |
| `maxScale` | 8 (L663) | 5 (`Canvas.tsx:68`) | **5** |
| `limitToBounds` | true (L664) | n/a | **true**: position clamped to bounds (L226-L234, L241-L253) |
| `centerZoomedOut` | false (L665) | n/a | **false**: content smaller than the wrapper is centred (`diff * 0.5`, L196-L208), not pinned to an edge |
| `centerOnInit` | false (L666) | true (`Canvas.tsx:70`) | **true**: see section 5 |
| `disablePadding` | false (L667) | n/a | **false**: overshoot padding is active (section 4) |
| `smooth` | true (L668) | true (`Canvas.tsx:69`) | **true** |
| `wheel.step` | 0.2 (L670) | n/a | 0.2, **unused** while `smooth` is true (L1169) |
| `wheel.smoothStep` | 0.001 (L672) | n/a | **0.001** per unit of `deltaY` (L1169) |
| `wheel.disabled` / `wheelDisabled` / `touchPadDisabled` | false (L671, L673, L674) | n/a | all enabled (L1012-L1027); wheel/touchpad-pinch both zoom |
| `panning.velocityDisabled` | false (L680) | n/a | **inertia enabled** (L560) |
| `panning.lockAxisX/Y` | false (L681-L682) | n/a | free panning |
| `panning.allowLeft/Middle/RightClickPan` | true (L683-L685) | n/a | all mouse buttons pan (L1529-L1534) |
| `pinch.step` | 5 (L691) | n/a | **unused**: the pinch maths never reads it (L1131-L1144) |
| `doubleClick.mode` | `"zoomIn"` (L698) | n/a | **zoomIn** (L1296-L1301) |
| `doubleClick.step` | 0.7 (L697) | n/a | **0.7**: `scale * exp(0.7)` (L762-L775), then rounded to 2 dp (L572) |
| `doubleClick.animationTime` / `animationType` | 200 / `"easeOut"` (L700, L699) | n/a | 200 ms easeOut |
| `zoomAnimation.size` | 0.4 (L705) | n/a | **0.4**: scale padding, only for ctrl-wheel / pinch (L1068-L1075, L1131-L1144) |
| `zoomAnimation.animationTime` / `animationType` | 200 / `"easeOut"` (L706, L707) | n/a | 200 ms: scale realignment (L577-L595) |
| `alignmentAnimation.sizeX` / `sizeY` | 100 / 100 (L711-L712) | n/a | **100** (a pixel count while dragging, a percent when flicking: section 4) |
| `alignmentAnimation.animationTime` | 200 (L713) | n/a | 200 ms bounds-align animation (L523-L534) |
| `alignmentAnimation.velocityAlignmentTime` | 400 (L714) | n/a | 400 ms (L481-L484) |
| `velocityAnimation.sensitivity` | 1 (L719) | n/a | 1 (L407-L412) |
| `velocityAnimation.animationTime` | 400 (L720) | n/a | 400 ms base (L407-L412) |
| `velocityAnimation.equalToMove` | true (L722) | n/a | true: move time is `400 * velocity * sensitivity` (L411) |
| animation easing | `easeOut(t) = -cos(t*PI)/2 + 0.5` (L31-L33) | n/a | used by every animation above |
| `zoomIn()` / `zoomOut()` | step 0.5, 300 ms, easeOut (L852-L860) | no args | `scale * exp(+-0.5)` rounded to 3 dp (L771-L774) and again to 2 dp (L572): 1 -> **1.65**, 1 -> **0.61** |
| `centerView()` | 200 ms, easeOut (L889-L899) | no args | centres at the **current** scale (L987-L995): `(wrapper - content*scale)/2`; **ignores the panel offsets** |
| `setTransform` | 300 ms, easeOut (L865-L881) | no extra args | not bounds-clamped: it animates straight to the requested state |

## 3. Input maths (what the goldens exercise)

### Wheel (L1156-L1198, L1061-L1075)

* Direction: `deltaY < 0` zooms in, anything else zooms out (L1029-L1034).
* Step: `scale += sign * 0.001 * |deltaY|` (smooth mode, L1169, L1069), rounded
  to 3 dp. A plain wheel clamps to `[minScale, maxScale]` with no scale padding
  (`disable = !ctrlKey`, L1066-L1073); `ctrl+wheel` (touchpad pinch) gets 0.4
  scale padding and can dip below `minScale` before realigning.
* Anchor: the point under the pointer stays fixed:
  `pos -= pointer * (newScale - scale)` where `pointer = (client - content.rect.left)/scale`
  (L1040-L1056, L254-L267).
* **Position is not clamped while wheeling** (padding enabled makes
  `isLimitedToBounds` false, L1175-L1177). 100 ms after the last event
  (`wheelAnimationTime`, L1147, L1184-L1195) `handleAlignToScaleBounds`
    (L577-L595) runs a 200 ms align-to-bounds. Goldens are read after that has
  finished (transform unchanged for 600 ms).
* On a mobile profile Chromium divides `deltaY` by `devicePixelRatio`
  (`page.mouse.wheel(0, -100)` arrives as about -38.1 at DPR 2.625), so the
  recorder uses `notch = round(100 * DPR)` (100 desktop, 262 mobile) to get
  about 0.1 scale per event.

### Dragging and inertia (L535-L568, L407-L513, L446-L468)

* Mouse listeners are on `window` (L1397-L1410); touch listeners on the wrapper
  (L1426-L1434). A touch that starts less than 200 ms after the previous one
  (single finger) is treated as a double tap and **does not start a pan**
  (L1613-L1615).
* While dragging, the position is clamped to bounds **plus a padding of
  `sizeX`/`sizeY` raw pixels** (`getPaddingValue` L375-L382 returns 100,
  `getMouseBoundedPosition` L241-L253 adds it), so content can be pulled up to
  100 px past an edge. On release it is aligned back (200 ms, L523-L534).
* Inertia starts only when `velocity.total > 0.1` **and** the content is larger
  than the wrapper (L559-L561). `velocity` is taken from the *last* move event
  only: `velocityX/Y` = last event delta in **pixels** (not per ms), and
  `total = |delta| / (now - lastEventTime)` using `Date.now()`
  (L446-L468). `equalToMove` divides by
  `min(1, wrapper.offsetWidth / innerWidth)` (L439-L445), which is 1 here.
* Animation length is `max(400 * total * sensitivity, 400)` ms (L407-L412,
  L484). On every animation frame the position advances by
  `velocity * (1 - ease(progress))`, accumulated from the **current** position
  (`handleVelocityPanning`, L469-L510), so travelled distance is roughly
  `lastEventDelta * 0.5 * (duration / frameInterval)`. It depends on the last
  event's delta, on its timestamp and on the number of frames, so it is **not
  reproducible between runs**.
* Inertia clamping: `getVelocityPosition` (L415-L437) hard-clamps a flick that
  started inside the bounds to exactly the bounds (`boundLimiter`). When the
  drag ended already past a bound (up to 100 px, see above) the position is
  instead eased back toward the bound with the 400 ms alignment curve, capped
  at `bound +- size * wrapperSize / 100` (L485-L488), i.e. **100 % of the
  wrapper size**, unlike the 100 px used while dragging.
* `boundLimiter` rounds every clamped position to 2 dp (L226-L234).

### Pinch (L1221-L1277, L1131-L1144)

`newScale = round2(startScale * currentDistance / startDistance)` (L1141-L1143);
the midpoint pan is added (L1248-L1264). `pinch.step` is never used. The
position is clamped with the drag padding (L1263-L1266); on release
`handlePinchStop` runs `handleAlignToScaleBounds` (L1268-L1277). **Pinch is not
part of the closed `Op` union in `tests/parity/replay.ts` and has no golden**;
this section is documentation only.

### Double click / double tap (L1302-L1330, L1658-L1666)

`dblclick` on the wrapper zooms in by `exp(0.7)` (1 -> 2.01) about the pointer,
200 ms easeOut, clamped to bounds (`handleZoomToPoint` L570-L576). A second
`dblclick` inside the animation window is ignored
(`doubleClickStopEventTimer`, L1309-L1310).

### Bounds (L196-L240)

```
if wrapper >= content*scale: min = max = (wrapper - content*scale) / 2   // centred
else:                        min = wrapper - content*scale, max = 0
```

The canvas is 3000 x 3000. Examples from the goldens: scale 1 on a 1280 x 800
viewport gives `x in [-1720, 0]`, `y in [-2200, 0]`; scale 0.1 is always
centred at `(490, 250)`; scale 5 gives `x in [-13720, 0]`, `y in [-14200, 0]`.
The panel offsets (320 / 135) are **not** part of the bounds.

## 4. Why only saturating flicks are goldens

Unclamped inertia jitters between runs (frame count, `Date.now()` resolution,
and the last event's delta), measured on the unchanged baseline:

| Gesture (real input) | Inertia distance seen |
| --- | --- |
| desktop mouse, -300 px over 160 ms | 346-360 px |
| desktop mouse, -600 px over 160 ms | 900-1340 px |
| mobile touch, -380 px over 160 ms | about 475 px (+-1) |
| mobile touch, -300 px over 160 ms | about 375 px |
| mobile touch, vertical -780 px over 160 ms | 1473-1533 px (unclamped) |

A golden recorded from one of those would fail on the next run, so the
`flick-left` and `flick-up` goldens use flicks whose inertia (minimum observed
900 px or more on desktop, at least 3x the distance needed) always reaches the
bound; the result is the clamped bound and is therefore reproducible. Mobile
`flick-left` repeats the flick three times because a 412 px viewport only
allows about 380 px per drag. The consequence is that **the goldens verify that
a fast flick saturates the bound, not the inertia distance itself**. A
rewrite must implement a flick that carries a real-world gesture past the
bound; the exact free-flight distance is not specified by these fixtures.

Timing caveat: the recorder drives drags in 16 ms steps (`DRAG_STEP_MS` in
`tests/parity/replay.ts`) while a 60 Hz frame is 16.67 ms; because of the
`Date.now()` quantisation `total` can differ by a few percent from a real
gesture. This does not change any recorded golden (slow drags never reach the
0.1 px/ms threshold; flicks saturate).

## 5. `centerOnInit` and resizing

* `handleInitialize` (L1435-L1472) creates a `ResizeObserver` on the wrapper and
  the content. The **first** callback with a non-zero content size calls
  `setCenter()` once (L1454-L1460, L1707-L1713): `(wrapperW - 3000*scale)/2`,
  `(wrapperH - 3000*scale)/2`, applied immediately (no animation) and
  **without the panel offsets**. A 1280 x 800 wrapper gives `(-860, -1100)`;
  412 x 839 gives `(-1294, -1080.5)`.
* Every later callback (including every viewport resize) takes the `else`
  branch: cancel the animation, recompute bounds, then
  `handleAlignToBounds(_this, 0)` (L1462-L1466): an **instant clamp**, never a
  re-centre. Growing the viewport from 1280 to 1500 px wide at `x = -1720`
  therefore gives `x = 1500 - 3000 = -1500` and leaves `y` alone (the
  `resize-reclamp` golden).
* `applyTransformation` (L1719-L1727) writes
  `translate(<x>px, <y>px) scale(<s>)` (L972-L975) onto the content element's
  `style.transform` on every state change; `setTransformState` (L1687-L1706)
  then fires `onTransformed`.

## 6. Notes on the stickers (not library behaviour)

A mouse drag of at least 10 px on a sticker does not open the sheet
(`Sticker.tsx:61-72`), and a keyboard activation (`detail === 0`,
`Sticker.tsx:46-54`) opens it directly. The recorder keeps its `dblclick`
anchor on empty canvas and asserts the sheet handle is absent after every
entry.
