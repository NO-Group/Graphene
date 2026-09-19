/* ============================================================
   splash.js — launch screen controller.

   The splash covers the whole viewport, so the one unacceptable
   outcome is leaving it up. Every path here is defensive:

     - a hard watchdog hides it after SPLASH_MAX_MS no matter what
     - an error during boot hides it immediately rather than
       trapping the user behind a frozen panel
     - hide() is idempotent and safe to call before DOMContentLoaded
     - it reports the real version, read from the manifest

   It also honours prefers-reduced-motion by skipping the fade.
   ============================================================ */

const SPLASH_MIN_MS = 450;    // avoid a jarring flash on a fast load
const SPLASH_MAX_MS = 6000;   // hard ceiling: never outlive this

let _splashShownAt = Date.now();
let _splashDone = false;
let _splashTimer = null;

function splashEl() {
  return (typeof document !== "undefined") ? document.getElementById("splash") : null;
}

/* Update the status line while modules come up. */
function splashStatus(text) {
  const el = (typeof document !== "undefined") ? document.getElementById("splash-status") : null;
  if (el && typeof text === "string" && text) el.textContent = text;
}

/* Hide the splash. Idempotent; safe to call at any point, including
   before the element exists. `immediate` skips the fade. */
function hideSplash(immediate) {
  if (_splashDone) return;
  _splashDone = true;
  if (_splashTimer) { clearTimeout(_splashTimer); _splashTimer = null; }

  const el = splashEl();
  if (!el) return;                       // nothing to hide: still "done"

  const reduce = typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const remove = () => {
    try {
      el.setAttribute("hidden", "");
      el.classList.remove("is-hiding");
      if (el.parentNode) el.parentNode.removeChild(el);   // free the layer entirely
      document.documentElement.classList.add("splash-done");
    } catch (e) { /* the DOM is gone; nothing to do */ }
  };

  if (immediate || reduce) { remove(); return; }
  try {
    el.classList.add("is-hiding");
    let fired = false;
    const once = () => { if (!fired) { fired = true; remove(); } };
    el.addEventListener("transitionend", once, { once: true });
    setTimeout(once, 420);               // transitionend can be skipped when hidden
  } catch (e) { remove(); }
}

/* Called by the app once it has rendered. Enforces the minimum
   on-screen time so the splash never strobes. */
function splashReady() {
  const waited = Date.now() - _splashShownAt;
  const rest = Math.max(0, SPLASH_MIN_MS - waited);
  if (rest === 0) hideSplash();
  else setTimeout(() => hideSplash(), rest);
}

/* Show the real version rather than a hardcoded string. */
function splashVersion() {
  const el = (typeof document !== "undefined") ? document.getElementById("splash-ver") : null;
  if (!el) return;
  /* the desktop shell knows its own version; the web build reads the manifest */
  if (typeof window !== "undefined" && window.graphene && window.graphene.version) {
    el.textContent = window.graphene.version;
    return;
  }
  if (typeof fetch !== "function") return;
  fetch("manifest.json", { cache: "no-store" })
    .then(r => (r && r.ok ? r.json() : null))
    .then(m => { if (m && m.version) el.textContent = String(m.version); })
    .catch(() => { /* offline or file:// - leave the inline default */ });
}

/* ---- wiring ------------------------------------------------ */
if (typeof window !== "undefined") {
  /* Watchdog first, so a throw anywhere below still gets cleaned up. */
  _splashTimer = setTimeout(() => hideSplash(true), SPLASH_MAX_MS);

  /* A boot error must not leave the panel covering the editor. */
  window.addEventListener("error", () => hideSplash(true));
  window.addEventListener("unhandledrejection", () => hideSplash(true));

  /* Escape/click dismisses it — never trap the user. */
  window.addEventListener("keydown", e => { if (e.key === "Escape") hideSplash(true); });
  document.addEventListener("click", e => {
    const el = splashEl();
    if (el && !el.hasAttribute("hidden") && el.contains(e.target)) hideSplash();
  });

  const start = () => {
    splashVersion();
    /* If the app never calls splashReady (an old build, or a module failed to
       define it), the load event still clears the splash. */
    window.addEventListener("load", () => setTimeout(() => hideSplash(), 200));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
