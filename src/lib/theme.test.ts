// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, isThemeChoice, resolveTheme } from "./theme";

// A stand-in for the browser's MediaQueryList that records its listeners.
function fakeMediaQuery(initiallyDark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: initiallyDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_: string, l: (e: { matches: boolean }) => void) => {
      listeners.add(l);
    }),
    removeEventListener: vi.fn((_: string, l: (e: { matches: boolean }) => void) => {
      listeners.delete(l);
    }),
  };
  vi.stubGlobal("matchMedia", () => mql);
  return {
    mql,
    listeners,
    emit(matches: boolean) {
      mql.matches = matches;
      for (const l of [...listeners]) l({ matches });
    },
  };
}

const html = document.documentElement;

beforeEach(() => {
  html.className = "";
  html.style.cssText = "";
});

afterEach(() => {
  // Detach any system-theme listener left behind by a test.
  applyTheme("light");
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("returns explicit choices unchanged", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows prefersDark for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("isThemeChoice", () => {
  it("accepts only the three known choices", () => {
    for (const ok of ["light", "dark", "system"]) expect(isThemeChoice(ok)).toBe(true);
    for (const bad of ["blue", "", null, undefined, 1]) expect(isThemeChoice(bad)).toBe(false);
  });
});

describe("applyTheme", () => {
  it("toggles .dark and colorScheme for explicit choices", () => {
    applyTheme("dark");
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");

    applyTheme("light");
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });

  it("resolves system from prefers-color-scheme", () => {
    fakeMediaQuery(true);
    applyTheme("system");
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
  });

  it("resolves system as light when matchMedia is missing", () => {
    html.classList.add("dark");
    applyTheme("system");
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });

  it("flips on prefers-color-scheme changes while system", () => {
    const media = fakeMediaQuery(false);
    applyTheme("system");
    expect(html.classList.contains("dark")).toBe(false);

    media.emit(true);
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");

    media.emit(false);
    expect(html.classList.contains("dark")).toBe(false);
    expect(html.style.colorScheme).toBe("light");
  });

  it("stops reacting once an explicit choice replaces system", () => {
    const media = fakeMediaQuery(false);
    applyTheme("system");
    applyTheme("light");
    expect(media.listeners.size).toBe(0);

    media.emit(true);
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("keeps exactly one listener across repeated system calls", () => {
    const media = fakeMediaQuery(false);
    applyTheme("system");
    applyTheme("system");
    applyTheme("system");
    expect(media.listeners.size).toBe(1);
  });
});
