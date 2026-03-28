import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
})
export class AppModule {}
