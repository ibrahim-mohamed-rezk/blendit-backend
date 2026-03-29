import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { LoyaltyTxnType, OrderChannel, OrderStatus, OrderType, PaymentMethod, TransactionStatus } from '@prisma/client';
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

  private async resolveCashierId(inputCashierId?: number): Promise<number> {
    if (typeof inputCashierId === 'number' && Number.isFinite(inputCashierId)) {
      const exists = await this.prisma.user.findUnique({ where: { id: inputCashierId } });
      if (exists) return inputCashierId;
    }

    const fallback = await this.prisma.user.findFirst({
      where: {
        is_active: true,
        role: { name: { in: ['CASHIER', 'ADMIN', 'SUPER_ADMIN'] } },
      },
      orderBy: { id: 'asc' },
    });

    if (!fallback) {
      throw new BadRequestException('No active cashier/admin user found to process this order');
    }

    return fallback.id;
  }

  /** Combine website order-level note with delivery-specific notes for queue / POS visibility. */
  private combineOrderAndDeliveryNotes(orderNotes?: string, deliveryNotes?: string): string | undefined {
    const o = orderNotes?.trim();
    const d = deliveryNotes?.trim();
    if (o && d) return `${o}\n\n${d}`;
    return o || d || undefined;
  }

  private async generateOrderNumber(): Promise<string> {
    const count = await this.prisma.order.count();
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return `BLD-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }

  async create(dto: CreateOrderDto, cashierId?: number, source: 'POS' | 'PUBLIC' = 'POS') {
    const resolvedCashierId = await this.resolveCashierId(cashierId);
    const [storeSettings, loyaltySettings] = await Promise.all([
      this.settingsService.getStore(),
      this.settingsService.getLoyalty(),
    ]);
    const taxRateRaw = Number(storeSettings?.taxRate);
    const taxRatePct = Number.isFinite(taxRateRaw) ? taxRateRaw : 15;
    const taxRate = taxRatePct / 100;
    const currencyValuePerPointRaw = Number(loyaltySettings?.currencyValuePerPoint);
    const currencyValuePerPoint = Number.isFinite(currencyValuePerPointRaw)
      ? currencyValuePerPointRaw
      : DEFAULT_CURRENCY_VALUE_PER_POINT;
    const pointsPerCurrencyRaw = Number(loyaltySettings?.pointsPerCurrency);
    const pointsPerCurrency = Number.isFinite(pointsPerCurrencyRaw) && pointsPerCurrencyRaw > 0
      ? pointsPerCurrencyRaw
      : DEFAULT_POINTS_PER_CURRENCY;

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

    // 1b. Ensure customer_id exists before connect (avoids Prisma 500 on stale website sessions / DB resets)
    let resolvedCustomerId: number | undefined;
    if (dto.customer_id != null && Number.isFinite(Number(dto.customer_id))) {
      const cid = Number(dto.customer_id);
      const customerExists = await this.prisma.customer.findUnique({
        where: { id: cid },
        select: { id: true },
      });
      if (customerExists) {
        resolvedCustomerId = cid;
      } else if (source === 'PUBLIC') {
        resolvedCustomerId = undefined;
      } else {
        throw new BadRequestException(`Customer #${cid} not found`);
      }
    }

    if ((dto.loyalty_points_redeemed ?? 0) > 0 && resolvedCustomerId == null) {
      throw new BadRequestException('Valid customer is required to redeem loyalty points');
    }

    // 2. Apply loyalty redemption discount (using store loyalty settings)
    let loyaltyDiscount = 0;
    if (dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0 && resolvedCustomerId != null) {
      const account = await this.prisma.loyaltyAccount.findUnique({
        where: { customer_id: resolvedCustomerId },
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

    const isPosDeliveryCheckout = source === 'POS' && dto.order_type === OrderType.DELIVERY;
    const initialOrderStatus =
      source === 'PUBLIC' || isPosDeliveryCheckout ? OrderStatus.PENDING : OrderStatus.COMPLETED;

    // 4. Create order in a transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.generateOrderNumber();
      const createdOrder = await tx.order.create({
        data: {
          order_number: orderNumber,
          order_type: dto.order_type,
          status: initialOrderStatus,
          channel: source === 'PUBLIC' ? OrderChannel.WEBSITE : OrderChannel.POS,
          subtotal,
          tax,
          discount: totalDiscount,
          total,
          notes: dto.order_notes?.trim() || undefined,
          customer:
            resolvedCustomerId != null
              ? {
                  connect: { id: resolvedCustomerId },
                }
              : undefined,
          cashier: {
            connect: { id: resolvedCashierId },
          },
          items: { create: itemsData },
        },
        include: { items: { include: { product: true } }, customer: true, cashier: { include: { role: true } } },
      });

      // 5. Create transaction record
      await tx.transaction.create({
        data: {
          order_id: createdOrder.id,
          user_id: resolvedCashierId,
          payment_method: dto.payment_method as PaymentMethod,
          amount: total,
          status: 'COMPLETED',
        },
      });

      // 6. Deduct loyalty points if redeemed
      if (dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0 && resolvedCustomerId != null) {
        await tx.loyaltyAccount.update({
          where: { customer_id: resolvedCustomerId },
          data: { points_balance: { decrement: dto.loyalty_points_redeemed } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            customer_id: resolvedCustomerId,
            points_change: -dto.loyalty_points_redeemed,
            type: 'REDEEMED',
            related_order_id: createdOrder.id,
          },
        });
      }

      // 7. Award loyalty points on purchase (POS non-delivery immediately; website & POS delivery defer — see tryAwardDeferredLoyaltyPoints)
      if (resolvedCustomerId != null && initialOrderStatus === OrderStatus.COMPLETED) {
        const pointsEarned = Math.floor(total * pointsPerCurrency);
        await tx.loyaltyAccount.upsert({
          where: { customer_id: resolvedCustomerId },
          update: { points_balance: { increment: pointsEarned } },
          create: { customer_id: resolvedCustomerId, points_balance: pointsEarned },
        });
        await tx.loyaltyTransaction.create({
          data: {
            customer_id: resolvedCustomerId,
            points_change: pointsEarned,
            type: 'EARNED',
            related_order_id: createdOrder.id,
          },
        });
      }

      // 8. Create delivery order if type is DELIVERY.
      // For PUBLIC website orders, also mirror non-delivery orders into delivery queue
      // so POS delivery tab can track website incoming orders in one place.
      if (dto.order_type === 'DELIVERY' && resolvedCustomerId != null && dto.delivery_address) {
        await tx.deliveryOrder.create({
          data: {
            order_id: createdOrder.id,
            customer_id: resolvedCustomerId,
            address: dto.delivery_address,
            notes: this.combineOrderAndDeliveryNotes(dto.order_notes, dto.delivery_notes),
            status: 'NEW',
          },
        });
      } else if (
        source === 'PUBLIC' &&
        resolvedCustomerId != null &&
        dto.order_type !== 'DELIVERY'
      ) {
        await tx.deliveryOrder.create({
          data: {
            order_id: createdOrder.id,
            customer_id: resolvedCustomerId,
            address: dto.delivery_address?.trim() || 'Website order (walk-in pickup)',
            notes:
              this.combineOrderAndDeliveryNotes(dto.order_notes, dto.delivery_notes) ?? 'Source: WEBSITE',
            status: 'NEW',
          },
        });
      }

      return createdOrder;
    });

    // 9. Activity log and real-time events
    await this.activityLogs.create({
      user_id: resolvedCashierId,
      action: 'create_order',
      entity: 'Order',
      entity_id: order.id,
      metadata: {
        order_number: order.order_number,
        total: order.total,
        client_order_id: dto.client_order_id,
      },
    });
    this.eventEmitter.emit('order.created', { order, source });

    return order;
  }

  /**
   * Website orders skip EARNED at checkout. Award once when delivery is out for delivery or completed,
   * or when the order is marked completed (idempotent via existing EARNED txn).
   */
  async tryAwardDeferredLoyaltyPoints(orderId: number): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customer_id: true, total: true, status: true },
    });
    if (!order?.customer_id) return;
    if (order.status === OrderStatus.CANCELLED) return;

    const existingEarned = await this.prisma.loyaltyTransaction.findFirst({
      where: { related_order_id: orderId, type: LoyaltyTxnType.EARNED },
    });
    if (existingEarned) return;

    const loyaltySettings = await this.settingsService.getLoyalty();
    const pointsPerCurrencyRaw = Number(loyaltySettings?.pointsPerCurrency);
    const pointsPerCurrency = Number.isFinite(pointsPerCurrencyRaw) && pointsPerCurrencyRaw > 0
      ? pointsPerCurrencyRaw
      : DEFAULT_POINTS_PER_CURRENCY;

    const pointsEarned = Math.floor(order.total * pointsPerCurrency);
    if (pointsEarned <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      const dup = await tx.loyaltyTransaction.findFirst({
        where: { related_order_id: orderId, type: LoyaltyTxnType.EARNED },
      });
      if (dup) return;

      const o = await tx.order.findUnique({
        where: { id: orderId },
        select: { customer_id: true, total: true, status: true },
      });
      if (!o?.customer_id) return;
      if (o.status === OrderStatus.CANCELLED) return;

      const pts = Math.floor(o.total * pointsPerCurrency);
      if (pts <= 0) return;

      await tx.loyaltyAccount.upsert({
        where: { customer_id: o.customer_id },
        update: { points_balance: { increment: pts } },
        create: { customer_id: o.customer_id, points_balance: pts },
      });
      await tx.loyaltyTransaction.create({
        data: {
          customer_id: o.customer_id,
          points_change: pts,
          type: LoyaltyTxnType.EARNED,
          related_order_id: orderId,
        },
      });
    });
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
        include: {
          items: { include: { product: true } },
          customer: true,
          transactions: true,
          deliveryOrders: true,
        },
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
    if (user?.role?.name === 'CASHIER' && order.status !== OrderStatus.PENDING) {
      throw new ForbiddenException('Cashier can only update status of pending orders');
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
      include: { items: { include: { product: true } }, customer: true },
    });
    if (dto.status === OrderStatus.COMPLETED) {
      await this.tryAwardDeferredLoyaltyPoints(id);
    }
    this.eventEmitter.emit('order.statusUpdated', updated);
    return updated;
  }

  async update(id: number, dto: UpdateOrderDto, user: { role?: { name: string } }) {
    const order = await this.findOne(id);
    if (user?.role?.name === 'CASHIER' && order.status !== OrderStatus.PENDING) {
      throw new ForbiddenException('Cashier can only update pending orders');
    }
    if (!dto.items?.length) throw new BadRequestException('Order must have at least one item');

    const storeSettings = await this.settingsService.getStore();
    const taxRateRaw = Number(storeSettings?.taxRate);
    const taxRatePct = Number.isFinite(taxRateRaw) ? taxRateRaw : DEFAULT_TAX_RATE * 100;
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
          customer:
            dto.customer_id !== undefined
              ? dto.customer_id === null
                ? { disconnect: true }
                : { connect: { id: dto.customer_id } }
              : undefined,
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

  async refund(id: number, dto: RefundOrderDto, user: { id: number; role?: { name: string } }) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        customer: true,
        transactions: true,
      },
    });
    if (!order) throw new NotFoundException(`Order #${id} not found`);

    const hasCompletedTxn = order.transactions?.some((t) => t.status === TransactionStatus.COMPLETED);
    if (!hasCompletedTxn) {
      throw new BadRequestException('Order has no completed payment to refund');
    }

    // Mark completed payments as refunded; order is canceled (same as manual cancel for reporting)
    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: OrderStatus.CANCELLED,
        transactions: {
          updateMany: {
            where: { status: TransactionStatus.COMPLETED },
            data: { status: TransactionStatus.REFUNDED },
          },
        },
      },
      include: {
        items: { include: { product: true } },
        customer: true,
        transactions: true,
        deliveryOrders: true,
      },
    });

    await this.activityLogs.create({
      user_id: user.id,
      action: 'refund',
      entity: 'Order',
      entity_id: id,
      metadata: dto?.reason ? { reason: dto.reason } : undefined,
    });

    this.eventEmitter.emit('order.refunded', updated);
    return updated;
  }
}
