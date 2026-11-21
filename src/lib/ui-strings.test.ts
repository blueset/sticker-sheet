import { expect, test } from "vitest";
import { t } from "./ui-strings";
import type { Lang } from "./localize";

test("t returns the Japanese string for a known key", () => {
  expect(t("ja", "zoomIn")).toBe("拡大");
});

test("t falls back to en for an unknown language", () => {
  expect(t("xx" as Lang, "zoomIn")).toBe("Zoom in");
});

test("t returns the English strings", () => {
  expect(t("en", "changeLanguage")).toBe("Change language");
  expect(t("en", "theme.toggleTheme")).toBe("Toggle theme");
  expect(t("en", "theme.light")).toBe("Light");
  expect(t("en", "theme.dark")).toBe("Dark");
  expect(t("en", "theme.system")).toBe("System");
  expect(t("en", "zoomIn")).toBe("Zoom in");
  expect(t("en", "zoomOut")).toBe("Zoom out");
  expect(t("en", "centerView")).toBe("Center view");
  expect(t("en", "togglePanelSize")).toBe("Toggle panel size");
});

test("t returns the Simplified Chinese strings", () => {
  expect(t("zh-Hans", "changeLanguage")).toBe("切换语言");
  expect(t("zh-Hans", "theme.toggleTheme")).toBe("切换主题");
  expect(t("zh-Hans", "theme.light")).toBe("亮色");
  expect(t("zh-Hans", "theme.dark")).toBe("暗色");
  expect(t("zh-Hans", "theme.system")).toBe("系统");
  expect(t("zh-Hans", "zoomIn")).toBe("放大");
  expect(t("zh-Hans", "zoomOut")).toBe("缩小");
  expect(t("zh-Hans", "centerView")).toBe("居中");
  expect(t("zh-Hans", "togglePanelSize")).toBe("切换面板大小");
});

test("t returns the Japanese strings", () => {
  expect(t("ja", "changeLanguage")).toBe("言語を変更");
  expect(t("ja", "theme.toggleTheme")).toBe("テーマを切り替え");
  expect(t("ja", "theme.light")).toBe("ライト");
  expect(t("ja", "theme.dark")).toBe("ダーク");
  expect(t("ja", "theme.system")).toBe("デバイス");
  expect(t("ja", "zoomIn")).toBe("拡大");
  expect(t("ja", "zoomOut")).toBe("縮小");
  expect(t("ja", "centerView")).toBe("中央揃え");
  expect(t("ja", "togglePanelSize")).toBe("パネルサイズを切り替え");
});
