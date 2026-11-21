// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("./appState");
}

const html = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  html.removeAttribute("lang");
  html.className = "";
  html.style.cssText = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("initial state", () => {
  it("defaults to en, system and no selection", async () => {
    const { appStore } = await load();
    expect(appStore.getState()).toEqual({ language: "en", theme: "system", selectedSlug: null });
  });

  it("restores saved language and theme", async () => {
    localStorage.setItem("language", "ja");
    localStorage.setItem("theme", "dark");
    const { appStore } = await load();
    expect(appStore.getState()).toMatchObject({ language: "ja", theme: "dark" });
  });

  it("ignores invalid saved values", async () => {
    localStorage.setItem("language", "fr");
    localStorage.setItem("theme", "blue");
    const { appStore } = await load();
    expect(appStore.getState()).toMatchObject({ language: "en", theme: "system" });
  });

  it("survives a throwing localStorage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { appStore } = await load();
    expect(appStore.getState()).toMatchObject({ language: "en", theme: "system" });
  });
});

describe("setLanguage", () => {
  it("persists, updates the store and sets html lang", async () => {
    const { appStore, setLanguage } = await load();
    setLanguage("zh-Hans");
    expect(localStorage.getItem("language")).toBe("zh-Hans");
    expect(appStore.getState().language).toBe("zh-Hans");
    expect(html.lang).toBe("zh-Hans");
  });

  it("still applies when storage refuses writes", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { appStore, setLanguage } = await load();
    expect(() => setLanguage("ja")).not.toThrow();
    expect(appStore.getState().language).toBe("ja");
    expect(html.lang).toBe("ja");
  });
});

describe("setTheme", () => {
  it("persists, updates the store and applies the theme", async () => {
    const { appStore, setTheme } = await load();
    setTheme("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(appStore.getState().theme).toBe("dark");
    expect(html.classList.contains("dark")).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
  });

  it("follows prefers-color-scheme only while system is selected", async () => {
    let onChange: ((e: { matches: boolean }) => void) | undefined;
    const mql = {
      matches: false,
      addEventListener: (_: string, l: typeof onChange) => {
        onChange = l;
      },
      removeEventListener: (_: string, l: typeof onChange) => {
        if (onChange === l) onChange = undefined;
      },
    };
    vi.stubGlobal("matchMedia", () => mql);
    const { setTheme } = await load();

    setTheme("system");
    onChange?.({ matches: true });
    expect(html.classList.contains("dark")).toBe(true);

    setTheme("light");
    expect(onChange).toBeUndefined();
    expect(html.classList.contains("dark")).toBe(false);
  });
});

describe("select", () => {
  it("pushes #slug and closing pushes the bare path", async () => {
    const { appStore, select } = await load();
    const before = history.length;

    select("dark");
    expect(appStore.getState().selectedSlug).toBe("dark");
    expect(location.hash).toBe("#dark");
    expect(history.length).toBe(before + 1);

    select(null);
    expect(appStore.getState().selectedSlug).toBeNull();
    expect(location.hash).toBe("");
    expect(location.pathname).toBe("/");
    expect(history.length).toBe(before + 2);
  });

  it("does not push a duplicate entry for the current URL", async () => {
    const { select } = await load();
    const before = history.length;

    select("dark");
    select("dark");
    expect(history.length).toBe(before + 1);

    select("css");
    expect(history.length).toBe(before + 2);
  });

  it("does not push when closing an already closed view", async () => {
    const { select } = await load();
    const before = history.length;
    select(null);
    expect(history.length).toBe(before);
  });

  it("updates the selection without touching history when push is false", async () => {
    const { appStore, select } = await load();
    const before = history.length;

    select("dark", { push: false });
    expect(appStore.getState().selectedSlug).toBe("dark");
    expect(history.length).toBe(before);
    expect(location.hash).toBe("");
  });

  it("round-trips slugs that need percent-encoding without duplicates", async () => {
    const { select } = await load();
    const before = history.length;
    select("a b");
    select("a b");
    expect(location.hash).toBe("#a%20b");
    expect(history.length).toBe(before + 1);
  });
});

describe("initFromHash", () => {
  const known = new Set(["dark", "css", "a b"]);

  it("selects a known slug without pushing history", async () => {
    const { appStore, initFromHash } = await load();
    history.replaceState(null, "", "/#dark");
    const before = history.length;
    initFromHash(known);
    expect(appStore.getState().selectedSlug).toBe("dark");
    expect(history.length).toBe(before);
  });

  it("decodes percent-encoded slugs", async () => {
    const { appStore, initFromHash } = await load();
    history.replaceState(null, "", "/#a%20b");
    initFromHash(known);
    expect(appStore.getState().selectedSlug).toBe("a b");
  });

  it("ignores unknown slugs", async () => {
    const { appStore, select, initFromHash } = await load();
    select("css", { push: false });
    history.replaceState(null, "", "/#nope");
    initFromHash(known);
    expect(appStore.getState().selectedSlug).toBeNull();
  });

  it("selects nothing for an empty hash", async () => {
    const { appStore, select, initFromHash } = await load();
    select("css", { push: false });
    initFromHash(known);
    expect(appStore.getState().selectedSlug).toBeNull();
  });

  it("treats a malformed percent escape as unknown", async () => {
    const { appStore, initFromHash } = await load();
    history.replaceState(null, "", "/#%E0%A4%A");
    expect(() => initFromHash(known)).not.toThrow();
    expect(appStore.getState().selectedSlug).toBeNull();
  });
});
