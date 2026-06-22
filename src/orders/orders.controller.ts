import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { AppendOrderNoteDto } from './dto/append-order-note.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentBranch, BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { OrderStatus, OrderType } from '@prisma/client';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new POS order' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: any, @CurrentBranch() branchId: number) {
    return this.ordersService.create(dto, user.id, 'POS', branchId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders (paginated, filter by status, type, date, search)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', enum: OrderStatus, required: false })
  @ApiQuery({ name: 'type', enum: OrderType, required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'fromDate', required: false, description: 'Start date (YYYY-MM-DD), inclusive' })
  @ApiQuery({ name: 'toDate', required: false, description: 'End date (YYYY-MM-DD), inclusive' })
  @ApiQuery({ name: 'search', required: false })
  findAll(
    @BranchScopeParam() scope: BranchScope,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: OrderStatus,
    @Query('type') type?: OrderType,
    @Query('date') date?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.ordersService.findAll(
      scope,
      Number.isFinite(pageNum) ? pageNum : 1,
      Number.isFinite(limitNum) ? limitNum : 10,
      status,
      type,
      date,
      fromDate,
      toDate,
      search?.trim(),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @BranchScopeParam() scope: BranchScope) {
    return this.ordersService.findOne(id, scope.allBranches ? undefined : scope.branchId!);
  }

  @Patch(':id/notes')
  @ApiOperation({ summary: 'Append to order notes (e.g. Instapay payer + reference)' })
  appendNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppendOrderNoteDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.ordersService.appendOrderNote(id, dto, branchId);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update order status' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: { role?: { name: string } },
    @CurrentBranch() branchId: number,
  ) {
    return this.ordersService.updateStatus(id, dto, user, branchId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update order (items, customer, discount). Admin: any; Cashier: pending only.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderDto,
    @CurrentUser() user: { role?: { name: string } },
    @CurrentBranch() branchId: number,
  ) {
    return this.ordersService.update(id, dto, user, branchId);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund an order (marks transactions as refunded)' })
  refund(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RefundOrderDto,
    @CurrentUser() user: { id: number; role?: { name: string } },
    @CurrentBranch() branchId: number,
  ) {
    return this.ordersService.refund(id, dto, user, branchId);
  }
}
