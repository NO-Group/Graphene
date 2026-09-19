/* arrange.test.js — align, distribute, equalise, and node editing.
   None of these existed before; every vector editor has them. The maths is
   asserted exactly (equal gaps to 1e-9, collinear smooth handles, and a
   de Casteljau split that leaves the curve bit-identical). */
const { boot } = require("./lib/boot.js");

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(54)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const { App, g } = boot();
const bb = g("worldBBox"), anchor = g("anchor");
const mk = (x, y, w, h) => { const r = g("makeRect")(x, y, w, h); App.objects.push(r); return r; };
const reset = () => { App.objects = []; App.pages = null; App.selection = []; App.nodeEdit = { id: null, sel: [] }; };

console.log("— align —");
{
  reset();
  const a = mk(10, 10, 100, 40), b = mk(200, 80, 50, 80), c = mk(90, 150, 80, 20);
  App.selection = [a.id, b.id, c.id];
  g("alignObjects")("left");
  t("align left puts every left edge on the leftmost", [a, b, c].every(o => near(bb(o).x, 10)),
    [a, b, c].map(o => bb(o).x).join(","));
}
{
  reset();
  const a = mk(10, 10, 100, 40), b = mk(200, 80, 50, 80), c = mk(90, 150, 80, 20);
  App.selection = [a.id, b.id, c.id];
  g("alignObjects")("hcenter");
  const cs = [a, b, c].map(o => bb(o).x + bb(o).w / 2);
  t("align centres horizontally", cs.every(v => near(v, cs[0])), cs.join(","));
}
{
  reset();
  const a = mk(10, 10, 100, 40), b = mk(200, 80, 50, 80), c = mk(90, 150, 80, 20);
  App.selection = [a.id, b.id, c.id];
  g("alignObjects")("bottom");
  t("align bottom puts every bottom edge on the lowest",
    [a, b, c].every(o => near(bb(o).y + bb(o).h, 170)), [a, b, c].map(o => bb(o).y + bb(o).h).join(","));
}
{
  reset(); App.doc.w = 1000; App.doc.h = 600;
  const s = mk(10, 10, 100, 40); App.selection = [s.id];
  g("alignObjects")("hcenter");
  t("a single object aligns to the page, not to itself", near(bb(s).x + bb(s).w / 2, 500), bb(s).x);
  g("alignObjects")("vcenter");
  t("  …vertically too", near(bb(s).y + bb(s).h / 2, 300), bb(s).y);
}
{
  reset();
  const a = mk(0, 0, 10, 10); a.locked = true;
  const b = mk(100, 0, 10, 10);
  App.selection = [a.id, b.id];
  g("alignObjects")("left");
  t("locked objects are not moved", near(bb(a).x, 0), bb(a).x);
}

console.log("— distribute —");
{
  reset();
  const ps = [mk(0, 0, 20, 20), mk(37, 0, 20, 20), mk(51, 0, 20, 20), mk(180, 0, 20, 20)];
  App.selection = ps.map(p => p.id);
  g("distributeObjects")("hcenter");
  const cs = ps.map(o => bb(o).x + bb(o).w / 2).sort((x, y) => x - y);
  const d = cs.slice(1).map((v, i) => v - cs[i]);
  t("centres end up evenly spaced", d.every(v => near(v, d[0])), d.join(","));
  t("  …and the outer two do not move", near(cs[0], 10) && near(cs[cs.length - 1], 190), `${cs[0]},${cs[cs.length - 1]}`);
}
{
  reset();
  const q = [mk(0, 0, 10, 20), mk(50, 0, 60, 20), mk(200, 0, 30, 20)];
  App.selection = q.map(o => o.id);
  g("distributeObjects")("hgap");
  const bs = q.map(bb).sort((a, b) => a.x - b.x);
  const g1 = bs[1].x - (bs[0].x + bs[0].w), g2 = bs[2].x - (bs[1].x + bs[1].w);
  t("gaps are equalised for differently-sized objects", near(g1, g2), `${g1} vs ${g2}`);
  t("  …the span is preserved", near(bs[0].x, 0) && near(bs[2].x + bs[2].w, 230), `${bs[0].x}..${bs[2].x + bs[2].w}`);
}
{
  reset();
  const q = [mk(0, 0, 10, 10), mk(5, 40, 10, 10), mk(0, 200, 10, 10)];
  App.selection = q.map(o => o.id);
  g("distributeObjects")("vgap");
  const bs = q.map(bb).sort((a, b) => a.y - b.y);
  const g1 = bs[1].y - (bs[0].y + bs[0].h), g2 = bs[2].y - (bs[1].y + bs[1].h);
  t("vertical gaps are equalised", near(g1, g2), `${g1} vs ${g2}`);
}
{
  reset();
  const a = mk(0, 0, 10, 10), b = mk(50, 0, 10, 10);
  App.selection = [a.id, b.id];
  g("distributeObjects")("hcenter");
  t("two objects are left alone (nothing to distribute)", near(bb(a).x, 0) && near(bb(b).x, 50));
}

console.log("— equalise size —");
{
  reset();
  const a = mk(0, 0, 10, 10), b = mk(50, 0, 73, 29);
  App.selection = [a.id, b.id];
  g("equalizeSize")("both");
  t("same size matches the last-selected object", near(bb(a).w, 73) && near(bb(a).h, 29), `${bb(a).w}x${bb(a).h}`);
}
{
  reset();
  const a = mk(0, 0, 10, 40), b = mk(50, 0, 73, 29);
  App.selection = [a.id, b.id];
  g("equalizeSize")("width");
  t("same width leaves height alone", near(bb(a).w, 73) && near(bb(a).h, 40), `${bb(a).w}x${bb(a).h}`);
}

console.log("— add node (de Casteljau) —");
function mkpath(pts, closed) {
  const o = { id: "pp", type: "path", x: 0, y: 0, w: 100, h: 100, pts, closed: closed !== false,
    fill: { type: "solid", color: "#888" }, stroke: { on: true, color: "#000", w: 1 }, opacity: 1, rot: 0 };
  App.objects = [o]; App.selection = [o.id]; App.nodeEdit = { id: o.id, sel: [] };
  return o;
}
{
  const o = mkpath([anchor(0, 0, null, { x: 33, y: -60 }), anchor(100, 0, { x: 67, y: -60 }, null)], false);
  const segPoint = g("segPoint");
  const before = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map(u => segPoint(o.pts[0], o.pts[1], u));
  App.nodeEdit.sel = [0, 1];
  g("addNodes")();
  t("a node is inserted", o.pts.length === 3, o.pts.length);
  t("  …at the curve midpoint", near(o.pts[1].x, 50) && near(o.pts[1].y, -45), `${o.pts[1].x},${o.pts[1].y}`);
  /* every sample must land exactly where it did before the split */
  let worst = 0;
  for (let i = 0; i < before.length; i++) {
    const u = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875][i];
    const p = u < 0.5 ? segPoint(o.pts[0], o.pts[1], u * 2) : segPoint(o.pts[1], o.pts[2], (u - 0.5) * 2);
    worst = Math.max(worst, Math.hypot(p.x - before[i].x, p.y - before[i].y));
  }
  t("  …and the curve is geometrically unchanged", worst < 1e-9, "worst deviation " + worst);
}
{
  const o = mkpath([anchor(0, 0), anchor(100, 0), anchor(100, 100)], true);
  App.nodeEdit.sel = [0, 1, 2];
  g("addNodes")();
  t("a closed triangle gains one node per side", o.pts.length === 6, o.pts.length);
}
{
  const o = mkpath([anchor(0, 0), anchor(100, 0)], false);
  App.nodeEdit.sel = [];
  const n = o.pts.length;
  g("addNodes")();
  t("no selection adds nothing", o.pts.length === n, o.pts.length);
}

console.log("— node types —");
{
  const o = mkpath([anchor(0, 0), anchor(50, 50), anchor(100, 0)], false);
  App.nodeEdit.sel = [1];
  g("setNodeType")("smooth");
  const p = o.pts[1];
  const v1 = { x: p.x - p.hin.x, y: p.y - p.hin.y }, v2 = { x: p.hout.x - p.x, y: p.hout.y - p.y };
  t("smooth makes the handles collinear", near(v1.x * v2.y - v1.y * v2.x, 0), v1.x * v2.y - v1.y * v2.x);
  g("setNodeType")("symmetric");
  const q = o.pts[1];
  const d1 = Math.hypot(q.x - q.hin.x, q.y - q.hin.y), d2 = Math.hypot(q.hout.x - q.x, q.hout.y - q.y);
  t("symmetric makes them equal length", near(d1, d2), `${d1} vs ${d2}`);
  const v3 = { x: q.x - q.hin.x, y: q.y - q.hin.y }, v4 = { x: q.hout.x - q.x, y: q.hout.y - q.y };
  t("  …and still collinear", near(v3.x * v4.y - v3.y * v4.x, 0));
  g("setNodeType")("corner");
  t("corner removes both handles", o.pts[1].hin === null && o.pts[1].hout === null);
}

console.log("— join / break / reverse —");
{
  const o = mkpath([anchor(0, 0), anchor(50, 0), anchor(50, 50), anchor(0, 50)], false);
  App.nodeEdit.sel = [0, 3];
  g("joinNodes")();
  t("joining the two ends closes the path", o.closed === true);
}
{
  const o = mkpath([anchor(0, 0), anchor(50, 0), anchor(50, 50)], false);
  App.nodeEdit.sel = [0, 1];
  g("joinNodes")();
  t("joining adjacent nodes merges them", o.pts.length === 2 && near(o.pts[0].x, 25), `${o.pts.length} pts, x=${o.pts[0].x}`);
}
{
  const o = mkpath([anchor(0, 0), anchor(50, 0), anchor(50, 50), anchor(0, 50)], true);
  App.nodeEdit.sel = [2];
  g("breakNodes")();
  t("breaking a closed path opens it", o.closed === false);
  t("  …and duplicates the break node", o.pts.length === 5, o.pts.length);
}
{
  const o = mkpath([anchor(0, 0, null, { x: 10, y: 10 }), anchor(50, 0, { x: 40, y: 10 }, null)], false);
  App.selection = [o.id];
  g("reversePath")();
  t("reverse flips point order", o.pts[0].x === 50 && o.pts[1].x === 0, o.pts.map(p => p.x).join(","));
  t("  …and swaps hin/hout", o.pts[0].hout && near(o.pts[0].hout.x, 40), JSON.stringify(o.pts[0].hout));
}

console.log("— commands are wired and safe when empty —");
{
  const run = g("runCommand");
  const cmds = ["align-left", "align-hcenter", "align-right", "align-top", "align-vcenter", "align-bottom",
    "dist-h", "dist-v", "dist-hgap", "dist-vgap", "same-width", "same-height", "same-size",
    "node-add", "node-corner", "node-smooth", "node-symmetric", "node-join", "node-break", "path-reverse"];
  const broken = [];
  for (const c of cmds) {
    reset();
    try { run(c); } catch (e) { broken.push(`${c}: ${e.message}`); }
  }
  t(`all ${cmds.length} new commands are no-ops on an empty document`, broken.length === 0, broken.join(" | "));

  const missing = cmds.filter(c => !require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8").includes(`data-cmd="${c}"`));
  t("every new command has a menu entry", missing.length === 0, missing.join(", "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
