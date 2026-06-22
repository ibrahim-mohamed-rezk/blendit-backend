import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BranchService } from '../branches/branch.service';
import type { BranchScope } from '../common/branch-scope';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  mapBranchAssignments,
  type BranchAssignmentInput,
} from './admin-page-access.util';
import * as bcrypt from 'bcrypt';

type Actor = { id: number; role: { name: string } };

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private branchService: BranchService,
  ) {}

  private toPublicUser(user: {
    password_hash: string;
    pin_hash: string | null;
    role?: { name: string };
    userBranches?: Array<{
      branch_id: number;
      page_access?: unknown;
      branch?: { id: number; name: string; slug: string };
    }>;
    [key: string]: unknown;
  }) {
    const { password_hash: _p, pin_hash: ph, userBranches, ...rest } = user;
    const branchRows = userBranches ?? [];
    const branchAssignments = mapBranchAssignments(
      branchRows.map((ub) => ({
        branch_id: ub.branch_id,
        page_access: ub.page_access,
        branch: ub.branch,
      })),
    );
    return {
      ...rest,
      has_pos_pin: !!ph,
      branch_ids: userBranches?.map((ub) => ub.branch_id) ?? [],
      branches: userBranches?.map((ub) => ub.branch) ?? [],
      branch_assignments: branchAssignments.map((a) => ({
        ...a,
        branch_name: userBranches?.find((ub) => ub.branch_id === a.branch_id)?.branch?.name,
      })),
    };
  }

  private assertSuperAdmin(actor?: Actor, message = 'Only SUPER_ADMIN can perform this action') {
    if (!actor || actor.role.name !== 'SUPER_ADMIN') {
      throw new ForbiddenException(message);
    }
  }

  private normalizeBranchAssignments(dto: {
    branch_assignments?: BranchAssignmentInput[];
    branch_ids?: number[];
    page_access?: string[];
  }): BranchAssignmentInput[] {
    if (dto.branch_assignments?.length) {
      return dto.branch_assignments.map((a) => ({
        branch_id: Number(a.branch_id),
        page_access: [...a.page_access],
      }));
    }
    if (dto.branch_ids?.length) {
      const pages = dto.page_access ?? [];
      return dto.branch_ids.map((branch_id) => ({
        branch_id: Number(branch_id),
        page_access: [...pages],
      }));
    }
    return [];
  }

  private async validateAdminBranchAssignments(assignments: BranchAssignmentInput[]) {
    if (!assignments.length) {
      throw new BadRequestException('At least one branch with page permissions is required for admin users');
    }
    const branchIds = assignments.map((a) => a.branch_id);
    const uniqueIds = new Set(branchIds);
    if (uniqueIds.size !== branchIds.length) {
      throw new BadRequestException('Duplicate branch assignments are not allowed');
    }
    for (const assignment of assignments) {
      if (!assignment.page_access?.length) {
        throw new BadRequestException(`Select at least one page permission for branch #${assignment.branch_id}`);
      }
    }
    const active = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, is_active: true },
      select: { id: true },
    });
    if (active.length !== branchIds.length) {
      throw new BadRequestException('One or more branch IDs are invalid or inactive');
    }
    return assignments;
  }

  private async syncUserBranchAssignments(userId: number, assignments: BranchAssignmentInput[]) {
    await this.prisma.$transaction([
      this.prisma.userBranch.deleteMany({ where: { user_id: userId } }),
      this.prisma.userBranch.createMany({
        data: assignments.map((a) => ({
          user_id: userId,
          branch_id: a.branch_id,
          page_access: a.page_access,
        })),
      }),
    ]);
  }

  private async resolveRole(roleId: number) {
    const role = await this.prisma.role.findUnique({ where: { id: Number(roleId) } });
    if (!role) throw new BadRequestException(`Role #${roleId} not found. Run: npx prisma db seed`);
    return role;
  }

  async create(dto: CreateUserDto, actor?: Actor) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Email already in use');

    const role = await this.resolveRole(dto.role_id);

    if (role.name === 'SUPER_ADMIN' || role.name === 'ADMIN') {
      this.assertSuperAdmin(actor, 'Only SUPER_ADMIN can create admin users');
    }

    if (role.name === 'CASHIER') {
      if (dto.branch_id == null) {
        throw new BadRequestException('branch_id is required for cashiers');
      }
    }

    let adminAssignments: BranchAssignmentInput[] | undefined;
    if (role.name === 'ADMIN') {
      this.assertSuperAdmin(actor, 'Only SUPER_ADMIN can assign branches to admin users');
      adminAssignments = await this.validateAdminBranchAssignments(this.normalizeBranchAssignments(dto));
    }

    const password_hash = await bcrypt.hash(dto.password, 10);
    const pin_hash = dto.pin?.trim() ? await bcrypt.hash(dto.pin.trim(), 10) : null;
    const data: Record<string, unknown> = {
      name: dto.name,
      email: dto.email,
      phone: dto.phone ?? null,
      password_hash,
      pin_hash,
      role_id: Number(dto.role_id),
      branch_id: role.name === 'CASHIER' ? dto.branch_id : null,
      page_access: Prisma.DbNull,
    };

    const user = await this.prisma.user.create({
      data: data as Parameters<typeof this.prisma.user.create>[0]['data'],
      include: { role: true, userBranches: { include: { branch: true } } },
    });

    if (role.name === 'ADMIN' && adminAssignments?.length) {
      await this.syncUserBranchAssignments(user.id, adminAssignments);
    }

    const full = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { role: true, userBranches: { include: { branch: true } } },
    });
    return this.toPublicUser(full!);
  }

  private async listWhereForActor(actor?: Actor, scope?: BranchScope) {
    let base: Record<string, unknown> = {};

    if (actor && actor.role.name !== 'SUPER_ADMIN') {
      const branches = await this.branchService.resolveBranchesForUser(actor.id, actor.role.name);
      const branchIds = branches.map((b) => b.id);
      if (branchIds.length === 0) return { id: -1 };
      base = {
        OR: [
          { branch_id: { in: branchIds } },
          { userBranches: { some: { branch_id: { in: branchIds } } } },
        ],
      };
    }

    if (scope && !scope.allBranches && scope.branchId != null) {
      const branchId = scope.branchId;
      const branchFilter = {
        OR: [{ branch_id: branchId }, { userBranches: { some: { branch_id: branchId } } }],
      };
      if (Object.keys(base).length === 0) return branchFilter;
      return { AND: [base, branchFilter] };
    }

    return base;
  }

  async findAll(page = 1, limit = 10, actor?: Actor, scope?: BranchScope) {
    const skip = (page - 1) * limit;
    const where = await this.listWhereForActor(actor, scope);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: { role: true, userBranches: { include: { branch: true } } },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data: data.map((u) => this.toPublicUser(u)), total, page, limit };
  }

  async findOne(id: number, actor?: Actor) {
    const where = { id, ...(await this.listWhereForActor(actor)) };
    const user = await this.prisma.user.findFirst({
      where,
      include: { role: true, userBranches: { include: { branch: true } } },
    });
    if (!user) throw new NotFoundException(`User #${id} not found`);
    return this.toPublicUser(user);
  }

  async update(id: number, dto: UpdateUserDto, actor?: Actor) {
    const existing = await this.findOne(id, actor);
    const role = dto.role_id != null ? await this.resolveRole(dto.role_id) : null;
    const roleName = role?.name ?? (existing.role as { name: string }).name;
    const existingRoleName = (existing.role as { name: string }).name;

    if (roleName === 'SUPER_ADMIN' || roleName === 'ADMIN') {
      if (existingRoleName !== roleName) {
        this.assertSuperAdmin(actor, 'Only SUPER_ADMIN can assign admin roles');
      }
    }

    const hasBranchPayload =
      dto.branch_assignments !== undefined ||
      dto.branch_ids !== undefined ||
      (dto.page_access !== undefined && roleName === 'ADMIN');

    if (hasBranchPayload) {
      this.assertSuperAdmin(actor, 'Only SUPER_ADMIN can assign branches to admin users');
    }
    if ('page_access' in dto && dto.page_access !== undefined && roleName === 'ADMIN' && !dto.branch_assignments) {
      this.assertSuperAdmin(actor, 'Only SUPER_ADMIN can set admin page access');
    }

    const data: any = { ...dto };
    if (dto.password) {
      data.password_hash = await bcrypt.hash(dto.password, 10);
      delete data.password;
    }
    if ('pin' in dto) {
      const raw = dto.pin;
      data.pin_hash =
        raw != null && String(raw).trim() !== '' ? await bcrypt.hash(String(raw).trim(), 10) : null;
      delete data.pin;
    }
    delete data.page_access;
    delete data.branch_ids;
    delete data.branch_assignments;

    if (roleName === 'CASHIER') {
      if (dto.branch_id !== undefined) data.branch_id = dto.branch_id;
    } else {
      data.branch_id = null;
      data.page_access = Prisma.DbNull;
    }

    await this.prisma.user.update({
      where: { id },
      data,
    });

    if (roleName === 'ADMIN') {
      if (hasBranchPayload) {
        const assignments = await this.validateAdminBranchAssignments(
          this.normalizeBranchAssignments({
            branch_assignments: dto.branch_assignments,
            branch_ids: dto.branch_ids,
            page_access: dto.page_access,
          }),
        );
        await this.syncUserBranchAssignments(id, assignments);
      } else if (role && role.name === 'ADMIN' && existingRoleName !== 'ADMIN') {
        throw new BadRequestException('branch_assignments is required when assigning the admin role');
      }
    } else if (dto.role_id != null && roleName !== 'ADMIN') {
      await this.prisma.userBranch.deleteMany({ where: { user_id: id } });
    }

    const full = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true, userBranches: { include: { branch: true } } },
    });
    return this.toPublicUser(full!);
  }

  async setUserBranches(userId: number, assignments: BranchAssignmentInput[]) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new NotFoundException(`User #${userId} not found`);
    if (user.role.name !== 'ADMIN') {
      throw new BadRequestException('Only ADMIN users can be assigned multiple branches');
    }

    const validated = await this.validateAdminBranchAssignments(assignments);
    await this.syncUserBranchAssignments(userId, validated);
    await this.prisma.user.update({
      where: { id: userId },
      data: { page_access: Prisma.DbNull },
    });

    return this.findOne(userId);
  }

  async remove(id: number, actor?: Actor) {
    await this.findOne(id, actor);
    await this.prisma.user.delete({ where: { id } });
    return { message: `User #${id} deleted successfully` };
  }

  async findAllRoles() {
    return this.prisma.role.findMany();
  }
}
