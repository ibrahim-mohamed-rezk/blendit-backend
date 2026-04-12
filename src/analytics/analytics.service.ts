import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryStatus, OrderStatus, TransactionStatus } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private localDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Calendar periods in the server’s local timezone (matches “today / this week / this month” labels). */
  private getDateRange(period: 'daily' | 'weekly' | 'monthly') {
    const end = new Date();
    const start = new Date(end);
    if (period === 'daily') {
      start.setHours(0, 0, 0, 0);
    } else if (period === 'weekly') {
      const dow = start.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      start.setDate(start.getDate() + diff);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
    return { start, end };
  }

  async getSalesSummary(period: 'daily' | 'weekly' | 'monthly') {
    const { start, end } = this.getDateRange(period);
    const orders = await this.prisma.order.findMany({
      where: { created_at: { gte: start, lte: end }, status: OrderStatus.COMPLETED },
      select: { total: true },
    });
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
    return { period, totalRevenue, totalOrders, avgOrderValue };
  }

  /** All-time KPIs for admin dashboard (avoids client-side pagination mistakes). */
  async getLifetimeSummary() {
    const [orderAgg, customerCount, pendingDelivery] = await Promise.all([
      this.prisma.order.aggregate({
        where: { status: OrderStatus.COMPLETED },
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.customer.count(),
      this.prisma.deliveryOrder.count({ where: { status: DeliveryStatus.NEW } }),
    ]);
    const totalCompletedOrders = orderAgg._count.id;
    const totalRevenue = orderAgg._sum.total ?? 0;
    const avgOrderValue = totalCompletedOrders > 0 ? totalRevenue / totalCompletedOrders : 0;
    return {
      totalCompletedOrders,
      totalRevenueAllTime: totalRevenue,
      avgOrderValueAllTime: avgOrderValue,
      totalCustomers: customerCount,
      pendingDeliveryOrders: pendingDelivery,
    };
  }

  async getTopProducts(limit = 10) {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { status: OrderStatus.COMPLETED } },
      select: { product_id: true, quantity: true, price: true },
    });
    const rolled = new Map<number, { qty: number; revenue: number; lines: number }>();
    for (const row of items) {
      const prev = rolled.get(row.product_id) ?? { qty: 0, revenue: 0, lines: 0 };
      prev.qty += row.quantity;
      prev.revenue += row.price * row.quantity;
      prev.lines += 1;
      rolled.set(row.product_id, prev);
    }
    const sorted = [...rolled.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, limit);
    const productIds = sorted.map(([id]) => id);
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((p) => [p.id, p]));
    return sorted.map(([productId, agg]) => ({
      product: productMap.get(productId) ?? null,
      totalQuantitySold: agg.qty,
      orderCount: agg.lines,
      totalRevenue: Math.round(agg.revenue * 100) / 100,
    }));
  }

  async getPaymentBreakdown() {
    const result = await this.prisma.transaction.groupBy({
      by: ['payment_method'],
      where: {
        status: TransactionStatus.COMPLETED,
        order: { status: OrderStatus.COMPLETED },
      },
      _count: { id: true },
      _sum: { amount: true },
    });
    return result.map((r) => ({
      method: r.payment_method,
      count: r._count.id,
      total: r._sum.amount ?? 0,
    }));
  }

  async getRevenueTrends(days = 30) {
    const n = Math.min(Math.max(Number(days) || 30, 1), 366);
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (n - 1));
    start.setHours(0, 0, 0, 0);

    const buckets: Record<string, { date: string; revenue: number; count: number }> = {};
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = this.localDateKey(d);
      buckets[key] = { date: key, revenue: 0, count: 0 };
    }

    const orders = await this.prisma.order.findMany({
      where: { created_at: { gte: start, lte: end }, status: OrderStatus.COMPLETED },
      select: { total: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });
    for (const order of orders) {
      const date = this.localDateKey(order.created_at);
      if (!buckets[date]) buckets[date] = { date, revenue: 0, count: 0 };
      buckets[date].revenue += order.total;
      buckets[date].count += 1;
    }
    return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getClientsPerHour(date?: string) {
    const base = date ? new Date(`${date}T12:00:00`) : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);

    const orders = await this.prisma.order.findMany({
      where: { created_at: { gte: start, lte: end } },
      select: { created_at: true },
    });

    const hourly: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourly[h] = 0;
    for (const order of orders) {
      const hour = order.created_at.getHours();
      hourly[hour] = (hourly[hour] || 0) + 1;
    }

    return Object.entries(hourly).map(([hour, count]) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      orders: count,
    }));
  }
}
