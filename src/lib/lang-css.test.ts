import { describe, expect, it } from "vitest";
import { variantCss, variantPlan } from "./lang-css";
import { LANGS } from "./localize";

describe("variantCss", () => {
  it("hides the other variants when the group has the language", () => {
    expect(variantCss(["en", "ja"])).toContain(
      'html[lang="ja"] [data-has~="ja"] > [data-l]:not([data-l="ja"]){display:none}',
    );
  });

  it("keeps only the fallback variant when the group lacks the language", () => {
    expect(variantCss(["en", "ja"])).toContain(
      'html[lang="ja"] :not([data-has~="ja"]) > [data-l]:not([data-fb]){display:none}',
    );
  });

  it("emits both rules for every language and nothing else", () => {
    const css = variantCss(LANGS);
    for (const lang of LANGS) {
      expect(css).toContain(`html[lang="${lang}"] [data-has~="${lang}"] > [data-l]:not([data-l="${lang}"])`);
      expect(css).toContain(`html[lang="${lang}"] :not([data-has~="${lang}"]) > [data-l]:not([data-fb])`);
    }
    expect(css.match(/\{display:none\}/g)).toHaveLength(LANGS.length * 2);
  });
});

describe("variantPlan", () => {
  it("lists the supported languages that have text, in LANGS order", () => {
    expect(variantPlan({ ja: "J", en: "E" }).has).toEqual(["en", "ja"]);
  });

  it("ignores empty strings, as localize does", () => {
    expect(variantPlan({ en: "E", ja: "" }).has).toEqual(["en"]);
  });

  it("falls back to en when it has text", () => {
    expect(variantPlan({ ja: "J", en: "E" }).fallback).toBe("en");
  });

  it("falls back to the first value when en has no text", () => {
    expect(variantPlan({ ja: "J", "zh-Hans": "Z" }).fallback).toBe("ja");
    expect(variantPlan({ "zh-Hans": "Z", ja: "J" }).fallback).toBe("zh-Hans");
  });

  it("has no variants for a missing source", () => {
    expect(variantPlan(undefined)).toEqual({ has: [], fallback: undefined });
  });

  it("refuses a fallback that would not be prerendered", () => {
    expect(() => variantPlan({ fr: "F", ja: "J" })).toThrow(/fr/);
  });
});
