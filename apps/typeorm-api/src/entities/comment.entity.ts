import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Post } from './post.entity';
import { User } from './user.entity';

@Entity('Comment')
@Index(['postId'])
@Index(['authorId'])
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('text')
  body: string;

  @Column()
  postId: number;

  @Column()
  authorId: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Post, (p) => p.comments, { onDelete: 'CASCADE' })
  post: Post;

  @ManyToOne(() => User, (u) => u.comments, { onDelete: 'CASCADE' })
  author: User;
}
