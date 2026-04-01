import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { AddonsModule } from '../addons/addons.module';
import { PublicController } from './public.controller';
import { WebsitePhoneAuthService } from './website-phone-auth.service';

@Module({
  imports: [ProductsModule, CustomersModule, OrdersModule, LoyaltyModule, AddonsModule],
  controllers: [PublicController],
  providers: [WebsitePhoneAuthService],
})
export class PublicModule {}
