// @vitest-environment node
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { bundleInline } from "./bundle";

const gzipBytes = (text: string) => gzipSync(text).length;

it("inline scripts stay small", async () => {
  expect(gzipBytes(await bundleInline("boot-head"))).toBeLessThanOrEqual(600);
  expect(gzipBytes(await bundleInline("boot-view"))).toBeLessThanOrEqual(1500);
});

it("bundles each entry into one self-contained minified IIFE", async () => {
  for (const entry of ["boot-head", "boot-view"]) {
    const code = await bundleInline(entry);
    expect(code).toMatch(/^(?:"use strict";)?\(\(\)=>\{[\s\S]*\}\)\(\);\s*$/);
    expect(code).not.toMatch(/\b(?:import|export|require)\b/);
  }
});

it("rejects entries that point outside src/inline", async () => {
  await expect(bundleInline("../lib/theme")).rejects.toThrow("Invalid inline entry");
});
