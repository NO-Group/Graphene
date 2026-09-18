/* Unit tests for the Graphene boolean engine — run: node test/boolean.test.js */
const path = require("path");
const { polyBoolean, contourArea, BOOL_UNION, BOOL_INTERSECTION, BOOL_DIFFERENCE, BOOL_XOR } =
  require(path.join(__dirname, "..", "js", "boolean.js"));

const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const circ = (cx, cy, r, n = 64) => [Array.from({ length: n }, (_, i) => {
  const a = i / n * 2 * Math.PI; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
})];
/* sum of |contour areas| — for even-odd results a hole contributes its own area */
const area = cs => cs.reduce((s, c) => s + contourArea(c), 0);

let pass = 0, fail = 0;
function t(name, got, want, tol = 0.5) {
  const ok = Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name.padEnd(34)} ${got.toFixed(2)} (expect ${want})`);
}

const A = [sq(0, 0, 100, 100)], B = [sq(50, 0, 100, 100)];
t("union of overlapping squares",  area(polyBoolean(A, B, BOOL_UNION)), 15000);
t("intersection",                  area(polyBoolean(A, B, BOOL_INTERSECTION)), 5000);
t("difference",                    area(polyBoolean(A, B, BOOL_DIFFERENCE)), 5000);
t("xor",                           area(polyBoolean(A, B, BOOL_XOR)), 10000);

const D = [sq(500, 500, 10, 10)];
t("disjoint union",                area(polyBoolean(A, D, BOOL_UNION)), 10100);
t("disjoint intersection",         area(polyBoolean(A, D, BOOL_INTERSECTION)), 0);
t("disjoint difference",           area(polyBoolean(A, D, BOOL_DIFFERENCE)), 10000);

const big = [sq(0, 0, 100, 100)], small = [sq(25, 25, 50, 50)];
const donut = polyBoolean(big, small, BOOL_DIFFERENCE);
t("donut contour count",           donut.length, 2, 0);
t("donut outer+hole (even-odd)",   area(donut), 12500);
t("contained intersection",        area(polyBoolean(big, small, BOOL_INTERSECTION)), 2500);
t("contained union",               area(polyBoolean(big, small, BOOL_UNION)), 10000);

t("identical union",               area(polyBoolean(A, [sq(0, 0, 100, 100)], BOOL_UNION)), 10000);
t("identical intersection",        area(polyBoolean(A, [sq(0, 0, 100, 100)], BOOL_INTERSECTION)), 10000);
t("identical difference",          area(polyBoolean(A, [sq(0, 0, 100, 100)], BOOL_DIFFERENCE)), 0);

t("triangle ∩ half-square",        area(polyBoolean([[[0, 0], [100, 0], [50, 100]]], [sq(0, 0, 100, 50)], BOOL_INTERSECTION)), 3750);

/* two r=50 circles, centres 50 apart → exact lens area 3070.92; 64-gons undershoot slightly */
t("circle ∩ circle (lens)",        area(polyBoolean(circ(0, 0, 50), circ(50, 0, 50), BOOL_INTERSECTION)), 3070.92, 12);
t("circle ∪ circle",               area(polyBoolean(circ(0, 0, 50), circ(50, 0, 50), BOOL_UNION)), 2 * Math.PI * 2500 - 3070.92, 25);

/* shared-edge (collinear overlap) case */
t("edge-sharing union",            area(polyBoolean([sq(0, 0, 50, 50)], [sq(50, 0, 50, 50)], BOOL_UNION)), 5000);
t("edge-sharing intersection",     area(polyBoolean([sq(0, 0, 50, 50)], [sq(50, 0, 50, 50)], BOOL_INTERSECTION)), 0);

/* multi-contour subject */
t("two squares − band",            area(polyBoolean([sq(0, 0, 40, 100), sq(60, 0, 40, 100)], [sq(0, 40, 100, 20)], BOOL_DIFFERENCE)), 6400);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
