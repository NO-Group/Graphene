/* Unit tests for PowerTRACE internals — node test/trace.test.js */
const path = require("path");
const { traceMask, rdpSimplify, quantise, polyArea, tracePixels } =
  require(path.join(__dirname, "..", "js", "trace.js"));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(40)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

/* ---------- contour tracing ---------- */
function mkMask(w, h, fn) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = fn(x, y) ? 1 : 0;
  return m;
}

// a solid 10×10 square inside a 20×20 field
const sq = mkMask(20, 20, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15);
const cs = traceMask(sq, 20, 20);
t("square traces to exactly 1 contour", cs.length === 1, cs.length);
t("square contour has 36 boundary px", cs[0].length === 36, cs[0] && cs[0].length);
t("square contour area ≈ 81", Math.abs(polyArea(cs[0]) - 81) < 1, cs[0] && polyArea(cs[0]));

// two disjoint squares → two contours
const two = mkMask(30, 12, (x, y) => (y >= 2 && y < 10) && ((x >= 2 && x < 8) || (x >= 20 && x < 26)));
t("two blobs → two contours", traceMask(two, 30, 12).length === 2, traceMask(two, 30, 12).length);

// empty mask
t("empty mask → no contours", traceMask(mkMask(10, 10, () => 0), 10, 10).length === 0);

// full mask (touches all borders)
t("full mask → 1 contour", traceMask(mkMask(8, 8, () => 1), 8, 8).length === 1);

// single isolated pixel must not hang or crash
const dot = mkMask(9, 9, (x, y) => x === 4 && y === 4);
t("isolated pixel is safely dropped", traceMask(dot, 9, 9).length === 0);

// diagonal line (8-connectivity stress)
const diag = mkMask(16, 16, (x, y) => Math.abs(x - y) <= 1);
const dcs = traceMask(diag, 16, 16);
t("diagonal traces without hanging", dcs.length >= 1, dcs.length);

/* ---------- RDP simplification ---------- */
const line = Array.from({ length: 50 }, (_, i) => [i, 0]);
t("RDP collapses a straight line to 2 pts", rdpSimplify(line, 0.5).length === 2, rdpSimplify(line, 0.5).length);

const bumpy = line.map(([x], i) => [x, i === 25 ? 10 : 0]);
/* a 1-px spike needs its apex plus both shoulders: [0,0] [24,0] [25,10] [26,0] [49,0] */
t("RDP keeps a significant spike", (() => {
  const r = rdpSimplify(bumpy, 0.5);
  return r.length === 5 && r.some(p => p[1] === 10);
})(), JSON.stringify(rdpSimplify(bumpy, 0.5)));
t("RDP with large eps drops the spike", rdpSimplify(bumpy, 20).length === 2, rdpSimplify(bumpy, 20).length);
t("RDP preserves endpoints", (() => {
  const r = rdpSimplify(bumpy, 0.5);
  return r[0][0] === 0 && r[r.length - 1][0] === 49;
})());
t("RDP handles <3 points", rdpSimplify([[0, 0], [1, 1]], 1).length === 2);

/* ---------- colour quantisation ---------- */
function mkPixels(w, h, colorFn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = colorFn(x, y);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, w, h };
}

// image of exactly two colours → palette of 2 should recover both
const twoTone = mkPixels(40, 40, x => (x < 20 ? [255, 0, 0] : [0, 0, 255]));
const pal = quantise(twoTone, 2);
t("quantise finds 2 clusters", pal.length === 2, pal.length);
const hasRed = pal.some(p => p[0] > 200 && p[1] < 60 && p[2] < 60);
const hasBlue = pal.some(p => p[2] > 200 && p[0] < 60 && p[1] < 60);
t("quantise recovers red", hasRed, JSON.stringify(pal));
t("quantise recovers blue", hasBlue, JSON.stringify(pal));
t("quantise never exceeds k", quantise(twoTone, 8).length <= 8);

/* ---------- full pipeline ---------- */
const tri = mkPixels(60, 60, (x, y) => (y > 10 && y < 50 && Math.abs(x - 30) < (y - 10) / 2) ? [0, 0, 0] : [255, 255, 255]);
const bw = tracePixels(tri, { mode: "bw", threshold: 128, detail: 1, minArea: 4 });
t("bw mode returns one colour group", bw.length === 1, bw.length);
t("bw group has a contour", bw[0] && bw[0].contours.length >= 1, bw[0] && bw[0].contours.length);
t("traced triangle is simplified (<40 pts)", bw[0].contours[0].length < 40, bw[0].contours[0].length);

const colr = tracePixels(twoTone, { mode: "color", colors: 2, detail: 1, minArea: 10 });
t("colour mode returns 2 groups", colr.length === 2, colr.length);
t("colour groups carry hex colours", colr.every(g => /^#[0-9a-f]{6}$/.test(g.color)), JSON.stringify(colr.map(g => g.color)));
t("groups sorted largest first", colr[0].size >= colr[1].size, `${colr[0].size} vs ${colr[1].size}`);

// transparent image must not crash
const clear = { data: new Uint8ClampedArray(20 * 20 * 4), w: 20, h: 20 };
t("fully transparent image → no groups", tracePixels(clear, { mode: "color", colors: 4 }).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
