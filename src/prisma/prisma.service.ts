import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    const shouldConnectOnStartup = process.env.PRISMA_CONNECT_ON_STARTUP !== 'false';
    if (!shouldConnectOnStartup) return;

    try {
      await this.$connect();
    } catch (err) {
      // Don't prevent the API from starting in dev environments where DB may be absent.
      // Any DB-backed request will still fail until Postgres is reachable.
      // eslint-disable-next-line no-console
      console.error(
        [
          'Prisma failed to connect on startup.',
          'Fix: start Postgres (default expected at localhost:5432) or set PRISMA_CONNECT_ON_STARTUP=false to boot without DB.',
          `DATABASE_URL=${process.env.DATABASE_URL ?? '(missing)'}`,
        ].join('\n'),
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
