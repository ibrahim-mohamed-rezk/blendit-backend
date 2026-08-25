import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryCustomersDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Match against name, phone or email' })
  @IsOptional()
  @IsString()
  search?: string;
}
