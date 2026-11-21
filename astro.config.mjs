import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { stickerMdx } from "./src/lib/mdx/vite-plugin.ts";

// https://astro.build/config
export default defineConfig({
  output: "static",
  integrations: [react()],
  vite: {
    plugins: [stickerMdx()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
