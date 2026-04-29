import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("agent-workstation.disable-ws", "1"));
  await page.route("**/api/**", (route) => route.abort());
});

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
  await expect(page.getByTestId("panel-models")).toBeVisible();
  await expect(page.getByTestId("panel-mapStudio")).toBeVisible();
  await expect(page.getByTestId("panel-properties")).toBeVisible();
  await expect(page.getByTestId("panel-title-tools")).toContainText("工具");
  await expect(page.getByTestId("panel-title-scene")).toContainText("场景列表");
  await expect(page.getByTestId("panel-title-models")).toContainText("模型管理");
  await expect(page.getByTestId("panel-title-mapStudio")).toContainText("地图工作台");
  await expect(page.getByTestId("panel-title-properties")).toContainText("属性");

  const tools = await page.getByTestId("panel-tools").boundingBox();
  expect(tools).not.toBeNull();
  expect(tools!.height).toBeGreaterThan(tools!.width * 3);

  await page.getByTestId("panel-agents").locator(".agent-card").first().click();
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("Agent");
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

test("floating panel layout persists across reloads", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.removeItem("agent-workstation.panel-layout.v1"));
  await page.reload();

  const panel = page.getByTestId("panel-scene");
  const title = page.getByTestId("panel-title-scene");
  const titleBox = await title.boundingBox();
  expect(titleBox).not.toBeNull();

  await page.mouse.move(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(220, 180, { steps: 8 });
  await page.mouse.up();

  const resizeCorner = page.getByTestId("resize-scene-se");
  const corner = await resizeCorner.boundingBox();
  expect(corner).not.toBeNull();
  await page.mouse.move(corner!.x + corner!.width / 2, corner!.y + corner!.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner!.x + corner!.width / 2 + 64, corner!.y + corner!.height / 2 + 48, { steps: 6 });
  await page.mouse.up();

  const saved = await panel.boundingBox();
  expect(saved).not.toBeNull();
  await page.reload();

  const restored = await page.getByTestId("panel-scene").boundingBox();
  expect(restored).not.toBeNull();
  expect(restored!.x).toBeCloseTo(saved!.x, 0);
  expect(restored!.y).toBeCloseTo(saved!.y, 0);
  expect(restored!.width).toBeCloseTo(saved!.width, 0);
  expect(restored!.height).toBeCloseTo(saved!.height, 0);
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
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
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
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
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

  const firstMarker = page.locator(".world-agent-marker").first();
  await page.getByTestId("panel-agents").locator(".agent-card").first().dblclick();
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("Agent");
  const after = await readGridState(scene);
  const agentPosition = await firstMarker.evaluate((element) => ({
    x: Number(element.getAttribute("data-world-x")),
    y: Number(element.getAttribute("data-world-y"))
  }));

  expect(parseFloat(after.panX)).toBeCloseTo(shellBox!.width / 2 - agentPosition.x, 0);
  expect(parseFloat(after.panY)).toBeCloseTo(shellBox!.height / 2 - agentPosition.y, 0);
  await expect(firstMarker).toBeVisible();
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
  const agentCountBefore = await page.locator(".world-agent-marker").count();
  const itemCountBefore = await page.locator(".world-item-marker").count();
  await page.mouse.click(box!.x + 740, box!.y + 260, { button: "right" });
  await page.getByRole("button", { name: "生成 Agent" }).click();
  await expect(page.locator(".world-agent-marker")).toHaveCount(agentCountBefore + 1);

  await page.mouse.click(box!.x + 770, box!.y + 320, { button: "right" });
  await page.getByRole("button", { name: "生成地图元素" }).click();
  await expect(page.locator(".world-item-marker")).toHaveCount(itemCountBefore + 1);
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("元素");

  const zoomBeforePanelRightClick = (await readGridState(scene)).minorSize;
  await page.getByTestId("panel-tools").click({ button: "right" });
  await expect(page.getByTestId("anchor-context-menu")).toHaveCount(0);
  const zoomAfterPanelRightClick = (await readGridState(scene)).minorSize;
  expect(zoomAfterPanelRightClick).toBe(zoomBeforePanelRightClick);

  await expect(page.getByTestId("world-2d")).toHaveCount(0);
});

test("properties panel renames map and agent through real editors", async ({ page }) => {
  await page.goto("/");
  const suffix = Date.now().toString().slice(-5);

  await page.getByTestId("panel-scene").getByRole("button", { name: /地图/ }).first().click();
  const mapName = page.getByTestId("panel-properties").locator(".property-edit-row").filter({ hasText: "名称" }).getByRole("textbox");
  await mapName.fill(`测试地图 ${suffix}`);
  await mapName.press("Enter");
  await expect(page.locator(".scene-footer").getByText(`测试地图 ${suffix}`, { exact: true })).toBeVisible();

  await page.getByTestId("panel-agents").locator(".agent-card").first().click();
  const agentName = page.getByTestId("panel-properties").locator(".property-edit-row").filter({ hasText: "名称" }).getByRole("textbox");
  await agentName.fill(`测试Agent ${suffix}`);
  await agentName.press("Enter");
  await expect(page.getByTestId("panel-agents").getByRole("button", { name: new RegExp(`测试Agent ${suffix}`) })).toBeVisible();
});

test("agent panel context menu and scene double click can rename agents", async ({ page }) => {
  await page.goto("/");
  const suffix = Date.now().toString().slice(-5);
  const firstAgent = page.getByTestId("panel-agents").locator(".agent-card").first();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("重命名 Agent");
    await dialog.accept(`右键Agent ${suffix}`);
  });
  await firstAgent.click({ button: "right" });
  await page.getByTestId("agent-context-menu").getByRole("button", { name: "重命名" }).click();
  await expect(page.getByTestId("panel-agents").getByRole("button", { name: new RegExp(`右键Agent ${suffix}`) })).toBeVisible();

  const marker = page.locator('[data-testid^="world-agent-label-"]').first();
  page.once("dialog", async (dialog) => {
    await dialog.accept(`场景Agent ${suffix}`);
  });
  await marker.dblclick({ force: true });
  await expect(page.locator('[data-testid^="world-agent-label-"]').filter({ hasText: `场景Agent ${suffix}` })).toBeVisible();
});

test("drawing tools create vector areas and item transform handles edit items", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const surface = page.getByTestId("workspace-surface");
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();

  await page.getByRole("button", { name: "障碍区" }).click();
  await page.mouse.click(box!.x + 440, box!.y + 260);
  await page.mouse.click(box!.x + 520, box!.y + 260);
  await page.mouse.click(box!.x + 520, box!.y + 330);
  await expect(page.getByTestId("world-draft-area")).toBeVisible();
  const areaCountBefore = await page.locator('[data-testid^="world-area-"]').count();
  await page.getByRole("button", { name: "完成多边形" }).click();
  await expect(page.locator('[data-testid^="world-area-"]')).toHaveCount(areaCountBefore + 1);

  await page.getByTestId("panel-tools").getByRole("button", { name: "元素" }).click();
  const itemCountBefore = await page.locator(".world-item-marker").count();
  await page.mouse.click(box!.x + 620, box!.y + 360);
  await expect(page.locator(".world-item-marker")).toHaveCount(itemCountBefore + 1);
  await expect(page.getByTestId("item-transform-box")).toBeVisible();
  const transformLayerState = await page.getByTestId("item-transform-box").evaluate((element) => ({
    inScaledLayer: Boolean(element.closest(".world-coordinate-layer")),
    scaleWidth: (element.querySelector(".item-transform-handle.scale") as HTMLElement).getBoundingClientRect().width,
    rotateWidth: (element.querySelector(".item-transform-handle.rotate") as HTMLElement).getBoundingClientRect().width
  }));
  expect(transformLayerState.inScaledLayer).toBe(false);
  expect(transformLayerState.scaleWidth).toBeLessThanOrEqual(14);
  expect(transformLayerState.rotateWidth).toBeLessThanOrEqual(16);

  const item = page.locator(".world-item-marker.active");
  await expect(item).toBeVisible();
  const before = await item.evaluate((element) => ({
    x: Number(element.getAttribute("data-world-x")),
    y: Number(element.getAttribute("data-world-y"))
  }));
  const itemBox = await item.boundingBox();
  expect(itemBox).not.toBeNull();
  await page.mouse.move(itemBox!.x + itemBox!.width / 2, itemBox!.y + itemBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(itemBox!.x + itemBox!.width / 2 + 54, itemBox!.y + itemBox!.height / 2 + 36, { steps: 6 });
  await page.mouse.up();
  const after = await item.evaluate((element) => ({
    x: Number(element.getAttribute("data-world-x")),
    y: Number(element.getAttribute("data-world-y"))
  }));
  expect(after.x).not.toBe(before.x);
  expect(after.y).not.toBe(before.y);

  const scaleHandle = page.locator(".item-transform-handle.scale");
  const scaleBox = await scaleHandle.boundingBox();
  expect(scaleBox).not.toBeNull();
  await page.mouse.move(scaleBox!.x + scaleBox!.width / 2, scaleBox!.y + scaleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(scaleBox!.x + 120, scaleBox!.y + 110, { steps: 8 });
  await page.mouse.up();
  const scaleValue = await page
    .getByTestId("panel-properties")
    .locator(".property-edit-row")
    .filter({ hasText: "缩放" })
    .getByRole("spinbutton")
    .inputValue();
  expect(Number(scaleValue)).toBeGreaterThanOrEqual(1);
});

test("map studio separates model management and runs gated SAM flow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.removeItem("agent-workstation.panel-layout.v1"));
  await page.reload();

  const modelsPanel = page.getByTestId("panel-models");
  const mapStudioPanel = page.getByTestId("panel-mapStudio");
  await expect(page.getByTestId("panel-title-models")).toContainText("模型管理");
  await expect(modelsPanel.getByTestId("model-capability-cards")).toContainText("语言模型 LLM");
  await expect(modelsPanel.getByTestId("model-capability-cards")).toContainText("图片生成");
  await expect(modelsPanel.getByTestId("model-capability-cards")).toContainText("SAM 分层");
  await expect(modelsPanel.getByText("服务地址", { exact: true })).toHaveCount(0);
  await expect(modelsPanel.getByText("Provider")).toHaveCount(0);
  await expect(modelsPanel.getByRole("button", { name: "新增模型" })).toHaveCount(0);
  await expect(modelsPanel.getByTestId("map-ratio-controls")).toHaveCount(0);
  await expect(modelsPanel.getByTestId("generate-map-button")).toHaveCount(0);
  await expect(modelsPanel.getByTestId("segment-map-button")).toHaveCount(0);
  await modelsPanel.getByTestId("model-capability-segmentation").click();
  await modelsPanel.getByTestId("model-advanced-toggle-segmentation").click();
  await expect(modelsPanel.getByTestId("model-advanced-segmentation").getByText("服务地址", { exact: true })).toBeVisible();
  await expect(modelsPanel.getByTestId("model-advanced-segmentation").getByText("API Key", { exact: true })).toBeVisible();

  await expect(mapStudioPanel.getByTestId("map-workflow-steps")).toContainText("背景生成/导入");
  await expect(mapStudioPanel.getByTestId("map-workflow-steps")).toContainText("SAM 分层");
  await expect(mapStudioPanel.getByTestId("map-step-body-background")).toBeVisible();
  await expect(mapStudioPanel.getByTestId("map-step-body-segment")).toHaveCount(0);
  await mapStudioPanel.getByTestId("map-ratio-controls").getByRole("button", { name: "16:9" }).click();
  const frame = page.getByTestId("world-map-frame");
  await expect(frame).toBeVisible();
  const frameState = await frame.evaluate((element) => {
    const style = getComputedStyle(element as HTMLElement);
    return {
      width: style.width,
      height: style.height,
      left: style.left,
      top: style.top
    };
  });
  expect(frameState.width).toBe("1920px");
  expect(frameState.height).toBe("1080px");
  expect(frameState.left).toBe("0px");
  expect(frameState.top).toBe("0px");

  await frame.click({ position: { x: 160, y: 50 } });
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("地图");
  await expect(mapStudioPanel.getByTestId("generated-candidates")).toHaveCount(0);

  await mapStudioPanel.getByLabel("背景图提示").fill("带有道路、居民楼和广场的俯视地图");
  await mapStudioPanel.getByTestId("generate-map-button").click();
  await expect(mapStudioPanel.getByTestId("generated-candidates").locator(".candidate-card")).toHaveCount(3);
  await mapStudioPanel.getByTestId("generated-candidates").locator(".candidate-card").first().click();
  await expect(page.getByTestId("world-map-background")).toBeVisible();
  await expect(page.getByTestId("world-map-frame")).toHaveCount(0);
  const backgroundState = await page.getByTestId("world-map-background").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      inCoordinateLayer: Boolean(element.closest(".world-coordinate-layer")),
      opacity: Number(style.opacity)
    };
  });
  expect(backgroundState.inCoordinateLayer).toBe(true);
  expect(backgroundState.opacity).toBeGreaterThan(0.9);
  await expect(mapStudioPanel.getByText("已应用为地图背景")).toBeVisible();

  await mapStudioPanel.getByTestId("map-step-segment").click();
  await expect(mapStudioPanel.getByTestId("map-step-body-segment")).toBeVisible();
  await expect(mapStudioPanel.getByTestId("sam-provider-card")).toContainText("未配置 SAM 分层模型");
  await expect(mapStudioPanel.getByTestId("segmentation-progress")).toContainText("待机");
  await page.route("**/api/map/segment", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "未配置 SAM 分层模型" })
    })
  );
  await mapStudioPanel.getByTestId("segment-map-button").click();
  await expect(mapStudioPanel.getByTestId("segmentation-status")).toContainText("未配置 SAM 分层模型");
  await expect(page.locator('[data-testid^="world-region-"]')).toHaveCount(0);

  await page.evaluate(() => window.localStorage.setItem("agent-workstation.enable-mock-sam", "1"));
  await mapStudioPanel.getByTestId("segment-map-button").click();
  await expect(page.locator('[data-testid^="world-region-"]')).toHaveCount(4);
  await expect(mapStudioPanel.getByTestId("segmentation-status")).toContainText("测试 Mock SAM");
  await expect(mapStudioPanel.getByTestId("segmentation-progress")).toContainText("完成");
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("SAM 分区");
  await expect(page.getByTestId("panel-scene").getByText("主道路", { exact: true })).toBeVisible();

  await mapStudioPanel.getByTestId("map-step-layers").click();
  await expect(mapStudioPanel.getByTestId("map-step-body-layers")).toBeVisible();
  await expect(mapStudioPanel.getByLabel("图层名称")).toBeVisible();
  await expect(mapStudioPanel.getByRole("button", { name: "未配置图像识别模型" })).toBeVisible();

  await mapStudioPanel.getByTestId("map-step-functions").click();
  await expect(mapStudioPanel.getByTestId("map-step-body-functions")).toBeVisible();
  await mapStudioPanel.getByTestId("map-step-body-functions").getByRole("button", { name: "不可穿过", exact: true }).click();
  await expect(page.getByTestId("panel-scene").getByText("不可穿过").first()).toBeVisible();
});

test("agent labels and origin icons stay crisp at a fixed screen size during zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  const surface = page.getByTestId("workspace-surface");
  const label = page.locator(".world-agent-label").first();
  const marker = page.locator(".world-agent-marker").first();
  const icon = marker.locator("> span");

  const labelBefore = await label.boundingBox();
  const markerBefore = await marker.boundingBox();
  const iconBefore = await icon.boundingBox();
  expect(labelBefore).not.toBeNull();
  expect(markerBefore).not.toBeNull();
  expect(iconBefore).not.toBeNull();
  await expect(page.getByTestId("world-label-layer")).toBeVisible();
  const labelLayerState = await label.evaluate((element) => ({
    scaleX: new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
    scaleY: new DOMMatrixReadOnly(getComputedStyle(element).transform).d,
    inScaledLayer: Boolean(element.closest(".world-coordinate-layer"))
  }));
  expect(labelLayerState.scaleX).toBeCloseTo(1, 2);
  expect(labelLayerState.scaleY).toBeCloseTo(1, 2);
  expect(labelLayerState.inScaledLayer).toBe(false);

  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -1200);
  await page.mouse.wheel(0, -1200);

  const labelAfter = await label.boundingBox();
  const markerAfter = await marker.boundingBox();
  const iconAfter = await icon.boundingBox();
  expect(labelAfter).not.toBeNull();
  expect(markerAfter).not.toBeNull();
  expect(iconAfter).not.toBeNull();
  expect(Math.abs(labelAfter!.height - labelBefore!.height)).toBeLessThan(2);
  expect(Math.abs(markerAfter!.width - markerBefore!.width)).toBeLessThan(1);
  expect(Math.abs(iconAfter!.width - iconBefore!.width)).toBeLessThan(1);
  const markerLayerState = await marker.evaluate((element) => ({
    scaleX: new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
    scaleY: new DOMMatrixReadOnly(getComputedStyle(element).transform).d,
    inScaledLayer: Boolean(element.closest(".world-coordinate-layer"))
  }));
  expect(markerLayerState.scaleX).toBeCloseTo(1, 2);
  expect(markerLayerState.scaleY).toBeCloseTo(1, 2);
  expect(markerLayerState.inScaledLayer).toBe(false);
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
