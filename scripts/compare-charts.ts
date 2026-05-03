import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const RESULTS = join(__dirname, '..', 'load', 'results');
const SCENARIOS = ['simple-lookup', 'relations', 'pagination', 'fulltext', 'n-plus-1', 'bulk-insert', 'deep-nested', 'raw-aggregation'] as const;
const METRICS = ['avg', 'p50', 'p95', 'p99', 'rps', 'failPct'] as const;

type Metric = (typeof METRICS)[number];
type Stats = Record<Metric, number>;
type Orm = 'prisma' | 'typeorm';

const loadSummary = (file: string): Stats => {
  const json = JSON.parse(readFileSync(file, 'utf-8'));
  const m = json.metrics.http_req_duration.values;
  return {
    avg: m.avg,
    p50: m['p(50)'],
    p95: m['p(95)'],
    p99: m['p(99)'],
    rps: json.metrics.http_reqs.values.rate,
    failPct: (json.metrics.http_req_failed.values.rate ?? 0) * 100,
  };
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const collect = (orm: Orm, scenario: string): Stats | null => {
  const files = readdirSync(RESULTS).filter((f) => f.startsWith(`${orm}-${scenario}`) && f.endsWith('.json'));
  if (!files.length) return null;
  const runs = files.map((f) => loadSummary(join(RESULTS, f)));
  return Object.fromEntries(METRICS.map((k) => [k, mean(runs.map((r) => r[k]))])) as Stats;
};

const data = SCENARIOS.map((s) => ({ scenario: s, prisma: collect('prisma', s), typeorm: collect('typeorm', s) }));

const labels = JSON.stringify(SCENARIOS);
const series = (orm: Orm, metric: Metric) => JSON.stringify(data.map((d) => d[orm]?.[metric] ?? null));

const chartBlock = (metric: Metric, title: string, unit: string) => `
  <div class="chart"><h2>${title}</h2><canvas id="c-${metric}"></canvas></div>
  <script>
    new Chart(document.getElementById('c-${metric}'), {
      type: 'bar',
      data: {
        labels: ${labels},
        datasets: [
          { label: 'Prisma', data: ${series('prisma', metric)}, backgroundColor: '#5a67d8' },
          { label: 'TypeORM', data: ${series('typeorm', metric)}, backgroundColor: '#ed8936' },
        ],
      },
      options: {
        responsive: true,
        plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(2) + '${unit}' } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: '${title} (${unit})' } } },
      },
    });
  </script>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Prisma vs TypeORM</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  .chart { margin: 2rem 0; }
  h1 { margin-bottom: 0; }
  .meta { color: #666; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Prisma vs TypeORM Benchmark</h1>
<p class="meta">Generated ${new Date().toISOString()}. Lower latency better. Higher RPS better.</p>
${chartBlock('avg', 'Average latency', 'ms')}
${chartBlock('p50', 'p50 latency', 'ms')}
${chartBlock('p95', 'p95 latency', 'ms')}
${chartBlock('p99', 'p99 latency', 'ms')}
${chartBlock('rps', 'Requests per second', '')}
${chartBlock('failPct', 'Error rate', '%')}
</body>
</html>
`;

const out = join(__dirname, '..', 'RESULTS.html');
writeFileSync(out, html);
console.log(`wrote ${out}`);
