---
name: image-compose
description: Combine multiple images (e.g. web screenshots) into a side-by-side,
  stacked, or grid layout for visual comparison. Adds optional title bars per
  panel and emits a JSON manifest of panel positions. Use when comparing two or
  more captures — before/after upgrades, computed-vs-reference values, A/B states
  — or any time several images need to sit in one frame. Pairs with image-annotate.
license: MIT
---

# Image Compose

Lay out several images into one composite. Outputs the merged image and,
optionally, a manifest describing where each source image (panel) landed —
feed that manifest to `image-annotate` to draw on a specific panel without
computing pixel offsets by hand.

## Usage

```bash
python scripts/compose.py IMG1 IMG2 [IMG3 ...] -o OUTPUT.png [options]
```

### Options

- `--layout horizontal|vertical|grid`  (default: horizontal)
- `--cols N`  columns when layout is grid (default: ~square)
- `--gap PIXELS`  spacing between panels (default: 24)
- `--gap-color COLOR`  background/gap fill (default: white)
- `--labels "A,B,..."`  one title per image, comma-separated, in order
- `--label-bg`, `--label-fg`, `--label-size`, `--label-height`  label bar styling
- `--manifest PATH`  write panel-position JSON (pass this to image-annotate)

`horizontal` matches panel heights; `vertical` matches widths; `grid` centers
each image in equal cells. JPEG output is auto-flattened.

## Examples

Two screenshots side by side with titles, saving a manifest:

```bash
python scripts/compose.py before.png after.png \
  --layout horizontal --gap 30 --labels "Before,After" \
  --manifest layout.json -o combined.png
```

Four captures in a 2-column grid:

```bash
python scripts/compose.py a.png b.png c.png d.png \
  --layout grid --cols 2 -o grid.png
```

## Manifest format

```json
{"output":"combined.png","size":[870,344],"layout":"horizontal",
 "panels":[{"index":0,"label":"Before","x":0,"y":44,"w":420,"h":300},
           {"index":1,"label":"After","x":450,"y":44,"w":420,"h":300}]}
```

Panel `x,y` is the top-left of that image’s **content area** inside the
composite — i.e. below its label bar if one was added. This means a coordinate
you measured in the *original* screenshot maps directly: `image-annotate`
resolves `"panel": N` by adding this `x,y`, so no need to compensate for label
height yourself. `w,h` describe the content region (excluding the label bar).

## Requirements

`pip install Pillow`
