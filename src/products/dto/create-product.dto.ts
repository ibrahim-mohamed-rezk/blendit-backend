import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class CustomizationOptionDto {
  @ApiProperty({ example: 'custom_option' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'No sugar' })
  @IsString()
  label: string;

  @ApiPropertyOptional({ example: 5, description: 'Extra charge (EGP) when this option is selected' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Short marketing tagline for website cards' })
  @IsOptional()
  @IsString()
  tagline?: string;

  @ApiPropertyOptional({ description: 'Tailwind color class for card accent, e.g. bg-pink-500' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty()
  @IsNumber()
  price: number;

  @ApiProperty()
  @IsInt()
  category_id: number;

  @ApiPropertyOptional({ type: [String], description: 'List of ingredients (for POS: remove/less/extra per ingredient)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ingredients?: string[];

  @ApiPropertyOptional({
    type: [CustomizationOptionDto],
    description: 'Customization options for this product (e.g. No sugar, Extra shot). Shown in POS for cashier to select.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomizationOptionDto)
  customization_options?: CustomizationOptionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image_url?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_available?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_popular?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_new?: boolean;
}
