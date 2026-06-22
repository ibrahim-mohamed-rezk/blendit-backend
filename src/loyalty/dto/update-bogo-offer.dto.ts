import { PartialType } from '@nestjs/swagger';
import { CreateBogoOfferDto } from './create-bogo-offer.dto';

export class UpdateBogoOfferDto extends PartialType(CreateBogoOfferDto) {}
