import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export class CreateBogoOfferDto {
  @ApiProperty({ example: 'Buy 2 Matcha Get 1 Free' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Specific product to buy; omit or null so any menu product counts',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(1)
  buy_product_id?: number | null;

  @ApiProperty({ example: 2, description: 'How many to buy to qualify' })
  @IsInt()
  @Min(1)
  buy_quantity: number;

  @ApiProperty({ description: 'Product given free' })
  @IsInt()
  @Min(1)
  get_product_id: number;

  @ApiProperty({ example: 1, description: 'How many free per qualifying set' })
  @IsInt()
  @Min(1)
  get_quantity: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  valid_until?: string;
}
