#!/usr/bin/env python3
"""Leaderboard service for THE CANCEL IS COMING.

Standard library only. Listens on localhost; nginx terminates TLS and proxies to it.

  POST /api/score   submit a finished run (JSON)
  GET  /api/board   ?daily=YYYY-MM-DD | ?seed=CODE | ?all=1   [&limit=50] [&player=ID]
  GET  /api/token   ?kind=milady|remilio&id=N   a token's traits, fetched once from maker.remilia.org and cached
  GET  /api/stats   how runs end, in aggregate (for balancing)
  GET  /api/health

The game runs entirely in the browser, so a score cannot be proven. Submissions are
checked for shape and plausibility and rate-limited; that keeps the board tidy, not tamper-proof.

Environment: CANCEL_DB, CANCEL_PORT, CANCEL_SALT, CANCEL_ORIGINS (comma separated), CANCEL_DEV=1
"""
import hashlib, json, os, re, sqlite3, threading, time, urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB = os.environ.get("CANCEL_DB", "/var/lib/cancel-api/scores.db")
PORT = int(os.environ.get("CANCEL_PORT", "8787"))
SALT = os.environ.get("CANCEL_SALT", "dev-salt")
ORIGINS = {o.strip() for o in os.environ.get("CANCEL_ORIGINS", "https://cancel.tylerirl.com,https://tylerirl.com").split(",") if o.strip()}
DEV = os.environ.get("CANCEL_DEV") == "1"  # also accept any localhost origin

MAX_BODY = 4096
MAX_SCORE = 6000          # day, boss, kill and $CULT points with the top heat bonus stay well under this
POSTS_PER_HOUR = 30       # per client address
TRIBES = {"hypebeast", "gyaru", "lolita", "harajuku", "prep"}
COLLECTIONS = {"milady", "remilio"}
RE_PLAYER = re.compile(r"^[a-z0-9]{8,32}$")
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
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, created INTEGER NOT NULL,
  score INTEGER NOT NULL, day INTEGER NOT NULL, win INTEGER NOT NULL, bosses INTEGER NOT NULL, kills INTEGER NOT NULL,
  heat INTEGER NOT NULL, tribe TEXT NOT NULL, collection TEXT NOT NULL, relics TEXT NOT NULL, killed_by TEXT NOT NULL,
  daily INTEGER NOT NULL
);
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


def utc_today():
    return datetime.now(timezone.utc).date()


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
    name = clean_text(d.get("name"), 18)
    if not name:
        raise Bad("bad name")
    score = as_int(d.get("score"), 0, MAX_SCORE, "score")
    day = as_int(d.get("day"), 1, 9, "day")
    bosses = as_int(d.get("bosses"), 0, 3, "bosses")
    kills = as_int(d.get("kills"), 0, 500, "kills")
    heat = as_int(d.get("heat", 0), 0, 5, "heat")
    win = bool(d.get("win"))
    if win and (bosses != 3 or day != 9):
        raise Bad("inconsistent win")
    if bosses > (day // 3):
        raise Bad("inconsistent bosses")
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

    row = dict(player=player, name=name, score=score, day=day, win=int(win), bosses=bosses, kills=kills, heat=heat,
               tribe=tribe, collection=collection, token=token, relics=json.dumps(out, separators=(",", ":")),
               killed_by=clean_text(d.get("killedBy"), 30), look=parse_look(d.get("look")))
    return boards, row


def rank_of(con, board, player):
    me = con.execute("SELECT score, created FROM scores WHERE board=? AND player=?", (board, player)).fetchone()
    if not me:
        return None
    ahead = con.execute(
        "SELECT COUNT(*) FROM scores WHERE board=? AND (score>? OR (score=? AND created<?))",
        (board, me["score"], me["score"], me["created"])).fetchone()[0]
    return {"rank": ahead + 1, "score": me["score"]}


def public(row, rank):
    return {"rank": rank, "name": row["name"], "score": row["score"], "day": row["day"], "win": bool(row["win"]),
            "bosses": row["bosses"], "kills": row["kills"], "heat": row["heat"], "tribe": row["tribe"],
            "collection": row["collection"], "token": row["token"], "relics": json.loads(row["relics"]),
            "killedBy": row["killed_by"], "look": json.loads(row["look"]) if row["look"] else None}


def read_board(board, limit, player):
    with db() as con:
        rows = con.execute("SELECT * FROM scores WHERE board=? ORDER BY score DESC, created ASC LIMIT ?", (board, limit)).fetchall()
        total = con.execute("SELECT COUNT(*) FROM scores WHERE board=?", (board,)).fetchone()[0]
        you = rank_of(con, board, player) if player else None
    return {"board": board, "total": total, "top": [public(r, i + 1) for i, r in enumerate(rows)], "you": you}


def run_stats():
    with db() as con:
        n, wins, avg_day, avg_score = con.execute("SELECT COUNT(*), COALESCE(SUM(win),0), AVG(day), AVG(score) FROM runs").fetchone()
        by_day = con.execute("SELECT day, COUNT(*) FROM runs WHERE win=0 GROUP BY day ORDER BY day").fetchall()
        killers = con.execute("SELECT killed_by, COUNT(*) c FROM runs WHERE win=0 AND killed_by<>'' GROUP BY killed_by ORDER BY c DESC LIMIT 12").fetchall()
        tribes = con.execute("SELECT tribe, COUNT(*), SUM(win), AVG(day) FROM runs GROUP BY tribe").fetchall()
        bosses = con.execute("SELECT bosses, COUNT(*) FROM runs GROUP BY bosses ORDER BY bosses").fetchall()
        relics = {}
        for (r,) in con.execute("SELECT relics FROM runs ORDER BY id DESC LIMIT 2000"):
            for rid, _tier in json.loads(r):
                relics[rid] = relics.get(rid, 0) + 1
    return {"runs": n, "wins": wins, "avgDay": round(avg_day or 0, 2), "avgScore": round(avg_score or 0, 1),
            "deathsByDay": {str(d): c for d, c in by_day}, "bossesBeaten": {str(b): c for b, c in bosses},
            "killedBy": [[k, c] for k, c in killers],
            "tribes": {t: {"runs": c, "wins": w or 0, "avgDay": round(a or 0, 2)} for t, c, w, a in tribes},
            "relicsHeldAtEnd": sorted(relics.items(), key=lambda x: -x[1])[:25]}


class Handler(BaseHTTPRequestHandler):
    server_version = "cancel-api"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # one short line per request, no addresses
        print("%s %s" % (self.command, fmt % args), flush=True)

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
            return self.send(200, {"ok": True, "today": utc_today().isoformat()})
        if u.path == "/api/stats":
            return self.send(200, run_stats())
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

    def do_POST(self):
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
            return self.send(400, {"error": str(e)})
        except (ValueError, UnicodeDecodeError):
            return self.send(400, {"error": "bad json"})
        now = int(time.time())
        ranks = {}
        with db() as con:
            for board in boards:
                # one row per player per board: a new run replaces it only if it scored higher
                con.execute(
                    """INSERT INTO scores (board, player, name, score, day, win, bosses, kills, heat, tribe, collection, token,
                                           relics, killed_by, ip_hash, created, look)
                       VALUES (:board, :player, :name, :score, :day, :win, :bosses, :kills, :heat, :tribe, :collection, :token,
                               :relics, :killed_by, :ip_hash, :created, :look)
                       ON CONFLICT(board, player) DO UPDATE SET
                         name=excluded.name, score=excluded.score, day=excluded.day, win=excluded.win, bosses=excluded.bosses,
                         kills=excluded.kills, heat=excluded.heat, tribe=excluded.tribe, collection=excluded.collection,
                         token=excluded.token, relics=excluded.relics, killed_by=excluded.killed_by, look=excluded.look,
                         ip_hash=excluded.ip_hash, created=excluded.created
                       WHERE excluded.score > scores.score""",
                    dict(row, board=board, ip_hash=key, created=now))
                total = con.execute("SELECT COUNT(*) FROM scores WHERE board=?", (board,)).fetchone()[0]
                ranks[board] = dict(rank_of(con, board, row["player"]), total=total)
            # every finished run is also kept, without the player, so the game can be balanced on how runs really end
            con.execute("""INSERT INTO runs (created, score, day, win, bosses, kills, heat, tribe, collection, relics, killed_by, daily)
                           VALUES (:created, :score, :day, :win, :bosses, :kills, :heat, :tribe, :collection, :relics, :killed_by, :daily)""",
                        dict(row, created=now, daily=int(any(b.startswith("daily:") for b in boards))))
        self.send(200, {"ok": True, "boards": ranks})


if __name__ == "__main__":
    init_db()
    print("cancel-api on 127.0.0.1:%d, db %s" % (PORT, DB), flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
