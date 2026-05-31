---
name: cosmosdb-inspect
description: Inspect a live Azure Cosmos DB for NoSQL account (read-only, via the
  Azure CLI) and emit an "observed model" plus optimization signals. Collects
  container configuration (partition keys, indexing policies, TTL, provisioned
  throughput) and Azure Monitor server-side metrics (normalized RU consumption
  for hot-partition detection, 429 throttling rate, storage, document count),
  then writes JSON in the same shape the cosmosdb-datamodeling skill consumes.
  Use to review or optimize an existing account, find hot partitions, spot
  over-provisioned or over-indexed containers, and feed a real model into the
  data-modeling workflow. Requires the az CLI and `az login`. NoSQL API only.
---

# Cosmos DB Inspect (for NoSQL)

Point this at a **running** Azure Cosmos DB for NoSQL account and it reverse-
engineers an *observed model* of every container — keys, indexing, TTL,
throughput — and enriches it with real server-side metrics so you can find what
to optimize. It pairs with the **`cosmosdb-datamodeling`** skill: this skill
tells you *what your account looks like and where it hurts*; that skill helps you
*design and cost the fix*.

It is **read-only** — it issues only `az ... show`/`list` and
`az monitor metrics list` calls. It never writes to the account.

## Requirements

- The **Azure CLI** (`az`) installed and signed in (`az login`).
- **Reader** access to the account (and Monitoring Reader for metrics).
- Python 3 (standard library only).
- Cosmos DB **NoSQL API** account.

## Usage

```bash
python scripts/cosmos_inspect.py -a <account> -g <resource-group> \
  [-d <database>] [-s <subscription>] [--start-time 2026-05-30T00:00:00Z] \
  [-o observed.json] [--json]
```

- `-a/--account`, `-g/--resource-group` — required.
- `-d/--database` — limit to one database (default: every database in the account).
- `-s/--subscription` — defaults to your current `az` subscription.
- `--start-time` — ISO 8601 start of the metrics window (default: az's window).
- `-o/--output` — write the observed-model JSON to a file.
- `--json` — print the observed-model JSON to stdout instead of the summary.

Default run prints an account summary and a list of **optimization signals**;
add `-o observed.json` to capture the model for the data-modeling skill.

## What it collects

**Control plane** (`az cosmosdb sql ...`):

- Account: regions, default consistency level, multi-region writes.
- Per container: partition key (single, or a list for **hierarchical** keys),
  indexing policy (mode, included/excluded paths, composite-index count),
  `defaultTtl`, and provisioned throughput (manual RU/s or autoscale max RU/s).

**Azure Monitor metrics** (`az monitor metrics list`, verified REST names):

- `NormalizedRUConsumption` — split per `PartitionKeyRangeId` to detect **hot
  partitions** (one range pinned near 100% while others sit low).
- `TotalRequests` filtered by `StatusCode eq '429'` vs. total → **throttling rate**.
- `DataUsage`, `IndexUsage`, `DocumentCount` → storage, index overhead, and a
  derived item-size *proxy* (`DataUsage ÷ DocumentCount`).

## Optimization signals

The summary flags, per container:

- **HOT PARTITION** — one partition key range peaks near 100% while others stay
  low; the partition key skews load. Consider a higher-cardinality or
  hierarchical key.
- **THROTTLING** — sustained 429 rate above ~5% of requests.
- **OVER-PROVISIONED** — normalized RU peaks stay low; throughput may exceed need.
- **INDEXING** — the container indexes every path (`/*`); if queries touch few
  properties, exclude the rest to cut write RU and storage.
- **PARTITION KEY** — `/id` partition key, which forces cross-partition queries
  for any non-point-read.

## Honest limitations

`az` is a **control-plane** tool. This skill therefore **cannot** read document
contents, exact per-item sizes, or per-query RU charges — those are data-plane
(SDK/REST) operations. Specifically:

- **Item size is a proxy** (`DataUsage ÷ DocumentCount`), not a measured value.
- It does **not** identify *which queries* are expensive or *which indexed paths
  are never queried* — only that a container over-indexes relative to its keys.
- Shared-database or serverless throughput may not be retrievable per container;
  those fields come back `unknown`/`null` rather than failing the run.

Every metric-derived number is an **observed estimate** over the chosen window.

## Pairing with cosmosdb-datamodeling

The emitted JSON matches that skill's spec shape (`containers[]` with
`partition_key`, `estimated_item_kb`, indexing, etc.), plus an `observed_metrics`
block. A typical optimization loop:

```bash
# 1. Inspect the live account
python scripts/cosmos_inspect.py -a contoso-shop -g shop-rg -o observed.json

# 2. Lint the observed model against documented limits/anti-patterns
python ../cosmosdb-datamodeling/scripts/model_lint.py --spec observed.json

# 3. Cost the current shape, then design and cost a proposed redesign
python ../cosmosdb-datamodeling/scripts/ru_cost_estimator.py --spec observed.json
```

Then drive the `cosmosdb-datamodeling` workflow (§ "Optimizing an existing
account") to turn the hot-partition / throttling / indexing signals into a
concrete redesign and a side-by-side cost comparison.

## Notes

The pure transform functions in `scripts/cosmos_inspect.py` are covered by
`scripts/test_transforms.py`, which runs offline against captured `az` JSON in
`examples/sample_az_output.json` — no live account needed to validate parsing.
