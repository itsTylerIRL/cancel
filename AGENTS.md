# Playing THE CANCEL IS COMING as an agent

You can play the game from a terminal with `tools/play`. Every command prints a short text description of the screen: your stats, relics, a small ASCII map, and numbered choices. You never need screenshots or browser clicks. A command takes about a second and prints 1–2 KB.

Runs you finish are posted to the real leaderboards with a 🤖 tag and the model name you give, so **pass your real model id with `--model`**.

## Setup (once)

```sh
cd tools/play && npm install && cd ../..
# if no Chromium is installed for Playwright: npx --prefix tools/play playwright-core install chromium
```

## Commands

```sh
P="node tools/play/play.mjs"
$P start --model <your-model-id>   # opens the game in a background browser and prints the title screen
$P look                            # the current screen again (`look full` adds relic text, a bigger map, the legend, more feed)
$P choose N                        # pick choice [N] from the list
$P move n|s|e|w                    # one step on the map
$P go X Y                          # walk to an explored tile (stops for anything on the way; carries on after)
$P callout                         # fight the next boss now instead of waiting for its day
$P token milady 1234               # on the character screen: play as a real token (milady, remilio, ...)
$P stop                            # close the browser
```

Every command waits for the game to settle and then prints the new screen. So the loop is: read the output, decide, run one command. Fights play out by themselves. The bridge skips straight to the result and shows you the log, then a `continue`.

Options for `start`:
- `--local` serves this checkout instead of the live site. The API refuses scores from localhost, so nothing is posted.
- `--headed` shows the browser window.
- `--url URL` loads a different deployment.

Each model gets its own browser profile, and so its own player id.

## Reading the screen

```
DAY 2/9 DAY · 12 moves left in this day · next boss THE LAWSUIT (day 3, 0/3 beaten)
HP 41/50 · ATK 13 · ARM 2 · SPD 7 · crit 10% · dodge 0% · $CULT 210 · keys 1 · banishes 3 · tribe WARTIME POSTER
MAP (x across, y down)
x   111222222      <- tens digit of x
y   789012345      <- units digit of x
 22 .A#...#        <- row y=22
 23   ###@###      <- @ is you at (21,23)
KNOWN PLACES, nearest first:
(22,24) 1 steps: Pixelady — HP 21 ATK 6 ARM 0 SPD 6 · easy · win 100% · ~44 HP left if you win
UNEXPLORED EDGES (x,y) steps: (25,20) 4 · ...
```

- **Map glyphs:** `@` you, `h` Schizoposter (night hunter), `#` wall, `.` floor, blank = unexplored. `c` chest, `g` grave, `m` monster, `E` elite, `$` shop, `s` shrine, `F` campfire, `B` boss gate, `?` event, `J` Remilia Jackson (fuses duplicates), `k` key, `V` vault, `f` fountain, `o` onno, `C` Charlotte Fang, `x` Scearpo, `A` cursed altar, `R` Rivergod, `Z` ETH Chan, `X` 10x, `D` Dr. Remilio Baby, `%` rift.
- **Foes** list their stats, your **win chance** and the HP you'd have left. Those numbers come from the game's own simulation, so trust them.
- **Coordinates** go into `go X Y`. `go` only routes through tiles you have explored. To see more of the map, walk toward an unexplored edge.

## How the game works, briefly

- 9 days. Each day has a set number of moves, then a night. Bosses come on days 3, 6 and 9. Day 9 is THE CANCEL, and beating it wins the run.
- **Day:** explore. Chests and graves offer a mint (choose 1 of 3–4 relics). Shops sell relics and a heal. Monsters give $CULT and sometimes a relic.
- **Night:** Schizoposters hunt you. Sleep at a campfire (`F`, at night only) to heal to full and skip to dawn. Each campfire works once.
- **Relics** fill a few slots. When the slots are full, taking a new one asks which to drop. Relics belong to **sets**: hold enough from one set (e.g. `ARMED 2/2`) and its bonus turns on. Two copies of a relic stack; Remilia Jackson (`J`) fuses a pair into GOLD, and two golds into DIAMOND.
- **Defense hits back:** armor damages attackers, dodges counter-attack, and max HP adds to your hits. Enemies are guarded: one hit takes at most half their HP, and at most a quarter of a boss's.
- **Calling a boss out early** (`callout`) makes it hit harder for each day skipped, but a win frees those days, and beating THE CANCEL early scores extra.
- Your **score (DRIP)** comes from days reached, bosses, kills, $CULT banked (capped), objectives, and +300 for a win plus a bonus per day saved.

## Good habits

- Read the win % before stepping onto a foe. Under ~70% at low HP is usually a mistake, so heal first (a shop heal, or a campfire at night).
- Pick relics that build toward one or two sets rather than the highest raw number.
- Be at a campfire as night falls, or at least know the path to one.
- A cursed altar (`A`) costs 150 $CULT to walk away from once you step on it. Step on one only if you mean to take it.
- Dialogs block movement. If `move` or `go` says "answer the dialog first", `look` and `choose`.
- Today's daily (`📅 play today's daily`) gives one counted attempt per player per day, and each model's profile is one player. Later runs that day are practice.
