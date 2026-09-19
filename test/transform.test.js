/* transform.test.js — flip / mirror correctness.
   Regression: flipObj() delegated to scaleObj(-1,1), but scaleObj normalises
   rect/ellipse/image boxes with min/abs. Mirroring such a shape about its own
   centre therefore produced an identical box and the command did nothing at
   all. Gradient angles also failed to mirror, so a flipped gradient still ran
   the same way. */
const { boot } = require("./lib/boot.js");

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(52)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

const { win, App, g } = boot();
const makeRect = g("makeRect"), makeEllipse = g("makeEllipse"), makeImage = g("makeImage");
const makeText = g("makeText"), flipObj = g("flipObj"), render = g("render");
const convertToPath = g("convertToPath"), runCommand = g("runCommand");

console.log("— primitives record the mirror —");
{
  const im = makeImage(0, 0, 100, 50, "data:image/png;base64,iVBORw0KGgo=");
  flipObj(im, true);
  t("flipping an image sets flipH", im.flipH === true, im.flipH);
  flipObj(im, true);
  t("flipping twice restores the original", !im.flipH, im.flipH);
  flipObj(im, false);
  t("vertical flip sets flipV", im.flipV === true, im.flipV);

  const r = makeRect(0, 0, 100, 50);
  flipObj(r, true);
  t("flipping a rect is observable", r.flipH === true, JSON.stringify(r).slice(0, 60));
}

console.log("— gradients mirror with the shape —");
{
  const mk = angle => {
    const r = makeRect(0, 0, 100, 50);
    r.fill = { type: "linear", color: "#f00", a: "#f00", b: "#00f", angle, stops: [{ p: 0, c: "#f00" }, { p: 1, c: "#00f" }] };
    return r;
  };
  const a = mk(45); flipObj(a, true);
  t("horizontal flip: 45° → 135°", a.fill.angle === 135, a.fill.angle);
  flipObj(a, true);
  t("and back again: 135° → 45°", a.fill.angle === 45, a.fill.angle);
  const b = mk(30); flipObj(b, false);
  t("vertical flip: 30° → 330°", b.fill.angle === 330, b.fill.angle);
  const c = mk(0); flipObj(c, true);
  t("horizontal flip: 0° → 180°", c.fill.angle === 180, c.fill.angle);
  const d = mk(90); flipObj(d, false);
  t("vertical flip: 90° → 270°", d.fill.angle === 270, d.fill.angle);
}

console.log("— real geometry still mirrors by coordinates —");
{
  const p = convertToPath(makeRect(0, 0, 100, 100));
  p.pts[0].x = 0; p.pts[1].x = 80; p.pts[2].x = 100; p.pts[3].x = 10;
  flipObj(p, true);
  const xs = p.pts.map(q => Math.round(q.x));
  t("path points mirror about the bbox centre", xs[0] === 100 && xs[1] === 20 && xs[2] === 0 && xs[3] === 90, xs.join(","));
  t("a mirrored path does not also set flipH", !p.flipH);

  const a = makeRect(0, 0, 20, 20), b = makeRect(80, 0, 20, 20);
  const grp = { id: "grp1", type: "group", children: [a, b], x: 0, y: 0, w: 100, h: 20, fill: null, stroke: null };
  flipObj(grp, true);
  t("group children swap sides", Math.round(a.x) === 80 && Math.round(b.x) === 0, `${a.x},${b.x}`);
}

console.log("— the mirror reaches the SVG —");
{
  App.objects = []; App.pages = null;
  const im = makeImage(10, 10, 100, 50, "data:image/png;base64,iVBORw0KGgo=");
  App.objects.push(im);
  render();
  t("no transform before flipping", !win.document.querySelector(`[data-id="${im.id}"]`).getAttribute("transform"));
  flipObj(im, true); render();
  const tf = win.document.querySelector(`[data-id="${im.id}"]`).getAttribute("transform") || "";
  t("mirrored image gets a scale(-1 1) transform", /scale\(-1 1\)/.test(tf), tf);
  t("  …centred on the object", /translate\(60 35\)/.test(tf), tf);

  const r = makeRect(10, 10, 80, 40);
  App.objects.push(r); flipObj(r, false); render();
  const tf2 = win.document.querySelector(`[data-id="${r.id}"]`).getAttribute("transform") || "";
  t("vertical mirror gets scale(1 -1)", /scale\(1 -1\)/.test(tf2), tf2);
}

console.log("— the mirror reaches the PDF —");
{
  const buildPDF = g("buildPDF");
  App.objects = []; App.pages = null;
  const im = makeImage(10, 10, 100, 50, "data:image/png;base64,iVBORw0KGgo=");
  App.objects.push(im);
  const before = buildPDF({ colorSpace: "rgb" });
  flipObj(im, true);
  const after = buildPDF({ colorSpace: "rgb" });
  t("flipping changes the PDF content stream", before !== after);
  t("emits a negative x scale", /-1 0 0 1 0 0 cm/.test(after) || /-1 0 0 1 0 0 cm/.test(after.replace(/\s+/g, " ")), "not found");
}

console.log("— via runCommand, the way a user triggers it —");
{
  App.objects = []; App.pages = null;
  const r = makeRect(0, 0, 100, 50);
  r.fill = { type: "linear", color: "#f00", a: "#f00", b: "#00f", angle: 45, stops: [{ p: 0, c: "#f00" }, { p: 1, c: "#00f" }] };
  App.objects.push(r); App.selection = [r.id];
  runCommand("flip-h");
  t("flip-h command mirrors the selection", r.flipH === true && r.fill.angle === 135, `flipH=${r.flipH} angle=${r.fill.angle}`);
  runCommand("flip-v");
  t("flip-v command mirrors the selection", r.flipV === true, `flipV=${r.flipV}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
