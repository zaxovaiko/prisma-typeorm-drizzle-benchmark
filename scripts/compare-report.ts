import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Reads load/results/*.json (k6 summaries, may be multiple per orm/scenario from RUNS),
// averages metrics, emits RESULTS.md with side-by-side comparison.

const RESULTS = join(__dirname, '..', 'load', 'results');
const SCENARIOS = ['simple-lookup', 'relations', 'pagination', 'fulltext', 'n-plus-1', 'bulk-insert', 'deep-nested', 'raw-aggregation'];

type Stats = { avg: number; p50: number; p95: number; p99: number; rps: number; failPct: number; n: number };

function loadSummary(file: string) {
  const json = JSON.parse(readFileSync(file, 'utf-8'));
  const m = json.metrics.http_req_duration.values;
  const reqs = json.metrics.http_reqs.values;
  return {
    avg: m.avg,
    p50: m['p(50)'],
    p95: m['p(95)'],
    p99: m['p(99)'],
    rps: reqs.rate,
    failPct: (json.metrics.http_req_failed.values.rate ?? 0) * 100,
  };
}

function avg(stats: Omit<Stats, 'n'>[]): Stats {
  const n = stats.length;
  const sum = stats.reduce(
    (a, s) => ({ avg: a.avg + s.avg, p50: a.p50 + s.p50, p95: a.p95 + s.p95, p99: a.p99 + s.p99, rps: a.rps + s.rps, failPct: a.failPct + s.failPct }),
    { avg: 0, p50: 0, p95: 0, p99: 0, rps: 0, failPct: 0 },
  );
  return { avg: sum.avg / n, p50: sum.p50 / n, p95: sum.p95 / n, p99: sum.p99 / n, rps: sum.rps / n, failPct: sum.failPct / n, n };
}

function collect(orm: 'prisma' | 'typeorm', scenario: string): Stats | null {
  const files = readdirSync(RESULTS).filter((f) => f.startsWith(`${orm}-${scenario}`) && f.endsWith('.json'));
  if (!files.length) return null;
  return avg(files.map((f) => loadSummary(join(RESULTS, f))));
}

function fmt(n: number, unit = 'ms') {
  return `${n.toFixed(1)}${unit}`;
}

function delta(p: number, t: number) {
  if (!p || !t) return '-';
  const pct = ((p - t) / t) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

const lines: string[] = [];
lines.push('# Benchmark Results: Prisma vs TypeORM\n');
lines.push(`Generated: ${new Date().toISOString()}\n`);
lines.push('Lower latency = better. RPS higher = better. Δ shown as Prisma vs TypeORM.\n');
lines.push('| Scenario | Metric | Prisma | TypeORM | Δ |');
lines.push('|---|---|---:|---:|---:|');

for (const s of SCENARIOS) {
  const p = collect('prisma', s);
  const t = collect('typeorm', s);
  if (!p || !t) {
    lines.push(`| ${s} | - | missing | missing | - |`);
    continue;
  }
  lines.push(`| ${s} | avg   | ${fmt(p.avg)} | ${fmt(t.avg)} | ${delta(p.avg, t.avg)} |`);
  lines.push(`| ${s} | p50   | ${fmt(p.p50)} | ${fmt(t.p50)} | ${delta(p.p50, t.p50)} |`);
  lines.push(`| ${s} | p95   | ${fmt(p.p95)} | ${fmt(t.p95)} | ${delta(p.p95, t.p95)} |`);
  lines.push(`| ${s} | p99   | ${fmt(p.p99)} | ${fmt(t.p99)} | ${delta(p.p99, t.p99)} |`);
  lines.push(`| ${s} | rps   | ${fmt(p.rps, '')} | ${fmt(t.rps, '')} | ${delta(t.rps, p.rps)} |`);
  lines.push(`| ${s} | err%  | ${fmt(p.failPct, '%')} | ${fmt(t.failPct, '%')} | - |`);
}

const out = lines.join('\n') + '\n';
writeFileSync(join(__dirname, '..', 'RESULTS.md'), out);
console.log(out);
