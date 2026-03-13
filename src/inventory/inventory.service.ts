import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export enum StockTxnType { RESTOCK = 'RESTOCK', USAGE = 'USAGE', ADJUSTMENT = 'ADJUSTMENT' }

export class CreateInventoryItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiProperty() @IsNumber() quantity: number;
  @ApiProperty() @IsString() @IsNotEmpty() unit: string;
}

export class UpdateInventoryItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() unit?: string;
}

export class StockTransactionDto {
  @ApiProperty({ enum: StockTxnType }) @IsEnum(StockTxnType) type: StockTxnType;
  @ApiProperty({ description: 'Positive for restock, negative for usage' }) @IsNumber() change_amount: number;
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateInventoryItemDto) {
    return this.prisma.inventoryItem.create({ data: dto });
  }

  async findAll(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({ skip, take: limit, orderBy: { name: 'asc' } }),
      this.prisma.inventoryItem.count(),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Inventory item #${id} not found`);
    return item;
  }

  async update(id: number, dto: UpdateInventoryItemDto) {
    await this.findOne(id);
    return this.prisma.inventoryItem.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.stockTransaction.deleteMany({ where: { inventory_item_id: id } }),
      this.prisma.inventoryItem.delete({ where: { id } }),
    ]);
    return { message: `Inventory item #${id} deleted` };
  }

  async addStockTransaction(itemId: number, dto: StockTransactionDto) {
    await this.findOne(itemId);
    const [txn] = await this.prisma.$transaction([
      this.prisma.stockTransaction.create({
        data: { inventory_item_id: itemId, change_amount: dto.change_amount, type: dto.type as any },
      }),
      this.prisma.inventoryItem.update({
        where: { id: itemId },
        data: { quantity: { increment: dto.change_amount } },
      }),
    ]);
    return txn;
  }
}
