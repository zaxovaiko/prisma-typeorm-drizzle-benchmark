import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller()
export class BenchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health() {
    return { ok: true, orm: 'prisma' };
  }

  // 1. Simple lookup - findFirst avoids Prisma's LIMIT/OFFSET wrapping on findUnique
  @Get('users/:id')
  user(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.user.findFirst({ where: { id } });
  }

  // 2. Complex with relations
  @Get('posts/:id/full')
  postFull(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.post.findUnique({
      where: { id },
      include: {
        author: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'desc' }, take: 20 },
        categories: true,
      },
      relationLoadStrategy: 'join',
    } as any);
  }

  // 3. Pagination - parity with TypeORM's loadRelationCountAndMap (separate batched count query)
  @Get('posts')
  async posts(@Query('page') page = '1', @Query('limit') limit = '50') {
    const take = Math.min(Number(limit), 100);
    const skip = (Number(page) - 1) * take;
    const posts = await this.prisma.post.findMany({
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { author: true },
      relationLoadStrategy: 'join',
    } as any);
    if (!posts.length) return [];
    const ids = posts.map((p: { id: number }) => p.id);
    const counts: { postId: number; n: bigint }[] = await this.prisma.$queryRawUnsafe(
      `SELECT "postId", COUNT(*)::bigint AS n FROM "Comment" WHERE "postId" = ANY($1::int[]) GROUP BY "postId"`,
      ids,
    );
    const byPost = new Map(counts.map((c: { postId: number; n: bigint }) => [c.postId, Number(c.n)]));
    return posts.map((p: { id: number }) => ({ ...p, commentsCount: byPost.get(p.id) ?? 0 }));
  }

  // 4. Full-text search
  @Get('search')
  async search(@Query('q') q: string) {
    if (!q) return [];
    return this.prisma.$queryRawUnsafe(
      `SELECT id, title, ts_rank(to_tsvector('english', title || ' ' || body), plainto_tsquery('english', $1)) AS rank
       FROM "Post"
       WHERE to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC LIMIT 50`,
      q,
    );
  }

  // 5. Feed - parity with TypeORM (single batched query via window function for last 3 comments)
  @Get('users/:id/feed')
  async feed(@Param('id', ParseIntPipe) id: number) {
    const posts = await this.prisma.post.findMany({
      where: { authorId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (!posts.length) return [];
    const ids = posts.map((p: { id: number }) => p.id);
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM (
         SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c."postId" ORDER BY c."createdAt" DESC) rn
         FROM "Comment" c WHERE c."postId" = ANY($1::int[])
       ) t WHERE rn <= 3`,
      ids,
    );
    const byPost = new Map<number, any[]>();
    for (const r of rows) {
      const arr = byPost.get(r.postId) ?? [];
      arr.push(r);
      byPost.set(r.postId, arr);
    }
    return posts.map((p: { id: number }) => ({ ...p, lastComments: byPost.get(p.id) ?? [] }));
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
    return this.prisma.post.createMany({ data });
  }

  // 7. Deep nested
  @Get('categories/tree')
  categoriesTree() {
    return this.prisma.category.findMany({
      include: {
        posts: {
          take: 5,
          include: {
            author: true,
            comments: { take: 3, include: { author: true } },
          },
        },
      },
      take: 20,
      relationLoadStrategy: 'join',
    } as any);
  }

  // 8. Raw aggregation
  @Get('raw/top-authors')
  topAuthors() {
    return this.prisma.$queryRawUnsafe(
      `SELECT u.id, u.name, COUNT(p.id)::int AS post_count
       FROM "User" u
       JOIN "Post" p ON p."authorId" = u.id
       GROUP BY u.id, u.name
       ORDER BY post_count DESC
       LIMIT 25`,
    );
  }

  // 9. Cursor pagination - direct WHERE id < $1 (parity with TypeORM, avoids Prisma's cursor:{} subquery wrapping)
  @Get('posts/cursor')
  postsCursor(@Query('cursor') cursor?: string, @Query('limit') limit = '50') {
    const take = Math.min(Number(limit), 100);
    return this.prisma.post.findMany({
      take,
      ...(cursor ? { where: { id: { lt: Number(cursor) } } } : {}),
      orderBy: { id: 'desc' },
    });
  }

  // 10. Complex filter - OR + range + nested relation predicate
  @Get('posts/filter')
  postsFilter(@Query('term') term = 'alpha') {
    return this.prisma.post.findMany({
      where: {
        AND: [
          {
            OR: [
              { title: { contains: term, mode: 'insensitive' } },
              { body: { contains: term, mode: 'insensitive' } },
            ],
          },
          { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
          { author: { posts: { some: { id: { gt: 0 } } } } },
        ],
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  }

  // 11. Delete - bulk delete by predicate (idempotent: insert N then delete N)
  @Post('posts/delete-by-author/:id')
  async deleteByAuthor(@Param('id', ParseIntPipe) id: number) {
    const stamp = Date.now();
    await this.prisma.post.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        title: `del-${id}-${stamp}-${i}`,
        body: 'x',
        authorId: id,
      })),
    });
    const r = await this.prisma.post.deleteMany({
      where: { authorId: id, title: { startsWith: `del-${id}-${stamp}-` } },
    });
    return { deleted: r.count };
  }

  // 12. Transaction - create post + 3 comments atomically
  @Post('tx/post-with-comments')
  txPostWithComments(@Body() b: { authorId: number }) {
    return this.prisma.$transaction(async (tx: any) => {
      const post = await tx.post.create({
        data: { title: `tx ${Date.now()}`, body: 'tx body', authorId: b.authorId },
      });
      await tx.comment.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          body: `c${i}`,
          postId: post.id,
          authorId: b.authorId,
        })),
      });
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
