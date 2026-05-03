import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BenchController } from './bench.controller';

@Module({
  controllers: [BenchController],
  providers: [PrismaService],
})
export class AppModule {}
