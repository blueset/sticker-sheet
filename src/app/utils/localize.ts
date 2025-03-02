import type { LocalizedContent } from "../store/useCanvasStore";

export function localize(
  source: LocalizedContent | undefined,
  language: string
) {
  if (!source) return undefined;
  return source[language] || source.en || Object.values(source)[0] || undefined;
}
