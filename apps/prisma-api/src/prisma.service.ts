import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type Client = InstanceType<typeof PrismaClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Client;

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_SIZE ?? 20),
    } as any);
    this.client = new (PrismaClient as any)({ adapter });
  }

  get user() { return this.client.user; }
  get post() { return this.client.post; }
  get comment() { return this.client.comment; }
  get category() { return this.client.category; }

  $queryRawUnsafe(query: string, ...values: any[]): any {
    return this.client.$queryRawUnsafe(query, ...values);
  }

  $transaction(fn: (tx: any) => Promise<any>): any {
    return (this.client as any).$transaction(fn);
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
