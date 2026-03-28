import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCustomerDto) {
    const exists = await this.prisma.customer.findUnique({ where: { phone: dto.phone } });
    if (exists) throw new BadRequestException('Customer with this phone already exists');
    return this.prisma.customer.create({ data: dto });
  }

  async findAll(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { loyaltyAccount: true },
      }),
      this.prisma.customer.count(),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException(`Customer #${id} not found`);
    return customer;
  }

  async searchByPhone(phone: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { phone },
      include: { loyaltyAccount: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Website login: exact phone match, or case-insensitive email match. */
  async searchByPhoneOrEmail(lookup: string) {
    const trimmed = lookup.trim();
    if (!trimmed) {
      throw new BadRequestException('Phone or email is required');
    }
    const looksLikeEmail = trimmed.includes('@');
    if (looksLikeEmail) {
      const customer = await this.prisma.customer.findFirst({
        where: { email: { equals: trimmed, mode: 'insensitive' } },
        include: { loyaltyAccount: true },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      return customer;
    }
    const customer = await this.prisma.customer.findUnique({
      where: { phone: trimmed },
      include: { loyaltyAccount: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async upsertByPhone(dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { phone: dto.phone },
      include: { loyaltyAccount: true },
    });

    if (!existing) {
      return this.prisma.customer.create({
        data: {
          name: dto.name,
          phone: dto.phone,
          email: dto.email ?? null,
        },
        include: { loyaltyAccount: true },
      });
    }

    return this.prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: dto.name,
        email: dto.email ?? null,
      },
      include: { loyaltyAccount: true },
    });
  }

  async getFavoriteProductIdsByPhone(phone: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS customer_favorites (
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (customer_id, product_id)
      )
    `);

    const favorites = await this.prisma.$queryRaw<Array<{ product_id: number }>>`
      SELECT product_id
      FROM customer_favorites
      WHERE customer_id = ${customer.id}
      ORDER BY created_at DESC
    `;
    return favorites.map((f) => Number(f.product_id));
  }

  async setFavoriteByPhone(phone: string, productId: number, isFavorite: boolean) {
    const customer = await this.prisma.customer.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS customer_favorites (
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (customer_id, product_id)
      )
    `);

    if (isFavorite) {
      await this.prisma.$executeRaw`
        INSERT INTO customer_favorites (customer_id, product_id)
        VALUES (${customer.id}, ${productId})
        ON CONFLICT (customer_id, product_id) DO NOTHING
      `;
    } else {
      await this.prisma.$executeRaw`
        DELETE FROM customer_favorites
        WHERE customer_id = ${customer.id} AND product_id = ${productId}
      `;
    }

    const favorites = await this.prisma.$queryRaw<Array<{ product_id: number }>>`
      SELECT product_id
      FROM customer_favorites
      WHERE customer_id = ${customer.id}
      ORDER BY created_at DESC
    `;
    return favorites.map((f) => Number(f.product_id));
  }
}
