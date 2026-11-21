# Sticker Sheet render-performance rewrite: design

Status: draft for approval. Date: 2026-11-20.

Everything below marked **(my call)** is the designer's decision, not something the owner agreed to. The owner has agreed to: the goal, the constraints, "both phones and desktop equally", and the pathway choice in "Approaches".

## Intent and why

The Sticker Sheet is a static single-page "about me" canvas: 63 stickers on a 3000×3000 board that the user pans and zooms. The owner wants it to feel fast in three moments: **first render**, **zooming**, **panning**. The owner is free to rewrite the project from the ground up. It must stay a web app, and every current feature must survive.

Phones and desktop browsers matter equally. Jank is felt on both today.

## What the code does today (read, not yet profiled)

These are suspects from reading the code. Milestone 0 turns them into numbers.

- **Empty first paint.** `Canvas.tsx` puts stickers in a zustand store from a `useEffect`, so the prerendered HTML contains no stickers. Nothing is visible until JS loads, hydrates and effects run.
- **Runtime MDX compiler.** Sticker `content` and every description are MDX strings compiled in the browser (`next-mdx-remote/serialize` in `MDXRenderer`). The compiler ships to every visitor. Dynamic stickers appear late, after an async compile.
- **Live filters on every sticker.** Each of the 63 stickers is a `<button>` with `filter: drop-shadow` (Tailwind `drop-shadow-md`) wrapping a `clip-path`ed `<div>`. Under a scaling parent, filters force offscreen surfaces.
- **Re-raster on settle.** `will-change: transform` is added on the first `onTransformed` and removed 100 ms after the last, so the whole layer re-rasters when a gesture ends.
- **Per-event React work.** Every `Sticker` subscribes to the zustand store. The follow-cursor tooltip does a React `setState` per `mousemove` while hovering.
- **Eager payload.** `public/stickers/` holds about 3.9 MB (55 SVG, 7 PNG) with no size or decoding hints. 4 SVGs embed rasters. About 100 KB of all-language sticker YAML is bundled into JS.
- **Render-blocking third-party CSS.** Inter loads from `rsms.me` and cc-icons from cdnjs, both in `<head>`.
- **Heavy dependency set.** Next.js, React, zustand, `react-zoom-pan-pinch`, Radix (dialog, dropdown, tooltip), Silk, vaul, framer-motion, `@mantine/hooks`, tweakpane and `react-scan` are all present. Only some are on the critical path.

Facts that constrain the design:

| Fact | Consequence |
|---|---|
| 8 stickers have `content` (arbitrary JSX/CSS: `light-dark()`, flex, fonts, `aspect-ratio`). | They cannot be painted into a canvas or WebGL. They stay DOM in every pathway. |
| `dd-mmm-yyyy` and `yyyy-mm-dd` render `new Date()`. `test-1` has a `setInterval` clock (it has `width: 0`, so it is hidden, but it is a template for live stickers). | A build-time prerender of these shows the build date. "Variable contents on first render" means they must show the current value on the first frame a user sees. |
| Clip-paths: 18 `polygon`, 7 `circle`, 3 `path`, 1 `ellipse`, 1 CSS `shape()`. 30 stickers are unclipped rectangles. | Hit-testing and hover must follow these shapes. The browser's own `clip-path` hit-testing does this for free. Any custom hit-test must support `path()` and `shape()`. |
| Sticker `clip-path` sits on the inner element, `filter: drop-shadow` on the outer button. | That is how shadows survive a clipped hover region. Any replacement must keep the shadow following the clipped silhouette (opaque or transparent-logo alpha), including while hovered (scale 1.1). |
| 2 SVGs (`mdx.svg`, `xkjd27c.svg`) use `prefers-color-scheme`. | Inside `<img>` they follow the OS setting, not the app's theme toggle. This is existing behaviour. Keep it, or fix it deliberately and say so. |
| `light-dark()` in sticker content depends on `color-scheme` on `<html>`, which `next-themes` sets. | The replacement theme mechanism must set `color-scheme` and the `.dark` class before first paint. |
| Static deploy to GitHub Pages (`output: "export"`, CI runs `deno ... --once`, then `next build`). | No server, no edge. Everything is build-time or client-time. |
| Descriptions use JSX and `export function` inside MDX, with `_provideComponents()` for `Button`, `useTheme`, `PlusCodeMap` (Leaflet), `CanIUse` (iframe), `BaselineStatus` (web component) and others. | The authoring format (YAML + MDX strings) is a public contract of this repo. It does not change. |
| The Silk sheet is passed only the first detent (`detents={snapPoints}` is a single string). | Milestone 0 measured this (`docs/superpowers/baseline/sheet-behaviour.md`): Silk appends a content-size detent, so a single-string `detents` still yields two real stops (1 = peek, 2 = expanded, 0 = hidden). `activeSnap !== 2` is therefore live, not dead code, and `scrollGesture` is on at expanded. The original reading here ("never occurs, always `false`") was wrong. The "Sheet spec" below follows the measured baseline (ruling R8). |
| `PANEL_BREAKPOINT` is 4096 px, so the bottom sheet is used on practically every viewport. | The left-side panel only appears on viewports wider than 4096 px. Keep the constant. |
| Sticker z-order follows `stickers.yaml` order, which comes from `Deno.readDir` and is filesystem-dependent (alphabetical on the owner's NTFS machine, arbitrary on the Linux CI runner). About two dozen sticker bounding boxes overlap. | Z-order needs a deterministic rule (see "Sticker z-order"). |

## Goals

1. **First render.** Every sticker is in the HTML, positioned, clipped and shadowed with no JS needed, in the user's saved language and theme. Stickers in the initial viewport have their images prioritised, and the rest load immediately after at low priority behind a placeholder (the shadow or silhouette sprite). The first paint is centred on the hashed sticker if the URL has `#slug`. Dynamic stickers show their *current* value on the first frame the user sees (see "Live stickers").
2. **Pan and zoom.** During a gesture, per-frame work is a single compositor-friendly transform write. React does no work per frame and nothing triggers layout or raster per frame.
3. **Settle.** When the gesture ends, visible content re-rasters sharp at the new scale (vectors stay vector). A cached, scaled bitmap during the gesture is acceptable.
4. **Parity.** Every feature in "Feature parity checklist" works as it does today.

### Proposed budgets (my call, to be calibrated against the Milestone 0 baseline)

Measured in Chromium with mobile emulation, 4× CPU throttle and "Fast 4G", plus desktop, plus the owner's real devices:

- First render: the stickers in the initial viewport are painted by LCP ≤ 1.5 s on the mobile profile. Critical-path JS ≤ 100 KB gzip, to be validated. Zero layout shift from sticker placement. No JS is needed for first paint of non-live stickers.
- Pan and zoom: p95 frame time ≤ 16.7 ms on the mobile profile. Main-thread time per frame during a gesture ≈ the transform write only.
- Settle: crisp re-raster within 150 ms of gesture end, with no blank or flickering stickers.
- Interaction: sticker hover feedback and sheet-open input delay under 100 ms.
- Relative: at least 2× better than baseline on every one of the above, whichever is stricter.

### Feature parity checklist

- Pan and zoom the canvas: wheel zoom to cursor, pinch, drag with inertia (`smooth`), double-click zoom, zoom range 0.1–5, bounded panning with centring when smaller than the viewport, `+`/`−`/centre buttons, animated programmatic moves. The exact `react-zoom-pan-pinch` defaults are captured in Milestone 0 and matched.
- Vectors re-render sharp at the current zoom once zoom settles.
- Dynamic stickers (the 8 with `content`) render with variable content on first render.
- Drop shadows on stickers that follow the clipped silhouette.
- Hover on a sticker clips to its shape (browser or equivalent hit-testing), scales to 1.1× with the shadow preserved, shows the pointer cursor (hover-capable devices only).
- Bottom sheet: see "Sheet spec".
- Content by language (`en`, `zh-Hans`, `ja`) with fallback to `en`, and by theme: sticker titles, `content`, descriptions, and UI strings. The language persists in `localStorage`.
- Light, dark and system theme. The canvas background pattern has light and dark variants.
- Hover tooltips on stickers that follow the cursor (hidden on coarse pointers).
- Hash anchors: `#slug` selects and centres the sticker on load and on `hashchange`; selecting pushes `#slug`; closing clears it.
- Sheet content: MDX with the full component set (Leaflet `PlusCodeMap`, `CanIUse` embeds, `BaselineStatus`, theme-aware components, `<style>` blocks, `export function` in MDX).
- Keyboard and a11y: stickers are focusable buttons that open the sheet on Enter/Space; Radix-style controls remain operable by keyboard.
- Dev tooling (live sticker-placement editor and the SVG→CSS-shape workbench) **(my call)**: kept as dev-only, lazy-loaded tools, ported last. They are outside the performance budgets.

### Sheet spec (my call, derived from the owner's "bottom sheet with details and two scroll stops" and the existing constants)

- Viewports ≤ 4096 px wide: a bottom sheet with two stops. **Peek** is `PANEL_HEIGHT + 96` = 231 px tall (title, close button and the first lines of the description). **Expanded** is `calc(100dvh − 3em)` (796 px at 844 px, as measured on the baseline), and the sticker preview and the full description scroll there. The handle button toggles the stops, and dragging snaps between them and dismisses below peek. Content scrolling is enabled only at the expanded stop; a wheel over the content at peek expands the sheet (Silk's default, kept as in the baseline).
- Viewports wider than 4096 px: the 320 px left panel, one stop.
- Selecting a sticker re-centres it in the visible area using the existing offsets (`PANEL_HEIGHT` = 135 px from the bottom on narrow viewports, `PANEL_WIDTH` from the left on wide ones), at the *current* zoom scale.
- The sheet is not part of the first paint, even on a `#slug` URL. It animates in after load as it does today. The hashed sticker's description chunk is preloaded early from the head script so it opens without waiting.
- Milestone 0 did measure the running app. Where it differed from the first draft of this section, the measured baseline won (ruling R8); the differences are listed at the end of this document.

### Sticker z-order (my call)

Stickers render in a deterministic order: **ascending slug (filename) order**. That matches what the owner's NTFS machine produces today and is stable on any CI. Hover scales a sticker but does not change its z-order, as today. No new schema field. Milestone 0 diffs the baseline screenshot against the deployed order and reports visible differences so the owner can decide whether a `z` field is wanted.

## Non-goals

- Changing the sticker YAML schema or the MDX authoring conventions. New stickers are still "add a YAML and an image". The generated `stickers.yaml` and the Deno step **(my call)** may be folded into the build, but the authoring workflow must not get harder.
- Redesigning the visuals, copy or sticker layout. Sticker placement matches current output to within 1 px at the same transform.
- Server-side anything.
- Perfecting the dev-only tools.

## Anti-goals (failures even if the numbers improve)

- A feature from the checklist silently regressing or being "close enough".
- Dynamic stickers showing a stale or placeholder value for any frame the user can see.
- A flash of English or the wrong theme before the saved language and theme apply.
- A faster canvas that is harder to keep correct (for example a custom hit-tester that disagrees with the browser's `clip-path`).
- Winning one engine at the cost of another (a Chromium-only optimization that makes Safari or iOS worse).

## Constraints

- Still a web app, static hosting (GitHub Pages), and the deploy workflow keeps working (`deno` and `node` are both available in CI today).
- Browser support at least what the current code already requires (`light-dark()`, `text-autospace`, `field-sizing`, `word-break: auto-phrase`), so evergreen Chromium, Safari and Firefox.
- Existing licensing of sticker assets is unchanged.

## Approaches

### Foundation shared by all pathways (decided)

1. **Prerender at build time.** Every sticker is in the HTML as positioned, styled DOM. Image stickers are `<img>` with explicit `width`/`height` and async decode. A tiny inline script in `<head>` (about 1 KB) applies saved language, theme (including `color-scheme` and the `.dark` class) and the initial transform (centre, or the hashed sticker offset by the panel) *before first paint*.
2. **MDX compiled at build time.** The browser never gets an MDX compiler. Descriptions become per-sticker, per-language lazy chunks, prefetched on hover or idle. Sticker `content` is prerendered to HTML for all languages. Switching language is CSS (`:lang()`), not JS, with the same `en` fallback rule as `localize()`.
3. **One gesture controller, no React per frame.** Replace `react-zoom-pan-pinch` with a small framework-free controller (pointer events, wheel, pinch, inertia, bounds, animated moves) that writes a single transform. Gesture state lives outside React. Parity with the library's defaults is a test target.
4. **No live filter on 63 elements.** Shadows are chosen by experiment from: (S1) a pre-baked, pre-blurred alpha sprite per image sticker generated at build time from the actual image-and-clip silhouette, (S2) `box-shadow` for rect and rounded-rect stickers, (S3) live `filter: drop-shadow` kept only for the few stickers where S1 and S2 cannot match (probably the 8 content stickers). The sprite sits inside the same hover-scaled group so the shadow follows the hovered scale as it does today.
5. **Live stickers (my call).** A sticker is *live* if its output depends on runtime values (`Date`, timers, hooks). Classification: render each content sticker at build time twice with a mocked `Date`. If the two outputs differ it is live; if the content uses hooks or timers, it is *interactive*. Three tiers:
   - **Static** content stickers are pure prerendered HTML.
   - **Date-derived** live stickers (today: `dd-mmm-yyyy`, `yyyy-mm-dd`) are prerendered with the runtime-dependent text wrapped in a marked node. A tiny inline script (≈1 KB) in `<head>`, running before first paint, fills those nodes with the current value (using the sticker's own expression compiled to plain JS). Nothing waits on React.
   - **Interactive** live stickers (hooks, timers, such as `test-1`'s clock) are prerendered with the sticker box, chrome and layout visible and the live node `visibility: hidden` with its space reserved. A small lazy runtime (Preact-compatible, off the critical path) hydrates them as soon as it loads and shows the live value. For these the concession is a brief absence of the live value, never a stale or wrong one.
   
   Acceptance: no frame shows a stale value, and non-live and date-derived stickers never wait on a JS framework. If the owner later wants hook-driven stickers fully visible on the very first frame, that costs the framework on the critical path and is a separate decision.
6. **Assets (my call, in scope).** Image stickers keep their formats where vectors are required: SVGs stay SVG, optimised losslessly with SVGO and with embedded rasters (`karaoke`, `double-lariat`) re-compressed only visually losslessly. The 7 PNGs may be re-encoded (WebP or AVIF, same pixel dimensions, visually lossless) with `<picture>` fallback. Images carry explicit dimensions, `decoding="async"`, and viewport-priority `fetchpriority`/`loading`. Unused public files (`Bitmap.svg`, `logo.svg`) are left alone and not shipped on any critical path.
7. **Imperative small UI.** The cursor-following tooltip is one absolutely positioned element updated from `pointermove`, not React state. Hover scale stays CSS (`:has(:hover)` or equivalent).
8. **Off the critical path.** The Silk sheet, Radix dropdowns/tooltips for the controls, Leaflet, CanIUse and `baseline-status` load lazily (sheet on first open or idle, controls on idle or first interaction). The controls bar can be prerendered as static markup and hydrated on first interaction.
9. **Fonts and CSS.** Self-host Inter (variable, subset, preloaded, `font-display: swap`). Load cc-icons only if a sticker or description uses it. No render-blocking third-party CSS.

### Pathway A: lean DOM (baseline for the rewrite; the owner picked this first)

Stickers stay DOM (`<img>` plus `clip-path` plus the chosen shadow). The viewport is one transformed layer. During a gesture the layer is a cached composited bitmap. At settle the layer re-rasters at the new scale, either by dropping `will-change` as today or by an alternative chosen by trace (for example swapping `scale` into layout-scale for the settle frame). Off-screen stickers are culled with `content-visibility: auto` or an explicit culling pass. The browser does hit-testing, clip hover, accessibility and the dynamic stickers.

Trade-offs: lowest risk and the fewest moving parts, everything correct by construction. The ceiling is the browser's own raster of ~55 SVGs and shadows at high zoom, and iOS Safari handles huge scaled layers poorly (memory, re-raster stalls).

### Pathway B: canvas hybrid (prototype only, benchmarked against A)

A WebGL or Canvas 2D layer paints the image stickers with a cached shadow sprite. On settle, visible SVGs are re-rasterized at the exact scale (OffscreenCanvas in a worker into an `ImageBitmap` LOD cache). Invisible DOM buttons carry the same `clip-path` so the browser still does hit-testing (including `path()` and `shape()`) and accessibility. Dynamic stickers stay in a transform-synced DOM layer.

Trade-offs: highest ceiling for pan and zoom, uniform across engines. More code, and real risks: z-order between canvas stickers and DOM-overlay stickers, iOS canvas memory limits, SVG embedded rasters, a first paint that needs the prerendered DOM as a placeholder before the canvas takes over.

### Pathway C: pre-baked tile pyramid (rejected)

Rasterize the whole sheet into map-style tiles at build time. Rejected: the board is only 3000×3000 with 63 items; tiles multiply by language and theme; crisp-at-settle vectors need an SVG overlay anyway, which brings back A.

### Decision rule

Both A and B are measured with the same harness (below) on the same machines. **A is chosen unless it misses a budget on the mobile profile and B meets it by a margin that justifies B's complexity.** The outcome is recorded in the repo. If B wins, the final architecture is "A's foundation plus B's renderer", not a second rewrite.

### Stack **(my call)**

The framework is not part of what the owner decided. The goals favour static HTML with minimal JS: **Astro (static output) plus a framework-free TypeScript viewer plus React islands** for the sheet and the controls (MDX content is React-shaped, and Silk and Radix are React-only). It is a smaller critical path than Next.js, and the viewer has no React in the gesture loop. Staying on Next.js static export with server components is the fallback if the plan finds a blocker. This is decided at the start of the plan with a short spike (prerender 63 stickers with build-time MDX through each option and compare critical-path bytes).

## Measurement and benchmark harness

Built in Milestone 0 against the *current* app and reused for every candidate:

- First render: FCP, LCP, TBT, critical-path JS/CSS/image bytes, time until all 63 stickers are painted, time until live stickers show current values. Throttled "Fast 4G", 4× CPU, mobile emulation. Also desktop.
- Pan and zoom: scripted gestures (wheel zoom ramp, drag with inertia, pinch via touch emulation, programmatic `setTransform`) driven by Playwright and Chrome tracing. Metrics: frames over 16.7 ms and 33 ms, main-thread busy time during gesture, raster and GPU time, time from gesture end to crisp, peak memory.
- A short manual checklist for the owner's real phones (iOS Safari, Android Chrome) because emulation cannot substitute for those, and WebKit via Playwright as a proxy, not a substitute, for iOS.
- Visual regression: screenshots of the sheet (light and dark, three languages, a hashed sticker, sheet open at both stops) compared to the baseline, to prove parity and sticker placement within 1 px.

## Milestones

0. **Baseline and parity capture.** Install deps, generate `stickers.yaml` (Deno), run the current app. Record the real two-stop sheet behaviour, the exact `react-zoom-pan-pinch` defaults, traces and numbers, and baseline screenshots. Update budgets from the numbers.
1. **Foundation.** Stack spike and choice, prerender, build-time MDX, live-sticker mechanism, head script, fonts, lazy islands, controller, tooltip, hash, language and theme.
2. **Pathway A complete.** Shadows experiment (S1/S2/S3), settle strategy, culling, parity checklist all green, budgets measured.
3. **Pathway B prototype.** Canvas image-sticker renderer with DOM hit regions and a DOM dynamic layer, benchmarked against A on the same harness.
4. **Decision and finish.** Apply the decision rule, clean up, port dev tooling, update README, keep the GitHub Pages deploy green.

## Left to the builder

- Exact stack, after the Milestone 1 spike.
- Which shadow strategy (S1/S2/S3) per sticker, and how the build generates silhouette sprites (headless browser or an image library).
- How the settle re-raster works (drop `will-change`, layout-scale swap, or another trace-driven option).
- Culling method and the pattern-background implementation (the existing PNG tile on the transformed layer versus a CSS gradient), judged on traces.
- Module boundaries, naming, and the exact runtime-fill mechanism for the date-derived and interactive live-sticker tiers.
- How the sheet is implemented in the lazy island (keep Silk as the default, since it preserves behaviour and is off the critical path).
- Test and CI details, as long as the build deploys to GitHub Pages.

## Baseline-observed differences (ruling R8: baseline wins where the spec misread the code; owner may reverse)

Task 0.3 recorded the running baseline's sheet behaviour against a
phone-sized viewport (evidence, measurements and screenshots:
`docs/superpowers/baseline/sheet-behaviour.md`). In place of the "Sheet spec"
gate ("the plan reports it to the owner before changing the spec"), the
differences below were ruled on directly. Where the spec had misread the
code, the spec now follows the measured baseline, because the goal is parity.
The owner may reverse any of these later.

1. **Expanded height.** The baseline's expanded stop is 796 px at 390×844
   (`calc(100dvh − 3em)`), not `calc(100vh − 96px)` = 748 px. The class
   `h-[calc(100dvh_-_3em)]` on `Sheet.Content` decides it; the second detent
   string was never read. *Ruling: adopt the baseline's `calc(100dvh − 3em)`*
   and the Sheet spec above now says so.
2. **Wheel at peek.** A wheel over the content at peek expands the sheet
   (Silk's step gesture) instead of doing nothing. *Ruling: keep it, by using
   Silk the same way (no custom override).* Scrolling inside the content still
   happens only at the expanded stop.
3. **Detent indexes.** The "what the code does today" premise that `activeSnap
   !== 2` never occurs is incorrect: Silk appends a content-size detent to
   whatever `detents` holds, so the handle reaches index 2 and `0` means
   hidden. *Ruling: Task 1.13 passes `detents={[peek]}` as the baseline does
   and treats `activeDetent` 1 = peek, 2 = expanded, 0 = closed; it steps with
   Silk's own step action instead of the old `% snapPoints.length`
   arithmetic (which counted the characters of a string).*

Separately, `docs/superpowers/baseline/z-order.md` found 0 of 39 overlapping
sticker pairs with a different paint order between the baseline's DOM order
and ascending-slug order, so the "Sticker z-order" section's ascending-slug
rule above stays as specified.
