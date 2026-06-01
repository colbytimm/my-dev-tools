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


def add_pills(svg, fill=None, stroke=None, radius=4, padx=11, pady=5):
    # Real shape groups, in document order: (key, start, class_attr).
    shapes = []
    for m in GROUP.finditer(svg):
        key = decode_key(m.group(1))
        if key is not None:
            shapes.append((key, m.start(), m.group(1)))
    keys = [k for k, _, _ in shapes]

    def is_container(k):
        return any(o != k and o.startswith(k + ".") for o in keys)

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
            x = float(attr(r'\bx="([-\d.]+)"', tel))
            y = float(attr(r'\by="([-\d.]+)"', tel))
        except (TypeError, ValueError):
            continue
        fs = float(attr(r"font-size:(\d+(?:\.\d+)?)", tel, "16"))
        anchor = attr(r"text-anchor:(\w+)", tel, "start")
        label = re.sub(r"<[^>]+>", "", tel)

        # Pill colors: explicit override, else the container's own rect fill/stroke.
        rect_tag = span[: tm.start()]
        pill_fill = fill or attr(r'<rect[^>]*\bfill="([^"]+)"', rect_tag) or "#FFFFFF"
        pill_stroke = stroke or attr(r'<rect[^>]*\bstroke="([^"]+)"', rect_tag) or "#888888"

        w = len(label) * fs * 0.58 + 2 * padx
        h = fs * 1.25 + 2 * pady
        if anchor == "middle":
            rx = x - w / 2
        elif anchor == "end":
            rx = x - w + padx
        else:
            rx = x - padx
        ry = y - fs * 0.82 - pady

        rect = (
            f'<rect x="{rx:.1f}" y="{ry:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'rx="{radius}" fill="{pill_fill}" stroke="{pill_stroke}" stroke-width="1.5"/>'
        )
        pills.append(rect + tel)

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
