---
name: image-annotate
description: Draw annotations on an image (boxes, arrows, labeled connectors,
  callout bubbles, text, highlights, blur/blackout redaction) from a JSON spec.
  Coordinates can be absolute or relative to a panel from an image-compose
  manifest. Use to mark up screenshots — highlight a field, point at a region,
  link matching values across a comparison, label which page a capture is from,
  or redact sensitive data. Pairs with image-compose.
---

# Image Annotate

Render annotations onto an image from a JSON spec. Works on any image; when
given a compose manifest, annotations can target a specific panel with
`"panel": N` and their coordinates are auto-offset into that panel.

## Usage

```bash
python scripts/annotate.py IMAGE -o OUTPUT.png \
  (--spec spec.json | --spec-json '[...]') [--manifest layout.json]
```

- `--spec PATH` — JSON file containing the annotation list
- `--spec-json '...'` — inline JSON (handy for one-offs)
- `--manifest PATH` — compose manifest enabling `"panel": N` coordinates

The spec is a JSON array of annotation objects (or `{"annotations":[...]}`).

## Annotation types

Every type accepts optional `"panel": N` (offset into that panel) and `"color"`.
Named colors include red, blue, green, amber, purple, black, plus any CSS hex/name.

|type       |required fields         |notes                                                                            |
|-----------|------------------------|---------------------------------------------------------------------------------|
|`box`      |`xy:[x0,y0,x1,y1]`      |rectangle outline; `width`                                                       |
|`ellipse`  |`xy:[x0,y0,x1,y1]`      |oval outline; `width`                                                            |
|`arrow`    |`from:[x,y]`, `to:[x,y]`|single-headed; `width`                                                           |
|`link`     |`from:[x,y]`, `to:[x,y]`|double-headed connector; optional `label`, `size` — use for “these match”        |
|`text`     |`xy:[x,y]`, `text`      |optional `bg` (pill), `size`, `pad`                                              |
|`callout`  |`xy:[x,y]`, `text`      |bubble with optional `target:[x,y]` leader line; `\n` for multiline; `text_color`|
|`highlight`|`xy:[x0,y0,x1,y1]`      |translucent fill; `alpha` 0–255                                                  |
|`redact`   |`xy:[x0,y0,x1,y1]`      |`mode:"blur"` (default, `radius`) or `"blackout"`                                |

## Examples

Point at a field and label the page (absolute coords):

```bash
python scripts/annotate.py shot.png -o out.png --spec-json \
'[{"type":"box","xy":[280,255,400,290],"color":"red","width":3},
  {"type":"text","xy":[14,300],"text":"Page: /dashboard","bg":"#fde68a","color":"black","size":16}]'
```

Verify two values match across a composed comparison (panel-relative box on
each, plus a connector in composite-space through the gap):

```bash
python scripts/annotate.py combined.png -o final.png --manifest layout.json --spec-json \
'[{"type":"box","panel":0,"xy":[294,190,395,214],"color":"green","width":3},
  {"type":"box","panel":1,"xy":[294,190,395,214],"color":"green","width":3},
  {"type":"text","xy":[540,256],"text":"match","color":"white","bg":"green","size":17}]'
```

Redact a sensitive field:

```bash
python scripts/annotate.py shot.png -o out.png --spec-json \
'[{"type":"redact","xy":[100,200,400,240],"mode":"blur","radius":14}]'
```

## Coordinate tip

Coordinates are either **composite-space** (omit `panel` — origin at the
top-left of the whole merged image; use for things in the gap between panels,
like a connector linking two values) or **panel-relative** (`"panel": N` —
origin at that panel’s content area, so you pass coordinates exactly as
measured in the original screenshot, even when compose added a label bar).

Don’t guess pixel values. If your agent browser can return element bounding
boxes (Playwright `element.bounding_box()`, DOM `getBoundingClientRect()`),
feed those straight into `xy`/`from`/`to` with the matching `"panel"`. If you
only have a rendered image, measure the target’s real box before placing
annotations — eyeballed coordinates will miss.

## Requirements

`pip install Pillow`
