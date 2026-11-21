import { expect, test } from "vitest";
import { isLang, LANGS, localize, type Lang } from "./localize";

test("localize prefers the requested language", () => {
  expect(localize({ en: "A", ja: "B" }, "ja")).toBe("B");
});

test("localize falls back to en when the requested language is missing", () => {
  expect(localize({ en: "A" }, "ja")).toBe("A");
});

test("localize falls back to the first value when en is also missing", () => {
  expect(localize({ ja: "B" }, "zh-Hans")).toBe("B");
});

test("localize returns undefined for an empty string result", () => {
  expect(localize({ en: "" }, "en")).toBeUndefined();
});

test("localize returns undefined when source is undefined", () => {
  expect(localize(undefined, "en")).toBeUndefined();
});

test("LANGS lists the three supported languages", () => {
  expect(LANGS).toEqual(["en", "zh-Hans", "ja"]);
});

test("isLang narrows known languages and rejects unknown ones", () => {
  const known: unknown = "ja";
  const unknown: unknown = "xx";
  expect(isLang(known)).toBe(true);
  expect(isLang(unknown)).toBe(false);
  if (isLang(known)) {
    const lang: Lang = known;
    expect(LANGS).toContain(lang);
  }
});
