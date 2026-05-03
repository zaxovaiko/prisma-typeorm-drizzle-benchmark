import { Client } from 'pg';

// Idempotent deterministic seeder. Creates schema if missing, then inserts identical data into both DBs.
// Uses raw SQL so both ORMs see exactly the same byte-for-byte rows.

const DBS = [
  process.env.DATABASE_URL_PRISMA ?? 'postgresql://bench:bench@localhost:5432/bench_prisma',
  process.env.DATABASE_URL_TYPEORM ?? 'postgresql://bench:bench@localhost:5432/bench_typeorm',
  process.env.DATABASE_URL_DRIZZLE ?? 'postgresql://bench:bench@localhost:5432/bench_drizzle',
];

const N_USERS = Number(process.env.N_USERS ?? 10_000);
const N_POSTS = Number(process.env.N_POSTS ?? 100_000);
const N_COMMENTS = Number(process.env.N_COMMENTS ?? 500_000);
const N_CATEGORIES = Number(process.env.N_CATEGORIES ?? 50);
const SEED = 42;

// Deterministic LCG
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "User" (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS "Category" (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS "Post" (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  "authorId" INT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Post_authorId_idx" ON "Post"("authorId");
CREATE INDEX IF NOT EXISTS "Post_createdAt_idx" ON "Post"("createdAt");
CREATE INDEX IF NOT EXISTS "Post_tsv_idx" ON "Post" USING GIN (to_tsvector('english', title || ' ' || body));
CREATE TABLE IF NOT EXISTS "Comment" (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  "postId" INT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
  "authorId" INT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Comment_postId_idx" ON "Comment"("postId");
CREATE INDEX IF NOT EXISTS "Comment_authorId_idx" ON "Comment"("authorId");
CREATE TABLE IF NOT EXISTS "_PostCategories" (
  "A" INT NOT NULL REFERENCES "Post"(id) ON DELETE CASCADE,
  "B" INT NOT NULL REFERENCES "Category"(id) ON DELETE CASCADE,
  PRIMARY KEY ("A", "B")
);
CREATE INDEX IF NOT EXISTS "_PostCategories_B_idx" ON "_PostCategories"("B");
`;

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon'];

function sentence(rand: () => number, n = 12) {
  return Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ');
}

async function seedDb(url: string) {
  console.log(`\n=== seeding ${url} ===`);
  const c = new Client({ connectionString: url });
  await c.connect();

  await c.query(SCHEMA_SQL);

  const counts = await c.query(`SELECT (SELECT count(*) FROM "User") AS u, (SELECT count(*) FROM "Post") AS p, (SELECT count(*) FROM "Comment") AS co`);
  if (Number(counts.rows[0].u) >= N_USERS && Number(counts.rows[0].p) >= N_POSTS) {
    console.log(`already seeded (users=${counts.rows[0].u}, posts=${counts.rows[0].p}, comments=${counts.rows[0].co}) — skip`);
    await c.end();
    return;
  }

  console.log('truncating');
  await c.query(`TRUNCATE "User", "Post", "Comment", "Category", "_PostCategories" RESTART IDENTITY CASCADE`);

  const rand = rng(SEED);

  console.log(`inserting ${N_CATEGORIES} categories`);
  const catVals = Array.from({ length: N_CATEGORIES }, (_, i) => `('cat-${i}')`).join(',');
  await c.query(`INSERT INTO "Category"(name) VALUES ${catVals}`);

  console.log(`inserting ${N_USERS} users`);
  await c.query('BEGIN');
  for (let i = 0; i < N_USERS; i += 1000) {
    const batch = Math.min(1000, N_USERS - i);
    const params: any[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch; j++) {
      const idx = i + j;
      params.push(`user${idx}@bench.local`, `User ${idx}`);
      placeholders.push(`($${j * 2 + 1}, $${j * 2 + 2})`);
    }
    await c.query(`INSERT INTO "User"(email, name) VALUES ${placeholders.join(',')}`, params);
  }
  await c.query('COMMIT');

  console.log(`inserting ${N_POSTS} posts`);
  await c.query('BEGIN');
  for (let i = 0; i < N_POSTS; i += 2000) {
    const batch = Math.min(2000, N_POSTS - i);
    const params: any[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch; j++) {
      const idx = i + j;
      const authorId = Math.floor(rand() * N_USERS) + 1;
      params.push(`post-${idx} ${sentence(rand, 4)}`, sentence(rand, 30), authorId);
      const p = j * 3;
      placeholders.push(`($${p + 1}, $${p + 2}, $${p + 3})`);
    }
    await c.query(`INSERT INTO "Post"(title, body, "authorId") VALUES ${placeholders.join(',')}`, params);
  }
  await c.query('COMMIT');

  console.log(`inserting ${N_COMMENTS} comments`);
  await c.query('BEGIN');
  for (let i = 0; i < N_COMMENTS; i += 2000) {
    const batch = Math.min(2000, N_COMMENTS - i);
    const params: any[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch; j++) {
      const postId = Math.floor(rand() * N_POSTS) + 1;
      const authorId = Math.floor(rand() * N_USERS) + 1;
      params.push(sentence(rand, 15), postId, authorId);
      const p = j * 3;
      placeholders.push(`($${p + 1}, $${p + 2}, $${p + 3})`);
    }
    await c.query(`INSERT INTO "Comment"(body, "postId", "authorId") VALUES ${placeholders.join(',')}`, params);
  }
  await c.query('COMMIT');

  console.log('linking posts <-> categories (20% of posts get 2 categories)');
  await c.query('BEGIN');
  const linkBatch: { a: number; b: number; c: number }[] = [];
  for (let i = 1; i <= N_POSTS; i += 1) {
    if (i % 5 !== 0) continue;
    const a = Math.floor(rand() * N_CATEGORIES) + 1;
    const b = ((a + Math.floor(rand() * 5)) % N_CATEGORIES) + 1;
    linkBatch.push({ a: i, b: a, c: b });
    if (linkBatch.length >= 2000) {
      const params: any[] = [];
      const placeholders: string[] = [];
      linkBatch.forEach((row, k) => {
        params.push(row.a, row.b, row.a, row.c);
        const p = k * 4;
        placeholders.push(`($${p + 1},$${p + 2})`, `($${p + 3},$${p + 4})`);
      });
      await c.query(`INSERT INTO "_PostCategories"("A","B") VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`, params);
      linkBatch.length = 0;
    }
  }
  if (linkBatch.length) {
    const params: any[] = [];
    const placeholders: string[] = [];
    linkBatch.forEach((row, k) => {
      params.push(row.a, row.b, row.a, row.c);
      const p = k * 4;
      placeholders.push(`($${p + 1},$${p + 2})`, `($${p + 3},$${p + 4})`);
    });
    await c.query(`INSERT INTO "_PostCategories"("A","B") VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`, params);
  }
  await c.query('COMMIT');

  console.log('VACUUM ANALYZE');
  await c.query('VACUUM ANALYZE');

  await c.end();
  console.log('done');
}

(async () => {
  for (const url of DBS) {
    await seedDb(url);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
