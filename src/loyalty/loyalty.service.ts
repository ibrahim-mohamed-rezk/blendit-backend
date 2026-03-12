import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LoyaltyService {
  constructor(private prisma: PrismaService) {}

  async getAccount(customerId: number) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customer_id: customerId },
      include: { customer: true },
    });
    if (!account) throw new NotFoundException(`Loyalty account for customer #${customerId} not found`);
    return account;
  }

  async getHistory(customerId: number, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.loyaltyTransaction.findMany({
        where: { customer_id: customerId },
        skip, take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.loyaltyTransaction.count({ where: { customer_id: customerId } }),
    ]);
    return { data, total, page, limit };
  }

  async manualAdjust(customerId: number, points: number, note?: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer #${customerId} not found`);

    await this.prisma.loyaltyAccount.upsert({
      where: { customer_id: customerId },
      update: { points_balance: { increment: points } },
      create: { customer_id: customerId, points_balance: points },
    });

    await this.prisma.loyaltyTransaction.create({
      data: {
        customer_id: customerId,
        points_change: points,
        type: 'MANUAL',
      },
    });

    return this.getAccount(customerId);
  }
}
