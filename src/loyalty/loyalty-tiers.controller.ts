import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { LoyaltyTiersService } from './loyalty-tiers.service';
import { CreateLoyaltyTierDto } from './dto/create-loyalty-tier.dto';
import { UpdateLoyaltyTierDto } from './dto/update-loyalty-tier.dto';

@ApiTags('Loyalty')
@ApiBearerAuth()
@Controller('loyalty/tiers')
@UseGuards(JwtAuthGuard)
export class LoyaltyTiersController {
  constructor(private readonly tiersService: LoyaltyTiersService) {}

  @Get()
  @ApiOperation({ summary: 'List loyalty tiers (for admin & website sync)' })
  @ApiQuery({ name: 'active', required: false, description: 'Only active tiers' })
  findAll(@Query('active') active?: string) {
    const activeOnly = active === 'true';
    return this.tiersService.findAll(activeOnly);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one loyalty tier' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tiersService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create loyalty tier' })
  create(@Body() dto: CreateLoyaltyTierDto) {
    return this.tiersService.create(dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update loyalty tier' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLoyaltyTierDto) {
    return this.tiersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete loyalty tier' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.tiersService.remove(id);
  }
}
