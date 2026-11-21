# Sticker assets: SVGO, WebP siblings, render-gated

Status: decided and applied (Task 1.8). `npm run optimize-assets` is the pipeline and its output is committed under `public/stickers/`. The page is unchanged apart from `<picture>` around the 7 raster stickers.

## Result

Cold load of `/` (`en`, `npx serve dist`, Chromium; desktop 1440x900 and Pixel 7 give identical numbers). Counted with a `page.on('response')` loop: wire = `request.sizes().responseBodySize` (after content-encoding, headers excluded), decoded = `response.body()` length. `serve` compresses SVG and HTML with brotli, so the wire saving on SVG understates the raw saving.

| | Before (`6abe8aa`) | After | Change |
|---|---|---|---|
| Image requests | 55 (48 SVG + 7 PNG) | 55 (48 SVG + 7 WebP) | 0 |
| Image bytes, wire | 2,294,946 | 716,095 | -68.8% |
| Image bytes, decoded | 3,002,287 | 1,125,811 | -62.5% |
| SVG only, wire (48) | 395,435 | 196,747 | -50.2% |
| PNG to WebP, wire (7) | 1,899,511 | 519,348 | -72.7% |
| Whole page, wire (59 requests) | 2,455,704 | 876,921 | -64.3% |
| Whole page, decoded | 3,231,439 | 1,355,404 | -58.1% |

On disk, `public/stickers/`:

| | Before | After |
|---|---|---|
| 53 optimised SVGs | 1,126,702 | 623,283 (-44.7%) |
| `Bitmap.svg`, `logo.svg` (skipped, see below) | 1,028,271 | 1,028,271 |
| 7 PNG | 1,899,511 | 1,899,511 (kept: the `<img src>` fallback) |
| 7 new `.webp` siblings | n/a | 519,348 |

### Per file

Bytes at `6abe8aa` (checked-out size) vs now. Unchanged: the 7 PNGs, `Bitmap.svg`, `logo.svg`.

| File | Before | After | Change |
|---|---|---|---|
| `sui-dau.webp` (vs `sui-dau.png`) | 647,612 | 283,802 | -56.2% |
| `yurucom.webp` (vs `.png`) | 431,158 | 66,618 | -84.5% |
| `typechat.webp` | 352,619 | 52,086 | -85.2% |
| `yurugengo.webp` | 333,140 | 82,736 | -75.2% |
| `xkcd.webp` | 53,546 | 16,154 | -69.8% |
| `earth.webp` | 50,525 | 9,258 | -81.7% |
| `yofukashi.webp` | 30,911 | 8,694 | -71.9% |
| `karaoke.svg` | 176,499 | 144,529 | -18.1% |
| `gif.svg` | 158,361 | 61,291 | -61.3% |
| `double-lariat.svg` | 129,294 | 45,714 | -64.6% |
| `typography.svg` | 111,622 | 59,578 | -46.6% |
| `pi.svg` | 83,124 | 35,932 | -56.8% |
| `next-js.svg` | 67,187 | 27,087 | -59.7% |
| `kagami.svg` | 40,246 | 26,184 | -34.9% |
| `regex.svg` | 26,075 | 13,129 | -49.6% |
| `shs.svg` | 25,525 | 17,614 | -31.0% |
| `inter.svg` | 21,391 | 8,828 | -58.7% |
| `xkjd27c.svg` | 20,485 | 14,843 | -27.5% |
| `si.svg` | 20,284 | 8,660 | -57.3% |
| `shoshitsu.svg` | 19,979 | 13,717 | -31.3% |
| `Combined Shape.svg` | 19,613 | 13,511 | -31.1% |
| `icpc.svg` | 16,099 | 12,951 | -19.6% |
| `map.svg` | 15,907 | 9,716 | -38.9% |
| `colemak.svg` | 15,199 | 8,013 | -47.3% |
| `dumbbell.svg` | 13,529 | 7,617 | -43.7% |
| `ja.svg` | 13,461 | 7,451 | -44.6% |
| `code-liga.svg` | 11,660 | 6,409 | -45.0% |
| `riddler.svg` | 10,940 | 8,693 | -20.5% |
| `react.svg` | 8,961 | 5,726 | -36.1% |
| `sass.svg` | 8,514 | 5,555 | -34.8% |
| `pedantic.svg` | 8,421 | 5,924 | -29.7% |
| `contoso.svg` | 8,288 | 5,139 | -38.0% |
| `space-tab.svg` | 8,002 | 3,833 | -52.1% |
| `quizknock.svg` | 7,582 | 5,165 | -31.9% |
| `vscode.svg` | 7,047 | 5,234 | -25.7% |
| `font-distinct.svg` | 6,080 | 3,351 | -44.9% |
| `quotes.svg` | 6,175 | 2,931 | -52.5% |
| `utc.svg` | 4,026 | 2,572 | -36.1% |
| `figma.svg` | 3,805 | 2,609 | -31.4% |
| `zh.svg` | 3,197 | 2,018 | -36.9% |
| `en.svg` | 2,845 | 1,897 | -33.3% |
| `internet.svg` | 2,687 | 2,034 | -24.3% |
| `08n.svg` | 2,679 | 1,765 | -34.1% |
| `cpp.svg` | 2,546 | 1,877 | -26.3% |
| `yaml.svg` | 2,039 | 1,343 | -34.1% |
| `typescript.svg` | 1,747 | 1,099 | -37.1% |
| `eana.svg` | 1,725 | 832 | -51.8% |
| `git.svg` | 1,683 | 1,203 | -28.5% |
| `fffd.svg` | 1,329 | 858 | -35.4% |
| `feed.svg` | 1,314 | 1,173 | -10.7% |
| `dark.svg` | 1,313 | 1,037 | -21.0% |
| `git-plain.svg` | 1,282 | 977 | -23.8% |
| `Path.svg` | 1,131 | 846 | -25.2% |
| `css.svg` | 1,091 | 1,055 | -3.3% |
| `kotlin.svg` | 1,008 | 826 | -18.1% |
| `vocaloid.svg` | 988 | 735 | -25.6% |
| `mdx.svg` | 879 | 663 | -24.6% |
| `shadcn-ui.svg` | 722 | 553 | -23.4% |
| `kotlin-plain.svg` | 625 | 552 | -11.7% |
| `Logotypes.svg` | 491 | 434 | -11.6% |

## Settings

**SVGO 4.1** (`multipass`, `preset-default`) with three overrides, each found by the render gate:

- `inlineStyles: false`. The default inlines `<style>` rules and drops `@media (prefers-color-scheme)` blocks, which `mdx.svg` and `xkjd27c.svg` rely on (93.6% and 99.1% of pixels differed in light scheme).
- `convertPathData.makeArcs: false`. It re-approximates curves as arcs and moved `mdx.svg`'s rounded corners (0.195% in dark with `includeAA`).
- `cleanupIds: false`. `<use>`, masks and `url(#...)` references must keep resolving, and it costs only 4 KB (0.6%) over the set (717,187 vs 713,224 B).
- `viewBox` is kept (svgo 4's default preset has no `removeViewBox`; a candidate that loses it is rejected). Animations: none of the SVGs use SMIL or `@keyframes`; the gate passes `animations: 'disabled'` anyway.
- Rung 2, "svgo precision 6" (`convertPathData.floatPrecision: 6`, `convertTransform` `floatPrecision: 6` / `transformPrecision: 8`), is only used when rung 1 fails the gate: `typography.svg` (glyph outlines) and `double-lariat.svg` (`scale(0.00138504 0.00330033)` on a 722 px bitmap, which the default rounds to `.00139 .0033`).

**Embedded rasters.** Every `data:image/(png|jpeg);base64,...` in an SVG is re-encoded as a WebP data URI and the SVG stays an SVG. A scan of `public/stickers/*.svg` finds four files with one: `karaoke.svg`, `double-lariat.svg`, `Bitmap.svg` and `logo.svg`. The last two are skipped as the brief says and are byte-identical to before.

**WebP** (sharp 0.35 / libwebp 1.6, `effort: 6`). Three rungs, smallest passing output wins:

1. lossy `quality: 90`, `alphaQuality: 100`, `smartSubsample` (photographic art: `earth`, `typechat`, `yofukashi`, `yurucom`, `yurugengo`);
2. near-lossless `quality: 40` (hard-edged art: `sui-dau`, `xkcd`, both embedded rasters). Level 1 already fails on `sui-dau` (0.0474%); 20 and above are exact, 40 leaves margin;
3. lossless.

Lossy q90 bleeds chroma at hard edges (`sui-dau` lossy q90: 0.0651%), which is why near-lossless exists. The 7 `.webp` files are siblings of the PNGs at the same pixel size; the PNG is the `<img src>` and the fallback inside `<picture>`.

## The gate

`scripts/optimize-assets.ts` renders the original and the candidate as `<img>` (`display:block; object-fit:contain`, exact size) in the repo's Chromium and compares with pixelmatch at per-pixel `threshold: 0.1` (default options, anti-aliasing not counted). A file passes when the worst scene differs in at most 0.05% of its pixels. Scenes: light (white page) and dark (`colorScheme: 'dark'`, black page), each at DPR 1 and 2, at the YAML display size and at the natural size (PNG natural size at DPR 1 only; longest side capped at 1024 px). The dark scheme runs for every file, so it covers `mdx.svg`, `xkjd27c.svg` and any other `prefers-color-scheme` SVG. The run throws if the original renders blank in every scene, and a candidate that does not decode is rejected. A file that fails every rung is not written (and recorded in the table the run prints).

The brief's wording ("threshold 0.1") is pixelmatch's default behaviour, so the final gate uses the defaults. `includeAA: true` also counts anti-aliased edge pixels as differences and is stricter; an earlier iteration used it, which is how the `makeArcs` shift was found (`karaoke.svg` measured 0.0503% then). The final output was not re-measured with it.

Worst accepted diffs close to the limit: `si.svg` 0.0400%, `karaoke.svg` 0.0340%, `gif.svg` 0.0320%, `code-liga.svg` 0.0278%, `typography.svg` 0.0259%; everything else is at most 0.0100%.

### Rejected candidates

No file ended up unwritten; these candidates failed and the next rung was used (or the setting was removed from the config).

| Candidate | Diff | Scene |
|---|---|---|
| `mdx.svg`, SVGO with `inlineStyles` | 93.6% | light |
| `xkjd27c.svg`, SVGO with `inlineStyles` | 99.1% | light |
| `mdx.svg`, SVGO with `makeArcs` (`includeAA`) | 0.195% | dark (earlier gate) |
| `karaoke.svg`, SVGO with `makeArcs` (`includeAA`) | 0.0503% | earlier gate |
| `double-lariat.svg`, precision 3 + embedded near-lossless 40 | 5.6305% | 159x100 @2x light |
| `typography.svg`, precision 3 | 0.0560% | 268x100 @1x dark |
| `sui-dau.png`, lossy q90 | 0.0651% | 1030x670 @1x dark |

## Rerunning

`scripts/optimized-assets.json` maps each output filename to a SHA-256 of the files that define its settled state (the SVG; or the PNG plus its `.webp`). A recorded file is skipped, because processing is lossy: without the manifest a second run recompressed `typography.svg` again (59,578 to 52,664 B, 0.0485% off its own input) and re-rejected `double-lariat.svg`. With it, a second `npm run optimize-assets` took 1.2 s, every file read "up to date", all 69 files and the manifest hashed identically, and `git status` did not change. After a deliberate re-optimisation, delete the manifest entry (or the manifest) and restore the originals from git first.

## Visual check against the baseline

`tests/visual/baseline.spec.ts` (exact match against the recorded `tests/visual/__snapshots__`) still has the font anti-aliasing residual from Task 1.7, so the comparison against the old app is opt-in: `VISUAL_MAX_DIFF` (default 0, i.e. unchanged) sets `expect.toHaveScreenshot.maxDiffPixelRatio` in `playwright.config.ts`. Run with `TARGET=new STATIC_DIR=dist VISUAL_MAX_DIFF=0.01 npx playwright test tests/visual -g initial --project=chromium-desktop`: all 6 `initial` scenes (en, zh-Hans, ja x light, dark; desktop) pass. `desktop-light-en-hash-dark` needs the sheet handle (Tasks 1.10 to 1.13) and the hover, tooltip and sheet scenes cannot run on the new page yet. The baselines were not regenerated.

Same 1440x900 frames, pixelmatch (threshold 0.1) against the recorded `tests/visual/__snapshots__` PNGs. Task 1.7 compared against a live `.baseline-site` render instead (0.034%), so the "before" numbers here differ from its table; the before/after pair below uses one reference and one method.

| Scene | Before this task | After |
|---|---|---|
| light, en / zh-Hans / ja | 300 px (0.0231%) | 330 px (0.0255%) |
| dark, en / zh-Hans / ja | 314 px (0.0242%) | 344 px (0.0265%) |

New build against the previous build, same scenes: 30 px (0.0023%) differ in all six, so this task moved 30 pixels of a 1.3 MP frame.

Spot checks (before = `dist` of `6abe8aa`, after = `public/`), rendered at 2x in the gate's page; the scratch PNGs are outside the repo in `C:\Users\ilove\asset-scratch\spot\` (`<file>.<scheme>.before.png`, `.after.png`, `.diff.png`):

| File | Scheme | Differing px |
|---|---|---|
| `karaoke.svg` | light | 23 of 216,000 |
| `double-lariat.svg` | light | 0 |
| `typography.svg` | dark | 9 of 428,800 |
| `sui-dau.webp` vs `.png` | dark | 0 |
| `mdx.svg` | dark | 0 |
| `xkjd27c.svg` | dark | 0 |

## Serving

`Sticker.astro` renders `<picture><source type="image/webp" srcset=".../x.webp"><img src=".../x.png" ...></picture>` when a `.webp` sibling exists in `public/` (`webpSibling()`, a pure function, with the file set read from `public/` at build time) and the plain `<img>` otherwise. The `img` keeps `width`, `height`, `loading`, `decoding` and `fetchpriority`; `picture` is `display: contents`, so `.clip > img` layout is identical. `tests/e2e/first-paint.spec.ts` asserts that all 7 raster stickers resolve to the `.webp` and the 48 SVGs have no `<picture>`.

`Bitmap.svg` (656,570 B) and `logo.svg` (371,710 B) are skipped per the brief and are not referenced by any sticker YAML or any page, so they are never requested. They are about 1.0 MB of `public/` that every deploy copies; removing them is a separate decision.
