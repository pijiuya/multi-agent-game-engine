import { expect, test } from "@playwright/test";
import { fallbackWorld } from "../src/lib/fallbackWorld";

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
  await expect(page.getByTestId("transport-controls").getByRole("button", { name: "运行", exact: true })).toBeVisible();
  await expect(page.getByTestId("transport-controls").getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await expect(page.getByTestId("transport-controls").getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await expect(page.getByTestId("transport-controls").getByRole("button", { name: "运行监控" })).toBeVisible();
  await expect(page.getByRole("button", { name: "回归零点" })).toBeVisible();
  await expect(page.getByRole("button", { name: "背景透明度" })).toBeVisible();
  await expect(page.getByRole("button", { name: "应用默认面板布局" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换黑白反色" })).toBeVisible();

  await expect(page.getByTestId("panel-tools")).toBeVisible();
  await expect(page.getByTestId("panel-scene")).toBeVisible();
  await expect(page.getByTestId("panel-regions")).toBeVisible();
  await expect(page.getByTestId("panel-regionDraw")).toBeVisible();
  await expect(page.getByTestId("region-draw-panel")).toBeVisible();
  await expect(page.getByTestId("panel-agents")).toBeVisible();
  await expect(page.getByTestId("panel-models")).toBeVisible();
  await expect(page.getByTestId("panel-runtimeMonitor")).toBeVisible();
  await expect(page.getByTestId("panel-mapStudio")).toBeVisible();
  await expect(page.getByTestId("panel-properties")).toBeVisible();
  await expect(page.getByTestId("panel-title-tools")).toContainText("工具");
  await expect(page.getByTestId("panel-title-scene")).toContainText("场景列表");
  await expect(page.getByTestId("panel-title-regions")).toContainText("区域");
  await expect(page.getByTestId("panel-title-regionDraw")).toContainText("区域绘制");
  await expect(page.getByTestId("panel-title-models")).toContainText("模型管理");
  await expect(page.getByTestId("panel-title-runtimeMonitor")).toContainText("运行监控");
  await expect(page.getByTestId("panel-title-mapStudio")).toContainText("地图工作台");
  await expect(page.getByTestId("panel-title-properties")).toContainText("属性");

  const tools = await page.getByTestId("panel-tools").boundingBox();
  expect(tools).not.toBeNull();
  expect(tools!.height).toBeGreaterThan(tools!.width * 3);

  await page.getByTestId("panel-agents").locator(".agent-card").first().click();
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("Agent");
});

test("runtime monitor shows model groups and local device pressure", async ({ page }) => {
  await page.route("**/api/runtime/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        timestamp: 1765814400,
        simulation: {
          running: true,
          tick: 88,
          scene_director_pending: false,
          pending_model_task_count: 1,
          pending_model_tasks: [
            { agent_id: "agent_mira", provider: "ollama", model: "qwen2.5:7b", started_tick: 80, age_ticks: 8 }
          ]
        },
        models: [
          {
            id: "local",
            name: "本地 LLM",
            kind: "local",
            provider: "ollama",
            model: "qwen2.5:7b",
            capabilities: ["llm"],
            enabled: true,
            pending_count: 1,
            recent_event_count: 4,
            recent_error_count: 0
          },
          {
            id: "remote",
            name: "线上备用",
            kind: "remote",
            provider: "openai-compatible",
            model: "gpt-test",
            capabilities: ["llm"],
            enabled: false,
            pending_count: 0,
            recent_event_count: 2,
            recent_error_count: 1
          }
        ],
        hardware: {
          platform: { system: "Darwin", release: "25.0.0", machine: "arm64", python: "3.11" },
          chip: "Apple M 系列",
          cpu_count: 12,
          load_average: [3.2, 2.5, 2.1],
          load_percent: 26.7,
          memory_total_bytes: 68719476736,
          memory_available_bytes: 34359738368,
          memory_used_percent: 50,
          gpu_pressure_available: false,
          gpu_pressure_reason: "低影响采样不读取 GPU/ANE 压力"
        }
      })
    })
  );
  await page.goto("/");

  const monitor = page.getByTestId("runtime-monitor-panel");
  await expect(monitor).toBeVisible();
  await expect(monitor.getByText("Tick 88")).toBeVisible();
  await expect(monitor.getByText("本地模型")).toBeVisible();
  await expect(monitor.getByText("本地 LLM")).toBeVisible();
  await expect(monitor.getByText("运行中 1")).toBeVisible();
  await expect(monitor.getByText("线上模型")).toBeVisible();
  await expect(monitor.getByText("线上备用")).toBeVisible();
  await expect(monitor.getByText("Apple M 系列")).toBeVisible();
  await expect(monitor.getByText("低影响采样不读取 GPU/ANE 压力")).toBeVisible();

  await page.getByRole("button", { name: "折叠 运行监控" }).click();
  await expect(page.getByTestId("panel-runtimeMonitor")).toHaveClass(/minimized/);
  await page.getByTestId("transport-controls").getByRole("button", { name: "运行监控" }).click();
  await expect(page.getByTestId("panel-runtimeMonitor")).not.toHaveClass(/minimized/);
  await expect(monitor.getByText("Tick 88")).toBeVisible();
});

test("top controls adjust app background opacity without map region controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const controls = page.getByTestId("transport-controls");
  await expect(controls.getByRole("button", { name: "背景透明度" })).toBeVisible();
  await controls.getByRole("button", { name: "背景透明度" }).click();
  await expect(page.getByTestId("background-opacity-popover")).toBeVisible();
  await expect(page.getByText("应用背景")).toBeVisible();
  await expect(page.getByLabel("应用背景不透明度")).toBeVisible();
  await expect(page.getByRole("button", { name: "全图" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "区域", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "区域外" })).toHaveCount(0);

  await page.getByLabel("应用背景不透明度").fill("0.5");
  const opacity = await page.locator(".desktop-workspace").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--app-background-opacity").trim()
  );
  expect(opacity).toBe("0.5");
  await expect(page.getByText("只调整应用窗口底色，不影响地图或 agent 场景。")).toBeVisible();
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
  await expect(panel).toHaveAttribute("data-docked", /screen:/);
});

test("floating panels snap to each other", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const tools = page.getByTestId("panel-tools");
  const scene = page.getByTestId("panel-scene");
  const title = page.getByTestId("panel-title-tools");
  const toolsBox = await tools.boundingBox();
  const sceneBox = await scene.boundingBox();
  const titleBox = await title.boundingBox();
  expect(toolsBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  expect(titleBox).not.toBeNull();

  const targetX = sceneBox!.x - toolsBox!.width - 10;
  const targetY = sceneBox!.y;
  await page.mouse.move(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX + titleBox!.width / 2, targetY + titleBox!.height / 2, { steps: 10 });
  await page.mouse.up();

  const snappedTools = await tools.boundingBox();
  const snappedScene = await scene.boundingBox();
  expect(snappedTools).not.toBeNull();
  expect(snappedScene).not.toBeNull();
  expect(snappedScene!.x - (snappedTools!.x + snappedTools!.width)).toBeCloseTo(8, 0);
  await expect(tools).toHaveAttribute("data-docked", /panel:/);
});

test("floating panels stay inside the bottom edge while dragging", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const panel = page.getByTestId("panel-scene");
  const title = page.getByTestId("panel-title-scene");
  const titleBox = await title.boundingBox();
  expect(titleBox).not.toBeNull();

  await page.mouse.move(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(640, 900, { steps: 12 });
  await page.mouse.up();

  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(804);
});

test("floating panels minimize and expand from the titlebar button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const panel = page.getByTestId("panel-scene");
  await expect(panel.locator(".floating-panel-body")).toBeVisible();
  await page.getByRole("button", { name: "折叠 场景列表" }).click();
  await expect(panel).toHaveClass(/minimized/);
  await expect(panel.locator(".floating-panel-body")).toHaveCount(0);
  await page.getByRole("button", { name: "展开 场景列表" }).click();
  await expect(panel).not.toHaveClass(/minimized/);
  await expect(panel.locator(".floating-panel-body")).toBeVisible();
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

test("scene material and grid use stable canvas rendering", async ({ page }) => {
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

  const surfaceStyles = await page.locator(".scene-window-surface").evaluate((element) => {
    const style = getComputedStyle(element);
    const prefixed = style as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
      webkitMaskImage?: string;
    };
    return {
      borderRadius: style.borderRadius,
      maskImage: style.maskImage || prefixed.webkitMaskImage,
      backdropFilter: style.backdropFilter || prefixed.webkitBackdropFilter
    };
  });
  expect(surfaceStyles.borderRadius).toBe("28px");
  expect(surfaceStyles.maskImage === "none" || surfaceStyles.maskImage === "").toBeTruthy();
  expect(surfaceStyles.backdropFilter === "none" || surfaceStyles.backdropFilter === "").toBeTruthy();

  const gridState = await page.getByTestId("scene-grid-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const style = getComputedStyle(element);
    const box = canvas.getBoundingClientRect();
    return {
      display: style.display,
      width: canvas.width,
      height: canvas.height,
      cssWidth: box.width,
      cssHeight: box.height
    };
  });
  expect(gridState.display).toBe("block");
  expect(gridState.width).toBeGreaterThan(0);
  expect(gridState.height).toBeGreaterThan(0);
  expect(gridState.cssWidth).toBeGreaterThan(0);
  expect(gridState.cssHeight).toBeGreaterThan(0);

  const materialStyles = await page.locator(".scene-window-material").evaluate((element) => {
    const style = getComputedStyle(element);
    const prefixed = style as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
      webkitMaskImage?: string;
    };
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      clipPath: style.clipPath,
      maskImage: style.maskImage || prefixed.webkitMaskImage,
      backdropFilter: style.backdropFilter || prefixed.webkitBackdropFilter
    };
  });
  expect(materialStyles.backgroundImage).toBe("none");
  expect(materialStyles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(materialStyles.backgroundImage).not.toContain("radial-gradient");
  expect(materialStyles.clipPath).toBe("none");
  expect(materialStyles.maskImage).toBe("none");
  expect(materialStyles.backdropFilter).toBe("none");
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
  await page.evaluate(() => window.localStorage.removeItem("agent-workstation.panel-layout.v3"));
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

test("panel layout reset button applies and saves the default arrangement", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.removeItem("agent-workstation.panel-layout.v3"));
  await page.reload();

  const scene = page.getByTestId("panel-scene");
  const title = page.getByTestId("panel-title-scene");
  const titleBox = await title.boundingBox();
  expect(titleBox).not.toBeNull();

  await page.mouse.move(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(640, 600, { steps: 10 });
  await page.mouse.up();
  const moved = await scene.boundingBox();
  expect(moved).not.toBeNull();

  await page.getByRole("button", { name: "应用默认面板布局" }).click();
  const reset = await readPanelBoxes(page);
  for (const box of reset) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(820);
  }
  for (let index = 0; index < reset.length; index += 1) {
    for (let other = index + 1; other < reset.length; other += 1) {
      expect(boxesOverlap(reset[index], reset[other])).toBe(false);
    }
  }
  const resetScene = await scene.boundingBox();
  expect(resetScene).not.toBeNull();
  expect(resetScene!.x).not.toBeCloseTo(moved!.x, 0);

  await page.reload();
  const restoredScene = await page.getByTestId("panel-scene").boundingBox();
  expect(restoredScene).not.toBeNull();
  expect(restoredScene!.x).toBeCloseTo(resetScene!.x, 0);
  expect(restoredScene!.y).toBeCloseTo(resetScene!.y, 0);
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

  const invertedStyles = await page.getByTestId("scene-viewport").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.getPropertyValue("--grid-rgb").trim();
  });
  expect(invertedStyles).toBe("255, 255, 255");

  const material = await page.locator(".scene-window-material").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backgroundColor;
  });
  expect(material).toBe("rgba(0, 0, 0, 0)");
  expect(material).not.toContain("radial-gradient");
});

test("workspace wheel zoom changes grid scale and density", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const scene = page.getByTestId("scene-viewport");
  const point = await visibleMapPoint(page);

  const before = await readGridState(scene);
  await page.mouse.move(point.x, point.y);
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
  const point = await visibleMapPoint(page);

  const before = await readGridState(scene);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(point.x + 96, point.y + 44, { steps: 8 });
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
  const point = await visibleWorkspacePoint(page, surface);

  const before = await readGridState(scene);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -900);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(point.x + 42, point.y + 32, { steps: 5 });
  await page.mouse.up({ button: "middle" });

  const after = await readGridState(scene);
  expect(after.minorSize).toBeGreaterThan(before.minorSize);
  expect(after.panX).not.toBe(before.panX);
  expect(after.gridRgb).toBe("255, 255, 255");
  expect(after.canvasWidth).toBeGreaterThan(0);
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
  const point = await visibleWorkspacePoint(page, surface);

  await page.getByTestId("panel-tools").getByRole("button", { name: "锚点" }).click();
  await expect(page.locator(".scene-footer").getByText("锚点", { exact: true })).toBeVisible();
  await page.mouse.click(point.x + 13, point.y + 11);
  await expect(page.getByTestId("world-anchor-marker")).toBeVisible();

  await page.mouse.click(point.x + 13, point.y + 11, { button: "right" });
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
  const point = await visibleWorkspacePoint(page, surface);

  await page.getByRole("button", { name: "锚点" }).click();
  await expect(page.locator(".scene-footer").getByText("锚点", { exact: true })).toBeVisible();
  const agentCountBefore = await page.locator(".world-agent-marker").count();
  const itemCountBefore = await page.locator(".world-item-marker").count();
  await page.mouse.click(point.x + 40, point.y + 20, { button: "right" });
  await page.getByRole("button", { name: "生成 Agent" }).click();
  await expect(page.locator(".world-agent-marker")).toHaveCount(agentCountBefore + 1);

  await page.getByTestId("panel-tools").locator('button[aria-label="锚点"]').click();
  await page.mouse.click(point.x, point.y, { button: "right" });
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

test("agent panel context menu and scene selection can rename agents", async ({ page }) => {
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

  await page.locator('[data-testid^="world-agent-"]').first().click({ force: true });
  const agentName = page.getByTestId("panel-properties").locator(".property-edit-row").filter({ hasText: "名称" }).getByRole("textbox");
  await agentName.fill(`场景Agent ${suffix}`);
  await agentName.press("Enter");
  await expect(page.locator('[data-testid^="world-agent-label-"]').filter({ hasText: `场景Agent ${suffix}` })).toBeVisible();
});

test("scene objects can be hidden, shown, and deleted from right click menus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const scenePanel = page.getByTestId("panel-scene");
  const firstAgentRow = scenePanel.getByRole("button", { name: /Mira/ });
  await firstAgentRow.click({ button: "right" });
  await expect(page.getByTestId("object-context-menu")).toContainText("Mira");
  await expect(page.getByTestId("object-context-menu")).toHaveCSS("z-index", "2147483000");
  await page.getByTestId("object-context-menu").getByRole("button", { name: "隐藏" }).click();
  await expect(page.locator('[data-testid="world-agent-agent_mira"]')).toHaveCount(0);
  await expect(firstAgentRow).toContainText("已隐藏");

  await firstAgentRow.click({ button: "right" });
  await page.getByTestId("object-context-menu").getByRole("button", { name: "显示" }).click();
  await expect(page.locator('[data-testid="world-agent-agent_mira"]')).toBeVisible();

  const itemCountBefore = await page.locator(".world-item-marker").count();
  await page.locator(".world-item-marker").first().dispatchEvent("contextmenu", {
    button: 2,
    clientX: 620,
    clientY: 360
  });
  await expect(page.getByTestId("object-context-menu")).toContainText("Lamp");
  await page.getByTestId("object-context-menu").getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".world-item-marker")).toHaveCount(itemCountBefore - 1);
  await expect(scenePanel.getByRole("button", { name: /Lamp/ })).toHaveCount(0);

  const points = await visibleMapTriangle(page);
  const point = points[0];
  await page.getByTestId("panel-tools").getByRole("button", { name: "区域绘制" }).click();
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
  }
  await page.getByRole("button", { name: "完成区域绘制" }).click();
  const regionRow = page.getByTestId("panel-regions").getByRole("button", { name: /手绘区域/ }).first();
  await expect(regionRow).toBeVisible();

  await regionRow.click({ button: "right" });
  await expect(page.getByTestId("object-context-menu")).toContainText("手绘区域");
  await page.getByTestId("object-context-menu").getByRole("button", { name: "隐藏" }).click();
  await expect(regionRow).toContainText("已隐藏");

  await regionRow.click({ button: "right" });
  await page.getByTestId("object-context-menu").getByRole("button", { name: "显示" }).click();
  await expect(regionRow).not.toContainText("已隐藏");

  await regionRow.click({ button: "right" });
  await page.getByTestId("object-context-menu").getByRole("button", { name: "删除" }).click();
  await expect(page.getByTestId("panel-regions").getByRole("button", { name: /手绘区域/ })).toHaveCount(0);
});

test("agent panel controls animation, stop, dialogue, and item mobility", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const actionRequests: Array<Record<string, unknown>> = [];
  const agentPatches: Array<Record<string, unknown>> = [];
  const itemPatches: Array<Record<string, unknown>> = [];

  await page.route("**/api/actions", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    actionRequests.push(body);
    const snapshot = JSON.parse(JSON.stringify(fallbackWorld));
    snapshot.agent_states.agent_mira.target = null;
    snapshot.agent_states.agent_mira.status = "idle";
    snapshot.events.push({
      id: "evt_dialogue_test",
      type: "dialogue",
      message: "Mira → Tao: hello",
      tick: 1,
      timestamp: Date.now() / 1000,
      agent_id: "agent_mira",
      payload: { text: "hello", participants: ["agent_mira", "agent_tao"] }
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "ok", event: snapshot.events.at(-1), world: snapshot })
    });
  });

  await page.route("**/api/assets", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ asset: "agent_mira.gif", url: "/api/assets/agent_mira.gif" })
    });
  });

  await page.route("**/api/agents/agent_mira", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    agentPatches.push(body);
    const snapshot = JSON.parse(JSON.stringify(fallbackWorld));
    snapshot.agent_profiles.agent_mira = { ...snapshot.agent_profiles.agent_mira, ...body };
    snapshot.agent_states.agent_mira.target = { x: 520, y: 260 };
    snapshot.agent_states.agent_mira.status = "moving";
    snapshot.events.push({
      id: "evt_dialogue_test",
      type: "dialogue",
      message: "Mira → Tao: hello",
      tick: 1,
      timestamp: Date.now() / 1000,
      agent_id: "agent_mira",
      payload: { text: "hello", participants: ["agent_mira", "agent_tao"] }
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.route("**/api/map/items/item_lamp", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    itemPatches.push(body);
    const snapshot = JSON.parse(JSON.stringify(fallbackWorld));
    snapshot.map.items[0] = { ...snapshot.map.items[0], ...body };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto("/");

  const miraCard = page.getByTestId("panel-agents").getByRole("button", { name: /Mira/ });
  await miraCard.click();
  await expect(page.getByTestId("agent-detail-agent_mira")).toContainText("实时坐标");
  await expect(page.getByTestId("agent-detail-agent_mira")).toContainText("Tao");

  await page.getByLabel("对话距离").fill("210");
  await page.getByLabel("对话距离").blur();
  expect((agentPatches[agentPatches.length - 1]?.dialogue_policy as Record<string, unknown>).distance).toBe(210);

  const gif = Buffer.from(
    "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
    "base64"
  );
  const agentDetail = page.getByTestId("agent-detail-agent_mira");
  const movingAnimationRow = agentDetail.locator(".agent-animation-row").filter({ hasText: "moving" }).first();
  await movingAnimationRow.locator('input[accept="image/gif"]').setInputFiles({
    name: "mira.gif",
    mimeType: "image/gif",
    buffer: gif
  });
  await expect(movingAnimationRow.locator(".agent-animation-meta")).toContainText("GIF");
  await expect(page.locator(".world-agent-sprite")).toBeVisible();
  await movingAnimationRow.getByLabel("moving scale").fill("2.4");
  await movingAnimationRow.getByLabel("moving scale").blur();
  expect((((agentPatches[agentPatches.length - 1]?.animation as Record<string, unknown>).clips as Record<string, Record<string, unknown>>).moving).scale).toBe(2.4);
  const spriteBox = await page.locator(".world-agent-sprite").boundingBox();
  expect(spriteBox).not.toBeNull();
  expect(spriteBox!.width).toBeGreaterThan(60);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  await movingAnimationRow.locator('input[accept="image/png"]').setInputFiles([
    { name: "idle-01.png", mimeType: "image/png", buffer: png },
    { name: "idle-02.png", mimeType: "image/png", buffer: png }
  ]);
  await expect(movingAnimationRow.locator(".agent-animation-meta")).toContainText("PNG 2 帧");
  const latestAnimation = agentPatches[agentPatches.length - 1]?.animation as Record<string, unknown>;
  const movingClip = (latestAnimation.clips as Record<string, Record<string, unknown>>).moving;
  expect(movingClip.kind).toBe("png_sequence");
  expect((movingClip.frames as unknown[]).length).toBe(2);
  expect(movingClip.scale).toBe(2.4);

  await page.getByRole("button", { name: "停止移动" }).click();
  expect(actionRequests[actionRequests.length - 1]?.type).toBe("stop");

  await expect(page.locator('[data-testid^="world-dialogue-"]')).toBeVisible();

  await page.getByTestId("panel-scene").getByRole("button", { name: /Lamp/ }).click();
  await page.getByTestId("panel-properties").getByLabel("可移动").uncheck();
  expect(itemPatches[itemPatches.length - 1]?.movable).toBe(false);
  await expect(page.getByTestId("panel-scene").getByRole("button", { name: /Lamp/ })).toContainText("不可移动");
});

test("drawing tools create vector areas and item transform handles edit items", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const surface = page.getByTestId("workspace-surface");
  const points = await visibleMapTriangle(page);
  const point = points[0];
  const unselectedItemVisualState = await page.locator(".world-item-marker:not(.active)").first().evaluate((element) => {
    const style = getComputedStyle(element as HTMLElement);
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow
    };
  });
  expect(unselectedItemVisualState.background).toBe("rgba(0, 0, 0, 0)");
  expect(unselectedItemVisualState.borderColor).toBe("rgba(0, 0, 0, 0)");
  expect(unselectedItemVisualState.borderRadius).toBe("0px");
  expect(unselectedItemVisualState.boxShadow).toBe("none");

  await page.getByTestId("panel-tools").getByRole("button", { name: "区域绘制" }).click();
  await expect(page.getByTestId("panel-regionDraw")).not.toHaveClass(/minimized/);
  await expect(page.getByTestId("region-draw-operation").getByRole("button", { name: "增加区域" })).toHaveClass(/active/);
  await expect(page.getByTestId("region-target-grid").getByRole("button", { name: "道路" })).toHaveClass(/active/);
  await expect(page.locator('[data-testid^="world-region-layer-walkable"]')).toBeVisible();
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
  }
  await expect(page.getByTestId("world-draft-area")).toBeVisible();
  const layerCountBefore = await page.locator('[data-testid^="world-region-layer-walkable"]').count();
  await page.getByRole("button", { name: "完成区域绘制" }).click();
  await expect(page.locator('[data-testid^="world-region-layer-walkable"]')).toHaveCount(layerCountBefore + 1);
  await expect(page.getByTestId("world-draft-area")).toHaveCount(0);
  await expect(page.getByTestId("panel-regions").getByText("手绘区域", { exact: true })).toBeVisible();
  const activeRegionPath = await page.locator(".world-region-layer.active").first().getAttribute("d");
  expect(activeRegionPath).toBeTruthy();

  const subtractRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/map/regions/boolean", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    subtractRequests.push(body);
    const targetId = String((body.target_ids as string[] | undefined)?.[0] ?? "region_mock");
    const points = [
      { x: 324, y: 234 },
      { x: 414, y: 234 },
      { x: 414, y: 306 },
      { x: 324, y: 306 }
    ];
    const snapshot = JSON.parse(JSON.stringify(fallbackWorld));
    snapshot.map.regions = [
      {
        id: targetId,
        name: "手绘区域",
        points,
        holes: [],
        source: "manual",
        function: "walkable",
        image_prompt: "",
        notes: "手绘区域。",
        confidence: 1,
        tags: ["手绘"],
        hidden: false
      }
    ];
    snapshot.map.walkable_areas = [
      {
        id: `area_${targetId}`,
        name: "手绘区域",
        kind: "walkable",
        points,
        holes: [],
        metadata: { region_id: targetId, function: "walkable", source: "manual" }
      }
    ];
    snapshot.map.obstacles = [];
    snapshot.map.interaction_zones = [];
    snapshot.map.region_layers = snapshot.map.region_layers.map((layer: { function: string; label: string }) =>
      layer.function === "walkable"
        ? { ...layer, region_ids: [targetId], polygons: [{ points, holes: [] }] }
        : { ...layer, region_ids: [], polygons: [] }
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot)
    });
  });
  await page.getByTestId("region-draw-operation").getByRole("button", { name: "减少区域" }).click();
  await expect(page.getByTestId("region-draw-operation").getByRole("button", { name: "减少区域" })).toHaveClass(/active/);
  const subtractPoints = await visibleMapTriangle(page);
  for (const point of subtractPoints) {
    await page.mouse.click(point.x, point.y);
  }
  await page.getByRole("button", { name: "完成区域绘制" }).click();
  await expect(page.getByTestId("world-draft-area")).toHaveCount(0);
  await expect(page.locator(".scene-header")).toContainText("区域已扣减");
  const subtractRequestBody = subtractRequests[0];
  expect((subtractRequestBody?.target_ids as unknown[] | undefined)?.length).toBe(1);
  expect(subtractRequestBody?.target_function).toBeNull();

  await page.getByTestId("panel-tools").getByRole("button", { name: "元素" }).click();
  const itemCountBefore = await page.locator(".world-item-marker").count();
  const itemPoint = await visibleMapPoint(page);
  await page.mouse.click(itemPoint.x, itemPoint.y);
  await expect(page.locator(".world-item-marker")).toHaveCount(itemCountBefore + 1);
  await expect(page.getByTestId("item-transform-box")).toBeVisible();
  const itemVisualState = await page.locator(".world-item-marker.active").evaluate((element) => {
    const style = getComputedStyle(element as HTMLElement);
    return { background: style.backgroundColor, borderRadius: style.borderRadius };
  });
  expect(itemVisualState.background).toBe("rgba(0, 0, 0, 0)");
  expect(itemVisualState.borderRadius).toBe("0px");
  const wideImage = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#111"/><rect x="6" y="6" width="108" height="48" fill="#fff"/></svg>'
  );
  await page.getByTestId("panel-properties").locator('input[type="file"]').setInputFiles({
    name: "wide.svg",
    mimeType: "image/svg+xml",
    buffer: wideImage
  });
  const itemImage = page.locator(".world-item-marker.active img");
  await expect(itemImage).toBeVisible();
  await expect
    .poll(async () => {
      const itemImageBox = await page.locator(".world-item-marker.active").boundingBox();
      return itemImageBox ? itemImageBox.width / itemImageBox.height : 0;
    })
    .toBeGreaterThan(1.5);
  await expect(itemImage).toHaveCSS("object-fit", "contain");
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
  await page
    .getByTestId("panel-properties")
    .locator(".property-edit-row")
    .filter({ hasText: "缩放" })
    .getByRole("spinbutton")
    .fill("1.35");
  await page
    .getByTestId("panel-properties")
    .locator(".property-edit-row")
    .filter({ hasText: "缩放" })
    .getByRole("spinbutton")
    .press("Enter");
  await expect(
    page.getByTestId("panel-properties").locator(".property-edit-row").filter({ hasText: "缩放" }).getByRole("spinbutton")
  ).toHaveValue("1.35");
});

test("sam capability starts embedded MobileSAM install without service address", async ({ page }) => {
  let installed = false;
  await page.route("**/api/model-capabilities/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        capabilities: [
          {
            id: "llm",
            label: "语言模型 LLM",
            status: "missing",
            summary: "未配置 LLM",
            configured: false,
            configured_model_id: null,
            configured_model_name: null,
            local_available: false,
            installable: false,
            recommended_local: null,
            suggestions: []
          },
          {
            id: "image_generation",
            label: "图片生成",
            status: "missing",
            summary: "未配置图片生成",
            configured: false,
            configured_model_id: null,
            configured_model_name: null,
            local_available: false,
            installable: false,
            recommended_local: null,
            suggestions: []
          },
          {
            id: "segmentation",
            label: "SAM 分层",
            status: installed ? "ready" : "installable",
            summary: installed ? "已配置：内置 MobileSAM" : "可安装内置 MobileSAM，本机完成分层，无需服务地址",
            configured: installed,
            configured_model_id: installed ? "model_local_sam_embedded" : null,
            configured_model_name: installed ? "内置 MobileSAM" : null,
            local_available: false,
            installable: !installed,
            recommended_local: null,
            suggestions: ["推荐直接点击安装内置 MobileSAM；完成后无需配置服务地址。"]
          }
        ],
        environment: {}
      })
    })
  );
  await page.route("**/api/model-capabilities/segmentation/install-local", async (route) => {
    installed = true;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          id: "task_embedded_sam",
          capability: "segmentation",
          title: "安装并启用内置 MobileSAM",
          status: "running",
          stage: "download_weights",
          progress: 68,
          message: "下载 MobileSAM 权重",
          error: null
        }
      })
    });
  });
  await page.route("**/api/model-capabilities/tasks/task_embedded_sam", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          id: "task_embedded_sam",
          capability: "segmentation",
          title: "安装并启用内置 MobileSAM",
          status: "done",
          stage: "done",
          progress: 100,
          message: "内置 MobileSAM 已启用",
          error: null
        }
      })
    })
  );

  await page.goto("/");
  const modelsPanel = page.getByTestId("panel-models");
  await modelsPanel.getByTestId("model-capability-segmentation").click();
  await expect(modelsPanel.getByText("服务地址", { exact: true })).toHaveCount(0);
  const installButton = modelsPanel.getByRole("button", { name: /安装并启用内置 SAM/ });
  await expect(installButton).toBeEnabled();
  await installButton.click();
  await expect(modelsPanel.getByTestId("model-install-task-segmentation")).toContainText("正在连接本机引擎并启动安装");
  await expect(modelsPanel.getByTestId("model-install-task-segmentation")).toContainText("内置 MobileSAM 已启用", { timeout: 4000 });
});

test("llm capability starts local Ollama model install when no model is available", async ({ page }) => {
  let installed = false;
  await page.route("**/api/model-capabilities/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        capabilities: [
          {
            id: "llm",
            label: "语言模型 LLM",
            status: installed ? "ready" : "installable",
            summary: installed ? "已配置：本地 LLM - qwen2.5:7b" : "可安装并启用本地 LLM：默认下载 qwen2.5:7b",
            configured: installed,
            configured_model_id: installed ? "model_local_llm" : null,
            configured_model_name: installed ? "本地 LLM - qwen2.5:7b" : null,
            local_available: false,
            installable: !installed,
            recommended_local: null,
            device_recommendation: {
              model: "qwen2.5:7b",
              name: "推荐 7B",
              size_label: "7B",
              reason: "检测到约 32GB 内存，推荐 7B 作为质量和实时性的平衡点。",
              python_required: false
            },
            local_options: [
              {
                id: "qwen25_15b",
                name: "实时 1.5B",
                model: "qwen2.5:1.5b",
                size_label: "1.5B",
                memory_gb: 8,
                disk_gb: 1.5,
                description: "适合多 agent 实时互动",
                installed: false,
                recommended: false,
                selected_by_default: false,
                reason: "可选安装"
              },
              {
                id: "qwen25_7b",
                name: "推荐 7B",
                model: "qwen2.5:7b",
                size_label: "7B",
                memory_gb: 16,
                disk_gb: 5,
                description: "多数新机器首选",
                installed: installed,
                recommended: true,
                selected_by_default: true,
                reason: "本机推荐"
              }
            ],
            suggestions: ["点击一键安装并启用本地 LLM；默认会准备 qwen2.5:7b。", "桌面版一键安装 LLM 不要求用户电脑预装 Python。"]
          },
          {
            id: "image_generation",
            label: "图片生成",
            status: "missing",
            summary: "未配置图片生成",
            configured: false,
            configured_model_id: null,
            configured_model_name: null,
            local_available: false,
            installable: false,
            recommended_local: null,
            suggestions: []
          },
          {
            id: "segmentation",
            label: "SAM 分层",
            status: "installable",
            summary: "可安装内置 MobileSAM，本机完成分层，无需服务地址",
            configured: false,
            configured_model_id: null,
            configured_model_name: null,
            local_available: false,
            installable: true,
            recommended_local: null,
            suggestions: []
          }
        ],
        environment: {}
      })
    })
  );
  await page.route("**/api/model-capabilities/llm/install-local", async (route) => {
    installed = true;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          id: "task_local_llm",
          capability: "llm",
          title: "下载并启用本地 LLM",
          status: "running",
          stage: "pull_model",
          progress: 50,
          message: "下载 qwen2.5:7b",
          error: null
        }
      })
    });
  });
  await page.route("**/api/model-capabilities/tasks/task_local_llm", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: {
          id: "task_local_llm",
          capability: "llm",
          title: "下载并启用本地 LLM",
          status: "done",
          stage: "done",
          progress: 100,
          message: "本地 LLM 已启用：qwen2.5:7b",
          error: null
        }
      })
    })
  );

  await page.goto("/");
  const modelsPanel = page.getByTestId("panel-models");
  await expect(modelsPanel.getByTestId("local-model-list-llm")).toContainText("推荐 7B");
  await expect(modelsPanel).toContainText("不要求用户电脑预装 Python");
  const installButton = modelsPanel.getByRole("button", { name: /qwen2\.5:7b/ });
  await expect(installButton).toBeEnabled();
  await installButton.click();
  await expect(modelsPanel.getByTestId("model-install-task-llm")).toContainText("正在连接 Ollama 并准备本地 LLM");
  await expect(modelsPanel.getByTestId("model-install-task-llm")).toContainText("本地 LLM 已启用：qwen2.5:7b", { timeout: 4000 });
});

test("configured local model actions show inline confirmation", async ({ page }) => {
  await page.route("**/api/model-capabilities/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        capabilities: [
          {
            id: "llm",
            label: "语言模型 LLM",
            status: "ready",
            summary: "已配置：本地 LLM - qwen2.5:7b",
            configured: true,
            configured_model_id: "model_local_llm",
            configured_model_name: "本地 LLM - qwen2.5:7b",
            local_available: true,
            installable: false,
            recommended_local: {
              id: "model_local_llm",
              name: "本地 LLM - qwen2.5:7b",
              kind: "local",
              provider: "ollama",
              base_url: "http://127.0.0.1:11434",
              api_key: "",
              model: "qwen2.5:7b",
              enabled: true,
              capabilities: ["llm"]
            },
            suggestions: ["可以直接使用已安装的 Ollama 模型。"]
          },
          {
            id: "image_generation",
            label: "图片生成",
            status: "missing",
            summary: "未配置图片生成",
            configured: false,
            configured_model_id: null,
            configured_model_name: null,
            local_available: false,
            installable: false,
            recommended_local: null,
            suggestions: []
          },
          {
            id: "segmentation",
            label: "SAM 分层",
            status: "ready",
            summary: "已配置：内置 MobileSAM",
            configured: true,
            configured_model_id: "model_local_sam_embedded",
            configured_model_name: "内置 MobileSAM",
            local_available: true,
            installable: false,
            recommended_local: {
              id: "model_local_sam_embedded",
              name: "内置 MobileSAM",
              kind: "local",
              provider: "embedded-mobile-sam",
              base_url: "",
              api_key: "",
              model: "vit_t",
              enabled: true,
              capabilities: ["segmentation"]
            },
            suggestions: ["内置 MobileSAM 已安装，可以一键启用。"]
          }
        ],
        environment: {}
      })
    })
  );
  await page.route("**/api/model-capabilities/llm/configure-local", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [],
        capability: {
          id: "llm",
          label: "语言模型 LLM",
          status: "ready",
          summary: "已配置：本地 LLM - qwen2.5:7b",
          configured: true,
          configured_model_id: "model_local_llm",
          configured_model_name: "本地 LLM - qwen2.5:7b",
          local_available: true,
          installable: false,
          recommended_local: null,
          suggestions: []
        }
      })
    })
  );
  await page.route("**/api/model-capabilities/segmentation/configure-local", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [],
        capability: {
          id: "segmentation",
          label: "SAM 分层",
          status: "ready",
          summary: "已配置：内置 MobileSAM",
          configured: true,
          configured_model_id: "model_local_sam_embedded",
          configured_model_name: "内置 MobileSAM",
          local_available: true,
          installable: false,
          recommended_local: null,
          suggestions: []
        }
      })
    })
  );

  await page.goto("/");
  const modelsPanel = page.getByTestId("panel-models");
  await expect(modelsPanel.getByRole("button", { name: /重新启用本地 LLM/ })).toBeEnabled();
  await modelsPanel.getByRole("button", { name: /重新启用本地 LLM/ }).click();
  await expect(modelsPanel.getByTestId("model-install-task-llm")).toContainText("本地 LLM 已启用");

  await modelsPanel.getByTestId("model-capability-segmentation").click();
  await expect(modelsPanel.getByRole("button", { name: /重新启用内置 SAM/ })).toBeEnabled();
  await modelsPanel.getByRole("button", { name: /重新启用内置 SAM/ }).click();
  await expect(modelsPanel.getByTestId("model-install-task-segmentation")).toContainText("内置 MobileSAM 已启用");
});

test("map studio separates model management and runs gated SAM flow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.removeItem("agent-workstation.panel-layout.v2"));
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
  await expect(mapStudioPanel.getByTestId("map-workflow-steps")).toContainText("图层处理");
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

  await page.getByTestId("panel-scene").getByRole("button", { name: /地图/ }).first().click();
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
  await expect(page.locator('[data-testid^="world-region-layer-"]')).toHaveCount(0);

  await page.evaluate(() => window.localStorage.setItem("agent-workstation.enable-mock-sam", "1"));
  await mapStudioPanel.getByTestId("segment-map-button").click();
  await expect(page.locator('[data-testid^="world-region-layer-"]')).toHaveCount(4);
  await expect(mapStudioPanel.getByTestId("map-step-body-layers")).toBeVisible();
  await expect(page.getByTestId("panel-properties").locator(".property-heading strong")).toHaveText("区域集合");
  await expect(page.getByTestId("panel-regions").getByText("主道路", { exact: true })).toBeVisible();
  await expect(page.getByTestId("panel-scene").getByText("主道路", { exact: true })).toHaveCount(0);
  await mapStudioPanel.getByTestId("map-step-background").click();
  await expect(page.locator('[data-testid^="world-region-layer-"]')).toHaveCount(4);
  await page.getByTestId("panel-scene").getByRole("button", { name: /地图/ }).click();
  await expect(page.locator('[data-testid^="world-region-layer-"]')).toHaveCount(0);

  await mapStudioPanel.getByTestId("map-step-layers").click();
  await expect(mapStudioPanel.getByTestId("map-step-body-layers")).toBeVisible();
  await expect(page.locator('[data-testid^="world-region-layer-"]')).toHaveCount(4);
  await mapStudioPanel.getByTestId("sam-layer-list").getByRole("button").nth(1).click();
  await expect(page.locator('[data-testid^="world-region-layer-"]')).toHaveCount(1);
  await expect(page.locator(".world-region-layer.active")).toHaveCount(1);
  await expect(page.locator('[data-testid^="world-region-source-"]')).toHaveCount(1);
  await expect(mapStudioPanel.getByTestId("layer-action-controls")).toBeVisible();
  await expect(mapStudioPanel.getByLabel("图层名称")).toBeVisible();
  await expect(mapStudioPanel.getByText("自动命名先不启用")).toBeVisible();
  await mapStudioPanel.getByTestId("layer-action-controls").getByRole("button", { name: "功能分区", exact: true }).click();
  await mapStudioPanel.getByRole("button", { name: "不可穿过", exact: true }).click();
  await expect(page.getByTestId("panel-regions").getByText("不可通过").first()).toBeVisible();
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

  const point = await visibleWorkspacePoint(page, surface);
  await page.mouse.move(point.x, point.y);
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
    const canvas = element.querySelector(".scene-window-grid-canvas") as HTMLCanvasElement | null;
    return {
      density: element.getAttribute("data-grid-density"),
      panX: style.getPropertyValue("--grid-pan-x").trim(),
      panY: style.getPropertyValue("--grid-pan-y").trim(),
      gridRgb: style.getPropertyValue("--grid-rgb").trim(),
      minorSize: parseFloat(style.getPropertyValue("--grid-size-minor")),
      majorSize: parseFloat(style.getPropertyValue("--grid-size-major")),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0
    };
  });
}

async function visibleWorkspacePoint(page: import("@playwright/test").Page, surface: import("@playwright/test").Locator) {
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  const point = await page.evaluate(({ x, y, width, height }) => {
    const candidates = [
      { x: x + width * 0.18, y: y + height * 0.24 },
      { x: x + width * 0.68, y: y + height * 0.26 },
      { x: x + width * 0.72, y: y + height * 0.72 },
      { x: x + width * 0.28, y: y + height * 0.72 },
      { x: x + width * 0.5, y: y + height * 0.5 }
    ];
    return candidates.find((candidate) => {
      const element = document.elementFromPoint(candidate.x, candidate.y);
      return Boolean(element?.closest(".scene-canvas-shell")) && !element?.closest(".floating-panel");
    }) ?? candidates[0];
  }, box!);
  return point;
}

async function visibleMapPoint(page: import("@playwright/test").Page) {
  const points = await visibleMapPoints(page);
  return points[0];
}

async function visibleMapTriangle(page: import("@playwright/test").Page) {
  const points = await visibleMapPoints(page);
  expect(points.length).toBeGreaterThanOrEqual(3);
  return points.slice(0, 3);
}

async function visibleMapPoints(page: import("@playwright/test").Page) {
  const target = page.locator('[data-testid="world-map-frame"], [data-testid="world-map-background"]').first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const points = await page.evaluate(({ x, y, width, height }) => {
    const candidates = [
      { x: x + width * 0.74, y: y + height * 0.34 },
      { x: x + width * 0.86, y: y + height * 0.34 },
      { x: x + width * 0.86, y: y + height * 0.46 },
      { x: x + width * 0.74, y: y + height * 0.46 },
      { x: x + width * 0.62, y: y + height * 0.42 },
      { x: x + width * 0.68, y: y + height * 0.58 },
      { x: x + width * 0.88, y: y + height * 0.58 },
      { x: x + width * 0.35, y: y + height * 0.42 },
      { x: x + width * 0.5, y: y + height * 0.5 }
    ];
    return candidates.filter((candidate) => {
      const element = document.elementFromPoint(candidate.x, candidate.y);
      return Boolean(element?.closest('[data-testid="world-map-frame"], [data-testid="world-map-background"]')) && !element?.closest(".floating-panel");
    });
  }, box!);
  expect(points.length).toBeGreaterThan(0);
  return points;
}

async function readPanelBoxes(page: import("@playwright/test").Page) {
  const ids = ["tools", "scene", "regions", "regionDraw", "agents", "mapStudio", "models", "properties"];
  const boxes = [];
  for (const id of ids) {
    const box = await page.getByTestId(`panel-${id}`).boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box!);
  }
  return boxes;
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
