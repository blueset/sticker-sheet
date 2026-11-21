import { expect, test } from "vitest";
import baseline from "../../tests/fixtures/stickers.baseline.json";
import { loadStickers, parseSticker } from "./stickers";

test("matches the data the baseline app rendered, ordered by slug", () => {
  const want = [...baseline].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  expect(loadStickers()).toEqual(want);
});

test("slugs are unique and ascending", () => {
  const slugs = loadStickers().map((s) => s.slug);
  expect(new Set(slugs).size).toBe(63);
  expect(slugs).toEqual([...slugs].sort());
});

test("parseSticker names the slug when the document is not an object", () => {
  expect(() => parseSticker("x", "- 1")).toThrow(/x/);
});
