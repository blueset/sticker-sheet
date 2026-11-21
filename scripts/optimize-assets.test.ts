import { describe, expect, it } from "vitest";
import { webpSibling } from "./optimize-assets.ts";

describe("webpSibling", () => {
  it("returns the .webp path next to a PNG when that file exists", () => {
    expect(webpSibling("/stickers/yurucom.png", new Set(["/stickers/yurucom.webp"]))).toBe(
      "/stickers/yurucom.webp",
    );
  });

  it("returns null for an SVG, even when the SVG itself is in the set", () => {
    expect(webpSibling("/stickers/gif.svg", new Set(["/stickers/gif.svg"]))).toBeNull();
  });

  it("returns null when the PNG has no .webp sibling", () => {
    expect(webpSibling("/stickers/earth.png", new Set(["/stickers/yurucom.webp"]))).toBeNull();
  });

  it("matches the extension case-insensitively and keeps dots in the stem", () => {
    expect(webpSibling("/stickers/a.b.PNG", new Set(["/stickers/a.b.webp"]))).toBe("/stickers/a.b.webp");
  });
});
