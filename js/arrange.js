/* ============================================================
   arrange.js — align, distribute, and node-level path editing.

   These are core vector-editor operations that were missing entirely:
   there was no way to align two objects, space a row evenly, add a node
   to a path, join two ends, or change a node between corner and smooth.
   ============================================================ */

/* ---------- alignment reference ----------
   With 2+ objects selected, align within the selection's bounding box.
   With exactly 1, align to the page — matching CorelDRAW's behaviour. */
function alignBounds(objs) {
  if (objs.length > 1) {
    const bs = objs.map(worldBBox);
    const x = Math.min(...bs.map(b => b.x));
    const y = Math.min(...bs.map(b => b.y));
    const r = Math.max(...bs.map(b => b.x + b.w));
    const bt = Math.max(...bs.map(b => b.y + b.h));
    return { x, y, w: r - x, h: bt - y };
  }
  return { x: 0, y: 0, w: App.doc.w, h: App.doc.h };
}

/* how: left|hcenter|right|top|vcenter|bottom */
function alignObjects(how) {
  const objs = selectedObjs().filter(o => !o.locked);
  if (!objs.length) { setHint("Select objects to align"); return; }
  if (objs.length === 1 && !App.doc) return;
  const R = alignBounds(objs);
  for (const o of objs) {
    const b = worldBBox(o);
    let dx = 0, dy = 0;
    switch (how) {
      case "left": dx = R.x - b.x; break;
      case "hcenter": dx = (R.x + R.w / 2) - (b.x + b.w / 2); break;
      case "right": dx = (R.x + R.w) - (b.x + b.w); break;
      case "top": dy = R.y - b.y; break;
      case "vcenter": dy = (R.y + R.h / 2) - (b.y + b.h / 2); break;
      case "bottom": dy = (R.y + R.h) - (b.y + b.h); break;
      default: return;
    }
    if (dx || dy) moveObj(o, dx, dy);
  }
  commit("align"); render(); updateUI();
  setHint(`Aligned ${objs.length} object${objs.length === 1 ? "" : "s"}`);
}

/* Distribute: equalise either the gaps between objects or their centres.
   Needs 3+ objects — with 2 there is nothing to distribute. */
function distributeObjects(how) {
  const objs = selectedObjs().filter(o => !o.locked);
  if (objs.length < 3) { setHint("Select 3 or more objects to distribute"); return; }
  const horizontal = how.startsWith("h");
  const key = horizontal ? "x" : "y";
  const size = horizontal ? "w" : "h";

  const items = objs.map(o => ({ o, b: worldBBox(o) }))
    .sort((a, b) => (a.b[key] + a.b[size] / 2) - (b.b[key] + b.b[size] / 2));
  const first = items[0].b, last = items[items.length - 1].b;

  if (how.endsWith("gap")) {
    /* equal empty space between neighbours */
    const span = (last[key] + last[size]) - first[key];
    const used = items.reduce((n, it) => n + it.b[size], 0);
    const gap = (span - used) / (items.length - 1);
    let cursor = first[key];
    for (const it of items) {
      const d = cursor - it.b[key];
      if (d) moveObj(it.o, horizontal ? d : 0, horizontal ? 0 : d);
      cursor += it.b[size] + gap;
    }
  } else {
    /* equal centre-to-centre spacing */
    const c0 = first[key] + first[size] / 2;
    const c1 = last[key] + last[size] / 2;
    const step = (c1 - c0) / (items.length - 1);
    items.forEach((it, i) => {
      const target = c0 + step * i;
      const d = target - (it.b[key] + it.b[size] / 2);
      if (d) moveObj(it.o, horizontal ? d : 0, horizontal ? 0 : d);
    });
  }
  commit("distribute"); render(); updateUI();
  setHint(`Distributed ${items.length} objects`);
}

/* Make selected objects the same size as the last-selected one. */
function equalizeSize(how) {
  const objs = selectedObjs().filter(o => !o.locked);
  if (objs.length < 2) { setHint("Select 2 or more objects"); return; }
  const ref = worldBBox(objs[objs.length - 1]);
  for (let i = 0; i < objs.length - 1; i++) {
    const o = objs[i], b = worldBBox(o);
    if (b.w <= 0 || b.h <= 0) continue;
    const sx = (how === "height") ? 1 : ref.w / b.w;
    const sy = (how === "width") ? 1 : ref.h / b.h;
    scaleObj(o, sx, sy, b.x, b.y);
  }
  commit("equalise size"); render(); updateUI();
  setHint(`Matched ${how}`);
}

/* ============================================================
   Node editing
   ============================================================ */

/* The path currently open in the node tool, plus its point array. */
function nodeTarget() {
  const o = App.nodeEdit.id ? findTop(App.nodeEdit.id) : null;
  if (!o || o.type !== "path" || !Array.isArray(o.pts)) return null;
  return o;
}

/* Evaluate a cubic segment between anchors a and b at parameter t. */
function segPoint(a, b, t) {
  const p0 = { x: a.x, y: a.y };
  const p3 = { x: b.x, y: b.y };
  const p1 = a.hout || p0;
  const p2 = b.hin || p3;
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

/* de Casteljau split: returns the two half-segments' control points. */
function splitSeg(a, b, t) {
  const p0 = { x: a.x, y: a.y }, p3 = { x: b.x, y: b.y };
  const p1 = a.hout || p0, p2 = b.hin || p3;
  const lerp = (u, v) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const q0 = lerp(p0, p1), q1 = lerp(p1, p2), q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1), r1 = lerp(q1, q2);
  const s = lerp(r0, r1);
  return { aOut: q0, mIn: r0, mid: s, mOut: r1, bIn: q2 };
}

/* Insert a node at the midpoint of every selected segment.
   A segment is "selected" when both its endpoints are selected. */
function addNodes() {
  const o = nodeTarget();
  if (!o) { setHint("Use the node tool on a path first"); return; }
  const sel = App.nodeEdit.sel.slice().sort((a, b) => a - b);
  if (sel.length < 1) { setHint("Select nodes, then add"); return; }
  const n = o.pts.length;
  const closed = o.closed !== false;
  /* collect segments to split, as start-indices */
  const segs = [];
  for (const i of sel) {
    const j = (i + 1) % n;
    if (j === 0 && !closed) continue;                 // no segment after the last node
    if (sel.includes(j)) segs.push(i);
  }
  if (!segs.length) {
    /* single node selected: split the segment that follows it */
    for (const i of sel) { const j = (i + 1) % n; if (j !== 0 || closed) segs.push(i); }
  }
  if (!segs.length) { setHint("Nothing to subdivide"); return; }

  segs.sort((a, b) => b - a);                          // splice from the end
  for (const i of segs) {
    const a = o.pts[i], b = o.pts[(i + 1) % n];
    const s = splitSeg(a, b, 0.5);
    if (a.hout) a.hout = s.aOut;
    if (b.hin) b.hin = s.bIn;
    const mid = anchor(s.mid.x, s.mid.y,
      (a.hout || b.hin) ? s.mIn : null,
      (a.hout || b.hin) ? s.mOut : null);
    o.pts.splice(i + 1, 0, mid);
  }
  App.nodeEdit.sel = [];
  commit("add nodes"); render(); updateUI();
  setHint(`Added ${segs.length} node${segs.length === 1 ? "" : "s"}`);
}

/* Change the handle style of the selected nodes. */
function setNodeType(kind) {
  const o = nodeTarget();
  if (!o) { setHint("Use the node tool on a path first"); return; }
  const sel = App.nodeEdit.sel;
  if (!sel.length) { setHint("Select nodes first"); return; }
  const n = o.pts.length;
  const closed = o.closed !== false;
  for (const i of sel) {
    const p = o.pts[i];
    if (!p) continue;
    if (kind === "cusp") {
      /* keep the handles exactly where they are: they simply stop being linked */
      p.smooth = false;
    } else if (kind === "corner") {
      p.hin = null; p.hout = null; p.smooth = false;
    } else if (kind === "smooth" || kind === "symmetric") {
      const prev = o.pts[(i - 1 + n) % n], next = o.pts[(i + 1) % n];
      const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
      if (!hasPrev && !hasNext) continue;
      /* tangent through the neighbours, as Catmull-Rom would give */
      const a = hasPrev ? prev : p, b = hasNext ? next : p;
      let tx = b.x - a.x, ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      const dPrev = hasPrev ? Math.hypot(p.x - a.x, p.y - a.y) / 3 : 0;
      const dNext = hasNext ? Math.hypot(b.x - p.x, b.y - p.y) / 3 : 0;
      const d = (kind === "symmetric") ? Math.max(dPrev, dNext) : null;
      p.hin = hasPrev ? { x: p.x - tx * (d !== null ? d : dPrev), y: p.y - ty * (d !== null ? d : dPrev) } : null;
      p.hout = hasNext ? { x: p.x + tx * (d !== null ? d : dNext), y: p.y + ty * (d !== null ? d : dNext) } : null;
      p.smooth = true;
    }
  }
  commit("node type"); render(); updateUI();
  setHint(`Nodes set to ${kind}`);
}

/* Join exactly two selected end nodes. Closes the path when both ends of the
   same open path are chosen, otherwise merges them into one node. */
function joinNodes() {
  const o = nodeTarget();
  if (!o) { setHint("Use the node tool on a path first"); return; }
  const sel = App.nodeEdit.sel.slice().sort((a, b) => a - b);
  if (sel.length !== 2) { setHint("Select exactly 2 nodes to join"); return; }
  const n = o.pts.length;
  if (o.closed !== false) { setHint("Path is already closed"); return; }
  const [i, j] = sel;
  if (i === 0 && j === n - 1) {
    o.closed = true;
    commit("close path"); render(); updateUI();
    setHint("Path closed");
    return;
  }
  /* merge two adjacent nodes into their midpoint */
  if (j === i + 1) {
    const a = o.pts[i], b = o.pts[j];
    a.x = (a.x + b.x) / 2; a.y = (a.y + b.y) / 2;
    a.hout = b.hout;
    o.pts.splice(j, 1);
    App.nodeEdit.sel = [i];
    commit("join nodes"); render(); updateUI();
    setHint("Nodes joined");
    return;
  }
  setHint("Select two adjacent nodes, or the two ends of an open path");
}

/* Break the path at each selected node, turning a closed path into an open one
   (or splitting an open path into subpaths). */
function breakNodes() {
  const o = nodeTarget();
  if (!o) { setHint("Use the node tool on a path first"); return; }
  const sel = App.nodeEdit.sel.slice().sort((a, b) => a - b);
  if (!sel.length) { setHint("Select nodes to break"); return; }
  if (o.closed !== false) {
    /* opening a closed path: rotate so the break lands at the ends */
    const i = sel[0];
    o.pts = o.pts.slice(i).concat(o.pts.slice(0, i));
    o.pts.push({ ...o.pts[0], hin: o.pts[0].hin ? { ...o.pts[0].hin } : null, hout: null });
    o.closed = false;
    App.nodeEdit.sel = [0];
    commit("break path"); render(); updateUI();
    setHint("Path opened");
    return;
  }
  /* already open: duplicate the node so the two halves separate */
  const i = sel[0];
  if (i <= 0 || i >= o.pts.length - 1) { setHint("Pick an interior node to break"); return; }
  const p = o.pts[i];
  o.pts.splice(i + 1, 0, { ...p, hin: null, hout: p.hout ? { ...p.hout } : null });
  o.pts[i].hout = null;
  App.nodeEdit.sel = [i];
  commit("break nodes"); render(); updateUI();
  setHint("Path broken");
}

/* Reverse path direction — matters for start/end markers and boolean winding. */
function reversePath() {
  const objs = selectedObjs().filter(o => o.type === "path" && !o.locked);
  if (!objs.length) { setHint("Select a path to reverse"); return; }
  for (const o of objs) {
    o.pts = o.pts.slice().reverse().map(p => ({ ...p, hin: p.hout ? { ...p.hout } : null, hout: p.hin ? { ...p.hin } : null }));
    if (o.subpaths) {
      o.subpaths = o.subpaths.map(sp => ({
        ...sp,
        pts: sp.pts.slice().reverse().map(p => ({ ...p, hin: p.hout ? { ...p.hout } : null, hout: p.hin ? { ...p.hin } : null })),
      }));
    }
  }
  commit("reverse path"); render(); updateUI();
  setHint(`Reversed ${objs.length} path${objs.length === 1 ? "" : "s"}`);
}
