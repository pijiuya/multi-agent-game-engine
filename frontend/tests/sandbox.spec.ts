import { expect, test } from "@playwright/test";

test("renders the sandbox, switches views, and opens an agent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Multi-Agent Engine" })).toBeVisible();
  await expect(page.getByTestId("world-2d")).toBeVisible();

  await page.getByRole("button", { name: "3D" }).click();
  await expect(page.getByTestId("world-3d")).toBeVisible();

  await page.getByRole("button", { name: "2D" }).click();
  await page.getByRole("button", { name: "Mira" }).click();
  await expect(page.getByText("mediator", { exact: true })).toBeVisible();
});
