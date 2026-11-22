# Manual device checklist (owner, real devices)

The agent cannot run these. They cover what headless Chromium, WebKit and
Firefox cannot show: real touch, real GPUs, real memory and real Safari. Each
line says what to do, what to look for and what counts as a pass. Compare with
the live baseline site when a line says "as in the baseline".

Devices: an iPhone with iOS Safari, and an Android phone with Chrome
(mid-tier, plus a low-end one where a line says so). A Mac with a trackpad and
Safari for the desktop lines.

Record the device, OS and browser version next to each tick. A fail is a note
in `docs/superpowers/decisions/004-parity.md` (Parity table, "manual" rows).

## iOS Safari and Android Chrome (run each item on both)

- [ ] **Pinch zoom.** Pinch in and out over a sticker, slowly and fast. Pass:
  the zoom follows the fingers and stays anchored between them, stops at 5×
  and 0.1× with no jump, and there is no page (browser) zoom.
- [ ] **Flick inertia.** Flick the canvas in four directions, short and long.
  Pass: it glides and slows smoothly, stops at the canvas bounds without a
  snap-back jolt, and a slow drag that ends with a pause does not glide.
- [ ] **Sheet drag at both stops.** Tap a sticker, drag the sheet from peek up
  to expanded and back, then below peek. Pass: it snaps to peek (title and
  the first lines visible) and to expanded (almost full height, about one
  line of canvas visible above it), dismisses below peek, and the canvas does
  not move while the sheet is dragged.
- [ ] **Sheet content scroll.** At peek, swipe up inside the text. Pass: the
  sheet expands rather than scrolling the text. At expanded, the preview and
  the description scroll.
- [ ] **Rotate with the sheet open.** Open a sticker, rotate to landscape and
  back. Pass: the sheet stays open at peek, the selected sticker stays
  visible above it, nothing is cut off or stuck mid-way.
- [ ] **Language switch.** Switch to 中文 and 日本語 and back, with the sheet
  closed and open. Pass: titles, the description, the live stickers and the
  control labels change together; reload keeps the language with no flash of
  English on the first frame.
- [ ] **Theme switch.** Light, dark, system; then change the OS setting while
  "system" is selected. Pass: the background pattern and the stickers switch
  together; reload shows the saved theme on the first frame (no white flash
  in dark). `mdx.svg` and `xkjd27c.svg` follow the OS scheme, as in the
  baseline.
- [ ] **Memory after zooming to 5×.** Zoom to 5× over a dense area and pan
  around for a minute. Pass: no tab reload ("this page was reloaded"), no
  checkerboard or blank tiles that do not fill in, no stickers that stay
  blurry after the pan stops.
- [ ] **Live date stickers.** Open the page and look at the date stickers
  (`yyyy-mm-dd`, `dd-mmm-yyyy` and the others with live values) at first
  sight, in each language. Pass: today's date on the first frame you see,
  never a placeholder or yesterday's value; leave the tab open across
  midnight once if convenient.
- [ ] **Tap a sticker.** Tap stickers near their clipped edges. Pass: a tap
  outside the visible shape (inside its box) does not open it; a tap inside
  does, once, and the sticker re-centres above the sheet at the current
  zoom.

## Items collected during the rewrite (Tasks 1.10 to 2.3c, see 002 and 003)

- [ ] **Safari `gesture*` events (macOS trackpad and iOS).** On macOS Safari,
  pinch on the trackpad. Pass: the canvas zooms around the cursor, the page
  does not zoom. On iOS, a two-finger pinch is handled as pointers (the
  `gesture*` handler only zooms with no pointers down), so check that a pinch
  does not zoom twice as fast as the fingers move.
- [ ] **WebKit ~200 ms stall after `will-change`.** On iOS Safari, start a
  pan or a wheel/pinch zoom from rest. Pass: the first frame of motion comes
  without a visible hitch; a stall of about a fifth of a second at the start
  of each gesture is a fail.
- [ ] **Real-touch hold threshold.** On both phones, flick quickly and also
  drag, pause briefly, and lift. Pass: every real flick glides (the
  threshold is about 100 ms; a flick whose lift lags 100–200 ms reads as a
  hold and does not glide, which is a fail), and a deliberate pause-then-lift
  does not glide.
- [ ] **iOS double-tap zoom.** Double-tap on empty canvas and on a sticker.
  Pass: the canvas zooms in one step at the tap point, the page itself does
  not zoom, and a double-tap on a sticker does not leave the sheet open with
  the wrong sticker.
- [ ] **macOS trackpad pinch (Chrome and Safari).** Pinch on the trackpad
  over a sticker. Pass: the canvas zooms around the cursor, briefly
  overshooting the minimum scale is fine and realigns, the browser page zoom
  never changes.
- [ ] **Safari Tab to buttons.** In macOS Safari (with "Press Tab to
  highlight each item" on, or Option-Tab), Tab through the stickers and the
  controls. Pass: each sticker and control gets a visible focus ring, Enter
  or Space opens the sheet, and the menus work from the keyboard.
- [ ] **GPU memory on a low-end Android with the layer left promoted.** Pan
  once and leave the page at rest for a minute; then switch apps and come
  back. Pass: no reload, no blank canvas, no stuttering in other apps. Note
  `chrome://memory-internals` or the OS memory reading if it looks high
  (unmeasured in the bench; see 003, Task 2.3b cost note).
- [ ] **Firefox pan jank (Android Firefox or desktop Firefox).** Pan a dense
  viewport at 1× and at 3×. Pass: smooth enough to read sticker labels while
  moving. Visible jank is the signal that would justify revisiting the
  pre-baked shadows (003, shadow S1).
- [ ] **Firefox sheet handle after a content scroll (desktop Firefox, narrow
  window).** Make the window about 390 px wide, open the `css` sticker,
  click the handle to expand, scroll the description with the mouse wheel,
  then click the handle again within about a second. Pass: every click
  toggles the stop. A dropped click (the sheet stays expanded) is the gap
  recorded in 004-parity.md; the baseline drops it only within about 0.1 s.
- [ ] **Android flick blur-to-crisp.** On a mid-tier Android, zoom to about
  3×, flick, and watch the stickers as the glide ends. Pass: they are sharp
  when the glide stops, with no blurry phase of about a second (removed in
  Task 2.3b; a return of it is a fail).
- [ ] **First-tap tooltip warm-up on a low-end phone.** Load the page, wait
  about 3 s, then tap zoom-in once. Pass: the zoom starts promptly (no
  visible lag before it moves), and scrolling or panning during the first
  seconds after load does not stutter (the idle warm-up steps are 15–30 ms
  each at 4× CPU; unmeasured on a real low-end phone).
- [ ] **Screenshot sharpness at settled zoom.** Zoom to 5× on a vector
  sticker (for example `dark`) and wait one second. Pass: edges are as sharp
  as the same view on the baseline site; no soft, bitmap-scaled look.
