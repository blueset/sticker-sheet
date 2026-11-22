import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { stickerMdx } from "./src/lib/mdx/vite-plugin.ts";
import { modulePreloadIntegration } from "./scripts/modulepreload.ts";
import devTools from "./src/dev/integration.ts";

// The prerender graph reaches leaflet's stylesheet only through the lazy map import, which the
// static page never renders; Astro would still link it (15 KB, render-blocking) from index.html.
// The client build keeps it, so the Sheet's lazy map chunk still loads its own CSS.
function skipLazyMapCssInPrerender() {
  const empty = "\0empty-leaflet-css";
  return {
    name: "skip-lazy-map-css-in-prerender",
    enforce: "pre",
    resolveId(source) {
      if (this.environment?.name === "prerender" && source === "leaflet/dist/leaflet.css") return empty;
    },
    load(id) {
      if (id === empty) return "export {};";
    },
  };
}

// https://astro.build/config
export default defineConfig({
  output: "static",
  integrations: [react(), modulePreloadIntegration(), devTools()],
  vite: {
    plugins: [stickerMdx(), skipLazyMapCssInPrerender()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
