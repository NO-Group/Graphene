# Graphene — Vector Design Studio

A fast, modern, browser-based vector graphics editor. No installs, no accounts,
no 4 GB download — open `index.html` and design.

![Graphene](https://img.shields.io/badge/vector-editor-7C5CFF) ![Zero dependencies](https://img.shields.io/badge/dependencies-0-39D2C0)

## Run it

```bash
# any static server works — zero build step, zero dependencies
python3 -m http.server 8000
# → http://localhost:8000
```

Or just double-click `index.html`.

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

Everything is vanilla ES2020 + SVG — no frameworks, no build step.
