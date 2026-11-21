# Stack: Astro 7 static output + framework-free TypeScript viewer + React islands (`client:idle`)

Status: decided, with one flagged rule-reading (see "Applying the rule"). Next.js static export is the rejected fallback.

Spike: 63 stickers prerendered as positioned DOM (box, `<img>` with `width`/`height`, YAML-driven) plus one lazily hydrated React island that renders the build-compiled `dark` en MDX. Both builds were measured with `bench/first-render.bench.ts` (`TARGET=new`, mobile profile, 5 cold runs). The spike dirs are deleted; this record is the only output.

## Measurements (mobile: Pixel 7 emulation, 4x CPU, Fast 4G, 5 cold runs)

| Metric | Astro | Next.js export | Old app (baseline-m0) |
|---|---|---|---|
| LCP median / p95 | 500 / 516 ms | 508 / 516 ms | 2,772 / 3,020 ms |
| FCP median / p95 | 332 / 352 ms | 380 / 428 ms | 724 / 756 ms |
| TBT median / p95 | 7 / 11 ms | 106 / 134 ms | 726 / 928 ms |
| `criticalPathJsGzip` (bench: JS finished before LCP) | 0 B | 0 B | 473,458 B |
| JS gzip requested by the initial HTML (`<script src>`) | 0 B | 136,985 B (6 async scripts) | n/a |
| Total JS gzip over the whole run | 70,490 B | 137,634 B | n/a |
| Total JS transferred | 72,990 B | 140,111 B | 439,685 B |
| HTML transferred (raw on disk) | 10,142 B (35,151) | 13,689 B (81,143 incl. RSC payload) | 35,446 B |
| Total transferred, all types | 2,395,688 B | 2,466,356 B | n/a |
| Latest JS response end (any run) | 992 ms | 2,784 ms (slowest single response end across all 5 cold runs; the 756-955 ms figure below is the median-run range) | n/a |

The LCP element is a sticker image (`eana.svg`) in both spikes, so LCP is image-bound and does not separate the stacks. All 63 stickers are visible at FCP in both (one Astro run showed 50). CLS is 0 in both.

## Applying the rule (Step 3)

- **(a) Blocker:** none. All three checks passed on both stacks (evidence below).
- **(b) Next critical-path JS gzip <= Astro's:** the bench metric is 0 B for both, so the literal inequality holds. It is a degenerate tie: the bench counts only scripts whose response ends before LCP, and the mobile profile delays Next's six async framework scripts (requested at ~22 ms, found by the parser, 136,985 B gzip) to 756-955 ms, just after the ~500 ms image LCP. Astro's HTML has no `<script src>` at all; its React JS loads only after idle. I read the critical path as JS the initial HTML requests, which is the spec's "critical-path bytes" in structural terms. On that reading Astro is 0 B and Next is 136,985 B, so (b) is false and Astro wins. Total JS (70 vs 138 KB gzip) and TBT (7 vs 106 ms) point the same way.
- **Flag for the controller:** read literally on the bench metric, (b) selects Next. If that reading is preferred, use the Step 4 mapping below; nothing else in this record changes.
- Both spikes lack the viewer and the real content stickers (the 8 content stickers are stubbed; the two date stickers fill from an inline script). The viewer is plain TS in either stack, so it does not change the comparison.

## Blocker checks (Playwright 1.65.1, Chromium 159, real built output, served statically)

1. **MDX with `_provideComponents()` and `<Button>` inside an `export function`** (both stacks). Clicking `button.sticker[data-slug="dark"]` loaded the compiled chunk (Astro `/_astro/en.*.js`) only on click. `[data-description]` then contained `<p>I prefer using <strong>dark mode</strong> on screens.</p>`, `<div class="hidden dark:block">Looks like you’re using dark mode too, yay!</div>` and `<button type="button" class="dark:hidden" data-ui="button" style="width: 100%;">Try out dark mode</button>`, plus the `<style>` block. Before the click: `html.className=''`, the `dark:block` div `display:none`, the button `inline-block`. After clicking that Button: `html.className='dark'`, `localStorage.theme='dark'`, div `display:block`, button `display:none`, 0 page errors. So the exported function's own `_provideComponents().useTheme()` call and the `Button` it renders both resolved.
2. **Lazy hydration.** Method: Playwright `page.route` held the island chunk. At `load` there were 63 stickers, `dataset.boot='1'` and `#sheet[data-hydrated]='false'`; the island chunk was first requested after `load` and the idle callback (Astro 104 ms vs load 99.5 / idle 100.6 ms; Next 131 ms vs load 118 / idle 128 ms). After release, `data-hydrated` became `true`. Astro uses `client:idle`; Next uses `next/dynamic` mounted from a `requestIdleCallback`.
3. **Inline `<script>` before first paint.** Method: CDP `Page.enable` + `Page.addScriptToEvaluateOnNewDocument` installing a passive `MutationObserver` (on `document`, `attributes` + `subtree`, since `documentElement` is still null then) and a `PerformanceObserver('paint')`, with `localStorage.theme='dark'` pre-seeded. Astro: boot at 8.6 ms, `.dark` at 8.9 ms, first paint = FCP = 84 ms, `className` at the first-paint callback `dark`, body background `rgb(20, 20, 20)`. Next: boot at 8.2 ms, `.dark` at 8.4 ms, first paint 92 ms, same class and background. The boot script sits at HTML offset 302 in Astro and 4,066 in Next, both before `</head>`.

## What worked in Astro (reuse in Tasks 1.2 / 1.5)

`package.json`: `"type": "module"` and `"imports": { "#mdx-provider": "./src/mdx-provider.tsx" }`. Node subpath imports resolve in Vite 8 with no alias, even from a `\0` virtual-module importer; the provider is bundled into the same chunk as the compiled MDX.

`astro.config.mjs` (Vite virtual-module plugin; `virtual:mdx/<slug>/<lang>`):

```js
function mdxDescriptions() {
  return {
    name: "mdx-descriptions",
    resolveId(id) { if (id.startsWith("virtual:mdx/")) return "\0" + id; },
    async load(id) {
      if (!id.startsWith("\0virtual:mdx/")) return;
      const [slug, lang] = id.slice("\0virtual:mdx/".length).split("/");
      const file = path.join(STICKER_DIR, `${slug}.yaml`);
      this.addWatchFile(file);
      const source = localize(yaml.load(fs.readFileSync(file, "utf8")).description, lang);
      const compiled = await compile(source, { outputFormat: "program", providerImportSource: "#mdx-provider" });
      return { code: String(compiled), map: null };
    },
  };
}
export default defineConfig({ output: "static", integrations: [react()], vite: { plugins: [mdxDescriptions()] } });
```

- With `providerImportSource`, MDX rewrites the exported function to `let {Button} = _provideComponents() || {}`, which is why `<Button>` inside it resolves. `_provideComponents` is a top-level import, so the user's own call works too.
- `#mdx-provider` (`.tsx`) exports `useMDXComponents()` returning `{ Button, useTheme }`. `useTheme` toggles `html.dark` and writes `localStorage.theme`.
- The island loads the description with `import("virtual:mdx/dark/en")` in an effect and renders `m.default`. Each (slug, lang) becomes its own chunk (~1.6 KB for `dark` en), fetched on demand. Caveat: this per-chunk split was proven for one literal specifier only; it is not guaranteed for a template-literal id like `` import(`virtual:mdx/${slug}/${lang}`) ``, since Rollup/Vite's static chunk-splitting for dynamic `import()` recognises only literal string specifiers. Scale it via a generated manifest of literal per-(slug,lang) imports (as Task 1.5's `Record<slug, Record<lang, () => Promise<...>>>` does), not a template-literal specifier.
- Page: `<Sheet client:idle />` emits `<astro-island client="idle">` plus a tiny inline idle bootstrap and no `<script src>`. `client.*.js` (react-dom, 213 KB raw) is requested only after idle.
- Head: `<script is:inline set:html={BOOT} />` and `<style is:inline set:html={CSS} />`. `is:inline` keeps Astro from bundling or deferring them.
- The spike's island attaches a document click listener when it hydrates, so a click before hydration is lost. The real viewer must own the click path from first paint: the plan puts sticker click delegation in `src/viewer/interactions.ts` on `#canvas`, outside any island (Task 1.11), and zoom/centre buttons behind `data-action` handled in `main.ts` (Tasks 1.7/1.12), so a click before an island hydrates is never lost in the real build.
- Bench mechanics: the bench waits for all images to be complete and for the en-GB `dd MMM yyyy` live date, else it runs to the 120 s deadline. Put an inline script right after the canvas markup that fills `[data-live]`.

## What worked in Next (only needed if Step 4 applies)

- `next.config.mjs`: `output: "export"`, `images: { unoptimized: true }`, `turbopack: { root: import.meta.dirname, rules: { "*.yaml": { loaders: ["./mdx-yaml-loader.cjs"], as: "*.js" } } }`, plus an equivalent webpack rule. The async CJS loader does `await import("@mdx-js/mdx")`, parses the YAML with js-yaml and returns `String(await compile(data.description.en, { outputFormat: "program", providerImportSource: "#mdx-provider" }))`.
- `#mdx-provider` resolved through the same package.json `imports` entry under Turbopack.
- Turbopack does not import YAML from outside the project root, so the spike copied `dark.yaml` into the project.
- Set `turbopack.root`, or Next warns about two lockfiles when a nested project exists.
- Inline scripts mutate the DOM before hydration. `suppressHydrationWarning` is needed on `<html>` and on any `[data-live]` span, or React 19 reports a mismatch and re-renders client-side.
- `layout.jsx` puts the inline BOOT script and `<style>` in `<head>` via `dangerouslySetInnerHTML`. The lazy island is a `'use client'` wrapper that mounts `next/dynamic(() => import("./Sheet"), { ssr: false })` from `requestIdleCallback`.
- Next cannot defer its framework: 6 async scripts are in the HTML and hydrating the whole tree cost 91-134 ms of TBT. It also emits 55 `<link rel="preload" as="image">` tags and `out/__next.*.txt` RSC payload files.

## If Next wins: Step 4 mapping (verbatim from the plan)

`src/pages/index.astro` → `src/app/page.tsx` plus `layout.tsx`; `astro.config.mjs` → `next.config.ts` with `output: 'export'`; the Vite virtual-module plugin → a webpack/turbopack loader with the same exports; `dist/` → `out/`. Everything under `src/lib`, `src/viewer`, `src/inline`, `scripts`, `tests`, `bench` is unchanged.

## Versions and environment

astro 7.4.13 (Vite 8.3.8, Rolldown), @astrojs/react 7.1.9, @mdx-js/mdx 3.1.1, js-yaml 4.3.2, next 16.4.6 (Turbopack), react / react-dom 19.3.1 in both spikes (the root app is on next 16.1.6, react 19.2.4), Playwright 1.65.1, Chromium 159.0.8154.6, Node v26.12.1, npm 12.2.0, Windows 11, Ryzen 9 9950X.

## Build time and pitfalls

- Astro: `npm install` 10.6 s (280 packages, 0 vulnerabilities), first `astro build` 4.6 s, rebuilds about 1 s. Next: `npm install` 23 s, `next build` 4.2 s.
- Astro 7 and Vite 8 (Rolldown) run on Node 26.12.1 with no workaround, and no Windows path problem appeared in either stack. `@astrojs/react` lists an `oxc-transform-react` peer that was not needed.
- The bench serves the build with `npx serve <dir> -l 4173` and `reuseExistingServer`: check the port is free between runs and give each run a distinct `BENCH_LABEL`, or an earlier `bench/results/<label>-mobile.json` is overwritten. Those summary files are not gitignored; do not commit spike results.
- `criticalPathJsGzip` is race-sensitive: it only counts scripts finished before LCP. With an image LCP at ~500 ms it reads 0 for any stack that loads JS after paint, so it cannot rank stacks. Report parser-requested JS and total JS beside it in later milestones.
- In the proof, the controls overlay blocked Playwright clicks on the description button, so the controls sit top-right and the sheet at the bottom.

## Deep-link chunk prefetch (Task 1.13)

The plan has a head script preload the Sheet chunk for a `#slug` deep link. A static `<link rel="modulepreload">` cannot name Vite's hashed chunk, so `src/viewer/deeplink.ts` is a tiny `<script type="module">` in `<head>` instead: when the hash names a sticker it calls `import("../islands/Sheet")` (the same chunk the `client:idle` island loads) and `prefetchDescription(slug, lang)`, so the sheet opens without waiting for idle. It imports no React and no description map.
