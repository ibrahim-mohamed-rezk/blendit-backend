import { Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsQueryDto } from './dto/transactions-query.dto';

function mapQueryStatus(raw?: string): TransactionStatus | undefined {
  if (!raw?.trim()) return undefined;
  const key = raw.trim().toUpperCase();
  const map: Record<string, TransactionStatus> = {
    PAID: TransactionStatus.COMPLETED,
    COMPLETED: TransactionStatus.COMPLETED,
    PENDING: TransactionStatus.PENDING,
    REFUNDED: TransactionStatus.REFUNDED,
    FAILED: TransactionStatus.FAILED,
  };
  return map[key];
}

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  async findAll(dto: TransactionsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 10;
    const skip = (page - 1) * limit;

    const parts: Prisma.TransactionWhereInput[] = [];

    if (dto.date) {
      const start = new Date(dto.date);
      const end = new Date(dto.date);
      end.setDate(end.getDate() + 1);
      parts.push({ created_at: { gte: start, lt: end } });
    }

    if (dto.paymentMethod) {
      parts.push({ payment_method: dto.paymentMethod });
    }

    if (dto.userId) {
      parts.push({ user_id: dto.userId });
    }

    const mappedStatus = mapQueryStatus(dto.status);
    if (mappedStatus) {
      parts.push({ status: mappedStatus });
    }

    if (dto.type === 'sale') {
      parts.push({ status: { not: TransactionStatus.REFUNDED } });
    } else if (dto.type === 'refund') {
      parts.push({ status: TransactionStatus.REFUNDED });
    } else if (dto.type === 'expense') {
      parts.push({ id: { lt: 0 } });
    }

    if (dto.search?.trim()) {
      const s = dto.search.trim();
      const or: Prisma.TransactionWhereInput[] = [
        { order: { order_number: { contains: s, mode: 'insensitive' } } },
        { user: { name: { contains: s, mode: 'insensitive' } } },
      ];
      const idNum = Number.parseInt(s, 10);
      if (!Number.isNaN(idNum) && String(idNum) === s) {
        or.push({ id: idNum });
        or.push({ order_id: idNum });
      }
      parts.push({ OR: or });
    }

    const where: Prisma.TransactionWhereInput = parts.length > 0 ? { AND: parts } : {};

    const refundWhere: Prisma.TransactionWhereInput =
      parts.length > 0
        ? { AND: [...parts, { status: TransactionStatus.REFUNDED }] }
        : { status: TransactionStatus.REFUNDED };

    const revenueWhere: Prisma.TransactionWhereInput =
      parts.length > 0
        ? { AND: [...parts, { status: { not: TransactionStatus.REFUNDED } }] }
        : { status: { not: TransactionStatus.REFUNDED } };

    const [
      data,
      total,
      sumRow,
      byUserAll,
      byUserRevenue,
      byUserRefunds,
    ] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        include: { order: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.aggregate({
        where,
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['user_id'],
        where,
        orderBy: { user_id: 'asc' },
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['user_id'],
        where: revenueWhere,
        orderBy: { user_id: 'asc' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['user_id'],
        where: refundWhere,
        orderBy: { user_id: 'asc' },
        _count: { id: true },
      }),
    ]);

    const userIds = [...new Set(byUserAll.map((g) => g.user_id))];
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const revenueMap = new Map(
      byUserRevenue.map((g) => [g.user_id, g._sum?.amount ?? 0]),
    );
    const refundCountMap = new Map(
      byUserRefunds.map((g) => [g.user_id, g._count && typeof g._count === 'object' ? g._count.id : 0]),
    );

    const byCashier = byUserAll.map((g) => {
      const cnt = g._count && typeof g._count === 'object' ? g._count.id : 0;
      return {
        userId: g.user_id,
        name: nameById[g.user_id] ?? '—',
        count: cnt,
        revenue: revenueMap.get(g.user_id) ?? 0,
        cancelled: refundCountMap.get(g.user_id) ?? 0,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      summary: {
        totalAmount: sumRow._sum.amount ?? 0,
        byCashier,
      },
    };
  }

  async findOne(id: number) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { order: { include: { items: { include: { product: true } } } }, user: true },
    });
  }
}
