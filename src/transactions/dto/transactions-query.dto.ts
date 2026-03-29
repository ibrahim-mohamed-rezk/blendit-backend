import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class TransactionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Calendar day (YYYY-MM-DD), server local midnight range' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'paid | pending | refunded | failed (or COMPLETED, etc.)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['sale', 'refund', 'expense'] })
  @IsOptional()
  @IsIn(['sale', 'refund', 'expense'])
  type?: string;
}
