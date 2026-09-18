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

**PowerTRACE — bitmap to vector**
- Converts any imported image (PNG/JPG/WebP/GIF) into **editable vector paths**
- Median-cut colour quantisation refined by **Lloyd/k-means** iterations, so
  flat-colour artwork comes back with its exact original colours
- **Moore-neighbour contour tracing** with 8-connectivity, Ramer–Douglas–Peucker
  simplification, and optional bezier smoothing
- Colour mode (2–48 colours) or silhouette/line-art mode with an adjustable
  threshold; result arrives as a grouped, fully editable path set

**Distortion & destructive editing**
- **Envelope** — bilinear 4-corner warp; drag the handles, Enter applies
- **Perspective** — true projective homography (not a fake shear), corners land
  exactly where you put them
- **Knife (K)** — drag a line to slice objects cleanly in two; Shift constrains
  to horizontal/vertical; area is provably conserved across the cut
- **Eraser (X)** — paint to subtract geometry, `[` / `]` resize the brush;
  fully-erased objects are removed
- **Eyedropper (I)** — copy fill + stroke from one object onto a selection
- **Roughen** and **Twirl** distortion effects

**Boolean shaping engine** (the CorelDRAW *Shaping* docker, done properly)
- **Weld · Trim · Intersect · Exclude · Front−Back · Back−Front · Simplify ·
  Create Boundary** — all eight operations
- Backed by an exact **Martinez–Rueda–Feito polygon clipper** written from
  scratch: handles holes, self-intersections, collinear/shared edges, and
  multi-contour inputs. Beziers are adaptively flattened, results come back as
  editable multi-subpath paths with correct even-odd holes
- Verified by 20 unit tests against analytically-known areas (circle–circle lens
  area within 0.3% using 64-gon approximation)

**Effects & composition**
- **Contour** — inner/outer offset rings with miter-clamped normals and
  automatic colour fade (1–20 steps)
- **Blend** — morph one shape into another across N steps, with arc-length
  resampling and best-rotation matching so shapes don't twist
- **PowerClip** — place any objects inside a container shape (real SVG clip
  paths), release at any time
- Drop shadow and gaussian blur per object, exported into SVG/PNG

**Text**
- **Text on a path** — fit text to any curve, adjust offset along the path and
  flip it above/below
- In-place editing, multi-line, 9 font families, bold/italic/align

**Documents**
- **Multi-page documents** with tabs, add/duplicate/rename/delete, PageUp/PageDown
- Page presets: A4, US Letter, Square 1080, 1920×1080, business card
- **Auto-save & crash recovery** — work is snapshotted to local storage and
  offered back after an unexpected close

**Colour**
- Bottom palette bar: 36 curated swatches, click = fill, Shift+click = stroke,
  plus save-your-own swatches persisted locally
- **CMYK** and **HSB** numeric entry alongside hex, with live conversion

**Pro workspace**
- Wireframe / outline view (Ctrl+Y)
- Live dimension readout while moving and resizing
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

**Print production**
- Export **print-ready PDF** (vector, not a rasterised screenshot) — the writer is
  implemented from scratch: no libraries, no server
- **DeviceCMYK** or DeviceRGB output, selected at export time
- **Bleed** and **crop marks** for commercial printing, with correct
  `TrimBox` / `BleedBox` / `MediaBox`
- Gradients export as native PDF **axial & radial shadings** (multi-stop gradients
  become stitched exponential functions — they stay resolution-independent)
- Transparency via `ExtGState`, text stays **live and selectable** using the
  base-14 fonts, and multi-page documents export as multi-page PDFs

**Fountain fills**
- **Unlimited colour stops** with a draggable ramp: double-click to add a stop,
  double-click a stop to remove it, drag to reposition
- Linear & radial, adjustable angle, one-click reverse
- Six built-in presets (Sunset, Ocean, Mint, Grape, Gold, Steel)
- **Convert Text to Curves** (Ctrl+Q) turns live text into editable vector paths

## Architecture

| File | Role |
|---|---|
| `js/core.js` | Document model, object factories, geometry (bbox, rotation, scaling), shape→bezier conversion, history |
| `js/render.js` | SVG scene renderer, gradients, grid, selection & node-editing overlays |
| `js/tools.js` | Pointer state machine for all tools: select/transform, pen, pencil (RDP + Catmull-Rom smoothing), node editing, text editing |
| `js/ui.js` | Toolbar, menus, properties panel, layers panel, keyboard shortcuts, file IO & export |
| `js/extras.js` | Rulers & guides, smart-guide snapping targets, context menu, image/SVG import (incl. a path-`d` parser), combine/break-apart, lock tools |
| `js/boolean.js` | Martinez–Rueda–Feito polygon clipper (sweep line, event queue, contour reconstruction) + the eight shaping commands |
| `js/pro.js` | Multi-page documents, CMYK/HSB colour, palette, text-on-path, contour, blend, PowerClip, auto-save recovery, dimension readout |
| `js/trace.js` | PowerTRACE: quantisation (median-cut + k-means), Moore-neighbour contour tracing, RDP simplification, bezier smoothing |
| `js/distort.js` | Envelope & perspective warping (homography solver), knife, eraser, roughen, twirl |
| `js/pdf.js` | Print-ready PDF 1.7 writer built from scratch: DeviceCMYK/RGB, axial & radial shadings, transparency groups, base-14 fonts, crop marks, bleed |
| `js/fountain.js` | Multi-stop fountain-fill editor (draggable ramp) and text→curves conversion |
| `sw.js` + `manifest.json` | Offline service worker + PWA install manifest |
| `desktop/main.js` + `package.json` | Electron shell + electron-builder config for native Windows/macOS/Linux builds |
| `test/` | 193 automated tests — boolean geometry, tracer, distortion, headless app smoke tests, simulated pointer interaction |

## Tests

```bash
npm install     # jsdom, for the headless DOM tests
npm test
```

- `test/boolean.test.js` — 20 geometry assertions against known-exact areas
- `test/trace.test.js` — 24 tests: contour tracing, RDP, colour quantisation
- `test/distort.test.js` — 29 tests: homography exactness, envelope, knife
  (area conservation), eraser, roughen, twirl
- `test/app.smoke.js` — boots the real `index.html` in jsdom and exercises
  shaping, pages, colour models, contour, blend, PowerClip, text-on-path,
  undo/redo, export and rendering
- `test/interaction.test.js` — dispatches real pointer/keyboard events to draw,
  drag, marquee-select, duplicate, delete and undo
- `test/pdf.test.js` — 58 tests: CMYK conversion, PDF object graph, xref offset
  integrity, stream `/Length` correctness, shadings, fonts & string escaping,
  transparency, bleed/crop marks, multi-stop gradients, text→curves

The editor itself is vanilla ES2020 + SVG — no frameworks, no build step, and
the same codebase powers the browser, PWA, and desktop versions.

## Compared to CorelDRAW

| | CorelDRAW | Graphene |
|---|---|---|
| Boolean shaping | Weld/Trim/Intersect/Simplify/Boundary | All of them, exact clipper, 20 unit tests |
| Bitmap tracing | PowerTRACE | PowerTRACE (quantise + k-means + contour trace) |
| Envelope / Perspective | Yes | Yes (true projective homography) |
| Knife / Eraser | Yes | Yes (boolean-exact, area-conserving) |
| Print PDF export | Yes | Yes — CMYK, bleed, crop marks, vector shadings |
| Fountain fills | Unlimited stops | Unlimited stops, draggable ramp, presets |
| Convert to curves | Yes | Yes |
| Contour & Blend | Yes | Yes |
| PowerClip | Yes | Yes |
| Text on path | Yes | Yes |
| Multi-page | Yes | Yes |
| CMYK entry | Yes | Yes |
| Price | Subscription / ~$549 | Free |
| Install size | ~4 GB | ~250 KB |
| Platforms | Windows (+ limited Mac) | Any browser, PWA, Windows, macOS, Linux |
| Offline | Yes | Yes (service worker) |
| Startup | Tens of seconds | Instant |

> "Who builds a serious app with HTML?" — Figma, Canva, Photoshop Web, and
> VS Code, among others. The trick is doing it properly.
