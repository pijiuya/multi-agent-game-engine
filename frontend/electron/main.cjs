const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_START_URL);

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

app.whenReady().then(() => {
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

