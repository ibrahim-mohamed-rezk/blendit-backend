import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

export class GetDeliveryOrdersQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({ enum: DeliveryStatus, description: 'Filter by delivery status' })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional({ description: 'Search by order number, customer name or phone' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateDeliveryStatusDto {
  @ApiProperty({ enum: DeliveryStatus })
  @IsEnum(DeliveryStatus)
  status: DeliveryStatus;

  @ApiPropertyOptional({ description: 'Required when cancelling delivery (non-admin): manager PIN.' })
  @IsOptional()
  @IsString()
  manager_pin?: string;

  @ApiPropertyOptional({ description: 'Required when status is CANCELLED.' })
  @ValidateIf((o: UpdateDeliveryStatusDto) => o.status === DeliveryStatus.CANCELLED)
  @IsNotEmpty()
  @IsString()
  cancellation_reason?: string;
}

export class CreateDeliveryOrderDto {
  @ApiProperty()
  @IsInt()
  order_id: number;

  @ApiProperty()
  @IsInt()
  customer_id: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDeliveryOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
