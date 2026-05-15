const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_START_URL);
const backendHost = process.env.AGENT_ENGINE_HOST || "127.0.0.1";
const requestedBackendPort = process.env.AGENT_ENGINE_PORT;
let backendPort = Number(requestedBackendPort || "8000");
const requestedNarrativePort = process.env.AGENT_ENGINE_NARRATIVE_PORT;
let narrativePort = Number(requestedNarrativePort || "8011");
const backendExecutableName = process.platform === "win32"
  ? "agent-engine-backend.exe"
  : "agent-engine-backend";
let backendProcess = null;
let narrativeProcess = null;
let backendEnsureInFlight = null;

app.setName("Multi-Agent Engine");

function log(message, detail) {
  const line = `[${new Date().toISOString()}] ${message}${detail ? ` ${detail}` : ""}`;
  if (!app.isPackaged) {
    console.log(line);
  }
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "electron-main.log"), `${line}\n`, "utf8");
  } catch {
    // Logging must never stop the desktop shell from opening.
  }
}

function backendUrl(pathname) {
  return `http://${backendHost}:${backendPort}${pathname}`;
}

function narrativeUrl(pathname) {
  return `http://${backendHost}:${narrativePort}${pathname}`;
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.max(1100, Math.floor(workArea.width * 0.88));
  const height = Math.max(720, Math.floor(workArea.height * 0.86));

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 640,
    center: true,
    frame: false,
    transparent: true,
    show: false,
    resizable: true,
    hasShadow: false,
    title: "Multi-Agent Engine",
    backgroundColor: "#00000000",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once("ready-to-show", () => {
    log("window ready-to-show");
    win.show();
  });
  win.webContents.on("did-fail-load", (_event, code, description, validatedURL) => {
    log("renderer did-fail-load", `${code} ${description} ${validatedURL}`);
    if (code === -3 || win.__enginePage === "startup" || String(validatedURL).includes("/startup/index.html")) {
      return;
    }
    showStartupPage(win, {
      title: "界面正在重新加载",
      message: "工作台界面刚才没有成功显示，程序会自动重试。",
      detail: description || String(code),
      variant: "warning"
    });
    scheduleRendererRetry(win);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    log("renderer process gone", JSON.stringify(details));
    showStartupPage(win, {
      title: "界面正在恢复",
      message: "工作台界面进程已退出，程序正在重新加载主界面。",
      detail: details.reason || "renderer exited",
      variant: "warning"
    });
    scheduleRendererRetry(win, 1600);
  });
  win.on("unresponsive", () => log("window unresponsive"));

  showStartupPage(win, {
    title: "正在启动工作台",
    message: "正在连接本机引擎，准备好后会自动进入主界面。",
    detail: backendUrl("/healthz")
  });

  return win;
}

function startupPagePath() {
  const dir = path.join(app.getPath("userData"), "startup");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "index.html");
}

function showStartupPage(win, options = {}) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const title = options.title || "正在启动工作台";
  const message = options.message || "正在连接本机引擎，准备好后会自动进入主界面。";
  const detail = options.detail || backendUrl("/healthz");
  const variant = options.variant || "info";
  const escapedTitle = escapeHtml(title);
  const escapedMessage = escapeHtml(message);
  const escapedDetail = escapeHtml(detail);
  const escapedBackend = escapeHtml(backendUrl("/healthz"));
  const escapedLogPath = escapeHtml(path.join(app.getPath("userData"), "logs", "electron-main.log"));
  const accent = variant === "warning" ? "#f0b429" : "#74c0fc";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Multi-Agent Engine</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, #111820, #17212b);
      color: #f5f7fb;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(680px, calc(100vw - 48px));
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 8px;
      padding: 30px;
      background: rgba(255,255,255,0.06);
      box-shadow: 0 24px 80px rgba(0,0,0,0.35);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      color: ${accent};
      font-size: 13px;
      font-weight: 600;
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.18);
      border-top-color: ${accent};
      border-radius: 50%;
      animation: spin 900ms linear infinite;
    }
    h1 { margin: 0 0 12px; font-size: 22px; letter-spacing: 0; }
    p { margin: 8px 0; color: #d7dde8; line-height: 1.6; }
    .detail {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.12);
      font-size: 13px;
      color: #aeb8c8;
    }
    code {
      color: #9bd7ff;
      word-break: break-all;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <main>
    <div class="status"><span class="spinner"></span><span>Electron</span></div>
    <h1>${escapedTitle}</h1>
    <p>${escapedMessage}</p>
    <p class="detail">当前状态：<code>${escapedDetail}</code></p>
    <p class="detail">本机引擎：<code>${escapedBackend}</code><br>日志：<code>${escapedLogPath}</code></p>
  </main>
</body>
</html>`;
  const filePath = startupPagePath();
  try {
    fs.writeFileSync(filePath, html, "utf8");
  } catch (error) {
    log("write startup page failed", error instanceof Error ? error.message : String(error));
  }
  win.__enginePage = "startup";
  win.loadFile(filePath).catch((error) => {
    log("startup page loadFile failed", error.message);
  }).finally(() => {
    if (!win.isVisible()) {
      win.show();
    }
  });
}

function loadRenderer(win) {
  if (!win || win.isDestroyed()) {
    return Promise.resolve(false);
  }
  clearWindowTimer(win, "__engineRendererRetryTimer");
  win.__enginePage = "renderer";
  const loaded = isDev
    ? (log("loading dev renderer", process.env.ELECTRON_START_URL), win.loadURL(process.env.ELECTRON_START_URL))
    : (log("loading renderer file", path.join(__dirname, "..", "dist", "index.html")), win.loadFile(path.join(__dirname, "..", "dist", "index.html")));

  return loaded.then(() => true).catch((error) => {
    log(isDev ? "loadURL failed" : "loadFile failed", error.message);
    showStartupPage(win, {
      title: "界面正在重新加载",
      message: "工作台界面暂时没有加载成功，程序会继续自动重试。",
      detail: error.message,
      variant: "warning"
    });
    scheduleRendererRetry(win);
    return false;
  });
}

function scheduleRendererRetry(win, delayMs = 2500) {
  if (!win || win.isDestroyed()) {
    return;
  }
  clearWindowTimer(win, "__engineRendererRetryTimer");
  win.__engineRendererRetryTimer = setTimeout(async () => {
    if (win.isDestroyed()) {
      return;
    }
    if (await backendHealthy()) {
      process.env.AGENT_ENGINE_HOST = backendHost;
      process.env.AGENT_ENGINE_PORT = String(backendPort);
      await loadRenderer(win);
      return;
    }
    showStartupPage(win, {
      title: "正在等待本机引擎",
      message: "本机引擎还没有准备好，主界面会在连接恢复后自动打开。",
      detail: backendUrl("/healthz"),
      variant: "warning"
    });
    scheduleBackendRetry(win);
  }, delayMs);
}

function clearWindowTimer(win, property) {
  if (win && win[property]) {
    clearTimeout(win[property]);
    win[property] = null;
  }
}

async function bootstrapWindow(win) {
  const backendReady = await ensureBackendOnce();
  process.env.AGENT_ENGINE_HOST = backendHost;
  process.env.AGENT_ENGINE_PORT = String(backendPort);
  process.env.AGENT_ENGINE_NARRATIVE_HOST = backendHost;
  process.env.AGENT_ENGINE_NARRATIVE_PORT = String(narrativePort);
  process.env.AGENT_ENGINE_NARRATIVE_URL = narrativeUrl("");
  if (!win || win.isDestroyed()) {
    return;
  }
  if (backendReady) {
    await loadRenderer(win);
    return;
  }
  log("backend unavailable; waiting with recovery page", backendUrl("/healthz"));
  showStartupPage(win, {
    title: "正在等待本机引擎",
    message: "本机引擎暂时没有连接成功，程序会继续重试，不需要手动重启主程序。",
    detail: backendUrl("/healthz"),
    variant: "warning"
  });
  scheduleBackendRetry(win);
}

function scheduleBackendRetry(win, delayMs = 5000) {
  if (!win || win.isDestroyed()) {
    return;
  }
  clearWindowTimer(win, "__engineBackendRetryTimer");
  win.__engineBackendRetryTimer = setTimeout(async () => {
    if (win.isDestroyed()) {
      return;
    }
    const backendReady = await ensureBackendOnce();
    process.env.AGENT_ENGINE_HOST = backendHost;
    process.env.AGENT_ENGINE_PORT = String(backendPort);
    if (backendReady) {
      log("backend recovered; loading renderer", backendUrl("/healthz"));
      await loadRenderer(win);
      return;
    }
    showStartupPage(win, {
      title: "正在等待本机引擎",
      message: "还没有连接到本机引擎，程序正在继续重试。",
      detail: backendUrl("/healthz"),
      variant: "warning"
    });
    scheduleBackendRetry(win);
  }, delayMs);
}

function ensureBackendOnce() {
  if (!backendEnsureInFlight) {
    backendEnsureInFlight = ensureBackend().finally(() => {
      backendEnsureInFlight = null;
    });
  }
  return backendEnsureInFlight;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

app.whenReady().then(async () => {
  log("app ready");
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:maximize-toggle", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  process.env.AGENT_ENGINE_HOST = backendHost;
  process.env.AGENT_ENGINE_PORT = String(backendPort);
  const win = createWindow();
  bootstrapWindow(win).catch((error) => {
    log("bootstrap window failed", error instanceof Error ? error.stack || error.message : String(error));
    showStartupPage(win, {
      title: "正在等待本机引擎",
      message: "启动流程遇到问题，程序会继续等待本机引擎恢复。",
      detail: error instanceof Error ? error.message : String(error),
      variant: "warning"
    });
    scheduleBackendRetry(win);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const activatedWindow = createWindow();
      bootstrapWindow(activatedWindow).catch((error) => {
        log("activate bootstrap failed", error instanceof Error ? error.stack || error.message : String(error));
        showStartupPage(activatedWindow, {
          title: "正在等待本机引擎",
          message: "启动流程遇到问题，程序会继续等待本机引擎恢复。",
          detail: error instanceof Error ? error.message : String(error),
          variant: "warning"
        });
        scheduleBackendRetry(activatedWindow);
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  log("before quit");
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  if (narrativeProcess && !narrativeProcess.killed) {
    narrativeProcess.kill();
  }
});

app.on("render-process-gone", (_event, webContents, details) => {
  log("app render-process-gone", JSON.stringify({ id: webContents.id, details }));
});

process.on("uncaughtException", (error) => {
  log("uncaught exception", error.stack || error.message);
});

process.on("unhandledRejection", (reason) => {
  log("unhandled rejection", reason instanceof Error ? reason.stack || reason.message : String(reason));
});

async function ensureBackend() {
  const root = path.resolve(__dirname, "..", "..");
  const projectDir = resolveProjectDir(root);
  if (process.env.AGENT_ENGINE_DISABLE_BACKEND_AUTOSTART === "1") {
    const healthy = await backendHealthy();
    log("backend autostart disabled", healthy ? "existing backend healthy" : "existing backend unavailable");
    return healthy;
  }

  process.env.AGENT_ENGINE_NARRATIVE_HOST = backendHost;
  process.env.AGENT_ENGINE_NARRATIVE_PORT = String(narrativePort);
  process.env.AGENT_ENGINE_NARRATIVE_URL = narrativeUrl("");
  if (narrativeAutostartEnabled()) {
    if (!requestedNarrativePort) {
      const availableNarrativePort = await findAvailableBackendPort(narrativePort);
      if (availableNarrativePort && availableNarrativePort !== narrativePort) {
        log("selected alternate narrative port", `${narrativePort} -> ${availableNarrativePort}`);
        narrativePort = availableNarrativePort;
      }
    }
    process.env.AGENT_ENGINE_NARRATIVE_PORT = String(narrativePort);
    process.env.AGENT_ENGINE_NARRATIVE_URL = narrativeUrl("");
    await ensureNarrativeService(root, projectDir);
  } else {
    process.env.AGENT_ENGINE_DISABLE_NARRATIVE_AUTOSTART = "1";
    log("narrative service autostart disabled by default", "set AGENT_ENGINE_ENABLE_NARRATIVE_AUTOSTART=1 to enable");
  }

  const healthy = await backendHealthy();
  if (healthy) {
    if (!(await backendSupportsLocalLlmInstall())) {
      log("backend healthy but capability probe was inconclusive; reusing existing backend");
    }
    log("reusing healthy backend", backendUrl("/healthz"));
    return true;
  }

  if (!requestedBackendPort) {
    const availablePort = await findAvailableBackendPort(backendPort);
    if (availablePort && availablePort !== backendPort) {
      log("selected alternate backend port", `${backendPort} -> ${availablePort}`);
      backendPort = availablePort;
    }
  }

  const packagedBackend = resolvePackagedBackendPath();
  if (packagedBackend) {
    if (await startBackendProcess(packagedBackend, [], path.dirname(packagedBackend), projectDir)) {
      return true;
    }
  }
  if (app.isPackaged) {
    log("packaged backend not found or failed to start");
    return false;
  }

  const venvPython = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  const pythonCandidates = process.platform === "win32"
    ? [
        ...(fs.existsSync(venvPython) ? [{ command: venvPython, args: [] }] : []),
        { command: "py", args: ["-3.11"] },
        { command: "python", args: [] }
      ]
    : [
        ...(fs.existsSync(venvPython) ? [{ command: venvPython, args: [] }] : []),
        { command: "python3", args: [] },
        { command: "python", args: [] }
      ];

  for (const candidate of pythonCandidates) {
    const started = await startBackendProcess(
      candidate.command,
      [
        ...candidate.args,
        "-m",
        "uvicorn",
        "agent_engine.api.main:app",
        "--app-dir",
        "backend",
        "--host",
        backendHost,
        "--port",
        String(backendPort)
      ],
      root,
      projectDir
    );
    if (started) {
      return true;
    }
  }
  log("no backend candidate started successfully");
  return false;
}

function resolveProjectDir(root) {
  if (process.env.AGENT_ENGINE_PROJECT_DIR) {
    return process.env.AGENT_ENGINE_PROJECT_DIR;
  }
  if (app.isPackaged) {
    return ensurePackagedRuntimeProject();
  }
  return path.join(root, "runtime_project");
}

function ensurePackagedRuntimeProject() {
  const userProjectDir = path.join(app.getPath("userData"), "runtime_project");
  if (fs.existsSync(path.join(userProjectDir, "world.sqlite"))) {
    return userProjectDir;
  }

  const seedProjectDir = path.join(process.resourcesPath, "runtime_project");
  try {
    fs.mkdirSync(path.dirname(userProjectDir), { recursive: true });
    if (fs.existsSync(seedProjectDir)) {
      fs.cpSync(seedProjectDir, userProjectDir, {
        recursive: true,
        errorOnExist: false,
        force: false
      });
      log("seeded packaged runtime project", userProjectDir);
    } else {
      fs.mkdirSync(userProjectDir, { recursive: true });
      log("packaged runtime seed missing; created empty project dir", userProjectDir);
    }
  } catch (error) {
    log("failed to seed packaged runtime project", error instanceof Error ? error.message : String(error));
    fs.mkdirSync(userProjectDir, { recursive: true });
  }
  return userProjectDir;
}

function resolvePackagedBackendPath() {
  if (process.env.AGENT_ENGINE_BACKEND_PATH) {
    return process.env.AGENT_ENGINE_BACKEND_PATH;
  }
  if (!app.isPackaged) {
    return null;
  }
  const candidate = path.join(process.resourcesPath, "backend", backendExecutableName);
  return fs.existsSync(candidate) ? candidate : null;
}

async function ensureNarrativeService(root, projectDir) {
  if (process.env.AGENT_ENGINE_DISABLE_NARRATIVE_AUTOSTART === "1") {
    log("narrative autostart disabled", narrativeUrl("/healthz"));
    return await narrativeHealthy();
  }
  if (await narrativeHealthy()) {
    log("reusing healthy narrative service", narrativeUrl("/healthz"));
    return true;
  }
  const packagedBackend = resolvePackagedBackendPath();
  if (packagedBackend) {
    if (await startNarrativeProcess(packagedBackend, [], path.dirname(packagedBackend), projectDir)) {
      return true;
    }
  }
  if (app.isPackaged) {
    log("packaged narrative service failed to start");
    return false;
  }
  const venvPython = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  const pythonCandidates = process.platform === "win32"
    ? [
        ...(fs.existsSync(venvPython) ? [{ command: venvPython, args: [] }] : []),
        { command: "py", args: ["-3.11"] },
        { command: "python", args: [] }
      ]
    : [
        ...(fs.existsSync(venvPython) ? [{ command: venvPython, args: [] }] : []),
        { command: "python3", args: [] },
        { command: "python", args: [] }
      ];
  for (const candidate of pythonCandidates) {
    const started = await startNarrativeProcess(
      candidate.command,
      [
        ...candidate.args,
        "-m",
        "uvicorn",
        "agent_engine.narrative_service:app",
        "--app-dir",
        "backend",
        "--host",
        backendHost,
        "--port",
        String(narrativePort)
      ],
      root,
      projectDir
    );
    if (started) {
      return true;
    }
  }
  log("no narrative service candidate started successfully");
  return false;
}

function narrativeAutostartEnabled() {
  return process.env.AGENT_ENGINE_ENABLE_NARRATIVE_AUTOSTART === "1";
}

async function startNarrativeProcess(command, args, cwd, projectDir) {
  try {
    const stdio = app.isPackaged ? narrativeLogStdio() : "ignore";
    log("starting narrative service", `${command} ${args.join(" ")}`);
    narrativeProcess = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        AGENT_ENGINE_PROJECT_DIR: projectDir,
        AGENT_ENGINE_HOST: backendHost,
        AGENT_ENGINE_PORT: String(narrativePort),
        AGENT_ENGINE_NARRATIVE_HOST: backendHost,
        AGENT_ENGINE_NARRATIVE_PORT: String(narrativePort),
        AGENT_ENGINE_UVICORN_APP: "agent_engine.narrative_service:app"
      },
      stdio,
      windowsHide: true
    });
    narrativeProcess.on("error", (error) => {
      log("narrative process error", error.message);
      narrativeProcess = null;
    });
    narrativeProcess.on("exit", (code, signal) => {
      log("narrative process exit", `code=${code} signal=${signal}`);
      narrativeProcess = null;
    });
    narrativeProcess.unref();
    if (await waitForNarrativeService()) {
      log("narrative service ready", narrativeUrl("/healthz"));
      return true;
    }
    if (narrativeProcess && !narrativeProcess.killed) {
      log("narrative service did not become healthy; killing candidate");
      narrativeProcess.kill();
    }
  } catch (error) {
    log("start narrative service threw", error instanceof Error ? error.message : String(error));
    narrativeProcess = null;
  }
  return false;
}

async function startBackendProcess(command, args, cwd, projectDir) {
  try {
    const stdio = app.isPackaged ? backendLogStdio() : "ignore";
    log("starting backend", `${command} ${args.join(" ")}`);
    backendProcess = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        AGENT_ENGINE_PROJECT_DIR: projectDir,
        AGENT_ENGINE_HOST: backendHost,
        AGENT_ENGINE_PORT: String(backendPort),
        AGENT_ENGINE_NARRATIVE_HOST: backendHost,
        AGENT_ENGINE_NARRATIVE_PORT: String(narrativePort),
        AGENT_ENGINE_NARRATIVE_URL: narrativeUrl("")
      },
      stdio,
      windowsHide: true
    });
    backendProcess.on("error", (error) => {
      log("backend process error", error.message);
      backendProcess = null;
    });
    backendProcess.on("exit", (code, signal) => {
      log("backend process exit", `code=${code} signal=${signal}`);
      backendProcess = null;
    });
    backendProcess.unref();
    if (await waitForBackend()) {
      log("backend ready", backendUrl("/healthz"));
      return true;
    }
    if (backendProcess && !backendProcess.killed) {
      log("backend did not become healthy; killing candidate");
      backendProcess.kill();
    }
  } catch (error) {
    log("start backend threw", error instanceof Error ? error.message : String(error));
    backendProcess = null;
  }
  return false;
}

function backendLogStdio() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  return [
    "ignore",
    fs.openSync(path.join(logDir, "backend.out.log"), "a"),
    fs.openSync(path.join(logDir, "backend.err.log"), "a")
  ];
}

function narrativeLogStdio() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  return [
    "ignore",
    fs.openSync(path.join(logDir, "narrative.out.log"), "a"),
    fs.openSync(path.join(logDir, "narrative.err.log"), "a")
  ];
}

function backendHealthy() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const request = http.get(backendUrl("/healthz"), { timeout: 2500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 8192) {
          request.destroy();
          finish(false);
        }
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          finish(false);
          return;
        }
        try {
          const payload = JSON.parse(body);
          finish(payload.ok === true);
        } catch {
          finish(false);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      finish(false);
    });
    request.on("error", () => finish(false));
  });
}

function narrativeHealthy() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const request = http.get(narrativeUrl("/healthz"), { timeout: 2000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 8192) {
          request.destroy();
          finish(false);
        }
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          finish(false);
          return;
        }
        try {
          const payload = JSON.parse(body);
          finish(payload.ok === true);
        } catch {
          finish(false);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      finish(false);
    });
    request.on("error", () => finish(false));
  });
}

function backendSupportsLocalLlmInstall() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const request = http.get(backendUrl("/api/model-capabilities/status"), { timeout: 3000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 65536) {
          request.destroy();
          finish(false);
        }
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          finish(false);
          return;
        }
        try {
          const payload = JSON.parse(body);
          const llm = Array.isArray(payload.capabilities)
            ? payload.capabilities.find((item) => item && item.id === "llm")
            : null;
          finish(Boolean(llm && (llm.installable === true || llm.local_available === true || llm.configured === true)));
        } catch {
          finish(false);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      finish(false);
    });
    request.on("error", () => finish(false));
  });
}

async function findAvailableBackendPort(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await portAvailable(port)) {
      return port;
    }
  }
  return null;
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, backendHost);
  });
}

async function waitForBackend() {
  const maxAttempts = app.isPackaged ? 240 : 40;
  const intervalMs = app.isPackaged ? 500 : 250;
  for (let index = 0; index < maxAttempts; index += 1) {
    if (!backendProcess) {
      return false;
    }
    if (await backendHealthy()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function waitForNarrativeService() {
  const maxAttempts = app.isPackaged ? 120 : 30;
  const intervalMs = app.isPackaged ? 500 : 250;
  for (let index = 0; index < maxAttempts; index += 1) {
    if (!narrativeProcess) {
      return false;
    }
    if (await narrativeHealthy()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
