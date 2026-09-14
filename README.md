# Tungsten IDE

A rugged, cross-platform development environment built with Electron, React, and Monaco. Tungsten runs as a native desktop application on Windows, macOS, and Linux while retaining a browser preview for development.

<img src="resources/icon.png" alt="Tungsten IDE icon" width="120" />

## Features

- Monaco editor bundled locally for fully offline syntax highlighting, minimap, bracket guides, and language services
- Open real folders from the computer and safely read or write workspace files
- Native project terminal that runs commands in the selected workspace
- Multi-file explorer, tabs, workspace search, outline, and source-control views
- Isolated live HTML/CSS/JavaScript preview
- Command palette, quick file navigation, keyboard shortcuts, resizable panels, and editor preferences
- Persistent browser demo workspace when running outside Electron
- Hardened Electron boundary using context isolation, renderer sandboxing, disabled Node integration, validated file paths, and a minimal preload API

## Run the desktop app

```bash
npm install
npm run desktop:dev
```

The desktop development command launches Vite and Electron together. A graphical desktop session is required.

## Build an installer

```bash
npm run desktop:dist
```

Installers are written to `out/`:

- **Windows:** NSIS installer and portable executable
- **macOS:** DMG and ZIP
- **Linux:** AppImage and Debian package

Installers should be built on their target operating system. The included [GitHub Actions workflow](.github/workflows/desktop-build.yml) builds all three platforms from one manually triggered workflow or a version tag.

For a quick unpacked application build on the current platform:

```bash
npm run desktop:pack
```

## Browser development

```bash
npm run dev
```

The Vite server binds to `0.0.0.0` for hosted development environments. Local-folder and native-terminal access are intentionally available only inside the desktop application.

## Quality checks

```bash
npm run build
npm run lint
npm audit
```
