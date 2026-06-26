#!/usr/bin/env python3
"""Compose multiple images into a side-by-side, stacked, or grid layout.

Emits the composited image plus an optional JSON manifest describing where
each source image (panel) was placed in the output coordinate space. That
manifest lets a downstream annotation step target a specific panel without
guessing pixel offsets.
"""
import argparse
import json
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (255, 255, 255, 255)


def load_font(size):
    for name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "Helvetica.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def text_size(draw, text, font):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    return r - l, b - t


def add_label(img, text, label_h, font, bg, fg):
    """Return a new image with a label bar across the top."""
    out = Image.new("RGBA", (img.width, img.height + label_h), bg)
    d = ImageDraw.Draw(out)
    tw, th = text_size(d, text, font)
    d.text(((img.width - tw) // 2, (label_h - th) // 2 - 2), text, fill=fg, font=font)
    out.paste(img, (0, label_h), img if img.mode == "RGBA" else None)
    return out


def normalize(imgs, mode):
    """Match dimension along the perpendicular axis so panels align cleanly."""
    if mode == "horizontal":  # match heights
        target = max(i.height for i in imgs)
        return [i if i.height == target else
                i.resize((round(i.width * target / i.height), target)) for i in imgs]
    if mode == "vertical":  # match widths
        target = max(i.width for i in imgs)
        return [i if i.width == target else
                i.resize((target, round(i.height * target / i.width))) for i in imgs]
    return imgs  # grid: leave as-is, panels placed in fixed cells


def compose(imgs, layout, gap, gap_color, cols, content_offset=0):
    """content_offset = height of any label bar added on top of each source
    image. Panel (x, y) is reported at the *content* origin (below the label),
    so coordinates measured in the original screenshot map directly via
    "panel": N in the annotate step."""
    panels = []  # (x, y, w, h): content area of each source image in output space

    if layout in ("horizontal", "vertical"):
        imgs = normalize(imgs, layout)
        if layout == "horizontal":
            h = max(i.height for i in imgs)
            w = sum(i.width for i in imgs) + gap * (len(imgs) - 1)
            canvas = Image.new("RGBA", (w, h), gap_color)
            x = 0
            for im in imgs:
                canvas.alpha_composite(im, (x, 0))
                panels.append((x, content_offset,
                               im.width, im.height - content_offset))
                x += im.width + gap
        else:
            w = max(i.width for i in imgs)
            h = sum(i.height for i in imgs) + gap * (len(imgs) - 1)
            canvas = Image.new("RGBA", (w, h), gap_color)
            y = 0
            for im in imgs:
                canvas.alpha_composite(im, (0, y))
                panels.append((0, y + content_offset,
                               im.width, im.height - content_offset))
                y += im.height + gap

    elif layout == "grid":
        cols = cols or max(1, round(len(imgs) ** 0.5))
        rows = -(-len(imgs) // cols)  # ceil
        cw = max(i.width for i in imgs)
        ch = max(i.height for i in imgs)
        w = cw * cols + gap * (cols - 1)
        h = ch * rows + gap * (rows - 1)
        canvas = Image.new("RGBA", (w, h), gap_color)
        for idx, im in enumerate(imgs):
            r, c = divmod(idx, cols)
            x = c * (cw + gap) + (cw - im.width) // 2
            y = r * (ch + gap) + (ch - im.height) // 2
            canvas.alpha_composite(im, (x, y))
            panels.append((x, y + content_offset,
                           im.width, im.height - content_offset))
    else:
        raise ValueError(f"unknown layout: {layout}")

    return canvas, panels


def main():
    p = argparse.ArgumentParser(description="Compose images into a layout.")
    p.add_argument("images", nargs="+", help="input image paths")
    p.add_argument("-o", "--out", required=True, help="output image path")
    p.add_argument("--layout", default="horizontal",
                   choices=["horizontal", "vertical", "grid"])
    p.add_argument("--cols", type=int, help="columns for grid layout")
    p.add_argument("--gap", type=int, default=24, help="pixels between panels")
    p.add_argument("--gap-color", default="white", help="color of gap/background")
    p.add_argument("--labels", help="comma-separated label per image")
    p.add_argument("--label-height", type=int, default=44)
    p.add_argument("--label-bg", default="#1f2937", help="label bar color")
    p.add_argument("--label-fg", default="white", help="label text color")
    p.add_argument("--label-size", type=int, default=22)
    p.add_argument("--manifest", help="write panel-position JSON here")
    a = p.parse_args()

    imgs = [Image.open(p_).convert("RGBA") for p_ in a.images]

    content_offset = 0
    if a.labels:
        labels = a.labels.split(",")
        if len(labels) != len(imgs):
            sys.exit(f"got {len(imgs)} images but {len(labels)} labels")
        font = load_font(a.label_size)
        imgs = [add_label(im, lab.strip(), a.label_height, font, a.label_bg, a.label_fg)
                for im, lab in zip(imgs, labels)]
        content_offset = a.label_height

    canvas, panels = compose(imgs, a.layout, a.gap, a.gap_color, a.cols,
                             content_offset)
    canvas.convert("RGB").save(a.out) if a.out.lower().endswith((".jpg", ".jpeg")) \
        else canvas.save(a.out)

    manifest = {
        "output": a.out,
        "size": [canvas.width, canvas.height],
        "layout": a.layout,
        "panels": [
            {"index": i, "label": (a.labels.split(",")[i].strip() if a.labels else None),
             "x": x, "y": y, "w": w, "h": h}
            for i, (x, y, w, h) in enumerate(panels)
        ],
    }
    if a.manifest:
        with open(a.manifest, "w") as f:
            json.dump(manifest, f, indent=2)
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
