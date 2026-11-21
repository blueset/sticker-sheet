import { describe, expect, it } from "vitest";
import { boxHash, readStickers, shadowsAreStale, spriteHash } from "./gen-shadows.ts";

const stickers = readStickers();
const stickerA = stickers.find((s) => s.image && !s.clipPath)!;
const contentSticker = stickers.find((s) => !s.image && s.content && s.width > 0)!;

describe("shadow sprites", () => {
  it("committed sprites and box measurements match their stickers", () => {
    expect(shadowsAreStale()).toEqual([]); // fails while sprites are missing
  });

  it("spriteHash covers the clip-path and the size", () => {
    expect(spriteHash(stickerA)).not.toBe(spriteHash({ ...stickerA, clipPath: "circle(40%)" }));
    expect(spriteHash(stickerA)).not.toBe(spriteHash({ ...stickerA, width: stickerA.width + 1 }));
    expect(spriteHash(stickerA)).toBe(spriteHash({ ...stickerA, x: stickerA.x + 10, rotation: 45 }));
  });

  it("boxHash covers the content of a content sticker", () => {
    const changed = { ...contentSticker, content: { en: "<div />" } };
    expect(boxHash(contentSticker)).not.toBe(boxHash(changed));
  });
});
