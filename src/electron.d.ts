type DesktopWorkspaceResult = {
  canceled: boolean
  name?: string
  path?: string
  files?: import('./workspace').WorkspaceFile[]
  truncated?: boolean
}

type DesktopCommandResult = {
  code: number
  stdout: string
  stderr: string
}

type GitStatusResult = {
  isRepository: boolean
  branch: string
  changes: Array<{ status: string; path: string }>
  error: string
}

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
    gitStatus: () => Promise<GitStatusResult>
    gitCommit: (message: string) => Promise<{ ok: true; output: string; status: GitStatusResult }>
    runCommand: (command: string) => Promise<DesktopCommandResult>
    openExternal: (url: string) => Promise<{ ok: true }>
  }
}
