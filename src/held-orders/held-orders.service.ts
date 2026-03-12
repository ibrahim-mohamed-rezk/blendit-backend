import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHeldOrderDto } from './dto/create-held-order.dto';

@Injectable()
export class HeldOrdersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateHeldOrderDto, cashierId: number) {
    const held = await this.prisma.heldOrder.create({
      data: {
        cashier_id: cashierId,
        order_type: dto.order_type,
        table_number: dto.table_number || null,
        customer_id: dto.customer_id || null,
        notes: dto.notes || null,
        items: dto.items as any,
        subtotal: dto.subtotal,
        tax: dto.tax,
        discount: dto.discount ?? 0,
        total: dto.total,
      },
      include: {
        customer: true,
        cashier: true,
      },
    });
    return held;
  }

  async findAll(cashierId?: number) {
    const where: { cashier_id?: number } = {};
    if (cashierId != null) where.cashier_id = cashierId;

    const list = await this.prisma.heldOrder.findMany({
      where,
      include: { customer: true, cashier: true },
      orderBy: { created_at: 'desc' },
    });

    return list.map((h) => ({
      id: h.id,
      orderNumber: `HLD-${String(h.id).padStart(4, '0')}`,
      type: h.order_type.toLowerCase().replace('_', '-'),
      customerName: h.customer?.name,
      tableNumber: h.table_number,
      notes: h.notes,
      items: (h.items as any[]).map((it, i) => ({
        id: String(i),
        productId: String(it.product_id),
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        notes: it.notes,
        modificationsSummary: it.modificationsSummary,
        customizations: it.customizations,
      })),
      subtotal: h.subtotal,
      tax: h.tax,
      discount: h.discount,
      total: h.total,
      createdAt: h.created_at.toISOString(),
    }));
  }

  async findOne(id: number) {
    const h = await this.prisma.heldOrder.findUnique({
      where: { id },
      include: { customer: true, cashier: true },
    });
    if (!h) throw new NotFoundException(`Held order #${id} not found`);
    return {
      id: h.id,
      orderNumber: `HLD-${String(h.id).padStart(4, '0')}`,
      type: h.order_type.toLowerCase().replace('_', '-'),
      customerName: h.customer?.name,
      customerId: h.customer_id,
      tableNumber: h.table_number,
      notes: h.notes,
      items: (h.items as any[]).map((it, i) => ({
        id: String(i),
        productId: String(it.product_id),
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        notes: it.notes,
        modificationsSummary: it.modificationsSummary,
        customizations: it.customizations,
      })),
      subtotal: h.subtotal,
      tax: h.tax,
      discount: h.discount,
      total: h.total,
      createdAt: h.created_at.toISOString(),
    };
  }

  async remove(id: number) {
    await this.prisma.heldOrder.delete({ where: { id } });
    return { success: true };
  }
}
