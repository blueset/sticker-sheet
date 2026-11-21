import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appStore, setLanguage } from "./appState";
import { useLanguage } from "./lang-hook";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof useLanguage>;

function Probe() {
  latest = useLanguage();
  return null;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  appStore.setState({ language: "en" });
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useLanguage", () => {
  it("re-renders with the new language after setLanguage", () => {
    expect(latest).toBe("en");
    act(() => setLanguage("ja"));
    expect(latest).toBe("ja");
    act(() => setLanguage("zh-Hans"));
    expect(latest).toBe("zh-Hans");
  });

  it("renders English on the server whatever the store holds", () => {
    appStore.setState({ language: "ja" });
    function Server() {
      return createElement("i", null, useLanguage());
    }
    expect(renderToStaticMarkup(createElement(Server))).toBe("<i>en</i>");
  });
});
