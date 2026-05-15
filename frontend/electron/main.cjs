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
const backendExecutableName = process.platform === "win32"
  ? "agent-engine-backend.exe"
  : "agent-engine-backend";
let backendProcess = null;

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

function createWindow(startupError = "") {
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
    showStartupError(win, `界面加载失败：${description || code}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    log("renderer process gone", JSON.stringify(details));
    showStartupError(win, "渲染进程已退出，请重启主程序。");
  });
  win.on("unresponsive", () => log("window unresponsive"));

  if (startupError) {
    log("showing startup error", startupError);
    showStartupError(win, startupError);
  } else if (isDev) {
    log("loading dev renderer", process.env.ELECTRON_START_URL);
    win.loadURL(process.env.ELECTRON_START_URL).catch((error) => {
      log("loadURL failed", error.message);
      showStartupError(win, `开发界面加载失败：${error.message}`);
    });
  } else {
    log("loading renderer file", path.join(__dirname, "..", "dist", "index.html"));
    win.loadFile(path.join(__dirname, "..", "dist", "index.html")).catch((error) => {
      log("loadFile failed", error.message);
      showStartupError(win, `界面文件加载失败：${error.message}`);
    });
  }

  return win;
}

function showStartupError(win, message) {
  const escapedMessage = escapeHtml(message);
  const escapedBackend = escapeHtml(backendUrl("/healthz"));
  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
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
      background: #101820;
      color: #f5f7fb;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(680px, calc(100vw - 48px));
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 8px;
      padding: 28px;
      background: rgba(255,255,255,0.06);
      box-shadow: 0 24px 80px rgba(0,0,0,0.35);
    }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 8px 0; color: #d7dde8; line-height: 1.6; }
    code { color: #8be9fd; }
  </style>
</head>
<body>
  <main>
    <h1>主程序暂时无法显示</h1>
    <p>${escapedMessage}</p>
    <p>后端检查地址：<code>${escapedBackend}</code></p>
    <p>日志已写入应用数据目录的 <code>logs/electron-main.log</code>。</p>
  </main>
</body>
</html>`)}`,
  ).finally(() => {
    if (!win.isVisible()) {
      win.show();
    }
  });
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

  const backendReady = await ensureBackend();
  process.env.AGENT_ENGINE_HOST = backendHost;
  process.env.AGENT_ENGINE_PORT = String(backendPort);
  createWindow(backendReady ? "" : `后端未能启动或连接：${backendUrl("/healthz")}`);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
  if (process.env.AGENT_ENGINE_DISABLE_BACKEND_AUTOSTART === "1") {
    const healthy = await backendHealthy();
    log("backend autostart disabled", healthy ? "existing backend healthy" : "existing backend unavailable");
    return healthy;
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

  const root = path.resolve(__dirname, "..", "..");
  const projectDir = resolveProjectDir(root);
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
        AGENT_ENGINE_PORT: String(backendPort)
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
