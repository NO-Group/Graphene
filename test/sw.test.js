/* sw.test.js — service worker behaviour.
   The SW is plain JS with no DOM dependency, so it runs in a vm with fake
   caches/fetch. Regression target: a single failed request used to overwrite a
   good cached asset, permanently breaking offline use. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(52)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};

function makeSW() {
  const listeners = {};
  const cacheStore = new Map();
  class FakeCache {
    constructor() { this.m = new Map(); }
    async addAll(urls) {
      for (const u of urls) {
        const rel = u.replace(/^\.\//, "");
        if (rel && !fs.existsSync(path.join(ROOT, rel))) throw new Error("addAll: missing " + u);
        this.m.set(u, { url: u, body: "cached " + u, status: 200, ok: true, type: "basic", clone() { return this; } });
      }
    }
    async put(req, res) { this.m.set(typeof req === "string" ? req : req.url, res); }
    async match(req) { return this.m.get(typeof req === "string" ? req : req.url); }
  }
  const caches = {
    async open(n) { if (!cacheStore.has(n)) cacheStore.set(n, new FakeCache()); return cacheStore.get(n); },
    async keys() { return [...cacheStore.keys()]; },
    async delete(k) { return cacheStore.delete(k); },
    async match(req) { for (const c of cacheStore.values()) { const r = await c.match(req); if (r) return r; } },
  };
  const state = { mode: "online" };
  async function fetchFn(req) {
    const url = typeof req === "string" ? req : req.url;
    if (state.mode === "offline") throw new Error("network down");
    if (state.mode === "error500") return { url, status: 500, ok: false, type: "basic", body: "SERVER ERROR PAGE", clone() { return this; } };
    if (state.mode === "captive") return { url, status: 200, ok: true, type: "opaque", body: "LOGIN PORTAL", clone() { return this; } };
    return { url, status: 200, ok: true, type: "basic", body: "fresh " + url, clone() { return this; } };
  }
  const ctx = {
    self: {
      addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); },
      skipWaiting: async () => {}, clients: { claim: async () => {} },
      location: { origin: "http://localhost:8000" },
    },
    caches, fetch: fetchFn, console, URL,
    Response: class { constructor(b, i) { this.body = b; Object.assign(this, i || {}); } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), ctx);

  return {
    listeners, caches, state, cacheStore,
    async install() {
      let ok = true, err = "";
      await new Promise(res => listeners.install[0]({ waitUntil: p => p.then(() => res()).catch(e => { ok = false; err = e.message; res(); }) }));
      return { ok, err };
    },
    async get(url, opts = {}) {
      const request = {
        url, method: opts.method || "GET",
        mode: opts.mode || (/\.html$|\/$/.test(url) ? "navigate" : "cors"),
        headers: { get: k => (opts.headers || {})[k] || null },
      };
      let captured = null;
      listeners.fetch[0]({ request, respondWith: p => { captured = p; } });
      if (captured === null) return { declined: true };
      try { const r = await captured; return r || { undefinedResponse: true }; }
      catch (e) { return { rejected: e.message }; }
    },
  };
}

(async () => {
  console.log("— install —");
  {
    const sw = makeSW();
    const r = await sw.install();
    t("installs and precaches every listed asset", r.ok, r.err);
    const listed = (fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").match(/"\.\/[^"]*"/g) || [])
      .map(s => s.slice(3, -1)).filter(Boolean);
    const missing = listed.filter(f => !fs.existsSync(path.join(ROOT, f)));
    t("no precached asset is missing from disk", missing.length === 0, missing.join(", "));
    const loaded = (fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(/src="(js\/[^"]+)"/g) || [])
      .map(s => s.slice(5, -1));
    const uncached = loaded.filter(f => !listed.includes(f));
    t("every script index.html loads is precached", uncached.length === 0, uncached.join(", "));
  }

  console.log("\n— offline —");
  {
    const sw = makeSW();
    await sw.install();
    sw.state.mode = "offline";
    const shell = await sw.get("./index.html");
    t("serves the app shell offline", shell.status === 200, JSON.stringify(shell).slice(0, 60));
    const js = await sw.get("./js/core.js");
    t("serves precached scripts offline", js.status === 200, JSON.stringify(js).slice(0, 60));
    const missing = await sw.get("./not-a-real-file.js");
    t("an uncached script 404s rather than returning HTML",
      missing.status === 504 || String(missing.body || "").indexOf("<") !== 0,
      JSON.stringify(missing).slice(0, 60));
  }

  console.log("\n— the cache must not be poisoned —");
  {
    const sw = makeSW();
    await sw.install();
    await sw.get("./index.html");                       // warm it with a good copy
    sw.state.mode = "error500";
    const bad = await sw.get("./index.html");
    t("a 500 is passed through to the page", bad.status === 500);
    const c = await sw.caches.open("graphene-v6");
    const held = await c.match("./index.html");
    t("a 500 response is NOT written to the cache",
      held && !String(held.body).includes("SERVER ERROR"), held && String(held.body).slice(0, 40));
    sw.state.mode = "offline";
    const after = await sw.get("./index.html");
    t("the good copy still serves after a failed request",
      after.status === 200 && !String(after.body).includes("SERVER ERROR"), JSON.stringify(after).slice(0, 60));
  }
  {
    const sw = makeSW();
    await sw.install();
    await sw.get("./index.html");
    sw.state.mode = "captive";
    await sw.get("./index.html");                       // captive portal interception
    const c = await sw.caches.open("graphene-v6");
    const held = await c.match("./index.html");
    t("an opaque response is NOT written to the cache",
      held && !String(held.body).includes("LOGIN PORTAL"), held && String(held.body).slice(0, 40));
  }

  console.log("\n— request filtering —");
  {
    const sw = makeSW();
    await sw.install();
    t("non-GET requests are left alone", (await sw.get("./index.html", { method: "POST" })).declined === true);
    t("cross-origin requests are left alone", (await sw.get("https://example.com/x.js")).declined === true);
    t("range requests are left alone", (await sw.get("./big.mp4", { headers: { range: "bytes=0-99" } })).declined === true);
  }

  console.log("\n— activation —");
  {
    const sw = makeSW();
    await sw.install();
    await sw.caches.open("graphene-v1");                // a stale cache from an old version
    await new Promise(res => sw.listeners.activate[0]({ waitUntil: p => p.then(res).catch(res) }));
    const keys = await sw.caches.keys();
    t("stale caches are deleted on activate", !keys.includes("graphene-v1"), keys.join(", "));
    t("the current cache survives activate", keys.some(k => /graphene-v\d+/.test(k)), keys.join(", "));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
