/* mesh.js — Mesh fill (Coons patch colour meshes) and gradient transparency.

   CorelDRAW's signature "Mesh Fill" lets you place a grid of colour nodes over
   an object and blend between them smoothly. We implement the same idea:

     • an R×C grid of nodes, each with a position and a colour
     • bicubic (Catmull-Rom) interpolation across the grid
     • rendered as a lattice of small quads so any SVG engine can draw it
     • exported to PDF as a ShadingType 6 (Coons patch) mesh — the *native*
       PDF construct, so the print output stays vector

   Also provides gradient transparency (an alpha ramp independent of colour),
   which maps to an SMask'd luminosity group in PDF. */

/* ---------- data model ---------- */

/* mesh = { rows, cols, nodes: [[{x,y,c}, ...cols], ...rows] } in LOCAL object
   coordinates normalised 0..1 relative to the object's bbox. */
function makeMesh(rows, cols, bb, baseColor) {
  rows = Math.max(2, Math.min(10, rows | 0));
  cols = Math.max(2, Math.min(10, cols | 0));
  const nodes = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ u: c / (cols - 1), v: r / (rows - 1), c: baseColor || "#7C5CFF" });
    }
    nodes.push(row);
  }
  return { rows, cols, nodes };
}

/* give a fresh mesh some visual interest so the user sees it working */
function seedMeshColors(mesh, palette) {
  const p = palette && palette.length ? palette
    : ["#7C5CFF", "#39D2C0", "#FF5C7A", "#FFC542", "#4CC9F0"];
  for (let r = 0; r < mesh.rows; r++) {
    for (let c = 0; c < mesh.cols; c++) {
      mesh.nodes[r][c].c = p[(r * mesh.cols + c) % p.length];
    }
  }
  return mesh;
}

function meshOf(o) {
  if (!o.fill) return null;
  if (!o.fill.mesh) {
    o.fill.mesh = seedMeshColors(makeMesh(3, 3, null, o.fill.color));
  }
  const m = o.fill.mesh;
  // repair a malformed mesh rather than throwing
  if (!m.nodes || !m.nodes.length || m.nodes.length !== m.rows) {
    o.fill.mesh = seedMeshColors(makeMesh(m.rows || 3, m.cols || 3, null, o.fill.color));
  }
  return o.fill.mesh;
}

/* ---------- colour helpers (self-contained) ---------- */

function _mhex(h) {
  h = String(h || "#000000").replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _mrgb(r, g, b) {
  const q = v => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + ((1 << 24) + (q(r) << 16) + (q(g) << 8) + q(b)).toString(16).slice(1);
}

/* Catmull-Rom through 4 values */
function _cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const _clampIdx = (i, n) => i < 0 ? 0 : i > n - 1 ? n - 1 : i;

/* sample the mesh colour at normalised (u,v) using bicubic interpolation */
function sampleMesh(mesh, u, v) {
  const R = mesh.rows, C = mesh.cols;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  const fx = u * (C - 1), fy = v * (R - 1);
  const ix = Math.min(C - 2, Math.floor(fx)), iy = Math.min(R - 2, Math.floor(fy));
  const tx = fx - ix, ty = fy - iy;
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const col = [];
    for (let j = -1; j <= 2; j++) {
      const ry = _clampIdx(iy + j, R);
      const rowVals = [];
      for (let i = -1; i <= 2; i++) {
        const cx = _clampIdx(ix + i, C);
        rowVals.push(_mhex(mesh.nodes[ry][cx].c)[ch]);
      }
      col.push(_cr(rowVals[0], rowVals[1], rowVals[2], rowVals[3], tx));
    }
    out[ch] = _cr(col[0], col[1], col[2], col[3], ty);
  }
  return _mrgb(out[0], out[1], out[2]);
}

/* node position in normalised space (nodes may be dragged off the grid) */
function meshNodePos(mesh, r, c) {
  const n = mesh.nodes[r][c];
  return { u: n.u, v: n.v };
}

/* ---------- Coons patch geometry ----------
   A mesh cell is a Coons patch bounded by four CUBIC curves. The curves are
   derived from the node grid with Catmull-Rom tangents, so an edge shared by
   two cells resolves to identical control points and the surface has no
   cracks. Both the on-canvas renderer and the PDF exporter evaluate THIS
   surface, which is what keeps the screen and the print identical. */

const _P = (x, y) => ({ x, y });
const _gridPt = (mesh, r, c) => _P(mesh.nodes[r][c].u, mesh.nodes[r][c].v);

/* Bezier controls for segment i -> i+1 of a polyline, Catmull-Rom style.
   At the ends we EXTRAPOLATE a phantom point (2*p1 - p2) rather than clamping
   to the endpoint. Clamping halves the end tangent, which makes an evenly
   spaced grid bulge instead of staying flat. */
function _segCtrl(P, i) {
  const n = P.length;
  const p1 = P[i], p2 = P[i + 1];
  const p0 = i - 1 >= 0 ? P[i - 1] : _P(2 * p1.x - p2.x, 2 * p1.y - p2.y);
  const p3 = i + 2 < n ? P[i + 2] : _P(2 * p2.x - p1.x, 2 * p2.y - p1.y);
  return [
    _P(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6),
    _P(p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6),
  ];
}
function _rowPts(mesh, r) {
  const out = [];
  for (let c = 0; c < mesh.cols; c++) out.push(_gridPt(mesh, r, c));
  return out;
}
function _colPts(mesh, c) {
  const out = [];
  for (let r = 0; r < mesh.rows; r++) out.push(_gridPt(mesh, r, c));
  return out;
}

/* The 12 control points of cell (r,c), in PDF ShadingType 6 order:
   p00 -> p01 -> p11 -> p10 -> back to p00, corners at indices 0,3,6,9.
   u runs along columns, v along rows. */
function meshCellPatch(mesh, r, c) {
  const top = _segCtrl(_rowPts(mesh, r), c);            // p00 -> p01
  const bot = _segCtrl(_rowPts(mesh, r + 1), c);        // p10 -> p11
  const left = _segCtrl(_colPts(mesh, c), r);           // p00 -> p10
  const right = _segCtrl(_colPts(mesh, c + 1), r);      // p01 -> p11
  const p00 = _gridPt(mesh, r, c), p01 = _gridPt(mesh, r, c + 1);
  const p11 = _gridPt(mesh, r + 1, c + 1), p10 = _gridPt(mesh, r + 1, c);
  return [
    p00, top[0], top[1],
    p01, right[0], right[1],
    p11, bot[1], bot[0],       // reversed: p11 -> p10
    p10, left[1], left[0],     // reversed: p10 -> p00
  ];
}

function _bez(p0, p1, p2, p3, t) {
  const m = 1 - t, a = m * m * m, b = 3 * m * m * t, cc = 3 * m * t * t, d = t * t * t;
  return _P(a * p0.x + b * p1.x + cc * p2.x + d * p3.x,
            a * p0.y + b * p1.y + cc * p2.y + d * p3.y);
}

/* Coons surface point of a 12-point patch at local (u,v). */
function coonsPoint(P, u, v) {
  const top = _bez(P[0], P[1], P[2], P[3], u);            // v = 0
  const bottom = _bez(P[9], P[8], P[7], P[6], u);         // v = 1
  const left = _bez(P[0], P[11], P[10], P[9], v);         // u = 0
  const right = _bez(P[3], P[4], P[5], P[6], v);          // u = 1
  const x = (1 - v) * top.x + v * bottom.x + (1 - u) * left.x + u * right.x
    - ((1 - u) * (1 - v) * P[0].x + u * (1 - v) * P[3].x
       + (1 - u) * v * P[9].x + u * v * P[6].x);
  const y = (1 - v) * top.y + v * bottom.y + (1 - u) * left.y + u * right.y
    - ((1 - u) * (1 - v) * P[0].y + u * (1 - v) * P[3].y
       + (1 - u) * v * P[9].y + u * v * P[6].y);
  return _P(x, y);
}

/* Exact cubic through 4 points sampled at t = 0, 1/3, 2/3, 1. */
function _fitCubic(q0, q1, q2, q3) {
  return [
    _P((-5 * q0.x + 18 * q1.x - 9 * q2.x + 2 * q3.x) / 6,
       (-5 * q0.y + 18 * q1.y - 9 * q2.y + 2 * q3.y) / 6),
    _P((2 * q0.x - 9 * q1.x + 18 * q2.x - 5 * q3.x) / 6,
       (2 * q0.y - 9 * q1.y + 18 * q2.y - 5 * q3.y) / 6),
  ];
}

/* Flatten the whole mesh into Coons sub-patches.
   `sub` subdivisions per cell per axis lets the bilinear colour model that
   PDF mandates converge on our bicubic colour field. Geometry stays exact
   at any subdivision because sub-patch edges are fitted to the surface. */
function meshPatchList(mesh, sub) {
  sub = Math.max(1, Math.min(6, sub | 0 || 1));
  const R = mesh.rows, C = mesh.cols;
  const out = [];
  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < C - 1; c++) {
      const cell = meshCellPatch(mesh, r, c);
      const S = (u, v) => coonsPoint(cell, u, v);
      for (let j = 0; j < sub; j++) {
        for (let i = 0; i < sub; i++) {
          const u0 = i / sub, u1 = (i + 1) / sub;
          const v0 = j / sub, v1 = (j + 1) / sub;
          const du = (u1 - u0) / 3, dv = (v1 - v0) / 3;
          const A = S(u0, v0), B = S(u1, v0), D2 = S(u1, v1), E = S(u0, v1);
          const ab = _fitCubic(A, S(u0 + du, v0), S(u0 + 2 * du, v0), B);
          const bc = _fitCubic(B, S(u1, v0 + dv), S(u1, v0 + 2 * dv), D2);
          const cd = _fitCubic(D2, S(u1 - du, v1), S(u1 - 2 * du, v1), E);
          const da = _fitCubic(E, S(u0, v1 - dv), S(u0, v1 - 2 * dv), A);
          /* global parametric position -> bicubic colour field */
          const GU = u => (c + u) / (C - 1), GV = v => (r + v) / (R - 1);
          out.push({
            pts: [A, ab[0], ab[1], B, bc[0], bc[1], D2, cd[0], cd[1], E, da[0], da[1]],
            colors: [
              sampleMesh(mesh, GU(u0), GV(v0)), sampleMesh(mesh, GU(u1), GV(v0)),
              sampleMesh(mesh, GU(u1), GV(v1)), sampleMesh(mesh, GU(u0), GV(v1)),
            ],
          });
        }
      }
    }
  }
  return out;
}

/* ---------- SVG rendering ---------- */

/* Tessellate the same Coons surface the PDF exporter uses. Each cell is
   split into a grid of quads whose corners sit ON the surface, so dragged
   nodes bend the fill exactly as they do in the exported file. */
function buildMeshPaint(o, bb) {
  const mesh = meshOf(o);
  if (!mesh) return null;
  const g = svgEl("g", { "pointer-events": "none" });
  const R = mesh.rows, C = mesh.cols;
  const steps = Math.max(3, Math.min(10, Math.round(24 / Math.max(R, C))));
  const w = bb.w || 1, h = bb.h || 1;
  const map = p => _P(bb.x + p.x * w, bb.y + p.y * h);

  for (let r = 0; r < R - 1; r++) {
    for (let c = 0; c < C - 1; c++) {
      const cell = meshCellPatch(mesh, r, c);
      for (let j = 0; j < steps; j++) {
        for (let i = 0; i < steps; i++) {
          const u0 = i / steps, u1 = (i + 1) / steps;
          const v0 = j / steps, v1 = (j + 1) / steps;
          const a = map(coonsPoint(cell, u0, v0));
          const b = map(coonsPoint(cell, u1, v0));
          const d = map(coonsPoint(cell, u1, v1));
          const e = map(coonsPoint(cell, u0, v1));
          const col = sampleMesh(mesh,
            (c + (u0 + u1) / 2) / (C - 1), (r + (v0 + v1) / 2) / (R - 1));
          g.appendChild(svgEl("path", {
            d: `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${d.x} ${d.y} L ${e.x} ${e.y} Z`,
            fill: col, stroke: col, "stroke-width": 0.75,
            "stroke-linejoin": "round"
          }));
        }
      }
    }
  }
  return g;
}

/* ---------- mesh editing tool ---------- */

let meshDrag = null;

function meshEditActive() {
  return App.tool === "mesh" && App.selection.length === 1;
}

function meshTargetObj() {
  if (App.selection.length !== 1) return null;
  const o = findTop(App.selection[0]);
  if (!o || o.type === "group" || o.type === "line") return null;
  return o;
}

/* draw draggable nodes over the selected object */
function drawMeshHandles() {
  const layer = document.getElementById("mesh-layer") || (() => {
    const g = svgEl("g", { id: "mesh-layer" });
    document.getElementById("overlay").appendChild(g);
    return g;
  })();
  layer.innerHTML = "";
  if (!meshEditActive()) return;
  const o = meshTargetObj();
  if (!o) return;
  const mesh = meshOf(o);
  const bb = worldBBox(o);
  const z = App.zoom;
  const R = 5 / z;

  // grid lines
  for (let r = 0; r < mesh.rows; r++) {
    const pts = [];
    for (let c = 0; c < mesh.cols; c++) {
      const n = mesh.nodes[r][c];
      pts.push(`${bb.x + n.u * bb.w},${bb.y + n.v * bb.h}`);
    }
    layer.appendChild(svgEl("polyline", {
      points: pts.join(" "), fill: "none", stroke: "rgba(255,255,255,.55)",
      "stroke-width": 1 / z, "pointer-events": "none"
    }));
  }
  for (let c = 0; c < mesh.cols; c++) {
    const pts = [];
    for (let r = 0; r < mesh.rows; r++) {
      const n = mesh.nodes[r][c];
      pts.push(`${bb.x + n.u * bb.w},${bb.y + n.v * bb.h}`);
    }
    layer.appendChild(svgEl("polyline", {
      points: pts.join(" "), fill: "none", stroke: "rgba(255,255,255,.55)",
      "stroke-width": 1 / z, "pointer-events": "none"
    }));
  }
  // nodes
  for (let r = 0; r < mesh.rows; r++) {
    for (let c = 0; c < mesh.cols; c++) {
      const n = mesh.nodes[r][c];
      const sel = App.meshSel && App.meshSel.r === r && App.meshSel.c === c;
      layer.appendChild(svgEl("circle", {
        cx: bb.x + n.u * bb.w, cy: bb.y + n.v * bb.h, r: sel ? R * 1.5 : R,
        fill: n.c, stroke: sel ? "#39D2C0" : "#ffffff",
        "stroke-width": (sel ? 2.5 : 1.5) / z,
        "data-mesh": `${r},${c}`, style: "cursor:move"
      }));
    }
  }
}

function meshDown(e, w) {
  const o = meshTargetObj();
  if (!o) return;
  const mesh = meshOf(o);
  const bb = worldBBox(o);
  const z = App.zoom;
  const tol = 9 / z;
  let best = null, bestD = Infinity;
  for (let r = 0; r < mesh.rows; r++) {
    for (let c = 0; c < mesh.cols; c++) {
      const n = mesh.nodes[r][c];
      const nx = bb.x + n.u * bb.w, ny = bb.y + n.v * bb.h;
      const d = Math.hypot(nx - w.x, ny - w.y);
      if (d < bestD) { bestD = d; best = { r, c }; }
    }
  }
  if (best && bestD <= tol) {
    App.meshSel = best;
    meshDrag = { o, mesh, bb, r: best.r, c: best.c };
    const input = document.getElementById("in-mesh-color");
    if (input) input.value = mesh.nodes[best.r][best.c].c;
    drawMeshHandles();
    render();
  }
}

function meshMove(w) {
  if (!meshDrag) return;
  const { mesh, bb, r, c } = meshDrag;
  const n = mesh.nodes[r][c];
  n.u = bb.w ? (w.x - bb.x) / bb.w : 0;
  n.v = bb.h ? (w.y - bb.y) / bb.h : 0;
  // keep inside a sane range so the lattice stays usable
  n.u = Math.max(-0.25, Math.min(1.25, n.u));
  n.v = Math.max(-0.25, Math.min(1.25, n.v));
  render();
  drawMeshHandles();
}

function meshUp() {
  if (meshDrag) { meshDrag = null; commit("move mesh node"); }
}

/* apply a colour to the selected mesh node */
function setMeshNodeColor(hex) {
  const o = meshTargetObj();
  if (!o || !App.meshSel) return;
  const mesh = meshOf(o);
  const { r, c } = App.meshSel;
  if (!mesh.nodes[r] || !mesh.nodes[r][c]) return;
  mesh.nodes[r][c].c = hex;
  render(); drawMeshHandles(); commit("mesh node colour");
}

function setMeshSize(rows, cols) {
  const o = meshTargetObj();
  if (!o) return;
  const old = meshOf(o);
  const next = makeMesh(rows, cols);
  // resample the old mesh so colours survive a resize
  for (let r = 0; r < next.rows; r++) {
    for (let c = 0; c < next.cols; c++) {
      next.nodes[r][c].c = sampleMesh(old, c / (next.cols - 1), r / (next.rows - 1));
    }
  }
  o.fill.mesh = next;
  App.meshSel = null;
  render(); drawMeshHandles(); commit("mesh size");
}

function applyMeshFill() {
  const objs = selectedObjs().filter(o => o.type !== "group" && o.type !== "line");
  if (!objs.length) return;
  for (const o of objs) {
    o.fill = o.fill || {};
    o.fill.type = "mesh";
    if (!o.fill.mesh) o.fill.mesh = seedMeshColors(makeMesh(3, 3, null, o.fill.color));
  }
  setTool("mesh");
  render(); updateUI(); commit("mesh fill");
}

/* ---------- gradient transparency ---------- */

/* alpha stops live on fill.alphaStops = [{p, a}] with a in 0..1 */
function alphaStops(f) {
  if (!f) return null;
  if (!f.alphaStops || f.alphaStops.length < 2) return null;
  return f.alphaStops.slice().sort((x, y) => x.p - y.p);
}

function setTransparencyRamp(kind) {
  const objs = selectedObjs();
  if (!objs.length) return;
  for (const o of objs) {
    o.fill = o.fill || { type: "solid", color: "#888888" };
    if (kind === "none") delete o.fill.alphaStops;
    else if (kind === "fade") o.fill.alphaStops = [{ p: 0, a: 1 }, { p: 1, a: 0 }];
    else if (kind === "fade-in") o.fill.alphaStops = [{ p: 0, a: 0 }, { p: 1, a: 1 }];
    else if (kind === "vignette") o.fill.alphaStops = [{ p: 0, a: 1 }, { p: 0.6, a: 1 }, { p: 1, a: 0 }];
  }
  render(); updateUI(); commit("transparency");
}

/* build/refresh an SVG mask implementing the alpha ramp */
function ensureAlphaMask(o) {
  const stops = alphaStops(o.fill);
  const mid = `alpha-${o.id}`;
  const existing = document.getElementById(mid);
  if (!stops) { if (existing) existing.remove(); return null; }

  const defs = document.getElementById("defs");
  let mask = existing;
  if (!mask) {
    mask = svgEl("mask", { id: mid, maskUnits: "objectBoundingBox",
                           x: "-0.3", y: "-0.3", width: "1.6", height: "1.6" });
    defs.appendChild(mask);
  }
  mask.innerHTML = "";
  const gid = `alphagrad-${o.id}`;
  let lg = document.getElementById(gid);
  if (lg) lg.remove();
  const radial = o.fill.type === "radial";
  lg = svgEl(radial ? "radialGradient" : "linearGradient", { id: gid });
  if (!radial) {
    const ang = ((o.fill.angle || 0) - 90) * Math.PI / 180;
    lg.setAttribute("x1", `${50 + Math.cos(ang + Math.PI) * 50}%`);
    lg.setAttribute("y1", `${50 + Math.sin(ang + Math.PI) * 50}%`);
    lg.setAttribute("x2", `${50 + Math.cos(ang) * 50}%`);
    lg.setAttribute("y2", `${50 + Math.sin(ang) * 50}%`);
  }
  for (const s of stops) {
    const v = Math.round(Math.max(0, Math.min(1, s.a)) * 255);
    lg.appendChild(svgEl("stop", {
      offset: `${Math.round(s.p * 100)}%`,
      "stop-color": `rgb(${v},${v},${v})`
    }));
  }
  defs.appendChild(lg);
  const bb = worldBBox(o);
  mask.appendChild(svgEl("rect", {
    x: bb.x - bb.w * 0.3, y: bb.y - bb.h * 0.3,
    width: bb.w * 1.6 || 1, height: bb.h * 1.6 || 1,
    fill: `url(#${gid})`
  }));
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  return `url(#${mid})`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    makeMesh, seedMeshColors, sampleMesh, meshOf, alphaStops,
    meshCellPatch, coonsPoint, meshPatchList,
  };
}
