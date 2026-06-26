#!/usr/bin/env python3
"""Look up correct cloud-provider icon URLs for d2 diagrams.

d2 references icons with `icon: <url>`. The hosted AWS/GCP/Azure icons at
https://icons.terrastruct.com use deeply URL-encoded paths (e.g.
`.../aws%2FCompute%2FAWS-Lambda.svg`) that are impossible to guess reliably, so
this tool searches a bundled index (assets/icons.csv) and prints the exact,
paste-ready URLs. Terrastruct does not change or expire existing icon URLs, so
the bundled values stay valid.

Index provenance: assets/icons.csv is sourced verbatim from the public
tf2d2/terrastruct-icons project (columns: Cloud,Title,URL).

Examples
--------
    # Find the AWS Lambda icon
    python scripts/icons.py search lambda --provider aws

    # Find a GCP storage icon, machine-readable
    python scripts/icons.py search "cloud storage" --provider gcp --json

    # What providers / categories are available?
    python scripts/icons.py providers
    python scripts/icons.py categories --provider azure
"""

import argparse
import csv
import json
import sys
import urllib.parse
from pathlib import Path

# assets/icons.csv lives one level up from this scripts/ directory.
DEFAULT_INDEX = Path(__file__).resolve().parent.parent / "assets" / "icons.csv"

PROVIDER_ALIASES = {
    "aws": "AWS",
    "amazon": "AWS",
    "gcp": "GCP",
    "google": "GCP",
    "azure": "AZURE",
    "az": "AZURE",
    "microsoft": "AZURE",
}


def category_from_url(url: str) -> str:
    """Extract the human-readable category segment from an icon URL.

    URLs encode the path as `<provider>%2F<category>%2F<name>.svg`. The middle
    segment is the category (decoded for readability).
    """
    decoded = urllib.parse.unquote(url)
    # Strip protocol/host, keep the path after the domain.
    path = decoded.split("icons.terrastruct.com/", 1)[-1]
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 3:
        return parts[1]
    return ""


def load_index(path: Path):
    if not path.exists():
        sys.exit(
            f"icon index not found at {path}. Expected the bundled assets/icons.csv."
        )
    rows = []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            cloud = (row.get("Cloud") or "").strip()
            title = (row.get("Title") or "").strip()
            url = (row.get("URL") or "").strip()
            if not (cloud and title and url):
                continue
            rows.append(
                {
                    "provider": cloud.upper(),
                    "title": title,
                    "url": url,
                    "category": category_from_url(url),
                }
            )
    return rows


def normalize_provider(value: str) -> str:
    key = value.strip().lower()
    if key in PROVIDER_ALIASES:
        return PROVIDER_ALIASES[key]
    return value.strip().upper()


def score(title: str, terms: list[str]) -> int:
    """Rank a candidate title against the query terms (higher == better)."""
    low = title.lower()
    words = low.replace("-", " ").replace("_", " ").split()
    joined = " ".join(terms)
    s = 0
    if low == joined:
        s += 1000  # exact full-title match
    if all(t in low for t in terms):
        s += 100  # all terms present
    for t in terms:
        if t in words:
            s += 20  # whole-word match
        elif any(w.startswith(t) for w in words):
            s += 8  # prefix match
        elif t in low:
            s += 3  # substring match
    # Prefer shorter, more specific titles when scores are otherwise close,
    # and de-prioritize the "_light-bg" ("Light") background variants slightly
    # so the standard icon surfaces first.
    if "light" in words:
        s -= 5
    s -= len(title) // 40
    return s


def cmd_search(rows, args):
    terms = [t.lower() for t in args.terms if t.strip()]
    if not terms:
        sys.exit("provide at least one search term")

    candidates = rows
    if args.provider:
        prov = normalize_provider(args.provider)
        candidates = [r for r in candidates if r["provider"] == prov]

    matched = [
        (score(r["title"], terms), r)
        for r in candidates
        if all(t in r["title"].lower() for t in terms)
    ]
    matched = [m for m in matched if m[0] > 0]
    matched.sort(key=lambda m: (-m[0], len(m[1]["title"]), m[1]["title"]))
    results = [r for _, r in matched[: args.limit]]

    if args.json:
        print(json.dumps(results, indent=2))
        return

    if not results:
        print(f"No icons matched {args.terms!r}. Try fewer/different terms or "
              f"`python {Path(__file__).name} categories`.")
        return

    for r in results:
        print(f"{r['provider']:<6} {r['category']:<32} {r['title']}")
        print(f"       icon: {r['url']}")


def cmd_providers(rows, args):
    counts = {}
    for r in rows:
        counts[r["provider"]] = counts.get(r["provider"], 0) + 1
    if args.json:
        print(json.dumps(counts, indent=2))
        return
    for prov in sorted(counts):
        print(f"{prov:<6} {counts[prov]} icons")


def cmd_categories(rows, args):
    if args.provider:
        prov = normalize_provider(args.provider)
        rows = [r for r in rows if r["provider"] == prov]
    cats = sorted({r["category"] for r in rows if r["category"]})
    if args.json:
        print(json.dumps(cats, indent=2))
        return
    for c in cats:
        print(c)


def main():
    parser = argparse.ArgumentParser(
        description="Look up cloud-provider icon URLs for d2 diagrams."
    )
    parser.add_argument(
        "--index", type=Path, default=DEFAULT_INDEX,
        help="path to the icon index CSV (default: bundled assets/icons.csv)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search", help="search icons by name")
    p_search.add_argument("terms", nargs="+", help="search term(s), e.g. 's3 bucket'")
    p_search.add_argument(
        "--provider", help="restrict to a provider (aws|gcp|azure)"
    )
    p_search.add_argument("--limit", type=int, default=10, help="max results")
    p_search.add_argument("--json", action="store_true", help="emit JSON")
    p_search.set_defaults(func=cmd_search)

    p_prov = sub.add_parser("providers", help="list providers and icon counts")
    p_prov.add_argument("--json", action="store_true", help="emit JSON")
    p_prov.set_defaults(func=cmd_providers)

    p_cat = sub.add_parser("categories", help="list icon categories")
    p_cat.add_argument("--provider", help="restrict to a provider (aws|gcp|azure)")
    p_cat.add_argument("--json", action="store_true", help="emit JSON")
    p_cat.set_defaults(func=cmd_categories)

    args = parser.parse_args()
    rows = load_index(args.index)
    args.func(rows, args)


if __name__ == "__main__":
    main()
