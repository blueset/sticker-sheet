// Pathway B prototype build: copies Pathway A's dist/ to dist-proto/, bundles
// proto/canvas/entry.ts into dist-proto/_proto/canvas.js and injects one
// module script for it into dist-proto/index.html. Run `npm run build` first.
// Usage: node proto/build.mjs
import fs from "node:fs";
import path from "node:path";
import { build } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const out = path.join(root, "dist-proto");
const html = path.join(out, "index.html");

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("dist/index.html is missing: run `npm run build` first.");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(dist, out, { recursive: true });
await build({ configFile: path.join(import.meta.dirname, "vite.config.ts"), logLevel: "warn" });

const tag = '<script type="module" src="/_proto/canvas.js"></script>';
const page = fs.readFileSync(html, "utf8");
if (!page.includes("</body>")) throw new Error("dist-proto/index.html has no </body>");
fs.writeFileSync(html, page.replace("</body>", `${tag}</body>`));
console.log(`dist-proto/ ready (${fs.statSync(path.join(out, "_proto", "canvas.js")).size} B bundle)`);
