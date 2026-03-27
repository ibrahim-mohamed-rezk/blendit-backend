import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateLoyaltyTierDto {
  @ApiProperty({ example: 'Lively' })
  @IsString()
  name: string;

  @ApiProperty({ example: 500, description: 'Minimum points required to unlock this tier' })
  @IsInt()
  @Min(0)
  points_threshold: number;

  @ApiPropertyOptional({ example: '#60a5fa' })
  @IsOptional()
  @IsString()
  color_from?: string;

  @ApiPropertyOptional({ example: '#22d3ee' })
  @IsOptional()
  @IsString()
  color_to?: string;

  @ApiPropertyOptional({ type: [String], example: ['Earn 1.5 points per EGP', 'Early access'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benefits?: string[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  sort_order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
