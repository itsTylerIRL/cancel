/* THE CANCEL IS COMING — engine part 1: utils, meta, assets, avatars, run state, map */
const $ = id => document.getElementById(id);
/* Everything the game decides by chance goes through rnd(). During a run it is a seeded generator whose
   state is saved with the run, so reloading the page replays the same outcomes, and a daily run starts
   everyone from the same seed. Purely visual randomness (confetti, grain) keeps using Math.random. */
let SEED = null; // null = not in a run: plain Math.random
function rnd(){
  if(SEED===null) return Math.random();
  SEED = (SEED + 0x6D2B79F5) | 0;
  let t = Math.imul(SEED ^ (SEED>>>15), 1|SEED);
  t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t;
  return ((t ^ (t>>>14))>>>0) / 4294967296;
}
function seedFrom(str){ let h = 2166136261; for(const c of str){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h|0; }
const randi = (a,b) => a + Math.floor(rnd()*(b-a+1));
const choice = arr => arr[Math.floor(rnd()*arr.length)];
const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const relicById = id => RELICS.find(r=>r.id===id);

/* ---------- meta (localStorage) ---------- */
const META_KEY = "tcc_meta_v1";
let META = {drip:0, wins:0, runs:0, best:0, unlocks:{}, speed:1, mute:false, seen:{}, tut:false, ach:{}, heat:0, tribe:"", daily:null};
function loadMeta(){ try{ const m = JSON.parse(localStorage.getItem(META_KEY)); if(m) META = {...META, ...m}; }catch(e){} }
function saveMeta(){ try{ localStorage.setItem(META_KEY, JSON.stringify(META)); }catch(e){} }

/* ---------- juice: synth sound, particles, shake ---------- */
const SFX = { // [wave, notes (Hz), seconds per note, volume]
  step:["triangle",[440],0.04,0.03], click:["triangle",[700],0.03,0.04],
  hit:["square",[190,130],0.05,0.04], hurt:["square",[120,90],0.06,0.05], crit:["sawtooth",[440,660,880],0.05,0.06],
  coin:["triangle",[988,1319],0.07,0.06], heal:["sine",[523,784],0.09,0.06], relic:["triangle",[523,659,784,1047],0.08,0.07],
  bad:["sawtooth",[200,150,110],0.09,0.05], fight:["square",[220,330],0.07,0.04], night:["sine",[330,262,196],0.16,0.06],
  boss:["sawtooth",[110,104,110,98],0.16,0.08], win:["triangle",[523,659,784],0.09,0.06],
  fanfare:["triangle",[523,659,784,1047,1319,1568],0.11,0.07], lose:["sawtooth",[330,262,196,131],0.18,0.07],
};
let AC = null;
function sfx(name){
  if(META.mute || !SFX[name]) return;
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if(AC.state==="suspended") AC.resume();
    const [wave, notes, dur, vol] = SFX[name], t0 = AC.currentTime;
    notes.forEach((f,i)=>{
      const o = AC.createOscillator(), g = AC.createGain(), t = t0+i*dur;
      o.type = wave; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur*1.6);
      o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t+dur*1.7);
    });
  }catch(e){}
}
function burst(emojis){ // a pop of emoji confetti from the middle of the screen
  const chars = [...emojis];
  for(let i=0;i<18;i++){
    const d = document.createElement("div"); d.className="confetti"; d.textContent=chars[Math.floor(Math.random()*chars.length)];
    const a = Math.random()*Math.PI*2, r = 120+Math.random()*220;
    d.style.setProperty("--dx", Math.cos(a)*r+"px"); d.style.setProperty("--dy", (Math.sin(a)*r-80)+"px");
    d.style.setProperty("--rot", (Math.random()*720-360)+"deg");
    document.body.appendChild(d); setTimeout(()=>d.remove(), 1100);
  }
}
function quake(){ const a=$("app"); a.classList.remove("quake"); void a.offsetWidth; a.classList.add("quake"); }
function setMute(m){
  META.mute = m; saveMeta();
  document.querySelectorAll(".mute").forEach(b=>{ b.textContent = m ? "🔇" : "🔊"; });
}

/* ---------- assets ---------- */
let ASSETS = null; // asset_index.json
const imgCache = {};
const ICONS = {};  // relic id -> cropped icon URL
function assetURL(cfg, layer, file){ return "assets/img/"+cfg+"/"+layer+"/"+file; }
function loadImg(url){
  if(imgCache[url]) return imgCache[url];
  imgCache[url] = new Promise((res,rej)=>{
    const im = new Image();
    im.onload = ()=>res(im); im.onerror = ()=>rej(url);
    im.src = (window.INLINE_FILES && window.INLINE_FILES[url]) || url;
  });
  return imgCache[url];
}
async function loadAssets(){
  if(!ASSETS){
    if(window.INLINE_ASSET_INDEX) ASSETS = window.INLINE_ASSET_INDEX;
    else {
      const r = await fetch("assets/asset_index.json");
      if(!r.ok) throw new Error("asset index "+r.status);
      ASSETS = await r.json();
    }
  }
  await Promise.all(RELICS.map(buildIcon));
}
/* How often an optional trait layer shows up on a generated character (anything not listed always does).
   Wearing every layer at once is what made them look piled-up. */
const LAYER_ODDS = {
  Milady:  { Face:0.6, Necklaces:0.3, "Face Decoration":0.2, Earrings:0.3, Glasses:0.3, Hat:0.4 },
  Remilio: { Costume:0.2, Mouth:0.6, Face:0.3, Earrings:0.3, Glasses:0.3, Hat:0.4, Friend:0.3, Weapon:0.25 },
  Bonkler: { Armor:0.5, Hand:0.6, Offhand:0.5, Pilot:0.7 },
};
function randomPicks(cfg, pinned){
  const picks = {}, odds = LAYER_ODDS[cfg] || {};
  for(const layer of ASSETS.order[cfg]){
    const files = (ASSETS[cfg]||{})[layer] || [];
    if(files.length && (odds[layer]==null || rnd()<odds[layer])) picks[layer] = choice(files);
  }
  for(const k in (pinned||{})) picks[k] = pinned[k]+".webp";
  // a costume is a full hood and body: nothing else goes on the head or torso unless the data asks for it
  if(picks.Costume) for(const k of ["Hair","Hat","Shirt","Earrings"]) if(!(pinned||{})[k]) delete picks[k];
  return picks;
}
/* Layers are composited at their native size (each collection has its own aspect ratio);
   small pixel-art layers are upscaled by a whole factor so they stay crisp. */
async function compositePortrait(cfg, picks){
  const ims = (await Promise.all(ASSETS.order[cfg].map(layer =>
    picks[layer] ? loadImg(assetURL(cfg, layer, picks[layer])).catch(()=>null) : null
  ))).filter(Boolean);
  const w = ims.length ? ims[0].naturalWidth : 600, h = ims.length ? ims[0].naturalHeight : 750;
  const k = Math.max(1, Math.round(480/w));
  const cv = document.createElement("canvas"); cv.width=w*k; cv.height=h*k;
  const cx = cv.getContext("2d"); cx.imageSmoothingEnabled = k===1;
  for(const im of ims) cx.drawImage(im,0,0,cv.width,cv.height);
  return cv;
}
/* ---------- the player: a Milady with no background, wearing her relics ---------- */
const BASE_LAYERS = ["Skin","Shirt","Hair","Eyes","Mouth","Brows","Face"];
/* where a relic's trait goes on the body. Single slots show the newest relic; the rest stack. */
const WEAR = {
  Milady:  { Hat:"hat", Glasses:"glasses", Shirt:"shirt", Hair:"hair", Eyes:"eyes", Necklaces:"neck", Earrings:"ear", "Face Decoration":"deco" },
  Remilio: { Hat:"hat", Glasses:"glasses", Shirt:"shirt", Costume:"costume", Face:"deco", Mouth:"smoke", Earrings:"ear", Weapon:"weapon", Friend:"friend" },
  Bonkler: { Body:"prop", Armor:"prop", Hand:"prop", Offhand:"prop", Head:"prop" },
};
const SINGLE = ["hat","glasses","shirt","hair","eyes","costume"];
const DRAW_ORDER = ["skin","shirt","neck","hair","costume","eyes","mouth","brows","face","deco","smoke","ear","glasses","hat","weapon","friend","prop"];
function basePicks(){
  const picks = {};
  for(const layer of BASE_LAYERS) picks[layer] = choice(ASSETS.Milady[layer]);
  return picks;
}
async function composeAvatar(base, relicIds){
  const slots = {};
  const add = (slot, item)=>{ if(SINGLE.includes(slot)) slots[slot]=[item]; else (slots[slot]=slots[slot]||[]).push(item); };
  for(const layer of BASE_LAYERS) add(layer.toLowerCase(), {cfg:"Milady", url:assetURL("Milady", layer, base[layer])});
  for(const id of relicIds){
    const [cfg, layer, name, tint] = relicById(id).icon;
    const slot = (WEAR[cfg]||{})[layer];
    if(slot) add(slot, {cfg, url:assetURL(cfg, layer, name+".webp"), tint});
  }
  const items = DRAW_ORDER.flatMap(slot => (slots[slot]||[]).map(it=>({...it, slot})));
  const ims = await Promise.all(items.map(it=>loadImg(it.url).catch(()=>null)));
  const cv = document.createElement("canvas"); cv.width=600; cv.height=750;
  const cx = cv.getContext("2d");
  let friends = 0, props = 0;
  items.forEach((it,i)=>{
    const im = ims[i]; if(!im) return;
    cx.filter = it.tint==="gray" ? "grayscale(1) contrast(1.15)" : "none";
    cx.imageSmoothingEnabled = true;
    if(it.slot==="friend"){ // Remilio friends sit in the bottom-right corner, side by side
      cx.drawImage(im, -85*friends++, 150, 600, 600);
    } else if(it.slot==="prop"){ // Bonkler parts are pixel art: carried as props down the left edge
      const [bx,by,bw,bh] = traitBounds(im, it.url);
      const k = Math.min(140/bw, 140/bh, 4);
      cx.imageSmoothingEnabled = false;
      cx.drawImage(im, bx,by,bw,bh, 78-bw*k/2, 742-150*props-bh*k, bw*k, bh*k);
      props++;
    } else if(it.cfg==="Remilio"){ // Remilio art is 600x600 with a smaller head: line its face up with hers
      cx.drawImage(im, -70, -32, 762, 762);
    } else if(it.slot==="hair" && slots.costume){ // under a hood only the hair around the face shows
      cx.save(); cx.beginPath(); cx.ellipse(330, 300, 225, 255, 0, 0, Math.PI*2); cx.clip();
      cx.drawImage(im, 0, 0, 600, 750); cx.restore();
    } else cx.drawImage(im, 0, 0, 600, 750);
  });
  cx.filter = "none";
  return (setCounts(relicIds).cheese||0) >= 2 ? fry(cv) : cv; // CHEESEWORLD builds get deep fried
}
let avatarTok = 0;
function refreshAvatar(){ // repaint the player everywhere after her relics change
  const run = G, tok = ++avatarTok;
  composeAvatar(run.base, run.relics).then(cv=>{
    if(G!==run || tok!==avatarTok) return;
    run.avatar = cv; run.face = faceToken(cv, "Milady");
    paint($("hud-avatar"), cv); paint($("combat-you"), cv);
    const t = document.querySelector("#map .tile.you .tok"); if(t) t.src = run.face;
  });
}
/* CHEESEWORLD treatment: crushed, oversaturated, grainy, with an Impact caption */
function fry(src, caption){
  const cv = document.createElement("canvas"); cv.width=src.width; cv.height=src.height;
  const cx = cv.getContext("2d");
  const t = document.createElement("canvas"); t.width=Math.round(src.width/3); t.height=Math.round(src.height/3);
  t.getContext("2d").drawImage(src,0,0,t.width,t.height);
  cx.filter = "saturate(2.6) contrast(1.6) brightness(1.08)";
  cx.drawImage(t,0,0,cv.width,cv.height);
  cx.filter = "none";
  cx.globalCompositeOperation = "source-atop"; // keep whatever transparency the portrait had
  cx.fillStyle = "rgba(255,110,0,.16)"; cx.fillRect(0,0,cv.width,cv.height);
  const g = Math.max(2, Math.round(cv.width/160));
  for(let i=0;i<1400;i++){
    cx.fillStyle = "hsla("+Math.floor(Math.random()*360)+",90%,60%,.13)";
    cx.fillRect(Math.random()*cv.width, Math.random()*cv.height, g, g);
  }
  cx.globalCompositeOperation = "source-over";
  if(caption){
    const fs = Math.round(cv.width/7.5);
    cx.font = "900 "+fs+"px Impact, Haettenschweiler, 'Arial Narrow Bold', 'Arial Black', sans-serif";
    cx.textAlign = "center"; cx.lineJoin = "round";
    cx.lineWidth = fs/7; cx.strokeStyle = "#000"; cx.fillStyle = "#fff";
    cx.strokeText(caption, cv.width/2, cv.height-fs*0.45, cv.width*0.94);
    cx.fillText(caption, cv.width/2, cv.height-fs*0.45, cv.width*0.94);
  }
  return cv;
}
/* MILADYCRAFT treatment: everything is blocks */
function blocky(src){
  const t = document.createElement("canvas"); t.width=30; t.height=Math.round(30*src.height/src.width);
  t.getContext("2d").drawImage(src,0,0,t.width,t.height);
  const cv = document.createElement("canvas"); cv.width=src.width; cv.height=src.height;
  const cx = cv.getContext("2d"); cx.imageSmoothingEnabled = false;
  cx.drawImage(t,0,0,cv.width,cv.height);
  return cv;
}
function foePortrait(def, picks){
  return compositePortrait(def.cfg, picks).then(cv => def.fx==="fried" ? fry(cv, def.caption) : def.fx==="blocky" ? blocky(cv) : cv);
}
function paint(el, src){
  el.width=src.width; el.height=src.height;
  el.getContext("2d").drawImage(src,0,0);
}
/* Trait layers are full-canvas with the item somewhere inside: find its alpha bounds [x,y,w,h]. */
const boundsCache = {};
function traitBounds(im, url){
  if(boundsCache[url]) return boundsCache[url];
  const iw = im.naturalWidth, ih = im.naturalHeight;
  const sw = Math.min(iw,150), sh = Math.round(sw*ih/iw);
  const sc = document.createElement("canvas"); sc.width=sw; sc.height=sh;
  const sx = sc.getContext("2d", {willReadFrequently:true}); sx.drawImage(im,0,0,sw,sh);
  const d = sx.getImageData(0,0,sw,sh).data;
  let x0=sw, y0=sh, x1=-1, y1=-1;
  for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){
    if(d[(y*sw+x)*4+3] > 24){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  }
  if(x1<0){ x0=0; y0=0; x1=sw-1; y1=sh-1; }
  const f = iw/sw;
  const bx = Math.max(0,(x0-1)*f), by = Math.max(0,(y0-1)*f);
  return boundsCache[url] = [bx, by, Math.min(iw,(x1+2)*f)-bx, Math.min(ih,(y1+2)*f)-by];
}
async function buildIcon(rel){
  const [cfg, layer, name, tint] = rel.icon;
  const url = assetURL(cfg, layer, name+".webp");
  try{
    const im = await loadImg(url);
    const iw = im.naturalWidth;
    const [bx,by,bw,bh] = traitBounds(im, url);
    const S = 96, pad = 10, k = Math.min((S-2*pad)/bw, (S-2*pad)/bh);
    const out = document.createElement("canvas"); out.width=S; out.height=S;
    const ox = out.getContext("2d");
    ox.imageSmoothingEnabled = !(iw<=200 && k>1);
    if(tint==="gray") ox.filter = "grayscale(1) contrast(1.15)";
    const draw = ()=>ox.drawImage(im, bx,by,bw,bh, (S-bw*k)/2, (S-bh*k)/2, bw*k, bh*k);
    // white sticker outline, so dark traits still read on the dark UI
    ox.shadowColor = "#fff";
    for(let a=0;a<8;a++){ ox.shadowOffsetX=Math.cos(a*Math.PI/4)*3; ox.shadowOffsetY=Math.sin(a*Math.PI/4)*3; draw(); }
    ox.shadowColor = "transparent"; draw();
    ICONS[rel.id] = out.toDataURL();
  }catch(e){ ICONS[rel.id] = url; }
}

/* ---------- run state ---------- */
let G = null;
const DAY_MOVES = 28, NIGHT_MOVES = 14, BOSS_DAYS = [3,6,9];
function baseStats(){
  return { hp:50, maxhp:50, atk:6, arm:0, spd:5, lck:10 };
}
function newRun(ava, opt){
  const tribe = TRIBES.find(t=>t.id===opt.tribe) || TRIBES[0], heat = opt.heat||0;
  SEED = opt.daily ? seedFrom("tcc-daily-"+opt.daily) : (Math.random()*4294967296)|0;
  const startCult = 100 + (META.unlocks.cult2?250:META.unlocks.cult1?100:0) + (tribe.cult||0);
  G = {
    name: ava.name, base: ava.picks, avatar: ava.canvas, face: faceToken(ava.canvas),
    tribe: tribe.id, heat, daily: opt.daily||"",
    cult: startCult,
    relics: [],
    maxSlots: 4 + (META.unlocks.slot1?1:0) - (heat>=5?1:0),
    day: 1, phase: "day", movesLeft: DAY_MOVES,
    px: SX, py: SY,
    map: [], fog: [],
    hunters: [], shops: {}, foes: {}, seen: [], bossLook: [],
    bonus: {maxhp:0, atk:0, spd:0},
    queue: [], over: false, newSeen: 0, sel: "", lit: {},
    bossesBeaten: 0, bossUnlocked: -1,
    kills: 0, tilesSeen: 0,
    stats: null,
  };
  // three bosses a run: one early, one mid, and THE CANCEL always closes
  G.bossIds = [0,1,2].map(slot=>choice(BOSSES.filter(b=>b.slot===slot)).id);
  G.relics.push(tribe.relic); discover(tribe.relic);
  if(META.unlocks.secondchance){ G.relics.push("wartime_pfp"); discover("wartime_pfp"); }
  oddsCache = {}; shownCult = G.cult;
  recalcStats();
  G.stats.hp = G.stats.maxhp;
  genMap();
  G.bossIds.forEach((id,i)=>spawnBoss(i, pinnedPicks(runBoss(i))));
}

/* ---------- autosave: the run is written out whenever the map is idle ---------- */
const RUN_KEY = "tcc_run_v3";
const RUN_FIELDS = ["name","base","cult","relics","maxSlots","day","phase","movesLeft","px","py","map","fog","gate","hunters","shops","seen","bonus","bossesBeaten","bossUnlocked","kills","tilesSeen","newSeen","lit","seed","seedDug","seedKnown","fudKills","newAch","tribe","heat","daily","bossIds"];
function saveRun(){
  if(!G || G.over || busy() || G.queue.length) return;
  const d = { v:3, rng:SEED, hp:G.stats.hp, log:$("map-log").innerHTML, foes:{}, boss:G.bossLook.map(l=>l.picks) };
  for(const k of RUN_FIELDS) d[k] = G[k];
  for(const k in G.foes) d.foes[k] = { id:G.foes[k].def.id, picks:G.foes[k].picks };
  try{ localStorage.setItem(RUN_KEY, JSON.stringify(d)); }catch(e){}
}
function clearRun(){ try{ localStorage.removeItem(RUN_KEY); }catch(e){} }
function loadRun(){
  try{
    const d = JSON.parse(localStorage.getItem(RUN_KEY));
    // a save from an older build may name things that no longer exist: drop it rather than break
    if(!d || d.v!==3 || !d.relics.every(relicById) || !Object.values(d.foes).every(f=>ENEMIES.some(e=>e.id===f.id))) return null;
    return d;
  }catch(e){ return null; }
}
async function resumeRun(d){
  G = { queue:[], over:false, sel:"", foes:{}, bossLook:[], stats:null };
  for(const k of RUN_FIELDS) G[k] = d[k];
  SEED = d.rng;
  G.avatar = await composeAvatar(G.base, G.relics);
  G.face = faceToken(G.avatar, "Milady"); G.worn = G.relics.join();
  oddsCache = {}; shownCult = G.cult;
  recalcStats(); G.stats.hp = clamp(d.hp, 1, G.stats.maxhp);
  for(const k in d.foes) spawnFoe(k, ENEMIES.find(e=>e.id===d.foes[k].id), d.foes[k].picks);
  G.bossIds.forEach((id,i)=>spawnBoss(i, d.boss[i] || pinnedPicks(runBoss(i))));
  paint($("hud-avatar"), G.avatar);
  $("map-log").innerHTML = d.log || "";
  showBanner();
  show("screen-map");
  mlog("💾 Run restored.", "gold");
  renderMap();
}
const FACE_CROP = { Milady:[0.14,0.2,0.72], Remilio:[0.14,0.1,0.72], Bonkler:[0.14,0,0.72] }; // x, y, size as fractions of width
function faceToken(cv, cfg){ // head crop of a portrait, used as a map piece
  try{
    const out = document.createElement("canvas"); out.width=96; out.height=96;
    const w = cv.width, [fx,fy,fs] = FACE_CROP[cfg||"Milady"];
    const ox = out.getContext("2d"); ox.imageSmoothingEnabled = cfg!=="Bonkler";
    ox.drawImage(cv, w*fx, w*fy, w*fs, w*fs, 0,0,96,96);
    return out.toDataURL();
  }catch(e){ return ""; }
}
function pinnedPicks(def){ // random look, with any layers the data pins down
  return randomPicks(def.cfg, def.picks);
}

/* ---------- relic engine ---------- */
function hasRelic(id){ return G.relics.includes(id); }
function runBoss(i){ return BOSSES.find(b=>b.id===G.bossIds[i]); } // this run's i-th boss (bosses are drawn from a pool)
function rarity(r){ return r.rar; }
function discover(id){ // first time ever holding a relic: it joins the collection on the title screen
  if(META.seen[id]) return;
  META.seen[id]=1; saveMeta(); if(G) G.newSeen++;
  if(Object.keys(META.seen).length>=30) achieve("collector");
}
/* Achievements persist across runs; each one adds its relic to the loot pool for good. */
const LOCKED = {}; // relic id -> the achievement that unlocks it
for(const a of ACHIEVEMENTS) LOCKED[a.relic] = a.id;
function achieve(id){
  if(META.ach[id]) return;
  const a = ACHIEVEMENTS.find(x=>x.id===id); if(!a) return;
  META.ach[id]=1; saveMeta();
  if(G) G.newAch = (G.newAch||0)+1;
  const r = relicById(a.relic);
  const t = document.createElement("div"); t.className="toast";
  t.innerHTML = "<img src='"+(ICONS[r.id]||"")+"' alt=''><div><em>🏆 ACHIEVEMENT</em><b>"+a.name+"</b><span>"+r.name+" joins the loot pool</span></div>";
  $("toasts").appendChild(t); setTimeout(()=>t.remove(), 4600);
  sfx("fanfare"); burst("🏆✨");
  if(G && !G.over && $("screen-map").classList.contains("active")) mlog("🏆 <b>"+a.name+"</b> — "+r.name+" unlocked for every future run.", "gold");
}
/* what equipping r would do to the numbers on your sheet, as little +/- chips */
function statDelta(r){
  const a = G.stats, b = computeStats([...G.relics, r.id]);
  return [["maxhp","HP"],["atk","ATK"],["arm","ARM"],["spd","SPD"],["crit","% crit"],["dodge","% dodge"]].map(([k,label])=>{
    const d = Math.round(b[k]-a[k]);
    return d ? "<i class='"+(d>0?"up":"down")+"'>"+(d>0?"+":"−")+Math.abs(d)+(label[0]==="%"?label:" "+label)+"</i>" : "";
  }).join("");
}
function relicPool(){
  return RELICS.filter(r => {
    if(r.tags.includes("blackmarket") && !META.unlocks.blackmarket) return false;
    if(LOCKED[r.id] && !META.ach[LOCKED[r.id]]) return false;
    if(G.relics.includes(r.id)) return false;
    return true;
  });
}
function setCounts(relics){
  const n = {};
  for(const id of relics) for(const k of relicById(id).set) n[k] = (n[k]||0)+1;
  return n;
}
function computeStats(relics){
  const s = baseStats();
  const R = id => relics.includes(id);
  const sets = s.sets = setCounts(relics), S = (id,n) => (sets[id]||0) >= n;
  const tb = (G && (TRIBES.find(t=>t.id===G.tribe)||{}).stat) || {};
  if(G){ s.maxhp+=G.bonus.maxhp+(tb.maxhp||0); s.atk+=G.bonus.atk+(tb.atk||0); s.spd+=G.bonus.spd+(tb.spd||0); s.arm+=tb.arm||0; }
  if(R("ak47")){ s.atk+=9; s.spd-=2; }
  if(R("bfg")){ s.atk+=15; s.maxhp-=15; }
  if(R("gold_ak")) s.atk+=13;
  if(R("balenciaga_bat")) s.atk+=5;
  if(R("katana")) s.atk+=4;
  if(R("golden_axe")) s.atk+=6;
  if(R("knife")){ s.atk+=3; s.spd+=2; }
  if(R("chrome_hearts")) s.atk+=1;
  if(R("yakuza_suit")){ s.atk+=3; s.arm+=3; }
  if(R("wwe_belt")) s.atk += 4*(sets.armed||0);
  if(R("drip_score")) s.atk += 2*relics.length;
  if(R("post_authorship")) s.atk += Math.min(10, G.kills);
  if(R("cancelversary")) s.atk += 4*G.bossesBeaten;
  if(S("armed",2)) s.atk+=4;
  if(R("ss_drip")) s.atk *= 1.5;
  if(R("diamond_stud")) s.maxhp+=25;
  if(R("frog_costume")){ s.maxhp+=30; s.spd-=1; }
  if(R("harajuku")){ s.maxhp+=10; s.spd+=1; }
  if(R("mexican_coke")){ s.maxhp+=10; s.spd+=2; }
  if(R("shark_suit")){ s.atk+=4; s.maxhp+=10; }
  if(R("blockhead")){ s.arm+=2; s.maxhp+=8; }
  if(R("mape_hoodie")) s.maxhp+=12;
  if(R("strawberry")) s.maxhp+=8;
  if(S("kawaii",2)) s.maxhp+=12;
  if(R("hat_911")) s.spd+=3;
  if(R("bulletproof")) s.arm+=6;
  if(R("moteiga")) s.arm+=4;
  if(R("hypebeast")) s.arm+=4;
  if(S("bonkler",2)) s.arm+=3;
  s.atk = Math.round(s.atk); s.spd = Math.max(1, s.spd); s.maxhp = Math.max(10, s.maxhp);
  s.crit = 5 + s.lck/2 + (R("gucci_cone")?20:0) + (R("katana")?10:0) + (R("swag_score")?3*relics.length:0)
    + (R("chrome_hearts")?8:0) + (R("mape_hoodie")?5:0) + (S("hype",2)?10:0) + (tb.crit||0);
  s.cultMult = (R("eth_necklace")?1.5:1) * (R("crown")?2:1) * (S("degen",2)?1.3:1);
  s.dodge = (R("cobain_glasses")?12:0) + (R("lain")?25:0) + (R("moteiga")?10:0) + (R("cat_ears")?6:0) + (R("matrix")?12:0) + (S("schizo",2)?10:0);
  s.shopDisc = (R("platinum")?0.7:1) * (R("hypebeast")?1.15:1) * (S("degen",3)?0.75:1) * (G && G.heat>=2 ? 1.25 : 1);
  return s;
}
/* synergy rows for the sidebar, the build sheet and draft cards */
function setRows(relics){
  const n = setCounts(relics);
  return SETS.filter(t=>n[t.id]).map(t=>{
    const c = n[t.id], next = t.tiers.find(([k])=>c<k);
    return { t, c, on: t.tiers.filter(([k])=>c>=k), next };
  }).sort((a,b)=>b.on.length-a.on.length || b.c-a.c);
}
function setsHTML(relics, full){
  const rows = setRows(relics);
  if(!rows.length) return "<div class='syn none'>hold 2 relics of the same set to switch on a synergy</div>";
  return rows.map(({t,c,on,next})=>
    "<div class='syn"+(on.length?" on":"")+"' style='--sc:"+t.color+"' title='"+t.tiers.map(([k,d])=>k+": "+d).join(" · ")+"'>"
    + "<b>"+t.icon+" "+t.name+"</b><em>"+c+(next?" / "+next[0]:"")+"</em>"
    + "<span>"+(on.length ? on.map(([k,d])=>d).join(" · ") : "")+(next && (full || !on.length) ? (on.length?" · ":"")+"<i>"+next[0]+": "+next[1]+"</i>" : "")+"</span></div>").join("");
}
/* weighted relic roll: rarer is scarcer, luck tilts toward rare, and sets you already hold come up more */
function rollRelics(n, luck){
  const held = setCounts(G.relics), out = [];
  const pool = relicPool().map(r=>({ r, w: RARITY[r.rar].w * (r.rar==="common" ? 1 : 1+(luck||0)) * (r.set.some(k=>held[k]) ? 2 : 1) }));
  while(out.length<n && pool.length){
    let x = rnd()*pool.reduce((a,p)=>a+p.w,0), i = 0;
    while(i<pool.length-1 && (x-=pool[i].w) > 0) i++;
    out.push(pool.splice(i,1)[0].r);
  }
  return out;
}
function recalcStats(){
  const s = computeStats(G.relics);
  const ratio = G.stats ? G.stats.hp / G.stats.maxhp : 1;
  G.stats = s;
  G.stats.hp = clamp(Math.round(ratio * s.maxhp), 1, s.maxhp);
  if((G.worn||"") !== G.relics.join()){ G.worn = G.relics.join(); refreshAvatar(); }
  if(setRows(G.relics).some(r=>!r.next)) achieve("synergy");
}

/* ---------- map generation ---------- */
const W=21, H=21, VIEW=9, SX=10, SY=10; // maze size, tiles visible across, spawn
const DIRS4 = [[1,0],[-1,0],[0,1],[0,-1]];
const T = { EMPTY:0, CHEST:1, GRAVE:2, MON:3, ELITE:4, SHOP:5, SHRINE:6, FIRE:7, GATE:8, EVENT:9, WALL:10 };
const T_EMOJI = { [T.CHEST]:"🎁", [T.GRAVE]:"🪦", [T.MON]:"👹", [T.ELITE]:"💀", [T.SHOP]:"🏪", [T.SHRINE]:"🎰", [T.FIRE]:"🔥", [T.GATE]:"⛩️", [T.EVENT]:"❓" };
const T_NAME = { [T.CHEST]:"chest", [T.GRAVE]:"grave", [T.MON]:"monster", [T.ELITE]:"elite monster", [T.SHOP]:"shop", [T.SHRINE]:"degen shrine", [T.FIRE]:"campfire", [T.GATE]:"boss gate", [T.EVENT]:"something is happening" };
function districtAt(x,y){ return (y<H/2 ? (x<W/2?0:1) : (x<W/2?2:3)); }
function isFloor(x,y){ return x>=0 && y>=0 && x<W && y<H && G.map[y][x]!==T.WALL; }
/* walking distance from (sx,sy) to every floor tile it can reach, as {"x,y": steps} */
function walkDist(sx, sy, max){
  const dist = {[sx+","+sy]:0}, q = [[sx,sy]];
  for(let i=0;i<q.length;i++){
    const [x,y] = q[i], d = dist[x+","+y];
    if(max!=null && d>=max) continue;
    for(const [dx,dy] of DIRS4){
      const nx=x+dx, ny=y+dy, k=nx+","+ny;
      if(isFloor(nx,ny) && dist[k]==null){ dist[k]=d+1; q.push([nx,ny]); }
    }
  }
  return dist;
}
function genMap(){
  G.map = []; G.fog = [];
  for(let y=0;y<H;y++){ G.map.push(new Array(W).fill(T.WALL)); G.fog.push(new Array(W).fill(true)); }
  // carve a maze: rooms sit on even coordinates, corridors run between them
  const seen = new Set([SX+","+SY]), stack = [[SX,SY]];
  G.map[SY][SX] = T.EMPTY;
  while(stack.length){
    const [x,y] = stack[stack.length-1];
    const next = shuffle(DIRS4).map(([dx,dy])=>[x+dx*2, y+dy*2, x+dx, y+dy])
      .find(([nx,ny])=>nx>=0 && ny>=0 && nx<W && ny<H && !seen.has(nx+","+ny));
    if(!next){ stack.pop(); continue; }
    const [nx,ny,wx,wy] = next;
    G.map[wy][wx] = T.EMPTY; G.map[ny][nx] = T.EMPTY;
    seen.add(nx+","+ny); stack.push([nx,ny]);
  }
  // knock through extra walls: loops mean there is usually a way round a fight you can't win
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    if((x+y)%2===1 && G.map[y][x]===T.WALL && rnd()<0.16) G.map[y][x] = T.EMPTY;
  }
  const dist = walkDist(SX,SY);
  const exits = (x,y) => DIRS4.filter(([dx,dy])=>isFloor(x+dx,y+dy)).length;
  const rooms = [], halls = [];
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const d = dist[x+","+y];
    if(d==null || d<=2) continue;
    if(x%2===0 && y%2===0) rooms.push({x,y,d,dead:exits(x,y)===1}); else halls.push({x,y,d});
  }
  // the boss gate waits somewhere deep in the maze
  const gate = choice([...rooms].sort((a,b)=>b.d-a.d).slice(0,10));
  G.map[gate.y][gate.x] = T.GATE; G.gate = [gate.x, gate.y];
  // loot likes dead ends; everything else takes whatever rooms are left
  const dead = shuffle(rooms.filter(r=>r.dead && r!==gate)), open = shuffle(rooms.filter(r=>!r.dead && r!==gate));
  const put = (t, n, deadEnd) => {
    for(let i=0;i<n;i++){
      const r = (deadEnd && dead.length ? dead : open.length ? open : dead).pop();
      if(!r) return;
      G.map[r.y][r.x] = t;
    }
  };
  put(T.CHEST,12,true); put(T.SHRINE,5,true); put(T.GRAVE,7,true);
  put(T.SHOP,4); put(T.FIRE,6); put(T.EVENT,10); put(T.ELITE,7); put(T.MON,13);
  for(const h of shuffle(halls).slice(0,8)) G.map[h.y][h.x] = T.MON; // and some monsters hold the corridors
  // Miladycraft lore: a seed phrase is buried somewhere near spawn
  const near = Object.keys(walkDist(SX,SY,3)).map(k=>k.split(",").map(Number)).filter(([x,y])=>(x!==SX||y!==SY) && G.map[y][x]===T.EMPTY);
  G.seed = near.length ? choice(near) : null;
  // every monster tile gets its foe (and its face) up front, themed to the district it stands in
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const t = G.map[y][x]; if(t!==T.MON && t!==T.ELITE) continue;
    const d = districtAt(x,y), tier = t===T.ELITE ? "elite" : "mon";
    const def = choice(ENEMIES.filter(e=>e.tier===tier && (d===3 || e.home.includes(d))));
    spawnFoe(x+","+y, def, pinnedPicks(def));
  }
  updateFog();
}
function spawnFoe(key, def, picks){ // a monster tile's foe and its face, composed in the background
  const run = G, foe = G.foes[key] = { def, picks, face:"", portrait: foePortrait(def, picks) };
  foe.portrait.then(cv=>{ foe.face = faceToken(cv, def.cfg); if(G===run && !busy()) renderMap(); });
}
function spawnBoss(i, picks){
  const run = G, b = runBoss(i), look = G.bossLook[i] = { picks, face:"", portrait: compositePortrait(b.cfg, picks) };
  look.portrait.then(cv=>{ look.face = faceToken(cv, b.cfg); if(G===run) renderTimeline(); });
}
function updateFog(){ // you see three steps down every corridor, and the walls beside what you see
  for(const k in walkDist(G.px,G.py,3)){
    const [fx,fy] = k.split(",").map(Number);
    for(let y=fy-1;y<=fy+1;y++) for(let x=fx-1;x<=fx+1;x++){
      if(x<0||y<0||x>=W||y>=H) continue;
      if(G.fog[y][x]) G.tilesSeen++;
      G.fog[y][x] = false;
    }
  }
}
function tileAt(x,y){ return (x<0||y<0||x>=W||y>=H) ? -1 : G.map[y][x]; }

/* ---------- logging / HUD ---------- */
function mlog(msg, cls){
  const el = $("map-log");
  const d=document.createElement("div"); if(cls)d.className=cls; d.innerHTML=msg; el.appendChild(d);
  while(el.childElementCount > 80) el.firstElementChild.remove();
  el.scrollTop=el.scrollHeight;
}
let shownCult = 0;
function renderHUD(){
  const s = G.stats;
  $("hp-fill").style.width = clamp(100*s.hp/s.maxhp,0,100)+"%";
  $("hp-fill").classList.toggle("low", s.hp <= s.maxhp*0.3);
  $("hp-text").textContent = s.hp+" / "+s.maxhp;
  if(shownCult!==G.cult){
    const d = G.cult-shownCult, c = $("hud-cult");
    countUp(c, shownCult, G.cult, 450); shownCult = G.cult;
    const f = document.createElement("span"); f.className="gain "+(d>0?"up":"down"); f.textContent=(d>0?"+":"−")+Math.abs(d);
    c.parentNode.appendChild(f); setTimeout(()=>f.remove(), 1000);
    if(d>0) sfx("coin");
  } else $("hud-cult").textContent = G.cult;
  document.body.classList.toggle("danger", !G.over && s.hp <= s.maxhp*0.3);
  if(G.cult>=800) achieve("rich");
  const chip = (ico,label,v) => "<span class='chip' title='"+label+"'>"+ico+" "+v+"</span>";
  $("hud-chips").innerHTML = chip("⚔️","ATK",s.atk)+chip("🛡️","ARM",s.arm)+chip("💨","SPD",s.spd)+(s.dodge?chip("🍃","dodge",s.dodge+"%"):"");
  const dist = DISTRICTS[districtAt(G.px,G.py)];
  const tr = TRIBES.find(t=>t.id===G.tribe);
  $("hud-name").textContent = G.name+(tr ? " "+tr.icon : "")+(G.heat ? " 🔥"+G.heat : "")+(G.daily ? " 📅" : "");
  $("hud-day").textContent = (G.phase==="day" ? "☀️ DAY " : "🌙 NIGHT ")+G.day;
  $("hud-district").innerHTML = "<span style='color:"+dist.color+"'>📍 "+dist.name+"</span> · "+dist.rule+" · "+G.movesLeft+" moves left";
  const total = G.phase==="day" ? DAY_MOVES : NIGHT_MOVES + (G.heat>=3 ? 3 : 0);
  let pips = "";
  for(let i=0;i<total;i++) pips += "<i"+(i<G.movesLeft?"":" class='spent'")+"></i>";
  const mv = $("hud-moves"); mv.innerHTML = pips; mv.title = G.movesLeft+" moves left"; mv.className = G.phase;
  $("relic-count").textContent = G.relics.length+" / "+G.maxSlots;
  let rb = "";
  for(let i=0;i<G.maxSlots;i++){
    const rel = G.relics[i] && relicById(G.relics[i]);
    rb += rel ? "<div class='relic' title='"+rel.name+" — "+rel.desc.replace(/'/g,"&#39;")+"'><img class='relic-ico' src='"+ICONS[rel.id]+"' alt=''><div class='rtxt'><b class='"+rel.rar+"'>"+rel.name+" <small>"+rel.set.map(k=>SETS.find(t=>t.id===k).icon).join("")+"</small></b><span>"+rel.desc+"</span></div></div>"
              : "<div class='relic'><div class='relic-ico empty'></div><div class='rtxt'><span>empty slot</span></div></div>";
  }
  $("relic-bar").innerHTML = rb;
  $("syn-bar").innerHTML = setsHTML(G.relics, false);
  renderTimeline();
}
/* the nine-day track across the top: where you are, and what is coming */
function renderTimeline(){
  if(!G) return;
  let h = "";
  for(let d=1; d<=9; d++){
    const bi = BOSS_DAYS.indexOf(d), look = bi>=0 && G.bossLook[bi];
    const cls = "day"+(d<G.day?" past":"")+(d===G.day?" now "+G.phase:"")+(bi>=0?" boss":"")+(bi>=0 && bi<G.bossesBeaten?" beaten":"");
    h += "<div class='"+cls+"'"+(bi>=0?" title='"+runBoss(bi).name+"'":"")+">"
      + (bi>=0 ? (look && look.face ? "<img src='"+look.face+"' alt=''>" : "<span>☠</span>") : "<span>"+d+"</span>")
      + (bi>=0 ? "<em>"+runBoss(bi).name+"</em>" : "")+"</div>";
  }
  $("timeline").innerHTML = h;
  const nb = runBoss(G.bossesBeaten), left = nb ? BOSS_DAYS[G.bossesBeaten]-G.day : 0;
  $("doom").innerHTML = !nb ? "" : "<b>"+nb.name+"</b> "+(left>0 ? "arrives in "+left+" day"+(left>1?"s":"") : G.phase==="day" ? "arrives at dawn" : "arrives when this night ends");
}
function renderMap(){
  const m = $("map");
  m.style.gridTemplateColumns = "repeat("+W+", 1fr)";
  m.style.width = (W/VIEW*100)+"%"; // VIEW tiles fit across the window; the rest scrolls
  m.classList.toggle("night", G.phase==="night");
  m.innerHTML = "";
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const d = document.createElement("div");
    d.className = "tile";
    d.style.setProperty("--dc", DISTRICTS[districtAt(x,y)].color);
    const fogged = G.fog[y][x], key = x+","+y;
    if(fogged) d.classList.add("fog");
    else if(!G.lit[key]){ G.lit[key]=1; d.classList.add("reveal"); }
    if(G.sel===key) d.classList.add("sel");
    if(G.map[y][x]===T.WALL){ if(!fogged) d.classList.add("wall"); m.appendChild(d); continue; }
    if(x===G.px && y===G.py){
      d.classList.add("you");
      d.innerHTML = G.face ? "<img class='tok' src='"+G.face+"' alt='you'>" : "🌸";
    } else if(!fogged){
      const t = G.map[y][x];
      if(G.hunters.some(h=>h.x===x&&h.y===y)){ d.classList.add("hunter"); d.innerHTML="<span>🌚</span>"; d.title="FUD demon"; }
      else if(t!==T.EMPTY){
        const foe = G.foes[x+","+y];
        if(foe && (t===T.MON || t===T.ELITE)){
          d.classList.add("foe"); if(t===T.ELITE) d.classList.add("elite");
          d.innerHTML = foe.face ? "<img class='tok' src='"+foe.face+"' alt=''>" : T_EMOJI[t];
          d.classList.add("d-"+fightOdds(foe.def, {elite:t===T.ELITE}).tag);
        } else {
          d.classList.add("poi", "t"+t);
          d.innerHTML = "<span>"+((t===T.GATE && G.bossUnlocked<0) ? "🔒" : T_EMOJI[t])+"</span>";
          d.title = T_NAME[t];
          if(t===T.GATE && G.bossUnlocked>=0) d.classList.add("gate-open");
        }
      }
    }
    if(G.seedKnown && !G.seedDug && G.seed && x===G.seed[0] && y===G.seed[1] && !(x===G.px && y===G.py)){ d.classList.add("dig"); d.textContent="⛏️"; }
    if(Math.abs(x-G.px)+Math.abs(y-G.py)===1 && !fogged) d.classList.add("moveable");
    d.onmouseenter = ()=>{ $("tile-info").innerHTML = tileInfo(x,y); };
    d.onclick = ()=>{
      // no hover on touch screens: the first tap on a foe shows its odds, the second commits
      const t = G.map[y][x];
      if(TOUCH && !fogged && (t===T.MON || t===T.ELITE) && G.sel!==key && d.classList.contains("moveable")){
        G.sel = key; renderMap(); $("tile-info").innerHTML = tileInfo(x,y)+" <b>— tap again to fight</b>"; return;
      }
      stopTravel();
      if(Math.abs(x-G.px)+Math.abs(y-G.py)===1) tryMove(x,y); else travelTo(x,y);
    };
    m.appendChild(d);
  }
  m.onmouseleave = ()=>{ $("tile-info").innerHTML = tileInfo(G.px,G.py); };
  $("tile-info").innerHTML = tileInfo(G.px,G.py);
  centerMap();
  renderMinimap();
  renderHUD();
}
/* keep the player in the middle of the window; you can still scroll or drag away to look around */
let camSnap = true;
function centerMap(){
  const w = $("map-wrap"), m = $("map"), ts = m.scrollWidth/W;
  if(!ts) return;
  w.scrollTo({ left: m.offsetLeft+(G.px+0.5)*ts-w.clientWidth/2, top: m.offsetTop+(G.py+0.5)*ts-w.clientHeight/2, behavior: camSnap ? "auto" : "smooth" });
  camSnap = false;
}
const MINI = { [T.CHEST]:"#ff9ecb", [T.GRAVE]:"#8d8aa6", [T.MON]:"#ff6b6b", [T.ELITE]:"#ffd75e", [T.SHOP]:"#8fd6ff",
  [T.SHRINE]:"#ffd75e", [T.FIRE]:"#ff9a4a", [T.EVENT]:"#b9a4ff", [T.GATE]:"#ff2244" };
function renderMinimap(){
  const cv = $("minimap"), k = 6, cx = cv.getContext("2d");
  cv.width = W*k; cv.height = H*k;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    if(G.fog[y][x]) continue;
    const t = G.map[y][x];
    cx.fillStyle = t===T.WALL ? "#1b1832" : "#4a4478";
    cx.fillRect(x*k, y*k, k, k);
    if(MINI[t]){ cx.fillStyle = MINI[t]; cx.fillRect(x*k+1, y*k+1, k-2, k-2); }
  }
  cx.fillStyle = "#ff2244"; for(const h of G.hunters) if(!G.fog[h.y][h.x]) cx.fillRect(h.x*k, h.y*k, k, k);
  cx.fillStyle = "#a6ff5e"; cx.fillRect(G.px*k-1, G.py*k-1, k+2, k+2);
}
const TOUCH = !window.matchMedia("(hover:hover)").matches;
const T_DESC = { [T.CHEST]:"<b>Chest</b> — draft 1 of 3 relics.", [T.GRAVE]:"<b>Grave</b> — a relic draft, or some $CULT.",
  [T.SHOP]:"<b>Remilio Mart</b> — buy relics or a full heal.", [T.SHRINE]:"<b>Degen Shrine</b> — coin flip: double your bet and draft a relic.",
  [T.FIRE]:"<b>Campfire</b> — heal to full, skip the rest of the day or night.", [T.EVENT]:"<b>???</b> — something is happening here." };
function foeLine(def, elite, opts){
  const f = foeInstance(def);
  return "<b>"+def.name+"</b>"+(elite?" · elite":"")+" — ❤️ "+f.hp+" ⚔️ "+f.atk+" 🛡️ "+f.arm+" 💨 "+f.spd+" · "+oddsText(fightOdds(def, opts));
}
function tileInfo(x,y){
  if(G.fog[y][x]) return "Unexplored.";
  if(G.map[y][x]===T.WALL) return "A wall.";
  if(G.hunters.some(h=>h.x===x&&h.y===y)) return foeLine(ENEMIES.find(e=>e.tier==="hunter"), false, {})+" · hunting you";
  if(x===G.px && y===G.py) return "📍 "+DISTRICTS[districtAt(x,y)].name+" — "+DISTRICTS[districtAt(x,y)].rule+" · "+(TOUCH ? "tap a foe once to scout it" : "hover a tile to scout it, click any explored tile to walk there");
  const t = G.map[y][x], foe = G.foes[x+","+y];
  if(foe && (t===T.MON || t===T.ELITE)) return foeLine(foe.def, t===T.ELITE, {elite:t===T.ELITE});
  if(t===T.GATE) return G.bossUnlocked<0 ? "<b>Boss gate</b> — sealed until a boss day." : foeLine(runBoss(G.bossUnlocked), false, {boss:runBoss(G.bossUnlocked)});
  if(t===T.EMPTY && G.seed && !G.seedDug && x===G.seed[0] && y===G.seed[1]) return G.seedKnown ? "<b>⛏️ The seed phrase is buried here.</b>" : "The ground looks disturbed here…";
  return T_DESC[t] || DISTRICTS[districtAt(x,y)].name+" district.";
}
function show(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  $(id).classList.add("active");
  if(id==="screen-map") camSnap = true; // a hidden screen loses its scroll position: jump, don't glide
  window.scrollTo(0,0);
}

/* THE CANCEL IS COMING — engine part 2: movement, time, encounters */
/* Everything a move triggers (ambush, tile, nightfall, boss) goes through G.queue so only
   one modal or fight is ever on screen; pump() runs the next one when the map is idle. */
function busy(){
  return !$("modal").classList.contains("hidden") || !$("screen-map").classList.contains("active");
}
function pump(){
  if(!G || G.over) return;
  while(G.queue.length && !busy()) G.queue.shift()();
  if(!busy()){ renderMap(); saveRun(); }
}
function tryMove(x,y){
  if(!G || G.over || busy() || G.queue.length) return;
  if(x<0||y<0||x>=W||y>=H) return;
  if(Math.abs(x-G.px)+Math.abs(y-G.py)!==1) return;
  if(G.fog[y][x] || !isFloor(x,y)) return;
  G.px=x; G.py=y; G.sel="";
  sfx("step");
  updateFog();
  // hunter collision
  const h = G.hunters.findIndex(h=>h.x===x&&h.y===y);
  if(h>=0){ G.hunters.splice(h,1); G.queue.push(()=>ambush("You walk straight into a FUD demon!")); }
  G.queue.push(()=>enterTile(G.map[y][x]));
  advanceTime();
  renderMap();
  pump();
}
/* click any explored tile to walk there: follows the shortest explored route and stops at anything that needs you */
let travelTimer = null;
function stopTravel(){ clearTimeout(travelTimer); travelTimer = null; }
function pathTo(tx, ty){
  if(G.fog[ty][tx] || !isFloor(tx,ty)) return null;
  const prev = {[G.px+","+G.py]:null}, q = [[G.px,G.py]];
  for(let i=0;i<q.length;i++){
    const [x,y] = q[i];
    if(x===tx && y===ty){
      const path = []; let c = [x,y];
      while(prev[c[0]+","+c[1]]){ path.unshift(c); c = prev[c[0]+","+c[1]]; }
      return path;
    }
    // only walk through plain explored floor; the destination itself can be anything
    if((x!==G.px || y!==G.py) && (G.map[y][x]!==T.EMPTY || G.hunters.some(h=>h.x===x&&h.y===y))) continue;
    for(const [dx,dy] of DIRS4){
      const nx=x+dx, ny=y+dy, k=nx+","+ny;
      if(isFloor(nx,ny) && !G.fog[ny][nx] && !(k in prev)){ prev[k]=[x,y]; q.push([nx,ny]); }
    }
  }
  return null;
}
function travelTo(tx, ty){
  if(!G || G.over || busy() || G.queue.length) return;
  const path = pathTo(tx,ty);
  if(!path || !path.length) return;
  const step = ()=>{
    travelTimer = null;
    if(!path.length || G.over || busy() || G.queue.length) return;
    const [nx,ny] = path.shift(), phase = G.phase;
    if(G.hunters.some(h=>h.x===nx&&h.y===ny)) return; // never auto-walk into a demon
    tryMove(nx,ny);
    if(G.px!==nx || G.py!==ny || busy() || G.queue.length || G.phase!==phase) return;
    if(G.hunters.some(h=>Math.abs(h.x-G.px)+Math.abs(h.y-G.py)<=3 && !G.fog[h.y][h.x])) return; // something is close: your call
    if(path.length) travelTimer = setTimeout(step, 110);
  };
  step();
}
function advanceTime(){
  G.movesLeft--;
  // hunters stalk at night
  if(G.phase==="night" && G.movesLeft%2===0){
    const dist = walkDist(G.px,G.py);
    for(const h of [...G.hunters]){
      // one step along the shortest way through the maze
      const step = DIRS4.map(([dx,dy])=>[h.x+dx,h.y+dy]).filter(([x,y])=>dist[x+","+y]!=null)
        .sort((a,b)=>dist[a[0]+","+a[1]]-dist[b[0]+","+b[1]])[0];
      if(step){ h.x=step[0]; h.y=step[1]; }
      if(h.x===G.px && h.y===G.py){
        G.hunters = G.hunters.filter(k=>k!==h);
        G.queue.push(()=>ambush("A FUD demon runs you down!"));
      }
    }
  }
  if(G.movesLeft<=0) G.queue.push(endPhase);
}
function ambush(msg){
  mlog(msg, "bad");
  startCombat(foeInstance(ENEMIES.find(e=>e.tier==="hunter")), {label:"AMBUSH"});
}
function endPhase(){
  if(G.phase==="day") return startNight();
  if(G.bossUnlocked>=0) return bossArrives(); // you didn't go to it, so it comes to you
  G.day++; startDay();
}
function startDay(){
  G.phase="day"; G.movesLeft=DAY_MOVES; G.hunters=[];
  mlog("☀️ <b>DAY "+G.day+"</b> dawns over the timeline.", "gold");
  if(G.day>=9) achieve("day9");
  const bi = BOSS_DAYS.indexOf(G.day);
  if(bi>=0){
    const b = runBoss(bi);
    G.bossUnlocked = bi;
    mlog("⚠️ <b>"+b.name+" IS COMING.</b> "+b.intro+"<br><i>"+b.mechanic+"</i>", "bad");
    sfx("boss"); quake();
  }
  showBanner();
  renderMap();
}
function showBanner(){
  const bb = $("boss-banner"), b = runBoss(G.bossUnlocked);
  bb.classList.toggle("hidden", !b);
  if(b) bb.innerHTML = "⚠️ "+b.name+" IS COMING<small>"+b.mechanic+"<br>face it at the ⛩️ gate — or it finds you at dawn</small>";
}
function startNight(){
  G.phase="night"; G.movesLeft=NIGHT_MOVES + (G.heat>=3 ? 3 : 0);
  mlog("🌙 <b>NIGHT falls.</b> FUD demons are hunting. Find a campfire.", "bad");
  sfx("night");
  // they come out of the maze a little way off: close enough to matter, far enough to see coming
  const dist = walkDist(G.px,G.py);
  const spots = shuffle(Object.keys(dist).filter(k=>dist[k]>=7 && dist[k]<=14));
  for(const k of spots.slice(0, (G.day<4 ? 2 : 3) + (G.heat>=3 ? 1 : 0))){ const [x,y]=k.split(",").map(Number); G.hunters.push({x,y}); }
  renderMap();
}
function clearTile(){ G.map[G.py][G.px]=T.EMPTY; }

/* ---------- encounters ---------- */
function enterTile(t){
  if(t===T.EMPTY && G.seed && !G.seedDug && G.px===G.seed[0] && G.py===G.seed[1]){
    G.seedDug = true; G.cult += 120; achieve("seed");
    mlog("⛏️ You dig where the ground looks disturbed… <b>a seed phrase.</b> The wallet is real. <b>+120 $CULT.</b>", "gold");
    sfx("fanfare"); burst("⛏️💎✨");
    return;
  }
  switch(t){
    case T.CHEST: clearTile(); openDraft("You crack open a chest.", districtAt(G.px,G.py)===0 ? rollRelics(4) : null); break;
    case T.GRAVE:
      clearTile();
      if(rnd()<0.55) openDraft("You scavenge the grave of a past milady.");
      else { const c=randi(40,90); G.cult+=c; mlog("Found <b>"+c+" $CULT</b> in a grave.", "gold"); }
      break;
    case T.MON: case T.ELITE: {
      const foe = G.foes[G.px+","+G.py];
      clearTile(); startCombat(foeInstance(foe.def), {elite:t===T.ELITE, portrait:foe.portrait});
      break;
    }
    case T.EVENT: openEvent(); break;
    case T.SHOP: openShop(); break;
    case T.SHRINE: openShrine(); break;
    case T.FIRE: openFire(); break;
    case T.GATE:
      if(G.bossUnlocked<0){ mlog("The gate is sealed. Something is coming…", "bad"); }
      else openBossGate();
      break;
  }
}
/* Foes grow every day: +10% HP and ATK per day (bosses +6%), a point of ARM every three days,
   and they pay out more $CULT to match. */
function foeInstance(def){
  const boss = BOSSES.some(b=>b.id===def.id), d = G.day-1;
  const lvl = 1 + d*(boss ? 0.06 : 0.1);
  const hpx = lvl * (boss ? (G.heat>=4?1.2:1) : (G.heat>=1?1.15:1)), atx = lvl * (boss && G.heat>=4 ? 1.2 : 1);
  return { ...def, hp:Math.round(def.hp*hpx), maxhp:Math.round(def.hp*hpx),
    atk:Math.round(def.atk*atx), arm:def.arm + (boss ? 0 : Math.floor(d/3)), spd:def.spd, lck:def.lck,
    cult:def.cult.map(c=>Math.round(c*lvl)) };
}

/* ---------- relic draft ---------- */
function relicCard(r, attr, delta){
  const rar = rarity(r);
  return "<div class='card "+rar+"' "+attr+">"+(rar!=="common"?"<em>"+rar+"</em>":"")+"<img src='"+ICONS[r.id]+"' alt=''><b>"+r.name+"</b><span>"+r.desc+"</span>"
    + (delta ? "<div class='delta'>"+statDelta(r)+"</div>" : "")+setChips(r, delta)+(META.seen[r.id]?"":"<u>new!</u>")+"</div>";
}
function setChips(r, preview){ // which sets a relic feeds, and whether taking it would switch a tier on
  const n = setCounts(G.relics.filter(id=>id!==r.id));
  return "<div class='sets'>"+r.set.map(k=>{
    const t = SETS.find(x=>x.id===k), c = (n[k]||0)+1, hit = t.tiers.find(([q])=>q===c), next = t.tiers.find(([q])=>c<q);
    return "<i style='--sc:"+t.color+"'"+(preview && hit ? " class='hit' title='"+hit[1]+"'" : "")+">"+t.icon+" "+t.name
      + (preview ? " "+c+(hit ? " ✓" : next ? "/"+next[0] : "") : "")+"</i>"
      + (preview && hit ? "<span class='syn-hit'>"+hit[1]+"</span>" : "");
  }).join("")+"</div>";
}
function gotRelic(r){ discover(r.id); sfx("relic"); burst(rarity(r)==="common" ? "✨" : "✨💖🌸"); }
/* Equip r, asking which relic to drop when slots are full. onDone(dropped) / onBack(). */
function acquireRelic(r, onDone, onBack){
  if(G.relics.length < G.maxSlots){ G.relics.push(r.id); recalcStats(); gotRelic(r); return onDone(null); }
  let h = "<h2>SLOTS FULL — DROP ONE</h2><div class='stat-line'><span>to make room for</span><b>"+r.name+"</b></div><div class='draft-cards'>";
  G.relics.forEach((id,j)=>{ h += relicCard(relicById(id), "data-j='"+j+"'"); });
  h += "</div><div class='row'><button class='btn small' id='drop-back'>← back</button></div>";
  openModal(h);
  document.querySelectorAll("#modal-panel .card").forEach(c=>{ c.onclick=()=>{
    const old = relicById(G.relics[+c.dataset.j]);
    G.relics[+c.dataset.j]=r.id; recalcStats(); gotRelic(r); onDone(old);
  };});
  $("drop-back").onclick = onBack;
}
function openDraft(flavor, pool, luck){
  pool = pool || rollRelics(3, luck);
  if(!pool.length){ mlog("Nothing new here. You already hold everything.", "bad"); return false; }
  let html = "<h2>CHOOSE A RELIC</h2><div class='stat-line'><span>"+flavor+"</span><b>"+G.relics.length+" / "+G.maxSlots+" slots</b></div><div class='draft-cards"+(pool.length>3?" four":"")+"'>";
  pool.forEach((r,i)=>{ html += relicCard(r, "data-i='"+i+"' style='animation-delay:"+(i*90)+"ms'", true); });
  html += "</div><div class='row'><button class='btn small' id='draft-skip'>leave it</button></div>";
  openModal(html);
  document.querySelectorAll("#modal-panel .card").forEach(c=>{
    c.onclick = ()=>{
      const r = pool[+c.dataset.i];
      acquireRelic(r, old=>{
        closeModal();
        mlog("Took <b>"+r.name+"</b> — "+r.desc+(old?" <i>(dropped "+old.name+")</i>":""), "good"); renderMap();
      }, ()=>openDraft(flavor, pool));
    };
  });
  $("draft-skip").onclick=()=>{ closeModal(); renderMap(); };
  return true;
}

/* ---------- shop ---------- */
function openShop(note){
  const key = G.px+","+G.py;
  const shop = G.shops[key] || (G.shops[key] = { stock: rollRelics(3, 0.5).map(r=>({id:r.id, base:RARITY[r.rar].price})) });
  shop.stock = shop.stock.filter(it=>!hasRelic(it.id));
  const disc = G.stats.shopDisc * (districtAt(G.px,G.py)===2 ? 0.8 : 1);
  const healCost = Math.round(60*disc), hurt = G.stats.hp < G.stats.maxhp;
  let html = "<h2>🏪 REMILIO MART</h2><div class='stat-line'><span>your $CULT</span><b>"+G.cult+"</b></div>";
  shop.stock.forEach((it,i)=>{
    const r = relicById(it.id), p = Math.round(it.base*disc);
    html+="<div class='shop-row "+r.rar+"'><img src='"+ICONS[r.id]+"' alt=''><div class='sinfo'><b>"+r.name+"</b><span>"+r.desc+"</span><div class='delta'>"+statDelta(r)+"</div>"+setChips(r, true)+"</div><button class='btn small' data-i='"+i+"'"+(G.cult<p?" disabled":"")+">"+p+"</button></div>";
  });
  if(!shop.stock.length) html += "<div class='note'>sold out. thank u for shopping.</div>";
  html += "<div class='shop-row'><div class='heal-ico'>💖</div><div class='sinfo'><b>Full heal</b><span>"+G.stats.hp+" / "+G.stats.maxhp+" HP</span></div><button class='btn small' id='shop-heal'"+(G.cult<healCost||!hurt?" disabled":"")+">"+healCost+"</button></div>";
  if(note) html += "<div class='note good'>"+note+"</div>";
  html += "<div class='row'><button class='btn small' id='shop-leave'>leave</button></div>";
  openModal(html);
  document.querySelectorAll("#modal-panel .shop-row .btn[data-i]").forEach(b=>{ b.onclick=()=>{
    const it=shop.stock[+b.dataset.i], r=relicById(it.id), p=Math.round(it.base*disc);
    if(G.cult<p) return;
    acquireRelic(r, old=>{
      G.cult-=p;
      mlog("Bought <b>"+r.name+"</b> for "+p+" $CULT."+(old?" <i>(dropped "+old.name+")</i>":""), "good");
      renderMap(); openShop("Bought "+r.name+".");
    }, ()=>openShop());
  };});
  $("shop-heal").onclick=()=>{
    if(G.cult<healCost || !hurt) return;
    G.cult-=healCost; G.stats.hp=G.stats.maxhp; sfx("heal");
    mlog("Healed to full.", "good"); renderMap(); openShop("Healed to full.");
  };
  $("shop-leave").onclick=()=>{ closeModal(); };
}

/* ---------- shrine (the gambler's corner) ---------- */
function openShrine(){
  let flipping = false;
  let html = "<h2>🎰 DEGEN SHRINE</h2><div class='stat-line'><span>your $CULT</span><b id='shrine-cult'>"+G.cult+"</b></div>"
    + "<div class='note'>Bet $CULT on a coin flip.<br>Win → double your bet and draft a relic. Lose → the void keeps it.<br>The shrine goes dark once it pays out.</div>"
    + "<div class='coinflip' id='coinflip'>🪙</div><div class='bet-row'>"
    + [25,50,100].map(b=>"<button class='btn small' data-b='"+b+"'>"+b+"</button>").join("")
    + "<button class='btn small' data-b='all'>ALL IN</button></div>"
    + "<div class='row'><button class='btn small' id='shrine-leave'>walk away</button></div>";
  openModal(html);
  const bets = [...document.querySelectorAll("#modal-panel .bet-row .btn")];
  const refresh = ()=>{
    $("shrine-cult").textContent = G.cult;
    bets.forEach(b=>{ b.disabled = flipping || G.cult<=0 || (b.dataset.b!=="all" && G.cult < +b.dataset.b); });
    $("shrine-leave").disabled = flipping;
  };
  bets.forEach(b=>{ b.onclick=()=>{
    const bet = b.dataset.b==="all" ? G.cult : +b.dataset.b;
    if(flipping || bet<=0 || G.cult<bet) return;
    flipping = true; G.cult-=bet;
    const cf=$("coinflip"); cf.textContent="🪙"; cf.classList.add("spin");
    refresh(); renderHUD();
    setTimeout(()=>{
      const win = hasRelic("game_watch") || rnd() < (districtAt(G.px,G.py)===3 ? 0.65 : 0.5);
      cf.classList.remove("spin");
      cf.textContent = win?"🌸":"💀";
      sfx(win?"win":"bad");
      if(win && b.dataset.b==="all" && bet>=100) achieve("allin");
      if(win){
        G.cult+=bet*2; clearTile();
        mlog("Shrine flip: WIN. +"+bet+" $CULT. The shrine goes dark.", "good");
        $("shrine-cult").textContent = G.cult; renderHUD();
        setTimeout(()=>{ if(!openDraft("The shrine provides.", null, 1)) closeModal(); },800);
      } else {
        mlog("Shrine flip: lost "+bet+" $CULT.", "bad");
        flipping = false; refresh(); renderHUD();
      }
    },700);
  };});
  $("shrine-leave").onclick=()=>{ if(!flipping) closeModal(); };
  refresh();
}

/* ---------- events ---------- */
function openEvent(){
  const fresh = EVENTS.filter(e=>!G.seen.includes(e.id));
  const ev = choice(fresh.length ? fresh : EVENTS);
  G.seen.push(ev.id); clearTile();
  let html = "<h2>"+ev.icon+" "+ev.name+"</h2><div class='note'><i>"+ev.text+"</i></div>";
  ev.choices.forEach((c,i)=>{
    const off = (c.cost && G.cult<c.cost) || (c.need==="relic" && !G.relics.length) || (c.need && c.need!=="relic" && !setCounts(G.relics)[c.need]);
    html += "<button class='choice' data-i='"+i+"'"+(off?" disabled":"")+"><b>"+c.label+"</b><span>"+c.hint+"</span></button>";
  });
  openModal(html);
  document.querySelectorAll("#modal-panel .choice").forEach(b=>{ b.onclick=()=>{
    const c = ev.choices[+b.dataset.i];
    if(c.cost) G.cult -= c.cost;
    const good = c.odds==null || rnd()<c.odds;
    const out = applyFx(good ? c.fx : c.bad);
    if(ev.id==="exhibit") achieve("exhibit");
    if(ev.id==="ball" && c.need==="squad") achieve("ball");
    const msg = out.length ? out.join(" · ") : "Nothing happens.";
    mlog(ev.icon+" <b>"+ev.name+"</b> — "+msg, good?"good":"bad");
    sfx(good?"heal":"bad");
    renderMap();
    openModal("<h2>"+ev.icon+" "+ev.name+"</h2><div class='note "+(good?"good":"bad")+"'>"+msg+"</div><div class='row'><button class='btn' id='ev-ok'>ok</button></div>");
    $("ev-ok").onclick=()=>closeModal();
  };});
}
function applyFx(list){
  const out = [];
  for(const [k,v] of list){
    switch(k){
      case "cult": G.cult+=v; out.push("+"+v+" $CULT"); break;
      case "cultpct": { const c=Math.floor(G.cult*-v/100); G.cult-=c; out.push("−"+c+" $CULT"); break; }
      case "hp": {
        const before = G.stats.hp;
        G.stats.hp = clamp(G.stats.hp+v, 1, G.stats.maxhp);
        out.push(v>0 ? "+"+(G.stats.hp-before)+" HP" : "−"+(before-G.stats.hp)+" HP"); break;
      }
      case "maxhp": G.bonus.maxhp+=v; G.stats.hp+=v; G.stats.maxhp+=v; recalcStats(); out.push("+"+v+" max HP"); break;
      case "atk": case "spd": G.bonus[k]+=v; recalcStats(); out.push("+"+v+" "+k.toUpperCase()); break;
      case "atkboss": { const n=1+G.bossesBeaten; G.bonus.atk+=n; recalcStats(); out.push("+"+n+" ATK"); break; }
      case "moves":
        G.movesLeft = Math.max(0, G.movesLeft+v); out.push("−"+(-v)+" moves");
        if(G.movesLeft<=0 && !G.queue.includes(endPhase)) G.queue.push(endPhase);
        break;
      case "relic": G.queue.unshift(()=>openDraft("The timeline provides.", null, v||0)); out.push("a relic draft"); break;
      case "seed":
        if(G.seedDug) out.push("someone already dug it up. it was you");
        else { G.seedKnown = true; out.push("the seed phrase is marked on your map"); }
        break;
      case "burn": {
        const gone = choice(G.relics); G.relics = G.relics.filter(r=>r!==gone); recalcStats();
        if(v) G.cult+=v;
        out.push("burned "+relicById(gone).name+(v?" for +"+v+" $CULT":"")); break;
      }
      case "reveal": for(const row of G.fog) row.fill(false); out.push("the whole map is revealed"); break;
      case "fight": { const def = ENEMIES.find(e=>e.id===v);
        G.queue.unshift(()=>startCombat(foeInstance(def), {elite:true})); out.push(def.name+" attacks"); break; }
    }
  }
  return out;
}

/* ---------- campfire ---------- */
function openFire(){
  const day = G.phase==="day";
  openModal("<h2>🔥 CAMPFIRE</h2><div class='note'>Rest until "+(day?"nightfall":"dawn")+"? You heal to full and skip the rest of this "+(day?"day":"night")+" safely — no loot, no fights."
    + (!day && G.bossUnlocked>=0 ? "<br><b class='bad'>"+runBoss(G.bossUnlocked).name+" arrives at dawn.</b>" : "")
    + "</div><div class='row'><button class='btn' id='fire-yes'>REST</button><button class='btn small' id='fire-no'>keep moving</button></div>");
  $("fire-yes").onclick=()=>{
    G.stats.hp=G.stats.maxhp; mlog("Rested. HP restored.", "good"); sfx("heal");
    G.queue = G.queue.filter(f=>f!==endPhase); G.queue.push(endPhase);
    closeModal();
  };
  $("fire-no").onclick=()=>closeModal();
}

/* ---------- boss gate ---------- */
function bossModal(b, title, fightLabel, canWait){
  const face = G.bossLook[G.bossIds.indexOf(b.id)].face;
  openModal("<h2>"+title+"</h2>"+(face?"<img class='boss-face' src='"+face+"' alt=''>":"")+"<div class='note'><i>"+b.intro+"</i></div><div class='stat-line'><span>mechanic</span><b>"+b.mechanic+"</b></div>"
    + "<div class='stat-line'><span>"+b.name+"</span><b>❤️ "+foeInstance(b).hp+" · ⚔️ "+foeInstance(b).atk+" · 🛡️ "+b.arm+" · 💨 "+b.spd+"</b></div>"
    + "<div class='stat-line'><span>your odds right now</span><b>"+oddsText(fightOdds(b, {boss:b}))+"</b></div>"
    + "<div class='row'><button class='btn big' id='boss-fight'>"+fightLabel+"</button>"+(canWait?"<button class='btn small' id='boss-wait'>not yet</button>":"")+"</div>");
}
function openBossGate(){
  const b = runBoss(G.bossUnlocked);
  bossModal(b, "⛩️ "+b.name, "FIGHT", true);
  $("boss-fight").onclick=()=>{ closeModal(); startCombat(foeInstance(b), {boss:b, portrait:G.bossLook[G.bossUnlocked].portrait}); };
  $("boss-wait").onclick=()=>closeModal();
}
function bossArrives(){
  const b = runBoss(G.bossUnlocked);
  mlog("⛩️ <b>"+b.name+" HAS ARRIVED.</b> There is nowhere left to post.", "bad");
  bossModal(b, b.name+"<br>HAS ARRIVED", "FACE IT", false);
  $("boss-fight").onclick=()=>{ closeModal(); startCombat(foeInstance(b), {boss:b, forced:true, portrait:G.bossLook[G.bossUnlocked].portrait}); };
}

/* ---------- build inspector ---------- */
function openBuild(){
  if(!G || G.over || busy()) return;
  const s = G.stats;
  let html = "<h2>YOUR BUILD</h2>"
    + "<div class='stat-line'><span>HP</span><b>"+s.hp+" / "+s.maxhp+"</b></div>"
    + "<div class='stat-line'><span>ATK · ARM · SPD</span><b>"+s.atk+" · "+s.arm+" · "+s.spd+"</b></div>"
    + "<div class='stat-line'><span>crit · dodge</span><b>"+s.crit+"% · "+s.dodge+"%</b></div>"
    + "<div class='stat-line'><span>relic slots</span><b>"+G.relics.length+" / "+G.maxSlots+"</b></div>";
  G.relics.forEach(id=>{ const r=relicById(id);
    html += "<div class='shop-row "+r.rar+"'><img src='"+ICONS[r.id]+"' alt=''><div class='sinfo'><b>"+r.name+"</b><span>"+r.desc+"</span>"+setChips(r, false)+"</div></div>"; });
  if(!G.relics.length) html += "<div class='note'>no relics yet. go loot something.</div>";
  html += "<div class='box-h' style='margin-top:12px'>SYNERGIES</div><div class='syn-list'>"+setsHTML(G.relics, true)+"</div>";
  html += "<div class='row'><button class='btn small' id='build-close'>close</button></div>";
  openModal(html);
  $("build-close").onclick=()=>closeModal();
}

/* ---------- modal helpers ---------- */
function openModal(html){
  const p=$("modal-panel"); p.innerHTML=html; p.scrollTop=0;
  $("modal").classList.remove("hidden");
}
function closeModal(){ $("modal").classList.add("hidden"); setTimeout(pump,0); }

/* THE CANCEL IS COMING — engine part 3: combat, endings, avatar/title screens, init */
function clog(msg, cls){
  const el=$("combat-log"); const d=document.createElement("div");
  if(cls)d.className=cls; d.innerHTML=msg; el.appendChild(d); el.scrollTop=el.scrollHeight;
}
function combatBars(you, foe){
  $("chp-you").style.width=clamp(100*you.hp/you.maxhp,0,100)+"%";
  $("chp-you-t").textContent=Math.max(0,Math.round(you.hp))+" / "+you.maxhp+(you.shield>0?" 🕯️"+you.shield:"");
  $("chp-foe").style.width=clamp(100*foe.hp/foe.maxhp,0,100)+"%";
  $("chp-foe-t").textContent=Math.max(0,Math.round(foe.hp))+" / "+foe.maxhp;
}
function floatText(side, text, cls){
  const d=document.createElement("div"); d.className="float "+(cls||""); d.textContent=text;
  d.style.left=(25+Math.random()*50)+"%";
  $("port-"+side).appendChild(d); setTimeout(()=>d.remove(), 900);
}
function shake(side){
  const c=$("port-"+side); c.classList.remove("hit"); void c.offsetWidth; c.classList.add("hit");
}

/* The fight itself: no DOM and no writes to G, so the same rules can be played on screen
   (startCombat) or run silently many times to estimate the odds (fightOdds).
   io = { log(msg,cls), hit(side,dmg,crit), float(side,text,cls), strip(F) }. */
const NOIO = { log(){}, hit(){}, float(){}, strip(){} };
function fightEngine(foeDef, opts, io){
  const boss = opts.boss || null;
  const st = { relics:[...G.relics], cult:G.cult }; // what the fight may change; the caller writes it back
  let base = G.stats;
  // THE CANCEL: cancels one relic at fight start
  if(boss && boss.id==="cancel" && st.relics.length){
    const gone = choice(st.relics);
    st.relics = st.relics.filter(r=>r!==gone);
    const s = computeStats(st.relics);
    base = {...s, hp: clamp(Math.round(G.stats.hp/G.stats.maxhp*s.maxhp), 1, s.maxhp)};
    io.log("📵 THE CANCEL has cancelled <b>"+relicById(gone).name+"</b>. It is gone.", "bad");
  }
  const you = {...base, stun:0, wartime:true, blunt:true, compTick:0, shield:0, suppressed:new Set()};
  const foe = {...foeDef, poison:0, stun:0, stolen:0};
  const F = { you, foe, st, tick:0, over:false, win:false, fxDelay:0, dodges:0 };
  const act = id => st.relics.includes(id) && !you.suppressed.has(id);
  const set = (id,n) => (you.sets[id]||0) >= n;
  const done = win => {
    if(win && foe.trait==="creeper" && !F.over){ // goes off when it dies, but can't finish you
      const d = Math.min(8, Math.round(you.hp)-1);
      if(d>0){ you.hp-=d; io.log("💥 "+foe.name+" blows up in your face for "+d+".", "bad"); io.hit("you",d,false); }
    }
    F.over=true; F.win=win;
  };
  const heal = n => {
    const before = you.hp;
    you.hp = Math.min(you.maxhp, you.hp + n*(act("heart_tattoo")?2:1));
    if(you.hp>before) io.float("you", "+"+(you.hp-before), "heal");
  };
  const companion = (dmg, msg) => { // every companion hit goes through here so SQUAD applies to all of them
    dmg += set("squad",2) ? 3 : 0;
    foe.hp-=dmg; io.log(msg+" for "+dmg+".", "good"); io.hit("foe",dmg,false);
    if(set("squad",3)) heal(2);
  };
  you.swings = 0; you.block = act("hobbes") ? 1 : 0; you.sure = false; you.hard = 0;
  if(foe.trait==="hard") io.log("🧀 "+foe.name+" goes harder the longer this lasts.", "bad");
  if(foe.trait==="creeper") io.log("💥 "+foe.name+" will blow up when it dies.", "bad");
  if(foe.trait==="bomber") io.log("🎈 "+foe.name+" bombs you from a blimp every 4th tick.", "bad");
  io.strip(F);
  if(boss && boss.id==="lawsuit" && st.relics.length){ // injunction: the first two relics are frozen all fight
    for(const id of st.relics.slice(0,2)) you.suppressed.add(id);
    const s2 = computeStats(st.relics.filter(r=>!you.suppressed.has(r)));
    you.atk=s2.atk; you.arm=s2.arm; you.spd=s2.spd; you.dodge=s2.dodge; you.crit=s2.crit; you.sets=s2.sets;
    io.log("⚖️ INJUNCTION: "+st.relics.slice(0,2).map(id=>relicById(id).name).join(" and ")+" frozen.", "bad");
    io.strip(F);
  }
  if(foe.trait==="mirror"){ foe.atk = Math.max(foe.atk, Math.round(you.atk*0.6)); io.log("🪞 "+foe.name+" copies your style.", "bad"); }
  if(foe.trait==="thief") io.log("💸 "+foe.name+" steals $CULT with every hit. Kill it to get it back.", "bad");
  you.shield = (act("network_spirituality")?12:0) + (act("jesus_tank")?8:0) + (set("cult",2)?8:0);
  if(you.shield) io.log("🕯️ You start shielded for "+you.shield+".", "good");
  if(act("cookie") && you.hp<you.maxhp){ heal(10); io.log("🍪 Cookie. You feel better.", "good"); }
  if(act("vibe_shift")){ foe.stun=1; io.log("🌀 Vibe shift. "+foe.name+" is caught off guard.", "good"); }

  function dmgCalc(att, def, isYou){
    let atk = att.atk;
    if(boss && boss.id==="bonkler911") atk *= (0.5+rnd()); // chaos
    if(isYou && you.hp < you.maxhp/2 && act("blood_splatter")) atk += 5;
    if(isYou && act("scarface")) atk += Math.min(8, Math.floor(st.cult/40));
    if(isYou) atk += you.hard;
    if(!isYou && act("beetleposting")) atk *= 0.8;
    const critC = isYou ? you.crit : (act("airpods") ? 0 : 5 + att.lck/2);
    const arm = isYou && act("energy_sword") ? 0 : def.arm;
    let dmg = Math.max(1, Math.round(atk - arm + randi(-1,1)));
    let crit = false;
    if(rnd()*100 < critC || (isYou && you.sure)){ dmg *= isYou && set("hype",4) ? 3 : 2; crit=true; }
    if(isYou) you.sure = false;
    if(isYou && crit && act("cigarette")) dmg += 4;
    if(!isYou && def===you && act("fbi_cap")) dmg = Math.max(1, dmg-2);
    if(!isYou && def===you && you.hp < you.maxhp/2 && act("hodl")) dmg = Math.max(1, Math.round(dmg*0.7));
    if(isYou && you.blunt && act("blunt")){ dmg*=3; you.blunt=false; crit=true; }
    return {dmg, crit};
  }
  function strike(att, def, isYou){
    const an = isYou?"You":foe.name, dn = isYou?foe.name:"you";
    // bonkler redirect
    if(!isYou && act("bonkler") && rnd()<0.15){
      const {dmg,crit}=dmgCalc(foe,foe,false);
      foe.hp-=dmg; io.log("🌀 Bonkler chaos! "+foe.name+" hits itself for "+dmg+".", crit?"crit":"good");
      io.hit("foe", dmg, crit);
      return;
    }
    if(!isYou && you.block){ you.block=0; io.log("🐯 Hobbes takes the hit for you.", "good"); io.float("you","blocked","heal"); return; }
    // dodge
    if(!isYou && rnd()*100 < (you.dodge||0)){
      io.log("💨 You dodge.", "good"); io.float("you","dodge","heal"); F.dodges++;
      if(act("cat_ears")) heal(3);
      if(act("matrix")) you.sure = true;
      if(set("schizo",4)){ const d = Math.max(1, you.atk-foe.arm); foe.hp-=d; io.log("📡 You strike back for "+d+".", "good"); io.hit("foe",d,false); }
      return;
    }
    let {dmg,crit}=dmgCalc(att,def,isYou);
    if(!isYou && you.shield>0){
      const soak = Math.min(you.shield, dmg); you.shield-=soak; dmg-=soak;
      if(!dmg){ io.log("🕯️ Your shield absorbs "+soak+".", "good"); io.float("you","shield","heal"); return; }
    }
    def.hp-=dmg;
    io.log((crit?"✨ CRIT! ":"")+an+" hit "+dn+" for <b>"+dmg+"</b>.", crit?"crit":(isYou?"good":"bad"));
    io.hit(isYou?"foe":"you", dmg, crit);
    if(isYou && set("cheese",3)){ st.cult+=3; }
    if(isYou && crit && act("trucker")) heal(5);
    if(isYou && crit && act("golden_axe") && !def.stun){ def.stun=1; io.log("🪓 "+dn+" is stunned!", "good"); }
    if(!isYou && act("evil_eye")){ foe.hp-=2; io.log("🧿 Evil Eye reflects 2.", "good"); }
    if(!isYou && foe.trait==="thief" && st.cult>0){ const n=Math.min(st.cult,8); st.cult-=n; foe.stolen+=n; io.log("💸 "+foe.name+" pockets "+n+" $CULT.", "bad"); }
    // stun
    if(isYou && act("balenciaga_bat") && rnd()<0.12){ def.stun=1; io.log("🦇 "+dn+" is stunned!", "good"); }
    // poison
    if(isYou && act("snakebites")){ def.poison=3; }
  }
  function lethalCheck(){
    if(you.hp>0) return false;
    if(you.wartime && act("wartime_pfp")){
      you.wartime=false; you.hp=1; io.log("🕊️ <b>WARTIME PFP</b> saves you!", "good");
      io.float("you","saved!","heal");
      return false;
    }
    if(act("reserve")){
      st.relics = st.relics.filter(r=>r!=="reserve"); you.hp=you.maxhp; io.strip(F);
      io.log("🔥 <b>BURN TO REDEEM.</b> The Bonkler Reserve is gone. You are whole.", "good");
      io.float("you","redeemed!","heal");
      return false;
    }
    return true;
  }
  F.step = function(){
    if(F.over) return;
    F.tick++; F.fxDelay=0;
    // boss: allegations suppression (a suppressed relic gives nothing this tick, stats included)
    if(boss && boss.id==="allegations"){
      you.suppressed.clear();
      if(rnd()<0.25 && st.relics.length && !st.relics.includes("tinfoil")){
        const s = choice(st.relics); you.suppressed.add(s);
        io.log("📢 FUD suppresses your "+relicById(s).name+"!", "bad");
      }
      const s2 = computeStats(st.relics.filter(r=>!you.suppressed.has(r)));
      you.atk=s2.atk; you.arm=s2.arm; you.spd=s2.spd; you.dodge=s2.dodge; you.crit=s2.crit; you.sets=s2.sets;
      io.strip(F);
    }
    if(boss && boss.id==="drain" && st.cult>0){
      const n = Math.min(st.cult, 15); st.cult-=n; foe.stolen+=n; foe.atk = foeDef.atk + Math.floor(foe.stolen/60);
      io.log("🏦 DRAINED: "+n+" $CULT gone. ("+foe.stolen+" so far)", "bad");
    }
    if(boss && boss.id==="shift" && F.tick%4===0){
      const t = you.atk; you.atk = foe.atk; foe.atk = t;
      io.log("🌀 VIBE SHIFT: you now hit for "+you.atk+", it hits for "+foe.atk+".", "bad");
    }
    // cancel ratio
    if(boss && boss.id==="cancel" && F.tick%5===0){ const r = act("tinfoil") ? 2 : 5; you.hp-=r; io.log("📉 RATIO'D — "+r+" pure damage.", "bad"); io.hit("you",r,false); }
    // regen
    if(F.tick%3===0){
      if(foe.trait==="hard"){ foe.atk+=1; io.log("🧀 "+foe.name+" goes harder. ATK "+foe.atk+".", "bad"); }
      if(set("cheese",2)){ you.hard+=1; io.float("you","+1 ATK","heal"); }
    }
    if(foe.trait==="bomber" && F.tick%4===0){ you.hp-=8; io.log("🎈 Blimp bombing! 8 damage.", "bad"); io.hit("you",8,false); }
    const regen = (act("cult_robe")?2:0) + (act("lollipop")?1:0) + (set("kawaii",4)?2:0);
    if(regen) heal(regen);
    if(set("cult",3) && F.tick%4===0){ you.shield+=4; io.float("you","+4 shield","heal"); }
    // poison ticks
    if(foe.poison>0){ const d = act("milady_pilled") ? 6 : 2; foe.poison--; foe.hp-=d; io.log("🐍 Poison bites "+foe.name+" for "+d+".", "good"); io.float("foe","-"+d,"psn"); }
    if(act("pikachu") && F.tick%4===0){ foe.hp-=8; io.log("⚡ Pikachu Suit shocks "+foe.name+" for 8.", "good"); io.hit("foe",8,false); }
    // companions
    you.compTick++;
    for(let k = act("gold_sonic") ? 2 : 1; k>0 && foe.hp>0; k--){
      if(act("remilio_friend") && you.compTick%3===0) companion(5, "🧸 Remilio Friend strikes");
      if(act("tails") && rnd()<0.3) companion(4, "🦊 Tails spins in");
      if(act("dino") && you.compTick%2===0) companion(3, "🦖 Dino bites");
      if(act("amogus") && !boss && foe.hp>0 && rnd()<0.2){
        foe.hp=0; io.log("👽 AMOGUS was the impostor. Instant kill.", "crit");
      }
    }
    if(foe.hp<=0) return done(true);
    if(lethalCheck()) return done(false);
    const order = you.spd>=foe.spd ? [true,false] : [false,true];
    for(const isYou of order){
      const att = isYou?you:foe, def = isYou?foe:you;
      F.fxDelay = isYou===order[0] ? 0 : 270; // the second striker's visuals land a beat later
      if(att.stun>0){ att.stun--; io.log((isYou?"You are":foe.name+" is")+" stunned.", ""); continue; }
      strike(att,def,isYou);
      if(foe.hp<=0) return done(true);
      if(lethalCheck()) return done(false);
      if(isYou && ((set("armed",3) && ++you.swings%3===0) || (set("bonkler",4) && rnd()<0.25))){
        io.log("⚡ You strike again!", "good");
        strike(you,foe,true);
        if(foe.hp<=0) return done(true);
      }
    }
  };
  return F;
}
/* win chance and typical HP left against a foe, from silent trial fights with the current build */
let oddsCache = {};
function fightOdds(def, opts={}){
  const s = G.stats;
  const key = [def.id, G.day, G.relics.join(), s.hp, s.maxhp, s.atk, s.arm, s.spd, G.kills, G.cult>0].join("|");
  if(oddsCache[key]) return oddsCache[key];
  const foe = foeInstance(def), N = 40;
  let wins=0, hp=0;
  const keep = SEED; SEED = null; // trial fights must not use up the run's own luck
  for(let i=0;i<N;i++){
    const F = fightEngine(foe, opts, NOIO);
    for(let n=0; !F.over && n<3000; n++) F.step();
    if(F.win){ wins++; hp+=Math.max(1,F.you.hp); }
  }
  SEED = keep;
  const p = wins/N;
  return oddsCache[key] = { p, hp: wins ? Math.round(hp/wins) : 0, tag: p>=0.85?"easy":p>=0.6?"fair":p>=0.35?"risky":"deadly" };
}
function oddsText(o){
  return "<span class='odds "+o.tag+"'>"+o.tag+" · win "+Math.round(o.p*100)+"%"+(o.p?" · ~"+o.hp+" HP left":"")+"</span>";
}

let combatTok = 0;
function startCombat(foeDef, opts={}){
  const boss = opts.boss || null, tok = ++combatTok;
  show("screen-combat");
  $("btn-combat-done").classList.add("hidden");
  $("combat-ctl").classList.remove("hidden");
  $("combat-log").innerHTML="";
  $("combat-title").textContent = opts.label || (boss ? boss.name : "WILD "+foeDef.name.toUpperCase());
  $("foe-name").textContent = foeDef.name.toUpperCase();
  $("you-name").textContent = G.name.toUpperCase();
  $("port-foe").classList.toggle("boss", !!boss);
  for(const s of ["you","foe"]) $("port-"+s).classList.remove("hit","dead");
  paint($("combat-you"), G.avatar);
  const fc = $("combat-foe"); fc.width=4; fc.height=5;
  (opts.portrait || foePortrait(foeDef, pinnedPicks(foeDef))).then(cv=>{ if(tok===combatTok) paint(fc, cv); });
  sfx(boss ? "boss" : "fight");

  let quiet=false, timer=null, F=null;
  const fx = fn => {
    if(quiet) return;
    const run = ()=>{ if(tok===combatTok) fn(); }, d = F ? F.fxDelay/META.speed : 0;
    d ? setTimeout(run, d) : run();
  };
  const io = {
    log: clog,
    hit: (side,dmg,crit)=>fx(()=>{ floatText(side, "-"+dmg, crit?"crit":"dmg"); shake(side); sfx(crit?"crit":side==="you"?"hurt":"hit"); if(crit) quake(); }),
    float: (side,text,cls)=>fx(()=>floatText(side,text,cls)),
    strip: f=>{
      // relics can vanish mid-fight (cancelled, burned): keep the build and the portrait in step
      if(G.relics.join()!==f.st.relics.join()){ G.relics=[...f.st.relics]; G.worn=G.relics.join(); refreshAvatar(); }
      $("combat-relics").innerHTML = f.st.relics.map(id=>{ const r=relicById(id);
        return "<img class='relic-ico"+(f.you.suppressed.has(id)?" off":"")+"' src='"+ICONS[id]+"' alt='"+r.name+"' title='"+r.name+" — "+r.desc.replace(/'/g,"&#39;")+"'>"; }).join("");
    },
  };
  F = fightEngine(foeDef, opts, io);
  const you = F.you, foe = F.foe;
  combatBars(you, foe);
  const speedBtn = $("btn-speed");
  speedBtn.textContent = META.speed+"X";
  speedBtn.onclick=()=>{ META.speed = META.speed>=4 ? 1 : META.speed*2; speedBtn.textContent=META.speed+"X"; saveMeta(); sfx("click"); };
  $("btn-skip").onclick=()=>{
    if(F.over) return;
    quiet=true; clearTimeout(timer);
    for(let n=0; !F.over && n<5000; n++) F.step();
    finish();
  };
  function finish(){
    clearTimeout(timer);
    combatBars(you,foe);
    $("combat-ctl").classList.add("hidden"); $("combat-choice").classList.add("hidden");
    const win = F.win;
    $("port-"+(win?"foe":"you")).classList.add("dead");
    const btn=$("btn-combat-done"); btn.classList.remove("hidden");
    G.relics = [...F.st.relics]; G.cult = F.st.cult;
    if(win){
      G.kills++;
      achieve("first");
      if(foe.id==="kumicho") achieve("shark");
      if(F.dodges>=5) achieve("dodge");
      if(foe.id==="fud"){ G.fudKills=(G.fudKills||0)+1; if(G.fudKills>=3) achieve("fud"); }
      if(boss) achieve(["allegations","bonkler911","win"][G.bossIds.indexOf(boss.id)]);
      let c = randi(foe.cult[0], foe.cult[1]);
      c = Math.round(c * (G.stats.cultMult||1) * (districtAt(G.px,G.py)===1 ? 1.5 : 1) * (opts.elite?1.5:1) * ((opts.elite||boss) && hasRelic("remilionaire") ? 2 : 1));
      if(hasRelic("no_meme") && rnd()<0.2){ c*=3; clog("💌 There is no meme. I love you. The floor triples.", "crit"); }
      G.cult += c + foe.stolen;
      clog("🏆 Victory! +"+c+" $CULT."+(foe.stolen?" Recovered "+foe.stolen+" stolen.":""), "good");
      if(hasRelic("silver_coin")){ G.cult+=15; clog("🪙 Silver Coin: +15 $CULT.", "good"); }
      const hm = hasRelic("heart_tattoo") ? 2 : 1;
      for(const [id,n,label] of [["birthday_hat",15,"🎂 Birthday Hat"],["maid",6,"🧹 Maid Outfit"],["strawberry",3,"🍓 Strawberry Earring"]])
        if(hasRelic(id)){ you.hp=Math.min(you.maxhp,you.hp+n*hm); clog(label+": +"+n*hm+" HP.", "good"); }
      const hp = clamp(Math.round(you.hp),1,you.maxhp);
      recalcStats(); // kills and burned relics change the build
      G.stats.hp = Math.min(hp, G.stats.maxhp);
      floatText("foe", "+"+c+" $CULT", "loot");
      sfx("win"); if(boss) burst("👑✨🌸💖");
      btn.textContent="CONTINUE →";
      btn.onclick=()=>{
        show("screen-map");
        if(boss) onBossDown(boss, opts.forced);
        else if(rnd() < (opts.elite?0.6:0.25)) openDraft("The fallen drops something.", null, opts.elite?1:0);
        pump();
      };
    } else {
      G.stats.hp = 0;
      clog("💀 You died.", "bad");
      sfx("lose"); quake();
      btn.textContent="LOG OFF 💀";
      btn.onclick=()=>endRun(false);
    }
  }
  let asked = false;
  const choiceBox = $("combat-choice");
  choiceBox.classList.add("hidden");
  function ask(){ // once per boss, at half health: the fight stops and waits for you
    asked = true;
    const opts2 = [
      ["CLAP BACK", "spend 50 $CULT: hit it for 22", F.st.cult>=50, ()=>{ F.st.cult-=50; foe.hp=Math.max(1,foe.hp-22); clog("📣 You clap back for 22.", "crit"); floatText("foe","-22","crit"); shake("foe"); }],
      ["TOUCH GRASS", "heal 18 HP, but it gains +2 ATK", true, ()=>{ you.hp=Math.min(you.maxhp,you.hp+18); foe.atk+=2; clog("🌱 You touch grass. +18 HP. It gets angrier.", "good"); floatText("you","+18","heal"); }],
      ["POST THROUGH IT", "+3 ATK for the rest of the fight, lose 6 HP", true, ()=>{ you.hard+=3; you.hp=Math.max(1,you.hp-6); clog("⌨️ You post through it. +3 ATK.", "good"); floatText("you","+3 ATK","heal"); }],
    ];
    choiceBox.innerHTML = "<div class='kicker'>"+boss.name+" is at half health — your move</div>"
      + opts2.map((o,i)=>"<button class='choice' data-i='"+i+"'"+(o[2]?"":" disabled")+"><b>"+o[0]+"</b><span>"+o[1]+"</span></button>").join("");
    choiceBox.classList.remove("hidden"); $("combat-ctl").classList.add("hidden");
    sfx("boss");
    choiceBox.querySelectorAll(".choice").forEach(b=>{ b.onclick=()=>{
      opts2[+b.dataset.i][3](); sfx("click");
      choiceBox.classList.add("hidden"); $("combat-ctl").classList.remove("hidden");
      combatBars(you,foe); timer=setTimeout(loop, 500);
    };});
  }
  function loop(){
    F.step(); combatBars(you,foe);
    if(F.over) return finish();
    if(boss && !asked && foe.hp<=foe.maxhp/2) return ask();
    timer=setTimeout(loop, 600/META.speed);
  }
  timer = setTimeout(loop, 500);
}

/* ---------- boss down / endings ---------- */
function onBossDown(boss, forced){
  G.bossesBeaten++;
  G.bossUnlocked=-1; // the gate seals again until the next one
  G.maxSlots++;
  recalcStats();
  G.stats.hp=G.stats.maxhp;
  $("boss-banner").classList.add("hidden");
  mlog("👑 <b>"+boss.name+" defeated!</b> +1 relic slot, HP restored.", "gold");
  if(boss.id==="cancel"){ endRun(true); return; }
  G.queue.unshift(()=>{ // boss tribute always offers at least one relic above common
    const pool = rollRelics(3, 3);
    if(pool.length && pool.every(r=>r.rar==="common")){ const up = rollRelics(40, 0).find(r=>r.rar!=="common"); if(up) pool[0] = up; }
    openDraft("The timeline yields tribute.", pool);
  });
  if(forced) G.queue.push(()=>{ G.day++; startDay(); });
}
function buildRow(){
  return G.relics.length ? "<div class='build-row'>"+G.relics.map(id=>"<img class='relic-ico' src='"+ICONS[id]+"' alt='' title='"+relicById(id).name+"'>").join("")+"</div>" : "";
}
function countUp(el, from, to, ms){
  const t0 = performance.now();
  const f = now => { const k = Math.min(1,(now-t0)/ms); el.textContent = Math.round(from+(to-from)*(1-Math.pow(1-k,3))); if(k<1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
/* the end-of-run screen: what the run was worth, and how close the next unlock is */
function endRun(win){
  G.over=true; clearRun();
  if(win) achieve("win");
  document.body.classList.remove("danger");
  const parts = [["day "+G.day+" reached", G.day*15], [G.bossesBeaten+" / 3 bosses", G.bossesBeaten*60], [G.kills+" kills", G.kills*2], [G.cult+" $CULT banked", Math.floor(G.cult/25)]];
  if(win) parts.push(["timeline saved", 300]);
  if(G.heat) parts.push(["heat "+G.heat+" bonus", Math.round(parts.reduce((a,p)=>a+p[1],0)*0.25*G.heat)]);
  const d = parts.reduce((a,p)=>a+p[1], 0);
  if(win && G.heat>=(META.heat||0) && G.heat<HEAT.length){ META.heat = G.heat+1; G.heatUp = true; }
  let dailyNote = "";
  if(G.daily){
    const old = META.daily && META.daily.date===G.daily ? META.daily.score : 0;
    if(d>old) META.daily = {date:G.daily, score:d, day:G.day, win};
    dailyNote = "<div class='note good'>📅 DAILY "+G.daily+" — "+(d>old ? "new best: "+d : "your best today: "+old)+"</div>";
  }
  const best = !win && G.day>META.best && META.runs>0;
  META.drip+=d; META.runs++;
  if(win){ META.wins++; META.best=9; } else META.best=Math.max(META.best,G.day);
  saveMeta();
  const next = UNLOCKS.filter(u=>!META.unlocks[u.id] && !(u.req && !META.unlocks[u.req])).sort((a,b)=>a.cost-b.cost)[0];
  let html = "<h2>"+(win?"🌸 TIMELINE SAVED":"💀 CANCELLED")+"</h2><div class='note'>"
    + (win ? G.name+" survived THE CANCEL.<br>The Miladys post through it." : G.name+" has been ratio'd off the timeline.")+"</div>"
    + "<canvas id='end-avatar' class='end-avatar"+(win?"":" dead")+"'></canvas>"+buildRow()
    + dailyNote
    + (G.heatUp ? "<div class='note good'>🔥 HEAT "+META.heat+" unlocked — "+HEAT[META.heat-1]+"</div>" : "")
    + (best ? "<div class='note good'>✨ NEW BEST — day "+G.day+"</div>" : "")
    + (G.newAch ? "<div class='note good'>🏆 "+G.newAch+" achievement"+(G.newAch>1?"s":"")+" unlocked</div>" : "")
    + (G.newSeen ? "<div class='note good'>📖 "+G.newSeen+" new relic"+(G.newSeen>1?"s":"")+" discovered</div>" : "")
    + parts.map(p=>"<div class='stat-line'><span>"+p[0]+"</span><b>+"+p[1]+"</b></div>").join("")
    + "<div class='drip-total'>DRIP EARNED <b id='end-drip'>0</b></div>";
  if(next){
    const can = META.drip>=next.cost;
    html += "<div class='next-unlock'><div class='stat-line'><span>"+(can?"you can afford":"next unlock")+"</span><b>"+next.name+" · "+Math.min(META.drip,next.cost)+" / "+next.cost+"</b></div>"
      + "<div class='bar'><div style='width:"+clamp(100*META.drip/next.cost,0,100)+"%'></div></div></div>";
  }
  html += "<div class='row'><button class='btn big' id='end-again'>"+(win?"RUN IT BACK":"ONE MORE RUN")+"</button><button class='btn small' id='end-title'>"+(next && META.drip>=next.cost?"spend drip ✨":"unlocks")+"</button><button class='btn small' id='end-card'>save card 📸</button></div>";
  openModal(html);
  paint($("end-avatar"), win ? G.avatar : fry(G.avatar, "CANCELLED"));
  countUp($("end-drip"), 0, d, 900);
  if(win){ sfx("fanfare"); burst("🌸✨💖🎀👑"); }
  $("end-again").onclick=()=>{ sfx("click"); leaveRun(); $("btn-begin").disabled=true; show("screen-avatar"); genAvatar(); };
  $("end-title").onclick=()=>{ sfx("click"); leaveRun(); renderTitle(); show("screen-title"); };
  const run = G;
  $("end-card").onclick=async()=>{
    sfx("click");
    const cv = await shareCard(run, win, d);
    cv.toBlob(b=>{ const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="the-cancel-is-coming-"+run.name.replace(/\W+/g,"-")+".png"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000); });
  };
}
/* a 1200x630 image of the run, for posting */
async function shareCard(run, win, drip){
  const cv = document.createElement("canvas"); cv.width=1200; cv.height=630;
  const cx = cv.getContext("2d");
  const bg = cx.createLinearGradient(0,0,1200,630); bg.addColorStop(0,"#2a0f24"); bg.addColorStop(0.55,"#0b0a14"); bg.addColorStop(1,"#10203a");
  cx.fillStyle = bg; cx.fillRect(0,0,1200,630);
  for(let i=0;i<140;i++){ cx.fillStyle="rgba(255,255,255,"+(0.15+Math.random()*0.5)+")"; cx.fillRect(Math.random()*1200, Math.random()*630, 2, 2); }
  // the Milady, on her stage
  const st = cx.createRadialGradient(250,250,20,250,300,330); st.addColorStop(0,"#ffe9f4"); st.addColorStop(0.5,"#f3bfdc"); st.addColorStop(1,"#8468c9");
  cx.fillStyle = st; cx.beginPath(); cx.roundRect(50,60,400,500,28); cx.fill();
  cx.save(); cx.beginPath(); cx.roundRect(50,60,400,500,28); cx.clip();
  cx.drawImage(win ? run.avatar : fry(run.avatar, "CANCELLED"), 50, 60, 400, 500); cx.restore();
  cx.lineWidth = 6; cx.strokeStyle = "#c54e71"; cx.beginPath(); cx.roundRect(50,60,400,500,28); cx.stroke();
  const font = (px, w) => { cx.font = (w||"bold")+" "+px+"px ui-rounded, 'Comic Sans MS', 'Arial Rounded MT Bold', system-ui, sans-serif"; };
  const text = (t, x, y, px, color, w) => { font(px, w); cx.fillStyle = color; cx.fillText(t, x, y); };
  cx.textBaseline = "alphabetic";
  font(54); cx.fillStyle="#c54e71"; cx.fillText("THE CANCEL IS COMING", 503, 113); cx.fillStyle="#f3e3b5"; cx.fillText("THE CANCEL IS COMING", 500, 110);
  const tribe = TRIBES.find(t=>t.id===run.tribe) || TRIBES[0];
  text(run.name+" · "+tribe.name+(run.heat?" · heat "+run.heat:"")+(run.daily?" · daily "+run.daily:""), 500, 160, 28, "#ff9ecb");
  text(win ? "TIMELINE SAVED" : "CANCELLED ON DAY "+run.day, 500, 240, 50, win ? "#a6ff5e" : "#ff6b6b");
  text(run.bossesBeaten+" / 3 bosses   ·   "+run.kills+" kills   ·   "+run.cult+" $CULT", 500, 290, 28, "#ece7dd", "normal");
  text("DRIP", 500, 370, 26, "#9794b0"); text(String(drip), 500, 440, 80, "#ffd75e");
  const sets = setRows(run.relics).filter(r=>r.on.length).map(r=>r.t.name+" "+r.c).join("   ");
  if(sets) text(sets, 720, 420, 24, "#b9a4ff");
  // relics
  const ims = await Promise.all(run.relics.map(id=>loadImg(ICONS[id]).catch(()=>null)));
  ims.forEach((im,i)=>{
    const x = 500+i*92, y = 470;
    cx.fillStyle = "#1a1730"; cx.beginPath(); cx.roundRect(x,y,82,82,14); cx.fill();
    cx.lineWidth = 3; cx.strokeStyle = {rare:"#ffd75e", legendary:"#ff9ecb", cursed:"#b9a4ff"}[relicById(run.relics[i]).rar] || "#37325e"; cx.stroke();
    if(im) cx.drawImage(im, x+5, y+5, 72, 72);
  });
  text(location.host || "thecancel.is/coming", 500, 600, 20, "#6b6885", "normal");
  return cv;
}
function leaveRun(){
  SEED = null; stopTravel();
  $("modal").classList.add("hidden");
  $("boss-banner").classList.add("hidden");
}

/* ---------- avatar screen ---------- */
let AVA = null, avaTok = 0;
const PICK = { tribe:"", heat:0, daily:"" }; // what the avatar screen is setting up
const today = () => new Date().toISOString().slice(0,10);
function renderPicks(){
  if(!TRIBES.some(t=>t.id===PICK.tribe)) PICK.tribe = META.tribe || TRIBES[0].id;
  PICK.heat = clamp(PICK.heat, 0, META.heat||0);
  $("tribes").innerHTML = TRIBES.map(t=>"<button class='pick"+(t.id===PICK.tribe?" on":"")+"' data-t='"+t.id+"'>"+t.icon+" "+t.name+"</button>").join("");
  const t = TRIBES.find(x=>x.id===PICK.tribe), r = relicById(t.relic);
  $("tribe-desc").innerHTML = "<img class='relic-ico' src='"+(ICONS[r.id]||"")+"' alt=''><div><b>"+t.desc+"</b><span>starts with "+r.name+" — "+r.desc+"</span></div>";
  $("tribes").querySelectorAll(".pick").forEach(b=>{ b.onclick=()=>{ PICK.tribe=b.dataset.t; META.tribe=PICK.tribe; saveMeta(); sfx("click"); renderPicks(); }; });
  const max = META.heat||0;
  $("heat-row").innerHTML = PICK.daily ? "<div class='note good'>📅 DAILY RUN "+PICK.daily+" — same maze and same luck for everyone today</div>"
    : !max ? "" : "<div class='kicker'>heat</div><div class='pick-row'>"+Array.from({length:max+1},(_,i)=>"<button class='pick"+(i===PICK.heat?" on":"")+"' data-h='"+i+"'>"+(i?"🔥 "+i:"off")+"</button>").join("")+"</div>"
      + "<div class='note'>"+(PICK.heat ? HEAT.slice(0,PICK.heat).join(" · ")+" · +"+25*PICK.heat+"% DRIP" : "beat THE CANCEL to unlock the next heat")+"</div>";
  $("heat-row").querySelectorAll(".pick").forEach(b=>{ b.onclick=()=>{ PICK.heat=+b.dataset.h; sfx("click"); renderPicks(); }; });
}
async function genAvatar(){
  const tok = ++avaTok;
  const ava = { picks: basePicks(), name: choice(NAMES) };
  ava.canvas = await composeAvatar(ava.picks, []);
  if(tok!==avaTok) return;
  AVA = ava;
  const cv = $("avatar-canvas");
  paint(cv, ava.canvas); paint($("hud-avatar"), ava.canvas);
  cv.classList.remove("pop"); void cv.offsetWidth; cv.classList.add("pop");
  $("avatar-name").textContent = ava.name;
  renderPicks();
  $("btn-begin").disabled = false;
}

/* ---------- title / unlocks ---------- */
function renderTitle(){
  $("meta-drip").textContent=META.drip; $("meta-wins").textContent=META.wins;
  $("meta-best").textContent=META.best?("day "+META.best):"—";
  const shop=$("unlock-shop"); shop.innerHTML="<div class='kicker'>drip unlocks</div>";
  for(const u of UNLOCKS){
    const owned=!!META.unlocks[u.id];
    const locked=u.req && !META.unlocks[u.req];
    const d=document.createElement("div"); d.className="unlock"+(owned?" owned":"");
    d.innerHTML="<div class='uinfo'><b>"+u.name+"</b><span>"+u.desc+"</span></div>";
    const b=document.createElement("button"); b.className="btn small";
    b.textContent=owned?"OWNED":(locked?"LOCKED":u.cost+" DRIP");
    b.disabled=owned||locked||META.drip<u.cost;
    if(!b.disabled) b.onclick=()=>{
      META.drip-=u.cost; META.unlocks[u.id]=1; saveMeta(); renderTitle();
    };
    d.appendChild(b); shop.appendChild(d);
  }
  renderCodex();
  const save = loadRun(), c = $("btn-continue");
  c.classList.toggle("hidden", !save);
  if(save) c.textContent = "CONTINUE · "+save.name+" · day "+save.day;
  const dd = META.daily && META.daily.date===today() ? META.daily : null;
  $("btn-daily").textContent = "📅 daily run"+(dd ? " · best "+dd.score : "");
  $("btn-start").textContent = save ? "new run" : "ENTER THE TIMELINE";
  $("btn-start").className = save ? "btn small" : "btn big";
}
function renderCodex(){ // every relic you have ever held; the rest stay silhouettes, or locks if an achievement gates them
  const pool = RELICS.filter(r=>!r.tags.includes("blackmarket") || META.unlocks.blackmarket);
  const have = pool.filter(r=>META.seen[r.id]).length;
  $("codex").innerHTML = "<div class='kicker'>relics discovered · "+have+" / "+pool.length+"</div><div class='codex-grid'>"
    + pool.map(r=>{
        const a = LOCKED[r.id] && !META.ach[LOCKED[r.id]] && ACHIEVEMENTS.find(x=>x.id===LOCKED[r.id]);
        if(a) return "<div class='relic-ico unknown locked' title='locked — "+a.name+": "+a.desc.replace(/'/g,"&#39;")+"'>🔒</div>";
        return META.seen[r.id] && ICONS[r.id]
          ? "<img class='relic-ico "+rarity(r)+"' src='"+ICONS[r.id]+"' alt='"+r.name+"' title='"+r.name+" — "+r.desc.replace(/'/g,"&#39;")+"'>"
          : "<div class='relic-ico unknown' title='undiscovered'>?</div>";
      }).join("")+"</div>";
  const done = ACHIEVEMENTS.filter(a=>META.ach[a.id]).length;
  $("achievements").innerHTML = "<div class='kicker'>achievements · "+done+" / "+ACHIEVEMENTS.length+"</div>"
    + ACHIEVEMENTS.map(a=>{
        const r = relicById(a.relic), on = !!META.ach[a.id];
        return "<div class='ach"+(on?" on":"")+"'>"+(ICONS[r.id] ? "<img class='relic-ico "+r.rar+"' src='"+ICONS[r.id]+"' alt=''>" : "<div class='relic-ico unknown'>?</div>")
          + "<div class='uinfo'><b>"+(on?"🏆 ":"")+a.name+"</b><span>"+a.desc+"</span><span class='rew'>unlocks <b class='"+r.rar+"'>"+r.name+"</b> — "+r.desc+"</span></div></div>";
      }).join("");
}
function openTutorial(){
  openModal("<h2>HOW TO SURVIVE</h2>"
    + "<div class='shop-row'><div class='heal-ico'>👣</div><div class='sinfo'><b>Find your way through the maze</b><span>Every step burns daylight. Loot hides in dead ends; scroll or drag the map to look around. Hover a tile (or tap a foe once) to scout it first.</span></div></div>"
    + "<div class='shop-row'><div class='heal-ico'>🎁</div><div class='sinfo'><b>Loot relics, wear them</b><span>Fights are automatic. Your build does the fighting — the odds are shown before you commit.</span></div></div>"
    + "<div class='shop-row'><div class='heal-ico'>🌙</div><div class='sinfo'><b>Night brings FUD demons</b><span>Campfires heal you and skip to the next dawn or dusk.</span></div></div>"
    + "<div class='shop-row'><div class='heal-ico'>⛩️</div><div class='sinfo'><b>Days 3, 6 and 9: a boss</b><span>Fight it at the gate when you're ready, or it finds you when that night ends.</span></div></div>"
    + "<div class='row'><button class='btn big' id='tut-ok'>GOT IT</button></div>");
  $("tut-ok").onclick=()=>{ META.tut=true; saveMeta(); sfx("click"); closeModal(); };
}

/* ---------- keyboard ---------- */
const KEY_DIRS = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0], w:[0,-1], s:[0,1], a:[-1,0], d:[1,0] };
function onKey(ev){
  if(!G || G.over || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if($("screen-combat").classList.contains("active")){
    const done = $("btn-combat-done");
    if(ev.key==="Enter" || ev.key===" "){ ev.preventDefault(); (done.classList.contains("hidden") ? $("btn-skip") : done).click(); }
    return;
  }
  const dir = KEY_DIRS[ev.key.length===1 ? ev.key.toLowerCase() : ev.key];
  if(!dir || busy()) return;
  stopTravel();
  ev.preventDefault();
  tryMove(G.px+dir[0], G.py+dir[1]);
}

/* ---------- init ---------- */
async function init(){
  loadMeta(); renderTitle(); setMute(META.mute);
  let ready = loadAssets().then(renderCodex); // start loading right away so ENTER is instant
  ready.catch(()=>{});
  $("btn-continue").onclick=async()=>{
    const d = loadRun(); if(!d) return renderTitle();
    $("btn-continue").disabled=true;
    try{ await ready; await resumeRun(d); sfx("relic"); }
    catch(e){ clearRun(); renderTitle(); }
    $("btn-continue").disabled=false;
  };
  $("btn-daily").onclick=()=>{ PICK.daily = today(); $("btn-start").click(); };
  $("minimap").onclick=()=>$("minimap").classList.toggle("big");
  $("btn-start").onclick=async(ev)=>{
    if(ev && ev.isTrusted) PICK.daily = ""; // a real click on this button is a normal run
    const label = $("btn-start").textContent;
    $("btn-start").disabled=true; $("btn-start").textContent="loading assets…";
    try{ await ready; }
    catch(e){ ready = loadAssets().then(renderCodex); ready.catch(()=>{}); $("btn-start").textContent="asset load failed — retry"; $("btn-start").disabled=false; return; }
    $("btn-start").disabled=false; $("btn-start").textContent=label;
    sfx("click");
    $("btn-begin").disabled = true;
    show("screen-avatar"); genAvatar();
  };
  document.querySelectorAll(".mute").forEach(b=>{ b.onclick=()=>{ setMute(!META.mute); sfx("click"); }; });
  $("btn-reroll").onclick=()=>{ sfx("click"); genAvatar(); };
  $("btn-begin").onclick=()=>{
    if(!AVA) return;
    clearRun();
    newRun(AVA, { tribe:PICK.tribe, heat:PICK.daily ? 0 : PICK.heat, daily:PICK.daily });
    show("screen-map");
    $("map-log").innerHTML="";
    mlog("🌸 <b>"+G.name+"</b> enters the timeline with "+G.cult+" $CULT.", "gold");
    mlog("Explore. Loot. Build. <b>THE CANCEL is coming on day 9.</b>", "");
    mlog("<i>Rumour on Miladycraft: a seed phrase is buried somewhere near spawn.</i>", "");
    startDay();
    sfx("relic"); saveRun();
    if(!META.tut) openTutorial();
  };
  $("relic-bar").onclick=openBuild;
  $("hud-avatar").onclick=openBuild;
  document.addEventListener("keydown", onKey);
}
document.addEventListener("DOMContentLoaded", init);
