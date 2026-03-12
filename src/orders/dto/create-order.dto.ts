import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { OrderType } from '@prisma/client';

export class OrderItemDto {
  @ApiProperty()
  @IsInt()
  product_id: number;

  @ApiProperty()
  @IsInt()
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: { remove: ['sugar'], add: ['extra ice'] } })
  @IsOptional()
  @IsObject()
  customizations?: Record<string, any>;
}

export class CreateOrderDto {
  @ApiProperty({ enum: OrderType })
  @IsEnum(OrderType)
  order_type: OrderType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  customer_id?: number;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional({ description: 'Loyalty points to redeem', default: 0 })
  @IsOptional()
  @IsInt()
  loyalty_points_redeemed?: number;

  @ApiProperty({ enum: ['CASH', 'CARD', 'WALLET'] })
  @IsString()
  @IsNotEmpty()
  payment_method: string;

  @ApiPropertyOptional({ description: 'Notes for address (delivery orders)' })
  @IsOptional()
  @IsString()
  delivery_address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  delivery_notes?: string;
}
