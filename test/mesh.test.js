/* mesh.test.js — mesh fill (Coons patches), gradient transparency,
   PNG embedding in PDF, and the V6 command wiring. */
const fs = require("fs"), path = require("path");
const zlib = require("zlib");
const ROOT = path.join(__dirname, "..");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require("/tmp/node_modules/jsdom").JSDOM; }
  catch (e2) { console.log("SKIP: jsdom not installed (npm i -D jsdom)"); process.exit(0); }
}

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
  url: "http://localhost:8000/", runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(win) {
    win.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 });
    win.HTMLCanvasElement.prototype.getContext = function () {
      return {
        canvas: this, font: "", textBaseline: "", textAlign: "", fillStyle: "#000",
        clearRect() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {},
        lineTo() {}, stroke() {}, fill() {}, save() {}, restore() {}, scale() {},
        setTransform() {}, drawImage() {},
        measureText: t => ({ width: (t || "").length * 8 }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      };
    };
    win.requestAnimationFrame = cb => setTimeout(() => cb(0), 0);
    win.alert = () => {}; win.confirm = () => true; win.prompt = (q, d) => d || "X";
  }
});
const win = dom.window;
const errors = [];
win.addEventListener("error", e => errors.push(String(e.error && e.error.message || e.message)));

for (const s of ["js/core.js", "js/render.js", "js/boolean.js", "js/tools.js", "js/ui.js",
                 "js/extras.js", "js/pro.js", "js/distort.js", "js/trace.js", "js/png.js",
                 "js/pdf.js", "js/fountain.js", "js/mesh.js"]) {
  const el = win.document.createElement("script");
  el.textContent = fs.readFileSync(path.join(ROOT, s), "utf8");
  win.document.body.appendChild(el);
}
const bridge = win.document.createElement("script");
bridge.textContent = `
  ["App","runCommand","makeRect","makeEllipse","makeText","makeImage","render","updateUI",
   "buildPDF","makeMesh","seedMeshColors","sampleMesh","meshOf","applyMeshFill",
   "setTransparencyRamp","setMeshSize","setMeshNodeColor","alphaStops","setTool","commit",
   "decodePNG","zlibStore"
  ].forEach(n => { try { window[n] = eval(n); } catch (e) {} });`;
win.document.body.appendChild(bridge);

const A = win.App;
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(46)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};
const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

console.log("— mesh model —");
const m = win.makeMesh(3, 4);
t("mesh has requested rows/cols", m.rows === 3 && m.cols === 4, `${m.rows}x${m.cols}`);
t("node grid matches dimensions", m.nodes.length === 3 && m.nodes[0].length === 4);
t("nodes span u,v 0..1", m.nodes[0][0].u === 0 && m.nodes[0][3].u === 1 && m.nodes[2][0].v === 1,
  JSON.stringify([m.nodes[0][0].u, m.nodes[0][3].u, m.nodes[2][0].v]));
t("rows clamp to >= 2", win.makeMesh(1, 1).rows === 2);
t("rows clamp to <= 10", win.makeMesh(50, 50).cols === 10);

console.log("\n— mesh interpolation —");
const flat = win.makeMesh(3, 3);
for (const row of flat.nodes) for (const n of row) n.c = "#3366cc";
t("uniform mesh samples uniformly", win.sampleMesh(flat, 0.37, 0.62) === "#3366cc",
  win.sampleMesh(flat, 0.37, 0.62));

const ramp = win.makeMesh(2, 2);
ramp.nodes[0][0].c = "#000000"; ramp.nodes[0][1].c = "#ffffff";
ramp.nodes[1][0].c = "#000000"; ramp.nodes[1][1].c = "#ffffff";
t("corner sample = corner colour", win.sampleMesh(ramp, 0, 0) === "#000000", win.sampleMesh(ramp, 0, 0));
t("opposite corner exact", win.sampleMesh(ramp, 1, 0) === "#ffffff", win.sampleMesh(ramp, 1, 0));
t("midpoint interpolates", (() => {
  const g = hex2rgb(win.sampleMesh(ramp, 0.5, 0.5))[0];
  return g > 100 && g < 155;
})(), win.sampleMesh(ramp, 0.5, 0.5));
t("monotonic along the ramp", (() => {
  let prev = -1;
  for (let i = 0; i <= 10; i++) {
    const v = hex2rgb(win.sampleMesh(ramp, i / 10, 0.5))[0];
    if (v < prev - 1) return false;
    prev = v;
  }
  return true;
})());
t("out-of-range u,v clamps (no NaN)", (() => {
  const a = win.sampleMesh(ramp, -3, 7);
  return /^#[0-9a-f]{6}$/.test(a);
})(), win.sampleMesh(ramp, -3, 7));
t("seedMeshColors fills every node", (() => {
  const s = win.seedMeshColors(win.makeMesh(4, 4));
  return s.nodes.every(r => r.every(n => /^#[0-9a-f]{6}$/i.test(n.c)));
})());

console.log("\n— applying a mesh fill —");
A.objects = []; A.selection = []; A.pages = null;
A.doc.w = 400; A.doc.h = 300;
const r1 = win.makeRect(20, 20, 160, 120);
A.objects.push(r1); A.selection = [r1.id];
win.applyMeshFill();
t("fill.type becomes mesh", r1.fill.type === "mesh", r1.fill.type);
t("a mesh object is attached", !!(r1.fill.mesh && r1.fill.mesh.nodes), JSON.stringify(!!r1.fill.mesh));
t("switches to the mesh tool", A.tool === "mesh", A.tool);
t("meshOf repairs a corrupt mesh", (() => {
  const broken = win.makeRect(0, 0, 10, 10);
  broken.fill = { type: "mesh", color: "#ff0000", mesh: { rows: 3, cols: 3, nodes: null } };
  const fixed = win.meshOf(broken);
  return fixed && fixed.nodes && fixed.nodes.length === 3;
})());

console.log("\n— mesh renders to SVG —");
win.render();
const objsLayer = win.document.getElementById("objects");
t("mesh emits a quad lattice", objsLayer.querySelectorAll("path").length > 50,
  objsLayer.querySelectorAll("path").length);
t("lattice is clipped to the shape", !!win.document.getElementById(`meshclip-${r1.id}`));
t("object still carries its id", !!objsLayer.querySelector(`[data-id="${r1.id}"]`));

console.log("\n— mesh editing —");
win.setMeshSize(4, 5);
t("resize keeps the new dimensions", r1.fill.mesh.rows === 4 && r1.fill.mesh.cols === 5,
  `${r1.fill.mesh.rows}x${r1.fill.mesh.cols}`);
t("resize preserves colour field", r1.fill.mesh.nodes.every(row => row.every(n => /^#[0-9a-f]{6}$/i.test(n.c))));
A.meshSel = { r: 1, c: 1 };
win.setMeshNodeColor("#ff0000");
t("node colour applies", r1.fill.mesh.nodes[1][1].c === "#ff0000", r1.fill.mesh.nodes[1][1].c);
t("setMeshNodeColor with no selection is safe", (() => {
  A.meshSel = null;
  try { win.setMeshNodeColor("#00ff00"); return true; } catch (e) { return false; }
})());

console.log("\n— mesh exports as a native PDF shading —");
let pdf = win.buildPDF({ colorSpace: "cmyk" });
t("ShadingType 6 (Coons patch)", pdf.includes("/ShadingType 6"));
t("declares BitsPerFlag", pdf.includes("/BitsPerFlag 8"));
t("declares BitsPerCoordinate", pdf.includes("/BitsPerCoordinate 16"));
t("CMYK mesh has an 8-value Decode", /\/Decode \[[^\]]*0 1 0 1 0 1 0 1\]/.test(pdf),
  (pdf.match(/\/Decode \[[^\]]*\]/) || [])[0]);
t("pattern registered in resources", /\/Pattern << \/Sh\d+ \d+ 0 R/.test(pdf),
  (pdf.match(/\/Pattern << [^>]*>>/) || [])[0]);
t("no 'undefined' leaked into the PDF", !pdf.includes("undefined"));
const rgbMesh = win.buildPDF({ colorSpace: "rgb" });
t("RGB mesh has a 6-value Decode", /\/Decode \[[^\]]*0 1 0 1 0 1\]/.test(rgbMesh) && !/0 1 0 1 0 1 0 1\]/.test(rgbMesh));

console.log("\n— gradient transparency —");
A.objects = []; A.selection = [];
const r2 = win.makeRect(10, 10, 100, 100);
A.objects.push(r2); A.selection = [r2.id];
win.setTransparencyRamp("fade");
t("fade sets two alpha stops", r2.fill.alphaStops && r2.fill.alphaStops.length === 2,
  JSON.stringify(r2.fill.alphaStops));
t("fade runs 1 → 0", r2.fill.alphaStops[0].a === 1 && r2.fill.alphaStops[1].a === 0);
win.setTransparencyRamp("vignette");
t("vignette uses three stops", r2.fill.alphaStops.length === 3, r2.fill.alphaStops.length);
win.render();
t("mask element created", !!win.document.getElementById(`alpha-${r2.id}`));
t("mask gradient created", !!win.document.getElementById(`alphagrad-${r2.id}`));
t("shape references the mask", (() => {
  const el = win.document.querySelector(`#objects [data-id="${r2.id}"]`);
  return el && /alpha-/.test(el.getAttribute("mask") || "");
})(), (win.document.querySelector(`#objects [data-id="${r2.id}"]`) || {}).outerHTML);
win.setTransparencyRamp("none");
t("clear removes the stops", !r2.fill.alphaStops);
win.render();
t("clear removes the mask def", !win.document.getElementById(`alpha-${r2.id}`));
t("alphaStops needs >= 2 entries", win.alphaStops({ alphaStops: [{ p: 0, a: 1 }] }) === null);

console.log("\n— PNG embeds in PDF as a real image —");
{
  /* build a 4x4 RGBA png in-process */
  function crc32(buf) {
    let table = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    let crc = 0xFFFFFFFF;
    for (const b of buf) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const W = 4, H = 4, raw = [];
  for (let y = 0; y < H; y++) { raw.push(0); for (let x = 0; x < W; x++) raw.push(255, 0, 128, x % 2 ? 120 : 255); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0)),
  ]);
  A.objects = []; A.selection = [];
  A.objects.push(win.makeImage(10, 10, 80, 80, "data:image/png;base64," + png.toString("base64")));
  const p = win.buildPDF({ colorSpace: "rgb" });
  t("emits an image XObject", p.includes("/Subtype /Image"));
  t("uses FlateDecode", p.includes("/Filter /FlateDecode"));
  t("records the true pixel size", p.includes("/Width 4") && p.includes("/Height 4"));
  t("alpha becomes an /SMask", p.includes("/SMask"));
  t("XObject listed in resources", /\/XObject << \/Im\d+ \d+ 0 R/.test(p));
  t("draws with Do, not a grey box", p.includes(" Do"));

  A.objects = [win.makeImage(0, 0, 10, 10, "data:image/png;base64,QUJD")];
  t("corrupt PNG degrades to a box (no throw)", (() => {
    try { const q = win.buildPDF({}); return !q.includes("/Subtype /Image") && q.includes("re f"); }
    catch (e) { return false; }
  })());
}

console.log("\n— command wiring —");
A.objects = []; A.selection = [];
const r3 = win.makeRect(0, 0, 50, 50);
A.objects.push(r3); A.selection = [r3.id];
for (const cmd of ["mesh-fill", "transp-fade", "transp-vignette", "transp-none"]) {
  t(`runCommand("${cmd}")`, (() => { try { win.runCommand(cmd); return true; } catch (e) { return false; } })());
}
t("mesh-fill via command sets the fill", r3.fill.type === "mesh", r3.fill.type);
A.objects = []; A.selection = [];
for (const cmd of ["mesh-fill", "transp-fade", "transp-none"]) {
  t(`"${cmd}" with empty selection is safe`, (() => { try { win.runCommand(cmd); return true; } catch (e) { return false; } })());
}

console.log("\n— regression: RGB mesh colour scale —");
A.objects = []; A.selection = [];
{
  const rr = win.makeRect(0, 0, 100, 100);
  const mm = win.makeMesh(2, 2);
  for (const row of mm.nodes) for (const n of row) n.c = "#ffffff";
  rr.fill = { type: "mesh", color: "#ffffff", mesh: mm };
  A.objects.push(rr);
  const p = win.buildPDF({ colorSpace: "rgb" });
  /* the mesh data stream is binary; white nodes must encode as 0xFF bytes,
     not 0x01 (the bug was dividing an already-normalised value by 255) */
  const mstream = /\/ShadingType 6[\s\S]*?stream\n([\s\S]*?)\nendstream/.exec(p);
  let maxByte = 0;
  if (mstream) for (const ch of mstream[1]) maxByte = Math.max(maxByte, ch.charCodeAt(0));
  t("white mesh encodes as 0xFF, not 0x01", maxByte === 255, "max byte " + maxByte);
}

console.log("\n— regression: text encoding —");
A.objects = []; A.selection = [];
{
  A.objects.push(win.makeText(10, 10, "arrow \u2192 dash \u2014 quote \u201cx\u201d"));
  const p = win.buildPDF({});
  t("arrow transliterates to ASCII", p.includes("->"), "missing ->");
  t("em dash maps to WinAnsi 0x97", p.includes("\x97"));
  t("curly quotes map to WinAnsi", p.includes("\x93") && p.includes("\x94"));
  A.objects = [win.makeText(0, 0, "unsupported \u4e2d\u6587")];
  const q = win.buildPDF({});
  t("unmappable chars degrade, never raw UTF-16", !/[\u0100-\uffff]/.test(q));
}

console.log("\n— regression: transparency reaches the PDF —");
A.objects = []; A.selection = [];
{
  const rr = win.makeRect(10, 10, 80, 80);
  rr.fill = { type: "linear", color: "#7C5CFF", a: "#7C5CFF", b: "#39D2C0", angle: 0,
              stops: [{ p: 0, c: "#7C5CFF" }, { p: 1, c: "#39D2C0" }],
              alphaStops: [{ p: 0, a: 1 }, { p: 1, a: 0 }] };
  A.objects.push(rr);
  const p = win.buildPDF({});
  t("emits a luminosity SMask", p.includes("/S /Luminosity"));
  t("mask is a Form XObject", p.includes("/Subtype /Form"));
  t("mask form declares a transparency group", p.includes("/S /Transparency"));
  t("soft-mask gstate applied in content", /\/GS\d+ gs/.test(p));
  const noAlpha = win.makeRect(0, 0, 10, 10);
  A.objects = [noAlpha];
  t("no alphaStops -> no SMask", !win.buildPDF({}).includes("/S /Luminosity"));
}

console.log("\n— errors —");
t("no uncaught runtime errors", errors.length === 0, errors.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
