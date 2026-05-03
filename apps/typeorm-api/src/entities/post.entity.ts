import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Comment } from './comment.entity';
import { Category } from './category.entity';

@Entity('Post')
@Index(['authorId'])
@Index(['createdAt'])
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column('text')
  body: string;

  @Column()
  authorId: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (u) => u.posts, { onDelete: 'CASCADE' })
  author: User;

  @OneToMany(() => Comment, (c) => c.post)
  comments: Comment[];

  @ManyToMany(() => Category, (c) => c.posts)
  @JoinTable({
    name: '_PostCategories',
    joinColumn: { name: 'A', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'B', referencedColumnName: 'id' },
  })
  categories: Category[];
}
