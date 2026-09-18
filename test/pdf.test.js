/* PDF export + fountain fill + text-to-curves tests — node test/pdf.test.js */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require("/tmp/node_modules/jsdom").JSDOM; }
  catch (e2) {
    /* Skipping silently would let a broken environment masquerade as a pass.
       Opt in explicitly with GRAPHENE_SKIP_DOM=1 if jsdom is unavailable. */
    if (process.env.GRAPHENE_SKIP_DOM === "1") {
      console.log("SKIP: jsdom unavailable (GRAPHENE_SKIP_DOM=1)");
      process.exit(0);
    }
    console.error("FATAL: jsdom is required for this suite. Run `npm install`,");
    console.error("or set GRAPHENE_SKIP_DOM=1 to deliberately skip DOM tests.");
    process.exit(1);
  }
}

/* a canvas stub that can actually "draw" a block glyph, so the
   text-to-curves path has something to trace */
function makeCtxStub() {
  let W = 0, H = 0, painted = [];
  return {
    _setSize(w, h) { W = w; H = h; painted = []; },
    canvas: null, font: "", textBaseline: "", textAlign: "", fillStyle: "#000",
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fill() {}, save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
    drawImage() {},
    measureText: t => ({ width: t.length * 20 }),
    fillRect(x, y, w, h) { painted.push({ x, y, w, h, c: this.fillStyle }); },
    fillText(txt, x, y) {
      // stand-in glyph: a solid block above the baseline
      painted.push({ x: x + 10, y: y - 60, w: Math.max(20, txt.length * 30), h: 60, c: "#000" });
    },
    getImageData(sx, sy, w, h) {
      const d = new Uint8ClampedArray(w * h * 4);
      d.fill(255);
      for (const p of painted) {
        if (p.c !== "#000") continue;
        for (let y = Math.max(0, p.y | 0); y < Math.min(h, (p.y + p.h) | 0); y++) {
          for (let x = Math.max(0, p.x | 0); x < Math.min(w, (p.x + p.w) | 0); x++) {
            const i = (y * w + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 0;
          }
        }
      }
      return { data: d, width: w, height: h };
    },
  };
}

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
  url: "http://localhost:8000/", runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(win) {
    win.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 });
    win.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__ctx) { this.__ctx = makeCtxStub(); this.__ctx.canvas = this; }
      return this.__ctx;
    };
    win.requestAnimationFrame = cb => setTimeout(() => cb(0), 0);
  }
});
const win = dom.window;
const errors = [];
win.addEventListener("error", e => errors.push(String(e.error || e.message)));

for (const s of ["js/core.js", "js/render.js", "js/boolean.js", "js/tools.js", "js/ui.js",
                 "js/extras.js", "js/pro.js", "js/distort.js", "js/trace.js", "js/pdf.js", "js/fountain.js"]) {
  const el = win.document.createElement("script");
  el.textContent = fs.readFileSync(path.join(ROOT, s), "utf8");
  win.document.body.appendChild(el);
}
const bridge = win.document.createElement("script");
bridge.textContent = `
  ["App","makeRect","makeEllipse","makeText","makePolygon","makeGroup","buildPDF","rgbToCmyk01",
   "byteLen","anchorsToOps","anchor","render","commit","textToCurves","glyphOutlines",
   "sampleGradient","fillStops","applyGradientPreset","GRADIENT_PRESETS","mixHex","selectedObjs"
  ].forEach(n => { try { window[n] = eval(n); } catch (e) {} });`;
win.document.body.appendChild(bridge);

/* Streams may be FlateDecode-compressed. Expand them so assertions test the
   real operators instead of accidentally passing on compressed noise. */
function pdfExpand(src) {
  const { zlibInflate } = require(path.join(ROOT, "js", "png.js"));
  return src.replace(/<<([^>]*?)\/Filter \/FlateDecode([^>]*?)\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g,
    (m, d1, d2, len, body) => {
      try {
        const u8 = new Uint8Array(body.length);
        for (let i = 0; i < body.length; i++) u8[i] = body.charCodeAt(i) & 255;
        const out = zlibInflate(u8);
        let txt = "";
        for (let i = 0; i < out.length; i += 0x8000) {
          txt += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
        }
        return `<<${d1}${d2}/Length ${txt.length} >>\nstream\n${txt}\nendstream`;
      } catch (e) { return m; }
    });
}

const A = win.App;
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(44)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

console.log("— CMYK conversion —");
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
t("pure red → 0,1,1,0", JSON.stringify(win.rgbToCmyk01("#ff0000").map(v => +v.toFixed(4))) === "[0,1,1,0]",
  JSON.stringify(win.rgbToCmyk01("#ff0000")));
t("pure black → 0,0,0,1", JSON.stringify(win.rgbToCmyk01("#000000")) === "[0,0,0,1]");
t("pure white → 0,0,0,0", JSON.stringify(win.rgbToCmyk01("#ffffff")) === "[0,0,0,0]");
t("cyan → 1,0,0,0", JSON.stringify(win.rgbToCmyk01("#00ffff").map(v => +v.toFixed(4))) === "[1,0,0,0]");
t("50% grey has only K", (() => {
  const [c, m, y, k] = win.rgbToCmyk01("#808080");
  return near(c, 0, 1e-9) && near(m, 0, 1e-9) && near(y, 0, 1e-9) && k > 0.4 && k < 0.6;
})(), JSON.stringify(win.rgbToCmyk01("#808080")));

console.log("\n— PDF structure —");
A.objects = []; A.pages = null; A.doc.w = 400; A.doc.h = 300; A.doc.bg = "#ffffff";
const r = win.makeRect(40, 40, 140, 90);
r.fill = { type: "solid", color: "#FF5C7A", a: "#FF5C7A", b: "#000", angle: 0 };
A.objects.push(r);
let pdf = pdfExpand(win.buildPDF({ colorSpace: "cmyk" }));

t("starts with %PDF-1.7", pdf.startsWith("%PDF-1.7"));
t("ends with %%EOF", pdf.trim().endsWith("%%EOF"));
t("has a Catalog", pdf.includes("/Type /Catalog"));
t("has a Pages tree", pdf.includes("/Type /Pages"));
t("has a Page", pdf.includes("/Type /Page "));
t("has an xref table", pdf.includes("\nxref\n"));
t("has startxref", pdf.includes("startxref"));
t("uses CMYK 'k' operator", /[\d.]+ [\d.]+ [\d.]+ [\d.]+ k\b/.test(pdf));
t("no RGB 'rg' operator in CMYK mode", !/\b[\d.]+ [\d.]+ [\d.]+ rg\b/.test(pdf));
t("MediaBox matches page", pdf.includes("/MediaBox [0 0 400 300]"), (pdf.match(/MediaBox[^\]]+\]/) || [])[0]);

/* xref offsets must actually point at "N 0 obj" */
function checkXref(src) {
  const m = /startxref\s+(\d+)/.exec(src);
  if (!m) return "no startxref";
  const start = +m[1];
  const tail = src.slice(start);
  if (!tail.startsWith("xref")) return "startxref does not point at xref";
  const lines = tail.split("\n");
  const count = +lines[1].split(" ")[1];
  for (let i = 1; i < count; i++) {
    const off = +lines[2 + i].slice(0, 10);
    const at = src.slice(off, off + 24);
    if (!new RegExp(`^${i} 0 obj`).test(at)) return `object ${i} offset wrong (found "${at.slice(0, 12)}")`;
  }
  return null;
}
t("every xref offset resolves to its object", checkXref(pdf) === null, checkXref(pdf));

/* /Length must equal the real stream byte count */
function checkLengths(src) {
  const re = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let m;
  while ((m = re.exec(src))) {
    if (win.byteLen(m[2]) !== +m[1]) return `declared ${m[1]}, actual ${win.byteLen(m[2])}`;
  }
  return null;
}
t("stream /Length values are correct", checkLengths(pdf) === null, checkLengths(pdf));

console.log("\n— RGB mode —");
const rgbPdf = pdfExpand(win.buildPDF({ colorSpace: "rgb" }));
t("uses RGB 'rg' operator", /\b[\d.]+ [\d.]+ [\d.]+ rg\b/.test(rgbPdf));
t("no CMYK 'k' operator in RGB mode", !/[\d.]+ [\d.]+ [\d.]+ [\d.]+ k\b/.test(rgbPdf));

console.log("\n— gradients (shadings) —");
A.objects = [];
const g = win.makeEllipse(20, 20, 100, 100);
g.fill = { type: "linear", color: "#7C5CFF", a: "#7C5CFF", b: "#39D2C0", angle: 45,
           stops: [{ p: 0, c: "#7C5CFF" }, { p: .5, c: "#FF5C7A" }, { p: 1, c: "#39D2C0" }] };
A.objects.push(g);
pdf = pdfExpand(win.buildPDF({ colorSpace: "cmyk" }));
t("axial shading emitted", pdf.includes("/ShadingType 2"));
t("3 stops → stitching function", pdf.includes("/FunctionType 3"));
t("two exponential sub-functions", (pdf.match(/\/FunctionType 2/g) || []).length === 2,
  (pdf.match(/\/FunctionType 2/g) || []).length);
t("pattern has a /Matrix (page-space fix)", /\/PatternType 2 \/Matrix \[/.test(pdf));
t("shading colour space is CMYK", pdf.includes("/ColorSpace /DeviceCMYK"));

A.objects = [];
const rad = win.makeEllipse(20, 20, 100, 100);
rad.fill = { type: "radial", color: "#fff", a: "#FFE38A", b: "#F72585", angle: 0 };
A.objects.push(rad);
t("radial shading emitted", win.buildPDF({}).includes("/ShadingType 3"));

/* regression: replacing App.objects must not leave the page on a stale array */
A.objects = [Object.assign(win.makeRect(0, 0, 10, 10), { fill: { type: "solid", color: "#123456", a: "#123456", b: "#000", angle: 0 } })];
A.objects = [Object.assign(win.makeEllipse(0, 0, 10, 10), { fill: { type: "solid", color: "#abcdef", a: "#abcdef", b: "#000", angle: 0 } })];
t("re-assigned App.objects reaches the PDF", !win.buildPDF({ colorSpace: "rgb" }).includes("0 0 10 10 re"),
  "page held a stale objects array");

console.log("\n— text —");
A.objects = [];
const txt = win.makeText(20, 100, "Hello (PDF)");
A.objects.push(txt);
pdf = pdfExpand(win.buildPDF({}));
t("font resource present", pdf.includes("/Type /Font") && pdf.includes("/BaseFont /Helvetica"));
t("text show operator present", pdf.includes(" Tj"));
t("parentheses are escaped", pdf.includes("\\(PDF\\)"), (pdf.match(/\(Hello[^)]*\)/) || [])[0]);
A.objects = [Object.assign(win.makeText(0, 0, "Bold"), { bold: true, font: "Georgia" })];
t("bold serif maps to Times-Bold", win.buildPDF({}).includes("/BaseFont /Times-Bold"));

console.log("\n— transparency & multi-page —");
A.objects = [];
const faded = win.makeRect(0, 0, 50, 50); faded.opacity = 0.4;
A.objects.push(faded);
pdf = pdfExpand(win.buildPDF({}));
t("ExtGState emitted for opacity", pdf.includes("/Type /ExtGState") && pdf.includes("/ca 0.4"));

A.pages = [
  { name: "P1", objects: [win.makeRect(0, 0, 10, 10)], guides: { h: [], v: [] } },
  { name: "P2", objects: [win.makeEllipse(0, 0, 10, 10)], guides: { h: [], v: [] } },
];
A.pageIndex = 0; A.objects = A.pages[0].objects;
pdf = pdfExpand(win.buildPDF({ allPages: true }));
t("two pages → /Count 2", pdf.includes("/Count 2"), (pdf.match(/\/Count \d+/) || [])[0]);
t("single-page export → /Count 1", win.buildPDF({ allPages: false }).includes("/Count 1"));
A.pages = null;

console.log("\n— bleed & crop marks —");
A.objects = [win.makeRect(0, 0, 50, 50)];
pdf = pdfExpand(win.buildPDF({ bleed: 9, marks: true }));
t("TrimBox present", pdf.includes("/TrimBox"));
t("BleedBox present", pdf.includes("/BleedBox"));
t("MediaBox grew for marks", !pdf.includes("/MediaBox [0 0 400 300]"));
t("no bleed → no BleedBox", !win.buildPDF({ bleed: 0, marks: false }).includes("/BleedBox"));

console.log("\n— path operators —");
const ops = win.anchorsToOps([win.anchor(0, 0), win.anchor(10, 0), win.anchor(10, 10)], true);
t("emits moveto", ops.includes(" m"));
t("emits lineto", ops.includes(" l"));
t("closes the subpath", ops.trim().endsWith("h"));
const curveOps = win.anchorsToOps(
  [win.anchor(0, 0, null, { x: 5, y: 0 }), win.anchor(10, 10, { x: 5, y: 10 }, null)], false);
t("emits curveto for beziers", curveOps.includes(" c"));

console.log("\n— fountain fill (multi-stop) —");
const stops = [{ p: 0, c: "#000000" }, { p: 1, c: "#ffffff" }];
t("sampleGradient at 0", win.sampleGradient(stops, 0) === "#000000");
t("sampleGradient at 1", win.sampleGradient(stops, 1) === "#ffffff");
t("sampleGradient midpoint", win.sampleGradient(stops, .5) === "#808080", win.sampleGradient(stops, .5));
t("sampleGradient clamps below 0", win.sampleGradient(stops, -1) === "#000000");
const three = [{ p: 0, c: "#ff0000" }, { p: .5, c: "#00ff00" }, { p: 1, c: "#0000ff" }];
t("3-stop samples the middle band", win.sampleGradient(three, .25) === "#808000", win.sampleGradient(three, .25));
t("fillStops backfills from a/b", (() => {
  const f = { type: "linear", a: "#111111", b: "#222222" };
  const s = win.fillStops(f);
  return s.length === 2 && s[0].c === "#111111" && s[1].c === "#222222";
})());
t("presets exist", Object.keys(win.GRADIENT_PRESETS).length >= 6);
A.objects = []; A.selection = [];
const pr = win.makeRect(0, 0, 10, 10);
A.objects.push(pr); A.selection = [pr.id];
win.applyGradientPreset("Sunset");
t("preset applied 3 stops", pr.fill.stops.length === 3, pr.fill.stops && pr.fill.stops.length);
t("preset switched fill to gradient", pr.fill.type === "linear", pr.fill.type);

console.log("\n— multi-stop reaches the SVG renderer —");
A.objects = [];
const mg = win.makeEllipse(0, 0, 100, 100);
mg.fill = { type: "linear", color: "#000", a: "#ff0000", b: "#0000ff", angle: 0,
            stops: [{ p: 0, c: "#ff0000" }, { p: .5, c: "#00ff00" }, { p: 1, c: "#0000ff" }] };
A.objects.push(mg);
win.render();
const grad = win.document.getElementById(`grad-${mg.id}`);
t("gradient element exists", !!grad);
t("renderer emitted 3 <stop> nodes", grad && grad.querySelectorAll("stop").length === 3,
  grad && grad.querySelectorAll("stop").length);
t("middle stop at 50%", grad && grad.querySelectorAll("stop")[1].getAttribute("offset") === "50%",
  grad && grad.querySelectorAll("stop")[1].getAttribute("offset"));

console.log("\n— text to curves —");
A.objects = []; A.selection = [];
const tc = win.makeText(50, 120, "AB");
tc.size = 40;
A.objects.push(tc); A.selection = [tc.id];
win.textToCurves();
t("text replaced by a path", A.objects.length === 1 && A.objects[0].type === "path", A.objects[0] && A.objects[0].type);
t("path has traced subpaths", A.objects[0].subpaths && A.objects[0].subpaths.length >= 1,
  A.objects[0] && A.objects[0].subpaths && A.objects[0].subpaths.length);
t("curves keep the original fill", A.objects[0].fill.color === tc.fill.color);
t("name marks it as curves", /\(curves\)$/.test(A.objects[0].name || ""), A.objects[0].name);

console.log("\n— errors —");
t("no uncaught runtime errors", errors.length === 0, errors.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
