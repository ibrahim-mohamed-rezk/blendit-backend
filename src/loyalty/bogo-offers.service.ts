import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBogoOfferDto } from './dto/create-bogo-offer.dto';
import { UpdateBogoOfferDto } from './dto/update-bogo-offer.dto';

const productSelect = {
  id: true,
  name: true,
  price: true,
  image_url: true,
  is_available: true,
} as const;

@Injectable()
export class BogoOffersService {
  constructor(private prisma: PrismaService) {}

  async findAll(branchId: number, activeOnly?: boolean) {
    const where: { branch_id: number; is_active?: boolean } = { branch_id: branchId };
    if (activeOnly) where.is_active = true;
    return this.prisma.bogoOffer.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        buyProduct: { select: productSelect },
        getProduct: { select: productSelect },
      },
    });
  }

  async findOne(id: number, branchId: number) {
    const offer = await this.prisma.bogoOffer.findFirst({
      where: { id, branch_id: branchId },
      include: {
        buyProduct: { select: productSelect },
        getProduct: { select: productSelect },
      },
    });
    if (!offer) throw new NotFoundException(`BOGO offer #${id} not found`);
    return offer;
  }

  private async assertProductInBranch(productId: number, branchId: number, label: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, branch_id: branchId },
    });
    if (!product) {
      throw new BadRequestException(`${label} must belong to the same branch`);
    }
  }

  private parseOptionalDate(value?: string | null): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value == null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    return d;
  }

  async create(dto: CreateBogoOfferDto, branchId: number) {
    if (dto.buy_product_id != null) {
      await this.assertProductInBranch(dto.buy_product_id, branchId, 'Buy product');
    }
    await this.assertProductInBranch(dto.get_product_id, branchId, 'Free product');
    return this.prisma.bogoOffer.create({
      data: {
        branch_id: branchId,
        name: dto.name,
        buy_product_id: dto.buy_product_id ?? null,
        buy_quantity: dto.buy_quantity,
        get_product_id: dto.get_product_id,
        get_quantity: dto.get_quantity,
        is_active: dto.is_active ?? true,
        valid_from: this.parseOptionalDate(dto.valid_from) ?? null,
        valid_until: this.parseOptionalDate(dto.valid_until) ?? null,
      },
      include: {
        buyProduct: { select: productSelect },
        getProduct: { select: productSelect },
      },
    });
  }

  async update(id: number, dto: UpdateBogoOfferDto, branchId: number) {
    await this.findOne(id, branchId);
    if (dto.buy_product_id != null) {
      await this.assertProductInBranch(dto.buy_product_id, branchId, 'Buy product');
    }
    if (dto.get_product_id != null) {
      await this.assertProductInBranch(dto.get_product_id, branchId, 'Free product');
    }
    return this.prisma.bogoOffer.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.buy_product_id !== undefined && { buy_product_id: dto.buy_product_id ?? null }),
        ...(dto.buy_quantity != null && { buy_quantity: dto.buy_quantity }),
        ...(dto.get_product_id != null && { get_product_id: dto.get_product_id }),
        ...(dto.get_quantity != null && { get_quantity: dto.get_quantity }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...(dto.valid_from !== undefined && { valid_from: this.parseOptionalDate(dto.valid_from) ?? null }),
        ...(dto.valid_until !== undefined && { valid_until: this.parseOptionalDate(dto.valid_until) ?? null }),
      },
      include: {
        buyProduct: { select: productSelect },
        getProduct: { select: productSelect },
      },
    });
  }

  async remove(id: number, branchId: number) {
    await this.findOne(id, branchId);
    await this.prisma.bogoOffer.delete({ where: { id } });
    return { success: true };
  }
}
