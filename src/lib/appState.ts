import { createStore } from "zustand/vanilla";
import { isLang, type Lang } from "./localize";
import { applyTheme, isThemeChoice, type ThemeChoice } from "./theme";

export type { ThemeChoice };

export interface AppState {
  language: Lang;
  theme: ThemeChoice;
  selectedSlug: string | null;
}

// Storage can be missing (Node has no `window`), blocked, or throw (privacy
// modes, sandboxed iframes), so every access goes through these helpers.
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort.
  }
}

const savedLanguage = readStorage("language");
const savedTheme = readStorage("theme");

export const appStore = createStore<AppState>()(() => ({
  language: isLang(savedLanguage) ? savedLanguage : "en",
  theme: isThemeChoice(savedTheme) ? savedTheme : "system",
  selectedSlug: null,
}));

export function setLanguage(language: Lang): void {
  appStore.setState({ language });
  writeStorage("language", language);
  document.documentElement.lang = language;
}

export function setTheme(theme: ThemeChoice): void {
  appStore.setState({ theme });
  writeStorage("theme", theme);
  applyTheme(theme);
}

// The slug named by `location.hash`, or null when empty or malformed.
function hashSlug(): string | null {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function select(slug: string | null, opts?: { push?: boolean }): void {
  appStore.setState({ selectedSlug: slug });
  if (opts?.push === false) return;

  if (slug === null) {
    if (location.hash !== "" || location.search !== "") {
      history.pushState(null, "", location.pathname);
    }
  } else if (hashSlug() !== slug) {
    history.pushState(null, "", `#${encodeURIComponent(slug)}`);
  }
}

export function initFromHash(knownSlugs: ReadonlySet<string>): void {
  const slug = hashSlug();
  const selectedSlug = slug !== null && knownSlugs.has(slug) ? slug : null;
  // Back/forward fires popstate and hashchange for one navigation; the second
  // call must not notify subscribers again.
  if (appStore.getState().selectedSlug !== selectedSlug) appStore.setState({ selectedSlug });
}
