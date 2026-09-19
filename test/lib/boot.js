/* Shared jsdom boot helper for Graphene test suites and audits.
   Lives in the repo (not /tmp) so it cannot be lost to a sandbox reset. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");

const SCRIPTS = ["js/splash.js", "js/core.js", "js/render.js", "js/boolean.js", "js/tools.js", "js/ui.js",
  "js/extras.js", "js/pro.js", "js/distort.js", "js/trace.js", "js/png.js",
  "js/pdf.js", "js/fountain.js", "js/mesh.js", "js/arrange.js"];

function loadJSDOM() {
  try { return require("jsdom").JSDOM; }
  catch (e) {
    if (process.env.GRAPHENE_SKIP_DOM === "1") { console.log("SKIP: jsdom unavailable"); process.exit(0); }
    console.error("FATAL: jsdom is required for this suite. Run `npm install`,");
    console.error("or set GRAPHENE_SKIP_DOM=1 to deliberately skip DOM tests.");
    process.exit(1);
  }
}

function stubCtx(canvas) {
  return {
    canvas, font: "", textBaseline: "", textAlign: "", fillStyle: "#000", strokeStyle: "#000",
    lineWidth: 1, globalAlpha: 1, lineCap: "butt", lineJoin: "miter", miterLimit: 10,
    clearRect() {}, fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {},
    save() {}, restore() {}, scale() {}, rotate() {}, translate() {}, transform() {}, setTransform() {},
    setLineDash() {}, getLineDash: () => [], measureText: s => ({ width: (s || "").length * 8 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)).fill(200), width: w, height: h }),
    putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)), width: w, height: h }),
    drawImage() {}, arc() {}, arcTo() {}, ellipse() {}, bezierCurveTo() {}, quadraticCurveTo() {},
    rect() {}, clip() {}, isPointInPath: () => false,
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
  };
}

/* opts.localStorage  - factory for a custom localStorage
   opts.scripts       - override the script list
   opts.html          - override index.html contents */
function boot(opts = {}) {
  const JSDOM = loadJSDOM();
  const html = opts.html || fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://localhost:8000/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      if (opts.localStorage) Object.defineProperty(w, "localStorage", { configurable: true, get: opts.localStorage });
      w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 });
      w.HTMLCanvasElement.prototype.getContext = function () { return stubCtx(this); };
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
      w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob([""], { type: "image/png" })); };
      w.requestAnimationFrame = cb => setTimeout(() => cb(0), 0);
      w.cancelAnimationFrame = id => clearTimeout(id);
      w.URL.createObjectURL = () => "blob:stub";
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {};
      w.alert = m => { (w.__alerts = w.__alerts || []).push(String(m)); };
      w.confirm = () => true;
      w.prompt = (q, d) => (d === undefined ? "X" : d);
      w.scrollTo = () => {};
      if (!w.PointerEvent) {                       // jsdom 24 has no PointerEvent
        w.PointerEvent = class extends w.MouseEvent {
          constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId || 1; this.pointerType = init.pointerType || "mouse"; this.isPrimary = init.isPrimary !== false; }
        };
      }
      w.Element.prototype.setPointerCapture = function () {};
      w.Element.prototype.releasePointerCapture = function () {};
      w.Element.prototype.hasPointerCapture = () => false;
    },
  });
  const win = dom.window;
  win.__errs = [];
  win.addEventListener("error", e => win.__errs.push((e.error && e.error.stack) || e.message));
  win.onunhandledrejection = e => win.__errs.push("unhandled rejection: " + e.reason);
  for (const s of (opts.scripts || SCRIPTS)) {
    const el = win.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, s), "utf8");
    win.document.body.appendChild(el);
  }
  const g = n => { try { return win.eval(n); } catch (e) { return undefined; } };
  return { dom, win, ROOT, g, App: g("App"), errors: win.__errs };
}

module.exports = { boot, SCRIPTS, ROOT, loadJSDOM };
