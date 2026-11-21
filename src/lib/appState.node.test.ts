// @vitest-environment node
import { expect, it } from "vitest";

// Importing the store outside a browser must never touch `localStorage`
// unguarded (Node has no such global, or a throwing one).
it("can be imported in Node and starts from the defaults", async () => {
  const { appStore } = await import("./appState");
  expect(appStore.getState()).toEqual({ language: "en", theme: "system", selectedSlug: null });
});
