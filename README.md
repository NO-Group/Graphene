# Tungsten IDE

A rugged, cross-platform development environment built with Electron, React, Monaco, and xterm. Tungsten runs on Windows, macOS, and Linux while retaining a browser workspace for development and demonstrations.

<img src="resources/icon.png" alt="Tungsten IDE icon" width="120" />

## Tungsten 1.0

### Professional editing

- Monaco editor bundled locally for offline syntax highlighting and core language services
- Multi-file tabs, minimap, bracket guides, sticky scopes, visible whitespace, word wrap, formatting, and autosave
- Quick-open, workspace search, symbol outline, command palette, keyboard shortcuts, and resizable panels
- Side-by-side live preview for HTML, CSS, and JavaScript projects
- Create, rename, delete, reveal, and refresh files from the explorer

### Language intelligence

Tungsten recognizes more than 40 languages and formats. A generic Language Server Protocol bridge supplies completion, hover documentation, and diagnostics.

- The TypeScript language server is bundled for JavaScript and TypeScript
- Python, Rust, Go, C/C++, Java, C#, Ruby, PHP, Kotlin, and Lua servers are discovered from the computer's `PATH`
- Editing and syntax highlighting continue normally when an optional server is not installed

See [Language servers](docs/LANGUAGE_SERVERS.md) for server names and setup.

### Native terminal

- PTY-backed shell using xterm with full ANSI color and interactive applications
- Native PowerShell/cmd compatibility on Windows and login shells on macOS/Linux
- Terminal resizing, command history, process interruption, scrolling, task execution, and session restart
- Sandboxed command emulator remains available in the browser build

### Debugging

- Debug Adapter Protocol transport over standard input/output
- Adapter initialization, launch, configuration, output, pause, stop, and lifecycle handling
- Breakpoint management and debug console views
- Project-defined `.tungsten/launch.json` configurations

See [Debugging](docs/DEBUGGING.md) for an example configuration. Language-specific debug adapters are intentionally installed separately.

### Git

- Live branch and working-tree status
- Changed-file list, visual diff buffers, per-file staging, and commits
- Backend support for unstaging, branch listing, and checkout
- All Git commands run against the selected local workspace

### Projects, tasks, and tests

- New-project templates for web, Node.js, Python, Rust, and Go
- Automatic project detection for npm, pytest, Cargo, Go, Maven, and Gradle
- Test Explorer and task runner integrated with the native terminal
- Custom `.tungsten/tasks.json` tasks
- Most-recent workspace restoration

### Extensions

- Install local extension folders from the Extensions sidebar
- Per-user and workspace-local extension discovery
- Declarative command, theme, and language contributions without arbitrary renderer execution

See the [extension manifest guide](docs/EXTENSIONS.md).

### Reliability and distribution

- Timed crash-recovery snapshots with restore prompts
- Electron renderer sandbox, context isolation, path validation, symbolic-link protection, and isolated previews
- Automatic update checks in packaged builds through `electron-updater`
- Windows NSIS/portable, macOS DMG/ZIP, and Linux AppImage/DEB targets
- Cross-platform GitHub Actions builds, optional signing/notarization secrets, release assets, and generated release notes

## Run the desktop app

```bash
npm install
npm run desktop:dev
```

A graphical desktop session is required.

## Build installers

```bash
npm run desktop:dist
```

Installers are written to `out/`. Build locally on the target operating system, or run the included `Build desktop installers` GitHub Actions workflow. For signed releases, configure the signing secrets documented in the workflow and push a version tag such as `v1.0.0`.

Create an unpacked application for the current platform with:

```bash
npm run desktop:pack
```

## Browser development

```bash
npm run dev
```

The Vite server binds to `0.0.0.0`. Native filesystem, PTY, Git, LSP, DAP, extension installation, and updater access remain available only inside Electron.

## Quality checks

```bash
npm run check
```

This runs ESLint, unit tests, TypeScript, and the production Vite build. Dependency security can be checked with `npm audit`.
