import type { Lang } from "./localize";

export type UiKey =
  | "changeLanguage"
  | "theme.toggleTheme"
  | "theme.light"
  | "theme.dark"
  | "theme.system"
  | "zoomIn"
  | "zoomOut"
  | "centerView"
  | "togglePanelSize";

// Ported verbatim (same text, same keys) from the old `i18n.ts` resources.
const strings: Record<Lang, Record<UiKey, string>> = {
  en: {
    changeLanguage: "Change language",
    "theme.toggleTheme": "Toggle theme",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    centerView: "Center view",
    togglePanelSize: "Toggle panel size",
  },
  "zh-Hans": {
    changeLanguage: "切换语言",
    "theme.toggleTheme": "切换主题",
    "theme.light": "亮色",
    "theme.dark": "暗色",
    "theme.system": "系统",
    zoomIn: "放大",
    zoomOut: "缩小",
    centerView: "居中",
    togglePanelSize: "切换面板大小",
  },
  ja: {
    changeLanguage: "言語を変更",
    "theme.toggleTheme": "テーマを切り替え",
    "theme.light": "ライト",
    "theme.dark": "ダーク",
    "theme.system": "デバイス",
    zoomIn: "拡大",
    zoomOut: "縮小",
    centerView: "中央揃え",
    togglePanelSize: "パネルサイズを切り替え",
  },
};

export function t(lang: Lang, key: UiKey): string {
  const table = strings[lang] ?? strings.en;
  return table[key];
}
