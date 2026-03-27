import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PublicController } from './public.controller';

@Module({
  imports: [ProductsModule, CustomersModule, OrdersModule, LoyaltyModule],
  controllers: [PublicController],
})
export class PublicModule {}
