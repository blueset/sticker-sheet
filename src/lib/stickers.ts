import { parse } from "yaml";

export type Localized = Record<string, string | undefined>;

export interface StickerRecord {
  slug: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  image?: string;
  clipPath?: string;
  content?: Localized;
  title: Localized;
  description?: Localized;
}

export const CANVAS = { width: 3000, height: 3000 } as const;

// Mirrors `utils/compileYaml.ts` (the old Deno step): parse with the same
// YAML parser, then set `slug` from the filename, overriding any `slug` key
// the document itself declares.
export function parseSticker(slug: string, raw: string): StickerRecord {
  const data = parse(raw);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`Sticker "${slug}" must parse to a YAML mapping.`);
  }
  return { ...(data as Record<string, unknown>), slug } as StickerRecord;
}

const stickerSources = import.meta.glob("/src/data/stickers/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadStickers(): StickerRecord[] {
  return Object.entries(stickerSources)
    .map(([filePath, raw]) => {
      const slug = filePath.slice(filePath.lastIndexOf("/") + 1, -".yaml".length);
      return parseSticker(slug, raw);
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}
