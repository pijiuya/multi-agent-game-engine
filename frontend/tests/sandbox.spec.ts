import { expect, test } from "@playwright/test";

test("renders the transparent 2D workstation with floating panels", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("scene-viewport")).toBeVisible();
  await expect(page.getByTestId("workspace-surface")).toBeVisible();
  await expect(page.getByTestId("world-2d")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "3D" })).toHaveCount(0);

  await expect(page.getByTestId("transport-controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "运行" })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换黑白反色" })).toBeVisible();

  await expect(page.getByTestId("panel-tools")).toBeVisible();
  await expect(page.getByTestId("panel-scene")).toBeVisible();
  await expect(page.getByTestId("panel-agents")).toBeVisible();
  await expect(page.getByTestId("panel-properties")).toBeVisible();
  await expect(page.getByText("工具", { exact: true })).toBeVisible();
  await expect(page.getByText("场景列表", { exact: true })).toBeVisible();
  await expect(page.getByText("属性", { exact: true })).toBeVisible();

  const tools = await page.getByTestId("panel-tools").boundingBox();
  expect(tools).not.toBeNull();
  expect(tools!.height).toBeGreaterThan(tools!.width * 3);

  await page.getByTestId("panel-agents").getByRole("button", { name: /Mira/ }).click();
  await expect(page.getByTestId("panel-properties").getByText("mediator", { exact: true })).toBeVisible();
});

test("floating panels drag and snap to the scene edge", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const panel = page.getByTestId("panel-tools");
  const title = page.getByTestId("panel-title-tools");
  const before = await panel.boundingBox();
  const titleBox = await title.boundingBox();
  expect(before).not.toBeNull();
  expect(titleBox).not.toBeNull();

  await page.mouse.move(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(32, 32, { steps: 8 });
  await page.mouse.up();

  const after = await panel.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).not.toBe(before!.x);
  await expect(panel).toHaveAttribute("data-docked", /scene-/);
});

test("scene window keeps an outer margin", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  const scene = await page.getByTestId("scene-viewport").boundingBox();
  expect(scene).not.toBeNull();
  expect(scene!.x).toBeGreaterThan(0);
  expect(scene!.y).toBeGreaterThan(0);
  expect(scene!.width).toBeLessThan(1280);
  expect(scene!.height).toBeLessThan(820);
});

test("scene material and grid use rectangular linear fading", async ({ page }) => {
  await page.goto("/");

  const sceneStyles = await page.getByTestId("scene-viewport").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow
    };
  });
  expect(sceneStyles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(sceneStyles.backgroundImage).toBe("none");
  expect(sceneStyles.borderTopWidth).toBe("0px");
  expect(sceneStyles.boxShadow).toBe("none");

  const canvasShellStyles = await page.locator(".scene-canvas-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow
    };
  });
  expect(canvasShellStyles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(canvasShellStyles.backgroundImage).toBe("none");
  expect(canvasShellStyles.boxShadow).toBe("none");

  const gridStyles = await page.locator(".scene-window-grid").evaluate((element) => {
    const style = getComputedStyle(element);
    const prefixed = style as CSSStyleDeclaration & { webkitMaskImage?: string };
    return {
      backgroundImage: style.backgroundImage,
      maskImage: style.maskImage || prefixed.webkitMaskImage
    };
  });
  expect(gridStyles.backgroundImage).toContain("rgba(0, 0, 0");
  expect(gridStyles.maskImage).toContain("linear-gradient");
  expect(gridStyles.maskImage).not.toContain("radial-gradient");

  const materialStyles = await page.locator(".scene-window-material").evaluate((element) => {
    const style = getComputedStyle(element);
    const prefixed = style as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
      webkitMaskImage?: string;
      webkitMaskComposite?: string;
    };
    return {
      backgroundImage: style.backgroundImage,
      maskImage: style.maskImage || prefixed.webkitMaskImage,
      maskComposite: style.maskComposite || prefixed.webkitMaskComposite,
      backdropFilter: style.backdropFilter || prefixed.webkitBackdropFilter
    };
  });
  expect(materialStyles.backgroundImage).toContain("linear-gradient");
  expect(materialStyles.backgroundImage).toContain("0.75");
  expect(materialStyles.backgroundImage).not.toContain("radial-gradient");
  expect(materialStyles.maskImage).toContain("linear-gradient");
  expect(materialStyles.maskImage).not.toContain("radial-gradient");
  expect(materialStyles.maskComposite).not.toContain("intersect");
  expect(materialStyles.maskComposite).not.toContain("source-in");
  expect(materialStyles.backdropFilter).toContain("blur");
});

test("floating panels resize from edges and scroll clipped content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const panel = page.getByTestId("panel-tools");
  const resizeCorner = page.getByTestId("resize-tools-se");
  const before = await panel.boundingBox();
  const corner = await resizeCorner.boundingBox();
  expect(before).not.toBeNull();
  expect(corner).not.toBeNull();

  await page.mouse.move(corner!.x + corner!.width / 2, corner!.y + corner!.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner!.x + corner!.width / 2 + 70, corner!.y + corner!.height / 2 + 50, { steps: 6 });
  await page.mouse.up();

  const grown = await panel.boundingBox();
  expect(grown).not.toBeNull();
  expect(grown!.width).toBeGreaterThan(before!.width + 30);
  expect(grown!.height).toBeGreaterThan(before!.height + 20);

  const resizeBottom = page.getByTestId("resize-tools-s");
  const bottom = await resizeBottom.boundingBox();
  expect(bottom).not.toBeNull();
  await page.mouse.move(bottom!.x + bottom!.width / 2, bottom!.y + bottom!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bottom!.x + bottom!.width / 2, before!.y + 126, { steps: 8 });
  await page.mouse.up();

  const scrollState = await panel.locator(".floating-panel-body").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    };
  });
  expect(scrollState.overflowY).toBe("auto");
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
});

test("floating panels are more legible without becoming solid blocks", async ({ page }) => {
  await page.goto("/");

  const panelStyles = await page.getByTestId("panel-tools").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderColor: style.borderTopColor
    };
  });

  expect(panelStyles.backgroundColor).toBe("rgba(248, 248, 248, 0.72)");
  expect(panelStyles.backgroundImage).toContain("rgba(0, 0, 0");
  expect(panelStyles.borderColor).toBe("rgba(0, 0, 0, 0.34)");
});

test("workspace can invert grid and translucent material tone", async ({ page }) => {
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "切换黑白反色" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".desktop-workspace")).toHaveClass(/tone-dark/);

  const invertedStyles = await page.locator(".scene-window-grid").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backgroundImage;
  });
  expect(invertedStyles).toContain("rgba(255, 255, 255");

  const material = await page.locator(".scene-window-material").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backgroundImage;
  });
  expect(material).toContain("rgba(10, 10, 10");
  expect(material).not.toContain("radial-gradient");
});
