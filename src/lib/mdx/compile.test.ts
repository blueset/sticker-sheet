import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { content, description } from "virtual:sticker-mdx";
import { compileMdx } from "./compile";
import { stickerMdx } from "./vite-plugin";

// Flags flipped by the mock factories below: a factory only runs when its
// module is actually imported.
const loaded = vi.hoisted(() => ({
  leaflet: false,
  reactLeaflet: false,
  baselineStatus: false,
  plusCodeMap: false,
  canIUse: false,
  baselineStatusComponent: false,
}));

vi.mock("leaflet", () => {
  loaded.leaflet = true;
  return { default: {} };
});
vi.mock("react-leaflet", () => {
  loaded.reactLeaflet = true;
  return {};
});
vi.mock("baseline-status", () => {
  loaded.baselineStatus = true;
  return {};
});
vi.mock("@/components/mdx/PlusCodeMap", () => {
  loaded.plusCodeMap = true;
  return { PlusCodeMap: () => null };
});
vi.mock("@/components/mdx/CanIUse", () => {
  loaded.canIUse = true;
  return { default: () => null };
});
vi.mock("@/components/mdx/BaselineStatus", () => {
  loaded.baselineStatusComponent = true;
  return { default: () => null };
});

describe("compiled sticker MDX", () => {
  it("renders dark/en including <Button> inside an exported function", async () => {
    const { default: C } = await description["dark"].en!();
    const html = renderToStaticMarkup(React.createElement(C));
    expect(html).toContain("Try out dark mode");
    expect(html).toContain("<button");
  });

  it("compiles every description and content in every language", { timeout: 60_000 }, async () => {
    for (const group of [description, content]) {
      for (const langs of Object.values(group)) {
        for (const load of Object.values(langs)) {
          await expect(load!()).resolves.toBeDefined();
        }
      }
    }
  });

  it("supports GFM", async () => {
    expect((await compileMdx("~~x~~")).code).toContain("del");
  });

  it("lazy components do not load at import time", async () => {
    await description["map"].en!();
    await description["css"].en!();
    expect(loaded).toEqual({
      leaflet: false,
      reactLeaflet: false,
      baselineStatus: false,
      plusCodeMap: false,
      canIUse: false,
      baselineStatusComponent: false,
    });

    // Control: the mocks do record a real import.
    await import("leaflet");
    expect(loaded.leaflet).toBe(true);
  });

  it("lets authored functions use React from the provider", async () => {
    const { default: C } = await content["test-1"].en!();
    expect(renderToStaticMarkup(React.createElement(C))).toMatch(/<span[^>]*>\d{2}:\d{2}:\d{2}<\/span>/);
  });
});

describe("stickerMdx plugin", () => {
  const root = path.resolve(import.meta.dirname, "__fixtures__/root");
  type Hooks = {
    configResolved(config: { root: string }): void;
    load(this: { addWatchFile(file: string): void }, id: string): Promise<{ code: string } | undefined>;
  };

  function setup() {
    const plugin = stickerMdx() as unknown as Hooks;
    plugin.configResolved({ root });
    const addWatchFile = vi.fn();
    return { addWatchFile, load: (id: string) => plugin.load.call({ addWatchFile }, id) };
  }

  it("emits a sorted manifest of literal imports for non-empty, known-language text only", async () => {
    const result = await setup().load("\0virtual:sticker-mdx");
    const specifiers = [...result!.code.matchAll(/\bimport\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(specifiers).toEqual([
      "virtual:sticker-mdx/description/Zed/en",
      "virtual:sticker-mdx/description/alpha/en",
      "virtual:sticker-mdx/description/alpha/zh-Hans",
      "virtual:sticker-mdx/description/broken/en",
      "virtual:sticker-mdx/content/alpha/en",
    ]);
    expect(result!.code).toMatch(/export const description = \{/);
    expect(result!.code).toMatch(/export const content = \{/);
  });

  it("names the sticker, kind and language when MDX fails to compile", async () => {
    const { load, addWatchFile } = setup();
    await expect(load("\0virtual:sticker-mdx/description/broken/en")).rejects.toThrow(
      /description MDX of sticker "broken" \(en\).*closing tag/s,
    );
    expect(addWatchFile).toHaveBeenCalledWith(path.join(root, "src/data/stickers/broken.yaml"));
  });
});
