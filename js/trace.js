/* ============================================================
   Graphene — PowerTRACE
   Bitmap → vector conversion.
   Pipeline: sample → colour quantise (median-cut) → per-colour
   mask → Moore-neighbour contour trace → Ramer-Douglas-Peucker
   simplify → optional bezier fit → styled path objects.
   ============================================================ */
"use strict";

/* Small local fallbacks so this module also runs standalone under Node
   (the browser build gets these from core.js / pro.js). */
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _hex = (r, g, b) =>
  "#" + [r, g, b].map(v => _clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");

/* ---------- 1. pixel access ---------- */
function imageToPixels(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

/* ---------- 2. median-cut colour quantisation ---------- */
function quantise(px, k) {
  const { data } = px;
  const pts = [];
  // subsample for speed on big images
  const stride = Math.max(1, Math.floor(Math.sqrt(data.length / 4 / 20000)));
  for (let i = 0; i < data.length; i += 4 * stride) {
    if (data[i + 3] < 128) continue;
    pts.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pts.length) return [[0, 0, 0]];

  let boxes = [pts];
  while (boxes.length < k) {
    // split the box with the largest channel range
    let bi = -1, bRange = -1, bChan = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        for (const p of b) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; }
        const r = mx - mn;
        if (r > bRange) { bRange = r; bi = i; bChan = c; }
      }
    });
    if (bi < 0 || bRange <= 0) break;
    const box = boxes[bi];
    box.sort((a, b) => a[bChan] - b[bChan]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }

  let palette = boxes.filter(b => b.length).map(b => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [r / b.length, g / b.length, bl / b.length];
  });

  /* Lloyd/k-means refinement — median-cut alone leaves cluster means sitting
     between real colours (a red bar on white averages to pink). A few
     iterations snap each centroid onto the colour that actually dominates it. */
  const K = palette.length;
  for (let iter = 0; iter < 8; iter++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < K; i++) {
        const c = palette[i];
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const s = sum[best];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    let moved = 0;
    for (let i = 0; i < K; i++) {
      if (!sum[i][3]) continue;
      const nx = sum[i][0] / sum[i][3], ny = sum[i][1] / sum[i][3], nz = sum[i][2] / sum[i][3];
      moved += Math.abs(nx - palette[i][0]) + Math.abs(ny - palette[i][1]) + Math.abs(nz - palette[i][2]);
      palette[i] = [nx, ny, nz];
    }
    if (moved < 1) break;                 // converged
  }

  return palette.map(c => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
}

function nearestIdx(palette, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* ---------- 3. Moore-neighbour contour tracing ---------- */
/* mask: Uint8Array (w*h), 1 = inside. Returns array of contours (outer + holes). */
function traceMask(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const contours = [];
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x];

  // 8-connected Moore neighbourhood, clockwise from west
  const NB = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y) || seen[y * w + x]) continue;
      // start only at a boundary pixel whose west neighbour is outside
      if (at(x - 1, y)) continue;

      const contour = [];
      let cx = x, cy = y, steps = 0;
      const startX = x, startY = y;
      const maxSteps = w * h * 4;
      /* We entered the start pixel from the west (index 0 = background),
         so begin the clockwise sweep at the neighbour after it. */
      let search = 1;

      do {
        contour.push([cx, cy]);
        seen[cy * w + cx] = 1;
        let found = false;
        for (let i = 0; i < 8; i++) {
          const d = (search + i) % 8;
          const nx = cx + NB[d][0], ny = cy + NB[d][1];
          if (at(nx, ny)) {
            cx = nx; cy = ny;
            /* backtrack from the new pixel is (d+4)%8; resume the sweep
               at the next neighbour clockwise from it. */
            search = (d + 5) % 8;
            found = true;
            break;
          }
        }
        if (!found) break;                       // isolated pixel
      } while ((cx !== startX || cy !== startY) && ++steps < maxSteps);

      if (contour.length >= 6) contours.push(contour);
    }
  }
  return contours;
}

/* ---------- 4. simplification (RDP) ---------- */
function rdpSimplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---------- 5. smooth a polygon into bezier anchors ---------- */
function polyToAnchors(poly, smooth) {
  const n = poly.length;
  if (!smooth || n < 3) return poly.map(p => anchor(round2(p[0]), round2(p[1])));
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n];
    const t = 0.28;
    const hin = { x: round2(cur[0] - (next[0] - prev[0]) * t), y: round2(cur[1] - (next[1] - prev[1]) * t) };
    const hout = { x: round2(cur[0] + (next[0] - prev[0]) * t), y: round2(cur[1] + (next[1] - prev[1]) * t) };
    out.push(anchor(round2(cur[0]), round2(cur[1]), hin, hout));
  }
  return out;
}

/* ---------- 6. the tracer ---------- */
function tracePixels(px, opts) {
  const { w, h, data } = px;
  const colors = _clamp(opts.colors | 0, 2, 64);
  const detail = _clamp(opts.detail == null ? 1 : opts.detail, 0.1, 8);   // RDP epsilon
  const minArea = Math.max(1, opts.minArea || 12);
  const smooth = opts.smooth !== false;

  const results = [];

  if (opts.mode === "bw") {
    // single-threshold silhouette
    const thr = _clamp(opts.threshold == null ? 128 : opts.threshold, 1, 254);
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      mask[p] = (data[i + 3] > 128 && lum < thr) ? 1 : 0;
    }
    const cs = traceMask(mask, w, h)
      .map(c => rdpSimplify(c, detail))
      .filter(c => c.length >= 3 && polyArea(c) >= minArea);
    if (cs.length) results.push({ color: "#000000", contours: cs });
    return results;
  }

  /* colour mode */
  const palette = quantise(px, colors);
  const idx = new Uint8Array(w * h);
  const alpha = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    alpha[p] = data[i + 3] > 128 ? 1 : 0;
    if (alpha[p]) idx[p] = nearestIdx(palette, data[i], data[i + 1], data[i + 2]);
  }

  for (let c = 0; c < palette.length; c++) {
    const mask = new Uint8Array(w * h);
    let count = 0;
    for (let p = 0; p < idx.length; p++) {
      if (alpha[p] && idx[p] === c) { mask[p] = 1; count++; }
    }
    if (count < minArea) continue;
    const cs = traceMask(mask, w, h)
      .map(ct => rdpSimplify(ct, detail))
      .filter(ct => ct.length >= 3 && polyArea(ct) >= minArea);
    if (!cs.length) continue;
    const [r, g, b] = palette[c];
    results.push({ color: _hex(r, g, b), contours: cs, size: count });
  }
  // paint large areas first so small details land on top
  results.sort((a, b) => (b.size || 0) - (a.size || 0));
  return results;
}

function polyArea(c) {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i++) {
    const p = c[i], q = c[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/* ---------- 7. public entry: trace the selected image ---------- */
function powerTrace(opts) {
  const img = selectedObjs().find(o => o.type === "image");
  if (!img) { setHint("Select an imported image to trace"); return; }

  opts = Object.assign({
    mode: "color", colors: 12, detail: 1, minArea: 12, smooth: true, threshold: 128, replace: true
  }, opts || {});

  setHint("Tracing…");
  const im = new Image();
  im.crossOrigin = "anonymous";
  im.onload = () => {
    let px;
    try { px = imageToPixels(im, 640); }
    catch (e) { alert("Could not read this image (it may be cross-origin)."); return; }

    const groups = tracePixels(px, opts);
    if (!groups.length) { setHint("Trace produced nothing — try more colours or lower detail"); return; }

    // map pixel space → the image object's world box
    const sx = img.w / px.w, sy = img.h / px.h;
    const kids = [];
    for (const g of groups) {
      const p = makePath([], true);
      p.subpaths = g.contours.map(c => ({
        pts: polyToAnchors(c.map(pt => [img.x + pt[0] * sx, img.y + pt[1] * sy]), opts.smooth),
        closed: true
      }));
      p.pts = p.subpaths[0].pts;
      p.fill = { type: "solid", color: g.color, a: g.color, b: g.color, angle: 90 };
      p.stroke = { on: false, color: "#000000", w: 1, style: "solid" };
      p.name = `Trace ${g.color}`;
      kids.push(p);
    }

    const group = makeGroup(kids);
    group.name = `Traced (${kids.length} colour${kids.length === 1 ? "" : "s"})`;
    const at = App.objects.indexOf(img);
    if (opts.replace) App.objects.splice(at, 1, group);
    else App.objects.splice(at + 1, 0, group);
    App.selection = [group.id];
    commit("power trace");
    render(); updateUI();
    const paths = kids.reduce((n, k) => n + k.subpaths.length, 0);
    setHint(`Traced into ${kids.length} colour path${kids.length === 1 ? "" : "s"} (${paths} outlines) ✓`);
  };
  im.onerror = () => alert("Could not load the image for tracing.");
  im.src = img.href;
}

/* dialog */
function openTraceDialog() {
  const img = selectedObjs().find(o => o.type === "image");
  if (!img) { setHint("Select an imported image first (File ▸ Import Image)"); return; }
  const dlg = $("#trace-modal");
  if (!dlg) return;
  dlg.hidden = false;
}

if (typeof document !== "undefined" && $("#trace-modal")) {
  const dlg = $("#trace-modal");
  const close = () => dlg.hidden = true;
  $("#trace-cancel").addEventListener("click", close);
  dlg.addEventListener("click", e => { if (e.target === dlg) close(); });
  $("#trace-mode").addEventListener("change", () => {
    const bw = $("#trace-mode").value === "bw";
    $("#trace-color-row").style.display = bw ? "none" : "";
    $("#trace-bw-row").style.display = bw ? "" : "none";
  });
  const sync = () => {
    $("#trace-colors-val").textContent = $("#trace-colors").value;
    $("#trace-detail-val").textContent = (+$("#trace-detail").value).toFixed(1);
    $("#trace-threshold-val").textContent = $("#trace-threshold").value;
  };
  ["#trace-colors", "#trace-detail", "#trace-threshold"].forEach(s => $(s).addEventListener("input", sync));
  sync();
  $("#trace-run").addEventListener("click", () => {
    close();
    setTimeout(() => powerTrace({
      mode: $("#trace-mode").value,
      colors: +$("#trace-colors").value,
      detail: +$("#trace-detail").value,
      threshold: +$("#trace-threshold").value,
      smooth: $("#trace-smooth").checked,
      replace: $("#trace-replace").checked,
    }), 20);
  });
}

/* node export for tests */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { traceMask, rdpSimplify, quantise, polyArea, tracePixels };
}
