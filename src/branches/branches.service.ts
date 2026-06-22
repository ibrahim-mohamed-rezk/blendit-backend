import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.branch.findMany({ orderBy: { name: 'asc' } });
  }

  findOne(id: number) {
    return this.prisma.branch.findUnique({ where: { id } });
  }

  create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  update(id: number, dto: UpdateBranchDto) {
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException(`Branch #${id} not found`);
    if (branch.slug === 'main') {
      throw new BadRequestException('The Main branch cannot be deleted');
    }

    const [orders, products, categories] = await Promise.all([
      this.prisma.order.count({ where: { branch_id: id } }),
      this.prisma.product.count({ where: { branch_id: id } }),
      this.prisma.category.count({ where: { branch_id: id } }),
    ]);

    if (orders > 0 || products > 0 || categories > 0) {
      throw new BadRequestException(
        'Branch has existing data. Deactivate it instead of deleting, or move data to another branch first.',
      );
    }

    await this.prisma.branch.delete({ where: { id } });
    return { id, deleted: true };
  }
}
