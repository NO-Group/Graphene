/* ============================================================
   Graphene — pro features: rulers & guides, context menu,
   image/SVG import, combine/break-apart, effects, PWA glue
   ============================================================ */
"use strict";

/* ============================================================
   Rulers
   ============================================================ */
const rulerH = $("#ruler-h"), rulerV = $("#ruler-v");
const RULER = 22;

function setRulers(on) {
  App.rulers = on;
  document.body.classList.toggle("rulers-on", on);
  requestAnimationFrame(() => { drawRulers(); render(); });
}

function niceStep(px) {
  // choose a world step that lands near `px` screen pixels
  const raw = px / App.zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (pow * m >= raw) return pow * m;
  return pow * 10;
}

function drawRulers() {
  if (!App.rulers) return;
  const wrap = $("#canvas-wrap");
  const W = wrap.clientWidth - RULER, H = wrap.clientHeight - RULER;
  if (W <= 0 || H <= 0) return;
  const dpr = window.devicePixelRatio || 1;

  for (const [cv, len, horiz] of [[rulerH, W, true], [rulerV, H, false]]) {
    const h = RULER;
    cv.width = (horiz ? len : h) * dpr;
    cv.height = (horiz ? h : len) * dpr;
    cv.style.width = (horiz ? len : h) + "px";
    cv.style.height = (horiz ? h : len) + "px";
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#1d1f26";
    ctx.fillRect(0, 0, horiz ? len : h, horiz ? h : len);
    ctx.strokeStyle = "#3a3e4a";
    ctx.fillStyle = "#9aa0ad";
    ctx.font = "9px system-ui";
    ctx.beginPath();

    const step = niceStep(60);
    const minor = step / 5;
    const pan = horiz ? App.panX : App.panY;
    const start = Math.floor((-pan / App.zoom) / minor) * minor;
    const end = (len - pan / 1) / App.zoom + step;

    for (let v = start; v < (-pan + len) / App.zoom + step; v += minor) {
      const s = v * App.zoom + pan;
      if (s < 0 || s > len) continue;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const tick = major ? 14 : 5;
      if (horiz) { ctx.moveTo(s + .5, RULER); ctx.lineTo(s + .5, RULER - tick); }
      else { ctx.moveTo(RULER, s + .5); ctx.lineTo(RULER - tick, s + .5); }
      if (major) {
        const label = String(Math.round(v));
        if (horiz) ctx.fillText(label, s + 3, 9);
        else {
          ctx.save(); ctx.translate(9, s + 3); ctx.rotate(Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore();
        }
      }
    }
    ctx.stroke();

    // page extent highlight
    ctx.fillStyle = "rgba(124,92,255,.18)";
    const p0 = 0 * App.zoom + pan, p1 = (horiz ? App.doc.w : App.doc.h) * App.zoom + pan;
    if (horiz) ctx.fillRect(p0, 0, p1 - p0, 3); else ctx.fillRect(0, p0, 3, p1 - p0);
  }
}

/* drag a new guide out of a ruler */
function rulerDrag(fromH) {
  return function (e) {
    e.preventDefault();
    const axis = fromH ? "h" : "v";
    const arr = App.doc.guides[axis];
    arr.push(fromH ? -99999 : -99999);
    const gi = arr.length - 1;
    const move = ev => {
      const w = screenToWorld(ev.clientX, ev.clientY);
      arr[gi] = snapVal(fromH ? w.y : w.x);
      renderGuides();
    };
    const up = ev => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const w = screenToWorld(ev.clientX, ev.clientY);
      const v = fromH ? w.y : w.x;
      const limit = fromH ? App.doc.h : App.doc.w;
      if (v < -2000 || v > limit + 2000) arr.splice(gi, 1);
      else arr[gi] = snapVal(v);
      commit("add guide");
      renderGuides();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}
rulerH.addEventListener("pointerdown", rulerDrag(true));
rulerV.addEventListener("pointerdown", rulerDrag(false));

window.addEventListener("resize", drawRulers);

/* ============================================================
   Context menu (right-click)
   ============================================================ */
const ctxMenu = $("#ctx-menu");

stage.addEventListener("contextmenu", e => {
  e.preventDefault();
  const o = hitObject(e);
  if (o && !App.selection.includes(o.id)) {
    App.selection = [o.id];
    render(); updateUI();
  }
  const has = App.selection.length > 0;
  const multi = App.selection.length > 1;
  const one = App.selection.length === 1 ? findTop(App.selection[0]) : null;

  ctxMenu.innerHTML = [
    has ? `<button data-cmd="cut">Cut <kbd>Ctrl+X</kbd></button>` : "",
    has ? `<button data-cmd="copy">Copy <kbd>Ctrl+C</kbd></button>` : "",
    App.clipboard ? `<button data-cmd="paste">Paste <kbd>Ctrl+V</kbd></button>` : "",
    has ? `<button data-cmd="duplicate">Duplicate <kbd>Ctrl+D</kbd></button>` : "",
    has ? `<button data-cmd="delete">Delete <kbd>Del</kbd></button>` : "",
    has ? `<hr>` : "",
    multi ? `<button data-cmd="group">Group <kbd>Ctrl+G</kbd></button>` : "",
    one && one.type === "group" ? `<button data-cmd="ungroup">Ungroup <kbd>Ctrl+Shift+G</kbd></button>` : "",
    has ? `<button data-cmd="front">Bring to Front <kbd>]</kbd></button>` : "",
    has ? `<button data-cmd="back">Send to Back <kbd>[</kbd></button>` : "",
    has ? `<hr>` : "",
    has ? `<button data-cmd="to-path">Convert to Path <kbd>Ctrl+Shift+C</kbd></button>` : "",
    multi ? `<button data-cmd="combine">Combine Paths <kbd>Ctrl+L</kbd></button>` : "",
    one && one.type === "path" ? `<button data-cmd="break-apart">Break Apart <kbd>Ctrl+K</kbd></button>` : "",
    multi ? `<hr>` : "",
    multi ? `<button data-cmd="shape-weld">Weld <kbd>Ctrl+W</kbd></button>` : "",
    multi ? `<button data-cmd="shape-trim">Trim</button>` : "",
    multi ? `<button data-cmd="shape-intersect">Intersect</button>` : "",
    multi ? `<button data-cmd="shape-exclude">Exclude</button>` : "",
    multi ? `<button data-cmd="powerclip">PowerClip Inside</button>` : "",
    one && one.type === "group" && one.clipWith ? `<button data-cmd="release-clip">Release PowerClip</button>` : "",
    has ? `<hr>` : "",
    has ? `<button data-cmd="lock">Lock <kbd>Ctrl+2</kbd></button>` : "",
    `<hr>`,
    `<button data-cmd="paste-here" data-x="${e.clientX}" data-y="${e.clientY}" ${App.clipboard ? "" : "disabled"}>Paste Here</button>`,
    `<button data-cmd="select-all">Select All <kbd>Ctrl+A</kbd></button>`,
    `<button data-cmd="zoom-fit">Fit Page</button>`,
  ].filter(Boolean).join("");

  ctxMenu.hidden = false;
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(e.clientX, innerWidth - mw - 8) + "px";
  ctxMenu.style.top = Math.min(e.clientY, innerHeight - mh - 8) + "px";
});

document.addEventListener("pointerdown", e => {
  if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) ctxMenu.hidden = true;
});
ctxMenu.addEventListener("click", e => {
  const b = e.target.closest("[data-cmd]");
  if (!b) return;
  ctxMenu.hidden = true;
  if (b.dataset.cmd === "paste-here") {
    pasteAt(+b.dataset.x, +b.dataset.y);
  }
  // other cmds handled by the global [data-cmd] dispatcher in ui.js
});

function pasteAt(sx, sy) {
  if (!App.clipboard) return;
  const objs = JSON.parse(App.clipboard);
  const w = screenToWorld(sx, sy);
  // compute clipboard bbox
  let bb = null;
  for (const o of objs) { const b = worldBBox(o); bb = bb ? unionBB(bb, b) : b; }
  const dx = w.x - (bb.x + bb.w / 2), dy = w.y - (bb.y + bb.h / 2);
  const ids = [];
  for (const o of objs) {
    reassignIds(o);
    moveObj(o, dx, dy);
    App.objects.push(o);
    ids.push(o.id);
  }
  App.selection = ids;
  commit("paste");
  render(); updateUI();
}

/* ============================================================
   Image import (file picker + drag-drop + paste)
   ============================================================ */
function importImageFile(file, atPt) {
  if (!file || !file.type.startsWith("image/")) return;
  if (file.type === "image/svg+xml") { importSVGFile(file); return; }
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxSide = Math.min(App.doc.w, App.doc.h) * 0.8;
      let w = img.naturalWidth, h = img.naturalHeight;
      const sc = Math.min(1, maxSide / Math.max(w, h));
      w *= sc; h *= sc;
      const cx = atPt ? atPt.x : App.doc.w / 2, cy = atPt ? atPt.y : App.doc.h / 2;
      const o = makeImage(cx - w / 2, cy - h / 2, w, h, rd.result);
      o.name = file.name.replace(/\.[^.]+$/, "");
      App.objects.push(o);
      App.selection = [o.id];
      commit("import image");
      render(); updateUI();
      setHint(`Imported ${file.name} ✓`);
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

$("#file-image").addEventListener("change", e => {
  for (const f of e.target.files) importImageFile(f);
  e.target.value = "";
});

/* drag & drop onto canvas */
$("#canvas-wrap").addEventListener("dragover", e => e.preventDefault());
$("#canvas-wrap").addEventListener("drop", e => {
  e.preventDefault();
  const pt = screenToWorld(e.clientX, e.clientY);
  for (const f of e.dataTransfer.files) {
    if (f.type === "image/svg+xml" || /\.svg$/i.test(f.name)) importSVGFile(f);
    else if (f.type.startsWith("image/")) importImageFile(f, pt);
    else if (/\.(json|graphene)$/i.test(f.name)) openProjectFile(f);
  }
});

/* paste image from clipboard */
window.addEventListener("paste", e => {
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  for (const item of (e.clipboardData || {}).items || []) {
    if (item.type.startsWith("image/")) {
      importImageFile(item.getAsFile());
      e.preventDefault();
      return;
    }
  }
});

/* ============================================================
   SVG import — parses basic shapes & paths into native objects
   ============================================================ */
$("#file-svg").addEventListener("change", e => {
  for (const f of e.target.files) importSVGFile(f);
  e.target.value = "";
});

function importSVGFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const parsed = parseSVGDocument(rd.result);
      if (!parsed.length) { setHint("SVG had no supported shapes — imported as image instead"); importSVGAsImage(rd.result, file.name); return; }
      const ids = [];
      for (const o of parsed) { App.objects.push(o); ids.push(o.id); }
      App.selection = ids;
      if (ids.length > 1) groupSelection(); else { commit("import svg"); render(); updateUI(); }
      setHint(`Imported ${file.name}: ${parsed.length} object(s) ✓`);
    } catch (err) {
      importSVGAsImage(rd.result, file.name);
    }
  };
  rd.readAsText(file);
}

function importSVGAsImage(svgText, name) {
  const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
  const img = new Image();
  img.onload = () => {
    const o = makeImage(60, 60, img.naturalWidth || 300, img.naturalHeight || 300, url);
    o.name = (name || "SVG").replace(/\.[^.]+$/, "");
    App.objects.push(o);
    App.selection = [o.id];
    commit("import svg");
    render(); updateUI();
  };
  img.src = url;
}

function parseSVGDocument(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("bad svg");
  const out = [];
  const walk = (el, style) => {
    const st = Object.assign({}, style, readStyle(el));
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === "g" || tag === "svg") { walk(child, st); continue; }
      const o = svgElToObj(child, Object.assign({}, st, readStyle(child)));
      if (o) out.push(o);
    }
  };
  walk(doc.documentElement, {});
  return out;
}

function readStyle(el) {
  const s = {};
  const get = n => el.getAttribute && el.getAttribute(n);
  if (get("fill") != null) s.fill = get("fill");
  if (get("stroke") != null) s.stroke = get("stroke");
  if (get("stroke-width") != null) s.strokeW = parseFloat(get("stroke-width"));
  if (get("opacity") != null) s.opacity = parseFloat(get("opacity"));
  const styleAttr = get("style");
  if (styleAttr) for (const part of styleAttr.split(";")) {
    const [k, v] = part.split(":").map(x => x && x.trim());
    if (k === "fill") s.fill = v;
    if (k === "stroke") s.stroke = v;
    if (k === "stroke-width") s.strokeW = parseFloat(v);
    if (k === "opacity") s.opacity = parseFloat(v);
  }
  return s;
}

function applyImportStyle(o, st) {
  if (st.fill && st.fill !== "none") { o.fill.type = "solid"; o.fill.color = normColor(st.fill); o.fill.a = o.fill.color; }
  else if (st.fill === "none") o.fill.type = "none";
  if (st.stroke && st.stroke !== "none") o.stroke = { on: true, color: normColor(st.stroke), w: st.strokeW || 1, style: "solid" };
  if (st.opacity != null && !isNaN(st.opacity)) o.opacity = clamp(st.opacity, 0, 1);
  return o;
}
function normColor(c) {
  const ctx = normColor._c || (normColor._c = document.createElement("canvas").getContext("2d"));
  ctx.fillStyle = "#000"; ctx.fillStyle = c;
  return ctx.fillStyle;
}

function svgElToObj(el, st) {
  const n = name => parseFloat(el.getAttribute(name)) || 0;
  switch (el.tagName.toLowerCase()) {
    case "rect": {
      const o = makeRect(n("x"), n("y"), n("width"), n("height"));
      o.rx = n("rx");
      return applyImportStyle(o, st);
    }
    case "circle": {
      const r = n("r");
      return applyImportStyle(makeEllipse(n("cx") - r, n("cy") - r, r * 2, r * 2), st);
    }
    case "ellipse": {
      const rx = n("rx"), ry = n("ry");
      return applyImportStyle(makeEllipse(n("cx") - rx, n("cy") - ry, rx * 2, ry * 2), st);
    }
    case "line": {
      const o = makeLine(n("x1"), n("y1"), n("x2"), n("y2"));
      return applyImportStyle(o, st);
    }
    case "polygon": case "polyline": {
      const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(anchor(nums[i], nums[i + 1]));
      if (pts.length < 2) return null;
      const o = makePath(pts, el.tagName.toLowerCase() === "polygon");
      return applyImportStyle(o, st);
    }
    case "path": {
      const pts = parsePathD(el.getAttribute("d") || "");
      if (!pts || pts.pts.length < 2) return null;
      const o = makePath(pts.pts, pts.closed);
      return applyImportStyle(o, st);
    }
    case "text": {
      const o = makeText(n("x"), n("y"), el.textContent.trim() || "Text");
      o.size = parseFloat(el.getAttribute("font-size")) || 16;
      return applyImportStyle(o, st);
    }
  }
  return null;
}

/* minimal path-d parser: M L H V C S Q T Z (absolute & relative). Arcs are linearized. */
function parsePathD(d) {
  const tokens = d.match(/[a-zA-Z]|-?[\d.]+(?:e-?\d+)?/g);
  if (!tokens) return null;
  let i = 0, cmd = "", cx = 0, cy = 0, sx = 0, sy = 0, closed = false;
  let prevC = null; // for S/T reflection
  const pts = [];
  const num = () => parseFloat(tokens[i++]);
  const push = (x, y) => pts.push(anchor(x, y));

  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") { closed = true; cx = sx; cy = sy; prevC = null; if (i < tokens.length && /[a-zA-Z]/.test(tokens[i])) continue; else continue; }
    switch (C) {
      case "M": {
        let x = num(), y = num();
        if (rel) { x += cx; y += cy; }
        cx = sx = x; cy = sy = y; push(x, y); prevC = null;
        cmd = rel ? "l" : "L";
        break;
      }
      case "L": {
        let x = num(), y = num();
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y; push(x, y); prevC = null;
        break;
      }
      case "H": { let x = num(); if (rel) x += cx; cx = x; push(cx, cy); prevC = null; break; }
      case "V": { let y = num(); if (rel) y += cy; cy = y; push(cx, cy); prevC = null; break; }
      case "C": {
        let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        const last = pts[pts.length - 1];
        if (last) last.hout = { x: x1, y: y1 };
        pts.push(anchor(x, y, { x: x2, y: y2 }, null));
        cx = x; cy = y; prevC = { x: x2, y: y2 };
        break;
      }
      case "S": {
        let x2 = num(), y2 = num(), x = num(), y = num();
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        const last = pts[pts.length - 1];
        const r = prevC ? { x: 2 * cx - prevC.x, y: 2 * cy - prevC.y } : { x: cx, y: cy };
        if (last) last.hout = r;
        pts.push(anchor(x, y, { x: x2, y: y2 }, null));
        cx = x; cy = y; prevC = { x: x2, y: y2 };
        break;
      }
      case "Q": {
        let qx = num(), qy = num(), x = num(), y = num();
        if (rel) { qx += cx; qy += cy; x += cx; y += cy; }
        // quadratic → cubic
        const last = pts[pts.length - 1];
        if (last) last.hout = { x: cx + 2 / 3 * (qx - cx), y: cy + 2 / 3 * (qy - cy) };
        pts.push(anchor(x, y, { x: x + 2 / 3 * (qx - x), y: y + 2 / 3 * (qy - y) }, null));
        cx = x; cy = y; prevC = { x: qx, y: qy };
        break;
      }
      case "T": {
        let x = num(), y = num();
        if (rel) { x += cx; y += cy; }
        const q = prevC ? { x: 2 * cx - prevC.x, y: 2 * cy - prevC.y } : { x: cx, y: cy };
        const last = pts[pts.length - 1];
        if (last) last.hout = { x: cx + 2 / 3 * (q.x - cx), y: cy + 2 / 3 * (q.y - cy) };
        pts.push(anchor(x, y, { x: x + 2 / 3 * (q.x - x), y: y + 2 / 3 * (q.y - y) }, null));
        cx = x; cy = y; prevC = q;
        break;
      }
      case "A": {
        // linearize arc: consume params, straight line to endpoint
        num(); num(); num(); num(); num();
        let x = num(), y = num();
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y; push(x, y); prevC = null;
        break;
      }
      default: i++; // skip unknown
    }
  }
  return { pts, closed };
}

function openProjectFile(f) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result);
      if (!s.objects || !s.doc) throw new Error("bad");
      App.doc = s.doc;
      if (!App.doc.guides) App.doc.guides = { h: [], v: [] };
      App.objects = s.objects; App.idSeq = s.idSeq || 1000;
      App.selection = []; App.nodeEdit = { id: null, sel: [] };
      App.history = []; App.histIndex = -1;
      commit("open");
      zoomFit(); updateUI();
    } catch (e) { alert("Not a valid Graphene project."); }
  };
  rd.readAsText(f);
}

/* ============================================================
   Combine / Break apart (CorelDRAW-style)
   ============================================================ */
function combinePaths() {
  const objs = selectedObjs().filter(o => !o.locked);
  if (objs.length < 2) { setHint("Select 2+ objects to combine"); return; }
  // convert everything to paths first
  const paths = objs.map(o => {
    if (o.type === "path") return o;
    return convertToPath(JSON.parse(JSON.stringify(o)));
  }).filter(o => o.type === "path");
  if (paths.length < 2) { setHint("Only shapes and paths can be combined"); return; }

  const combined = makePath([], true);
  combined.subpaths = paths.map(p => ({ pts: JSON.parse(JSON.stringify(p.pts)), closed: p.closed !== false }));
  combined.pts = JSON.parse(JSON.stringify(combined.subpaths[0].pts));
  combined.closed = combined.subpaths[0].closed;
  combined.fill = JSON.parse(JSON.stringify(objs[0].fill));
  combined.stroke = JSON.parse(JSON.stringify(objs[0].stroke));
  combined.name = "Combined path";

  const set = new Set(objs.map(o => o.id));
  const insertAt = App.objects.findIndex(o => set.has(o.id));
  App.objects = App.objects.filter(o => !set.has(o.id));
  App.objects.splice(insertAt, 0, combined);
  App.selection = [combined.id];
  commit("combine");
  render(); updateUI();
}

function breakApart() {
  const o = selectedObjs()[0];
  if (!o || o.type !== "path" || !o.subpaths || o.subpaths.length < 2) {
    setHint("Select a combined path to break apart");
    return;
  }
  const idx = App.objects.indexOf(o);
  const parts = o.subpaths.map(sp => {
    const p = makePath(sp.pts, sp.closed);
    p.fill = JSON.parse(JSON.stringify(o.fill));
    p.stroke = JSON.parse(JSON.stringify(o.stroke));
    p.opacity = o.opacity;
    return p;
  });
  App.objects.splice(idx, 1, ...parts);
  App.selection = parts.map(p => p.id);
  commit("break apart");
  render(); updateUI();
}

/* multi-subpath rendering is handled natively by pathD() in core.js */

/* ============================================================
   Lock helpers
   ============================================================ */
function lockSelection() {
  for (const o of selectedObjs()) o.locked = true;
  App.selection = [];
  commit("lock");
  render(); updateUI();
}
function unlockAll() {
  const walk = list => list.forEach(o => { o.locked = false; if (o.type === "group") walk(o.children); });
  walk(App.objects);
  commit("unlock all");
  render(); updateUI();
  setHint("All objects unlocked ✓");
}

/* boot rulers */
setRulers(true);
if (!App.doc.guides) App.doc.guides = { h: [], v: [] };
drawRulers();
