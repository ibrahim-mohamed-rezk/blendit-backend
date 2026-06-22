import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BranchSummary = { id: number; name: string; slug: string; address?: string | null };

export type AuthUserWithRole = {
  id: number;
  branch_id: number | null;
  role: { name: string };
  userBranches?: { branch_id: number; branch: BranchSummary }[];
};

@Injectable()
export class BranchService {
  constructor(private prisma: PrismaService) {}

  branchWhere(branchId: number) {
    return { branch_id: branchId };
  }

  async listActiveBranches(): Promise<BranchSummary[]> {
    return this.prisma.branch.findMany({
      where: { is_active: true },
      select: { id: true, name: true, slug: true, address: true },
      orderBy: { name: 'asc' },
    });
  }

  async resolveBranchesForUser(userId: number, roleName: string): Promise<BranchSummary[]> {
    if (roleName === 'SUPER_ADMIN') {
      return this.listActiveBranches();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userBranches: { include: { branch: { select: { id: true, name: true, slug: true, address: true } } } },
        branch: { select: { id: true, name: true, slug: true, address: true } },
      },
    });
    if (!user) return [];
    if (roleName === 'CASHIER' && user.branch) {
      return [user.branch];
    }
    const fromJunction = user.userBranches.map((ub) => ub.branch);
    if (fromJunction.length > 0) return fromJunction;
    if (user.branch) return [user.branch];
    return [];
  }

  async assertBranchAccess(user: AuthUserWithRole, branchId: number): Promise<void> {
    const role = user.role.name;
    if (role === 'SUPER_ADMIN') return;
    if (role === 'CASHIER') {
      if (user.branch_id !== branchId) {
        throw new ForbiddenException('Cashiers can only access their assigned branch');
      }
      return;
    }
    const allowed = await this.resolveBranchesForUser(user.id, role);
    if (!allowed.some((b) => b.id === branchId)) {
      throw new ForbiddenException('You do not have access to this branch');
    }
  }

  async resolveActiveBranchId(
    user: AuthUserWithRole,
    headerBranchId: number | undefined,
    jwtBranchId: number | undefined,
  ): Promise<number> {
    const role = user.role.name;
    let branchId = headerBranchId ?? jwtBranchId ?? user.branch_id ?? undefined;

    if (role === 'CASHIER') {
      branchId = user.branch_id ?? undefined;
      if (!branchId) {
        throw new BadRequestException('Cashier has no assigned branch');
      }
      if (headerBranchId != null && headerBranchId !== branchId) {
        throw new ForbiddenException('Cashiers cannot switch branches');
      }
      return branchId;
    }

    if (role === 'SUPER_ADMIN') {
      if (!branchId) {
        const branches = await this.listActiveBranches();
        if (branches.length === 0) throw new NotFoundException('No active branches');
        branchId = branches[0].id;
      }
      return branchId;
    }

    // ADMIN
    const allowed = await this.resolveBranchesForUser(user.id, role);
    if (allowed.length === 0) {
      throw new ForbiddenException('No branches assigned to this admin');
    }
    if (!branchId) {
      branchId = allowed[0].id;
    } else {
      await this.assertBranchAccess(user, branchId);
    }
    return branchId;
  }

  async findBySlug(slug: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { slug, is_active: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async findById(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch || !branch.is_active) throw new NotFoundException('Branch not found');
    return branch;
  }
}
