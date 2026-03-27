import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyGiftsService } from './loyalty-gifts.service';
import { LoyaltyGiftsController } from './loyalty-gifts.controller';
import { LoyaltyTiersService } from './loyalty-tiers.service';
import { LoyaltyTiersController } from './loyalty-tiers.controller';

@Module({
  controllers: [LoyaltyGiftsController, LoyaltyController, LoyaltyTiersController],
  providers: [LoyaltyService, LoyaltyGiftsService, LoyaltyTiersService],
  exports: [LoyaltyGiftsService, LoyaltyTiersService],
})
export class LoyaltyModule {}
