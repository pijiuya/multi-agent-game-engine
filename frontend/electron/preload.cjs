const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engineWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximizeToggle: () => ipcRenderer.invoke("window:maximize-toggle"),
  close: () => ipcRenderer.invoke("window:close")
});

