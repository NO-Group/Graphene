const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { exec, execFile, spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const pty = require('@homebridge/node-pty-prebuilt-multiarch')
const { autoUpdater } = require('electron-updater')

const isDevelopment = !app.isPackaged
let mainWindow = null
let workspaceRoot = null
let terminalSequence = 0
const terminalSessions = new Map()
const languageServers = new Map()
const debugSessions = new Map()

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

class StdioJsonPeer {
  constructor(processHandle, notificationHandler) {
    this.process = processHandle
    this.notificationHandler = notificationHandler
    this.buffer = Buffer.alloc(0)
    this.sequence = 0
    this.pending = new Map()
    processHandle.stdout.on('data', (chunk) => this.consume(chunk))
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const headers = this.buffer.subarray(0, headerEnd).toString('ascii')
      const lengthMatch = headers.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(lengthMatch[1])
      const messageEnd = headerEnd + 4 + length
      if (this.buffer.length < messageEnd) return
      const payload = this.buffer.subarray(headerEnd + 4, messageEnd).toString('utf8')
      this.buffer = this.buffer.subarray(messageEnd)
      try {
        const message = JSON.parse(payload)
        if (message.id !== undefined && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id)
          this.pending.delete(message.id)
          clearTimeout(pending.timer)
          if (message.error) pending.reject(new Error(message.error.message || 'Language service request failed.'))
          else pending.resolve(message.result)
        } else {
          this.notificationHandler(message)
        }
      } catch {
        // Ignore malformed adapter output and continue parsing the stream.
      }
    }
  }

  send(message) {
    const payload = JSON.stringify(message)
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`)
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  request(method, params, timeout = 20000) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  dispose() {
    this.pending.forEach(({ reject, timer }) => { clearTimeout(timer); reject(new Error('Language service stopped.')) })
    this.pending.clear()
    this.process.kill()
  }
}

function languageServerSpec(language) {
  if (language === 'javascript' || language === 'typescript') {
    const packageRoot = path.dirname(require.resolve('typescript-language-server/package.json'))
    return {
      command: process.execPath,
      args: [path.join(packageRoot, 'lib', 'cli.mjs'), '--stdio'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  const servers = {
    python: ['pylsp'], rust: ['rust-analyzer'], go: ['gopls'],
    c: ['clangd'], cpp: ['clangd'], java: ['jdtls'],
    csharp: ['omnisharp', '--languageserver'], ruby: ['solargraph', 'stdio'],
    php: ['intelephense', '--stdio'], kotlin: ['kotlin-language-server'],
    lua: ['lua-language-server'],
  }
  const spec = servers[language]
  return spec ? { command: spec[0], args: spec.slice(1), env: {} } : null
}

async function startLanguageServer(language) {
  if (!workspaceRoot) throw new Error('Open a workspace before starting a language server.')
  const existing = languageServers.get(language)
  if (existing) return { running: true, language, capabilities: existing.capabilities }
  const spec = languageServerSpec(language)
  if (!spec) return { running: false, language, error: `No language-server adapter is configured for ${language}.` }

  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...spec.env },
    })
    let settled = false
    const peer = new StdioJsonPeer(child, (message) => {
      if (message.id !== undefined && message.method) {
        const result = message.method === 'workspace/configuration'
          ? (message.params?.items || []).map(() => null)
          : message.method === 'workspace/applyEdit'
            ? { applied: false, failureReason: 'Workspace edits require user confirmation.' }
            : null
        peer.send({ jsonrpc: '2.0', id: message.id, result })
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lsp:notification', { language, message })
    })
    const entry = { child, peer, capabilities: {} }

    child.once('error', (error) => {
      languageServers.delete(language)
      if (!settled) {
        settled = true
        resolve({ running: false, language, error: `${spec.command} is not available: ${error.message}` })
      }
    })
    child.once('spawn', async () => {
      try {
        const result = await peer.request('initialize', {
          processId: process.pid,
          rootUri: pathToFileURL(workspaceRoot).href,
          capabilities: {
            textDocument: {
              completion: { completionItem: { snippetSupport: true } },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              publishDiagnostics: { relatedInformation: true },
            },
            workspace: { workspaceFolders: true },
          },
          workspaceFolders: [{ uri: pathToFileURL(workspaceRoot).href, name: path.basename(workspaceRoot) }],
        })
        entry.capabilities = result?.capabilities || {}
        languageServers.set(language, entry)
        peer.notify('initialized', {})
        settled = true
        resolve({ running: true, language, capabilities: entry.capabilities })
      } catch (error) {
        peer.dispose()
        if (!settled) {
          settled = true
          resolve({ running: false, language, error: error.message })
        }
      }
    })
    child.once('exit', (code) => {
      languageServers.delete(language)
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lsp:status', { language, running: false, code })
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

async function detectProject() {
  if (!workspaceRoot) return { tasks: [], tests: [], frameworks: [] }
  const tasks = []
  const tests = []
  const frameworks = []
  const has = async (name) => fs.access(path.join(workspaceRoot, name)).then(() => true).catch(() => false)

  if (await has('package.json')) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf8'))
      Object.keys(manifest.scripts || {}).forEach((script) => tasks.push({ label: `npm: ${script}`, command: `npm run ${script}`, kind: script.includes('test') ? 'test' : 'task' }))
      if (manifest.scripts?.test) tests.push({ label: 'npm test', command: 'npm test' })
      frameworks.push('Node.js')
    } catch { /* Ignore an invalid package manifest. */ }
  }
  if (await has('pyproject.toml') || await has('pytest.ini') || await has('requirements.txt')) {
    frameworks.push('Python')
    tasks.push({ label: 'Python: run module', command: 'python -m main', kind: 'task' })
    tests.push({ label: 'pytest', command: 'python -m pytest', kind: 'test' })
  }
  if (await has('Cargo.toml')) {
    frameworks.push('Rust')
    tasks.push({ label: 'Cargo: build', command: 'cargo build', kind: 'build' })
    tests.push({ label: 'Cargo: test', command: 'cargo test', kind: 'test' })
  }
  if (await has('go.mod')) {
    frameworks.push('Go')
    tasks.push({ label: 'Go: build', command: 'go build ./...', kind: 'build' })
    tests.push({ label: 'Go: test', command: 'go test ./...', kind: 'test' })
  }
  if (await has('pom.xml')) {
    frameworks.push('Maven')
    tasks.push({ label: 'Maven: package', command: 'mvn package', kind: 'build' })
    tests.push({ label: 'Maven: test', command: 'mvn test', kind: 'test' })
  }
  if (await has('build.gradle') || await has('build.gradle.kts')) {
    frameworks.push('Gradle')
    tasks.push({ label: 'Gradle: build', command: process.platform === 'win32' ? 'gradlew.bat build' : './gradlew build', kind: 'build' })
    tests.push({ label: 'Gradle: test', command: process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test', kind: 'test' })
  }
  try {
    const custom = JSON.parse(await fs.readFile(path.join(workspaceRoot, '.tungsten', 'tasks.json'), 'utf8'))
    for (const task of custom.tasks || []) {
      if (typeof task.label === 'string' && typeof task.command === 'string') tasks.push({ label: task.label, command: task.command, kind: task.kind || 'task' })
    }
  } catch { /* Custom tasks are optional. */ }
  return { tasks, tests, frameworks }
}

async function scanExtensions() {
  const roots = [path.join(app.getPath('userData'), 'extensions')]
  if (workspaceRoot) roots.push(path.join(workspaceRoot, '.tungsten', 'extensions'))
  const extensions = []

  for (const root of roots) {
    let entries = []
    try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(root, entry.name, 'extension.json'), 'utf8'))
        if (typeof manifest.id !== 'string' || typeof manifest.name !== 'string') continue
        extensions.push({
          id: manifest.id,
          name: manifest.name,
          version: String(manifest.version || '0.0.0'),
          description: String(manifest.description || ''),
          publisher: String(manifest.publisher || 'Local'),
          contributes: manifest.contributes || {},
          location: path.join(root, entry.name),
        })
      } catch { /* Skip invalid extension folders. */ }
    }
  }
  return extensions
}

async function createProject(template, projectName) {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(projectName)) throw new Error('Use a simple project name without spaces or path separators.')
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Choose a parent folder', properties: ['openDirectory', 'createDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
  const root = path.join(selection.filePaths[0], projectName)
  await fs.mkdir(root, { recursive: false })

  const templates = {
    web: {
      'index.html': '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>New project</title><link rel="stylesheet" href="./src/styles.css"></head>\n<body><main id="app"></main><script type="module" src="./src/main.js"></script></body>\n</html>\n',
      'src/main.js': "document.querySelector('#app').innerHTML = '<h1>Forged with Tungsten</h1>'\n",
      'src/styles.css': ':root { font-family: system-ui; color-scheme: dark; }\nbody { margin: 0; padding: 3rem; background: #111; color: #eee; }\n',
      'package.json': JSON.stringify({ name: projectName, private: true, version: '0.1.0', scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: 'latest' } }, null, 2) + '\n',
    },
    node: {
      'src/index.js': "console.log('Forged with Tungsten')\n",
      'package.json': JSON.stringify({ name: projectName, private: true, version: '0.1.0', type: 'module', scripts: { start: 'node src/index.js', test: 'node --test' } }, null, 2) + '\n',
    },
    python: {
      'main.py': "def main():\n    print('Forged with Tungsten')\n\nif __name__ == '__main__':\n    main()\n",
      'pyproject.toml': `[project]\nname = "${projectName}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n`,
      'tests/test_main.py': 'def test_truth():\n    assert True\n',
    },
    rust: {
      'src/main.rs': 'fn main() {\n    println!("Forged with Tungsten");\n}\n',
      'Cargo.toml': `[package]\nname = "${projectName}"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\n`,
    },
    go: {
      'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Forged with Tungsten")\n}\n',
      'go.mod': `module ${projectName}\n\ngo 1.24\n`,
    },
  }
  const selectedTemplate = templates[template]
  if (!selectedTemplate) throw new Error('Unknown project template.')
  for (const [relativePath, content] of Object.entries(selectedTemplate)) {
    const target = path.join(root, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }
  await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\ndist/\ntarget/\n.venv/\n.env\n', 'utf8')
  workspaceRoot = await fs.realpath(root)
  await rememberWorkspace()
  return workspacePayload()
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
ipcMain.handle('desktop:absolute-path', (_event, relativePath) => resolveWorkspacePath(relativePath))

ipcMain.handle('desktop:git-status', () => gitStatus())

ipcMain.handle('desktop:git-commit', async (_event, message) => {
  if (typeof message !== 'string' || !message.trim() || message.length > 500) throw new Error('Enter a valid commit message.')
  await runFile('git', ['add', '--all'])
  const result = await runFile('git', ['commit', '-m', message.trim()])
  return { ok: true, output: `${result.stdout}${result.stderr}`.trim(), status: await gitStatus() }
})

ipcMain.handle('desktop:git-diff', async (_event, relativePath, staged = false) => {
  resolveWorkspacePath(relativePath)
  const args = ['diff']
  if (staged) args.push('--cached')
  args.push('--', relativePath)
  const result = await runFile('git', args)
  return { diff: result.stdout || 'No textual differences.' }
})

ipcMain.handle('desktop:git-stage', async (_event, relativePath, staged) => {
  resolveWorkspacePath(relativePath)
  if (staged) await runFile('git', ['add', '--', relativePath])
  else await runFile('git', ['restore', '--staged', '--', relativePath])
  return gitStatus()
})

ipcMain.handle('desktop:git-branches', async () => {
  const { stdout } = await runFile('git', ['branch', '--format=%(refname:short)'])
  return stdout.split(/\r?\n/).filter(Boolean)
})

ipcMain.handle('desktop:git-checkout', async (_event, branch) => {
  if (typeof branch !== 'string' || !/^[\w./-]{1,200}$/.test(branch)) throw new Error('Invalid branch name.')
  await runFile('git', ['checkout', branch])
  return gitStatus()
})

ipcMain.handle('terminal:create', (_event, columns = 80, rows = 24) => {
  const id = `terminal-${++terminalSequence}`
  const shellPath = process.platform === 'win32'
    ? process.env.COMSPEC || 'powershell.exe'
    : process.env.SHELL || '/bin/bash'
  const shellArgs = process.platform === 'win32' ? [] : ['-l']
  const session = pty.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: Math.max(20, Math.min(400, Number(columns) || 80)),
    rows: Math.max(5, Math.min(200, Number(rows) || 24)),
    cwd: workspaceRoot || app.getPath('home'),
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TUNGSTEN_IDE: '1' },
  })
  terminalSessions.set(id, session)
  session.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:data', { id, data })
  })
  session.onExit(({ exitCode }) => {
    terminalSessions.delete(id)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:exit', { id, code: exitCode })
  })
  return { id }
})

ipcMain.handle('terminal:write', (_event, id, data) => {
  if (typeof data !== 'string' || data.length > 65536) throw new Error('Invalid terminal input.')
  const session = terminalSessions.get(id)
  if (!session) throw new Error('Terminal session not found.')
  session.write(data)
  return { ok: true }
})

ipcMain.handle('terminal:resize', (_event, id, columns, rows) => {
  const session = terminalSessions.get(id)
  if (session) session.resize(Math.max(20, Math.min(400, Number(columns) || 80)), Math.max(5, Math.min(200, Number(rows) || 24)))
  return { ok: true }
})

ipcMain.handle('terminal:kill', (_event, id) => {
  const session = terminalSessions.get(id)
  if (session) session.kill()
  terminalSessions.delete(id)
  return { ok: true }
})

ipcMain.handle('lsp:file-uri', (_event, relativePath) => pathToFileURL(resolveWorkspacePath(relativePath)).href)
ipcMain.handle('lsp:start', (_event, language) => startLanguageServer(language))
ipcMain.handle('lsp:request', async (_event, language, method, params) => {
  if (typeof method !== 'string' || !/^[\w$/]+$/.test(method)) throw new Error('Invalid language service method.')
  const server = languageServers.get(language)
  if (!server) throw new Error(`The ${language} language server is not running.`)
  return server.peer.request(method, params)
})
ipcMain.handle('lsp:notify', (_event, language, method, params) => {
  const server = languageServers.get(language)
  if (!server) return { ok: false }
  server.peer.notify(method, params)
  return { ok: true }
})
ipcMain.handle('lsp:stop', (_event, language) => {
  const server = languageServers.get(language)
  if (server) server.peer.dispose()
  languageServers.delete(language)
  return { ok: true }
})

function expandDebugVariables(value) {
  if (typeof value === 'string') return value.replaceAll('${workspaceFolder}', workspaceRoot || '')
  if (Array.isArray(value)) return value.map(expandDebugVariables)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandDebugVariables(item)]))
  return value
}

ipcMain.handle('debug:start', async (_event, configuration) => {
  if (!workspaceRoot) throw new Error('Open a workspace before debugging.')
  const adapter = configuration?.adapter
  if (!adapter || typeof adapter.command !== 'string' || !adapter.command) throw new Error('The launch configuration needs an adapter command.')
  const id = `debug-${Date.now()}`
  const child = spawn(adapter.command, Array.isArray(adapter.args) ? adapter.args : [], {
    cwd: workspaceRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...(adapter.env || {}) },
  })
  let session
  const peer = new StdioJsonPeer(child, (message) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug:message', { id, message })
    if (message.type === 'response' && message.command === 'initialize' && message.success !== false) {
      peer.send({ type: 'request', seq: ++session.sequence, command: configuration.request || 'launch', arguments: expandDebugVariables(configuration.arguments || {}) })
    }
  })
  session = { child, peer, sequence: 0 }
  debugSessions.set(id, session)
  child.stderr.on('data', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug:output', { id, output: data.toString() })
  })
  child.on('exit', (code) => {
    debugSessions.delete(id)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug:exit', { id, code })
  })
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    return { id }
  } catch (error) {
    debugSessions.delete(id)
    peer.dispose()
    throw error
  }
})

ipcMain.handle('debug:send', (_event, id, message) => {
  const session = debugSessions.get(id)
  if (!session) throw new Error('Debug session not found.')
  session.peer.send({ ...message, seq: ++session.sequence })
  return { ok: true }
})

ipcMain.handle('debug:stop', (_event, id) => {
  const session = debugSessions.get(id)
  if (session) session.peer.dispose()
  debugSessions.delete(id)
  return { ok: true }
})

ipcMain.handle('project:detect', () => detectProject())
ipcMain.handle('project:create', (_event, template, name) => createProject(template, name))

ipcMain.handle('extensions:scan', () => scanExtensions())
ipcMain.handle('extensions:install-folder', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Install a Tungsten extension', properties: ['openDirectory'] })
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true, extensions: await scanExtensions() }
  const source = selection.filePaths[0]
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'extension.json'), 'utf8'))
  if (typeof manifest.id !== 'string' || !/^[a-z0-9._-]+$/i.test(manifest.id)) throw new Error('The extension has an invalid id.')
  const destinationRoot = path.join(app.getPath('userData'), 'extensions')
  const destination = path.join(destinationRoot, manifest.id)
  await fs.mkdir(destinationRoot, { recursive: true })
  await fs.rm(destination, { recursive: true, force: true })
  await fs.cp(source, destination, { recursive: true })
  return { canceled: false, extensions: await scanExtensions() }
})

ipcMain.handle('recovery:save', async (_event, snapshot) => {
  const serialized = JSON.stringify(snapshot)
  if (serialized.length > 10 * 1024 * 1024) throw new Error('Recovery snapshot is too large.')
  await fs.writeFile(path.join(app.getPath('userData'), 'recovery.json'), serialized, 'utf8')
  return { ok: true }
})
ipcMain.handle('recovery:load', async () => {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'recovery.json'), 'utf8')) } catch { return null }
})
ipcMain.handle('recovery:clear', async () => {
  await fs.rm(path.join(app.getPath('userData'), 'recovery.json'), { force: true })
  return { ok: true }
})

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { available: false, message: 'Updates are checked in packaged builds.' }
  const result = await autoUpdater.checkForUpdates()
  return { available: Boolean(result?.updateInfo), info: result?.updateInfo || null }
})
ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())
ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall())

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

for (const event of ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error']) {
  autoUpdater.on(event, (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:status', { event, payload: payload instanceof Error ? { message: payload.message } : payload })
  })
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

app.whenReady().then(() => {
  createWindow()
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => undefined), 5000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  terminalSessions.forEach((session) => session.kill())
  languageServers.forEach((server) => server.peer.dispose())
  debugSessions.forEach((session) => session.peer.dispose())
  terminalSessions.clear()
  languageServers.clear()
  debugSessions.clear()
  if (process.platform !== 'darwin') app.quit()
})
