import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 10, paymentMethod?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (paymentMethod) where.payment_method = paymentMethod;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where, skip, take: limit,
        include: { order: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { order: { include: { items: { include: { product: true } } } }, user: true },
    });
  }
}
