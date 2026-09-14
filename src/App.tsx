import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import {
  Bell,
  Blocks,
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CircleAlert,
  CircleCheck,
  CircleUserRound,
  Columns2,
  Command,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  File,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Hammer,
  Maximize2,
  Menu,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SquareCode,
  SplitSquareHorizontal,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { defaultFiles, fileIconClass, fileName, symbolsFor, type WorkspaceFile } from './workspace'
import './styles.css'

type Activity = 'explorer' | 'search' | 'source' | 'extensions'
type PaletteMode = 'commands' | 'files'
type SettingsState = {
  fontSize: number
  wordWrap: boolean
  minimap: boolean
  autosave: boolean
}

type TreeNode = {
  name: string
  path: string
  folder: boolean
  children: TreeNode[]
}

const WORKSPACE_KEY = 'tungsten.workspace.v1'
const SETTINGS_KEY = 'tungsten.settings.v1'
const PREVIEW_PATH = '$preview'

const defaultSettings: SettingsState = {
  fontSize: 13,
  wordWrap: false,
  minimap: true,
  autosave: false,
}

function loadFiles() {
  try {
    const stored = localStorage.getItem(WORKSPACE_KEY)
    if (stored) return JSON.parse(stored) as WorkspaceFile[]
  } catch {
    // Fall back to the factory workspace.
  }
  return defaultFiles
}

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return defaultSettings
  }
}

function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeNode[] = []

  files.forEach((file) => {
    const parts = file.path.split('/')
    let children = root
    let current = ''

    parts.forEach((part, index) => {
      current = current ? `${current}/${part}` : part
      const isFolder = index < parts.length - 1
      let node = children.find((item) => item.name === part && item.folder === isFolder)
      if (!node) {
        node = { name: part, path: current, folder: isFolder, children: [] }
        children.push(node)
      }
      children = node.children
    })
  })

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name))
    nodes.forEach((node) => sort(node.children))
  }
  sort(root)
  return root
}

function FileGlyph({ path }: { path: string }) {
  const kind = fileIconClass(path)
  const labels: Record<string, string> = {
    js: 'JS', ts: 'TS', css: '#', html: '<>', json: '{}', md: 'M↓', npm: '⬡', file: '·',
  }
  return <span className={`file-glyph ${kind}`}>{labels[kind]}</span>
}

function TipButton({
  label,
  children,
  className = '',
  onClick,
  active = false,
  disabled = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function ExplorerTree({
  files,
  activePath,
  openFile,
  dirty,
}: {
  files: WorkspaceFile[]
  activePath: string
  openFile: (path: string) => void
  dirty: Set<string>
}) {
  const [expanded, setExpanded] = useState(() => new Set(['src', 'src/utils']))
  const tree = useMemo(() => buildTree(files), [files])

  const renderNode = (node: TreeNode, depth = 0) => {
    if (node.folder) {
      const isOpen = expanded.has(node.path)
      return (
        <div key={node.path}>
          <button
            className="tree-row folder-row"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (isOpen) next.delete(node.path)
              else next.add(node.path)
              return next
            })}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {isOpen ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />}
            <span>{node.name}</span>
          </button>
          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    return (
      <button
        key={node.path}
        className={`tree-row file-row ${activePath === node.path ? 'selected' : ''}`}
        style={{ paddingLeft: 26 + depth * 14 }}
        onClick={() => openFile(node.path)}
      >
        <FileGlyph path={node.path} />
        <span className="tree-label">{node.name}</span>
        {dirty.has(node.path) && <span className="dirty-dot" />}
      </button>
    )
  }

  return <div className="file-tree">{tree.map((node) => renderNode(node))}</div>
}

function Preview({ html, onReload }: { html: string; onReload: () => void }) {
  const [key, setKey] = useState(0)
  return (
    <section className="preview-shell">
      <div className="preview-toolbar">
        <div className="preview-controls">
          <button aria-label="Reload preview" title="Reload preview" onClick={() => { setKey((value) => value + 1); onReload() }}>
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="preview-address">
          <ShieldCheck size={13} />
          <span>tungsten://preview/forge</span>
        </div>
        <button className="preview-external" title="Open preview in a new tab" onClick={() => {
          const blob = new Blob([html], { type: 'text/html' })
          window.open(URL.createObjectURL(blob), '_blank')
        }}><ExternalLink size={13} /></button>
      </div>
      <iframe key={key} title="Project preview" sandbox="allow-scripts" srcDoc={html} />
    </section>
  )
}

const activityItems = [
  { id: 'explorer' as const, label: 'Explorer', icon: Files },
  { id: 'search' as const, label: 'Search', icon: Search },
  { id: 'source' as const, label: 'Source Control', icon: GitBranch },
  { id: 'extensions' as const, label: 'Extensions', icon: Blocks },
]

export default function App() {
  const [files, setFiles] = useState<WorkspaceFile[]>(loadFiles)
  const [openTabs, setOpenTabs] = useState(['README.md', 'index.html', 'src/main.js'])
  const [activePath, setActivePath] = useState('src/main.js')
  const [activity, setActivity] = useState<Activity>('explorer')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(248)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelHeight, setPanelHeight] = useState(225)
  const [panelTab, setPanelTab] = useState('TERMINAL')
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({ open: false, mode: 'commands' })
  const [paletteQuery, setPaletteQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<SettingsState>(loadSettings)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<Array<{ text: string; kind?: string }>>([
    { text: 'Tungsten Shell 0.1.0  ·  web sandbox', kind: 'muted' },
    { text: 'Workspace restored in 184ms. Type “help” for available commands.', kind: 'success' },
  ])
  const [terminalInput, setTerminalInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const terminalEndRef = useRef<HTMLDivElement>(null)
  const terminalInputRef = useRef<HTMLInputElement>(null)
  const paletteInputRef = useRef<HTMLInputElement>(null)
  const newFileInputRef = useRef<HTMLInputElement>(null)

  const activeFile = files.find((file) => file.path === activePath)
  const symbols = useMemo(() => symbolsFor(activeFile), [activeFile])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }, [])

  const save = useCallback((path?: string) => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(files))
    if (path) {
      setDirty((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
      notify(`${fileName(path)} saved`)
    } else {
      setDirty(new Set())
      notify('All files saved')
    }
  }, [files, notify])

  const openFile = useCallback((path: string) => {
    setOpenTabs((tabs) => tabs.includes(path) ? tabs : [...tabs, path])
    setActivePath(path)
  }, [])

  const closeTab = (path: string) => {
    const index = openTabs.indexOf(path)
    const nextTabs = openTabs.filter((tab) => tab !== path)
    setOpenTabs(nextTabs)
    if (activePath === path) {
      setActivePath(nextTabs[Math.min(index, nextTabs.length - 1)] || '')
    }
  }

  const updateFile = (value?: string) => {
    if (!activeFile || value === undefined) return
    setFiles((current) => current.map((file) => file.path === activePath ? { ...file, content: value } : file))
    setDirty((current) => new Set(current).add(activePath))
  }

  const buildPreview = useCallback(() => {
    const get = (path: string) => files.find((file) => file.path === path)?.content ?? ''
    const styles = get('src/styles.css')
    const utils = get('src/utils/time.js').replace(/\bexport\s+/g, '')
    const script = get('src/main.js').replace(/^import\s+.*$/gm, '')
    return get('index.html')
      .replace(/<link[^>]+href=["']\/src\/styles\.css["'][^>]*>/, `<style>${styles}</style>`)
      .replace(/<script[^>]+src=["']\/src\/main\.js["'][^>]*><\/script>/, `<script type="module">${utils}\n${script.replace(/<\/script/gi, '<\\/script')}</script>`)
  }, [files])

  const runProject = useCallback(() => {
    if (!openTabs.includes(PREVIEW_PATH)) setOpenTabs((tabs) => [...tabs, PREVIEW_PATH])
    setActivePath(PREVIEW_PATH)
    notify('Preview rebuilt successfully')
    setTerminalLines((lines) => [
      ...lines,
      { text: '$ npm run dev', kind: 'command' },
      { text: 'VITE ready in 287 ms  →  tungsten://preview/forge', kind: 'success' },
    ])
  }, [notify, openTabs])

  const createFile = () => {
    const path = newFileName.trim().replace(/^\//, '')
    if (!path) return
    if (files.some((file) => file.path === path)) {
      notify('A file with that path already exists')
      return
    }
    const ext = path.split('.').pop() || ''
    const languages: Record<string, string> = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', css: 'css', html: 'html', json: 'json', md: 'markdown',
    }
    setFiles((current) => [...current, { path, content: '', language: languages[ext] || 'plaintext' }])
    setDirty((current) => new Set(current).add(path))
    openFile(path)
    setNewFileName('')
    setNewFileOpen(false)
    notify(`${fileName(path)} created`)
  }

  const resetWorkspace = useCallback(() => {
    setFiles(defaultFiles)
    setOpenTabs(['README.md', 'index.html', 'src/main.js'])
    setActivePath('src/main.js')
    setDirty(new Set())
    localStorage.removeItem(WORKSPACE_KEY)
    notify('Workspace restored to defaults')
  }, [notify])

  const runTerminalCommand = (raw: string) => {
    const command = raw.trim()
    if (!command) return
    setHistory((current) => [...current, command])
    setHistoryIndex(-1)
    const base: Array<{ text: string; kind?: string }> = [{ text: `tungsten@forge ~/forge $ ${command}`, kind: 'command' }]
    const [name, ...args] = command.split(/\s+/)

    if (name === 'clear') {
      setTerminalLines([])
      return
    }
    if (name === 'help') {
      base.push({ text: 'Available: help, clear, ls, pwd, cat, echo, date, whoami, git status, npm run dev, npm run build', kind: 'muted' })
    } else if (name === 'pwd') {
      base.push({ text: '/workspace/forge' })
    } else if (name === 'whoami') {
      base.push({ text: 'tungsten' })
    } else if (name === 'date') {
      base.push({ text: new Date().toString() })
    } else if (name === 'echo') {
      base.push({ text: args.join(' ') })
    } else if (name === 'ls') {
      const target = args[0]?.replace(/\/$/, '') || ''
      const entries = new Set<string>()
      files.filter((file) => !target || file.path.startsWith(`${target}/`)).forEach((file) => {
        const relative = target ? file.path.slice(target.length + 1) : file.path
        entries.add(relative.split('/')[0] + (relative.includes('/') ? '/' : ''))
      })
      base.push({ text: [...entries].join('   ') || `ls: ${target}: No such directory` })
    } else if (name === 'cat') {
      const file = files.find((item) => item.path === args[0])
      base.push({ text: file?.content || `cat: ${args[0] || ''}: No such file`, kind: file ? undefined : 'error' })
    } else if (command === 'git status') {
      base.push({ text: `On branch main\n${dirty.size ? `Changes not staged for commit:\n  ${[...dirty].map((path) => `modified: ${path}`).join('\n  ')}` : 'nothing to commit, working tree clean'}`, kind: dirty.size ? 'warning' : 'success' })
    } else if (command === 'npm run dev') {
      base.push({ text: 'VITE ready in 287 ms\n  Local: tungsten://preview/forge\n  press Ctrl+Enter to open', kind: 'success' })
    } else if (command === 'npm run build') {
      base.push({ text: '✓ 8 modules transformed.\n✓ built in 412ms  dist/index.html  7.21 kB', kind: 'success' })
    } else {
      base.push({ text: `${name}: command not found`, kind: 'error' })
    }
    setTerminalLines((lines) => [...lines, ...base])
  }

  const commands = useMemo(() => [
    { label: 'File: New File', detail: 'Create a file in the workspace', icon: File, keys: ['⌘', 'N'], action: () => setNewFileOpen(true) },
    { label: 'File: Save Active File', detail: activePath && activePath !== PREVIEW_PATH ? fileName(activePath) : 'No editable file active', icon: Check, keys: ['⌘', 'S'], action: () => activePath && save(activePath) },
    { label: 'File: Save All', detail: `${dirty.size} unsaved change${dirty.size === 1 ? '' : 's'}`, icon: Copy, action: () => save() },
    { label: 'Run: Open Live Preview', detail: 'Build and run the current workspace', icon: Play, keys: ['⌃', '↵'], action: runProject },
    { label: 'View: Toggle Primary Side Bar', detail: sidebarVisible ? 'Hide the explorer' : 'Show the explorer', icon: PanelLeftClose, keys: ['⌘', 'B'], action: () => setSidebarVisible((value) => !value) },
    { label: 'View: Toggle Panel', detail: panelOpen ? 'Hide the bottom panel' : 'Show the bottom panel', icon: PanelBottomOpen, keys: ['⌘', 'J'], action: () => setPanelOpen((value) => !value) },
    { label: 'Preferences: Open Settings', detail: 'Editor and workspace preferences', icon: Settings, keys: ['⌘', ','], action: () => setSettingsOpen(true) },
    { label: 'Workspace: Reset Starter', detail: 'Restore all starter files', icon: RotateCcw, action: resetWorkspace },
  ], [activePath, dirty.size, panelOpen, resetWorkspace, runProject, save, sidebarVisible])

  const paletteItems = palette.mode === 'files'
    ? files.filter((file) => file.path.toLowerCase().includes(paletteQuery.toLowerCase())).map((file) => ({
        label: fileName(file.path), detail: file.path, icon: FileCode2, action: () => openFile(file.path), keys: [] as string[],
      }))
    : commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(paletteQuery.toLowerCase()))

  const executePaletteItem = (action: () => void) => {
    action()
    setPalette({ ...palette, open: false })
    setPaletteQuery('')
  }

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    if (!settings.autosave || !dirty.size) return
    const timer = window.setTimeout(() => save(), 900)
    return () => window.clearTimeout(timer)
  }, [dirty, files, save, settings.autosave])

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [terminalLines])

  useEffect(() => {
    if (palette.open) window.setTimeout(() => paletteInputRef.current?.focus(), 20)
  }, [palette.open])

  useEffect(() => {
    if (newFileOpen) window.setTimeout(() => newFileInputRef.current?.focus(), 20)
  }, [newFileOpen])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault(); setPalette({ open: true, mode: 'commands' }); setPaletteQuery('')
      } else if (mod && event.key.toLowerCase() === 'p') {
        event.preventDefault(); setPalette({ open: true, mode: 'files' }); setPaletteQuery('')
      } else if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault(); if (activePath && activePath !== PREVIEW_PATH) save(activePath)
      } else if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault(); setSidebarVisible((value) => !value)
      } else if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault(); setPanelOpen((value) => !value)
      } else if (mod && event.key === 'Enter') {
        event.preventDefault(); runProject()
      } else if (event.ctrlKey && event.key === '`') {
        event.preventDefault(); setPanelOpen((value) => !value)
      } else if (event.key === 'Escape') {
        setPalette((current) => ({ ...current, open: false })); setSettingsOpen(false); setNewFileOpen(false); setMenuOpen(null)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [activePath, runProject, save])

  const startSidebarResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const move = (moveEvent: MouseEvent) => setSidebarWidth(Math.max(190, Math.min(420, startWidth + moveEvent.clientX - startX)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const startPanelResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = panelHeight
    const move = (moveEvent: MouseEvent) => setPanelHeight(Math.max(120, Math.min(window.innerHeight * .65, startHeight + startY - moveEvent.clientY)))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const panelContent = () => {
    if (panelTab === 'PROBLEMS') return (
      <div className="empty-panel"><CircleCheck size={24} /><strong>No problems detected</strong><span>Workspace validation passed.</span></div>
    )
    if (panelTab === 'OUTPUT') return (
      <div className="output-panel"><span>[Tungsten]</span> Workspace indexed in 184ms<br /><span>[Vite]</span> Development graph ready<br /><span>[Git]</span> Watching repository changes</div>
    )
    if (panelTab === 'DEBUG CONSOLE') return (
      <div className="empty-panel"><Bot size={24} /><strong>Debug console is ready</strong><span>Start a debug session to inspect values.</span></div>
    )
    return (
      <div className="terminal" onClick={() => terminalInputRef.current?.focus()}>
        <div className="terminal-scroll">
          {terminalLines.map((line, index) => <div key={index} className={`terminal-line ${line.kind || ''}`}>{line.text}</div>)}
          <div className="terminal-prompt">
            <span className="prompt-user">tungsten@forge</span><span className="prompt-path"> ~/forge </span><span>$</span>
            <input
              ref={terminalInputRef}
              value={terminalInput}
              spellCheck={false}
              autoComplete="off"
              aria-label="Terminal input"
              onChange={(event) => setTerminalInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  runTerminalCommand(terminalInput); setTerminalInput('')
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  const next = Math.min(history.length - 1, historyIndex + 1)
                  setHistoryIndex(next); setTerminalInput(history[history.length - 1 - next] || '')
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  const next = Math.max(-1, historyIndex - 1)
                  setHistoryIndex(next); setTerminalInput(next === -1 ? '' : history[history.length - 1 - next] || '')
                }
              }}
            />
          </div>
          <div ref={terminalEndRef} />
        </div>
      </div>
    )
  }

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const query = searchQuery.toLowerCase()
    return files.flatMap((file) => file.content.split('\n').map((line, index) => ({ file, line, index })).filter((result) => result.line.toLowerCase().includes(query))).slice(0, 40)
  }, [files, searchQuery])

  const sidebarContent = () => {
    if (activity === 'search') return (
      <>
        <div className="sidebar-title"><span>SEARCH</span><Ellipsis size={16} /></div>
        <div className="search-box-wrap"><Search size={13} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search workspace" /></div>
        <div className="search-meta">{searchQuery ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} in ${new Set(searchResults.map((item) => item.file.path)).size} files` : 'Type to search across files'}</div>
        <div className="search-results">
          {searchResults.map((result, index) => <button key={`${result.file.path}-${result.index}-${index}`} onClick={() => openFile(result.file.path)}>
            <div><FileGlyph path={result.file.path} /><strong>{fileName(result.file.path)}</strong><span>:{result.index + 1}</span></div>
            <p>{result.line.trim()}</p>
          </button>)}
        </div>
      </>
    )
    if (activity === 'source') return (
      <>
        <div className="sidebar-title"><span>SOURCE CONTROL</span><Ellipsis size={16} /></div>
        <div className="commit-box">
          <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Message (⌘Enter to commit)" />
          <button disabled={!commitMessage.trim()} onClick={() => { setDirty(new Set()); setCommitMessage(''); notify('Changes committed locally') }}><Check size={14} /> Commit</button>
        </div>
        <div className="section-heading"><span>CHANGES</span><span className="count-pill">{dirty.size}</span><Plus size={14} /><RefreshCw size={13} /></div>
        {dirty.size === 0 ? <div className="sidebar-empty"><GitCommitHorizontal size={25} /><span>Working tree is clean</span></div> : [...dirty].map((path) => (
          <button className="change-row" key={path} onClick={() => openFile(path)}><FileGlyph path={path} /><span>{fileName(path)}</span><small>{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</small><b>M</b></button>
        ))}
      </>
    )
    if (activity === 'extensions') return (
      <>
        <div className="sidebar-title"><span>EXTENSIONS</span><Ellipsis size={16} /></div>
        <div className="search-box-wrap"><Search size={13} /><input placeholder="Search extensions" /></div>
        <div className="section-heading"><span>INSTALLED</span><span className="count-pill">3</span></div>
        {[
          ['Prettier', 'Opinionated code formatter', 'P'],
          ['ESLint', 'Integrates ESLint into Tungsten', 'E'],
          ['GitLens', 'Supercharge Git capabilities', 'G'],
        ].map(([name, description, icon]) => <div className="extension-card" key={name}><div className={`extension-icon ext-${icon.toLowerCase()}`}>{icon}</div><div><strong>{name}</strong><p>{description}</p><span>Enabled</span></div><Settings size={13} /></div>)}
      </>
    )
    return (
      <>
        <div className="sidebar-title"><span>EXPLORER</span><Ellipsis size={16} /></div>
        <div className="project-heading"><ChevronDown size={13} /><strong>FORGE</strong><span /><TipButton label="New file" onClick={() => setNewFileOpen(true)}><File size={14} /><Plus size={8} className="mini-plus" /></TipButton><TipButton label="Collapse folders"><ChevronsDownUp size={14} /></TipButton></div>
        <ExplorerTree files={files} activePath={activePath} openFile={openFile} dirty={dirty} />
        <div className="outline-section">
          <div className="section-heading"><ChevronDown size={13} /><span>OUTLINE</span><span /><Ellipsis size={14} /></div>
          {symbols.length ? <div className="symbols-list">{symbols.map((symbol, index) => <div key={`${symbol.label}-${index}`}><Braces size={13} /><span>{symbol.label}</span></div>)}</div> : <p className="outline-empty">No symbols found</p>}
        </div>
        <div className="collapsed-section"><ChevronRight size={13} /> TIMELINE</div>
      </>
    )
  }

  const menus: Record<string, Array<{ label: string; shortcut?: string; action: () => void; divider?: boolean }>> = {
    File: [
      { label: 'New File…', shortcut: 'Ctrl+N', action: () => setNewFileOpen(true) },
      { label: 'Open File…', shortcut: 'Ctrl+P', action: () => setPalette({ open: true, mode: 'files' }) },
      { label: 'Save', shortcut: 'Ctrl+S', action: () => activePath && save(activePath), divider: true },
      { label: 'Save All', shortcut: 'Ctrl+K S', action: () => save() },
    ],
    Edit: [
      { label: 'Command Palette…', shortcut: 'Ctrl+Shift+P', action: () => setPalette({ open: true, mode: 'commands' }) },
      { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', action: () => { setActivity('search'); setSidebarVisible(true) } },
    ],
    View: [
      { label: 'Primary Side Bar', shortcut: 'Ctrl+B', action: () => setSidebarVisible((value) => !value) },
      { label: 'Bottom Panel', shortcut: 'Ctrl+J', action: () => setPanelOpen((value) => !value) },
      { label: 'Settings', shortcut: 'Ctrl+,', action: () => setSettingsOpen(true), divider: true },
    ],
    Run: [
      { label: 'Run Project', shortcut: 'Ctrl+Enter', action: runProject },
      { label: 'Start Debugging', shortcut: 'F5', action: () => { setPanelOpen(true); setPanelTab('DEBUG CONSOLE'); notify('Debug session started') } },
    ],
    Terminal: [
      { label: 'New Terminal', shortcut: 'Ctrl+Shift+`', action: () => { setPanelOpen(true); setPanelTab('TERMINAL') } },
      { label: 'Clear Terminal', action: () => setTerminalLines([]) },
    ],
    Help: [
      { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+K Ctrl+S', action: () => { setPalette({ open: true, mode: 'commands' }); setPaletteQuery('') } },
      { label: 'About Tungsten', action: () => notify('Tungsten IDE · forged for focused work') },
    ],
  }

  return (
    <div className="ide" onClick={() => menuOpen && setMenuOpen(null)}>
      <header className="titlebar">
        <div className="brand-mark" title="Tungsten"><Hammer size={15} strokeWidth={2.4} /></div>
        <button className="menu-mobile"><Menu size={15} /></button>
        <nav className="app-menu" aria-label="Application menu">
          {['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'].map((name) => (
            <div className="menu-wrap" key={name}>
              <button onClick={(event) => { event.stopPropagation(); if (menus[name]) setMenuOpen(menuOpen === name ? null : name) }}>{name}</button>
              {menuOpen === name && menus[name] && <div className="menu-dropdown" onClick={(event) => event.stopPropagation()}>
                {menus[name].map((item, index) => <button key={item.label} className={item.divider && index ? 'with-divider' : ''} onClick={() => { item.action(); setMenuOpen(null) }}><span>{item.label}</span><kbd>{item.shortcut}</kbd></button>)}
              </div>}
            </div>
          ))}
        </nav>
        <button className="command-center" onClick={() => setPalette({ open: true, mode: 'commands' })}>
          <Search size={12} /><span>forge — Tungsten</span><kbd>⌘ K</kbd>
        </button>
        <div className="title-actions">
          <TipButton label="Tungsten Copilot"><Bot size={15} /></TipButton>
          <TipButton label={sidebarVisible ? 'Hide primary sidebar' : 'Show primary sidebar'} active={sidebarVisible} onClick={() => setSidebarVisible((value) => !value)}><PanelLeftClose size={15} /></TipButton>
          <TipButton label={panelOpen ? 'Hide panel' : 'Show panel'} active={panelOpen} onClick={() => setPanelOpen((value) => !value)}><PanelBottomClose size={15} /></TipButton>
          <TipButton label="Split editor"><Columns2 size={15} /></TipButton>
        </div>
      </header>

      <main className="workbench">
        <aside className="activitybar">
          <div>
            {activityItems.map((item) => {
              const Icon = item.icon
              return <button key={item.id} className={activity === item.id && sidebarVisible ? 'active' : ''} onClick={() => {
                if (activity === item.id) setSidebarVisible((value) => !value)
                else { setActivity(item.id); setSidebarVisible(true) }
              }} aria-label={item.label} title={item.label}>
                <Icon size={21} strokeWidth={1.65} />
                {item.id === 'source' && dirty.size > 0 && <span className="activity-badge">{dirty.size}</span>}
              </button>
            })}
          </div>
          <div>
            <button aria-label="Accounts" title="Accounts"><CircleUserRound size={20} strokeWidth={1.6} /><span className="presence-dot" /></button>
            <button aria-label="Manage" title="Manage" onClick={() => setSettingsOpen(true)}><Settings size={20} strokeWidth={1.6} /></button>
          </div>
        </aside>

        {sidebarVisible && <aside className="sidebar" style={{ width: sidebarWidth }}>
          {sidebarContent()}
          <div className="resize-handle vertical" onMouseDown={startSidebarResize} />
        </aside>}

        <section className="main-stage">
          <div className="editor-tabs">
            <div className="tab-scroll">
              {openTabs.map((path) => {
                const isPreview = path === PREVIEW_PATH
                return <button key={path} className={`editor-tab ${activePath === path ? 'active' : ''}`} onClick={() => setActivePath(path)}>
                  {isPreview ? <Eye size={14} className="preview-tab-icon" /> : <FileGlyph path={path} />}
                  <span>{isPreview ? 'Preview' : fileName(path)}</span>
                  {dirty.has(path) ? <span className="tab-dirty" /> : <X size={13} className="tab-close" onClick={(event) => { event.stopPropagation(); closeTab(path) }} />}
                </button>
              })}
            </div>
            <div className="tab-actions"><TipButton label="Run project" onClick={runProject}><Play size={14} fill="currentColor" /></TipButton><TipButton label="Split editor"><SplitSquareHorizontal size={14} /></TipButton><TipButton label="More actions"><Ellipsis size={15} /></TipButton></div>
          </div>

          {activePath && activePath !== PREVIEW_PATH && <div className="breadcrumbs">
            <span>forge</span><ChevronRight size={12} />
            {activePath.split('/').map((part, index, parts) => <span className="crumb" key={`${part}-${index}`}>{index === parts.length - 1 && <FileGlyph path={activePath} />}{part}{index < parts.length - 1 && <ChevronRight size={12} />}</span>)}
            {dirty.has(activePath) && <span className="unsaved-label">UNSAVED</span>}
          </div>}

          <div className="editor-and-panel">
            <div className="editor-area">
              {activePath === PREVIEW_PATH ? <Preview html={buildPreview()} onReload={() => notify('Preview refreshed')} /> : activeFile ? (
                <Editor
                  height="100%"
                  path={`file:///${activeFile.path}`}
                  language={activeFile.language}
                  value={activeFile.content}
                  theme="tungsten-dark"
                  beforeMount={(monaco) => {
                    monaco.editor.defineTheme('tungsten-dark', {
                      base: 'vs-dark',
                      inherit: true,
                      rules: [
                        { token: 'comment', foreground: '727A73', fontStyle: 'italic' },
                        { token: 'keyword', foreground: 'D2FF72' },
                        { token: 'string', foreground: 'D7BA7D' },
                        { token: 'number', foreground: 'B8A9E8' },
                        { token: 'type.identifier', foreground: '82CED1' },
                        { token: 'delimiter', foreground: '9AA09A' },
                      ],
                      colors: {
                        'editor.background': '#111311',
                        'editor.foreground': '#D5D9D4',
                        'editorLineNumber.foreground': '#474C48',
                        'editorLineNumber.activeForeground': '#A8B0A9',
                        'editor.lineHighlightBackground': '#191C19',
                        'editor.selectionBackground': '#3C4A2C',
                        'editor.inactiveSelectionBackground': '#2A3323',
                        'editorCursor.foreground': '#D2FF72',
                        'editorIndentGuide.background1': '#252925',
                        'editorIndentGuide.activeBackground1': '#454B45',
                        'editorWhitespace.foreground': '#2B2E2B',
                        'editorGutter.background': '#111311',
                        'minimap.background': '#101210',
                        'scrollbarSlider.background': '#565B5642',
                        'scrollbarSlider.hoverBackground': '#6D736D66',
                      },
                    })
                  }}
                  onChange={updateFile}
                  onMount={(editor) => {
                    editor.onDidChangeCursorPosition((event) => setCursor({ line: event.position.lineNumber, column: event.position.column }))
                    editor.focus()
                  }}
                  options={{
                    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
                    fontSize: settings.fontSize,
                    lineHeight: Math.round(settings.fontSize * 1.62),
                    fontLigatures: true,
                    minimap: { enabled: settings.minimap, maxColumn: 90, renderCharacters: false, scale: 1 },
                    wordWrap: settings.wordWrap ? 'on' : 'off',
                    padding: { top: 14, bottom: 20 },
                    smoothScrolling: true,
                    cursorSmoothCaretAnimation: 'on',
                    cursorBlinking: 'smooth',
                    renderLineHighlight: 'all',
                    overviewRulerBorder: false,
                    hideCursorInOverviewRuler: true,
                    bracketPairColorization: { enabled: true },
                    guides: { bracketPairs: true, indentation: true },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                  }}
                  loading={<div className="editor-loading"><div className="loading-mark"><Hammer size={24} /></div><span>Heating editor core…</span></div>}
                />
              ) : (
                <div className="empty-editor">
                  <div className="empty-brand"><Hammer size={41} /></div><h2>TUNGSTEN</h2><p>A development environment forged for focus.</p>
                  <div className="empty-actions"><button onClick={() => setPalette({ open: true, mode: 'files' })}>Open file <kbd>⌘P</kbd></button><button onClick={() => setNewFileOpen(true)}>New file <kbd>⌘N</kbd></button><button onClick={runProject}>Run project <kbd>⌃↵</kbd></button></div>
                </div>
              )}
            </div>

            {panelOpen && <section className="bottom-panel" style={{ height: panelHeight }}>
              <div className="resize-handle horizontal" onMouseDown={startPanelResize} />
              <header className="panel-header">
                <nav>{['PROBLEMS', 'OUTPUT', 'DEBUG CONSOLE', 'TERMINAL'].map((tab) => <button key={tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)}>{tab}{tab === 'PROBLEMS' && <span className="tab-count">0</span>}</button>)}</nav>
                <div><span className="terminal-name"><TerminalSquare size={13} /> zsh <ChevronDown size={11} /></span><TipButton label="New terminal"><Plus size={14} /></TipButton><TipButton label="Kill terminal" onClick={() => setTerminalLines([])}><Trash2 size={13} /></TipButton><TipButton label="Maximize panel" onClick={() => setPanelHeight((height) => height > 400 ? 225 : Math.round(window.innerHeight * .62))}><Maximize2 size={13} /></TipButton><TipButton label="Close panel" onClick={() => setPanelOpen(false)}><X size={14} /></TipButton></div>
              </header>
              {panelContent()}
            </section>}
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <div>
          <button title="Open a remote window" className="remote-status"><SquareCode size={13} /></button>
          <button title="Current branch"><GitBranch size={13} /><span>main*</span></button>
          <button title="Synchronize changes"><RefreshCw size={11} /><span>0</span></button>
          <button title="No errors or warnings"><X size={12} /><span>0</span><CircleAlert size={12} /><span>0</span></button>
        </div>
        <div>
          <button title="Tungsten workspace"><Radio size={11} /><span>Forge</span></button>
          {activePath !== PREVIEW_PATH && <><button title="Go to line">Ln {cursor.line}, Col {cursor.column}</button><button>Spaces: 2</button><button>UTF-8</button><button>LF</button><button>{activeFile?.language || 'Plain Text'}</button></>}
          <button title="Formatter"><CircleCheck size={12} /><span>Prettier</span></button>
          <button title="Tungsten engine"><Zap size={12} /><span>Ready</span></button>
          <button title="Notifications"><Bell size={13} /></button>
        </div>
      </footer>

      {palette.open && <div className="overlay palette-overlay" onMouseDown={() => setPalette((current) => ({ ...current, open: false }))}>
        <div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
          <div className="palette-input"><Command size={17} /><input ref={paletteInputRef} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder={palette.mode === 'files' ? 'Search files by name…' : 'Type a command…'} onKeyDown={(event) => { if (event.key === 'Enter' && paletteItems[0]) executePaletteItem(paletteItems[0].action) }} /><kbd>ESC</kbd></div>
          <div className="palette-label">{palette.mode === 'files' ? 'FILES' : 'COMMANDS'}</div>
          <div className="palette-list">
            {paletteItems.map((item, index) => { const Icon = item.icon; return <button key={item.label + item.detail} className={index === 0 ? 'selected' : ''} onClick={() => executePaletteItem(item.action)}><Icon size={16} /><div><strong>{item.label}</strong><span>{item.detail}</span></div>{item.keys?.length ? <div className="shortcut-keys">{item.keys.map((key) => <kbd key={key}>{key}</kbd>)}</div> : null}</button> })}
            {!paletteItems.length && <div className="no-results">No matching {palette.mode === 'files' ? 'files' : 'commands'}</div>}
          </div>
          <footer><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span></footer>
        </div>
      </div>}

      {settingsOpen && <div className="overlay" onMouseDown={() => setSettingsOpen(false)}>
        <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="modal-icon"><Settings size={17} /></span><div><h2>Editor settings</h2><p>Make the forge yours.</p></div></div><button onClick={() => setSettingsOpen(false)}><X size={17} /></button></header>
          <div className="settings-body">
            <label className="range-setting"><div><strong>Font size</strong><span>Controls the editor text size.</span></div><div><input type="range" min="11" max="19" value={settings.fontSize} onChange={(event) => setSettings({ ...settings, fontSize: Number(event.target.value) })} /><output>{settings.fontSize}px</output></div></label>
            {[
              ['Word wrap', 'Wrap long lines at the editor viewport.', 'wordWrap'],
              ['Minimap', 'Show a compact overview of the active file.', 'minimap'],
              ['Auto save', 'Save changes after a short delay.', 'autosave'],
            ].map(([title, description, key]) => <label className="toggle-setting" key={key}><div><strong>{title}</strong><span>{description}</span></div><input type="checkbox" checked={settings[key as keyof SettingsState] as boolean} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} /><span className="toggle-track"><i /></span></label>)}
          </div>
          <footer><button onClick={() => setSettings(defaultSettings)}>Reset defaults</button><button className="primary" onClick={() => setSettingsOpen(false)}>Done</button></footer>
        </section>
      </div>}

      {newFileOpen && <div className="overlay" onMouseDown={() => setNewFileOpen(false)}>
        <section className="new-file-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="new-file-icon"><FileCode2 size={20} /></div><div><h2>Create a new file</h2><p>Use a path to place it inside a folder.</p></div>
          <label>FILE PATH<input ref={newFileInputRef} value={newFileName} onChange={(event) => setNewFileName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createFile()} placeholder="src/components/button.tsx" /></label>
          <footer><button onClick={() => setNewFileOpen(false)}>Cancel</button><button className="primary" disabled={!newFileName.trim()} onClick={createFile}>Create file</button></footer>
        </section>
      </div>}

      {toast && <div className="toast"><CircleCheck size={15} /><span>{toast}</span></div>}
    </div>
  )
}
