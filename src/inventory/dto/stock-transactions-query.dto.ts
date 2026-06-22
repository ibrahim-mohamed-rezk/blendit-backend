import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Min } from 'class-validator';

export class StockTransactionsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by inventory item id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  inventoryItemId?: number;

  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD), inclusive' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD), inclusive' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate?: string;
}
