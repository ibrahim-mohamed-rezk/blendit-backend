import { PartialType } from '@nestjs/swagger';
import { CreateLoyaltyGiftDto } from './create-loyalty-gift.dto';

export class UpdateLoyaltyGiftDto extends PartialType(CreateLoyaltyGiftDto) {}
