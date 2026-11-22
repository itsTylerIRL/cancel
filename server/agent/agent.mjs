#!/usr/bin/env node
/* THE CANCEL IS COMING — hosted agent games.
   An agent plays over plain HTTP: it asks for a game, reads each screen as text, and sends one move at a time. The game
   itself runs here, in this server's own browser (the same page everyone plays, with tools/play/bridge.js on top), so the
   agent never holds the game or its score. When a run ends, the page posts it like any other, and this service passes
   it on to the API with a key only it knows: the board marks the run 🤖✓, verified.

     GET  /api/agent                          how to play (AGENTS.md)
     POST /api/agent/new?model=MODEL          a new game: its id, then the title screen
     GET  /api/agent/ID[?full=1]              the screen as it is
     POST /api/agent/ID/choose/N              pick choice [N]
     POST /api/agent/ID/move/n|s|e|w          one step on the map
     POST /api/agent/ID/go/X/Y                walk to an explored tile
     POST /api/agent/ID/callout               fight the next boss now
     POST /api/agent/ID/token/KIND/N          on the character screen: play as a real token
     POST /api/agent/ID/end                   close the game
   GET works for every one of these too, for agents that can only fetch URLs; add ?t=TURN (each screen says its turn) so
   a cached or repeated request can't make a move twice.

   Environment: CANCEL_AGENT_KEY (shared with the API), CANCEL_AGENT_PORT (8794), CANCEL_AGENT_MAX (games at once, 2),
   CANCEL_API (http://127.0.0.1:8787), CANCEL_GAME (https://cancel.tylerirl.com/), CANCEL_PUBLIC (this service's public
   base, https://cancel-api.tylerirl.com), BRIDGE and AGENTS_DOC (paths; default to the repo layout). */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = +(env.CANCEL_AGENT_PORT || 8794);
const MAX = +(env.CANCEL_AGENT_MAX || 2); // about 250 MB a game
const KEY = env.CANCEL_AGENT_KEY || "";
const API = (env.CANCEL_API || "http://127.0.0.1:8787").replace(/\/$/, "");
const API_PUBLIC = "https://cancel-api.tylerirl.com"; // what the game's page calls (API_DEFAULT in game.js)
const GAME = env.CANCEL_GAME || "https://cancel.tylerirl.com/";
const GAME_ORIGIN = new URL(GAME).origin;
const PUBLIC = (env.CANCEL_PUBLIC || API_PUBLIC).replace(/\/$/, "");
const BRIDGE = readFileSync(env.BRIDGE || join(HERE, "../../tools/play/bridge.js"), "utf8");
const DOC = () => { try { return readFileSync(env.AGENTS_DOC || join(HERE, "../../AGENTS.md"), "utf8"); } catch { return "see " + GAME; } };
// A game only holds a browser tab while someone is playing it. Idle for 10 minutes (or open for 3 hours) it is put away:
// its save goes to disk and the tab closes, and the next request for it opens it again where the run was last saved.
// Saves are kept for 3 days, so an agent can be as slow as it likes.
const IDLE_MS = +(env.CANCEL_AGENT_IDLE_MIN || 10) * 60e3, MAX_AGE_MS = 3 * 3600e3, KEEP_MS = 3 * 864e5, SNAP_MS = 2 * 60e3, NEW_PER_HOUR = 10, PER_IP = 2;
const SAVES = env.CANCEL_AGENT_SAVES || join(env.HOME || HERE, "saved");
mkdirSync(SAVES, { recursive: true });
const savePath = id => join(SAVES, id + ".json");
const RE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,39}$/; // as the API takes it (server.py RE_BOT)

/* ---------- one browser, one isolated context per game ---------- */
let browserP = null;
function browser() {
  if (!browserP) browserP = chromium.launch({
    headless: true, args: ["--mute-audio", "--disable-dev-shm-usage"],
    handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false, // our own handler saves every game before the browser goes
    env: { ...env, DBUS_SESSION_BUS_ADDRESS: "disabled:", DBUS_SYSTEM_BUS_ADDRESS: "disabled:" }, // Chromium aborts when it loses D-Bus
  }).then(b => { b.on("disconnected", () => { browserP = null; for (const g of games.values()) drop(g, "the browser restarted", false); }); return b; },
          e => { browserP = null; throw e; });
  return browserP;
}

// the game's files, fetched once and shared by every game (each context would otherwise download ~20 MB of art)
const files = new Map();
async function serveGameFile(route) {
  const req = route.request();
  if (req.method() !== "GET") return route.continue();
  const url = req.url(), hit = files.get(url);
  if (hit && hit.until > Date.now()) return route.fulfill({ status: 200, headers: hit.headers, body: hit.body });
  const res = await route.fetch();
  const body = await res.body();
  // versioned files and art never change under their name; the page itself and version.json are checked each minute
  if (res.status() === 200 && body.length < 8e6) files.set(url, { headers: res.headers(), body, until: Date.now() + (/[?&]v=|\/assets\//.test(url) ? 864e5 : 60e3) });
  return route.fulfill({ response: res, body });
}

// the page's calls to the API go straight to it here, as this model; a finished run goes with the key that verifies it
async function passToApi(route, g) {
  const req = route.request(), u = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: {
    "access-control-allow-origin": GAME_ORIGIN, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type", "access-control-max-age": "86400" } });
  const headers = { ...req.headers(), origin: GAME_ORIGIN, "x-real-ip": "agent:" + g.model };
  delete headers.host;
  let postData = req.postDataBuffer() || undefined;
  if (u.pathname === "/api/score" && req.method() === "POST") {
    if (KEY) headers["x-agent-key"] = KEY;
    try { const d = JSON.parse(postData.toString("utf8")); d.bot = g.model; postData = Buffer.from(JSON.stringify(d));
      console.log("game", g.id, "posted a run for", g.model + ":", d.win ? "won" : "lost", "on day", d.day, "·", d.score, "drip · turn", g.turn); } catch {} // the model this game was opened as
    g.posted = (g.posted || 0) + 1;
  }
  try {
    const res = await route.fetch({ url: API + u.pathname + u.search, headers, postData });
    return route.fulfill({ response: res, headers: { ...res.headers(), "access-control-allow-origin": GAME_ORIGIN } });
  } catch (e) { return route.abort(); }
}

/* ---------- games ---------- */
const games = new Map(); // id -> { id, model, ip, ctx, page, created, last, turn, chain }
const made = new Map();  // ip -> [times a game was opened]
const opening = new Map(); // id -> the promise of a saved game being opened again, so two requests don't open it twice

// the game's own save (it lives in the page's localStorage), written to disk
async function stash(g) {
  try {
    const st = await g.ctx.storageState();
    writeFileSync(savePath(g.id), JSON.stringify({ model: g.model, turn: g.turn, created: g.created,
      origins: st.origins.filter(o => o.origin === GAME_ORIGIN) }));
    g.stashed = Date.now();
  } catch (e) { /* the page is already gone: the last snapshot stands */ }
}
function readSave(id) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return null;
  try { return JSON.parse(readFileSync(savePath(id), "utf8")); } catch { return null; }
}
const putting = new Map(); // id -> a game being put away: a request for it waits until its save is on disk
function drop(g, why, keep = true) {
  if (!games.has(g.id)) return putting.get(g.id);
  games.delete(g.id); g.closed = why || "closed";
  const p = (async () => {
    if (keep) await stash(g); else if (why === "ended") { try { unlinkSync(savePath(g.id)); } catch {} }
    await g.ctx.close().catch(() => {});
  })().finally(() => putting.delete(g.id));
  putting.set(g.id, p);
  return p;
}
setInterval(() => {
  const now = Date.now();
  for (const g of games.values()) {
    if (now - g.last > IDLE_MS || now - g.opened > MAX_AGE_MS) { console.log("game", g.id, "put away at turn", g.turn); drop(g, "put away"); }
    else if (now - (g.stashed || g.opened) > SNAP_MS) stash(g); // a snapshot now and then, in case the service itself goes down
  }
  try { for (const f of readdirSync(SAVES)) if (now - statSync(join(SAVES, f)).mtimeMs > KEEP_MS) unlinkSync(join(SAVES, f)); } catch {}
  for (const [ip, ts] of made) { const left = ts.filter(t => now - t < 3600e3); left.length ? made.set(ip, left) : made.delete(ip); }
}, 30e3).unref();

async function open(model, ip, saved) {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: saved ? { cookies: [], origins: saved.origins || [] } : undefined });
  const g = { id: saved ? saved.id : randomBytes(12).toString("base64url"), model, ip, ctx, page: null, created: saved ? saved.created : Date.now(),
    opened: Date.now(), last: Date.now(), turn: saved ? saved.turn : 0, chain: Promise.resolve() };
  try {
    const pid = createHash("sha256").update("cancel-agent:" + KEY + ":" + model.toLowerCase()).digest("hex").slice(0, 16); // the same player every game, per model
    await ctx.addInitScript({ content: "window.__AGENT_CFG=" + JSON.stringify({ model, pid }) + ";\n" + BRIDGE });
    // a request still in flight when its game closes fails: that must not take the whole service down
    await ctx.route(GAME_ORIGIN + "/**", route => serveGameFile(route).catch(() => route.abort().catch(() => {})));
    await ctx.route(API_PUBLIC + "/**", route => passToApi(route, g).catch(() => route.abort().catch(() => {})));
    g.page = await ctx.newPage();
    g.page.on("crash", () => drop(g, "the page crashed", false));
    g.page.on("dialog", d => d.dismiss().catch(() => {}));
    await g.page.goto(GAME, { waitUntil: "load", timeout: 60e3 });
    await g.page.waitForFunction(() => window.AGENT && document.querySelector("#btn-start"), null, { timeout: 60e3 });
  } catch (e) { ctx.close().catch(() => {}); throw e; }
  games.set(g.id, g);
  if (!saved) stash(g);
  return g;
}

// one command at a time per game: a second request waits for the first
function run(g, fn) { const p = g.chain.then(fn); g.chain = p.catch(() => {}); return p; }

/* ---------- HTTP ---------- */
const text = (res, code, body) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }); res.end(body); };
const clientIp = req => req.headers["x-real-ip"] || req.socket.remoteAddress || "?";

// Every screen ends with how to answer it. Fetched by GET (an agent with only a URL fetcher, which may only open
// addresses it has been shown), it spells out the full address of every move it can make from here.
function frame(g, body, note, links) {
  const base = PUBLIC + "/api/agent/" + g.id, t = "?t=" + g.turn;
  let out = "game " + g.id + " · turn " + g.turn + " · model " + g.model + (note ? "\n" + note : "") + "\n\n" + body + "\n\n";
  if (!links) return out + "send (POST): " + base + "/choose/N · /move/n|s|e|w · /go/X/Y · /callout · GET " + base + " to look again\n";
  const L = [];
  for (const m of body.matchAll(/^\[(\d+)\] /gm)) L.push("[" + m[1] + "] " + base + "/choose/" + m[1] + t);
  if (/^ACTIONS: move/m.test(body)) {
    for (const d of ["n", "s", "e", "w"]) L.push("move " + d + ": " + base + "/move/" + d + t);
    for (const m of body.matchAll(/^\((\d+),(\d+)\) \d+ steps/gm)) L.push("go to (" + m[1] + "," + m[2] + "): " + base + "/go/" + m[1] + "/" + m[2] + t);
    for (const m of (body.match(/^UNEXPLORED EDGES.*$/m) || [""])[0].matchAll(/\((\d+),(\d+)\)/g)) L.push("explore (" + m[1] + "," + m[2] + "): " + base + "/go/" + m[1] + "/" + m[2] + t);
    if (/next boss/.test(body)) L.push("call out the next boss: " + base + "/callout" + t);
  }
  L.push("look again: " + base + t + " · more detail: " + base + t + "&full=1");
  return out + "LINKS (fetch one to make that move):\n" + L.join("\n") + "\n";
}

const ACTS = {
  choose: ([n]) => /^\d{1,2}$/.test(n) && ["choose", +n],
  move: ([d]) => /^(n|s|e|w)$/i.test(d) && ["move", d.toLowerCase()],
  go: ([x, y]) => /^\d{1,2}$/.test(x) && /^\d{1,2}$/.test(y) && ["go", +x, +y],
  callout: () => ["callout"],
  token: ([k, n]) => /^[a-z]{1,12}$/.test(k) && /^\d{1,4}$/.test(n || "0") && ["token", k, +(n || 0)],
};

async function handle(req, res) {
  const u = new URL(req.url, "http://x"), parts = u.pathname.replace(/\/+$/, "").split("/").slice(1); // ["api","agent",...]
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Content-Type" }); return res.end(); }
  if (parts[0] !== "api" || parts[1] !== "agent") return text(res, 404, "not found\n");
  if (!["GET", "POST", "DELETE"].includes(req.method)) return text(res, 405, "GET or POST\n");
  const rest = parts.slice(2);

  if (!rest.length) return text(res, 200, "live: " + games.size + " of " + MAX + " games running\n\n" + DOC());

  if (rest[0] === "new") {
    const model = (u.searchParams.get("model") || "").trim(), ip = clientIp(req);
    if (!RE_MODEL.test(model)) return text(res, 400, "say which model is playing: /api/agent/new?model=<your model id> (letters, digits, . _ : / - and spaces, up to 40)\n");
    if (games.size >= MAX) return text(res, 503, "all " + MAX + " games are taken. Try again in a few minutes (idle games close after 10).\n");
    if ([...games.values()].filter(g => g.ip === ip).length >= PER_IP) return text(res, 429, "you already have " + PER_IP + " games open. End one first: /api/agent/ID/end\n");
    const ts = made.get(ip) || [];
    if (ts.length >= NEW_PER_HOUR) return text(res, 429, "that's " + NEW_PER_HOUR + " new games this hour. Try again later.\n");
    made.set(ip, ts.concat(Date.now()));
    let g;
    try { g = await open(model, ip); } catch (e) { console.error("open failed:", e.message); return text(res, 503, "the game didn't load. Try again in a minute.\n"); }
    console.log("game", g.id, "opened for", model, "(" + games.size + "/" + MAX + ")");
    const body = await run(g, () => g.page.evaluate(() => window.AGENT.look()));
    return text(res, 200, frame(g, body, "a new game. Its id is in every address below; keep it. It is saved as you go, so take as long as you need between moves. Read " + PUBLIC + "/api/agent for the rules and the map legend.", req.method === "GET"));
  }

  if (putting.has(rest[0])) await putting.get(rest[0]);
  let g = games.get(rest[0]), note = "";
  const links = req.method === "GET";
  if (!g) {
    const saved = readSave(rest[0]);
    if (!saved) return text(res, 404, "no game " + rest[0] + " (games are kept 3 days after their last move). Start one: " + PUBLIC + "/api/agent/new?model=<your model id>\n");
    if (rest[1] === "end") { try { unlinkSync(savePath(rest[0])); } catch {} return text(res, 200, "game " + rest[0] + " closed\n"); }
    if (games.size >= MAX) return text(res, 503, "your game is saved, but all " + MAX + " game slots are in use right now. Try the same address again in a few minutes.\n");
    try { g = await (opening.get(rest[0]) || opening.set(rest[0], open(saved.model, clientIp(req), { ...saved, id: rest[0] }).finally(() => opening.delete(rest[0]))).get(rest[0])); }
    catch (e) { console.error("reopen failed:", e.message); return text(res, 503, "your game is saved, but it didn't reopen. Try again in a minute.\n"); }
    // straight back into the run, as a player pressing CONTINUE would
    const back = await run(g, () => g.page.evaluate(async () => { const b = document.getElementById("btn-continue");
      if (!b || b.classList.contains("hidden") || b.offsetParent === null) return false; b.click(); await window.AGENT.settle(); return true; })).catch(() => false);
    console.log("game", g.id, "picked up again at turn", g.turn, back ? "in its run" : "at the title", "(" + games.size + "/" + MAX + ")");
    note = back ? "this game had been put away while you were away, and has been opened again: the run carries on from its last save (anything after that, such as a mint left open, may be gone)."
      : "this game had been put away while you were away, and has been opened again. No run was in progress: you're at the title screen.";
    if (rest[1] && rest[1] !== "look") { // the move was meant for the screen before it was put away: show the screen as it is now instead
      const body = await run(g, () => g.page.evaluate(() => window.AGENT.look()));
      return text(res, 200, frame(g, body, note + " Your last request was not carried out: look, then move again.", links));
    }
  }
  g.last = Date.now();
  const [verb, ...args] = rest.slice(1);
  if (verb === "end" || req.method === "DELETE") { await drop(g, "ended", false); console.log("game", g.id, "ended"); return text(res, 200, "game " + g.id + " closed\n"); }

  const t = u.searchParams.get("t");
  if (!verb || verb === "look") {
    const body = await run(g, () => g.page.evaluate(full => window.AGENT.look({ full }), u.searchParams.get("full") === "1"));
    return text(res, 200, frame(g, body, note, links));
  }
  const act = ACTS[verb] && ACTS[verb](args);
  if (!act) return text(res, 400, "unknown command. Commands: choose/N, move/n|s|e|w, go/X/Y, callout, token/KIND/N, end\n");
  if (req.method === "GET" && t === null) return text(res, 400, "a move by GET needs the turn it answers: add ?t=" + g.turn + " (POST doesn't)\n");
  try {
    const out = await run(g, async () => {
      if (t !== null && +t !== g.turn) return { stale: true, body: await g.page.evaluate(() => window.AGENT.look()) };
      g.turn++;
      return { body: await g.page.evaluate(([fn, a]) => window.AGENT[fn](...a), [act[0], act.slice(1)]) };
    });
    if (out.stale) return text(res, 409, frame(g, out.body, "that move was for turn " + t + ", and this game is on turn " + g.turn + ": nothing was done. Here is the screen now.", links));
    if (g.turn % 50 === 0) console.log("game", g.id, "turn", g.turn);
    return text(res, 200, frame(g, out.body, "", links));
  } catch (e) {
    if (g.closed) return text(res, 410, "game " + g.id + " is gone: " + g.closed + "\n");
    console.error("game", g.id, verb, e.message);
    return text(res, 500, "that didn't work: " + e.message.split("\n")[0] + "\n");
  }
}

createServer((req, res) => { handle(req, res).catch(e => { console.error(e); try { text(res, 500, "error\n"); } catch {} }); })
  .listen(PORT, "127.0.0.1", () => console.log("cancel-agent on 127.0.0.1:" + PORT + ", up to " + MAX + " games, game " + GAME + ", api " + API + (KEY ? "" : " (no CANCEL_AGENT_KEY: runs won't be verified)")));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, async () => { // a restart puts every game away first
  try { await Promise.all([...games.values()].map(g => stash(g))); const b = browserP && await browserP; b && await b.close(); } catch {} process.exit(0); });
process.on("unhandledRejection", e => console.error("unhandled:", e && e.message || e)); // logged; one game's trouble doesn't end the others
