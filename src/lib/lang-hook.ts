import { useSyncExternalStore } from "react";
import { appStore } from "./appState";
import type { Lang } from "./localize";

const subscribe = (onChange: () => void): (() => void) => appStore.subscribe(onChange);
const getLanguage = (): Lang => appStore.getState().language;
const getServerLanguage = (): Lang => "en";

export function useLanguage(): Lang {
  return useSyncExternalStore(subscribe, getLanguage, getServerLanguage);
}

const getSelectedSlug = (): string | null => appStore.getState().selectedSlug;
const getServerSelectedSlug = (): null => null;

export function useSelectedSlug(): string | null {
  return useSyncExternalStore(subscribe, getSelectedSlug, getServerSelectedSlug);
}
