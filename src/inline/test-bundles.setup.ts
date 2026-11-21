import type { TestProject } from "vitest/node";
import { bundleInline } from "./bundle";

declare module "vitest" {
  export interface ProvidedContext {
    inlineBundles: { bootHead: string; bootView: string };
  }
}

// esbuild cannot start inside Vitest's jsdom environment (its
// `TextEncoder`/`Uint8Array` invariant fails there), so the jsdom boot tests
// receive the bundled scripts from this Node-side setup instead.
export default async function setup(project: TestProject): Promise<void> {
  project.provide("inlineBundles", {
    bootHead: await bundleInline("boot-head"),
    bootView: await bundleInline("boot-view"),
  });
}
