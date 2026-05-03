#!/usr/bin/env bash
set -euo pipefail

: "${PRISMA_API_URL:?PRISMA_API_URL required}"
: "${TYPEORM_API_URL:?TYPEORM_API_URL required}"
: "${DRIZZLE_API_URL:?DRIZZLE_API_URL required}"
: "${DATABASE_URL:?DATABASE_URL required (Postgres for bench_runs)}"

SCENARIOS=(simple-lookup relations pagination fulltext n-plus-1 bulk-insert deep-nested raw-aggregation cursor complex-filter delete transaction)
RUNS=${RUNS:-3}

echo "==> waiting for APIs"
for url in "$PRISMA_API_URL/health" "$TYPEORM_API_URL/health" "$DRIZZLE_API_URL/health"; do
  ok=0
  for i in $(seq 1 120); do
    if curl -sf "$url" >/dev/null; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" -ne 1 ]; then echo "API never became healthy: $url"; exit 1; fi
  echo "  $url ok"
done

psql "$DATABASE_URL" <<'SQL'
CREATE TABLE IF NOT EXISTS bench_runs (
  id           bigserial PRIMARY KEY,
  orm          text not null,
  scenario     text not null,
  file         text not null unique,
  ran_at       timestamptz not null default now(),
  avg_ms       double precision,
  p50_ms       double precision,
  p95_ms       double precision,
  p99_ms       double precision,
  rps          double precision,
  fail_pct     double precision,
  peak_rss_mb  double precision
);
ALTER TABLE bench_runs ADD COLUMN IF NOT EXISTS peak_rss_mb double precision;
CREATE INDEX IF NOT EXISTS bench_runs_scenario_orm_idx ON bench_runs (scenario, orm, ran_at DESC);
SQL

run_one() {
  local orm="$1" scenario="$2" base_url="$3"
  local stamp; stamp=$(date +%s)
  local file="${orm}-${scenario}-${stamp}.json"
  local out="/tmp/${file}"
  echo "==> [$orm] $scenario"
  # Poll /metrics in background to capture peak RSS during run
  local mem_log; mem_log=$(mktemp)
  ( while true; do curl -sf "$base_url/metrics" 2>/dev/null | jq '.rss_mb' >> "$mem_log" 2>/dev/null || true; sleep 2; done ) &
  local mem_pid=$!
  BASE_URL="$base_url" ORM="$orm" SCENARIO="$scenario" \
    k6 run --summary-export="$out" --quiet scenarios.js || echo "k6 returned non-zero (continuing)"
  kill "$mem_pid" 2>/dev/null || true
  local peak_rss
  peak_rss=$(sort -n "$mem_log" 2>/dev/null | tail -1)
  [ -z "$peak_rss" ] && peak_rss=0
  rm -f "$mem_log"
  local avg p50 p95 p99 rps fail
  avg=$(jq '.metrics.http_req_duration.avg' "$out")
  p50=$(jq '.metrics.http_req_duration["p(50)"]' "$out")
  p95=$(jq '.metrics.http_req_duration["p(95)"]' "$out")
  p99=$(jq '.metrics.http_req_duration["p(99)"]' "$out")
  rps=$(jq '.metrics.http_reqs.rate' "$out")
  fail=$(jq '(.metrics.http_req_failed.rate // 0) * 100' "$out")
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO bench_runs (orm, scenario, file, ran_at, avg_ms, p50_ms, p95_ms, p99_ms, rps, fail_pct, peak_rss_mb)
     VALUES ('$orm','$scenario','$file', now(), $avg, $p50, $p95, $p99, $rps, $fail, $peak_rss)
     ON CONFLICT (file) DO NOTHING;"
  # Clean up bulk-inserted rows so the volume doesn't grow unbounded
  if [ "$scenario" = "bulk-insert" ]; then
    local target_db
    case "$orm" in
      prisma)  target_db="bench_prisma" ;;
      typeorm) target_db="bench_typeorm" ;;
      drizzle) target_db="bench_drizzle" ;;
    esac
    local cleanup_url; cleanup_url=$(echo "$DATABASE_URL" | sed "s|/railway$|/${target_db}|")
    psql "$cleanup_url" -c "DELETE FROM \"Post\" WHERE title LIKE 'bulk %'; VACUUM \"Post\";" >/dev/null 2>&1 || true
  fi
  sleep 10
}

for r in $(seq 1 "$RUNS"); do
  echo "===== RUN $r/$RUNS ====="
  for s in "${SCENARIOS[@]}"; do
    run_one prisma  "$s" "$PRISMA_API_URL"
    run_one typeorm "$s" "$TYPEORM_API_URL"
    run_one drizzle "$s" "$DRIZZLE_API_URL"
  done
done

echo "==> done. Query: SELECT * FROM bench_runs ORDER BY ran_at DESC;"
