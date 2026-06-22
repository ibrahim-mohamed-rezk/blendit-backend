import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePromotionDto, branchId: number) {
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.promotion.findUnique({
      where: { branch_id_code: { branch_id: branchId, code } },
    });
    if (exists) throw new BadRequestException(`Promo code "${code}" already exists in this branch`);

    const data = {
      branch_id: branchId,
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

  async findAll(branchId: number, activeOnly?: boolean) {
    const where: { branch_id: number; is_active?: boolean } = { branch_id: branchId };
    if (activeOnly) where.is_active = true;
    return this.prisma.promotion.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number, branchId: number) {
    const promo = await this.prisma.promotion.findFirst({ where: { id, branch_id: branchId } });
    if (!promo) throw new NotFoundException(`Promotion #${id} not found`);
    return promo;
  }

  async findByCode(code: string, branchId: number) {
    const promo = await this.prisma.promotion.findUnique({
      where: { branch_id_code: { branch_id: branchId, code: code.trim().toUpperCase() } },
    });
    if (!promo) throw new NotFoundException(`Promo code "${code}" not found`);
    return promo;
  }

  async update(id: number, dto: UpdatePromotionDto, branchId: number) {
    const existing = await this.findOne(id, branchId);
    const data: Record<string, unknown> = { ...dto };
    if (dto.code != null) {
      const code = dto.code.trim().toUpperCase();
      if (code !== existing.code) {
        const dup = await this.prisma.promotion.findUnique({
          where: { branch_id_code: { branch_id: branchId, code } },
        });
        if (dup) throw new BadRequestException(`Promo code "${code}" already exists in this branch`);
      }
      data.code = code;
    }
    if (dto.valid_from !== undefined) data.valid_from = dto.valid_from ? new Date(dto.valid_from) : null;
    if (dto.valid_until !== undefined) data.valid_until = dto.valid_until ? new Date(dto.valid_until) : null;
    return this.prisma.promotion.update({
      where: { id },
      data: data as any,
    });
  }

  async remove(id: number, branchId: number) {
    await this.findOne(id, branchId);
    await this.prisma.promotion.delete({ where: { id } });
    return { message: `Promotion #${id} deleted` };
  }

  async incrementUsedCount(id: number, branchId: number) {
    await this.findOne(id, branchId);
    return this.prisma.promotion.update({
      where: { id },
      data: { used_count: { increment: 1 } },
    });
  }
}
