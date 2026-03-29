import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  private normalizePhone(phone: string): string {
    return phone.trim();
  }

  /** Lowercase trimmed email, or null if empty / missing. */
  private normalizeEmail(email: string | undefined | null): string | null {
    if (email == null) return null;
    const t = email.trim();
    return t.length > 0 ? t.toLowerCase() : null;
  }

  private async findOtherCustomerByEmail(email: string, excludeCustomerId?: number) {
    const row = await this.prisma.customer.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        ...(excludeCustomerId != null ? { NOT: { id: excludeCustomerId } } : {}),
      },
      select: { id: true, phone: true },
    });
    return row;
  }

  async create(dto: CreateCustomerDto) {
    const phone = this.normalizePhone(dto.phone);
    const email = this.normalizeEmail(dto.email);
    const exists = await this.prisma.customer.findUnique({ where: { phone } });
    if (exists) throw new BadRequestException('Customer with this phone already exists');
    if (email) {
      const byEmail = await this.findOtherCustomerByEmail(email);
      if (byEmail) throw new BadRequestException('Customer with this email already exists');
    }
    return this.prisma.customer.create({
      data: { name: dto.name.trim(), phone, email },
    });
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
      where: { phone: this.normalizePhone(phone) },
      include: { loyaltyAccount: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Website OTP flow — no exception when missing. */
  async findByPhoneOptional(phone: string) {
    return this.prisma.customer.findUnique({
      where: { phone: this.normalizePhone(phone) },
      include: { loyaltyAccount: true },
    });
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
      where: { phone: this.normalizePhone(trimmed) },
      include: { loyaltyAccount: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /**
   * Website "join club" — create only. Does not update existing rows or sign anyone in.
   */
  async register(dto: CreateCustomerDto) {
    const phone = this.normalizePhone(dto.phone);
    const email = this.normalizeEmail(dto.email);
    const existingPhone = await this.prisma.customer.findUnique({ where: { phone } });
    if (existingPhone) {
      throw new BadRequestException(
        'An account with this phone number already exists. Please sign in instead.',
      );
    }
    if (email) {
      const byEmail = await this.findOtherCustomerByEmail(email);
      if (byEmail) {
        throw new BadRequestException(
          'An account with this email already exists. Please sign in or use a different email.',
        );
      }
    }
    return this.prisma.customer.create({
      data: { name: dto.name.trim(), phone, email },
      include: { loyaltyAccount: true },
    });
  }

  async upsertByPhone(dto: CreateCustomerDto) {
    const phone = this.normalizePhone(dto.phone);
    const email = this.normalizeEmail(dto.email);
    const existing = await this.prisma.customer.findUnique({
      where: { phone },
      include: { loyaltyAccount: true },
    });

    if (!existing) {
      if (email) {
        const byEmail = await this.findOtherCustomerByEmail(email);
        if (byEmail) {
          throw new BadRequestException(
            'This email is already linked to another account. Log in with that phone or use a different email.',
          );
        }
      }
      return this.prisma.customer.create({
        data: {
          name: dto.name.trim(),
          phone,
          email,
        },
        include: { loyaltyAccount: true },
      });
    }

    if (email) {
      const byEmail = await this.findOtherCustomerByEmail(email, existing.id);
      if (byEmail) {
        throw new BadRequestException('Customer with this email already exists');
      }
    }

    return this.prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: dto.name.trim(),
        email,
      },
      include: { loyaltyAccount: true },
    });
  }

  async getFavoriteProductIdsByPhone(phone: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { phone: this.normalizePhone(phone) },
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

  /**
   * Permanently remove a customer. Orders keep history with customer unlinked (SET NULL).
   * Clears loyalty history, delivery-queue rows, and held-order links first due to DB RESTRICT rules.
   */
  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyTransaction.deleteMany({ where: { customer_id: id } });
      await tx.deliveryOrder.deleteMany({ where: { customer_id: id } });
      // held_orders.customer_id uses ON DELETE SET NULL; favorites & loyalty_accounts cascade.
      await tx.customer.delete({ where: { id } });
    });
    return { id, deleted: true };
  }

  async setFavoriteByPhone(phone: string, productId: number, isFavorite: boolean) {
    const customer = await this.prisma.customer.findUnique({
      where: { phone: this.normalizePhone(phone) },
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
