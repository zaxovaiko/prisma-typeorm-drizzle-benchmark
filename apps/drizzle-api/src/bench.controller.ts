import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, like, lt, or, sql } from 'drizzle-orm';
import { DrizzleService } from './drizzle.service';
import { categories, comments, postCategories, posts, users } from './schema';

@Controller()
export class BenchController {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  @Get('health')
  health() {
    return { ok: true, orm: 'drizzle' };
  }

  // 1. Simple lookup
  @Get('users/:id')
  user(@Param('id', ParseIntPipe) id: number) {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  // 2. Complex with relations - relational query API emits a single SQL with json_agg subqueries
  @Get('posts/:id/full')
  postFull(@Param('id', ParseIntPipe) id: number) {
    return this.db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: {
        author: true,
        comments: {
          with: { author: true },
          orderBy: desc(comments.createdAt),
          limit: 20,
        },
        postCategories: {
          with: { category: true },
        },
      },
    });
  }

  // 3. Pagination - parity with Prisma/TypeORM (separate batched count keyed to page IDs)
  @Get('posts')
  async posts(@Query('page') page = '1', @Query('limit') limit = '50') {
    const take = Math.min(Number(limit), 100);
    const skip = (Number(page) - 1) * take;
    const rows = await this.db.query.posts.findMany({
      with: { author: true },
      orderBy: desc(posts.createdAt),
      limit: take,
      offset: skip,
    });
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const countRows = await this.db
      .select({ postId: comments.postId, n: sql<number>`COUNT(*)::int` })
      .from(comments)
      .where(inArray(comments.postId, ids))
      .groupBy(comments.postId);
    const byPost = new Map(countRows.map((c) => [c.postId, Number(c.n)]));
    return rows.map((p) => ({ ...p, commentsCount: byPost.get(p.id) ?? 0 }));
  }

  // 4. Full-text search - identical raw SQL across all 3 ORMs
  @Get('search')
  async search(@Query('q') q: string) {
    if (!q) return [];
    const result = await this.db.execute(sql`
      SELECT id, title, ts_rank(to_tsvector('english', title || ' ' || body), plainto_tsquery('english', ${q})) AS rank
      FROM "Post"
      WHERE to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC LIMIT 50
    `);
    return result.rows;
  }

  // 5. Feed - parity with TypeORM/Prisma (single batched query via window function for last 3 comments)
  @Get('users/:id/feed')
  async feed(@Param('id', ParseIntPipe) id: number) {
    const userPosts = await this.db.query.posts.findMany({
      where: eq(posts.authorId, id),
      orderBy: desc(posts.createdAt),
      limit: 20,
    });
    if (!userPosts.length) return [];
    const ids = userPosts.map((p) => p.id);
    const result = await this.db.execute(sql`
      SELECT * FROM (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c."postId" ORDER BY c."createdAt" DESC) rn
        FROM "Comment" c WHERE c."postId" = ANY(${ids}::int[])
      ) t WHERE rn <= 3
    `);
    const byPost = new Map<number, any[]>();
    for (const r of result.rows as any[]) {
      const arr = byPost.get(r.postId) ?? [];
      arr.push(r);
      byPost.set(r.postId, arr);
    }
    return userPosts.map((p) => ({ ...p, lastComments: byPost.get(p.id) ?? [] }));
  }

  // 6. Bulk insert
  @Post('posts/bulk')
  async bulkInsert(@Body() body: { authorId: number; count?: number }) {
    const count = Math.min(body.count ?? 1000, 5000);
    const data = Array.from({ length: count }, (_, i) => ({
      title: `bulk ${Date.now()}-${i}`,
      body: 'bulk body content for benchmarking purposes',
      authorId: body.authorId,
    }));
    const result = await this.db.insert(posts).values(data).returning({ id: posts.id });
    return { count: result.length };
  }

  // 7. Deep nested
  @Get('categories/tree')
  categoriesTree() {
    return this.db.query.categories.findMany({
      with: {
        postCategories: {
          limit: 5,
          with: {
            post: {
              with: {
                author: true,
                comments: {
                  limit: 3,
                  with: { author: true },
                },
              },
            },
          },
        },
      },
      limit: 20,
    });
  }

  // 8. Raw aggregation - identical SQL across all 3 ORMs
  @Get('raw/top-authors')
  async topAuthors() {
    const result = await this.db.execute(sql`
      SELECT u.id, u.name, COUNT(p.id)::int AS post_count
      FROM "User" u
      JOIN "Post" p ON p."authorId" = u.id
      GROUP BY u.id, u.name
      ORDER BY post_count DESC
      LIMIT 25
    `);
    return result.rows;
  }

  // 9. Cursor pagination - direct WHERE id < $1 (parity with TypeORM)
  @Get('posts/cursor')
  postsCursor(@Query('cursor') cursor?: string, @Query('limit') limit = '50') {
    const take = Math.min(Number(limit), 100);
    return this.db.query.posts.findMany({
      where: cursor ? lt(posts.id, Number(cursor)) : undefined,
      orderBy: desc(posts.id),
      limit: take,
    });
  }

  // 10. Complex filter - OR + range + EXISTS
  @Get('posts/filter')
  postsFilter(@Query('term') term = 'alpha') {
    const since = new Date(Date.now() - 30 * 86400_000);
    const pattern = `%${term}%`;
    return this.db.query.posts.findMany({
      where: and(
        or(ilike(posts.title, pattern), ilike(posts.body, pattern)),
        gte(posts.createdAt, since),
        sql`EXISTS (SELECT 1 FROM "Post" pp WHERE pp."authorId" = ${posts.authorId} AND pp.id > 0)`,
      ),
      orderBy: desc(posts.createdAt),
      limit: 50,
    });
  }

  // 11. Delete - bulk delete by predicate (idempotent)
  @Post('posts/delete-by-author/:id')
  async deleteByAuthor(@Param('id', ParseIntPipe) id: number) {
    const stamp = Date.now();
    const data = Array.from({ length: 5 }, (_, i) => ({
      title: `del-${id}-${stamp}-${i}`,
      body: 'x',
      authorId: id,
    }));
    await this.db.insert(posts).values(data);
    const r = await this.db
      .delete(posts)
      .where(and(eq(posts.authorId, id), like(posts.title, `del-${id}-${stamp}-%`)))
      .returning({ id: posts.id });
    return { deleted: r.length };
  }

  // 12. Transaction - create post + 3 comments atomically
  @Post('tx/post-with-comments')
  async txPostWithComments(@Body() b: { authorId: number }) {
    return this.db.transaction(async (tx) => {
      const [post] = await tx
        .insert(posts)
        .values({ title: `tx ${Date.now()}`, body: 'tx body', authorId: b.authorId })
        .returning({ id: posts.id });
      await tx.insert(comments).values(
        Array.from({ length: 3 }, (_, i) => ({
          body: `c${i}`,
          postId: post.id,
          authorId: b.authorId,
        })),
      );
      return { id: post.id };
    });
  }

  // Process-level metrics for memory benchmarking
  @Get('metrics')
  metrics() {
    const m = process.memoryUsage();
    return {
      rss_mb: +(m.rss / 1048576).toFixed(2),
      heap_used_mb: +(m.heapUsed / 1048576).toFixed(2),
      heap_total_mb: +(m.heapTotal / 1048576).toFixed(2),
      external_mb: +(m.external / 1048576).toFixed(2),
    };
  }
}
