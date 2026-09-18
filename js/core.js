/* ============================================================
   Graphene — core state, geometry, history
   ============================================================ */
"use strict";

const App = {
  doc: {
    w: 1200, h: 800, bg: "#ffffff",
    grid: { show: false, snap: false, size: 20 },
    guides: { h: [], v: [] }
  },
  rulers: true,
  smartGuides: true,
  objects: [],            // z-order: index 0 = back
  selection: [],          // array of ids
  zoom: 1, panX: 0, panY: 0,
  tool: "select",
  clipboard: null,
  history: [], histIndex: -1, HIST_MAX: 100,
  idSeq: 1,
  nodeEdit: { id: null, sel: [] },   // node-tool state
};

const SVGNS = "http://www.w3.org/2000/svg";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deg2rad = d => d * Math.PI / 180;
const uid = () => "o" + (App.idSeq++);
const round2 = v => Math.round(v * 100) / 100;

/* ---------- object factory ---------- */
function baseObj(type) {
  return {
    id: uid(), type, name: "",
    rot: 0, opacity: 1, visible: true, locked: false,
    fill: { type: "solid", color: "#7C5CFF", a: "#7C5CFF", b: "#39D2C0", angle: 90 },
    stroke: { on: false, color: "#22242c", w: 2, style: "solid" },
    fx: { shadow: false, sx: 4, sy: 4, sblur: 8, scolor: "#000000", blur: 0 },
  };
}
/* older saved objects may lack fx */
function ensureFx(o) {
  if (!o.fx) o.fx = { shadow: false, sx: 4, sy: 4, sblur: 8, scolor: "#000000", blur: 0 };
  return o.fx;
}

function makeRect(x, y, w, h)   { return Object.assign(baseObj("rect"),   { x, y, w, h, rx: 0 }); }
function makeEllipse(x, y, w, h){ return Object.assign(baseObj("ellipse"),{ x, y, w, h }); }
function makeLine(x1, y1, x2, y2) {
  const o = Object.assign(baseObj("line"), { x1, y1, x2, y2 });
  o.fill.type = "none"; o.stroke = { on: true, color: "#e6e8ee", w: 3, style: "solid" };
  return o;
}
function makePolygon(x, y, w, h, sides, star, inner) {
  return Object.assign(baseObj("polygon"), { x, y, w, h, sides: sides || 6, star: !!star, inner: inner == null ? 0.5 : inner });
}
function makeText(x, y, text) {
  const o = Object.assign(baseObj("text"), {
    x, y, text: text || "Text", font: "Arial", size: 48,
    bold: false, italic: false, align: "left"
  });
  o.fill.color = "#e6e8ee"; o.fill.a = "#e6e8ee";
  return o;
}
function makePath(pts, closed) {
  const o = Object.assign(baseObj("path"), { pts: pts || [], closed: !!closed });
  return o;
}
function makeGroup(children) { return Object.assign(baseObj("group"), { children: children || [] }); }
function makeImage(x, y, w, h, href) {
  const o = Object.assign(baseObj("image"), { x, y, w, h, href });
  o.fill.type = "none";
  return o;
}

/* anchor point of a path: {x,y, hin:{x,y}|null, hout:{x,y}|null} */
const anchor = (x, y, hin, hout) => ({ x, y, hin: hin || null, hout: hout || null });

/* ---------- lookup ---------- */
function findObj(id, list) {
  list = list || App.objects;
  for (const o of list) {
    if (o.id === id) return o;
    if (o.type === "group") { const r = findObj(id, o.children); if (r) return r; }
  }
  return null;
}
function findTop(id) { return App.objects.find(o => o.id === id) || null; }
function removeObj(id, list) {
  list = list || App.objects;
  const i = list.findIndex(o => o.id === id);
  if (i >= 0) { list.splice(i, 1); return true; }
  for (const o of list) if (o.type === "group" && removeObj(id, o.children)) return true;
  return false;
}
function selectedObjs() { return App.selection.map(id => findTop(id)).filter(Boolean); }

/* ---------- geometry ---------- */
function rotPt(px, py, cx, cy, deg) {
  const a = deg2rad(deg), c = Math.cos(a), s = Math.sin(a);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/* untransformed (local) bbox of an object */
function localBBox(o) {
  switch (o.type) {
    case "rect": case "ellipse": case "polygon": case "image":
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    case "line": {
      const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2);
      return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    }
    case "path": {
      const el = $(`[data-id="${o.id}"]`);
      if (el) { try { const b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } catch (e) {} }
      let xs = [], ys = [];
      for (const p of o.pts) {
        xs.push(p.x); ys.push(p.y);
        if (p.hin) { xs.push(p.hin.x); ys.push(p.hin.y); }
        if (p.hout) { xs.push(p.hout.x); ys.push(p.hout.y); }
      }
      if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 };
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case "text": {
      const el = $(`[data-id="${o.id}"]`);
      if (el) { try { const b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } catch (e) {} }
      const lines = o.text.split("\n");
      const w = Math.max(...lines.map(l => l.length)) * o.size * 0.55;
      return { x: o.x, y: o.y - o.size, w, h: lines.length * o.size * 1.2 };
    }
    case "group": {
      let bb = null;
      for (const c of o.children) {
        const b = worldBBox(c);
        bb = bb ? unionBB(bb, b) : b;
      }
      return bb || { x: 0, y: 0, w: 0, h: 0 };
    }
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function unionBB(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/* axis-aligned bbox including rotation */
function worldBBox(o) {
  const b = localBBox(o);
  if (!o.rot || o.type === "group") return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const cs = [
    rotPt(b.x, b.y, cx, cy, o.rot), rotPt(b.x + b.w, b.y, cx, cy, o.rot),
    rotPt(b.x + b.w, b.y + b.h, cx, cy, o.rot), rotPt(b.x, b.y + b.h, cx, cy, o.rot)
  ];
  const xs = cs.map(p => p.x), ys = cs.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function selectionBBox() {
  let bb = null;
  for (const o of selectedObjs()) { const b = worldBBox(o); bb = bb ? unionBB(bb, b) : b; }
  return bb;
}

/* ---------- transforms on objects ---------- */
function moveObj(o, dx, dy) {
  switch (o.type) {
    case "rect": case "ellipse": case "polygon": case "text": case "image":
      o.x += dx; o.y += dy; break;
    case "line":
      o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; break;
    case "path": {
      const movePts = pts => {
        for (const p of pts) {
          p.x += dx; p.y += dy;
          if (p.hin) { p.hin.x += dx; p.hin.y += dy; }
          if (p.hout) { p.hout.x += dx; p.hout.y += dy; }
        }
      };
      movePts(o.pts);
      if (o.subpaths) for (const sp of o.subpaths) movePts(sp.pts);
      break;
    }
    case "group":
      for (const c of o.children) moveObj(c, dx, dy); break;
  }
}

/* scale object's local geometry around origin (ox,oy) */
function scaleObj(o, sx, sy, ox, oy) {
  const S = (x, y) => ({ x: ox + (x - ox) * sx, y: oy + (y - oy) * sy });
  switch (o.type) {
    case "rect": case "ellipse": case "polygon": case "image": {
      const p = S(o.x, o.y), q = S(o.x + o.w, o.y + o.h);
      o.x = Math.min(p.x, q.x); o.y = Math.min(p.y, q.y);
      o.w = Math.abs(q.x - p.x); o.h = Math.abs(q.y - p.y);
      if (o.type === "rect") o.rx = o.rx * Math.min(Math.abs(sx), Math.abs(sy));
      break;
    }
    case "line": {
      const p = S(o.x1, o.y1), q = S(o.x2, o.y2);
      o.x1 = p.x; o.y1 = p.y; o.x2 = q.x; o.y2 = q.y; break;
    }
    case "path": {
      const scalePts = pts => {
        for (const pt of pts) {
          const p = S(pt.x, pt.y); pt.x = p.x; pt.y = p.y;
          if (pt.hin) { const h = S(pt.hin.x, pt.hin.y); pt.hin.x = h.x; pt.hin.y = h.y; }
          if (pt.hout) { const h = S(pt.hout.x, pt.hout.y); pt.hout.x = h.x; pt.hout.y = h.y; }
        }
      };
      scalePts(o.pts);
      if (o.subpaths) for (const sp of o.subpaths) scalePts(sp.pts);
      break;
    }
    case "text": {
      const p = S(o.x, o.y); o.x = p.x; o.y = p.y;
      o.size = Math.max(2, o.size * Math.abs((Math.abs(sx) + Math.abs(sy)) / 2));
      break;
    }
    case "group":
      for (const c of o.children) {
        scaleObj(c, sx, sy, ox, oy);
        if (c.stroke && c.stroke.on) c.stroke.w = Math.max(0.1, c.stroke.w * (Math.abs(sx) + Math.abs(sy)) / 2);
      }
      break;
  }
}

function flipObj(o, horizontal) {
  const b = worldBBox(o);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (o.type === "group") { for (const c of o.children) flipChild(c, horizontal, cx, cy); return; }
  flipChild(o, horizontal, cx, cy);
}
function flipChild(o, horizontal, cx, cy) {
  if (o.type === "group") { for (const c of o.children) flipChild(c, horizontal, cx, cy); return; }
  scaleObj(o, horizontal ? -1 : 1, horizontal ? 1 : -1, cx, cy);
  if (o.rot) o.rot = -o.rot;
}

/* ---------- shape → path conversion ---------- */
function shapeToPathPts(o) {
  const K = 0.5522847498; // circle bezier constant
  switch (o.type) {
    case "rect": {
      const { x, y, w, h } = o;
      const r = Math.min(o.rx || 0, w / 2, h / 2);
      if (r < 0.01) {
        return [anchor(x, y), anchor(x + w, y), anchor(x + w, y + h), anchor(x, y + h)];
      }
      const k = r * K;
      return [
        anchor(x + r, y, { x: x + r - k, y }, null), anchor(x + w - r, y, null, { x: x + w - r + k, y }),
        anchor(x + w, y + r, { x: x + w, y: y + r - k }, null), anchor(x + w, y + h - r, null, { x: x + w, y: y + h - r + k }),
        anchor(x + w - r, y + h, { x: x + w - r + k, y: y + h }, null), anchor(x + r, y + h, null, { x: x + r - k, y: y + h }),
        anchor(x, y + h - r, { x, y: y + h - r + k }, null), anchor(x, y + r, null, { x, y: y + r - k }),
      ];
    }
    case "ellipse": {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, rx = o.w / 2, ry = o.h / 2;
      const kx = rx * K, ky = ry * K;
      return [
        anchor(cx, cy - ry, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
        anchor(cx + rx, cy, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
        anchor(cx, cy + ry, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
        anchor(cx - rx, cy, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
      ];
    }
    case "polygon":
      return polygonPoints(o).map(p => anchor(p.x, p.y));
    case "line":
      return [anchor(o.x1, o.y1), anchor(o.x2, o.y2)];
  }
  return null;
}

function convertToPath(o) {
  if (o.type === "path" || o.type === "text" || o.type === "group") return o;
  const pts = shapeToPathPts(o);
  if (!pts) return o;
  const p = makePath(pts, o.type !== "line");
  p.id = o.id; p.name = o.name || (cap(o.type) + " path");
  p.rot = o.rot; p.opacity = o.opacity; p.visible = o.visible;
  p.fill = JSON.parse(JSON.stringify(o.fill));
  p.stroke = JSON.parse(JSON.stringify(o.stroke));
  return p;
}

function polygonPoints(o) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, rx = o.w / 2, ry = o.h / 2;
  const n = clamp(o.sides | 0, 3, 120);
  const pts = [];
  const total = o.star ? n * 2 : n;
  for (let i = 0; i < total; i++) {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / total;
    const f = o.star && (i % 2 === 1) ? o.inner : 1;
    pts.push({ x: cx + Math.cos(ang) * rx * f, y: cy + Math.sin(ang) * ry * f });
  }
  return pts;
}

function pathD(o) {
  const pts = o.pts;
  if (!pts.length) return "";
  let d = `M ${round2(pts[0].x)} ${round2(pts[0].y)}`;
  const seg = (a, b) => {
    const c1 = a.hout || a, c2 = b.hin || b;
    if (!a.hout && !b.hin) return ` L ${round2(b.x)} ${round2(b.y)}`;
    return ` C ${round2(c1.x)} ${round2(c1.y)} ${round2(c2.x)} ${round2(c2.y)} ${round2(b.x)} ${round2(b.y)}`;
  };
  for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
  if (o.closed && pts.length > 1) d += seg(pts[pts.length - 1], pts[0]) + " Z";
  return d;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ---------- history ---------- */
function snapshot() {
  return JSON.stringify({ doc: App.doc, objects: App.objects, idSeq: App.idSeq });
}
function commit(label) {
  App.history = App.history.slice(0, App.histIndex + 1);
  App.history.push({ label: label || "", data: snapshot() });
  if (App.history.length > App.HIST_MAX) App.history.shift();
  App.histIndex = App.history.length - 1;
}
function restore(entry) {
  const s = JSON.parse(entry.data);
  App.doc = s.doc; App.objects = s.objects; App.idSeq = s.idSeq;
  App.selection = App.selection.filter(id => findTop(id));
  if (App.nodeEdit.id && !findTop(App.nodeEdit.id)) { App.nodeEdit.id = null; App.nodeEdit.sel = []; }
  render(); updateUI();
}
function undo() { if (App.histIndex > 0) { App.histIndex--; restore(App.history[App.histIndex]); } }
function redo() { if (App.histIndex < App.history.length - 1) { App.histIndex++; restore(App.history[App.histIndex]); } }

/* ---------- coordinates ---------- */
function screenToWorld(sx, sy) {
  const r = $("#stage").getBoundingClientRect();
  return { x: (sx - r.left - App.panX) / App.zoom, y: (sy - r.top - App.panY) / App.zoom };
}
function snapVal(v) {
  if (App.doc.grid.snap) { const g = App.doc.grid.size; return Math.round(v / g) * g; }
  return v;
}
function snapPt(p) { return { x: snapVal(p.x), y: snapVal(p.y) }; }

/* ---------- default naming ---------- */
function autoName(o) {
  if (o.name) return o.name;
  const names = { rect: "Rectangle", ellipse: "Ellipse", line: "Line", path: "Path", polygon: o.star ? "Star" : "Polygon", text: "Text", group: "Group", image: "Image" };
  let n = names[o.type] || "Object";
  if (o.type === "text") n = `"${(o.text || "").split("\n")[0].slice(0, 14)}"`;
  return n;
}
