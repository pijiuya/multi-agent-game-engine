const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engineWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximizeToggle: () => ipcRenderer.invoke("window:maximize-toggle"),
  close: () => ipcRenderer.invoke("window:close")
});

contextBridge.exposeInMainWorld("engineRuntime", {
  apiBase: `http://${process.env.AGENT_ENGINE_HOST || "127.0.0.1"}:${process.env.AGENT_ENGINE_PORT || "8000"}`
});
