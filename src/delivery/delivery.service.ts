import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryStatus, OrderStatus, Prisma } from '@prisma/client';
import { UpdateDeliveryStatusDto, CreateDeliveryOrderDto, UpdateDeliveryOrderDto } from './dto/delivery.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private ordersService: OrdersService,
    private settingsService: SettingsService,
  ) {}

  /** Map delivery row → `orders.status`: NEW → PENDING, COMPLETED → COMPLETED, CANCELLED cancels pending sale. */
  private deliveryProgressToOrderStatus(
    deliveryStatus: DeliveryStatus,
    currentOrderStatus: OrderStatus,
  ): OrderStatus | null {
    if (currentOrderStatus === OrderStatus.CANCELLED) {
      return null;
    }
    if (deliveryStatus === DeliveryStatus.CANCELLED) {
      if (currentOrderStatus === OrderStatus.PENDING) return OrderStatus.CANCELLED;
      return null;
    }
    if (deliveryStatus === DeliveryStatus.COMPLETED) {
      return OrderStatus.COMPLETED;
    }
    if (currentOrderStatus === OrderStatus.COMPLETED) {
      return null;
    }
    return OrderStatus.PENDING;
  }

  private async syncLinkedOrderStatus(orderId: number, deliveryStatus: DeliveryStatus): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) return;

    const nextStatus = this.deliveryProgressToOrderStatus(deliveryStatus, order.status);
    if (nextStatus == null || order.status === nextStatus) return;

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

  private async appendLinkedOrderCancellationNote(orderId: number, reason: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { notes: true },
    });
    if (!order) return;
    const piece = `Cancellation reason: ${reason}`;
    const next = order.notes?.trim() ? `${order.notes.trim()}\n\n${piece}` : piece;
    await this.prisma.order.update({
      where: { id: orderId },
      data: { notes: next },
    });
  }

  async updateStatus(
    id: number,
    dto: UpdateDeliveryStatusDto,
    user?: { role?: { name: string } },
  ) {
    const existing = await this.findOne(id);
    const cur = existing.status as DeliveryStatus;
    if (cur === DeliveryStatus.COMPLETED || cur === DeliveryStatus.CANCELLED) {
      if (dto.status === cur) {
        return await this.findOne(id);
      }
      throw new BadRequestException('This delivery is already completed or canceled');
    }
    if (cur === DeliveryStatus.NEW) {
      if (dto.status !== DeliveryStatus.COMPLETED && dto.status !== DeliveryStatus.CANCELLED) {
        throw new BadRequestException('From a new delivery, only complete or cancel is allowed');
      }
    }

    if (dto.status === DeliveryStatus.CANCELLED) {
      if (!dto.cancellation_reason?.trim()) {
        throw new BadRequestException('Cancellation reason is required');
      }
      const ok = await this.settingsService.verifyManagerPin(dto.manager_pin);
      if (!ok) throw new ForbiddenException('Invalid manager PIN');
    }

    let deliveryNotes: string | undefined;
    if (dto.status === DeliveryStatus.CANCELLED && dto.cancellation_reason?.trim()) {
      const reason = dto.cancellation_reason.trim();
      const prev = existing.notes?.trim();
      deliveryNotes = prev ? `${prev}\n\nCancellation reason: ${reason}` : `Cancellation reason: ${reason}`;
    }

    const updated = await this.prisma.deliveryOrder.update({
      where: { id },
      data: {
        status: dto.status,
        ...(deliveryNotes != null ? { notes: deliveryNotes } : {}),
      },
      include: { order: true, customer: true },
    });

    if (dto.status === DeliveryStatus.CANCELLED && dto.cancellation_reason?.trim()) {
      await this.appendLinkedOrderCancellationNote(updated.order_id, dto.cancellation_reason.trim());
    }

    await this.syncLinkedOrderStatus(updated.order_id, dto.status);

    const refreshed = await this.prisma.order.findUnique({
      where: { id: updated.order_id },
      select: { status: true },
    });
    if (refreshed?.status === OrderStatus.COMPLETED) {
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
