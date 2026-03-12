import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private getDateRange(period: 'daily' | 'weekly' | 'monthly') {
    const now = new Date();
    const start = new Date();
    if (period === 'daily') start.setDate(now.getDate() - 1);
    else if (period === 'weekly') start.setDate(now.getDate() - 7);
    else start.setMonth(now.getMonth() - 1);
    return { start, end: now };
  }

  async getSalesSummary(period: 'daily' | 'weekly' | 'monthly') {
    const { start, end } = this.getDateRange(period);
    const orders = await this.prisma.order.findMany({
      where: { created_at: { gte: start, lte: end }, status: 'COMPLETED' },
      select: { total: true, subtotal: true, tax: true, discount: true, order_type: true, created_at: true },
    });
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
    return { period, totalRevenue, totalOrders, avgOrderValue, orders };
  }

  async getTopProducts(limit = 10) {
    const result = await this.prisma.orderItem.groupBy({
      by: ['product_id'],
      _sum: { quantity: true },
      _count: { id: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    });
    const productIds = result.map((r) => r.product_id);
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((p) => [p.id, p]));
    return result.map((r) => ({
      product: productMap.get(r.product_id),
      totalQuantitySold: r._sum.quantity,
      orderCount: r._count.id,
    }));
  }

  async getPaymentBreakdown() {
    const result = await this.prisma.transaction.groupBy({
      by: ['payment_method'],
      _count: { id: true },
      _sum: { amount: true },
    });
    return result.map((r) => ({
      method: r.payment_method,
      count: r._count.id,
      total: r._sum.amount,
    }));
  }

  async getRevenueTrends(days = 30) {
    const start = new Date();
    start.setDate(start.getDate() - days);
    const orders = await this.prisma.order.findMany({
      where: { created_at: { gte: start }, status: 'COMPLETED' },
      select: { total: true, created_at: true },
      orderBy: { created_at: 'asc' },
    });
    // Group by date
    const grouped: Record<string, { date: string; revenue: number; count: number }> = {};
    for (const order of orders) {
      const date = order.created_at.toISOString().split('T')[0];
      if (!grouped[date]) grouped[date] = { date, revenue: 0, count: 0 };
      grouped[date].revenue += order.total;
      grouped[date].count += 1;
    }
    return Object.values(grouped);
  }

  async getClientsPerHour(date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate.setHours(0, 0, 0, 0));
    const end = new Date(targetDate.setHours(23, 59, 59, 999));

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
