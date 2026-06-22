import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTxnType as PrismaStockTxnType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum StockTxnType { RESTOCK = 'RESTOCK', USAGE = 'USAGE', ADJUSTMENT = 'ADJUSTMENT' }

export class CreateInventoryItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsNumber() quantity: number;
  @ApiProperty() @IsString() @IsNotEmpty() unit: string;
  @ApiPropertyOptional({ description: 'Total purchase cost (EGP) for initial stock' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  total_price?: number;
}

export class UpdateInventoryItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() unit?: string;
}

export class StockTransactionDto {
  @ApiProperty({ enum: StockTxnType }) @IsEnum(StockTxnType) type: StockTxnType;
  @ApiProperty({ description: 'Positive for restock, negative for usage' }) @IsNumber() change_amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Total purchase cost (EGP) for positive restocks' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  total_price?: number;
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  private snapshotFromItem(item: { id: number; name: string; unit: string; branch_id: number }) {
    return {
      inventory_item_id: item.id,
      branch_id: item.branch_id,
      item_name: item.name,
      item_unit: item.unit,
    };
  }

  private mapStockTransactionRow(row: {
    id: number;
    inventory_item_id: number | null;
    change_amount: number;
    type: PrismaStockTxnType;
    order_id: number | null;
    notes: string | null;
    total_price: number | null;
    created_at: Date;
    branch_id: number;
    item_name: string;
    item_unit: string;
    item: { id: number; name: string; unit: string; quantity: number } | null;
  }) {
    return {
      id: row.id,
      inventory_item_id: row.inventory_item_id,
      branch_id: row.branch_id,
      change_amount: row.change_amount,
      type: row.type,
      order_id: row.order_id,
      notes: row.notes,
      total_price: row.total_price,
      created_at: row.created_at,
      item: {
        id: row.inventory_item_id ?? 0,
        name: row.item?.name ?? row.item_name,
        unit: row.item?.unit ?? row.item_unit,
        quantity: row.item?.quantity ?? 0,
      },
    };
  }

  private async enrichItemsWithLatestPrice<T extends { id: number }>(items: T[]) {
    if (items.length === 0) return items.map((i) => ({ ...i, last_total_price: null, unit_cost: null }));

    const ids = items.map((i) => i.id);
    const rows = await this.prisma.stockTransaction.findMany({
      where: {
        inventory_item_id: { in: ids },
        total_price: { not: null },
        change_amount: { gt: 0 },
      },
      orderBy: { created_at: 'desc' },
      select: { inventory_item_id: true, total_price: true, change_amount: true },
    });

    const priceByItem = new Map<number, { last_total_price: number; unit_cost: number }>();
    for (const row of rows) {
      if (row.inventory_item_id == null || priceByItem.has(row.inventory_item_id)) continue;
      if (row.total_price == null || row.change_amount <= 0) continue;
      priceByItem.set(row.inventory_item_id, {
        last_total_price: row.total_price,
        unit_cost: row.total_price / row.change_amount,
      });
    }

    return items.map((i) => {
      const price = priceByItem.get(i.id);
      return {
        ...i,
        last_total_price: price?.last_total_price ?? null,
        unit_cost: price?.unit_cost ?? null,
      };
    });
  }

  async create(dto: CreateInventoryItemDto, branchId: number) {
    if (dto.total_price != null && dto.total_price > 0 && dto.quantity <= 0) {
      throw new BadRequestException('Total price is only allowed when initial quantity is greater than zero');
    }
    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        data: { name: dto.name, quantity: dto.quantity, unit: dto.unit, branch_id: branchId },
      });
      if (dto.quantity > 0) {
        await tx.stockTransaction.create({
          data: {
            ...this.snapshotFromItem(created),
            change_amount: dto.quantity,
            type: PrismaStockTxnType.RESTOCK,
            notes: 'Initial stock',
            total_price: dto.total_price != null && dto.total_price > 0 ? dto.total_price : null,
          },
        });
      }
      return created;
    });
    const [enriched] = await this.enrichItemsWithLatestPrice([item]);
    return enriched;
  }

  async findAll(branchId: number, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const where = { branch_id: branchId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    const enriched = await this.enrichItemsWithLatestPrice(data);
    return { data: enriched, total, page, limit };
  }

  async findOne(id: number, branchId: number) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, branch_id: branchId } });
    if (!item) throw new NotFoundException(`Inventory item #${id} not found`);
    const [enriched] = await this.enrichItemsWithLatestPrice([item]);
    return enriched;
  }

  async update(id: number, dto: UpdateInventoryItemDto, branchId: number) {
    await this.findOne(id, branchId);
    const updated = await this.prisma.inventoryItem.update({ where: { id }, data: dto });
    const [enriched] = await this.enrichItemsWithLatestPrice([updated]);
    return enriched;
  }

  async remove(id: number, branchId: number) {
    const item = await this.findOne(id, branchId);
    const usedInRecipes = await this.prisma.productRecipeItem.count({
      where: { inventory_item_id: id },
    });
    if (usedInRecipes > 0) {
      throw new BadRequestException(
        `Cannot delete: this stock item is used in ${usedInRecipes} product recipe(s). Remove it from products first.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      if (item.quantity !== 0) {
        await tx.stockTransaction.create({
          data: {
            ...this.snapshotFromItem(item),
            change_amount: -item.quantity,
            type: PrismaStockTxnType.ADJUSTMENT,
            notes: 'Item deleted — remaining balance removed',
          },
        });
      }
      await tx.inventoryItem.delete({ where: { id } });
    });
    return { message: `Inventory item #${id} deleted` };
  }

  async addStockTransaction(itemId: number, dto: StockTransactionDto, branchId: number) {
    const item = await this.findOne(itemId, branchId);
    if (dto.total_price != null && dto.total_price > 0 && dto.change_amount <= 0) {
      throw new BadRequestException('Total price applies only to restocks (positive quantity)');
    }
    const [txn] = await this.prisma.$transaction([
      this.prisma.stockTransaction.create({
        data: {
          ...this.snapshotFromItem(item),
          change_amount: dto.change_amount,
          type: dto.type as PrismaStockTxnType,
          notes: dto.notes?.trim() || null,
          total_price:
            dto.change_amount > 0 && dto.total_price != null && dto.total_price > 0
              ? dto.total_price
              : null,
        },
      }),
      this.prisma.inventoryItem.update({
        where: { id: itemId },
        data: { quantity: { increment: dto.change_amount } },
      }),
    ]);
    return txn;
  }

  async findStockTransactions(
    branchId: number,
    page = 1,
    limit = 20,
    inventoryItemId?: number,
    fromDate?: string,
    toDate?: string,
  ) {
    const parseYmdStart = (ymd: string): Date | undefined => {
      const [y, m, d] = ymd.split('-').map(Number);
      if (!y || !m || !d) return undefined;
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };
    const parseYmdEndExclusive = (ymd: string): Date | undefined => {
      const start = parseYmdStart(ymd);
      if (!start) return undefined;
      return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);
    };

    const skip = (page - 1) * limit;
    const createdAt: { gte?: Date; lt?: Date } = {};
    const from = fromDate ? parseYmdStart(fromDate) : undefined;
    const to = toDate ? parseYmdEndExclusive(toDate) : undefined;
    if (from) createdAt.gte = from;
    if (to) createdAt.lt = to;

    const where: Prisma.StockTransactionWhereInput = {
      branch_id: branchId,
      ...(inventoryItemId ? { inventory_item_id: inventoryItemId } : {}),
      ...(Object.keys(createdAt).length > 0 ? { created_at: createdAt } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          item: { select: { id: true, name: true, unit: true, quantity: true } },
        },
      }),
      this.prisma.stockTransaction.count({ where }),
    ]);

    return {
      data: data.map((row) => this.mapStockTransactionRow(row)),
      total,
      page,
      limit,
    };
  }

  async transferItem(
    itemId: number,
    fromBranchId: number,
    toBranchId: number,
    quantity?: number,
  ) {
    if (fromBranchId === toBranchId) {
      throw new BadRequestException('Source and destination branch must differ');
    }
    const source = await this.findOne(itemId, fromBranchId);
    const targetBranch = await this.prisma.branch.findUnique({ where: { id: toBranchId } });
    if (!targetBranch?.is_active) throw new NotFoundException('Target branch not found');

    const qty = quantity ?? source.quantity;
    if (qty <= 0) throw new BadRequestException('Transfer quantity must be positive');
    if (qty > source.quantity) {
      throw new BadRequestException(`Insufficient stock (on hand: ${source.quantity})`);
    }

    let dest = await this.prisma.inventoryItem.findFirst({
      where: { branch_id: toBranchId, name: source.name },
    });

    return this.prisma.$transaction(async (tx) => {
      if (!dest) {
        dest = await tx.inventoryItem.create({
          data: {
            branch_id: toBranchId,
            name: source.name,
            unit: source.unit,
            quantity: qty,
          },
        });
      } else {
        dest = await tx.inventoryItem.update({
          where: { id: dest.id },
          data: { quantity: { increment: qty } },
        });
      }

      await tx.inventoryItem.update({
        where: { id: source.id },
        data: { quantity: { decrement: qty } },
      });

      await tx.stockTransaction.create({
        data: {
          ...this.snapshotFromItem(source),
          change_amount: -qty,
          type: PrismaStockTxnType.ADJUSTMENT,
          notes: `Transferred to branch #${toBranchId}`,
        },
      });
      await tx.stockTransaction.create({
        data: {
          ...this.snapshotFromItem(dest),
          change_amount: qty,
          type: PrismaStockTxnType.RESTOCK,
          notes: `Transferred from branch #${fromBranchId}`,
        },
      });

      return { source_item_id: source.id, destination_item: dest, quantity: qty };
    });
  }

  /** Sum recipe usage for an order and apply stock change (allows negative on-hand). */
  private async aggregateOrderUsage(orderId: number, branchId: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const order = await db.order.findFirst({
      where: { id: orderId, branch_id: branchId },
      include: {
        items: {
          include: {
            product: {
              include: {
                recipeItems: { include: { inventoryItem: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException(`Order #${orderId} not found`);

    const totals = new Map<number, number>();
    for (const line of order.items) {
      for (const recipe of line.product.recipeItems) {
        if (!recipe.inventoryItem) continue;
        if (recipe.inventoryItem.branch_id !== branchId) continue;
        if (line.product_size_id != null) {
          if (recipe.product_size_id !== line.product_size_id) continue;
        } else if (recipe.product_size_id != null) {
          continue;
        }
        const use = recipe.quantity * line.quantity;
        totals.set(recipe.inventory_item_id, (totals.get(recipe.inventory_item_id) ?? 0) + use);
      }
    }
    return totals;
  }

  async deductForOrder(orderId: number, branchId: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const order = await db.order.findFirst({
      where: { id: orderId, branch_id: branchId },
      select: { id: true, stock_deducted_at: true },
    });
    if (!order || order.stock_deducted_at) return;

    const totals = await this.aggregateOrderUsage(orderId, branchId, tx);
    if (totals.size === 0) {
      await db.order.update({
        where: { id: orderId },
        data: { stock_deducted_at: new Date() },
      });
      return;
    }

    const apply = async (client: Prisma.TransactionClient) => {
      for (const [inventoryItemId, amount] of totals.entries()) {
        if (amount <= 0) continue;
        const inv = await client.inventoryItem.findUnique({ where: { id: inventoryItemId } });
        if (!inv) continue;
        await client.inventoryItem.update({
          where: { id: inventoryItemId },
          data: { quantity: { decrement: amount } },
        });
        await client.stockTransaction.create({
          data: {
            ...this.snapshotFromItem(inv),
            change_amount: -amount,
            type: PrismaStockTxnType.USAGE,
            order_id: orderId,
          },
        });
      }
      await client.order.update({
        where: { id: orderId },
        data: { stock_deducted_at: new Date() },
      });
    };

    if (tx) await apply(tx);
    else await this.prisma.$transaction(apply);
  }

  async restoreForOrder(orderId: number, branchId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branch_id: branchId },
      select: { id: true, stock_deducted_at: true },
    });
    if (!order?.stock_deducted_at) return;

    const usageTxns = await this.prisma.stockTransaction.findMany({
      where: { order_id: orderId, type: PrismaStockTxnType.USAGE },
    });
    if (usageTxns.length === 0) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { stock_deducted_at: null },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const row of usageTxns) {
        if (!row.inventory_item_id) continue;
        const inv = await tx.inventoryItem.findUnique({ where: { id: row.inventory_item_id } });
        if (!inv) continue;
        const restoreAmount = Math.abs(row.change_amount);
        await tx.inventoryItem.update({
          where: { id: row.inventory_item_id },
          data: { quantity: { increment: restoreAmount } },
        });
        await tx.stockTransaction.create({
          data: {
            ...this.snapshotFromItem(inv),
            change_amount: restoreAmount,
            type: PrismaStockTxnType.RESTOCK,
            order_id: orderId,
            notes: 'Order cancelled — stock restored',
          },
        });
      }
      await tx.order.update({
        where: { id: orderId },
        data: { stock_deducted_at: null },
      });
    });
  }
}
