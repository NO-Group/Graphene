/* png.js — DEFLATE inflate + PNG decoding, implemented from scratch.
   Used by the PDF exporter to embed PNG artwork as real image XObjects
   (rather than a placeholder box) and available to the tracer.

   No dependencies: works in the browser and in Node. */

/* ---------- DEFLATE (RFC 1951) ---------- */

const _LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35,
  43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const _LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
  4, 4, 4, 4, 5, 5, 5, 5, 0];
const _DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const _DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
  9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const _CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/* canonical Huffman table: maps (length<<16)|code -> symbol */
function buildHuffman(lengths) {
  let maxBits = 0;
  for (const l of lengths) if (l > maxBits) maxBits = l;
  const blCount = new Array(maxBits + 1).fill(0);
  for (const l of lengths) if (l) blCount[l]++;
  const nextCode = new Array(maxBits + 2).fill(0);
  let code = 0;
  for (let b = 1; b <= maxBits; b++) { code = (code + blCount[b - 1]) << 1; nextCode[b] = code; }
  const map = new Map();
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i];
    if (l) map.set((l << 16) | nextCode[l]++, i);
  }
  return { map, maxBits };
}

function inflateRaw(src) {
  let pos = 0, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), outLen = 0;

  const need = n => {
    if (outLen + n <= out.length) return;
    let cap = out.length || 1024;
    while (cap < outLen + n) cap *= 2;
    const bigger = new Uint8Array(cap);
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  };
  const bit = () => {
    if (bitCnt === 0) {
      if (pos >= src.length) throw new Error("inflate: out of input");
      bitBuf = src[pos++]; bitCnt = 8;
    }
    const b = bitBuf & 1; bitBuf >>= 1; bitCnt--;
    return b;
  };
  const bits = n => { let v = 0; for (let i = 0; i < n; i++) v |= bit() << i; return v; };
  const symbol = h => {
    let code = 0;
    for (let len = 1; len <= h.maxBits; len++) {
      code = (code << 1) | bit();
      const s = h.map.get((len << 16) | code);
      if (s !== undefined) return s;
    }
    throw new Error("inflate: bad Huffman code");
  };

  let fixedLit = null, fixedDist = null;
  const getFixed = () => {
    if (!fixedLit) {
      const l = new Array(288);
      for (let i = 0; i < 144; i++) l[i] = 8;
      for (let i = 144; i < 256; i++) l[i] = 9;
      for (let i = 256; i < 280; i++) l[i] = 7;
      for (let i = 280; i < 288; i++) l[i] = 8;
      fixedLit = buildHuffman(l);
      fixedDist = buildHuffman(new Array(30).fill(5));
    }
    return [fixedLit, fixedDist];
  };

  for (;;) {
    const last = bit();
    const type = bits(2);

    if (type === 0) {                       // stored
      bitCnt = 0;                            // discard to byte boundary
      if (pos + 4 > src.length) throw new Error("inflate: truncated stored block");
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;                              // skip LEN + NLEN
      need(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len; pos += len;
    } else if (type === 1 || type === 2) {
      let litH, distH;
      if (type === 1) {
        [litH, distH] = getFixed();
      } else {                               // dynamic
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const clcLens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clcLens[_CLC_ORDER[i]] = bits(3);
        const clcH = buildHuffman(clcLens);
        const lens = [];
        while (lens.length < hlit + hdist) {
          const s = symbol(clcH);
          if (s < 16) lens.push(s);
          else if (s === 16) {
            const prev = lens[lens.length - 1];
            if (prev === undefined) throw new Error("inflate: repeat with no previous length");
            const n = 3 + bits(2);
            for (let i = 0; i < n; i++) lens.push(prev);
          } else if (s === 17) {
            const n = 3 + bits(3);
            for (let i = 0; i < n; i++) lens.push(0);
          } else {
            const n = 11 + bits(7);
            for (let i = 0; i < n; i++) lens.push(0);
          }
        }
        litH = buildHuffman(lens.slice(0, hlit));
        distH = buildHuffman(lens.slice(hlit, hlit + hdist));
      }

      for (;;) {
        const s = symbol(litH);
        if (s === 256) break;
        if (s < 256) { need(1); out[outLen++] = s; continue; }
        const li = s - 257;
        if (li >= _LEN_BASE.length) throw new Error("inflate: bad length symbol");
        const len = _LEN_BASE[li] + bits(_LEN_EXTRA[li]);
        const ds = symbol(distH);
        if (ds >= _DIST_BASE.length) throw new Error("inflate: bad distance symbol");
        const dist = _DIST_BASE[ds] + bits(_DIST_EXTRA[ds]);
        if (dist > outLen) throw new Error("inflate: distance beyond output");
        need(len);
        let from = outLen - dist;
        for (let i = 0; i < len; i++) out[outLen++] = out[from++];
      }
    } else {
      throw new Error("inflate: invalid block type");
    }
    if (last) break;
  }
  return out.subarray(0, outLen);
}

/* zlib wrapper (RFC 1950): 2-byte header, optional dict, adler32 tail */
function zlibInflate(src) {
  if (src.length < 2) throw new Error("zlib: too short");
  const cmf = src[0], flg = src[1];
  if ((cmf & 0x0f) !== 8) throw new Error("zlib: not deflate");
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error("zlib: bad header checksum");
  const start = (flg & 0x20) ? 6 : 2;       // skip FDICT if present
  return inflateRaw(src.subarray(start));
}

/* ---------- PNG (RFC 2083) ---------- */

const _PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

/* reverse PNG row filters for one (sub)image */
function unfilter(data, off, w, h, bpp, rowBytes) {
  const out = new Uint8Array(w === 0 || h === 0 ? 0 : rowBytes * h);
  let prev = new Uint8Array(rowBytes);
  for (let y = 0; y < h; y++) {
    const ft = data[off++];
    const row = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    row.set(data.subarray(off, off + rowBytes));
    off += rowBytes;
    switch (ft) {
      case 0: break;
      case 1: for (let i = bpp; i < rowBytes; i++) row[i] = (row[i] + row[i - bpp]) & 255; break;
      case 2: for (let i = 0; i < rowBytes; i++) row[i] = (row[i] + prev[i]) & 255; break;
      case 3:
        for (let i = 0; i < rowBytes; i++) {
          const left = i >= bpp ? row[i - bpp] : 0;
          row[i] = (row[i] + ((left + prev[i]) >> 1)) & 255;
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++) {
          const left = i >= bpp ? row[i - bpp] : 0;
          const ul = i >= bpp ? prev[i - bpp] : 0;
          row[i] = (row[i] + paeth(left, prev[i], ul)) & 255;
        }
        break;
      default: throw new Error("png: unknown filter " + ft);
    }
    prev = row;
  }
  return { pixels: out, next: off };
}

/* read sample `i` of a row packed at `depth` bits */
function sampleAt(row, i, depth) {
  if (depth === 8) return row[i];
  if (depth === 16) return row[i * 2];               // reduce 16-bit to 8
  const per = 8 / depth, idx = (i / per) | 0;
  const shift = 8 - depth * ((i % per) + 1);
  return (row[idx] >> shift) & ((1 << depth) - 1);
}

const _ADAM7 = [
  // xStart, yStart, xStep, yStep
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
  [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
];

/* bytes: Uint8Array of a whole .png file.
   returns { w, h, rgb:Uint8Array(w*h*3), alpha:Uint8Array(w*h)|null } */
function decodePNG(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 ||
      bytes[2] !== 0x4E || bytes[3] !== 0x47) throw new Error("png: bad signature");

  let p = 8, w = 0, h = 0, depth = 8, colorType = 6, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p); p += 4;
    const type = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    p += 4;
    if (type === "IHDR") {
      w = dv.getUint32(p); h = dv.getUint32(p + 4);
      depth = bytes[p + 8]; colorType = bytes[p + 9];
      if (bytes[p + 10] !== 0) throw new Error("png: unsupported compression");
      interlace = bytes[p + 12];
    } else if (type === "PLTE") {
      palette = bytes.subarray(p, p + len);
    } else if (type === "tRNS") {
      trns = bytes.subarray(p, p + len);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(p, p + len));
    } else if (type === "IEND") {
      break;
    }
    p += len + 4;                            // payload + CRC
  }
  if (!w || !h) throw new Error("png: missing IHDR");
  if (!idat.length) throw new Error("png: missing IDAT");
  if (_PNG_CHANNELS[colorType] === undefined) throw new Error("png: bad colour type");

  let total = 0; for (const c of idat) total += c.length;
  const comp = new Uint8Array(total);
  let q = 0; for (const c of idat) { comp.set(c, q); q += c.length; }
  const raw = zlibInflate(comp);

  const channels = _PNG_CHANNELS[colorType];
  const bpp = Math.max(1, (channels * depth) >> 3);

  /* gather unfiltered rows as a flat w*h sample grid */
  const rgb = new Uint8Array(w * h * 3);
  const hasAlpha = colorType === 4 || colorType === 6 || (colorType === 3 && trns);
  const alpha = hasAlpha ? new Uint8Array(w * h) : null;
  if (alpha) alpha.fill(255);

  const putPixel = (x, y, row, i) => {
    if (x >= w || y >= h) return;
    const o = (y * w + x) * 3;
    if (colorType === 0 || colorType === 4) {
      let g = sampleAt(row, i * channels, depth);
      if (depth < 8) g = Math.round(g * 255 / ((1 << depth) - 1));
      rgb[o] = rgb[o + 1] = rgb[o + 2] = g;
      if (colorType === 4) alpha[y * w + x] = sampleAt(row, i * channels + 1, depth);
    } else if (colorType === 2 || colorType === 6) {
      rgb[o] = sampleAt(row, i * channels, depth);
      rgb[o + 1] = sampleAt(row, i * channels + 1, depth);
      rgb[o + 2] = sampleAt(row, i * channels + 2, depth);
      if (colorType === 6) alpha[y * w + x] = sampleAt(row, i * channels + 3, depth);
    } else {                                  // indexed
      const idx = sampleAt(row, i, depth);
      if (palette && idx * 3 + 2 < palette.length) {
        rgb[o] = palette[idx * 3]; rgb[o + 1] = palette[idx * 3 + 1]; rgb[o + 2] = palette[idx * 3 + 2];
      }
      if (trns) alpha[y * w + x] = idx < trns.length ? trns[idx] : 255;
    }
  };

  if (!interlace) {
    const rowBytes = Math.ceil(w * channels * depth / 8);
    const { pixels } = unfilter(raw, 0, w, h, bpp, rowBytes);
    for (let y = 0; y < h; y++) {
      const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let x = 0; x < w; x++) putPixel(x, y, row, x);
    }
  } else {
    let off = 0;
    for (const [x0, y0, dx, dy] of _ADAM7) {
      const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const rowBytes = Math.ceil(pw * channels * depth / 8);
      const r = unfilter(raw, off, pw, ph, bpp, rowBytes);
      off = r.next;
      for (let yy = 0; yy < ph; yy++) {
        const row = r.pixels.subarray(yy * rowBytes, (yy + 1) * rowBytes);
        for (let xx = 0; xx < pw; xx++) putPixel(x0 + xx * dx, y0 + yy * dy, row, xx);
      }
    }
  }

  return { w, h, rgb, alpha };
}

/* Quick header read without decoding the pixels. */
function pngInfo(bytes) {
  if (bytes.length < 26) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  return {
    w: dv.getUint32(16), h: dv.getUint32(20),
    depth: bytes[24], colorType: bytes[25], interlace: bytes[28],
  };
}


/* ---------- minimal zlib DEFLATE encoder (stored blocks) ----------
   PDF's /FlateDecode requires a zlib stream. We emit uncompressed
   (BTYPE=00) blocks: always valid, no patent/perf risk, and the PDF
   viewer decodes it natively. Callers that want smaller files can use
   CompressionStream where available. */
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStore(buf) {
  const MAX = 65535;
  const nBlocks = Math.max(1, Math.ceil(buf.length / MAX));
  const out = new Uint8Array(2 + buf.length + nBlocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;          // CM=8, no dict, fastest
  for (let i = 0; i < nBlocks; i++) {
    const start = i * MAX;
    const len = Math.min(MAX, buf.length - start);
    out[o++] = (i === nBlocks - 1) ? 1 : 0;  // BFINAL, BTYPE=00
    out[o++] = len & 255; out[o++] = (len >> 8) & 255;
    out[o++] = ~len & 255; out[o++] = (~len >> 8) & 255;
    out.set(buf.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(buf);
  out[o++] = (ad >>> 24) & 255; out[o++] = (ad >>> 16) & 255;
  out[o++] = (ad >>> 8) & 255; out[o++] = ad & 255;
  return out.subarray(0, o);
}

/* Uint8Array -> latin1 string, for embedding in a PDF stream */
function bytesToLatin1(u8) {
  let s = "", CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return s;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { inflateRaw, zlibInflate, decodePNG, pngInfo, buildHuffman, zlibStore, adler32, bytesToLatin1 };
}
