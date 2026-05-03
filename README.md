# Prisma vs TypeORM vs Drizzle Performance Bench

Reproducible head-to-head benchmark of NestJS + Prisma 7 vs NestJS + TypeORM 0.3 vs NestJS + Drizzle 0.44 on identical Postgres schema, identical workload, identical resource limits. Live Grafana dashboards via k6 → Prometheus, plus post-run charts via `scripts/charts-from-pg.ts`.

**📖 Full write-up + analysis**: [zaxovaiko.me/posts/prisma-vs-typeorm-vs-drizzle-deep-dive](https://www.zaxovaiko.me/posts/prisma-vs-typeorm-vs-drizzle-deep-dive)

## Final results

12 scenarios, RUNS=1, Railway Hobby tier (8 vCPU / 8 GB shared), 2k users / 20k posts / 100k comments seed. Lower p95 = better. Lower RSS = better.

| Scenario | Prisma p95 | TypeORM p95 | Drizzle p95 | Prisma RSS | TypeORM RSS | Drizzle RSS | Winner |
|---|---:|---:|---:|---:|---:|---:|---|
| simple-lookup | 213ms | **147ms** | 224ms | 248 MB | 241 MB | 214 MB | TypeORM |
| relations | 301ms | **200ms** | 765ms | 714 MB | 348 MB | 510 MB | TypeORM |
| pagination | **331ms** | 608ms | 1331ms | 961 MB | 345 MB | 375 MB | Prisma |
| fulltext | 8604ms | 8505ms | 7815ms | 135 MB | 107 MB | 99 MB | tie (~10%) |
| n+1 | **161ms** | 190ms | 514ms | 319 MB | 214 MB | 266 MB | Prisma |
| bulk-insert | 67ms | **14ms** | 22ms | 244 MB | 228 MB | 206 MB | TypeORM |
| deep-nested | 129ms | **113ms** | 1465ms | 862 MB | 323 MB | 372 MB | TypeORM |
| raw-aggregation | 11086ms | 28738ms | **10689ms** | 135 MB | 106 MB | 102 MB | Drizzle |
| cursor | 507ms | **279ms** | 585ms | 365 MB | 350 MB | 331 MB | TypeORM |
| complex-filter | **35953ms** | 60001ms | 53046ms | 127 MB | 105 MB | 103 MB | Prisma (least-worst) |
| delete | 798ms | **90ms** | 102ms | 232 MB | 212 MB | 203 MB | TypeORM |
| transaction | 188ms | **127ms** | 150ms | 301 MB | 229 MB | 220 MB | TypeORM |

**Score**: TypeORM 7, Prisma 2 outright + 1 least-worst, Drizzle 2, fulltext tied. Memory: Drizzle wins 8/12.

**Key surprises** (full discussion in the blog post):
- Drizzle's `LATERAL`+`json_agg` relational API is **3-13x slower than TypeORM's flat JOINs** under load. The gap grows with `with: { ... }` nesting depth.
- Prisma's `delete` is **9x slower** than TypeORM thanks to `title::text LIKE` casting (kills `text_pattern_ops` index).
- TypeORM's raw-aggregation outlier (28.7s vs ~11s for the other two) on identical raw SQL — likely connection-pool contention; flagged as suspect.

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
- Drizzle 0.44 (`drizzle-orm/node-postgres`)
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

Full reasoning + the Prisma optimization checklist that closes most of the gap is in the [blog post](https://www.zaxovaiko.me/posts/prisma-vs-typeorm-vs-drizzle-deep-dive).
