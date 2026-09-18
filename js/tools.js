/* ============================================================
   Graphene — tools & pointer interaction
   ============================================================ */
"use strict";

const TOOLS = [
  { id: "select",  key: "V", name: "Select", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2l12 11-6 .6 3.4 6.8-2.7 1.3L9.3 15 6 19z"/></svg>' },
  { id: "node",    key: "A", name: "Node edit", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 18C8 6 16 6 20 18"/><rect x="2" y="16" width="4.5" height="4.5" fill="currentColor" stroke="none"/><rect x="17.5" y="16" width="4.5" height="4.5" fill="currentColor" stroke="none"/><circle cx="12" cy="9" r="2" fill="currentColor" stroke="none"/></svg>' },
  { sep: true },
  { id: "pen",     key: "P", name: "Pen (bezier)", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.5 2.5l7 7L9 22l-7 .1L2 15zM4.6 16.2l3.2 3.2 9.4-9.4-3.2-3.2z" fill-rule="evenodd"/></svg>' },
  { id: "pencil",  key: "B", name: "Pencil (freehand)", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21c0-6 3-14 9-14s5 6 1 8-7-2-2-6 10-4 10-4"/></svg>' },
  { sep: true },
  { id: "rect",    key: "R", name: "Rectangle", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="1.5"/></svg>' },
  { id: "ellipse", key: "E", name: "Ellipse", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>' },
  { id: "polygon", key: "G", name: "Polygon", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z"/></svg>' },
  { id: "star",    key: "S", name: "Star", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l2.4 5.9 6.3.4-4.9 4 1.6 6.2L12 16l-5.4 3.5 1.6-6.2-4.9-4 6.3-.4z"/></svg>' },
  { id: "line",    key: "L", name: "Line", icon: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.6" fill="currentColor" stroke="none"/></svg>' },
  { id: "text",    key: "T", name: "Text", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v4h-2.2V6.5H13.2v11h2.3V20H8.5v-2.5h2.3v-11H6.2V8H4z"/></svg>' },
  { sep: true },
  { id: "pan",     key: "H", name: "Pan", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V11m0-3a1.5 1.5 0 013 0v6.5c0 4-2.5 7-6.5 7-3.4 0-5-1.6-6.7-4.8L3.4 13c-.7-1.4.8-2.7 2-1.8L7 12.7V7a1.5 1.5 0 013-0z"/></svg>' },
];

const DRAW_TOOLS = ["pen", "pencil", "rect", "ellipse", "polygon", "star", "line"];

/* drag state machine */
let drag = null;          // {mode, ...}
let penState = null;      // {pts:[], curDragging, ...}
let spacePan = false;

function setTool(id) {
  if (App.tool === "pen" && id !== "pen") finishPen(false);
  if (App.tool === "text") commitTextEditor();
  App.tool = id;
  if (id !== "node") { App.nodeEdit.id = null; App.nodeEdit.sel = []; }
  else if (App.selection.length === 1) {
    let o = findTop(App.selection[0]);
    if (o && o.type !== "path" && o.type !== "group" && o.type !== "text") {
      const p = convertToPath(o);
      const i = App.objects.indexOf(o);
      if (p !== o) { App.objects[i] = p; commit("convert to path"); }
      o = p;
    }
    if (o && o.type === "path") App.nodeEdit.id = o.id;
  }
  $$(".tool").forEach(b => b.classList.toggle("active", b.dataset.tool === id));
  stage.classList.toggle("tool-pan", id === "pan");
  stage.classList.toggle("tool-draw", DRAW_TOOLS.includes(id) || id === "node");
  stage.classList.toggle("tool-text", id === "text");
  setHint(toolHint(id));
  render(); updateUI();
}

function toolHint(id) {
  return {
    select: "Drag to move · handles to resize · circle to rotate · Shift-click multi-select · drag empty space to marquee",
    node: "Click an anchor to select · drag anchors / handles · Alt-drag anchor pulls out handles · Del removes anchor · dbl-click segment adds anchor",
    pen: "Click = corner point · click-drag = smooth curve · click first point or Enter to close/finish · Esc cancels",
    pencil: "Draw freehand — the stroke is auto-smoothed into a bezier path",
    rect: "Drag to draw · Shift = square · Alt = from center",
    ellipse: "Drag to draw · Shift = circle · Alt = from center",
    polygon: "Drag to draw a polygon · set sides in the panel",
    star: "Drag to draw a star · tweak points & inner radius in the panel",
    line: "Drag to draw · Shift constrains to 45°",
    text: "Click on canvas to place text · Esc or click outside finishes editing",
    pan: "Drag to pan · scroll to zoom",
  }[id] || "";
}

/* ---------- hit testing ---------- */
function hitObject(e) {
  const t = e.target.closest("[data-id]");
  if (!t || !gObjects.contains(t)) return null;
  // resolve to top-level object
  let id = t.dataset.id;
  let node = t;
  while (node && node.parentNode !== gObjects) node = node.parentNode;
  if (node && node.dataset && node.dataset.id) id = node.dataset.id;
  const o = findTop(id);
  return o && !o.locked ? o : null;
}

/* ---------- pointer events ---------- */
stage.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
stage.addEventListener("dblclick", onDblClick);
stage.addEventListener("wheel", onWheel, { passive: false });

function onPointerDown(e) {
  if (e.button === 1 || spacePan || App.tool === "pan") {
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, px: App.panX, py: App.panY };
    stage.classList.add("panning");
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  const w = screenToWorld(e.clientX, e.clientY);

  switch (App.tool) {
    case "select": selectDown(e, w); break;
    case "node": nodeDown(e, w); break;
    case "pen": penDown(e, w); break;
    case "pencil":
      drag = { mode: "pencil", raw: [snapPt(w)] };
      break;
    case "rect": case "ellipse": case "polygon": case "star": case "line":
      drag = { mode: "draw", tool: App.tool, start: snapPt(w), obj: null, alt: e.altKey };
      break;
    case "text": textDown(e, w); break;
  }
  if (drag) stage.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  const w = screenToWorld(e.clientX, e.clientY);
  $("#st-pos").textContent = `${Math.round(w.x)}, ${Math.round(w.y)}`;

  if (penState && !drag) { drawPenPreview(penState.pts, constrainPen(w, e.shiftKey), penNearStart(w)); }

  if (!drag) return;
  switch (drag.mode) {
    case "pan":
      App.panX = drag.px + e.clientX - drag.sx;
      App.panY = drag.py + e.clientY - drag.sy;
      gWorld.setAttribute("transform", `translate(${App.panX} ${App.panY}) scale(${App.zoom})`);
      break;
    case "move": moveDrag(e, w); break;
    case "resize": resizeDrag(e, w); break;
    case "rotate": rotateDrag(e, w); break;
    case "marquee": marqueeDrag(e, w); break;
    case "draw": shapeDrag(e, w); break;
    case "pencil":
      drag.raw.push(w);
      drawPenPreview(drag.raw.map(p => anchor(p.x, p.y)), null, false);
      break;
    case "pen-handle": penHandleDrag(e, w); break;
    case "node-move": nodeMoveDrag(e, w); break;
    case "node-handle": nodeHandleDrag(e, w); break;
  }
}

function onPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null;
  stage.classList.remove("panning");

  switch (d.mode) {
    case "move":
      if (d.moved) commit("move");
      break;
    case "resize": commit("resize"); break;
    case "rotate": commit("rotate"); break;
    case "marquee": clearMarquee(); updateUI(); break;
    case "draw":
      if (d.obj) {
        const b = worldBBox(d.obj);
        if (b.w < 2 && b.h < 2 && d.obj.type !== "line") { removeObj(d.obj.id); render(); }
        else { App.selection = [d.obj.id]; commit("draw " + d.obj.type); setTool("select"); }
      }
      break;
    case "pencil": finishPencil(d.raw); break;
    case "pen-handle":
      penState.dragIdx = null;
      drawPenPreview(penState.pts, null, false);
      break;
    case "node-move": case "node-handle": commit("edit nodes"); break;
  }
  updateUI();
}

/* ---------- wheel zoom ---------- */
function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAt(e.clientX, e.clientY, App.zoom * factor);
}
function zoomAt(sx, sy, z) {
  z = clamp(z, 0.05, 32);
  const r = stage.getBoundingClientRect();
  const wx = (sx - r.left - App.panX) / App.zoom;
  const wy = (sy - r.top - App.panY) / App.zoom;
  App.zoom = z;
  App.panX = sx - r.left - wx * z;
  App.panY = sy - r.top - wy * z;
  render(); updateZoomLabel();
}
function zoomFit() {
  const r = stage.getBoundingClientRect();
  const pad = 60;
  const z = clamp(Math.min((r.width - pad) / App.doc.w, (r.height - pad) / App.doc.h), 0.05, 8);
  App.zoom = z;
  App.panX = (r.width - App.doc.w * z) / 2;
  App.panY = (r.height - App.doc.h * z) / 2;
  render(); updateZoomLabel();
}

/* ============================================================
   SELECT tool
   ============================================================ */
function selectDown(e, w) {
  const handle = e.target.getAttribute && e.target.getAttribute("data-handle");
  if (handle && App.selection.length) {
    if (handle === "rotate") {
      const bb = selectionBBox();
      drag = { mode: "rotate", cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2, start: JSON.parse(JSON.stringify(selectedObjs())), a0: Math.atan2(w.y - (bb.y + bb.h / 2), w.x - (bb.x + bb.w / 2)) };
    } else {
      drag = { mode: "resize", handle, bb0: selectionBBox(), start: JSON.parse(JSON.stringify(selectedObjs())) };
    }
    return;
  }

  const o = hitObject(e);
  if (o) {
    if (e.shiftKey) {
      const i = App.selection.indexOf(o.id);
      if (i >= 0) App.selection.splice(i, 1); else App.selection.push(o.id);
      render(); updateUI();
      if (!App.selection.includes(o.id)) return;
    } else if (!App.selection.includes(o.id)) {
      App.selection = [o.id];
      render(); updateUI();
    }
    drag = { mode: "move", w0: w, orig: JSON.parse(JSON.stringify(selectedObjs())), moved: false };
  } else {
    if (!e.shiftKey) { App.selection = []; render(); updateUI(); }
    drag = { mode: "marquee", start: w, add: e.shiftKey, base: e.shiftKey ? [...App.selection] : [] };
  }
}

function moveDrag(e, w) {
  let dx = w.x - drag.w0.x, dy = w.y - drag.w0.y;
  if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  if (App.doc.grid.snap) { const g = App.doc.grid.size; dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; }
  if (dx || dy) drag.moved = true;
  const objs = selectedObjs();
  objs.forEach((o, i) => {
    const orig = drag.orig[i];
    const cp = JSON.parse(JSON.stringify(orig));
    moveObj(cp, dx, dy);
    Object.assign(o, cp);
  });
  render(); syncTransformInputs();
}

function resizeDrag(e, w) {
  const b = drag.bb0;
  const h = drag.handle;
  let ax, ay; // anchor (fixed corner)
  ax = h.includes("w") ? b.x + b.w : h.includes("e") ? b.x : b.x + b.w / 2;
  ay = h.includes("n") ? b.y + b.h : h.includes("s") ? b.y : b.y + b.h / 2;
  const px = snapVal(w.x), py = snapVal(w.y);

  let sx = h.includes("e") || h.includes("w") ? (px - ax) / ((h.includes("w") ? b.x : b.x + b.w) - ax) : 1;
  let sy = h.includes("n") || h.includes("s") ? (py - ay) / ((h.includes("n") ? b.y : b.y + b.h) - ay) : 1;
  if (!isFinite(sx) || sx === 0) sx = 0.001;
  if (!isFinite(sy) || sy === 0) sy = 0.001;
  if (e.shiftKey) {
    const u = Math.max(Math.abs(sx), Math.abs(sy));
    sx = (sx < 0 ? -1 : 1) * u; sy = (sy < 0 ? -1 : 1) * u;
    if (!(h.includes("e") || h.includes("w"))) sx = sy;
    if (!(h.includes("n") || h.includes("s"))) sy = sx;
  }

  const objs = selectedObjs();
  objs.forEach((o, i) => {
    const cp = JSON.parse(JSON.stringify(drag.start[i]));
    scaleObj(cp, sx, sy, ax, ay);
    Object.assign(o, cp);
  });
  render(); syncTransformInputs();
}

function rotateDrag(e, w) {
  const a1 = Math.atan2(w.y - drag.cy, w.x - drag.cx);
  let deg = (a1 - drag.a0) * 180 / Math.PI;
  if (e.shiftKey) deg = Math.round(deg / 15) * 15;
  const objs = selectedObjs();
  objs.forEach((o, i) => {
    const orig = drag.start[i];
    const cp = JSON.parse(JSON.stringify(orig));
    if (objs.length === 1) {
      cp.rot = ((orig.rot || 0) + deg) % 360;
    } else {
      // rotate object centers around group center, plus own rotation
      const b = worldBBox(orig);
      const c0 = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const c1 = rotPt(c0.x, c0.y, drag.cx, drag.cy, deg);
      moveObj(cp, c1.x - c0.x, c1.y - c0.y);
      cp.rot = ((orig.rot || 0) + deg) % 360;
    }
    Object.assign(o, cp);
  });
  render(); syncTransformInputs();
}

function marqueeDrag(e, w) {
  const x = Math.min(drag.start.x, w.x), y = Math.min(drag.start.y, w.y);
  const mw = Math.abs(w.x - drag.start.x), mh = Math.abs(w.y - drag.start.y);
  drawMarquee(x, y, mw, mh);
  const hit = App.objects.filter(o => {
    if (!o.visible || o.locked) return false;
    const b = worldBBox(o);
    return b.x < x + mw && b.x + b.w > x && b.y < y + mh && b.y + b.h > y;
  }).map(o => o.id);
  App.selection = drag.add ? [...new Set([...drag.base, ...hit])] : hit;
  renderOverlay();
  // keep marquee on top
  const m = $("#marquee-rect");
  if (m) gOverlay.appendChild(m); else drawMarquee(x, y, mw, mh);
}

/* ============================================================
   SHAPE drawing
   ============================================================ */
function shapeDrag(e, w) {
  const s = drag.start;
  let p = snapPt(w);

  if (drag.tool === "line") {
    if (!drag.obj) {
      drag.obj = makeLine(s.x, s.y, p.x, p.y);
      App.objects.push(drag.obj);
    }
    let dx = p.x - s.x, dy = p.y - s.y;
    if (e.shiftKey) {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      dx = Math.cos(ang) * len; dy = Math.sin(ang) * len;
    }
    drag.obj.x2 = s.x + dx; drag.obj.y2 = s.y + dy;
    render();
    return;
  }

  let x = Math.min(s.x, p.x), y = Math.min(s.y, p.y);
  let ww = Math.abs(p.x - s.x), hh = Math.abs(p.y - s.y);
  if (e.shiftKey) {
    const u = Math.max(ww, hh);
    x = p.x < s.x ? s.x - u : s.x; y = p.y < s.y ? s.y - u : s.y;
    ww = hh = u;
  }
  if (e.altKey) { x = s.x - ww; y = s.y - hh; ww *= 2; hh *= 2; }

  if (!drag.obj) {
    if (drag.tool === "rect") drag.obj = makeRect(x, y, ww, hh);
    else if (drag.tool === "ellipse") drag.obj = makeEllipse(x, y, ww, hh);
    else if (drag.tool === "polygon") drag.obj = makePolygon(x, y, ww, hh, App.lastSides || 6, false);
    else if (drag.tool === "star") drag.obj = makePolygon(x, y, ww, hh, App.lastStarPts || 5, true, App.lastInner || 0.45);
    App.objects.push(drag.obj);
  }
  Object.assign(drag.obj, { x, y, w: ww, h: hh });
  render();
}

/* ============================================================
   PEN tool
   ============================================================ */
function penDown(e, w) {
  let p = constrainPen(snapPt(w), e.shiftKey);
  if (!penState) penState = { pts: [] };

  // close path if clicking near start
  if (penState.pts.length > 2 && penNearStart(w)) { finishPen(true); return; }

  const a = anchor(p.x, p.y);
  penState.pts.push(a);
  drag = { mode: "pen-handle", idx: penState.pts.length - 1 };
  drawPenPreview(penState.pts, null, false);
}

function penHandleDrag(e, w) {
  const a = penState.pts[drag.idx];
  const dx = w.x - a.x, dy = w.y - a.y;
  if (Math.hypot(dx, dy) > 3 / App.zoom) {
    a.hout = { x: a.x + dx, y: a.y + dy };
    a.hin = { x: a.x - dx, y: a.y - dy };
  } else { a.hout = null; a.hin = null; }
  drawPenPreview(penState.pts, null, false);
}

function constrainPen(p, shift) {
  if (!shift || !penState || !penState.pts.length) return p;
  const last = penState.pts[penState.pts.length - 1];
  const dx = p.x - last.x, dy = p.y - last.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: last.x + Math.cos(ang) * len, y: last.y + Math.sin(ang) * len };
}

function penNearStart(w) {
  if (!penState || penState.pts.length < 3) return false;
  const s = penState.pts[0];
  return Math.hypot(w.x - s.x, w.y - s.y) < 8 / App.zoom;
}

function finishPen(close) {
  if (!penState) return;
  const pts = penState.pts;
  penState = null;
  clearPenPreview();
  if (pts.length < 2) { render(); return; }
  const o = makePath(pts, close);
  if (!close) { o.fill.type = "none"; o.stroke = { on: true, color: "#e6e8ee", w: 2.5, style: "solid" }; }
  App.objects.push(o);
  App.selection = [o.id];
  commit("pen path");
  setTool("select");
}

/* ============================================================
   PENCIL — freehand with Ramer-Douglas-Peucker + smoothing
   ============================================================ */
function finishPencil(raw) {
  clearPenPreview();
  if (raw.length < 3) { render(); return; }
  const simplified = rdp(raw, 2.2 / App.zoom);
  const pts = catmullToBezier(simplified);
  const o = makePath(pts, false);
  o.fill.type = "none";
  o.stroke = { on: true, color: "#e6e8ee", w: 2.5, style: "solid" };
  App.objects.push(o);
  App.selection = [o.id];
  commit("pencil");
  setTool("select");
}

function rdp(points, eps) {
  if (points.length < 3) return points.slice();
  let dmax = 0, idx = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}
function catmullToBezier(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n - 1, i + 1)];
    const t = 1 / 6;
    const hout = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t };
    const hin = { x: p1.x - (p2.x - p0.x) * t, y: p1.y - (p2.y - p0.y) * t };
    out.push(anchor(p1.x, p1.y, i === 0 ? null : hin, i === n - 1 ? null : hout));
  }
  return out;
}

/* ============================================================
   NODE tool
   ============================================================ */
function nodeDown(e, w) {
  const hIdx = e.target.getAttribute && e.target.getAttribute("data-node-idx");
  const hKey = e.target.getAttribute && e.target.getAttribute("data-node-handle");

  if (hIdx != null && hKey) {
    drag = { mode: "node-handle", idx: +hIdx, key: hKey, alt: e.altKey };
    return;
  }
  if (hIdx != null) {
    const i = +hIdx;
    if (e.altKey) {
      // alt-drag pulls out handles
      drag = { mode: "node-handle", idx: i, key: "hout", mirror: true };
      return;
    }
    if (e.shiftKey) {
      const s = App.nodeEdit.sel;
      const k = s.indexOf(i);
      if (k >= 0) s.splice(k, 1); else s.push(i);
    } else if (!App.nodeEdit.sel.includes(i)) {
      App.nodeEdit.sel = [i];
    }
    const o = findTop(App.nodeEdit.id);
    drag = { mode: "node-move", w0: w, orig: JSON.parse(JSON.stringify(o.pts)) };
    render();
    return;
  }

  // click on an object: enter node editing for it
  const o = hitObject(e);
  if (o) {
    let target = o;
    if (o.type !== "path" && o.type !== "group" && o.type !== "text") {
      const p = convertToPath(o);
      const i = App.objects.indexOf(o);
      if (p !== o) { App.objects[i] = p; commit("convert to path"); }
      target = p;
    }
    if (target.type === "path") {
      App.nodeEdit.id = target.id; App.nodeEdit.sel = [];
      App.selection = [target.id];
      render(); updateUI();
      return;
    }
  }
  App.nodeEdit.sel = [];
  render();
}

function nodeMoveDrag(e, w) {
  const o = findTop(App.nodeEdit.id);
  if (!o) return;
  let dx = w.x - drag.w0.x, dy = w.y - drag.w0.y;
  if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  for (const i of App.nodeEdit.sel) {
    const src = drag.orig[i], dst = o.pts[i];
    dst.x = snapVal(src.x + dx); dst.y = snapVal(src.y + dy);
    const rx = dst.x - src.x, ry = dst.y - src.y;
    dst.hin = src.hin ? { x: src.hin.x + rx, y: src.hin.y + ry } : null;
    dst.hout = src.hout ? { x: src.hout.x + rx, y: src.hout.y + ry } : null;
  }
  render();
}

function nodeHandleDrag(e, w) {
  const o = findTop(App.nodeEdit.id);
  if (!o) return;
  const p = o.pts[drag.idx];
  p[drag.key] = { x: w.x, y: w.y };
  const other = drag.key === "hout" ? "hin" : "hout";
  // mirror unless Alt held (broken handles)
  if ((drag.mirror || !e.altKey) && !drag.broken) {
    p[other] = { x: 2 * p.x - w.x, y: 2 * p.y - w.y };
  }
  if (e.altKey && !drag.mirror) drag.broken = true;
  if (!App.nodeEdit.sel.includes(drag.idx)) App.nodeEdit.sel = [drag.idx];
  render();
}

function onDblClick(e) {
  const w = screenToWorld(e.clientX, e.clientY);
  if (App.tool === "pen") { finishPen(false); return; }
  if (App.tool === "node") {
    const o = findTop(App.nodeEdit.id);
    if (o && o.type === "path") {
      // dbl-click near a segment inserts an anchor
      const idx = nearestSegment(o, w);
      if (idx >= 0) {
        o.pts.splice(idx + 1, 0, anchor(w.x, w.y));
        App.nodeEdit.sel = [idx + 1];
        commit("add anchor");
        render();
        return;
      }
    }
    return;
  }
  if (App.tool === "select") {
    const o = hitObject(e);
    if (o && o.type === "text") { startTextEditor(o); return; }
    if (o && o.type === "path") { setTool("node"); App.nodeEdit.id = o.id; App.selection = [o.id]; render(); updateUI(); return; }
    if (o && o.type !== "group") { setTool("node"); return; }
  }
}

function nearestSegment(o, w) {
  let best = -1, bestD = 12 / App.zoom;
  const n = o.pts.length;
  const count = o.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = o.pts[i], b = o.pts[(i + 1) % n];
    // sample bezier
    const c1 = a.hout || a, c2 = b.hin || b;
    for (let t = 0.05; t < 1; t += 0.05) {
      const mt = 1 - t;
      const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x;
      const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y;
      const d = Math.hypot(w.x - x, w.y - y);
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

function deleteSelectedNodes() {
  const o = findTop(App.nodeEdit.id);
  if (!o || !App.nodeEdit.sel.length) return false;
  o.pts = o.pts.filter((_, i) => !App.nodeEdit.sel.includes(i));
  App.nodeEdit.sel = [];
  if (o.pts.length < 2) { removeObj(o.id); App.nodeEdit.id = null; App.selection = []; }
  commit("delete anchors");
  render(); updateUI();
  return true;
}

/* ============================================================
   TEXT tool
   ============================================================ */
let editingText = null;

function textDown(e, w) {
  if (editingText) { commitTextEditor(); return; }
  const hit = hitObject(e);
  if (hit && hit.type === "text") { startTextEditor(hit); return; }
  const o = makeText(snapVal(w.x), snapVal(w.y), "");
  App.objects.push(o);
  App.selection = [o.id];
  render(); updateUI();
  startTextEditor(o, true);
}

function startTextEditor(o, isNew) {
  commitTextEditor();
  editingText = { id: o.id, isNew: !!isNew, prev: o.text };
  const holder = $("#text-editor-holder");
  const ta = document.createElement("textarea");
  ta.value = o.text || "";
  const r = stage.getBoundingClientRect();
  const sx = o.x * App.zoom + App.panX;
  const sy = (o.y - o.size) * App.zoom + App.panY;
  ta.style.left = sx + "px";
  ta.style.top = sy + "px";
  ta.style.font = `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}${o.size * App.zoom}px ${o.font}`;
  ta.style.lineHeight = 1.2;
  ta.style.color = o.fill.type === "solid" ? o.fill.color : o.fill.a;
  ta.style.width = Math.max(140, (localBBox(o).w + 40) * App.zoom) + "px";
  ta.style.height = Math.max(o.size * 1.5 * App.zoom, (localBBox(o).h + 20) * App.zoom) + "px";
  holder.appendChild(ta);
  // hide the SVG text while editing
  const el = $(`[data-id="${o.id}"]`);
  if (el) el.style.opacity = 0;
  ta.focus();
  if (!isNew) ta.select();

  const grow = () => {
    ta.style.width = Math.max(140, ta.scrollWidth + 20) + "px";
    ta.style.height = ta.scrollHeight + 8 + "px";
  };
  ta.addEventListener("input", grow);
  ta.addEventListener("keydown", ev => {
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); commitTextEditor(); }
  });
  ta.addEventListener("pointerdown", ev => ev.stopPropagation());
  ta.addEventListener("blur", () => commitTextEditor());
  editingText.ta = ta;
}

function commitTextEditor() {
  if (!editingText) return;
  const et = editingText; editingText = null;
  const o = findTop(et.id);
  if (et.ta) et.ta.remove();
  if (!o) return;
  const val = et.ta ? et.ta.value : o.text;
  if (!val.trim()) {
    removeObj(o.id);
    App.selection = App.selection.filter(id => id !== o.id);
    render(); updateUI();
    if (!et.isNew) commit("delete text");
    return;
  }
  o.text = val;
  render(); updateUI();
  if (et.isNew || val !== et.prev) commit(et.isNew ? "add text" : "edit text");
  if (et.isNew) setTool("select");
}

/* keyboard flag for space-pan */
window.addEventListener("keydown", e => {
  if (e.code === "Space" && !editingText && !e.repeat && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "SELECT") {
    spacePan = true; stage.classList.add("tool-pan"); e.preventDefault();
  }
});
window.addEventListener("keyup", e => {
  if (e.code === "Space") {
    spacePan = false;
    if (App.tool !== "pan") stage.classList.remove("tool-pan");
  }
});
