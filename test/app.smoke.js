/* Headless integration smoke test — loads index.html in jsdom and drives the app.
   Run: node test/app.smoke.js   (requires jsdom; see README) */
const fs = require("fs");
const path = require("path");
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

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name}${!cond && extra !== undefined ? "  → " + extra : ""}`);
};

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost:8000/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  resources: undefined,
  beforeParse(win) {
    // jsdom lacks these; stub just enough for boot
    win.SVGElement.prototype.getBBox = function () {
      return { x: 0, y: 0, width: 100, height: 20 };
    };
    win.HTMLCanvasElement.prototype.getContext = function () {
      return {
        canvas: this, fillStyle: "#000000", strokeStyle: "#000", lineWidth: 1, font: "",
        clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, save() {}, restore() {}, scale() {}, translate() {}, rotate() {},
        setTransform() {}, fillText() {}, measureText: () => ({ width: 10 }), drawImage() {},
        createLinearGradient: () => ({ addColorStop() {} }),
      };
    };
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
    win.scrollTo = () => {};
  }
});

const win = dom.window;

// inject the app scripts manually so we control order & catch errors
const errors = [];
win.addEventListener("error", e => errors.push(String(e.error || e.message)));

const scripts = ["js/core.js", "js/render.js", "js/boolean.js", "js/tools.js", "js/ui.js", "js/extras.js", "js/pro.js"];
for (const s of scripts) {
  const code = fs.readFileSync(path.join(ROOT, s), "utf8");
  const el = win.document.createElement("script");
  // classic script → declarations land in global scope, exactly like the browser
  el.textContent = code;
  try {
    win.document.body.appendChild(el);
  } catch (e) {
    errors.push(`${s}: ${e.message}`);
  }
}
// jsdom reports script errors via the virtual console, not throws
dom.virtualConsole.on("jsdomError", e => errors.push(e.message));

/* `const`/`function` declarations in classic scripts are global-scope but not
   window properties. Bridge them onto window so the test can call them. */
const bridge = win.document.createElement("script");
bridge.textContent = `
  window.__g = name => { try { return eval(name); } catch (e) { return undefined; } };
  [ "App","makeRect","makeEllipse","makePolygon","makeLine","makeText","makePath","makeGroup",
    "makeImage","anchor","moveObj","scaleObj","worldBBox","localBBox","convertToPath","pathD",
    "subpathD","render","commit","undo","redo","shapeOp","objContours","contourArea","polyBoolean",
    "contoursToPath","addPage","gotoPage","deletePage","ensurePages","rgb2cmyk","cmyk2rgb","rgb2hsb",
    "hsb2rgb","mixHex","contourSelection","blendSelection","powerClip","releaseClip",
    "attachTextToPath","detachTextFromPath","buildExportSVG","renderGuides","updateUI","combinePaths",
    "breakApart","runCommand","setPageSize","selectedObjs","findTop","flattenAnchors","resample"
  ].forEach(n => { const v = window.__g(n); if (v !== undefined) window[n] = v; });
`;
win.document.body.appendChild(bridge);

console.log("\n— load —");
t("all scripts evaluated without throwing", errors.length === 0, errors.join(" | "));

const A = win.App;
t("App state exists", !!A);
t("boot seeded welcome objects", A && A.objects.length === 4, A && A.objects.length);
t("pages initialised", !!(A && A.pages && A.pages.length === 1));

console.log("\n— geometry / core —");
const r = win.makeRect(10, 20, 100, 50);
t("makeRect", r.x === 10 && r.w === 100);
win.moveObj(r, 5, 5);
t("moveObj", r.x === 15 && r.y === 25);
win.scaleObj(r, 2, 2, 0, 0);
t("scaleObj", r.w === 200 && r.h === 100);
const bb = win.worldBBox(r);
t("worldBBox", bb.w === 200 && bb.h === 100);

const p = win.convertToPath(win.makeEllipse(0, 0, 100, 100));
t("ellipse → path has 4 anchors", p.type === "path" && p.pts.length === 4, p.pts && p.pts.length);
t("pathD emits curves", win.pathD(p).includes("C"));

// multi-subpath pathD (native, no monkey patch)
const combo = win.makePath([win.anchor(0, 0), win.anchor(10, 0), win.anchor(10, 10)], true);
combo.subpaths = [
  { pts: [win.anchor(0, 0), win.anchor(10, 0), win.anchor(10, 10)], closed: true },
  { pts: [win.anchor(2, 2), win.anchor(6, 2), win.anchor(6, 6)], closed: true },
];
const d = win.pathD(combo);
t("multi-subpath pathD has 2 M commands", (d.match(/M /g) || []).length === 2, d);

console.log("\n— boolean shaping —");
A.objects = [];
A.idSeq = 5000;
const s1 = win.makeRect(0, 0, 100, 100);
const s2 = win.makeRect(50, 0, 100, 100);
A.objects.push(s1, s2);
A.selection = [s1.id, s2.id];
win.shapeOp("weld");
t("weld produced a single path", A.objects.length === 1 && A.objects[0].type === "path", A.objects.length);
const weldArea = win.objContours(A.objects[0]).reduce((s, c) => s + win.contourArea(c), 0);
t("weld area = 15000", Math.abs(weldArea - 15000) < 1, weldArea);

A.objects = [];
const i1 = win.makeRect(0, 0, 100, 100), i2 = win.makeRect(50, 0, 100, 100);
A.objects.push(i1, i2); A.selection = [i1.id, i2.id];
win.shapeOp("intersect");
const interArea = win.objContours(A.objects[0]).reduce((s, c) => s + win.contourArea(c), 0);
t("intersect area = 5000", Math.abs(interArea - 5000) < 1, interArea);

A.objects = [];
const d1 = win.makeRect(0, 0, 100, 100), d2 = win.makeRect(25, 25, 50, 50);
A.objects.push(d1, d2); A.selection = [d1.id, d2.id];
win.shapeOp("fmb");           // front (d2) minus back → empty; use bmf for the donut
A.objects = [];
const b1 = win.makeRect(0, 0, 100, 100), b2 = win.makeRect(25, 25, 50, 50);
A.objects.push(b1, b2); A.selection = [b1.id, b2.id];
win.shapeOp("bmf");
t("back-minus-front makes a donut (2 subpaths)", A.objects[0].subpaths && A.objects[0].subpaths.length === 2,
  A.objects[0] && A.objects[0].subpaths && A.objects[0].subpaths.length);

console.log("\n— pages —");
A.objects = []; A.selection = [];
win.addPage(false);
t("addPage → 2 pages", A.pages.length === 2, A.pages.length);
A.objects.push(win.makeRect(0, 0, 10, 10));
win.gotoPage(0);
t("gotoPage switches object list", A.objects.length === 0, A.objects.length);
win.gotoPage(1);
t("page 2 kept its object", A.objects.length === 1, A.objects.length);
win.deletePage();
t("deletePage → 1 page", A.pages.length === 1, A.pages.length);

console.log("\n— colour models —");
t("rgb2cmyk(#ff0000)", JSON.stringify(win.rgb2cmyk("#ff0000")) === JSON.stringify({ c: 0, m: 100, y: 100, k: 0 }), JSON.stringify(win.rgb2cmyk("#ff0000")));
t("cmyk2rgb roundtrip", win.cmyk2rgb(0, 100, 100, 0) === "#ff0000", win.cmyk2rgb(0, 100, 100, 0));
t("rgb2hsb(#00ff00)", win.rgb2hsb("#00ff00").h === 120);
t("hsb2rgb roundtrip", win.hsb2rgb(120, 100, 100) === "#00ff00", win.hsb2rgb(120, 100, 100));
t("mixHex midpoint", win.mixHex("#000000", "#ffffff", 0.5) === "#808080", win.mixHex("#000000", "#ffffff", 0.5));

console.log("\n— contour / blend —");
A.objects = []; A.selection = [];
const co = win.makeRect(100, 100, 100, 100);
A.objects.push(co); A.selection = [co.id];
win.contourSelection(1);
t("contour created 3 rings", A.objects.length === 4, A.objects.length);

A.objects = []; A.selection = [];
const ba = win.makeRect(0, 0, 50, 50), bb2 = win.makeEllipse(300, 300, 80, 80);
A.objects.push(ba, bb2); A.selection = [ba.id, bb2.id];
win.blendSelection();
t("blend created 6 intermediate shapes", A.objects.length === 8, A.objects.length);

console.log("\n— powerclip —");
A.objects = []; A.selection = [];
const content = win.makeRect(0, 0, 200, 200), container = win.makeEllipse(50, 50, 100, 100);
A.objects.push(content, container); A.selection = [content.id, container.id];
win.powerClip();
t("powerclip made a clip group", A.objects.length === 1 && !!A.objects[0].clipWith, A.objects.length);
win.releaseClip();
t("release restored objects", A.objects.length === 2, A.objects.length);

console.log("\n— text on path —");
A.objects = []; A.selection = [];
const txt = win.makeText(0, 0, "Curved");
const curve = win.makePath([win.anchor(0, 100), win.anchor(200, 100)], false);
A.objects.push(curve, txt); A.selection = [txt.id, curve.id];
win.attachTextToPath();
t("text attached to path", txt.onPath === curve.id, txt.onPath);
win.render();
const tEl = win.document.querySelector(`#objects [data-id="${txt.id}"]`);
t("rendered <text> contains <textPath>", !!(tEl && tEl.querySelector("textPath")));
A.selection = [txt.id];
win.detachTextFromPath();
t("text detached", !txt.onPath);

console.log("\n— undo / redo / history —");
A.objects = []; A.selection = []; A.history = []; A.histIndex = -1;
win.commit("base");
A.objects.push(win.makeRect(0, 0, 10, 10));
win.commit("add");
t("history has 2 entries", A.history.length === 2, A.history.length);
win.undo();
t("undo removed the rect", A.objects.length === 0, A.objects.length);
win.redo();
t("redo restored the rect", A.objects.length === 1, A.objects.length);

console.log("\n— export —");
A.objects = [win.makeRect(10, 10, 50, 50)];
const svg = win.buildExportSVG();
const out = new win.XMLSerializer().serializeToString(svg);
t("export SVG has rect", out.includes("<rect"));
t("export SVG has page size", out.includes(`width="${A.doc.w}"`));

console.log("\n— render integrity —");
A.objects = [];
["rect", "ellipse", "polygon", "line", "text", "path"].forEach(type => {
  let o;
  if (type === "rect") o = win.makeRect(0, 0, 10, 10);
  else if (type === "ellipse") o = win.makeEllipse(0, 0, 10, 10);
  else if (type === "polygon") o = win.makePolygon(0, 0, 10, 10, 5, false, .5);
  else if (type === "line") o = win.makeLine(0, 0, 10, 10);
  else if (type === "text") o = win.makeText(0, 0, "hi");
  else o = win.makePath([win.anchor(0, 0), win.anchor(10, 10)], false);
  A.objects.push(o);
});
win.render();
t("all 6 object types rendered", win.document.querySelectorAll("#objects > *").length === 6,
  win.document.querySelectorAll("#objects > *").length);

// guides + smart guides
A.doc.guides = { h: [100], v: [200] };
win.renderGuides();
t("guides rendered (2 lines + 2 hit areas)", win.document.querySelectorAll("#guides > line").length === 4,
  win.document.querySelectorAll("#guides > line").length);

console.log("\n— runtime errors during the whole run —");
t("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
