import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderChannel, OrderStatus, PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { BranchScope } from '../common/branch-scope';
import { orderBranchWhere } from '../common/branch-scope';
import { ShiftsQueryDto, ShiftAnalyticsQueryDto } from './dto/shifts-query.dto';

export type ShiftPaymentTotals = { cash: number; card: number; wallet: number };

export type ShiftSummary = {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  refundedOrders: number;
  grossSales: number;
  refunds: number;
  netCollected: number;
  paymentTotals: ShiftPaymentTotals;
};

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  private parseYmdStart(ymd: string): Date | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return undefined;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }

  private parseYmdEndExclusive(ymd: string): Date | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return undefined;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 0, 0, 0, 0);
  }

  private mapPaymentMethod(method: PaymentMethod): keyof ShiftPaymentTotals {
    if (method === PaymentMethod.CASH) return 'cash';
    if (method === PaymentMethod.CARD) return 'card';
    return 'wallet';
  }

  private orderIsRefunded(transactions: { status: TransactionStatus }[]): boolean {
    if (transactions.length === 0) return false;
    return transactions.every((t) => t.status === TransactionStatus.REFUNDED);
  }

  /** Canceled sales and fully refunded payments should not count toward net collected. */
  private orderIsFinanciallyReversed(order: {
    status: OrderStatus;
    transactions: { status: TransactionStatus }[];
  }): boolean {
    if (order.status === OrderStatus.CANCELLED) return true;
    return this.orderIsRefunded(order.transactions);
  }

  private posChannelWhere() {
    return { OR: [{ channel: OrderChannel.POS }, { channel: null }] };
  }

  /** Money returned this shift for a sale from an earlier shift — reduce drawer totals. */
  private subtractReversedPayments(
    order: {
      total: number;
      status: OrderStatus;
      transactions: { status: TransactionStatus; payment_method: PaymentMethod; amount: number }[];
    },
    paymentTotals: ShiftPaymentTotals,
  ): void {
    const refundedTxns = order.transactions.filter((t) => t.status === TransactionStatus.REFUNDED);
    const sourceTxns =
      refundedTxns.length > 0
        ? refundedTxns
        : order.transactions.filter((t) => t.status === TransactionStatus.COMPLETED);
    if (sourceTxns.length > 0) {
      for (const t of sourceTxns) {
        paymentTotals[this.mapPaymentMethod(t.payment_method)] -= t.amount;
      }
      return;
    }
    if (order.status === OrderStatus.CANCELLED) {
      paymentTotals.cash -= order.total;
    }
  }

  /** POS shift totals: cashier orders since shift start, excluding website channel. */
  async computeSummary(
    branchId: number,
    cashierId: number,
    startedAt: Date,
    endedAt: Date,
  ): Promise<ShiftSummary> {
    const baseWhere = {
      branch_id: branchId,
      cashier_id: cashierId,
      ...this.posChannelWhere(),
    };

    const [createdInShift, cancelledInShift] = await Promise.all([
      this.prisma.order.findMany({
        where: { ...baseWhere, created_at: { gte: startedAt, lt: endedAt } },
        include: { transactions: true },
      }),
      this.prisma.order.findMany({
        where: {
          ...baseWhere,
          status: OrderStatus.CANCELLED,
          created_at: { lt: startedAt },
          updated_at: { gte: startedAt, lt: endedAt },
        },
        include: { transactions: true },
      }),
    ]);

    let totalOrders = 0;
    let completedOrders = 0;
    let cancelledOrders = 0;
    let refundedOrders = 0;
    let grossSales = 0;
    let refunds = 0;
    const paymentTotals: ShiftPaymentTotals = { cash: 0, card: 0, wallet: 0 };

    for (const o of createdInShift) {
      totalOrders += 1;
      if (o.status === OrderStatus.COMPLETED) completedOrders += 1;
      if (o.status === OrderStatus.CANCELLED) cancelledOrders += 1;
      const reversed = this.orderIsFinanciallyReversed(o);
      if (reversed) refundedOrders += 1;

      grossSales += o.total;
      if (reversed) {
        refunds += o.total;
        continue;
      }

      const completedTxns = o.transactions.filter((t) => t.status === TransactionStatus.COMPLETED);
      if (completedTxns.length > 0) {
        for (const t of completedTxns) {
          paymentTotals[this.mapPaymentMethod(t.payment_method)] += t.amount;
        }
      } else if (o.status === OrderStatus.COMPLETED) {
        // Fallback when no txn rows (legacy)
        paymentTotals.cash += o.total;
      }
    }

    const createdIds = new Set(createdInShift.map((o) => o.id));
    for (const o of cancelledInShift) {
      if (createdIds.has(o.id)) continue;
      cancelledOrders += 1;
      const wasRefunded = this.orderIsRefunded(o.transactions);
      if (wasRefunded) {
        refundedOrders += 1;
        refunds += o.total;
        this.subtractReversedPayments(o, paymentTotals);
      }
    }

    return {
      totalOrders,
      completedOrders,
      cancelledOrders,
      refundedOrders,
      grossSales,
      refunds,
      netCollected: grossSales - refunds,
      paymentTotals,
    };
  }

  private toPublicShift(row: {
    id: number;
    branch_id: number;
    cashier_id: number;
    started_at: Date;
    ended_at: Date | null;
    total_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    refunded_orders: number;
    gross_sales: number;
    refunds: number;
    net_collected: number;
    payment_totals: unknown;
    branch?: { id: number; name: string; slug: string };
    cashier?: { id: number; name: string; email: string };
  }) {
    const durationMs =
      row.ended_at != null
        ? row.ended_at.getTime() - row.started_at.getTime()
        : Date.now() - row.started_at.getTime();
    return {
      id: row.id,
      branch_id: row.branch_id,
      cashier_id: row.cashier_id,
      started_at: row.started_at,
      ended_at: row.ended_at,
      is_active: row.ended_at == null,
      duration_minutes: Math.round(durationMs / 60000),
      total_orders: row.total_orders,
      completed_orders: row.completed_orders,
      cancelled_orders: row.cancelled_orders,
      refunded_orders: row.refunded_orders,
      gross_sales: row.gross_sales,
      refunds: row.refunds,
      net_collected: row.net_collected,
      payment_totals: (row.payment_totals as ShiftPaymentTotals | null) ?? { cash: 0, card: 0, wallet: 0 },
      branch: row.branch ?? null,
      cashier: row.cashier ?? null,
    };
  }

  /** Zero-length, zero-total close for spurious duplicate active shifts so analytics stay correct. */
  private async closeDuplicateShifts(
    ids: number[],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    if (ids.length === 0) return;
    await db.shift.updateMany({
      where: { id: { in: ids } },
      data: {
        ended_at: new Date(),
        total_orders: 0,
        completed_orders: 0,
        cancelled_orders: 0,
        refunded_orders: 0,
        gross_sales: 0,
        refunds: 0,
        net_collected: 0,
        payment_totals: { cash: 0, card: 0, wallet: 0 },
      },
    });
  }

  private pickKeeperShiftIds(
    rows: { id: number; branch_id: number; cashier_id: number; started_at: Date }[],
  ): { keepIds: Set<number>; closeIds: number[] } {
    const closeIds: number[] = [];
    const keepIds = new Set<number>();
    const seen = new Set<string>();
    const sorted = [...rows].sort((a, b) => {
      const t = a.started_at.getTime() - b.started_at.getTime();
      return t !== 0 ? t : a.id - b.id;
    });
    for (const row of sorted) {
      const key = `${row.branch_id}:${row.cashier_id}`;
      if (seen.has(key)) {
        closeIds.push(row.id);
      } else {
        seen.add(key);
        keepIds.add(row.id);
      }
    }
    return { keepIds, closeIds };
  }

  private shiftInclude() {
    return {
      branch: { select: { id: true, name: true, slug: true } },
      cashier: { select: { id: true, name: true, email: true } },
    };
  }

  async ensureActiveShift(branchId: number, cashierId: number, startedAtIso?: string) {
    const include = this.shiftInclude();

    const shiftId = await this.prisma.$transaction(async (tx) => {
      const actives = await tx.shift.findMany({
        where: { branch_id: branchId, cashier_id: cashierId, ended_at: null },
        orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
      });

      if (actives.length > 0) {
        const [keep, ...extras] = actives;
        await this.closeDuplicateShifts(
          extras.map((e) => e.id),
          tx,
        );
        return keep.id;
      }

      const startedAt = startedAtIso ? new Date(startedAtIso) : new Date();
      if (Number.isNaN(startedAt.getTime())) {
        throw new BadRequestException('Invalid started_at');
      }

      try {
        const created = await tx.shift.create({
          data: {
            branch_id: branchId,
            cashier_id: cashierId,
            started_at: startedAt,
          },
        });
        return created.id;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }
        const again = await tx.shift.findMany({
          where: { branch_id: branchId, cashier_id: cashierId, ended_at: null },
          orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
        });
        if (again.length === 0) throw err;
        const [keep, ...extras] = again;
        await this.closeDuplicateShifts(
          extras.map((e) => e.id),
          tx,
        );
        return keep.id;
      }
    });

    const row = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include,
    });
    if (!row) throw new NotFoundException('Shift not found');
    return this.toPublicShift(row);
  }

  /** Live summary for the caller's current open shift (authoritative source for the POS report). */
  async getCurrentSummary(branchId: number, cashierId: number) {
    const actives = await this.prisma.shift.findMany({
      where: { branch_id: branchId, cashier_id: cashierId, ended_at: null },
      orderBy: { started_at: 'asc' },
      include: {
        branch: { select: { id: true, name: true, slug: true } },
        cashier: { select: { id: true, name: true, email: true } },
      },
    });

    if (actives.length === 0) {
      const now = new Date();
      return {
        id: null as number | null,
        branch_id: branchId,
        cashier_id: cashierId,
        started_at: now,
        ended_at: null,
        is_active: false,
        duration_minutes: 0,
        total_orders: 0,
        completed_orders: 0,
        cancelled_orders: 0,
        refunded_orders: 0,
        gross_sales: 0,
        refunds: 0,
        net_collected: 0,
        payment_totals: { cash: 0, card: 0, wallet: 0 },
        branch: null,
        cashier: null,
      };
    }

    const [active, ...extras] = actives;
    await this.closeDuplicateShifts(extras.map((e) => e.id));

    const now = new Date();
    const summary = await this.computeSummary(branchId, active.cashier_id, active.started_at, now);
    return {
      ...this.toPublicShift(active),
      total_orders: summary.totalOrders,
      completed_orders: summary.completedOrders,
      cancelled_orders: summary.cancelledOrders,
      refunded_orders: summary.refundedOrders,
      gross_sales: summary.grossSales,
      refunds: summary.refunds,
      net_collected: summary.netCollected,
      payment_totals: summary.paymentTotals,
    };
  }

  async endShift(shiftId: number, branchId: number, actorId: number, allowAnyCashier = false) {
    const shift = await this.prisma.shift.findFirst({
      where: {
        id: shiftId,
        branch_id: branchId,
        ended_at: null,
        ...(allowAnyCashier ? {} : { cashier_id: actorId }),
      },
    });
    if (!shift) throw new NotFoundException('Active shift not found');

    const endedAt = new Date();
    const summary = await this.computeSummary(branchId, shift.cashier_id, shift.started_at, endedAt);

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        ended_at: endedAt,
        total_orders: summary.totalOrders,
        completed_orders: summary.completedOrders,
        cancelled_orders: summary.cancelledOrders,
        refunded_orders: summary.refundedOrders,
        gross_sales: summary.grossSales,
        refunds: summary.refunds,
        net_collected: summary.netCollected,
        payment_totals: summary.paymentTotals,
      },
      include: {
        branch: { select: { id: true, name: true, slug: true } },
        cashier: { select: { id: true, name: true, email: true } },
      },
    });
    return this.toPublicShift(updated);
  }

  async endActiveShift(branchId: number, cashierId: number) {
    const actives = await this.prisma.shift.findMany({
      where: { branch_id: branchId, cashier_id: cashierId, ended_at: null },
      orderBy: { started_at: 'asc' },
    });
    if (actives.length === 0) throw new NotFoundException('No active shift to end');
    const [primary, ...extras] = actives;
    // Close any stray duplicate open shifts so none linger as "active" after ending.
    await this.closeDuplicateShifts(extras.map((e) => e.id));
    return this.endShift(primary.id, branchId, cashierId, true);
  }

  async findAll(scope: BranchScope, dto: ShiftsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { ...orderBranchWhere(scope) };

    const closedOnly =
      dto.status === 'closed' || (dto.status !== 'open' && dto.active === false);
    const openOnly = dto.status === 'open' || (dto.status !== 'closed' && dto.active === true);

    if (openOnly) where.ended_at = null;
    if (closedOnly) where.ended_at = { not: null };
    if (dto.cashierId) where.cashier_id = dto.cashierId;

    const from = dto.fromDate ? this.parseYmdStart(dto.fromDate) : undefined;
    const to = dto.toDate ? this.parseYmdEndExclusive(dto.toDate) : undefined;
    if (from || to) {
      const dateField = closedOnly ? 'ended_at' : 'started_at';
      where[dateField] = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
    }

    const includeBranch = scope.allBranches;
    const orderBy = openOnly
      ? [{ started_at: 'asc' as const }]
      : [{ ended_at: 'desc' as const }, { started_at: 'desc' as const }];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.shift.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          cashier: { select: { id: true, name: true, email: true } },
          ...(includeBranch ? { branch: { select: { id: true, name: true, slug: true } } } : {}),
        },
      }),
      this.prisma.shift.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toPublicShift(r)),
      total,
      page,
      limit,
    };
  }

  async findActive(scope: BranchScope) {
    const where = { ...orderBranchWhere(scope), ended_at: null };
    const rows = await this.prisma.shift.findMany({
      where,
      orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        ...(scope.allBranches ? { branch: { select: { id: true, name: true, slug: true } } } : {}),
      },
    });

    const { keepIds, closeIds } = this.pickKeeperShiftIds(rows);
    await this.closeDuplicateShifts(closeIds);
    const activeRows = rows.filter((r) => keepIds.has(r.id));

    const now = new Date();
    return Promise.all(
      activeRows.map(async (r) => {
        const summary = await this.computeSummary(r.branch_id, r.cashier_id, r.started_at, now);
        const pub = this.toPublicShift(r);
        return {
          ...pub,
          total_orders: summary.totalOrders,
          completed_orders: summary.completedOrders,
          cancelled_orders: summary.cancelledOrders,
          refunded_orders: summary.refundedOrders,
          gross_sales: summary.grossSales,
          refunds: summary.refunds,
          net_collected: summary.netCollected,
          payment_totals: summary.paymentTotals,
        };
      }),
    );
  }

  async getAnalytics(scope: BranchScope, dto: ShiftAnalyticsQueryDto) {
    const where: Record<string, unknown> = {
      ...orderBranchWhere(scope),
      ended_at: { not: null },
    };
    const from = dto.fromDate ? this.parseYmdStart(dto.fromDate) : undefined;
    const to = dto.toDate ? this.parseYmdEndExclusive(dto.toDate) : undefined;
    if (from || to) {
      where.ended_at = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
    } else {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      where.ended_at = { gte: start, lte: end };
    }

    const [closedShifts, activeCount, agg] = await Promise.all([
      this.prisma.shift.findMany({
        where,
        select: {
          id: true,
          started_at: true,
          ended_at: true,
          net_collected: true,
          total_orders: true,
          cashier_id: true,
          cashier: { select: { id: true, name: true } },
        },
        orderBy: { started_at: 'asc' },
      }),
      this.prisma.shift.count({
        where: { ...orderBranchWhere(scope), ended_at: null },
      }),
      this.prisma.shift.aggregate({
        where,
        _count: { id: true },
        _sum: {
          net_collected: true,
          gross_sales: true,
          total_orders: true,
          refunds: true,
        },
        _avg: { net_collected: true },
      }),
    ]);

    const byDayMap = new Map<string, { date: string; shifts: number; netCollected: number; orders: number }>();
    const byCashierMap = new Map<
      number,
      { cashierId: number; name: string; shifts: number; netCollected: number; orders: number }
    >();
    let totalDurationMinutes = 0;

    for (const s of closedShifts) {
      if (!s.ended_at) continue;
      const dayKey = s.started_at.toISOString().slice(0, 10);
      const day = byDayMap.get(dayKey) ?? { date: dayKey, shifts: 0, netCollected: 0, orders: 0 };
      day.shifts += 1;
      day.netCollected += s.net_collected;
      day.orders += s.total_orders;
      byDayMap.set(dayKey, day);

      const c = byCashierMap.get(s.cashier_id) ?? {
        cashierId: s.cashier_id,
        name: s.cashier?.name ?? `Cashier #${s.cashier_id}`,
        shifts: 0,
        netCollected: 0,
        orders: 0,
      };
      c.shifts += 1;
      c.netCollected += s.net_collected;
      c.orders += s.total_orders;
      byCashierMap.set(s.cashier_id, c);

      totalDurationMinutes += (s.ended_at.getTime() - s.started_at.getTime()) / 60000;
    }

    const closedCount = agg._count.id;
    return {
      activeShifts: activeCount,
      closedShifts: closedCount,
      totalNetCollected: agg._sum.net_collected ?? 0,
      totalGrossSales: agg._sum.gross_sales ?? 0,
      totalOrders: agg._sum.total_orders ?? 0,
      totalRefunds: agg._sum.refunds ?? 0,
      avgNetPerShift: agg._avg.net_collected ?? 0,
      avgDurationMinutes: closedCount > 0 ? Math.round(totalDurationMinutes / closedCount) : 0,
      netCollectedByDay: [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byCashier: [...byCashierMap.values()].sort((a, b) => b.netCollected - a.netCollected),
    };
  }

  async listCashiers(scope: BranchScope) {
    const rows = await this.prisma.shift.findMany({
      where: orderBranchWhere(scope),
      distinct: ['cashier_id'],
      select: {
        cashier_id: true,
        cashier: { select: { id: true, name: true } },
      },
    });
    return rows
      .filter((r) => r.cashier != null)
      .map((r) => ({ id: r.cashier_id, name: r.cashier!.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getOne(id: number, scope: BranchScope, actorId?: number, actorRole?: string) {
    const row = await this.prisma.shift.findFirst({
      where: {
        id,
        ...orderBranchWhere(scope),
        ...(actorRole === 'CASHIER' && actorId ? { cashier_id: actorId } : {}),
      },
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!row) throw new NotFoundException(`Shift #${id} not found`);
    return this.toPublicShift(row);
  }

  async assertCashierOwnsShift(shiftId: number, branchId: number, cashierId: number) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, branch_id: branchId, cashier_id: cashierId },
    });
    if (!shift) throw new ForbiddenException('Not your shift');
    return shift;
  }
}
