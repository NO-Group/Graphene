/* ============================================================
   Graphene — Distortion & destructive editing
   Envelope (4-point warp) · Perspective · Knife · Eraser ·
   Roughen · Twirl · Mesh-free Free Transform
   ============================================================ */
"use strict";

/* ============================================================
   ENVELOPE / PERSPECTIVE
   The envelope maps the object's bbox onto an arbitrary quad.
   Bilinear = envelope (soft), projective = true perspective.
   ============================================================ */
let envState = null;   // { id, quad:[[x,y]×4], bb, mode }

function startEnvelope(mode) {
  const objs = selectedObjs().filter(o => !o.locked);
  if (!objs.length) { setHint("Select an object to distort"); return; }
  const bb = selectionBBox();
  envState = {
    ids: objs.map(o => o.id),
    bb,
    mode: mode || "envelope",
    quad: [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]],
    orig: JSON.parse(JSON.stringify(objs)),
  };
  App.tool = "envelope";
  $$(".tool").forEach(b => b.classList.remove("active"));
  setHint(mode === "perspective"
    ? "Perspective: drag the 4 corners · Enter applies · Esc cancels"
    : "Envelope: drag the 4 corners · Enter applies · Esc cancels");
  render();
  drawEnvelopeHandles();
}

function drawEnvelopeHandles() {
  const g = $("#env-layer");
  if (g) g.remove();
  if (!envState) return;
  const z = App.zoom;
  const grp = svgEl("g", { id: "env-layer" });
  const q = envState.quad;
  grp.appendChild(svgEl("polygon", {
    points: q.map(p => `${p[0]},${p[1]}`).join(" "),
    fill: "rgba(124,92,255,.08)", stroke: "#7C5CFF",
    "stroke-width": 1 / z, "stroke-dasharray": `${5 / z} ${3 / z}`, "pointer-events": "none"
  }));
  q.forEach((p, i) => {
    const h = svgEl("circle", {
      cx: p[0], cy: p[1], r: 6 / z, fill: "#fff",
      stroke: "#7C5CFF", "stroke-width": 2 / z, "data-env": i
    });
    h.style.cursor = "move";
    grp.appendChild(h);
  });
  gOverlay.appendChild(grp);
}

/* bilinear map: unit square (u,v) → quad */
function bilerpQuad(q, u, v) {
  const top = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u];
  const bot = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

/* projective (homography) map: unit square → quad, solved via 8×8 linear system */
function makeHomography(q) {
  // maps (0,0),(1,0),(1,1),(0,1) → q0..q3
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  let g, hh;
  if (Math.abs(den) < 1e-12) { g = 0; hh = 0; }
  else { g = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dx3 * dy1) / den; }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  const f = y0;
  return (u, v) => {
    const w = g * u + hh * v + 1;
    if (Math.abs(w) < 1e-12) return [c, f];
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

function applyEnvelope() {
  if (!envState) return;
  const { bb, quad, mode, ids, orig } = envState;
  const map = mode === "perspective" ? makeHomography(quad) : (u, v) => bilerpQuad(quad, u, v);
  const T = (x, y) => {
    const u = bb.w ? (x - bb.x) / bb.w : 0;
    const v = bb.h ? (y - bb.y) / bb.h : 0;
    const p = map(u, v);
    return { x: p[0], y: p[1] };
  };

  const out = [];
  ids.forEach((id, i) => {
    const src = orig[i];
    // everything becomes a path so the warp is exact
    let p = src.type === "path" ? JSON.parse(JSON.stringify(src)) : convertToPath(JSON.parse(JSON.stringify(src)));
    if (p.type !== "path") {
      // text / image / group: warp their bbox corners only (move+scale approximation)
      const b = worldBBox(src);
      const c = T(b.x + b.w / 2, b.y + b.h / 2);
      const o2 = JSON.parse(JSON.stringify(src));
      moveObj(o2, c.x - (b.x + b.w / 2), c.y - (b.y + b.h / 2));
      out.push(o2);
      return;
    }
    const warpPts = pts => {
      for (const pt of pts) {
        const n = T(pt.x, pt.y); 
        if (pt.hin) { const h = T(pt.hin.x, pt.hin.y); pt.hin.x = h.x; pt.hin.y = h.y; }
        if (pt.hout) { const h = T(pt.hout.x, pt.hout.y); pt.hout.x = h.x; pt.hout.y = h.y; }
        pt.x = n.x; pt.y = n.y;
      }
    };
    // subdivide long straight segments so the warp is visible on rectangles
    p = subdividePath(p, 8);
    warpPts(p.pts);
    if (p.subpaths) for (const sp of p.subpaths) warpPts(sp.pts);
    p.id = src.id;
    out.push(p);
  });

  out.forEach(o => {
    const i = App.objects.findIndex(x => x.id === o.id);
    if (i >= 0) App.objects[i] = o;
  });
  App.selection = out.map(o => o.id);
  envState = null;
  const g = $("#env-layer"); if (g) g.remove();
  setTool("select");
  commit("distort");
  render(); updateUI();
  setHint("Distortion applied ✓");
}

function cancelEnvelope() {
  if (!envState) return;
  envState = null;
  const g = $("#env-layer"); if (g) g.remove();
  setTool("select");
  render();
  setHint("Distortion cancelled");
}

/* insert extra anchors along each segment (so straight edges can bend) */
function subdividePath(p, per) {
  const doList = (pts, closed) => {
    const out = [];
    const n = pts.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push(a);
      if (a.hout || b.hin) continue;           // curves already bend
      for (let s = 1; s < per; s++) {
        const t = s / per;
        out.push(anchor(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
      }
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  };
  if (p.subpaths && p.subpaths.length) {
    p.subpaths = p.subpaths.map(sp => ({ pts: doList(sp.pts, sp.closed !== false), closed: sp.closed !== false }));
    p.pts = p.subpaths[0].pts;
  } else {
    p.pts = doList(p.pts, p.closed);
  }
  return p;
}

/* ============================================================
   KNIFE — slice objects along a drawn line
   ============================================================ */
function knifeCut(x1, y1, x2, y2) {
  const targets = selectedObjs().filter(o => !o.locked);
  const list = targets.length ? targets : App.objects.filter(o => o.visible && !o.locked);
  if (!list.length) return false;

  // build two huge half-plane polygons from the cut line
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return false;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const EXT = 1e5;
  const ax = x1 - ux * EXT, ay = y1 - uy * EXT;
  const bx = x2 + ux * EXT, by = y2 + uy * EXT;
  const sideA = [[ax, ay], [bx, by], [bx + nx * EXT, by + ny * EXT], [ax + nx * EXT, ay + ny * EXT]];
  const sideB = [[ax, ay], [ax - nx * EXT, ay - ny * EXT], [bx - nx * EXT, by - ny * EXT], [bx, by]];

  let cut = 0;
  const newSel = [];
  for (const o of list) {
    const cs = objContours(o);
    if (!cs.length) continue;
    const bb = worldBBox(o);
    // quick reject: does the segment's band even touch the bbox?
    if (!segHitsBox(x1, y1, x2, y2, bb)) continue;

    const partA = polyBoolean(cs, [sideA], BOOL_INTERSECTION);
    const partB = polyBoolean(cs, [sideB], BOOL_INTERSECTION);
    if (!partA.length || !partB.length) continue;

    const pa = contoursToPath(partA, o), pb = contoursToPath(partB, o);
    if (!pa || !pb) continue;
    pa.name = (o.name || cap(o.type)) + " A";
    pb.name = (o.name || cap(o.type)) + " B";
    const at = App.objects.indexOf(o);
    if (at < 0) continue;
    App.objects.splice(at, 1, pa, pb);
    newSel.push(pa.id, pb.id);
    cut++;
  }
  if (!cut) { setHint("Knife: nothing was crossed by the cut"); return false; }
  App.selection = newSel;
  commit("knife");
  render(); updateUI();
  setHint(`Knife: split ${cut} object${cut === 1 ? "" : "s"} ✓`);
  return true;
}

function segHitsBox(x1, y1, x2, y2, b) {
  const minx = Math.min(x1, x2), maxx = Math.max(x1, x2);
  const miny = Math.min(y1, y2), maxy = Math.max(y1, y2);
  return !(maxx < b.x || minx > b.x + b.w || maxy < b.y || miny > b.y + b.h);
}

/* ============================================================
   ERASER — subtract a stroked path from objects
   ============================================================ */
function eraseStroke(points, radius) {
  if (points.length < 2) return false;
  const targets = selectedObjs().filter(o => !o.locked);
  const list = targets.length ? targets : App.objects.filter(o => o.visible && !o.locked);
  if (!list.length) return false;

  // build a thick polygon around the stroke (round-ish joins via octagons at each point)
  let brush = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const nx = -dy / l * radius, ny = dx / l * radius;
    brush.push([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
  }
  for (const [px, py] of points) {
    const oct = [];
    for (let a = 0; a < 8; a++) {
      const t = a / 8 * Math.PI * 2;
      oct.push([px + Math.cos(t) * radius, py + Math.sin(t) * radius]);
    }
    brush.push(oct);
  }
  // union the brush pieces into one region
  let region = [brush[0]];
  for (let i = 1; i < brush.length; i++) region = polyBoolean(region, [brush[i]], BOOL_UNION);

  let n = 0;
  const newSel = [];
  for (const o of list) {
    const cs = objContours(o);
    if (!cs.length) continue;
    const res = polyBoolean(cs, region, BOOL_DIFFERENCE);
    const at = App.objects.indexOf(o);
    if (at < 0) continue;
    if (!res.length) { App.objects.splice(at, 1); n++; continue; }
    const p = contoursToPath(res, o);
    if (!p) continue;
    p.name = (o.name || cap(o.type)) + " (erased)";
    App.objects.splice(at, 1, p);
    newSel.push(p.id);
    n++;
  }
  if (!n) return false;
  App.selection = newSel;
  commit("erase");
  render(); updateUI();
  setHint(`Erased from ${n} object${n === 1 ? "" : "s"} ✓`);
  return true;
}

/* ============================================================
   ROUGHEN & TWIRL — distortion effects on paths
   ============================================================ */
function roughenSelection() {
  const objs = selectedObjs().filter(o => !o.locked);
  if (!objs.length) { setHint("Select an object to roughen"); return; }
  const amt = clamp(+($("#in-rough-amt") || {}).value || 6, 0.5, 200);
  const freq = clamp(+($("#in-rough-freq") || {}).value || 8, 1, 60);
  let n = 0;
  objs.forEach(o => {
    let p = o.type === "path" ? o : convertToPath(o);
    if (p.type !== "path") return;
    p = subdividePath(p, Math.round(freq));
    const jitter = pts => pts.forEach((pt, i) => {
      const a = Math.sin(i * 12.9898) * 43758.5453;
      const r = (a - Math.floor(a)) * 2 - 1;
      const a2 = Math.sin(i * 78.233) * 12345.6789;
      const r2 = (a2 - Math.floor(a2)) * 2 - 1;
      pt.x += r * amt; pt.y += r2 * amt;
      pt.hin = null; pt.hout = null;
    });
    jitter(p.pts);
    if (p.subpaths) p.subpaths.forEach(sp => jitter(sp.pts));
    const i = App.objects.indexOf(o);
    if (i >= 0) { p.id = o.id; App.objects[i] = p; n++; }
  });
  if (!n) return;
  commit("roughen");
  render(); updateUI();
  setHint("Roughened ✓");
}

function twirlSelection() {
  const objs = selectedObjs().filter(o => !o.locked);
  if (!objs.length) { setHint("Select an object to twirl"); return; }
  const deg = clamp(+($("#in-twirl-deg") || {}).value || 45, -720, 720);
  let n = 0;
  objs.forEach(o => {
    let p = o.type === "path" ? o : convertToPath(o);
    if (p.type !== "path") return;
    p = subdividePath(p, 6);
    const b = worldBBox(o);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const R = Math.max(b.w, b.h) / 2 || 1;
    const spin = pts => pts.forEach(pt => {
      const dx = pt.x - cx, dy = pt.y - cy;
      const d = Math.hypot(dx, dy);
      const f = clamp(1 - d / R, 0, 1);
      const a = deg2rad(deg * f);
      const c = Math.cos(a), s = Math.sin(a);
      pt.x = cx + dx * c - dy * s;
      pt.y = cy + dx * s + dy * c;
      pt.hin = null; pt.hout = null;
    });
    spin(p.pts);
    if (p.subpaths) p.subpaths.forEach(sp => spin(sp.pts));
    const i = App.objects.indexOf(o);
    if (i >= 0) { p.id = o.id; App.objects[i] = p; n++; }
  });
  if (!n) return;
  commit("twirl");
  render(); updateUI();
  setHint("Twirled ✓");
}

/* ---------- wiring ---------- */
if (typeof document !== "undefined") {
  const b1 = $("#btn-roughen"); if (b1) b1.addEventListener("click", roughenSelection);
  const b2 = $("#btn-twirl"); if (b2) b2.addEventListener("click", twirlSelection);
}
