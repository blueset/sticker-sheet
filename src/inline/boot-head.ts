import { isLang } from "../lib/localize";
import { isThemeChoice, resolveTheme } from "../lib/theme";

// Runs in <head> before first paint; nothing here may throw.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function prefersDark(): boolean {
  try {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

try {
  const language = read("language");
  const theme = read("theme");
  const root = document.documentElement;
  const resolved = resolveTheme(isThemeChoice(theme) ? theme : "system", prefersDark());

  root.lang = isLang(language) ? language : "en";
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  // Hides the canvas until boot-view centres it on the hashed sticker
  // (global.css reveals it after 1.5 s even if boot-view never runs).
  if (location.hash.length > 1) root.dataset.deep = "";
} catch {
  // Falling back to the markup defaults is better than a console error.
}
