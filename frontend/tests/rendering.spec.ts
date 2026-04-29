import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test.describe("transparent workstation rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("agent-workstation.disable-ws", "1"));
    await page.route("**/api/**", (route) => route.abort());
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 820 },
    { name: "mobile", width: 390, height: 820 }
  ]) {
    test(`workspace surface has rectangular fade on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      await expect(page.getByTestId("scene-viewport")).toBeVisible();
      await expect(page.getByTestId("workspace-surface")).toBeVisible();
      await expect(page.getByTestId("world-2d")).toHaveCount(0);
      await expectRectangularFade(page);
    });
  }
});

async function expectRectangularFade(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      .floating-panel,
      .transport-controls,
      .scene-header,
      .scene-footer {
        visibility: hidden !important;
      }
    `
  });
  await page.waitForTimeout(250);
  const scene = await page.getByTestId("scene-viewport").boundingBox();
  expect(scene).not.toBeNull();
  if (!scene) {
    return;
  }

  const image = await page.screenshot({ omitBackground: true });
  const png = PNG.sync.read(image);
  const center = alphaAt(png, scene.x + scene.width * 0.5, scene.y + scene.height * 0.5);
  const leftEdge = alphaAt(png, scene.x + scene.width * 0.03, scene.y + scene.height * 0.5);
  const topEdge = alphaAt(png, scene.x + scene.width * 0.5, scene.y + scene.height * 0.03);
  const corner = alphaAt(png, scene.x + scene.width * 0.03, scene.y + scene.height * 0.03);

  expect(center).toBeGreaterThan(150);
  expect(center).toBeGreaterThan(leftEdge + 8);
  expect(center).toBeGreaterThan(topEdge + 8);
  expect(center).toBeGreaterThan(corner + 16);
}

function alphaAt(png: PNG, x: number, y: number) {
  const px = clamp(Math.round(x), 0, png.width - 1);
  const py = clamp(Math.round(y), 0, png.height - 1);
  return png.data[(png.width * py + px) * 4 + 3];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
