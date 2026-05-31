#!/usr/bin/env python3
"""Annotate an image from a JSON spec.

Primitives: box, ellipse, arrow, link (labeled connector), text, callout
(text bubble with leader line), highlight (translucent fill), redact (blur/blackout).

Coordinates may be absolute, or relative to a panel from a compose manifest:
give a primitive `"panel": N` and its coordinates are offset by that panel's
(x, y). This lets annotations target "the left screenshot" without arithmetic.
"""
import argparse
import json
import math
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

COLORS = {  # a few friendly names beyond Pillow's set
    "red": "#e02424", "blue": "#2563eb", "green": "#059669",
    "amber": "#d97706", "purple": "#7c3aed", "black": "#111827",
}


def col(c):
    return COLORS.get(c, c)


def load_font(size, bold=True):
    names = (["DejaVuSans-Bold.ttf"] if bold else ["DejaVuSans.ttf"]) + ["Arial.ttf"]
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def offset_for(spec_item, panels):
    p = spec_item.get("panel")
    if p is None:
        return 0, 0
    if p < 0 or p >= len(panels):
        sys.exit(f"panel {p} out of range (have {len(panels)})")
    return panels[p]["x"], panels[p]["y"]


def shift(coords, dx, dy):
    """Shift a flat [x,y,x,y,...] list by (dx,dy)."""
    return [v + (dx if i % 2 == 0 else dy) for i, v in enumerate(coords)]


def draw_arrowhead(d, x1, y1, x2, y2, color, width):
    ang = math.atan2(y2 - y1, x2 - x1)
    h = max(12, width * 3.5)
    for s in (math.pi / 7, -math.pi / 7):
        d.line([x2, y2, x2 - h * math.cos(ang + s), y2 - h * math.sin(ang + s)],
               fill=color, width=width)


def rounded(d, box, radius, **kw):
    d.rounded_rectangle(box, radius=radius, **kw)


def render(img, spec, panels):
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    for a in spec:
        dx, dy = offset_for(a, panels)
        c = col(a.get("color", "red"))
        w = a.get("width", 4)
        t = a["type"]

        if t == "box":
            d.rectangle(shift(a["xy"], dx, dy), outline=c, width=w)

        elif t == "ellipse":
            d.ellipse(shift(a["xy"], dx, dy), outline=c, width=w)

        elif t == "highlight":
            x0, y0, x1, y1 = shift(a["xy"], dx, dy)
            alpha = a.get("alpha", 70)
            fill = ImageColor_rgba(c, alpha)
            d.rectangle([x0, y0, x1, y1], fill=fill)

        elif t == "redact":
            x0, y0, x1, y1 = [int(v) for v in shift(a["xy"], dx, dy)]
            region = base.crop((x0, y0, x1, y1))
            if a.get("mode", "blur") == "blackout":
                region = Image.new("RGBA", region.size, (17, 24, 39, 255))
            else:
                region = region.filter(ImageFilter.GaussianBlur(a.get("radius", 12)))
            base.paste(region, (x0, y0))

        elif t == "arrow":
            x1, y1 = a["from"]; x2, y2 = a["to"]
            x1, y1, x2, y2 = x1 + dx, y1 + dy, x2 + dx, y2 + dy
            d.line([x1, y1, x2, y2], fill=c, width=w)
            draw_arrowhead(d, x1, y1, x2, y2, c, w)

        elif t == "link":
            # double-headed connector with an optional mid label; good for
            # "this value matches that value" comparisons.
            x1, y1 = a["from"]; x2, y2 = a["to"]
            x1, y1, x2, y2 = x1 + dx, y1 + dy, x2 + dx, y2 + dy
            d.line([x1, y1, x2, y2], fill=c, width=w)
            draw_arrowhead(d, x2, y2, x1, y1, c, w)
            draw_arrowhead(d, x1, y1, x2, y2, c, w)
            if a.get("label"):
                f = load_font(a.get("size", 22))
                mx, my = (x1 + x2) / 2, (y1 + y2) / 2
                tb = d.textbbox((0, 0), a["label"], font=f)
                tw, th = tb[2] - tb[0], tb[3] - tb[1]
                pad = 6
                rounded(d, [mx - tw / 2 - pad, my - th / 2 - pad,
                            mx + tw / 2 + pad, my + th / 2 + pad],
                        8, fill=ImageColor_rgba(c, 235))
                d.text((mx - tw / 2, my - th / 2 - 2), a["label"], fill="white", font=f)

        elif t == "text":
            f = load_font(a.get("size", 24))
            x, y = a["xy"][0] + dx, a["xy"][1] + dy
            if a.get("bg"):
                tb = d.textbbox((x, y), a["text"], font=f)
                pad = a.get("pad", 6)
                rounded(d, [tb[0] - pad, tb[1] - pad, tb[2] + pad, tb[3] + pad],
                        8, fill=col(a["bg"]))
            d.text((x, y), a["text"], fill=c, font=f)

        elif t == "callout":
            # bubble at xy with a leader line pointing to `target`
            f = load_font(a.get("size", 22))
            bx, by = a["xy"][0] + dx, a["xy"][1] + dy
            lines = a["text"].split("\n")
            tw = max(d.textbbox((0, 0), ln, font=f)[2] for ln in lines)
            lh = d.textbbox((0, 0), "Ag", font=f)[3]
            th = lh * len(lines)
            pad = 10
            box = [bx, by, bx + tw + 2 * pad, by + th + 2 * pad]
            if a.get("target"):
                tx, ty = a["target"][0] + dx, a["target"][1] + dy
                d.line([bx + (tw + 2 * pad) / 2, by + (th + 2 * pad) / 2, tx, ty],
                       fill=c, width=w)
            rounded(d, box, 10, fill="white", outline=c, width=w)
            for i, ln in enumerate(lines):
                d.text((bx + pad, by + pad + i * lh), ln, fill=col(a.get("text_color", "black")), font=f)

        else:
            sys.exit(f"unknown annotation type: {t}")

    return Image.alpha_composite(base, overlay)


def ImageColor_rgba(c, alpha):
    from PIL import ImageColor
    r, g, b = ImageColor.getrgb(c)
    return (r, g, b, alpha)


def main():
    p = argparse.ArgumentParser(description="Annotate an image from a JSON spec.")
    p.add_argument("image")
    p.add_argument("-o", "--out", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--spec", help="path to JSON spec file")
    g.add_argument("--spec-json", help="inline JSON spec string")
    p.add_argument("--manifest", help="compose manifest for panel-relative coords")
    a = p.parse_args()

    spec = json.loads(a.spec_json) if a.spec_json else json.load(open(a.spec))
    if isinstance(spec, dict):
        spec = spec.get("annotations", [])
    panels = []
    if a.manifest:
        panels = json.load(open(a.manifest)).get("panels", [])

    img = Image.open(a.image)
    out = render(img, spec, panels)
    if a.out.lower().endswith((".jpg", ".jpeg")):
        out.convert("RGB").save(a.out)
    else:
        out.save(a.out)
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
