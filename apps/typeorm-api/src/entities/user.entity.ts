import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Post } from './post.entity';
import { Comment } from './comment.entity';

@Entity('User')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ nullable: true, type: 'varchar' })
  name: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Post, (p) => p.author)
  posts: Post[];

  @OneToMany(() => Comment, (c) => c.author)
  comments: Comment[];
}
