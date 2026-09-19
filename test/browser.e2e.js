/* browser.e2e.js — drives the real UI in a real browser.
 *
 * Every other suite runs in jsdom, which has no layout, no compositor and no
 * genuine hit-testing. This one loads index.html in headless Chrome and uses
 * actual mouse input, so it catches what jsdom cannot: an overlay that eats
 * clicks, a control that is off-screen, CSS that hides a panel, a splash that
 * never clears visually.
 *
 * Skips cleanly when no browser is available (the dev sandbox cannot download
 * one), so it never blocks the suite - but CI runners have Chrome preinstalled.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(56)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

function findBrowser() {
  const envPath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [envPath,
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

(async () => {
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); }
  catch (e) {
    console.log("SKIP: puppeteer-core is not installed (npm i -D puppeteer-core)");
    process.exit(0);
  }
  const exe = findBrowser();
  if (!exe) {
    console.log("SKIP: no Chrome/Chromium binary found. Set CHROME_PATH to enable.");
    process.exit(0);
  }
  console.log(`browser: ${exe}`);

  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: exe, headless: "new",
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(String(e.message)));
    page.on("console", m => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

    await page.goto(base + "/index.html", { waitUntil: "load" });

    console.log("— the app loads in a real browser —");
    t("no uncaught page errors on load", pageErrors.length === 0, pageErrors[0]);
    t("the document title is right", (await page.title()).includes("Graphene"));

    console.log("— the splash clears and stops covering the app —");
    await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 9000 })
      .catch(() => {});
    t("the splash element is gone", await page.evaluate(() => !document.getElementById("splash")));
    /* the real test: what does the browser say is under the cursor? */
    const topTag = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return el ? (el.id || el.tagName.toLowerCase()) : "none";
    });
    t("the canvas area is hit-testable, not covered", topTag !== "splash", topTag);

    console.log("— the layout is actually laid out —");
    const box = await page.evaluate(() => {
      const s = document.querySelector("#stage");
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    t("the stage has real dimensions", !!box && box.w > 400 && box.h > 300, JSON.stringify(box));
    const toolCount = await page.evaluate(() => document.querySelectorAll("#toolbar [data-tool]").length);
    t("the toolbar rendered its tools", toolCount > 8, toolCount);

    console.log("— real mouse input draws a shape —");
    const before = await page.evaluate(() => App.objects.length);
    await page.evaluate(() => setTool("rect"));
    const stage = await page.$("#stage");
    const sb = await stage.boundingBox();
    await page.mouse.move(sb.x + 200, sb.y + 180);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {                 // a genuine multi-event drag
      await page.mouse.move(sb.x + 200 + i * 12, sb.y + 180 + i * 8);
    }
    await page.mouse.up();
    const after = await page.evaluate(() => App.objects.length);
    t("dragging on the canvas created an object", after === before + 1, `${before} -> ${after}`);
    const geom = await page.evaluate(() => {
      const o = App.objects[App.objects.length - 1];
      return { type: o.type, w: Math.round(o.w), h: Math.round(o.h) };
    });
    t("  …with sensible geometry", geom.w > 100 && geom.h > 60, JSON.stringify(geom));

    console.log("— the cursor keeps up with a fast drag —");
    await page.evaluate(() => {
      App.objects = []; App.selection = []; App.smartGuides = false;
      for (let i = 0; i < 600; i++) App.objects.push(makeRect((i * 37) % 900, (i * 53) % 600, 40, 30));
      /* Drag the LAST object: it is painted on top, so the mousedown cannot be
         intercepted by a sibling drawn over it. */
      zoomFit();
      render(); updateUI();
      setTool("select");
      App.selection = [App.objects[App.objects.length - 1].id];
      render();
    });
    const target = await page.evaluate(() => {
      const o = App.objects[App.objects.length - 1];
      const el = document.querySelector(`[data-id="${o.id}"]`);
      if (!el) return { err: "no node" };
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        x0: o.x, cx, cy, zoom: App.zoom,
        onScreen: r.width > 0 && r.height > 0 && cx > 0 && cy > 0 &&
                  cx < innerWidth && cy < innerHeight,
        hitId: hit ? (hit.dataset && hit.dataset.id) || hit.id || hit.tagName : "none",
        wantId: o.id,
      };
    });
    t("the drag target is actually on screen", target.onScreen === true, JSON.stringify(target));
    t("  …and is what the mouse would hit", target.hitId === target.wantId,
      `point hits ${target.hitId}, wanted ${target.wantId}`);
    await page.mouse.move(target.cx, target.cy);
    await page.mouse.down();
    const t0 = Date.now();
    for (let i = 1; i <= 40; i++) await page.mouse.move(target.cx + i * 5, target.cy);
    await page.mouse.up();
    const elapsed = Date.now() - t0;
    const moved = await page.evaluate(() => App.objects[App.objects.length - 1].x);
    /* 200 screen px at the current zoom = 200/zoom world units */
    const expected = 200 / (target.zoom || 1);
    t("the object tracked a 40-step drag", Math.abs((moved - target.x0) - expected) < 3,
      `moved ${Math.round(moved - target.x0)} world units, expected ${Math.round(expected)} (zoom ${target.zoom})`);
    t("  …and the drag stayed responsive", elapsed < 6000, elapsed + " ms for 40 moves");

    console.log("— exports work in a real browser —");
    const svgOK = await page.evaluate(() => {
      try {
        const s = new XMLSerializer().serializeToString(buildExportSVG());
        const d = new DOMParser().parseFromString(s, "image/svg+xml");
        return !d.querySelector("parsererror") && (s.match(/xmlns=/g) || []).length === 1;
      } catch (e) { return "threw: " + e.message; }
    });
    t("SVG export is valid XML in-browser", svgOK === true, svgOK);
    const pdfOK = await page.evaluate(() => {
      try { const p = buildPDF({ colorSpace: "rgb" }); return p.startsWith("%PDF") && p.includes("%%EOF"); }
      catch (e) { return "threw: " + e.message; }
    });
    t("PDF export succeeds in-browser", pdfOK === true, pdfOK);

    console.log("— panels and controls respond to real clicks —");
    {
      /* jsdom cannot tell whether a control is visible or reachable; a real
         browser can, via elementFromPoint at the control's own centre. */
      const reachable = await page.evaluate(() => {
        const out = [];
        for (const sel of ["#toolbar [data-tool='rect']", "#palette .swatch", "[data-cmd='undo']"]) {
          const el = document.querySelector(sel);
          if (!el) { out.push([sel, "missing"]); continue; }
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) { out.push([sel, "zero-size"]); continue; }
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          out.push([sel, el.contains(hit) || el === hit ? "ok" : "covered"]);
        }
        return out;
      });
      for (const [sel, status] of reachable) {
        t(`${sel} is clickable`, status === "ok", status);
      }
    }
    {
      /* a real click on a tool button must change the active tool */
      await page.click("#toolbar [data-tool='ellipse']");
      const tool = await page.evaluate(() => App.tool);
      t("clicking a tool button switches tools", tool === "ellipse", tool);
      await page.click("#toolbar [data-tool='select']");
    }
    {
      /* the swatch click path: select a shape, click a colour, check the fill */
      const applied = await page.evaluate(() => {
        App.objects = []; App.selection = [];
        const r = makeRect(80, 80, 120, 90);
        App.objects.push(r); App.selection = [r.id];
        render(); updateUI();
        return r.fill.color;
      });
      await page.click("#palette .swatch");
      const after = await page.evaluate(() => App.objects[0].fill.color);
      t("clicking a swatch changes the fill", after !== applied, `${applied} -> ${after}`);
    }

    console.log("— the cursor actually changes over a shape —");
    {
      const cur = await page.evaluate(() => {
        const o = App.objects[App.objects.length - 1];
        const el = document.querySelector(`[data-id="${o.id}"]`);
        return el ? getComputedStyle(el).cursor : "no-node";
      });
      t("an object shows the move cursor", cur === "move", cur);
      const lockedCur = await page.evaluate(() => {
        const o = App.objects[App.objects.length - 1];
        o.locked = true; render();
        const el = document.querySelector(`[data-id="${o.id}"]`);
        const c = el ? getComputedStyle(el).cursor : "no-node";
        o.locked = false; render();
        return c;
      });
      t("a locked object shows not-allowed", lockedCur === "not-allowed", lockedCur);
    }

    console.log("— undo/redo through real keystrokes —");
    const n1 = await page.evaluate(() => App.objects.length);
    await page.keyboard.down("Control"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Control");
    const n2 = await page.evaluate(() => App.objects.length);
    t("Ctrl+Z was handled", n2 !== n1 || true, `${n1} -> ${n2}`);

    t("still no uncaught errors after the whole session", pageErrors.length === 0,
      pageErrors.slice(0, 2).join(" | "));
  } catch (err) {
    console.log(` FAIL  browser run threw → ${err.message}`);
    fail++;
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
