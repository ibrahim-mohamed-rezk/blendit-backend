import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { CreatePromotionDto } from './create-promotion.dto';

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {
  @IsOptional()
  @IsInt()
  @Min(0)
  used_count?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
