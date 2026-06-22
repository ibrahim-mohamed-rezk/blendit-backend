import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class TransferInventoryDto {
  @ApiProperty({ description: 'Destination branch ID' })
  @IsInt()
  to_branch_id: number;

  @ApiPropertyOptional({ description: 'Quantity to transfer (defaults to full on-hand quantity)' })
  @IsOptional()
  @IsPositive()
  quantity?: number;
}
