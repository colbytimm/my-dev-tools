#!/usr/bin/env python3
"""Estimate Azure Cosmos DB for NoSQL throughput, partition count, and monthly cost.

Reads a model/workload spec (the same JSON the cosmosdb-datamodeling skill
produces) and reports, per container and for the whole account:

  - required provisioned throughput (RU/s) summed across access patterns
  - estimated physical-partition count (storage- and throughput-bound)
  - cross-partition query overhead folded into RU costs
  - an *illustrative* monthly cost for both manual and autoscale throughput

All cost numbers are estimates with region-dependent, overridable prices. For an
authoritative figure use the Azure Cosmos DB capacity calculator:
https://cosmos.azure.com/capacitycalculator/

Verified service facts used here (Azure Cosmos DB service quotas & limits):
  - A physical partition holds up to 50 GB and serves up to 10,000 RU/s.
  - Minimum throughput: 400 RU/s (manual), 1000 max RU/s (autoscale).
  - https://learn.microsoft.com/azure/cosmos-db/concepts-limits
  - https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions
"""

import argparse
import json
import math
import sys

# Per-physical-partition limits (verified, see module docstring).
PHYSICAL_PARTITION_GB = 50
PHYSICAL_PARTITION_RU = 10_000

# Minimum provisioned throughput (verified service limits).
MIN_RU_MANUAL = 400
MIN_RU_AUTOSCALE_MAX = 1000

# Cross-partition query overhead heuristic: a fan-out query pays roughly a base
# RU charge per physical partition it touches. ~2.5 RU/partition is the rule of
# thumb carried over from the reference skill; it is an estimate, not a billed
# constant.
CROSS_PARTITION_RU_PER_PARTITION = 2.5

# Hours billed per month (~730 = 365*24/12). Used for the monthly cost estimate.
HOURS_PER_MONTH = 730

# Illustrative default prices (USD). Region-dependent -- override on the CLI.
# Throughput is billed per 100 RU/s, but per-RU/hr figures are used here for a
# simple linear estimate.
DEFAULT_PRICE_STORAGE_GB_MONTH = 0.25
DEFAULT_PRICE_RU_HOUR_MANUAL = 0.00008
DEFAULT_PRICE_RU_HOUR_AUTOSCALE = 0.00012

# Autoscale bills between 10% and 100% of max RU/s depending on usage. We assume
# the max for a conservative (upper-bound) estimate but expose the floor.
AUTOSCALE_FLOOR_FRACTION = 0.10


def _err(msg):
    print("error: " + msg, file=sys.stderr)
    sys.exit(2)


def load_spec(args):
    if args.spec_json:
        text = args.spec_json
    elif args.spec:
        try:
            with open(args.spec, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            _err("could not read --spec file: {}".format(exc))
    else:
        _err("provide --spec PATH or --spec-json '{...}'")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        _err("invalid JSON in spec: {}".format(exc))


def physical_partitions(storage_gb, required_ru):
    """Storage- and throughput-bound physical-partition count (at least 1)."""
    by_storage = math.ceil(storage_gb / PHYSICAL_PARTITION_GB) if storage_gb else 0
    by_throughput = math.ceil(required_ru / PHYSICAL_PARTITION_RU) if required_ru else 0
    return max(1, by_storage, by_throughput)


def effective_ru(pattern, n_partitions):
    """RU charge for one operation, adding cross-partition fan-out overhead."""
    ru = float(pattern.get("ru_per_op", 0))
    if pattern.get("cross_partition"):
        ru += CROSS_PARTITION_RU_PER_PARTITION * n_partitions
    return ru


def analyze_container(container):
    name = container.get("name", "<unnamed>")
    patterns = container.get("access_patterns", [])
    storage_gb = float(container.get("storage_gb", 0))

    # Two passes: estimate partitions from base RU, then recompute with the
    # cross-partition overhead that depends on the partition count.
    base_ru = sum(
        float(p.get("ops_per_sec", 0)) * float(p.get("ru_per_op", 0)) for p in patterns
    )
    n_part = physical_partitions(storage_gb, base_ru)
    required_ru = sum(
        float(p.get("ops_per_sec", 0)) * effective_ru(p, n_part) for p in patterns
    )
    n_part = physical_partitions(storage_gb, required_ru)

    return {
        "name": name,
        "storage_gb": storage_gb,
        "physical_partitions": n_part,
        "required_ru_per_sec": round(required_ru, 1),
        "patterns": [
            {
                "name": p.get("name", "pattern {}".format(i + 1)),
                "ops_per_sec": float(p.get("ops_per_sec", 0)),
                "ru_per_op": round(effective_ru(p, n_part), 2),
                "cross_partition": bool(p.get("cross_partition")),
                "ru_per_sec": round(
                    float(p.get("ops_per_sec", 0)) * effective_ru(p, n_part), 1
                ),
            }
            for i, p in enumerate(patterns)
        ],
    }


def monthly_cost(required_ru, storage_gb, prices):
    storage = storage_gb * prices["storage"]
    manual_ru = max(required_ru, MIN_RU_MANUAL)
    manual = manual_ru * prices["manual"] * HOURS_PER_MONTH + storage
    auto_max = max(required_ru, MIN_RU_AUTOSCALE_MAX)
    auto_high = auto_max * prices["autoscale"] * HOURS_PER_MONTH + storage
    auto_low = (
        auto_max * AUTOSCALE_FLOOR_FRACTION * prices["autoscale"] * HOURS_PER_MONTH
        + storage
    )
    return {
        "storage_usd_month": round(storage, 2),
        "manual_provisioned_ru": int(manual_ru),
        "manual_usd_month": round(manual, 2),
        "autoscale_max_ru": int(auto_max),
        "autoscale_usd_month_at_max": round(auto_high, 2),
        "autoscale_usd_month_at_floor": round(auto_low, 2),
    }


def build_report(spec, prices):
    containers = spec.get("containers")
    if not containers:
        # Allow a flat single-workload spec (no "containers" wrapper).
        containers = [spec]

    results = [analyze_container(c) for c in containers]
    total_ru = sum(r["required_ru_per_sec"] for r in results)
    total_storage = sum(r["storage_gb"] for r in results)
    return {
        "containers": results,
        "totals": {
            "required_ru_per_sec": round(total_ru, 1),
            "storage_gb": round(total_storage, 2),
            "cost": monthly_cost(total_ru, total_storage, prices),
        },
        "prices": prices,
    }


def print_human(report):
    print("Azure Cosmos DB for NoSQL -- throughput & cost estimate")
    print("=" * 60)
    for c in report["containers"]:
        print("\nContainer: {}".format(c["name"]))
        print("  storage: {:.2f} GB   physical partitions (est.): {}".format(
            c["storage_gb"], c["physical_partitions"]))
        print("  required throughput: {:.1f} RU/s".format(c["required_ru_per_sec"]))
        if c["patterns"]:
            print("  access patterns:")
            for p in c["patterns"]:
                xp = " [cross-partition]" if p["cross_partition"] else ""
                print("    - {:<32} {:>8.0f} ops/s x {:>7.2f} RU = {:>9.1f} RU/s{}".format(
                    p["name"][:32], p["ops_per_sec"], p["ru_per_op"], p["ru_per_sec"], xp))

    t = report["totals"]
    cost = t["cost"]
    print("\n" + "-" * 60)
    print("TOTAL required throughput: {:.1f} RU/s   storage: {:.2f} GB".format(
        t["required_ru_per_sec"], t["storage_gb"]))
    print("\nMonthly cost estimate (illustrative, region-dependent):")
    print("  storage:                 ${:>10.2f}".format(cost["storage_usd_month"]))
    print("  manual ({:>7} RU/s):    ${:>10.2f}/mo".format(
        cost["manual_provisioned_ru"], cost["manual_usd_month"]))
    print("  autoscale (max {:>6} RU/s): ${:>8.2f}/mo at max, ${:.2f}/mo at 10% floor".format(
        cost["autoscale_max_ru"], cost["autoscale_usd_month_at_max"],
        cost["autoscale_usd_month_at_floor"]))
    print("\nEstimate only -- confirm with the Azure Cosmos DB capacity calculator:")
    print("  https://cosmos.azure.com/capacitycalculator/")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Estimate Cosmos DB for NoSQL throughput, partitions, and monthly cost.")
    src = parser.add_mutually_exclusive_group()
    src.add_argument("--spec", help="path to a JSON model/workload spec")
    src.add_argument("--spec-json", help="inline JSON spec")
    parser.add_argument("--price-storage", type=float, default=DEFAULT_PRICE_STORAGE_GB_MONTH,
                        help="USD per GB-month (default %(default)s)")
    parser.add_argument("--price-ru-manual", type=float, default=DEFAULT_PRICE_RU_HOUR_MANUAL,
                        help="USD per RU/s-hour, manual (default %(default)s)")
    parser.add_argument("--price-ru-autoscale", type=float, default=DEFAULT_PRICE_RU_HOUR_AUTOSCALE,
                        help="USD per RU/s-hour, autoscale (default %(default)s)")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args(argv)

    spec = load_spec(args)
    prices = {
        "storage": args.price_storage,
        "manual": args.price_ru_manual,
        "autoscale": args.price_ru_autoscale,
    }
    report = build_report(spec, prices)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_human(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
