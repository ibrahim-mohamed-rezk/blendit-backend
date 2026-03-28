import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryStatus, OrderStatus, Prisma } from '@prisma/client';
import { UpdateDeliveryStatusDto, CreateDeliveryOrderDto, UpdateDeliveryOrderDto } from './dto/delivery.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private ordersService: OrdersService,
  ) {}

  /** Keep `orders.status` aligned with delivery workflow (history, admin, analytics use Order). */
  private deliveryStatusToOrderStatus(status: DeliveryStatus): OrderStatus {
    switch (status) {
      case DeliveryStatus.NEW:
        return OrderStatus.PENDING;
      case DeliveryStatus.ACCEPTED:
        return OrderStatus.PREPARING;
      case DeliveryStatus.PREPARING:
        return OrderStatus.PREPARING;
      case DeliveryStatus.READY:
        return OrderStatus.READY;
      case DeliveryStatus.OUT_FOR_DELIVERY:
        return OrderStatus.READY;
      case DeliveryStatus.COMPLETED:
        return OrderStatus.COMPLETED;
      case DeliveryStatus.CANCELLED:
        return OrderStatus.CANCELLED;
      default:
        return OrderStatus.PENDING;
    }
  }

  private async syncLinkedOrderStatus(orderId: number, deliveryStatus: DeliveryStatus): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === OrderStatus.REFUNDED) return;

    const nextStatus = this.deliveryStatusToOrderStatus(deliveryStatus);
    if (order.status === nextStatus) return;

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: nextStatus },
      include: { items: { include: { product: true } }, customer: true },
    });

    this.eventEmitter.emit('order.statusUpdated', updated);
  }

  async createDeliveryOrder(dto: CreateDeliveryOrderDto) {
    const delivery = await this.prisma.deliveryOrder.create({
      data: {
        order_id: dto.order_id,
        customer_id: dto.customer_id,
        address: dto.address,
        notes: dto.notes,
        status: 'NEW',
      },
      include: { order: { include: { items: { include: { product: true } }, transactions: true } }, customer: true },
    });
    this.eventEmitter.emit('delivery.created', delivery);
    return delivery;
  }

  async findAll(page = 1, limit = 10, status?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.DeliveryOrderWhereInput = {};
    if (status) where.status = status as DeliveryStatus;
    if (search) {
      where.OR = [
        { order: { order_number: { contains: search, mode: 'insensitive' } } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.deliveryOrder.findMany({
        where, skip, take: limit,
        include: { order: { include: { items: { include: { product: true } }, transactions: true } }, customer: true },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.deliveryOrder.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const order = await this.prisma.deliveryOrder.findUnique({
      where: { id },
      include: { order: { include: { items: { include: { product: true } }, transactions: true } }, customer: true },
    });
    if (!order) throw new NotFoundException(`Delivery order #${id} not found`);
    return order;
  }

  async updateStatus(id: number, dto: UpdateDeliveryStatusDto) {
    await this.findOne(id);
    const updated = await this.prisma.deliveryOrder.update({
      where: { id },
      data: { status: dto.status },
      include: { order: true, customer: true },
    });

    await this.syncLinkedOrderStatus(updated.order_id, dto.status);

    if (
      dto.status === DeliveryStatus.OUT_FOR_DELIVERY ||
      dto.status === DeliveryStatus.COMPLETED
    ) {
      await this.ordersService.tryAwardDeferredLoyaltyPoints(updated.order_id);
    }

    this.eventEmitter.emit('delivery.statusUpdated', updated);
    return updated;
  }

  async update(id: number, dto: UpdateDeliveryOrderDto) {
    await this.findOne(id);
    const data: { address?: string; notes?: string } = {};
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.notes !== undefined) data.notes = dto.notes;
    const updated = await this.prisma.deliveryOrder.update({
      where: { id },
      data,
      include: { order: { include: { items: { include: { product: true } }, transactions: true } }, customer: true },
    });
    this.eventEmitter.emit('delivery.updated', updated);
    return updated;
  }
}
