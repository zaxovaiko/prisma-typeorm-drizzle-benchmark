# Prisma vs TypeORM vs Drizzle Performance Bench

Reproducible head-to-head benchmark of NestJS + Prisma 7 vs NestJS + TypeORM 0.3 vs NestJS + Drizzle (v1 RC) on identical Postgres schema, identical workload, identical resource limits. Live Grafana dashboards via k6 → Prometheus, plus post-run charts via `scripts/charts-from-pg.ts`.

**📖 Full write-up + analysis**: [zaxovaiko.me/posts/prisma-vs-typeorm-vs-drizzle-deep-dive](https://www.zaxovaiko.me/posts/prisma-vs-typeorm-vs-drizzle-deep-dive)

## Final results

12 scenarios, RUNS=1, Railway Hobby tier (8 vCPU / 8 GB shared), 2k users / 20k posts / 100k comments seed. Lower p95 = better. Lower RSS = better. Drizzle on `1.0.0-rc.1`.

| Scenario | Prisma p95 | TypeORM p95 | Drizzle v1 p95 | Prisma RSS | TypeORM RSS | Drizzle RSS | Winner |
|---|---:|---:|---:|---:|---:|---:|---|
| simple-lookup | 234ms | **150ms** | 151ms | 255 MB | 230 MB | 216 MB | TypeORM (Drizzle tied) |
| relations | 339ms | **221ms** | 363ms | 679 MB | 344 MB | 360 MB | TypeORM |
| pagination | **339ms** | 662ms | 618ms | 931 MB | 339 MB | 348 MB | Prisma |
| fulltext | 8694ms | 8614ms | 8693ms | 135 MB | 106 MB | 101 MB | tie (~1%) |
| n+1 | 201ms | **188ms** | 437ms | 311 MB | 215 MB | 267 MB | TypeORM |
| bulk-insert | 70ms | **17ms** | 18ms | 239 MB | 231 MB | 205 MB | TypeORM (Drizzle tied) |
| deep-nested | 166ms | **132ms** | 855ms | 688 MB | 324 MB | 334 MB | TypeORM |
| raw-aggregation | **14082ms** | 33986ms | 20315ms | 125 MB | 103 MB | 101 MB | Prisma |
| cursor | 587ms | 294ms | **274ms** | 358 MB | 347 MB | 321 MB | Drizzle |
| complex-filter | 42530ms | 59996ms | **2115ms** | 122 MB | 105 MB | 267 MB | **Drizzle (28x faster)** |
| delete | 502ms | 84ms | **77ms** | 236 MB | 215 MB | 203 MB | Drizzle |
| transaction | 221ms | **115ms** | 116ms | 297 MB | 229 MB | 222 MB | TypeORM (Drizzle tied) |

**Score**: TypeORM 6, Drizzle v1 3, Prisma 2, fulltext tied. Memory: Drizzle wins 7/12, TypeORM 5/12.

**Headline finding**: Drizzle v1 RC's `complex-filter` runs in **2.1 seconds** while TypeORM grinds for **60 seconds** on the same workload. Drizzle's filter-object syntax produces a tighter EXISTS subquery the planner handles efficiently.

**Other key surprises** (full discussion in the blog post):
- Drizzle v1 RC closed major gaps vs 0.44.7: relations -53%, pagination -54%, deep-nested -42%, complex-filter -96%.
- Prisma's `delete` is **6x slower** than the others thanks to `title::text LIKE` casting (kills `text_pattern_ops` index).
- TypeORM's raw-aggregation outlier (33s vs ~14-20s for the other two) on identical raw SQL — likely connection-pool contention; flagged as suspect.
- Apparent v1 RC regression on `raw-aggregation` (90% slower than 0.44.7) turned out to be system noise on Postgres — *all three ORMs* got slower between runs. Source inspection confirmed no meaningful Drizzle code change in the raw-execute path. Treated as run-to-run variance.

## Quickstart (local Docker)

```bash
cp .env.example .env
pnpm install
pnpm up                      # postgres + 3 APIs + observability stack
pnpm seed                    # default sizes; override via N_USERS / N_POSTS / N_COMMENTS env
pnpm bench                   # runs all scenarios, alternating P/T/D
pnpm report                  # writes RESULTS.md
```

Live Grafana: http://localhost:3030 (anonymous Admin) → "API Perf" dashboard.

## Quickstart (Railway)

See [`RAILWAY.md`](./RAILWAY.md). The numbers above were collected on Railway's Hobby tier so they reflect realistic small-SaaS production hardware, not laptop perf.

## Stack

- NestJS 11 + Node 24 (Alpine Docker)
- Prisma 7 (`@prisma/adapter-pg`)
- TypeORM 0.3.28 (`@nestjs/typeorm` 11)
- Drizzle `1.0.0-rc.1` (`drizzle-orm/node-postgres`, relational query API with `defineRelations`)
- PostgreSQL 18
- k6 (Prometheus remote-write + summary-export to Postgres)
- Prometheus + Grafana + postgres_exporter + cAdvisor

## Scenarios

1. `GET /users/:id` — simple lookup
2. `GET /posts/:id/full` — relations (post + author + comments + categories)
3. `GET /posts` — offset pagination + count
4. `GET /search?q=X` — tsvector full-text
5. `GET /users/:id/feed` — N+1 trap (window-fn fix)
6. `POST /posts/bulk` — 20-row INSERT
7. `GET /categories/tree` — 3-level eager load
8. `GET /raw/top-authors` — GROUP BY raw SQL
9. `GET /posts/cursor` — keyset pagination
10. `GET /posts/filter` — OR + range + EXISTS
11. `POST /posts/delete-by-author/:id` — bulk DELETE
12. `POST /tx/post-with-comments` — atomic transaction

## Fairness rules

- Identical container resource limits (Railway Hobby)
- Same seed data, byte-for-byte identical via raw SQL
- `VACUUM ANALYZE` before each run
- 30s warmup, 60s measure, 10s cooldown, alternating P/T/D order
- Same connection pool size (20)
- Production builds (`NODE_ENV=production`), logging off on hot paths
- `pg_stat_statements` enabled per DB so emitted SQL is auditable

## Methodology caveats

- `RUNS=1`: enough for stable p95s on busy scenarios but the slow ones (`fulltext`, `raw-aggregation`, `complex-filter` ~10 RPS each) have run-to-run noise. Treat sub-10% gaps as ties.
- Single-instance Postgres, no replicas, no PgBouncer.
- Latency includes ORM CPU + JSON serialization + NestJS request lifecycle (by design — it's what users feel).
- 20k posts is "medium." `LATERAL`+`json_agg` may scale better at 1M+ rows.
- Drizzle on `1.0.0-rc.1` not GA — minor changes possible before 1.0 stable.

Full reasoning + the Prisma optimization checklist that closes most of the gap is in the [blog post](https://www.zaxovaiko.me/posts/prisma-vs-typeorm-vs-drizzle-deep-dive).
