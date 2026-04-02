import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { AppendOrderNoteDto } from './dto/append-order-note.dto';
import { LoyaltyTxnType, OrderChannel, OrderStatus, OrderType, PaymentMethod, TransactionStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

const DEFAULT_TAX_RATE = 0.15; // 15% – used when store taxRate is missing
const LOYALTY_POINT_UNITS = 2; // 1 point = 2 stored units (supports 0.5 points with Int schema)

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

  private roundMoney(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Convert display points (e.g. 5, 10, 0.5) to stored integer units. */
  private pointsToUnits(points: number): number {
    const raw = Number(points);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.round(raw * LOYALTY_POINT_UNITS);
  }

  /** Loyalty earn rule per product unit: <100 EGP => 0.5 point, >=100 EGP => 1 point. */
  private earnedPointsPerUnitDisplay(unitPrice: number): number {
    const p = Number(unitPrice);
    if (!Number.isFinite(p) || p <= 0) return 0;
    return p < 100 ? 0.5 : 1;
  }

  /** Sum loyalty points per order items (quantity-aware), returned in storage units. */
  private earnedPointsUnitsFromItems(items: Array<{ price: number; quantity: number }>): number {
    let pointsDisplay = 0;
    for (const item of items) {
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      pointsDisplay += this.earnedPointsPerUnitDisplay(item.price) * qty;
    }
    return this.pointsToUnits(pointsDisplay);
  }

  /** Earning after removing up to one free unit of a redeemed product (website gift). */
  private earnedPointsUnitsFromLineItems(
    items: Array<{ product_id: number; price: number; quantity: number }>,
    excludeOneUnitOfProductId: number | null,
  ): number {
    if (!excludeOneUnitOfProductId) {
      return this.earnedPointsUnitsFromItems(
        items.map((i) => ({ price: i.price, quantity: i.quantity })),
      );
    }
    let rem = 1;
    const virtual: { price: number; quantity: number }[] = [];
    for (const i of items) {
      let q = Number(i.quantity);
      if (!Number.isFinite(q) || q <= 0) continue;
      if (rem > 0 && i.product_id === excludeOneUnitOfProductId) {
        const take = Math.min(rem, q);
        q -= take;
        rem -= take;
      }
      if (q > 0) virtual.push({ price: i.price, quantity: q });
    }
    return this.earnedPointsUnitsFromItems(virtual);
  }

  /** One unit of `freeProductId` priced from order lines (server-side prices). */
  private computeFreeProductDiscount(
    itemsData: Array<{ product_id: number; quantity: number; price: number }>,
    freeProductId: number,
  ): number {
    let remaining = 1;
    let discount = 0;
    for (const row of itemsData) {
      if (row.product_id !== freeProductId) continue;
      const q = Math.min(remaining, row.quantity);
      discount += row.price * q;
      remaining -= q;
      if (remaining <= 0) break;
    }
    return this.roundMoney(discount);
  }

  /** Build one or more payment lines; split mode requires ≥2 lines and sum ≈ order total. */
  private resolvePaymentLines(
    dto: CreateOrderDto,
    orderTotal: number,
  ): { payment_method: PaymentMethod; amount: number }[] {
    const target = this.roundMoney(orderTotal);
    if (dto.payments && dto.payments.length > 0) {
      if (dto.payments.length < 2) {
        throw new BadRequestException('Split payment requires at least two payment lines');
      }
      let sum = 0;
      const lines: { payment_method: PaymentMethod; amount: number }[] = [];
      for (const p of dto.payments) {
        const amt = this.roundMoney(Number(p.amount));
        if (!Number.isFinite(amt) || amt <= 0) {
          throw new BadRequestException('Each split payment must be a positive amount');
        }
        sum = this.roundMoney(sum + amt);
        lines.push({ payment_method: p.payment_method as PaymentMethod, amount: amt });
      }
      if (Math.abs(sum - target) > 0.02) {
        throw new BadRequestException(
          `Payment amounts (${sum.toFixed(2)}) must equal order total (${target.toFixed(2)})`,
        );
      }
      return lines;
    }
    if (!dto.payment_method) {
      throw new BadRequestException('payment_method is required when payments are not provided');
    }
    return [{ payment_method: dto.payment_method as PaymentMethod, amount: target }];
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
    void loyaltySettings;

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

    const mergedAddons = new Map<number, number>();
    for (const line of dto.order_addons ?? []) {
      const aid = Number(line.addon_id);
      const q = Number(line.quantity);
      if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(q) || q < 1) {
        throw new BadRequestException('Invalid add-on line');
      }
      mergedAddons.set(aid, (mergedAddons.get(aid) ?? 0) + q);
    }

    const orderAddonsCreate: { addon_id: number; quantity: number; unit_price: number }[] = [];
    for (const [addonId, qty] of mergedAddons) {
      const addon = await this.prisma.addon.findUnique({ where: { id: addonId } });
      if (!addon) throw new NotFoundException(`Add-on #${addonId} not found`);
      if (!addon.is_active) throw new BadRequestException(`Add-on "${addon.name}" is not available`);
      subtotal += addon.price * qty;
      orderAddonsCreate.push({ addon_id: addonId, quantity: qty, unit_price: addon.price });
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

    if (dto.loyalty_gift_id != null && (!(dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0))) {
      throw new BadRequestException('loyalty_points_redeemed is required when loyalty_gift_id is set');
    }
    if (source === 'PUBLIC' && dto.loyalty_free_product_id != null && dto.loyalty_gift_id == null) {
      throw new BadRequestException('loyalty_gift_id is required when loyalty_free_product_id is set');
    }
    if (source === 'POS' && dto.loyalty_free_product_id != null && dto.loyalty_gift_id == null) {
      throw new BadRequestException('loyalty_free_product_id on POS requires loyalty_gift_id');
    }

    // 2. Loyalty redeem: POS catalog gift applies one free unit (same as website). Legacy 5/10 without gift_id = points only.
    let loyaltyPointsToRedeemUnits = 0;
    let loyaltyFreeProductId: number | null = null;
    let loyaltyFreeDiscount = 0;

    if (dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0 && resolvedCustomerId != null) {
      const account = await this.prisma.loyaltyAccount.findUnique({
        where: { customer_id: resolvedCustomerId },
      });
      if (!account) throw new BadRequestException('Customer has no loyalty account');

      if (source === 'PUBLIC') {
        if (dto.loyalty_gift_id == null) {
          throw new BadRequestException('loyalty_gift_id is required for website loyalty redemption');
        }
        const gift = await this.prisma.loyaltyGift.findUnique({ where: { id: dto.loyalty_gift_id } });
        if (!gift?.is_active) {
          throw new BadRequestException('Loyalty reward is not available');
        }
        if (gift.points_required !== dto.loyalty_points_redeemed) {
          throw new BadRequestException('Points do not match this reward');
        }
        const resolvedFreePid = gift.gift_product_id ?? dto.loyalty_free_product_id ?? null;
        if (
          gift.gift_product_id != null &&
          dto.loyalty_free_product_id != null &&
          dto.loyalty_free_product_id !== gift.gift_product_id
        ) {
          throw new BadRequestException('Free product does not match this reward');
        }
        if (resolvedFreePid == null) {
          throw new BadRequestException(
            'loyalty_free_product_id is required when the reward lets you choose any product',
          );
        }
        loyaltyFreeDiscount = this.computeFreeProductDiscount(itemsData, resolvedFreePid);
        if (loyaltyFreeDiscount <= 0) {
          throw new BadRequestException('Add the free reward drink to your cart to checkout');
        }
        loyaltyFreeProductId = resolvedFreePid;
        loyaltyPointsToRedeemUnits = this.pointsToUnits(dto.loyalty_points_redeemed);
      } else {
        if (dto.loyalty_gift_id != null) {
          const gift = await this.prisma.loyaltyGift.findUnique({ where: { id: dto.loyalty_gift_id } });
          if (!gift?.is_active) {
            throw new BadRequestException('Loyalty reward is not available');
          }
          if (gift.points_required !== dto.loyalty_points_redeemed) {
            throw new BadRequestException('Points do not match this reward');
          }
          const resolvedFreePid = gift.gift_product_id ?? dto.loyalty_free_product_id ?? null;
          if (
            gift.gift_product_id != null &&
            dto.loyalty_free_product_id != null &&
            dto.loyalty_free_product_id !== gift.gift_product_id
          ) {
            throw new BadRequestException('Free product does not match this reward');
          }
          if (resolvedFreePid == null) {
            throw new BadRequestException(
              'loyalty_free_product_id is required for this reward when no fixed product is configured',
            );
          }
          loyaltyFreeDiscount = this.computeFreeProductDiscount(itemsData, resolvedFreePid);
          if (loyaltyFreeDiscount <= 0) {
            throw new BadRequestException('Add the free reward drink to the order');
          }
          loyaltyFreeProductId = resolvedFreePid;
          loyaltyPointsToRedeemUnits = this.pointsToUnits(dto.loyalty_points_redeemed);
        } else if (dto.loyalty_points_redeemed !== 5 && dto.loyalty_points_redeemed !== 10) {
          throw new BadRequestException(
            'Loyalty redemption must be either 5 or 10 points, or use loyalty_gift_id with a catalog reward',
          );
        } else {
          loyaltyPointsToRedeemUnits = this.pointsToUnits(dto.loyalty_points_redeemed);
        }
      }

      if (account.points_balance < loyaltyPointsToRedeemUnits) {
        throw new BadRequestException(
          `Insufficient loyalty points. Balance: ${(account.points_balance / LOYALTY_POINT_UNITS).toFixed(1)}`,
        );
      }
    }

    // 3. Calculate totals (tax from store settings)
    const customDiscount = dto.discount || 0;
    const totalDiscount = this.roundMoney(customDiscount + loyaltyFreeDiscount);
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
          loyalty_free_product_id: loyaltyFreeProductId,
          notes: dto.order_notes?.trim() || undefined,
          customer_id: resolvedCustomerId ?? null,
          cashier_id: resolvedCashierId,
          items: { create: itemsData },
          ...(orderAddonsCreate.length
            ? {
                orderAddons: {
                  create: orderAddonsCreate.map((a) => ({
                    addon_id: a.addon_id,
                    quantity: a.quantity,
                    unit_price: a.unit_price,
                  })),
                },
              }
            : {}),
        },
        include: {
          items: { include: { product: true } },
          orderAddons: { include: { addon: true } },
          customer: true,
          cashier: { include: { role: true } },
        },
      });

      // 5. Create transaction record(s) — single tender or split payments
      const paymentLines = this.resolvePaymentLines(dto, total);
      for (const line of paymentLines) {
        await tx.transaction.create({
          data: {
            order_id: createdOrder.id,
            user_id: resolvedCashierId,
            payment_method: line.payment_method,
            amount: line.amount,
            status: 'COMPLETED',
          },
        });
      }

      // 6. Deduct loyalty points if redeemed
      if (loyaltyPointsToRedeemUnits > 0 && resolvedCustomerId != null) {
        await tx.loyaltyAccount.update({
          where: { customer_id: resolvedCustomerId },
          data: { points_balance: { decrement: loyaltyPointsToRedeemUnits } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            customer_id: resolvedCustomerId,
            points_change: -loyaltyPointsToRedeemUnits,
            type: 'REDEEMED',
            related_order_id: createdOrder.id,
          },
        });
      }

      // 7. Award loyalty points on purchase (POS non-delivery immediately; website & POS delivery defer — see tryAwardDeferredLoyaltyPoints)
      if (resolvedCustomerId != null && initialOrderStatus === OrderStatus.COMPLETED) {
        const pointsEarned = this.earnedPointsUnitsFromLineItems(
          itemsData.map((i) => ({
            product_id: i.product_id,
            price: Number(i.price),
            quantity: Number(i.quantity),
          })),
          loyaltyFreeProductId,
        );
        if (pointsEarned > 0) {
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
      select: { id: true, customer_id: true, total: true, status: true, loyalty_free_product_id: true },
    });
    if (!order?.customer_id) return;
    if (order.status === OrderStatus.CANCELLED) return;

    const existingEarned = await this.prisma.loyaltyTransaction.findFirst({
      where: { related_order_id: orderId, type: LoyaltyTxnType.EARNED },
    });
    if (existingEarned) return;

    const orderItems = await this.prisma.orderItem.findMany({
      where: { order_id: orderId },
      select: { product_id: true, price: true, quantity: true },
    });
    const pointsEarned = this.earnedPointsUnitsFromLineItems(
      orderItems.map((i) => ({
        product_id: i.product_id,
        price: Number(i.price),
        quantity: Number(i.quantity),
      })),
      order.loyalty_free_product_id,
    );
    if (pointsEarned <= 0) return;

    await this.prisma.$transaction(async (tx) => {
      const dup = await tx.loyaltyTransaction.findFirst({
        where: { related_order_id: orderId, type: LoyaltyTxnType.EARNED },
      });
      if (dup) return;

      const o = await tx.order.findUnique({
        where: { id: orderId },
        select: { customer_id: true, status: true },
      });
      if (!o?.customer_id) return;
      if (o.status === OrderStatus.CANCELLED) return;

      const oi = await tx.orderItem.findMany({
        where: { order_id: orderId },
        select: { product_id: true, price: true, quantity: true },
      });
      const fullOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: { loyalty_free_product_id: true },
      });
      const pts = this.earnedPointsUnitsFromLineItems(
        oi.map((i) => ({
          product_id: i.product_id,
          price: Number(i.price),
          quantity: Number(i.quantity),
        })),
        fullOrder?.loyalty_free_product_id ?? null,
      );
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
          orderAddons: { include: { addon: true } },
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
        orderAddons: { include: { addon: true } },
        customer: true,
        cashier: { include: { role: true } },
        transactions: true,
        deliveryOrders: true,
      },
    });
    if (!order) throw new NotFoundException(`Order #${id} not found`);
    return order;
  }

  /** Append text to order-level notes (e.g. Instapay payer + ref after checkout). */
  async appendOrderNote(id: number, dto: AppendOrderNoteDto) {
    const order = await this.findOne(id);
    const piece = dto.append_note.trim();
    if (!piece) throw new BadRequestException('Note cannot be empty');
    const prev = order.notes?.trim();
    const next = prev ? `${prev}\n\n${piece}` : piece;
    const updated = await this.prisma.order.update({
      where: { id },
      data: { notes: next },
      include: {
        items: { include: { product: true } },
        orderAddons: { include: { addon: true } },
        customer: true,
        cashier: { include: { role: true } },
        transactions: true,
        deliveryOrders: true,
      },
    });
    this.eventEmitter.emit('order.updated', updated);
    return updated;
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto, user?: { role?: { name: string } }) {
    const order = await this.findOne(id);
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled/refunded orders cannot be changed again');
    }
    if (user?.role?.name === 'CASHIER' && order.status !== OrderStatus.PENDING) {
      throw new ForbiddenException('Cashier can only update status of pending orders');
    }
    const isPrivileged = user?.role?.name === 'ADMIN' || user?.role?.name === 'SUPER_ADMIN';
    if (dto.status === OrderStatus.CANCELLED && !isPrivileged) {
      const ok = await this.settingsService.verifyManagerPin(dto.manager_pin);
      if (!ok) throw new ForbiddenException('Invalid manager PIN');
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === OrderStatus.CANCELLED && dto.cancellation_reason?.trim()
          ? {
              notes: order.notes?.trim()
                ? `${order.notes.trim()}\n\nCancellation reason: ${dto.cancellation_reason.trim()}`
                : `Cancellation reason: ${dto.cancellation_reason.trim()}`,
            }
          : {}),
      },
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

    let addonSubtotal = 0;
    const orderAddonsCreate: { addon_id: number; quantity: number; unit_price: number }[] = [];

    if (dto.order_addons !== undefined) {
      const mergedAddons = new Map<number, number>();
      for (const line of dto.order_addons) {
        const aid = Number(line.addon_id);
        const q = Number(line.quantity);
        if (!Number.isFinite(aid) || aid <= 0 || !Number.isFinite(q) || q < 1) {
          throw new BadRequestException('Invalid add-on line');
        }
        mergedAddons.set(aid, (mergedAddons.get(aid) ?? 0) + q);
      }
      for (const [addonId, qty] of mergedAddons) {
        const addon = await this.prisma.addon.findUnique({ where: { id: addonId } });
        if (!addon) throw new NotFoundException(`Add-on #${addonId} not found`);
        if (!addon.is_active) throw new BadRequestException(`Add-on "${addon.name}" is not available`);
        addonSubtotal += addon.price * qty;
        orderAddonsCreate.push({ addon_id: addonId, quantity: qty, unit_price: addon.price });
      }
    } else {
      const existing = order.orderAddons ?? [];
      for (const row of existing) {
        addonSubtotal += row.unit_price * row.quantity;
      }
    }

    subtotal += addonSubtotal;

    const discount = dto.discount ?? order.discount;
    const discountedSubtotal = Math.max(subtotal - discount, 0);
    const tax = discountedSubtotal * taxRate;
    const total = discountedSubtotal + tax;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { order_id: id } });
      if (dto.order_addons !== undefined) {
        await tx.orderAddon.deleteMany({ where: { order_id: id } });
      }
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
          ...(dto.order_addons !== undefined && orderAddonsCreate.length > 0
            ? {
                orderAddons: {
                  create: orderAddonsCreate.map((a) => ({
                    addon_id: a.addon_id,
                    quantity: a.quantity,
                    unit_price: a.unit_price,
                  })),
                },
              }
            : {}),
        },
        include: {
          items: { include: { product: true } },
          orderAddons: { include: { addon: true } },
          customer: true,
        },
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
    if (order.status === OrderStatus.CANCELLED || order.transactions?.some((t) => t.status === TransactionStatus.REFUNDED)) {
      throw new BadRequestException('Cancelled/refunded orders cannot be changed again');
    }
    const isPrivileged = user?.role?.name === 'ADMIN' || user?.role?.name === 'SUPER_ADMIN';
    if (!isPrivileged) {
      const ok = await this.settingsService.verifyManagerPin(dto.manager_pin);
      if (!ok) {
        throw new ForbiddenException('Invalid manager PIN');
      }
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
