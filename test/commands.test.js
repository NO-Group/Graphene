/* commands.test.js — every toolbar/menu command must survive being invoked.
   Sweeps every data-cmd in index.html twice: once with a populated selection,
   once with an empty document. Commands are the main user-facing surface and a
   throw here is a dead button. This lived in /tmp as an ad-hoc script; it is a
   real suite now so it cannot be lost. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  if (process.env.GRAPHENE_SKIP_DOM === "1") { console.log("SKIP: jsdom unavailable"); process.exit(0); }
  console.error("FATAL: jsdom is required for this suite. Run `npm install`,");
  console.error("or set GRAPHENE_SKIP_DOM=1 to deliberately skip DOM tests.");
  process.exit(1);
}

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(50)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost:8000/", runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 });
    w.HTMLCanvasElement.prototype.getContext = function () {
      return { canvas: this, font: "", textBaseline: "", textAlign: "", fillStyle: "#000", strokeStyle: "#000",
        lineWidth: 1, globalAlpha: 1,
        clearRect() {}, fillRect() {}, fillText() {}, strokeText() {}, beginPath() {}, moveTo() {}, lineTo() {},
        closePath() {}, stroke() {}, fill() {}, save() {}, restore() {}, scale() {}, rotate() {}, translate() {},
        setTransform() {}, measureText: s => ({ width: (s || "").length * 8 }),
        getImageData: (x, y, w2, h2) => ({ data: new Uint8ClampedArray(w2 * h2 * 4).fill(200), width: w2, height: h2 }),
        putImageData() {}, createImageData: (w2, h2) => ({ data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 }),
        drawImage() {}, arc() {}, ellipse() {}, bezierCurveTo() {}, quadraticCurveTo() {}, rect() {}, clip() {},
        createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
    };
    w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
    w.requestAnimationFrame = cb => setTimeout(() => cb(0), 0);
    w.URL.createObjectURL = () => "blob:x";
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {};
    w.alert = () => {}; w.confirm = () => true; w.prompt = (q, d) => d || "X"; w.scrollTo = () => {};
  },
});
const win = dom.window;
const asyncErrors = [];
win.addEventListener("error", e => asyncErrors.push((e.error && e.error.message) || e.message));
win.onunhandledrejection = e => asyncErrors.push("unhandled rejection: " + e.reason);

for (const s of ["js/core.js", "js/render.js", "js/boolean.js", "js/tools.js", "js/ui.js", "js/extras.js",
                 "js/pro.js", "js/distort.js", "js/trace.js", "js/png.js", "js/pdf.js", "js/fountain.js", "js/mesh.js", "js/arrange.js"]) {
  const el = win.document.createElement("script");
  el.textContent = fs.readFileSync(path.join(ROOT, s), "utf8");
  win.document.body.appendChild(el);
}
const App = win.eval("App");
const runCommand = win.eval("runCommand");
const cmds = [...new Set([...html.matchAll(/data-cmd="([^"]+)"/g)].map(m => m[1]))];

t("index.html exposes a meaningful number of commands", cmds.length > 50, cmds.length);
t("runCommand is reachable", typeof runCommand === "function");

function seed() {
  App.objects = []; App.pages = null; App.pageIndex = 0;
  App.selection = []; App.nodeEdit = { id: null, sel: [] }; App.meshSel = null;
  const r = win.eval("makeRect")(20, 20, 120, 80);
  const e = win.eval("makeEllipse")(80, 50, 120, 80);
  const tx = win.eval("makeText")(40, 200, "Hello");
  App.objects.push(r, e, tx);
  App.selection = [r.id, e.id];
  win.eval("render")(); win.eval("updateUI")();
}

const broken = [];
for (const c of cmds) {
  seed();
  const before = asyncErrors.length;
  try { runCommand(c); }
  catch (err) { broken.push(`${c}: ${err.message}`); continue; }
  if (asyncErrors.length > before) broken.push(`${c}: ${asyncErrors[before]}`);
}
t(`all ${cmds.length} commands run with a selection`, broken.length === 0, broken.slice(0, 3).join(" | "));

const brokenEmpty = [];
for (const c of cmds) {
  App.objects = []; App.selection = []; App.nodeEdit = { id: null, sel: [] };
  const before = asyncErrors.length;
  try { runCommand(c); }
  catch (err) { brokenEmpty.push(`${c}: ${err.message}`); continue; }
  if (asyncErrors.length > before) brokenEmpty.push(`${c}: ${asyncErrors[before]}`);
}
t(`all ${cmds.length} commands run on an empty document`, brokenEmpty.length === 0, brokenEmpty.slice(0, 3).join(" | "));

t("an unknown command is ignored rather than throwing", (() => {
  try { runCommand("no-such-command-xyz"); return true; } catch (e) { return false; }
})());

t("no asynchronous errors during the whole sweep", asyncErrors.length === 0, asyncErrors.slice(0, 2).join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
