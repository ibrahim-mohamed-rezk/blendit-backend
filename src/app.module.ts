import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

/** Load .env from cwd or from backend/ when the shell cwd is the monorepo root. */
function resolveEnvFilePaths(): string[] {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'backend', '.env'),
    join(__dirname, '..', '.env'),
    join(__dirname, '..', '..', '.env'),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const key = resolve(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.length > 0 ? out : ['.env'];
}

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { CustomersModule } from './customers/customers.module';
import { OrdersModule } from './orders/orders.module';
import { DeliveryModule } from './delivery/delivery.module';
import { HeldOrdersModule } from './held-orders/held-orders.module'; 
import { TransactionsModule } from './transactions/transactions.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { InventoryModule } from './inventory/inventory.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { WebsocketsModule } from './websockets/websockets.module'; 
import { AnalyticsModule } from './analytics/analytics.module';
import { PromotionsModule } from './promotions/promotions.module';
import { SettingsModule } from './settings/settings.module';
import { PublicModule } from './public/public.module';
import { AddonsModule } from './addons/addons.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvFilePaths(),
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CustomersModule,
    OrdersModule,
    DeliveryModule,
    HeldOrdersModule,
    TransactionsModule,
    LoyaltyModule,
    InventoryModule,
    ActivityLogsModule,
    WebsocketsModule,
    AnalyticsModule,
    PromotionsModule,
    SettingsModule,
    PublicModule,
    AddonsModule,
  ],
})
export class AppModule {}
