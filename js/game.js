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
function cosmetic(fn){ // run fn on plain randomness: how something looks must not shift the seeded sequence
  const keep = SEED; SEED = null;
  try{ return fn(); } finally{ SEED = keep; }
}
function seedFrom(str){ let h = 2166136261; for(const c of str){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h|0; }
const randi = (a,b) => a + Math.floor(rnd()*(b-a+1));
const choice = arr => arr[Math.floor(rnd()*arr.length)];
const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const relicById = id => RELICS.find(r=>r.id===id);

/* ---------- meta (localStorage) ---------- */
const META_KEY = "tcc_meta_v1";
let META = {drip:0, wins:0, runs:0, best:0, unlocks:{}, speed:1, mute:false, seen:{}, tut:false, ach:{}, heat:0, tribe:"", daily:null, nft:null, name:"", auto:true, quick:true, calm:false, bg3d:true};
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
  if(META.calm) return;
  const chars = [...emojis];
  for(let i=0;i<18;i++){
    const d = document.createElement("div"); d.className="confetti"; d.textContent=chars[Math.floor(Math.random()*chars.length)];
    const a = Math.random()*Math.PI*2, r = 120+Math.random()*220;
    d.style.setProperty("--dx", Math.cos(a)*r+"px"); d.style.setProperty("--dy", (Math.sin(a)*r-80)+"px");
    d.style.setProperty("--rot", (Math.random()*720-360)+"deg");
    document.body.appendChild(d); setTimeout(()=>d.remove(), 1100);
  }
}
function splash(text, cls){ // a line of big type across the screen for a beat; never blocks input
  const d = document.createElement("div"); d.className = "splash "+(cls||""); d.innerHTML = text;
  document.body.appendChild(d); setTimeout(()=>d.remove(), 1700);
}
function quake(){ if(META.calm) return; const a=$("app"); a.classList.remove("quake"); void a.offsetWidth; a.classList.add("quake"); }
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
  const M = TOKEN_MAP[cfg.toLowerCase()]; // and what the collection itself hides (a Southpark face has no brows)
  if(M) for(const layer in M.exclusions){ const v = picks[layer] && picks[layer].slice(0,-5); for(const gone of (M.exclusions[layer][v]||[])) if(!(pinned||{})[gone]) delete picks[gone]; }
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
/* back-to-front order of the slots, following each collection's own layering (hair sits over the eyes, brows over the hair) */
const DRAW_ORDER = {
  Milady:  ["skin","face","eyes","mouth","necktat","neck","shirt","hair","costume","brows","smoke","ear","deco","glasses","hat","weapon","friend","prop"],
  Remilio: ["skin","brows","eyes","hair","face","deco","shirt","neck","mouth","smoke","costume","ear","glasses","hat","weapon","friend","prop"],
};
/* which slot each of a token's own trait layers fills */
const TOKEN_SLOTS = {
  Milady:  { Skin:"skin", Face:"face", Eyes:"eyes", Mouth:"mouth", Neck:"necktat", Necklaces:"neck", Shirt:"shirt", Hair:"hair", Brows:"brows",
             Earrings:"ear", "Face Decoration":"deco", Glasses:"glasses", Hat:"hat" },
  Remilio: { Race:"skin", Brows:"brows", Eyes:"eyes", Hair:"hair", Face:"face", Shirt:"shirt", Mouth:"mouth", Costume:"costume",
             Earrings:"ear", Glasses:"glasses", Hat:"hat", Weapon:"weapon", Friend:"friend" },
};
function basePicks(){
  const picks = {};
  for(const layer of BASE_LAYERS) picks[layer] = choice(ASSETS.Milady[layer]);
  picks.eyeColor = choice(ASSETS.Milady["Eye Color"]).slice(0,-5);
  return picks;
}
/* What a token brings to a run, read from its traits: its Core picks the tribe, its drip (or swag) score is starting
   $CULT, and if it wears something that is a relic's art it starts with that relic in place of the tribe's. */
function tokenKit(kind, attrs, tk){
  const get = t => { const a = attrs.find(x=>x[0]===t); return a ? a[1] : ""; };
  const kit = { tribe:"", cult:0, relic:"", note:[] };
  const core = get("Core").toLowerCase();
  if(TRIBES.some(t=>t.id===core)){ kit.tribe = core; kit.note.push("core "+core); }
  const score = parseInt(get("Drip Score") || "", 10), swag = parseInt(get("Swag Score") || "", 10);
  if(score>0){ kit.cult = clamp(score, 0, 80); kit.note.push("drip "+score+" → +"+kit.cult+" $CULT"); }
  else if(swag>0){ kit.cult = clamp(Math.round(swag/3), 0, 80); kit.note.push("swag "+swag+" → +"+kit.cult+" $CULT"); }
  const worn = RELICS.filter(r=>r.icon[0]===tk.cfg && tk.layers[r.icon[1]]===r.icon[2]+".webp"
    && r.rar!=="legendary" && r.rar!=="cursed" && !(LOCKED[r.id] && !META.ach[LOCKED[r.id]]));
  const pick = worn.find(r=>r.rar==="rare") || worn[0];
  if(pick){ kit.relic = pick.id; kit.note.push("wears "+pick.name); }
  return kit;
}
/* ---------- a token rebuilt from its own traits, so a relic hat replaces its hat instead of sitting on top ---------- */
async function tokenTraits(nft){ const r = await api("/api/token?kind="+nft.kind+"&id="+nft.id); return r && r.attributes; }
function tokenLayers(kind, attrs){ // [[trait, value], ...] -> { cfg, layers:{Layer: file}, eyeColor } or null
  const M = TOKEN_MAP[kind], files = ASSETS[M.cfg], layers = {};
  const title = v => v.split(" ").map(w=>w ? w[0].toUpperCase()+w.slice(1) : w).join(" ");
  let eyeColor = "";
  for(const [trait, value] of attrs){
    const layer = M.names[trait] || trait;
    const want = (M.values[trait]||{})[value] || (M.transform==="titlecase" ? title(value) : value);
    if(M.tint && layer===M.tint.by){ eyeColor = want; continue; }
    if(!TOKEN_SLOTS[M.cfg][layer] || !files[layer]) continue; // backgrounds, overlays and scores are not worn
    const f = files[layer].find(x=>x.toLowerCase()===(want+".webp").toLowerCase());
    if(f) layers[layer] = f;
  }
  // traits that the collection itself hides under others
  for(const layer in M.exclusions){ const v = layers[layer] && layers[layer].slice(0,-5); for(const gone of (M.exclusions[layer][v]||[])) delete layers[gone]; }
  for(const layer in M.layerExclusions) if(layers[layer]) for(const gone of M.layerExclusions[layer]) delete layers[gone];
  return layers[M.body] ? { cfg:M.cfg, layers, eyeColor } : null;
}
function rgb2hsl(r,g,b){ // degrees, percent, percent
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2, d=mx-mn;
  let h=0, s=0;
  if(d){ s = d/(1-Math.abs(2*l-1)); h = mx===r ? ((g-b)/d)%6 : mx===g ? (b-r)/d+2 : (r-g)/d+4; h*=60; if(h<0) h+=360; }
  return [h, s*100, l*100];
}
function hsl2rgb(h,s,l){
  s/=100; l/=100;
  const k = n => (n+h/30)%12, a = s*Math.min(l,1-l), f = n => l-a*Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)));
  return [255*f(0), 255*f(8), 255*f(4)];
}
/* Milady eye colour, as the maker does it: inside the eye mask, keep each pixel's lightness and take the colour's hue and saturation */
function tintEyes(cx, mask, swatch, darken){
  const W=600, Y=180, H=320; // the eyes sit in this band
  const t = document.createElement("canvas"); t.width=W; t.height=750;
  const tx = t.getContext("2d", {willReadFrequently:true});
  tx.drawImage(swatch,0,0,W,750);
  const c = tx.getImageData(300,375,1,1).data, [th,ts] = rgb2hsl(c[0],c[1],c[2]);
  tx.clearRect(0,0,W,750); tx.drawImage(mask,0,0,W,750);
  const m = tx.getImageData(0,Y,W,H), e = cx.getImageData(0,Y,W,H), md = m.data, ed = e.data;
  for(let i=0;i<md.length;i+=4){
    if(md[i+3]<128 || md[i]+md[i+1]+md[i+2]<180){ md[i+3]=0; continue; } // black or empty: not the iris
    let l = rgb2hsl(ed[i],ed[i+1],ed[i+2])[2];
    if(darken) l = l<5 ? 5 : l*darken;
    const [r,g,b] = hsl2rgb(th,ts,l);
    md[i]=r; md[i+1]=g; md[i+2]=b; md[i+3]=255;
  }
  tx.clearRect(0,0,W,750); tx.putImageData(m,0,Y);
  cx.drawImage(t,0,0);
}
/* Token art. You can play as a Milady or Remilio you hold; the other collections supply enemy portraits. Each collection says where its token images live and how the art is framed.
   Images go through an image proxy that resizes them and adds the CORS header most hosts lack (without it
   the canvas could not be exported for map tokens or share cards). Ownership is not checked. */
const IPFS = "https://ipfs.filebase.io/ipfs/";
const viaGateway = u => u.replace(/^ipfs:\/\//, IPFS).replace(/^https:\/\/([a-z0-9]+)\.ipfs\.[^/]+\//, IPFS+"$1/")
  .replace(/^https:\/\/(?!ipfs\.filebase\.io)[^/]+\/ipfs\//, IPFS); // any other gateway's /ipfs/ path too
async function metaImage(url){ // a token's metadata JSON -> its image URL
  const j = await (await fetch(viaGateway(url))).json();
  return viaGateway(j.image || j.image_url || j.file_url);
}
async function tokenURI(contract, id){ // ask a public Ethereum node where a token's metadata is
  const r = await fetch("https://ethereum-rpc.publicnode.com", { method:"POST", headers:{"content-type":"application/json"},
    body: JSON.stringify({ jsonrpc:"2.0", id:1, method:"eth_call", params:[{ to:contract, data:"0xc87b56dd"+id.toString(16).padStart(64,"0") }, "latest"] }) });
  const hex = (await r.json()).result, len = parseInt(hex.slice(66,130), 16), data = hex.slice(130, 130+len*2);
  return new TextDecoder().decode(new Uint8Array(data.match(/../g).map(h=>parseInt(h,16))));
}
/* playable: the player can be one (Miladys and Remilios only). Every other collection appears in the game
   as enemies and NPCs, never as the player.
   frame: milady = the 4:5 Milady template (relics line up exactly) · remilio = square with a smaller head ·
   square = square close-up · poster = 2:3 */
// SchizoPosters ship with the game (the sixteen from tylerirl.com's gallery): the collection's own host is too flaky to rely on
const SCHIZO_LOCAL = ["atlantean","brobot","celestial","crystalline","demon","grey","ice","microlady","monument","nebulady","psychedelic","robro","rockbro","sealady","tulpa","wired"];
const localFile = path => (window.INLINE_FILES && window.INLINE_FILES[path]) || path;
const NFT = {
  milady:   { name:"Milady",          max:9999,  frame:"milady",  playable:true, src:id=>"https://www.miladymaker.net/milady/"+id+".png" },
  remilio:  { name:"Remilio",         max:9999,  frame:"remilio", playable:true, src:id=>"https://remilio.org/remilio/"+id+".png" },
  pixelady: { name:"Pixelady",        max:10000, frame:"milady",  src:id=>IPFS+"bafybeih5mqafo34424swmfdboww3s2tvfmzoojbip4jmcjbg5n3fl7edee/"+id+".png" },
  radbro:   { name:"Radbro",          max:5000,  frame:"remilio", src:id=>metaImage("https://radbro.xyz/api/tokens/metadata/"+id) },
  schizo:   { name:"SchizoPoster",    max:SCHIZO_LOCAL.length, frame:"poster", src:id=>localFile("assets/img/Schizo/"+SCHIZO_LOCAL[(id-1)%SCHIZO_LOCAL.length]+".webp") },
  station:  { name:"MiladyStation",   max:1212,  frame:"square",  src:id=>IPFS+"QmSjnEsFWBWC3hCcm1UarThXLSRrKuYLq1e8oYFaZpVmJS/"+id+".png" },
  seen:     { name:"oh.. I've seen",  max:202,   frame:"square",  src:async id=>metaImage(await tokenURI("0x39dac0b2943757c6e53c3a1f02eb75330128c159", id)) },
};
const nftCache = {};
function loadNft(n){
  const key = n.kind+n.id;
  const get = url => new Promise((res,rej)=>{ const im = new Image(); im.crossOrigin="anonymous"; im.onload=()=>res(im); im.onerror=()=>rej(url); im.src=url; });
  return nftCache[key] || (nftCache[key] = Promise.resolve(NFT[n.kind].src(n.id))
    .then(src => /^https?:/.test(src) ? get("https://wsrv.nl/?w=600&output=webp&url="+encodeURIComponent(src)).catch(()=>get(src)) : get(src)) // bundled art needs no proxy
    .catch(e=>{ delete nftCache[key]; throw e; }));
}
async function composeAvatar(base, relicIds){
  const tk = base.token || null, body = tk ? tk.cfg : "Milady";
  // a token whose traits couldn't be read falls back to its flat picture; with no token at all, the generated look
  const nftIm = !tk && base.nft && NFT[base.nft.kind] ? await loadNft(base.nft).catch(()=>null) : null;
  const slots = {};
  const add = (slot, item)=>{ if(SINGLE.includes(slot)) slots[slot]=[item]; else (slots[slot]=slots[slot]||[]).push(item); };
  if(tk){
    for(const layer in tk.layers){ const slot = TOKEN_SLOTS[tk.cfg][layer]; if(slot) add(slot, {cfg:tk.cfg, url:assetURL(tk.cfg, layer, tk.layers[layer]), own:true, file:tk.layers[layer]}); }
  } else if(!nftIm){
    for(const layer of BASE_LAYERS) add(layer.toLowerCase(), {cfg:"Milady", url:assetURL("Milady", layer, base[layer]), own:true, file:base[layer]});
  }
  for(const id of new Set(relicIds)){
    const [cfg, layer, name, tint] = relicById(id).icon;
    const slot = (WEAR[cfg]||{})[layer];
    if(slot) add(slot, {cfg, url:assetURL(cfg, layer, name+".webp"), tint});
  }
  // on a Remilio body a costume hides what the collection hides under one; a relic you put on still shows
  if(body==="Remilio" && slots.costume) for(const k of ["shirt","hat","glasses","hair","face"]) if(slots[k]) slots[k] = slots[k].filter(it=>!it.own);
  const items = DRAW_ORDER[body].flatMap(slot => (slots[slot]||[]).map(it=>({...it, slot})));
  const ims = await Promise.all(items.map(it=>loadImg(it.url).catch(()=>null)));
  // eye colour applies to her own eyes, when they are a kind that takes a colour
  const TINT = TOKEN_MAP.milady.tint, eyes = (slots.eyes||[])[0], colour = tk ? tk.eyeColor : base.eyeColor;
  let tintWith = null;
  if(body==="Milady" && !nftIm && eyes && eyes.own && colour && TINT.values.includes(eyes.file.slice(0,-5))){
    tintWith = await Promise.all([loadImg(assetURL("Milady", TINT.mask, eyes.file)), loadImg(assetURL("Milady", TINT.by, colour+".webp"))]).catch(()=>null);
  }
  const cv = document.createElement("canvas"); cv.width=600; cv.height=750;
  const cx = cv.getContext("2d", {willReadFrequently:true});
  if(nftIm){
    const frame = NFT[base.nft.kind].frame;
    if(frame==="remilio"){ // square art with a smaller head: fill the frame, then line the face up like a Remilio relic
      cx.drawImage(nftIm, 0, 0, 600, 750); cx.drawImage(nftIm, -70, -32, 762, 762);
      cx.drawImage(nftIm, 0, nftIm.height*0.97, nftIm.width, nftIm.height*0.03, -70, 729, 762, 21);
    } else if(frame==="square") cx.drawImage(nftIm, -75, 0, 750, 750);
    else if(frame==="poster") cx.drawImage(nftIm, 0, -75, 600, 900);
    else cx.drawImage(nftIm, 0, 0, 600, 750);
  }
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
    if(it===items.find(x=>x.slot==="eyes") && tintWith){ cx.filter = "none"; try{ tintEyes(cx, tintWith[0], tintWith[1], TINT.darken[colour]||0); }catch(e){} }
  });
  cx.filter = "none";
  let out = base.ps1 ? ps1(cv) : cv; // booted up a MiladyStation this run
  return (setCounts(relicIds).cheese||0) >= 2 ? fry(out) : out; // CHEESEWORLD builds get deep fried
}
let avatarTok = 0;
function refreshAvatar(){ // repaint the player everywhere after her relics change
  const run = G, tok = ++avatarTok;
  composeAvatar(run.base, run.relics).then(cv=>{
    if(G!==run || tok!==avatarTok) return;
    run.avatar = cv; run.face = faceToken(cv, "Milady");
    paint($("hud-avatar"), cv); paint($("combat-you"), cv);
    $("you-img").src = run.face;
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
/* SCHIZOPOSTERS treatment: the picture buried under scattered text */
const SCHIZO_TEXT = ["I HATE THE ANTICHRIST","I HATE THE ANTICHRIST","FOR FOUR YEARS I SLEPT","THEY ARE WATCHING","post through it","i love you","NETWORK SPIRITUALITY","it's all connected","NGMI","do not reply","the wired","remember what they took","wagmi?","LOG OFF","he is coming","read the manifesto","1000x","trust the plan","who is posting","it's over","we're so back"];
function schizo(src){
  const cv = document.createElement("canvas"); cv.width=src.width; cv.height=src.height;
  const cx = cv.getContext("2d");
  cx.filter = "contrast(1.25) saturate(1.3) hue-rotate(-12deg)"; cx.drawImage(src,0,0); cx.filter = "none";
  cx.globalCompositeOperation = "source-atop";
  const u = cv.width/600;
  for(let i=0;i<16;i++){
    const t = SCHIZO_TEXT[Math.floor(Math.random()*SCHIZO_TEXT.length)], fs = (14+Math.random()*30)*u;
    cx.save();
    cx.translate(Math.random()*cv.width, Math.random()*cv.height); cx.rotate((Math.random()-0.5)*0.9);
    cx.font = (Math.random()<0.5?"bold ":"")+fs+"px "+(Math.random()<0.5 ? "'Courier New', monospace" : "Impact, 'Arial Black', sans-serif");
    cx.textAlign = "center"; cx.lineWidth = fs/6; cx.strokeStyle = "rgba(0,0,0,.85)";
    cx.fillStyle = ["#fff","#ff3b3b","#ffe14a","#7dffb0"][Math.floor(Math.random()*4)];
    cx.strokeText(t,0,0); cx.fillText(t,0,0);
    cx.restore();
  }
  cx.globalCompositeOperation = "source-over";
  return cv;
}
/* MILADYSTATION treatment: a first-generation console render, low resolution with dithered 15-bit colour */
function ps1(src){
  const w = 110, h = Math.round(w*src.height/src.width);
  const t = document.createElement("canvas"); t.width=w; t.height=h;
  const tx = t.getContext("2d", {willReadFrequently:true}); tx.drawImage(src,0,0,w,h);
  try{
    const img = tx.getImageData(0,0,w,h), d = img.data, bayer = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i = (y*w+x)*4, n = (bayer[(y&3)*4+(x&3)]-7.5)*1.6;
      for(let c=0;c<3;c++) d[i+c] = clamp(Math.round((d[i+c]+n)/8)*8, 0, 255);
      d[i+3] = d[i+3]>110 ? 255 : 0;
    }
    tx.putImageData(img,0,0);
  }catch(e){ /* a canvas that can't be read still gets the low resolution */ }
  const cv = document.createElement("canvas"); cv.width=src.width; cv.height=src.height;
  const cx = cv.getContext("2d"); cx.imageSmoothingEnabled = false;
  cx.drawImage(t,0,0,cv.width,cv.height);
  return cv;
}
function pixel(src){ // PIXELADY treatment: chunky pixels, finer than Miladycraft's blocks
  const t = document.createElement("canvas"); t.width=64; t.height=Math.round(64*src.height/src.width);
  t.getContext("2d").drawImage(src,0,0,t.width,t.height);
  const cv = document.createElement("canvas"); cv.width=src.width; cv.height=src.height;
  const cx = cv.getContext("2d"); cx.imageSmoothingEnabled = false;
  cx.drawImage(t,0,0,cv.width,cv.height);
  return cv;
}
function undead(src){ // Pixelady WOTLK: a burned token, revived as a Death Knight
  const cv = pixel(src), cx = cv.getContext("2d");
  cx.globalCompositeOperation = "source-atop"; cx.fillStyle = "rgba(60,150,255,.38)"; cx.fillRect(0,0,cv.width,cv.height);
  cx.globalCompositeOperation = "source-over";
  return cv;
}
function frost(src){ // the Death Knight tint on its own, for art that is already pixelated
  const cv = document.createElement("canvas"); cv.width=src.width; cv.height=src.height;
  const cx = cv.getContext("2d"); cx.drawImage(src,0,0);
  cx.globalCompositeOperation = "source-atop"; cx.fillStyle = "rgba(60,150,255,.38)"; cx.fillRect(0,0,cv.width,cv.height);
  cx.globalCompositeOperation = "source-over";
  return cv;
}
const PORTRAIT_FX = { fried:(cv,def)=>fry(cv, def.caption), blocky, schizo, ps1, pixel, undead, frost };
/* You never fight your own collection: a Milady meets no Miladys, a Radbro no Radbros. */
function playerCollection(){ return G && G.base && G.base.nft ? G.base.nft.kind : "milady"; }
function collectionOf(def){ return def.nft || def.cfg.toLowerCase(); }
function clashes(def){ return collectionOf(def)===playerCollection(); }
function foePool(tier, district){
  const ok = ENEMIES.filter(e=>e.tier===tier && !clashes(e));
  const local = ok.filter(e=>district===3 || e.home.includes(district));
  return local.length ? local : ok;
}
/* An enemy's portrait. Enemies from a token collection (def.nft) show a real token, picked by number;
   if it can't be fetched in time they fall back to trait layers with that collection's look. */
async function foePortrait(def, picks, tok){
  if(def.nft && tok){
    try{
      const im = await Promise.race([loadNft({kind:def.nft, id:tok}), new Promise((_,rej)=>setTimeout(rej, 9000))]);
      let cv = document.createElement("canvas"); cv.width=600; cv.height=Math.round(600*im.naturalHeight/im.naturalWidth);
      cv.getContext("2d").drawImage(im,0,0,cv.width,cv.height);
      if(PORTRAIT_FX[def.nftFx]) cv = PORTRAIT_FX[def.nftFx](cv, def);
      cv.frame = NFT[def.nft].frame;
      return cv;
    }catch(e){ /* offline, or a token that doesn't exist: draw one from layers instead */ }
  }
  let cfg = def.cfg;
  if(cfg.toLowerCase()===playerCollection()){ // the fallback must not look like the player's collection either
    cfg = cfg==="Milady" ? "Remilio" : "Milady";
    const keep = SEED; SEED = null; picks = randomPicks(cfg); SEED = keep; // a look is cosmetic: don't spend the run's luck on it
  }
  let cv = await compositePortrait(cfg, picks);
  if(PORTRAIT_FX[def.fx]) cv = PORTRAIT_FX[def.fx](cv, def);
  cv.cfg = cfg;
  return cv;
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
const DAY_MOVES = 34, NIGHT_MOVES = 16, BOSS_DAYS = [3,6,9];
function baseStats(){
  return { hp:50, maxhp:50, atk:6, arm:0, spd:5, lck:10 };
}
function newRun(ava, opt){
  const tribe = TRIBES.find(t=>t.id===opt.tribe) || TRIBES[0], heat = opt.heat||0;
  // the whole run grows from one short code: the date for a daily, or six characters that a link can carry
  const code = opt.daily ? "daily-"+opt.daily : (opt.seed || Math.random().toString(36).slice(2,8).padEnd(6,"0"));
  SEED = seedFrom("tcc-"+code);
  const kit = ava.picks.kit || {};
  const startCult = 100 + (META.unlocks.cult2?250:META.unlocks.cult1?100:0) + (tribe.cult||0) + (kit.cult||0);
  G = {
    name: ava.name, base: ava.picks, avatar: ava.canvas, face: faceToken(ava.canvas),
    tribe: tribe.id, heat, daily: opt.daily||"", seedCode: opt.daily ? "" : code, linked: !!opt.seed,
    cult: startCult,
    relics: [],
    maxSlots: 4 + (META.unlocks.slot1?1:0) - (heat>=5?1:0),
    day: 1, phase: "day", movesLeft: DAY_MOVES,
    px: SX, py: SY,
    map: [], fog: [],
    hunters: [], shops: {}, foes: {}, seen: [], bossLook: [],
    bonus: {maxhp:0, atk:0, spd:0},
    queue: [], over: false, newSeen: 0, sel: "", lit: {},
    tiers: [], // tiers[i] is the tier of relics[i]: 1 normal, 2 gold, 3 diamond
    bossesBeaten: 0, bossUnlocked: -1,
    kills: 0, tilesSeen: 0,
    stats: null,
  };
  // three bosses a run: one early, one mid, and THE CANCEL always closes
  G.bossIds = [0,1,2].map(slot=>choice(BOSSES.filter(b=>b.slot===slot)).id);
  G.keys = 0; G.flags = {};
  G.objectives = shuffle(OBJECTIVES).slice(0,3).map(o=>({id:o.id, state:""})); // seeded, so a shared map shares its objectives
  const first = kit.relic || tribe.relic; // a token that wears a relic's art starts with that relic instead of the tribe's
  addRelic(first); discover(first);
  if(META.unlocks.secondchance){ addRelic("wartime_pfp"); discover("wartime_pfp"); }
  oddsCache = {}; shownCult = G.cult; shownStats = null;
  recalcStats();
  G.stats.hp = G.stats.maxhp;
  genMap();
  G.bossIds.forEach((id,i)=>spawnBoss(i, cosmetic(()=>pinnedPicks(runBoss(i)))));
}

/* ---------- autosave: the run is written out whenever the map is idle ---------- */
const RUN_KEY = "tcc_run_v4";
const RUN_FIELDS = ["name","base","cult","relics","maxSlots","day","phase","movesLeft","px","py","map","fog","gate","hunters","shops","seen","bonus","bossesBeaten","bossUnlocked","kills","tilesSeen","newSeen","lit","seed","seedDug","seedKnown","fudKills","newAch","tribe","heat","daily","bossIds","memUsed","gates","tiers","seedCode","linked","keys","flags","objectives"];
function saveRun(){
  if(!G || G.over || busy() || G.queue.length) return;
  const d = { v:4, rng:SEED, hp:G.stats.hp, log:$("map-log").innerHTML, foes:{}, boss:G.bossLook.map(l=>l.picks) };
  for(const k of RUN_FIELDS) d[k] = G[k];
  for(const k in G.foes) d.foes[k] = { id:G.foes[k].def.id, picks:G.foes[k].picks, tok:G.foes[k].tok };
  try{ localStorage.setItem(RUN_KEY, JSON.stringify(d)); }catch(e){}
}
function clearRun(){ try{ localStorage.removeItem(RUN_KEY); }catch(e){} }
function loadRun(){
  try{
    const d = JSON.parse(localStorage.getItem(RUN_KEY));
    // a save from an older build may name things that no longer exist: drop it rather than break
    if(!d || d.v!==4 || !d.relics.every(relicById) || !Object.values(d.foes).every(f=>ENEMIES.some(e=>e.id===f.id))) return null;
    return d;
  }catch(e){ return null; }
}
async function resumeRun(d){
  G = { queue:[], over:false, sel:"", foes:{}, bossLook:[], stats:null };
  for(const k of RUN_FIELDS) G[k] = d[k];
  G.flags = G.flags || {}; G.objectives = G.objectives || []; G.keys = G.keys || 0;
  if(!Array.isArray(G.tiers)) G.tiers = G.relics.map(id=>(d.tier||{})[id]||1); // a save from before relics had their own slots
  SEED = d.rng;
  G.avatar = await composeAvatar(G.base, G.relics);
  G.face = faceToken(G.avatar, "Milady"); G.worn = G.relics.join();
  oddsCache = {}; shownCult = G.cult;
  recalcStats(); G.stats.hp = clamp(d.hp, 1, G.stats.maxhp);
  for(const k in d.foes) spawnFoe(k, ENEMIES.find(e=>e.id===d.foes[k].id), d.foes[k].picks, d.foes[k].tok);
  G.bossIds.forEach((id,i)=>spawnBoss(i, d.boss[i] || cosmetic(()=>pinnedPicks(runBoss(i)))));
  paint($("hud-avatar"), G.avatar);
  $("map-log").innerHTML = d.log || "";
  showBanner();
  show("screen-map");
  mlog("💾 Run restored.", "gold");
  renderMap();
}
const FACE_CROP = { Milady:[0.14,0.2,0.72], Remilio:[0.14,0.1,0.72], Bonkler:[0.14,0,0.72] }; // x, y, size as fractions of width
const FRAME_CROP = { milady:[0.14,0.2,0.72], remilio:[0.14,0.1,0.72], square:[0.12,0.06,0.76], poster:[0.14,0.3,0.72] }; // token art, by framing
function faceToken(cv, cfg){ // head crop of a portrait, used as a map piece
  try{
    const out = document.createElement("canvas"); out.width=96; out.height=96;
    const w = cv.width, [fx,fy,fs] = FRAME_CROP[cv.frame] || FACE_CROP[cv.cfg||cfg||"Milady"];
    const ox = out.getContext("2d"); ox.imageSmoothingEnabled = (cv.cfg||cfg)!=="Bonkler";
    ox.drawImage(cv, w*fx, w*fy, w*fs, w*fs, 0,0,96,96);
    return out.toDataURL();
  }catch(e){ return ""; }
}
function pinnedPicks(def){ // random look, with any layers the data pins down
  return randomPicks(def.cfg, def.picks);
}

/* ---------- relic engine ---------- */
function hasRelic(id){ return G.relics.includes(id); }
/* Tiers. Every relic you hold is its own item in its own slot, duplicates included, and G.tiers[i] is the tier of
   G.relics[i]. Copies stack: two of the same relic give twice its numbers. Remilia Jackson fuses a pair into one
   item worth both, which frees a slot: two normal make one GOLD (x2), two gold make one DIAMOND (x4). */
const TIERS = [null, {name:"", mult:1}, {name:"GOLD", mult:2, icon:"🥇"}, {name:"DIAMOND", mult:4, icon:"💎"}];
const tierAt = i => (G && G.tiers && G.tiers[i]) || 1;
const tierOf = id => { let t = 1; if(G && G.relics) G.relics.forEach((x,i)=>{ if(x===id && tierAt(i)>t) t = tierAt(i); }); return t; };
const tm = id => { // how much a relic's numbers are multiplied by: every copy you hold adds its tier's worth
  let m = 0;
  if(G && G.relics) G.relics.forEach((x,i)=>{ if(x===id) m += TIERS[tierAt(i)].mult; });
  return m || 1;
};
const tierCls = t => ["","","gold","diamond"][t||1];
const tierLabel = t => t>1 ? " <small class='tier-tag "+tierCls(t)+"'>"+TIERS[t].icon+" "+TIERS[t].name+"</small>" : "";
const tierClass = id => tierCls(tierOf(id));
function addRelic(id, tier){ G.relics.push(id); G.tiers.push(tier||1); }
function dropRelicAt(i){ G.relics.splice(i,1); G.tiers.splice(i,1); }
/* relics whose fight numbers are scaled where they are used (in fightEngine and settleWin); the rest get their
   stat bonuses scaled in computeStats, or a flat bonus per tier if they have no numbers at all */
const TIER_IN_FIGHT = ["network_spirituality","jesus_tank","cookie","cult_robe","lollipop","snakebites","pikachu","remilio_friend","tails","dino",
  "evil_eye","trucker","cat_ears","birthday_hat","maid","strawberry","silver_coin","blood_splatter","cigarette","fbi_cap","bonkler"];
/* A relic's text at a given worth (1 normal, 2 gold, 4 diamond): the same numbers the engine uses, so the
   description always says what the item in that slot really gives. */
const STAT_RX = /\+(\d+)(%? ?)(ATK|ARM|SPD|max HP|crit chance|dodge)/g, DODGE_RX = /^(\d+)(% dodge chance)/;
const HEAL_RX = /(Heal )(\d+)/;
const FIGHT_RX = { network_spirituality:/(an? )(\d+)( HP shield)/, jesus_tank:/(an? )(\d+)( HP shield)/, cookie:HEAL_RX, cult_robe:HEAL_RX, lollipop:HEAL_RX,
  birthday_hat:HEAL_RX, maid:HEAL_RX, strawberry:HEAL_RX, cat_ears:HEAL_RX, snakebites:/(poison: )(\d+)/, pikachu:/(shock for )(\d+)/,
  remilio_friend:/(strikes for )(\d+)/, tails:/(hit for )(\d+)/, dino:/(bites for )(\d+)/, evil_eye:/(Reflect )(\d+)/, trucker:/(heal you for )(\d+)/,
  silver_coin:/(\+)(\d+)( \$CULT)/, blood_splatter:/(\+)(\d+)( ATK)/, cigarette:/(deal \+)(\d+)/, fbi_cap:/(deals )(\d+)( less)/, bonkler:/^()(\d+)(%)/ };
const hasStatText = r => r.id!=="blood_splatter" && (new RegExp(STAT_RX.source).test(r.desc) || DODGE_RX.test(r.desc));
const flatTier = r => !hasStatText(r) && !TIER_IN_FIGHT.includes(r.id); // nothing numeric to scale: +2 ATK, +6 max HP per extra copy's worth
function relicText(r, m, plain, copy){ // copy: a second item of a relic you already hold, whose effect can't happen twice
  m = m||1; const flat = flatTier(r) ? m-1+(copy?1:0) : 0;
  if(m<=1 && !flat) return r.desc;
  const hi = v => plain ? v : "<b class='boost'>"+v+"</b>";
  let d = r.desc;
  if(FIGHT_RX[r.id]) d = d.replace(FIGHT_RX[r.id], (_, a, n, z)=>(/^an? $/.test(a) ? "a " : a)+"\u0001"+Math.round(n*m)+"\u0002"+(typeof z==="string" ? z : ""));
  if(hasStatText(r)) d = d.replace(STAT_RX, (_, n, u, k)=>"\u0001+"+Math.round(n*m)+u+k+"\u0002").replace(DODGE_RX, (_, n, z)=>"\u0001"+Math.round(n*m)+"\u0002"+z);
  if(flat) d += " \u0001+"+2*flat+" ATK, +"+6*flat+" max HP.\u0002";
  return d.replace(/\u0001([^\u0002]*)\u0002/g, (_, v)=>hi(v));
}
const textAt = (r, i, plain) => relicText(r, TIERS[tierAt(i)].mult, plain, G.relics.indexOf(r.id)!==i); // the item in slot i
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
  G.relics.push(r.id); G.tiers.push(1); // as if you held it: a copy of something you already hold stacks
  const a = G.stats, b = computeStats(G.relics);
  G.relics.pop(); G.tiers.pop();
  return [["maxhp","HP"],["atk","ATK"],["arm","ARM"],["spd","SPD"],["crit","% crit"],["dodge","% dodge"]].map(([k,label])=>{
    const d = Math.round(b[k]-a[k]);
    return d ? "<i class='"+(d>0?"up":"down")+"'>"+(d>0?"+":"−")+Math.abs(d)+(label[0]==="%"?label:" "+label)+"</i>" : "";
  }).join("");
}
function relicPool(){
  return RELICS.filter(r => {
    if(r.tags.includes("blackmarket") && !META.unlocks.blackmarket) return false;
    if(LOCKED[r.id] && !META.ach[LOCKED[r.id]]) return false;
    return true;
  });
}
function setCounts(relics){
  const n = {};
  for(const id of new Set(relics)) for(const k of relicById(id).set) n[k] = (n[k]||0)+1; // a duplicate doesn't count twice
  if(relics.includes("webring")) for(const k in n) n[k]++; // the webring links in to every set you already hold
  return n;
}
function computeStats(relics){
  const base = rawStats(relics), s = {...base};
  for(const id of new Set(relics)){ // an upgraded relic's positive stat bonuses grow with its tier
    const m = tm(id); if(m===1) continue;
    const without = rawStats(relics.filter(x=>x!==id));
    for(const k of ["atk","maxhp","arm","spd","crit","dodge"]){ const d = base[k]-without[k]; if(d>0) s[k] += Math.round(d*(m-1)); }
    if(flatTier(relicById(id))){ s.atk += 2*(m-1); s.maxhp += 6*(m-1); } // nothing numeric to scale: a flat bonus per extra copy's worth instead
  }
  return s;
}
function rawStats(relics){
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
  if(R("desert_eagle")) s.atk+=4;
  if(R("bugatti")) s.spd+=2;
  if(R("shark_suit")){ s.atk+=4; s.maxhp+=10; }
  if(R("blockhead")){ s.arm+=2; s.maxhp+=8; }
  if(R("mape_hoodie")) s.maxhp+=12;
  if(R("strawberry")) s.maxhp+=8;
  if(R("custom")){ s.atk+=3; s.arm+=2; s.spd+=1; s.maxhp+=10; }
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
  G.tiers = G.relics.map((_,i)=>tierAt(i)); // keep one tier per slot
  if((G.worn||"") !== G.relics.join()){ G.worn = G.relics.join(); refreshAvatar(); }
  if(setRows(G.relics).some(r=>!r.next)) achieve("synergy");
}

/* ---------- map generation ---------- */
const W=41, H=41, SX=20, SY=20; // maze size, spawn (rooms sit on even coordinates)
const viewTiles = () => window.innerWidth<=520 ? 7 : 9; // tiles visible across: fewer and bigger on a phone
const DIRS4 = [[1,0],[-1,0],[0,1],[0,-1]];
const T = { EMPTY:0, CHEST:1, GRAVE:2, MON:3, ELITE:4, SHOP:5, SHRINE:6, FIRE:7, GATE:8, EVENT:9, WALL:10, FORGE:11, KEY:12, VAULT:13 };
const T_EMOJI = { [T.CHEST]:"🎁", [T.GRAVE]:"🪦", [T.MON]:"👹", [T.ELITE]:"💀", [T.SHOP]:"🏪", [T.SHRINE]:"🎰", [T.FIRE]:"🔥", [T.GATE]:"⛩️", [T.EVENT]:"❓", [T.KEY]:"🗝️", [T.VAULT]:"🔐" };
const T_NAME = { [T.CHEST]:"chest", [T.GRAVE]:"grave", [T.MON]:"monster", [T.ELITE]:"elite monster", [T.SHOP]:"shop", [T.SHRINE]:"degen shrine", [T.FIRE]:"campfire", [T.GATE]:"boss gate", [T.EVENT]:"something is happening", [T.FORGE]:"Remilia Jackson", [T.KEY]:"key", [T.VAULT]:"vault" };
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
  // a boss gate in every district, a fair walk from spawn, so one is always within reach
  G.gates = [];
  for(let q=0;q<4;q++){
    const here = rooms.filter(r=>districtAt(r.x,r.y)===q);
    const good = here.filter(r=>r.d>=16 && r.d<=40);
    const g = good.length ? choice(good) : [...here].sort((a,b)=>Math.abs(a.d-28)-Math.abs(b.d-28))[0];
    if(!g) continue;
    G.map[g.y][g.x] = T.GATE; G.gates.push([g.x,g.y]); g.used = true;
  }
  G.gate = G.gates[0];
  // loot likes dead ends; everything else takes whatever rooms are left
  const dead = shuffle(rooms.filter(r=>r.dead && !r.used)), open = shuffle(rooms.filter(r=>!r.dead && !r.used));
  const put = (t, n, deadEnd) => {
    for(let i=0;i<n;i++){
      const r = (deadEnd && dead.length ? dead : open.length ? open : dead).pop();
      if(!r) return;
      G.map[r.y][r.x] = t;
    }
  };
  put(T.VAULT,5,true); // locked rooms at dead ends; the keys are somewhere else entirely
  put(T.CHEST,40,true); put(T.SHRINE,14,true); put(T.GRAVE,20,true); put(T.FORGE,8); put(T.KEY,6);
  put(T.SHOP,12); put(T.FIRE,18); put(T.EVENT,30); put(T.ELITE,24); put(T.MON,45);
  for(const h of shuffle(halls).slice(0,30)) G.map[h.y][h.x] = T.MON; // and some monsters hold the corridors
  // Miladycraft lore: a seed phrase is buried somewhere near spawn
  const near = Object.keys(walkDist(SX,SY,3)).map(k=>k.split(",").map(Number)).filter(([x,y])=>(x!==SX||y!==SY) && G.map[y][x]===T.EMPTY);
  G.seed = near.length ? choice(near) : null;
  // every monster tile gets its foe up front, themed to the district it stands in (its portrait waits until it is seen)
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const t = G.map[y][x]; if(t!==T.MON && t!==T.ELITE) continue;
    const d = districtAt(x,y), tier = t===T.ELITE ? "elite" : "mon";
    const def = choice(foePool(tier, d));
    spawnFoe(x+","+y, def, cosmetic(()=>pinnedPicks(def)), def.nft ? cosmetic(()=>randi(1, NFT[def.nft].max)) : 0);
  }
  updateFog();
}
function spawnFoe(key, def, picks, tok){ G.foes[key] = { def, picks, tok, face:"", portrait:null }; }
function foeArt(foe){ // a foe's portrait and map face are put together the first time it is seen
  if(!foe.portrait){
    const run = G;
    foe.portrait = foePortrait(foe.def, foe.picks, foe.tok);
    foe.portrait.then(cv=>{ foe.face = faceToken(cv, foe.def.cfg); if(G===run) queueRender(); });
  }
  return foe.portrait;
}
let renderQueued = false;
function queueRender(){ // many portraits can finish at once: redraw the map once for all of them
  if(renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(()=>{ renderQueued = false; if(G && !G.over && !busy()) renderMap(); });
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
let shownCult = 0, shownStats = null;
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
  const now = {ATK:s.atk, ARM:s.arm, SPD:s.spd, dodge:s.dodge, HP:s.maxhp};
  $("hud-chips").innerHTML = chip("⚔️","ATK",s.atk)+chip("🛡️","ARM",s.arm)+chip("💨","SPD",s.spd)+(s.dodge?chip("🍃","dodge",s.dodge+"%"):"")+(G.keys?chip("🗝️","keys",G.keys):"");
  if(shownStats) for(const el of $("hud-chips").children){ const k = el.title, d = now[k]-shownStats[k]; if(d) el.classList.add(d>0?"bump-up":"bump-down"); }
  if(shownStats && now.HP!==shownStats.HP) { const hb = $("hp-fill").parentNode; hb.classList.remove("bump"); void hb.offsetWidth; hb.classList.add("bump"); }
  shownStats = now;
  const dist = DISTRICTS[districtAt(G.px,G.py)];
  const tr = TRIBES.find(t=>t.id===G.tribe);
  $("hud-name").textContent = G.name+(tr ? " "+tr.icon : "")+(G.heat ? " 🔥"+G.heat : "")+(G.daily ? " 📅" : G.linked ? " 🔗" : "");
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
    rb += rel ? "<div class='relic' title='"+rel.name+" — "+textAt(rel,i,true).replace(/'/g,"&#39;")+"'><img class='relic-ico "+tierCls(tierAt(i))+"' src='"+ICONS[rel.id]+"' alt=''>"+(G.relics.indexOf(rel.id)!==i ? "<i class='copies'>copy</i>" : "")+"<div class='rtxt'><b class='"+rel.rar+"'>"+rel.name+tierLabel(tierAt(i))+" <small>"+rel.set.map(k=>SETS.find(t=>t.id===k).icon).join("")+"</small></b><span>"+textAt(rel,i)+"</span></div></div>"
              : "<div class='relic'><div class='relic-ico empty'></div><div class='rtxt'><span>empty slot</span></div></div>";
  }
  $("relic-bar").innerHTML = rb;
  $("syn-bar").innerHTML = setsHTML(G.relics, false);
  $("obj-bar").innerHTML = objectivesHTML();
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
let tileEl = {}; // "x,y" -> its element, for the tiles currently drawn
function renderMap(){
  const m = $("map");
  m.style.gridTemplateColumns = "repeat("+W+", 1fr)"; m.style.gridTemplateRows = "repeat("+H+", 1fr)";
  $("map-inner").style.width = (W/viewTiles()*100)+"%"; // that many tiles fit across the window; the rest scrolls
  m.classList.toggle("night", G.phase==="night");
  m.innerHTML = ""; tileEl = {};
  const coin = coinSrc();
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    if(G.fog[y][x]) continue; // unexplored tiles are not drawn at all: the map's own background is the fog
    const d = document.createElement("div"), key = x+","+y, t = G.map[y][x];
    d.className = "tile";
    d.style.gridColumn = x+1; d.style.gridRow = y+1;
    d.style.setProperty("--dc", DISTRICTS[districtAt(x,y)].color);
    if(!G.lit[key]){ G.lit[key]=1; d.classList.add("reveal"); }
    if(G.sel===key) d.classList.add("sel");
    if(t===T.WALL){ d.classList.add("wall"); m.appendChild(d); continue; }
    tileEl[key] = d;
    if(x===G.px && y===G.py){
      d.classList.add("you"); // the token itself is #you-tok, which slides between tiles
    } else if(G.hunters.some(h=>h.x===x&&h.y===y)){ d.classList.add("hunted"); d.title="FUD demon"; } // drawn by placeHunters
    else if(t!==T.EMPTY){
      const foe = G.foes[key];
      if(foe && (t===T.MON || t===T.ELITE)){
        foeArt(foe);
        d.classList.add("foe"); if(t===T.ELITE) d.classList.add("elite");
        d.innerHTML = foe.face ? "<img class='tok' src='"+foe.face+"' alt=''>" : "<i class='tok ph'></i>"; // its portrait is still being put together
        d.classList.add("d-"+fightOdds(foe.def, {elite:t===T.ELITE}).tag);
      } else {
        d.classList.add("poi", "t"+t);
        d.innerHTML = "<span>"+(t===T.FORGE ? "<img class='npc' src='"+coin+"' alt=''>" : (t===T.GATE && G.bossUnlocked<0) ? "🔒" : T_EMOJI[t])+"</span>";
        d.title = T_NAME[t];
        if(t===T.GATE && G.bossUnlocked>=0) d.classList.add("gate-open");
      }
    }
    if(G.seedKnown && !G.seedDug && G.seed && x===G.seed[0] && y===G.seed[1] && !(x===G.px && y===G.py)){ d.classList.add("dig"); d.textContent="⛏️"; }
    if(Math.abs(x-G.px)+Math.abs(y-G.py)===1) d.classList.add("moveable");
    d.onmouseenter = ()=>{
      let info = tileInfo(x,y);
      clearPath();
      if(!busy() && Math.abs(x-G.px)+Math.abs(y-G.py)>1){ // preview the walk a click would take
        const path = pathTo(x,y);
        if(path){
          for(const [qx,qy] of path){ const el = tileEl[qx+","+qy]; if(el) el.classList.add("path"); }
          info += " · <b>"+path.length+" steps</b>"+(path.length>G.movesLeft ? " <span class='bad'>(past "+(G.phase==="day"?"nightfall":"dawn")+")</span>" : "");
        }
      }
      $("tile-info").innerHTML = info;
    };
    d.onclick = ()=>{
      // no hover on touch screens: the first tap on a foe shows its odds, the second commits
      if(TOUCH && (t===T.MON || t===T.ELITE) && G.sel!==key && d.classList.contains("moveable")){
        G.sel = key; renderMap(); $("tile-info").innerHTML = tileInfo(x,y)+" <b>— tap again to fight</b>"; return;
      }
      stopTravel();
      if(Math.abs(x-G.px)+Math.abs(y-G.py)===1) tryMove(x,y); else travelTo(x,y);
    };
    m.appendChild(d);
  }
  m.onmouseleave = ()=>{ clearPath(); $("tile-info").innerHTML = tileInfo(G.px,G.py); };
  $("tile-info").innerHTML = tileInfo(G.px,G.py);
  placeYou(); placeHunters();
  centerMap();
  renderMinimap();
  renderHUD();
}
/* keep the player in the middle of the window; you can still scroll or drag away to look around */
function clearPath(){ document.querySelectorAll("#map .tile.path").forEach(t=>t.classList.remove("path")); }
let camSnap = true;
const GAP = 3; // px between tiles, as in the stylesheet
function placeYou(){
  const t = $("you-tok"), img = $("you-img"), cell = "((100% - "+(W-1)*GAP+"px) / "+W+" + "+GAP+"px)";
  if(img.getAttribute("src")!==G.face) img.src = G.face;
  t.classList.toggle("snap", camSnap); // arriving on this screen: appear in place, don't slide in from the last run
  t.style.width = "calc((100% - "+(W-1)*GAP+"px) / "+W+")";
  const moved = t.dataset.at !== G.px+","+G.py;
  t.style.left = "calc("+G.px+" * "+cell+")"; t.style.top = "calc("+G.py+" * "+cell+")";
  t.dataset.at = G.px+","+G.py;
  if(moved && !camSnap){ img.classList.remove("hop"); void img.offsetWidth; img.classList.add("hop"); }
}
function placeHunters(){ // one sliding token per demon you can see
  const inner = $("map-inner"), live = {}, cell = "((100% - "+(W-1)*GAP+"px) / "+W+" + "+GAP+"px)";
  for(const h of G.hunters){
    if(G.fog[h.y][h.x]) continue;
    h.id = h.id || Math.random().toString(36).slice(2,9); live[h.id] = 1;
    let el = inner.querySelector(".hunter-tok[data-id='"+h.id+"']");
    if(!el){ el = document.createElement("div"); el.className="hunter-tok"; el.dataset.id=h.id; el.innerHTML="<span>🌚</span>"; inner.appendChild(el); }
    el.style.width = "calc((100% - "+(W-1)*GAP+"px) / "+W+")";
    el.style.left = "calc("+h.x+" * "+cell+")"; el.style.top = "calc("+h.y+" * "+cell+")";
  }
  inner.querySelectorAll(".hunter-tok").forEach(el=>{ if(!live[el.dataset.id]) el.remove(); });
}
function mapFloat(text, cls){ // a line of text that rises off the player's tile
  const t = $("you-tok"), d = document.createElement("div"); d.className = "map-float "+(cls||""); d.textContent = text;
  d.style.left = t.style.left; d.style.top = t.style.top; d.style.width = t.style.width;
  $("map-inner").appendChild(d); setTimeout(()=>d.remove(), 1500);
}
function centerMap(){
  const w = $("map-wrap"), m = $("map-inner"), ts = m.scrollWidth/W;
  if(!ts) return;
  w.scrollTo({ left: m.offsetLeft+(G.px+0.5)*ts-w.clientWidth/2, top: m.offsetTop+(G.py+0.5)*ts-w.clientHeight/2, behavior: camSnap ? "auto" : "smooth" });
  camSnap = false;
}
const MINI = { [T.CHEST]:"#ff79c6", [T.GRAVE]:"#7c8a90", [T.MON]:"#ff5555", [T.ELITE]:"#f1fa8c", [T.SHOP]:"#8be9fd",
  [T.SHRINE]:"#f1fa8c", [T.FIRE]:"#ffb86c", [T.EVENT]:"#bd93f9", [T.GATE]:"#ff5555", [T.FORGE]:"#50fa7b", [T.KEY]:"#f1fa8c", [T.VAULT]:"#ffb86c" };
function renderMinimap(){
  const cv = $("minimap"), k = 4, cx = cv.getContext("2d");
  cv.width = W*k; cv.height = H*k;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    if(G.fog[y][x]) continue;
    const t = G.map[y][x];
    cx.fillStyle = t===T.WALL ? "#061014" : "#1d3a44";
    cx.fillRect(x*k, y*k, k, k);
    if(MINI[t]){ cx.fillStyle = MINI[t]; cx.fillRect(x*k+1, y*k+1, k-2, k-2); }
  }
  cx.fillStyle = "#ff5555"; for(const h of G.hunters) if(!G.fog[h.y][h.x]) cx.fillRect(h.x*k, h.y*k, k, k);
  cx.fillStyle = "#50fa7b"; cx.fillRect(G.px*k-2, G.py*k-2, k+4, k+4);
}
const TOUCH = !window.matchMedia("(hover:hover)").matches;
const T_DESC = { [T.CHEST]:"<b>Chest</b> — draft 1 of 3 relics.", [T.GRAVE]:"<b>Grave</b> — a relic draft, or some $CULT.",
  [T.SHOP]:"<b>Remilio Mart</b> — buy relics or a full heal. Closes once you've shopped.", [T.SHRINE]:"<b>Degen Shrine</b> — coin flip: double your bet and draft a relic.",
  [T.FIRE]:"<b>Campfire</b> — heal to full, skip the rest of the day or night. One use.", [T.EVENT]:"<b>???</b> — something is happening here.",
  [T.FORGE]:"<b>Remilia Jackson</b> — fuses two of the same relic into one slot: normal → gold → diamond. One visit.",
  [T.KEY]:"<b>Key</b> — opens one vault.", [T.VAULT]:"<b>Vault</b> — needs a key. 100 $CULT and a draft of better relics." };
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
  document.body.classList.toggle("on-title", id==="screen-title"); // the Return Home card only belongs on the title screen
  if(id==="screen-map") camSnap = true; // a hidden screen loses its scroll position: jump, don't glide
  window.scrollTo(0,0);
  if(id==="screen-avatar") navBegin = true;
  navRefresh();
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
  if(!busy()){ checkObjectives(); renderMap(); saveRun(); }
}
/* Side objectives. true = done, false = can no longer be done, undefined = still open. */
const OBJ_TEST = {
  elite_early: ()=> G.flags.eliteEarly ? true : G.day>=3 ? false : undefined,
  gate_boss:   ()=> G.flags.gateBoss || undefined,
  no_rest:     ()=> G.flags.rested ? false : G.day>=4 ? true : undefined,
  full_slots:  ()=> G.relics.length>=G.maxSlots || undefined,
  fuse:        ()=> G.flags.fused || undefined,
  vault:       ()=> G.flags.vault || undefined,
  night_wins:  ()=> (G.flags.nightWins||0)>=3 || undefined,
  synergy:     ()=> setRows(G.relics).some(r=>r.on.length) || undefined,
  rich:        ()=> G.cult>=400 || undefined,
  explorer:    ()=> G.tilesSeen>=260 || undefined,
  slayer:      ()=> G.kills>=10 || undefined,
  seed:        ()=> G.seedDug || undefined,
};
function checkObjectives(){
  for(const o of (G.objectives||[])){
    if(o.state) continue;
    const def = OBJECTIVES.find(x=>x.id===o.id), r = OBJ_TEST[o.id]();
    if(r===true){
      o.state = "done"; G.cult += def.cult; sfx("fanfare"); burst("🎯✨");
      mlog("🎯 <b>Objective done:</b> "+def.text+". <b>+"+def.cult+" $CULT</b> now, +25 DRIP at the end.", "gold");
      mapFloat("🎯 +"+def.cult, "loot");
    } else if(r===false){ o.state = "failed"; mlog("🎯 Objective lost: "+def.text+".", ""); }
  }
}
function objectivesHTML(){
  return (G.objectives||[]).map(o=>{ const def = OBJECTIVES.find(x=>x.id===o.id);
    return "<div class='obj "+(o.state||"")+"'><i>"+(o.state==="done"?"✓":o.state==="failed"?"✕":"○")+"</i><span>"+def.text+"</span><em>+"+def.cult+"</em></div>"; }).join("");
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
    sfx("boss"); quake(); splash("⚠️ "+b.name+"<small>is coming</small>", "boss");
  } else splash("☀️ DAY "+G.day, "day");
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
  splash("🌙 NIGHT FALLS<small>the FUD demons are hunting</small>", "night");
  sfx("night");
  // they come out of the maze a little way off: close enough to matter, far enough to see coming
  const dist = walkDist(G.px,G.py);
  const spots = shuffle(Object.keys(dist).filter(k=>dist[k]>=7 && dist[k]<=14));
  for(const k of spots.slice(0, (G.day<2 ? 1 : G.day<4 ? 2 : 3) + (G.heat>=3 ? 1 : 0))){ const [x,y]=k.split(",").map(Number); G.hunters.push({x,y}); }
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
      clearTile(); startCombat(foeInstance(foe.def), {elite:t===T.ELITE, portrait:foeArt(foe)});
      break;
    }
    case T.EVENT: openEvent(); break;
    case T.FORGE: openForge(); break;
    case T.KEY: clearTile(); G.keys = (G.keys||0)+1; sfx("coin"); mapFloat("🗝️ +1", "loot"); mlog("🗝️ You pocket a <b>key</b>. Somewhere in the maze a vault is waiting.", "gold"); break;
    case T.VAULT:
      if(!G.keys){ mlog("🔐 A vault door. It wants a <b>key</b>, and you don't have one.", "bad"); break; }
      G.keys--; clearTile(); G.cult += 100; G.flags.vault = true; sfx("fanfare"); burst("🔐💎✨");
      mlog("🔐 The key turns. <b>+100 $CULT</b>, and something better than usual.", "gold");
      openDraft("The vault opens.", richRoll());
      break;
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
function relicExtras(r, preview){ // what taking r would do: stat changes and set progress, or what a duplicate is for
  if(preview && hasRelic(r.id)){ // a copy stacks with the one you hold
    const d = statDelta(r), worth = tm(r.id);
    return "<div class='delta'>"+(d || "<i class='up'>its numbers ×"+(worth+1)+(worth>1 ? " (now ×"+worth+")" : "")+"</i>")+"</div>"
      + "<div class='sets'><i style='--sc:#50fa7b'>stacks with yours</i><i style='--sc:#50fa7b'>takes a slot until fused</i></div>";
  }
  return (preview ? "<div class='delta'>"+statDelta(r)+"</div>" : "")+setChips(r, preview);
}
function relicCard(r, attr, delta, tier){ // tier: when the card stands for a relic you hold, that item's tier
  const rar = rarity(r);
  return "<div class='card "+rar+" "+tierCls(tier)+"' "+attr+">"+(rar!=="common"?"<em>"+rar+"</em>":"")+"<img src='"+ICONS[r.id]+"' alt=''><b>"+r.name+tierLabel(tier||1)+"</b><span>"+relicText(r, TIERS[tier||1].mult)+"</span>"
    + relicExtras(r, delta)+(META.seen[r.id] ? (delta && hasRelic(r.id) ? "<u class='dup'>stacks</u>" : "") : "<u>new!</u>")+"</div>";
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
function gotRelic(r){ discover(r.id); sfx("relic"); burst(rarity(r)==="common" ? "✨" : "✨💖🌸"); flyRelic(r.id); }
function flyRelic(id){ // the relic leaps from the middle of the screen onto your Milady
  if(META.calm) return;
  const to = $("hud-avatar").getBoundingClientRect();
  if(!to.width) return;
  const im = document.createElement("img"); im.className = "fly-relic "+tierClass(id); im.src = ICONS[id]; im.alt = "";
  document.body.appendChild(im);
  const sx = innerWidth/2-48, sy = innerHeight/2-48, ex = to.left+to.width/2-48, ey = to.top+to.height/2-48;
  const a = im.animate([
    { transform:"translate("+sx+"px,"+sy+"px) scale(.4) rotate(-20deg)", opacity:0 },
    { transform:"translate("+sx+"px,"+(sy-36)+"px) scale(2) rotate(8deg)", opacity:1, offset:0.3 },
    { transform:"translate("+sx+"px,"+(sy-36)+"px) scale(1.8) rotate(-4deg)", opacity:1, offset:0.5 },
    { transform:"translate("+ex+"px,"+ey+"px) scale(.3) rotate(360deg)", opacity:0.9 },
  ], { duration:900, easing:"cubic-bezier(.5,0,.3,1)" });
  a.onfinish = ()=>{ im.remove(); const h = $("hud-avatar"); h.classList.remove("equip"); void h.offsetWidth; h.classList.add("equip"); };
}
/* Equip r, asking which relic to drop when slots are full. onDone(dropped) / onBack(). */
function acquireRelic(r, onDone, onBack){
  if(G.relics.length < G.maxSlots){ addRelic(r.id); recalcStats(); gotRelic(r); return onDone(null); }
  let h = "<h2>SLOTS FULL — DROP ONE</h2><div class='stat-line'><span>to make room for</span><b>"+r.name+"</b></div><div class='draft-cards'>";
  G.relics.forEach((id,j)=>{ h += relicCard(relicById(id), "data-j='"+j+"'", false, tierAt(j)); });
  h += "</div><div class='row'><button class='btn small' id='drop-back'>← back</button></div>";
  openModal(h);
  document.querySelectorAll("#modal-panel .card").forEach(c=>{ c.onclick=()=>{
    const old = relicById(G.relics[+c.dataset.j]);
    G.relics[+c.dataset.j]=r.id; G.tiers[+c.dataset.j]=1; recalcStats(); gotRelic(r); onDone(old);
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
const coinSrc = () => document.querySelector(".cult-coin").src;
function relicRow(r, extra, tail, tier, copy){ // a relic as a row: art, name, text, then whatever goes on the right
  return "<div class='shop-row "+r.rar+" "+tierCls(tier)+"'><img src='"+ICONS[r.id]+"' alt=''><div class='sinfo'><b class='"+r.rar+"'>"+r.name+tierLabel(tier||1)
    + (r.rar!=="common" ? " <small class='rar-tag'>"+r.rar+"</small>" : "")+"</b><span>"+relicText(r, TIERS[tier||1].mult, false, copy)+"</span>"+(extra||"")+"</div>"+(tail||"")+"</div>";
}
function openShop(note){
  const key = G.px+","+G.py;
  const shop = G.shops[key] || (G.shops[key] = { stock: rollRelics(3, 0.5).map(r=>({id:r.id, base:RARITY[r.rar].price})) });
  const cheap = districtAt(G.px,G.py)===2, disc = G.stats.shopDisc * (cheap ? 0.8 : 1);
  const healCost = Math.round(60*disc), hurt = G.stats.hp < G.stats.maxhp, coin = "<img class='cult-coin' src='"+coinSrc()+"' alt='$CULT'>";
  let html = "<h2>🏪 REMILIO MART</h2><div class='sheet-top'><span class='chip cult'>"+coin+"<b>"+G.cult+"</b></span>"
    + "<span class='chip'>🎒 "+G.relics.length+" / "+G.maxSlots+" slots</span>"
    + (disc<1 ? "<span class='chip sale'>"+Math.round((1-disc)*100)+"% off</span>" : disc>1 ? "<span class='chip markup'>+"+Math.round((disc-1)*100)+"% prices</span>" : "")+"</div>";
  shop.stock.forEach((it,i)=>{
    const r = relicById(it.id), p = Math.round(it.base*disc);
    html += relicRow(r, relicExtras(r, true),
      "<button class='btn small price' data-i='"+i+"'"+(G.cult<p?" disabled":"")+">"+coin+p+"</button>");
  });
  if(!shop.stock.length) html += "<div class='note'>sold out. thank u for shopping.</div>";
  html += "<div class='shop-row'><div class='heal-ico'>💖</div><div class='sinfo'><b>Full heal</b><span>"+G.stats.hp+" / "+G.stats.maxhp+" HP</span>"
    + "<div class='bar hp'><div style='width:"+clamp(100*G.stats.hp/G.stats.maxhp,0,100)+"%'></div></div></div>"
    + "<button class='btn small price' id='shop-heal'"+(G.cult<healCost||!hurt?" disabled":"")+">"+coin+healCost+"</button></div>";
  if(note) html += "<div class='note good'>"+note+"</div>";
  html += "<div class='row'><button class='btn small' id='shop-leave'>leave</button></div>";
  openModal(html);
  document.querySelectorAll("#modal-panel .shop-row .btn[data-i]").forEach(b=>{ b.onclick=()=>{
    const it=shop.stock[+b.dataset.i], r=relicById(it.id), p=Math.round(it.base*disc);
    if(G.cult<p) return;
    acquireRelic(r, old=>{
      G.cult-=p; shop.stock.splice(shop.stock.indexOf(it), 1); shop.used = true;
      mlog("Bought <b>"+r.name+"</b> for "+p+" $CULT."+(old?" <i>(dropped "+old.name+")</i>":""), "good");
      renderMap(); openShop("Bought "+r.name+".");
    }, ()=>openShop());
  };});
  $("shop-heal").onclick=()=>{
    if(G.cult<healCost || !hurt) return;
    G.cult-=healCost; G.stats.hp=G.stats.maxhp; sfx("heal"); shop.used = true;
    mlog("Healed to full.", "good"); renderMap(); openShop("Healed to full.");
  };
  $("shop-leave").textContent = shop.used ? "leave (the mart closes)" : "leave";
  $("shop-leave").onclick=()=>{ // one visit's worth of business, then it shutters
    if(shop.used){ clearTile(); delete G.shops[key]; mlog("🏪 The mart pulls its shutters down behind you.", ""); renderMap(); }
    closeModal();
  };
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
      case "give": { const r = relicById(v);
        if(hasRelic(v)) out.push("you already hold "+r.name);
        else { G.queue.unshift(()=>acquireRelic(r, old=>{ closeModal(); mlog("Took <b>"+r.name+"</b> — "+r.desc+(old?" <i>(dropped "+old.name+")</i>":""), "good"); renderMap(); }, ()=>closeModal())); out.push(r.name); }
        break; }
      case "ps1": G.base.ps1 = true; refreshAvatar(); out.push("you are low-poly now"); break;
      case "seed":
        if(G.seedDug) out.push("someone already dug it up. it was you");
        else { G.seedKnown = true; out.push("the seed phrase is marked on your map"); }
        break;
      case "burn": {
        const gi = Math.floor(rnd()*G.relics.length), gone = G.relics[gi]; dropRelicAt(gi); recalcStats();
        if(v) G.cult+=v;
        out.push("burned "+relicById(gone).name+(v?" for +"+v+" $CULT":"")); break;
      }
      case "reveal": for(const row of G.fog) row.fill(false); out.push("the whole map is revealed"); break;
      case "fight": { let def = ENEMIES.find(e=>e.id===v);
        if(clashes(def)) def = choice(foePool("elite", 3));
        G.queue.unshift(()=>startCombat(foeInstance(def), {elite:true})); out.push(def.name+" attacks"); break; }
    }
  }
  return out;
}

/* ---------- campfire ---------- */
function openFire(){
  const day = G.phase==="day";
  openModal("<h2>🔥 CAMPFIRE</h2><div class='note'>Rest until "+(day?"nightfall":"dawn")+"? You heal to full and skip the rest of this "+(day?"day":"night")+" safely — no loot, no fights. The fire burns out once you've used it."
    + (!day && G.bossUnlocked>=0 ? "<br><b class='bad'>"+runBoss(G.bossUnlocked).name+" arrives at dawn.</b>" : "")
    + "</div><div class='row'><button class='btn' id='fire-yes'>REST</button><button class='btn small' id='fire-no'>keep moving</button></div>");
  $("fire-yes").onclick=()=>{
    G.stats.hp=G.stats.maxhp; clearTile(); G.flags.rested = true; mlog("Rested. HP restored. The fire burns out behind you.", "good"); sfx("heal");
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
  quake();
  bossModal(b, b.name+"<br>HAS ARRIVED", "FACE IT", false);
  $("boss-fight").onclick=()=>{ closeModal(); startCombat(foeInstance(b), {boss:b, forced:true, portrait:G.bossLook[G.bossUnlocked].portrait}); };
}

/* ---------- build inspector ---------- */
function openBuild(){
  if(!G || G.over || busy()) return;
  const s = G.stats, tr = TRIBES.find(t=>t.id===G.tribe), cell = (k,v) => "<div><span>"+k+"</span><b>"+v+"</b></div>";
  let html = "<h2>YOUR BUILD</h2><div class='build-top'><canvas id='build-ava'></canvas><div class='stat-grid'>"
    + cell("HP", s.hp+" / "+s.maxhp)+cell("ATK", s.atk)+cell("ARM", s.arm)+cell("SPD", s.spd)
    + cell("CRIT", s.crit+"%")+cell("DODGE", s.dodge+"%")+cell("$CULT", "×"+(Math.round(s.cultMult*100)/100))+cell("SLOTS", G.relics.length+" / "+G.maxSlots)
    + "</div></div><div class='sheet-top'>"+(tr ? "<span class='chip'>"+tr.icon+" "+tr.name+" · "+tr.desc+"</span>" : "")
    + (G.heat ? "<span class='chip markup'>🔥 heat "+G.heat+"</span>" : "")+(G.daily ? "<span class='chip'>📅 "+G.daily+"</span>" : "")
    + (G.bonus.atk||G.bonus.maxhp||G.bonus.spd ? "<span class='chip sale'>events: "+[G.bonus.atk&&"+"+G.bonus.atk+" ATK", G.bonus.maxhp&&"+"+G.bonus.maxhp+" HP", G.bonus.spd&&"+"+G.bonus.spd+" SPD"].filter(Boolean).join(", ")+"</span>" : "")+"</div>";
  G.relics.forEach((id,i)=>{ const r = relicById(id); html += relicRow(r, G.relics.indexOf(id)!==i ? "<div class='delta'><i class='up'>a copy: stacks with the other, fuse the pair to free a slot</i></div>" : setChips(r, false), "", tierAt(i), G.relics.indexOf(id)!==i); });
  if(!G.relics.length) html += "<div class='note'>no relics yet. go loot something.</div>";
  html += "<div class='box-h' style='margin-top:12px'>SYNERGIES</div><div class='syn-list'>"+setsHTML(G.relics, true)+"</div>";
  html += "<div class='row'><button class='btn small' id='build-close'>close</button></div>";
  openModal(html);
  paint($("build-ava"), G.avatar);
  $("build-close").onclick=()=>closeModal();
}

/* ---------- Remilia Jackson: fuses copies of a relic into its next tier ----------
   He only fuses. Copies have to be found (drafts, shops, drops); he never sells them. */
function openForge(note){
  let html = "<h2>REMILIA JACKSON</h2><img class='npc-face' src='"+coinSrc()+"' alt=''>"
    + "<div class='note'><i>\"Two of a kind, baby. Hand them over and I'll make them shine.\"</i><br>copies already stack. fusing two puts both in one slot: 🥇 GOLD is worth two, 💎 DIAMOND (two GOLD) is worth four"
    + "<br>he doesn't sell copies, and he moves on once he has fused for you</div>";
  const used = new Set(); let pairs = 0;
  G.relics.forEach((id,i)=>{
    const r = relicById(id), t = tierAt(i), next = TIERS[t+1];
    // a partner is another copy of the same relic at the same tier
    const j = next && !used.has(i) ? G.relics.findIndex((x,k)=>k>i && x===id && tierAt(k)===t && !used.has(k)) : -1;
    let prog, btn = "";
    if(used.has(i)) prog = "<div class='delta'><i class='up'>goes into the fuse above</i></div>";
    else if(!next) prog = "<div class='delta'><i class='up'>fully fused</i></div>";
    else if(j>=0){ used.add(i); used.add(j); pairs++; prog = "<div class='delta'><i class='up'>you hold two: ready</i></div><span class='after'>"+next.icon+" fused: "+relicText(r, next.mult)+"</span>"; btn = "<button class='btn small fuse' data-a='"+i+"' data-b='"+j+"'>fuse → "+next.icon+"</button>"; }
    else prog = "<div class='delta'><i>needs a second "+(t>1 ? TIERS[t].name+" " : "")+r.name+"</i></div>";
    html += relicRow(r, prog, btn, t, G.relics.indexOf(id)!==i);
  });
  if(!G.relics.length) html += "<div class='note'>\"You've got nothing for me to work with.\"</div>";
  else if(!pairs) html += "<div class='note'>\"No pairs. Come back when you've found a second one.\"</div>";
  if(note) html += "<div class='note good'>"+note+"</div>";
  html += "<div class='row'><button class='btn small' id='forge-leave'>leave</button></div>";
  openModal(html);
  $("modal-panel").querySelectorAll("[data-a]").forEach(b=>{ b.onclick=()=>{
    const i = +b.dataset.a, j = +b.dataset.b, id = G.relics[i], r = relicById(id), t = tierAt(i)+1;
    G.tiers[i] = t; dropRelicAt(j); recalcStats(); G.flags.fused = true; // two become one: a slot comes free
    G.forged = G.px+","+G.py; // he works once per spot: he leaves when you do
    sfx("fanfare"); burst("✨💎🥇"); flyRelic(id);
    mlog("✨ Remilia Jackson fused two <b>"+r.name+"</b> into "+TIERS[t].icon+" <b>"+TIERS[t].name+"</b> — "+relicText(r, TIERS[t].mult)+"", "gold");
    renderMap(); openForge(r.name+" is now "+TIERS[t].name+". A slot is free.");
  };});
  const done = G.forged===G.px+","+G.py;
  $("forge-leave").textContent = done ? "leave (he moves on)" : "leave";
  $("forge-leave").onclick=()=>{
    if(done){ G.forged = ""; clearTile(); mlog("🙂 Remilia Jackson moonwalks off into the maze.", ""); renderMap(); }
    closeModal();
  };
}

/* ---------- settings ---------- */
function openSettings(){
  if(G && !G.over && $("screen-combat").classList.contains("active")) return;
  const inRun = G && !G.over && $("screen-map").classList.contains("active") && !G.queue.length;
  const row = (label, hint, ctl) => "<div class='set-row'><div><b>"+label+"</b><span>"+hint+"</span></div>"+ctl+"</div>";
  const tog = (k, on) => "<button class='tog"+(on?" on":"")+"' data-k='"+k+"'>"+(on?"on":"off")+"</button>";
  openModal("<h2>⚙️ SETTINGS</h2>"
    + row("Sound", "synth effects, no music", tog("sound", !META.mute))
    + row("Fight speed", "how fast fights play out", "<div class='seg'>"+[1,2,4].map(v=>"<button class='tog"+(META.speed===v?" on":"")+"' data-speed='"+v+"'>"+v+"×</button>").join("")+"</div>")
    + row("Auto-continue", "ordinary wins move on by themselves", tog("auto", META.auto!==false))
    + row("Skip easy fights", "settle fights you can't lose on the map", tog("quick", META.quick!==false))
    + row("Calm mode", "no screen shake, flashing or confetti", tog("calm", !!META.calm))
    + row("3D background", bgState==="failed" ? "couldn't be loaded on this device" : "the particle field from tylerirl.com", tog("bg3d", META.bg3d!==false))
    + (inRun ? "<div class='row'><button class='btn small danger' id='set-quit'>abandon this run</button></div>" : "")
    + "<div class='row'><button class='btn' id='set-close'>done</button></div>");
  const p = $("modal-panel");
  p.querySelectorAll(".tog[data-k]").forEach(b=>{ b.onclick=()=>{
    const k = b.dataset.k;
    if(k==="sound") setMute(!META.mute); else { META[k] = !(k==="calm" ? META.calm : META[k]!==false); saveMeta(); }
    applyCalm(); applyBackground(); sfx("click"); openSettings();
  };});
  p.querySelectorAll(".tog[data-speed]").forEach(b=>{ b.onclick=()=>{ META.speed = +b.dataset.speed; saveMeta(); sfx("click"); openSettings(); }; });
  $("set-close").onclick=()=>{ sfx("click"); closeModal(); };
  if(inRun) $("set-quit").onclick=()=>{
    const b = $("set-quit");
    if(b.dataset.sure){ G.killedBy = "giving up"; G.diedToBoss = false; endRun(false); }
    else { b.dataset.sure = 1; b.textContent = "really abandon? click again"; }
  };
}
function applyCalm(){ document.body.classList.toggle("calm", !!META.calm); }
/* The 3D particle background is tylerirl.com's own script, loaded from the main site so this page always
   carries whatever the site is running. If anything fails to load, the plain CSS backdrop simply stays. */
const BG_SCRIPTS = [
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
  "https://unpkg.com/three@0.128.0/examples/js/shaders/CopyShader.js",
  "https://unpkg.com/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js",
  "https://unpkg.com/three@0.128.0/examples/js/postprocessing/EffectComposer.js",
  "https://unpkg.com/three@0.128.0/examples/js/postprocessing/RenderPass.js",
  "https://unpkg.com/three@0.128.0/examples/js/postprocessing/ShaderPass.js",
  "https://unpkg.com/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js",
  "https://tylerirl.com/js/background3d.js",
];
let bgState = "idle"; // idle | loading | on | failed
function applyBackground(){
  const want = META.bg3d!==false;
  window._bgPaused = !want; // the site script stops its per-frame work while this is set
  document.body.classList.toggle("bg3d", want && bgState==="on");
  if(!want || bgState!=="idle") return;
  bgState = "loading";
  const next = i => {
    if(i>=BG_SCRIPTS.length){
      bgState = document.getElementById("bg3d-canvas") ? "on" : "failed"; // no canvas means no WebGL here
      return applyBackground();
    }
    const el = document.createElement("script");
    el.src = BG_SCRIPTS[i]; el.async = false;
    el.onload = ()=>next(i+1);
    el.onerror = ()=>{ bgState = "failed"; };
    document.head.appendChild(el);
  };
  next(0);
}

/* ---------- modal helpers ---------- */
function openModal(html){
  const p=$("modal-panel"); p.innerHTML=html; p.scrollTop=0;
  $("modal").classList.remove("hidden");
  navRefresh();
}
function closeModal(){ $("modal").classList.add("hidden"); setTimeout(pump,0); setTimeout(navRefresh,0); }

/* THE CANCEL IS COMING — engine part 3: combat, endings, avatar/title screens, init */
function clog(msg, cls){
  const el=$("combat-log"); const d=document.createElement("div");
  if(cls)d.className=cls; d.innerHTML=msg; el.appendChild(d); el.scrollTop=el.scrollHeight;
}
function combatBars(you, foe){
  for(const [id, c] of [["you",you],["foe",foe]]){
    const w = clamp(100*c.hp/c.maxhp,0,100)+"%";
    $("chp-"+id).style.width = w; $("chp-"+id+"-g").style.width = w; // the pale ghost bar catches up a moment later
  }
  $("chp-you-t").textContent=Math.max(0,Math.round(you.hp))+" / "+you.maxhp+(you.shield>0?" 🕯️"+you.shield:"");
  $("chp-foe-t").textContent=Math.max(0,Math.round(foe.hp))+" / "+foe.maxhp;
  $("foe-status").innerHTML = [["🔥",foe.burn,"burning"],["🩸",foe.bleed,"bleeding"],["🧊",foe.chill,"chilled"],["🐍",foe.poison,"poisoned"],["💫",foe.stun,"stunned"]]
    .filter(x=>x[1]>0).map(x=>"<span title='"+x[2]+"'>"+x[0]+x[1]+"</span>").join("");
}
function lunge(side){ // the attacker jabs toward the other portrait
  const c = $("port-"+side), cls = side==="you" ? "lunge-r" : "lunge-l";
  c.classList.remove(cls); void c.offsetWidth; c.classList.add(cls);
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
  const st = { relics:[...G.relics], tiers:G.relics.map((_,i)=>tierAt(i)), cult:G.cult, memUsed:!!G.memUsed };
  const lose = i => { st.relics.splice(i,1); st.tiers.splice(i,1); }; // one item goes; a duplicate of it would stay // what the fight may change; the caller writes it back
  let base = G.stats;
  // THE CANCEL: cancels one relic at fight start
  if(boss && boss.id==="cancel" && st.relics.length){
    const gi = Math.floor(rnd()*st.relics.length), gone = st.relics[gi];
    lose(gi);
    const s = computeStats(st.relics);
    base = {...s, hp: clamp(Math.round(G.stats.hp/G.stats.maxhp*s.maxhp), 1, s.maxhp)};
    io.log("📵 THE CANCEL has cancelled <b>"+relicById(gone).name+"</b>. It is gone.", "bad");
  }
  const you = {...base, stun:0, wartime:true, blunt:true, compTick:0, shield:0, suppressed:new Set()};
  const foe = {...foeDef, poison:0, stun:0, stolen:0, burn:0, bleed:0, chill:0};
  const F = { you, foe, st, tick:0, over:false, win:false, fxDelay:0, dodges:0 };
  const act = id => st.relics.includes(id) && !you.suppressed.has(id);
  const set = (id,n) => (you.sets[id]||0) >= n;
  const done = win => {
    if(win && foe.trait==="revive" && !foe.revived){ // Death Knights get up once
      foe.revived = true; foe.hp = Math.round(foe.maxhp*0.5); foe.poison = 0;
      io.log("💀 "+foe.name+" was burned once already. It gets back up.", "bad"); io.float("foe","revived","psn");
      return;
    }
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
  // burn: damage every tick. bleed: hurts the enemy each time it attacks. chill: saps its ATK, and can freeze it
  const bleedMax = () => set("blood",2) ? 6 : 4, chillMax = () => set("ice",2) ? 5 : 3;
  if(foe.trait==="hard") io.log("🧀 "+foe.name+" goes harder the longer this lasts.", "bad");
  if(foe.trait==="creeper") io.log("💥 "+foe.name+" will blow up when it dies.", "bad");
  if(foe.trait==="revive") io.log("💀 "+foe.name+" will get back up once.", "bad");
  if(foe.trait==="bomber") io.log("🎈 "+foe.name+" bombs you from a blimp every 4th tick.", "bad");
  io.strip(F);
  if(boss && boss.id==="lawsuit" && st.relics.length){ // injunction: the first relic is frozen all fight
    for(const id of st.relics.slice(0,1)) you.suppressed.add(id);
    const s2 = computeStats(st.relics.filter(r=>!you.suppressed.has(r)));
    you.atk=s2.atk; you.arm=s2.arm; you.spd=s2.spd; you.dodge=s2.dodge; you.crit=s2.crit; you.sets=s2.sets;
    io.log("⚖️ INJUNCTION: "+relicById(st.relics[0]).name+" frozen.", "bad");
    io.strip(F);
  }
  if(foe.trait==="mirror"){ foe.atk = Math.max(foe.atk, Math.round(you.atk*0.6)); io.log("🪞 "+foe.name+" copies your style.", "bad"); }
  if(foe.trait==="thief") io.log("💸 "+foe.name+" steals $CULT with every hit. Kill it to get it back.", "bad");
  const tv = (id, n) => Math.round(n*tm(id)); // a relic's number at its tier
  you.shield = (act("network_spirituality")?tv("network_spirituality",12):0) + (act("jesus_tank")?tv("jesus_tank",8):0) + (set("cult",2)?8:0);
  if(you.shield) io.log("🕯️ You start shielded for "+you.shield+".", "good");
  if(act("cookie") && you.hp<you.maxhp){ heal(tv("cookie",10)); io.log("🍪 Cookie. You feel better.", "good"); }
  if(act("vibe_shift")){ foe.stun=1; io.log("🌀 Vibe shift. "+foe.name+" is caught off guard.", "good"); }

  function dmgCalc(att, def, isYou){
    let atk = att.atk;
    if(boss && boss.id==="bonkler911") atk *= (0.5+rnd()); // chaos
    if(isYou && you.hp < you.maxhp/2 && act("blood_splatter")) atk += tv("blood_splatter",5);
    if(isYou && act("scarface")) atk += Math.min(8, Math.floor(st.cult/40));
    if(isYou) atk += you.hard + (set("blood",3) ? foe.bleed : 0);
    if(!isYou && def===you){ atk *= 1 - 0.08*foe.chill; if(foe.burn>0 && set("flame",3)) atk *= 0.8; }
    if(!isYou && act("beetleposting")) atk *= 0.8;
    const critC = isYou ? you.crit : (act("airpods") ? 0 : 5 + att.lck/2);
    const arm = isYou && act("energy_sword") ? 0 : def.arm;
    let dmg = Math.max(1, Math.round(atk - arm + randi(-1,1)));
    let crit = false;
    if(rnd()*100 < critC || (isYou && you.sure)){ dmg *= isYou && set("hype",4) ? 3 : 2; crit=true; }
    if(isYou) you.sure = false;
    if(isYou && crit && act("cigarette")) dmg += tv("cigarette",4);
    if(isYou && act("bugatti") && foe.chill>=chillMax()) dmg = Math.round(dmg*1.3);
    if(!isYou && def===you && act("fbi_cap")) dmg = Math.max(1, dmg-tv("fbi_cap",2));
    if(!isYou && def===you && you.hp < you.maxhp/2 && act("hodl")) dmg = Math.max(1, Math.round(dmg*0.7));
    if(isYou && you.blunt && act("blunt")){ dmg*=3; you.blunt=false; crit=true; }
    return {dmg, crit};
  }
  function strike(att, def, isYou){
    const an = isYou?"You":foe.name, dn = isYou?foe.name:"you";
    // bonkler redirect
    if(!isYou && act("bonkler") && rnd()<0.15*tm("bonkler")){
      const {dmg,crit}=dmgCalc(foe,foe,false);
      foe.hp-=dmg; io.log("🌀 Bonkler chaos! "+foe.name+" hits itself for "+dmg+".", crit?"crit":"good");
      io.hit("foe", dmg, crit);
      return;
    }
    if(!isYou && foe.bleed>0){ // a bleeding enemy pays for every swing
      const d = 2*foe.bleed; foe.hp-=d; io.log("🩸 "+foe.name+" bleeds for "+d+".", "good"); io.float("foe","-"+d,"psn");
      if(act("vampire")) heal(1);
      if(foe.hp<=0) return;
    }
    if(!isYou && you.block){ you.block=0; io.log("🐯 Hobbes takes the hit for you.", "good"); io.float("you","blocked","heal"); return; }
    // dodge
    if(!isYou && rnd()*100 < (you.dodge||0)){
      io.log("💨 You dodge.", "good"); io.float("you","dodge","heal"); F.dodges++;
      if(act("cat_ears")) heal(tv("cat_ears",3));
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
    if(isYou){
      const extra = act("juul") ? 2 : 0;
      if(act("fire_glasses")) foe.burn = Math.max(foe.burn, 2+extra);
      if(crit && act("laser_eyes")) foe.burn = Math.max(foe.burn, 4+extra);
      const bleed = (act("claw")||act("vampire") ? 1 : 0) + (crit && act("desert_eagle") ? 2 : 0);
      if(bleed) foe.bleed = Math.min(bleedMax(), foe.bleed+bleed);
      if(act("chain_earrings")||act("square_diamond")){
        foe.chill = Math.min(chillMax(), foe.chill+1);
        if(set("ice",3) && foe.chill>=chillMax() && !foe.stun){ foe.stun = 1; foe.chill = 0; io.log("🧊 "+foe.name+" freezes solid.", "good"); io.float("foe","frozen","psn"); }
      }
    }
    if(isYou && crit && act("trucker")) heal(tv("trucker",5));
    if(isYou && crit && act("golden_axe") && !def.stun){ def.stun=1; io.log("🪓 "+dn+" is stunned!", "good"); }
    if(!isYou && act("evil_eye")){ const e = tv("evil_eye",2); foe.hp-=e; io.log("🧿 Evil Eye reflects "+e+".", "good"); }
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
    if(act("memcard") && !st.memUsed){
      st.memUsed = true; you.hp = Math.ceil(you.maxhp/2);
      io.log("💾 <b>MEMORY CARD.</b> Save state loaded. That was your only one.", "good");
      io.float("you","reloaded!","heal");
      return false;
    }
    if(act("reserve")){
      lose(st.relics.indexOf("reserve")); you.hp=you.maxhp; io.strip(F);
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
    const regen = (act("cult_robe")?tv("cult_robe",2):0) + (act("lollipop")?tv("lollipop",1):0) + (set("kawaii",4)?2:0);
    if(regen) heal(regen);
    if(set("cult",3) && F.tick%4===0){ you.shield+=4; io.float("you","+4 shield","heal"); }
    // poison ticks
    if(foe.burn>0){ const d = 3 + (set("flame",2)?2:0) + (act("laser_eyes")?1:0); foe.burn--; foe.hp-=d; io.log("🔥 "+foe.name+" burns for "+d+".", "good"); io.float("foe","-"+d,"psn"); }
    if(foe.poison>0){ const d = tv("snakebites",2) * (act("milady_pilled") ? 3 : 1); foe.poison--; foe.hp-=d; io.log("🐍 Poison bites "+foe.name+" for "+d+".", "good"); io.float("foe","-"+d,"psn"); }
    if(act("pikachu") && F.tick%4===0){ const z = tv("pikachu",8); foe.hp-=z; io.log("⚡ Pikachu Suit shocks "+foe.name+" for "+z+".", "good"); io.hit("foe",z,false); }
    // companions
    you.compTick++;
    for(let k = act("gold_sonic") ? 2 : 1; k>0 && foe.hp>0; k--){
      if(act("remilio_friend") && you.compTick%3===0) companion(tv("remilio_friend",5), "🧸 Remilio Friend strikes");
      if(act("tails") && rnd()<0.3) companion(tv("tails",4), "🦊 Tails spins in");
      if(act("dino") && you.compTick%2===0) companion(tv("dino",3), "🦖 Dino bites");
      if(act("amogus") && !boss && foe.hp>0 && rnd()<0.2){
        foe.hp=0; io.log("👽 AMOGUS was the impostor. Instant kill.", "crit");
      }
    }
    if(foe.hp<=0) return done(true);
    if(lethalCheck()) return done(false);
    const order = you.spd >= foe.spd-(act("square_diamond") ? foe.chill : 0) ? [true,false] : [false,true];
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

/* everything a won fight changes: loot, post-fight heals, achievements. log(msg, cls) receives the lines. */
function settleWin(F, opts, log){
  const you = F.you, foe = F.foe, boss = opts.boss || null;
  G.relics = [...F.st.relics]; G.tiers = [...F.st.tiers]; G.cult = F.st.cult; G.memUsed = F.st.memUsed;
  G.kills++;
  if(opts.elite && G.day<3) G.flags.eliteEarly = true;
  if(G.phase==="night") G.flags.nightWins = (G.flags.nightWins||0)+1;
  achieve("first");
  if(foe.id==="kumicho") achieve("shark");
  if(F.dodges>=5) achieve("dodge");
  if(foe.id==="fud"){ G.fudKills=(G.fudKills||0)+1; if(G.fudKills>=3) achieve("fud"); }
  if(boss) achieve(["allegations","bonkler911","win"][G.bossIds.indexOf(boss.id)]);
  let c = randi(foe.cult[0], foe.cult[1]);
  c = Math.round(c * (G.stats.cultMult||1) * (districtAt(G.px,G.py)===1 ? 1.5 : 1) * (opts.elite?1.5:1) * ((opts.elite||boss) && hasRelic("remilionaire") ? 2 : 1));
  if(hasRelic("no_meme") && rnd()<0.2){ c*=3; log("💌 There is no meme. I love you. The floor triples.", "crit"); }
  G.cult += c + foe.stolen;
  log("🏆 Victory! +"+c+" $CULT."+(foe.stolen?" Recovered "+foe.stolen+" stolen.":""), "good");
  if(hasRelic("silver_coin")){ const sc = Math.round(15*tm("silver_coin")); G.cult+=sc; log("🪙 Silver Coin: +"+sc+" $CULT.", "good"); }
  const hm = hasRelic("heart_tattoo") ? 2 : 1;
  for(const [id,n,label] of [["birthday_hat",15,"🎂 Birthday Hat"],["maid",6,"🧹 Maid Outfit"],["strawberry",3,"🍓 Strawberry Earring"]])
    if(hasRelic(id)){ const h = Math.round(n*hm*tm(id)); you.hp=Math.min(you.maxhp,you.hp+h); log(label+": +"+h+" HP.", "good"); }
  const hp = clamp(Math.round(you.hp),1,you.maxhp);
  recalcStats(); // kills and burned relics change the build
  G.stats.hp = Math.min(hp, G.stats.maxhp);
  return c;
}
/* A fight you cannot lose and that barely scratches you is settled on the map, without the fight screen. */
function trivial(foeDef, opts){
  if(opts.boss || META.quick===false) return false;
  const def = ENEMIES.find(e=>e.id===foeDef.id);
  if(!def) return false;
  const o = fightOdds(def, opts);
  return o.p===1 && o.hp >= G.stats.hp*0.85;
}
function quickFight(foeDef, opts){
  const keep = SEED, F = fightEngine(foeDef, opts, NOIO);
  for(let n=0; !F.over && n<3000; n++) F.step();
  if(!F.win){ SEED = keep; return false; } // not so easy after all: rewind the luck and play it out on screen
  const before = G.stats.hp, c = settleWin(F, opts, ()=>{}), lost = before-G.stats.hp;
  mlog("⚔️ Stomped <b>"+foeDef.name+"</b>"+(lost>0 ? ", took "+lost : "")+". <b>+"+c+" $CULT.</b>", "good");
  renderMap();
  mapFloat("⚔️ +"+c+(lost>0 ? "  −"+lost+" HP" : ""), "loot");
  sfx("win");
  if(rnd() < (opts.elite?0.6:0.25)) G.queue.unshift(()=>openDraft("The fallen drops something.", null, opts.elite?1:0));
  return true;
}
let combatTok = 0;
function startCombat(foeDef, opts={}){
  if(trivial(foeDef, opts) && quickFight(foeDef, opts)) return;
  const boss = opts.boss || null, tok = ++combatTok;
  show("screen-combat");
  $("btn-combat-done").classList.add("hidden");
  $("combat-ctl").classList.remove("hidden");
  navSet($("btn-skip"));
  $("combat-log").innerHTML="";
  $("combat-title").textContent = opts.label || (boss ? boss.name : "WILD "+foeDef.name.toUpperCase());
  $("foe-name").textContent = foeDef.name.toUpperCase();
  $("you-name").textContent = G.name.toUpperCase();
  $("port-foe").classList.toggle("boss", !!boss);
  for(const s of ["you","foe"]) $("port-"+s).classList.remove("hit","dead");
  paint($("combat-you"), G.avatar);
  const fc = $("combat-foe"); fc.width=4; fc.height=5;
  (opts.portrait || foePortrait(foeDef, cosmetic(()=>pinnedPicks(foeDef)), foeDef.nft ? 1+Math.floor(Math.random()*NFT[foeDef.nft].max) : 0)).then(cv=>{ if(tok===combatTok) paint(fc, cv); });
  sfx(boss ? "boss" : "fight");

  let quiet=false, timer=null, F=null;
  const fx = fn => {
    if(quiet) return;
    const run = ()=>{ if(tok===combatTok) fn(); }, d = F ? F.fxDelay/META.speed : 0;
    d ? setTimeout(run, d) : run();
  };
  const io = {
    log: clog,
    hit: (side,dmg,crit)=>fx(()=>{ floatText(side, "-"+dmg, crit?"crit":"dmg"); lunge(side==="you"?"foe":"you"); shake(side); sfx(crit?"crit":side==="you"?"hurt":"hit"); if(crit) quake(); }),
    float: (side,text,cls)=>fx(()=>floatText(side,text,cls)),
    strip: f=>{
      // relics can vanish mid-fight (cancelled, burned): keep the build and the portrait in step
      if(G.relics.join()!==f.st.relics.join()){ G.relics=[...f.st.relics]; G.tiers=[...f.st.tiers]; G.worn=G.relics.join(); refreshAvatar(); }
      $("combat-relics").innerHTML = f.st.relics.map((id,n)=>{ const r=relicById(id);
        return "<img class='relic-ico "+tierCls(f.st.tiers[n])+(f.you.suppressed.has(id)?" off":"")+"' src='"+ICONS[id]+"' alt='"+r.name+"' title='"+r.name+" — "+relicText(r, TIERS[f.st.tiers[n]||1].mult, true, f.st.relics.indexOf(id)!==n).replace(/'/g,"&#39;")+"'>"; }).join("");
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
    $("boss-intro").className = ""; $("port-foe").classList.remove("slam");
    const win = F.win;
    $("port-"+(win?"foe":"you")).classList.add("dead");
    const btn=$("btn-combat-done"); btn.classList.remove("hidden");
    navSet(btn);
    if(win){
      const c = settleWin(F, opts, clog);
      floatText("foe", "+"+c+" $CULT", "loot");
      sfx("win"); if(boss) burst("👑✨🌸💖");
      btn.textContent="CONTINUE →";
      let auto = null;
      if(!boss && META.auto!==false){ // ordinary wins move on by themselves; a click or Enter is just faster
        btn.classList.add("auto");
        auto = setTimeout(()=>{ if(tok===combatTok && $("screen-combat").classList.contains("active")) btn.click(); }, 1700);
      }
      btn.onclick=()=>{
        clearTimeout(auto); btn.classList.remove("auto");
        show("screen-map");
        if(boss) onBossDown(boss, opts.forced);
        else if(rnd() < (opts.elite?0.6:0.25)) openDraft("The fallen drops something.", null, opts.elite?1:0);
        pump();
      };
    } else {
      G.stats.hp = 0;
      G.killedBy = foe.name; G.diedToBoss = !!boss;
      G.relics = [...F.st.relics]; G.tiers = [...F.st.tiers]; G.cult = F.st.cult;
      clog("💀 You died.", "bad");
      sfx("lose"); quake();
      btn.classList.remove("auto");
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
    navSet(choiceBox.querySelector(".choice:not(:disabled)"));
    sfx("boss");
    choiceBox.querySelectorAll(".choice").forEach(b=>{ b.onclick=()=>{
      opts2[+b.dataset.i][3](); sfx("click");
      choiceBox.classList.add("hidden"); $("combat-ctl").classList.remove("hidden"); navSet($("btn-skip"));
      combatBars(you,foe); timer=setTimeout(loop, 500);
    };});
  }
  function loop(){
    F.step(); combatBars(you,foe);
    if(F.over) return finish();
    if(boss && !asked && foe.hp<=foe.maxhp/2) return ask();
    timer=setTimeout(loop, 600/META.speed);
  }
  const intro = $("boss-intro");
  intro.className = "";
  if(boss && !META.calm){ // the boss gets an entrance before the first blow
    intro.innerHTML = "<div class='bi-warn'>⚠ WARNING ⚠</div><div class='bi-name'>"+boss.name+"</div><div class='bi-mech'>"+boss.mechanic+"</div>";
    intro.className = "show";
    $("port-foe").classList.add("slam");
    setTimeout(()=>{ if(tok===combatTok){ quake(); sfx("hurt"); } }, 520);
    setTimeout(()=>{ if(tok===combatTok){ intro.className = ""; $("port-foe").classList.remove("slam"); } }, 2100);
  }
  timer = setTimeout(loop, boss && !META.calm ? 2200 : 500);
}

/* ---------- boss down / endings ---------- */
function richRoll(){ // three relics tilted hard toward the good stuff, with at least one above common
  const pool = rollRelics(3, 3);
  if(pool.length && pool.every(r=>r.rar==="common")){ const up = rollRelics(40, 0).find(r=>r.rar!=="common"); if(up) pool[0] = up; }
  return pool;
}
function onBossDown(boss, forced){
  G.bossesBeaten++;
  G.bossUnlocked=-1; // the gate seals again until the next one
  G.maxSlots++;
  recalcStats();
  G.stats.hp=G.stats.maxhp;
  $("boss-banner").classList.add("hidden");
  mlog("👑 <b>"+boss.name+" defeated!</b> +1 relic slot, HP restored.", "gold");
  if(boss.id==="cancel"){ endRun(true); return; }
  if(!forced) G.flags.gateBoss = true;
  G.queue.unshift(()=>openDraft("The timeline yields tribute.", richRoll())); // boss tribute always offers at least one relic above common
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
  const objDone = (G.objectives||[]).filter(o=>o.state==="done").length;
  if(objDone) parts.push([objDone+" objective"+(objDone>1?"s":""), objDone*25]);
  if(G.heat) parts.push(["heat "+G.heat+" bonus", Math.round(parts.reduce((a,p)=>a+p[1],0)*0.25*G.heat)]);
  const d = parts.reduce((a,p)=>a+p[1], 0);
  if(win && G.heat>=(META.heat||0) && G.heat<HEAT.length){ META.heat = G.heat+1; G.heatUp = true; }
  let dailyNote = "";
  if(G.daily && G.daily!==today()) dailyNote = "<div class='note'>📅 daily map for "+G.daily+" (not today's, so it doesn't count toward today's best)</div>";
  else if(G.daily){
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
  html += "<div class='row'><button class='btn big' id='end-again'>"+(win?"RUN IT BACK":"ONE MORE RUN")+"</button><button class='btn small' id='end-title'>"+(next && META.drip>=next.cost?"spend drip ✨":"unlocks")+"</button></div>"
    + "<div id='end-rank' class='end-rank'></div>"
    + "<div class='share'><pre id='end-text'></pre><div class='row'><button class='btn small' id='end-copy'>copy result 📋</button><button class='btn small' id='end-x'>share to 𝕏</button><button class='btn small' id='end-card'>save card 📸</button><button class='btn small' id='end-meme'>make a meme 🧀</button><button class='btn small' id='end-board'>leaderboard 🏆</button></div></div>";
  openModal(html);
  const run = G, txt = resultText(run, win, d);
  countUp($("end-drip"), 0, d, 900);
  if(win){ sfx("fanfare"); burst("🌸✨💖🎀👑"); }
  const wireEnd = first => { // also called when coming back from the meme maker
    paint($("end-avatar"), win ? run.avatar : fry(run.avatar, "CANCELLED"));
    if(!first) $("end-drip").textContent = d;
    $("end-text").textContent = txt;
    $("end-rank").innerHTML = rankHtml;
    $("end-board").onclick=()=>{ sfx("click"); openBoard(run.daily ? "daily" : run.linked ? "seed" : "all", ()=>{ openModal(html); wireEnd(false); }, run.daily ? "" : run.seedCode); };
    $("end-again").onclick=()=>{ sfx("click"); leaveRun(); $("btn-begin").disabled=true; show("screen-avatar"); genAvatar(run.base.nft); };
    $("end-title").onclick=()=>{ sfx("click"); leaveRun(); renderTitle(); show("screen-title"); };
    $("end-copy").onclick=async()=>{
      sfx("click");
      let ok = false;
      try{ await navigator.clipboard.writeText(txt); ok = true; }
      catch(e){ // older browsers and non-secure pages: fall back to selecting a hidden field
        const ta = document.createElement("textarea"); ta.value = txt; ta.style.position="fixed"; ta.style.opacity="0";
        document.body.appendChild(ta); ta.select(); try{ ok = document.execCommand("copy"); }catch(e2){} ta.remove();
      }
      $("end-copy").textContent = ok ? "copied ✓" : "select the text above";
    };
    $("end-x").onclick=()=>{ sfx("click"); window.open("https://twitter.com/intent/tweet?text="+encodeURIComponent(txt), "_blank", "noopener"); };
    $("end-card").onclick=async()=>{ sfx("click"); saveImage(await shareCard(run, win, d), run.name+"-card", txt); };
    $("end-meme").onclick=()=>{ sfx("click"); openMeme(run, win, ()=>{ openModal(html); wireEnd(false); }); };
  };
  let rankHtml = online() ? "<div class='dim'>posting your score…</div>" : "";
  wireEnd(true);
  submitRun(run, win, d).then(res=>{ // fills in when the service answers; the end screen doesn't wait for it
    if(res) res.sent = d;
    rankHtml = res ? rankLines(res) : online() ? "<div class='dim'>leaderboard unavailable — your score wasn't posted</div>" : "";
    if($("end-rank")) $("end-rank").innerHTML = rankHtml;
  });
}
/* hand an image to the phone's share sheet when there is one, otherwise download it */
function saveImage(cv, name, text){
  cv.toBlob(async b=>{
    if(!b) return;
    const file = new File([b], "the-cancel-is-coming-"+name.replace(/\W+/g,"-")+".png", {type:"image/png"});
    if(TOUCH && navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file], text:text||""}); return; }catch(e){ if(e && e.name==="AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = file.name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  });
}
/* ---------- meme maker: top text, bottom text, deep fry ---------- */
function memeCanvas(run, top, bottom, fried){
  let cv = document.createElement("canvas"); cv.width=1080; cv.height=1080;
  let cx = cv.getContext("2d");
  const bg = cx.createRadialGradient(540,400,40,540,540,760);
  bg.addColorStop(0,"#1f5663"); bg.addColorStop(0.45,"#0c2a33"); bg.addColorStop(0.8,"#031014"); bg.addColorStop(1,"#000000");
  cx.fillStyle = bg; cx.fillRect(0,0,1080,1080);
  cx.drawImage(run.avatar, 108, 0, 864, 1080);
  if(fried){ cv = fry(cv); cx = cv.getContext("2d"); }
  const caption = (text, yTop, fromBottom) => {
    text = text.trim().toUpperCase(); if(!text) return;
    let fs = 120, lines;
    const wrap = () => { // at most two lines; shrink the type until it fits
      cx.font = "900 "+fs+"px Impact, Haettenschweiler, 'Arial Narrow Bold', 'Arial Black', sans-serif";
      const words = text.split(/\s+/); lines = [""];
      for(const w of words){ const t = (lines[lines.length-1]+" "+w).trim(); if(cx.measureText(t).width<=1000 || !lines[lines.length-1]) lines[lines.length-1]=t; else lines.push(w); }
      return lines.length<=2 && lines.every(l=>cx.measureText(l).width<=1000);
    };
    while(!wrap() && fs>44) fs-=8;
    cx.textAlign="center"; cx.lineJoin="round"; cx.lineWidth=fs/6; cx.strokeStyle="#000"; cx.fillStyle="#fff";
    lines.forEach((l,i)=>{
      const y = fromBottom ? 1080-36-(lines.length-1-i)*fs*1.05 : yTop+fs+i*fs*1.05;
      cx.strokeText(l,540,y); cx.fillText(l,540,y);
    });
  };
  caption(top, 20, false); caption(bottom, 0, true);
  cx.font = "bold 22px 'Courier New', monospace"; cx.textAlign="right"; cx.fillStyle="rgba(255,255,255,.75)"; cx.strokeStyle="rgba(0,0,0,.7)"; cx.lineWidth=4;
  cx.strokeText("THE CANCEL IS COMING", 1064, 30); cx.fillText("THE CANCEL IS COMING", 1064, 30);
  return cv;
}
function openMeme(run, win, back){
  const top0 = win ? "posted through it" : "got cancelled", bot0 = win ? "timeline saved" : "by "+(run.killedBy||"the timeline")+" on day "+run.day;
  openModal("<h2>🧀 MEME MAKER</h2><canvas id='meme-cv' class='meme-cv'></canvas>"
    + "<input id='meme-top' class='meme-in' maxlength='60' placeholder='top text' value=\""+top0+"\">"
    + "<input id='meme-bot' class='meme-in' maxlength='60' placeholder='bottom text' value=\""+bot0.replace(/"/g,"&quot;")+"\">"
    + "<label class='meme-fry'><input type='checkbox' id='meme-fried' checked> deep fry</label>"
    + "<div class='row'><button class='btn big' id='meme-save'>"+(TOUCH?"SHARE":"SAVE")+" 📸</button><button class='btn small' id='meme-back'>← back</button></div>");
  let cv = null;
  const draw = ()=>{ cv = memeCanvas(run, $("meme-top").value, $("meme-bot").value, $("meme-fried").checked); paint($("meme-cv"), cv); };
  for(const id of ["meme-top","meme-bot"]){ $(id).oninput = draw; }
  $("meme-fried").onchange = draw;
  $("meme-save").onclick = ()=>{ sfx("click"); saveImage(cv, run.name+"-meme", "THE CANCEL IS COMING"); };
  $("meme-back").onclick = ()=>{ sfx("click"); back(); };
  draw();
}
/* A link that puts whoever opens it in the same maze: ?daily=2026-10-04 or ?seed=k3x9ab. */
function runLink(run){
  if(!/^https?:/.test(location.protocol)) return "";
  return location.origin+location.pathname+(run.daily ? "?daily="+run.daily : run.seedCode ? "?seed="+run.seedCode : "");
}
function linkedRun(){ // what the page's own address asks for, if anything
  const q = new URLSearchParams(location.search), d = q.get("daily")||"", c = (q.get("seed")||"").toLowerCase();
  if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return { daily:d };
  if(/^[a-z0-9]{1,12}$/.test(c)) return { seed:c };
  return null;
}
/* the run as a few lines of text and emoji, for pasting anywhere */
function resultText(run, win, drip){
  const tribe = TRIBES.find(t=>t.id===run.tribe) || TRIBES[0];
  const bosses = [0,1,2].map(i => i<run.bossesBeaten ? "🟩" : (!win && run.diedToBoss && i===run.bossesBeaten ? "🟥" : "⬛")).join("");
  const days = "▰".repeat(run.day)+"▱".repeat(9-run.day);
  const sets = setRows(run.relics).filter(r=>r.on.length).map(r=>r.t.icon).join("");
  const url = runLink(run);
  return [
    "THE CANCEL IS COMING "+(run.daily ? "📅 "+run.daily : "🎲 "+(run.seedCode||""))+(run.heat ? " 🔥"+run.heat : ""),
    run.name+" · "+tribe.icon+" "+tribe.name,
    bosses+" "+(win ? "👑 TIMELINE SAVED" : "💀 cancelled by "+(run.killedBy||"the timeline")+", day "+run.day),
    days+" "+(sets ? sets+" · " : "")+run.relics.length+" relics · "+drip+" DRIP",
  ].concat(url ? ["same map: "+url] : []).join("\n");
}
/* ---------- leaderboard: a small service on its own host keeps the best run per player per board ---------- */
const API_DEFAULT = "https://cancel-api.tylerirl.com";
const apiBase = () => { try{ return localStorage.getItem("tcc_api") || API_DEFAULT; }catch(e){ return API_DEFAULT; } };
const online = () => /^https?:/.test(location.protocol); // a page opened as a file has no origin the service will accept
async function api(path, body){ // null on any failure: the game never depends on the service
  if(!online()) return null;
  const ctl = new AbortController(), t = setTimeout(()=>ctl.abort(), 6000);
  try{
    const r = await fetch(apiBase()+path, body
      ? { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:ctl.signal }
      : { signal:ctl.signal });
    return r.ok ? await r.json() : null;
  }catch(e){ return null; }finally{ clearTimeout(t); }
}
function playerId(){ // an anonymous id made once per browser, so a player has one row per board
  if(!META.pid){ META.pid = Array.from(crypto.getRandomValues(new Uint8Array(8)), b=>b.toString(16).padStart(2,"0")).join(""); saveMeta(); }
  return META.pid;
}
const esc = v => String(v).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* How she looked, as a recipe of trait layers. The board redraws every character from this and the relics they
   held; no pictures are uploaded, so it can only ever show the game's own art. */
function lookOf(base){
  if(base.token) return { cfg:base.token.cfg, layers:base.token.layers, eye:base.token.eyeColor||"", ps1:!!base.ps1 };
  if(base.nft) return null; // a token shown as its flat picture has no layers to send
  const layers = {}; for(const l of BASE_LAYERS) layers[l] = base[l];
  return { cfg:"Milady", layers, eye:base.eyeColor||"", ps1:!!base.ps1 };
}
async function drawLook(cv, look, relics){ // paint a board entry's face onto a small canvas
  if(!look || !TOKEN_SLOTS[look.cfg]) return;
  const layers = {};
  for(const k in look.layers) if(TOKEN_SLOTS[look.cfg][k] && (ASSETS[look.cfg][k]||[]).includes(look.layers[k])) layers[k] = look.layers[k]; // only layers this game ships
  if(!layers[TOKEN_MAP[look.cfg.toLowerCase()].body]) return;
  const worn = [...new Set(relics.map(r=>r[0]).filter(id=>relicById(id)))];
  const full = await composeAvatar({ token:{cfg:look.cfg, layers, eyeColor:look.eye}, ps1:look.ps1 }, worn);
  const w = full.width;
  cv.width = 144; cv.height = 144;
  cv.getContext("2d").drawImage(full, w*0.1, w*0.14, w*0.8, w*0.8, 0, 0, 144, 144);
  cv.classList.add("ready");
}
function submitRun(run, win, drip){
  const nft = run.base.nft;
  return api("/api/score", {
    player: playerId(), name: run.name, score: drip, day: run.day, win, bosses: run.bossesBeaten, kills: run.kills, heat: run.heat||0,
    tribe: run.tribe, collection: nft ? nft.kind : "milady", token: nft ? nft.id : null,
    relics: run.relics.slice(0,8).map((id,i)=>[id, (run.tiers||[])[i]||1]), killedBy: win ? "" : (run.killedBy||""),
    daily: run.daily||null, seed: run.daily ? null : (run.seedCode||null), look: lookOf(run.base),
  });
}
async function loadPulse(){ // everyone's games and wins, on the title screen
  const p = await api("/api/pulse"), el = $("pulse");
  if(!p || !el || !p.lifetime.games){ if(el) el.classList.add("hidden"); return; }
  const cell = (label, d)=>"<div class='pcell'><u>"+label+"</u><b>"+d.games.toLocaleString()+"</b><span>game"+(d.games===1?"":"s")+" · "+d.wins.toLocaleString()+" win"+(d.wins===1?"":"s")+"</span></div>";
  el.innerHTML = "<div class='phead'>the timeline, worldwide</div><div class='pgrid'>"+cell("today", p.today)+cell("this week", p.week)+cell("all time", p.lifetime)
    + "<div class='pcell'><u>all time</u><b>"+p.players.toLocaleString()+"</b><span>player"+(p.players===1?"":"s")+" · "+p.lifetime.kills.toLocaleString()+" kills</span></div></div>";
  el.classList.remove("hidden");
}
function rankLines(res){ // "#3 of 41 on today's daily" for each board the run landed on
  if(!res || !res.boards) return "";
  return Object.keys(res.boards).sort().reverse().filter(k=>!(k.startsWith("seed:") && res.boards[k].total<2)).map(k=>{ // a map only you have played isn't a ranking yet
    const b = res.boards[k], what = k==="all" ? "all-time" : k.startsWith("daily:") ? "the "+k.slice(6)+" daily" : "this map";
    return "<div>"+(k==="all"?"🏆":k.startsWith("daily:")?"📅":"🔗")+" <b>#"+b.rank+"</b> of "+b.total+" on "+what+(b.score>res.sent ? " <span class='dim'>(your best: "+b.score+")</span>" : "")+"</div>";
  }).join("");
}
/* the board itself: tabs for today's daily, all-time, and the current map when it has a seed */
async function openBoard(tab, back, seed){
  const day = today(), tabs = [["daily","📅 today"],["all","🏆 all-time"]].concat(seed ? [["seed","🔗 this map"]] : [], [["hall","🏛 hall of fame"]]);
  const shell = body => "<h2>leaderboard</h2><div class='pick-row'>"+tabs.map(([k,l])=>"<button class='pick"+(k===tab?" on":"")+"' data-tab='"+k+"'>"+l+"</button>").join("")+"</div>"
    + body+"<div class='row'><button class='btn small' id='board-close'>"+(back ? "← back" : "close")+"</button></div>";
  const wire = ()=>{
    $("modal-panel").querySelectorAll("[data-tab]").forEach(b=>{ b.onclick=()=>{ sfx("click"); openBoard(b.dataset.tab, back, seed); }; });
    $("board-close").onclick=()=>{ sfx("click"); back ? back() : closeModal(); };
  };
  openModal(shell("<div class='note'>loading…</div>")); wire();
  if(tab==="hall"){ // every daily map's champion, as a wall of faces
    const h = await api("/api/hall");
    if($("modal").classList.contains("hidden") || !$("board-close")) return;
    const days = h ? h.days : [];
    openModal(shell(!h ? "<div class='note bad'>the leaderboard can't be reached right now</div>"
      : !days.length ? "<div class='note'>no daily map has a champion yet. today's is open.</div>"
      : "<div class='hall'>"+days.map((e,i)=>"<div class='hcard"+(e.date===h.today?" live":"")+"'><canvas class='bpfp' data-n='"+i+"' width='4' height='4'></canvas><u>"+esc(e.date)+"</u><b>"+esc(e.name)+"</b><em>"+e.score+(e.win?" 👑":"")+"</em><span>"
          + (e.date===h.today ? "still open · " : "")+e.players+" player"+(e.players===1?"":"s")+"</span></div>").join("")+"</div>"
        + "<div class='note'>the best run on each day's map. today's spot is still up for grabs until midnight UTC.</div>")); wire();
    for(const cv of [...$("modal-panel").querySelectorAll(".bpfp")]){
      if(!cv.isConnected) return;
      try{ await drawLook(cv, days[+cv.dataset.n].look, days[+cv.dataset.n].relics); }catch(err){}
    }
    return;
  }
  const q = tab==="daily" ? "daily="+day : tab==="seed" ? "seed="+seed : "all=1";
  const res = await api("/api/board?"+q+"&limit=50&player="+playerId());
  if($("modal").classList.contains("hidden") || !$("board-close")) return; // closed while loading
  let body;
  if(!res) body = "<div class='note bad'>the leaderboard can't be reached right now</div>";
  else if(!res.top.length) body = "<div class='note'>nobody is on this board yet. be the first.</div>";
  else body = "<div class='board'>"+res.top.map(e=>{
      const me = res.you && res.you.rank===e.rank, tr = TRIBES.find(t=>t.id===e.tribe);
      const relics = e.relics.filter(r=>ICONS[r[0]]).map(r=>"<img class='relic-ico "+["","","gold","diamond"][r[1]]+"' src='"+ICONS[r[0]]+"' alt='' title='"+esc(relicById(r[0]).name)+"'>").join("");
      return "<div class='brow"+(me?" me":"")+(e.rank<=3?" top":"")+"'><i>"+e.rank+"</i><canvas class='bpfp' data-n='"+(e.rank-1)+"' width='4' height='4'></canvas><div class='bname'><b>"+esc(e.name)+"</b><span>"+(tr?tr.icon+" ":"")
        + (e.token!=null ? esc(e.collection)+" #"+e.token+" · " : "")+(e.win ? "👑 timeline saved" : "day "+e.day+(e.killedBy ? " · "+esc(e.killedBy) : ""))+(e.heat?" · 🔥"+e.heat:"")+"</span></div>"
        + "<div class='brel'>"+relics+"</div><em>"+e.score+"</em></div>";
    }).join("")+"</div>"
    + "<div class='note'>"+res.total+" player"+(res.total===1?"":"s")+(res.you ? " · you are <b>#"+res.you.rank+"</b> with "+res.you.score : tab==="daily" ? " · play the daily run to get on this board" : "")+"</div>";
  openModal(shell(body)); wire();
  if(res && res.top.length){ // the characters, drawn one after another so the list stays responsive
    $("modal-panel").querySelector(".board").insertAdjacentHTML("beforebegin", "<div class='lineup'>"+res.top.slice(0,12).map((e,i)=>"<canvas class='bpfp big' data-n='"+i+"' width='4' height='4' title='"+esc(e.name)+" · "+e.score+"'></canvas>").join("")+"</div>");
    for(const cv of [...$("modal-panel").querySelectorAll(".bpfp")]){
      if(!cv.isConnected) return; // the board was closed or switched
      const e = res.top[+cv.dataset.n];
      try{ await drawLook(cv, e.look, e.relics); }catch(err){}
    }
  }
}
/* a 1200x630 image of the run, for posting */
async function shareCard(run, win, drip){
  const cv = document.createElement("canvas"); cv.width=1200; cv.height=630;
  const cx = cv.getContext("2d"), MONO = "'JetBrains Mono','Fira Mono','Menlo','Consolas',monospace";
  cx.fillStyle = "#000"; cx.fillRect(0,0,1200,630);
  const glow = cx.createRadialGradient(250,300,20,250,300,520); glow.addColorStop(0,"rgba(139,233,253,.20)"); glow.addColorStop(1,"rgba(139,233,253,0)");
  cx.fillStyle = glow; cx.fillRect(0,0,1200,630);
  for(let i=0;i<120;i++){ cx.fillStyle="rgba(139,233,253,"+(0.15+Math.random()*0.5)+")"; cx.fillRect(Math.random()*1200, Math.random()*630, 2, 2); }
  // the site's corner brackets
  cx.strokeStyle = "rgba(139,233,253,.5)"; cx.lineWidth = 2;
  for(const [x,y,dx,dy] of [[18,18,1,1],[1182,18,-1,1],[18,612,1,-1],[1182,612,-1,-1]]){ cx.beginPath(); cx.moveTo(x+dx*40,y); cx.lineTo(x,y); cx.lineTo(x,y+dy*40); cx.stroke(); }
  // the Milady, as a hologram
  const st = cx.createRadialGradient(250,270,20,250,310,330); st.addColorStop(0,"rgba(139,233,253,.34)"); st.addColorStop(0.55,"rgba(139,233,253,.10)"); st.addColorStop(1,"rgba(139,233,253,.02)");
  cx.fillStyle = "#010506"; cx.beginPath(); cx.roundRect(50,60,400,500,12); cx.fill();
  cx.fillStyle = st; cx.beginPath(); cx.roundRect(50,60,400,500,12); cx.fill();
  cx.save(); cx.beginPath(); cx.roundRect(50,60,400,500,12); cx.clip();
  cx.drawImage(win ? run.avatar : fry(run.avatar, "CANCELLED"), 50, 60, 400, 500);
  cx.fillStyle = "rgba(0,0,0,.16)"; for(let y=60;y<560;y+=4) cx.fillRect(50,y,400,2); // scanlines
  cx.restore();
  cx.lineWidth = 1.5; cx.strokeStyle = "rgba(139,233,253,.6)"; cx.beginPath(); cx.roundRect(50,60,400,500,12); cx.stroke();
  const text = (t, x, y, px, color, w) => { cx.font = (w||"bold")+" "+px+"px "+MONO; cx.fillStyle = color; cx.fillText(t, x, y); };
  cx.textBaseline = "alphabetic";
  cx.shadowColor = "rgba(139,233,253,.7)"; cx.shadowBlur = 18;
  text("the cancel", 500, 108, 50, "#fff"); text("is coming_", 500 + cx.measureText("the cancel ").width, 108, 50, "#8be9fd");
  cx.shadowBlur = 0;
  const tribe = TRIBES.find(t=>t.id===run.tribe) || TRIBES[0];
  text((run.name+" · "+tribe.name+(run.heat?" · heat "+run.heat:"")+(run.daily?" · daily "+run.daily:run.seedCode?" · map "+run.seedCode:"")).toLowerCase(), 500, 156, 24, "#bdbdbd", "normal");
  text(win ? "timeline saved" : "cancelled on day "+run.day, 500, 240, 44, win ? "#50fa7b" : "#ff5555");
  text(run.bossesBeaten+" / 3 bosses  ·  "+run.kills+" kills  ·  "+run.cult+" $CULT", 500, 288, 24, "#eaeaea", "normal");
  text("DRIP", 500, 366, 18, "#666"); text(String(drip), 500, 438, 76, "#f1fa8c");
  const sets = setRows(run.relics).filter(r=>r.on.length).map(r=>r.t.name+" "+r.c).join("  ").toLowerCase();
  if(sets) text(sets, 720, 420, 20, "#bd93f9", "normal");
  // relics
  const ims = await Promise.all(run.relics.map(id=>loadImg(ICONS[id]).catch(()=>null)));
  ims.forEach((im,i)=>{
    const x = 500+i*92, y = 470;
    cx.fillStyle = "#06090b"; cx.beginPath(); cx.roundRect(x,y,82,82,8); cx.fill();
    cx.lineWidth = 1.5; cx.strokeStyle = {rare:"#f1fa8c", legendary:"#ff79c6", cursed:"#bd93f9"}[relicById(run.relics[i]).rar] || "rgba(139,233,253,.3)"; cx.stroke();
    if(im) cx.drawImage(im, x+5, y+5, 72, 72);
  });
  text((location.host || "tylerirl.com").toUpperCase(), 500, 598, 16, "#666", "normal");
  return cv;
}
function leaveRun(){
  SEED = null; stopTravel();
  $("modal").classList.add("hidden");
  $("boss-banner").classList.add("hidden");
}

/* ---------- avatar screen ---------- */
let AVA = null, avaTok = 0;
/* names end up inside HTML in the feed and dialogs, so keep them to plain characters */
const cleanName = v => v.replace(/[<>&"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 18);
const PICK = { tribe:"", heat:0, daily:"", seed:"" }; // what the avatar screen is setting up
const today = () => new Date().toISOString().slice(0,10);
function renderPicks(){
  if(!TRIBES.some(t=>t.id===PICK.tribe)) PICK.tribe = META.tribe || TRIBES[0].id;
  PICK.heat = PICK.daily||PICK.seed ? 0 : clamp(PICK.heat, 0, META.heat||0);
  $("tribes").innerHTML = TRIBES.map(t=>"<button class='pick"+(t.id===PICK.tribe?" on":"")+"' data-t='"+t.id+"'>"+t.icon+" "+t.name+"</button>").join("");
  const kit = (AVA && AVA.picks.kit) || {};
  const t = TRIBES.find(x=>x.id===PICK.tribe), r = relicById(kit.relic || t.relic);
  $("tribe-desc").innerHTML = "<img class='relic-ico' src='"+(ICONS[r.id]||"")+"' alt=''><div><b>"+t.desc+"</b><span>starts with "+r.name+" — "+r.desc+"</span>"
    + (kit.note && kit.note.length ? "<span class='kit'>token kit: "+kit.note.join(" · ")+"</span>" : "")+"</div>";
  $("tribes").querySelectorAll(".pick").forEach(b=>{ b.onclick=()=>{ PICK.tribe=b.dataset.t; META.tribe=PICK.tribe; saveMeta(); sfx("click"); renderPicks(); }; });
  const max = META.heat||0;
  $("heat-row").innerHTML = PICK.daily ? "<div class='note good'>📅 DAILY MAP "+PICK.daily+" — the same maze, bosses and loot spots for everyone</div>"
    : PICK.seed ? "<div class='note good'>🔗 MAP "+PICK.seed+" — the same maze as whoever sent you the link</div>"
    : !max ? "" : "<div class='kicker'>heat</div><div class='pick-row'>"+Array.from({length:max+1},(_,i)=>"<button class='pick"+(i===PICK.heat?" on":"")+"' data-h='"+i+"'>"+(i?"🔥 "+i:"off")+"</button>").join("")+"</div>"
      + "<div class='note'>"+(PICK.heat ? HEAT.slice(0,PICK.heat).join(" · ")+" · +"+25*PICK.heat+"% DRIP" : "beat THE CANCEL to unlock the next heat")+"</div>";
  $("heat-row").querySelectorAll(".pick").forEach(b=>{ b.onclick=()=>{ PICK.heat=+b.dataset.h; sfx("click"); renderPicks(); }; });
}
async function genAvatar(nft){
  const tok = ++avaTok;
  const ava = { picks: basePicks(), name: choice(NAMES) };
  if(nft && !(NFT[nft.kind] && NFT[nft.kind].playable)) nft = null; // only Miladys and Remilios are playable
  if(nft){
    const label = NFT[nft.kind].name+" #"+nft.id;
    $("nft-msg").textContent = "loading "+label+"…";
    $("avatar-canvas").classList.add("loading"); $("nft-load").disabled = true;
    // first choice: its traits, so it can be rebuilt in layers. failing that, its flat picture
    const traits = await tokenTraits(nft), tk = traits ? tokenLayers(nft.kind, traits) : null;
    const ok = tk ? true : await loadNft(nft).then(()=>true, ()=>false);
    $("avatar-canvas").classList.remove("loading"); $("nft-load").disabled = false;
    if(tok!==avaTok) return;
    $("nft-msg").textContent = tk ? "playing as "+label+", rebuilt from its traits: relics replace what it wears"
      : ok ? "playing as "+label+" — its traits couldn't be read, so relics are drawn over its picture"
      : "couldn't load that one — check the number and your connection";
    if(tk){ ava.picks.kit = tokenKit(nft.kind, traits, tk); if(ava.picks.kit.tribe) PICK.tribe = ava.picks.kit.tribe; }
    if(ok){ ava.picks.nft = nft; if(tk) ava.picks.token = tk; ava.name = NFT[nft.kind].name.toLowerCase()+" #"+nft.id; META.nft = nft; saveMeta(); }
  } else $("nft-msg").textContent = "";
  ava.canvas = await composeAvatar(ava.picks, []);
  if(tok!==avaTok) return;
  AVA = ava;
  const cv = $("avatar-canvas");
  paint(cv, ava.canvas); paint($("hud-avatar"), ava.canvas);
  cv.classList.remove("pop"); void cv.offsetWidth; cv.classList.add("pop");
  $("name-in").placeholder = ava.name;
  document.querySelector("#screen-avatar h2").textContent = "your "+(ava.picks.nft && ava.picks.nft.kind==="remilio" ? "remilio" : "milady");
  renderPicks();
  $("btn-begin").disabled = false;
  if(navBegin){ navBegin = false; navSet($("btn-begin")); } // arriving here, Enter should start the run
}

/* ---------- title / unlocks ---------- */
function renderTitle(){
  $("meta-drip").textContent=META.drip; $("meta-wins").textContent=META.wins; loadPulse();
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

/* ---------- touch: swipe on the map to step that way ---------- */
function initSwipe(){
  const w = $("map-wrap"); let sx=0, sy=0, st=0;
  w.addEventListener("touchstart", ev=>{ const t=ev.touches[0]; sx=t.clientX; sy=t.clientY; st=Date.now(); }, {passive:true});
  w.addEventListener("touchend", ev=>{
    const t = ev.changedTouches[0], dx = t.clientX-sx, dy = t.clientY-sy;
    if(Date.now()-st>600 || Math.max(Math.abs(dx),Math.abs(dy))<28) return; // a tap or a slow drag, not a swipe
    ev.preventDefault(); // or the lift would also count as a tap on whatever tile is under the finger
    if(!G || G.over || busy()) return;
    stopTravel();
    const d = Math.abs(dx)>Math.abs(dy) ? [Math.sign(dx),0] : [0,Math.sign(dy)];
    tryMove(G.px+d[0], G.py+d[1]);
  });
}

/* ---------- keyboard ---------- */
const KEY_DIRS = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0], w:[0,-1], s:[0,1], a:[-1,0], d:[1,0] };
/* Arrow keys drive everything. On the map they move you; anywhere else they move a highlight between the
   things you can choose, and Enter picks the highlighted one. The highlight only shows once a key has been used. */
const KEY_BACK = ["set-close","board-close","forge-leave","draft-skip","shop-leave","shrine-leave","fire-no","boss-wait","build-close","drop-back","meme-back","ev-ok","tut-ok"];
const ARROWS = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] };
let navSel = null, navAt = { scope:"", index:0 }, navBegin = false;
function navScope(){ // whichever dialog or screen the keys currently belong to; null on the map
  if(!$("modal").classList.contains("hidden")) return $("modal-panel");
  for(const id of ["screen-combat","screen-title","screen-avatar"]) if($(id).classList.contains("active")) return $(id);
  return null;
}
function navItems(scope){
  return [...scope.querySelectorAll(".card, .choice, button, input, select")].filter(el=>!el.disabled && el.offsetParent!==null);
}
function navKey(scope){ const h = scope.querySelector("h2"); return scope.id+"|"+(h ? h.textContent : ""); }
function navSet(el, scroll){
  if(navSel && navSel!==el) navSel.classList.remove("ksel");
  navSel = el;
  if(!el) return;
  el.classList.add("ksel");
  const scope = navScope();
  if(scope) navAt = { scope:navKey(scope), index:navItems(scope).indexOf(el) };
  if(document.activeElement!==el){ if(!el.hasAttribute("tabindex") && !/^(BUTTON|INPUT|SELECT)$/.test(el.tagName)) el.tabIndex = -1; el.focus({preventScroll:true}); }
  if(scroll) el.scrollIntoView({block:"nearest", inline:"nearest"});
}
function navRefresh(){ // make sure something sensible is highlighted in the current dialog or screen
  const scope = navScope();
  if(!scope){ navSet(null); if(document.activeElement && document.activeElement!==document.body) document.activeElement.blur(); return; }
  const items = navItems(scope);
  if(!items.length) return navSet(null);
  if(navSel && items.includes(navSel)) return navSet(navSel);
  // the dialog was redrawn (a toggle, a purchase): stay on the same position; otherwise start on the main choice
  const same = navAt.scope===navKey(scope) && navAt.index>=0;
  navSet(same ? items[Math.min(navAt.index, items.length-1)]
    : scope.querySelector(".card, .choice:not(:disabled)") || items.find(el=>el.classList.contains("big")) || items[0], true);
}
function navMove(dx, dy){ // step to the nearest choice in that direction
  const scope = navScope(), items = navItems(scope);
  if(!items.length) return;
  if(!navSel || !items.includes(navSel)) return navRefresh();
  const a = navSel.getBoundingClientRect(), ax = a.left+a.width/2, ay = a.top+a.height/2;
  let best = null, bestD = Infinity;
  for(const el of items){
    if(el===navSel) continue;
    const r = el.getBoundingClientRect(), ex = r.left+r.width/2, ey = r.top+r.height/2;
    const along = dx ? (ex-ax)*dx : (ey-ay)*dy, across = dx ? Math.abs(ey-ay) : Math.abs(ex-ax);
    if(along < (dx ? 4 : (a.height+r.height)/4)) continue; // not in that direction (up and down must reach another row)
    if(dx && across > Math.max(a.height, r.height)*0.6) continue; // left and right stay on the same row
    const d = along + across*2.5;
    if(d<bestD){ bestD = d; best = el; }
  }
  if(!best && dx){ // end of a row: wrap along the reading order
    const i = items.indexOf(navSel); best = items[(i+(dx>0?1:-1)+items.length)%items.length];
  }
  if(best){ navSet(best, true); sfx("step"); }
}
function onKey(ev){
  if(ev.ctrlKey || ev.metaKey || ev.altKey) return;
  document.body.classList.add("kb");
  const scope = navScope(), typing = /^(INPUT|TEXTAREA)$/.test(ev.target.tagName) && ev.target.type!=="checkbox", arrow = ARROWS[ev.key];
  if(scope){
    if(typing && !(ev.key==="ArrowUp" || ev.key==="ArrowDown" || ev.key==="Enter" || ev.key==="Escape")) return; // let the field have its keys
    if(arrow){
      ev.preventDefault();
      if(ev.target.tagName==="SELECT" && arrow[0]){ // left and right change a dropdown; up and down leave it
        const sel = ev.target; sel.selectedIndex = (sel.selectedIndex+arrow[0]+sel.options.length)%sel.options.length; sel.dispatchEvent(new Event("change")); return;
      }
      return navMove(arrow[0], arrow[1]);
    }
    const n = parseInt(ev.key, 10);
    if(!typing && n>=1 && n<=9){
      const opts = [...scope.querySelectorAll(".card, .choice, .shop-row .btn[data-i], .bet-row .btn")].filter(el=>!el.disabled && el.offsetParent!==null);
      if(n<=opts.length){ ev.preventDefault(); navSet(opts[n-1]); opts[n-1].click(); }
      return;
    }
    if(ev.key==="Enter" || (ev.key===" " && !typing)){
      ev.preventDefault();
      if(typing){ if(ev.target.id==="nft-id") $("nft-load").click(); else navMove(0,1); return; }
      if(!navSel || !navItems(scope).includes(navSel)) navRefresh();
      if(navSel && navSel.tagName!=="SELECT") navSel.click();
      return;
    }
    if(ev.key==="Escape"){
      const back = KEY_BACK.map($).find(el=>el && !el.disabled && scope.contains(el));
      if(back){ ev.preventDefault(); back.click(); }
      return;
    }
    return;
  }
  // the map
  if(!G || G.over) return;
  if(ev.key==="Escape"){ openSettings(); return; }
  if(ev.key==="b" || ev.key==="B"){ openBuild(); return; }
  const dir = KEY_DIRS[ev.key.length===1 ? ev.key.toLowerCase() : ev.key];
  if(!dir || busy()) return;
  stopTravel();
  ev.preventDefault();
  tryMove(G.px+dir[0], G.py+dir[1]);
}

/* ---------- init ---------- */
async function init(){
  loadMeta(); renderTitle(); setMute(META.mute); applyCalm(); applyBackground();
  document.body.classList.add("on-title");
  if(!/^https?:/.test(location.protocol)) $("floating-home").remove(); // opened as a file: there is no site to go home to
  document.querySelectorAll(".gear").forEach(b=>{ b.onclick=()=>{ sfx("click"); openSettings(); }; });
  let ready = loadAssets().then(renderCodex); // start loading right away so ENTER is instant
  ready.catch(()=>{});
  $("btn-continue").onclick=async()=>{
    const d = loadRun(); if(!d) return renderTitle();
    $("btn-continue").disabled=true;
    try{ await ready; await resumeRun(d); sfx("relic"); }
    catch(e){ clearRun(); renderTitle(); }
    $("btn-continue").disabled=false;
  };
  $("btn-board").onclick=()=>{ sfx("click"); openBoard("daily"); };
  if(!online()) $("btn-board").remove();
  $("btn-daily").onclick=()=>{ PICK.daily = today(); PICK.seed = ""; $("btn-start").click(); };
  const link = linkedRun();
  if(link){ // arrived by a shared link: offer that exact map first
    const b = $("btn-link");
    b.textContent = link.daily ? "▶ PLAY THE "+(link.daily===today() ? "DAILY" : link.daily)+" MAP" : "▶ PLAY SHARED MAP "+link.seed;
    b.classList.remove("hidden");
    b.onclick=()=>{ PICK.daily = link.daily||""; PICK.seed = link.seed||""; $("btn-start").click(); };
    $("link-note").textContent = "someone sent you this map — same maze, same bosses, same loot spots";
  }
  $("minimap").onclick=()=>$("minimap").classList.toggle("big");
  $("btn-start").onclick=async(ev)=>{
    if(ev && ev.isTrusted){ PICK.daily = ""; PICK.seed = ""; } // a real click on this button is a normal run
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
  $("name-in").value = META.name || "";
  $("nft-kind").innerHTML = Object.keys(NFT).filter(k=>NFT[k].playable).map(k=>"<option value='"+k+"'>"+NFT[k].name+"</option>").join("");
  if(META.nft && NFT[META.nft.kind] && NFT[META.nft.kind].playable){ $("nft-kind").value = META.nft.kind; $("nft-id").value = META.nft.id; }
  const useNft = ()=>{
    const kind = $("nft-kind").value, id = parseInt($("nft-id").value, 10);
    if(!(id>=0 && id<=NFT[kind].max)){ $("nft-msg").textContent = "enter a token number from 0 to "+NFT[kind].max; return; }
    sfx("click"); $("btn-begin").disabled = true; genAvatar({kind, id});
  };
  $("nft-load").onclick = useNft;

  $("btn-begin").onclick=()=>{
    if(!AVA) return;
    clearRun();
    const typed = cleanName($("name-in").value);
    META.name = typed; saveMeta();
    if(typed) AVA.name = typed;
    newRun(AVA, { tribe:PICK.tribe, heat:PICK.daily||PICK.seed ? 0 : PICK.heat, daily:PICK.daily, seed:PICK.seed });
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
  document.addEventListener("mousemove", ()=>document.body.classList.remove("kb"), {passive:true}); // the mouse takes over: hide the key highlight
  document.addEventListener("mouseover", ev=>{ // and whatever it points at becomes the selection, so the two never disagree
    const scope = navScope(), el = scope && ev.target.closest && ev.target.closest(".card, .choice, button");
    if(el && scope.contains(el) && !el.disabled && el!==navSel){ if(navSel) navSel.classList.remove("ksel"); navSel = el; el.classList.add("ksel"); navAt = { scope:navKey(scope), index:navItems(scope).indexOf(el) }; }
  });
  navRefresh();
  initSwipe();
  if(TOUCH) document.querySelector("#screen-map .hint").textContent = "swipe or tap a neighbouring tile to move · tap any explored tile to walk there · tap a foe once to scout it · tap the minimap to enlarge";
  window.addEventListener("resize", ()=>{ if(G && !G.over && $("screen-map").classList.contains("active")){ camSnap = true; renderMap(); } });
}
document.addEventListener("DOMContentLoaded", init);
