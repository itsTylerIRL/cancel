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

   Environment: CANCEL_AGENT_KEY (shared with the API), CANCEL_AGENT_PORT (8794), CANCEL_AGENT_MAX (games at once, 4),
   CANCEL_API (http://127.0.0.1:8787), CANCEL_GAME (https://cancel.tylerirl.com/), CANCEL_PUBLIC (this service's public
   base, https://cancel-api.tylerirl.com), BRIDGE and AGENTS_DOC (paths; default to the repo layout). */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = +(env.CANCEL_AGENT_PORT || 8794);
const MAX = +(env.CANCEL_AGENT_MAX || 4);
const KEY = env.CANCEL_AGENT_KEY || "";
const API = (env.CANCEL_API || "http://127.0.0.1:8787").replace(/\/$/, "");
const API_PUBLIC = "https://cancel-api.tylerirl.com"; // what the game's page calls (API_DEFAULT in game.js)
const GAME = env.CANCEL_GAME || "https://cancel.tylerirl.com/";
const GAME_ORIGIN = new URL(GAME).origin;
const PUBLIC = (env.CANCEL_PUBLIC || API_PUBLIC).replace(/\/$/, "");
const BRIDGE = readFileSync(env.BRIDGE || join(HERE, "../../tools/play/bridge.js"), "utf8");
const DOC = () => { try { return readFileSync(env.AGENTS_DOC || join(HERE, "../../AGENTS.md"), "utf8"); } catch { return "see " + GAME; } };
const IDLE_MS = 10 * 60e3, MAX_AGE_MS = 3 * 3600e3, NEW_PER_HOUR = 10, PER_IP = 2;
const RE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,39}$/; // as the API takes it (server.py RE_BOT)

/* ---------- one browser, one isolated context per game ---------- */
let browserP = null;
function browser() {
  if (!browserP) browserP = chromium.launch({
    headless: true, args: ["--mute-audio", "--disable-dev-shm-usage"],
    env: { ...env, DBUS_SESSION_BUS_ADDRESS: "disabled:", DBUS_SYSTEM_BUS_ADDRESS: "disabled:" }, // Chromium aborts when it loses D-Bus
  }).then(b => { b.on("disconnected", () => { browserP = null; for (const g of games.values()) drop(g, "the browser restarted"); }); return b; },
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
    try { const d = JSON.parse(postData.toString("utf8")); d.bot = g.model; postData = Buffer.from(JSON.stringify(d)); } catch {} // the model this game was opened as
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

function drop(g, why) {
  if (!games.has(g.id)) return;
  games.delete(g.id); g.closed = why || "closed";
  g.ctx.close().catch(() => {});
}
setInterval(() => {
  const now = Date.now();
  for (const g of games.values()) if (now - g.last > IDLE_MS || now - g.created > MAX_AGE_MS) drop(g, now - g.last > IDLE_MS ? "idle for 10 minutes" : "open for 3 hours");
  for (const [ip, ts] of made) { const left = ts.filter(t => now - t < 3600e3); left.length ? made.set(ip, left) : made.delete(ip); }
}, 30e3).unref();

async function open(model, ip) {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const g = { id: randomBytes(12).toString("base64url"), model, ip, ctx, page: null, created: Date.now(), last: Date.now(), turn: 0, chain: Promise.resolve() };
  try {
    const pid = createHash("sha256").update("cancel-agent:" + KEY + ":" + model.toLowerCase()).digest("hex").slice(0, 16); // the same player every game, per model
    await ctx.addInitScript({ content: "window.__AGENT_CFG=" + JSON.stringify({ model, pid }) + ";\n" + BRIDGE });
    await ctx.route(GAME_ORIGIN + "/**", serveGameFile);
    await ctx.route(API_PUBLIC + "/**", route => passToApi(route, g));
    g.page = await ctx.newPage();
    g.page.on("crash", () => drop(g, "the page crashed"));
    g.page.on("dialog", d => d.dismiss().catch(() => {}));
    await g.page.goto(GAME, { waitUntil: "load", timeout: 60e3 });
    await g.page.waitForFunction(() => window.AGENT && document.querySelector("#btn-start"), null, { timeout: 60e3 });
  } catch (e) { ctx.close().catch(() => {}); throw e; }
  games.set(g.id, g);
  return g;
}

// one command at a time per game: a second request waits for the first
function run(g, fn) { const p = g.chain.then(fn); g.chain = p.catch(() => {}); return p; }

/* ---------- HTTP ---------- */
const text = (res, code, body) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }); res.end(body); };
const clientIp = req => req.headers["x-real-ip"] || req.socket.remoteAddress || "?";

function frame(g, body, note) {
  const base = PUBLIC + "/api/agent/" + g.id;
  return "game " + g.id + " · turn " + g.turn + " · model " + g.model + (note ? "\n" + note : "") + "\n\n" + body + "\n\n"
    + "send (POST, or GET with the turn): " + base + "/choose/N?t=" + g.turn + " · /move/n|s|e|w · /go/X/Y · /callout · " + base + "?t=" + g.turn + " to look again\n";
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
    return text(res, 200, frame(g, body, "a new game. Its id is in every address below; keep it. Read " + PUBLIC + "/api/agent for the rules and the map legend."));
  }

  const g = games.get(rest[0]);
  if (!g) return text(res, 404, "no game " + rest[0] + " (finished games close after 10 idle minutes). Start one: POST " + PUBLIC + "/api/agent/new?model=<your model id>\n");
  g.last = Date.now();
  const [verb, ...args] = rest.slice(1);
  if (verb === "end" || req.method === "DELETE") { drop(g, "ended"); console.log("game", g.id, "ended"); return text(res, 200, "game " + g.id + " closed\n"); }

  const t = u.searchParams.get("t");
  if (!verb || verb === "look") {
    const body = await run(g, () => g.page.evaluate(full => window.AGENT.look({ full }), u.searchParams.get("full") === "1"));
    return text(res, 200, frame(g, body));
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
    if (out.stale) return text(res, 409, frame(g, out.body, "that move was for turn " + t + ", and this game is on turn " + g.turn + ": nothing was done. Here is the screen now."));
    return text(res, 200, frame(g, out.body));
  } catch (e) {
    if (g.closed) return text(res, 410, "game " + g.id + " is gone: " + g.closed + "\n");
    console.error("game", g.id, verb, e.message);
    return text(res, 500, "that didn't work: " + e.message.split("\n")[0] + "\n");
  }
}

createServer((req, res) => { handle(req, res).catch(e => { console.error(e); try { text(res, 500, "error\n"); } catch {} }); })
  .listen(PORT, "127.0.0.1", () => console.log("cancel-agent on 127.0.0.1:" + PORT + ", up to " + MAX + " games, game " + GAME + ", api " + API + (KEY ? "" : " (no CANCEL_AGENT_KEY: runs won't be verified)")));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, async () => { try { const b = browserP && await browserP; b && await b.close(); } catch {} process.exit(0); });
