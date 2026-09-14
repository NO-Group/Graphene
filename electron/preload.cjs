const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tungsten', {
  isDesktop: true,
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  }),
  openFolder: () => ipcRenderer.invoke('desktop:open-folder'),
  writeFile: (path, content) => ipcRenderer.invoke('desktop:write-file', path, content),
  runCommand: (command) => ipcRenderer.invoke('desktop:run-command', command),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
})
