import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyGiftsService } from './loyalty-gifts.service';
import { LoyaltyGiftsController } from './loyalty-gifts.controller';

@Module({
  controllers: [LoyaltyGiftsController, LoyaltyController],
  providers: [LoyaltyService, LoyaltyGiftsService],
})
export class LoyaltyModule {}
