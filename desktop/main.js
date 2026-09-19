/* Graphene desktop shell (Electron).
   The browser build saves to localStorage and downloads through the DOM; the
   desktop build additionally gets a native menu, real Open/Save dialogs, and
   window-state persistence. */
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const STATE_FILE = () => path.join(app.getPath("userData"), "window-state.json");

/* Only one instance: a second launch focuses the existing window instead of
   opening a rival copy with its own autosave. */
if (!app.requestSingleInstanceLock()) { app.quit(); }

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), "utf8"));
    if (typeof s.width === "number" && typeof s.height === "number") return s;
  } catch (e) { /* first run, or unreadable - fall through to defaults */ }
  return { width: 1440, height: 900 };
}

function saveState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch (e) { /* not fatal */ }
}

let mainWindow = null;
let splashWindow = null;

/* Frameless branded splash, shown while the editor loads.
   It is closed from exactly one place (closeSplash) and guarded by a watchdog,
   so a failure to load index.html can never leave it orphaned on screen. */
function createSplash() {
  try {
    const win = new BrowserWindow({
      width: 520, height: 300,
      frame: false, resizable: false, movable: true,
      center: true, show: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      backgroundColor: "#00000000",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadFile(path.join(__dirname, "splash.html"),
      { search: "v=" + encodeURIComponent(app.getVersion()) });
    win.once("ready-to-show", () => { if (!win.isDestroyed()) win.show(); });
    splashWindow = win;
    /* Hard ceiling: never outlive the main window's load by much. */
    setTimeout(closeSplash, 10000);
    return win;
  } catch (e) {
    splashWindow = null;                 // splash is optional, never fatal
    return null;
  }
}

function closeSplash() {
  const w = splashWindow;
  splashWindow = null;
  try { if (w && !w.isDestroyed()) w.close(); } catch (e) { /* already gone */ }
}


function createWindow() {
  const st = readState();
  const win = new BrowserWindow({
    width: st.width, height: st.height,
    x: st.x, y: st.y,
    minWidth: 960, minHeight: 600,
    backgroundColor: "#16171c",
    show: false,                                  // avoid a white flash
    icon: path.join(ROOT, "icons", "icon-512.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: ["--app-version=" + app.getVersion()],
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (st.maximized) win.maximize();
  win.once("ready-to-show", () => {
    closeSplash();                       // retire the splash before revealing
    win.show();
    win.focus();
  });
  /* If the page fails to load, the splash must still go and the user must be
     told, rather than being left staring at a branded panel forever. */
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    closeSplash();
    if (!win.isDestroyed()) win.show();
    dialog.showErrorBox("Graphene could not start",
      `The editor failed to load (${code}). ${desc || ""}`.trim());
  });
  win.webContents.on("render-process-gone", () => closeSplash());
  win.on("close", () => saveState(win));
  win.loadFile(path.join(ROOT, "index.html"));

  /* External links open in the real browser, never inside the app frame. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  return win;
}

/* ---------- native menu: the in-app menu bar stays, this adds OS integration ---------- */
function buildMenu() {
  const send = cmd => () => { if (mainWindow) mainWindow.webContents.send("graphene:command", cmd); };
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+Alt+N", click: send("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => openProject() },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
        { type: "separator" },
        { label: "Export SVG", click: send("export-svg") },
        { label: "Export PNG", click: send("export-png") },
        { label: "Export PDF…", accelerator: "CmdOrCtrl+Shift+P", click: send("export-pdf") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send("undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: send("redo") },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", click: send("cut") },
        { label: "Copy", accelerator: "CmdOrCtrl+C", click: send("copy") },
        { label: "Paste", accelerator: "CmdOrCtrl+V", click: send("paste") },
        { label: "Duplicate", accelerator: "CmdOrCtrl+D", click: send("duplicate") },
        { type: "separator" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", click: send("select-all") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: send("zoom-in") },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: send("zoom-out") },
        { label: "Zoom to Fit", accelerator: "CmdOrCtrl+0", click: send("zoom-fit") },
        { type: "separator" },
        { label: "Rulers", click: send("toggle-rulers") },
        { label: "Grid", click: send("toggle-grid") },
        { label: "Wireframe", click: send("toggle-outline") },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Keyboard Shortcuts", click: send("help") },
        {
          label: "About Graphene",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info", title: "About Graphene",
            message: `Graphene ${app.getVersion()}`,
            detail: "Professional vector graphics editor.\nBezier paths, mesh fills, boolean shaping, CMYK PDF export.",
            buttons: ["OK"],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* Native open dialog -> hand the file contents to the page. */
async function openProject() {
  if (!mainWindow) return;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "Open Graphene project",
    filters: [{ name: "Graphene project", extensions: ["json", "graphene"] }, { name: "All files", extensions: ["*"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths.length) return;
  try {
    const text = fs.readFileSync(r.filePaths[0], "utf8");
    mainWindow.webContents.send("graphene:open-project", text);
  } catch (e) {
    dialog.showErrorBox("Could not open file", e.message);
  }
}

/* Save a payload produced by the page to a real file. */
ipcMain.handle("graphene:save-file", async (_e, { data, defaultName, encoding }) => {
  if (!mainWindow) return { ok: false };
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName || "design" });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, encoding === "base64" ? Buffer.from(data, "base64") : data,
      encoding === "base64" ? undefined : "utf8");
    return { ok: true, path: r.filePath };
  } catch (e) {
    dialog.showErrorBox("Could not save file", e.message);
    return { ok: false, error: e.message };
  }
});

app.on("second-instance", () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.whenReady().then(() => {
  createSplash();                        // branded panel first
  createWindow();
  buildMenu();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => closeSplash());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
