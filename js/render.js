/* ============================================================
   Graphene — SVG rendering: scene, grid, selection overlay
   ============================================================ */
"use strict";

const stage = $("#stage");
const gWorld = $("#world"), gBoard = $("#board"), gGrid = $("#grid"),
      gObjects = $("#objects"), gOverlay = $("#overlay"), gDefs = $("#defs");

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

/* ---------- paint (fill / stroke) ---------- */
function fillRef(o) {
  const f = o.fill;
  if (!f || f.type === "none") return "none";
  if (f.type === "solid") return f.color;
  return `url(#grad-${o.id})`;
}

function ensureGradient(o) {
  const f = o.fill;
  const gid = `grad-${o.id}`;
  let g = document.getElementById(gid);
  if (!f || (f.type !== "linear" && f.type !== "radial")) { if (g) g.remove(); return; }
  const want = f.type === "linear" ? "linearGradient" : "radialGradient";
  if (g && g.tagName !== want) { g.remove(); g = null; }
  if (!g) {
    g = svgEl(want, { id: gid });
    g.appendChild(svgEl("stop", { offset: "0%" }));
    g.appendChild(svgEl("stop", { offset: "100%" }));
    gDefs.appendChild(g);
  }
  const stops = g.querySelectorAll("stop");
  stops[0].setAttribute("stop-color", f.a);
  stops[1].setAttribute("stop-color", f.b);
  if (f.type === "linear") {
    const a = deg2rad(f.angle || 0);
    const x = Math.cos(a) / 2, y = Math.sin(a) / 2;
    g.setAttribute("x1", 0.5 - x); g.setAttribute("y1", 0.5 - y);
    g.setAttribute("x2", 0.5 + x); g.setAttribute("y2", 0.5 + y);
  }
}

function applyPaint(el, o) {
  ensureGradient(o);
  el.setAttribute("fill", o.type === "line" ? "none" : fillRef(o));
  const s = o.stroke;
  if (s && s.on && s.w > 0) {
    el.setAttribute("stroke", s.color);
    el.setAttribute("stroke-width", s.w);
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    if (s.style === "dashed") el.setAttribute("stroke-dasharray", `${s.w * 3} ${s.w * 2}`);
    else if (s.style === "dotted") el.setAttribute("stroke-dasharray", `0.1 ${s.w * 2}`);
    else el.removeAttribute("stroke-dasharray");
  } else {
    el.setAttribute("stroke", "none");
    el.removeAttribute("stroke-dasharray");
  }
}

/* ---------- object → SVG element ---------- */
function renderObj(o) {
  if (!o.visible) return null;
  let el;
  switch (o.type) {
    case "rect":
      el = svgEl("rect", { x: o.x, y: o.y, width: Math.max(0, o.w), height: Math.max(0, o.h) });
      if (o.rx > 0) { el.setAttribute("rx", o.rx); el.setAttribute("ry", o.rx); }
      break;
    case "ellipse":
      el = svgEl("ellipse", { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: Math.max(0, o.w / 2), ry: Math.max(0, o.h / 2) });
      break;
    case "line":
      el = svgEl("line", { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 });
      break;
    case "polygon":
      el = svgEl("polygon", { points: polygonPoints(o).map(p => `${round2(p.x)},${round2(p.y)}`).join(" ") });
      break;
    case "path":
      el = svgEl("path", { d: pathD(o) });
      if (!o.closed) el.setAttribute("fill-rule", "evenodd");
      break;
    case "text": {
      el = svgEl("text", { x: o.x, y: o.y });
      el.setAttribute("font-family", o.font);
      el.setAttribute("font-size", o.size);
      if (o.bold) el.setAttribute("font-weight", "bold");
      if (o.italic) el.setAttribute("font-style", "italic");
      el.setAttribute("text-anchor", o.align === "center" ? "middle" : o.align === "right" ? "end" : "start");
      const lines = (o.text || "").split("\n");
      lines.forEach((ln, i) => {
        const ts = svgEl("tspan", { x: o.x, dy: i === 0 ? 0 : o.size * 1.2 });
        ts.textContent = ln || "\u00A0";
        el.appendChild(ts);
      });
      break;
    }
    case "group": {
      el = svgEl("g");
      for (const c of o.children) { const ce = renderObj(c); if (ce) el.appendChild(ce); }
      break;
    }
    default: return null;
  }
  el.dataset.id = o.id;
  if (o.type !== "group") applyPaint(el, o);
  if (o.opacity < 1) el.setAttribute("opacity", o.opacity);
  if (o.rot) {
    const b = localBBox(o);
    el.setAttribute("transform", `rotate(${o.rot} ${b.x + b.w / 2} ${b.y + b.h / 2})`);
  }
  return el;
}

/* ---------- full render ---------- */
function render() {
  gWorld.setAttribute("transform", `translate(${App.panX} ${App.panY}) scale(${App.zoom})`);

  // artboard
  gBoard.innerHTML = "";
  const shadow = svgEl("rect", { x: 6 / App.zoom, y: 8 / App.zoom, width: App.doc.w, height: App.doc.h, fill: "rgba(0,0,0,.45)" });
  const page = svgEl("rect", { x: 0, y: 0, width: App.doc.w, height: App.doc.h, fill: App.doc.bg });
  gBoard.appendChild(shadow); gBoard.appendChild(page);

  renderGrid();

  // objects
  gObjects.innerHTML = "";
  // prune stale gradients
  $$("#defs > *").forEach(g => { const id = g.id.replace(/^grad-/, ""); if (!findObj(id)) g.remove(); });
  for (const o of App.objects) { const el = renderObj(o); if (el) gObjects.appendChild(el); }

  renderOverlay();
}

function renderGrid() {
  gGrid.innerHTML = "";
  if (!App.doc.grid.show) return;
  const g = App.doc.grid.size;
  if (g * App.zoom < 5) return;
  let d = "";
  for (let x = 0; x <= App.doc.w; x += g) d += `M ${x} 0 V ${App.doc.h} `;
  for (let y = 0; y <= App.doc.h; y += g) d += `M 0 ${y} H ${App.doc.w} `;
  gGrid.appendChild(svgEl("path", { d, stroke: "rgba(124,92,255,.16)", "stroke-width": 1 / App.zoom, fill: "none" }));
}

/* ---------- selection overlay ---------- */
const HANDLES = [
  ["nw", 0, 0], ["n", .5, 0], ["ne", 1, 0], ["e", 1, .5],
  ["se", 1, 1], ["s", .5, 1], ["sw", 0, 1], ["w", 0, .5]
];

function renderOverlay() {
  gOverlay.innerHTML = "";
  if (App.tool === "node") { renderNodeOverlay(); return; }
  const objs = selectedObjs();
  if (!objs.length) return;
  const z = App.zoom;

  // per-object outline
  for (const o of objs) {
    const b = worldBBox(o);
    gOverlay.appendChild(svgEl("rect", {
      x: b.x, y: b.y, width: b.w, height: b.h,
      fill: "none", stroke: "#39D2C0", "stroke-width": 1 / z,
      "stroke-dasharray": objs.length > 1 ? `${4 / z} ${3 / z}` : "none",
      "pointer-events": "none"
    }));
  }

  const bb = selectionBBox();
  if (!bb) return;

  if (objs.length > 1) {
    gOverlay.appendChild(svgEl("rect", {
      x: bb.x, y: bb.y, width: bb.w, height: bb.h,
      fill: "none", stroke: "#7C5CFF", "stroke-width": 1 / z, "pointer-events": "none"
    }));
  }

  const hs = 8 / z;
  for (const [name, fx, fy] of HANDLES) {
    const hx = bb.x + bb.w * fx, hy = bb.y + bb.h * fy;
    const h = svgEl("rect", {
      x: hx - hs / 2, y: hy - hs / 2, width: hs, height: hs,
      fill: "#fff", stroke: "#7C5CFF", "stroke-width": 1.2 / z,
      "data-handle": name, class: "sel-handle"
    });
    h.style.cursor = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" }[name];
    gOverlay.appendChild(h);
  }

  // rotate handle
  const rx = bb.x + bb.w / 2, ry = bb.y - 26 / z;
  gOverlay.appendChild(svgEl("line", { x1: rx, y1: bb.y, x2: rx, y2: ry, stroke: "#7C5CFF", "stroke-width": 1 / z, "pointer-events": "none" }));
  const rh = svgEl("circle", { cx: rx, cy: ry, r: 5.5 / z, fill: "#7C5CFF", stroke: "#fff", "stroke-width": 1.2 / z, "data-handle": "rotate" });
  rh.style.cursor = "grab";
  gOverlay.appendChild(rh);
}

/* node-edit overlay: bezier anchors + handles */
function renderNodeOverlay() {
  const o = App.nodeEdit.id ? findTop(App.nodeEdit.id) : null;
  if (!o || o.type !== "path") return;
  const z = App.zoom, sel = App.nodeEdit.sel;

  const outline = svgEl("path", { d: pathD(o), fill: "none", stroke: "#39D2C0", "stroke-width": 1 / z, "pointer-events": "none", opacity: .7 });
  gOverlay.appendChild(outline);

  o.pts.forEach((p, i) => {
    // handle lines + control points for selected anchors
    if (sel.includes(i)) {
      for (const key of ["hin", "hout"]) {
        const h = p[key];
        if (!h) continue;
        gOverlay.appendChild(svgEl("line", { x1: p.x, y1: p.y, x2: h.x, y2: h.y, stroke: "#7C5CFF", "stroke-width": 1 / z, "pointer-events": "none" }));
        const c = svgEl("circle", { cx: h.x, cy: h.y, r: 4 / z, fill: "#7C5CFF", stroke: "#fff", "stroke-width": 1 / z, "data-node-handle": key, "data-node-idx": i });
        c.style.cursor = "move";
        gOverlay.appendChild(c);
      }
    }
    const isSel = sel.includes(i);
    const a = svgEl("rect", {
      x: p.x - 4.5 / z, y: p.y - 4.5 / z, width: 9 / z, height: 9 / z,
      fill: isSel ? "#39D2C0" : "#fff", stroke: "#22242c", "stroke-width": 1 / z,
      "data-node-idx": i, transform: `rotate(45 ${p.x} ${p.y})`
    });
    a.style.cursor = "move";
    gOverlay.appendChild(a);
  });
}

/* ---------- marquee / preview helpers ---------- */
function drawMarquee(x, y, w, h) {
  let m = $("#marquee-rect");
  if (!m) {
    m = svgEl("rect", { id: "marquee-rect", fill: "rgba(124,92,255,.12)", stroke: "#7C5CFF", "stroke-width": 1 / App.zoom, "pointer-events": "none" });
    gOverlay.appendChild(m);
  }
  m.setAttribute("x", x); m.setAttribute("y", y);
  m.setAttribute("width", w); m.setAttribute("height", h);
}
function clearMarquee() { const m = $("#marquee-rect"); if (m) m.remove(); }

/* pen preview */
function drawPenPreview(pts, cur, closedHint) {
  let g = $("#pen-preview");
  if (g) g.remove();
  g = svgEl("g", { id: "pen-preview", "pointer-events": "none" });
  const z = App.zoom;
  if (pts.length) {
    const tmp = { pts, closed: false };
    g.appendChild(svgEl("path", { d: pathD(tmp), fill: "none", stroke: "#39D2C0", "stroke-width": 1.5 / z }));
    if (cur) {
      const last = pts[pts.length - 1];
      const c1 = last.hout || last;
      g.appendChild(svgEl("path", { d: `M ${last.x} ${last.y} C ${c1.x} ${c1.y} ${cur.x} ${cur.y} ${cur.x} ${cur.y}`, fill: "none", stroke: "rgba(57,210,192,.5)", "stroke-width": 1 / z, "stroke-dasharray": `${4 / z} ${3 / z}` }));
    }
    pts.forEach((p, i) => {
      g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: (i === 0 && closedHint ? 6 : 3.5) / z, fill: i === 0 ? "#7C5CFF" : "#fff", stroke: "#22242c", "stroke-width": 1 / z }));
    });
  }
  gOverlay.appendChild(g);
}
function clearPenPreview() { const g = $("#pen-preview"); if (g) g.remove(); }
