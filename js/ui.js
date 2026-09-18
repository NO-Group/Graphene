/* ============================================================
   Graphene — UI: panels, menus, commands, shortcuts, IO
   ============================================================ */
"use strict";

/* ---------- build toolbar ---------- */
(function buildToolbar() {
  const tb = $("#toolbar");
  for (const t of TOOLS) {
    if (t.sep) { const s = document.createElement("div"); s.className = "tool-sep"; tb.appendChild(s); continue; }
    const b = document.createElement("button");
    b.className = "tool";
    b.dataset.tool = t.id;
    b.innerHTML = t.icon + `<span class="tip">${t.name} <b style="opacity:.6">${t.key}</b></span>`;
    b.addEventListener("click", () => setTool(t.id));
    tb.appendChild(b);
  }
})();

/* ---------- menus ---------- */
$$("[data-menu]").forEach(menu => {
  const title = menu.querySelector(".menu-title");
  title.addEventListener("click", e => {
    e.stopPropagation();
    const open = menu.classList.contains("open");
    $$(".menu.open").forEach(m => m.classList.remove("open"));
    if (!open) menu.classList.add("open");
  });
  menu.addEventListener("mouseenter", () => {
    if ($(".menu.open") && !menu.classList.contains("open")) {
      $$(".menu.open").forEach(m => m.classList.remove("open"));
      menu.classList.add("open");
    }
  });
});
document.addEventListener("click", () => $$(".menu.open").forEach(m => m.classList.remove("open")));

/* dispatch all [data-cmd] buttons */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-cmd]");
  if (b) runCommand(b.dataset.cmd);
});

/* ---------- commands ---------- */
function runCommand(cmd) {
  switch (cmd) {
    case "new": newDocument(); break;
    case "open": $("#file-open").click(); break;
    case "save": saveProject(); break;
    case "import-image": $("#file-image").click(); break;
    case "import-svg": $("#file-svg").click(); break;
    case "export-svg": exportSVG(); break;
    case "export-png": exportPNG(1); break;
    case "export-png2": exportPNG(2); break;
    case "export-png4": exportPNG(4); break;
    case "undo": undo(); break;
    case "redo": redo(); break;
    case "cut": copySelection(); deleteSelection(); break;
    case "copy": copySelection(); break;
    case "paste": pasteClipboard(); break;
    case "duplicate": duplicateSelection(); break;
    case "delete": deleteSelection(); break;
    case "select-all":
      App.selection = App.objects.filter(o => o.visible && !o.locked).map(o => o.id);
      render(); updateUI(); break;
    case "group": groupSelection(); break;
    case "ungroup": ungroupSelection(); break;
    case "front": reorder("front"); break;
    case "back": reorder("back"); break;
    case "forward": reorder("forward"); break;
    case "backward": reorder("backward"); break;
    case "flip-h": applyToSelection(o => flipObj(o, true), "flip"); break;
    case "flip-v": applyToSelection(o => flipObj(o, false), "flip"); break;
    case "to-path": convertSelectionToPath(); break;
    case "combine": combinePaths(); break;
    case "break-apart": breakApart(); break;
    case "lock": lockSelection(); break;
    case "unlock-all": unlockAll(); break;

    /* --- boolean shaping --- */
    case "shape-weld": shapeOp("weld"); break;
    case "shape-trim": shapeOp("trim"); break;
    case "shape-intersect": shapeOp("intersect"); break;
    case "shape-exclude": shapeOp("exclude"); break;
    case "shape-fmb": shapeOp("fmb"); break;
    case "shape-bmf": shapeOp("bmf"); break;
    case "shape-simplify": shapeOp("simplify"); break;
    case "shape-boundary": shapeOp("boundary"); break;

    /* --- powerclip --- */
    case "powerclip": powerClip(); break;
    case "release-clip": releaseClip(); break;

    /* --- text on path --- */
    case "text-on-path": attachTextToPath(); break;
    case "text-off-path": detachTextFromPath(); break;

    /* --- pages --- */
    case "page-add": addPage(false); break;
    case "page-dup": addPage(true); break;
    case "page-rename": renamePage(); break;
    case "page-delete": deletePage(); break;

    /* --- page presets --- */
    case "preset-a4": setPageSize(794, 1123); break;
    case "preset-letter": setPageSize(816, 1056); break;
    case "preset-square": setPageSize(1080, 1080); break;
    case "preset-hd": setPageSize(1920, 1080); break;
    case "preset-card": setPageSize(1050, 600); break;

    case "export-pdf": openPDFDialog(); break;
    case "export-pdf-quick": exportPDF({ colorSpace: "cmyk", allPages: true }); break;
    case "text-to-curves": textToCurves(); break;

    /* --- bitmap tracing --- */
    case "trace": openTraceDialog(); break;
    case "trace-quick": powerTrace({ mode: "color", colors: 16, detail: 1, smooth: true }); break;
    case "trace-bw": powerTrace({ mode: "bw", threshold: 128, detail: 1, smooth: true }); break;

    /* --- distortion --- */
    case "envelope": startEnvelope("envelope"); break;
    case "perspective": startEnvelope("perspective"); break;
    case "roughen": roughenSelection(); break;
    case "twirl": twirlSelection(); break;

    /* --- view --- */
    case "toggle-outline":
      document.body.classList.toggle("outline-view");
      setHint("Wireframe view " + (document.body.classList.contains("outline-view") ? "on" : "off"));
      break;
    case "toggle-palette":
      document.body.classList.toggle("palette-off");
      break;
    case "toggle-rulers": setRulers(!App.rulers); break;
    case "toggle-smart": App.smartGuides = !App.smartGuides; setHint("Smart guides " + (App.smartGuides ? "on" : "off")); break;
    case "clear-guides": App.doc.guides = { h: [], v: [] }; commit("clear guides"); render(); break;
    case "zoom-in": zoomAt(stageCenter().x, stageCenter().y, App.zoom * 1.25); break;
    case "zoom-out": zoomAt(stageCenter().x, stageCenter().y, App.zoom / 1.25); break;
    case "zoom-100": zoomAt(stageCenter().x, stageCenter().y, 1); break;
    case "zoom-fit": zoomFit(); break;
    case "toggle-grid": App.doc.grid.show = !App.doc.grid.show; render(); syncDocInputs(); break;
    case "toggle-snap": App.doc.grid.snap = !App.doc.grid.snap; syncDocInputs(); break;
    case "help": $("#modal").hidden = false; break;
  }
}
function stageCenter() {
  const r = stage.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function setPageSize(w, h) {
  App.doc.w = w; App.doc.h = h;
  commit("page size");
  render(); syncDocInputs(); zoomFit();
  setHint(`Page set to ${w} × ${h}`);
}

function applyToSelection(fn, label) {
  const objs = selectedObjs();
  if (!objs.length) return;
  objs.forEach(fn);
  commit(label);
  render(); updateUI();
}

/* ---------- clipboard / duplicate / delete ---------- */
function copySelection() {
  const objs = selectedObjs();
  if (objs.length) App.clipboard = JSON.stringify(objs);
}
function pasteClipboard() {
  if (!App.clipboard) return;
  const objs = JSON.parse(App.clipboard);
  const ids = [];
  for (const o of objs) {
    reassignIds(o);
    moveObj(o, 24, 24);
    App.objects.push(o);
    ids.push(o.id);
  }
  App.selection = ids;
  commit("paste");
  render(); updateUI();
}
function duplicateSelection() {
  const objs = selectedObjs();
  if (!objs.length) return;
  const ids = [];
  for (const src of objs) {
    const o = JSON.parse(JSON.stringify(src));
    reassignIds(o);
    moveObj(o, 24, 24);
    App.objects.push(o);
    ids.push(o.id);
  }
  App.selection = ids;
  commit("duplicate");
  render(); updateUI();
}
function reassignIds(o) {
  o.id = uid();
  if (o.type === "group") o.children.forEach(reassignIds);
}
function deleteSelection() {
  if (App.tool === "node" && App.nodeEdit.sel.length) { deleteSelectedNodes(); return; }
  if (!App.selection.length) return;
  for (const id of App.selection) removeObj(id);
  App.selection = [];
  commit("delete");
  render(); updateUI();
}

/* ---------- group / ungroup ---------- */
function groupSelection() {
  const objs = selectedObjs();
  if (objs.length < 2) return;
  const set = new Set(App.selection);
  const children = App.objects.filter(o => set.has(o.id));
  App.objects = App.objects.filter(o => !set.has(o.id));
  const g = makeGroup(children);
  App.objects.push(g);
  App.selection = [g.id];
  commit("group");
  render(); updateUI();
}
function ungroupSelection() {
  const objs = selectedObjs().filter(o => o.type === "group");
  if (!objs.length) return;
  const newSel = [];
  for (const g of objs) {
    const i = App.objects.indexOf(g);
    App.objects.splice(i, 1, ...g.children);
    newSel.push(...g.children.map(c => c.id));
  }
  App.selection = newSel;
  commit("ungroup");
  render(); updateUI();
}

/* ---------- z-order ---------- */
function reorder(how) {
  const set = new Set(App.selection);
  if (!set.size) return;
  const sel = App.objects.filter(o => set.has(o.id));
  const rest = App.objects.filter(o => !set.has(o.id));
  if (how === "front") App.objects = [...rest, ...sel];
  else if (how === "back") App.objects = [...sel, ...rest];
  else {
    const arr = [...App.objects];
    const idxs = sel.map(o => arr.indexOf(o)).sort((a, b) => how === "forward" ? b - a : a - b);
    for (const i of idxs) {
      const j = how === "forward" ? i + 1 : i - 1;
      if (j < 0 || j >= arr.length || set.has(arr[j].id)) continue;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    App.objects = arr;
  }
  commit("reorder");
  render(); updateUI();
}

/* ---------- convert to path ---------- */
function convertSelectionToPath() {
  let changed = false;
  App.objects = App.objects.map(o => {
    if (!App.selection.includes(o.id)) return o;
    const p = convertToPath(o);
    if (p !== o) changed = true;
    return p;
  });
  if (changed) { commit("convert to path"); render(); updateUI(); }
}

/* ---------- align / distribute ---------- */
$("#align-row").addEventListener("click", e => {
  const b = e.target.closest("[data-align]");
  if (!b) return;
  const objs = selectedObjs();
  if (!objs.length) return;
  const mode = b.dataset.align;
  const ref = objs.length > 1 ? selectionBBox() : { x: 0, y: 0, w: App.doc.w, h: App.doc.h };

  if (mode === "dh" || mode === "dv") {
    if (objs.length < 3) return;
    const horiz = mode === "dh";
    const sorted = [...objs].sort((a, b2) => {
      const ba = worldBBox(a), bb2 = worldBBox(b2);
      return horiz ? ba.x - bb2.x : ba.y - bb2.y;
    });
    const boxes = sorted.map(worldBBox);
    const total = boxes.reduce((s, b2) => s + (horiz ? b2.w : b2.h), 0);
    const span = horiz ? (ref.x + ref.w - ref.x) : (ref.y + ref.h - ref.y);
    const gap = (span - total) / (sorted.length - 1);
    let pos = horiz ? ref.x : ref.y;
    sorted.forEach((o, i) => {
      const b2 = boxes[i];
      const d = pos - (horiz ? b2.x : b2.y);
      moveObj(o, horiz ? d : 0, horiz ? 0 : d);
      pos += (horiz ? b2.w : b2.h) + gap;
    });
  } else {
    for (const o of objs) {
      const b2 = worldBBox(o);
      let dx = 0, dy = 0;
      if (mode === "l") dx = ref.x - b2.x;
      if (mode === "c") dx = ref.x + ref.w / 2 - (b2.x + b2.w / 2);
      if (mode === "r") dx = ref.x + ref.w - (b2.x + b2.w);
      if (mode === "t") dy = ref.y - b2.y;
      if (mode === "m") dy = ref.y + ref.h / 2 - (b2.y + b2.h / 2);
      if (mode === "b") dy = ref.y + ref.h - (b2.y + b2.h);
      moveObj(o, dx, dy);
    }
  }
  commit("align");
  render(); updateUI();
});

/* ============================================================
   Properties panel
   ============================================================ */
const P = {
  x: $("#in-x"), y: $("#in-y"), w: $("#in-w"), h: $("#in-h"), rot: $("#in-rot"),
  op: $("#in-op"), opVal: $("#op-val"),
  rx: $("#in-rx"), rxVal: $("#rx-val"),
  sides: $("#in-sides"), star: $("#in-star"), inner: $("#in-inner"), innerVal: $("#inner-val"),
  font: $("#in-font"), fsize: $("#in-fsize"), talign: $("#in-talign"),
  fillColor: $("#in-fill-color"), gradA: $("#in-grad-a"), gradB: $("#in-grad-b"),
  gradAngle: $("#in-grad-angle"), angleVal: $("#angle-val"),
  strokeOn: $("#in-stroke-on"), strokeColor: $("#in-stroke-color"), strokeW: $("#in-stroke-w"), strokeStyle: $("#in-stroke-style"),
  shadowOn: $("#in-shadow-on"), shadowColor: $("#in-shadow-color"),
  shadowX: $("#in-shadow-x"), shadowY: $("#in-shadow-y"), shadowBlur: $("#in-shadow-blur"),
  blur: $("#in-blur"), blurVal: $("#blur-val"),
};

let uiSyncing = false;

function updateUI() {
  uiSyncing = true;
  const objs = selectedObjs();
  const one = objs.length === 1 ? objs[0] : null;

  show("#props-doc", objs.length === 0);
  show("#props-align", true);
  show("#props-transform", objs.length > 0);
  show("#props-rect", one && one.type === "rect");
  show("#props-polygon", one && one.type === "polygon");
  show("#props-text", one && one.type === "text");
  const paintable = objs.length > 0 && objs.some(o => o.type !== "group" && o.type !== "image");
  show("#props-fill", paintable);
  show("#props-stroke", paintable);
  show("#props-effects", objs.length > 0);
  show("#props-color", true);
  show("#props-shaping", objs.length > 1);
  show("#props-contour", objs.length > 0);
  show("#props-distort", objs.length > 0);
  show("#props-bitmap", objs.some(o => o.type === "image"));
  show("#props-textpath", !!(one && one.type === "text" && one.onPath));
  if (one && one.type === "text" && one.onPath) {
    const po = $("#in-path-offset"), pv = $("#path-offset-val"), ps = $("#in-path-side");
    if (po) po.value = one.pathOffset || 0;
    if (pv) pv.textContent = (one.pathOffset || 0) + "%";
    if (ps) ps.value = one.pathSide || "above";
  }

  syncDocInputs();
  syncTransformInputs();

  if (one) {
    if (one.type === "rect") { P.rx.value = one.rx || 0; P.rxVal.textContent = Math.round(one.rx || 0); }
    if (one.type === "polygon") {
      P.sides.value = one.sides; P.star.checked = one.star;
      P.inner.value = Math.round(one.inner * 100); P.innerVal.textContent = Math.round(one.inner * 100) + "%";
      $("#props-polygon .row:last-child").style.display = one.star ? "" : "none";
    }
    if (one.type === "text") {
      P.font.value = one.font; P.fsize.value = Math.round(one.size);
      P.talign.value = one.align;
      $("#btn-bold").classList.toggle("on", one.bold);
      $("#btn-italic").classList.toggle("on", one.italic);
    }
  }

  // effects
  if (objs.length) {
    const fx = ensureFx(objs[0]);
    P.shadowOn.checked = fx.shadow;
    P.shadowColor.value = toHex(fx.scolor);
    P.shadowX.value = fx.sx; P.shadowY.value = fx.sy; P.shadowBlur.value = fx.sblur;
    $("#shadow-rows").style.display = fx.shadow ? "" : "none";
    P.blur.value = fx.blur; P.blurVal.textContent = fx.blur;
  }

  const paintRef = objs.find(o => o.type !== "group" && o.type !== "image");
  if (paintRef) {
    const f = paintRef.fill;
    $$("#fill-type-seg button").forEach(b => b.classList.toggle("on", b.dataset.filltype === f.type));
    $("#fill-solid-row").style.display = f.type === "solid" ? "" : "none";
    $("#fill-grad-rows").style.display = (f.type === "linear" || f.type === "radial") ? "" : "none";
    $("#grad-angle-row").style.display = f.type === "linear" ? "" : "none";
    P.fillColor.value = toHex(f.color);
    P.gradA.value = toHex(f.a); P.gradB.value = toHex(f.b);
    P.gradAngle.value = f.angle || 0; P.angleVal.textContent = (f.angle || 0) + "°";
    const s = paintRef.stroke;
    P.strokeOn.checked = s.on; P.strokeColor.value = toHex(s.color);
    P.strokeW.value = s.w; P.strokeStyle.value = s.style;
  }

  // status bar
  $("#st-sel").textContent = objs.length === 0 ? "" : objs.length === 1 ? autoName(one) : `${objs.length} objects`;

  renderLayers();
  updateHistButtons();
  if (typeof syncColorModel === "function") syncColorModel();
  if (typeof renderRamp === "function") renderRamp();
  uiSyncing = false;
}

function show(sel, on) { $(sel).classList.toggle("hidden", !on); }
function toHex(c) {
  if (/^#([0-9a-f]{6})$/i.test(c)) return c;
  const ctx = toHex._ctx || (toHex._ctx = document.createElement("canvas").getContext("2d"));
  ctx.fillStyle = c; return ctx.fillStyle;
}

function syncTransformInputs() {
  const objs = selectedObjs();
  if (!objs.length) return;
  const bb = selectionBBox();
  P.x.value = Math.round(bb.x); P.y.value = Math.round(bb.y);
  P.w.value = Math.round(bb.w); P.h.value = Math.round(bb.h);
  P.rot.value = objs.length === 1 ? Math.round(objs[0].rot || 0) : 0;
  const op = objs.length === 1 ? objs[0].opacity : objs[0].opacity;
  P.op.value = Math.round(op * 100); P.opVal.textContent = Math.round(op * 100) + "%";
}

function syncDocInputs() {
  $("#in-doc-w").value = App.doc.w; $("#in-doc-h").value = App.doc.h;
  $("#in-doc-bg").value = toHex(App.doc.bg);
  $("#in-grid-show").checked = App.doc.grid.show;
  $("#in-grid-snap").checked = App.doc.grid.snap;
  $("#in-grid-size").value = App.doc.grid.size;
}

/* ---------- input wiring ---------- */
function onInput(el, fn, commitLabel) {
  el.addEventListener("input", () => { if (!uiSyncing) fn(); });
  if (commitLabel) el.addEventListener("change", () => { if (!uiSyncing) { commit(commitLabel); updateUI(); } });
}

/* document */
onInput($("#in-doc-w"), () => { App.doc.w = clamp(+$("#in-doc-w").value || 100, 16, 8000); render(); }, "doc size");
onInput($("#in-doc-h"), () => { App.doc.h = clamp(+$("#in-doc-h").value || 100, 16, 8000); render(); }, "doc size");
onInput($("#in-doc-bg"), () => { App.doc.bg = $("#in-doc-bg").value; render(); }, "doc bg");
$("#in-grid-show").addEventListener("change", () => { App.doc.grid.show = $("#in-grid-show").checked; render(); });
$("#in-grid-snap").addEventListener("change", () => { App.doc.grid.snap = $("#in-grid-snap").checked; });
onInput($("#in-grid-size"), () => { App.doc.grid.size = clamp(+$("#in-grid-size").value || 20, 2, 500); render(); });

/* transform */
function setBBoxFromInputs() {
  const objs = selectedObjs();
  if (!objs.length) return;
  const bb = selectionBBox();
  const nx = +P.x.value, ny = +P.y.value;
  const nw = Math.max(1, +P.w.value), nh = Math.max(1, +P.h.value);
  const sx = nw / (bb.w || 1), sy = nh / (bb.h || 1);
  for (const o of objs) {
    if (sx !== 1 || sy !== 1) scaleObj(o, sx, sy, bb.x, bb.y);
  }
  const bb2 = selectionBBox();
  const dx = nx - bb2.x, dy = ny - bb2.y;
  if (dx || dy) for (const o of objs) moveObj(o, dx, dy);
  render();
}
onInput(P.x, setBBoxFromInputs, "transform");
onInput(P.y, setBBoxFromInputs, "transform");
onInput(P.w, setBBoxFromInputs, "transform");
onInput(P.h, setBBoxFromInputs, "transform");
onInput(P.rot, () => {
  const objs = selectedObjs();
  if (objs.length === 1) { objs[0].rot = +P.rot.value || 0; render(); }
}, "rotate");
onInput(P.op, () => {
  const v = clamp(+P.op.value, 0, 100) / 100;
  for (const o of selectedObjs()) o.opacity = v;
  P.opVal.textContent = Math.round(v * 100) + "%";
  render();
}, "opacity");

/* rect */
onInput(P.rx, () => {
  const o = selectedObjs()[0];
  if (o && o.type === "rect") { o.rx = +P.rx.value; P.rxVal.textContent = Math.round(o.rx); render(); }
}, "corner radius");

/* polygon */
onInput(P.sides, () => {
  const o = selectedObjs()[0];
  if (o && o.type === "polygon") { o.sides = clamp(+P.sides.value || 3, 3, 60); App.lastSides = o.sides; render(); }
}, "sides");
P.star.addEventListener("change", () => {
  const o = selectedObjs()[0];
  if (o && o.type === "polygon") { o.star = P.star.checked; commit("star"); render(); updateUI(); }
});
onInput(P.inner, () => {
  const o = selectedObjs()[0];
  if (o && o.type === "polygon") {
    o.inner = clamp(+P.inner.value, 5, 95) / 100; App.lastInner = o.inner;
    P.innerVal.textContent = Math.round(o.inner * 100) + "%"; render();
  }
}, "inner radius");

/* text */
onInput(P.font, () => { const o = selectedObjs()[0]; if (o && o.type === "text") { o.font = P.font.value; render(); } }, "font");
onInput(P.fsize, () => { const o = selectedObjs()[0]; if (o && o.type === "text") { o.size = clamp(+P.fsize.value || 12, 4, 600); render(); } }, "font size");
onInput(P.talign, () => { const o = selectedObjs()[0]; if (o && o.type === "text") { o.align = P.talign.value; render(); } }, "align text");
$("#btn-bold").addEventListener("click", () => {
  const o = selectedObjs()[0];
  if (o && o.type === "text") { o.bold = !o.bold; commit("bold"); render(); updateUI(); }
});
$("#btn-italic").addEventListener("click", () => {
  const o = selectedObjs()[0];
  if (o && o.type === "text") { o.italic = !o.italic; commit("italic"); render(); updateUI(); }
});

/* fill */
$("#fill-type-seg").addEventListener("click", e => {
  const b = e.target.closest("[data-filltype]");
  if (!b) return;
  eachPaintable(o => { o.fill.type = b.dataset.filltype; });
  commit("fill type"); render(); updateUI();
});
onInput(P.fillColor, () => { eachPaintable(o => { o.fill.color = P.fillColor.value; o.fill.a = P.fillColor.value; }); render(); }, "fill");
onInput(P.gradA, () => { eachPaintable(o => o.fill.a = P.gradA.value); render(); }, "gradient");
onInput(P.gradB, () => { eachPaintable(o => o.fill.b = P.gradB.value); render(); }, "gradient");
onInput(P.gradAngle, () => {
  eachPaintable(o => o.fill.angle = +P.gradAngle.value);
  P.angleVal.textContent = P.gradAngle.value + "°"; render();
}, "gradient angle");

/* stroke */
P.strokeOn.addEventListener("change", () => { eachPaintable(o => o.stroke.on = P.strokeOn.checked); commit("stroke"); render(); updateUI(); });
onInput(P.strokeColor, () => { eachPaintable(o => o.stroke.color = P.strokeColor.value); render(); }, "stroke color");
onInput(P.strokeW, () => { eachPaintable(o => { o.stroke.w = Math.max(0, +P.strokeW.value || 0); o.stroke.on = o.stroke.w > 0; }); render(); }, "stroke width");
onInput(P.strokeStyle, () => { eachPaintable(o => o.stroke.style = P.strokeStyle.value); render(); }, "stroke style");

function eachPaintable(fn) {
  const walk = o => { if (o.type === "group") o.children.forEach(walk); else if (o.type !== "image") fn(o); };
  selectedObjs().forEach(walk);
}

/* effects */
P.shadowOn.addEventListener("change", () => {
  for (const o of selectedObjs()) ensureFx(o).shadow = P.shadowOn.checked;
  commit("shadow"); render(); updateUI();
});
onInput(P.shadowColor, () => { for (const o of selectedObjs()) ensureFx(o).scolor = P.shadowColor.value; render(); }, "shadow");
onInput(P.shadowX, () => { for (const o of selectedObjs()) ensureFx(o).sx = +P.shadowX.value || 0; render(); }, "shadow");
onInput(P.shadowY, () => { for (const o of selectedObjs()) ensureFx(o).sy = +P.shadowY.value || 0; render(); }, "shadow");
onInput(P.shadowBlur, () => { for (const o of selectedObjs()) ensureFx(o).sblur = Math.max(0, +P.shadowBlur.value || 0); render(); }, "shadow");
onInput(P.blur, () => {
  const v = +P.blur.value;
  for (const o of selectedObjs()) ensureFx(o).blur = v;
  P.blurVal.textContent = v; render();
}, "blur");

/* ============================================================
   Layers panel
   ============================================================ */
const layerIcons = {
  rect: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="4" width="11" height="8" rx="1"/></svg>',
  ellipse: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="8" rx="6" ry="4.5"/></svg>',
  line: '<svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5"><path d="M3 13L13 3"/></svg>',
  polygon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2.5l5.5 4-2.1 6.5H4.6L2.5 6.5z"/></svg>',
  path: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12C5 4 11 4 14 12"/></svg>',
  text: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h10v2.5h-1.6V4.8H9v7h1.5V13h-5v-1.2H7v-7H4.6v.7H3z"/></svg>',
  group: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="6" y="6" width="8" height="8" rx="1"/></svg>',
  image: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><path d="M2 11l3.5-3 3 2.5L12 7l2 2"/></svg>',
};
const eyeOpen = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const eyeClosed = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 12l12-8"/><path d="M3.5 9.5C2.3 8.6 1.5 8 1.5 8S4 3.5 8 3.5c.8 0 1.6.2 2.3.5M12.6 6.6c1.2.9 1.9 1.4 1.9 1.4S12 12.5 8 12.5c-.8 0-1.6-.2-2.3-.5"/></svg>';
const lockIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>';

let dragLayerId = null;

function renderLayers() {
  const ul = $("#layers");
  ul.innerHTML = "";
  $("#layer-count").textContent = App.objects.length ? `(${App.objects.length})` : "";
  // top of list = front of canvas
  [...App.objects].reverse().forEach(o => {
    const li = document.createElement("li");
    li.dataset.id = o.id;
    li.draggable = true;
    if (App.selection.includes(o.id)) li.classList.add("sel");
    if (!o.visible) li.classList.add("hidden-obj");
    li.innerHTML =
      `<span class="l-icon">${layerIcons[o.type] || layerIcons.path}</span>` +
      `<span class="l-name">${escapeHtml(autoName(o))}</span>` +
      `<button class="l-btn l-lock ${o.locked ? "on" : ""}" title="Lock">${lockIcon}</button>` +
      `<button class="l-btn l-eye ${!o.visible ? "on" : ""}" title="Visibility">${o.visible ? eyeOpen : eyeClosed}</button>`;

    li.addEventListener("click", e => {
      if (e.target.closest(".l-btn")) return;
      if (e.shiftKey) {
        const i = App.selection.indexOf(o.id);
        if (i >= 0) App.selection.splice(i, 1); else App.selection.push(o.id);
      } else App.selection = [o.id];
      render(); updateUI();
    });
    li.querySelector(".l-eye").addEventListener("click", () => {
      o.visible = !o.visible;
      if (!o.visible) App.selection = App.selection.filter(id => id !== o.id);
      commit("visibility"); render(); updateUI();
    });
    li.querySelector(".l-lock").addEventListener("click", () => {
      o.locked = !o.locked;
      if (o.locked) App.selection = App.selection.filter(id => id !== o.id);
      commit("lock"); render(); updateUI();
    });
    li.addEventListener("dblclick", e => {
      if (e.target.closest(".l-btn")) return;
      const name = prompt("Rename layer:", autoName(o));
      if (name != null) { o.name = name.trim(); commit("rename"); updateUI(); }
    });

    /* drag to reorder */
    li.addEventListener("dragstart", () => { dragLayerId = o.id; });
    li.addEventListener("dragover", e => { e.preventDefault(); li.classList.add("drag-over"); });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
    li.addEventListener("drop", e => {
      e.preventDefault();
      li.classList.remove("drag-over");
      if (!dragLayerId || dragLayerId === o.id) return;
      const from = App.objects.findIndex(x => x.id === dragLayerId);
      let to = App.objects.findIndex(x => x.id === o.id);
      if (from < 0 || to < 0) return;
      const [moved] = App.objects.splice(from, 1);
      to = App.objects.findIndex(x => x.id === o.id);
      App.objects.splice(to + 1, 0, moved);
      dragLayerId = null;
      commit("reorder"); render(); updateUI();
    });
    ul.appendChild(li);
  });
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ============================================================
   Keyboard shortcuts
   ============================================================ */
window.addEventListener("keydown", e => {
  const tag = document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  const mod = e.ctrlKey || e.metaKey;

  if (typing) {
    if (e.key === "Enter" && tag === "INPUT") document.activeElement.blur();
    return;
  }

  if (mod) {
    const k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (k === "y") { e.preventDefault(); redo(); return; }
    if (k === "c") { e.preventDefault(); copySelection(); return; }
    if (k === "x") { e.preventDefault(); copySelection(); deleteSelection(); return; }
    if (k === "v") { e.preventDefault(); pasteClipboard(); return; }
    if (k === "d") { e.preventDefault(); duplicateSelection(); return; }
    if (k === "a") { e.preventDefault(); runCommand("select-all"); return; }
    if (k === "g") { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
    if (k === "s") { e.preventDefault(); saveProject(); return; }
    if (k === "o") { e.preventDefault(); $("#file-open").click(); return; }
    if (k === "]") { e.preventDefault(); reorder("forward"); return; }
    if (k === "[") { e.preventDefault(); reorder("backward"); return; }
    if (e.altKey && k === "n") { e.preventDefault(); newDocument(); return; }
    if (e.shiftKey && k === "c") { e.preventDefault(); convertSelectionToPath(); return; }
    if (k === "l") { e.preventDefault(); combinePaths(); return; }
    if (k === "k") { e.preventDefault(); breakApart(); return; }
    if (k === "r") { e.preventDefault(); setRulers(!App.rulers); return; }
    if (k === "2") { e.preventDefault(); lockSelection(); return; }
    if (k === "w") { e.preventDefault(); shapeOp("weld"); return; }
    if (k === "q") { e.preventDefault(); selectedObjs().some(o => o.type === "text") ? textToCurves() : convertSelectionToPath(); return; }
    if (e.shiftKey && k === "p") { e.preventDefault(); openPDFDialog(); return; }
    if (k === "y") { e.preventDefault(); runCommand("toggle-outline"); return; }
    if (e.key === "PageDown") { e.preventDefault(); gotoPage(App.pageIndex + 1); return; }
    if (e.key === "PageUp") { e.preventDefault(); gotoPage(App.pageIndex - 1); return; }
    return;
  }

  switch (e.key) {
    case "v": case "V": setTool("select"); break;
    case "a": case "A": setTool("node"); break;
    case "p": case "P": setTool("pen"); break;
    case "b": case "B": setTool("pencil"); break;
    case "r": case "R": setTool("rect"); break;
    case "e": case "E": setTool("ellipse"); break;
    case "g": case "G": setTool("polygon"); break;
    case "s": case "S": setTool("star"); break;
    case "l": case "L": setTool("line"); break;
    case "t": case "T": setTool("text"); break;
    case "h": case "H": setTool("pan"); break;
    case "k": case "K": setTool("knife"); break;
    case "x": case "X": setTool("eraser"); break;
    case "i": case "I": setTool("dropper"); break;
    case "Escape":
      if (App.tool === "envelope") { cancelEnvelope(); }
      else if (App.tool === "pen" && penState) { penState = null; clearPenPreview(); render(); }
      else if (!$("#modal").hidden) $("#modal").hidden = true;
      else { App.selection = []; App.nodeEdit.sel = []; render(); updateUI(); }
      break;
    case "Enter":
      if (App.tool === "envelope") applyEnvelope();
      else if (App.tool === "pen") finishPen(false);
      break;
    case "Delete": case "Backspace":
      e.preventDefault(); deleteSelection(); break;
    case "ArrowLeft": nudge(e, -1, 0); break;
    case "ArrowRight": nudge(e, 1, 0); break;
    case "ArrowUp": nudge(e, 0, -1); break;
    case "ArrowDown": nudge(e, 0, 1); break;
    case "[":
      if (App.tool === "eraser") { App.eraserSize = clamp((App.eraserSize || 12) - 4, 2, 200); setHint(`Eraser size ${App.eraserSize}`); }
      else reorder("back");
      break;
    case "]":
      if (App.tool === "eraser") { App.eraserSize = clamp((App.eraserSize || 12) + 4, 2, 200); setHint(`Eraser size ${App.eraserSize}`); }
      else reorder("front");
      break;
    case "+": case "=": runCommand("zoom-in"); break;
    case "-": runCommand("zoom-out"); break;
    case "1": e.shiftKey ? zoomFit() : runCommand("zoom-100"); break;
    case "!": zoomFit(); break;
    case "#": runCommand("toggle-grid"); break;
    case "?": $("#modal").hidden = !$("#modal").hidden; break;
  }
});

let nudgeTimer = null;
function nudge(e, dx, dy) {
  const objs = selectedObjs();
  if (!objs.length) return;
  e.preventDefault();
  const m = e.shiftKey ? 10 : 1;
  for (const o of objs) moveObj(o, dx * m, dy * m);
  render(); syncTransformInputs();
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => commit("nudge"), 400);
}

$("#modal-close").addEventListener("click", () => $("#modal").hidden = true);
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").hidden = true; });

/* ============================================================
   File IO
   ============================================================ */
function newDocument() {
  if (App.objects.length && !confirm("Start a new document? Unsaved changes will be lost.")) return;
  App.objects = []; App.selection = []; App.nodeEdit = { id: null, sel: [] };
  App.doc = { w: 1200, h: 800, bg: "#ffffff", grid: { show: false, snap: false, size: 20 }, guides: { h: [], v: [] } };
  App.pages = [{ name: "Page 1", objects: App.objects, guides: App.doc.guides }];
  App.pageIndex = 0;
  App.history = []; App.histIndex = -1;
  commit("new");
  zoomFit(); updateUI();
  if (typeof renderPageBar === "function") renderPageBar();
}

function saveProject() {
  if (typeof syncActivePage === "function") syncActivePage();
  const data = JSON.stringify({
    app: "graphene", version: 3,
    doc: App.doc, objects: App.objects, idSeq: App.idSeq,
    pages: App.pages, pageIndex: App.pageIndex
  }, null, 1);
  download(new Blob([data], { type: "application/json" }), "design.graphene.json");
  setHint("Project saved ✓");
}

$("#file-open").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result);
      if (!s.objects || !s.doc) throw new Error("bad file");
      App.doc = s.doc;
      if (!App.doc.guides) App.doc.guides = { h: [], v: [] };
      App.objects = s.objects; App.idSeq = s.idSeq || 1000;
      if (s.pages && s.pages.length) {
        App.pages = s.pages;
        App.pageIndex = clamp(s.pageIndex || 0, 0, s.pages.length - 1);
        App.objects = App.pages[App.pageIndex].objects;
        App.doc.guides = App.pages[App.pageIndex].guides || { h: [], v: [] };
      } else {
        App.pages = [{ name: "Page 1", objects: App.objects, guides: App.doc.guides }];
        App.pageIndex = 0;
      }
      App.selection = []; App.nodeEdit = { id: null, sel: [] };
      App.history = []; App.histIndex = -1;
      commit("open");
      zoomFit(); updateUI();
      if (typeof renderPageBar === "function") renderPageBar();
      setHint("Project loaded ✓");
    } catch (err) { alert("Could not open file: not a valid Graphene project."); }
  };
  rd.readAsText(f);
  e.target.value = "";
});

function buildExportSVG() {
  const svg = svgEl("svg", {
    xmlns: SVGNS, width: App.doc.w, height: App.doc.h,
    viewBox: `0 0 ${App.doc.w} ${App.doc.h}`
  });
  const defs = svgEl("defs");
  svg.appendChild(defs);
  svg.appendChild(svgEl("rect", { width: App.doc.w, height: App.doc.h, fill: App.doc.bg }));
  // clone rendered object nodes + used gradients
  for (const o of App.objects) {
    const el = renderObj(o);
    if (el) svg.appendChild(el);
  }
  const collect = o => {
    if (o.fill && (o.fill.type === "linear" || o.fill.type === "radial")) {
      const g = document.getElementById(`grad-${o.id}`);
      if (g) defs.appendChild(g.cloneNode(true));
    }
    const f = document.getElementById(`fx-${o.id}`);
    if (f) defs.appendChild(f.cloneNode(true));
    if (o.type === "group") o.children.forEach(collect);
  };
  App.objects.forEach(collect);
  return svg;
}

function exportSVG() {
  const svg = buildExportSVG();
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  download(new Blob([str], { type: "image/svg+xml" }), "design.svg");
  setHint("SVG exported ✓");
}

function exportPNG(scale) {
  const svg = buildExportSVG();
  const str = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = App.doc.w * scale; c.height = App.doc.h * scale;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(b => { download(b, "design.png"); setHint("PNG exported ✓"); }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert("PNG export failed."); };
  img.src = url;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- misc ---------- */
function setHint(t) { $("#st-hint").textContent = t; }
function updateZoomLabel() { $("#zoom-label").textContent = Math.round(App.zoom * 100) + "%"; }
function updateHistButtons() {
  $("#btn-undo").style.opacity = App.histIndex > 0 ? 1 : .35;
  $("#btn-redo").style.opacity = App.histIndex < App.history.length - 1 ? 1 : .35;
}

window.addEventListener("resize", () => render());

/* ============================================================
   Boot — seed a small welcome composition
   ============================================================ */
(function boot() {
  const r1 = makeRect(120, 120, 300, 200);
  r1.rx = 22;
  r1.fill = { type: "linear", color: "#7C5CFF", a: "#7C5CFF", b: "#39D2C0", angle: 35 };
  r1.name = "Gradient card";

  const e1 = makeEllipse(700, 140, 220, 220);
  e1.fill = { type: "radial", color: "#FFB86B", a: "#FFE38A", b: "#FF7847", angle: 0 };
  e1.name = "Sun";

  const s1 = makePolygon(480, 420, 200, 200, 5, true, 0.45);
  s1.fill = { type: "solid", color: "#FF5C7A", a: "#FF5C7A", b: "#7C5CFF", angle: 90 };
  s1.rot = -12;
  s1.name = "Star";

  const t1 = makeText(120, 700, "Welcome to Graphene");
  t1.size = 44; t1.bold = true; t1.font = "Georgia";
  t1.fill = { type: "linear", color: "#7C5CFF", a: "#a18bff", b: "#39D2C0", angle: 0 };

  App.objects.push(r1, e1, s1, t1);
  commit("init");
  setTool("select");
  zoomFit();
  updateUI();
})();
