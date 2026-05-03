import { Body, Controller, Get, Param, ParseIntPipe, Post as HttpPost, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Category } from './entities/category.entity';

@Controller()
export class BenchController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Post) private posts: Repository<Post>,
    @InjectRepository(Comment) private comments: Repository<Comment>,
    @InjectRepository(Category) private categories: Repository<Category>,
    private ds: DataSource,
  ) {}

  @Get('health')
  health() {
    return { ok: true, orm: 'typeorm' };
  }

  // 1. Simple lookup
  @Get('users/:id')
  user(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne({ where: { id } });
  }

  // 2. Complex with relations - single query with joins (TypeORM strength)
  @Get('posts/:id/full')
  postFull(@Param('id', ParseIntPipe) id: number) {
    return this.posts
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.author', 'author')
      .leftJoinAndSelect('p.categories', 'categories')
      .leftJoinAndSelect('p.comments', 'comments')
      .leftJoinAndSelect('comments.author', 'commentAuthor')
      .where('p.id = :id', { id })
      .orderBy('comments.createdAt', 'DESC')
      .limit(20)
      .getOne();
  }

  // 3. Pagination
  @Get('posts')
  async list(@Query('page') page = '1', @Query('limit') limit = '50') {
    const take = Math.min(Number(limit), 100);
    const skip = (Number(page) - 1) * take;
    return this.posts
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.author', 'author')
      .loadRelationCountAndMap('p.commentsCount', 'p.comments')
      .orderBy('p.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getMany();
  }

  // 4. Full-text search
  @Get('search')
  async search(@Query('q') q: string) {
    if (!q) return [];
    return this.ds.query(
      `SELECT id, title, ts_rank(to_tsvector('english', title || ' ' || body), plainto_tsquery('english', $1)) AS rank
       FROM "Post"
       WHERE to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC LIMIT 50`,
      [q],
    );
  }

  // 5. N+1 trap: user feed - implement with single batched query (TypeORM advantage)
  @Get('users/:id/feed')
  async feed(@Param('id', ParseIntPipe) id: number) {
    const posts = await this.posts.find({
      where: { authorId: id },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    if (!posts.length) return [];
    const postIds = posts.map((p) => p.id);
    // Single query for last 3 comments per post via window function
    const rows: any[] = await this.ds.query(
      `SELECT * FROM (
         SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c."postId" ORDER BY c."createdAt" DESC) rn
         FROM "Comment" c WHERE c."postId" = ANY($1::int[])
       ) t WHERE rn <= 3`,
      [postIds],
    );
    const byPost = new Map<number, any[]>();
    for (const r of rows) {
      const arr = byPost.get(r.postId) ?? [];
      arr.push(r);
      byPost.set(r.postId, arr);
    }
    return posts.map((p) => ({ ...p, lastComments: byPost.get(p.id) ?? [] }));
  }

  // 6. Bulk insert
  @HttpPost('posts/bulk')
  async bulkInsert(@Body() body: { authorId: number; count?: number }) {
    const count = Math.min(body.count ?? 1000, 5000);
    const data = Array.from({ length: count }, (_, i) => ({
      title: `bulk ${Date.now()}-${i}`,
      body: 'bulk body content for benchmarking purposes',
      authorId: body.authorId,
    }));
    const result = await this.posts.createQueryBuilder().insert().values(data).execute();
    return { count: result.identifiers.length };
  }

  // 7. Deep nested
  @Get('categories/tree')
  categoriesTree() {
    return this.categories
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.posts', 'p')
      .leftJoinAndSelect('p.author', 'author')
      .leftJoinAndSelect('p.comments', 'comments')
      .leftJoinAndSelect('comments.author', 'commentAuthor')
      .limit(20)
      .getMany();
  }

  // 8. Raw aggregation
  @Get('raw/top-authors')
  topAuthors() {
    return this.ds.query(
      `SELECT u.id, u.name, COUNT(p.id)::int AS post_count
       FROM "User" u
       JOIN "Post" p ON p."authorId" = u.id
       GROUP BY u.id, u.name
       ORDER BY post_count DESC
       LIMIT 25`,
    );
  }

  // 9. Cursor pagination - keyset on id
  @Get('posts/cursor')
  async postsCursor(@Query('cursor') cursor?: string, @Query('limit') limit = '50') {
    const take = Math.min(Number(limit), 100);
    const qb = this.posts.createQueryBuilder('p').orderBy('p.id', 'DESC').take(take);
    if (cursor) qb.where('p.id < :cursor', { cursor: Number(cursor) });
    return qb.getMany();
  }

  // 10. Complex filter - OR + range + EXISTS subquery
  @Get('posts/filter')
  async postsFilter(@Query('term') term = 'alpha') {
    const since = new Date(Date.now() - 30 * 86400_000);
    return this.posts
      .createQueryBuilder('p')
      .where('(p.title ILIKE :t OR p.body ILIKE :t)', { t: `%${term}%` })
      .andWhere('p.createdAt >= :since', { since })
      .andWhere('EXISTS (SELECT 1 FROM "Post" pp WHERE pp."authorId" = p."authorId" AND pp.id > 0)')
      .orderBy('p.createdAt', 'DESC')
      .take(50)
      .getMany();
  }

  // 11. Delete - bulk delete by predicate (idempotent)
  @HttpPost('posts/delete-by-author/:id')
  async deleteByAuthor(@Param('id', ParseIntPipe) id: number) {
    const stamp = Date.now();
    const data = Array.from({ length: 5 }, (_, i) => ({
      title: `del-${id}-${stamp}-${i}`,
      body: 'x',
      authorId: id,
    }));
    await this.posts.createQueryBuilder().insert().values(data).execute();
    const r = await this.posts
      .createQueryBuilder()
      .delete()
      .where('"authorId" = :id AND title LIKE :p', { id, p: `del-${id}-${stamp}-%` })
      .execute();
    return { deleted: r.affected ?? 0 };
  }

  // 12. Transaction - create post + 3 comments atomically
  @HttpPost('tx/post-with-comments')
  async txPostWithComments(@Body() b: { authorId: number }) {
    return this.ds.transaction(async (em) => {
      const post = em.getRepository(Post).create({
        title: `tx ${Date.now()}`,
        body: 'tx body',
        authorId: b.authorId,
      });
      const saved = await em.getRepository(Post).save(post);
      const comments = Array.from({ length: 3 }, (_, i) =>
        em.getRepository(Comment).create({
          body: `c${i}`,
          postId: saved.id,
          authorId: b.authorId,
        }),
      );
      await em.getRepository(Comment).insert(comments);
      return { id: saved.id };
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
