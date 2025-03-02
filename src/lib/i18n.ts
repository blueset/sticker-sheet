import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// the translations
// (tip move them in a JSON file and import them,
// or even better, manage them separated from your code: https://react.i18next.com/guides/multiple-translation-files)
const resources = {
  en: {
    translation: {
      changeLanguage: "Change language",
      theme: {
        toggleTheme: "Toggle theme",
        light: "Light",
        dark: "Dark",
        system: "System",
      },
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      centerView: "Center view",
      togglePanelSize: "Toggle panel size",
    },
  },
  "zh-Hans": {
    translation: {
      changeLanguage: "切换语言",
      theme: {
        toggleTheme: "切换主题",
        light: "亮色",
        dark: "暗色",
        system: "系统",
      },
      zoomIn: "放大",
      zoomOut: "缩小",
      centerView: "居中",
      togglePanelSize: "切换面板大小",
    },
  },
  ja: {
    translation: {
      changeLanguage: "言語を変更",
      theme: {
        toggleTheme: "テーマを切り替え",
        light: "ライト",
        dark: "ダーク",
        system: "デバイス",
      },
      zoomIn: "拡大",
      zoomOut: "縮小",
      centerView: "中央揃え",
      togglePanelSize: "パネルサイズを切り替え",
    },
  },
};

i18n
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    resources,
    fallbackLng: "en",
    debug: process.env.NODE_ENV === "development",
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
  });

export default i18n;
