#!/usr/bin/env python3
"""Bundle index.html + css/ + js/ + assets/ into one self-contained dist.html.

Usage: python3 build.py
"""
import base64, hashlib, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent
MIME = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif"}


def data_uri(rel):
    p = ROOT / rel
    return "data:%s;base64,%s" % (MIME[p.suffix.lower()], base64.b64encode(p.read_bytes()).decode())


def swap(html, old, new):
    if old not in html:
        raise SystemExit("build.py: expected to find %r in index.html" % old)
    return html.replace(old, new)


index = json.loads((ROOT / "assets/asset_index.json").read_text("utf8"))
files = {}
for cfg in index["order"]:  # other top-level keys are metadata
    for layer, names in index[cfg].items():
        for name in names:
            rel = "assets/img/%s/%s/%s" % (cfg, layer, name)
            files[rel] = data_uri(rel)

for folder in ("Schizo", "Radbro", "Pixelady", "npc"):  # enemy posters and NPC pictures that ship with the game
    for p in sorted((ROOT / "assets/img" / folder).glob("*.webp")):
        rel = "assets/img/%s/%s" % (folder, p.name)
        files[rel] = data_uri(rel)

script = "\n".join([
    "window.INLINE_ASSET_INDEX=" + json.dumps(index, separators=(",", ":")) + ";",
    "window.INLINE_FILES=" + json.dumps(files, separators=(",", ":")) + ";",
    (ROOT / "js/data.js").read_text("utf8"),
    (ROOT / "js/game.js").read_text("utf8"),
])

# Stamp the page with a version made from the code itself, so a browser never runs an old script against a new
# page: index.html asks for js/game.js?v=<stamp>, and version.json lets an open tab notice that it has gone stale.
stamp = hashlib.sha256(b"".join((ROOT / f).read_bytes() for f in ("js/data.js", "js/game.js", "css/style.css"))).hexdigest()[:10]
page = (ROOT / "index.html").read_text("utf8")
stamped = re.sub(r'(href="css/style\.css|src="js/data\.js|src="js/game\.js)(\?v=[0-9a-f]+)?"', lambda m: m.group(1) + "?v=" + stamp + '"', page)
if stamped != page:
    (ROOT / "index.html").write_text(stamped, "utf8")
(ROOT / "version.json").write_text(json.dumps({"v": stamp}) + "\n", "utf8")

html = re.sub(r'\?v=[0-9a-f]+"', '"', stamped)
html = swap(html, '<link rel="stylesheet" href="css/style.css">',
            "<style>\n" + (ROOT / "css/style.css").read_text("utf8") + "</style>")
html = swap(html, '<script src="js/data.js"></script>\n', "")
html = swap(html, '<script src="js/game.js"></script>', "<script>\n" + script + "\n</script>")
coin = "assets/img/cult_coin.png"
html = swap(html, 'src="%s"' % coin, 'src="%s"' % data_uri(coin))
html = swap(html, 'href="%s"' % coin, 'href="%s"' % data_uri(coin))

(ROOT / "dist.html").write_text(html, "utf8")
print("dist.html: %.1f MB, %d inlined assets, version %s" % (len(html.encode()) / 1e6, len(files), stamp))
