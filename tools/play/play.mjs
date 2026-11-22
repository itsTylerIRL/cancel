#!/usr/bin/env node
/* tools/play: play THE CANCEL IS COMING from a terminal, one short text command at a time.
   Made for tool-calling agents: every command prints a plain-text description of the screen and its numbered
   choices, so no screenshots and no clicking around a browser. See AGENTS.md.

     node tools/play/play.mjs start [--model NAME] [--local] [--headed] [--url URL]
     node tools/play/play.mjs look [full]
     node tools/play/play.mjs choose N
     node tools/play/play.mjs move n|s|e|w
     node tools/play/play.mjs go X Y
     node tools/play/play.mjs callout
     node tools/play/play.mjs token KIND ID     (character screen: play as milady/remilio/... #ID)
     node tools/play/play.mjs shot [file.png]   (a screenshot, for a human debugging the bridge)
     node tools/play/play.mjs stop

   `start` leaves a browser running in the background (its own profile per model, so each model is one player with
   one daily attempt), and every other command attaches to it, acts, waits for the game to settle and prints. */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, createReadStream, openSync } from "node:fs";
import { join, dirname, extname, resolve, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const STATE_DIR = process.env.CANCEL_PLAY_HOME || join(homedir(), ".cache", "cancel-play");
const STATE = join(STATE_DIR, "daemon.json"), LOG = join(STATE_DIR, "daemon.log");
const PORT = +(process.env.CANCEL_PLAY_PORT || 9333);
const LIVE = "https://cancel.tylerirl.com/";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf("--" + name); if (i < 0) return dflt; const v = rest[i + 1]; return v && !v.startsWith("--") ? v : true; };
const readState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const die = msg => { console.error(msg); process.exit(1); };

// --- the daemon: a browser with the bridge in every page, and (with --local) a static server for this checkout ---
async function daemon() {
  const cfg = JSON.parse(process.env.CANCEL_PLAY_CFG);
  let url = cfg.url;
  if (cfg.local) {
    const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".webmanifest": "application/manifest+json" };
    const srv = createServer((req, res) => {
      const p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
      const f = p.endsWith(sep) ? join(p, "index.html") : p;
      if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": MIME[extname(f)] || "application/octet-stream" }); createReadStream(f).pipe(res);
    });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    url = "http://127.0.0.1:" + srv.address().port + "/";
  }
  const profile = join(STATE_DIR, "profile-" + String(cfg.model || "agent").replace(/[^A-Za-z0-9._-]/g, "_"));
  // no D-Bus: a detached browser loses its session bus connection and Chromium aborts on that (FATAL bus.cc)
  const opts = { headless: !cfg.headed, viewport: { width: 1280, height: 900 }, args: ["--remote-debugging-port=" + PORT, "--mute-audio"],
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "disabled:", DBUS_SYSTEM_BUS_ADDRESS: "disabled:" } };
  let ctx;
  try { ctx = await chromium.launchPersistentContext(profile, opts); }
  catch (e) { ctx = await chromium.launchPersistentContext(profile, { ...opts, channel: "chrome" }); } // no Playwright Chromium here: the installed Chrome
  await ctx.addInitScript({ content: "window.__AGENT_CFG=" + JSON.stringify({ model: cfg.model || "" }) + ";\n" + readFileSync(join(HERE, "bridge.js"), "utf8") });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.AGENT && document.querySelector("#btn-start"), null, { timeout: 60000 });
  writeFileSync(STATE, JSON.stringify({ pid: process.pid, port: PORT, url, model: cfg.model || "", local: !!cfg.local }));
  ctx.on("close", () => process.exit(0));
}

async function attach() {
  const st = readState();
  if (!st || !alive(st.pid)) die((st ? "the game's browser has stopped (log: " + LOG + "). " : "") + "no game running: start one with `node tools/play/play.mjs start --model <your model id>`");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:" + st.port);
  const page = browser.contexts()[0].pages().find(p => !p.url().startsWith("about:")) || browser.contexts()[0].pages()[0];
  return { browser, page, st };
}
async function call(fn, ...args) {
  const { page } = await attach();
  const out = await page.evaluate(([fn, args]) => window.AGENT[fn](...args), [fn, args]);
  console.log(out);
  process.exit(0);
}

async function main() {
  switch (cmd) {
    case "__daemon": return daemon();
    case "start": {
      const st = readState();
      if (st && alive(st.pid)) { console.log("already running (" + (st.model || "no model named") + ", " + st.url + "). `stop` first to start over.\n"); return call("look"); }
      const model = flag("model", process.env.CANCEL_MODEL || "");
      if (!model || model === true) console.error("note: no --model given. Runs will be tagged 🤖 without a model name. Pass --model <your model id>.");
      mkdirSync(STATE_DIR, { recursive: true }); rmSync(STATE, { force: true });
      const cfg = { model: model === true ? "" : model, local: !!flag("local"), headed: !!flag("headed"), url: flag("url", LIVE) };
      const log = openSync(LOG, "w"), err = () => readFileSync(LOG, "utf8").split("\n").filter(l => !/Fontconfig/.test(l)).slice(-15).join("\n");
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "__daemon"], {
        detached: true, stdio: ["ignore", log, log], env: { ...process.env, CANCEL_PLAY_CFG: JSON.stringify(cfg) } });
      child.unref();
      for (let i = 0; i < 300 && !existsSync(STATE); i++) {
        if (child.exitCode !== null) die("the browser didn't start:\n" + err());
        await new Promise(r => setTimeout(r, 200));
      }
      if (!existsSync(STATE)) { try { process.kill(child.pid); } catch {} die("the game didn't load within a minute:\n" + err()); }
      return call("look");
    }
    case "look": return call("look", { full: rest[0] === "full" });
    case "choose": case "c": { const n = parseInt(rest[0], 10); if (!(n > 0)) die("choose N: N is a choice number from look"); return call("choose", n); }
    case "move": case "m": return call("move", rest[0]);
    case "go": { const x = parseInt(rest[0], 10), y = parseInt(rest[1], 10); if (!(x >= 0 && y >= 0)) die("go X Y"); return call("go", x, y); }
    case "callout": return call("callout");
    case "token": return call("token", rest[0], parseInt(rest[1], 10));
    case "shot": { const { page } = await attach(); const f = rest[0] || join(STATE_DIR, "shot.png"); await page.screenshot({ path: f }); console.log(f); process.exit(0); }
    case "stop": {
      const st = readState();
      if (st && alive(st.pid)) process.kill(st.pid);
      rmSync(STATE, { force: true }); console.log("stopped"); return;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\* ?/, ""));
  }
}
main().catch(e => die(String(e && e.stack || e)));
