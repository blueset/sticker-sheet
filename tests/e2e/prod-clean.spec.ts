// The dev tools (src/dev: placement editor, /dev/svg-shape workbench) exist
// only under `astro dev`. This reads the production build on disk and fails if
// any trace of them reached it. Filesystem only, so it runs on one project.
//   $env:TARGET='new'; npm run build; $env:STATIC_DIR='dist'; npx playwright test tests/e2e/prod-clean.spec.ts --project=chromium-desktop
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? "dist");

// Minified bundles may drop the package name, so also look for what cannot be
// renamed: Tweakpane's injected stylesheet selectors, and the workbench route.
const MARKERS: { label: string; pattern: RegExp }[] = [
  { label: "the word 'tweakpane'", pattern: /tweakpane/i },
  { label: "Tweakpane's default-wrapper class (.tp-dfwv)", pattern: /tp-dfwv/ },
  { label: "Tweakpane's label-view class (.tp-lblv)", pattern: /tp-lblv/ },
  { label: "the /dev/svg-shape route", pattern: /\/dev\/svg-shape/ },
];

const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf"]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? [full, ...walk(full)] : [full];
  });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "filesystem check; runs once, on chromium-desktop");
  expect(
    fs.existsSync(STATIC_DIR) && fs.statSync(STATIC_DIR).isDirectory(),
    `build directory ${STATIC_DIR} is missing: run \`npm run build\` (or set STATIC_DIR)`
  ).toBe(true);
});

test("the production build has a non-empty index.html", () => {
  const index = path.join(STATIC_DIR, "index.html");
  expect(fs.existsSync(index), `${index} is missing`).toBe(true);
  expect(fs.statSync(index).size, `${index} is empty`).toBeGreaterThan(0);
});

test("the production build has no dev route", () => {
  const devPaths = walk(STATIC_DIR)
    .map((p) => path.relative(STATIC_DIR, p).split(path.sep).join("/"))
    .filter((rel) => rel.split("/").includes("dev") || /(^|\/)dev\.html$/.test(rel));
  expect(devPaths, `dev route files in the build: ${devPaths.join(", ")}`).toEqual([]);
});

test("no built file contains a dev-tool marker", () => {
  const hits: string[] = [];
  for (const file of walk(STATIC_DIR)) {
    if (!fs.statSync(file).isFile() || BINARY.has(path.extname(file).toLowerCase())) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const { label, pattern } of MARKERS) {
      if (pattern.test(text)) hits.push(`${path.relative(STATIC_DIR, file)}: ${label}`);
    }
  }
  expect(hits, `dev-tool code reached the production build:\n${hits.join("\n")}`).toEqual([]);
});
