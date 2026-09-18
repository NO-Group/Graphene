/* Distortion, knife and eraser tests (jsdom) — node test/distort.test.js */
const fs = require("fs"), path = require("path");
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
        canvas: this, fillStyle: "#000", strokeStyle: "#000", clearRect() {}, fillRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, save() {}, restore() {},
        scale() {}, translate() {}, setTransform() {}, fillText() {}, measureText: () => ({ width: 10 }),
        drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      };
    };
    win.requestAnimationFrame = cb => setTimeout(() => cb(0), 0);
  }
});
const win = dom.window;
const errors = [];
win.addEventListener("error", e => errors.push(String(e.error || e.message)));

for (const s of ["js/core.js", "js/render.js", "js/boolean.js", "js/tools.js", "js/ui.js",
                 "js/extras.js", "js/pro.js", "js/distort.js", "js/trace.js"]) {
  const el = win.document.createElement("script");
  el.textContent = fs.readFileSync(path.join(ROOT, s), "utf8");
  win.document.body.appendChild(el);
}
const bridge = win.document.createElement("script");
bridge.textContent = `
  ["App","makeRect","makeEllipse","makePath","makeGroup","anchor","render","commit","objContours",
   "contourArea","knifeCut","eraseStroke","makeHomography","bilerpQuad","subdividePath","startEnvelope",
   "applyEnvelope","cancelEnvelope","roughenSelection","twirlSelection","worldBBox","selectedObjs",
   "setTool","polyBoolean","BOOL_UNION","BOOL_DIFFERENCE","powerTrace","openTraceDialog"
  ].forEach(n => { try { window[n] = eval(n); } catch (e) {} });`;
win.document.body.appendChild(bridge);

const A = win.App;
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(42)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};
const area = o => win.objContours(o).reduce((s, c) => s + win.contourArea(c), 0);

console.log("— homography (perspective) —");
const unitQuad = [[0, 0], [100, 0], [100, 100], [0, 100]];
const Hid = win.makeHomography(unitQuad);
t("identity quad maps (0,0)→(0,0)", Math.hypot(...Hid(0, 0)) < 1e-6, JSON.stringify(Hid(0, 0)));
t("identity quad maps (1,1)→(100,100)", Math.hypot(Hid(1, 1)[0] - 100, Hid(1, 1)[1] - 100) < 1e-6, JSON.stringify(Hid(1, 1)));
t("identity quad maps (0.5,0.5)→centre", Math.hypot(Hid(.5, .5)[0] - 50, Hid(.5, .5)[1] - 50) < 1e-6, JSON.stringify(Hid(.5, .5)));

// a true trapezoid: top edge narrowed → perspective
const trap = [[20, 0], [80, 0], [100, 100], [0, 100]];
const Ht = win.makeHomography(trap);
t("trapezoid corners land exactly", 
  Math.hypot(Ht(0, 0)[0] - 20, Ht(0, 0)[1]) < 1e-6 &&
  Math.hypot(Ht(1, 0)[0] - 80, Ht(1, 0)[1]) < 1e-6 &&
  Math.hypot(Ht(1, 1)[0] - 100, Ht(1, 1)[1] - 100) < 1e-6 &&
  Math.hypot(Ht(0, 1)[0] - 0, Ht(0, 1)[1] - 100) < 1e-6,
  [Ht(0,0), Ht(1,0), Ht(1,1), Ht(0,1)].map(p => p.map(Math.round).join(",")).join(" | "));
const mid = Ht(0.5, 0.5);
t("perspective midpoint is NOT the affine midpoint", Math.abs(mid[1] - 50) > 1, JSON.stringify(mid.map(v => +v.toFixed(2))));
t("perspective midpoint stays centred in x", Math.abs(mid[0] - 50) < 1e-6, mid[0]);

console.log("\n— bilinear envelope —");
t("bilerp corner (0,0)", JSON.stringify(win.bilerpQuad(trap, 0, 0)) === JSON.stringify([20, 0]));
t("bilerp corner (1,1)", JSON.stringify(win.bilerpQuad(trap, 1, 1)) === JSON.stringify([100, 100]));
t("bilerp midpoint is the affine midpoint", win.bilerpQuad(trap, .5, .5)[1] === 50, win.bilerpQuad(trap, .5, .5));

console.log("\n— path subdivision —");
const sq = win.makePath([win.anchor(0, 0), win.anchor(10, 0), win.anchor(10, 10), win.anchor(0, 10)], true);
const sub = win.subdividePath(JSON.parse(JSON.stringify(sq)), 4);
t("subdivide 4 corners ×4 → 16 pts", sub.pts.length === 16, sub.pts.length);
t("subdivision keeps original corners", sub.pts.some(p => p.x === 10 && p.y === 10));

console.log("\n— envelope end-to-end —");
A.objects = []; A.selection = [];
const er = win.makeRect(0, 0, 100, 100);
A.objects.push(er); A.selection = [er.id];
win.startEnvelope("perspective");
t("envelope mode engaged", A.tool === "envelope", A.tool);
// drag the top-left corner inward
const envQuad = win.eval ? null : null;
win.document.body.appendChild(Object.assign(win.document.createElement("script"),
  { textContent: `envState.quad[0] = [40, 0]; envState.quad[1] = [60, 0];` }));
win.applyEnvelope();
const warped = A.objects[0];
t("object became a path", warped.type === "path", warped.type);
/* points exactly on the top edge must span the new 40..60 width */
t("warped top edge narrowed to 40..60", (() => {
  const xs = warped.pts.filter(p => Math.abs(p.y) < 1e-6).map(p => p.x);
  return xs.length >= 2 &&
         Math.abs(Math.min(...xs) - 40) < 1e-6 &&
         Math.abs(Math.max(...xs) - 60) < 1e-6;
})(), JSON.stringify(warped.pts.filter(p => Math.abs(p.y) < 1e-6).map(p => +p.x.toFixed(2))));
t("bottom edge unchanged (still 0..100)", (() => {
  const xs = warped.pts.filter(p => p.y > 95).map(p => p.x);
  return Math.min(...xs) < 1 && Math.max(...xs) > 99;
})());
t("tool returned to select", A.tool === "select", A.tool);

console.log("\n— knife —");
A.objects = []; A.selection = [];
const kr = win.makeRect(0, 0, 100, 100);
A.objects.push(kr); A.selection = [kr.id];
const before = area(kr);
win.knifeCut(-50, 50, 150, 50);          // horizontal slice through the middle
t("knife split into 2 objects", A.objects.length === 2, A.objects.length);
const after = A.objects.reduce((s, o) => s + area(o), 0);
t("total area preserved after cut", Math.abs(after - before) < 1, `${after} vs ${before}`);
t("each half is ~5000", A.objects.every(o => Math.abs(area(o) - 5000) < 1),
  A.objects.map(o => Math.round(area(o))).join(","));

A.objects = []; A.selection = [];
const miss = win.makeRect(0, 0, 100, 100);
A.objects.push(miss); A.selection = [miss.id];
win.knifeCut(0, 500, 100, 500);          // line that misses entirely
t("knife that misses leaves 1 object", A.objects.length === 1, A.objects.length);

console.log("\n— eraser —");
A.objects = []; A.selection = [];
const target = win.makeRect(0, 0, 100, 100);
A.objects.push(target); A.selection = [target.id];
const a0 = area(target);
win.eraseStroke([[0, 50], [100, 50]], 10);   // 20-wide band across the middle
t("eraser kept the object", A.objects.length >= 1, A.objects.length);
const a1 = A.objects.reduce((s, o) => s + area(o), 0);
t("eraser removed roughly the band area", a1 < a0 - 1500 && a1 > a0 - 2600, `${Math.round(a0)} → ${Math.round(a1)}`);

A.objects = []; A.selection = [];
const tiny = win.makeRect(0, 0, 10, 10);
A.objects.push(tiny); A.selection = [tiny.id];
win.eraseStroke([[-20, 5], [30, 5]], 40);    // brush swallows the whole shape
t("fully erased object is removed", A.objects.length === 0, A.objects.length);

console.log("\n— roughen / twirl —");
A.objects = []; A.selection = [];
const rr = win.makeRect(0, 0, 100, 100);
A.objects.push(rr); A.selection = [rr.id];
win.roughenSelection();
t("roughen converted to path", A.objects[0].type === "path", A.objects[0].type);
t("roughen added detail points", A.objects[0].pts.length > 8, A.objects[0].pts.length);

A.objects = []; A.selection = [];
const tw = win.makeRect(0, 0, 100, 100);
A.objects.push(tw); A.selection = [tw.id];
const cornerBefore = JSON.stringify([tw.x, tw.y]);
win.twirlSelection();
t("twirl converted to path", A.objects[0].type === "path", A.objects[0].type);
t("twirl moved interior points", (() => {
  const p = A.objects[0].pts;
  return p.some(pt => Math.abs(pt.x - 0) > 0.5 && Math.abs(pt.x - 100) > 0.5);
})());

console.log("\n— trace UI guard —");
A.objects = [win.makeRect(0, 0, 10, 10)]; A.selection = [A.objects[0].id];
win.powerTrace({ mode: "color" });          // no image selected — must not throw
t("powerTrace with no image is a no-op", A.objects.length === 1 && A.objects[0].type === "rect");

console.log("\n— errors —");
t("no uncaught runtime errors", errors.length === 0, errors.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
