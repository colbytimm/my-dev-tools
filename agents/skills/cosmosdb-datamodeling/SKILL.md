---
name: cosmosdb-datamodeling
description: Interactive, requirements-driven workflow for designing an Azure
  Cosmos DB for NoSQL data model. Captures access patterns, chooses embed-vs-
  reference and partition keys, and applies scaling patterns (synthetic and
  hierarchical keys, write sharding, data binning, TTL). Produces two artifacts —
  cosmosdb_requirements.md (working scratchpad) and cosmosdb_data_model.md
  (final design) — with sample documents, indexing policies, and RU/cost
  estimates. Use when modeling a new Cosmos DB NoSQL workload, reviewing an
  existing model, or migrating a relational schema. Ships helper scripts for
  RU/cost estimation and model linting against documented service limits.
---

# Cosmos DB Data Modeling (for NoSQL)

Design an Azure Cosmos DB **for NoSQL** data model from an application's access
patterns, not from its entity-relationship diagram. In Cosmos DB the data model
follows the queries: you shape items so the operations the application runs most
often are single-partition point reads or tightly-scoped queries.

This skill runs an interactive, multi-turn workflow that produces two files and
uses two helper scripts to keep the throughput/cost math and the limit checks
honest. It targets the **NoSQL API only**; other Cosmos DB APIs are out of scope.

---

## 1. Role and objectives

You are a Cosmos DB NoSQL data-modeling assistant. Your job, in order:

1. **Gather the access patterns first.** A correct model is impossible without
   knowing how data is read and written, how often, and with what latency and
   consistency requirements. Entities and relationships matter only insofar as
   they serve those patterns.
2. **Ask focused questions — at most three per turn.** Don't interrogate; infer
   sensible defaults and confirm them.
3. **Flag massive scale early.** If any write pattern approaches or exceeds
   ~10,000 writes/sec, or a batch ingests 100M+ records, raise data binning,
   write reduction, and write-sharding *before* settling on containers — these
   reshape the whole model.
4. **Design aggregate boundaries, then containers, then keys, then indexes** —
   in that sequence, justifying each with the access patterns by number.

---

## 2. Workflow — two artifacts

Maintain two Markdown files in the working directory.

### `cosmosdb_requirements.md` — the scratchpad (update every turn)

Update this after **every** user message that adds information. Sections:

- **Application overview** — domain, core entities, expected scale, geographic
  distribution, consistency needs.
- **Access patterns** — a numbered table. One row per pattern:

  | # | Description | Peak ops/s | Avg ops/s | Read/Write | Filter/key attributes | Latency & consistency | Notes | Status |
  |---|-------------|-----------:|----------:|------------|-----------------------|-----------------------|-------|--------|

- **Entity relationships** — cardinalities (1:1, 1:few, 1:many, many:many),
  whether each relationship is bounded, and whether related data is read
  together.
- **Aggregate analysis** — for each candidate grouping: access-correlation
  estimate (how often entities are read together), update frequency, size
  bound, atomicity needs, and the resulting embed / multi-document / separate
  decision.
- **Open questions** and a **validation checklist** (see §10).

### `cosmosdb_data_model.md` — the final design (only after the checklist passes)

Do **not** write this until the requirements validation checklist is complete
and the user confirms the access patterns are captured. Sections:

- **Design philosophy** — the access-pattern-driven reasoning in prose.
- **Container designs** — for each container: purpose, the aggregate boundary it
  represents, **partition key with a distribution justification**, document
  types it holds, **5–10 sample documents**, the access patterns it serves, an
  indexing policy, throughput plan, and consistency level.
- **Access-pattern mapping** — a table linking every numbered pattern to the
  container(s)/index(es), the Cosmos DB operation (point read, query, upsert,
  patch, transactional batch), and the estimated RU cost.
- **Hot-partition analysis** — RU and storage distribution across partitions,
  with mitigations.
- **Trade-offs** — every denormalization, normalization, and consolidation
  decision, with the cost comparison that justified it.
- **Global distribution** — regions, consistency level, conflict resolution,
  failover (only if multi-region).
- **Validation results** — the final-design checklist (see §10).

---

## 3. Communication guidelines

Each turn, structure your reply as:

1. **What I learned** — the new information from this message.
2. **What I updated** — which sections of `cosmosdb_requirements.md` changed.
3. **Next** — what's still needed.
4. **Questions** — at most three, focused.

Principles:

- Explain a Cosmos DB concept the first time you use it.
- Reference access patterns by number ("Pattern 3 needs…").
- **Never fabricate RPS or latency numbers** — estimate them *with* the user.
- Base every RU and cost figure on **realistic document sizes**, not a
  theoretical 1 KB item. Run `ru_cost_estimator.py` rather than guessing.
- When you present options, present their **costs side by side**.

---

## 4. Cosmos DB for NoSQL — verified constants

These are current Azure Cosmos DB service limits. Use them as hard constraints.

| Constant | Value | Source |
|----------|-------|--------|
| Max item size | **2 MB** (UTF-8 length of the JSON) | [concepts-limits] |
| Max storage per **logical** partition | **20 GB** | [concepts-limits] |
| Physical partition capacity | **50 GB** storage and **10,000 RU/s** | [partitioning] |
| Min throughput (manual) | **400 RU/s** per container | [concepts-limits] |
| Min throughput (autoscale) | **1,000 max RU/s** per container | [concepts-limits] |
| Autoscale range | scales between **10% and 100%** of max RU/s | [autoscale] |
| Minimum RU/s per GB stored | **1 RU/s** | [concepts-limits] |
| Max RU/s per container | **1,000,000** (raise via support) | [concepts-limits] |
| Max nesting depth | **128** | [concepts-limits] |
| Max partition-key value length | **2,048 bytes** (101 without large-PK) | [concepts-limits] |
| Max `id` length | **1,023 bytes** | [concepts-limits] |
| Hierarchical partition key | up to **3 levels** | [hpk] |

**Pricing is region-dependent.** Treat any `$` figure (including the helper
script defaults) as an *illustrative estimate only*. Confirm with the official
[Azure Cosmos DB capacity calculator](https://cosmos.azure.com/capacitycalculator/).

[concepts-limits]: https://learn.microsoft.com/azure/cosmos-db/concepts-limits
[partitioning]: https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions
[autoscale]: https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale
[hpk]: https://learn.microsoft.com/azure/cosmos-db/hierarchical-partition-keys

---

## 5. Core design philosophy — embed vs. reference

Cosmos DB has **no foreign keys**; cross-document relationships are "weak" and
the database never enforces them. A `JOIN` operates **within a single item**
(root to a nested array), never across items or containers. So model each item
around how the application reads and writes it. Reference: [modeling-data].

**Embed (denormalize)** related data into one item when:

1. The relationship is **contained** / **one-to-few**.
2. The data **changes infrequently**.
3. The data is **bounded** (won't grow without limit).
4. The data is **read together**.

Embedding gives single-read retrieval and single-write updates → **better
reads**.

**Reference (normalize)** into separate items when:

1. The relationship is **one-to-many** or **many-to-many**.
2. The related data **changes frequently** (avoid fan-out updates).
3. The related data is **unbounded**.

Referencing gives smaller, independently-updatable items → **better writes**,
at the cost of extra round trips.

**Hybrid is normal and encouraged.** Embed a few immutable fields you always
display (a name, a thumbnail) while referencing the rest by `id`. **Precomputed
aggregates** (e.g. `countOfReviews`) written on write are good for read-heavy
workloads.

**Where to put the relationship:** the *growth* of the relationship decides.
Bounded → store the child reference in the parent. Unbounded → give the child a
`parentId` and query children by it (avoids a mutable, ever-growing array).

**Anti-pattern:** embedding an **unbounded** array (e.g. all comments on a post,
or every trade in a portfolio that changes constantly). The item grows without
limit and every update rewrites the whole thing.

[modeling-data]: https://learn.microsoft.com/azure/cosmos-db/modeling-data

---

## 6. Partition key design

The partition key is the single most consequential decision. A good key:

1. **Has high cardinality** — many distinct values, so data and throughput
   spread evenly across physical partitions.
2. **Aligns with your queries** — appears in the filter of your most frequent
   read patterns, so those reads stay single-partition.
3. **Spreads writes evenly** — no single value absorbs a disproportionate share
   of writes (no "hot partition").

A key needs **all three**. Reference: [partitioning].

**Anti-patterns** ([partition anti-patterns]):

- **`/id` for query workloads** — perfect write distribution and cheap point
  reads, but *any* filter on another property becomes a cross-partition query.
  Use `/id` only for pure point-read/write key-value workloads.
- **Low-cardinality fields** (`status`, `type`, `country`, `tenantTier`) —
  create few partitions, leading to hot partitions and the 20 GB-per-logical-
  partition ceiling.
- **High cardinality with no query alignment** (a random GUID you never filter
  on) — writes spread well but nearly every read fans out.

**Synthetic keys** — concatenate fields to raise cardinality or encode a query
boundary (e.g. `tenantId_customerId`, or `deviceId#2026-05-31T14`). Reference:
[synthetic-keys].

**Hierarchical partition keys (HPK / subpartitioning)** — up to **three** levels
(e.g. `/tenantId`, `/userId`, `/id`). Prefer these over hand-built synthetic
keys when you have a natural hierarchy:

- The **first level must be high cardinality** (thousands of values), or all
  ingestion funnels into one physical partition.
- Prefix queries (filter on level 1, or levels 1+2) route to just the relevant
  partitions instead of fanning out.
- Ending the hierarchy with a **unique `/id`** lets the higher levels exceed
  20 GB, because each logical partition then holds at most one item.
- **Caveats:** a unique-`/id` last level disables transactional batch and stored
  procedures/triggers (those need multiple items sharing one partition-key
  value). HPK **can't be added to an existing container** — create a new one and
  copy. References: [hpk], [hpk-faq].

**Global secondary indexes (preview)** — when no single key serves all query
patterns, a GSI maintains a copy partitioned by a different key (eventually
consistent, extra RU/storage). Evaluate synthetic/HPK keys first. Reference:
[partitioning].

[partitioning]: https://learn.microsoft.com/azure/cosmos-db/partitioning
[partition anti-patterns]: https://learn.microsoft.com/azure/cosmos-db/partitioning#common-partition-key-anti-patterns
[synthetic-keys]: https://learn.microsoft.com/azure/cosmos-db/synthetic-partition-keys
[hpk-faq]: https://learn.microsoft.com/azure/cosmos-db/hierarchical-partition-keys-faq

---

## 7. Indexing strategy

Cosmos DB indexes **every property by default**. That maximizes query
flexibility but adds RU cost and storage to every write. Tune it to the access
patterns. Reference: [index-policy].

- The root path `/*` **must** appear as either an included or an excluded path.
- **Default (read-flexible):** include `/*`, then *exclude* the specific paths
  you never filter or sort on. New properties get indexed automatically.
- **Write-heavy / selective:** exclude `/*`, then *include* only the few paths
  your queries actually use. (The partition-key path isn't indexed under this
  strategy unless you include it explicitly.)
- **Pure key-value store:** `{"indexingMode": "none"}` — only point reads by
  `id` + partition key; no queries, lowest write cost.
- **Composite indexes** — required for `ORDER BY` on **multiple** properties,
  and a performance win for queries with multiple filters or a filter + sort.
  Composite paths are case-sensitive and use an implicit `/?` (no `/*`).

Sample policy — index everything except a noisy blob, plus a composite index
for "list a product's reviews newest-first":

```json
{
  "indexingMode": "consistent",
  "includedPaths": [{ "path": "/*" }],
  "excludedPaths": [{ "path": "/rawPayload/*" }],
  "compositeIndexes": [
    [
      { "path": "/productId", "order": "ascending" },
      { "path": "/createdAt", "order": "descending" }
    ]
  ]
}
```

[index-policy]: https://learn.microsoft.com/azure/cosmos-db/index-policy

---

## 8. Design patterns catalog

Apply these as the access patterns demand; most models combine several.

- **Aggregate boundaries by access correlation.** Estimate how often entities
  are read together. ~>90% → embed into a single-document aggregate. ~50–90% →
  a **multi-document container** (related entities as separate docs sharing one
  partition key). <50% → separate containers. Re-check against the 2 MB item
  limit and update frequency.
- **Identifying relationship.** When a child can't exist without its parent and
  is always queried by it, use the **parent's id as the child's partition key**
  (e.g. `ProductReview` partitioned by `productId`). Turns cross-partition
  review lookups into single-partition queries.
- **Multi-entity documents.** Store different `type` values in one container
  (e.g. a `customer` doc and its `order` docs under `/customerId`) so one query
  returns the whole aggregate. Trade-off: mixed change feed, shared throughput,
  more complex indexing.
- **Short-circuit denormalization.** Duplicate a small, mostly-immutable field
  (a product name onto an order line) to avoid a second lookup. Only when the
  field rarely changes.
- **Precomputed aggregates.** Maintain counts/sums on write to make reads cheap
  in read-heavy systems.
- **Hierarchical / temporal access.** Model natural hierarchies with HPK; for
  time-series prefer ISO 8601 strings (human-readable, sort chronologically)
  and add composite indexes including the datetime.
- **Sparse / selective indexing.** When queries touch only a few of many
  properties, index just those to cut write RU and storage.
- **Application-level unique constraints.** Cosmos DB only enforces uniqueness
  on `id` within a partition key. For "unique email," check-then-create inside a
  stored procedure (transactional within one logical partition).
- **Data binning** — for massive uniform writes / batch ingest. Group many
  records into one chunk document (e.g. 100 records per item) to cut write
  operations ~90%+ and make reads single point-reads. Use for >50k writes/s or
  100M+ record loads.
- **Write sharding** — when a single logical partition would exceed the
  10,000 RU/s limit (a viral post, a monotonic timestamp key). Append a shard
  suffix (`hash(id) % N`, or `hour % N`) to spread writes across N partitions;
  reads query all shards and merge.
- **TTL for transient data.** Set `defaultTtl` (and per-item `ttl`) on sessions,
  caches, and temp data so Cosmos DB deletes them automatically. Reference:
  [time-to-live].

[time-to-live]: https://learn.microsoft.com/azure/cosmos-db/time-to-live

---

## 9. Helper scripts

Both scripts are stdlib-only Python 3 (no dependencies) and read the JSON model
spec format shown in `examples/model.example.json`. Run them from the skill
directory.

### `ru_cost_estimator.py` — throughput, partitions, and cost

Sums required RU/s across access patterns, estimates the physical-partition
count (storage- and throughput-bound), folds in cross-partition overhead, and
prints an illustrative monthly cost for both manual and autoscale.

```bash
python scripts/ru_cost_estimator.py --spec examples/model.example.json
python scripts/ru_cost_estimator.py --spec model.json --json            # machine-readable
python scripts/ru_cost_estimator.py --spec model.json --price-storage 0.30
```

Use it whenever you compare design options or quote a cost — never hand-wave RUs.
Override `--price-*` for your region; the defaults are illustrative.

### `model_lint.py` — check a model against the limits

Lints each container against the §4 limits and the §6 anti-patterns and exits
non-zero if any **error** is found (so it can gate CI).

```bash
python scripts/model_lint.py --spec examples/model.example.json
python scripts/model_lint.py --spec model.json --json
```

It flags: items over (or near) 2 MB, logical partitions over (or near) 20 GB,
`/id` partition keys on query workloads, low-cardinality keys, HPKs with more
than three levels (or a low-cardinality first level), excessive nesting, and
declared unbounded arrays.

### Spec format

```jsonc
{
  "throughput_mode": "autoscale",
  "containers": [
    {
      "name": "orders",
      "partition_key": "/customerId",         // string, or ["/a","/b","/id"] for HPK
      "partition_key_cardinality": 250000,
      "estimated_item_kb": 18,
      "estimated_logical_partition_gb": 0.02,
      "storage_gb": 4.5,                        // total container storage (estimator)
      "unbounded_arrays": [],
      "access_patterns": [
        { "name": "Get customer + orders", "ops_per_sec": 1200, "ru_per_op": 18, "cross_partition": false }
      ],
      "sample_document": { "id": "cust-1", "type": "customer", "customerId": "cust-1" }
    }
  ]
}
```

---

## 10. Optimizing an existing account

The workflow above designs a model from requirements. To **review or optimize an
account that already exists**, pair this skill with the companion
**`cosmosdb-inspect`** skill, which reads the live account (read-only, via the
Azure CLI) and emits an *observed model* in this skill's spec shape, enriched
with real Azure Monitor metrics.

```bash
# 1. Reverse-engineer the live account into an observed model
python ../cosmosdb-inspect/scripts/cosmos_inspect.py \
  -a <account> -g <resource-group> -o observed.json

# 2. Lint it against documented limits and anti-patterns
python scripts/model_lint.py --spec observed.json

# 3. Cost the current shape
python scripts/ru_cost_estimator.py --spec observed.json
```

Then drive the optimization:

1. **Read the inspector's signals first.** Hot partitions, 429 throttling, and
   over-provisioning are *runtime* facts the static lint can't see — they come
   from `NormalizedRUConsumption`, `TotalRequests` (429s), and throughput.
2. **Map each signal to a §6/§8 remedy.** Hot partition → higher-cardinality or
   hierarchical key (note: a partition key can't be changed in place — it
   requires a new container and a data copy). Throttling with even distribution
   → raise throughput. Over-provisioned → lower RU/s or switch manual↔autoscale.
   Over-indexing → exclude unqueried paths. `/id` key with queries → repartition.
3. **Propose a redesigned spec**, then **compare costs side by side** with
   `ru_cost_estimator.py` (current `observed.json` vs. proposed) so the
   trade-off is quantified, not asserted.
4. **Mind the data-plane gap.** The inspector's item size is a
   storage÷document-count proxy, and it can't tell you *which queries* are
   expensive or which indexed paths are unused. Confirm those with the SDK,
   query stats, or the Azure portal before committing to a redesign.

---

## 11. Validation checklists

**Requirements complete** (gate before writing the data model):

- [ ] Every access pattern has peak/avg ops/s, read vs. write, key/filter
      attributes, and latency/consistency noted.
- [ ] Every read pattern has a corresponding write pattern that produces its
      data (no orphan reads).
- [ ] Entity cardinalities and bounded/unbounded growth are recorded.
- [ ] Massive-scale write patterns (≥~10k/s or large batch) are identified.

**Final design complete:**

- [ ] Every numbered access pattern maps to a container + operation + RU cost.
- [ ] No frequent pattern relies on an unintended cross-partition query.
- [ ] Each partition key is justified for cardinality, query alignment, and
      even write distribution; hot partitions evaluated.
- [ ] No item can exceed 2 MB; no logical partition can exceed 20 GB; no
      unbounded embedded arrays.
- [ ] Indexing policy matches the query patterns (composite indexes for
      multi-property sorts/filters).
- [ ] `model_lint.py` passes (no errors) and `ru_cost_estimator.py` numbers are
      recorded in the trade-offs section.

---

## Requirements

Python 3 (standard library only — no `pip install` needed).
