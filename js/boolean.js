/* ============================================================
   Graphene — Boolean shape operations
   Martinez-Rueda-Feito polygon clipping (exact, handles holes,
   self-intersections, collinear overlaps) + CorelDRAW-style
   shaping commands: Weld, Trim, Intersect, Simplify,
   Front Minus Back, Back Minus Front, Create Boundary.
   ============================================================ */
"use strict";

const BOOL_INTERSECTION = 0, BOOL_UNION = 1, BOOL_DIFFERENCE = 2, BOOL_XOR = 3;
const _NORMAL = 0, _NON_CONTRIBUTING = 1, _SAME_TRANSITION = 2, _DIFFERENT_TRANSITION = 3;
const _EPS = 1e-9;

/* ---------- vector helpers ---------- */
function _cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
function _dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
function _eq(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function _signedArea(p0, p1, p2) {
  return (p0[0] - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (p0[1] - p2[1]);
}

/* ---------- sweep event ---------- */
class SweepEvent {
  constructor(point, left, otherEvent, isSubject, type) {
    this.point = point;
    this.left = left;
    this.otherEvent = otherEvent;
    this.isSubject = isSubject;
    this.type = type || _NORMAL;
    this.inOut = false;
    this.otherInOut = false;
    this.prevInResult = null;
    this.inResult = false;
    this.otherPos = -1;
    this.contourId = 0;
  }
  isBelow(p) {
    const p0 = this.point, p1 = this.otherEvent.point;
    return this.left ? _signedArea(p0, p1, p) > 0 : _signedArea(p1, p0, p) > 0;
  }
  isAbove(p) { return !this.isBelow(p); }
  isVertical() { return this.point[0] === this.otherEvent.point[0]; }
}

/* ---------- ordering ---------- */
function compareEvents(e1, e2) {
  if (e1.point[0] > e2.point[0]) return 1;
  if (e1.point[0] < e2.point[0]) return -1;
  if (e1.point[1] !== e2.point[1]) return e1.point[1] > e2.point[1] ? 1 : -1;
  return specialCases(e1, e2);
}
function specialCases(e1, e2) {
  if (e1.left !== e2.left) return e1.left ? 1 : -1;      // right events first
  if (_signedArea(e1.point, e1.otherEvent.point, e2.otherEvent.point) !== 0) {
    return e1.isBelow(e2.otherEvent.point) ? -1 : 1;
  }
  return (!e1.isSubject && e2.isSubject) ? 1 : -1;
}

function compareSegments(le1, le2) {
  if (le1 === le2) return 0;
  if (_signedArea(le1.point, le1.otherEvent.point, le2.point) !== 0 ||
      _signedArea(le1.point, le1.otherEvent.point, le2.otherEvent.point) !== 0) {
    // segments are not collinear
    if (_eq(le1.point, le2.point)) return le1.isBelow(le2.otherEvent.point) ? -1 : 1;
    if (le1.point[0] === le2.point[0]) return le1.point[1] < le2.point[1] ? -1 : 1;
    if (compareEvents(le1, le2) === 1) return le2.isAbove(le1.point) ? -1 : 1;
    return le1.isBelow(le2.point) ? -1 : 1;
  }
  if (le1.isSubject === le2.isSubject) {
    if (_eq(le1.point, le2.point)) {
      if (_eq(le1.otherEvent.point, le2.otherEvent.point)) return 0;
      return le1.contourId > le2.contourId ? 1 : -1;
    }
    return compareEvents(le1, le2) === 1 ? 1 : -1;
  }
  return le1.isSubject ? -1 : 1;
}

/* ---------- priority queue (binary heap) ---------- */
class EventQueue {
  constructor() { this.data = []; this.length = 0; }
  push(item) { this.data.push(item); this.length++; this._up(this.length - 1); }
  pop() {
    if (this.length === 0) return undefined;
    const top = this.data[0], bottom = this.data.pop();
    this.length--;
    if (this.length > 0) { this.data[0] = bottom; this._down(0); }
    return top;
  }
  _up(pos) {
    const d = this.data, item = d[pos];
    while (pos > 0) {
      const parent = (pos - 1) >> 1, cur = d[parent];
      if (compareEvents(item, cur) >= 0) break;
      d[pos] = cur; pos = parent;
    }
    d[pos] = item;
  }
  _down(pos) {
    const d = this.data, half = this.length >> 1, item = d[pos];
    while (pos < half) {
      let best = (pos << 1) + 1;
      const right = best + 1;
      if (right < this.length && compareEvents(d[right], d[best]) < 0) best = right;
      if (compareEvents(d[best], item) >= 0) break;
      d[pos] = d[best]; pos = best;
    }
    d[pos] = item;
  }
}

/* ---------- sweep-line status (sorted array) ---------- */
function statusInsert(line, e) {
  let lo = 0, hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareSegments(line[mid], e) < 0) lo = mid + 1; else hi = mid;
  }
  line.splice(lo, 0, e);
  return lo;
}

/* ---------- segment intersection ---------- */
function _toPoint(p, s, d) { return [p[0] + s * d[0], p[1] + s * d[1]]; }

function segmentIntersection(a1, a2, b1, b2, noEndpointTouch) {
  const va = [a2[0] - a1[0], a2[1] - a1[1]];
  const vb = [b2[0] - b1[0], b2[1] - b1[1]];
  const e = [b1[0] - a1[0], b1[1] - a1[1]];
  let kross = _cross(va, vb);
  let sqrKross = kross * kross;
  const sqrLenA = _dot(va, va), sqrLenB = _dot(vb, vb);

  if (sqrKross > _EPS * sqrLenA * sqrLenB) {
    const s = _cross(e, vb) / kross;
    if (s < 0 || s > 1) return null;
    const t = _cross(e, va) / kross;
    if (t < 0 || t > 1) return null;
    if (s === 0 || s === 1) return noEndpointTouch ? null : [_toPoint(a1, s, va)];
    if (t === 0 || t === 1) return noEndpointTouch ? null : [_toPoint(b1, t, vb)];
    return [_toPoint(a1, s, va)];
  }

  kross = _cross(e, va);
  sqrKross = kross * kross;
  if (sqrKross > _EPS * sqrLenA * _dot(e, e)) return null;   // parallel, not collinear

  const sa = _dot(e, va) / sqrLenA;
  const sb = sa + _dot(vb, va) / sqrLenA;
  const smin = Math.min(sa, sb), smax = Math.max(sa, sb);

  if (smin <= 1 && smax >= 0) {
    if (smin === 1) return noEndpointTouch ? null : [_toPoint(a1, smin, va)];
    if (smax === 0) return noEndpointTouch ? null : [_toPoint(a1, smax, va)];
    if (noEndpointTouch && smin === 0 && smax === 1) return null;
    return [_toPoint(a1, Math.max(smin, 0), va), _toPoint(a1, Math.min(smax, 1), va)];
  }
  return null;
}

/* ---------- divide / intersect ---------- */
function divideSegment(se, p, queue) {
  const r = new SweepEvent(p, false, se, se.isSubject);
  const l = new SweepEvent(p, true, se.otherEvent, se.isSubject);
  r.contourId = l.contourId = se.contourId;
  if (compareEvents(l, se.otherEvent) > 0) { se.otherEvent.left = true; l.left = false; }
  se.otherEvent.otherEvent = l;
  se.otherEvent = r;
  queue.push(l); queue.push(r);
}

function possibleIntersection(se1, se2, queue) {
  const inter = segmentIntersection(se1.point, se1.otherEvent.point, se2.point, se2.otherEvent.point);
  const n = inter ? inter.length : 0;
  if (n === 0) return 0;
  if (n === 1 && (_eq(se1.point, se2.point) || _eq(se1.otherEvent.point, se2.otherEvent.point))) return 0;
  if (n === 2 && se1.isSubject === se2.isSubject) return 0;   // overlap inside same polygon: ignore

  if (n === 1) {
    if (!_eq(se1.point, inter[0]) && !_eq(se1.otherEvent.point, inter[0])) divideSegment(se1, inter[0], queue);
    if (!_eq(se2.point, inter[0]) && !_eq(se2.otherEvent.point, inter[0])) divideSegment(se2, inter[0], queue);
    return 1;
  }

  /* overlapping segments */
  const events = [];
  const leftCoincide = _eq(se1.point, se2.point);
  const rightCoincide = _eq(se1.otherEvent.point, se2.otherEvent.point);
  if (!leftCoincide) {
    if (compareEvents(se1, se2) > 0) events.push(se2, se1); else events.push(se1, se2);
  }
  if (!rightCoincide) {
    if (compareEvents(se1.otherEvent, se2.otherEvent) > 0) events.push(se2.otherEvent, se1.otherEvent);
    else events.push(se1.otherEvent, se2.otherEvent);
  }

  if ((leftCoincide && rightCoincide) || leftCoincide) {
    se2.type = _NON_CONTRIBUTING;
    se1.type = (se2.inOut === se1.inOut) ? _SAME_TRANSITION : _DIFFERENT_TRANSITION;
    if (leftCoincide && !rightCoincide) divideSegment(events[1].otherEvent, events[0].point, queue);
    return 2;
  }
  if (rightCoincide) { divideSegment(events[0], events[1].point, queue); return 3; }
  if (events[0] !== events[3].otherEvent) {
    divideSegment(events[0], events[1].point, queue);
    divideSegment(events[1], events[2].point, queue);
    return 3;
  }
  divideSegment(events[0], events[1].point, queue);
  divideSegment(events[3].otherEvent, events[2].point, queue);
  return 3;
}

/* ---------- fields ---------- */
function computeInResult(event, operation) {
  switch (event.type) {
    case _NORMAL:
      switch (operation) {
        case BOOL_INTERSECTION: return !event.otherInOut;
        case BOOL_UNION: return event.otherInOut;
        case BOOL_DIFFERENCE:
          return (event.isSubject && event.otherInOut) || (!event.isSubject && !event.otherInOut);
        case BOOL_XOR: return true;
      }
      return false;
    case _SAME_TRANSITION: return operation === BOOL_INTERSECTION || operation === BOOL_UNION;
    case _DIFFERENT_TRANSITION: return operation === BOOL_DIFFERENCE;
    case _NON_CONTRIBUTING: return false;
  }
  return false;
}

function computeFields(event, prev, operation) {
  if (prev === null || prev === undefined) {
    event.inOut = false;
    event.otherInOut = true;
  } else {
    if (event.isSubject === prev.isSubject) {
      event.inOut = !prev.inOut;
      event.otherInOut = prev.otherInOut;
    } else {
      event.inOut = !prev.otherInOut;
      event.otherInOut = prev.isVertical() ? !prev.inOut : prev.inOut;
    }
    event.prevInResult = (!computeInResult(prev, operation) || prev.isVertical()) ? prev.prevInResult : prev;
  }
  event.inResult = computeInResult(event, operation);
}

/* ---------- queue fill ---------- */
function processContour(contour, isSubject, contourId, queue, bbox) {
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const a = contour[i], b = contour[(i + 1) % n];
    if (_eq(a, b)) continue;
    const e1 = new SweepEvent(a, false, undefined, isSubject);
    const e2 = new SweepEvent(b, false, e1, isSubject);
    e1.otherEvent = e2;
    e1.contourId = e2.contourId = contourId;
    if (compareEvents(e1, e2) > 0) e2.left = true; else e1.left = true;
    if (a[0] < bbox[0]) bbox[0] = a[0];
    if (a[1] < bbox[1]) bbox[1] = a[1];
    if (a[0] > bbox[2]) bbox[2] = a[0];
    if (a[1] > bbox[3]) bbox[3] = a[1];
    queue.push(e1); queue.push(e2);
  }
}

/* ---------- sweep ---------- */
function subdivide(queue, sbbox, cbbox, operation) {
  const line = [];
  const sorted = [];
  const rightbound = Math.min(sbbox[2], cbbox[2]);
  let prev, next, pos;

  while (queue.length !== 0) {
    let event = queue.pop();
    sorted.push(event);

    if ((operation === BOOL_INTERSECTION && event.point[0] > rightbound) ||
        (operation === BOOL_DIFFERENCE && event.point[0] > sbbox[2])) break;

    if (event.left) {
      pos = statusInsert(line, event);
      prev = pos > 0 ? line[pos - 1] : null;
      next = pos < line.length - 1 ? line[pos + 1] : null;
      computeFields(event, prev, operation);
      if (next && possibleIntersection(event, next, queue) === 2) {
        computeFields(event, prev, operation);
        computeFields(next, event, operation);
      }
      if (prev && possibleIntersection(prev, event, queue) === 2) {
        const pp = line.indexOf(prev) - 1;
        computeFields(prev, pp >= 0 ? line[pp] : null, operation);
        computeFields(event, prev, operation);
      }
    } else {
      event = event.otherEvent;
      pos = line.indexOf(event);
      if (pos >= 0) {
        prev = pos > 0 ? line[pos - 1] : null;
        next = pos < line.length - 1 ? line[pos + 1] : null;
        line.splice(pos, 1);
        if (prev && next) possibleIntersection(prev, next, queue);
      }
    }
  }
  return sorted;
}

/* ---------- build contours from result events ---------- */
function orderEvents(sortedEvents) {
  const res = [];
  for (const e of sortedEvents) {
    if ((e.left && e.inResult) || (!e.left && e.otherEvent.inResult)) res.push(e);
  }
  res.sort(compareEvents);
  for (let i = 0; i < res.length; i++) res[i].otherPos = i;
  for (const e of res) {
    if (!e.left) {
      const tmp = e.otherPos;
      e.otherPos = e.otherEvent.otherPos;
      e.otherEvent.otherPos = tmp;
    }
  }
  return res;
}

function nextPos(pos, resultEvents, processed, origPos) {
  let newPos = pos + 1;
  const len = resultEvents.length;
  const p = resultEvents[pos].point;
  let p1 = newPos < len ? resultEvents[newPos].point : null;
  while (newPos < len && p1[0] === p[0] && p1[1] === p[1]) {
    if (!processed[newPos]) return newPos;
    newPos++;
    p1 = newPos < len ? resultEvents[newPos].point : null;
  }
  newPos = pos - 1;
  while (newPos > origPos && processed[newPos]) newPos--;
  return newPos;
}

function connectEdges(sortedEvents) {
  const res = orderEvents(sortedEvents);
  const processed = {};
  const contours = [];
  const guard = res.length * 4 + 16;

  for (let i = 0; i < res.length; i++) {
    if (processed[i]) continue;
    const contour = [res[i].point];
    let pos = i, steps = 0;
    while (pos >= i && steps++ < guard) {
      processed[pos] = true;
      pos = res[pos].otherPos;
      if (pos < 0 || pos >= res.length) break;
      processed[pos] = true;
      contour.push(res[pos].point);
      pos = nextPos(pos, res, processed, i);
      if (pos <= i) break;
    }
    if (contour.length > 2) contours.push(contour);
  }
  return contours;
}

/* ---------- public: polygon boolean ----------
   subject / clipping: array of contours, contour = [[x,y], ...]
   returns array of contours (even-odd fill)                     */
function polyBoolean(subject, clipping, operation) {
  subject = (subject || []).filter(c => c && c.length >= 3);
  clipping = (clipping || []).filter(c => c && c.length >= 3);

  if (subject.length === 0 || clipping.length === 0) {
    if (operation === BOOL_INTERSECTION) return [];
    if (operation === BOOL_DIFFERENCE) return subject;
    return subject.concat(clipping);          // union / xor
  }

  const queue = new EventQueue();
  const sbbox = [Infinity, Infinity, -Infinity, -Infinity];
  const cbbox = [Infinity, Infinity, -Infinity, -Infinity];
  let cid = 1;
  for (const c of subject) processContour(c, true, cid++, queue, sbbox);
  for (const c of clipping) processContour(c, false, cid++, queue, cbbox);

  // disjoint bounding boxes → trivial results
  if (sbbox[0] > cbbox[2] || cbbox[0] > sbbox[2] || sbbox[1] > cbbox[3] || cbbox[1] > sbbox[3]) {
    if (operation === BOOL_INTERSECTION) return [];
    if (operation === BOOL_DIFFERENCE) return subject;
    return subject.concat(clipping);
  }

  const sorted = subdivide(queue, sbbox, cbbox, operation);
  return connectEdges(sorted);
}

/* shoelace area (absolute) — used for tests + tiny-sliver cleanup */
function contourArea(c) {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i++) {
    const p = c[i], q = c[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/* ============================================================
   Application layer — flatten Graphene objects → contours
   ============================================================ */
function _cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
          a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
function _dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

/* flatten anchor list (with bezier handles) into a polygon */
function flattenAnchors(pts, closed) {
  const out = [];
  const n = pts.length;
  if (n < 2) return out;
  const segs = closed === false ? n - 1 : n;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const p0 = [a.x, a.y], p3 = [b.x, b.y];
    if (!a.hout && !b.hin) { out.push(p0); continue; }
    const p1 = a.hout ? [a.hout.x, a.hout.y] : p0;
    const p2 = b.hin ? [b.hin.x, b.hin.y] : p3;
    const len = _dist(p0, p1) + _dist(p1, p2) + _dist(p2, p3);
    const steps = Math.max(6, Math.min(72, Math.ceil(len / 3)));
    for (let s = 0; s < steps; s++) out.push(_cubicAt(p0, p1, p2, p3, s / steps));
  }
  if (closed === false) out.push([pts[n - 1].x, pts[n - 1].y]);
  // drop duplicate consecutive points
  const clean = [];
  for (const p of out) {
    const q = clean[clean.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) clean.push(p);
  }
  return clean;
}

/* world-space contours of any object */
function objContours(o) {
  let contours = [];
  if (o.type === "group") {
    for (const c of o.children) contours = contours.concat(objContours(c));
    return contours;
  }
  if (o.type === "path") {
    if (o.subpaths && o.subpaths.length) {
      for (const sp of o.subpaths) contours.push(flattenAnchors(sp.pts, true));
    } else contours.push(flattenAnchors(o.pts, true));
  } else if (o.type === "text" || o.type === "image") {
    const b = localBBox(o);
    contours.push([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]);
  } else {
    const pts = shapeToPathPts(o);
    if (pts) contours.push(flattenAnchors(pts, true));
  }
  if (o.rot) {
    const b = localBBox(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    contours = contours.map(c => c.map(p => {
      const r = rotPt(p[0], p[1], cx, cy, o.rot);
      return [r.x, r.y];
    }));
  }
  return contours.filter(c => c.length >= 3);
}

/* contours → Graphene path object (styled like `template`) */
function contoursToPath(contours, template) {
  contours = contours.filter(c => c.length >= 3 && contourArea(c) > 0.02);
  if (!contours.length) return null;
  const p = makePath([], true);
  p.subpaths = contours.map(c => ({ pts: c.map(pt => anchor(round2(pt[0]), round2(pt[1]))), closed: true }));
  p.pts = p.subpaths[0].pts;               // first subpath is the editable one
  if (template) {
    p.fill = JSON.parse(JSON.stringify(template.fill));
    p.stroke = JSON.parse(JSON.stringify(template.stroke));
    p.opacity = template.opacity;
    if (template.fx) p.fx = JSON.parse(JSON.stringify(template.fx));
  }
  return p;
}

/* ============================================================
   Shaping commands
   ============================================================ */
function shapeOp(op) {
  const objs = selectedObjs().filter(o => !o.locked && o.visible);
  if (objs.length < 2 && op !== "simplify") { setHint("Select 2 or more objects to shape"); return; }
  if (!objs.length) return;

  // z-order: objs[0] = back-most … last = front-most
  const ordered = App.objects.filter(o => objs.includes(o));
  const front = ordered[ordered.length - 1];
  const back = ordered[0];
  const template = { weld: back, trim: back, intersect: front, simplify: back, fmb: front, bmf: back, boundary: front }[op] || front;

  let result = null;
  let keep = [];

  if (op === "weld") {
    result = objContours(ordered[0]);
    for (let i = 1; i < ordered.length; i++) result = polyBoolean(result, objContours(ordered[i]), BOOL_UNION);
  } else if (op === "intersect") {
    result = objContours(ordered[0]);
    for (let i = 1; i < ordered.length; i++) result = polyBoolean(result, objContours(ordered[i]), BOOL_INTERSECTION);
  } else if (op === "exclude") {
    result = objContours(ordered[0]);
    for (let i = 1; i < ordered.length; i++) result = polyBoolean(result, objContours(ordered[i]), BOOL_XOR);
  } else if (op === "trim") {
    // front object cuts every object behind it; the cutter survives
    const cutter = objContours(front);
    const newObjs = [];
    for (const o of ordered.slice(0, -1)) {
      const r = polyBoolean(objContours(o), cutter, BOOL_DIFFERENCE);
      const p = contoursToPath(r, o);
      if (p) { p.name = (o.name || cap(o.type)) + " (trimmed)"; newObjs.push({ old: o, neu: p }); }
      else newObjs.push({ old: o, neu: null });
    }
    replaceObjects(newObjs);
    App.selection = newObjs.filter(n => n.neu).map(n => n.neu.id).concat([front.id]);
    commit("trim"); render(); updateUI();
    setHint("Trimmed ✓");
    return;
  } else if (op === "fmb") {           // front minus back
    result = objContours(front);
    for (const o of ordered.slice(0, -1)) result = polyBoolean(result, objContours(o), BOOL_DIFFERENCE);
  } else if (op === "bmf") {           // back minus front
    result = objContours(back);
    for (const o of ordered.slice(1)) result = polyBoolean(result, objContours(o), BOOL_DIFFERENCE);
  } else if (op === "simplify") {
    // remove hidden (overlapped) areas from every object underneath
    const news = [];
    for (let i = 0; i < ordered.length; i++) {
      let r = objContours(ordered[i]);
      for (let j = i + 1; j < ordered.length; j++) r = polyBoolean(r, objContours(ordered[j]), BOOL_DIFFERENCE);
      const p = contoursToPath(r, ordered[i]);
      if (p) p.name = (ordered[i].name || cap(ordered[i].type)) + " (simplified)";
      news.push({ old: ordered[i], neu: p });
    }
    replaceObjects(news);
    App.selection = news.filter(n => n.neu).map(n => n.neu.id);
    commit("simplify"); render(); updateUI();
    setHint("Simplified ✓");
    return;
  } else if (op === "boundary") {
    result = objContours(ordered[0]);
    for (let i = 1; i < ordered.length; i++) result = polyBoolean(result, objContours(ordered[i]), BOOL_UNION);
    const p = contoursToPath(result, template);
    if (!p) { setHint("Nothing to outline"); return; }
    p.name = "Boundary";
    p.fill = { type: "none", color: "#7C5CFF", a: "#7C5CFF", b: "#39D2C0", angle: 90 };
    p.stroke = { on: true, color: "#FF5C7A", w: 2, style: "solid", cap: "round", join: "round" };
    App.objects.push(p);
    App.selection = [p.id];
    commit("create boundary"); render(); updateUI();
    setHint("Boundary created ✓");
    return;
  }

  const p = contoursToPath(result, template);
  if (!p) { setHint("Result is empty"); return; }
  p.name = { weld: "Welded", intersect: "Intersection", exclude: "Exclusion", fmb: "Front minus back", bmf: "Back minus front" }[op] || "Shape";

  const set = new Set(ordered.map(o => o.id));
  const at = App.objects.findIndex(o => set.has(o.id));
  App.objects = App.objects.filter(o => !set.has(o.id));
  App.objects.splice(Math.max(0, at), 0, p);
  App.selection = [p.id];
  commit(op);
  render(); updateUI();
  setHint(p.name + " ✓");
}

/* swap a list of {old, neu} in place, preserving z-order */
function replaceObjects(pairs) {
  for (const { old, neu } of pairs) {
    const i = App.objects.indexOf(old);
    if (i < 0) continue;
    if (neu) App.objects.splice(i, 1, neu);
    else App.objects.splice(i, 1);
  }
}

/* node export for unit testing */
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = { polyBoolean, contourArea, BOOL_UNION, BOOL_INTERSECTION, BOOL_DIFFERENCE, BOOL_XOR };
}
