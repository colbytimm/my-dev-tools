#!/usr/bin/env python3
"""Add a masking title "pill" behind each group/container label in a d2 SVG.

d2 draws connections *after* shape labels, so a routed edge can pass over a
container's title and make it hard to read. d2 has no native background for a
container label, so this post-processes the SVG: for every grouping container it
draws a filled, rounded rectangle behind the title text and re-appends both at
the end of the document, so the title is rendered on top of the edges with an
opaque background that masks any line behind it.

How it works: d2 encodes each shape's d2 key as the base64 `class` on its
`<g>` (e.g. `dm5ldA==` -> `vnet`). A shape is a *container* when another key
starts with `<key>.`. For each container the title text is found and a pill is
synthesized; pill colors default to the container's own fill/stroke so it reads
as an integrated header.

Usage:
    python scripts/title_pills.py IN.svg [-o OUT.svg] [--fill C] [--stroke C]

Stdlib only. If nothing matches (e.g. a future d2 SVG format), the SVG is copied
through unchanged.
"""

import argparse
import base64
import re
import sys

GROUP = re.compile(r'<g class="([^"]+)">')
TEXT = re.compile(r"<text\b[^>]*>.*?</text>", re.DOTALL)


def decode_key(class_attr):
    """Decode the first class token (base64 d2 key); None if not a shape key."""
    token = class_attr.split()[0]
    try:
        return base64.b64decode(token).decode("utf-8")
    except Exception:
        return None


def attr(pattern, text, default=None):
    m = re.search(pattern, text)
    return m.group(1) if m else default


# Approximate per-character advance width as a fraction of the font size, so the
# pill hugs the text instead of using a flat (over-wide) estimate. Group titles
# are mostly lowercase + digits + punctuation (e.g. "snet-app 10.0.3.0/24").
_NARROW = set(" .,:;'!|iIjl()[]{}/\\-ftr")
_WIDE = set("mwMW")
_UPPER = set("ABCDEFGHKNOPQRSUVXYZ")


def text_width(label, fs):
    total = 0.0
    for ch in label:
        if ch == " ":
            total += 0.27
        elif ch in _NARROW:
            total += 0.30
        elif ch in _WIDE:
            total += 0.82
        elif ch in _UPPER:
            total += 0.62
        else:  # most lowercase + digits
            total += 0.50
    return total * fs


def add_pills(svg, fill=None, stroke=None, radius=4, padx=6, pady=2, inset=7):
    # Real shape groups, in document order: (key, start, class_attr).
    shapes = []
    for m in GROUP.finditer(svg):
        key = decode_key(m.group(1))
        if key is not None:
            shapes.append((key, m.start(), m.group(1)))
    keys = [k for k, _, _ in shapes]

    def is_container(k):
        return any(o != k and o.startswith(k + ".") for o in keys)

    removals = []
    pills = []
    for i, (key, start, _) in enumerate(shapes):
        if not is_container(key):
            continue
        # The container's own markup runs until the next shape group.
        end = shapes[i + 1][1] if i + 1 < len(shapes) else len(svg)
        span = svg[start:end]

        tm = TEXT.search(span)
        if not tm:
            continue
        tel = tm.group(0)
        try:
            tx = float(attr(r'\bx="([-\d.]+)"', tel))
        except (TypeError, ValueError):
            continue
        fs = float(attr(r"font-size:(\d+(?:\.\d+)?)", tel, "16"))
        anchor = attr(r"text-anchor:(\w+)", tel, "start")
        label = re.sub(r"<[^>]+>", "", tel)

        # The container's own box rect (first rect before the label) anchors the pill.
        rect_tag = span[: tm.start()]
        try:
            bx = float(attr(r'<rect[^>]*\bx="([-\d.]+)"', rect_tag))
            by = float(attr(r'<rect[^>]*\by="([-\d.]+)"', rect_tag))
            bw = float(attr(r'<rect[^>]*\bwidth="([-\d.]+)"', rect_tag))
        except (TypeError, ValueError):
            continue  # need the box to place the pill inside it
        pill_fill = fill or attr(r'<rect[^>]*\bfill="([^"]+)"', rect_tag) or "#FFFFFF"
        pill_stroke = stroke or attr(r'<rect[^>]*\bstroke="([^"]+)"', rect_tag) or "#888888"

        w = text_width(label, fs) + 2 * padx
        # Never let the pill exceed the box interior.
        w = min(w, bw - 2 * inset)
        h = fs + 2 * pady
        # Sit the pill just inside the box's top edge.
        py = by + inset
        # Honour the label's horizontal anchor, then clamp fully inside the box.
        if anchor == "middle":
            px = tx - w / 2
        elif anchor == "end":
            px = tx - w
        else:
            px = bx + inset
        px = max(bx + inset, min(px, bx + bw - w - inset))

        # Re-emit the title text vertically centred in the pill.
        new_y = py + h / 2 + fs * 0.34
        if anchor == "middle":
            new_x = px + w / 2
        elif anchor == "end":
            new_x = px + w - padx
        else:
            new_x = px + padx
        new_text = re.sub(r'\bx="[-\d.]+"', f'x="{new_x:.1f}"', tel, count=1)
        new_text = re.sub(r'\by="[-\d.]+"', f'y="{new_y:.1f}"', new_text, count=1)

        rect = (
            f'<rect x="{px:.1f}" y="{py:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'rx="{radius}" fill="{pill_fill}" stroke="{pill_stroke}" stroke-width="1.5"/>'
        )
        removals.append(tel)
        pills.append(rect + new_text)

    # Remove the original (un-masked) titles, then draw the pills on top.
    for tel in removals:
        svg = svg.replace(tel, "", 1)
    if pills:
        svg = svg.replace("</svg>", "".join(pills) + "</svg>", 1)
    return svg, len(pills)


def main():
    p = argparse.ArgumentParser(description="Add masking title pills to a d2 SVG.")
    p.add_argument("input", help="input .svg")
    p.add_argument("-o", "--output", help="output .svg (default: overwrite input)")
    p.add_argument("--fill", help="pill fill color (default: each container's own fill)")
    p.add_argument("--stroke", help="pill border color (default: container's own stroke)")
    p.add_argument("--radius", type=int, default=4, help="corner radius (default 4)")
    args = p.parse_args()

    svg = open(args.input, encoding="utf-8").read()
    out, n = add_pills(svg, fill=args.fill, stroke=args.stroke, radius=args.radius)
    open(args.output or args.input, "w", encoding="utf-8").write(out)
    print(f"added {n} title pill(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
