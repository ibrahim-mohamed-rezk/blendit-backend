import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LoyaltyGiftsService } from './loyalty-gifts.service';
import { CreateLoyaltyGiftDto } from './dto/create-loyalty-gift.dto';
import { UpdateLoyaltyGiftDto } from './dto/update-loyalty-gift.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Loyalty')
@ApiBearerAuth()
@Controller('loyalty/gifts')
@UseGuards(JwtAuthGuard)
export class LoyaltyGiftsController {
  constructor(private readonly giftsService: LoyaltyGiftsService) {}

  @Get()
  @ApiOperation({ summary: 'List loyalty gifts (for admin & POS)' })
  @ApiQuery({ name: 'active', required: false, description: 'Only active gifts (e.g. for POS)' })
  findAll(@Query('active') active?: string) {
    const activeOnly = active === 'true';
    return this.giftsService.findAll(activeOnly);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one loyalty gift' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.giftsService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create loyalty gift' })
  create(@Body() dto: CreateLoyaltyGiftDto) {
    return this.giftsService.create(dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update loyalty gift' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLoyaltyGiftDto) {
    return this.giftsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete loyalty gift' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.giftsService.remove(id);
  }
}
