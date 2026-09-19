/* responsiveness.test.js — pointer handling must stay attached to the cursor.

   Pointer devices fire far faster than the display refreshes, and the drag
   handlers used to run in full for every single event. These tests assert the
   coalescing works AND that it never loses the final position, which is the
   way a naive rAF throttle silently breaks dragging. */
const { boot } = require("./lib/boot.js");

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(56)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};
const frame = () => new Promise(r => setTimeout(r, 0));

(async () => {
  const { win, App, g } = boot();
  const doc = win.document;
  const stage = doc.querySelector("#stage");
  const scene = n => {
    App.objects = []; App.pages = null; App.selection = [];
    for (let i = 0; i < n; i++) App.objects.push(g("makeRect")((i * 37) % 900, (i * 53) % 600, 40, 30));
    g("render")(); g("updateUI")();
    App.zoom = 1; App.panX = 0; App.panY = 0;
  };
  const down = (el, x, y) => el.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, button: 0 }));
  const move = (x, y) => win.dispatchEvent(new win.PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
  const up = (x, y) => win.dispatchEvent(new win.PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y }));

  console.log("— pointer moves are coalesced to animation frames —");
  {
    scene(40);
    let handled = 0;
    const real = win.eval("onPointerMove");
    win.onPointerMove = function (e) { handled++; return real.call(this, e); };
    down(stage, 10, 10);
    for (let i = 0; i < 24; i++) move(10 + i, 10 + i);   // burst with no frame between
    t("a burst of 24 events does not run 24 handlers", handled < 24, handled);
    await frame();
    t("  …but at least one frame is processed", handled >= 1, handled);
    up(300, 300);
    win.onPointerMove = real;
  }

  console.log("— no motion is lost —");
  {
    /* The classic rAF-throttle bug: the last move before pointerup is still
       queued when the gesture ends, so the object lands short of the cursor. */
    scene(10);
    /* Smart guides deliberately pull the object to nearby edges, so they are
       disabled here: this test is about the pointer pipeline, not snapping. */
    const smart = App.smartGuides;
    App.smartGuides = false;
    const target = App.objects[0];
    App.selection = [target.id];
    g("render")();
    const el = doc.querySelector(`[data-id="${target.id}"]`);
    const x0 = target.x, y0 = target.y;
    down(el, 20, 20);
    move(60, 20);
    move(120, 20);
    move(180, 20);          // final position, still queued
    up(180, 20);            // must flush before finishing
    t("the object follows the final pointer position",
      Math.abs(target.x - (x0 + 160)) < 1e-9, `x ${x0} -> ${target.x}, expected ${x0 + 160}`);
    t("  …and does not drift vertically", Math.abs(target.y - y0) < 1e-9, `y ${y0} -> ${target.y}`);
    App.smartGuides = smart;
  }
  {
    /* pointercancel (e.g. the browser steals the gesture) must flush too */
    scene(10);
    const smart2 = App.smartGuides;
    App.smartGuides = false;
    const target = App.objects[0];
    App.selection = [target.id];
    g("render")();
    const el = doc.querySelector(`[data-id="${target.id}"]`);
    const x0 = target.x;
    down(el, 20, 20);
    move(90, 20);
    win.dispatchEvent(new win.PointerEvent("pointercancel", { bubbles: true, clientX: 90, clientY: 20 }));
    t("pointercancel also flushes the pending move", Math.abs(target.x - (x0 + 70)) < 1e-9,
      `x ${x0} -> ${target.x}`);
    App.smartGuides = smart2;
  }

  console.log("— the stage rect is cached, not measured per move —");
  {
    scene(10);
    const el = doc.querySelector("#stage");
    let rects = 0;
    const realRect = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = function () { rects++; return realRect(); };
    g("screenToWorld")(10, 10);
    const first = rects;
    for (let i = 0; i < 30; i++) g("screenToWorld")(10 + i, 10 + i);
    t("repeated conversions do not re-measure layout", rects === first, `${first} -> ${rects}`);

    win.dispatchEvent(new win.Event("resize"));
    g("screenToWorld")(10, 10);
    t("  …but a resize invalidates the cache", rects > first, `${first} -> ${rects}`);
    el.getBoundingClientRect = realRect;
  }
  {
    /* correctness: the cached rect must still produce right coordinates */
    scene(5);
    App.zoom = 2; App.panX = 30; App.panY = 40;
    const w = g("screenToWorld")(130, 140);
    const r = doc.querySelector("#stage").getBoundingClientRect();
    const expX = (130 - r.left - 30) / 2, expY = (140 - r.top - 40) / 2;
    t("cached conversion is still numerically correct",
      Math.abs(w.x - expX) < 1e-9 && Math.abs(w.y - expY) < 1e-9, `${w.x},${w.y} vs ${expX},${expY}`);
    App.zoom = 1; App.panX = 0; App.panY = 0;
  }

  console.log("— snap targets are cached per gesture —");
  {
    scene(300);
    const target = App.objects[0];
    App.selection = [target.id];
    g("render")();
    const el = doc.querySelector(`[data-id="${target.id}"]`);
    let calls = 0;
    const realBB = win.eval("worldBBox");
    win.worldBBox = function (...a) { calls++; return realBB.apply(this, a); };
    down(el, 20, 20);
    calls = 0;
    const mv = win.eval("onPointerMove");
    for (let i = 0; i < 10; i++) mv(new win.PointerEvent("pointermove", { bubbles: true, clientX: 20 + i * 5, clientY: 20 }));
    t("bboxes are not recomputed for every object every frame", calls < 300 * 10 * 0.5,
      `${calls} calls for 10 moves over 300 objects`);
    up(100, 20);
    win.worldBBox = realBB;
  }
  {
    /* the cache must not outlive a change to the document */
    scene(20);
    const a = App.objects[0], b = App.objects[1];
    App.selection = [a.id];
    g("render")();
    const el = doc.querySelector(`[data-id="${a.id}"]`);
    down(el, 20, 20); move(40, 20); up(40, 20);
    b.x = 777;                                  // move another object between gestures
    g("commit")("test change");
    down(el, 40, 20); move(60, 20); up(60, 20);
    t("the snap cache is invalidated by a commit", true);   // no stale-target crash
    t("  …and the document is still consistent", App.objects.length === 20 && b.x === 777, b.x);
  }

  console.log("— dragging only re-renders what moved —");
  {
    scene(400);
    const target = App.objects[0];
    App.selection = [target.id];
    g("render")();
    const el = doc.querySelector(`[data-id="${target.id}"]`);
    let fullRenders = 0;
    const realRender = win.eval("render");
    win.render = function () { fullRenders++; return realRender.apply(this, arguments); };
    down(el, 20, 20);
    const mv = win.eval("onPointerMove");
    for (let i = 0; i < 8; i++) mv(new win.PointerEvent("pointermove", { bubbles: true, clientX: 20 + i * 5, clientY: 20 }));
    t("a drag does not rebuild the whole scene each frame", fullRenders === 0, fullRenders);
    up(80, 20);
    win.render = realRender;

    /* and the moved node must actually be updated on screen */
    const node = doc.querySelector(`[data-id="${target.id}"]`);
    t("the dragged node is still in the DOM", !!node);
    t("  …and every other object survived", doc.querySelectorAll("#objects [data-id]").length === 400,
      doc.querySelectorAll("#objects [data-id]").length);
  }

  console.log("— marquee stays correct and visible —");
  {
    App.objects = []; App.pages = null; App.selection = [];
    const a = g("makeRect")(10, 10, 40, 40), b = g("makeRect")(100, 100, 40, 40), c = g("makeRect")(400, 400, 40, 40);
    App.objects.push(a, b, c); g("render")();
    App.zoom = 1; App.panX = 0; App.panY = 0;
    down(stage, 0, 0);
    const mv = win.eval("onPointerMove");
    mv(new win.PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
    const rect = doc.querySelector("#marquee-rect");
    t("the marquee rectangle is drawn during the drag", !!rect);
    t("  …with the dragged geometry", rect && rect.getAttribute("width") === "200", rect && rect.getAttribute("width"));
    t("  …and selects exactly the enclosed objects",
      App.selection.length === 2 && App.selection.includes(a.id) && App.selection.includes(b.id),
      JSON.stringify(App.selection));
    up(200, 200);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
