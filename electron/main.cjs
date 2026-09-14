const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { exec, execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')

const isDevelopment = !app.isPackaged
let mainWindow = null
let workspaceRoot = null

const TEXT_EXTENSIONS = new Set([
  '.asm', '.astro', '.bat', '.c', '.cc', '.clj', '.cljs', '.cmake', '.coffee',
  '.conf', '.cpp', '.cs', '.css', '.csv', '.dart', '.diff', '.dockerfile', '.ex',
  '.exs', '.fs', '.fsx', '.go', '.graphql', '.gql', '.groovy', '.h', '.handlebars',
  '.hbs', '.hpp', '.hs', '.html', '.ini', '.ipynb', '.java', '.jl', '.js', '.jsx',
  '.json', '.jsonc', '.kt', '.kts', '.less', '.lua', '.m', '.md', '.mdx', '.mjs',
  '.mm', '.pas', '.php', '.pl', '.pm', '.properties', '.proto', '.ps1', '.pug',
  '.py', '.r', '.razor', '.rb', '.rs', '.sass', '.scala', '.scss', '.sh', '.sol',
  '.sql', '.svelte', '.svg', '.swift', '.tf', '.tfvars', '.toml', '.ts', '.tsx',
  '.txt', '.vue', '.xml', '.yaml', '.yml', '.zig',
])
const TEXT_NAMES = new Set([
  '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore', '.npmrc',
  'CMakeLists.txt', 'Containerfile', 'Dockerfile', 'Gemfile', 'LICENSE', 'Makefile',
  'Procfile', 'README', 'Rakefile',
])
const IGNORED_DIRECTORIES = new Set([
  '.git', '.gradle', '.idea', '.next', '.nuxt', '.svelte-kit', '.turbo', '.venv',
  'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'vendor',
])
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_FILES = 4000

function languageFor(filePath) {
  const filename = path.basename(filePath)
  if (filename === 'Dockerfile' || filename === 'Containerfile') return 'dockerfile'
  if (filename === 'CMakeLists.txt' || path.extname(filename) === '.cmake') return 'plaintext'
  if (filename.startsWith('.env') || filename === '.gitignore') return 'plaintext'

  const extension = path.extname(filePath).slice(1).toLowerCase()
  const languages = {
    asm: 'plaintext', astro: 'html', bat: 'bat', c: 'c', cc: 'cpp', clj: 'clojure',
    cljs: 'clojure', coffee: 'coffeescript', conf: 'ini', cpp: 'cpp', cs: 'csharp',
    css: 'css', dart: 'dart', diff: 'plaintext', ex: 'elixir', exs: 'elixir', fs: 'fsharp',
    fsx: 'fsharp', go: 'go', gql: 'graphql', graphql: 'graphql', groovy: 'plaintext',
    h: 'cpp', handlebars: 'handlebars', hbs: 'handlebars', hpp: 'cpp', hs: 'plaintext',
    html: 'html', ini: 'ini', ipynb: 'json', java: 'java', jl: 'julia', js: 'javascript',
    jsx: 'javascript', json: 'json', jsonc: 'json', kt: 'kotlin', kts: 'kotlin', less: 'less',
    lua: 'lua', m: 'objective-c', md: 'markdown', mdx: 'mdx', mjs: 'javascript',
    mm: 'objective-c', pas: 'pascal', php: 'php', pl: 'perl', pm: 'perl',
    properties: 'ini', proto: 'protobuf', ps1: 'powershell', pug: 'pug', py: 'python',
    r: 'r', razor: 'razor', rb: 'ruby', rs: 'rust', sass: 'scss', scala: 'scala',
    scss: 'scss', sh: 'shell', sol: 'solidity', sql: 'sql', svelte: 'html', svg: 'xml',
    swift: 'swift', tf: 'hcl', tfvars: 'hcl', toml: 'ini', ts: 'typescript',
    tsx: 'typescript', txt: 'plaintext', vue: 'html', xml: 'xml', yaml: 'yaml',
    yml: 'yaml', zig: 'plaintext',
  }
  return languages[extension] || 'plaintext'
}

function assertInsideWorkspace(absolutePath) {
  const relation = path.relative(workspaceRoot, absolutePath)
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('The requested path is outside the workspace.')
}

function resolveWorkspacePath(relativePath) {
  if (!workspaceRoot) throw new Error('Open a workspace before accessing files.')
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) throw new Error('Invalid file path.')
  const absolutePath = path.resolve(workspaceRoot, relativePath)
  assertInsideWorkspace(absolutePath)
  return absolutePath
}

async function resolveWritablePath(relativePath) {
  const absolutePath = resolveWorkspacePath(relativePath)
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
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
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
      const isEnvironmentFile = entry.name === '.env' || entry.name.startsWith('.env.')
      if (!TEXT_EXTENSIONS.has(extension) && !TEXT_NAMES.has(entry.name) && !isEnvironmentFile) continue

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

async function workspacePayload() {
  if (!workspaceRoot) return { canceled: true }
  const files = await readWorkspace(workspaceRoot)
  return {
    canceled: false,
    name: path.basename(workspaceRoot),
    path: workspaceRoot,
    files,
    truncated: files.length >= MAX_WORKSPACE_FILES,
  }
}

function recentWorkspacePath() {
  return path.join(app.getPath('userData'), 'recent-workspace.json')
}

async function rememberWorkspace() {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(recentWorkspacePath(), JSON.stringify({ path: workspaceRoot }), 'utf8')
}

async function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: workspaceRoot,
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout || ''
        error.stderr = stderr || ''
        reject(error)
        return
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

async function gitStatus() {
  if (!workspaceRoot) return { isRepository: false, branch: '', changes: [], error: 'Open a folder first.' }
  try {
    const { stdout } = await runFile('git', ['status', '--porcelain=v1', '--branch'])
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    const heading = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : 'HEAD'
    const branch = heading.split('...')[0].split(' ')[0]
    const changes = lines.map((line) => ({
      status: line.slice(0, 2).trim() || 'M',
      path: line.slice(3).replace(/^"|"$/g, ''),
    }))
    return { isRepository: true, branch, changes, error: '' }
  } catch (error) {
    return { isRepository: false, branch: '', changes: [], error: error.stderr?.trim() || 'This folder is not a Git repository.' }
  }
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
  await rememberWorkspace()
  return workspacePayload()
})

ipcMain.handle('desktop:restore-workspace', async () => {
  try {
    const recent = JSON.parse(await fs.readFile(recentWorkspacePath(), 'utf8'))
    workspaceRoot = await fs.realpath(recent.path)
    return workspacePayload()
  } catch {
    workspaceRoot = null
    return { canceled: true }
  }
})

ipcMain.handle('desktop:refresh-workspace', () => workspacePayload())

ipcMain.handle('desktop:write-file', async (_event, relativePath, content) => {
  if (typeof content !== 'string') throw new Error('File content must be text.')
  const absolutePath = await resolveWritablePath(relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, content, 'utf8')
  return { ok: true }
})

ipcMain.handle('desktop:rename-path', async (_event, sourcePath, destinationPath) => {
  const source = resolveWorkspacePath(sourcePath)
  const destination = await resolveWritablePath(destinationPath)
  const sourceStats = await fs.lstat(source)
  if (sourceStats.isSymbolicLink()) throw new Error('Renaming symbolic links is not allowed.')
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.rename(source, destination)
  return { ok: true }
})

ipcMain.handle('desktop:delete-path', async (_event, relativePath) => {
  const absolutePath = resolveWorkspacePath(relativePath)
  const stats = await fs.lstat(absolutePath)
  if (!stats.isFile()) throw new Error('Only files can be deleted from the explorer.')
  await fs.unlink(absolutePath)
  return { ok: true }
})

ipcMain.handle('desktop:reveal-path', async (_event, relativePath) => {
  shell.showItemInFolder(resolveWorkspacePath(relativePath))
  return { ok: true }
})

ipcMain.handle('desktop:git-status', () => gitStatus())

ipcMain.handle('desktop:git-commit', async (_event, message) => {
  if (typeof message !== 'string' || !message.trim() || message.length > 500) throw new Error('Enter a valid commit message.')
  await runFile('git', ['add', '--all'])
  const result = await runFile('git', ['commit', '-m', message.trim()])
  return { ok: true, output: `${result.stdout}${result.stderr}`.trim(), status: await gitStatus() }
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
