import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Category } from './entities/category.entity';
import { BenchController } from './bench.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [User, Post, Comment, Category],
      synchronize: false,
      logging: false,
      extra: {
        max: Number(process.env.DB_POOL_SIZE ?? 20),
      },
    }),
    TypeOrmModule.forFeature([User, Post, Comment, Category]),
  ],
  controllers: [BenchController],
})
export class AppModule {}
