import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
const rendererEntry = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const configuredEditor = readFileSync(new URL('./components/ConfiguredEditor.tsx', import.meta.url), 'utf8')

describe('desktop bridge contract', () => {
  it('registers every renderer-invoked IPC channel in the main process', () => {
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1])
    const handled = new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]))
    expect(invoked.filter((channel) => !handled.has(channel))).toEqual([])
    expect(invoked.length).toBeGreaterThan(35)
  })

  it('keeps privileged APIs behind the context-isolated preload', () => {
    expect(preload).toContain("contextBridge.exposeInMainWorld('tungsten'")
    expect(preload).not.toMatch(/require\(['"](?:node:)?(?:fs|child_process|net|ssh2)['"]\)/)
    expect(main).toContain('sandbox: true')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('nodeIntegration: false')
  })

  it('ships isolated extension, remote, and collaboration services', () => {
    expect(main).toContain("fork(path.join(__dirname, 'extension-host.cjs')")
    expect(main).toContain("ipcMain.handle('remote:ssh-connect'")
    expect(main).toContain("ipcMain.handle('collaboration:host'")
    expect(main).toContain("ipcMain.handle('workspace:search'")
  })

  it('ships multi-root, hunk staging, and structured test contracts', () => {
    expect(main).toContain("ipcMain.handle('desktop:add-workspace-folder'")
    expect(main).toContain("ipcMain.handle('desktop:git-stage-hunk'")
    expect(main).toContain("ipcMain.handle('project:run-test'")
    expect(main).toContain('workspace/didChangeWorkspaceFolders')
  })

  it('loads Monaco and its tested workers outside the renderer entry chunk', () => {
    expect(rendererEntry).not.toContain("from 'monaco-editor'")
    expect(configuredEditor).toContain("from 'monaco-editor'")
    expect(configuredEditor).toContain('editor.worker.js?worker')
    expect(configuredEditor).toContain('typescript/ts.worker.js?worker')
  })
})
