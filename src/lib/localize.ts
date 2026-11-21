import type { Localized } from "./stickers";

export const LANGS = ["en", "zh-Hans", "ja"] as const;

export type Lang = (typeof LANGS)[number];

export function isLang(x: unknown): x is Lang {
  return (LANGS as readonly unknown[]).includes(x);
}

export function localize(source: Localized | undefined, lang: string): string | undefined {
  if (!source) return undefined;
  return source[lang] || source.en || Object.values(source)[0] || undefined;
}
