import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SettingsModule } from '../settings/settings.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [EventEmitterModule.forRoot(), SettingsModule, ActivityLogsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
