import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class HeldOrderItemDto {
  @ApiProperty()
  @IsInt()
  product_id: number;

  @ApiProperty()
  @IsString()
  productName: string;

  @ApiProperty()
  @IsInt()
  quantity: number;

  @ApiProperty()
  @IsNumber()
  unitPrice: number;

  @ApiProperty()
  @IsNumber()
  totalPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modificationsSummary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  customizations?: Record<string, unknown>;
}

export class CreateHeldOrderDto {
  @ApiProperty({ example: 'DINE_IN' })
  @IsString()
  order_type: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  table_number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  customer_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [HeldOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HeldOrderItemDto)
  items: HeldOrderItemDto[];

  @ApiProperty()
  @IsNumber()
  subtotal: number;

  @ApiProperty()
  @IsNumber()
  tax: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiProperty()
  @IsNumber()
  total: number;
}
