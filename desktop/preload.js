/* Preload: the only bridge between the sandboxed page and the main process.
   contextIsolation is on, so the page sees exactly this object and nothing more. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("graphene", {
  isDesktop: true,
  /* main -> renderer: menu commands and files chosen in a native dialog */
  onCommand: cb => ipcRenderer.on("graphene:command", (_e, cmd) => cb(cmd)),
  onOpenProject: cb => ipcRenderer.on("graphene:open-project", (_e, text) => cb(text)),
  /* renderer -> main: write a file through a native save dialog */
  saveFile: (data, defaultName, encoding) =>
    ipcRenderer.invoke("graphene:save-file", { data, defaultName, encoding }),
});
