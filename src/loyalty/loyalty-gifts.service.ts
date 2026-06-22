import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoyaltyGiftDto } from './dto/create-loyalty-gift.dto';
import { UpdateLoyaltyGiftDto } from './dto/update-loyalty-gift.dto';

@Injectable()
export class LoyaltyGiftsService {
  constructor(private prisma: PrismaService) {}

  async findAll(branchId: number, activeOnly?: boolean) {
    const where: { branch_id: number; is_active?: boolean } = { branch_id: branchId };
    if (activeOnly) where.is_active = true;
    return this.prisma.loyaltyGift.findMany({
      where,
      orderBy: { points_required: 'asc' },
      include: {
        giftProduct: {
          select: {
            id: true,
            name: true,
            description: true,
            tagline: true,
            price: true,
            image_url: true,
            is_available: true,
          },
        },
      },
    });
  }

  async findOne(id: number, branchId: number) {
    const gift = await this.prisma.loyaltyGift.findFirst({ where: { id, branch_id: branchId } });
    if (!gift) throw new NotFoundException(`Loyalty gift #${id} not found`);
    return gift;
  }

  private async assertGiftProductBranch(giftProductId: number | null | undefined, branchId: number) {
    if (giftProductId == null) return;
    const product = await this.prisma.product.findFirst({
      where: { id: giftProductId, branch_id: branchId },
    });
    if (!product) {
      throw new BadRequestException('Gift product must belong to the same branch');
    }
  }

  async create(dto: CreateLoyaltyGiftDto, branchId: number) {
    await this.assertGiftProductBranch(dto.gift_product_id, branchId);
    return this.prisma.loyaltyGift.create({
      data: {
        branch_id: branchId,
        name: dto.name,
        description: dto.description ?? null,
        points_required: dto.points_required,
        discount_value: dto.discount_value,
        gift_product_id: dto.gift_product_id ?? null,
        is_active: dto.is_active ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateLoyaltyGiftDto, branchId: number) {
    await this.findOne(id, branchId);
    if (dto.gift_product_id !== undefined) {
      await this.assertGiftProductBranch(dto.gift_product_id, branchId);
    }
    return this.prisma.loyaltyGift.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.points_required != null && { points_required: dto.points_required }),
        ...(dto.discount_value != null && { discount_value: dto.discount_value }),
        ...(dto.gift_product_id !== undefined && { gift_product_id: dto.gift_product_id }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });
  }

  async remove(id: number, branchId: number) {
    await this.findOne(id, branchId);
    await this.prisma.loyaltyGift.delete({ where: { id } });
    return { success: true };
  }
}
