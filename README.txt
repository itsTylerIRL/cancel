THE CANCEL IS COMING — a Remilia roguelite autobattler

DEPLOY: this repo is the site. GitHub Pages serves index.html (plus css/,
js/ and assets/) at https://cancel.tylerirl.com — the CNAME file names the
domain, and the DNS record is a CNAME from "cancel" to
itstylerirl.github.io. In the repo: Settings -> Pages -> Deploy from a
branch -> main, / (root). No build step.

To try it locally: `python3 -m http.server` in this folder. Opening
index.html by double-click does not work in most browsers.

SINGLE FILE: `python3 build.py` writes dist.html, the whole game in one
file. It is not committed; it is only for handing the game around.

HOW TO PLAY:
- Name yourself on the avatar screen (or leave it blank for the default).
- You are a Milady in a big maze (41x41, four boss gates, one per district). Move one tile per step (click a neighbouring
  tile, or arrows / WASD), or click any explored tile to walk there.
  The map is bigger than the window: it follows
  you, you can scroll or drag it to look around, and the minimap in the
  corner shows what you have explored. Loot tends to sit in dead ends.
- Loot chests 🎁, scavenge graves 🪦, shop 🏪, gamble at Degen Shrines 🎰,
  rest at campfires 🔥, and walk into events ❓ (Milady Raves, Bonkler
  auctions, Miladychan threads...). Faces on the map are monsters;
  a gold ring means elite.
- Pick a tribe before each run (Hypebeast, Gyaru, Lolita, Harajuku, Prep):
  each starts with its own relic and a small bonus.
- The four districts each bend a rule: 4-relic chests, richer fights,
  cheaper shops, luckier shrines.
- Days 3, 6 and 9 bring a boss, drawn from a pool; THE CANCEL is always last.
  At half health every boss fight stops and asks you to make a call.
  Fight it at the ⛩️ gate when you are ready — otherwise it finds you
  when that night ends.
- Combat is automatic — your relic build fights for you.
  Hover a foe (or tap it once on a phone) to see your odds before you commit;
  the coloured dot on each foe is the same estimate at a glance.
- A relic you already hold can drop again. The duplicate takes its own
  slot and does nothing extra until Remilia Jackson (the smiley on the map)
  fuses the pair: two normal make one GOLD (numbers x1.5), two GOLD make one
  DIAMOND (x2). He only fuses; copies have to be found. A diamond therefore
  needs four copies and enough free slots to carry them to him.
- Relics come in common / rare / legendary (and cursed, from the Black
  Market unlock). Each belongs to one or two sets — ARMED, HYPEBEAST, DEGEN,
  KAWAII, CULT, SCHIZO, SQUAD, BONKLER, CHEESEWORLD. Hold enough of a set and its
  synergy switches on; draft cards show when a pick would do that.
- CHEESEWORLD: deep-fried animal yakuza roam the map and go harder the
  longer a fight lasts; a CHEESEWORLD relic set deep-fries your own Milady.
- MILADYCRAFT: blocky Griefers and Blimp Bombers, the Grand Remilia Ball,
  and a seed phrase buried somewhere near spawn.
- The run autosaves whenever you are standing on the map. Luck is seeded
  and saved with the run, so reloading replays the same outcome.
- Shared maps. Every run grows from a short seed code. The result text
  ends with a link (?seed=k3x9ab, or ?daily=2026-10-04 for a daily) and
  anyone who opens it is offered that exact map: same maze, same loot
  spots, same gates, same bosses, same monster positions.
- Daily map: one seed per (UTC) day, the same for everyone. Which enemies
  stand on the monster tiles and which relics drop can differ between
  players (your collection and unlocks change the pools).
- Heat: each win unlocks a harder optional modifier worth more DRIP.
- The end screen gives a copyable emoji result, a share-to-X button and a
  share card (PNG) of your Milady and build.
- Play as your own Milady or Remilio: enter a token number on the avatar
  screen. Ownership is not checked. Every other collection (Pixelady,
  Radbro, SchizoPosters, MiladyStation, oh.. I've seen) appears only as
  enemies and NPCs. Token images come from outside services, listed in the
  NFT table in js/game.js: the collections' own sites, the wsrv.nl image
  proxy (resizes and adds the CORS header), the filebase IPFS gateway,
  arweave.net and a public Ethereum node.
- Bonklers are bosses only; no ordinary enemy uses Bonkler art.
- You never fight your own collection: a Milady meets no Miladys, a Remilio
  no Remilios. Pixelady, Radbro, SchizoPoster, MiladyStation and oh.. I've
  seen enemies show real tokens when online and fall back to trait layers.
- Phones: swipe on the map to step, tap an explored tile to walk there,
  bigger tiles (7 across), drafts as a list, and images go to the share sheet.
- Keyboard: the arrow keys do everything. On the map they move you; in any
  menu or screen they move a green highlight between the choices, Enter
  picks the highlighted one and Esc backs out. 1-9 also pick, B opens your
  build, Esc on the map opens settings. Hovering an explored tile previews
  the walk and its length. Ordinary wins continue on their own.
- Settings (the gear): sound, fight speed, auto-continue, skip easy fights,
  calm mode (no shake, flashing or confetti), and abandon run.
- Fights you cannot lose and that barely scratch you are settled on the map
  without opening the fight screen.
- Meme maker on the end screen: top text, bottom text, deep fry, save.
- Derivatives in the maze: SchizoPosters (text-buried elites, an event),
  Radbro (mirror enemy, the Webring event and legendary), MiladyStation
  (Player Character enemies, an event, the Memory Card), Pixelady (pixel
  enemies and revived Death Knights), and Shiro's Oh... I See (an event
  and a hand-drawn 1/1 legendary).

- Your Milady is built from trait layers with no background, and she wears
  what she loots: hats, glasses, shirts, costumes, weapons, friends.

LOOK: themed to match tylerirl.com — black, the cyan #8be9fd accent,
Dracula colours for meaning, JetBrains Mono, lowercase headings with a
blinking cursor, thin cyan borders, corner brackets, and a "Return Home"
card on the title screen (it links to "/"; hidden when opened as a file).
The palette is the :root block at the top of css/style.css and the theme
rules are the block at the end. It does not load the site's own scripts
(3D background, custom cursor, radgotchi); the page works on its own.

LEADERBOARD: server/server.py is a small Python service (standard library
only, SQLite) that keeps each player's best run per board: today's daily,
all-time, and one board per shared map. The game posts a finished run to
it and shows your rank; if the service can't be reached the game carries
on without it. Scores can't be proven (the game runs in the browser), so
the service checks shape and plausibility and rate-limits, nothing more.
It runs on the droplet as the systemd unit cancel-api (server/
cancel-api.service) on 127.0.0.1:8787, behind nginx (server/
nginx-cancel-api.conf) at https://cancel-api.tylerirl.com. Settings are in
/etc/cancel-api.env, data in /var/lib/cancel-api/scores.db. To update it:
copy server.py to /opt/cancel-api/ and `systemctl restart cancel-api`.
The address the game uses is API_DEFAULT in js/game.js.

CONTENT lives in js/data.js: relics, sets, rarity odds, enemies, bosses,
events, names, unlocks. A relic's numbers live in computeStats() and
fightEngine() in js/game.js, keyed by its id.
Relic icons point at trait files by name: ["Remilio","Hat","Tinfoil"].

Assets: official Remilia trait layers from maker.remilia.org (copyleft),
$CULT coin logo from Dexscreener. Not affiliated with Remilia Corporation.
