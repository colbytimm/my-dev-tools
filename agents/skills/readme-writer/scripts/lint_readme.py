#!/usr/bin/env python3
"""Lint a README for markdown best practices and generated-sounding writing.

Usage: python lint_readme.py README.md [--strict]

Exit codes: 0 clean (or warnings only), 1 errors found (warnings count as
errors with --strict). Stdlib only.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

BANNED_WORDS = {
    # marketing adjectives
    "blazingly", "blazing-fast", "cutting-edge", "state-of-the-art",
    "game-changing", "next-generation", "enterprise-grade", "supercharged",
    "production-ready", "world-class", "best-in-class",
    # AI vocabulary
    "delve", "delves", "delving", "leverage", "leverages", "leveraging",
    "utilize", "utilizes", "utilizing", "streamline", "streamlines",
    "streamlining", "empower", "empowers", "empowering", "foster",
    "fosters", "fostering", "harness", "harnesses", "harnessing",
    "elevate", "elevates", "unlock", "unlocks", "effortless",
    "effortlessly", "seamless", "seamlessly", "robust", "holistic",
    "pivotal", "crucial", "tapestry", "testament", "intricate",
}
# flagged only when describing the project, so warn not error
SOFT_WORDS = {"powerful", "comprehensive", "elegant", "intuitive", "lightweight",
              "simple", "easy", "flexible", "modern", "ecosystem", "landscape",
              "journey", "vital", "enhance", "enhances", "enhanced"}

SUMMARY_OPENERS = re.compile(
    r"^\s*(In conclusion|In summary|To summarize|Overall),", re.I)
NEG_PARALLEL = re.compile(
    r"\b(?:is|it'?s)\s+not\s+(?:just|merely|simply)\b.{0,80}?\b(?:it'?s|but)\b", re.I)
EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\u2B00-\u2BFF\uFE0F]")
SEMANTIC_EMOJI = {"\u2705", "\u274c", "\u26a0", "\u26a0\ufe0f"}  # ✅ ❌ ⚠
TERM_BULLET = re.compile(r"^\s*[-*]\s+\*\*[^*]+:?\*\*:?\s")
WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")


def lint(path: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warns: list[str] = []
    lines = path.read_text(encoding="utf-8").splitlines()

    in_fence = False
    fence_marker = ""
    h1_count = 0
    prev_level = 0
    list_lengths: list[int] = []
    cur_list = 0
    term_bullet_run = 0

    def err(n: int, rule: str, msg: str) -> None:
        errors.append(f"{path}:{n}: error [{rule}] {msg}")

    def warn(n: int, rule: str, msg: str) -> None:
        warns.append(f"{path}:{n}: warn  [{rule}] {msg}")

    for i, line in enumerate(lines, 1):
        stripped = line.strip()

        # code fences
        m = re.match(r"^(```+|~~~+)(.*)$", stripped)
        if m:
            if not in_fence:
                in_fence, fence_marker = True, m.group(1)[0] * 3
                if not m.group(2).strip():
                    warn(i, "fence-lang", "code fence has no language tag")
            elif stripped.startswith(fence_marker):
                in_fence = False
            continue
        if in_fence:
            continue

        # headings
        hm = re.match(r"^(#{1,6})\s+(.*)$", line)
        if hm:
            level, text = len(hm.group(1)), hm.group(2)
            if level == 1:
                h1_count += 1
                if h1_count > 1:
                    warn(i, "single-h1", "more than one top-level heading")
            if prev_level and level > prev_level + 1:
                err(i, "heading-jump",
                    f"heading level jumps from h{prev_level} to h{level}")
            prev_level = level
            if EMOJI.search(text):
                err(i, "emoji-header", f"emoji in heading: {text!r}")

        # list bookkeeping (rule-of-threes + term-bullet walls)
        if re.match(r"^\s*([-*+]|\d+\.)\s+\S", line):
            cur_list += 1
            if TERM_BULLET.match(line):
                term_bullet_run += 1
                if term_bullet_run == 4:
                    warn(i, "term-bullets",
                         "4+ consecutive '**Term:** definition' bullets; "
                         "write sentences with concrete claims instead")
            else:
                term_bullet_run = 0
        else:
            if cur_list:
                list_lengths.append(cur_list)
            cur_list = 0
            term_bullet_run = 0

        # prose checks
        if "\u2014" in line:
            err(i, "em-dash", "em dash; use a comma, parentheses, or a period")
        if SUMMARY_OPENERS.search(stripped):
            err(i, "summary-opener", f"compulsive summary opener: {stripped[:40]!r}")
        if NEG_PARALLEL.search(line):
            warn(i, "neg-parallel", "negative parallelism ('not just X, it's Y'); say what it is")
        for em in EMOJI.findall(line):
            if em not in SEMANTIC_EMOJI:
                err(i, "emoji", f"decorative emoji {em!r}; allowed only as "
                    "semantic markers (e.g. \u2705/\u274c in a support table)")
            elif "|" not in line:
                warn(i, "emoji-context", f"{em!r} outside a table; confirm it carries meaning")
        for w in WORD.findall(line):
            lw = w.lower()
            if lw in BANNED_WORDS:
                err(i, "banned-word", f"{w!r}; replace with the fact that justifies it")
            elif lw in SOFT_WORDS:
                warn(i, "soft-word", f"{w!r}; fine if backed by evidence nearby, else cut")

    if cur_list:
        list_lengths.append(cur_list)
    threes = [n for n in list_lengths if n == 3]
    if len(list_lengths) >= 3 and len(threes) == len(list_lengths):
        warns.append(f"{path}: warn  [rule-of-threes] every list has exactly 3 "
                     "items; lists should be their natural length")
    if h1_count == 0:
        errors.append(f"{path}: error [no-h1] missing top-level '#' title")

    # relative links/images must resolve
    text = "\n".join(lines)
    for m in re.finditer(r"!?\[[^\]]*\]\(([^)\s#]+)[^)]*\)", text):
        target = m.group(1)
        if "://" in target or target.startswith(("mailto:", "#", "<")):
            continue
        if not (path.parent / target).exists():
            n = text[: m.start()].count("\n") + 1
            warns.append(f"{path}:{n}: warn  [dead-link] relative path "
                         f"{target!r} does not exist")
    return errors, warns


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=Path)
    ap.add_argument("--strict", action="store_true",
                    help="treat warnings as errors")
    args = ap.parse_args()
    if not args.file.exists():
        print(f"{args.file}: not found", file=sys.stderr)
        return 2
    errors, warns = lint(args.file)
    for line in errors + warns:
        print(line)
    print(f"\n{len(errors)} error(s), {len(warns)} warning(s)")
    return 1 if errors or (args.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())
