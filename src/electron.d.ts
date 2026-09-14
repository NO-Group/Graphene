type DesktopWorkspaceResult = {
  canceled: boolean
  name?: string
  path?: string
  files?: import('./workspace').WorkspaceFile[]
  truncated?: boolean
}

type DesktopCommandResult = { code: number; stdout: string; stderr: string }
type GitStatusResult = {
  isRepository: boolean
  branch: string
  changes: Array<{ status: string; path: string }>
  error: string
}
type ProjectTask = { label: string; command: string; kind?: string }
type ProjectInfo = { tasks: ProjectTask[]; tests: ProjectTask[]; frameworks: string[] }
type ExtensionManifest = {
  id: string
  name: string
  version: string
  description: string
  publisher: string
  contributes: Record<string, unknown>
  location: string
}
type Unsubscribe = () => void

interface Window {
  tungsten?: {
    isDesktop: true
    platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32'
    versions: Readonly<{ electron: string; chromium: string; node: string }>

    openFolder: () => Promise<DesktopWorkspaceResult>
    restoreWorkspace: () => Promise<DesktopWorkspaceResult>
    refreshWorkspace: () => Promise<DesktopWorkspaceResult>
    writeFile: (path: string, content: string) => Promise<{ ok: true }>
    renamePath: (source: string, destination: string) => Promise<{ ok: true }>
    deletePath: (path: string) => Promise<{ ok: true }>
    revealPath: (path: string) => Promise<{ ok: true }>
    absolutePath: (path: string) => Promise<string>
    openExternal: (url: string) => Promise<{ ok: true }>

    gitStatus: () => Promise<GitStatusResult>
    gitCommit: (message: string) => Promise<{ ok: true; output: string; status: GitStatusResult }>
    gitDiff: (path: string, staged?: boolean) => Promise<{ diff: string }>
    gitStage: (path: string, staged: boolean) => Promise<GitStatusResult>
    gitBranches: () => Promise<string[]>
    gitCheckout: (branch: string) => Promise<GitStatusResult>

    createTerminal: (columns: number, rows: number) => Promise<{ id: string }>
    writeTerminal: (id: string, data: string) => Promise<{ ok: true }>
    resizeTerminal: (id: string, columns: number, rows: number) => Promise<{ ok: true }>
    killTerminal: (id: string) => Promise<{ ok: true }>
    onTerminalData: (callback: (payload: { id: string; data: string }) => void) => Unsubscribe
    onTerminalExit: (callback: (payload: { id: string; code: number }) => void) => Unsubscribe

    fileUri: (path: string) => Promise<string>
    startLanguageServer: (language: string) => Promise<{ running: boolean; language: string; capabilities?: Record<string, unknown>; error?: string }>
    languageRequest: (language: string, method: string, params: unknown) => Promise<any>
    languageNotify: (language: string, method: string, params: unknown) => Promise<{ ok: boolean }>
    stopLanguageServer: (language: string) => Promise<{ ok: true }>
    onLanguageNotification: (callback: (payload: { language: string; message: any }) => void) => Unsubscribe
    onLanguageStatus: (callback: (payload: { language: string; running: boolean; code?: number }) => void) => Unsubscribe

    startDebug: (configuration: Record<string, any>) => Promise<{ id: string }>
    sendDebug: (id: string, message: Record<string, any>) => Promise<{ ok: true }>
    stopDebug: (id: string) => Promise<{ ok: true }>
    onDebugMessage: (callback: (payload: { id: string; message: any }) => void) => Unsubscribe
    onDebugOutput: (callback: (payload: { id: string; output: string }) => void) => Unsubscribe
    onDebugExit: (callback: (payload: { id: string; code: number }) => void) => Unsubscribe

    detectProject: () => Promise<ProjectInfo>
    createProject: (template: string, name: string) => Promise<DesktopWorkspaceResult>
    scanExtensions: () => Promise<ExtensionManifest[]>
    installExtensionFolder: () => Promise<{ canceled: boolean; extensions: ExtensionManifest[] }>

    saveRecovery: (snapshot: unknown) => Promise<{ ok: true }>
    loadRecovery: () => Promise<any>
    clearRecovery: () => Promise<{ ok: true }>

    checkForUpdates: () => Promise<{ available: boolean; message?: string; info?: unknown }>
    downloadUpdate: () => Promise<unknown>
    installUpdate: () => Promise<unknown>
    onUpdaterStatus: (callback: (payload: { event: string; payload: any }) => void) => Unsubscribe

    runCommand: (command: string) => Promise<DesktopCommandResult>
  }
}
