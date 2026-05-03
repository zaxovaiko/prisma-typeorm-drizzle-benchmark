import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const RESULTS = join(__dirname, '..', 'load', 'results');
const ORMS = ['prisma', 'typeorm'] as const;

const DDL = `
  CREATE TABLE IF NOT EXISTS bench_runs (
    id           bigserial PRIMARY KEY,
    orm          text not null,
    scenario     text not null,
    file         text not null unique,
    ran_at       timestamptz not null,
    avg_ms       double precision,
    p50_ms       double precision,
    p95_ms       double precision,
    p99_ms       double precision,
    rps          double precision,
    fail_pct     double precision
  );
  CREATE INDEX IF NOT EXISTS bench_runs_scenario_orm_idx ON bench_runs (scenario, orm, ran_at DESC);
`;

type Row = {
  orm: string;
  scenario: string;
  file: string;
  ran_at: Date;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  rps: number;
  fail_pct: number;
};

const parseFile = (file: string): Row | null => {
  const base = file.replace(/\.json$/, '');
  const orm = ORMS.find((o) => base.startsWith(`${o}-`));
  if (!orm) return null;
  const rest = base.slice(orm.length + 1);
  // scenario name may include extra suffix like -<timestamp>; take known scenario prefix or full
  const scenario = rest.replace(/-\d{8,}.*$/, '');
  const full = join(RESULTS, file);
  const json = JSON.parse(readFileSync(full, 'utf-8'));
  const m = json.metrics.http_req_duration.values;
  return {
    orm,
    scenario,
    file,
    ran_at: statSync(full).mtime,
    avg_ms: m.avg,
    p50_ms: m['p(50)'],
    p95_ms: m['p(95)'],
    p99_ms: m['p(99)'],
    rps: json.metrics.http_reqs.values.rate,
    fail_pct: (json.metrics.http_req_failed.values.rate ?? 0) * 100,
  };
};

const main = async () => {
  const client = new Client({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'bench',
    password: process.env.POSTGRES_PASSWORD ?? 'bench',
    database: 'postgres',
  });
  await client.connect();
  await client.query(DDL);

  const rows = readdirSync(RESULTS)
    .filter((f) => f.endsWith('.json'))
    .map(parseFile)
    .filter((r): r is Row => r !== null);

  for (const r of rows) {
    await client.query(
      `INSERT INTO bench_runs (orm, scenario, file, ran_at, avg_ms, p50_ms, p95_ms, p99_ms, rps, fail_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (file) DO UPDATE SET
         ran_at=EXCLUDED.ran_at, avg_ms=EXCLUDED.avg_ms, p50_ms=EXCLUDED.p50_ms,
         p95_ms=EXCLUDED.p95_ms, p99_ms=EXCLUDED.p99_ms, rps=EXCLUDED.rps, fail_pct=EXCLUDED.fail_pct`,
      [r.orm, r.scenario, r.file, r.ran_at, r.avg_ms, r.p50_ms, r.p95_ms, r.p99_ms, r.rps, r.fail_pct],
    );
  }

  console.log(`loaded ${rows.length} rows`);
  await client.end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
