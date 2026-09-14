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
  restoreWorkspace: () => ipcRenderer.invoke('desktop:restore-workspace'),
  refreshWorkspace: () => ipcRenderer.invoke('desktop:refresh-workspace'),
  writeFile: (path, content) => ipcRenderer.invoke('desktop:write-file', path, content),
  renamePath: (source, destination) => ipcRenderer.invoke('desktop:rename-path', source, destination),
  deletePath: (path) => ipcRenderer.invoke('desktop:delete-path', path),
  revealPath: (path) => ipcRenderer.invoke('desktop:reveal-path', path),
  gitStatus: () => ipcRenderer.invoke('desktop:git-status'),
  gitCommit: (message) => ipcRenderer.invoke('desktop:git-commit', message),
  runCommand: (command) => ipcRenderer.invoke('desktop:run-command', command),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
})
