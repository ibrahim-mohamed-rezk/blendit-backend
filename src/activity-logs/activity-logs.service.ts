import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateLogDto {
  user_id: number;
  action: string;
  entity?: string;
  entity_id?: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class ActivityLogsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLogDto) {
    return this.prisma.activityLog.create({ data: dto });
  }

  async findAll(page = 1, limit = 20, userId?: number, action?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (userId) where.user_id = userId;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({
        where, skip, take: limit,
        include: { user: { select: { id: true, name: true, email: true, role: { select: { name: true } } } } },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.activityLog.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
