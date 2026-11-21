import fs from "node:fs";
import path from "node:path";

let cached: ReadonlySet<string> | undefined;

// URL paths (`/stickers/x.webp`) of every file under `public/`. Build-time only: the prerendered
// markup is the only consumer, nothing of this ships to the client. Read once per build / dev server.
export function publicFiles(): ReadonlySet<string> {
  if (cached) return cached;
  const root = path.join(process.cwd(), "public");
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.add(`/${path.relative(root, full).split(path.sep).join("/")}`);
    }
  };
  if (fs.existsSync(root)) walk(root);
  cached = found;
  return found;
}
