#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SCENARIOS=(simple-lookup relations pagination fulltext n-plus-1 bulk-insert deep-nested raw-aggregation)
RUNS=${RUNS:-3}

mkdir -p load/results

echo "==> bringing stack up"
docker compose up -d --build postgres prisma-api typeorm-api prometheus grafana postgres-exporter cadvisor

echo "==> waiting for APIs"
for url in http://localhost:3001/health http://localhost:3002/health; do
  for i in {1..60}; do
    if curl -sf "$url" >/dev/null; then break; fi
    sleep 2
  done
  curl -sf "$url" >/dev/null || { echo "API never became healthy: $url"; exit 1; }
done

echo "==> seeding (idempotent)"
DATABASE_URL_PRISMA="postgresql://bench:bench@localhost:5432/bench_prisma" \
DATABASE_URL_TYPEORM="postgresql://bench:bench@localhost:5432/bench_typeorm" \
pnpm seed

run_scenario() {
  local orm="$1"
  local scenario="$2"
  local base_url="$3"
  echo "==> [$orm] $scenario"
  docker compose run --rm \
    -e BASE_URL="$base_url" \
    -e ORM="$orm" \
    -e SCENARIO="$scenario" \
    -e K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
    -e K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true \
    k6 "k6 run -o experimental-prometheus-rw --summary-export=/results/${orm}-${scenario}-$(date +%s).json /scripts/scenarios.js"
  # cooldown between runs
  sleep 10
}

# vacuum analyze before measuring
echo "==> VACUUM ANALYZE"
docker compose exec -T postgres psql -U bench -d bench_prisma -c "VACUUM ANALYZE"
docker compose exec -T postgres psql -U bench -d bench_typeorm -c "VACUUM ANALYZE"

for ((r = 1; r <= RUNS; r++)); do
  echo "===== RUN $r/$RUNS ====="
  for s in "${SCENARIOS[@]}"; do
    # alternate to avoid systematic cache bias
    run_scenario prisma  "$s" "http://prisma-api:3001"
    run_scenario typeorm "$s" "http://typeorm-api:3002"
  done
done

echo "==> generating report"
pnpm report

echo "==> done. open http://localhost:3030 (Grafana, anonymous Admin)"
