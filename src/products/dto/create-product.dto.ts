import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ProductRecipeItemDto {
  @ApiProperty({ description: 'Inventory item id from stock page' })
  @IsInt()
  inventory_item_id: number;

  @ApiProperty({ example: 200, description: 'Amount used per 1 product unit (in stock item unit, e.g. grams)' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Size id when updating an existing sized product' })
  @IsOptional()
  @IsInt()
  product_size_id?: number;

  @ApiPropertyOptional({ example: 'Large', description: 'Size name (required per row when product has sizes)' })
  @IsOptional()
  @IsString()
  size_name?: string;
}

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

export class ProductSizeDto {
  @ApiProperty({ example: 'Large' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 199 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sort_order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
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

  @ApiPropertyOptional({ type: [String], description: 'Display labels for POS/website (auto-filled from recipe when omitted)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ingredients?: string[];

  @ApiPropertyOptional({
    type: [ProductRecipeItemDto],
    description: 'Optional stock ingredients consumed per unit sold. When omitted, the product has no recipe.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductRecipeItemDto)
  recipe_items?: ProductRecipeItemDto[];

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

  @ApiPropertyOptional({
    type: [ProductSizeDto],
    description: 'Optional sizes (e.g. Small, Medium, Large). When set, POS/website require a size per line.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSizeDto)
  sizes?: ProductSizeDto[];
}
