import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // Categories
  async createCategory(dto: CreateCategoryDto) {
    const exists = await this.prisma.category.findUnique({ where: { name: dto.name } });
    if (exists) throw new BadRequestException('Category already exists');
    return this.prisma.category.create({ data: { name: dto.name } });
  }

  async findAllCategories() {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  async findOneCategory(id: number) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException(`Category #${id} not found`);
    return cat;
  }

  async updateCategory(id: number, dto: UpdateCategoryDto) {
    await this.findOneCategory(id);
    const exists = await this.prisma.category.findFirst({
      where: { name: dto.name, NOT: { id } },
    });
    if (exists) throw new BadRequestException('Category with this name already exists');
    return this.prisma.category.update({ where: { id }, data: { name: dto.name } });
  }

  async removeCategory(id: number) {
    await this.findOneCategory(id);
    await this.prisma.category.delete({ where: { id } });
    return { message: `Category #${id} deleted` };
  }

  // Products
  async create(dto: CreateProductDto) {
    const data: Record<string, unknown> = {
      name: dto.name,
      description: dto.description ?? null,
      price: dto.price,
      category_id: dto.category_id,
      ingredients: dto.ingredients ?? [],
      image_url: dto.image_url ?? null,
      is_available: dto.is_available ?? true,
      is_popular: dto.is_popular ?? false,
      is_new: dto.is_new ?? false,
    };
    if (dto.customization_options !== undefined && dto.customization_options !== null) {
      data.customization_options = Array.isArray(dto.customization_options)
        ? dto.customization_options
        : null;
    }
    return this.prisma.product.create({
      data: data as Parameters<typeof this.prisma.product.create>[0]['data'],
      include: { category: true },
    });
  }

  async findAll(page = 1, limit = 10, categoryId?: number, available?: boolean, search?: string) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (categoryId) where.category_id = categoryId;
    if (available !== undefined) where.is_available = available;
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, skip, take: limit, include: { category: true }, orderBy: { created_at: 'desc' } }),
      this.prisma.product.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { category: true } });
    if (!product) throw new NotFoundException(`Product #${id} not found`);
    return product;
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.customization_options !== undefined) {
      data.customization_options = Array.isArray(dto.customization_options)
        ? dto.customization_options
        : null;
    }
    return this.prisma.product.update({
      where: { id },
      data: data as Parameters<typeof this.prisma.product.update>[0]['data'],
      include: { category: true },
    });
  }

  async remove(id: number) { 
    await this.findOne(id);
    const usedInOrders = await this.prisma.orderItem.count({ where: { product_id: id } });
    if (usedInOrders > 0) {
      throw new BadRequestException(
        `Cannot delete product: it is used in ${usedInOrders} order item(s). Remove or complete those orders first.`,
      );
    }
    await this.prisma.product.delete({ where: { id } });
    return { message: `Product #${id} deleted` }; 
  }
}
