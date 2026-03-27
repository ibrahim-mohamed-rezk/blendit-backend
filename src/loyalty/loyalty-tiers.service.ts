import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoyaltyTierDto } from './dto/create-loyalty-tier.dto';
import { UpdateLoyaltyTierDto } from './dto/update-loyalty-tier.dto';

@Injectable()
export class LoyaltyTiersService {
  constructor(private prisma: PrismaService) {}

  async findAll(activeOnly?: boolean) {
    const where = activeOnly ? { is_active: true } : {};
    return this.prisma.loyaltyTier.findMany({
      where,
      orderBy: [{ sort_order: 'asc' }, { points_threshold: 'asc' }, { id: 'asc' }],
    });
  }

  async findOne(id: number) {
    const tier = await this.prisma.loyaltyTier.findUnique({ where: { id } });
    if (!tier) throw new NotFoundException(`Loyalty tier #${id} not found`);
    return tier;
  }

  async create(dto: CreateLoyaltyTierDto) {
    return this.prisma.loyaltyTier.create({
      data: {
        name: dto.name,
        points_threshold: dto.points_threshold,
        color_from: dto.color_from ?? '#22c55e',
        color_to: dto.color_to ?? '#10b981',
        benefits: dto.benefits ?? [],
        sort_order: dto.sort_order ?? 0,
        is_active: dto.is_active ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateLoyaltyTierDto) {
    await this.findOne(id);
    return this.prisma.loyaltyTier.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.points_threshold != null && { points_threshold: dto.points_threshold }),
        ...(dto.color_from != null && { color_from: dto.color_from }),
        ...(dto.color_to != null && { color_to: dto.color_to }),
        ...(dto.benefits != null && { benefits: dto.benefits }),
        ...(dto.sort_order != null && { sort_order: dto.sort_order }),
        ...(dto.is_active != null && { is_active: dto.is_active }),
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.loyaltyTier.delete({ where: { id } });
    return { success: true };
  }
}
