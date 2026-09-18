/* ============================================================
   Graphene — Pro systems
   Multi-page documents · Color palettes (CMYK/HSB/swatches) ·
   Text on path · Contour/offset · Blend · Symbols/assets ·
   Measurement & dimension readout · Auto-save recovery
   ============================================================ */
"use strict";

/* ============================================================
   1. MULTI-PAGE DOCUMENTS
   ============================================================ */
function ensurePages() {
  if (!App.pages) {
    App.pages = [{ name: "Page 1", objects: App.objects, guides: App.doc.guides }];
    App.pageIndex = 0;
  }
  return App.pages;
}

function syncActivePage() {
  const pages = ensurePages();
  const p = pages[App.pageIndex];
  if (p) { p.objects = App.objects; p.guides = App.doc.guides; }
}

function gotoPage(i) {
  const pages = ensurePages();
  if (i < 0 || i >= pages.length || i === App.pageIndex) return;
  syncActivePage();
  App.pageIndex = i;
  const p = pages[i];
  App.objects = p.objects;
  App.doc.guides = p.guides || { h: [], v: [] };
  App.selection = []; App.nodeEdit = { id: null, sel: [] };
  render(); updateUI(); renderPageBar();
  setHint(`${p.name}`);
}

function addPage(duplicateCurrent) {
  const pages = ensurePages();
  syncActivePage();
  const objs = duplicateCurrent ? JSON.parse(JSON.stringify(App.objects)) : [];
  if (duplicateCurrent) objs.forEach(reassignIds);
  pages.splice(App.pageIndex + 1, 0, {
    name: `Page ${pages.length + 1}`,
    objects: objs,
    guides: { h: [], v: [] }
  });
  App.pageIndex++;
  App.objects = pages[App.pageIndex].objects;
  App.doc.guides = pages[App.pageIndex].guides;
  App.selection = [];
  commit("add page");
  render(); updateUI(); renderPageBar();
}

function deletePage() {
  const pages = ensurePages();
  if (pages.length < 2) { setHint("A document needs at least one page"); return; }
  pages.splice(App.pageIndex, 1);
  App.pageIndex = Math.max(0, App.pageIndex - 1);
  App.objects = pages[App.pageIndex].objects;
  App.doc.guides = pages[App.pageIndex].guides || { h: [], v: [] };
  App.selection = [];
  commit("delete page");
  render(); updateUI(); renderPageBar();
}

function renamePage() {
  const pages = ensurePages();
  const n = prompt("Page name:", pages[App.pageIndex].name);
  if (n == null) return;
  pages[App.pageIndex].name = n.trim() || pages[App.pageIndex].name;
  commit("rename page"); renderPageBar();
}

function renderPageBar() {
  const bar = $("#pagebar");
  if (!bar) return;
  const pages = ensurePages();
  bar.innerHTML = "";
  pages.forEach((p, i) => {
    const b = document.createElement("button");
    b.className = "page-tab" + (i === App.pageIndex ? " on" : "");
    b.textContent = p.name;
    b.title = `${p.objects.length} object${p.objects.length === 1 ? "" : "s"}`;
    b.addEventListener("click", () => gotoPage(i));
    b.addEventListener("dblclick", renamePage);
    bar.appendChild(b);
  });
  const add = document.createElement("button");
  add.className = "page-add";
  add.textContent = "+";
  add.title = "Add page (Alt+click to duplicate current)";
  add.addEventListener("click", e => addPage(e.altKey));
  bar.appendChild(add);
}

/* ============================================================
   2. COLOR — CMYK / HSB conversion + palette docker
   ============================================================ */
function rgb2cmyk(hex) {
  const c = hex2rgb(hex);
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round((1 - r - k) / (1 - k) * 100),
    m: Math.round((1 - g - k) / (1 - k) * 100),
    y: Math.round((1 - b - k) / (1 - k) * 100),
    k: Math.round(k * 100)
  };
}
function cmyk2rgb(c, m, y, k) {
  c /= 100; m /= 100; y /= 100; k /= 100;
  return rgb2hex(
    Math.round(255 * (1 - c) * (1 - k)),
    Math.round(255 * (1 - m) * (1 - k)),
    Math.round(255 * (1 - y) * (1 - k))
  );
}
function hex2rgb(hex) {
  hex = (hex || "#000000").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgb2hex(r, g, b) {
  return "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}
function rgb2hsb(hex) {
  const { r, g, b } = hex2rgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === R) h = ((G - B) / d) % 6;
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(mx ? d / mx * 100 : 0), b: Math.round(mx * 100) };
}
function hsb2rgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgb2hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/* default palette — print-friendly spread */
const PALETTE = [
  "#000000", "#3d3d3d", "#6b6b6b", "#9a9a9a", "#c9c9c9", "#ffffff",
  "#7C5CFF", "#5b3dff", "#a18bff", "#39D2C0", "#1aa596", "#7ff0e3",
  "#FF5C7A", "#e02a4d", "#ff9eb0", "#FFB86B", "#f08b1d", "#ffd9a8",
  "#4CC9F0", "#1580c4", "#b3e6fb", "#8AC926", "#5a8c14", "#d4f08a",
  "#F72585", "#B5179E", "#7209B7", "#560BAD", "#3A0CA3", "#4361EE",
  "#006D77", "#83C5BE", "#EDF6F9", "#FFDDD2", "#E29578", "#8B4513",
];

function renderPalette() {
  const el = $("#palette");
  if (!el) return;
  el.innerHTML = "";
  const custom = JSON.parse(localStorage.getItem("graphene-swatches") || "[]");
  [...PALETTE, ...custom].forEach(c => {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = c;
    b.title = `${c}  ·  click = fill, Shift+click = stroke`;
    b.addEventListener("click", e => {
      const objs = selectedObjs();
      if (!objs.length) { App.doc.bg = c; render(); syncDocInputs(); commit("page colour"); return; }
      eachPaintable(o => {
        if (e.shiftKey) { o.stroke.on = true; o.stroke.color = c; }
        else { o.fill.type = "solid"; o.fill.color = c; o.fill.a = c; }
      });
      commit("colour"); render(); updateUI();
    });
    el.appendChild(b);
  });
  const add = document.createElement("button");
  add.className = "swatch swatch-add";
  add.textContent = "+";
  add.title = "Save current fill as a swatch";
  add.addEventListener("click", () => {
    const o = selectedObjs().find(x => x.fill && x.fill.type === "solid");
    const c = o ? o.fill.color : App.doc.bg;
    const list = JSON.parse(localStorage.getItem("graphene-swatches") || "[]");
    if (!list.includes(c)) list.push(c);
    localStorage.setItem("graphene-swatches", JSON.stringify(list));
    renderPalette();
    setHint(`Swatch ${c} saved`);
  });
  el.appendChild(add);
}

function syncColorModel() {
  const o = selectedObjs().find(x => x.fill && x.fill.type === "solid");
  const hex = o ? o.fill.color : App.doc.bg;
  const cm = rgb2cmyk(hex), hs = rgb2hsb(hex);
  const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  set("#in-c", cm.c); set("#in-m", cm.m); set("#in-y", cm.y); set("#in-k", cm.k);
  set("#in-hh", hs.h); set("#in-ss", hs.s); set("#in-bb", hs.b);
  set("#in-hex", hex.toUpperCase());
}

function applyHexColor(hex) {
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) return;
  if (hex[0] !== "#") hex = "#" + hex;
  const objs = selectedObjs();
  if (!objs.length) { App.doc.bg = hex; render(); syncDocInputs(); return; }
  eachPaintable(o => { o.fill.type = "solid"; o.fill.color = hex; o.fill.a = hex; });
  render();
}

/* ============================================================
   3. TEXT ON PATH
   ============================================================ */
function attachTextToPath() {
  const objs = selectedObjs();
  const txt = objs.find(o => o.type === "text");
  const pth = objs.find(o => o.type === "path" || o.type === "ellipse" || o.type === "rect" || o.type === "polygon" || o.type === "line");
  if (!txt || !pth) { setHint("Select one text object and one path/shape"); return; }
  txt.onPath = pth.id;
  txt.pathOffset = txt.pathOffset || 0;
  txt.pathSide = txt.pathSide || "above";
  commit("text on path");
  render(); updateUI();
  setHint("Text fitted to path ✓");
}
function detachTextFromPath() {
  let n = 0;
  for (const o of selectedObjs()) if (o.type === "text" && o.onPath) { delete o.onPath; n++; }
  if (!n) { setHint("No text on a path selected"); return; }
  commit("detach text"); render(); updateUI();
  setHint("Text detached ✓");
}

/* build/refresh the <path> in <defs> that a textPath references */
function ensureTextPathDef(o) {
  const host = findObj(o.onPath);
  if (!host) return null;
  const pid = `tp-${o.id}`;
  let p = document.getElementById(pid);
  if (p) p.remove();
  let d = "";
  if (host.type === "path") d = pathD(host);
  else {
    const pts = shapeToPathPts(host);
    if (pts) d = pathD({ pts, closed: host.type !== "line" });
  }
  if (!d) return null;
  p = svgEl("path", { id: pid, d });
  gDefs.appendChild(p);
  return pid;
}

/* ============================================================
   4. CONTOUR (inner / outer offset) — CorelDRAW's Contour tool
   ============================================================ */
function offsetContour(contour, dist) {
  const n = contour.length;
  if (n < 3) return null;
  // signed area → orientation
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const p = contour[i], q = contour[(i + 1) % n];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  const sign = a2 >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = contour[(i - 1 + n) % n], cur = contour[i], next = contour[(i + 1) % n];
    const v1 = [cur[0] - prev[0], cur[1] - prev[1]];
    const v2 = [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(v1[0], v1[1]) || 1, l2 = Math.hypot(v2[0], v2[1]) || 1;
    // outward normals
    const n1 = [v1[1] / l1 * sign, -v1[0] / l1 * sign];
    const n2 = [v2[1] / l2 * sign, -v2[0] / l2 * sign];
    let bx = n1[0] + n2[0], by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { bx = n1[0]; by = n1[1]; }
    else { bx /= bl; by /= bl; }
    // miter length compensation, clamped to avoid spikes
    const cosHalf = Math.max(0.2, (bx * n1[0] + by * n1[1]));
    const m = clamp(dist / cosHalf, -Math.abs(dist) * 4, Math.abs(dist) * 4);
    out.push([cur[0] + bx * m, cur[1] + by * m]);
  }
  return out;
}

function contourSelection(dir) {
  const objs = selectedObjs().filter(o => !o.locked);
  if (!objs.length) { setHint("Select an object to contour"); return; }
  const steps = clamp(+($("#in-contour-steps") || {}).value || 3, 1, 20);
  const gap = clamp(+($("#in-contour-gap") || {}).value || 8, 0.5, 200);
  const created = [];
  for (const o of objs) {
    const base = objContours(o);
    for (let s = 1; s <= steps; s++) {
      const d = dir * gap * s;
      let rings = base.map(c => offsetContour(c, d)).filter(Boolean);
      // self-intersection cleanup: union each ring with itself via boolean
      rings = rings.filter(r => r && r.length >= 3 && contourArea(r) > 1);
      if (!rings.length) break;
      const p = contoursToPath(rings, o);
      if (!p) break;
      p.name = `${o.name || cap(o.type)} contour ${s}`;
      // fade colour towards background for depth
      const t = s / (steps + 1);
      if (p.fill.type === "solid") p.fill.color = p.fill.a = mixHex(o.fill.color, App.doc.bg, dir > 0 ? t * 0.55 : t * 0.35);
      const at = App.objects.indexOf(o);
      App.objects.splice(dir > 0 ? at : at + 1, 0, p);
      created.push(p.id);
    }
  }
  if (!created.length) { setHint("Contour produced nothing — try a smaller offset"); return; }
  App.selection = created;
  commit("contour");
  render(); updateUI();
  setHint(`Contour: ${created.length} step${created.length === 1 ? "" : "s"} ✓`);
}

function mixHex(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

/* ============================================================
   5. BLEND — morph between two objects (CorelDRAW Blend tool)
   ============================================================ */
function blendSelection() {
  const objs = App.objects.filter(o => App.selection.includes(o.id));
  if (objs.length !== 2) { setHint("Select exactly 2 objects to blend"); return; }
  const steps = clamp(+($("#in-blend-steps") || {}).value || 6, 1, 60);
  const [a, b] = objs;
  const ca = objContours(a), cb = objContours(b);
  if (!ca.length || !cb.length) { setHint("Objects cannot be blended"); return; }
  const A = resample(ca[0], 96), B = resample(cb[0], 96);
  // rotate B so its start point is nearest A's — avoids twisting
  const off = bestOffset(A, B);
  const created = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / (steps + 1);
    const pts = A.map((p, i) => {
      const q = B[(i + off) % B.length];
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    });
    const p = contoursToPath([pts], a);
    if (!p) continue;
    p.name = `Blend ${s}`;
    if (p.fill.type === "solid" && b.fill.type === "solid") p.fill.color = p.fill.a = mixHex(a.fill.color, b.fill.color, t);
    p.opacity = a.opacity + (b.opacity - a.opacity) * t;
    const at = App.objects.indexOf(b);
    App.objects.splice(at, 0, p);
    created.push(p.id);
  }
  if (!created.length) { setHint("Blend failed"); return; }
  App.selection = created;
  commit("blend");
  render(); updateUI();
  setHint(`Blended in ${created.length} steps ✓`);
}

/* resample a closed contour to n evenly-spaced points */
function resample(contour, n) {
  const pts = contour.slice();
  if (pts.length < 2) return pts;
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    seg.push(d); total += d;
  }
  if (total === 0) return pts;
  const out = [];
  const step = total / n;
  let i = 0, acc = 0, target = 0;
  for (let k = 0; k < n; k++) {
    while (acc + seg[i] < target && i < seg.length - 1) { acc += seg[i]; i++; }
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const t = seg[i] ? (target - acc) / seg[i] : 0;
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    target += step;
  }
  return out;
}
function bestOffset(A, B) {
  let best = 0, bestD = Infinity;
  const n = B.length, probe = Math.max(1, Math.floor(n / 24));
  for (let off = 0; off < n; off += probe) {
    let d = 0;
    for (let i = 0; i < A.length; i += 8) {
      const p = A[i], q = B[(i + off) % n];
      d += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    }
    if (d < bestD) { bestD = d; best = off; }
  }
  return best;
}

/* ============================================================
   6. POWERCLIP — place objects inside a container shape
   ============================================================ */
function powerClip() {
  const objs = App.objects.filter(o => App.selection.includes(o.id));
  if (objs.length < 2) { setHint("Select content plus a container shape (front-most = container)"); return; }
  const container = objs[objs.length - 1];
  const content = objs.slice(0, -1);
  const g = makeGroup(content.map(o => JSON.parse(JSON.stringify(o))));
  g.clipWith = JSON.parse(JSON.stringify(container));
  g.name = "PowerClip";
  const set = new Set(objs.map(o => o.id));
  const at = App.objects.findIndex(o => set.has(o.id));
  App.objects = App.objects.filter(o => !set.has(o.id));
  App.objects.splice(Math.max(0, at), 0, g);
  App.selection = [g.id];
  commit("powerclip");
  render(); updateUI();
  setHint("PowerClip created ✓");
}
function releaseClip() {
  const objs = selectedObjs().filter(o => o.type === "group" && o.clipWith);
  if (!objs.length) { setHint("Select a PowerClip group"); return; }
  for (const g of objs) {
    const at = App.objects.indexOf(g);
    const kids = g.children;
    const cont = g.clipWith;
    App.objects.splice(at, 1, ...kids, cont);
  }
  App.selection = [];
  commit("release powerclip");
  render(); updateUI();
  setHint("PowerClip released ✓");
}

/* build the <clipPath> for a powerclip group */
function ensureClipDef(o) {
  const cid = `clip-${o.id}`;
  let cp = document.getElementById(cid);
  if (cp) cp.remove();
  const shape = renderObj(Object.assign({}, o.clipWith, { opacity: 1, visible: true }));
  if (!shape) return null;
  cp = svgEl("clipPath", { id: cid, clipPathUnits: "userSpaceOnUse" });
  shape.removeAttribute("filter");
  cp.appendChild(shape);
  gDefs.appendChild(cp);
  return cid;
}

/* ============================================================
   7. AUTO-SAVE / CRASH RECOVERY
   ============================================================ */
const AUTOSAVE_KEY = "graphene-autosave";
let autosaveTimer = null;

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      syncActivePage();
      const payload = JSON.stringify({
        app: "graphene", version: 3, t: Date.now(),
        doc: App.doc, pages: App.pages, pageIndex: App.pageIndex, idSeq: App.idSeq
      });
      if (payload.length < 4_500_000) localStorage.setItem(AUTOSAVE_KEY, payload);
    } catch (e) { /* quota — ignore */ }
  }, 1500);
}

function checkRecovery() {
  let raw;
  try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return; }
  if (!raw) return;
  let s;
  try { s = JSON.parse(raw); } catch (e) { return; }
  if (!s || !s.pages || !s.pages.length) return;
  const total = s.pages.reduce((n, p) => n + (p.objects ? p.objects.length : 0), 0);
  if (!total) return;
  const when = new Date(s.t || Date.now());
  const bar = document.createElement("div");
  bar.id = "recovery-bar";
  bar.innerHTML =
    `<span>Recovered work from <b>${when.toLocaleString()}</b> — ${total} object${total === 1 ? "" : "s"} across ${s.pages.length} page${s.pages.length === 1 ? "" : "s"}.</span>` +
    `<button id="rec-restore">Restore</button><button id="rec-discard">Discard</button>`;
  document.body.appendChild(bar);
  $("#rec-restore").addEventListener("click", () => {
    App.doc = s.doc;
    App.pages = s.pages;
    App.pageIndex = clamp(s.pageIndex || 0, 0, s.pages.length - 1);
    App.objects = App.pages[App.pageIndex].objects;
    App.doc.guides = App.pages[App.pageIndex].guides || { h: [], v: [] };
    App.idSeq = s.idSeq || 1000;
    App.selection = [];
    App.history = []; App.histIndex = -1;
    commit("restore");
    render(); updateUI(); renderPageBar(); zoomFit();
    bar.remove();
    setHint("Work restored ✓");
  });
  $("#rec-discard").addEventListener("click", () => {
    localStorage.removeItem(AUTOSAVE_KEY);
    bar.remove();
  });
  setTimeout(() => bar.remove(), 30000);
}

/* ============================================================
   8. DIMENSION READOUT while dragging
   ============================================================ */
function drawDimensions(bb) {
  const g = $("#dimension-layer");
  if (g) g.remove();
  if (!bb) return;
  const z = App.zoom;
  const grp = svgEl("g", { id: "dimension-layer", "pointer-events": "none" });
  const label = (x, y, text) => {
    const pad = 3 / z;
    const t = svgEl("text", {
      x, y, "font-size": 11 / z, "font-family": "ui-monospace, monospace",
      fill: "#fff", "text-anchor": "middle", "dominant-baseline": "middle"
    });
    t.textContent = text;
    const w = (text.length * 6.2 + 8) / z, h = 15 / z;
    grp.appendChild(svgEl("rect", { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 3 / z, fill: "#7C5CFF" }));
    grp.appendChild(t);
  };
  label(bb.x + bb.w / 2, bb.y - 14 / z, `${Math.round(bb.w)} × ${Math.round(bb.h)}`);
  label(bb.x + bb.w / 2, bb.y + bb.h + 14 / z, `x ${Math.round(bb.x)}  y ${Math.round(bb.y)}`);
  gOverlay.appendChild(grp);
}
function clearDimensions() { const g = $("#dimension-layer"); if (g) g.remove(); }

/* ============================================================
   9. WIRING
   ============================================================ */
/* palette + colour model inputs */
["#in-c", "#in-m", "#in-y", "#in-k"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const hex = cmyk2rgb(+$("#in-c").value || 0, +$("#in-m").value || 0, +$("#in-y").value || 0, +$("#in-k").value || 0);
    applyHexColor(hex);
    const hx = $("#in-hex"); if (hx) hx.value = hex.toUpperCase();
  });
  el.addEventListener("change", () => { commit("cmyk colour"); updateUI(); });
});
["#in-hh", "#in-ss", "#in-bb"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const hex = hsb2rgb(+$("#in-hh").value || 0, +$("#in-ss").value || 0, +$("#in-bb").value || 0);
    applyHexColor(hex);
    const hx = $("#in-hex"); if (hx) hx.value = hex.toUpperCase();
  });
  el.addEventListener("change", () => { commit("hsb colour"); updateUI(); });
});
if ($("#in-hex")) {
  $("#in-hex").addEventListener("change", () => {
    applyHexColor($("#in-hex").value.trim());
    commit("hex colour"); updateUI();
  });
}

/* contour / blend buttons */
if ($("#btn-contour-out")) $("#btn-contour-out").addEventListener("click", () => contourSelection(1));
if ($("#btn-contour-in")) $("#btn-contour-in").addEventListener("click", () => contourSelection(-1));
if ($("#btn-blend")) $("#btn-blend").addEventListener("click", blendSelection);

/* text-on-path controls */
if ($("#in-path-offset")) {
  $("#in-path-offset").addEventListener("input", () => {
    const o = selectedObjs()[0];
    if (o && o.type === "text" && o.onPath) {
      o.pathOffset = +$("#in-path-offset").value;
      const lv = $("#path-offset-val"); if (lv) lv.textContent = o.pathOffset + "%";
      render();
    }
  });
  $("#in-path-offset").addEventListener("change", () => { commit("text offset"); });
}
if ($("#in-path-side")) {
  $("#in-path-side").addEventListener("change", () => {
    const o = selectedObjs()[0];
    if (o && o.type === "text" && o.onPath) { o.pathSide = $("#in-path-side").value; commit("text side"); render(); }
  });
}

/* boot pro systems after the main app has booted.
   Runs immediately if the document is already parsed (script order /
   cached loads mean the "load" event may have fired already). */
function bootPro() {
  ensurePages();
  renderPageBar();
  renderPalette();
  syncColorModel();
  checkRecovery();
}
bootPro();
if (document.readyState !== "complete") {
  window.addEventListener("load", () => { ensurePages(); renderPageBar(); renderPalette(); }, { once: true });
}
