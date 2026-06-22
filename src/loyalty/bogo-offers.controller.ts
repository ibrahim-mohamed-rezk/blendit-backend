import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BogoOffersService } from './bogo-offers.service';
import { CreateBogoOfferDto } from './dto/create-bogo-offer.dto';
import { UpdateBogoOfferDto } from './dto/update-bogo-offer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Loyalty')
@ApiBearerAuth()
@Controller('loyalty/bogo-offers')
@UseGuards(JwtAuthGuard, BranchGuard)
export class BogoOffersController {
  constructor(private readonly bogoOffersService: BogoOffersService) {}

  @Get()
  @ApiOperation({ summary: 'List buy-X-get-Y offers (admin & POS)' })
  @ApiQuery({ name: 'active', required: false, description: 'Only active offers (e.g. for POS)' })
  findAll(@CurrentBranch() branchId: number, @Query('active') active?: string) {
    const activeOnly = active === 'true';
    return this.bogoOffersService.findAll(branchId, activeOnly);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one BOGO offer' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.bogoOffersService.findOne(id, branchId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create BOGO offer' })
  create(@Body() dto: CreateBogoOfferDto, @CurrentBranch() branchId: number) {
    return this.bogoOffersService.create(dto, branchId);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update BOGO offer' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBogoOfferDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.bogoOffersService.update(id, dto, branchId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete BOGO offer' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.bogoOffersService.remove(id, branchId);
  }
}
