import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { UpdateDeliveryStatusDto, CreateDeliveryOrderDto, UpdateDeliveryOrderDto, GetDeliveryOrdersQueryDto } from './dto/delivery.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch, BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Delivery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
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
  findAll(@Query() query: GetDeliveryOrdersQueryDto, @BranchScopeParam() scope: BranchScope) {
    return this.deliveryService.findAll(
      scope,
      query.page ?? 1,
      query.limit ?? 10,
      query.status,
      query.search?.trim(),
      query.fromDate,
      query.toDate,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get delivery order by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.deliveryService.findOne(id, branchId);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update delivery order status' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeliveryStatusDto,
    @CurrentUser() user: { role?: { name: string } },
    @CurrentBranch() branchId: number,
  ) {
    return this.deliveryService.updateStatus(id, dto, user, branchId);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update delivery order (address, notes) - Admin only' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeliveryOrderDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.deliveryService.update(id, dto, branchId);
  }
}
