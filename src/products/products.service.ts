import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';

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

  async removeCategory(id: number) {
    await this.prisma.category.delete({ where: { id } });
    return { message: `Category #${id} deleted` };
  }

  // Products
  async create(dto: CreateProductDto) {
    const data = {
      name: dto.name,
      description: dto.description,
      price: dto.price,
      category_id: dto.category_id,
      ingredients: dto.ingredients || [],
      image_url: dto.image_url,
      is_available: dto.is_available ?? true,
      is_popular: dto.is_popular ?? false,
      is_new: dto.is_new ?? false,
    };
    return this.prisma.product.create({
      data: data as Parameters<typeof this.prisma.product.create>[0]['data'],
      include: { category: true },
    });
  }

  async findAll(page = 1, limit = 10, categoryId?: number, available?: boolean) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (categoryId) where.category_id = categoryId;
    if (available !== undefined) where.is_available = available;

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
    return this.prisma.product.update({ where: { id }, data: dto, include: { category: true } });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.product.delete({ where: { id } });
    return { message: `Product #${id} deleted` };
  }
}
