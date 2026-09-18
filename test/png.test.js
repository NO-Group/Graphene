/* png.test.js — DEFLATE inflate + PNG decode + zlib store.
   Cross-checked against Node's zlib, which is an independent implementation. */
const zlib = require("zlib");
const path = require("path");
const { inflateRaw, zlibInflate, decodePNG, pngInfo, zlibStore, adler32 } =
  require(path.join(__dirname, "..", "js", "png.js"));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(46)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

/* ---------- helpers: build PNGs in-process, no fixtures on disk ---------- */
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePNG({ w, h, depth, colorType, raw, plte, trns, interlace = 0 }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = interlace;
  const parts = [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk("IHDR", ihdr)];
  if (plte) parts.push(chunk("PLTE", Buffer.from(plte)));
  if (trns) parts.push(chunk("tRNS", Buffer.from(trns)));
  parts.push(chunk("IDAT", zlib.deflateSync(Buffer.from(raw))));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}
const px = (d, x, y) => { const o = (y * d.w + x) * 3; return [d.rgb[o], d.rgb[o + 1], d.rgb[o + 2]]; };

console.log("— DEFLATE inflate vs node zlib —");
const payloads = {
  empty: Buffer.alloc(0),
  single: Buffer.from("x"),
  text: Buffer.from("the quick brown fox ".repeat(40)),
  zeros: Buffer.alloc(70000),                                  // long back-references
  ramp: Buffer.from(Array.from({ length: 50000 }, (_, i) => i % 251)),
  far: Buffer.from("ab".repeat(33000)),                        // > 32 KiB window use
};
const rnd = Buffer.alloc(30000);
for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 2654435761) % 256;
payloads.pseudorandom = rnd;

for (const [name, src] of Object.entries(payloads)) {
  for (const level of [0, 1, 6, 9]) {                          // level 0 ⇒ stored blocks
    let ok = false, note = "";
    try {
      const out = Buffer.from(zlibInflate(new Uint8Array(zlib.deflateSync(src, { level }))));
      ok = out.equals(src);
      if (!ok) note = `got ${out.length} want ${src.length}`;
    } catch (e) { note = e.message; }
    t(`inflate ${name} @level${level}`, ok, note);
  }
}
t("inflateRaw (headerless)", (() => {
  const src = Buffer.from("raw deflate ".repeat(300));
  return Buffer.from(inflateRaw(new Uint8Array(zlib.deflateRawSync(src)))).equals(src);
})());
t("rejects non-deflate zlib header", (() => {
  try { zlibInflate(new Uint8Array([0x00, 0x01])); return false; } catch (e) { return true; }
})());

console.log("\n— zlib store encoder (round-trips through node) —");
for (const len of [0, 1, 1000, 65535, 65536, 150000]) {
  const src = Buffer.alloc(len);
  for (let i = 0; i < len; i++) src[i] = (i * 7) & 255;
  let ok = false, note = "";
  try { ok = zlib.inflateSync(Buffer.from(zlibStore(new Uint8Array(src)))).equals(src); }
  catch (e) { note = e.message; }
  t(`zlibStore len=${len}`, ok, note);
}
t("adler32('abc') = 0x024d0127", adler32(new Uint8Array([97, 98, 99])) === 0x024d0127,
  adler32(new Uint8Array([97, 98, 99])).toString(16));

console.log("\n— PNG colour types —");
let rows = [];
const rgbPx = [[[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]],
               [[10, 20, 30], [40, 50, 60], [70, 80, 90], [100, 110, 120]]];
for (const r of rgbPx) rows.push(0, ...r.flat());
let d = decodePNG(makePNG({ w: 4, h: 2, depth: 8, colorType: 2, raw: rows }));
t("truecolour dims", d.w === 4 && d.h === 2, `${d.w}x${d.h}`);
t("truecolour pixel 0,0", String(px(d, 0, 0)) === "255,0,0", String(px(d, 0, 0)));
t("truecolour pixel 3,1", String(px(d, 3, 1)) === "100,110,120", String(px(d, 3, 1)));
t("truecolour has no alpha", d.alpha === null);

rows = [];
for (let y = 0; y < 2; y++) { rows.push(0); for (let x = 0; x < 4; x++) rows.push(x * 60, y * 100, 128, x * 80); }
d = decodePNG(makePNG({ w: 4, h: 2, depth: 8, colorType: 6, raw: rows }));
t("RGBA colour", String(px(d, 2, 1)) === "120,100,128", String(px(d, 2, 1)));
t("RGBA alpha channel", d.alpha[0] === 0 && d.alpha[1] === 80 && d.alpha[3] === 240,
  [...d.alpha.slice(0, 4)].join(","));

rows = [0, 0, 64, 128, 192, 255,  0, 8, 16, 24, 32, 40];
d = decodePNG(makePNG({ w: 5, h: 2, depth: 8, colorType: 0, raw: rows }));
t("greyscale expands to RGB", String(px(d, 2, 0)) === "128,128,128", String(px(d, 2, 0)));

rows = [0, 50, 200, 100, 255,  0, 150, 90, 200, 10];
d = decodePNG(makePNG({ w: 2, h: 2, depth: 8, colorType: 4, raw: rows }));
t("grey+alpha grey", String(px(d, 0, 0)) === "50,50,50", String(px(d, 0, 0)));
t("grey+alpha alpha", d.alpha[0] === 200 && d.alpha[1] === 255, [...d.alpha.slice(0, 2)].join(","));

const plte = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];
d = decodePNG(makePNG({ w: 4, h: 2, depth: 8, colorType: 3, raw: [0, 0, 1, 2, 3,  0, 3, 2, 1, 0], plte }));
t("palette colours", String(px(d, 2, 0)) === "0,0,255", String(px(d, 2, 0)));
t("palette without tRNS is opaque", d.alpha === null);

d = decodePNG(makePNG({ w: 4, h: 1, depth: 8, colorType: 3, raw: [0, 0, 1, 2, 3], plte, trns: [0, 128, 255, 255] }));
t("palette tRNS becomes alpha", d.alpha[0] === 0 && d.alpha[1] === 128, [...d.alpha.slice(0, 3)].join(","));

d = decodePNG(makePNG({ w: 4, h: 1, depth: 4, colorType: 3, raw: [0, 0x01, 0x23], plte }));
t("4-bit palette unpacks", String(px(d, 0, 0)) === "255,0,0" && String(px(d, 3, 0)) === "255,255,255",
  [px(d, 0, 0), px(d, 3, 0)].join("|"));
d = decodePNG(makePNG({ w: 3, h: 1, depth: 1, colorType: 3, raw: [0, 0b10100000], plte: [0, 0, 0, 255, 255, 255] }));
t("1-bit palette unpacks", String(px(d, 0, 0)) === "255,255,255" && String(px(d, 1, 0)) === "0,0,0",
  [px(d, 0, 0), px(d, 1, 0)].join("|"));

rows = [0]; for (const v of [0, 10000, 20000, 30000, 40000, 65535]) rows.push(v >> 8, v & 255);
d = decodePNG(makePNG({ w: 2, h: 1, depth: 16, colorType: 2, raw: rows }));
t("16-bit reduces to 8-bit", String(px(d, 0, 0)) === "0,39,78", String(px(d, 0, 0)));

console.log("\n— PNG row filters (all five) —");
{
  const W = 6, H = 5;
  const img = [];
  let seed = 12345;
  const rnd2 = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
  for (let y = 0; y < H; y++) { const r = []; for (let x = 0; x < W; x++) r.push([rnd2(), rnd2(), rnd2()]); img.push(r); }
  const raw = [];
  let prev = new Array(W * 3).fill(0);
  for (let y = 0; y < H; y++) {
    const cur = img[y].flat();
    const ft = y % 5;
    raw.push(ft);
    for (let i = 0; i < cur.length; i++) {
      const a = i >= 3 ? cur[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
      let pred = 0;
      if (ft === 1) pred = a;
      else if (ft === 2) pred = b;
      else if (ft === 3) pred = (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      raw.push((cur[i] - pred) & 255);
    }
    prev = cur;
  }
  const dec = decodePNG(makePNG({ w: W, h: H, depth: 8, colorType: 2, raw }));
  let ok = true, bad = "";
  for (let y = 0; y < H && ok; y++) for (let x = 0; x < W; x++) {
    const g = px(dec, x, y), e = img[y][x];
    if (g[0] !== e[0] || g[1] !== e[1] || g[2] !== e[2]) { ok = false; bad = `(${x},${y}) ${g} vs ${e}`; break; }
  }
  t("filters None/Sub/Up/Average/Paeth exact", ok, bad);
}

console.log("\n— header probe & error handling —");
{
  const bytes = makePNG({ w: 9, h: 4, depth: 8, colorType: 2, raw: new Array(4 * (1 + 27)).fill(0) });
  const info = pngInfo(bytes);
  t("pngInfo reads dimensions", info && info.w === 9 && info.h === 4, JSON.stringify(info));
}
t("bad signature throws", (() => {
  try { decodePNG(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])); return false; } catch (e) { return true; }
})());
t("truncated data throws (not hangs)", (() => {
  const good = makePNG({ w: 4, h: 4, depth: 8, colorType: 2, raw: new Array(4 * 13).fill(0) });
  try { decodePNG(good.slice(0, good.length - 30)); return false; } catch (e) { return true; }
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
