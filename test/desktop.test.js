/* desktop.test.js — the Electron shell and its bridge to the page.
   The preload exposes an API; if the page never used it, the native menu and
   native Save dialog would be decoration. These tests drive the bridge with a
   fake window.graphene and assert real effects. */
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/boot.js");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(54)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

console.log("— shell files —");
{
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
  const pre = fs.readFileSync(path.join(ROOT, "desktop", "preload.js"), "utf8");
  t("main.js parses", (() => { try { new Function(main); return true; } catch (e) { return false; } })());
  t("preload.js parses", (() => { try { new Function(pre); return true; } catch (e) { return false; } })());
  t("context isolation is on", /contextIsolation:\s*true/.test(main));
  t("node integration is off", /nodeIntegration:\s*false/.test(main));
  t("sandbox is on", /sandbox:\s*true/.test(main));
  t("a preload script is configured", /preload:/.test(main));
  t("external links do not open in-app", /setWindowOpenHandler/.test(main) && /openExternal/.test(main));
  t("only one instance may run", /requestSingleInstanceLock/.test(main));
  t("window state is persisted", /window-state\.json/.test(main));
  t("preload exposes exactly the bridge", /exposeInMainWorld\("graphene"/.test(pre));
  t("preload does not leak ipcRenderer wholesale", !/exposeInMainWorld\([^)]*ipcRenderer\s*\)/.test(pre));
}

console.log("— packaging config —");
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  t("appId is com.n_o_group.graphene", pkg.build.appId === "com.n_o_group.graphene", pkg.build.appId);
  t("product name is set", pkg.build.productName === "Graphene", pkg.build.productName);
  t("main entry points at the shell", pkg.main === "desktop/main.js", pkg.main);
  t("windows targets nsis + portable",
    JSON.stringify(pkg.build.win.target).includes("nsis") && JSON.stringify(pkg.build.win.target).includes("portable"));
  t("linux targets AppImage + deb",
    JSON.stringify(pkg.build.linux.target).includes("AppImage") && JSON.stringify(pkg.build.linux.target).includes("deb"));
  t("mac targets dmg", JSON.stringify(pkg.build.mac.target).includes("dmg"));
  t("installer lets the user choose a directory", pkg.build.nsis.oneClick === false);
  for (const f of ["js/arrange.js", "desktop/**/*"]) {
    t(`build includes ${f}`, pkg.build.files.includes(f) || pkg.build.files.some(x => x === "js/**/*" && f.startsWith("js/")));
  }
}

console.log("— icons are real, not renamed PNGs —");
{
  const ico = fs.readFileSync(path.join(ROOT, "build", "icon.ico"));
  t("icon.ico has the ICONDIR header", ico[0] === 0 && ico[1] === 0 && ico[2] === 1 && ico[3] === 0);
  const count = ico.readUInt16LE(4);
  t("icon.ico holds several resolutions", count >= 5, count);

  const icns = fs.readFileSync(path.join(ROOT, "build", "icon.icns"));
  t("icon.icns has the icns magic", icns.slice(0, 4).toString() === "icns");
  t("icon.icns declares its own length correctly", icns.readUInt32BE(4) === icns.length,
    `${icns.readUInt32BE(4)} vs ${icns.length}`);
  let off = 8, variants = 0, bad = "";
  while (off < icns.length) {
    const type = icns.slice(off, off + 4).toString();
    const len = icns.readUInt32BE(off + 4);
    if (len < 8 || off + len > icns.length) { bad = "bad chunk length at " + off; break; }
    const payload = icns.slice(off + 8, off + len);
    if (payload.slice(0, 8).toString("latin1") !== "\x89PNG\r\n\x1a\n") { bad = type + " is not PNG"; break; }
    variants++; off += len;
  }
  t("every icns chunk is a valid PNG", !bad, bad);
  t("icns has the full icon family", variants >= 8, variants);

  for (const s of [16, 32, 48, 64, 128, 256, 512]) {
    const p = path.join(ROOT, "build", "icons", `${s}x${s}.png`);
    if (!fs.existsSync(p)) { t(`linux icon ${s}x${s} exists`, false); continue; }
    const b = fs.readFileSync(p);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    t(`linux icon ${s}x${s} is really ${s}x${s}`, w === s && h === s, `${w}x${h}`);
  }
}

console.log("— the page actually uses the bridge —");
{
  /* no window.graphene: everything must stay inert */
  const plain = boot();
  t("initDesktopBridge is a no-op in a browser", plain.g("initDesktopBridge")() === false);
  t("  …and no desktop class is added", !plain.win.document.documentElement.classList.contains("is-desktop"));
}
{
  const r = boot();
  const { win, App, g } = r;
  const sent = [];
  let cmdHandler = null, openHandler = null;
  win.graphene = {
    isDesktop: true,
    onCommand: cb => { cmdHandler = cb; },
    onOpenProject: cb => { openHandler = cb; },
    saveFile: (data, name, enc) => { sent.push({ name, enc, len: String(data).length }); return Promise.resolve({ ok: true }); },
  };
  const ok = g("initDesktopBridge")();
  t("bridge initialises when window.graphene exists", ok === true);
  t("  …and marks the document as desktop", win.document.documentElement.classList.contains("is-desktop"));
  t("  …and registers a command handler", typeof cmdHandler === "function");
  t("  …and registers an open handler", typeof openHandler === "function");

  /* a native menu command must reach runCommand */
  App.objects = []; App.pages = null;
  const before = App.zoom;
  cmdHandler("zoom-in");
  t("a native menu command drives the app", App.zoom !== before, `${before} -> ${App.zoom}`);

  /* an unknown command must not crash the app */
  let threw = false;
  try { cmdHandler("no-such-command"); } catch (e) { threw = true; }
  t("an unknown native command is handled safely", !threw);

  /* the native Open dialog must load a project */
  openHandler(JSON.stringify({
    doc: { w: 640, h: 480, grid: { show: false, snap: false, size: 20 }, guides: { h: [], v: [] } },
    objects: [{ id: "a", type: "rect", x: 3, y: 4, w: 50, h: 60 }],
  }));
  t("a file from the native dialog is loaded", App.objects.length === 1 && App.doc.w === 640,
    `${App.objects.length} objs, w=${App.doc.w}`);
  t("  …and FileReader is restored afterwards", typeof win.FileReader === "function" && !/readAsText = \(\) =>/.test(String(win.FileReader)));

  /* a malformed file from the dialog must not wedge the app */
  openHandler("{ not json");
  let renderOK = true;
  try { g("render")(); } catch (e) { renderOK = false; }
  t("a malformed file from the dialog is survivable", renderOK);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
