# the service

Optional. The game runs without it; this adds leaderboards, share cards and sign-in.

Python standard library and SQLite, plus Pillow for drawing cards. It listens on localhost and expects nginx in front for TLS.

## What it does

| Route | |
|---|---|
| `POST /api/score` | a finished run. Keeps each player's best per board: today's daily, all-time, and one per shared map |
| `POST /api/daily/start` | a daily run has begun. A player's first daily run of the day is the only one that counts on that day's board |
| `GET /api/board` | a board, with `?daily=YYYY-MM-DD`, `?seed=CODE` or `?all=1`. Each entry has the run's `id`, its `share` link and its card `image` |
| `GET /api/king` | this week's king of the hill, their relics, and when the hill (Sunday night, Eastern) and the daily next reset |
| `POST /api/king/challenge` | a run that beat THE CANCEL claims an empty hill, takes it, or loses. One challenge per winning run |
| `GET /api/hall` | the best run of every daily map, and whoever held the hill as each past week ended |
| `POST /api/profile` | a signed-in player's progress (unlocks, achievements, record, streak), merged with what the account already holds |
| `GET /api/pulse` | games and wins today, this week, ever |
| `GET /api/stats` | how runs end, in aggregate. Useful for balancing |
| `GET /api/token` | a Milady or Remilio token's traits, fetched once and cached |
| `GET /r/ID` | a run's share link. Link previews get that run's card; people get forwarded to the same map |
| `GET /api/card/ID.png` | the card itself |
| `GET /api/auth/login`, `/callback` | Sign in with RemiliaNET |
| `GET /api/auth/urbit/login`, `/callback` | Sign in with Urbit, through the owner's ship |

Boards rank every run that saved the timeline above every run that was cancelled, then by score, then by who got there first. A player's row is replaced only by a run that ranks higher.

Scores can't be proven, since the game runs in the browser. The service checks shape and plausibility and rate-limits. That keeps the board tidy, not tamper-proof.

## Cards and portraits

Nothing is ever uploaded. A run stores the character as a recipe (which trait layers, which relics) and `card.py` redraws it from the game's own art. The layer rules live in `card_spec.json`, exported from the game's source so the two can't drift:

```sh
node server/make_spec.mjs
```

Run that after changing relics or layers, and copy the result (and any new art) to the server. Cards are kept for 90 days.

## Sign in with RemiliaNET

OIDC Authorization Code with PKCE, per [docs.remilia.net](https://docs.remilia.net). The service asks RemiliaNET who the player is, then hands the game its own signed 30-day session. No RemiliaNET token is kept. Signed-in scores get a verified mark and one leaderboard row per account, on any device.

Register this redirect URI for the client, exactly:

```
https://YOUR-API-HOST/api/auth/callback
```

The button stays hidden until `CANCEL_RN_ON=1`.

## Sign in with Urbit

The owner's ship vouches for the visitor, using Eyre's eauth. The player clicks "Urbit ID", logs in to the owner's ship as their own ship, and approves on their own ship. They land on `/cancel-auth` on the ship's web address, which nginx hands to this service along with the ship's login cookie. The service asks the ship (`/~/name`) who holds that cookie, and that ship name becomes the identity.

Galaxies, stars, planets and moons only. A comet is free to make, and a visitor who never logged in is given a comet-shaped guest name, so refusing comets is also what tells a real login from none.

A player is signed in with RemiliaNET or with Urbit, not both. Urbit handles are stored with their `~`, which is how the two are told apart (green and blue on the boards).

On the ship's nginx site:

```
location = /cancel-auth {
    proxy_pass http://127.0.0.1:8787/api/auth/urbit/callback$is_args$args;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Settings: `CANCEL_UR_ON=1`, `CANCEL_UR_PUBLIC` (the ship's web address), `CANCEL_UR_LOCAL` (the same ship from this machine, default `http://127.0.0.1:8080`).

## Setup

1. Copy `server.py`, `card.py`, `card_spec.json` and `fonts/` to `/opt/cancel-api/`, and the game's `assets/img/` to `/opt/cancel-api/assets/img/`.
2. Make Pillow importable (`pip install --target /opt/cancel-api/lib pillow`, or your distro's package).
3. Install `cancel-api.service` as a systemd unit and `nginx-cancel-api.conf` as an nginx site, then get a certificate.
4. Put settings in `/etc/cancel-api.env`.

| Setting | |
|---|---|
| `CANCEL_SALT` | a long random secret. Signs sessions and hashes addresses |
| `CANCEL_DB` | SQLite file. Default `/var/lib/cancel-api/scores.db` |
| `CANCEL_PORT` | default `8787` |
| `CANCEL_ORIGINS` | sites allowed to post scores, comma separated |
| `CANCEL_SITE`, `CANCEL_PUBLIC` | where the game lives, and where this service lives |
| `CANCEL_ASSETS` | the art folder `card.py` draws from |
| `PYTHONPATH` | where Pillow is, if you installed it to a folder |
| `CANCEL_RN_ON`, `CANCEL_RN_CLIENT`, `CANCEL_RN_REDIRECT` | RemiliaNET sign-in |
| `CANCEL_RN_SECRET` | only if the RemiliaNET client is a confidential one |
| `CANCEL_DEV=1` | also accept localhost origins, for testing |

Point the game at your service with `API_DEFAULT` in `js/game.js`.

## Backups

`backup.py` takes a safe copy of the database while the service runs, gzips it into `backups/` beside the database and keeps the newest 14. `cancel-backup.service` and `cancel-backup.timer` run it nightly:

```sh
cp cancel-backup.service cancel-backup.timer /etc/systemd/system/
systemctl enable --now cancel-backup.timer
```

Those copies live on the same machine, so they cover a bad edit, not a dead disk. To send each one somewhere else, set `CANCEL_BACKUP_COPY` in `/etc/cancel-api.env` to a command; `{}` becomes the file's path, for example `rclone copy {} remote:cancel-backups`.
