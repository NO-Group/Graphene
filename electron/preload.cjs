const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

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
  absolutePath: (path) => ipcRenderer.invoke('desktop:absolute-path', path),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),

  gitStatus: () => ipcRenderer.invoke('desktop:git-status'),
  gitCommit: (message) => ipcRenderer.invoke('desktop:git-commit', message),
  gitDiff: (path, staged = false) => ipcRenderer.invoke('desktop:git-diff', path, staged),
  gitStage: (path, staged) => ipcRenderer.invoke('desktop:git-stage', path, staged),
  gitBranches: () => ipcRenderer.invoke('desktop:git-branches'),
  gitCheckout: (branch) => ipcRenderer.invoke('desktop:git-checkout', branch),

  createTerminal: (columns, rows) => ipcRenderer.invoke('terminal:create', columns, rows),
  writeTerminal: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeTerminal: (id, columns, rows) => ipcRenderer.invoke('terminal:resize', id, columns, rows),
  killTerminal: (id) => ipcRenderer.invoke('terminal:kill', id),
  onTerminalData: (callback) => subscribe('terminal:data', callback),
  onTerminalExit: (callback) => subscribe('terminal:exit', callback),

  fileUri: (path) => ipcRenderer.invoke('lsp:file-uri', path),
  startLanguageServer: (language) => ipcRenderer.invoke('lsp:start', language),
  languageRequest: (language, method, params) => ipcRenderer.invoke('lsp:request', language, method, params),
  languageNotify: (language, method, params) => ipcRenderer.invoke('lsp:notify', language, method, params),
  stopLanguageServer: (language) => ipcRenderer.invoke('lsp:stop', language),
  onLanguageNotification: (callback) => subscribe('lsp:notification', callback),
  onLanguageStatus: (callback) => subscribe('lsp:status', callback),

  startDebug: (configuration) => ipcRenderer.invoke('debug:start', configuration),
  sendDebug: (id, message) => ipcRenderer.invoke('debug:send', id, message),
  stopDebug: (id) => ipcRenderer.invoke('debug:stop', id),
  onDebugMessage: (callback) => subscribe('debug:message', callback),
  onDebugOutput: (callback) => subscribe('debug:output', callback),
  onDebugExit: (callback) => subscribe('debug:exit', callback),

  detectProject: () => ipcRenderer.invoke('project:detect'),
  createProject: (template, name) => ipcRenderer.invoke('project:create', template, name),
  scanExtensions: () => ipcRenderer.invoke('extensions:scan'),
  installExtensionFolder: () => ipcRenderer.invoke('extensions:install-folder'),

  saveRecovery: (snapshot) => ipcRenderer.invoke('recovery:save', snapshot),
  loadRecovery: () => ipcRenderer.invoke('recovery:load'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),

  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback) => subscribe('updater:status', callback),

  runCommand: (command) => ipcRenderer.invoke('desktop:run-command', command),
})
