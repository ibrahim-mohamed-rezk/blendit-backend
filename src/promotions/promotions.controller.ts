import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Promotions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create promo code' })
  create(@Body() dto: CreatePromotionDto, @CurrentBranch() branchId: number) {
    return this.promotionsService.create(dto, branchId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all promotions' })
  @ApiQuery({ name: 'active', required: false, description: 'Only active promos (for POS)' })
  findAll(@CurrentBranch() branchId: number, @Query('active') active?: string) {
    const activeOnly = active === 'true';
    return this.promotionsService.findAll(branchId, activeOnly);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'Get promotion by code (for POS validation)' })
  findByCode(@Param('code') code: string, @CurrentBranch() branchId: number) {
    return this.promotionsService.findByCode(code, branchId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get promotion by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.promotionsService.findOne(id, branchId);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update promotion' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePromotionDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.promotionsService.update(id, dto, branchId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete promotion' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.promotionsService.remove(id, branchId);
  }
}
