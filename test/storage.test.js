/* storage.test.js — the app must survive a hostile localStorage.
   Safari's private mode throws SecurityError on any access, storage can be
   full, and stored values can be corrupt or of the wrong shape. renderPalette()
   and checkRecovery() both run during boot, so a throw there left the user with
   a blank editor. */
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

const SCRIPTS = ["js/core.js", "js/render.js", "js/boolean.js", "js/tools.js", "js/ui.js",
                 "js/extras.js", "js/pro.js", "js/distort.js", "js/trace.js", "js/png.js",
                 "js/pdf.js", "js/fountain.js", "js/mesh.js"];

function boot(storageFactory) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
    url: "http://localhost:8000/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, "localStorage", { configurable: true, get: storageFactory });
      w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 });
      w.HTMLCanvasElement.prototype.getContext = function () {
        return { canvas: this, font: "", fillStyle: "#000", measureText: () => ({ width: 9 }),
          getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }),
          clearRect() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {},
          stroke() {}, fill() {}, save() {}, restore() {}, scale() {}, setTransform() {}, drawImage() {} };
      };
      w.requestAnimationFrame = cb => setTimeout(() => cb(0), 0);
      w.alert = () => {}; w.confirm = () => true;
    },
  });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", e => errors.push(e.error && e.error.message || e.message));
  for (const s of SCRIPTS) {
    const el = win.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(ROOT, s), "utf8");
    win.document.body.appendChild(el);
  }
  return { win, errors, App: win.eval("App") };
}
const mapStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return () => ({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) });
};

console.log("— hostile localStorage —");
const hostile = {
  "works normally": mapStore(),
  "throws on every access (private mode)": () => { throw new DOMException("denied", "SecurityError"); },
  "throws on write (quota exceeded)": () => ({ getItem: () => null, setItem: () => { throw new DOMException("full", "QuotaExceededError"); }, removeItem() {} }),
  "swatches are corrupt JSON": mapStore({ "graphene-swatches": "{{{not json" }),
  "swatches are not an array": mapStore({ "graphene-swatches": '{"a":1}' }),
  "swatches contain junk entries": mapStore({ "graphene-swatches": '["#ff0000", null, 7, "javascript:alert(1)"]' }),
};
for (const [label, factory] of Object.entries(hostile)) {
  let booted = false, swatches = 0, errs = [];
  try {
    const r = boot(factory);
    booted = !!r.App;
    errs = r.errors;
    swatches = r.win.document.querySelectorAll(".swatch").length;
  } catch (e) { errs = [e.message]; }
  t(`boots when localStorage ${label}`, booted && errs.length === 0, errs[0]);
  t(`  …and still renders the palette`, swatches > 1, swatches);
}
{
  /* only well-formed colours may come back out of storage */
  const r = boot(mapStore({ "graphene-swatches": '["#ff0000", null, 7, "javascript:alert(1)", "#0f0"]' }));
  const loaded = r.win.eval("loadSwatches()");
  t("loadSwatches filters out non-colour entries",
    Array.isArray(loaded) && loaded.length === 2 && loaded.every(c => /^#[0-9a-f]{3,8}$/i.test(c)),
    JSON.stringify(loaded));
}

console.log("\n— crash recovery —");
const goodSave = {
  app: "graphene", version: 3, t: Date.now(),
  doc: { w: 640, h: 480, grid: { show: false, snap: false, size: 20 }, guides: { h: [], v: [] } },
  pages: [{ name: "P1", objects: [{ id: "a", type: "rect", x: 1, y: 2, w: 30, h: 40 }], guides: { h: [], v: [] } }],
  pageIndex: 0, idSeq: 1001,
};
function restoreFrom(payload) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = boot(mapStore({ "graphene-autosave": raw }));
  const bar = r.win.document.querySelector("#recovery-bar");
  if (!bar) return { r, offered: false };
  const btn = r.win.document.querySelector("#rec-restore");
  let threw = "";
  try { btn.dispatchEvent(new r.win.MouseEvent("click", { bubbles: true })); }
  catch (e) { threw = e.message; }
  try { r.win.eval("render")(); r.win.eval("updateUI")(); }
  catch (e) { threw += " render: " + e.message; }
  return { r, offered: true, threw };
}
function healthy(App) {
  const d = App && App.doc;
  return !!d && Number.isFinite(d.w) && d.w > 0 && Number.isFinite(d.h) && d.h > 0
    && !!d.grid && !!d.guides && Array.isArray(d.guides.h);
}
{
  const { r, offered, threw } = restoreFrom(goodSave);
  t("offers recovery for a valid autosave", offered);
  t("restoring a valid autosave works", !threw && r.App.objects.length === 1, threw || r.App.objects.length);
  t("  …and the document is healthy", healthy(r.App));
}
for (const [label, payload] of Object.entries({
  "junk objects in a page": { ...goodSave, pages: [{ name: "P1", objects: [null, 7, { id: "b", type: "rect", x: 0, y: 0, w: 5, h: 5 }] }] },
  "no doc at all": { ...goodSave, doc: undefined },
  "null geometry": { ...goodSave, pages: [{ name: "P1", objects: [{ id: "a", type: "rect", x: null, y: 0, w: 10, h: 10 }] }] },
})) {
  const { r, offered, threw } = restoreFrom(payload);
  t(`restores safely with ${label}`, offered && !threw && healthy(r.App), threw || (offered ? "unhealthy doc" : "not offered"));
}
for (const [label, payload] of Object.entries({
  "truncated JSON": JSON.stringify(goodSave).slice(0, 120),
  "pages is not an array": { ...goodSave, pages: "nope" },
  "no pages": { ...goodSave, pages: [] },
})) {
  const { r, offered } = restoreFrom(payload);
  t(`does not offer recovery for ${label}`, !offered && !!r.App, offered ? "bar shown" : "app dead");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
