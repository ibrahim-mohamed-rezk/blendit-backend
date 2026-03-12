import { Module } from '@nestjs/common';
import { HeldOrdersController } from './held-orders.controller';
import { HeldOrdersService } from './held-orders.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HeldOrdersController],
  providers: [HeldOrdersService],
})
export class HeldOrdersModule {}
