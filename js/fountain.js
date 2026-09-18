/* ============================================================
   Graphene — Fountain Fill editor & Text-to-Curves
   Multi-stop gradient editing with a draggable ramp, plus
   real glyph outline extraction (text → editable bezier paths)
   using the browser's own font rasteriser + contour tracing.
   ============================================================ */
"use strict";

/* ============================================================
   1. FOUNTAIN FILL (multi-stop gradient) EDITOR
   ============================================================ */
function fillStops(f) {
  if (f.stops && f.stops.length >= 2) return f.stops;
  f.stops = [{ p: 0, c: f.a || "#7C5CFF" }, { p: 1, c: f.b || "#39D2C0" }];
  return f.stops;
}

let activeStop = 0;

function renderRamp() {
  const ramp = $("#grad-ramp");
  if (!ramp) return;
  const o = selectedObjs().find(x => x.fill && (x.fill.type === "linear" || x.fill.type === "radial"));
  const panel = $("#props-fountain");
  if (!o) { if (panel) panel.classList.add("hidden"); return; }
  if (panel) panel.classList.remove("hidden");

  const stops = fillStops(o.fill).slice().sort((a, b) => a.p - b.p);
  o.fill.stops = stops;
  activeStop = clamp(activeStop, 0, stops.length - 1);

  ramp.style.background =
    `linear-gradient(90deg, ${stops.map(s => `${s.c} ${(s.p * 100).toFixed(1)}%`).join(", ")})`;

  const handles = $("#grad-handles");
  handles.innerHTML = "";
  stops.forEach((s, i) => {
    const h = document.createElement("button");
    h.className = "grad-stop" + (i === activeStop ? " on" : "");
    h.style.left = (s.p * 100) + "%";
    h.style.background = s.c;
    h.dataset.i = i;
    h.title = `${s.c} at ${Math.round(s.p * 100)}% — drag to move, double-click to delete`;
    handles.appendChild(h);
  });

  const cur = stops[activeStop];
  if (cur) {
    const col = $("#in-stop-color"), pos = $("#in-stop-pos");
    if (col) col.value = toHex(cur.c);
    if (pos) pos.value = Math.round(cur.p * 100);
  }
}

function eachGradObj(fn) {
  selectedObjs().forEach(o => {
    const walk = x => {
      if (x.type === "group") { x.children.forEach(walk); return; }
      if (x.fill && (x.fill.type === "linear" || x.fill.type === "radial")) fn(x);
    };
    walk(o);
  });
}

function addStopAt(p) {
  eachGradObj(o => {
    const stops = fillStops(o.fill);
    const c = sampleGradient(stops, p);
    stops.push({ p, c });
    stops.sort((a, b) => a.p - b.p);
    activeStop = stops.findIndex(s => s.p === p);
  });
  commit("add gradient stop");
  render(); renderRamp();
}

function deleteStop(i) {
  let removed = false;
  eachGradObj(o => {
    const stops = fillStops(o.fill);
    if (stops.length <= 2) return;
    stops.splice(i, 1);
    removed = true;
  });
  if (!removed) { setHint("A gradient needs at least two stops"); return; }
  activeStop = Math.max(0, activeStop - 1);
  commit("delete gradient stop");
  render(); renderRamp();
}

/* linear interpolation of a stop list at position p */
function sampleGradient(stops, p) {
  const s = stops.slice().sort((a, b) => a.p - b.p);
  if (p <= s[0].p) return s[0].c;
  if (p >= s[s.length - 1].p) return s[s.length - 1].c;
  for (let i = 0; i < s.length - 1; i++) {
    if (p >= s[i].p && p <= s[i + 1].p) {
      const t = (p - s[i].p) / ((s[i + 1].p - s[i].p) || 1);
      return mixHex(s[i].c, s[i + 1].c, t);
    }
  }
  return s[0].c;
}

/* gradient presets */
const GRADIENT_PRESETS = {
  "Sunset":   [{ p: 0, c: "#FF5C7A" }, { p: .5, c: "#FFB86B" }, { p: 1, c: "#FFE38A" }],
  "Ocean":    [{ p: 0, c: "#3A0CA3" }, { p: .5, c: "#4361EE" }, { p: 1, c: "#4CC9F0" }],
  "Mint":     [{ p: 0, c: "#006D77" }, { p: .5, c: "#39D2C0" }, { p: 1, c: "#EDF6F9" }],
  "Grape":    [{ p: 0, c: "#7209B7" }, { p: .5, c: "#B5179E" }, { p: 1, c: "#F72585" }],
  "Gold":     [{ p: 0, c: "#8B5A00" }, { p: .35, c: "#FFD700" }, { p: .5, c: "#FFF8DC" }, { p: .65, c: "#FFD700" }, { p: 1, c: "#8B5A00" }],
  "Steel":    [{ p: 0, c: "#2b2f38" }, { p: .45, c: "#9aa0ad" }, { p: .55, c: "#e6e8ee" }, { p: 1, c: "#42464f" }],
};

function applyGradientPreset(name) {
  const preset = GRADIENT_PRESETS[name];
  if (!preset) return;
  let n = 0;
  selectedObjs().forEach(o => {
    const walk = x => {
      if (x.type === "group") { x.children.forEach(walk); return; }
      if (x.type === "image") return;
      if (x.fill.type !== "linear" && x.fill.type !== "radial") x.fill.type = "linear";
      x.fill.stops = JSON.parse(JSON.stringify(preset));
      x.fill.a = preset[0].c;
      x.fill.b = preset[preset.length - 1].c;
      n++;
    };
    walk(o);
  });
  if (!n) { setHint("Select an object first"); return; }
  activeStop = 0;
  commit("gradient preset");
  render(); updateUI(); renderRamp();
  setHint(`${name} gradient applied ✓`);
}

/* ---------- ramp interaction ---------- */
if (typeof document !== "undefined" && typeof $ === "function" && $("#grad-ramp")) {
  const ramp = $("#grad-ramp");
  const handles = $("#grad-handles");
  let dragStop = null;

  const posFromEvent = e => {
    const r = ramp.getBoundingClientRect();
    return clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
  };

  handles.addEventListener("pointerdown", e => {
    const h = e.target.closest(".grad-stop");
    if (!h) return;
    activeStop = +h.dataset.i;
    dragStop = activeStop;
    handles.setPointerCapture(e.pointerId);
    renderRamp();
    e.stopPropagation();
  });
  window.addEventListener("pointermove", e => {
    if (dragStop == null) return;
    const p = posFromEvent(e);
    eachGradObj(o => {
      const stops = fillStops(o.fill);
      if (stops[dragStop]) stops[dragStop].p = p;
    });
    render(); renderRamp();
  });
  window.addEventListener("pointerup", () => {
    if (dragStop == null) return;
    dragStop = null;
    eachGradObj(o => {
      const stops = fillStops(o.fill);
      stops.sort((a, b) => a.p - b.p);
      o.fill.a = stops[0].c;
      o.fill.b = stops[stops.length - 1].c;
    });
    commit("move gradient stop");
    render(); renderRamp();
  });

  handles.addEventListener("dblclick", e => {
    const h = e.target.closest(".grad-stop");
    if (h) { deleteStop(+h.dataset.i); e.stopPropagation(); }
  });
  ramp.addEventListener("dblclick", e => {
    if (e.target.closest(".grad-stop")) return;
    addStopAt(posFromEvent(e));
  });

  const sc = $("#in-stop-color");
  if (sc) {
    sc.addEventListener("input", () => {
      eachGradObj(o => {
        const stops = fillStops(o.fill);
        if (stops[activeStop]) stops[activeStop].c = sc.value;
        o.fill.a = stops[0].c;
        o.fill.b = stops[stops.length - 1].c;
      });
      render(); renderRamp();
    });
    sc.addEventListener("change", () => commit("gradient stop colour"));
  }
  const sp = $("#in-stop-pos");
  if (sp) {
    sp.addEventListener("input", () => {
      const p = clamp(+sp.value, 0, 100) / 100;
      eachGradObj(o => {
        const stops = fillStops(o.fill);
        if (stops[activeStop]) stops[activeStop].p = p;
      });
      render(); renderRamp();
    });
    sp.addEventListener("change", () => commit("gradient stop position"));
  }
  const rev = $("#btn-grad-reverse");
  if (rev) rev.addEventListener("click", () => {
    eachGradObj(o => {
      const stops = fillStops(o.fill);
      stops.forEach(s => s.p = 1 - s.p);
      stops.sort((a, b) => a.p - b.p);
      o.fill.a = stops[0].c; o.fill.b = stops[stops.length - 1].c;
    });
    commit("reverse gradient");
    render(); renderRamp();
  });

  const presetSel = $("#in-grad-preset");
  if (presetSel) {
    Object.keys(GRADIENT_PRESETS).forEach(k => {
      const opt = document.createElement("option");
      opt.value = k; opt.textContent = k;
      presetSel.appendChild(opt);
    });
    presetSel.addEventListener("change", () => {
      if (presetSel.value) applyGradientPreset(presetSel.value);
      presetSel.value = "";
    });
  }
}

/* ============================================================
   2. TEXT → CURVES (glyph outlines)
   Renders the glyphs to an offscreen canvas at high resolution,
   traces the alpha channel, and converts to editable paths.
   This works with ANY font the system has, without parsing
   font binaries.
   ============================================================ */
function textToCurves() {
  const texts = selectedObjs().filter(o => o.type === "text");
  if (!texts.length) { setHint("Select a text object to convert to curves"); return; }

  let made = 0;
  for (const o of texts) {
    const p = glyphOutlines(o);
    if (!p) continue;
    const i = App.objects.indexOf(o);
    if (i < 0) continue;
    App.objects.splice(i, 1, p);
    made++;
  }
  if (!made) { setHint("Could not convert this text"); return; }
  App.selection = App.objects.filter(o => o.name && o.name.endsWith("(curves)")).map(o => o.id);
  commit("text to curves");
  render(); updateUI();
  setHint(`Converted ${made} text object${made === 1 ? "" : "s"} to curves ✓`);
}

function glyphOutlines(o) {
  const SS = 4;                                  // supersample factor
  const lines = String(o.text || "").split("\n");
  const size = o.size || 16;
  const lh = size * (o.lineHeight || 1.2);

  const measure = document.createElement("canvas").getContext("2d");
  const style = `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}`;
  measure.font = `${style}${size}px ${o.font || "Arial"}`;
  const widths = lines.map(l => measure.measureText(l).width);
  const maxW = Math.max(1, ...widths);

  const padL = size * 0.4, padT = size * 1.1, padB = size * 0.6;
  const W = Math.ceil((maxW + padL * 2) * SS);
  const H = Math.ceil((padT + lh * (lines.length - 1) + size + padB) * SS);
  if (W < 2 || H < 2 || W * H > 36e6) return null;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  ctx.font = `${style}${size * SS}px ${o.font || "Arial"}`;
  ctx.textAlign = o.align === "center" ? "center" : o.align === "right" ? "right" : "left";
  const ox = o.align === "center" ? (padL + maxW / 2) * SS
           : o.align === "right" ? (padL + maxW) * SS
           : padL * SS;
  lines.forEach((ln, i) => ctx.fillText(ln, ox, (padT + i * lh) * SS));

  let img;
  try { img = ctx.getImageData(0, 0, W, H); } catch (e) { return null; }

  // threshold to a binary mask (glyphs are dark on white)
  const mask = new Uint8Array(W * H);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) mask[p] = d[i] < 128 ? 1 : 0;

  const contours = traceMask(mask, W, H)
    .map(ct => rdpSimplify(ct, 1.1))
    .filter(ct => ct.length >= 3 && polyArea(ct) >= 6);
  if (!contours.length) return null;

  // pixel space → world space; the baseline of line 0 sits at o.y
  const inv = 1 / SS;
  const originX = o.x - padL;
  const originY = o.y - padT;
  const sub = contours.map(ct => ({
    pts: ct.map(pt => anchor(
      round2(originX + pt[0] * inv),
      round2(originY + pt[1] * inv)
    )),
    closed: true
  }));

  const p = makePath([], true);
  p.subpaths = sub;
  p.pts = sub[0].pts;
  p.fill = JSON.parse(JSON.stringify(o.fill));
  p.stroke = JSON.parse(JSON.stringify(o.stroke));
  p.opacity = o.opacity;
  p.rot = o.rot;
  if (o.fx) p.fx = JSON.parse(JSON.stringify(o.fx));
  p.name = `${(o.text || "Text").split("\n")[0].slice(0, 16)} (curves)`;
  return p;
}

/* keep the ramp in sync whenever the panel refreshes */
if (typeof window !== "undefined") {
  window.addEventListener("graphene:ui", renderRamp);
}
