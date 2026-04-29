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
  await expect(page.getByRole("button", { name: "回归零点" })).toBeVisible();
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

test("workspace wheel zoom changes grid scale and density", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const scene = page.getByTestId("scene-viewport");
  const surface = page.getByTestId("workspace-surface");
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();

  const before = await readGridState(scene);
  await surface.hover();
  await page.mouse.wheel(0, -900);
  await page.mouse.wheel(0, -900);
  await page.mouse.wheel(0, -900);
  await page.mouse.wheel(0, -900);
  const zoomedIn = await readGridState(scene);
  expect(zoomedIn.minorSize).toBeGreaterThan(before.minorSize);
  expect(zoomedIn.density).toBe("fine");

  await page.mouse.wheel(0, 1400);
  await page.mouse.wheel(0, 1400);
  await page.mouse.wheel(0, 1400);
  await page.mouse.wheel(0, 1400);
  await page.mouse.wheel(0, 1400);
  await page.mouse.wheel(0, 1400);
  await page.mouse.wheel(0, 1400);
  await page.mouse.wheel(0, 1400);
  const zoomedOut = await readGridState(scene);
  expect(zoomedOut.minorSize).toBeLessThan(zoomedIn.minorSize);
  expect(zoomedOut.density).toBe("simple");

  await expect(page.getByTestId("world-2d")).toHaveCount(0);
});

test("middle mouse pans infinite grid without affecting panels", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const scene = page.getByTestId("scene-viewport");
  const surface = page.getByTestId("workspace-surface");
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();

  const before = await readGridState(scene);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box!.x + box!.width / 2 + 96, box!.y + box!.height / 2 + 44, { steps: 8 });
  await page.mouse.up({ button: "middle" });

  const after = await readGridState(scene);
  expect(after.panX).not.toBe(before.panX);
  expect(after.panY).not.toBe(before.panY);

  const panelBody = page.getByTestId("panel-tools").locator(".floating-panel-body");
  const panelScrollBefore = await panelBody.evaluate((element) => element.scrollTop);
  const zoomBeforePanelWheel = (await readGridState(scene)).minorSize;
  await panelBody.hover();
  await page.mouse.wheel(0, 500);
  const panelScrollAfter = await panelBody.evaluate((element) => element.scrollTop);
  const zoomAfterPanelWheel = (await readGridState(scene)).minorSize;
  expect(panelScrollAfter).toBeGreaterThanOrEqual(panelScrollBefore);
  expect(zoomAfterPanelWheel).toBe(zoomBeforePanelWheel);
});

test("workspace zoom and pan still work after tone inversion", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  await page.getByRole("button", { name: "切换黑白反色" }).click();
  const scene = page.getByTestId("scene-viewport");
  const surface = page.getByTestId("workspace-surface");
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();

  const before = await readGridState(scene);
  await surface.hover();
  await page.mouse.wheel(0, -900);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box!.x + box!.width / 2 + 42, box!.y + box!.height / 2 + 32, { steps: 5 });
  await page.mouse.up({ button: "middle" });

  const after = await readGridState(scene);
  expect(after.minorSize).toBeGreaterThan(before.minorSize);
  expect(after.panX).not.toBe(before.panX);
  expect(after.backgroundImage).toContain("rgba(255, 255, 255");
});

test("origin button centers the zero point without changing zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const scene = page.getByTestId("scene-viewport");
  const shell = page.locator(".scene-canvas-shell");
  const shellBox = await shell.boundingBox();
  expect(shellBox).not.toBeNull();

  const before = await readGridState(scene);
  await page.getByRole("button", { name: "回归零点" }).click();
  const after = await readGridState(scene);

  expect(after.minorSize).toBe(before.minorSize);
  expect(parseFloat(after.panX)).toBeCloseTo(shellBox!.width / 2, 0);
  expect(parseFloat(after.panY)).toBeCloseTo(shellBox!.height / 2, 0);
  await expect(page.getByTestId("origin-marker")).toBeVisible();
});

test("double clicking an agent centers that agent in world coordinates", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const scene = page.getByTestId("scene-viewport");
  const shell = page.locator(".scene-canvas-shell");
  const shellBox = await shell.boundingBox();
  expect(shellBox).not.toBeNull();

  await page.getByTestId("panel-agents").getByRole("button", { name: /Mira/ }).dblclick();
  await expect(page.getByTestId("panel-properties").getByText("mediator", { exact: true })).toBeVisible();
  const after = await readGridState(scene);
  const agentPosition = await page.getByTestId("world-agent-agent_mira").evaluate((element) => ({
    x: Number(element.getAttribute("data-world-x")),
    y: Number(element.getAttribute("data-world-y"))
  }));

  expect(parseFloat(after.panX)).toBeCloseTo(shellBox!.width / 2 - agentPosition.x, 0);
  expect(parseFloat(after.panY)).toBeCloseTo(shellBox!.height / 2 - agentPosition.y, 0);
  await expect(page.getByTestId("world-agent-agent_mira")).toBeVisible();
});

test("anchor tool snaps to the grid and generates empty points", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const surface = page.getByTestId("workspace-surface");
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();

  await page.getByRole("button", { name: "锚点" }).click();
  await expect(page.locator(".scene-footer").getByText("锚点", { exact: true })).toBeVisible();
  await page.mouse.click(box!.x + box!.width / 2 + 13, box!.y + box!.height / 2 + 11);
  await expect(page.getByTestId("world-anchor-marker")).toBeVisible();

  await page.mouse.click(box!.x + box!.width / 2 + 13, box!.y + box!.height / 2 + 11, { button: "right" });
  await expect(page.getByTestId("anchor-context-menu")).toBeVisible();
  await page.getByRole("button", { name: "生成空点" }).click();

  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("空点");
  await expect(page.getByTestId("panel-properties").getByText("已吸附到网格", { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="world-point-"]')).toHaveCount(1);
});

test("anchor context menu generates agents and map elements without affecting panels", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const scene = page.getByTestId("scene-viewport");
  const surface = page.getByTestId("workspace-surface");
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();

  await page.getByRole("button", { name: "锚点" }).click();
  await expect(page.locator(".scene-footer").getByText("锚点", { exact: true })).toBeVisible();
  const agentCountBefore = await page.locator('[data-testid^="world-agent-"]').count();
  const itemCountBefore = await page.locator('[data-testid^="world-item-"]').count();
  await page.mouse.click(box!.x + 430, box!.y + 260, { button: "right" });
  await page.getByRole("button", { name: "生成 Agent" }).click();
  await expect(page.locator('[data-testid^="world-agent-"]')).toHaveCount(agentCountBefore + 1);

  await page.mouse.click(box!.x + 520, box!.y + 320, { button: "right" });
  await page.getByRole("button", { name: "生成地图元素" }).click();
  await expect(page.locator('[data-testid^="world-item-"]')).toHaveCount(itemCountBefore + 1);
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("元素");

  const zoomBeforePanelRightClick = (await readGridState(scene)).minorSize;
  await page.getByTestId("panel-tools").click({ button: "right" });
  await expect(page.getByTestId("anchor-context-menu")).toHaveCount(0);
  const zoomAfterPanelRightClick = (await readGridState(scene)).minorSize;
  expect(zoomAfterPanelRightClick).toBe(zoomBeforePanelRightClick);

  await expect(page.getByTestId("world-2d")).toHaveCount(0);
});

async function readGridState(scene: import("@playwright/test").Locator) {
  return scene.evaluate((element) => {
    const style = getComputedStyle(element);
    const grid = getComputedStyle(element.querySelector(".scene-window-grid") as Element);
    return {
      density: element.getAttribute("data-grid-density"),
      panX: style.getPropertyValue("--grid-pan-x").trim(),
      panY: style.getPropertyValue("--grid-pan-y").trim(),
      minorSize: parseFloat(style.getPropertyValue("--grid-size-minor")),
      majorSize: parseFloat(style.getPropertyValue("--grid-size-major")),
      backgroundImage: grid.backgroundImage
    };
  });
}
