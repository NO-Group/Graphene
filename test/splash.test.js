/* splash.test.js — the launch screen.
   A splash covers the entire viewport, so the one unacceptable failure is
   leaving it up. These tests drive every path that must retire it, including
   the ones that only happen when boot goes wrong. */
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/boot.js");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(56)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const state = win => {
  const e = win.document.getElementById("splash");
  return !e ? "removed" : e.hasAttribute("hidden") ? "hidden" : "visible";
};

(async () => {
  console.log("— markup —");
  {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    t("splash markup is inline in index.html", html.includes('id="splash"'));
    const bodyAt = html.indexOf("<body>");
    const splashAt = html.indexOf('id="splash"');
    const firstScript = html.indexOf("<script");
    t("  …before the first script, so it paints first", splashAt > bodyAt && splashAt < firstScript,
      `body@${bodyAt} splash@${splashAt} script@${firstScript}`);
    t("splash.js loads before the app modules",
      html.indexOf("js/splash.js") < html.indexOf("js/core.js"));
    t("the app signals readiness", /splashReady\s*\(\s*\)/.test(html));
    t("it is announced to assistive tech", /id="splash"[^>]*role="status"/.test(html) || /role="status"[^>]*id="splash"/.test(html));

    const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");
    t("splash is styled", css.includes("#splash"));
    t("  …covers the viewport", /#splash\s*\{[^}]*position:\s*fixed/.test(css));
    t("  …sits above the app", /#splash\s*\{[^}]*z-index:\s*\d{3,}/.test(css));
    t("reduced motion is honoured", /prefers-reduced-motion[\s\S]{0,400}splash|splash[\s\S]{0,400}prefers-reduced-motion/.test(css));

    t("the service worker precaches splash.js",
      fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes("./js/splash.js"));
  }

  console.log("— it appears, then retires —");
  {
    const { win, App, errors } = boot();
    t("splash is present when the app boots", state(win) === "visible", state(win));
    t("  …and the app itself booted cleanly", !!App && errors.length === 0, errors[0]);
    win.eval("splashReady")();
    await wait(900);
    t("splashReady retires it", state(win) === "removed", state(win));
  }

  console.log("— every failure path still retires it —");
  {
    const { win } = boot();
    win.dispatchEvent(new win.Event("load"));
    await wait(700);
    t("the load event retires it even without splashReady", state(win) === "removed", state(win));
  }
  {
    const { win } = boot();
    win.dispatchEvent(new win.ErrorEvent("error", { message: "simulated boot failure" }));
    await wait(150);
    t("a runtime error retires it immediately", state(win) === "removed", state(win));
  }
  {
    const { win } = boot();
    win.dispatchEvent(new win.Event("unhandledrejection"));
    await wait(150);
    t("an unhandled rejection retires it", state(win) === "removed", state(win));
  }
  {
    const { win } = boot();
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
    await wait(150);
    t("Escape dismisses it", state(win) === "removed", state(win));
  }

  console.log("— it cannot break the app —");
  {
    const { win } = boot();
    let threw = null;
    try { win.eval("hideSplash")(true); win.eval("hideSplash")(true); win.eval("hideSplash")(); }
    catch (e) { threw = e.message; }
    t("hideSplash is idempotent", !threw, threw);
  }
  {
    const { win } = boot();
    let threw = null;
    try { win.eval("splashReady")(); win.eval("splashReady")(); } catch (e) { threw = e.message; }
    await wait(800);
    t("splashReady is safe to call twice", !threw && state(win) === "removed", threw || state(win));
  }
  {
    const { win, g } = boot();
    win.eval("hideSplash")(true);
    const App = g("App");
    g("runCommand")("select-all");
    t("the app is interactive once the splash is gone", App.selection.length > 0, App.selection.length);
  }
  {
    /* the status line is a real element the app can drive */
    const { win } = boot();
    win.eval("splashStatus")("Loading modules");
    const el = win.document.getElementById("splash-status");
    t("splashStatus updates the visible text", el && el.textContent === "Loading modules", el && el.textContent);
    let threw = null;
    try { win.eval("splashStatus")(null); win.eval("splashStatus")(""); } catch (e) { threw = e.message; }
    t("  …and ignores empty input rather than blanking", !threw && el.textContent === "Loading modules", threw || el.textContent);
  }

  console.log("— desktop splash window —");
  {
    const html = fs.readFileSync(path.join(ROOT, "desktop", "splash.html"), "utf8");
    const { JSDOM } = require("jsdom");
    const d = new JSDOM(html).window.document;
    t("desktop/splash.html parses", !!d.documentElement);
    t("  …shows the product name", (d.querySelector("h1") || {}).textContent === "Graphene");
    t("  …has the folded-corner artwork", !!d.querySelector("svg.fold"));
    t("  …has a version slot", !!d.querySelector("#ver"));
    t("  …locks itself down with a CSP", !!d.querySelector('meta[http-equiv="Content-Security-Policy"]'));
    t("  …does not require node", !/require\(/.test(html));

    const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
    t("the shell creates a splash window", /createSplash\s*\(/.test(main));
    t("  …frameless and transparent", /frame:\s*false/.test(main) && /transparent:\s*true/.test(main));
    t("  …sandboxed like the main window", /createSplash[\s\S]{0,900}sandbox:\s*true/.test(main));
    t("  …closed when the editor is ready", /ready-to-show[\s\S]{0,120}closeSplash/.test(main));
    t("  …closed if the page fails to load", /did-fail-load[\s\S]{0,200}closeSplash/.test(main));
    t("  …closed if the renderer crashes", /render-process-gone[\s\S]{0,120}closeSplash/.test(main));
    t("  …closed on quit", /before-quit[\s\S]{0,80}closeSplash/.test(main));
    t("  …has a watchdog so it cannot be orphaned", /setTimeout\(closeSplash/.test(main));
    t("closeSplash tolerates an already-destroyed window", /isDestroyed\(\)[\s\S]{0,60}close\(\)/.test(main));

    const pre = fs.readFileSync(path.join(ROOT, "desktop", "preload.js"), "utf8");
    t("the real app version reaches the renderer", /--app-version=/.test(pre) && /--app-version=/.test(main));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
