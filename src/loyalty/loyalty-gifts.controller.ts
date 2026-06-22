import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LoyaltyGiftsService } from './loyalty-gifts.service';
import { CreateLoyaltyGiftDto } from './dto/create-loyalty-gift.dto';
import { UpdateLoyaltyGiftDto } from './dto/update-loyalty-gift.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Loyalty')
@ApiBearerAuth()
@Controller('loyalty/gifts')
@UseGuards(JwtAuthGuard, BranchGuard)
export class LoyaltyGiftsController {
  constructor(private readonly giftsService: LoyaltyGiftsService) {}

  @Get()
  @ApiOperation({ summary: 'List loyalty gifts (for admin & POS)' })
  @ApiQuery({ name: 'active', required: false, description: 'Only active gifts (e.g. for POS)' })
  findAll(@CurrentBranch() branchId: number, @Query('active') active?: string) {
    const activeOnly = active === 'true';
    return this.giftsService.findAll(branchId, activeOnly);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one loyalty gift' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.giftsService.findOne(id, branchId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create loyalty gift' })
  create(@Body() dto: CreateLoyaltyGiftDto, @CurrentBranch() branchId: number) {
    return this.giftsService.create(dto, branchId);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update loyalty gift' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLoyaltyGiftDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.giftsService.update(id, dto, branchId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete loyalty gift' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.giftsService.remove(id, branchId);
  }
}
