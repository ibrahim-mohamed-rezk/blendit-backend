import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { OrderAddonLineDto, OrderItemDto } from './create-order.dto';

export class UpdateOrderDto {
  @ApiProperty({ type: [OrderItemDto], description: 'Replace all order items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiPropertyOptional({ description: 'Set to null for walk-in' })
  @IsOptional()
  @IsInt()
  customer_id?: number | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional({
    type: [OrderAddonLineDto],
    description: 'Replace order add-ons. Omit to leave existing add-ons unchanged.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderAddonLineDto)
  order_addons?: OrderAddonLineDto[];

  @ApiPropertyOptional({
    enum: ['CASH', 'CARD', 'WALLET'],
    description: 'Update completed payment tender(s). Single-tender orders also sync amount to new total.',
  })
  @IsOptional()
  @IsString()
  @IsIn(['CASH', 'CARD', 'WALLET'])
  payment_method?: string;
}
