import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

const DEFAULT_TAX_RATE = 0.15; // 15% – used when store taxRate is missing
const DEFAULT_POINTS_PER_CURRENCY = 1;
const DEFAULT_CURRENCY_VALUE_PER_POINT = 0.01;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private settingsService: SettingsService,
    private activityLogs: ActivityLogsService,
  ) {}

  private async generateOrderNumber(): Promise<string> {
    const count = await this.prisma.order.count();
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return `BLD-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }

  async create(dto: CreateOrderDto, cashierId: number) {
    const [storeSettings, loyaltySettings] = await Promise.all([
      this.settingsService.getStore(),
      this.settingsService.getLoyalty(),
    ]);
    const taxRatePct = Number(storeSettings?.taxRate) ?? 15;
    const taxRate = taxRatePct / 100;
    const currencyValuePerPoint = Number(loyaltySettings?.currencyValuePerPoint) ?? DEFAULT_CURRENCY_VALUE_PER_POINT;
    const pointsPerCurrency = Number(loyaltySettings?.pointsPerCurrency) || DEFAULT_POINTS_PER_CURRENCY;

    // 1. Validate and calculate items
    let subtotal = 0;
    const itemsData: any[] = [];

    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({ where: { id: item.product_id } });
      if (!product) throw new NotFoundException(`Product #${item.product_id} not found`);
      if (!product.is_available) throw new BadRequestException(`Product "${product.name}" is not available`);

      const lineTotal = product.price * item.quantity;
      subtotal += lineTotal;
      itemsData.push({
        product_id: item.product_id,
        quantity: item.quantity,
        price: product.price,
        notes: item.notes,
        customizations: item.customizations || {},
      });
    }

    // 2. Apply loyalty redemption discount (using store loyalty settings)
    let loyaltyDiscount = 0;
    if (dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0 && dto.customer_id) {
      const account = await this.prisma.loyaltyAccount.findUnique({
        where: { customer_id: dto.customer_id },
      });
      if (!account) throw new BadRequestException('Customer has no loyalty account');
      if (account.points_balance < dto.loyalty_points_redeemed) {
        throw new BadRequestException(`Insufficient loyalty points. Balance: ${account.points_balance}`);
      }
      loyaltyDiscount = dto.loyalty_points_redeemed * currencyValuePerPoint;
    }

    // 3. Calculate totals (tax from store settings)
    const customDiscount = dto.discount || 0;
    const totalDiscount = customDiscount + loyaltyDiscount;
    const discountedSubtotal = Math.max(subtotal - totalDiscount, 0);
    const tax = discountedSubtotal * taxRate;
    const total = discountedSubtotal + tax;

    // 4. Create order in a transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.generateOrderNumber();
      const createdOrder = await tx.order.create({
        data: {
          order_number: orderNumber,
          customer_id: dto.customer_id || null,
          cashier_id: cashierId,
          order_type: dto.order_type,
          status: OrderStatus.PENDING,
          subtotal,
          tax,
          discount: totalDiscount,
          total,
          items: { create: itemsData },
        },
        include: { items: { include: { product: true } }, customer: true, cashier: { include: { role: true } } },
      });

      // 5. Create transaction record
      await tx.transaction.create({
        data: {
          order_id: createdOrder.id,
          user_id: cashierId,
          payment_method: dto.payment_method as PaymentMethod,
          amount: total,
          status: 'COMPLETED',
        },
      });

      // 6. Deduct loyalty points if redeemed
      if (dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0 && dto.customer_id) {
        await tx.loyaltyAccount.update({
          where: { customer_id: dto.customer_id },
          data: { points_balance: { decrement: dto.loyalty_points_redeemed } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            customer_id: dto.customer_id,
            points_change: -dto.loyalty_points_redeemed,
            type: 'REDEEMED',
            related_order_id: createdOrder.id,
          },
        });
      }

      // 7. Award loyalty points on purchase (using store loyalty settings)
      if (dto.customer_id) {
        const pointsEarned = Math.floor(total * pointsPerCurrency);
        await tx.loyaltyAccount.upsert({
          where: { customer_id: dto.customer_id },
          update: { points_balance: { increment: pointsEarned } },
          create: { customer_id: dto.customer_id, points_balance: pointsEarned },
        });
        await tx.loyaltyTransaction.create({
          data: {
            customer_id: dto.customer_id,
            points_change: pointsEarned,
            type: 'EARNED',
            related_order_id: createdOrder.id,
          },
        });
      }

      // 8. Create delivery order if type is DELIVERY
      if (dto.order_type === 'DELIVERY' && dto.customer_id && dto.delivery_address) {
        await tx.deliveryOrder.create({
          data: {
            order_id: createdOrder.id,
            customer_id: dto.customer_id,
            address: dto.delivery_address,
            notes: dto.delivery_notes,
            status: 'NEW',
          },
        });
      }

      return createdOrder;
    });

    // 9. Activity log and real-time events
    await this.activityLogs.create({
      user_id: cashierId,
      action: 'create_order',
      entity: 'Order',
      entity_id: order.id,
      metadata: { order_number: order.order_number, total: order.total },
    });
    this.eventEmitter.emit('order.created', order);

    return order;
  }

  async findAll(
    page = 1,
    limit = 10,
    status?: OrderStatus,
    type?: string,
    date?: string,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (type) where.order_type = type;
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      where.created_at = { gte: start, lt: end };
    }
    if (search) {
      where.OR = [
        { order_number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search, mode: 'insensitive' } } },
        { items: { some: { product: { name: { contains: search, mode: 'insensitive' } } } } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where, skip, take: limit,
        include: { items: { include: { product: true } }, customer: true, deliveryOrders: true },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        customer: true,
        cashier: { include: { role: true } },
        transactions: true,
        deliveryOrders: true,
      },
    });
    if (!order) throw new NotFoundException(`Order #${id} not found`);
    return order;
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto, user?: { role?: { name: string } }) {
    const order = await this.findOne(id);
    const cashierEditableStatuses: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY];
    if (user?.role?.name === 'CASHIER' && !cashierEditableStatuses.includes(order.status)) {
      throw new ForbiddenException('Cashier can only update status of pending, preparing, or ready orders');
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
      include: { items: { include: { product: true } }, customer: true },
    });
    this.eventEmitter.emit('order.statusUpdated', updated);
    return updated;
  }

  async update(id: number, dto: UpdateOrderDto, user: { role?: { name: string } }) {
    const order = await this.findOne(id);
    const cashierEditableStatuses: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY];
    if (user?.role?.name === 'CASHIER' && !cashierEditableStatuses.includes(order.status)) {
      throw new ForbiddenException('Cashier can only update pending, preparing, or ready orders');
    }
    if (!dto.items?.length) throw new BadRequestException('Order must have at least one item');

    const storeSettings = await this.settingsService.getStore();
    const taxRatePct = Number(storeSettings?.taxRate) ?? DEFAULT_TAX_RATE * 100;
    const taxRate = taxRatePct / 100;

    let subtotal = 0;
    const itemsData: any[] = [];
    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({ where: { id: item.product_id } });
      if (!product) throw new NotFoundException(`Product #${item.product_id} not found`);
      if (!product.is_available) throw new BadRequestException(`Product "${product.name}" is not available`);
      const lineTotal = product.price * item.quantity;
      subtotal += lineTotal;
      itemsData.push({
        product_id: item.product_id,
        quantity: item.quantity,
        price: product.price,
        notes: item.notes,
        customizations: item.customizations || {},
      });
    }

    const discount = dto.discount ?? order.discount;
    const discountedSubtotal = Math.max(subtotal - discount, 0);
    const tax = discountedSubtotal * taxRate;
    const total = discountedSubtotal + tax;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { order_id: id } });
      return tx.order.update({
        where: { id },
        data: {
          customer_id: dto.customer_id !== undefined ? dto.customer_id : order.customer_id,
          discount,
          subtotal,
          tax,
          total,
          items: { create: itemsData },
        },
        include: { items: { include: { product: true } }, customer: true },
      });
    });

    this.eventEmitter.emit('order.updated', updated);
    return updated;
  }
}
