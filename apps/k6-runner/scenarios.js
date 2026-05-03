// Shared scenario library. Picked via SCENARIO env var.
// Tags every metric with orm + scenario so Grafana can split panels.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const ORM = __ENV.ORM || 'prisma';
const SCENARIO = __ENV.SCENARIO || 'simple-lookup';

const N_USERS = Number(__ENV.N_USERS || 10000);
const N_POSTS = Number(__ENV.N_POSTS || 100000);
const SEARCH_TERMS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'lambda', 'sigma'];

// Per-scenario VU caps. Heavy endpoints (N+1, bulk write, fulltext rank) saturate
// the 20-conn pool well below 500 VUs, so they get smaller targets to measure
// throughput at a fair load instead of timing out.
const VU_PROFILES = {
  'simple-lookup':   { warm: 100, peak: 500 },
  'relations':       { warm: 100, peak: 500 },
  'pagination':      { warm: 100, peak: 500 },
  'raw-aggregation': { warm: 50,  peak: 200 },
  'deep-nested':     { warm: 50,  peak: 200 },
  'fulltext':        { warm: 25,  peak: 100 },
  'n-plus-1':        { warm: 25,  peak: 100 },
  'bulk-insert':     { warm: 5,   peak: 20  },
  'cursor':          { warm: 100, peak: 500 },
  'complex-filter':  { warm: 50,  peak: 200 },
  'delete':          { warm: 25,  peak: 100 },
  'transaction':     { warm: 25,  peak: 100 },
};

const profile = VU_PROFILES[SCENARIO] ?? { warm: 100, peak: 500 };

export const options = {
  scenarios: {
    main: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: profile.warm },
        { duration: '60s', target: profile.peak },
        { duration: '10s', target: 0 },
      ],
      gracefulStop: '5s',
    },
  },
  tags: { orm: ORM, scenario: SCENARIO },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
};

function randInt(max) {
  return Math.floor(Math.random() * max) + 1;
}

const RUNNERS = {
  'simple-lookup': () => http.get(`${BASE_URL}/users/${randInt(N_USERS)}`),
  'relations': () => http.get(`${BASE_URL}/posts/${randInt(N_POSTS)}/full`),
  'pagination': () => http.get(`${BASE_URL}/posts?page=${randInt(50)}&limit=50`),
  'fulltext': () => http.get(`${BASE_URL}/search?q=${SEARCH_TERMS[randInt(SEARCH_TERMS.length) - 1]}`),
  'n-plus-1': () => http.get(`${BASE_URL}/users/${randInt(N_USERS)}/feed`),
  'bulk-insert': () => http.post(
    `${BASE_URL}/posts/bulk`,
    JSON.stringify({ authorId: randInt(N_USERS), count: 20 }),
    { headers: { 'Content-Type': 'application/json' } },
  ),
  'deep-nested': () => http.get(`${BASE_URL}/categories/tree`),
  'raw-aggregation': () => http.get(`${BASE_URL}/raw/top-authors`),
  'cursor': () => http.get(`${BASE_URL}/posts/cursor?cursor=${randInt(N_POSTS)}&limit=50`),
  'complex-filter': () => http.get(`${BASE_URL}/posts/filter?term=${SEARCH_TERMS[randInt(SEARCH_TERMS.length) - 1]}`),
  'delete': () => http.post(
    `${BASE_URL}/posts/delete-by-author/${randInt(N_USERS)}`,
    null,
    { headers: { 'Content-Type': 'application/json' } },
  ),
  'transaction': () => http.post(
    `${BASE_URL}/tx/post-with-comments`,
    JSON.stringify({ authorId: randInt(N_USERS) }),
    { headers: { 'Content-Type': 'application/json' } },
  ),
};

export default function () {
  const fn = RUNNERS[SCENARIO];
  if (!fn) throw new Error(`unknown scenario ${SCENARIO}`);
  const res = fn();
  check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });
}

export function handleSummary(data) {
  return {
    [`/results/${ORM}-${SCENARIO}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics.http_req_duration;
  const reqs = data.metrics.http_reqs;
  return `\n=== ${ORM} :: ${SCENARIO} ===\n` +
    `  reqs: ${reqs.values.count} @ ${reqs.values.rate.toFixed(1)}/s\n` +
    `  avg=${m.values.avg.toFixed(1)}ms  p50=${m.values['p(50)'].toFixed(1)}ms  p95=${m.values['p(95)'].toFixed(1)}ms  p99=${m.values['p(99)'].toFixed(1)}ms\n` +
    `  failed: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
}
