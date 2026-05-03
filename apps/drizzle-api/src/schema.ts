import { relations } from 'drizzle-orm';
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

// Relations for the relational query API (db.query.posts.findMany({ with: ... }))

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  comments: many(comments),
  postCategories: many(postCategories),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  postCategories: many(postCategories),
}));

export const postCategoriesRelations = relations(postCategories, ({ one }) => ({
  post: one(posts, { fields: [postCategories.a], references: [posts.id] }),
  category: one(categories, { fields: [postCategories.b], references: [categories.id] }),
}));
