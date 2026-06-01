#!/usr/bin/env python3
"""Render, validate, and format d2 diagrams, and embed them into markdown.

A thin wrapper around the `d2` CLI (https://d2lang.com). SVG is the default
output and has no dependencies. PNG/PDF output makes `d2` spin up a headless
Chromium (downloaded on first use); when that browser is unavailable (e.g. on a
restricted network) this script falls back to emitting SVG and tells you how to
enable raster output, rather than crashing.

Examples
--------
    # Render to SVG (output path derived from input)
    python scripts/render.py examples/software-arch.d2

    # Render to PNG with a theme + the ELK layout engine
    python scripts/render.py examples/aws-arch.d2 --format png --theme 1 --layout elk

    # Validate / autoformat
    python scripts/render.py examples/aws-arch.d2 --validate
    python scripts/render.py examples/aws-arch.d2 --fmt

    # Render and embed (or update) the image in a markdown file
    python scripts/render.py examples/software-arch.d2 --md README.md --md-marker arch

Requires the `d2` CLI on PATH:
    curl -fsSL https://d2lang.com/install.sh | sh -s --
    # or: brew install d2   |   go install oss.terrastruct.com/d2@latest
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# title_pills lives alongside this script.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import title_pills  # noqa: E402

PRESETS_PATH = Path(__file__).resolve().parent.parent / "assets" / "themes.json"


def load_presets():
    try:
        return json.loads(PRESETS_PATH.read_text(encoding="utf-8")).get("presets", {})
    except (OSError, ValueError):
        return {}


def apply_preset(args, name):
    """Fill unset render options from a named preset (explicit CLI flags win)."""
    presets = load_presets()
    if name not in presets:
        sys.exit(
            f"unknown preset '{name}'. Available: {', '.join(sorted(presets)) or '(none)'}"
        )
    p = presets[name]
    for opt in ("theme", "dark_theme", "layout", "pad", "elk_node_spacing"):
        if getattr(args, opt, None) is None and opt in p:
            setattr(args, opt, p[opt])
    for flag in ("sketch", "title_pills"):
        if p.get(flag):
            setattr(args, flag, True)

INSTALL_HINT = (
    "d2 CLI not found on PATH. Install it with one of:\n"
    "  curl -fsSL https://d2lang.com/install.sh | sh -s --\n"
    "  brew install d2\n"
    "  go install oss.terrastruct.com/d2@latest\n"
    "Docs: https://d2lang.com/tour/install/"
)

# Substrings that indicate PNG/PDF export failed because the headless browser
# could not be launched/downloaded (as opposed to a real diagram error).
BROWSER_ERROR_HINTS = (
    "chromium",
    "playwright",
    "browser",
    "failed to launch",
    "download",
)

# Substring indicating render failed only because remote icon images couldn't be
# fetched and inlined (icon host unreachable at build time). Re-rendering with
# --bundle=false keeps icons as remote refs that load when the SVG is viewed.
BUNDLE_ERROR_HINT = "failed to bundle remote images"


def require_d2():
    if shutil.which("d2") is None:
        sys.exit(INSTALL_HINT)


def run_d2(cmd):
    """Run a d2 subcommand, returning (returncode, combined_output)."""
    proc = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    return proc.returncode, proc.stdout


def build_render_cmd(src: Path, out: Path, args, bundle: bool = True):
    cmd = ["d2"]
    if not bundle:
        cmd += ["--bundle=false"]
    if args.theme is not None:
        cmd += ["--theme", str(args.theme)]
    if args.dark_theme is not None:
        cmd += ["--dark-theme", str(args.dark_theme)]
    if args.layout:
        cmd += ["--layout", args.layout]
    if args.sketch:
        cmd += ["--sketch"]
    if args.pad is not None:
        cmd += ["--pad", str(args.pad)]
    # ELK spacing knobs only apply to the elk engine. They are the main lever for
    # spreading out a cramped diagram so labels stop overlapping lines/icons.
    if args.layout == "elk":
        if args.elk_node_spacing is not None:
            cmd += ["--elk-nodeNodeBetweenLayers", str(args.elk_node_spacing)]
            cmd += ["--elk-edgeNodeBetweenLayers", str(args.elk_node_spacing)]
        if args.elk_padding is not None:
            cmd += ["--elk-padding", args.elk_padding]
    cmd += [str(src), str(out)]
    return cmd


def render(src: Path, args):
    """Render `src`, with graceful SVG fallback for raster formats."""
    fmt = args.format
    out = Path(args.output) if args.output else src.with_suffix(f".{fmt}")
    bundle = not args.no_bundle

    code, output = run_d2(build_render_cmd(src, out, args, bundle=bundle))
    if code == 0:
        print(f"Rendered {src} -> {out}")
        return out

    # Icon bundling can fail purely because the icon host is unreachable at build
    # time. Retry with --bundle=false so icons stay as remote refs (load at view
    # time) instead of failing the whole render.
    if bundle and BUNDLE_ERROR_HINT in output.lower():
        code, output = run_d2(build_render_cmd(src, out, args, bundle=False))
        if code == 0:
            print(
                f"Rendered {src} -> {out}\n"
                "Note: the icon host was unreachable, so icons are kept as remote "
                "references (--bundle=false) and will load when the image is viewed "
                "with network access. Re-render once online for a self-contained file.",
                file=sys.stderr,
            )
            return out

    # Raster export can fail purely because the headless browser is missing.
    if fmt in ("png", "pdf") and any(
        h in output.lower() for h in BROWSER_ERROR_HINTS
    ):
        svg_out = out.with_suffix(".svg")
        svg_code, svg_output = run_d2(
            build_render_cmd(src, svg_out, args, bundle=bundle)
        )
        if svg_code == 0:
            print(output.strip(), file=sys.stderr)
            print(
                f"\n{fmt.upper()} export needs a headless Chromium that isn't "
                f"available here. Fell back to SVG: {svg_out}\n"
                "To enable raster output, ensure d2 can download/launch Chromium "
                "(network access on first PNG/PDF render), then re-run.",
                file=sys.stderr,
            )
            return svg_out

    # Genuine failure (bad diagram, etc.): surface d2's output verbatim.
    print(output.strip(), file=sys.stderr)
    sys.exit(f"d2 failed to render {src} (exit {code}).")


def validate(src: Path):
    code, output = run_d2(["d2", "validate", str(src)])
    if output.strip():
        print(output.strip())
    if code == 0:
        print(f"{src}: valid")
    else:
        sys.exit(f"{src}: invalid (exit {code}).")


def fmt(src: Path):
    code, output = run_d2(["d2", "fmt", str(src)])
    if output.strip():
        print(output.strip())
    if code != 0:
        sys.exit(f"d2 fmt failed on {src} (exit {code}).")
    print(f"Formatted {src}")


def embed_in_markdown(md_path: Path, image_path: Path, marker: str):
    """Insert or replace a marked image block in a markdown file.

    The block is delimited so repeat runs update in place:
        <!-- d2:MARKER -->
        ![MARKER](relative/path)
        <!-- /d2:MARKER -->
    """
    md_path = md_path.resolve()
    # Link the image relative to the markdown file's directory.
    try:
        rel = os.path.relpath(image_path.resolve(), md_path.parent)
    except ValueError:
        rel = str(image_path)
    rel = rel.replace(os.sep, "/")

    block = (
        f"<!-- d2:{marker} -->\n"
        f"![{marker}]({rel})\n"
        f"<!-- /d2:{marker} -->"
    )

    text = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
    pattern = re.compile(
        rf"<!-- d2:{re.escape(marker)} -->.*?<!-- /d2:{re.escape(marker)} -->",
        re.DOTALL,
    )
    if pattern.search(text):
        text = pattern.sub(block, text)
        action = "Updated"
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += ("\n" if text else "") + block + "\n"
        action = "Inserted"

    md_path.write_text(text, encoding="utf-8")
    print(f"{action} diagram block '{marker}' in {md_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Render/validate/format d2 diagrams and embed them in markdown."
    )
    parser.add_argument("input", type=Path, nargs="?", help="path to the .d2 source file")
    parser.add_argument("-o", "--output", help="output path (default: derived from input)")
    parser.add_argument(
        "--preset", help="named render preset from assets/themes.json (e.g. default, "
        "aubergine, c4, dark, sketch). Sets theme/layout/pad/title-pills; explicit "
        "flags still win. Use --list-presets to see them.",
    )
    parser.add_argument(
        "--list-presets", action="store_true", help="list available presets and exit",
    )
    parser.add_argument(
        "--format", choices=["svg", "png", "pdf"], default="svg",
        help="output format (default: svg). png/pdf need a headless Chromium.",
    )
    parser.add_argument("--theme", type=int, help="theme id (see `d2 themes`)")
    parser.add_argument("--dark-theme", type=int, help="dark-mode theme id")
    parser.add_argument(
        "--layout", choices=["dagre", "elk", "tala"],
        help="layout engine. Prefer 'elk' for architecture/flow diagrams: it routes "
             "edges orthogonally and places labels with far less overlap than the "
             "default dagre. (tala needs a separate install.)",
    )
    parser.add_argument(
        "--elk-node-spacing", type=int, metavar="N",
        help="with --layout elk: spacing (px) between nodes and between nodes/edges. "
             "Raise it (e.g. 90-120) to de-clutter a cramped diagram. d2 default 70/40.",
    )
    parser.add_argument(
        "--elk-padding", metavar="SPEC",
        help="with --layout elk: container padding, e.g. \"[top=60,left=50,bottom=50,right=50]\".",
    )
    parser.add_argument("--sketch", action="store_true", help="hand-drawn style")
    parser.add_argument("--pad", type=int, help="padding in pixels around the diagram")
    parser.add_argument(
        "--no-bundle", action="store_true",
        help="keep icons as remote URL refs instead of inlining them (use when "
             "the icon host is unreachable at render time; icons load at view time)",
    )
    parser.add_argument(
        "--title-pills", action="store_true",
        help="SVG only: draw an opaque, bordered pill behind each group/container "
             "title and render it on top of the edges, so routed lines can't draw "
             "over the title. Pills match each container's own fill/border by default.",
    )
    parser.add_argument("--pill-fill", help="with --title-pills: override pill fill color")
    parser.add_argument("--pill-stroke", help="with --title-pills: override pill border color")
    parser.add_argument("--validate", action="store_true", help="validate only, don't render")
    parser.add_argument("--fmt", action="store_true", help="autoformat the .d2 file in place")
    parser.add_argument("--md", type=Path, help="markdown file to embed the rendered image into")
    parser.add_argument(
        "--md-marker", default="diagram",
        help="marker name for the markdown block (default: diagram)",
    )
    args = parser.parse_args()

    if args.list_presets:
        presets = load_presets()
        for name in sorted(presets):
            print(f"{name:14} {json.dumps(presets[name])}")
        return

    if args.preset:
        apply_preset(args, args.preset)

    require_d2()

    if args.input is None:
        sys.exit("an input .d2 file is required (or use --list-presets).")
    if not args.input.exists():
        sys.exit(f"input file not found: {args.input}")

    if args.fmt:
        fmt(args.input)
        return
    if args.validate:
        validate(args.input)
        return

    # Title pills are an SVG-only post-process. If a preset turned them on but a
    # raster format was requested, skip them quietly rather than failing.
    if args.title_pills and args.format != "svg":
        if args.preset:
            args.title_pills = False
        else:
            sys.exit("--title-pills only applies to SVG output; use --format svg.")

    out = render(args.input, args)

    # Post-process the SVG to mask edges behind group titles.
    if args.title_pills and out.suffix == ".svg":
        svg = out.read_text(encoding="utf-8")
        svg, n = title_pills.add_pills(
            svg, fill=args.pill_fill, stroke=args.pill_stroke
        )
        out.write_text(svg, encoding="utf-8")
        print(f"Added {n} title pill(s) to {out}")

    if args.md:
        embed_in_markdown(args.md, out, args.md_marker)


if __name__ == "__main__":
    main()
