// Builds the Pathway B prototype (proto/canvas/entry.ts) into one standalone
// ES module. Not part of the Astro build; proto/build.mjs runs it and injects
// the bundle into a copy of dist/.
import path from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;

export default defineConfig({
  root: here,
  publicDir: false,
  build: {
    outDir: path.resolve(here, "../dist-proto/_proto"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    lib: {
      entry: path.resolve(here, "canvas/entry.ts"),
      formats: ["es"],
      fileName: () => "canvas.js",
    },
  },
});
