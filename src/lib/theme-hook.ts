import { useMemo, useSyncExternalStore } from "react";
import { appStore, setTheme, type ThemeChoice } from "./appState";
import { resolveTheme } from "./theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeTheme(onChange: () => void): () => void {
  return appStore.subscribe(onChange);
}

const getTheme = (): ThemeChoice => appStore.getState().theme;
const getServerTheme = (): ThemeChoice => "system";

function darkQuery(): MediaQueryList | undefined {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY)
    : undefined;
}

function subscribePrefersDark(onChange: () => void): () => void {
  const mql = darkQuery();
  mql?.addEventListener("change", onChange);
  return () => mql?.removeEventListener("change", onChange);
}

const getPrefersDark = (): boolean => darkQuery()?.matches ?? false;
const getServerPrefersDark = (): boolean => false;

export interface ThemeApi {
  theme: ThemeChoice;
  resolvedTheme: "light" | "dark";
  setTheme(theme: ThemeChoice): void;
}

export function useTheme(): ThemeApi {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const prefersDark = useSyncExternalStore(subscribePrefersDark, getPrefersDark, getServerPrefersDark);
  const resolvedTheme = resolveTheme(theme, prefersDark);
  return useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme]);
}
