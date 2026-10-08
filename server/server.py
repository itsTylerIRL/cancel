#!/usr/bin/env python3
"""Leaderboard service for THE CANCEL IS COMING.

Standard library only. Listens on localhost; nginx terminates TLS and proxies to it.

  POST /api/score   submit a finished run (JSON)
  POST /api/daily/start   a daily run has begun. Only a player's first daily run of the day counts on that board
  GET  /api/board   ?daily=YYYY-MM-DD | ?seed=CODE | ?all=1   [&limit=50] [&player=ID]
                    each entry carries the run's "id", its "share" link and its card "image"
  GET  /api/token   ?kind=milady|remilio&id=N   a token's traits, fetched once from maker.remilia.org and cached
  GET  /api/stats   how runs end, in aggregate (for balancing)
  GET  /api/king    this week's king of the hill, and when the hill and the daily next reset
  POST /api/king/challenge   a run that beat THE CANCEL fights the king: claim an empty hill, take it, or lose
  GET  /api/pulse   games and wins today, this week and ever
  GET  /api/hall    the best run of every daily map, and whoever held the hill as each past week ended
  POST /api/profile  a signed-in player's progress (unlocks, achievements, record, streak), merged with what the account holds
  GET  /api/auth/urbit/login?return=URL   start "Sign in with Urbit": log in to the owner's ship as your own (eauth)
  GET  /api/auth/urbit/callback     arrives through the ship's address; the ship says who you are
  GET  /api/auth/login?return=URL   start "Sign in with RemiliaNET" (OIDC Authorization Code + PKCE)
  GET  /api/auth/callback           RemiliaNET sends the player back here; they return to the game signed in
  GET  /r/ID        a run's share link: link previews get that run's card, people are forwarded to the same map
  GET  /api/card/ID.png   the card, drawn here from the run's data (card.py); nothing is uploaded
  GET  /api/health

The game runs entirely in the browser, so a score cannot be proven. Submissions are
checked for shape and plausibility and rate-limited; that keeps the board tidy, not tamper-proof.

Environment: CANCEL_DB, CANCEL_PORT, CANCEL_SALT, CANCEL_ORIGINS (comma separated), CANCEL_DEV=1,
CANCEL_RN_ON=1 (offer RemiliaNET sign-in), CANCEL_RN_CLIENT, CANCEL_RN_REDIRECT, and CANCEL_RN_SECRET (only if the RemiliaNET client is a confidential one)
"""
import base64, hashlib, hmac, json, os, re, secrets, sqlite3, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB = os.environ.get("CANCEL_DB", "/var/lib/cancel-api/scores.db")
PORT = int(os.environ.get("CANCEL_PORT", "8787"))
SALT = os.environ.get("CANCEL_SALT", "dev-salt")
ORIGINS = {o.strip() for o in os.environ.get("CANCEL_ORIGINS", "https://cancel.tylerirl.com,https://tylerirl.com").split(",") if o.strip()}
DEV = os.environ.get("CANCEL_DEV") == "1"  # also accept any localhost origin
# Sign in with RemiliaNET (docs.remilia.net). The redirect address must be registered for the client, verbatim.
RN_ISSUER = os.environ.get("CANCEL_RN_ISSUER", "https://www.remilia.net/oidc/realms/remilia")
RN_API = os.environ.get("CANCEL_RN_API", "https://www.remilia.net/api/v1")
RN_CLIENT = os.environ.get("CANCEL_RN_CLIENT", "tpa-cancel-game")
RN_SECRET = os.environ.get("CANCEL_RN_SECRET", "")  # empty for a public login client, which has none
RN_REDIRECT = os.environ.get("CANCEL_RN_REDIRECT", "https://cancel-api.tylerirl.com/api/auth/callback")
SITE = os.environ.get("CANCEL_SITE", "https://cancel.tylerirl.com/")           # where share links forward to
PUBLIC = os.environ.get("CANCEL_PUBLIC", "https://cancel-api.tylerirl.com")   # this service, as the world sees it
CARDS = os.environ.get("CANCEL_CARDS", os.path.join(os.path.dirname(DB) or ".", "cards"))  # drawn cards, kept on disk
CARD_DAYS = 90
RE_CARD = re.compile(r"^[a-z0-9]{8}$")
RN_ON = os.environ.get("CANCEL_RN_ON") == "1"  # the game only offers sign-in once RemiliaNET has approved the client
SESSION_DAYS = 30
RE_HANDLE = re.compile(r"^(?:[A-Za-z0-9_.-]{1,40}|~(?:[a-z]{3}|[a-z]{6}(?:-[a-z]{6}){0,3}))$")  # a RemiliaNET handle, or an Urbit ship
# Sign in with Urbit. The owner's ship vouches for the visitor (Eyre's eauth): the visitor logs in to it as their own
# ship, the ship is asked who they are, and that name is the identity. The callback lives on the ship's own web
# address (nginx hands that one path to this service), because that is where the login cookie is.
UR_ON = os.environ.get("CANCEL_UR_ON") == "1"
UR_PUBLIC = os.environ.get("CANCEL_UR_PUBLIC", "https://urbit.tylerirl.com")   # the ship, as visitors reach it
UR_LOCAL = os.environ.get("CANCEL_UR_LOCAL", "http://127.0.0.1:8080")           # the same ship, from this machine
UR_PATH = os.environ.get("CANCEL_UR_PATH", "/cancel-auth")                      # the path on the ship's address that comes here
# Galaxies, stars, planets and moons. Not comets: anyone can make one for free, and a visitor who hasn't logged in
# at all is given a comet-shaped guest name by the ship, so this is also what tells a real login from none.
RE_PATP = re.compile(r"^~(?:[a-z]{3}|[a-z]{6}(?:-[a-z]{6}){0,3})$")

MAX_BODY = 6000
MAX_SCORE = 3000          # day, boss, kill, objective and (capped) $CULT points with the top heat bonus stay under this
POSTS_PER_HOUR = 30       # per client address
TRIBES = {"hypebeast", "gyaru", "lolita", "harajuku", "prep"}
COLLECTIONS = {"milady", "remilio"}
RE_PLAYER = re.compile(r"^[a-z0-9]{8,32}$")
RE_RUN = re.compile(r"^[a-z0-9]{8,32}$")
RE_SEED = re.compile(r"^[a-z0-9]{1,12}$")
RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_RELIC = re.compile(r"^[a-z0-9_]{1,24}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  board TEXT NOT NULL, player TEXT NOT NULL,
  name TEXT NOT NULL, score INTEGER NOT NULL, day INTEGER NOT NULL, win INTEGER NOT NULL,
  bosses INTEGER NOT NULL, kills INTEGER NOT NULL, heat INTEGER NOT NULL,
  tribe TEXT NOT NULL, collection TEXT NOT NULL, token INTEGER,
  relics TEXT NOT NULL, killed_by TEXT NOT NULL,
  ip_hash TEXT NOT NULL, created INTEGER NOT NULL,
  UNIQUE(board, player)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores(board, score DESC, created ASC);
CREATE INDEX IF NOT EXISTS scores_rank ON scores(board, win DESC, score DESC, created ASC);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, created INTEGER NOT NULL,
  score INTEGER NOT NULL, day INTEGER NOT NULL, win INTEGER NOT NULL, bosses INTEGER NOT NULL, kills INTEGER NOT NULL,
  heat INTEGER NOT NULL, tribe TEXT NOT NULL, collection TEXT NOT NULL, relics TEXT NOT NULL, killed_by TEXT NOT NULL,
  daily INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, created INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  date TEXT NOT NULL, player TEXT NOT NULL, run TEXT NOT NULL, created INTEGER NOT NULL,
  PRIMARY KEY(date, player)
);
CREATE TABLE IF NOT EXISTS hill (
  date TEXT PRIMARY KEY, card TEXT NOT NULL, player TEXT NOT NULL, since INTEGER NOT NULL, defences INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS duels (card TEXT PRIMARY KEY, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (player TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (
  kind TEXT NOT NULL, id INTEGER NOT NULL, attrs TEXT NOT NULL, fetched INTEGER NOT NULL,
  PRIMARY KEY(kind, id)
);
"""

# Token traits. The collection sites don't allow other sites' pages to read them, so the game asks here.
# Traits never change, so each token is fetched once and kept.
TOKEN_SOURCES = {
    "milady": ["https://maker.remilia.org/metadata/Milady/%d", "https://www.miladymaker.net/milady/json/%d"],
    "remilio": ["https://maker.remilia.org/metadata/Remilio/%d", "https://remilio.org/remilio/json/%d"],
}
LOOKUPS_PER_HOUR = 60  # uncached lookups per client address


def fetch_traits(kind, tid):
    for url in TOKEN_SOURCES[kind]:
        try:
            req = urllib.request.Request(url % tid, headers={"User-Agent": "cancel-api (tylerirl.com)"})
            with urllib.request.urlopen(req, timeout=8) as r:
                data = json.loads(r.read(65536))
            out = []
            for a in data.get("attributes", [])[:40]:
                t, v = clean_text(a.get("trait_type"), 40), clean_text(str(a.get("value", "")), 60)
                if t and v:
                    out.append([t, v])
            if out:
                return out
        except Exception:
            continue
    return None


def token_traits(kind, tid, key):
    with db() as con:
        row = con.execute("SELECT attrs FROM tokens WHERE kind=? AND id=?", (kind, tid)).fetchone()
    if row:
        return json.loads(row["attrs"]), 200
    if not rate_ok("t:" + key, LOOKUPS_PER_HOUR):
        return None, 429
    attrs = fetch_traits(kind, tid)
    if attrs is None:
        return None, 502
    with db() as con:
        con.execute("INSERT OR REPLACE INTO tokens (kind, id, attrs, fetched) VALUES (?,?,?,?)",
                    (kind, tid, json.dumps(attrs, separators=(",", ":")), int(time.time())))
    return attrs, 200


_spec = None


def spec():
    """The game's own layer rules and art list (card_spec.json, written by make_spec.mjs)."""
    global _spec
    if _spec is None:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "card_spec.json"), encoding="utf8") as f:
            _spec = json.load(f)
    return _spec


def look_from_traits(kind, attrs):
    """A token's traits as a look recipe: the same reading the game does in tokenLayers()."""
    S = spec()
    M = S["token_map"][kind]
    cfg, files, layers, eye = M["cfg"], S["assets"][M["cfg"]], {}, ""
    for trait, value in attrs:
        name = M["names"].get(trait, trait)
        want = M["values"].get(trait, {}).get(value) or (
            " ".join(w[:1].upper() + w[1:] for w in value.split(" ")) if M["transform"] == "titlecase" else value)
        if M.get("tint") and name == M["tint"]["by"]:
            eye = want
            continue
        if name not in S["TOKEN_SLOTS"][cfg] or name not in files:  # backgrounds, overlays and scores are not worn
            continue
        f = next((x for x in files[name] if x.lower() == (want + ".webp").lower()), None)
        if f:
            layers[name] = f
    for name, by_value in M["exclusions"].items():  # traits the collection itself hides under others
        for gone in by_value.get(layers.get(name, "")[:-5], []):
            layers.pop(gone, None)
    for name, hidden in M["layerExclusions"].items():
        if name in layers:
            for gone in hidden:
                layers.pop(gone, None)
    if M["body"] not in layers:
        return None
    return json.dumps({"cfg": cfg, "layers": layers, "eye": eye if re.match(r"^[A-Za-z]{1,12}$", eye) else "", "ps1": False},
                      separators=(",", ":"))


def look_from_token(kind, tid, key):
    """When the game couldn't send a look (it fell back to the token's flat picture), build it here from the traits."""
    try:
        attrs, _code = token_traits(kind, tid, key)
        return look_from_traits(kind, attrs) if attrs else None
    except Exception as e:
        print("look_from_token failed: %s" % type(e).__name__, flush=True)
        return None


def db():
    con = sqlite3.connect(DB, timeout=5)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    os.makedirs(os.path.dirname(DB) or ".", exist_ok=True)
    with db() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(SCHEMA)
        if "look" not in [r[1] for r in con.execute("PRAGMA table_info(scores)")]:
            con.execute("ALTER TABLE scores ADD COLUMN look TEXT")  # how the character looked: a recipe of trait layers
        if "stats" not in [r[1] for r in con.execute("PRAGMA table_info(runs)")]:
            con.execute("ALTER TABLE runs ADD COLUMN stats TEXT")  # the build's final numbers, for balancing
        if "card" not in [r[1] for r in con.execute("PRAGMA table_info(scores)")]:
            con.execute("ALTER TABLE scores ADD COLUMN card TEXT")  # the share card of the run this row is
        if "handle" not in [r[1] for r in con.execute("PRAGMA table_info(scores)")]:
            con.execute("ALTER TABLE scores ADD COLUMN handle TEXT")  # the RemiliaNET account, when the player signed in


RE_LAYER = re.compile(r"^[A-Za-z -]{1,20}$")
RE_FILE = re.compile(r"^[A-Za-z0-9 _.,'!%&()+-]{1,60}\.webp$")


def parse_look(v):
    """The character's look is a recipe (which trait layers), never an uploaded picture, so the board can only
    ever show the game's own art. Returns compact JSON or None."""
    if not isinstance(v, dict) or v.get("cfg") not in ("Milady", "Remilio"):
        return None
    layers = v.get("layers")
    if not isinstance(layers, dict) or not 1 <= len(layers) <= 16:
        return None
    out = {}
    for k, f in layers.items():
        if not isinstance(k, str) or not isinstance(f, str) or not RE_LAYER.match(k) or not RE_FILE.match(f) or ".." in f:
            return None
        out[k] = f
    eye = v.get("eye")
    eye = eye if isinstance(eye, str) and re.match(r"^[A-Za-z]{1,12}$", eye) else ""
    return json.dumps({"cfg": v["cfg"], "layers": out, "eye": eye, "ps1": bool(v.get("ps1"))}, separators=(",", ":"))


def clean_text(v, limit):
    """Names and labels are shown in other players' browsers: plain characters only."""
    if not isinstance(v, str):
        return ""
    v = re.sub(r"[<>&\"'`\\\x00-\x1f\x7f]", "", v)
    return re.sub(r"\s+", " ", v).strip()[:limit]


try:  # the daily turns over at midnight Eastern (New York)
    from zoneinfo import ZoneInfo
    DAILY_TZ = ZoneInfo("America/New_York")
except Exception:  # no time zone data on this machine: fixed UTC-5
    DAILY_TZ = timezone(timedelta(hours=-5))


def daily_now():
    return datetime.now(DAILY_TZ)


def utc_today():  # (the name is historical) today's date where the daily is kept
    return daily_now().date()


_hits = {}
_hits_lock = threading.Lock()


def rate_ok(key, limit=POSTS_PER_HOUR):
    now = time.time()
    with _hits_lock:
        recent = [t for t in _hits.get(key, []) if now - t < 3600]
        if len(recent) >= limit:
            _hits[key] = recent
            return False
        recent.append(now)
        _hits[key] = recent
        if len(_hits) > 20000:  # forget idle addresses
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 3600]:
                _hits.pop(k, None)
        return True


class Bad(Exception):
    pass


def cult_points(cult):
    """$CULT's share of a score: 1 per 25 for the first 1,000, then 1 per 100, never more than 100."""
    return min(100, min(cult, 1000) // 25 + max(0, cult - 1000) // 100)


def b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign(body):
    return b64u(hmac.new(SALT.encode(), body.encode(), hashlib.sha256).digest())


def verified_player(handle):
    """One leaderboard identity per signed-in account, whatever device it plays from. Anonymous ids are hex,
    so they can never start with "rn" or "ur"."""
    kind = "ur" if handle.startswith("~") else "rn"  # an Urbit ship or a RemiliaNET account: separate people, separate rows
    return kind + hashlib.sha256((SALT + "|" + kind + "|" + handle.lower()).encode()).hexdigest()[:22]


def make_session(handle, name):
    body = b64u(json.dumps({"h": handle, "n": name, "p": verified_player(handle),
                            "exp": int(time.time()) + SESSION_DAYS * 86400}, separators=(",", ":")).encode())
    return body + "." + sign(body)


def read_session(token):
    """The signed-in RemiliaNET handle, or None. The token is ours: signed here, checked here."""
    if not isinstance(token, str) or len(token) > 600 or token.count(".") != 1:
        return None
    body, sig = token.split(".")
    if not hmac.compare_digest(sig, sign(body)):
        return None
    try:
        d = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return None
    if d.get("exp", 0) < time.time() or not RE_HANDLE.match(str(d.get("h", ""))):
        return None
    return d["h"]


_pending = {}  # state -> (pkce verifier, where to send the player back, started)
_pending_lock = threading.Lock()


def auth_begin(back):
    state, verifier = secrets.token_urlsafe(16), secrets.token_urlsafe(48)
    now = time.time()
    with _pending_lock:
        for k in [k for k, v in _pending.items() if now - v[2] > 900]:
            _pending.pop(k, None)
        if len(_pending) > 5000:
            return None
        _pending[state] = (verifier, back, now)
    q = urllib.parse.urlencode({
        "client_id": RN_CLIENT, "response_type": "code", "redirect_uri": RN_REDIRECT, "scope": "openid", "state": state,
        "code_challenge": b64u(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256"})
    return RN_ISSUER + "/protocol/openid-connect/auth?" + q


def urbit_begin(back):
    state = secrets.token_urlsafe(16)
    now = time.time()
    with _pending_lock:
        for k in [k for k, v in _pending.items() if now - v[2] > 900]:
            _pending.pop(k, None)
        if len(_pending) > 5000:
            return None
        _pending[state] = ("urbit", back, now)
    return UR_PUBLIC + "/~/login?eauth&redirect=" + urllib.parse.quote(UR_PATH + "?state=" + state, safe="")


def urbit_who(cookie_header):
    """Ask the ship who is holding these login cookies. Only the ship's own cookies are passed on."""
    mine = "; ".join(c.strip() for c in (cookie_header or "").split(";") if c.strip().startswith("urbauth-"))
    if not mine:
        return None
    req = urllib.request.Request(UR_LOCAL + "/~/name", headers={"Cookie": mine, "User-Agent": "cancel-api"})
    with urllib.request.urlopen(req, timeout=8) as r:
        name = r.read(200).decode("ascii", "replace").strip()
    return name if RE_PATP.match(name) else None


def auth_finish(code, verifier):
    """Trade the code for a token, ask RemiliaNET who it belongs to, and return our own session. The RemiliaNET
    token is used once and thrown away: the game needs to know who the player is, nothing more."""
    form = {"grant_type": "authorization_code", "client_id": RN_CLIENT, "code": code, "redirect_uri": RN_REDIRECT,
            "code_verifier": verifier}
    if RN_SECRET:
        form["client_secret"] = RN_SECRET
    req = urllib.request.Request(RN_ISSUER + "/protocol/openid-connect/token", data=urllib.parse.urlencode(form).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "cancel-api"})
    with urllib.request.urlopen(req, timeout=10) as r:
        access = json.loads(r.read())["access_token"]
    req = urllib.request.Request(RN_API + "/me", headers={"Authorization": "Bearer " + access, "User-Agent": "cancel-api"})
    with urllib.request.urlopen(req, timeout=10) as r:
        user = json.loads(r.read())["user"]
    handle = str(user.get("username", ""))
    if not RE_HANDLE.match(handle):
        raise ValueError("bad handle")
    return make_session(handle, clean_text(user.get("displayName") or handle, 18) or handle)


def as_int(v, lo, hi, what):
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise Bad("bad " + what)
    return v


def parse_run(d):
    """Validate a submitted run; returns (boards, row) or raises Bad."""
    if not isinstance(d, dict):
        raise Bad("not an object")
    player = d.get("player")
    if not isinstance(player, str) or not RE_PLAYER.match(player):
        raise Bad("bad player")
    handle = read_session(d.get("session"))
    if handle:
        player = verified_player(handle)  # the account's one row per board, from any device
    elif player.startswith(("rn", "ur")):
        raise Bad("sign in again")  # an expired or forged session must not write to a verified player's row
    name = clean_text(d.get("name"), 18)
    if not name:
        raise Bad("bad name")
    score = as_int(d.get("score"), 0, MAX_SCORE, "score")
    day = as_int(d.get("day"), 1, 9, "day")
    bosses = as_int(d.get("bosses"), 0, 3, "bosses")
    kills = as_int(d.get("kills"), 0, 500, "kills")
    heat = as_int(d.get("heat", 0), 0, 5, "heat")
    win = bool(d.get("win"))
    # A boss can be called out early, so bosses beaten no longer follow from the day: a run can win on day 4.
    if win and bosses != 3:
        raise Bad("inconsistent win")
    tribe = d.get("tribe")
    if tribe not in TRIBES:
        raise Bad("bad tribe")
    collection = d.get("collection")
    if collection not in COLLECTIONS:
        raise Bad("bad collection")
    token = d.get("token")
    if token is not None:
        token = as_int(token, 0, 9999, "token")
    relics = d.get("relics")
    if not isinstance(relics, list) or len(relics) > 8:
        raise Bad("bad relics")
    out = []
    for r in relics:
        if (not isinstance(r, list) or len(r) != 2 or not isinstance(r[0], str) or not RE_RELIC.match(r[0])
                or isinstance(r[1], bool) or r[1] not in (1, 2, 3)):
            raise Bad("bad relic")
        out.append([r[0], r[1]])

    boards = ["all"]
    daily, seed = d.get("daily"), d.get("seed")
    if daily:
        if not isinstance(daily, str) or not RE_DATE.match(daily):
            raise Bad("bad daily")
        try:
            when = datetime.strptime(daily, "%Y-%m-%d").date()
        except ValueError:
            raise Bad("bad daily")
        # only the current daily counts (a day either side allows for clocks and runs that cross midnight)
        if abs((when - utc_today()).days) <= 1:
            if heat != 0:
                raise Bad("daily runs are heat 0")
            boards.append("daily:" + daily)
    elif seed:
        if not isinstance(seed, str) or not RE_SEED.match(seed):
            raise Bad("bad seed")
        boards.append("seed:" + seed)

    cult = d.get("cult")  # an older copy of the game doesn't send it: leave it off the card rather than print 0
    cult = cult if isinstance(cult, int) and not isinstance(cult, bool) and 0 <= cult <= 99999 else None
    # The score is the game's own sum, so the most it can honestly be follows from the run: every objective done,
    # and $CULT counted the capped way. Anything above that (an old copy of the game still counting $CULT in full,
    # or a made-up number) is brought down to it.
    base = day * 15 + bosses * 60 + kills * 2 + cult_points(cult or 0) + (300 + max(0, 9 - day) * 80 if win else 0) + 75  # a win is worth more for each day it came early
    score = min(score, base + int(base * 0.25 * heat + 0.5))
    run = d.get("run")
    run = run if isinstance(run, str) and RE_RUN.match(run) else None
    st = d.get("stats")
    stats = None
    if isinstance(st, dict):
        stats = {k: v for k, v in st.items() if k in ("hp", "atk", "arm", "spd", "crit", "dodge", "batk", "bhp", "bspd")
                 and isinstance(v, int) and not isinstance(v, bool) and -999 <= v <= 9999}
    row = dict(run=run, stats=json.dumps(stats, separators=(",", ":")) if stats else None, cult=cult, card_daily=daily if daily else None, card_seed=seed if seed and not daily else None,
               player=player, name=name, score=score, day=day, win=int(win), bosses=bosses, kills=kills, heat=heat,
               tribe=tribe, collection=collection, token=token, relics=json.dumps(out, separators=(",", ":")),
               killed_by=clean_text(d.get("killedBy"), 30), look=parse_look(d.get("look")), handle=handle)
    return boards, row


# Boards rank everyone who saved the timeline above everyone who was cancelled, then by score, then by who got there first.
BOARD_ORDER = "win DESC, score DESC, created ASC"


def rank_of(con, board, player):
    me = con.execute("SELECT win, score, created FROM scores WHERE board=? AND player=?", (board, player)).fetchone()
    if not me:
        return None
    ahead = con.execute(
        "SELECT COUNT(*) FROM scores WHERE board=? AND (win>? OR (win=? AND (score>? OR (score=? AND created<?))))",
        (board, me["win"], me["win"], me["score"], me["score"], me["created"])).fetchone()[0]
    return {"rank": ahead + 1, "score": me["score"], "win": bool(me["win"])}


def public(row, rank):
    return {"rank": rank, "name": row["name"], "score": row["score"], "day": row["day"], "win": bool(row["win"]),
            "bosses": row["bosses"], "kills": row["kills"], "heat": row["heat"], "tribe": row["tribe"],
            "collection": row["collection"], "token": row["token"], "relics": json.loads(row["relics"]),
            "killedBy": row["killed_by"], "look": json.loads(row["look"]) if row["look"] else None, "handle": row["handle"],
            # the run's id: its share link is /r/ID and its card image /api/card/ID.png
            "id": row["card"], "share": PUBLIC + "/r/" + row["card"] if row["card"] else None,
            "image": "%s/api/card/%s.png" % (PUBLIC, row["card"]) if row["card"] else None}


def read_board(board, limit, player):
    with db() as con:
        rows = con.execute("SELECT * FROM scores WHERE board=? ORDER BY " + BOARD_ORDER + " LIMIT ?", (board, limit)).fetchall()
        total = con.execute("SELECT COUNT(*) FROM scores WHERE board=?", (board,)).fetchone()[0]
        you = rank_of(con, board, player) if player else None
        cult = {}  # $CULT banked isn't kept on the row; the run's card has it
        ids = [r["card"] for r in rows if r["card"]]
        for cid, data in con.execute("SELECT id, data FROM cards WHERE id IN (%s)" % ",".join("?" * len(ids)), ids) if ids else []:
            cult[cid] = json.loads(data).get("cult")
    return {"board": board, "total": total, "top": [dict(public(r, i + 1), cult=cult.get(r["card"])) for i, r in enumerate(rows)], "you": you}


def run_stats():
    with db() as con:
        n, wins, avg_day, avg_score = con.execute("SELECT COUNT(*), COALESCE(SUM(win),0), AVG(day), AVG(score) FROM runs").fetchone()
        by_day = con.execute("SELECT day, COUNT(*) FROM runs WHERE win=0 GROUP BY day ORDER BY day").fetchall()
        killers = con.execute("SELECT killed_by, COUNT(*) c FROM runs WHERE win=0 AND killed_by<>'' GROUP BY killed_by ORDER BY c DESC LIMIT 12").fetchall()
        tribes = con.execute("SELECT tribe, COUNT(*), SUM(win), AVG(day) FROM runs GROUP BY tribe").fetchall()
        bosses = con.execute("SELECT bosses, COUNT(*) FROM runs GROUP BY bosses ORDER BY bosses").fetchall()
        rows_stats = con.execute("SELECT stats, win FROM runs WHERE stats IS NOT NULL ORDER BY id DESC LIMIT 2000").fetchall()
        relics = {}
        for (r,) in con.execute("SELECT relics FROM runs ORDER BY id DESC LIMIT 2000"):
            for rid, _tier in json.loads(r):
                relics[rid] = relics.get(rid, 0) + 1
    final = {}
    for win in (0, 1):  # what the builds that lose and the builds that win actually add up to
        got = [json.loads(r[0]) for r in rows_stats if r[1] == win]
        if got:
            final["win" if win else "loss"] = dict({k: round(sum(g.get(k, 0) for g in got) / len(got), 1) for k in ("hp", "atk", "arm", "spd", "crit", "dodge", "batk", "bhp", "bspd")}, runs=len(got))
    return {"runs": n, "wins": wins, "avgDay": round(avg_day or 0, 2), "avgScore": round(avg_score or 0, 1),
            "deathsByDay": {str(d): c for d, c in by_day}, "bossesBeaten": {str(b): c for b, c in bosses},
            "killedBy": [[k, c] for k, c in killers],
            "tribes": {t: {"runs": c, "wins": w or 0, "avgDay": round(a or 0, 2)} for t, c, w, a in tribes},
            "relicsHeldAtEnd": sorted(relics.items(), key=lambda x: -x[1])[:25], "finalStats": final}


def pulse():
    """Headline numbers for the title screen: games and wins today (Eastern), over the last 7 days, and ever."""
    now = daily_now()
    midnight = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    out = {}
    with db() as con:
        for key, since in (("today", midnight), ("week", midnight - 6 * 86400), ("lifetime", 0)):
            n, wins, kills = con.execute("SELECT COUNT(*), COALESCE(SUM(win),0), COALESCE(SUM(kills),0) FROM runs WHERE created>=?", (since,)).fetchone()
            out[key] = {"games": n, "wins": wins, "kills": kills}
        out["players"] = con.execute("SELECT COUNT(*) FROM scores WHERE board='all'").fetchone()[0]
    return out


def hall(limit):
    """The best run of every daily map, newest first."""
    with db() as con:
        rows = con.execute(
            """SELECT s.*, (SELECT COUNT(*) FROM scores c WHERE c.board=s.board) AS players FROM scores s
               WHERE s.board LIKE 'daily:%' AND s.id=(SELECT t.id FROM scores t WHERE t.board=s.board ORDER BY t.win DESC, t.score DESC, t.created ASC LIMIT 1)
               ORDER BY s.board DESC LIMIT ?""", (limit,)).fetchall()
        kings = []  # whoever held the hill as each past week ended
        for k in con.execute("""SELECT h.date, h.defences, c.data FROM hill h JOIN cards c ON c.id=h.card
                                WHERE h.date<? ORDER BY h.date DESC LIMIT 52""", (hill_week(),)):
            d = json.loads(k["data"])
            kings.append({"week": k["date"], "name": d["name"], "handle": d.get("handle"), "look": d.get("look"), "relics": d["relics"],
                          "score": d["score"], "tribe": d["tribe"], "defences": k["defences"]})
    return {"today": utc_today().isoformat(), "days": [dict(public(r, 1), date=r["board"][6:], players=r["players"]) for r in rows],
            "kings": kings}


# King of the hill. Anyone who beats THE CANCEL may fight the week's king, build against build.
# The fight runs in the challenger's browser like everything else, so the result is taken on trust, within limits:
# one challenge per winning run, made soon after that run was posted, by the player who posted it.
KING_LIMITS = {"hp": (10, 600), "atk": (1, 300), "arm": (0, 80), "spd": (1, 40), "crit": (0, 100), "dodge": (0, 65),
               "batk": (0, 60), "bhp": (0, 200), "bspd": (0, 10)}


def hill_week():
    """The hill is held for a week. Its key is the Monday the week began on; it empties as Sunday night ends, Eastern."""
    today = utc_today()
    return (today - timedelta(days=today.weekday())).isoformat()


def hill_reset():
    now = daily_now()
    monday = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=now.weekday())
    return int((monday + timedelta(days=7)).timestamp())


def next_reset():
    """When the daily and the hill next turn over: the coming midnight Eastern, as epoch seconds."""
    now = daily_now()
    return int((now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).timestamp())


def king_public(con):
    row = con.execute("SELECT * FROM hill WHERE date=?", (hill_week(),)).fetchone()
    if not row:
        return None, None
    c = con.execute("SELECT data FROM cards WHERE id=?", (row["card"],)).fetchone()
    if not c:
        return None, None
    d = json.loads(c[0])
    st = d.get("stats") or {}
    stats = {k: max(lo, min(hi, int(st.get(k, lo)))) for k, (lo, hi) in KING_LIMITS.items()}
    return {"name": d["name"], "handle": d.get("handle"), "look": d.get("look"), "relics": d["relics"], "tribe": d["tribe"],
            "score": d["score"], "kills": d.get("kills", 0), "cult": d.get("cult") or 0, "stats": stats, "since": row["since"], "defences": row["defences"], "id": row["card"],
            "image": "%s/api/card/%s.png" % (PUBLIC, row["card"])}, row["player"]


def king_challenge(card, player, won, now):
    """Returns (status code, body)."""
    with db() as con:
        c = con.execute("SELECT created, data FROM cards WHERE id=?", (card,)).fetchone()
        d = json.loads(c["data"]) if c else None
        if not d or not d.get("win") or d.get("player") != player or not d.get("stats"):
            return 400, {"error": "only a run that just beat THE CANCEL can climb the hill"}
        if now - c["created"] > 3 * 3600:
            return 400, {"error": "that win is too old: challenge straight after the run"}
        king, king_player = king_public(con)
        if king_player == player:
            return 200, {"ok": True, "king": king, "you": True, "result": "already"}
        if con.execute("SELECT 1 FROM duels WHERE card=?", (card,)).fetchone():
            return 400, {"error": "this run has already had its challenge"}
        con.execute("INSERT INTO duels (card, created) VALUES (?,?)", (card, now))
        if king and not won:
            con.execute("UPDATE hill SET defences=defences+1 WHERE date=?", (hill_week(),))
            return 200, {"ok": True, "king": king_public(con)[0], "you": False, "result": "lost"}
        con.execute("INSERT OR REPLACE INTO hill (date, card, player, since, defences) VALUES (?,?,?,?,0)",
                    (hill_week(), card, player, now))
        return 200, {"ok": True, "king": king_public(con)[0], "you": True, "result": "took" if king else "claimed"}


# A signed-in player's progress follows the account: what they have unlocked, found and earned, and their record.
# Nothing here is trusted for the boards; it is the player's own save, merged so that no device ever loses anything.
RE_PKEY = re.compile(r"^[a-z0-9_]{1,32}$")
PROFILE_COUNTS = {"runs": 100000, "wins": 100000, "drip": 10000000}  # these add up across devices
PROFILE_BEST = {"best": 9, "heat": 20}                                # these only ever go up
PROFILE_SETS = ("unlocks", "seen", "ach", "tips")
MAX_PROFILE = 24000


def clean_profile(d):
    def num(src, k, hi):
        v = src.get(k) if isinstance(src, dict) else None
        return max(0, min(hi, int(v))) if isinstance(v, (int, float)) and v == v else 0

    def day(v):
        return v if isinstance(v, str) and RE_DATE.match(v) else ""

    out = {k: num(d, k, hi) for k, hi in {**PROFILE_COUNTS, **PROFILE_BEST}.items()}
    for k in PROFILE_SETS:
        v = d.get(k)
        v = [x for x in v if v[x]] if isinstance(v, dict) else v if isinstance(v, list) else []  # the game sends {id: 1}; kept as a list
        out[k] = sorted({x for x in v if isinstance(x, str) and RE_PKEY.match(x)})[:400]
    out["tut"] = bool(d.get("tut"))
    st = d.get("streak") if isinstance(d.get("streak"), dict) else {}
    out["streak"] = {"n": num(st, "n", 100000), "best": num(st, "best", 100000), "last": day(st.get("last"))}
    out["daily"] = day(d.get("daily"))  # the last day this player's daily was played, on any device
    return out


def merge_profile(old, new, base):
    """`old` is what the account holds, `new` what this device has, `base` what this device had when it last synced.
    With a base, the device's changes since then are applied on top. Without one (a device joining an account that
    already has progress) the larger of each number is kept, so nothing is counted twice."""
    if old is None:
        return new
    out = {}
    for k, hi in PROFILE_COUNTS.items():
        out[k] = max(0, min(hi, old[k] + new[k] - base[k])) if base else max(old[k], new[k])
    for k in PROFILE_BEST:
        out[k] = max(old[k], new[k])
    for k in PROFILE_SETS:
        out[k] = sorted(set(old[k]) | set(new[k]))[:400]
    out["tut"] = old["tut"] or new["tut"]
    a, b = old["streak"], new["streak"]
    lead = b if (b["last"], b["n"]) > (a["last"], a["n"]) else a
    out["streak"] = {"n": lead["n"], "last": lead["last"], "best": max(a["best"], b["best"], lead["n"])}
    out["daily"] = max(old["daily"], new["daily"])
    return out


def profile_sync(player, data, base, now):
    new = clean_profile(data)
    with db() as con:
        row = con.execute("SELECT data FROM profiles WHERE player=?", (player,)).fetchone()
        old = clean_profile(json.loads(row[0])) if row else None
        merged = merge_profile(old, new, clean_profile(base) if isinstance(base, dict) and old is not None else None)
        con.execute("INSERT OR REPLACE INTO profiles (player, data, at) VALUES (?,?,?)",
                    (player, json.dumps(merged, separators=(",", ":")), now))
    return merged


def daily_attempt(con, date, player, run, now):
    """True if `run` is this player's one daily run for `date`. The first run started (or, failing that, the first
    one posted) claims the day; a player already on that day's board from before this rule has used theirs."""
    got = con.execute("SELECT run FROM attempts WHERE date=? AND player=?", (date, player)).fetchone()
    if got:
        return got[0] == run
    if con.execute("SELECT 1 FROM scores WHERE board=? AND player=?", ("daily:" + date, player)).fetchone():
        return False
    con.execute("INSERT OR IGNORE INTO attempts (date, player, run, created) VALUES (?,?,?,?)", (date, player, run, now))
    return True


def forget_old_cards(con, now):
    # a card that a leaderboard row still points at is kept for as long as that row stands; a king's is kept for good
    old = [r[0] for r in con.execute("SELECT id FROM cards WHERE created<? AND id NOT IN (SELECT card FROM scores WHERE card IS NOT NULL)"
                                     " AND id NOT IN (SELECT card FROM hill)",
                                     (now - CARD_DAYS * 86400,))]
    con.executemany("DELETE FROM cards WHERE id=?", [(i,) for i in old])
    for cid in old:
        try:
            os.remove(os.path.join(CARDS, cid + ".png"))
        except OSError:
            pass


def card_run(cid):
    if not RE_CARD.match(cid):
        return None
    with db() as con:
        r = con.execute("SELECT data FROM cards WHERE id=?", (cid,)).fetchone()
    return json.loads(r[0]) if r else None


_draw_lock = threading.Lock()  # one card at a time: drawing is the only heavy thing this service does


def card_png(cid):
    path = os.path.join(CARDS, cid + ".png")
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        pass
    run = card_run(cid)
    if not run:
        return None
    with _draw_lock:
        if not os.path.exists(path):
            import card  # Pillow is only needed here
            png = card.render(run, cid)
            os.makedirs(CARDS, exist_ok=True)
            with open(path + ".tmp", "wb") as f:
                f.write(png)
            os.replace(path + ".tmp", path)
    with open(path, "rb") as f:
        return f.read()


def draw_ahead(cid):
    try:
        card_png(cid)
    except Exception as e:
        print("card failed: %s %s" % (type(e).__name__, e), flush=True)


def esc(v):
    return str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def share_page(cid, run):
    """What a link preview reads. People are forwarded to the game, onto the same map."""
    to = SITE + ("?daily=" + run["daily"] if run.get("daily") else "?seed=" + run["seed"] if run.get("seed") else "")
    title = "%s %s · %d drip" % (run["name"], "saved the timeline" if run["win"] else "was cancelled on day %d" % run["day"], run["score"])
    desc = "THE CANCEL IS COMING, a neochibi roguelite autobattler. " + (
        "Play the same map." if run.get("daily") or run.get("seed") else "9 days. 3 bosses. One timeline.")
    img = "%s/api/card/%s.png" % (PUBLIC, cid)
    return ("<!doctype html><html><head><meta charset='utf-8'><title>{t}</title>"
            "<meta property='og:type' content='website'><meta property='og:title' content=\"{t}\">"
            "<meta property='og:description' content=\"{d}\"><meta property='og:image' content=\"{i}\">"
            "<meta property='og:image:width' content='1200'><meta property='og:image:height' content='630'>"
            "<meta property='og:url' content=\"{u}\"><meta name='twitter:card' content='summary_large_image'>"
            "<meta name='twitter:title' content=\"{t}\"><meta name='twitter:description' content=\"{d}\">"
            "<meta name='twitter:image' content=\"{i}\"><meta name='theme-color' content='#8be9fd'>"
            "<meta property='og:site_name' content='THE CANCEL IS COMING'><meta property='og:image:type' content='image/png'>"
            "<meta property='og:image:alt' content=\"{alt}\"><meta name='twitter:image:alt' content=\"{alt}\">"
            # people are forwarded by script. Preview robots don't run scripts, so they stay here and read the tags
            # above; a plain redirect or an unconditional refresh would send some of them on to the game's own preview.
            "<script>location.replace({js})</script><noscript><meta http-equiv='refresh' content=\"0;url={to}\"></noscript></head>"
            "<body style='background:#000;color:#8be9fd;font-family:monospace'><a style='color:#8be9fd' href=\"{to}\">enter the timeline</a>"
            "</body></html>").format(t=esc(title), d=esc(desc), i=esc(img), u=esc(PUBLIC + "/r/" + cid), to=esc(to),
                                     alt=esc("%s's character and relics at the end of the run" % run["name"]),
                                     js=json.dumps(to).replace("<", "\\u003c"))


class Handler(BaseHTTPRequestHandler):
    server_version = "cancel-api"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # one short line per request, no addresses, no sign-in codes
        print("%s %s" % (self.command, re.sub(r"(/api/auth/[\w/]+)\?\S*", r"\1?…", fmt % args)), flush=True)

    def raw(self, code, ctype, data, cache):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def allowed_return(self, url):  # only ever send a signed-in player back to the game itself
        u = urlparse(url)
        origin = "%s://%s" % (u.scheme, u.netloc)
        return origin in ORIGINS or bool(DEV and re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin))

    def client_key(self):
        ip = self.headers.get("X-Real-IP") or self.client_address[0]
        return hashlib.sha256((SALT + ip).encode()).hexdigest()[:24]

    def allowed_origin(self):
        o = self.headers.get("Origin", "")
        if o in ORIGINS:
            return o
        if DEV and re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", o):
            return o
        return None

    def send(self, code, body):
        data = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(code)
        o = self.allowed_origin()
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        o = self.allowed_origin()
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        one = lambda k: (q.get(k) or [""])[0]
        if u.path == "/api/health":
            return self.send(200, {"ok": True, "today": utc_today().isoformat(), "rn": RN_ON, "ur": UR_ON})
        if u.path == "/api/stats":
            return self.send(200, run_stats())
        if u.path.startswith("/r/"):
            run = card_run(u.path[3:])
            if not run:
                return self.redirect(SITE)  # expired or mistyped: the link still opens the game
            return self.raw(200, "text/html; charset=utf-8", share_page(u.path[3:], run).encode(), "public, max-age=300")
        if u.path.startswith("/api/card/") and u.path.endswith(".png"):
            cid = u.path[10:-4]
            try:
                png = card_png(cid) if RE_CARD.match(cid) else None
            except Exception as e:  # a card that can't be drawn must not take the service down
                print("card failed: %s %s" % (type(e).__name__, e), flush=True)
                png = None
            if not png:
                return self.send(404, {"error": "no such card"})
            return self.raw(200, "image/png", png, "public, max-age=86400")
        if u.path == "/api/auth/urbit/login":
            back = one("return").split("#")[0]
            if not UR_ON:
                return self.send(404, {"error": "sign-in is not switched on"})
            if not self.allowed_return(back) or not rate_ok("auth:" + self.client_key(), 40):
                return self.send(400, {"error": "bad return"})
            url = urbit_begin(back)
            return self.redirect(url) if url else self.send(503, {"error": "busy"})
        if u.path == "/api/auth/urbit/callback":  # reached through the ship's own address, so the ship's login cookie comes with it
            with _pending_lock:
                kind, back, _started = _pending.pop(one("state"), (None, None, 0))
            if not back or kind != "urbit":
                return self.send(400, {"error": "this sign-in link has expired, start again from the game"})
            try:
                ship = urbit_who(self.headers.get("Cookie"))
            except (urllib.error.URLError, ValueError, TimeoutError) as e:
                print("urbit auth failed: %s" % type(e).__name__, flush=True)
                return self.redirect(back + "#rn_error=" + urllib.parse.quote("the ship didn't answer"))
            if not ship:
                return self.redirect(back + "#rn_error=" + urllib.parse.quote("log in with a planet, star, galaxy or moon"))
            return self.redirect(back + "#rn=" + make_session(ship, ship))
        if u.path == "/api/auth/login":
            back = one("return").split("#")[0]
            if not RN_ON:
                return self.send(404, {"error": "sign-in is not switched on"})
            if not self.allowed_return(back) or not rate_ok("auth:" + self.client_key(), 40):
                return self.send(400, {"error": "bad return"})
            url = auth_begin(back)
            return self.redirect(url) if url else self.send(503, {"error": "busy"})
        if u.path == "/api/auth/callback":
            with _pending_lock:
                verifier, back, _started = _pending.pop(one("state"), (None, None, 0))
            if not back or verifier == "urbit":
                return self.send(400, {"error": "this sign-in link has expired, start again from the game"})
            if not one("code"):
                return self.redirect(back + "#rn_error=" + urllib.parse.quote(clean_text(one("error") or "cancelled", 40)))
            try:
                return self.redirect(back + "#rn=" + auth_finish(one("code"), verifier))
            except (urllib.error.URLError, ValueError, KeyError, TimeoutError) as e:
                print("auth failed: %s" % type(e).__name__, getattr(e, "code", ""), flush=True)
                return self.redirect(back + "#rn_error=failed")
        if u.path == "/api/king":
            player = one("player") if RE_PLAYER.match(one("player")) else None
            with db() as con:
                king, king_player = king_public(con)
            return self.send(200, {"week": hill_week(), "resets": hill_reset(), "dailyResets": next_reset(), "king": king,
                                   "you": bool(player and king_player == player)})
        if u.path == "/api/pulse":
            return self.send(200, pulse())
        if u.path == "/api/hall":
            return self.send(200, hall(120))
        if u.path == "/api/token":
            kind = one("kind")
            if kind not in TOKEN_SOURCES or not re.match(r"^\d{1,4}$", one("id")):
                return self.send(400, {"error": "bad token"})
            attrs, code = token_traits(kind, int(one("id")), self.client_key())
            if attrs is None:
                return self.send(code, {"error": "slow down" if code == 429 else "traits unavailable"})
            return self.send(200, {"kind": kind, "id": int(one("id")), "attributes": attrs})
        if u.path != "/api/board":
            return self.send(404, {"error": "not found"})
        if one("daily"):
            if not RE_DATE.match(one("daily")):
                return self.send(400, {"error": "bad daily"})
            board = "daily:" + one("daily")
        elif one("seed"):
            if not RE_SEED.match(one("seed")):
                return self.send(400, {"error": "bad seed"})
            board = "seed:" + one("seed")
        else:
            board = "all"
        try:
            limit = max(1, min(100, int(one("limit") or 50)))
        except ValueError:
            limit = 50
        player = one("player") if RE_PLAYER.match(one("player")) else None
        self.send(200, read_board(board, limit, player))

    def daily_start(self):
        """A daily run has begun: the first one a player starts on a given day is the one that will count."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
            d = json.loads(self.rfile.read(length)) if 0 < length <= MAX_BODY else None
        except (ValueError, UnicodeDecodeError):
            d = None
        if not isinstance(d, dict):
            return self.send(400, {"error": "bad json"})
        player, run, daily = d.get("player"), d.get("run"), d.get("daily")
        handle = read_session(d.get("session"))
        if handle:
            player = verified_player(handle)
        ok = (isinstance(player, str) and RE_PLAYER.match(player) and (handle or not player.startswith(("rn", "ur")))
              and isinstance(run, str) and RE_RUN.match(run) and isinstance(daily, str) and RE_DATE.match(daily))
        if ok:
            try:
                ok = abs((datetime.strptime(daily, "%Y-%m-%d").date() - utc_today()).days) <= 1
            except ValueError:
                ok = False
        if not ok:
            return self.send(400, {"error": "bad start"})
        if not rate_ok("start:" + self.client_key(), 60):
            return self.send(429, {"error": "slow down"})
        with db() as con:
            first = daily_attempt(con, daily, player, run, int(time.time()))
        self.send(200, {"ok": True, "first": first})

    def profile_post(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            d = json.loads(self.rfile.read(length)) if 0 < length <= MAX_PROFILE else None
        except (ValueError, UnicodeDecodeError):
            d = None
        if not isinstance(d, dict) or not isinstance(d.get("data"), dict):
            return self.send(400, {"error": "bad json"})
        handle = read_session(d.get("session"))
        if not handle:
            return self.send(401, {"error": "sign in to keep your progress on your account"})
        if not rate_ok("profile:" + self.client_key(), 240):
            return self.send(429, {"error": "slow down"})
        player = verified_player(handle)
        self.send(200, {"ok": True, "player": player, "data": profile_sync(player, d["data"], d.get("base"), int(time.time()))})

    def king_post(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            d = json.loads(self.rfile.read(length)) if 0 < length <= MAX_BODY else None
        except (ValueError, UnicodeDecodeError):
            d = None
        if not isinstance(d, dict):
            return self.send(400, {"error": "bad json"})
        player, card = d.get("player"), d.get("card")
        handle = read_session(d.get("session"))
        if handle:
            player = verified_player(handle)
        if not (isinstance(player, str) and RE_PLAYER.match(player) and (handle or not player.startswith(("rn", "ur")))
                and isinstance(card, str) and RE_CARD.match(card)):
            return self.send(400, {"error": "bad challenge"})
        if not rate_ok("king:" + self.client_key(), 30):
            return self.send(429, {"error": "slow down"})
        code, body = king_challenge(card, player, d.get("won") is True, int(time.time()))
        self.send(code, body)

    def do_POST(self):
        if urlparse(self.path).path == "/api/king/challenge":
            if not self.allowed_origin():
                return self.send(403, {"error": "origin not allowed"})
            return self.king_post()
        if urlparse(self.path).path == "/api/profile":
            if not self.allowed_origin():
                return self.send(403, {"error": "origin not allowed"})
            return self.profile_post()
        if urlparse(self.path).path == "/api/daily/start":
            if not self.allowed_origin():
                return self.send(403, {"error": "origin not allowed"})
            return self.daily_start()
        if urlparse(self.path).path != "/api/score":
            return self.send(404, {"error": "not found"})
        if not self.allowed_origin():  # browsers always send Origin on a cross-site POST
            return self.send(403, {"error": "origin not allowed"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY:
            return self.send(413, {"error": "bad size"})
        key = self.client_key()
        if not rate_ok(key):
            return self.send(429, {"error": "slow down"})
        try:
            boards, row = parse_run(json.loads(self.rfile.read(length)))
        except Bad as e:
            print("score refused: %s" % e, flush=True)  # so a run that didn't post can be explained afterwards
            return self.send(400, {"error": str(e)})
        except (ValueError, UnicodeDecodeError):
            return self.send(400, {"error": "bad json"})
        if not row["look"] and row["token"] is not None:
            row["look"] = look_from_token(row["collection"], row["token"], key)
        now = int(time.time())
        ranks = {}
        share = "".join(secrets.choice("abcdefghijkmnpqrstuvwxyz23456789") for _ in range(8))  # this run's id
        row["card"] = share
        with db() as con:
            for board in boards:
                if board.startswith("daily:") and not daily_attempt(con, board[6:], row["player"], row["run"] or share, now):
                    # not this player's first daily run today: the board keeps the first, this one is practice
                    total = con.execute("SELECT COUNT(*) FROM scores WHERE board=?", (board,)).fetchone()[0]
                    ranks[board] = dict(rank_of(con, board, row["player"]) or {}, total=total, locked=True)
                    continue
                # one row per player per board: a new run replaces it only if it ranks higher (a win beats any loss)
                con.execute(
                    """INSERT INTO scores (board, player, name, score, day, win, bosses, kills, heat, tribe, collection, token,
                                           relics, killed_by, ip_hash, created, look, handle, card)
                       VALUES (:board, :player, :name, :score, :day, :win, :bosses, :kills, :heat, :tribe, :collection, :token,
                               :relics, :killed_by, :ip_hash, :created, :look, :handle, :card)
                       ON CONFLICT(board, player) DO UPDATE SET
                         name=excluded.name, score=excluded.score, day=excluded.day, win=excluded.win, bosses=excluded.bosses,
                         kills=excluded.kills, heat=excluded.heat, tribe=excluded.tribe, collection=excluded.collection,
                         token=excluded.token, relics=excluded.relics, killed_by=excluded.killed_by, look=excluded.look, handle=excluded.handle, card=excluded.card,
                         ip_hash=excluded.ip_hash, created=excluded.created
                       WHERE excluded.win > scores.win OR (excluded.win = scores.win AND excluded.score > scores.score)""",
                    dict(row, board=board, ip_hash=key, created=now))
                total = con.execute("SELECT COUNT(*) FROM scores WHERE board=?", (board,)).fetchone()[0]
                ranks[board] = dict(rank_of(con, board, row["player"]), total=total)
            # every finished run is also kept, without the player, so the game can be balanced on how runs really end
            con.execute("""INSERT INTO runs (created, score, day, win, bosses, kills, heat, tribe, collection, relics, killed_by, daily, stats)
                           VALUES (:created, :score, :day, :win, :bosses, :kills, :heat, :tribe, :collection, :relics, :killed_by, :daily, :stats)""",
                        dict(row, created=now, daily=int(any(b.startswith("daily:") for b in boards))))
            # and as a card: what the share link's preview is drawn from
            con.execute("INSERT INTO cards (id, created, data) VALUES (?,?,?)", (share, now, json.dumps({
                "name": row["name"], "score": row["score"], "day": row["day"], "win": bool(row["win"]), "bosses": row["bosses"],
                "kills": row["kills"], "cult": row["cult"], "heat": row["heat"], "tribe": row["tribe"],
                "relics": json.loads(row["relics"]), "look": json.loads(row["look"]) if row["look"] else None,
                "daily": row["card_daily"], "seed": row["card_seed"], "handle": row["handle"],
                "collection": row["collection"], "token": row["token"],
                "killedBy": row["killed_by"],
                "player": row["player"], "stats": json.loads(row["stats"]) if row["stats"] else None},  # for king of the hill; never sent out
                separators=(",", ":"))))
            if secrets.randbelow(50) == 0:
                forget_old_cards(con, now)
        self.send(200, {"ok": True, "boards": ranks, "share": PUBLIC + "/r/" + share})
        threading.Thread(target=draw_ahead, args=(share,), daemon=True).start()  # so the preview is ready before the link is posted


if __name__ == "__main__":
    init_db()
    print("cancel-api on 127.0.0.1:%d, db %s" % (PORT, DB), flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
