import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export class ShiftsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  /** Prefer this over `active` — avoids boolean query-string parsing issues. */
  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';

  @ApiPropertyOptional({ description: 'When true, only open shifts (ended_at is null)' })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD inclusive start (started_at for open, ended_at for closed)' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD inclusive end (started_at for open, ended_at for closed)' })
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cashierId?: number;
}

export class ShiftAnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'YYYY-MM-DD inclusive start' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD inclusive end' })
  @IsOptional()
  @IsString()
  toDate?: string;
}

export class EnsureActiveShiftDto {
  @ApiPropertyOptional({ description: 'ISO timestamp when shift started on device (defaults to now)' })
  @IsOptional()
  @IsString()
  started_at?: string;
}
