import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { UpdateDeliveryStatusDto, CreateDeliveryOrderDto } from './dto/delivery.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PaginationDto } from '../common/dto/pagination.dto';

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
  @ApiOperation({ summary: 'Get all delivery orders (paginated)' })
  @ApiQuery({ name: 'status', required: false })
  findAll(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.deliveryService.findAll(pagination.page, pagination.limit, status);
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
}
