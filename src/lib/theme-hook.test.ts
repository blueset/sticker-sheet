import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appStore } from "./appState";
import { applyTheme } from "./theme";
import { useTheme } from "./theme-hook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A stand-in for the browser's MediaQueryList that records its listeners.
function fakeMediaQuery(initiallyDark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initiallyDark,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", () => mql);
  return {
    emit(matches: boolean) {
      mql.matches = matches;
      for (const l of [...listeners]) l();
    },
  };
}

let latest: ReturnType<typeof useTheme>;

function Probe() {
  latest = useTheme();
  return null;
}

let container: HTMLElement;
let root: Root;

function mount() {
  act(() => root.render(createElement(Probe)));
}

beforeEach(() => {
  appStore.setState({ theme: "system" });
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  // Detach any system-theme listener left behind by `setTheme('system')`.
  applyTheme("light");
  vi.unstubAllGlobals();
});

describe("useTheme", () => {
  it("re-renders with the new theme after setTheme", () => {
    mount();
    expect(latest).toMatchObject({ theme: "system", resolvedTheme: "light" });

    act(() => latest.setTheme("dark"));
    expect(latest).toMatchObject({ theme: "dark", resolvedTheme: "dark" });
  });

  it("flips resolvedTheme when the OS scheme changes under the system theme", () => {
    const media = fakeMediaQuery(false);
    mount();
    expect(latest).toMatchObject({ theme: "system", resolvedTheme: "light" });

    act(() => media.emit(true));
    expect(latest).toMatchObject({ theme: "system", resolvedTheme: "dark" });

    act(() => latest.setTheme("light"));
    expect(latest).toMatchObject({ theme: "light", resolvedTheme: "light" });
  });

  it("renders the system theme on the server", () => {
    appStore.setState({ theme: "dark" });
    fakeMediaQuery(true);
    function Server() {
      const { theme, resolvedTheme } = useTheme();
      return createElement("i", null, `${theme}/${resolvedTheme}`);
    }
    expect(renderToStaticMarkup(createElement(Server))).toBe("<i>system/light</i>");
  });
});
