/* Preload: the only bridge between the sandboxed page and the main process.
   contextIsolation is on, so the page sees exactly this object and nothing more. */
const { contextBridge, ipcRenderer } = require("electron");

/* The main process passes the real version as an --app-version= switch, so the
   renderer never needs node access to display it. */
const VERSION = (process.argv.find(a => a.startsWith("--app-version=")) || "").split("=")[1] || "";

contextBridge.exposeInMainWorld("graphene", {
  isDesktop: true,
  version: VERSION,
  /* main -> renderer: menu commands and files chosen in a native dialog */
  onCommand: cb => ipcRenderer.on("graphene:command", (_e, cmd) => cb(cmd)),
  onOpenProject: cb => ipcRenderer.on("graphene:open-project", (_e, text) => cb(text)),
  /* renderer -> main: write a file through a native save dialog */
  saveFile: (data, defaultName, encoding) =>
    ipcRenderer.invoke("graphene:save-file", { data, defaultName, encoding }),
});
