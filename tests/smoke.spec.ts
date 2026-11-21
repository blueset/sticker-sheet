import { test, expect } from "@playwright/test";
import { contract } from "./contract";

test("every sticker renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(contract.stickers)).toHaveCount(63);
});
