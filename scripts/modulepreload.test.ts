import { describe, expect, it } from "vitest";
import { eagerGraph, injectModulePreloads, staticImports } from "./modulepreload.ts";

const modules: Record<string, string> = {
  "/_astro/main.A.js":
    'const __vite__mapDeps=["_astro/Sheet.S.js"];import{l as e}from"./appState.B.js";import{i as a}from"./preload-helper.C.js";import"./side.D.js";a(()=>import("./Sheet.S.js"),__vite__mapDeps([0]));',
  "/_astro/appState.B.js": 'import{i}from"./preload-helper.C.js";export const l=1;',
  "/_astro/preload-helper.C.js": "export const i=1;",
  "/_astro/side.D.js": "",
};
const read = (href: string) => {
  if (!(href in modules)) throw new Error(`unexpected read ${href}`);
  return modules[href];
};
const page = (head: string) =>
  `<html><head><meta charset="utf-8">${head}</head><body><img src="/stickers/a.svg"><script type="module" src="/_astro/main.A.js"></script></body></html>`;

describe("staticImports", () => {
  it("resolves static imports and skips dynamic ones", () => {
    expect(staticImports(modules["/_astro/main.A.js"], "/_astro/main.A.js")).toEqual([
      "/_astro/appState.B.js",
      "/_astro/preload-helper.C.js",
      "/_astro/side.D.js",
    ]);
  });
});

describe("eagerGraph", () => {
  it("is the entry and its static import closure, each once", () => {
    expect(eagerGraph(page(""), read)).toEqual([
      "/_astro/main.A.js",
      "/_astro/appState.B.js",
      "/_astro/preload-helper.C.js",
      "/_astro/side.D.js",
    ]);
  });

  it("is empty without a module entry", () => {
    expect(eagerGraph("<html><head></head><body></body></html>", read)).toEqual([]);
  });
});

describe("injectModulePreloads", () => {
  it("links the eager graph at high priority at the end of the head", () => {
    const out = injectModulePreloads(page(""), read);
    const head = out.slice(0, out.indexOf("</head>"));
    for (const href of ["/_astro/main.A.js", "/_astro/appState.B.js", "/_astro/preload-helper.C.js", "/_astro/side.D.js"]) {
      expect(head).toContain(`<link rel="modulepreload" href="${href}" fetchpriority="high">`);
    }
    expect(out).not.toContain('href="/_astro/Sheet.S.js"');
    expect(out.slice(out.indexOf("</head>"))).toBe(page("").slice(page("").indexOf("</head>")));
  });

  it("is idempotent", () => {
    const once = injectModulePreloads(page(""), read);
    expect(injectModulePreloads(once, read)).toBe(once);
  });
});
