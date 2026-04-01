import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefundOrderDto {
  @ApiPropertyOptional({ description: 'Optional reason for refund' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'Manager PIN required for refunds (if configured).' })
  @IsOptional()
  @IsString()
  manager_pin?: string;
}

