/* THE CANCEL IS COMING — agent bridge.
   Injected into the page by tools/play/play.mjs (never shipped with the game). It turns the screen into a short
   text description and numbered choices, so a tool-calling agent can play with plain text instead of screenshots.
   Everything here reads the game's own globals (G, T, navScope, navItems, tileInfo, ...) at call time, and every
   choice is made by clicking the same element a player would, so the game's own rules and delays still apply.
   Wrapped in a function: a top-level let/const here would collide with the game's own when its script loads. */
(() => {
  const CFG = window.__AGENT_CFG || {};
  if (CFG.model) window.CANCEL_BOT = CFG.model; // the game sends this with the run: the boards tag it 🤖 and name the model

  // quiet, fast and still: no sound, calm mode (no long celebrations or shakes), fights at 4x, easy fights settled on the map
  try {
    const k = "tcc_meta_v1", m = JSON.parse(localStorage.getItem(k) || "{}");
    Object.assign(m, { mute: true, calm: true, speed: 4, quick: true, bg3d: false, tut: true });
    if (CFG.pid && !m.pid) m.pid = CFG.pid; // hosted games: one player per model, so the daily is one attempt per model there too
    localStorage.setItem(k, JSON.stringify(m));
  } catch (e) {}

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vis = el => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
  const one = s => String(s || "").replace(/\s+/g, " ").trim();
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  // the interface draws its stat emoji as little SVGs (si() in game.js), which have no text: put words back for them
  const WORD = { "❤️": "HP", "⚔️": "ATK", "🛡️": "ARM", "💨": "SPD", "✨": "crit", "🌀": "dodge", "🍃": "dodge" };
  let ICON_KEY = null;
  const iconKey = () => ICON_KEY || (ICON_KEY = Object.fromEntries(Object.entries(STAT_SVG).map(([e, svg]) => {
    const d = document.createElement("div"); d.innerHTML = svg; return [d.firstElementChild.outerHTML, WORD[e] || e]; })));
  function worded(root, fn) { // run fn with a word beside every stat drawing under root, then take the words away
    const key = iconKey(), added = [];
    root.querySelectorAll("svg.si").forEach(svg => { const w = key[svg.outerHTML]; if (!w) return;
      const t = document.createElement("span"); t.setAttribute("data-agent-word", ""); t.textContent = w + " "; svg.after(t); added.push(t); });
    try { return fn(); } finally { added.forEach(t => t.remove()); }
  }
  const strip = html => { const d = document.createElement("div"); d.innerHTML = html; return worded(d, () => one(d.textContent)); };
  const active = () => [...document.querySelectorAll(".screen.active")].map(s => s.id.replace("screen-", ""))[0] || "?";
  const modalOpen = () => !$("modal").classList.contains("hidden");

  // the game's chrome that is never a decision: sound, fullscreen, settings, fight speed, the fight log's own buttons
  const CHROME = ".mute, .fs, .gear, #btn-speed, .log-bar button, a, #menu-help, #rn-in, #ur-in"; // and signing in, which leaves the game
  function choices() {
    if (document.getElementById("win-seq")) return [document.getElementById("win-seq")];
    const scope = navScope();
    if (!scope) return [];
    let items = navItems(scope).filter(el => !el.matches("input, select") && !el.closest(CHROME) && !el.matches(CHROME)
      && !(el.matches(".card") && el.tagName !== "BUTTON" && !el.onclick)); // a card on show (the altar's relic), not one to pick: it stays in the dialog text
    // a fight that is still playing: the only thing to do is skip to its end, which settle() does by itself
    if (active() === "combat" && vis($("btn-skip")) && !vis($("combat-choice"))) items = items.filter(el => el.id !== "btn-skip");
    return items;
  }
  function label(el) {
    let t = one(worded(el, () => el.innerText) || el.textContent || el.title || el.getAttribute("aria-label") || "");
    if (!t && el.dataset.rid) t = el.dataset.rid;
    if (el.disabled) t += " (disabled)";
    return clip(t, el.matches(".card, .choice") ? 420 : 200);
  }

  // what a dialog or screen says, without repeating the text of its choices
  function bodyText(scope, items) {
    items.forEach(el => el.setAttribute("data-agent-hide", ""));
    const st = document.createElement("style"); st.textContent = "[data-agent-hide]{display:none!important}";
    document.head.appendChild(st);
    let t = "";
    try { t = worded(scope, () => scope.innerText); } finally { st.remove(); items.forEach(el => el.removeAttribute("data-agent-hide")); }
    return t.split("\n").map(one).filter(Boolean).join("\n");
  }

  const GLYPH = () => ({
    [T.CHEST]: "c", [T.GRAVE]: "g", [T.MON]: "m", [T.ELITE]: "E", [T.SHOP]: "$", [T.SHRINE]: "s", [T.FIRE]: "F", [T.GATE]: "B",
    [T.EVENT]: "?", [T.FORGE]: "J", [T.KEY]: "k", [T.VAULT]: "V", [T.FOUNTAIN]: "f", [T.ONNO]: "o", [T.FANG]: "C", [T.SCEARPO]: "x",
    [T.ALTAR]: "A", [T.RIVERGOD]: "R", [T.ETHCHAN]: "Z", [T.TENX]: "X", [T.DRBABY]: "D", [T.RIFT]: "%",
  });
  const LEGEND = "@ you, h Schizoposter (hunter), # wall, . floor, blank = unexplored. c chest, g grave, m monster, E elite, $ shop, s shrine, F campfire, B boss gate, ? event, J Remilia Jackson (fuse), k key, V vault, f fountain, o onno, C Charlotte Fang, x Scearpo, A cursed altar, R Rivergod, Z ETH Chan, X 10x, D Dr. Remilio Baby, % rift";

  // steps from you to every tile you have explored, through explored tiles only (what travel can use)
  function knownDist() {
    const d = { [G.px + "," + G.py]: 0 }, q = [[G.px, G.py]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy, k = nx + "," + ny;
        if (d[k] == null && isFloor(nx, ny) && !G.fog[ny][nx]) { d[k] = d[x + "," + y] + 1; q.push([nx, ny]); }
      }
    }
    return d;
  }

  function mapText(r) {
    const g = GLYPH(), lines = [];
    let x0 = Math.max(0, G.px - r), x1 = Math.min(W - 1, G.px + r), y0 = Math.max(0, G.py - r), y1 = Math.min(H - 1, G.py + r);
    // only as much of the window as has been explored
    let bx0 = G.px, bx1 = G.px, by0 = G.py, by1 = G.py;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!G.fog[y][x]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    x0 = bx0; x1 = bx1; y0 = by0; y1 = by1;
    let head = "x   ", head2 = "y   "; // two rows of column numbers: tens, then units
    for (let x = x0; x <= x1; x++) { head += Math.floor(x / 10); head2 += x % 10; }
    lines.push(head, head2);
    for (let y = y0; y <= y1; y++) {
      let row = String(y).padStart(3) + " ";
      for (let x = x0; x <= x1; x++) {
        let c;
        if (x === G.px && y === G.py) c = "@";
        else if (G.fog[y][x]) c = " ";
        else if (G.hunters.some(h => h.x === x && h.y === y)) c = "h";
        else { const t = G.map[y][x]; c = t === T.WALL ? "#" : t === T.EMPTY ? "." : (g[t] || "*"); }
        row += c;
      }
      lines.push(row.replace(/\s+$/, ""));
    }
    return lines.join("\n");
  }

  function places(limit) {
    const d = knownDist(), out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (G.fog[y][x] || (x === G.px && y === G.py)) continue;
      const t = G.map[y][x], hunter = G.hunters.some(h => h.x === x && h.y === y), pin = G.pins && G.pins[x + "," + y];
      if (t === T.WALL || (t === T.EMPTY && !hunter && !pin)) continue;
      const steps = d[x + "," + y];
      out.push({ x, y, steps: steps == null ? 999 : steps, text: (pin ? "[pinned] " : "") + strip(tileInfo(x, y)) });
    }
    out.sort((a, b) => a.steps - b.steps);
    const more = out.length - limit;
    return out.slice(0, limit).map(p => "(" + p.x + "," + p.y + ") " + (p.steps === 999 ? "no known path" : p.steps + " steps") + ": " + clip(p.text, 220)).join("\n")
      + (more > 0 ? "\n… " + more + " more (look full)" : "");
  }

  // explored floor next to unexplored ground: where to walk to see more
  function edges(limit) {
    const d = knownDist(), out = [];
    for (const k in d) {
      const [x, y] = k.split(",").map(Number);
      if (d[k] && DIRS4.some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && G.fog[ny][nx]; })) out.push([x, y, d[k]]);
    }
    out.sort((a, b) => a[2] - b[2]);
    const picked = []; // spread out: not five tiles of the same corridor end
    for (const e of out) { if (picked.length >= limit) break; if (picked.every(p => Math.abs(p[0] - e[0]) + Math.abs(p[1] - e[1]) > 3)) picked.push(e); }
    return picked.map(([x, y, n]) => "(" + x + "," + y + ") " + n).join(" · ");
  }

  function runText(full) {
    const s = G.stats, L = [];
    const nb = !G.endless && runBoss(G.bossesBeaten);
    L.push((G.endless ? "NIGHT " + G.day + " · depth " + depthOf() : "DAY " + G.day + "/9 " + G.phase.toUpperCase()) + " · " + G.movesLeft + " moves left in this " + G.phase
      + (nb ? " · next boss " + nb.name + " (day " + BOSS_DAYS[G.bossesBeaten] + ", " + G.bossesBeaten + "/3 beaten)" : ""));
    L.push("HP " + Math.round(s.hp) + "/" + s.maxhp + " · ATK " + s.atk + " · ARM " + s.arm + " · SPD " + s.spd + " · crit " + Math.round(s.crit) + "% · dodge " + Math.round(s.dodge || 0) + "%"
      + " · $CULT " + G.cult + " · keys " + (G.keys || 0) + " · banishes " + (G.banishes || 0) + " · tribe " + ((TRIBES.find(t => t.id === G.tribe) || {}).name || G.tribe) + (G.heat ? " · heat " + G.heat : ""));
    const dd = DISTRICTS[districtAt(G.px, G.py)];
    L.push("at (" + G.px + "," + G.py + ") in " + dd.name + ": " + dd.rule);
    L.push("RELICS " + G.relics.length + "/" + G.maxSlots + ":");
    G.relics.forEach((id, i) => { const r = relicById(id); L.push("  " + (i + 1) + ". " + r.name + (tierAt(i) > 1 ? " [" + TIERS[tierAt(i)].name + "]" : "") + " (" + r.rar + ")"
      + (full ? " — " + strip(textAt(r, i, true)) : "")); });
    const sets = setRows(G.relics);
    if (sets.length) L.push("SETS: " + sets.map(r => r.t.name + " " + r.c + (r.next ? "/" + r.next[0] : "") + (r.on.length ? " ON" : "")).join(" · "));
    const objs = (G.objectives || []).map(o => { const def = OBJECTIVES.find(x => x.id === o.id); return (o.state === "done" ? "✓" : o.state === "failed" ? "✕" : "○") + " " + def.text; });
    if (objs.length) L.push("OBJECTIVES: " + objs.join(" · "));
    return L.join("\n");
  }

  function feed(n) {
    const rows = [...$("map-log").children].slice(-n).map(d => one(d.textContent)).filter(Boolean);
    return rows.length ? "FEED (newest last):\n" + rows.map(r => "  " + clip(r, 240)).join("\n") : "";
  }

  function look(opts) {
    opts = opts || {};
    const full = !!opts.full, out = [];
    if (document.getElementById("win-seq")) return "THE CANCEL HAS BEEN CANCELLED. timeline saved.\nCHOICES:\n[1] continue";
    const screen = active(), inRun = G && !G.over && G.stats && !setupStep;
    out.push("SCREEN: " + screen + (modalOpen() ? " + dialog" : ""));
    if (inRun && (screen === "map" || screen === "combat")) out.push(runText(full || screen === "map" && !modalOpen()));
    const items = choices();
    if (modalOpen()) {
      out.push("DIALOG:\n" + clip(bodyText($("modal-panel"), items), full ? 6000 : 2500));
    } else if (screen === "combat") {
      out.push(one($("combat-title").textContent) + " — you " + one($("chp-you-t").textContent) + " vs " + one($("foe-name").textContent) + " " + one($("chp-foe-t").textContent));
      const log = [...$("combat-log").children].filter(d => !d.classList.contains("log-bar")).map(d => one(d.textContent)).filter(Boolean);
      out.push("FIGHT LOG (last " + Math.min(log.length, full ? 40 : 10) + " of " + log.length + "):\n" + log.slice(full ? -40 : -10).map(l => "  " + clip(l, 200)).join("\n"));
      if (vis($("combat-choice"))) out.push("CHOICE:\n" + bodyText($("combat-choice"), items));
    } else if (screen === "map" && inRun) {
      out.push("MAP (x across, y down; " + (full ? LEGEND : "legend: look full") + "):\n" + mapText(full ? 12 : 7));
      out.push("KNOWN PLACES, nearest first:\n" + (places(full ? 60 : 14) || "(none yet)"));
      const ed = edges(full ? 10 : 5); if (ed) out.push("UNEXPLORED EDGES (x,y) steps: " + ed);
      const f = feed(full ? 15 : 5); if (f) out.push(f);
      out.push("ACTIONS: move n|s|e|w · go X Y (walk there through explored tiles; stops for anything on the way) · callout (fight the next boss now)");
    } else if (screen === "avatar") {
      out.push(one($("ava-name").textContent) + (one($("nft-msg").textContent) ? " · " + one($("nft-msg").textContent) : ""));
    } else if (screen === "title") {
      const s = one(($("daily-sub") || {}).textContent); if (s) out.push("daily: " + s);
    }
    if (items.length) out.push("CHOICES:\n" + items.map((el, i) => "[" + (i + 1) + "] " + label(el)).join("\n"));
    else if (!(screen === "map" && inRun && !modalOpen())) out.push("(nothing to choose: wait)");
    if (G && G.over && screen !== "title") out.push("RUN OVER.");
    return out.join("\n\n");
  }

  // the page has stopped changing: no fight playing, no walk in progress, the same text for a beat
  async function settle(ms) {
    const t0 = Date.now(); let last = "", same = 0;
    while (Date.now() - t0 < (ms || 30000)) {
      const ws = document.getElementById("win-seq"); if (ws && ws.onclick) { ws.onclick(); await sleep(450); continue; }
      if (active() === "combat" && vis($("btn-skip")) && !vis($("combat-choice")) && !$("combat-ctl").classList.contains("hidden")) { $("btn-skip").click(); await sleep(150); continue; }
      const walking = typeof travelGoal !== "undefined" && travelGoal && !busy(); // a walk paused by a dialog carries on once the dialog is answered
      // the title and character screens disable their main button while art loads (a run resuming, a character being drawn): not settled yet
      const loading = ["btn-continue", "btn-start", "btn-begin"].some(id => { const b = $(id); return b && b.disabled && vis(b); });
      if (loading) { same = 0; await sleep(150); continue; }
      const sig = active() + "|" + modalOpen() + "|" + (G ? G.px + "," + G.py + "," + G.movesLeft + "," + G.queue.length : "") + "|" + choices().map(label).join("|") + "|" + ($("modal-panel").textContent.length);
      if (!walking && sig === last) { if (++same >= 4) return true; } else same = 0;
      last = sig; await sleep(150);
    }
    return false;
  }

  async function after(fn, opts) {
    let err = "";
    try { const r = fn(); if (typeof r === "string") err = r; } catch (e) { err = "error: " + e.message; }
    await sleep(120);
    const ok = await settle();
    return (err ? err + "\n\n" : "") + (ok ? "" : "(still changing after 30s; look again)\n\n") + look(opts);
  }

  const DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], up: [0, -1], down: [0, 1], right: [1, 0], left: [-1, 0] };
  window.AGENT = {
    look: async opts => { await settle(8000); return look(opts); },
    choose: (n, opts) => after(() => {
      const items = choices(), el = items[n - 1];
      if (!el) return "no choice [" + n + "]: there are " + items.length;
      if (el.disabled) return "[" + n + "] is disabled";
      if (el.id === "win-seq") { el.onclick && el.onclick(); return; }
      el.scrollIntoView({ block: "nearest" }); el.click();
    }, opts),
    move: (d, opts) => after(() => {
      const v = DIR[String(d).toLowerCase()]; if (!v) return "direction is n, s, e or w";
      if (!G || G.over || busy() || G.queue.length) return "can't move now: answer the dialog first";
      const x = G.px + v[0], y = G.py + v[1];
      if (!isFloor(x, y)) return "wall that way";
      tryMove(x, y);
    }, opts),
    go: (x, y, opts) => after(() => {
      if (!G || G.over || busy() || G.queue.length) return "can't travel now: answer the dialog first";
      if (G.fog[y] === undefined || G.fog[y][x]) return "(" + x + "," + y + ") is unexplored";
      if (!pathTo(x, y)) return "no known path to (" + x + "," + y + ")";
      travelTo(x, y);
    }, opts),
    callout: opts => after(() => { if (!G || G.endless) return "no boss to call out"; skipToBoss(); }, opts),
    token: (kind, id, opts) => after(() => { // play as a real token on the character screen
      if (active() !== "avatar") return "only on the character screen";
      $("nft-kind").value = kind; $("nft-kind").onchange();
      if (kind !== "radbro") { $("nft-id").value = String(id); $("nft-id").onchange(); }
    }, opts),
    settle,
  };
})();
