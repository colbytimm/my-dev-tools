#!/usr/bin/env python3
"""Lint an Azure Cosmos DB for NoSQL data-model spec against documented limits.

Reads the same JSON spec the cosmosdb-datamodeling skill produces and checks
each container against Cosmos DB service limits and well-known partition-key /
modeling anti-patterns. Prints grouped findings and exits non-zero if any
ERROR-level finding is present (WARN-only is a clean-ish pass with exit 0).

Verified facts the checks are based on (Azure Cosmos DB service quotas & limits,
partitioning, and hierarchical partition keys docs):
  - Maximum item size: 2 MB (UTF-8 length of the JSON).
  - Maximum storage per logical partition: 20 GB.
  - Maximum nesting depth: 128.
  - Hierarchical partition keys: up to 3 levels.
  - /id as the partition key is an anti-pattern for query workloads.
  - Low-cardinality partition keys cause hot partitions / uneven distribution.
  https://learn.microsoft.com/azure/cosmos-db/concepts-limits
  https://learn.microsoft.com/azure/cosmos-db/partitioning#common-partition-key-anti-patterns
  https://learn.microsoft.com/azure/cosmos-db/hierarchical-partition-keys
"""

import argparse
import json
import sys

ITEM_SIZE_MAX_MB = 2.0
LOGICAL_PARTITION_MAX_GB = 20.0
MAX_NESTING_DEPTH = 128
HPK_MAX_LEVELS = 3

# Cardinality below this for a single-level key risks hot partitions; the
# partitioning docs recommend a key with many distinct values.
LOW_CARDINALITY_THRESHOLD = 100

# Field names that are classic low-cardinality choices called out in the docs.
LOW_CARDINALITY_NAMES = {"status", "type", "country", "region", "tier",
                         "category", "state", "gender"}


def _norm_key(name):
    return str(name).lstrip("/").lower()


def _max_depth(value, depth=1):
    if isinstance(value, dict):
        return max([depth] + [_max_depth(v, depth + 1) for v in value.values()])
    if isinstance(value, list):
        return max([depth] + [_max_depth(v, depth + 1) for v in value])
    return depth


class Findings:
    def __init__(self):
        self.items = []

    def add(self, level, container, rule, message):
        self.items.append({
            "level": level, "container": container, "rule": rule, "message": message,
        })

    def error(self, *a):
        self.add("ERROR", *a)

    def warn(self, *a):
        self.add("WARN", *a)

    def info(self, *a):
        self.add("INFO", *a)

    @property
    def n_errors(self):
        return sum(1 for f in self.items if f["level"] == "ERROR")


def check_container(c, f):
    name = c.get("name", "<unnamed>")

    # --- partition key ---
    pk = c.get("partition_key")
    if pk is None:
        f.error(name, "partition-key/missing", "no partition_key declared")
        levels = []
    elif isinstance(pk, list):
        levels = pk
        if len(levels) > HPK_MAX_LEVELS:
            f.error(name, "hpk/too-many-levels",
                    "hierarchical partition key has {} levels; max is {}".format(
                        len(levels), HPK_MAX_LEVELS))
        if levels and _norm_key(levels[-1]) != "id":
            f.info(name, "hpk/last-level",
                   "consider /id as the final HPK level to stay under the 20 GB "
                   "logical-partition limit")
    else:
        levels = [pk]

    first = _norm_key(levels[0]) if levels else None
    if first == "id" and c.get("access_patterns"):
        non_point = [p for p in c["access_patterns"] if p.get("cross_partition")
                     or "search" in str(p.get("name", "")).lower()
                     or "list" in str(p.get("name", "")).lower()]
        if non_point:
            f.warn(name, "partition-key/id-anti-pattern",
                   "/id partition key forces cross-partition queries for any "
                   "non-point-read access pattern")

    if first and (first in LOW_CARDINALITY_NAMES):
        f.warn(name, "partition-key/low-cardinality-name",
               "partition key '{}' looks low-cardinality; risks hot partitions "
               "-- consider a synthetic or hierarchical key".format(levels[0]))

    card = c.get("partition_key_cardinality")
    if isinstance(card, (int, float)) and 0 < card < LOW_CARDINALITY_THRESHOLD:
        f.warn(name, "partition-key/low-cardinality",
               "only ~{} distinct partition-key values (< {}); uneven "
               "distribution likely".format(int(card), LOW_CARDINALITY_THRESHOLD))

    # --- item size ---
    item_kb = c.get("estimated_item_kb")
    if isinstance(item_kb, (int, float)):
        if item_kb / 1024.0 > ITEM_SIZE_MAX_MB:
            f.error(name, "item-size/over-limit",
                    "estimated item {:.2f} MB exceeds the 2 MB hard limit".format(
                        item_kb / 1024.0))
        elif item_kb / 1024.0 > ITEM_SIZE_MAX_MB * 0.75:
            f.warn(name, "item-size/near-limit",
                   "estimated item {:.2f} MB is near the 2 MB limit".format(
                       item_kb / 1024.0))

    sample = c.get("sample_document")
    if isinstance(sample, (dict, list)):
        size_mb = len(json.dumps(sample, ensure_ascii=False).encode("utf-8")) / 1_048_576.0
        if size_mb > ITEM_SIZE_MAX_MB:
            f.error(name, "item-size/sample-over-limit",
                    "sample_document is {:.2f} MB, over the 2 MB limit".format(size_mb))
        depth = _max_depth(sample)
        if depth > MAX_NESTING_DEPTH:
            f.error(name, "nesting/too-deep",
                    "sample_document nests {} levels; max is {}".format(
                        depth, MAX_NESTING_DEPTH))

    # --- logical partition storage ---
    lp_gb = c.get("estimated_logical_partition_gb")
    if isinstance(lp_gb, (int, float)):
        if lp_gb > LOGICAL_PARTITION_MAX_GB:
            f.error(name, "logical-partition/over-20gb",
                    "estimated {:.1f} GB per logical partition exceeds the 20 GB "
                    "limit -- use hierarchical partition keys (with /id last "
                    "level) to scale past it".format(lp_gb))
        elif lp_gb > LOGICAL_PARTITION_MAX_GB * 0.8:
            f.warn(name, "logical-partition/near-20gb",
                   "estimated {:.1f} GB per logical partition approaches the "
                   "20 GB limit".format(lp_gb))

    # --- unbounded arrays ---
    unbounded = c.get("unbounded_arrays") or []
    for arr in unbounded:
        f.warn(name, "embedding/unbounded-array",
               "array '{}' is unbounded; embedding it grows the item without "
               "limit -- reference these as separate items instead".format(arr))


def lint(spec):
    f = Findings()
    containers = spec.get("containers")
    if not containers:
        containers = [spec]
    if not isinstance(containers, list):
        f.error("<spec>", "spec/invalid", "'containers' must be a list")
        return f
    for c in containers:
        if isinstance(c, dict):
            check_container(c, f)
        else:
            f.error("<spec>", "spec/invalid", "each container must be an object")
    return f


def print_human(f):
    if not f.items:
        print("OK -- no findings.")
        return
    order = {"ERROR": 0, "WARN": 1, "INFO": 2}
    for item in sorted(f.items, key=lambda i: (i["container"], order[i["level"]])):
        print("[{:<5}] {} :: {}\n         {}".format(
            item["level"], item["container"], item["rule"], item["message"]))
    n_err = f.n_errors
    n_warn = sum(1 for i in f.items if i["level"] == "WARN")
    print("\n{} error(s), {} warning(s).".format(n_err, n_warn))


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Lint a Cosmos DB for NoSQL data-model spec against limits "
                    "and anti-patterns.")
    src = parser.add_mutually_exclusive_group()
    src.add_argument("--spec", help="path to a JSON model spec")
    src.add_argument("--spec-json", help="inline JSON spec")
    parser.add_argument("--json", action="store_true", help="emit findings as JSON")
    args = parser.parse_args(argv)

    if args.spec_json:
        text = args.spec_json
    elif args.spec:
        try:
            with open(args.spec, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            print("error: could not read --spec file: {}".format(exc), file=sys.stderr)
            return 2
    else:
        print("error: provide --spec PATH or --spec-json '{...}'", file=sys.stderr)
        return 2

    try:
        spec = json.loads(text)
    except json.JSONDecodeError as exc:
        print("error: invalid JSON in spec: {}".format(exc), file=sys.stderr)
        return 2

    findings = lint(spec)
    if args.json:
        print(json.dumps({"findings": findings.items, "errors": findings.n_errors}, indent=2))
    else:
        print_human(findings)

    return 1 if findings.n_errors else 0


if __name__ == "__main__":
    sys.exit(main())
