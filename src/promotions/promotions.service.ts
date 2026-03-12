import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePromotionDto) {
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.promotion.findUnique({ where: { code } });
    if (exists) throw new BadRequestException(`Promo code "${code}" already exists`);

    const data = {
      code,
      description: dto.description ?? null,
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      min_order_amount: dto.min_order_amount ?? null,
      max_uses: dto.max_uses ?? null,
      valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
      valid_until: dto.valid_until ? new Date(dto.valid_until) : null,
      is_active: dto.is_active ?? true,
    };
    return this.prisma.promotion.create({ data });
  }

  async findAll(activeOnly?: boolean) {
    const where = activeOnly ? { is_active: true } : {};
    return this.prisma.promotion.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number) {
    const promo = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException(`Promotion #${id} not found`);
    return promo;
  }

  async findByCode(code: string) {
    const promo = await this.prisma.promotion.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!promo) throw new NotFoundException(`Promo code "${code}" not found`);
    return promo;
  }

  async update(id: number, dto: UpdatePromotionDto) {
    await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.valid_from !== undefined) data.valid_from = dto.valid_from ? new Date(dto.valid_from) : null;
    if (dto.valid_until !== undefined) data.valid_until = dto.valid_until ? new Date(dto.valid_until) : null;
    return this.prisma.promotion.update({
      where: { id },
      data: data as any,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.promotion.delete({ where: { id } });
    return { message: `Promotion #${id} deleted` };
  }

  async incrementUsedCount(id: number) {
    await this.findOne(id);
    return this.prisma.promotion.update({
      where: { id },
      data: { used_count: { increment: 1 } },
    });
  }
}
