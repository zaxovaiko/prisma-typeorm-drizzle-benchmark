import { defineRelations } from 'drizzle-orm';
import { pgTable, serial, text, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';

// Schema mirrors the raw SQL in load/seed/seed.ts byte-for-byte:
//   - Mixed-case PascalCase table names ("User", "Post", etc.)
//   - camelCase column names ("authorId", "createdAt")
//   - Junction table "_PostCategories" with columns "A" and "B" (Prisma convention)

export const users = pgTable('User', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export const categories = pgTable('Category', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const posts = pgTable('Post', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  authorId: integer('authorId').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export const comments = pgTable('Comment', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  postId: integer('postId').notNull(),
  authorId: integer('authorId').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export const postCategories = pgTable(
  '_PostCategories',
  {
    a: integer('A').notNull(),
    b: integer('B').notNull(),
  },
  (t) => [primaryKey({ columns: [t.a, t.b] })],
);

const schema = { users, categories, posts, comments, postCategories };

// Drizzle v1 uses `defineRelations(schema, helpers => ...)` instead of per-table `relations()` calls
export const relations = defineRelations(schema, (r) => ({
  users: {
    posts: r.many.posts(),
    comments: r.many.comments(),
  },
  posts: {
    author: r.one.users({ from: r.posts.authorId, to: r.users.id }),
    comments: r.many.comments(),
    postCategories: r.many.postCategories(),
  },
  comments: {
    post: r.one.posts({ from: r.comments.postId, to: r.posts.id }),
    author: r.one.users({ from: r.comments.authorId, to: r.users.id }),
  },
  categories: {
    postCategories: r.many.postCategories(),
  },
  postCategories: {
    post: r.one.posts({ from: r.postCategories.a, to: r.posts.id }),
    category: r.one.categories({ from: r.postCategories.b, to: r.categories.id }),
  },
}));
