import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [OrdersModule, SettingsModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
