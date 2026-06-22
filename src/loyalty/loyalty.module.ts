import { Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyGiftsService } from './loyalty-gifts.service';
import { LoyaltyGiftsController } from './loyalty-gifts.controller';
import { BogoOffersService } from './bogo-offers.service';
import { BogoOffersController } from './bogo-offers.controller';
import { LoyaltyTiersService } from './loyalty-tiers.service';
import { LoyaltyTiersController } from './loyalty-tiers.controller';

@Module({
  controllers: [LoyaltyGiftsController, BogoOffersController, LoyaltyController, LoyaltyTiersController],
  providers: [LoyaltyService, LoyaltyGiftsService, BogoOffersService, LoyaltyTiersService],
  exports: [LoyaltyGiftsService, BogoOffersService, LoyaltyTiersService],
})
export class LoyaltyModule {}
