import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDeliveryStatusDto, CreateDeliveryOrderDto } from './dto/delivery.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async createDeliveryOrder(dto: CreateDeliveryOrderDto) {
    const delivery = await this.prisma.deliveryOrder.create({
      data: {
        order_id: dto.order_id,
        customer_id: dto.customer_id,
        address: dto.address,
        notes: dto.notes,
        status: 'NEW',
      },
      include: { order: { include: { items: { include: { product: true } } } }, customer: true },
    });
    this.eventEmitter.emit('delivery.created', delivery);
    return delivery;
  }

  async findAll(page = 1, limit = 10, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.deliveryOrder.findMany({
        where, skip, take: limit,
        include: { order: { include: { items: { include: { product: true } } } }, customer: true },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.deliveryOrder.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const order = await this.prisma.deliveryOrder.findUnique({
      where: { id },
      include: { order: { include: { items: { include: { product: true } } } }, customer: true },
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
    this.eventEmitter.emit('delivery.statusUpdated', updated);
    return updated;
  }
}
