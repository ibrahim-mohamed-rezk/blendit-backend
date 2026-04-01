import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @ApiPropertyOptional({ description: 'Manager PIN required when canceling an order (if configured).' })
  @IsOptional()
  @IsString()
  manager_pin?: string;

  @ApiPropertyOptional({ description: 'Reason for canceling the order (saved in order notes).' })
  @IsOptional()
  @IsString()
  cancellation_reason?: string;
}
