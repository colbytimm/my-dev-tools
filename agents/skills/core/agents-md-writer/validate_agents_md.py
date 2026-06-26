#!/usr/bin/env python3
"""
validate_agents_md.py — Mechanical checks for an AGENTS.md.

Scope is deliberately narrow: this only measures things a script counts more
reliably than an agent eyeballing the file — line count, reference count, code-block
length, and whether a commands section exists. It does NOT judge content quality
(is this filler? is this 'don't' paired with a 'do'? is the overview a tour?). Those
are judgment calls the agent applying the skill should make by reading the file; a
regex guessing at them gives false confidence, which is worse than no check.

Exit code: 0 normally, 1 if any FAIL (so it can gate CI), 2 on usage error.
WARN does not change the exit code unless --strict is passed.

Usage:
    python validate_agents_md.py path/to/AGENTS.md
    python validate_agents_md.py path/to/AGENTS.md --max-lines 150 --json --strict
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Literal

DEFAULT_MAX_LINES = 150     # skill: "~100-150 lines"
HARD_OVER_RATIO = 2.0       # past 2x, the measured gains reverse
MAX_REFERENCES = 15         # skill: "cap references at ~15"
MAX_SNIPPET_LINES = 10      # skill: "snippets, 3-10 lines"

# Substring match on heading text only — keep it dumb; deciding whether a section is
# *good* is the author's job, not this script's.
COMMAND_HEADING = re.compile(
    r"^#{1,6}\s+.*\b(setup|install|build|test|testing|commands?|getting started|"
    r"dev(?:elopment)? environment|scripts?)\b",
    re.IGNORECASE,
)
MD_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
FENCE = re.compile(r"^\s*```")


@dataclass
class Finding:
    level: Literal["PASS", "WARN", "FAIL"]
    rule: str
    message: str
    detail: list = field(default_factory=list)


def _code_blocks(lines):
    """Return a list of code blocks, each a list of lines (fences excluded)."""
    blocks, cur, in_code = [], [], False
    for ln in lines:
        if FENCE.match(ln):
            if in_code:
                blocks.append(cur); cur = []
            in_code = not in_code
            continue
        if in_code:
            cur.append(ln)
    if cur:
        blocks.append(cur)
    return blocks


def check_line_budget(lines, max_lines):
    n = len(lines)
    hard = int(max_lines * HARD_OVER_RATIO)
    if n > hard:
        return Finding("FAIL", "line-count",
                       f"{n} lines is more than 2x the ~{max_lines}-line target — split into reference files.")
    if n > max_lines:
        return Finding("WARN", "line-count",
                       f"{n} lines exceeds the ~{max_lines}-line target — trim or push depth into references.")
    return Finding("PASS", "line-count", f"{n} lines (target ~{max_lines}).")


def check_commands_present(lines):
    if any(COMMAND_HEADING.match(ln) for ln in lines):
        return Finding("PASS", "commands-section", "A setup/build/test/commands heading is present.")
    return Finding("WARN", "commands-section",
                   "No setup/build/test/commands heading found — this is the highest-value section.")


def check_references(lines):
    refs = []
    in_code = False
    for i, ln in enumerate(lines, 1):
        if FENCE.match(ln):
            in_code = not in_code
            continue
        if in_code:
            continue
        for m in MD_LINK.finditer(ln):
            target = m.group(1)
            if not target.startswith(("http://", "https://", "#", "mailto:")):
                refs.append((i, target))
    if len(refs) > MAX_REFERENCES:
        return Finding("WARN", "reference-count",
                       f"{len(refs)} local references — over the ~{MAX_REFERENCES} ceiling.",
                       detail=[f"line {i}: {t}" for i, t in refs])
    return Finding("PASS", "reference-count", f"{len(refs)} local reference(s) (ceiling ~{MAX_REFERENCES}).")


def check_snippet_length(lines):
    longest = 0
    over = []
    for b in _code_blocks(lines):
        body = sum(1 for x in b if x.strip())
        longest = max(longest, body)
        if body > MAX_SNIPPET_LINES:
            over.append(body)
    if over:
        return Finding("WARN", "snippet-length",
                       f"{len(over)} code block(s) exceed {MAX_SNIPPET_LINES} non-blank lines "
                       f"(longest {max(over)}). If these are example snippets, trim; if they're config "
                       f"the agent copies verbatim, ignore.")
    return Finding("PASS", "snippet-length",
                   f"Longest code block {longest} non-blank line(s) (limit ~{MAX_SNIPPET_LINES}).")


def validate(path: Path, max_lines: int):
    lines = path.read_text(encoding="utf-8").splitlines()
    return [
        check_line_budget(lines, max_lines),
        check_commands_present(lines),
        check_references(lines),
        check_snippet_length(lines),
    ]


def render_text(path, findings) -> str:
    icons = {"PASS": "✓", "WARN": "!", "FAIL": "✗"}
    order = {"FAIL": 0, "WARN": 1, "PASS": 2}
    out = [f"AGENTS.md mechanical checks — {path}", "=" * 56]
    for f in sorted(findings, key=lambda x: order[x.level]):
        out.append(f"[{icons[f.level]}] {f.level:<5} {f.rule}: {f.message}")
        for d in f.detail:
            out.append(f"        - {d}")
    counts = {k: sum(1 for f in findings if f.level == k) for k in icons}
    out.append("-" * 56)
    out.append(f"FAIL={counts['FAIL']}  WARN={counts['WARN']}  PASS={counts['PASS']}")
    out.append("Note: content quality (filler, don't/do pairing, architecture tours) is a judgment "
               "call left to the author — these checks only count what a script counts reliably.")
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description="Mechanical checks for an AGENTS.md.")
    p.add_argument("path", type=Path, help="Path to the AGENTS.md (or CLAUDE.md) file.")
    p.add_argument("--max-lines", type=int, default=DEFAULT_MAX_LINES,
                   help=f"Line-count target (default {DEFAULT_MAX_LINES}).")
    p.add_argument("--json", action="store_true", help="Emit findings as JSON.")
    p.add_argument("--strict", action="store_true", help="Treat WARN as failure for exit code.")
    args = p.parse_args(argv)

    if not args.path.is_file():
        print(f"error: no such file: {args.path}", file=sys.stderr)
        return 2

    findings = validate(args.path, args.max_lines)

    if args.json:
        print(json.dumps({"path": str(args.path), "findings": [asdict(f) for f in findings]}, indent=2))
    else:
        print(render_text(args.path, findings))

    has_fail = any(f.level == "FAIL" for f in findings)
    has_warn = any(f.level == "WARN" for f in findings)
    return 1 if (has_fail or (args.strict and has_warn)) else 0


if __name__ == "__main__":
    sys.exit(main())
