"""Draws a run's share card (1200x630 PNG) on the server, from the run's data alone.

Nothing is uploaded: the character is rebuilt from its recipe of trait layers and the relics it held, using the
game's own art and the layer rules exported from the game by make_spec.mjs (card_spec.json). This mirrors
composeAvatar() and shareCard() in js/game.js.
"""
import colorsys, io, json, math, os, random
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.environ.get("CANCEL_ASSETS", os.path.join(HERE, "..", "assets", "img"))
with open(os.path.join(HERE, "card_spec.json"), encoding="utf8") as f:
    SPEC = json.load(f)

CYAN = (139, 233, 253)
RARITY = {"rare": (241, 250, 140, 255), "legendary": (255, 121, 198, 255), "cursed": (189, 147, 249, 255)}
_fonts = {}


def font(px, weight="Bold"):
    key = (px, weight)
    if key not in _fonts:
        name = "Anton-Regular.ttf" if weight == "Impact" else "JetBrainsMono-%s.ttf" % weight
        _fonts[key] = ImageFont.truetype(os.path.join(HERE, "fonts", name), px)
    return _fonts[key]


def layer(cfg, name, file):
    """One trait image, or None. Names were validated when the run was posted; this also refuses anything that
    is not a file inside the art folder."""
    if cfg not in ("Milady", "Remilio", "Bonkler") or "/" in name or "/" in file or ".." in file:
        return None
    path = os.path.join(ASSETS, cfg, name, file)
    try:
        return Image.open(path).convert("RGBA")
    except OSError:
        return None


def bounds(im):
    box = im.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
    return box or (0, 0, im.width, im.height)


def gray(im):
    a = im.getchannel("A")
    g = ImageEnhance.Contrast(ImageOps.grayscale(im).convert("RGB")).enhance(1.15).convert("RGBA")
    g.putalpha(a)
    return g


def tint_eyes(cv, mask, swatch, darken):
    """Milady eye colour: inside the eye mask keep each pixel's lightness, take the colour's hue and saturation."""
    W, Y, H = 600, 180, 320
    r, g, b = swatch.resize((W, 750)).convert("RGB").getpixel((300, 375))
    th, _l, ts = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    m = mask.resize((W, 750)).crop((0, Y, W, Y + H)).load()
    px = cv.load()
    for y in range(H):
        for x in range(W):
            mr, mg, mb, ma = m[x, y]
            if ma < 128 or mr + mg + mb < 180:
                continue
            er, eg, eb, _ea = px[x, Y + y]
            l = (max(er, eg, eb) + min(er, eg, eb)) / 510 * 100
            if darken:
                l = 5 if l < 5 else l * darken
            nr, ng, nb = colorsys.hls_to_rgb(th, min(l, 100) / 100, ts)
            px[x, Y + y] = (round(nr * 255), round(ng * 255), round(nb * 255), 255)


def compose(look, relic_ids):
    """The character, 600x750 on transparency, wearing its relics."""
    cv = Image.new("RGBA", (600, 750), (0, 0, 0, 0))
    body = look["cfg"] if look else "Milady"
    slots = {}

    def add(slot, item):
        if slot in SPEC["SINGLE"]:
            slots[slot] = [item]
        else:
            slots.setdefault(slot, []).append(item)

    if look:
        for name, file in look["layers"].items():
            slot = SPEC["TOKEN_SLOTS"][body].get(name)
            if slot:
                add(slot, {"cfg": body, "layer": name, "file": file, "own": True})
    seen = set()
    for rid in relic_ids:
        r = SPEC["relics"].get(rid)
        if not r or rid in seen:
            continue
        seen.add(rid)
        cfg, name, art = r["icon"][:3]
        slot = SPEC["WEAR"].get(cfg, {}).get(name)
        if slot:
            add(slot, {"cfg": cfg, "layer": name, "file": art + ".webp", "tint": r["icon"][3] if len(r["icon"]) > 3 else ""})
    if body == "Remilio" and slots.get("costume"):  # a costume hides what the collection hides under one
        for k in ("shirt", "hat", "glasses", "hair", "face"):
            if k in slots:
                slots[k] = [it for it in slots[k] if not it.get("own")]
    if body == "Milady" and slots.get("costume") and "shirt" in slots:  # a costume is the whole outfit
        slots["shirt"] = [it for it in slots["shirt"] if not it.get("own")]
    eyes = (slots.get("eyes") or [None])[0]
    tint = SPEC["tint"]
    colour = (look or {}).get("eye") or ""
    friends = props = 0
    for slot in SPEC["DRAW_ORDER"][body]:
        for it in slots.get(slot, []):
            im = layer(it["cfg"], it["layer"], it["file"])
            if im is None:
                continue
            if it.get("tint") == "gray":
                im = gray(im)
            if slot == "friend":  # Remilio friends sit in the bottom-right corner, side by side
                paste(cv, im.resize((600, 600)), -85 * friends, 150)
                friends += 1
            elif slot == "prop":  # Bonkler parts are pixel art: carried as props down the left edge
                x0, y0, x1, y1 = bounds(im)
                bw, bh = x1 - x0, y1 - y0
                k = min(140 / bw, 140 / bh, 4)
                part = im.crop((x0, y0, x1, y1)).resize((max(1, round(bw * k)), max(1, round(bh * k))), Image.NEAREST)
                paste(cv, part, round(78 - bw * k / 2), round(742 - 150 * props - bh * k))
                props += 1
            elif it["cfg"] == "Remilio":  # Remilio art is square with a smaller head: fitted per kind of piece on a Milady, as the game does
                fit = SPEC.get("REMILIO_FIT") or {"base": [-70, -32, 762, 762], "onMilady": {}}
                x, y, w, h = (fit["onMilady"].get(slot) if body == "Milady" else None) or fit["base"]
                paste(cv, im.resize((w, h)), x, y)
            elif slot == "hair" and slots.get("costume"):  # under a hood only the hair around the face shows
                im = im.resize((600, 750))
                clip = Image.new("L", (600, 750), 0)
                ImageDraw.Draw(clip).ellipse((330 - 225, 300 - 255, 330 + 225, 300 + 255), fill=255)
                im.putalpha(Image.composite(im.getchannel("A"), clip, clip))
                paste(cv, im, 0, 0)
            else:
                paste(cv, im.resize((600, 750)), 0, 0)
            if it is eyes and body == "Milady" and it.get("own") and colour and it["file"][:-5] in tint["values"]:
                mask, swatch = layer("Milady", tint["mask"], it["file"]), layer("Milady", tint["by"], colour + ".webp")
                if mask and swatch:
                    tint_eyes(cv, mask, swatch, tint["darken"].get(colour, 0))
    return cv


def paste(cv, im, x, y):
    """alpha_composite that allows the image to hang off the canvas."""
    sx, sy = max(0, -x), max(0, -y)
    w, h = min(im.width - sx, cv.width - max(0, x)), min(im.height - sy, cv.height - max(0, y))
    if w > 0 and h > 0:
        cv.alpha_composite(im, (max(0, x), max(0, y)), (sx, sy, sx + w, sy + h))


def over(base, top, xy=(0, 0)):
    base.paste(top, xy, top)


def fry(src, caption, rng):
    """CHEESEWORLD treatment: crushed, oversaturated, grainy, with a caption."""
    a = src.getchannel("A")
    small = src.resize((src.width // 3, src.height // 3)).resize(src.size, Image.BILINEAR)
    rgb = small.convert("RGB")
    for enh, v in ((ImageEnhance.Color, 2.6), (ImageEnhance.Contrast, 1.6), (ImageEnhance.Brightness, 1.08)):
        rgb = enh(rgb).enhance(v)
    over = Image.new("RGBA", src.size, (255, 110, 0, 41))
    d = ImageDraw.Draw(over)
    g = max(2, round(src.width / 160))
    for _ in range(1400):
        r, gr, b = colorsys.hls_to_rgb(rng.random(), 0.6, 0.9)
        x, y = rng.random() * src.width, rng.random() * src.height
        d.rectangle((x, y, x + g, y + g), fill=(round(r * 255), round(gr * 255), round(b * 255), 33))
    out = Image.alpha_composite(rgb.convert("RGBA"), over)
    out.putalpha(small.getchannel("A") if a.getextrema()[0] < 255 else a)
    if caption:
        fs = round(src.width / 7.5)
        f = font(fs, "Impact")
        ImageDraw.Draw(out).text((src.width / 2, src.height - fs * 0.45), caption, font=f, fill="#fff", anchor="ms",
                                 stroke_width=max(2, fs // 14), stroke_fill="#000")
    return out


def ps1(src):
    """MILADYSTATION treatment: low resolution, ordered dither, hard edges."""
    w = 110
    h = round(w * src.height / src.width)
    t = src.resize((w, h), Image.BILINEAR)
    px = t.load()
    bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            n = (bayer[(y & 3) * 4 + (x & 3)] - 7.5) * 1.6
            px[x, y] = tuple(max(0, min(255, round((v + n) / 8) * 8)) for v in (r, g, b)) + (255 if a > 110 else 0,)
    return t.resize(src.size, Image.NEAREST)


def cheese(relic_ids):
    n = sum(1 for rid in set(relic_ids) if "cheese" in SPEC["relics"].get(rid, {}).get("set", []))
    return n + (1 if n and "webring" in relic_ids else 0)


def icon(rid):
    """A relic's art cropped to its trait, with the white sticker outline the game gives it."""
    r = SPEC["relics"].get(rid)
    im = layer(r["icon"][0], r["icon"][1], r["icon"][2] + ".webp") if r else None
    S, pad = 96, 10
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    if im is None:
        return out
    x0, y0, x1, y1 = bounds(im)
    bw, bh = x1 - x0, y1 - y0
    k = min((S - 2 * pad) / bw, (S - 2 * pad) / bh)
    part = im.crop((x0, y0, x1, y1)).resize((max(1, round(bw * k)), max(1, round(bh * k))),
                                           Image.NEAREST if im.width <= 200 and k > 1 else Image.LANCZOS)
    if len(r["icon"]) > 3 and r["icon"][3] == "gray":
        part = gray(part)
    art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    art.alpha_composite(part, ((S - part.width) // 2, (S - part.height) // 2))
    edge = art.getchannel("A").filter(ImageFilter.MaxFilter(7))
    out.paste((255, 255, 255, 255), (0, 0), edge)
    out.alpha_composite(art)
    return out


def radial(size, centre, radius, stops):
    """A radial gradient layer: stops are (position 0..1, (r, g, b, a))."""
    w, h = size
    k = 4
    small = Image.new("RGBA", (w // k, h // k))
    px = small.load()
    for y in range(h // k):
        for x in range(w // k):
            t = min(1.0, math.hypot(x * k - centre[0], y * k - centre[1]) / radius)
            for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
                if t <= p1:
                    u = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                    px[x, y] = tuple(round(c0[i] + (c1[i] - c0[i]) * u) for i in range(4))
                    break
    return small.resize(size, Image.BILINEAR)


def set_line(relic_ids):
    n = {}
    for rid in set(relic_ids):
        for s in SPEC["relics"].get(rid, {}).get("set", []):
            n[s] = n.get(s, 0) + 1
    if "webring" in relic_ids:
        n = {k: v + 1 for k, v in n.items()}
    on = [(s["name"], n[s["id"]]) for s in SPEC["sets"] if n.get(s["id"], 0) >= s["min"]]
    return "  ".join("%s %d" % (name, c) for name, c in sorted(on, key=lambda x: -x[1])).lower()


def render(run, seed="x"):
    """run: name, score, day, win, bosses, kills, cult, heat, tribe, relics [[id, tier]], look, daily, seed, handle."""
    rng = random.Random(seed)
    W, H = 1200, 630
    cv = Image.new("RGB", (W, H), (0, 0, 0))  # RGB, so translucent fills blend instead of replacing pixels
    over(cv, radial((W, H), (250, 300), 520, [(0, CYAN + (51,)), (1, CYAN + (0,))]))
    d = ImageDraw.Draw(cv, "RGBA")
    for _ in range(120):
        x, y = rng.random() * W, rng.random() * H
        d.rectangle((x, y, x + 2, y + 2), fill=CYAN + (round(255 * (0.15 + rng.random() * 0.5)),))
    for x, y, dx, dy in ((18, 18, 1, 1), (1182, 18, -1, 1), (18, 612, 1, -1), (1182, 612, -1, -1)):  # the site's corner brackets
        d.line([(x + dx * 40, y), (x, y), (x, y + dy * 40)], fill=CYAN + (128,), width=2)

    # the character, as a hologram
    panel = Image.new("RGB", (400, 500), (1, 5, 6))
    over(panel, radial((400, 500), (200, 230), 330, [(0, CYAN + (87,)), (0.55, CYAN + (26,)), (1, CYAN + (5,))]))
    relic_ids = [r[0] for r in run["relics"]]
    who = compose(run.get("look"), relic_ids)
    if (run.get("look") or {}).get("ps1"):  # booted up a MiladyStation this run
        who = ps1(who)
    if cheese(relic_ids) >= 2:  # CHEESEWORLD builds get deep fried
        who = fry(who, "", rng)
    if not run["win"]:
        who = fry(who, "CANCELLED", rng)
    over(panel, who.resize((400, 500), Image.LANCZOS))
    pd = ImageDraw.Draw(panel, "RGBA")
    for y in range(0, 500, 4):
        pd.rectangle((0, y, 400, y + 1), fill=(0, 0, 0, 41))  # scanlines
    clip = Image.new("L", (400, 500), 0)
    ImageDraw.Draw(clip).rounded_rectangle((0, 0, 399, 499), 12, fill=255)
    cv.paste(panel, (50, 60), clip)
    d.rounded_rectangle((50, 60, 450, 560), 12, outline=CYAN + (153,), width=2)

    def text(t, x, y, px, color, weight="Bold"):
        d.text((x, y), t, font=font(px, weight), fill=color, anchor="ls")

    # the title glows
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    f50 = font(50)
    off = gd.textlength("the cancel ", font=f50)
    gd.text((500, 108), "the cancel", font=f50, fill=CYAN + (180,), anchor="ls")
    gd.text((500 + off, 108), "is coming_", font=f50, fill=CYAN + (180,), anchor="ls")
    over(cv, glow.filter(ImageFilter.GaussianBlur(9)))
    d = ImageDraw.Draw(cv, "RGBA")
    text("the cancel", 500, 108, 50, "#fff")
    text("is coming_", 500 + off, 108, 50, "#8be9fd")

    tribe = SPEC["tribes"].get(run["tribe"], "")
    where = " · daily " + run["daily"] if run.get("daily") else " · map " + run["seed"] if run.get("seed") else ""
    line = (run["name"] + " · " + tribe + (" · heat %d" % run["heat"] if run["heat"] else "") + where).lower()
    f24 = font(24, "Regular")
    while d.textlength(line, font=f24) > 660 and len(line) > 10:
        line = line[:-2].rstrip() + "…"
    text(line, 500, 156, 24, "#bdbdbd", "Regular")
    text("timeline saved" if run["win"] else "cancelled on day %d" % run["day"], 500, 240, 44, "#50fa7b" if run["win"] else "#ff5555")
    stats = "%d / 3 bosses  ·  %d kills" % (run["bosses"], run["kills"]) + ("  ·  %d $CULT" % run["cult"] if run.get("cult") is not None else "")
    text(stats, 500, 288, 24, "#eaeaea", "Regular")
    text("DRIP", 500, 366, 18, "#666")
    text(str(run["score"]), 500, 438, 76, "#f1fa8c")
    sets = set_line(relic_ids)
    if sets:
        text(sets, 720, 420, 20, "#bd93f9", "Regular")

    n = len(relic_ids)
    step = 92 if n <= 7 else (1150 - 500 - 82) / (n - 1)
    for i, rid in enumerate(relic_ids):
        x, y = round(500 + i * step), 470
        d.rounded_rectangle((x, y, x + 82, y + 82), 8, fill=(6, 9, 11, 255),
                            outline=RARITY.get(SPEC["relics"].get(rid, {}).get("rar"), CYAN + (77,)), width=2)
        over(cv, icon(rid).resize((72, 72), Image.LANCZOS), (x + 5, y + 5))
        d = ImageDraw.Draw(cv, "RGBA")
        tier = run["relics"][i][1]
        if tier > 1:  # gold and diamond items carry their tier
            d.rounded_rectangle((x + 50, y - 8, x + 88, y + 12), 4, fill=(241, 250, 140, 255) if tier == 2 else (159, 243, 255, 255))
            d.text((x + 69, y + 2), "x2" if tier == 2 else "x4", font=font(14), fill="#111", anchor="mm")
    text("CANCEL.TYLERIRL.COM" + ("   ✓ ~" + run["handle"].lstrip("~") if run.get("handle") else ""), 500, 598, 16, "#666", "Regular")

    out = io.BytesIO()
    cv.save(out, "PNG", compress_level=6)  # "optimize" doubles the drawing time for a few kilobytes
    return out.getvalue()


if __name__ == "__main__":  # python3 server/card.py run.json out.png
    import sys
    with open(sys.argv[1], encoding="utf8") as f:
        png = render(json.load(f))
    with open(sys.argv[2], "wb") as f:
        f.write(png)
    print(len(png), "bytes")
