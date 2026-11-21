import { LANGS, localize, type Lang } from "./localize";
import type { Localized } from "./stickers";

// Each group of `[data-l]` variants sits directly under an element whose
// `data-has` lists the languages the group has text for. The language is
// chosen by `html[lang]` alone, so the page needs no script to show the right
// variant and a language switch is a single attribute write.
export function variantCss(langs: readonly Lang[]): string {
  return langs
    .map(
      (lang) =>
        `html[lang="${lang}"] [data-has~="${lang}"] > [data-l]:not([data-l="${lang}"]){display:none}` +
        `html[lang="${lang}"] :not([data-has~="${lang}"]) > [data-l]:not([data-fb]){display:none}`,
    )
    .join("");
}

export interface VariantPlan {
  // Supported languages with text, in `LANGS` order.
  has: Lang[];
  // The variant shown for a language the group lacks, i.e. what `localize`
  // returns for it.
  fallback: Lang | undefined;
}

export function variantPlan(source: Localized | undefined): VariantPlan {
  const has = LANGS.filter((lang) => !!source?.[lang]);
  // An empty language tag is never a key, so `localize` takes its fallback path.
  const fallbackText = localize(source, "");
  if (!source || fallbackText === undefined) return { has, fallback: undefined };

  const key = source.en === fallbackText ? "en" : Object.keys(source).find((k) => source[k] === fallbackText);
  const fallback = LANGS.find((lang) => lang === key);
  if (!fallback) {
    throw new Error(`The fallback text is in "${key}", which is not a prerendered language (${LANGS.join(", ")}).`);
  }
  return { has, fallback };
}
