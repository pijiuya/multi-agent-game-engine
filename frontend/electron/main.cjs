const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_START_URL);
const backendHost = process.env.AGENT_ENGINE_HOST || "127.0.0.1";
const backendPort = Number(process.env.AGENT_ENGINE_PORT || "8000");
const backendHealthUrl = `http://${backendHost}:${backendPort}/healthz`;
let backendProcess = null;

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
    resizable: true,
    hasShadow: true,
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

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  return win;
}

app.whenReady().then(async () => {
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

  await ensureBackend();
  createWindow();

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
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});

async function ensureBackend() {
  if (process.env.AGENT_ENGINE_DISABLE_BACKEND_AUTOSTART === "1") {
    return;
  }
  if (await backendHealthy()) {
    return;
  }

  const root = path.resolve(__dirname, "..", "..");
  const pythonCandidates = process.platform === "win32"
    ? [
        { command: "py", args: ["-3.11"] },
        { command: "python", args: [] }
      ]
    : [
        { command: "python3", args: [] },
        { command: "python", args: [] }
      ];

  for (const candidate of pythonCandidates) {
    try {
      backendProcess = spawn(
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
        {
          cwd: root,
          env: {
            ...process.env,
            PYTHONUTF8: "1",
            AGENT_ENGINE_PROJECT_DIR: process.env.AGENT_ENGINE_PROJECT_DIR || path.join(root, "runtime_project")
          },
          stdio: "ignore",
          windowsHide: true
        }
      );
      backendProcess.on("error", () => {
        backendProcess = null;
      });
      backendProcess.on("exit", () => {
        backendProcess = null;
      });
      backendProcess.unref();
      if (await waitForBackend()) {
        return;
      }
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill();
      }
    } catch {
      backendProcess = null;
    }
  }
}

function backendHealthy() {
  return new Promise((resolve) => {
    const request = http.get(backendHealthUrl, { timeout: 700 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForBackend() {
  for (let index = 0; index < 40; index += 1) {
    if (!backendProcess) {
      return false;
    }
    if (await backendHealthy()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
