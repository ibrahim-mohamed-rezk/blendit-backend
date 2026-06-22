import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService, CreateInventoryItemDto, UpdateInventoryItemDto, StockTransactionDto } from './inventory.service';
import { TransferInventoryDto } from './dto/transfer-inventory.dto';
import { StockTransactionsQueryDto } from './dto/stock-transactions-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('inventory')
  @ApiOperation({ summary: 'Create inventory item' })
  create(@Body() dto: CreateInventoryItemDto, @CurrentBranch() branchId: number) {
    return this.inventoryService.create(dto, branchId);
  }

  @Get('inventory')
  @ApiOperation({ summary: 'Get all inventory items (paginated)' })
  findAll(@Query() pagination: PaginationDto, @CurrentBranch() branchId: number) {
    return this.inventoryService.findAll(branchId, pagination.page, pagination.limit);
  }

  @Get('inventory/stock-transactions')
  @ApiOperation({ summary: 'Stock movement history (paginated, filterable by date range)' })
  findStockTransactions(
    @Query() query: StockTransactionsQueryDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.inventoryService.findStockTransactions(
      branchId,
      query.page ?? 1,
      query.limit ?? 20,
      query.inventoryItemId,
      query.fromDate,
      query.toDate,
    );
  }

  @Get('inventory/:id')
  @ApiOperation({ summary: 'Get inventory item by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.inventoryService.findOne(id, branchId);
  }

  @Put('inventory/:id')
  @ApiOperation({ summary: 'Update inventory item' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInventoryItemDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.inventoryService.update(id, dto, branchId);
  }

  @Delete('inventory/:id')
  @ApiOperation({ summary: 'Delete inventory item' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.inventoryService.remove(id, branchId);
  }

  @Post('inventory/:id/stock-transaction')
  @ApiOperation({ summary: 'Record a stock transaction (restock/usage/adjustment)' })
  stockTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StockTransactionDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.inventoryService.addStockTransaction(id, dto, branchId);
  }

  @Post('admin/inventory/:id/transfer')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Transfer stock to another branch (super admin)' })
  transfer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransferInventoryDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.inventoryService.transferItem(id, branchId, dto.to_branch_id, dto.quantity);
  }
}
