import { writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const SCENARIOS = [
  'simple-lookup', 'relations', 'pagination', 'fulltext', 'n-plus-1',
  'bulk-insert', 'deep-nested', 'raw-aggregation',
  'cursor', 'complex-filter', 'delete', 'transaction',
] as const;
const METRICS = ['avg_ms', 'p50_ms', 'p95_ms', 'p99_ms', 'rps', 'fail_pct', 'peak_rss_mb'] as const;

type Metric = (typeof METRICS)[number];
type Orm = 'prisma' | 'typeorm' | 'drizzle';
type Row = { orm: Orm; scenario: string } & Record<Metric, number>;

const ORM_COLORS: Record<Orm, string> = {
  prisma: '#5a67d8',
  typeorm: '#ed8936',
  drizzle: '#38a169',
};

const CHART_TITLES: Record<Metric, { title: string; unit: string }> = {
  avg_ms: { title: 'Average latency', unit: 'ms' },
  p50_ms: { title: 'p50 latency', unit: 'ms' },
  p95_ms: { title: 'p95 latency', unit: 'ms' },
  p99_ms: { title: 'p99 latency', unit: 'ms' },
  rps: { title: 'Requests per second', unit: '' },
  fail_pct: { title: 'Error rate', unit: '%' },
  peak_rss_mb: { title: 'Peak RSS memory', unit: 'MB' },
};

const main = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<Row>(
    `SELECT orm, scenario,
            AVG(avg_ms) AS avg_ms, AVG(p50_ms) AS p50_ms,
            AVG(p95_ms) AS p95_ms, AVG(p99_ms) AS p99_ms,
            AVG(rps)    AS rps,    AVG(fail_pct) AS fail_pct,
            AVG(peak_rss_mb) AS peak_rss_mb
     FROM bench_runs GROUP BY orm, scenario ORDER BY scenario, orm`,
  );
  await client.end();

  const lookup = (orm: Orm, s: string, m: Metric) =>
    rows.find((r) => r.orm === orm && r.scenario === s)?.[m] ?? null;

  const series = (orm: Orm, m: Metric) => JSON.stringify(SCENARIOS.map((s) => lookup(orm, s, m)));
  const labels = JSON.stringify(SCENARIOS);

  const chart = (m: Metric) => {
    const { title, unit } = CHART_TITLES[m];
    return `
  <div class="chart"><h2>${title}</h2><canvas id="c-${m}"></canvas></div>
  <script>
    new Chart(document.getElementById('c-${m}'), {
      type: 'bar',
      data: {
        labels: ${labels},
        datasets: [
          { label: 'Prisma',  data: ${series('prisma', m)},  backgroundColor: '${ORM_COLORS.prisma}' },
          { label: 'TypeORM', data: ${series('typeorm', m)}, backgroundColor: '${ORM_COLORS.typeorm}' },
          { label: 'Drizzle', data: ${series('drizzle', m)}, backgroundColor: '${ORM_COLORS.drizzle}' },
        ],
      },
      options: {
        responsive: true,
        plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(2) + '${unit}' } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: '${title} (${unit})' } } },
      },
    });
  </script>`;
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Prisma vs TypeORM vs Drizzle (Railway)</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  .chart { margin: 2rem 0; }
  .meta { color: #666; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Prisma vs TypeORM vs Drizzle Benchmark (Railway)</h1>
<p class="meta">Generated ${new Date().toISOString()}. Aggregated mean across all runs in bench_runs.</p>
${METRICS.map(chart).join('\n')}
</body>
</html>
`;
  const out = join(__dirname, '..', 'RESULTS.html');
  writeFileSync(out, html);
  console.log(`wrote ${out} (${rows.length} aggregated rows)`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
