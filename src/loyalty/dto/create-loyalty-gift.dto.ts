import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';

export class CreateLoyaltyGiftDto {
  @ApiProperty({ example: 'Free Smoothie' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Get any regular smoothie free' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 500 })
  @IsInt()
  @Min(1)
  points_required: number;

  @ApiProperty({ example: 85, description: 'EGP value when redeemed' })
  @IsNumber()
  @Min(0)
  discount_value: number;

  @ApiPropertyOptional({
    description: 'Fixed free product id; omit or null so the customer picks any menu item (website)',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  gift_product_id?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
