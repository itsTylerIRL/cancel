THE CANCEL IS COMING — a Remilia roguelite autobattler

DEPLOY: serve this folder statically (index.html + css/ + js/ + assets/),
or upload dist.html on its own — it is the whole game in a single file.
No server needed. Opening index.html by double-click does not work in most
browsers (local file restrictions); use dist.html or `python3 -m http.server`.

BUILD: `python3 build.py` regenerates dist.html from the sources.
Run it after any change to index.html, css/, js/ or assets/.

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
- A relic you already hold can drop again. The copy takes no slot; bring
  2 copies to Remilia Jackson (the smiley on the map) to fuse it to GOLD
  (numbers x1.5) and 4 for DIAMOND (x2). She also sells copies for $CULT.
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
- Daily run: one seed per (UTC) day, same maze and same luck for everyone.
- Heat: each win unlocks a harder optional modifier worth more DRIP.
- The end screen gives a copyable emoji result, a share-to-X button and a
  share card (PNG) of your Milady and build.
- Play as your own NFT: pick a collection and enter a token number on the
  avatar screen. Supported: Milady, Remilio, Pixelady, Radbro, SchizoPosters,
  MiladyStation and oh.. I've seen (Shiro). Ownership is not checked.
  Where each collection's images come from is the NFT table in js/game.js.
  It relies on outside services: the wsrv.nl image proxy (resizes and adds
  the CORS header), the filebase IPFS gateway, radbro.xyz / schizoposters.xyz
  metadata, arweave.net, and a public Ethereum node for oh.. I've seen.
- You never fight your own collection: a Milady meets no Miladys, a Radbro
  no Radbros. Pixelady, Radbro, SchizoPoster, MiladyStation and oh.. I've
  seen enemies show real tokens when online and fall back to trait layers.
- Phones: swipe on the map to step, tap an explored tile to walk there,
  bigger tiles (7 across), drafts as a list, and images go to the share sheet.
- Keyboard: arrows / WASD move, 1-9 pick an option in any dialog, Enter
  confirms, Esc backs out, B opens your build. Hovering an explored tile
  previews the walk and its length. Ordinary wins continue on their own.
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

CONTENT lives in js/data.js: relics, sets, rarity odds, enemies, bosses,
events, names, unlocks. A relic's numbers live in computeStats() and
fightEngine() in js/game.js, keyed by its id.
Relic icons point at trait files by name: ["Remilio","Hat","Tinfoil"].

Assets: official Remilia trait layers from maker.remilia.org (copyleft),
$CULT coin logo from Dexscreener. Not affiliated with Remilia Corporation.
