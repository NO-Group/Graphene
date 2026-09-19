/* ============================================================
   Graphene — PDF export (print production)
   A from-scratch PDF 1.7 writer: real vector output, DeviceCMYK
   or DeviceRGB colour, axial/radial shadings, transparency via
   ExtGState, multi-page documents, crop/bleed boxes and
   printer's marks. No external libraries.
   ============================================================ */
"use strict";

/* ---------- colour ---------- */
function _pdfHex2rgb(hex) {
  hex = String(hex || "#000000").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const n = parseInt(hex, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/* full-precision CMYK (unlike the 0-100 integer UI conversion) */
function rgbToCmyk01(hex) {
  const [r, g, b] = _pdfHex2rgb(hex);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}
const f3 = v => {
  /* Number.isFinite, not the global isFinite: the global coerces, so null and
     "" pass as finite and then blow up on .toFixed. A malformed project file
     must never be able to produce a corrupt PDF. */
  if (typeof v !== "number" || !Number.isFinite(v)) v = Number(v);
  if (!Number.isFinite(v)) v = 0;
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, "") || "0";
};

/* ---------- low-level PDF document builder ---------- */
class PDFDoc {
  constructor() {
    this.objects = [""];      // 1-based; index 0 unused
    this.mode = "cmyk";
  }
  alloc() { this.objects.push(null); return this.objects.length - 1; }
  put(id, body) { this.objects[id] = body; return id; }
  add(body) { const id = this.alloc(); return this.put(id, body); }

  stream(dict, data, opts) {
    const id = this.alloc();
    let bytes = typeof data === "string" ? data : String(data);
    let extra = "";
    /* Compress with FlateDecode when it helps and the dict has no filter of
       its own (image XObjects arrive pre-compressed). */
    const compressible = this.compress !== false &&
      !/\/Filter/.test(dict) && (opts && opts.raw) !== true && bytes.length > 256;
    if (compressible && typeof zlibDeflate === "function") {
      try {
        const u8 = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) u8[i] = bytes.charCodeAt(i) & 255;
        const z = zlibDeflate(u8);
        if (z.length < bytes.length) {
          bytes = bytesToLatin1(z);
          extra = " /Filter /FlateDecode";
        }
      } catch (e) { /* fall through uncompressed */ }
    }
    this.objects[id] = `<< ${dict}${extra} /Length ${byteLen(bytes)} >>\nstream\n${bytes}\nendstream`;
    return id;
  }

  build() {
    let out = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [0];
    for (let i = 1; i < this.objects.length; i++) {
      offsets[i] = byteLen(out);
      out += `${i} 0 obj\n${this.objects[i]}\nendobj\n`;
    }
    const xrefAt = byteLen(out);
    const n = this.objects.length;
    out += `xref\n0 ${n}\n0000000000 65535 f \n`;
    for (let i = 1; i < n; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${n} /Root ${this.rootId} 0 R /Info ${this.infoId} 0 R >>\n`;
    out += `startxref\n${xrefAt}\n%%EOF\n`;
    return out;
  }
}
/* PDF /Length counts bytes; our strings are latin-1 so length===bytes,
   but be safe about any stray multi-byte char. */
function byteLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) > 255 ? 2 : 1;
  return n;
}
/* Map a JS string into WinAnsiEncoding (cp1252) bytes and escape the
   PDF string delimiters. Characters outside cp1252 degrade to a similar
   ASCII form rather than emitting a bogus byte. */
const _WINANSI = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};
/* best-effort transliteration for common symbols outside cp1252 */
const _FALLBACK = {
  0x2192: "->", 0x2190: "<-", 0x2194: "<->", 0x21D2: "=>",
  0x00D7: "x", 0x2212: "-", 0x2248: "~", 0x2264: "<=", 0x2265: ">=",
  0x2260: "!=", 0x00B7: ".", 0x2027: ".", 0x25CF: "*", 0x25CB: "o",
  0x2605: "*", 0x2606: "*", 0x2713: "v", 0x2717: "x",
};
function toWinAnsi(str) {
  let out = "";
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) { out += ch; continue; }
    if (_WINANSI[cp] !== undefined) { out += String.fromCharCode(_WINANSI[cp]); continue; }
    if (cp <= 0xFF) { out += ch; continue; }          // latin-1 maps directly
    if (_FALLBACK[cp] !== undefined) { out += _FALLBACK[cp]; continue; }
    out += "?";
  }
  return out;
}
function pdfEscape(s) {
  return toWinAnsi(s)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]/g, " ");
}

/* ---------- geometry → PDF path operators ---------- */
/* anchors are in SVG space; the page CTM flips y, so we emit them as-is */
function anchorsToOps(pts, closed) {
  if (!pts || !pts.length) return "";
  let s = `${f3(pts[0].x)} ${f3(pts[0].y)} m\n`;
  const seg = (a, b) => {
    if (!a.hout && !b.hin) return `${f3(b.x)} ${f3(b.y)} l\n`;
    const c1 = a.hout || a, c2 = b.hin || b;
    return `${f3(c1.x)} ${f3(c1.y)} ${f3(c2.x)} ${f3(c2.y)} ${f3(b.x)} ${f3(b.y)} c\n`;
  };
  for (let i = 1; i < pts.length; i++) s += seg(pts[i - 1], pts[i]);
  if (closed && pts.length > 1) { s += seg(pts[pts.length - 1], pts[0]); s += "h\n"; }
  return s;
}

/* an object's outline as PDF ops (converting primitives to paths) */
function objToPathOps(o) {
  if (o.type === "path") {
    if (o.subpaths && o.subpaths.length) {
      return o.subpaths.map(sp => anchorsToOps(sp.pts, sp.closed !== false)).join("");
    }
    return anchorsToOps(o.pts, o.closed);
  }
  if (o.type === "line") {
    return `${f3(o.x1)} ${f3(o.y1)} m\n${f3(o.x2)} ${f3(o.y2)} l\n`;
  }
  const pts = shapeToPathPts(o);
  if (pts) return anchorsToOps(pts, o.type !== "line");
  return "";
}

/* ---------- the exporter ---------- */
function buildPDF(opts) {
  opts = Object.assign({
    colorSpace: "cmyk",     // "cmyk" | "rgb"
    allPages: true,
    bleed: 0,               // pt of bleed beyond the page
    marks: false,           // crop marks + registration
    title: "Graphene design",
  }, opts || {});

  const doc = new PDFDoc();
  doc.mode = opts.colorSpace;

  const pages = (typeof ensurePages === "function") ? ensurePages() : [{ name: "Page 1", objects: App.objects }];
  const list = opts.allPages ? pages : [pages[App.pageIndex] || pages[0]];

  doc.infoId = doc.add(
    `<< /Title (${pdfEscape(opts.title)}) /Producer (Graphene) /Creator (Graphene Vector Design Studio) ` +
    `/CreationDate (D:${pdfDate()}) >>`
  );
  const pagesId = doc.alloc();
  doc.rootId = doc.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const W = App.doc.w, H = App.doc.h;
  const bleed = Math.max(0, opts.bleed);
  const markPad = opts.marks ? Math.max(18, bleed + 12) : bleed;
  const mediaW = W + markPad * 2, mediaH = H + markPad * 2;

  const kids = [];
  for (const page of list) {
    const ctx = {
      doc, ops: [], fonts: new Map(), gstates: new Map(),
      shadings: new Map(), patterns: new Map(), xobjects: new Map(),
      mode: opts.colorSpace,
      /* content CTM is: translate(markPad,markPad) · [1 0 0 -1 0 H] */
      patternMatrix: `1 0 0 -1 ${f3(markPad)} ${f3(markPad + H)}`,
    };

    /* page CTM: shift for marks/bleed, then flip y so SVG coords work directly */
    ctx.ops.push("q");
    ctx.ops.push(`1 0 0 1 ${f3(markPad)} ${f3(markPad)} cm`);
    ctx.ops.push(`1 0 0 -1 0 ${f3(H)} cm`);

    /* page background */
    if (App.doc.bg && App.doc.bg !== "none") {
      ctx.ops.push(setFillColor(App.doc.bg, ctx.mode));
      ctx.ops.push(`0 0 ${f3(W)} ${f3(H)} re f`);
    }

    for (const o of (page.objects || [])) emitObject(o, ctx);
    ctx.ops.push("Q");

    if (opts.marks) ctx.ops.push(printerMarks(W, H, markPad, bleed, ctx.mode));

    const content = doc.stream("", ctx.ops.join("\n"));
    const res = buildResources(ctx);
    const pageId = doc.alloc();
    let dict =
      `<< /Type /Page /Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${f3(mediaW)} ${f3(mediaH)}] ` +
      `/TrimBox [${f3(markPad)} ${f3(markPad)} ${f3(markPad + W)} ${f3(markPad + H)}] `;
    if (bleed > 0) {
      dict += `/BleedBox [${f3(markPad - bleed)} ${f3(markPad - bleed)} ${f3(markPad + W + bleed)} ${f3(markPad + H + bleed)}] `;
    }
    dict += `/Resources ${res} /Contents ${content} 0 R >>`;
    doc.put(pageId, dict);
    kids.push(`${pageId} 0 R`);
  }

  doc.put(pagesId, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`);
  return doc.build();
}

function pdfDate() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function setFillColor(hex, mode) {
  if (mode === "rgb") { const [r, g, b] = _pdfHex2rgb(hex); return `${f3(r)} ${f3(g)} ${f3(b)} rg`; }
  const [c, m, y, k] = rgbToCmyk01(hex);
  return `${f3(c)} ${f3(m)} ${f3(y)} ${f3(k)} k`;
}
function setStrokeColor(hex, mode) {
  if (mode === "rgb") { const [r, g, b] = _pdfHex2rgb(hex); return `${f3(r)} ${f3(g)} ${f3(b)} RG`; }
  const [c, m, y, k] = rgbToCmyk01(hex);
  return `${f3(c)} ${f3(m)} ${f3(y)} ${f3(k)} K`;
}

/* transparency state */
function gsFor(ctx, alpha) {
  const key = f3(alpha);
  if (!ctx.gstates.has(key)) {
    const id = ctx.doc.add(`<< /Type /ExtGState /ca ${key} /CA ${key} >>`);
    ctx.gstates.set(key, { name: `GS${ctx.gstates.size}`, id });
  }
  return ctx.gstates.get(key).name;
}

/* Gradient transparency -> a luminosity SMask in an ExtGState.
   The mask is a form XObject painting a greyscale shading over the object's
   bbox; PDF reads its luminosity as the alpha channel. */
function alphaMaskGsFor(ctx, o, bb) {
  const stops = (typeof alphaStops === "function") ? alphaStops(o.fill) : null;
  if (!stops) return null;
  const key = `am-${o.id}`;
  if (ctx.gstates.has(key)) return ctx.gstates.get(key).name;

  const grey = v => {
    const g = Math.max(0, Math.min(1, v));
    return `${f3(g)} ${f3(g)} ${f3(g)}`;
  };
  /* stitch exponential functions between successive alpha stops */
  const fns = [], bounds = [], encode = [];
  for (let i = 0; i < stops.length - 1; i++) {
    fns.push(ctx.doc.add(
      `<< /FunctionType 2 /Domain [0 1] /C0 [${grey(stops[i].a)}] /C1 [${grey(stops[i + 1].a)}] /N 1 >>`));
    if (i > 0) bounds.push(f3(stops[i].p));
    encode.push("0 1");
  }
  const fnId = fns.length === 1 ? fns[0] : ctx.doc.add(
    `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.map(f => f + " 0 R").join(" ")}] ` +
    `/Bounds [${bounds.join(" ")}] /Encode [${encode.join(" ")}] >>`);

  const f = o.fill || {};
  let shDict;
  if (f.type === "radial") {
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    const rr = Math.max(bb.w, bb.h) / 2 || 1;
    shDict = `<< /ShadingType 3 /ColorSpace /DeviceRGB ` +
             `/Coords [${f3(cx)} ${f3(cy)} 0 ${f3(cx)} ${f3(cy)} ${f3(rr)}] ` +
             `/Function ${fnId} 0 R /Extend [true true] >>`;
  } else {
    const a = (f.angle || 0) * Math.PI / 180;
    const hx = Math.cos(a) / 2, hy = Math.sin(a) / 2;
    shDict = `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [` +
             `${f3(bb.x + bb.w * (0.5 - hx))} ${f3(bb.y + bb.h * (0.5 - hy))} ` +
             `${f3(bb.x + bb.w * (0.5 + hx))} ${f3(bb.y + bb.h * (0.5 + hy))}] ` +
             `/Function ${fnId} 0 R /Extend [true true] >>`;
  }
  const shId = ctx.doc.add(shDict);

  const pad = 4;
  const bx = bb.x - pad, by = bb.y - pad, bw = (bb.w || 1) + pad * 2, bh = (bb.h || 1) + pad * 2;
  const content = `/Sh sh\n`;
  const formId = ctx.doc.stream(
    `/Type /XObject /Subtype /Form /FormType 1 /BBox [${f3(bx)} ${f3(by)} ${f3(bx + bw)} ${f3(by + bh)}] ` +
    `/Group << /Type /Group /S /Transparency /CS /DeviceGray >> ` +
    `/Resources << /Shading << /Sh ${shId} 0 R >> >>`, content);

  const gsId = ctx.doc.add(
    `<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${formId} 0 R ` +
    `/BC [0] >> >>`);
  const name = `GS${ctx.gstates.size}`;
  ctx.gstates.set(key, { name, id: gsId });
  return name;
}

/* axial / radial shading pattern for a gradient fill */
/* Mesh fill -> ShadingType 6 (Coons patch mesh), the native PDF construct.
   Each grid cell becomes one patch with straight edges (control points placed
   at the thirds), so the result is resolution independent in print. */
function meshShadingFor(ctx, o, bb) {
  const key = `mesh-${o.id}`;
  if (ctx.patterns.has(key)) return ctx.patterns.get(key);
  const mesh = (typeof meshOf === "function") ? meshOf(o) : (o.fill && o.fill.mesh);
  if (!mesh || typeof meshPatchList !== "function") return null;

  const cmyk = ctx.mode === "cmyk";
  const ncomp = cmyk ? 4 : 3;

  /* PDF interpolates patch colours BILINEARLY, but our colour field is
     bicubic. Subdividing each cell lets the two converge; 3x3 keeps the
     error invisible without bloating the file. */
  const patches = meshPatchList(mesh, 3);
  if (!patches.length) return null;

  /* Coordinates are normalised (0..1) mesh space -> map into object space. */
  const W = bb.w || 1, H = bb.h || 1;
  const toX = u => bb.x + u * W, toY = v => bb.y + v * H;

  /* Decode range must cover dragged nodes, which may sit outside the bbox. */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of patches) {
    for (const pt of p.pts) {
      const x = toX(pt.x), y = toY(pt.y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!(maxX > minX)) { maxX = minX + 1; }
  if (!(maxY > minY)) { maxY = minY + 1; }

  const bytes = [];
  const pushByte = v => bytes.push(Math.max(0, Math.min(255, Math.round(v))));
  const pushCoord = (v, lo, hi) => {
    const t = hi > lo ? (v - lo) / (hi - lo) : 0;
    const n = Math.max(0, Math.min(65535, Math.round(t * 65535)));
    bytes.push((n >> 8) & 255, n & 255);
  };
  const comps = hex => cmyk ? rgbToCmyk01(hex) : _pdfHex2rgb(hex);

  for (const patch of patches) {
    pushByte(0);                                   // flag 0: standalone patch
    for (const pt of patch.pts) {
      pushCoord(toX(pt.x), minX, maxX);
      pushCoord(toY(pt.y), minY, maxY);
    }
    for (const hex of patch.colors) {
      for (const v of comps(hex)) pushByte(v * 255);
    }
  }

  let data = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    data += String.fromCharCode.apply(null, bytes.slice(i, i + 0x8000));
  }
  const decode = `[${f3(minX)} ${f3(maxX)} ${f3(minY)} ${f3(maxY)}` +
                 ` ${"0 1 ".repeat(ncomp).trim()}]`;
  const shId = ctx.doc.stream(
    `/ShadingType 6 /ColorSpace /Device${cmyk ? "CMYK" : "RGB"} ` +
    `/BitsPerCoordinate 16 /BitsPerComponent 8 /BitsPerFlag 8 ` +
    `/Decode ${decode}`, data);
  const m = ctx.patternMatrix || "1 0 0 1 0 0";
  const patId = ctx.doc.add(`<< /Type /Pattern /PatternType 2 /Matrix [${m}] /Shading ${shId} 0 R >>`);
  const name = `Sh${ctx.shadings.size}`;
  ctx.shadings.set(key, { name, id: patId });
  ctx.patterns.set(key, name);
  return name;
}

/* axial / radial shading pattern for a gradient fill */

function shadingFor(ctx, o, bb) {
  const f = o.fill;
  const key = `${o.id}`;
  if (ctx.shadings.has(key)) return ctx.shadings.get(key).name;

  const cs = ctx.mode === "rgb" ? "/DeviceRGB" : "/DeviceCMYK";
  const conv = ctx.mode === "rgb" ? _pdfHex2rgb : rgbToCmyk01;
  const stops = (f.stops && f.stops.length >= 2)
    ? f.stops.slice().sort((a, b) => a.p - b.p)
    : [{ p: 0, c: f.a }, { p: 1, c: f.b }];

  /* stitch pairwise exponential functions so multi-stop gradients work */
  const fns = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const c0 = conv(stops[i].c).map(f3).join(" ");
    const c1 = conv(stops[i + 1].c).map(f3).join(" ");
    fns.push(ctx.doc.add(`<< /FunctionType 2 /Domain [0 1] /C0 [${c0}] /C1 [${c1}] /N 1 >>`));
  }
  let fnId;
  if (fns.length === 1) fnId = fns[0];
  else {
    const bounds = stops.slice(1, -1).map(s => f3(clamp01(s.p)));
    const encode = fns.map(() => "0 1").join(" ");
    fnId = ctx.doc.add(
      `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.map(i => `${i} 0 R`).join(" ")}] ` +
      `/Bounds [${bounds.join(" ")}] /Encode [${encode}] >>`
    );
  }

  let shDict;
  if (f.type === "radial") {
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    const r = Math.max(bb.w, bb.h) / 2 || 1;
    shDict = `<< /ShadingType 3 /ColorSpace ${cs} /Coords [${f3(cx)} ${f3(cy)} 0 ${f3(cx)} ${f3(cy)} ${f3(r)}] ` +
             `/Function ${fnId} 0 R /Extend [true true] >>`;
  } else {
    const a = (f.angle || 0) * Math.PI / 180;
    const hx = Math.cos(a) / 2, hy = Math.sin(a) / 2;
    const x0 = bb.x + bb.w * (0.5 - hx), y0 = bb.y + bb.h * (0.5 - hy);
    const x1 = bb.x + bb.w * (0.5 + hx), y1 = bb.y + bb.h * (0.5 + hy);
    shDict = `<< /ShadingType 2 /ColorSpace ${cs} /Coords [${f3(x0)} ${f3(y0)} ${f3(x1)} ${f3(y1)}] ` +
             `/Function ${fnId} 0 R /Extend [true true] >>`;
  }
  const shId = ctx.doc.add(shDict);
  /* Pattern space maps to the page's DEFAULT space, NOT the current CTM.
     Replicate the page transform (offset + y-flip) so shadings land correctly. */
  const m = ctx.patternMatrix || "1 0 0 1 0 0";
  const patId = ctx.doc.add(`<< /Type /Pattern /PatternType 2 /Matrix [${m}] /Shading ${shId} 0 R >>`);
  const name = `Sh${ctx.shadings.size}`;
  ctx.shadings.set(key, { name, id: patId });
  return name;
}
const clamp01 = v => Math.max(0, Math.min(1, v));

/* base-14 font mapping */
const PDF_FONTS = {
  "arial": "Helvetica", "helvetica": "Helvetica", "verdana": "Helvetica",
  "trebuchet ms": "Helvetica", "system-ui": "Helvetica", "impact": "Helvetica-Bold",
  "georgia": "Times-Roman", "times new roman": "Times-Roman", "times": "Times-Roman",
  "courier new": "Courier", "courier": "Courier",
};
function fontFor(ctx, o) {
  let base = PDF_FONTS[String(o.font || "").toLowerCase()] || "Helvetica";
  const serif = base.startsWith("Times"), mono = base.startsWith("Courier");
  if (o.bold && o.italic) base = serif ? "Times-BoldItalic" : mono ? "Courier-BoldOblique" : "Helvetica-BoldOblique";
  else if (o.bold) base = serif ? "Times-Bold" : mono ? "Courier-Bold" : "Helvetica-Bold";
  else if (o.italic) base = serif ? "Times-Italic" : mono ? "Courier-Oblique" : "Helvetica-Oblique";
  if (!ctx.fonts.has(base)) {
    const id = ctx.doc.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
    ctx.fonts.set(base, { name: `F${ctx.fonts.size}`, id });
  }
  return ctx.fonts.get(base).name;
}

/* embed a raster image as an XObject (PNG/JPEG data URLs) */
function imageFor(ctx, o) {
  if (ctx.xobjects.has(o.id)) return ctx.xobjects.get(o.id).name;
  const href = o.href || "";
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(href);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const raw = b64ToLatin1(m[2]);
  let dict, data, id;

  if (kind === "png") {
    /* Decode the PNG ourselves and re-emit the samples as a FlateDecode
       image. Alpha (or palette tRNS) becomes an /SMask so transparency
       survives into print. */
    let img;
    try {
      img = decodePNG(latin1ToBytes(raw));
    } catch (e) {
      return null;                       // corrupt PNG: caller draws a box
    }
    const body = bytesToLatin1(zlibDeflate(img.rgb));
    let smask = "";
    if (img.alpha && !allOpaque(img.alpha)) {
      const aId = ctx.doc.stream(
        `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
        `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        bytesToLatin1(zlibDeflate(img.alpha)));
      smask = ` /SMask ${aId} 0 R`;
    }
    dict = `/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
           `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask}`;
    data = body;
  } else {
    /* JPEG passes through untouched — DCTDecode is native to PDF. */
    const dims = jpegSize(raw);
    if (!dims) return null;
    dict = `/Type /XObject /Subtype /Image /Width ${dims.w} /Height ${dims.h} ` +
           `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`;
    data = raw;
  }

  id = ctx.doc.stream(dict, data);
  const name = `Im${ctx.xobjects.size}`;
  ctx.xobjects.set(o.id, { name, id });
  return name;
}
function allOpaque(a) {
  for (let i = 0; i < a.length; i++) if (a[i] !== 255) return false;
  return true;
}
function latin1ToBytes(s) {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
  return u;
}
function b64ToLatin1(b64) {
  if (typeof atob === "function") return atob(b64);
  return Buffer.from(b64, "base64").toString("latin1");
}
function jpegSize(s) {
  for (let i = 2; i + 9 < s.length;) {
    if (s.charCodeAt(i) !== 0xFF) { i++; continue; }
    const marker = s.charCodeAt(i + 1);
    const len = (s.charCodeAt(i + 2) << 8) | s.charCodeAt(i + 3);
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: (s.charCodeAt(i + 5) << 8) | s.charCodeAt(i + 6), w: (s.charCodeAt(i + 7) << 8) | s.charCodeAt(i + 8) };
    }
    i += 2 + len;
  }
  return null;
}

/* ---------- emit one object ---------- */
function emitObject(o, ctx) {
  if (!o || o.visible === false) return;
  const ops = ctx.ops;

  if (o.type === "group") {
    ops.push("q");
    if (o.opacity < 1) ops.push(`/${gsFor(ctx, o.opacity)} gs`);
    if (o.clipWith) {
      const c = objToPathOps(o.clipWith);
      if (c) { ops.push(c + "W n"); }
    }
    for (const c of o.children) emitObject(c, ctx);
    ops.push("Q");
    return;
  }

  ops.push("q");
  if (o.opacity < 1) ops.push(`/${gsFor(ctx, o.opacity)} gs`);
  /* gradient transparency -> luminosity soft mask */
  if (o.fill && o.fill.alphaStops) {
    const am = alphaMaskGsFor(ctx, o, localBBox(o));
    if (am) ops.push(`/${am} gs`);
  }

  /* rotation about the object's centre (y-flipped space: negate the angle) */
  if (o.rot) {
    const b = localBBox(o);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const a = -o.rot * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    ops.push(`1 0 0 1 ${f3(cx)} ${f3(cy)} cm`);
    ops.push(`${f3(cos)} ${f3(sin)} ${f3(-sin)} ${f3(cos)} 0 0 cm`);
    ops.push(`1 0 0 1 ${f3(-cx)} ${f3(-cy)} cm`);
  }

  /* mirroring, recorded by flipChild() for primitives with a normalised box */
  if (o.flipH || o.flipV) {
    const b = localBBox(o);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const sx = o.flipH ? -1 : 1, sy = o.flipV ? -1 : 1;
    ops.push(`1 0 0 1 ${f3(cx)} ${f3(cy)} cm`);
    ops.push(`${f3(sx)} 0 0 ${f3(sy)} 0 0 cm`);
    ops.push(`1 0 0 1 ${f3(-cx)} ${f3(-cy)} cm`);
  }

  if (o.type === "text") {
    emitText(o, ctx);
    ops.push("Q");
    return;
  }

  if (o.type === "image") {
    const name = imageFor(ctx, o);
    if (name) {
      ops.push(`q ${f3(o.w)} 0 0 ${f3(-o.h)} ${f3(o.x)} ${f3(o.y + o.h)} cm /${name} Do Q`);
    } else {
      ops.push(setFillColor("#cccccc", ctx.mode));
      ops.push(`${f3(o.x)} ${f3(o.y)} ${f3(o.w)} ${f3(o.h)} re f`);
    }
    ops.push("Q");
    return;
  }

  const pathOps = objToPathOps(o);
  if (!pathOps) { ops.push("Q"); return; }

  const f = o.fill || { type: "none" };
  const s = o.stroke || { on: false };
  const hasFill = f.type && f.type !== "none" && o.type !== "line";
  const hasStroke = s.on && s.w > 0;
  const grad = hasFill && (f.type === "linear" || f.type === "radial" || f.type === "mesh");
  const evenOdd = (o.subpaths && o.subpaths.length > 1) || (o.type === "path" && !o.closed);

  if (hasStroke) {
    ops.push(setStrokeColor(s.color, ctx.mode));
    ops.push(`${f3(s.w)} w 1 J 1 j`);
    if (s.style === "dashed") ops.push(`[${f3(s.w * 3)} ${f3(s.w * 2)}] 0 d`);
    else if (s.style === "dotted") ops.push(`[${f3(0.1)} ${f3(s.w * 2)}] 0 d`);
    else ops.push("[] 0 d");
  }

  if (grad) {
    /* clip to the path, paint the shading, then stroke separately */
    const bb = localBBox(o);
    const name = (f.type === "mesh") ? meshShadingFor(ctx, o, bb) : shadingFor(ctx, o, bb);
    if (!name) { ops.push("Q"); return; }
    ops.push("q");
    ops.push(pathOps + (evenOdd ? "W* n" : "W n"));
    ops.push("/Pattern cs");
    ops.push(`/${name} scn`);
    ops.push(`${f3(bb.x - 2)} ${f3(bb.y - 2)} ${f3(bb.w + 4)} ${f3(bb.h + 4)} re f`);
    ops.push("Q");
    if (hasStroke) ops.push(pathOps + "S");
  } else if (hasFill && hasStroke) {
    ops.push(setFillColor(f.color, ctx.mode));
    ops.push(pathOps + (evenOdd ? "B*" : "B"));
  } else if (hasFill) {
    ops.push(setFillColor(f.color, ctx.mode));
    ops.push(pathOps + (evenOdd ? "f*" : "f"));
  } else if (hasStroke) {
    ops.push(pathOps + "S");
  }
  ops.push("Q");
}

function emitText(o, ctx) {
  const ops = ctx.ops;
  const fname = fontFor(ctx, o);
  const size = o.size || 16;
  ops.push(setFillColor(o.fill && o.fill.type === "solid" ? o.fill.color : (o.fill && o.fill.a) || "#000000", ctx.mode));
  const lines = String(o.text || "").split("\n");
  const lh = size * (o.lineHeight || 1.2);
  lines.forEach((ln, i) => {
    const y = o.y + i * lh;
    let x = o.x;
    if (o.align === "center" || o.align === "right") {
      const wApprox = ln.length * size * 0.5;
      x -= o.align === "center" ? wApprox / 2 : wApprox;
    }
    ops.push("BT");
    ops.push(`/${fname} ${f3(size)} Tf`);
    /* counter-flip so glyphs are upright inside the flipped page CTM */
    ops.push(`1 0 0 -1 ${f3(x)} ${f3(y)} Tm`);
    ops.push(`(${pdfEscape(ln)}) Tj`);
    ops.push("ET");
  });
}

/* crop marks + registration targets, drawn in page (unflipped) space */
function printerMarks(W, H, pad, bleed, mode) {
  const out = [];
  const L = 12, gap = Math.max(4, bleed + 3);
  out.push("q");
  out.push(mode === "rgb" ? "0 0 0 RG" : "0 0 0 1 K");
  out.push("0.5 w [] 0 d");
  const x0 = pad, y0 = pad, x1 = pad + W, y1 = pad + H;
  const seg = (a, b, c, d) => out.push(`${f3(a)} ${f3(b)} m ${f3(c)} ${f3(d)} l S`);
  // corners: horizontal + vertical ticks outside the trim box
  seg(x0 - gap - L, y0, x0 - gap, y0);  seg(x0, y0 - gap - L, x0, y0 - gap);
  seg(x1 + gap, y0, x1 + gap + L, y0);  seg(x1, y0 - gap - L, x1, y0 - gap);
  seg(x0 - gap - L, y1, x0 - gap, y1);  seg(x0, y1 + gap, x0, y1 + gap + L);
  seg(x1 + gap, y1, x1 + gap + L, y1);  seg(x1, y1 + gap, x1, y1 + gap + L);
  out.push("Q");
  return out.join("\n");
}

/* ---------- resource dictionary ---------- */
function buildResources(ctx) {
  const parts = ["/ProcSet [/PDF /Text /ImageC]"];
  if (ctx.fonts.size) {
    parts.push("/Font << " + [...ctx.fonts.values()].map(f => `/${f.name} ${f.id} 0 R`).join(" ") + " >>");
  }
  if (ctx.gstates.size) {
    parts.push("/ExtGState << " + [...ctx.gstates.values()].map(g => `/${g.name} ${g.id} 0 R`).join(" ") + " >>");
  }
  if (ctx.shadings.size) {
    parts.push("/Pattern << " + [...ctx.shadings.values()].map(s => `/${s.name} ${s.id} 0 R`).join(" ") + " >>");
  }
  if (ctx.xobjects.size) {
    parts.push("/XObject << " + [...ctx.xobjects.values()].map(x => `/${x.name} ${x.id} 0 R`).join(" ") + " >>");
  }
  return `<< ${parts.join(" ")} >>`;
}

/* ---------- download ---------- */
function exportPDF(opts) {
  let str;
  try { str = buildPDF(opts); }
  catch (e) { alert("PDF export failed: " + e.message); return; }
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  download(new Blob([bytes], { type: "application/pdf" }), "design.pdf");
  const cs = (opts && opts.colorSpace === "rgb") ? "RGB" : "CMYK";
  setHint(`PDF exported (${cs}, vector) ✓`);
}

function openPDFDialog() {
  const d = $("#pdf-modal");
  if (d) d.hidden = false;
}

if (typeof document !== "undefined" && typeof $ === "function" && $("#pdf-modal")) {
  const d = $("#pdf-modal");
  $("#pdf-cancel").addEventListener("click", () => d.hidden = true);
  d.addEventListener("click", e => { if (e.target === d) d.hidden = true; });
  $("#pdf-run").addEventListener("click", () => {
    d.hidden = true;
    exportPDF({
      colorSpace: $("#pdf-cs").value,
      allPages: $("#pdf-allpages").checked,
      bleed: +$("#pdf-bleed").value || 0,
      marks: $("#pdf-marks").checked,
    });
  });
}

if (typeof meshPatchList === "undefined" && typeof require === "function") {
  try { var { meshPatchList, meshOf } = require("./mesh.js"); } catch (e) {}
}

if (typeof decodePNG === "undefined" && typeof require === "function") {
  try { var { decodePNG, zlibStore, zlibDeflate, bytesToLatin1 } = require("./png.js"); } catch (e) {}
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { rgbToCmyk01, PDFDoc, byteLen, anchorsToOps, f3 };
}
