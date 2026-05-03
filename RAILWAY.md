# Running benchmark on Railway

## Why
Local laptop battery + thermal throttling skew results. Railway gives stable CPU/RAM and runs k6 in same private network as APIs (sub-ms latency).

## Architecture

| Service | Image | Public | Notes |
|---|---|---|---|
| `postgres` | Railway Postgres plugin | no | shared by both APIs + bench_runs table |
| `prisma-api` | `apps/prisma-api/Dockerfile` | optional | `DATABASE_URL` from Postgres, suffix `?schema=prisma` |
| `typeorm-api` | `apps/typeorm-api/Dockerfile` | optional | `DATABASE_URL` from Postgres, second db or schema |
| `k6-runner` | `apps/k6-runner/Dockerfile` | no | one-shot job, hits APIs via `*.railway.internal`, inserts results into Postgres |

## Setup

1. Install CLI: `brew install railway` then `railway login`
2. `railway init` in repo root → create project
3. Add Postgres plugin via dashboard → grab `DATABASE_URL`
4. Create two databases manually (one Postgres instance, two DBs):
   ```sh
   psql "$DATABASE_URL" -c 'CREATE DATABASE bench_prisma;'
   psql "$DATABASE_URL" -c 'CREATE DATABASE bench_typeorm;'
   ```
5. Deploy each service:
   ```sh
   railway up --service prisma-api  ./apps/prisma-api
   railway up --service typeorm-api ./apps/typeorm-api
   railway up --service k6-runner   ./apps/k6-runner
   ```
6. Per-service env vars:
   - `prisma-api`: `DATABASE_URL_PRISMA=${{Postgres.DATABASE_URL}}/bench_prisma`
   - `typeorm-api`: `DATABASE_URL_TYPEORM=${{Postgres.DATABASE_URL}}/bench_typeorm`
   - `k6-runner`:
     - `PRISMA_API_URL=http://prisma-api.railway.internal:3001`
     - `TYPEORM_API_URL=http://typeorm-api.railway.internal:3002`
     - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
     - `RUNS=3`
7. Trigger k6: redeploy `k6-runner` (one-shot via `restartPolicyType: NEVER`).

## Visualize results

After bench finishes, pull data locally:

```sh
export DATABASE_URL=<railway postgres public url>
pnpm tsx scripts/compare-charts.ts   # writes RESULTS.html
open RESULTS.html
```

`compare-charts.ts` currently reads `load/results/*.json`. To read from Postgres instead, swap loader to `SELECT ... FROM bench_runs`.
