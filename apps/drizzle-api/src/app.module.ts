import { Module } from '@nestjs/common';
import { DrizzleService } from './drizzle.service';
import { BenchController } from './bench.controller';

@Module({
  providers: [DrizzleService],
  controllers: [BenchController],
})
export class AppModule {}
