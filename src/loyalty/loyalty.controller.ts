import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoyaltyService } from './loyalty.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

class ManualAdjustDto {
  @ApiProperty({ description: 'Points to add (positive) or deduct (negative)' })
  @IsInt()
  points: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

@ApiTags('Loyalty')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('accounts/:customerId')
  @ApiOperation({ summary: 'Get loyalty account for customer' })
  getAccount(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.loyaltyService.getAccount(customerId);
  }

  @Get('accounts/:customerId/history')
  @ApiOperation({ summary: 'Get loyalty transaction history' })
  getHistory(@Param('customerId', ParseIntPipe) customerId: number, @Query() pagination: PaginationDto) {
    return this.loyaltyService.getHistory(customerId, pagination.page, pagination.limit);
  }

  @Post('accounts/:customerId/adjust')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Manually adjust loyalty points' })
  adjust(@Param('customerId', ParseIntPipe) customerId: number, @Body() dto: ManualAdjustDto) {
    return this.loyaltyService.manualAdjust(customerId, dto.points, dto.note);
  }
}
