#!/usr/bin/env python3
"""Inspect a live Azure Cosmos DB for NoSQL account and emit an observed model.

Shells out to the Azure CLI (`az`) -- read-only -- to collect control-plane
configuration (databases, containers, partition keys, indexing policies, TTL,
provisioned throughput) and Azure Monitor server-side metrics (normalized RU
consumption for hot-partition detection, 429 throttling rate, storage, document
count). It writes a JSON document in the same shape the `cosmosdb-datamodeling`
helper scripts consume (`model_lint.py`, `ru_cost_estimator.py`), enriched with
an `observed_metrics` block per container, plus human-readable optimization
signals.

Requires: the Azure CLI installed and signed in (`az login`), with at least
reader access to the account. NoSQL API only.

Verified command/metric references (Microsoft Learn):
  - az cosmosdb sql container:   https://learn.microsoft.com/cli/azure/cosmosdb/sql/container
  - container throughput show:   https://learn.microsoft.com/cli/azure/cosmosdb/sql/container/throughput
  - monitor metrics list:        https://learn.microsoft.com/azure/cosmos-db/monitor-reference#metrics
  - normalized RU / hot partition: https://learn.microsoft.com/azure/cosmos-db/monitor-normalized-request-units
"""

import argparse
import json
import shutil
import subprocess
import sys

# A normalized RU consumption at/above this (%) on a single partition key range,
# while the typical range sits well below it, points to a hot partition.
HOT_PARTITION_HIGH = 80.0
HOT_PARTITION_SPREAD_RATIO = 0.5  # others <= ratio * the hottest

# A sustained 429 rate above this fraction of requests is worth surfacing.
THROTTLE_RATE_WARN = 0.05

# Consistently low utilization suggests over-provisioned throughput.
OVERPROVISION_LOW = 30.0

# Per-physical-partition limits (verified service limits) for context.
PHYSICAL_PARTITION_RU = 10_000


# --------------------------------------------------------------------------- #
# az plumbing (thin; all parsing lives in pure functions below for testability)
# --------------------------------------------------------------------------- #

class AzError(Exception):
    pass


def run_az(args, capture_json=True):
    """Run an `az` command and return parsed JSON (or text). Raises AzError."""
    cmd = ["az"] + args + (["-o", "json"] if capture_json else [])
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        raise AzError("the Azure CLI ('az') was not found on PATH -- install it "
                      "and run 'az login'")
    if proc.returncode != 0:
        raise AzError("`{}` failed: {}".format(" ".join(cmd), proc.stderr.strip()))
    if not capture_json:
        return proc.stdout
    try:
        return json.loads(proc.stdout or "null")
    except json.JSONDecodeError as exc:
        raise AzError("could not parse JSON from `{}`: {}".format(" ".join(cmd), exc))


def preflight():
    if shutil.which("az") is None:
        raise AzError("the Azure CLI ('az') was not found on PATH -- install it "
                      "and run 'az login'")
    run_az(["account", "show"])  # raises if not logged in


# --------------------------------------------------------------------------- #
# pure transforms (unit-testable without az)
# --------------------------------------------------------------------------- #

def account_resource_id(subscription, resource_group, account):
    return ("/subscriptions/{}/resourceGroups/{}/providers/"
            "Microsoft.DocumentDB/databaseAccounts/{}".format(
                subscription, resource_group, account))


def parse_account(account_json):
    """Account-level config: regions, consistency, multi-region writes."""
    locations = account_json.get("locations") or account_json.get("readLocations") or []
    regions = [loc.get("locationName") for loc in locations if loc.get("locationName")]
    consistency = (account_json.get("consistencyPolicy") or {}).get("defaultConsistencyLevel")
    return {
        "name": account_json.get("name"),
        "regions": regions,
        "default_consistency": consistency,
        "multi_region_writes": bool(account_json.get("enableMultipleWriteLocations")),
    }


def parse_partition_key(pk_json):
    """Return a string for a single key or a list of paths for hierarchical."""
    paths = (pk_json or {}).get("paths") or []
    kind = (pk_json or {}).get("kind", "Hash")
    if kind == "MultiHash" or len(paths) > 1:
        return list(paths)
    return paths[0] if paths else None


def summarize_indexing(indexing_json):
    ip = indexing_json or {}
    included = [p.get("path") for p in ip.get("includedPaths", []) if p.get("path")]
    excluded = [p.get("path") for p in ip.get("excludedPaths", []) if p.get("path")]
    composite = ip.get("compositeIndexes", [])
    return {
        "mode": ip.get("indexingMode"),
        "automatic": ip.get("automatic"),
        "included_paths": included,
        "excluded_paths": excluded,
        "composite_index_count": len(composite),
        # Heuristic: the default "index everything" policy.
        "indexes_everything": included == ["/*"] and not _meaningful_excludes(excluded),
    }


def _meaningful_excludes(excluded):
    # The _etag exclusion is present by default and not a tuning signal.
    return [p for p in excluded if "_etag" not in p]


def parse_throughput(throughput_json):
    """Manual RU/s vs autoscale max RU/s. None if not retrievable (serverless)."""
    if not throughput_json:
        return {"mode": "unknown", "ru_per_sec": None, "autoscale_max_ru": None}
    res = throughput_json.get("resource", throughput_json)
    autoscale = res.get("autoscaleSettings") or {}
    if autoscale.get("maxThroughput"):
        return {"mode": "autoscale", "ru_per_sec": None,
                "autoscale_max_ru": autoscale.get("maxThroughput")}
    return {"mode": "manual", "ru_per_sec": res.get("throughput"),
            "autoscale_max_ru": None}


def _series_max(metric_json):
    """Highest single data point across all timeseries of a metric response."""
    best = None
    for metric in (metric_json or {}).get("value", []):
        for ts in metric.get("timeseries", []):
            for point in ts.get("data", []):
                for agg in ("maximum", "average", "total", "count"):
                    if point.get(agg) is not None:
                        best = point[agg] if best is None else max(best, point[agg])
                        break
    return best


def _series_sum(metric_json):
    total = 0.0
    seen = False
    for metric in (metric_json or {}).get("value", []):
        for ts in metric.get("timeseries", []):
            for point in ts.get("data", []):
                for agg in ("total", "count", "maximum", "average"):
                    if point.get(agg) is not None:
                        total += point[agg]
                        seen = True
                        break
    return total if seen else None


def per_pkrange_maxima(metric_json, dimension="partitionkeyrangeid"):
    """Map each partition key range id -> its peak normalized RU consumption."""
    out = {}
    for metric in (metric_json or {}).get("value", []):
        for ts in metric.get("timeseries", []):
            key = None
            for md in ts.get("metadatavalues", []):
                if (md.get("name", {}).get("value", "").lower() == dimension):
                    key = md.get("value")
            peak = None
            for point in ts.get("data", []):
                v = point.get("maximum", point.get("average"))
                if v is not None:
                    peak = v if peak is None else max(peak, v)
            if key is not None and peak is not None:
                out[key] = peak
    return out


def detect_hot_partition(pkrange_maxima):
    """Flag if one partition key range is hot relative to the others."""
    if len(pkrange_maxima) < 2:
        return None
    values = sorted(pkrange_maxima.values(), reverse=True)
    hottest, second = values[0], values[1]
    if hottest >= HOT_PARTITION_HIGH and second <= hottest * HOT_PARTITION_SPREAD_RATIO:
        hot_id = max(pkrange_maxima, key=pkrange_maxima.get)
        return {"hot_partition_key_range": hot_id, "peak_pct": hottest,
                "next_peak_pct": second}
    return None


def throttle_rate(total_requests_json, requests_429_json):
    total = _series_sum(total_requests_json)
    throttled = _series_sum(requests_429_json)
    if not total:
        return None
    return round((throttled or 0.0) / total, 4)


def derive_item_kb(data_usage_bytes, document_count):
    if not document_count or document_count <= 0 or data_usage_bytes is None:
        return None
    return round((data_usage_bytes / document_count) / 1024.0, 3)


def build_container_record(container_json, throughput_json, metrics):
    """Assemble one container entry in the cosmosdb-datamodeling spec shape."""
    res = container_json.get("resource", container_json)
    name = container_json.get("name") or res.get("id")
    pk = parse_partition_key(res.get("partitionKey"))

    norm_ru = metrics.get("normalized_ru", {})
    pkrange = norm_ru.get("per_pkrange", {})
    data_usage = metrics.get("data_usage_bytes")
    doc_count = metrics.get("document_count")
    item_kb = derive_item_kb(data_usage, doc_count)

    record = {
        "name": name,
        "partition_key": pk,
        "indexing": summarize_indexing(res.get("indexingPolicy")),
        "default_ttl": res.get("defaultTtl"),
        "throughput": parse_throughput(throughput_json),
        "storage_gb": round(data_usage / 1_073_741_824.0, 3) if data_usage else None,
        "document_count": doc_count,
        "derived_item_kb": item_kb,
        # Mirror into the field model_lint reads, so the observed model lints.
        "estimated_item_kb": item_kb,
        "observed_metrics": {
            "normalized_ru_peak_pct": norm_ru.get("peak_pct"),
            "per_pkrange_peak_pct": pkrange,
            "hot_partition": detect_hot_partition(pkrange),
            "throttle_rate_429": metrics.get("throttle_rate"),
            "index_usage_bytes": metrics.get("index_usage_bytes"),
        },
    }
    return record


def optimization_signals(record):
    """Human-facing findings derived from observed metrics + config."""
    out = []
    name = record["name"]
    m = record["observed_metrics"]

    if m.get("hot_partition"):
        hp = m["hot_partition"]
        out.append(("HOT PARTITION", name,
                    "partition key range {} peaks at {:.0f}% while the next is "
                    "{:.0f}% -- skewed partition key; consider a higher-cardinality "
                    "or hierarchical key".format(
                        hp["hot_partition_key_range"], hp["peak_pct"],
                        hp["next_peak_pct"])))

    rate = m.get("throttle_rate_429")
    if rate is not None and rate > THROTTLE_RATE_WARN:
        out.append(("THROTTLING", name,
                    "{:.1f}% of requests hit 429 -- raise throughput or fix the "
                    "hot partition".format(rate * 100)))

    peak = m.get("normalized_ru_peak_pct")
    if peak is not None and peak < OVERPROVISION_LOW:
        out.append(("OVER-PROVISIONED", name,
                    "normalized RU peaks at only {:.0f}% -- throughput may be "
                    "higher than needed; consider lowering RU/s or autoscale".format(peak)))

    idx = record.get("indexing", {})
    if idx.get("indexes_everything"):
        out.append(("INDEXING", name,
                    "indexes every path (/*) -- if queries touch few properties, "
                    "exclude unqueried paths to cut write RU and storage"))

    pk = record.get("partition_key")
    if pk == "/id":
        out.append(("PARTITION KEY", name,
                    "/id partition key forces cross-partition queries for any "
                    "non-point-read access pattern"))

    return out


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #

def collect_metrics(resource_id, database, collection, window):
    """Best-effort metric collection; any failure degrades to empty, not fatal."""
    def metric(name, extra=None):
        args = ["monitor", "metrics", "list", "--resource", resource_id,
                "--metric", name, "--interval", "PT1M", "--aggregation",
                "Maximum", "Total", "--filter",
                "CollectionName eq '{}'".format(collection)]
        if window:
            args += ["--start-time", window]
        if extra:
            args += extra
        try:
            return run_az(args)
        except AzError as exc:
            print("  warn: metric {} unavailable: {}".format(name, exc),
                  file=sys.stderr)
            return None

    norm = metric("NormalizedRUConsumption")
    total_req = metric("TotalRequests")
    req_429 = metric("TotalRequests", ["--filter",
                     "CollectionName eq '{}' and StatusCode eq '429'".format(collection)])
    data_usage = metric("DataUsage")
    index_usage = metric("IndexUsage")
    doc_count = metric("DocumentCount")

    return {
        "normalized_ru": {
            "peak_pct": _series_max(norm),
            "per_pkrange": per_pkrange_maxima(norm),
        },
        "throttle_rate": throttle_rate(total_req, req_429),
        "data_usage_bytes": _series_max(data_usage),
        "index_usage_bytes": _series_max(index_usage),
        "document_count": _series_max(doc_count),
    }


def inspect(args):
    preflight()
    rg, account = args.resource_group, args.account
    sub = args.subscription or (run_az(["account", "show"]).get("id"))
    resource_id = account_resource_id(sub, rg, account)

    account_json = run_az(["cosmosdb", "show", "-n", account, "-g", rg])
    account_info = parse_account(account_json)

    if args.database:
        databases = [{"name": args.database}]
    else:
        databases = run_az(["cosmosdb", "sql", "database", "list",
                            "-a", account, "-g", rg])

    containers_out = []
    for db in databases:
        db_name = db.get("name")
        containers = run_az(["cosmosdb", "sql", "container", "list",
                             "-a", account, "-g", rg, "-d", db_name])
        for c in containers:
            c_name = c.get("name")
            print("inspecting {}/{} ...".format(db_name, c_name), file=sys.stderr)
            try:
                tp = run_az(["cosmosdb", "sql", "container", "throughput", "show",
                             "-a", account, "-g", rg, "-d", db_name, "-n", c_name])
            except AzError:
                tp = None  # serverless / shared-throughput: not retrievable here
            metrics = collect_metrics(resource_id, db_name, c_name, args.start_time)
            record = build_container_record(c, tp, metrics)
            record["database"] = db_name
            containers_out.append(record)

    return {"account": account_info, "containers": containers_out}


def print_summary(model):
    acc = model["account"]
    print("Azure Cosmos DB account: {}".format(acc.get("name")))
    print("  regions: {}   consistency: {}   multi-region writes: {}".format(
        ", ".join(acc.get("regions") or []) or "?",
        acc.get("default_consistency") or "?", acc.get("multi_region_writes")))
    print("  containers inspected: {}".format(len(model["containers"])))

    findings = []
    for rec in model["containers"]:
        findings.extend(optimization_signals(rec))

    print("\nOptimization signals:")
    if not findings:
        print("  none flagged from observed metrics and configuration.")
    else:
        for tag, name, msg in findings:
            print("  [{}] {} :: {}".format(tag, name, msg))

    print("\nObserved model written for use with the cosmosdb-datamodeling skill")
    print("(lint it, then compare a proposed redesign with ru_cost_estimator.py).")
    print("Metric-derived numbers are observed estimates; item size is")
    print("storage/document-count proxy, not a measured per-item size.")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Inspect a live Cosmos DB for NoSQL account (read-only) and "
                    "emit an observed model + optimization signals.")
    parser.add_argument("-a", "--account", required=True, help="Cosmos DB account name")
    parser.add_argument("-g", "--resource-group", required=True, help="resource group")
    parser.add_argument("-d", "--database", help="limit to one database (default: all)")
    parser.add_argument("-s", "--subscription", help="subscription id (default: current)")
    parser.add_argument("--start-time", help="metrics window start, ISO 8601 "
                        "(e.g. 2026-05-30T00:00:00Z); default is the az default window")
    parser.add_argument("-o", "--output", help="write the observed model JSON to a file")
    parser.add_argument("--json", action="store_true",
                        help="print the observed model JSON to stdout (no summary)")
    args = parser.parse_args(argv)

    try:
        model = inspect(args)
    except AzError as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return 2

    payload = json.dumps(model, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(payload + "\n")
        print("wrote observed model to {}".format(args.output), file=sys.stderr)

    if args.json:
        print(payload)
    else:
        print_summary(model)
    return 0


if __name__ == "__main__":
    sys.exit(main())
