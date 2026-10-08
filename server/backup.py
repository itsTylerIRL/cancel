#!/usr/bin/env python3
"""Nightly copy of the leaderboard database.

Uses SQLite's own online backup, so it is safe while the service is running. Writes a gzipped copy to
<data dir>/backups/scores-YYYY-MM-DD.db.gz and keeps the newest KEEP of them.

This guards against a bad edit or a corrupted file. It does not guard against losing the machine: for that, set
CANCEL_BACKUP_COPY to a command that ships the file somewhere else; "{}" is replaced with the backup's path.
"""
import glob, gzip, os, shutil, sqlite3, subprocess, sys, time

DB = os.environ.get("CANCEL_DB", "/var/lib/cancel-api/scores.db")
OUT = os.environ.get("CANCEL_BACKUPS", os.path.join(os.path.dirname(DB), "backups"))
KEEP = int(os.environ.get("CANCEL_BACKUP_KEEP", "14"))
COPY = os.environ.get("CANCEL_BACKUP_COPY", "")

os.makedirs(OUT, exist_ok=True)
tmp = os.path.join(OUT, ".snapshot.db")
dest = os.path.join(OUT, "scores-%s.db.gz" % time.strftime("%Y-%m-%d"))
src = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
dst = sqlite3.connect(tmp)
with dst:
    src.backup(dst)
ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
rows = dst.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
dst.close(); src.close()
if ok != "ok":
    os.remove(tmp)
    sys.exit("backup failed its integrity check: %s" % ok)
with open(tmp, "rb") as f, gzip.open(dest + ".tmp", "wb", 6) as g:
    shutil.copyfileobj(f, g)
os.replace(dest + ".tmp", dest)
os.remove(tmp)
old = sorted(glob.glob(os.path.join(OUT, "scores-*.db.gz")))[:-KEEP]
for p in old:
    os.remove(p)
print("backed up %d score rows to %s (%d kB), %d older copies removed" % (rows, dest, os.path.getsize(dest) // 1024, len(old)), flush=True)
if COPY:
    subprocess.run(COPY.replace("{}", dest), shell=True, check=True, timeout=300)
    print("copied off the machine", flush=True)
