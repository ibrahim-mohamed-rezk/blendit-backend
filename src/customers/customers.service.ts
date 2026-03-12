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
      this.prisma.customer.findMany({ skip, take: limit, orderBy: { created_at: 'desc' } }),
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
}
