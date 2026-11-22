// Dev-only tools, wired in only under `astro dev`: the /dev/svg-shape
// workbench route and the placement editor on every page. `astro build` gets
// nothing from here (tests/e2e/prod-clean.spec.ts checks the output).
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

export default function devTools(): AstroIntegration {
  return {
    name: "sticker-sheet-dev-tools",
    hooks: {
      "astro:config:setup": ({ command, injectRoute, injectScript }) => {
        if (command !== "dev") return;
        injectRoute({
          pattern: "/dev/svg-shape",
          entrypoint: new URL("./svg-shape.astro", import.meta.url),
          prerender: true,
        });
        const entry = fileURLToPath(new URL("./placement-entry.ts", import.meta.url)).replace(/\\/g, "/");
        injectScript("page", `import ${JSON.stringify(entry)};`);
      },
    },
  };
}
