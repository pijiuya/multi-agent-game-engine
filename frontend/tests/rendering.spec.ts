import { expect, test, type Locator } from "@playwright/test";
import { PNG } from "pngjs";

test.describe("canvas rendering", () => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 820 },
    { name: "mobile", width: 390, height: 820 }
  ]) {
    test(`2D and 3D canvases are nonblank on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      await expect(page.getByTestId("world-2d")).toBeVisible();
      await expectCanvasHasInk(page.getByTestId("world-2d").locator("canvas"));

      await page.getByRole("button", { name: "3D" }).click();
      await expect(page.getByTestId("world-3d")).toBeVisible();
      await expectCanvasHasInk(page.getByTestId("world-3d").locator("canvas"));
    });
  }
});

async function expectCanvasHasInk(canvas: Locator) {
  await expect(canvas).toBeVisible();
  await canvas.page().waitForTimeout(250);
  let image: Buffer | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      image = await canvas.screenshot();
      break;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await canvas.page().waitForTimeout(250);
    }
  }
  if (!image) {
    throw new Error("canvas screenshot was not captured");
  }
  const png = PNG.sync.read(image);
  let varied = 0;
  for (let y = 0; y < png.height; y += Math.max(1, Math.floor(png.height / 24))) {
    for (let x = 0; x < png.width; x += Math.max(1, Math.floor(png.width / 24))) {
      const index = (png.width * y + x) * 4;
      const r = png.data[index];
      const g = png.data[index + 1];
      const b = png.data[index + 2];
      if (Math.abs(r - 248) + Math.abs(g - 250) + Math.abs(b - 252) > 20) {
        varied += 1;
      }
    }
  }
  expect(varied).toBeGreaterThan(12);
}
