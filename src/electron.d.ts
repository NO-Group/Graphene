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

interface Window {
  tungsten?: {
    isDesktop: true
    platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32'
    versions: Readonly<{ electron: string; chromium: string; node: string }>
    openFolder: () => Promise<DesktopWorkspaceResult>
    writeFile: (path: string, content: string) => Promise<{ ok: true }>
    runCommand: (command: string) => Promise<DesktopCommandResult>
    openExternal: (url: string) => Promise<{ ok: true }>
  }
}
