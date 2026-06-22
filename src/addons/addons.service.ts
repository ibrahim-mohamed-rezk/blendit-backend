import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddonDto } from './dto/create-addon.dto';
import { UpdateAddonDto } from './dto/update-addon.dto';

@Injectable()
export class AddonsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForAdmin(branchId: number) {
    return this.prisma.addon.findMany({
      where: { branch_id: branchId },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  async findAllActive(branchId: number) {
    return this.prisma.addon.findMany({
      where: { branch_id: branchId, is_active: true },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  async create(dto: CreateAddonDto, branchId: number) {
    return this.prisma.addon.create({
      data: {
        branch_id: branchId,
        name: dto.name.trim(),
        price: dto.price,
        is_active: dto.is_active ?? true,
        sort_order: dto.sort_order ?? 0,
      },
    });
  }

  async update(id: number, dto: UpdateAddonDto, branchId: number) {
    await this.ensureExists(id, branchId);
    return this.prisma.addon.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
      },
    });
  }

  async remove(id: number, branchId: number) {
    await this.ensureExists(id, branchId);
    const used = await this.prisma.orderAddon.count({ where: { addon_id: id } });
    if (used > 0) {
      return this.prisma.addon.update({
        where: { id },
        data: { is_active: false },
      });
    }
    await this.prisma.addon.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async ensureExists(id: number, branchId: number): Promise<void> {
    const row = await this.prisma.addon.findFirst({ where: { id, branch_id: branchId } });
    if (!row) throw new NotFoundException(`Add-on #${id} not found`);
  }
}
