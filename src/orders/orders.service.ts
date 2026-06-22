import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BranchScope, orderBranchWhere } from '../common/branch-scope';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { AppendOrderNoteDto } from './dto/append-order-note.dto';
import {
  DeliveryStatus,
  LoyaltyTxnType,
  OrderChannel,
  OrderStatus,
  OrderType,
  PaymentMethod,
  Prisma,
  TransactionStatus,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { computeOrderTotals, resolveTaxRatePct } from './order-pricing';

const LOYALTY_POINT_UNITS = 2; // 1 point = 2 stored units (supports 0.5 points with Int schema)

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private settingsService: SettingsService,
    private activityLogs: ActivityLogsService,
    private inventoryService: InventoryService,
  ) {}

  /** When a sale is canceled/refunded, keep POS delivery queue in sync with the same order. */
  private async cancelLinkedDeliveryOrders(orderId: number): Promise<void> {
    await this.prisma.deliveryOrder.updateMany({
      where: {
        order_id: orderId,
        status: { not: DeliveryStatus.CANCELLED },
      },
      data: { status: DeliveryStatus.CANCELLED },
    });
  }

  /** Flip completed payments to refunded rows with negative amounts (Transactions page ledger). */
  private async reverseCompletedPaymentTransactions(
    orderId: number,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const completed = await db.transaction.findMany({
      where: { order_id: orderId, status: TransactionStatus.COMPLETED },
    });
    for (const t of completed) {
      await db.transaction.update({
        where: { id: t.id },
        data: {
          status: TransactionStatus.REFUNDED,
          amount: -Math.abs(t.amount),
        },
      });
    }
  }

  /** POS: cashier must be the authenticated JWT user — never guess another staff id (fixes wrong shift totals). */
  private async resolvePosCashierId(cashierId?: number): Promise<number> {
    if (typeof cashierId !== 'number' || !Number.isFinite(cashierId)) {
      throw new BadRequestException('Authenticated cashier is required for POS orders');
    }
    const u = await this.prisma.user.findUnique({
      where: { id: cashierId }, 
      include: { role: true },  
    });
    if (!u?.is_active) {
      throw new BadRequestException('Invalid or inactive user for POS order');
    }
    const roleName = u.role?.name;
    if (roleName !== 'CASHIER' && roleName !== 'ADMIN' && roleName !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only staff roles can create POS orders');
    }
    return u.id; 
  }

  /**
   * Website orders have no logged-in cashier; attribute to a real CASHIER first (not lowest-id SUPER_ADMIN),
   * so POS shift reports for admins are not polluted by web checkouts.
   */
  private async resolvePublicWebsiteCashierId(branchId: number): Promise<number> {
    const cashier = await this.prisma.user.findFirst({
      where: { is_active: true, branch_id: branchId, role: { name: 'CASHIER' } },
      orderBy: { id: 'asc' },
    });
    if (cashier) return cashier.id;
    const admin = await this.prisma.user.findFirst({
      where: {
        is_active: true,
        role: { name: 'ADMIN' },
        OR: [{ userBranches: { some: { branch_id: branchId } } }, { branch_id: branchId }],
      },
      orderBy: { id: 'asc' },
    });
    if (admin) return admin.id;
    const superAdmin = await this.prisma.user.findFirst({
      where: { is_active: true, role: { name: 'SUPER_ADMIN' } },
      orderBy: { id: 'asc' },
    });
    if (superAdmin) return superAdmin.id;
    throw new BadRequestException('No active staff user found to record website orders');
  }

  /** Combine website order-level note with delivery-specific notes for queue / POS visibility. */
  private combineOrderAndDeliveryNotes(orderNotes?: string, deliveryNotes?: string): string | undefined {
    const o = orderNotes?.trim();
    const d = deliveryNotes?.trim();
    if (o && d) return `${o}\n\n${d}`;
    return o || d || undefined;
  }

  private async generateOrderNumber(branchId: number, tx?: { order: { count: (args: unknown) => Promise<number> } }): Promise<string> {
    const db = tx ?? this.prisma;
    const count = await db.order.count({ where: { branch_id: branchId } });
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return `BLD-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }

  private roundMoney(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * POS offline sync: preserve the device checkout time on the server (order + related rows).
   * Ignored for public website orders. Bounded to reduce clock-abuse.
   */
  private resolvePosClientOrderTimestamps(
    dto: CreateOrderDto,
    source: 'POS' | 'PUBLIC',
  ): { created_at: Date; updated_at: Date } | null {
    if (source !== 'POS') return null;
    const raw = dto.client_created_at?.trim();
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid client_created_at');
    }
    const now = new Date();
    const maxSkewMs = 5 * 60 * 1000;
    if (d.getTime() > now.getTime() + maxSkewMs) {
      throw new BadRequestException('client_created_at cannot be in the future');
    }
    const maxAgeMs = 365 * 24 * 60 * 60 * 1000;
    if (d.getTime() < now.getTime() - maxAgeMs) {
      throw new BadRequestException('client_created_at is too far in the past');
    }
    return { created_at: d, updated_at: d };
  }

  /** Parse `customizations` JSON from POS/website: `{ modifications: [{ type, label }] }`. */
  private extractModificationsFromCustomizations(customizations: unknown): Array<{ type: string; label: string }> {
    if (customizations == null || typeof customizations !== 'object') return [];
    const o = customizations as Record<string, unknown>;
    const m = o.modifications;
    if (!Array.isArray(m)) return [];
    const out: Array<{ type: string; label: string }> = [];
    for (const row of m) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const type = String(r.type ?? '');
      const label = String(r.label ?? '').trim();
      if (!label) continue;
      out.push({ type, label });
    }
    return out;
  }

  /** Sum catalog prices for selected modifications (server-side; do not trust client line totals). */
  private customizationExtrasFromProductJson(customizationOptionsJson: unknown, customizations: unknown): number {
    const raw = customizationOptionsJson;
    const opts = Array.isArray(raw) ? raw : [];
    const mods = this.extractModificationsFromCustomizations(customizations);
    let sum = 0;
    for (const m of mods) {
      const match = opts.find(
        (x: unknown) =>
          x &&
          typeof x === 'object' &&
          String((x as Record<string, unknown>).type ?? '') === m.type &&
          String((x as Record<string, unknown>).label ?? '').trim() === m.label,
      ) as Record<string, unknown> | undefined;
      if (match && match.price != null) {
        const n = Number(match.price);
        if (Number.isFinite(n) && n > 0) sum += n;
      }
    }
    return this.roundMoney(sum);
  }

  /** Base unit price from product catalog price or selected size, plus customization extras. */
  private async resolveProductUnitPrice(
    product: { id: number; name: string; price: number; customization_options: unknown },
    productSizeId: number | undefined | null,
    customizations: unknown,
  ): Promise<{ unitPrice: number; productSizeId: number | null }> {
    const extras = this.customizationExtrasFromProductJson(product.customization_options, customizations);
    const activeSizes = await this.prisma.productSize.findMany({
      where: { product_id: product.id, is_active: true },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });

    if (activeSizes.length > 0) {
      let resolvedSizeId = productSizeId;
      if (resolvedSizeId == null || !Number.isFinite(resolvedSizeId)) {
        const defaultSize = [...activeSizes].sort((a, b) => {
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          if (a.price !== b.price) return a.price - b.price;
          return a.id - b.id;
        })[0];
        resolvedSizeId = defaultSize.id;
      }
      const size = activeSizes.find((s) => s.id === resolvedSizeId);
      if (!size) {
        throw new BadRequestException(`Invalid size for product "${product.name}"`);
      }
      return {
        unitPrice: this.roundMoney(size.price + extras),
        productSizeId: size.id,
      };
    }

    if (productSizeId != null && Number.isFinite(productSizeId)) {
      throw new BadRequestException(`Product "${product.name}" has no sizes`);
    }

    return {
      unitPrice: this.roundMoney(product.price + extras),
      productSizeId: null,
    };
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

  /** Earning after removing one free unit per entry (same product id may repeat). */
  private earnedPointsUnitsAfterFreeUnits(
    items: Array<{ product_id: number; price: number; quantity: number }>,
    excludeOneUnitPerProductId: number[],
  ): number {
    const virtual = items.map((i) => ({
      product_id: i.product_id,
      price: i.price,
      quantity: i.quantity,
    }));
    for (const pid of excludeOneUnitPerProductId) {
      const line = virtual.find((l) => l.product_id === pid && l.quantity > 0);
      if (!line) continue;
      line.quantity -= 1;
    }
    return this.earnedPointsUnitsFromItems(
      virtual.filter((l) => l.quantity > 0).map((l) => ({ price: l.price, quantity: l.quantity })),
    );
  }

  /** Earning after removing up to one free unit of a redeemed product (website gift). */
  private earnedPointsUnitsFromLineItems(
    items: Array<{ product_id: number; price: number; quantity: number }>,
    excludeOneUnitOfProductId: number | null,
  ): number {
    return this.earnedPointsUnitsAfterFreeUnits(
      items,
      excludeOneUnitOfProductId != null ? [excludeOneUnitOfProductId] : [],
    );
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

  /** One free unit per entry, in order (same product may appear multiple times). */
  private computeSequentialFreeUnitsDiscount(
    itemsData: Array<{ product_id: number; quantity: number; price: number }>,
    freeProductIdsInOrder: number[],
  ): number {
    const lines = itemsData.map((r) => ({ ...r }));
    let discount = 0;
    for (const pid of freeProductIdsInOrder) {
      const idx = lines.findIndex((l) => l.product_id === pid && l.quantity > 0);
      if (idx < 0) {
        throw new BadRequestException(
          `Add each loyalty reward drink to the order (missing product #${pid})`,
        );
      }
      discount += lines[idx].price;
      lines[idx].quantity -= 1;
    }
    return this.roundMoney(discount);
  }

  private isBogoOfferCurrentlyValid(offer: {
    valid_from: Date | null;
    valid_until: Date | null;
  }): boolean {
    const now = new Date();
    if (offer.valid_from && now < offer.valid_from) return false;
    if (offer.valid_until && now > offer.valid_until) return false;
    return true;
  }

  /** Paid units that count toward BOGO buy quantity (excludes free loyalty / BOGO lines). */
  private countPaidUnitsForBogoBuy(
    itemsData: Array<{ product_id: number; quantity: number }>,
    offer: { buy_product_id: number | null; get_product_id: number },
    redemptionCount: number,
    loyaltyFreeProductIds: number[],
  ): number {
    if (offer.buy_product_id != null) {
      let paidBuyQty = itemsData
        .filter((i) => i.product_id === offer.buy_product_id)
        .reduce((s, i) => s + i.quantity, 0);
      if (offer.buy_product_id === offer.get_product_id) {
        paidBuyQty = Math.max(0, paidBuyQty - redemptionCount);
      }
      return paidBuyQty;
    }

    let total = itemsData.reduce((s, i) => s + i.quantity, 0);
    total = Math.max(0, total - redemptionCount);
    total = Math.max(0, total - loyaltyFreeProductIds.length);
    return total;
  }

  /** Validate BOGO redemptions and return free product ids (one per redemption line). */
  private async validateBogoRedemptions(
    branchId: number,
    itemsData: Array<{ product_id: number; quantity: number; price: number }>,
    redemptions: Array<{ bogo_offer_id: number; free_product_id: number }>,
    loyaltyFreeProductIds: number[],
  ): Promise<number[]> {
    const byOffer = new Map<number, number>();
    for (const r of redemptions) {
      byOffer.set(r.bogo_offer_id, (byOffer.get(r.bogo_offer_id) ?? 0) + 1);
    }

    const freePids: number[] = [];

    for (const [offerId, redemptionCount] of byOffer) {
      const offer = await this.prisma.bogoOffer.findFirst({
        where: { id: offerId, branch_id: branchId },
      });
      if (!offer?.is_active) {
        throw new BadRequestException('Offer is not available');
      }
      if (!this.isBogoOfferCurrentlyValid(offer)) {
        throw new BadRequestException(`Offer "${offer.name}" is not valid at this time`);
      }

      const paidBuyQty = this.countPaidUnitsForBogoBuy(
        itemsData,
        offer,
        redemptionCount,
        loyaltyFreeProductIds,
      );
      const eligibleSets = Math.floor(paidBuyQty / offer.buy_quantity);
      const maxFree = eligibleSets * offer.get_quantity;

      if (redemptionCount > maxFree) {
        throw new BadRequestException(
          `Offer "${offer.name}": only ${maxFree} free item(s) allowed (buy ${offer.buy_quantity}, get ${offer.get_quantity})`,
        );
      }

      for (const r of redemptions.filter((x) => x.bogo_offer_id === offerId)) {
        if (r.free_product_id !== offer.get_product_id) {
          throw new BadRequestException('Free product does not match this offer');
        }
        freePids.push(r.free_product_id);
      }
    }

    return freePids;
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

  async create(dto: CreateOrderDto, cashierId?: number, source: 'POS' | 'PUBLIC' = 'POS', branchId?: number) {
    const resolvedBranchId = branchId ?? dto.branch_id;
    if (!resolvedBranchId) {
      throw new BadRequestException('branch_id is required');
    }
    const resolvedCashierId =
      source === 'PUBLIC'
        ? await this.resolvePublicWebsiteCashierId(resolvedBranchId)
        : await this.resolvePosCashierId(cashierId);
    const clientOrderId = dto.client_order_id?.trim() || null;
    const orderInclude = {
      items: { include: { product: true } },
      orderAddons: { include: { addon: true } },
      customer: true,
      cashier: { include: { role: true } },
    } as const;
    if (source === 'POS' && clientOrderId) {
      const existingOrder = await this.prisma.order.findFirst({
        where: { branch_id: resolvedBranchId, client_order_id: clientOrderId },
        include: orderInclude,
      });
      if (existingOrder) {
        return existingOrder;
      }
    }
    const [storeSettings, loyaltySettings] = await Promise.all([
      this.settingsService.getStore(resolvedBranchId),
      this.settingsService.getLoyalty(resolvedBranchId),
    ]);
    const taxRatePct = resolveTaxRatePct(storeSettings);
    void loyaltySettings;

    // 1. Validate and calculate items
    let subtotal = 0;
    const itemsData: any[] = [];

    for (const item of dto.items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.product_id, branch_id: resolvedBranchId },
      });
      if (!product) throw new NotFoundException(`Product #${item.product_id} not found`);
      if (!product.is_available) throw new BadRequestException(`Product "${product.name}" is not available`);

      const { unitPrice, productSizeId: resolvedSizeId } = await this.resolveProductUnitPrice(
        product,
        item.product_size_id,
        item.customizations,
      );
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      itemsData.push({
        product_id: item.product_id,
        product_size_id: resolvedSizeId,
        quantity: item.quantity,
        price: unitPrice,
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
      const addon = await this.prisma.addon.findFirst({
        where: { id: addonId, branch_id: resolvedBranchId },
      });
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
    if (dto.loyalty_pos_redemptions?.length && resolvedCustomerId == null) {
      throw new BadRequestException('Valid customer is required to redeem loyalty points');
    }

    if (
      dto.loyalty_gift_id != null &&
      (!(dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0)) &&
      !(dto.loyalty_pos_redemptions?.length && source === 'POS')
    ) {
      throw new BadRequestException('loyalty_points_redeemed is required when loyalty_gift_id is set');
    }
    if (source === 'PUBLIC' && dto.loyalty_free_product_id != null && dto.loyalty_gift_id == null) {
      throw new BadRequestException('loyalty_gift_id is required when loyalty_free_product_id is set');
    }
    if (source === 'POS' && dto.loyalty_free_product_id != null && dto.loyalty_gift_id == null) {
      if (!dto.loyalty_pos_redemptions?.length) {
        throw new BadRequestException('loyalty_free_product_id on POS requires loyalty_gift_id');
      }
    }

    // 2. Loyalty redeem: POS multi-gift (loyalty_pos_redemptions), single catalog gift, or legacy 5/10.
    let loyaltyPointsToRedeemUnits = 0;
    let loyaltyFreeProductId: number | null = null;
    let loyaltyFreeDiscount = 0;
    let loyaltyFreeProductIdsForEarn: number[] = [];

    const posMultiRedemptions =
      source === 'POS' && dto.loyalty_pos_redemptions && dto.loyalty_pos_redemptions.length > 0;

    if (posMultiRedemptions && resolvedCustomerId != null) {
      const account = await this.prisma.loyaltyAccount.findUnique({
        where: { customer_id: resolvedCustomerId },
      });
      if (!account) throw new BadRequestException('Customer has no loyalty account');

      const freePids: number[] = [];
      let pointsUnits = 0;

      for (const line of dto.loyalty_pos_redemptions!) {
        const gift = await this.prisma.loyaltyGift.findUnique({ where: { id: line.loyalty_gift_id } });
        if (!gift?.is_active) {
          throw new BadRequestException('Loyalty reward is not available');
        }
        const resolvedFreePid = gift.gift_product_id ?? line.loyalty_free_product_id ?? null;
        if (
          gift.gift_product_id != null &&
          line.loyalty_free_product_id != null &&
          line.loyalty_free_product_id !== gift.gift_product_id
        ) {
          throw new BadRequestException('Free product does not match this reward');
        }
        if (resolvedFreePid == null) {
          throw new BadRequestException(
            'loyalty_free_product_id is required for this reward when no fixed product is configured',
          );
        }
        pointsUnits += this.pointsToUnits(gift.points_required);
        freePids.push(resolvedFreePid);
      }

      loyaltyFreeDiscount = this.computeSequentialFreeUnitsDiscount(itemsData, freePids);
      loyaltyPointsToRedeemUnits = pointsUnits;
      loyaltyFreeProductIdsForEarn = freePids;
      loyaltyFreeProductId = freePids[0] ?? null;

      if (account.points_balance < loyaltyPointsToRedeemUnits) {
        throw new BadRequestException(
          `Insufficient loyalty points. Balance: ${(account.points_balance / LOYALTY_POINT_UNITS).toFixed(1)}`,
        );
      }
    } else if (dto.loyalty_points_redeemed && dto.loyalty_points_redeemed > 0 && resolvedCustomerId != null) {
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
        loyaltyFreeProductIdsForEarn = [resolvedFreePid];
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
          loyaltyFreeProductIdsForEarn = [resolvedFreePid];
        } else if (dto.loyalty_points_redeemed !== 5 && dto.loyalty_points_redeemed !== 10) {
          throw new BadRequestException(
            'Loyalty redemption must be either 5 or 10 points, or use loyalty_gift_id with a catalog reward',
          );
        } else {
          loyaltyPointsToRedeemUnits = this.pointsToUnits(dto.loyalty_points_redeemed);
          loyaltyFreeProductIdsForEarn = [];
        }
      }

      if (account.points_balance < loyaltyPointsToRedeemUnits) {
        throw new BadRequestException(
          `Insufficient loyalty points. Balance: ${(account.points_balance / LOYALTY_POINT_UNITS).toFixed(1)}`,
        );
      }
    }

    // 2b. Buy-X-get-Y offers (no loyalty points; cashier adds free lines in POS).
    let bogoFreeDiscount = 0;
    let bogoFreeProductIdsForEarn: number[] = [];

    if (dto.bogo_redemptions?.length) {
      bogoFreeProductIdsForEarn = await this.validateBogoRedemptions(
        resolvedBranchId,
        itemsData,
        dto.bogo_redemptions,
        loyaltyFreeProductIdsForEarn,
      );
      bogoFreeDiscount = this.computeSequentialFreeUnitsDiscount(itemsData, bogoFreeProductIdsForEarn);
    }

    // 3. Calculate totals (tax from store settings)
    const customDiscount = dto.discount || 0;
    const totalDiscount = this.roundMoney(customDiscount + loyaltyFreeDiscount + bogoFreeDiscount);
    const { tax, total } = computeOrderTotals({ subtotal, discount: totalDiscount, taxRatePct });

    const isPosDeliveryCheckout = source === 'POS' && dto.order_type === OrderType.DELIVERY;
    const initialOrderStatus =
      source === 'PUBLIC' || isPosDeliveryCheckout ? OrderStatus.PENDING : OrderStatus.COMPLETED;

    const clientOrderTimes = this.resolvePosClientOrderTimestamps(dto, source);
    const rowCreatedAt = clientOrderTimes?.created_at;

    // 4. Create order in a transaction
    let order: any;
    let resolvedFromUniqueConflict = false;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const orderNumber = await this.generateOrderNumber(resolvedBranchId, tx);
        const createdOrder = await tx.order.create({
          data: {
            branch_id: resolvedBranchId,
            order_number: orderNumber,
            client_order_id: source === 'POS' ? clientOrderId : null,
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
            ...(clientOrderTimes
              ? {
                  created_at: clientOrderTimes.created_at,
                  updated_at: clientOrderTimes.updated_at,
                }
              : {}),
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
          include: orderInclude,
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
            ...(rowCreatedAt ? { created_at: rowCreatedAt } : {}),
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
            ...(rowCreatedAt ? { created_at: rowCreatedAt } : {}),
          },
        });
      }

      // 7. Award loyalty points on purchase (POS non-delivery immediately; website & POS delivery defer — see tryAwardDeferredLoyaltyPoints)
      if (resolvedCustomerId != null && initialOrderStatus === OrderStatus.COMPLETED) {
        const pointsEarned = this.earnedPointsUnitsAfterFreeUnits(
          itemsData.map((i) => ({
            product_id: i.product_id,
            price: Number(i.price),
            quantity: Number(i.quantity),
          })),
          [...loyaltyFreeProductIdsForEarn, ...bogoFreeProductIdsForEarn],
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
            ...(rowCreatedAt ? { created_at: rowCreatedAt } : {}),
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
            branch_id: resolvedBranchId,
            order_id: createdOrder.id,
            customer_id: resolvedCustomerId,
            address: dto.delivery_address,
            notes: this.combineOrderAndDeliveryNotes(dto.order_notes, dto.delivery_notes),
            status: 'NEW',
            ...(rowCreatedAt ? { created_at: rowCreatedAt } : {}),
          },
        });
      } else if (
        source === 'PUBLIC' &&
        resolvedCustomerId != null &&
        dto.order_type !== 'DELIVERY'
      ) {
        await tx.deliveryOrder.create({
          data: {
            branch_id: resolvedBranchId,
            order_id: createdOrder.id,
            customer_id: resolvedCustomerId,
            address: dto.delivery_address?.trim() || 'Website order (walk-in pickup)',
            notes:
              this.combineOrderAndDeliveryNotes(dto.order_notes, dto.delivery_notes) ?? 'Source: WEBSITE',
            status: 'NEW',
            ...(rowCreatedAt ? { created_at: rowCreatedAt } : {}),
          },
        });
      }

      // Inventory is no longer deducted when an order is created/completed.

        return createdOrder;
      });
    } catch (error) {
      if (
        source === 'POS' &&
        clientOrderId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingOrder = await this.prisma.order.findFirst({
          where: { branch_id: resolvedBranchId, client_order_id: clientOrderId },
          include: orderInclude,
        });
        if (existingOrder) {
          resolvedFromUniqueConflict = true;
          order = existingOrder;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    if (resolvedFromUniqueConflict) {
      return order;
    }

    // 9. Activity log and real-time events
    await this.activityLogs.create({
      user_id: resolvedCashierId,
      branch_id: resolvedBranchId,
      action: 'create_order',
      entity: 'Order',
      entity_id: order.id,
      metadata: {
        order_number: order.order_number,
        total: order.total,
        client_order_id: dto.client_order_id,
        branch_id: resolvedBranchId,
      },
      created_at: order.created_at,
    });
    this.eventEmitter.emit('order.created', { order, source, branch_id: resolvedBranchId });

    return order;
  }

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

  /** Deduct recipe stock when an order is completed (idempotent). */
  async tryDeductStockForOrder(orderId: number): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branch_id: true, status: true },
    });
    if (!order || order.status !== OrderStatus.COMPLETED) return;
    await this.inventoryService.deductForOrder(orderId, order.branch_id);
  }

  /** Restore recipe stock after cancel/refund of a completed order (idempotent). */
  async tryRestoreStockForOrder(orderId: number): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { branch_id: true },
    });
    if (!order) return;
    await this.inventoryService.restoreForOrder(orderId, order.branch_id);
  }

  async findAll(
    scope: BranchScope,
    page = 1,
    limit = 10,
    status?: OrderStatus,
    type?: string,
    date?: string,
    fromDate?: string,
    toDate?: string,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { ...orderBranchWhere(scope) };
    if (status) where.status = status;
    if (type) where.order_type = type;
    const parseYmdStart = (ymd: string): Date | undefined => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
      if (!m) return undefined;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const da = Number(m[3]);
      return new Date(y, mo - 1, da, 0, 0, 0, 0);
    };
    const parseYmdEndExclusive = (ymd: string): Date | undefined => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
      if (!m) return undefined;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const da = Number(m[3]);
      return new Date(y, mo - 1, da + 1, 0, 0, 0, 0);
    };
    const from = fromDate ? parseYmdStart(fromDate) : undefined;
    const to = toDate ? parseYmdEndExclusive(toDate) : undefined;
    if (from || to) {
      where.created_at = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
    } else if (date) {
      const start = parseYmdStart(date);
      const end = parseYmdEndExclusive(date);
      if (start && end) {
        where.created_at = { gte: start, lt: end };
      }
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
          cashier: { select: { id: true, name: true } },
          transactions: true,
          deliveryOrders: true,
          ...(scope.allBranches ? { branch: { select: { id: true, name: true, slug: true } } } : {}),
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number, branchId?: number) {
    const order = await this.prisma.order.findFirst({
      where: { id, ...(branchId != null ? { branch_id: branchId } : {}) },
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
  async appendOrderNote(id: number, dto: AppendOrderNoteDto, branchId: number) {
    const order = await this.findOne(id, branchId);
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

  async updateStatus(id: number, dto: UpdateOrderStatusDto, user?: { role?: { name: string } }, branchId?: number) {
    const order = await this.findOne(id, branchId);
    const previousStatus = order.status;
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled/refunded orders cannot be changed again');
    }
    if (user?.role?.name === 'CASHIER' && order.status !== OrderStatus.PENDING) {
      if (dto.status !== OrderStatus.CANCELLED) {
        throw new ForbiddenException('Cashier can only update status of pending orders');
      }
    }
    if (dto.status === OrderStatus.CANCELLED) {
      await this.settingsService.assertManagerAuthorization(
        order.branch_id,
        user?.role?.name,
        dto.manager_pin,
      );
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
    if (dto.status === OrderStatus.CANCELLED) {
      await this.cancelLinkedDeliveryOrders(id);
      await this.reverseCompletedPaymentTransactions(id);
      // Inventory is no longer restored when an order is cancelled.
    }
    if (dto.status === OrderStatus.COMPLETED && previousStatus !== OrderStatus.COMPLETED) {
      await this.tryAwardDeferredLoyaltyPoints(id);
      // Inventory is no longer deducted when an order is completed.
    }
    this.eventEmitter.emit('order.statusUpdated', updated);
    return updated;
  }

  async update(id: number, dto: UpdateOrderDto, user: { role?: { name: string } }, branchId?: number) {
    const order = await this.findOne(id, branchId);
    if (user?.role?.name === 'CASHIER' && order.status !== OrderStatus.PENDING) {
      throw new ForbiddenException('Cashier can only update pending orders');
    }
    if (!dto.items?.length) throw new BadRequestException('Order must have at least one item');

    const storeSettings = await this.settingsService.getStore(order.branch_id);
    const taxRatePct = resolveTaxRatePct(storeSettings);

    let subtotal = 0;
    const itemsData: any[] = [];
    for (const item of dto.items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.product_id, branch_id: order.branch_id },
      });
      if (!product) throw new NotFoundException(`Product #${item.product_id} not found`);
      if (!product.is_available) throw new BadRequestException(`Product "${product.name}" is not available`);
      const { unitPrice, productSizeId: resolvedSizeId } = await this.resolveProductUnitPrice(
        product,
        item.product_size_id,
        item.customizations,
      );
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      itemsData.push({
        product_id: item.product_id,
        product_size_id: resolvedSizeId,
        quantity: item.quantity,
        price: unitPrice,
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
        const addon = await this.prisma.addon.findFirst({ where: { id: addonId, branch_id: order.branch_id } });
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
    const { tax, total } = computeOrderTotals({ subtotal, discount, taxRatePct });

    const paymentMethod = dto.payment_method?.trim().toUpperCase() as PaymentMethod | undefined;
    if (paymentMethod && !['CASH', 'CARD', 'WALLET'].includes(paymentMethod)) {
      throw new BadRequestException('payment_method must be CASH, CARD, or WALLET');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { order_id: id } });
      if (dto.order_addons !== undefined) {
        await tx.orderAddon.deleteMany({ where: { order_id: id } });
      }
      const saved = await tx.order.update({
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
          cashier: { select: { id: true, name: true } },
          transactions: true,
        },
      });

      const txnCashierId = saved.cashier_id ?? order.cashier_id;
      if (!txnCashierId && (paymentMethod || total !== order.total)) {
        throw new BadRequestException('Order has no cashier to record payment');
      }
      if (txnCashierId) {
        await this.syncOrderTransactionsAfterEdit(
          tx,
          id,
          total,
          txnCashierId,
          paymentMethod,
        );
      }

      return tx.order.findUniqueOrThrow({
        where: { id },
        include: {
          items: { include: { product: true } },
          orderAddons: { include: { addon: true } },
          customer: true,
          cashier: { select: { id: true, name: true } },
          transactions: true,
          deliveryOrders: true,
        },
      });
    });

    this.eventEmitter.emit('order.updated', updated);
    return updated;
  }

  /** Keep transaction rows aligned when admin edits order totals or payment method. */
  private async syncOrderTransactionsAfterEdit(
    tx: Prisma.TransactionClient,
    orderId: number,
    total: number,
    cashierId: number,
    paymentMethod?: PaymentMethod,
  ): Promise<void> {
    const completed = await tx.transaction.findMany({
      where: { order_id: orderId, status: TransactionStatus.COMPLETED },
      orderBy: { id: 'asc' },
    });

    if (paymentMethod) {
      if (completed.length === 0) {
        await tx.transaction.create({
          data: {
            order_id: orderId,
            user_id: cashierId,
            payment_method: paymentMethod,
            amount: total,
            status: TransactionStatus.COMPLETED,
          },
        });
        return;
      }
      if (completed.length === 1) {
        await tx.transaction.update({
          where: { id: completed[0].id },
          data: { payment_method: paymentMethod, amount: total },
        });
        return;
      }
      for (const row of completed) {
        await tx.transaction.update({
          where: { id: row.id },
          data: { payment_method: paymentMethod },
        });
      }
      return;
    }

    if (completed.length === 1) {
      await tx.transaction.update({
        where: { id: completed[0].id },
        data: { amount: total },
      });
    }
  }

  async refund(id: number, dto: RefundOrderDto, user: { id: number; role?: { name: string } }, branchId?: number) {
    const order = await this.findOne(id, branchId);
    const orderWithTx = await this.prisma.order.findUnique({
      where: { id },
      include: { transactions: true },
    });
    if (!orderWithTx) throw new NotFoundException(`Order #${id} not found`);

    const hasCompletedTxn = orderWithTx.transactions?.some((t) => t.status === TransactionStatus.COMPLETED);
    if (!hasCompletedTxn) {
      throw new BadRequestException('Order has no completed payment to refund');
    }
    if (order.status === OrderStatus.CANCELLED || orderWithTx.transactions?.some((t) => t.status === TransactionStatus.REFUNDED)) {
      throw new BadRequestException('Cancelled/refunded orders cannot be changed again');
    }
    await this.settingsService.assertManagerAuthorization(
      order.branch_id,
      user?.role?.name,
      dto.manager_pin,
    );

    const refundNoteLine = dto.reason?.trim()
      ? `Refund reason: ${dto.reason.trim()}`
      : undefined;

    // Mark completed payments as refunded (negative amounts for Transactions ledger)
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          ...(refundNoteLine
            ? {
                notes: order.notes?.trim()
                  ? `${order.notes.trim()}\n\n${refundNoteLine}`
                  : refundNoteLine,
              }
            : {}),
        },
      });
      await this.reverseCompletedPaymentTransactions(id, tx);
      return tx.order.findUnique({
        where: { id: updatedOrder.id },
        include: {
          items: { include: { product: true } },
          customer: true,
          transactions: true,
          deliveryOrders: true,
        },
      });
    });
    if (!updated) throw new NotFoundException(`Order #${id} not found`);

    await this.cancelLinkedDeliveryOrders(id);

    // Inventory is no longer restored when an order is refunded.

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
