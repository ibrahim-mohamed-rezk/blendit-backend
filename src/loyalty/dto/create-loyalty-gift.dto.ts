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

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
