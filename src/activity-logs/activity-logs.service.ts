import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(ActivityLogsService.name);

  constructor(private prisma: PrismaService) {}

  /** Best-effort: never fail the caller (e.g. login) if the table is missing or DB errors. */
  async create(dto: CreateLogDto) {
    try {
      return await this.prisma.activityLog.create({ data: dto });
    } catch (err) {
      this.logger.warn(
        `Activity log skipped (${dto.action}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
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
