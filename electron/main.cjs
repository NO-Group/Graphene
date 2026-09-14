const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { exec } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')

const isDevelopment = !app.isPackaged
let mainWindow = null
let workspaceRoot = null

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.csv', '.go', '.graphql', '.h', '.hpp',
  '.html', '.ini', '.java', '.js', '.jsx', '.json', '.kt', '.less', '.lua',
  '.md', '.mjs', '.php', '.properties', '.py', '.rb', '.rs', '.sass', '.scss',
  '.sh', '.sql', '.svelte', '.svg', '.toml', '.ts', '.tsx', '.txt', '.vue',
  '.xml', '.yaml', '.yml',
])
const TEXT_NAMES = new Set([
  '.dockerignore', '.editorconfig', '.env.example', '.gitignore', '.npmrc',
  'Dockerfile', 'LICENSE', 'Makefile', 'README',
])
const IGNORED_DIRECTORIES = new Set([
  '.git', '.idea', '.next', '.nuxt', '.svelte-kit', '.turbo', '.venv',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'target',
])
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_FILES = 1500

function languageFor(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const languages = {
    c: 'c', cc: 'cpp', cpp: 'cpp', cs: 'csharp', css: 'css', go: 'go',
    graphql: 'graphql', h: 'cpp', hpp: 'cpp', html: 'html', ini: 'ini',
    java: 'java', js: 'javascript', jsx: 'javascript', json: 'json',
    kt: 'kotlin', less: 'less', lua: 'lua', md: 'markdown', mjs: 'javascript',
    php: 'php', py: 'python', rb: 'ruby', rs: 'rust', sass: 'scss', scss: 'scss',
    sh: 'shell', sql: 'sql', svelte: 'html', svg: 'xml', toml: 'ini',
    ts: 'typescript', tsx: 'typescript', txt: 'plaintext', vue: 'html',
    xml: 'xml', yaml: 'yaml', yml: 'yaml',
  }
  return languages[extension] || 'plaintext'
}

function assertInsideWorkspace(absolutePath) {
  const relation = path.relative(workspaceRoot, absolutePath)
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('The requested path is outside the workspace.')
}

async function resolveWritablePath(relativePath) {
  if (!workspaceRoot) throw new Error('Open a workspace before accessing files.')
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) throw new Error('Invalid file path.')
  const absolutePath = path.resolve(workspaceRoot, relativePath)
  assertInsideWorkspace(absolutePath)

  let existingParent = path.dirname(absolutePath)
  while (existingParent !== path.dirname(existingParent)) {
    try {
      const realParent = await fs.realpath(existingParent)
      assertInsideWorkspace(realParent)
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      existingParent = path.dirname(existingParent)
    }
  }

  try {
    const targetStats = await fs.lstat(absolutePath)
    if (targetStats.isSymbolicLink()) throw new Error('Writing through symbolic links is not allowed.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  return absolutePath
}

async function readWorkspace(root) {
  const files = []

  async function visit(directory) {
    if (files.length >= MAX_WORKSPACE_FILES) return
    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (files.length >= MAX_WORKSPACE_FILES) break
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) continue

      const extension = path.extname(entry.name).toLowerCase()
      if (!TEXT_EXTENSIONS.has(extension) && !TEXT_NAMES.has(entry.name)) continue

      try {
        const stats = await fs.stat(absolutePath)
        if (stats.size > MAX_FILE_BYTES) continue
        const content = await fs.readFile(absolutePath, 'utf8')
        if (content.includes('\0')) continue
        files.push({ path: relativePath, content, language: languageFor(relativePath) })
      } catch {
        // An unreadable file should not prevent the rest of the folder from opening.
      }
    }
  }

  await visit(root)
  return files
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#111311',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    autoHideMenuBar: true,
    title: 'Tungsten IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDevelopment) {
    mainWindow.loadURL(process.env.TUNGSTEN_DEV_URL || 'http://localhost:5173')
    if (process.env.TUNGSTEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('desktop:open-folder', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a folder in Tungsten',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true }

  workspaceRoot = await fs.realpath(selection.filePaths[0])
  const files = await readWorkspace(workspaceRoot)
  return {
    canceled: false,
    name: path.basename(workspaceRoot),
    path: workspaceRoot,
    files,
    truncated: files.length >= MAX_WORKSPACE_FILES,
  }
})

ipcMain.handle('desktop:write-file', async (_event, relativePath, content) => {
  if (typeof content !== 'string') throw new Error('File content must be text.')
  const absolutePath = await resolveWritablePath(relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, content, 'utf8')
  return { ok: true }
})

ipcMain.handle('desktop:run-command', async (_event, command) => {
  if (!workspaceRoot) throw new Error('Open a workspace before running commands.')
  if (typeof command !== 'string' || !command.trim() || command.length > 4000) throw new Error('Invalid command.')

  return new Promise((resolve) => {
    exec(command, {
      cwd: workspaceRoot,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      shell: process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh',
      env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
    }, (error, stdout, stderr) => {
      resolve({
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || (error?.killed ? 'Command timed out after 120 seconds.' : ''),
      })
    })
  })
})

ipcMain.handle('desktop:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only HTTP links can be opened.')
  await shell.openExternal(url)
  return { ok: true }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
