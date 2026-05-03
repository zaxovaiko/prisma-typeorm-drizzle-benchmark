# Prisma vs TypeORM Performance Bench

Reproducible head-to-head benchmark of NestJS + Prisma 7 vs NestJS + TypeORM on identical Postgres schema, identical workload, identical resource limits. Live Grafana dashboards via k6 → Prometheus.

## Quickstart

```bash
cp .env .env.local           # tweak if needed
pnpm install
pnpm up                      # postgres + both APIs + observability stack
pnpm seed                    # 10k users, 100k posts, 500k comments per DB
pnpm bench                   # runs all scenarios, alternating P/T x3
pnpm report                  # writes RESULTS.md
```

Open Grafana at http://localhost:3030 (anonymous Admin) → "API Perf" dashboard.

## Stack

- NestJS 11 + Node 24
- Prisma 7 (Rust-free, `@prisma/adapter-pg`)
- TypeORM 0.3.28 + `@nestjs/typeorm` 11
- PostgreSQL 17
- k6 (Prometheus remote-write)
- Prometheus + Grafana + postgres_exporter + cAdvisor

## Scenarios

1. `GET /users/:id` — simple lookup
2. `GET /posts/:id/full` — relations
3. `GET /posts?page=N&limit=50` — pagination
4. `GET /search?q=X` — full-text
5. `GET /users/:id/feed` — N+1 trap
6. `POST /posts/bulk` — bulk insert
7. `GET /categories/tree` — deep nested
8. `GET /raw/top-authors` — raw aggregation

## Fairness rules

- Identical container CPU/mem limits
- Same seed data
- `VACUUM ANALYZE` before each run
- 30s warmup, 60s measure, alternating P/T order
- Same connection pool size (20)
- Production builds, logging off on hot path
