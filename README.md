# Graphene — Vector Design Studio

A professional vector graphics editor that runs on **every computer** — in any
modern browser, installed as an offline desktop PWA, or packaged as a native
Windows / macOS / Linux app.

![Graphene](https://img.shields.io/badge/vector-editor-7C5CFF) ![Zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-39D2C0)

## Run it — three ways

**1. Browser (any OS, zero install)**
```bash
python3 -m http.server 8000   # any static server works
# → http://localhost:8000
```

**2. Install as an app (offline-capable PWA)**
Open it in Chrome/Edge and click *Install* in the address bar. Graphene then
runs in its own window, works fully offline (service worker caches everything),
and appears in your Start menu / dock like any other program.

**3. Native desktop app (Windows / macOS / Linux)**
```bash
npm install
npm run desktop        # run with Electron
npm run dist:win       # build Windows installer (.exe) + portable
npm run dist:mac       # build macOS .dmg
npm run dist:linux     # build AppImage + .deb
```

## Features

**Drawing tools**
- Select (V) — move, resize (Shift = uniform), rotate, multi-select, marquee
- Node editor (A) — edit bezier anchors & control handles, add/delete anchors,
  Alt-drag for asymmetric handles; shapes auto-convert to editable paths
- Pen (P) — true bezier pen: click for corners, click-drag for smooth curves,
  close paths by clicking the start point
- Pencil (B) — freehand drawing, auto-simplified (Ramer–Douglas–Peucker) and
  smoothed into bezier curves
- Rectangle (R) with live corner radius, Ellipse (E), Polygon (G), Star (S)
  with adjustable points & inner radius, Line (L)
- Text (T) — in-place editing, multi-line, 9 font families, bold/italic/align

**Styling**
- Solid fills, linear gradients (with angle control), radial gradients
- Strokes with width, color, solid/dashed/dotted styles
- Per-object opacity

**Pro workspace**
- Rulers with adaptive tick scale (Ctrl+R) — drag from a ruler to create guides,
  drag guides off-canvas to delete
- Smart alignment guides: objects snap to other objects' edges/centers, page
  center/edges, and your guides while moving
- Right-click context menu with the full object toolkit
- Combine paths (Ctrl+L) / Break apart (Ctrl+K) — CorelDRAW-style multi-subpath
  objects with even-odd holes
- Drop shadow and gaussian blur effects per object (exported to SVG/PNG)
- Import images: PNG/JPG/WebP/GIF via menu, drag-and-drop, or Ctrl+V paste
- Import SVG files — parsed into native editable objects (rect, circle, ellipse,
  line, polygon, polyline, path with full bezier data, text)
- Lock objects (Ctrl+2) / Unlock all

**Workflow**
- Full undo/redo history (100 steps)
- Layers panel: reorder by drag, rename, lock, hide, live type icons
- Group / ungroup, z-order commands, flip H/V
- Align (left/center/right/top/middle/bottom) & distribute — to page when one
  object is selected, to selection bounds for many
- Grid with snap, snap-aware drawing & moving
- Infinite canvas: scroll-zoom at cursor (5%–3200%), space-drag panning
- Copy/cut/paste/duplicate, arrow-key nudging (Shift = 10 px)
- Convert any shape to an editable bezier path

**Files**
- Save / open projects as JSON (`.graphene.json`)
- Export clean standalone **SVG**
- Export **PNG** at 2× resolution

Press `?` in the app for the full shortcut list.

## Architecture

| File | Role |
|---|---|
| `js/core.js` | Document model, object factories, geometry (bbox, rotation, scaling), shape→bezier conversion, history |
| `js/render.js` | SVG scene renderer, gradients, grid, selection & node-editing overlays |
| `js/tools.js` | Pointer state machine for all tools: select/transform, pen, pencil (RDP + Catmull-Rom smoothing), node editing, text editing |
| `js/ui.js` | Toolbar, menus, properties panel, layers panel, keyboard shortcuts, file IO & export |
| `js/extras.js` | Rulers & guides, smart-guide snapping targets, context menu, image/SVG import (incl. a path-`d` parser), combine/break-apart, lock tools |
| `sw.js` + `manifest.json` | Offline service worker + PWA install manifest |
| `desktop/main.js` + `package.json` | Electron shell + electron-builder config for native Windows/macOS/Linux builds |

The editor itself is vanilla ES2020 + SVG — no frameworks, no build step, and
the same codebase powers the browser, PWA, and desktop versions.

> "Who builds a serious app with HTML?" — Figma, Canva, Photoshop Web, and
> VS Code, among others. The trick is doing it properly.
