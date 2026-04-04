import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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

export class OrderAddonLineDto {
  @ApiProperty()
  @IsInt()
  addon_id: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

/** One catalog redemption line (POS: multiple gifts in one order). */
export class LoyaltyPosRedemptionDto {
  @ApiProperty({ description: 'Loyalty gift catalog id' })
  @IsInt()
  loyalty_gift_id: number;

  @ApiPropertyOptional({
    description:
      'Chosen free product when the gift has no fixed product; optional when gift defines gift_product_id.',
  })
  @IsOptional()
  @IsInt()
  loyalty_free_product_id?: number;
}

/** POS split tender: at least two lines; amounts must sum to order total (within tolerance). */
export class OrderPaymentLineDto {
  @ApiProperty({ enum: ['CASH', 'CARD', 'WALLET'] })
  @IsIn(['CASH', 'CARD', 'WALLET'])
  payment_method: string;

  @ApiProperty({ description: 'Amount for this tender' })
  @IsNumber()
  @Min(0.01)
  amount: number;
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

  @ApiPropertyOptional({
    type: [LoyaltyPosRedemptionDto],
    description: 'POS: multiple loyalty catalog redemptions in one order (one entry per free drink line).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoyaltyPosRedemptionDto)
  loyalty_pos_redemptions?: LoyaltyPosRedemptionDto[];

  @ApiPropertyOptional({ description: 'Website: loyalty gift id from catalog (required with redemption on public orders)' })
  @IsOptional()
  @IsInt()
  loyalty_gift_id?: number;

  @ApiPropertyOptional({
    description:
      'Free product id for the reward when the gift has no fixed product (website), or POS with loyalty_gift_id. Ignored if the gift defines gift_product_id.',
  })
  @IsOptional()
  @IsInt()
  loyalty_free_product_id?: number;

  @ApiPropertyOptional({
    enum: ['CASH', 'CARD', 'WALLET'],
    description:
      'Single tender. Omit when `payments` is set (split). WALLET is Instapay in POS/website.',
  })
  @ValidateIf((o: CreateOrderDto) => !o.payments?.length)
  @IsString()
  @IsNotEmpty()
  payment_method?: string;

  @ApiPropertyOptional({
    type: [OrderPaymentLineDto],
    description: 'Split payment (POS). Min 2 lines; sum of amounts must equal order total.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderPaymentLineDto)
  payments?: OrderPaymentLineDto[];

  @ApiPropertyOptional({ description: 'Notes for address (delivery orders)' })
  @IsOptional()
  @IsString()
  delivery_address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  delivery_notes?: string;

  @ApiPropertyOptional({ description: 'Customer / kitchen note for the whole order (e.g. website special instructions)' })
  @IsOptional()
  @IsString()
  order_notes?: string;

  @ApiPropertyOptional({ description: 'Client-generated id for offline-first order tracking' })
  @IsOptional()
  @IsString()
  client_order_id?: string;

  @ApiPropertyOptional({ type: [OrderAddonLineDto], description: 'Optional order-level add-ons' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderAddonLineDto)
  order_addons?: OrderAddonLineDto[];
}
