# the service

Optional. The game runs without it; this adds leaderboards, share cards and sign-in.

Python standard library and SQLite, plus Pillow for drawing cards. It listens on localhost and expects nginx in front for TLS.

## What it does

| Route | |
|---|---|
| `POST /api/score` | a finished run. Keeps each player's best per board: today's daily, all-time, and one per shared map |
| `POST /api/daily/start` | a daily run has begun. A player's first daily run of the day is the only one that counts on that day's board |
| `GET /api/board` | a board, with `?daily=YYYY-MM-DD`, `?seed=CODE` or `?all=1`. Each entry has the run's `id`, its `share` link and its card `image` |
| `GET /api/hall` | the best run of every daily map |
| `GET /api/pulse` | games and wins today, this week, ever |
| `GET /api/stats` | how runs end, in aggregate. Useful for balancing |
| `GET /api/token` | a Milady or Remilio token's traits, fetched once and cached |
| `GET /r/ID` | a run's share link. Link previews get that run's card; people get forwarded to the same map |
| `GET /api/card/ID.png` | the card itself |
| `GET /api/auth/login`, `/callback` | Sign in with RemiliaNET |

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
