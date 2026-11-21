// Build step: announce the eager viewer graph from the head.
//
// Astro emits the page's `<script>` as one `<script type="module" src>` near
// the end of the body and no modulepreload. On a slow link the entry then
// queues behind the sticker images, and its static imports (appState,
// preload-helper) are only requested once it has arrived. Linking the entry
// and every module it statically imports from the head at high priority
// requests all of them at once, ahead of the images.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = /<script type="module" src="(\/[^"]+\.js)"/;
// Static `import … from "./x.js"` and `import "./x.js"`; dynamic `import()` is skipped.
const STATIC_IMPORT = /\bimport\s*(?:[^;()"'`]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g;

export function staticImports(source: string, from: string): string[] {
  return Array.from(source.matchAll(STATIC_IMPORT), (m) => new URL(m[1], new URL(from, "http://x")).pathname);
}

// The module entry of `html` and its static import closure, entry first.
export function eagerGraph(html: string, readModule: (href: string) => string): string[] {
  const entry = ENTRY.exec(html)?.[1];
  if (!entry) return [];
  const graph: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const href = queue.shift()!;
    if (graph.includes(href)) continue;
    graph.push(href);
    queue.push(...staticImports(readModule(href), href));
  }
  return graph;
}

export function injectModulePreloads(html: string, readModule: (href: string) => string): string {
  const head = html.indexOf("</head>");
  if (head < 0) return html;
  const links = eagerGraph(html, readModule)
    .filter((href) => !html.slice(0, head).includes(`href="${href}"`))
    .map((href) => `<link rel="modulepreload" href="${href}" fetchpriority="high">`)
    .join("");
  return html.slice(0, head) + links + html.slice(head);
}

export function modulePreloadIntegration() {
  return {
    name: "eager-modulepreload",
    hooks: {
      "astro:build:done": ({ dir }: { dir: URL }) => {
        const root = fileURLToPath(dir);
        for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".html"))) {
          const htmlPath = path.join(root, file);
          const html = fs.readFileSync(htmlPath, "utf8");
          const read = (href: string) => fs.readFileSync(path.join(root, href), "utf8");
          fs.writeFileSync(htmlPath, injectModulePreloads(html, read));
        }
      },
    },
  };
}
