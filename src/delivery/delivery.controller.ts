import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { UpdateDeliveryStatusDto, CreateDeliveryOrderDto, UpdateDeliveryOrderDto, GetDeliveryOrdersQueryDto } from './dto/delivery.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Delivery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery-orders')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Post()
  @ApiOperation({ summary: 'Create delivery order (from website)' })
  create(@Body() dto: CreateDeliveryOrderDto) {
    return this.deliveryService.createDeliveryOrder(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all delivery orders (paginated, filter by status, search)' })
  findAll(@Query() query: GetDeliveryOrdersQueryDto) {
    return this.deliveryService.findAll(
      query.page ?? 1,
      query.limit ?? 10,
      query.status,
      query.search?.trim(),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get delivery order by ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.deliveryService.findOne(id);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update delivery order status' })
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDeliveryStatusDto) {
    return this.deliveryService.updateStatus(id, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update delivery order (address, notes) - Admin only' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDeliveryOrderDto) {
    return this.deliveryService.update(id, dto);
  }
}
