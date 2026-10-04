# the cancel is coming_

A neochibi roguelite autobattler. Nine days, three bosses, one timeline.

**Play it: [cancel.tylerirl.com](https://cancel.tylerirl.com)**

![a Milady in a 9/11 hat holding a katana, next to the game's title](assets/preview.png)

You are a Milady (or a Remilio) dropped into a maze with a hundred $CULT and a bad feeling. Loot what you can during the day. Find a campfire before night, because that's when the schizoposters come out. On day 3 something arrives to end you. Same on day 6. On day 9 it's THE CANCEL, and it does not negotiate.

Fights play themselves. Your job is everything before the fight: what you pick up, what you leave, and whether that elite is worth it at half health.

## How it plays

- **The maze.** 41×41, four districts, a boss gate in each. Loot hides in dead ends. Each district bends one rule in your favour.
- **Relics.** About 85 of them, in four rarities. Your character wears what she loots, so by day 6 you look like a problem.
- **Sets.** Every relic belongs to a set or two (ARMED, HYPEBEAST, DEGEN, KAWAII, CULT, SCHIZO, SQUAD, BONKLER, CHEESEWORLD, FLAMEWAR, BLOODSPORT, ICED OUT). Hold enough of one and it switches on.
- **Copies stack.** Two of the same relic count twice. Find Remilia Jackson and he'll fuse the pair into one GOLD item, freeing a slot. Two golds make a DIAMOND. He doesn't sell copies. You have to find them.
- **onno and Charlotte Fang.** They're in the maze too. onno takes one relic and hands back a random one of the same grade. Charlotte takes any two of the same grade and returns one random relic a grade higher. One trade each, and neither lets you pick.
- **Scearpo.** Scorched earth policy. Hand him a relic and he flips a coin: it comes back a tier higher, or it burns.
- **The fountain.** Throw $CULT in. Give enough and it gives something rare back. It won't tell you how much is enough.
- **Burn, bleed, chill.** Three status effects, each with its own relics.
- **Keys and vaults.** Keys are lying around. Vaults cost 100 $CULT to open and are worth it.
- **Bosses.** Drawn from a pool, so the run doesn't tell you who's coming until it does. At half health every boss stops the fight and makes you choose something.
- **Nights.** Hunters path toward you. Campfires burn out after one rest.
- **Tribes.** Hypebeast, Gyaru, Lolita, Harajuku, Prep. Each starts with its own relic.
- **Heat.** Win, and the game offers to get worse for more DRIP.

A few things that keep you from playing blind: draft cards show what each pick does to your odds against the next boss you can't already beat, every fight ends with a line on what did the damage, and you can pin a tile (right-click, long-press, or `P`) to come back to.

## Bring your own

Type in a Milady or Remilio token number and play as it. The game rebuilds the token from its trait layers, so a relic hat replaces the hat it came with, the way the maker would do it. Its Core picks your tribe and its drip score becomes starting $CULT. Ownership isn't checked. Nobody's checking.

You never fight your own collection. Everyone else is fair game: Pixeladys, Radbros, MiladyStation characters, Shiro's *oh.. I've seen*, and the SchizoPosters at night. Bonklers only show up as bosses.

## Daily map and sharing

One seed per UTC day, same maze for everyone, one leaderboard. Any other run has a seed code too, and its link drops whoever opens it into the same map.

When a run ends you get a Wordle-style result to paste, and a link whose preview is that run's own card: your character as she finished, relics and all. The leaderboard shows everyone's final look side by side, and the hall of fame keeps each day's winner.

## Controls

Arrow keys do everything, including menus. Enter picks, Esc backs out, `B` opens your build. Mouse and touch work too: click a tile to walk there, swipe to step on a phone.

## Running it yourself

It's a static site. No build step, no framework, no dependencies.

```sh
git clone git@github.com:itsTylerIRL/cancel.git
cd cancel
python3 -m http.server
```

Then open `localhost:8000`. Opening `index.html` directly won't work; browsers block the asset loading.

| Where | What |
|---|---|
| `js/data.js` | all the content: relics, sets, enemies, bosses, events, tribes |
| `js/game.js` | the engine: maze, combat, avatar compositing, UI |
| `assets/img/` | every wearable Milady and Remilio trait layer |
| `server/` | the optional leaderboard service |
| `build.py` | packs the whole game into one `dist.html` for passing around |

Adding a relic is a line in `data.js` plus its numbers in `computeStats()` or `fightEngine()`. Its icon is just a pointer at a trait file: `["Remilio", "Hat", "Tinfoil"]`.

The leaderboard, share cards and sign-in are a small Python service that the game works fine without. Setup notes are in [`server/README.md`](server/README.md).

## Credits

Trait art is Remilia's, from [maker.remilia.org](https://maker.remilia.org). The SchizoPosters are by RIVERGOD. *oh.. I've seen* is by Shiro. The structure owes a lot to *He is Coming*. Fonts are JetBrains Mono and Anton, both under the Open Font License.

This is a fan project. It is not affiliated with Remilia Corporation, and nothing in it is for sale.

Made by [tyler](https://tylerirl.com).
