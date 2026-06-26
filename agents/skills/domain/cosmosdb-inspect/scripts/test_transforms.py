#!/usr/bin/env python3
"""Offline tests for cosmos_inspect's pure transform functions.

These exercise the parsing/transform logic against representative captured
`az` JSON (examples/sample_az_output.json) without needing a live Azure
account or the `az` CLI. Run: python scripts/test_transforms.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cosmos_inspect as ci  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = json.load(open(os.path.join(HERE, "..", "examples", "sample_az_output.json")))

_checks = 0
_failures = []


def check(label, got, want):
    global _checks
    _checks += 1
    if got != want:
        _failures.append("FAIL {}: got {!r}, want {!r}".format(label, got, want))


def approx(label, got, want, tol=0.01):
    global _checks
    _checks += 1
    if got is None or abs(got - want) > tol:
        _failures.append("FAIL {}: got {!r}, want ~{!r}".format(label, got, want))


def main():
    f = FIXTURES

    # account parsing
    acc = ci.parse_account(f["account_show"])
    check("account.name", acc["name"], "contoso-shop")
    check("account.regions", acc["regions"], ["East US", "West US"])
    check("account.consistency", acc["default_consistency"], "Session")
    check("account.multiwrite", acc["multi_region_writes"], False)

    # partition key: single vs hierarchical
    check("pk.single",
          ci.parse_partition_key(f["container_orders"]["resource"]["partitionKey"]),
          "/customerId")
    check("pk.hpk",
          ci.parse_partition_key(f["container_events_hpk"]["resource"]["partitionKey"]),
          ["/tenantId", "/userId", "/id"])

    # indexing summary
    idx_orders = ci.summarize_indexing(
        f["container_orders"]["resource"]["indexingPolicy"])
    check("idx.everything (only _etag excluded)", idx_orders["indexes_everything"], True)
    check("idx.mode", idx_orders["mode"], "consistent")

    # throughput parsing
    check("tp.autoscale", ci.parse_throughput(f["throughput_autoscale"]),
          {"mode": "autoscale", "ru_per_sec": None, "autoscale_max_ru": 40000})
    check("tp.manual", ci.parse_throughput(f["throughput_manual"]),
          {"mode": "manual", "ru_per_sec": 4000, "autoscale_max_ru": None})
    check("tp.serverless/none", ci.parse_throughput(None)["mode"], "unknown")

    # normalized RU per partition key range + hot-partition detection
    pkr = ci.per_pkrange_maxima(f["normalized_ru_hot"])
    check("pkrange.peaks", pkr, {"0": 100.0, "1": 31.0, "2": 25.0})
    hot = ci.detect_hot_partition(pkr)
    check("hot.detected_range", hot["hot_partition_key_range"], "0")
    approx("hot.peak", hot["peak_pct"], 100.0)
    # even distribution should NOT flag
    check("hot.none_when_even",
          ci.detect_hot_partition({"0": 55.0, "1": 50.0, "2": 48.0}), None)

    # throttle rate = 429s / total
    rate = ci.throttle_rate(f["total_requests"], f["requests_429"])
    approx("throttle.rate", rate, 22000.0 / 220000.0)  # 0.10

    # derived item size proxy: 5 GiB / 250k docs ~= 21.0 KB
    item_kb = ci.derive_item_kb(5_368_709_120, 250_000)
    approx("item.kb", item_kb, 20.97, tol=0.1)
    check("item.kb_guard_zero_docs", ci.derive_item_kb(1000, 0), None)

    # end-to-end container record + signals (hot + throttling + indexing)
    metrics = {
        "normalized_ru": {"peak_pct": 100.0, "per_pkrange": pkr},
        "throttle_rate": rate,
        "data_usage_bytes": 5_368_709_120,
        "index_usage_bytes": 1_000_000,
        "document_count": 250_000,
    }
    rec = ci.build_container_record(f["container_orders"], f["throughput_autoscale"], metrics)
    check("rec.pk", rec["partition_key"], "/customerId")
    check("rec.estimated_item_kb_mirrored", rec["estimated_item_kb"], rec["derived_item_kb"])
    approx("rec.storage_gb", rec["storage_gb"], 5.0, tol=0.05)
    tags = sorted({t for t, _, _ in ci.optimization_signals(rec)})
    check("signals.present", tags, ["HOT PARTITION", "INDEXING", "THROTTLING"])

    # /id partition key signal
    id_rec = ci.build_container_record(
        {"name": "kv", "resource": {"id": "kv",
            "partitionKey": {"paths": ["/id"], "kind": "Hash"},
            "indexingPolicy": {"indexingMode": "consistent",
                "includedPaths": [{"path": "/*"}], "excludedPaths": []}}},
        f["throughput_manual"],
        {"normalized_ru": {"peak_pct": 60.0, "per_pkrange": {}},
         "throttle_rate": 0.0, "data_usage_bytes": None,
         "index_usage_bytes": None, "document_count": None})
    id_tags = {t for t, _, _ in ci.optimization_signals(id_rec)}
    check("signals.id_pk", "PARTITION KEY" in id_tags, True)

    # over-provisioned signal (low peak utilization)
    op_tags = {t for t, _, _ in ci.optimization_signals({
        "name": "idle", "partition_key": "/tenantId", "indexing": {},
        "observed_metrics": {"hot_partition": None, "throttle_rate_429": 0.0,
                             "normalized_ru_peak_pct": 12.0}})}
    check("signals.overprovisioned", "OVER-PROVISIONED" in op_tags, True)

    # report
    if _failures:
        print("\n".join(_failures))
        print("\n{} checks, {} FAILED".format(_checks, len(_failures)))
        return 1
    print("all {} checks passed".format(_checks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
