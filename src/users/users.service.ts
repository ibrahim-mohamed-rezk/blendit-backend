import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Email already in use');

    const role = await this.prisma.role.findUnique({ where: { id: Number(dto.role_id) } });
    if (!role) throw new BadRequestException(`Role #${dto.role_id} not found. Run: npx prisma db seed`);

    const password_hash = await bcrypt.hash(dto.password, 10);
    const pin_hash = dto.pin?.trim() ? await bcrypt.hash(dto.pin.trim(), 10) : null;
    const data: Record<string, unknown> = {
      name: dto.name,
      email: dto.email,
      phone: dto.phone ?? null,
      password_hash,
      pin_hash,
      role_id: Number(dto.role_id),
    };
    if (dto.page_access != null && Array.isArray(dto.page_access) && dto.page_access.length > 0) {
      data.page_access = dto.page_access;
    }
    const user = await this.prisma.user.create({
      data: data as Parameters<typeof this.prisma.user.create>[0]['data'],
      include: { role: true },
    });
    const { password_hash: _, pin_hash: __, ...result } = user;
    return result;
  }

  async findAll(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take: limit,
        include: { role: true },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count(),
    ]);
    return { data: data.map(({ password_hash, pin_hash, ...u }) => u), total, page, limit };
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException(`User #${id} not found`);
    const { password_hash, pin_hash, ...result } = user;
    return result;
  }

  async update(id: number, dto: UpdateUserDto) {
    await this.findOne(id);
    const data: any = { ...dto };
    if (dto.password) {
      data.password_hash = await bcrypt.hash(dto.password, 10);
      delete data.password;
    }
    if ('pin' in dto) {
      data.pin_hash = dto.pin?.trim() ? await bcrypt.hash(dto.pin.trim(), 10) : null;
      delete data.pin;
    }
    if ('page_access' in dto) {
      data.page_access = dto.page_access ?? null;
    }
    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: { role: true },
    });
    const { password_hash, pin_hash, ...result } = user;
    return result;
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    return { message: `User #${id} deleted successfully` };
  }

  async findAllRoles() {
    return this.prisma.role.findMany();
  }
}
