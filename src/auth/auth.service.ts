import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { BranchService } from '../branches/branch.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { PosSwitchDto } from './dto/pos-switch.dto';
import { SwitchBranchDto } from './dto/switch-branch.dto';
import { resolveAdminPageAccess, asUserBranchAccessRows } from '../users/admin-page-access.util';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private activityLogs: ActivityLogsService,
    private branchService: BranchService,
  ) {}

  private async buildTokenPayload(user: { id: number; email: string; role: { name: string }; branch_id: number | null }) {
    const branches = await this.branchService.resolveBranchesForUser(user.id, user.role.name);
    let branch_id = user.branch_id ?? branches[0]?.id ?? null;
    if (user.role.name === 'CASHIER' && user.branch_id) {
      branch_id = user.branch_id;
    }
    return {
      sub: user.id,
      email: user.email,
      role: user.role.name,
      branch_id,
      branch_ids: user.role.name === 'SUPER_ADMIN' ? 'all' : branches.map((b) => b.id),
    };
  }

  private signToken(payload: Record<string, unknown>) {
    return this.jwtService.sign(payload);
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account is inactive');
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = await this.buildTokenPayload(user);
    const token = this.signToken(payload);

    await this.activityLogs.create({
      user_id: user.id,
      action: 'login',
      branch_id: payload.branch_id ?? undefined,
    });

    const me = await this.getMe(user.id, payload.branch_id ?? undefined);
    const { password_hash, pin_hash, ...result } = user;
    return { access_token: token, user: { ...result, ...me, has_pos_pin: !!pin_hash } };
  }

  async getMe(userId: number, activeBranchId?: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        branch: true,
        userBranches: { include: { branch: { select: { id: true, name: true, slug: true, address: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const branches = await this.branchService.resolveBranchesForUser(user.id, user.role.name);
    let branch_id =
      user.role.name === 'CASHIER'
        ? user.branch_id
        : user.branch_id ?? branches[0]?.id ?? null;

    if (activeBranchId != null && user.role.name !== 'CASHIER') {
      if (user.role.name === 'SUPER_ADMIN' || branches.some((b) => b.id === activeBranchId)) {
        branch_id = activeBranchId;
      }
    }

    const branchRows = asUserBranchAccessRows(user.userBranches);

    const page_access = resolveAdminPageAccess(
      user.role.name,
      user.page_access,
      branchRows,
      branch_id,
    );

    const branch_assignments = branchRows.map((ub) => ({
      branch_id: ub.branch_id,
      branch_name: ub.branch?.name,
      page_access: Array.isArray(ub.page_access) ? (ub.page_access as string[]) : [],
    }));

    const { password_hash, pin_hash, userBranches: _ub, ...result } = user;
    return {
      ...result,
      branch_id,
      branches,
      page_access,
      branch_assignments,
      has_pos_pin: !!pin_hash,
    };
  }

  async switchBranch(userId: number, dto: SwitchBranchDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.role.name === 'CASHIER') {
      throw new ForbiddenException('Cashiers cannot switch branches');
    }
    await this.branchService.assertBranchAccess(user, dto.branch_id);
    const payload = await this.buildTokenPayload({ ...user, branch_id: dto.branch_id });
    payload.branch_id = dto.branch_id;
    const token = this.signToken(payload);
    const me = await this.getMe(userId, dto.branch_id);
    return { access_token: token, user: me };
  }

  async getPosSwitchUsers(branchId?: number) {
    const where: Record<string, unknown> = {
      is_active: true,
      role: { name: { in: ['CASHIER', 'ADMIN', 'SUPER_ADMIN'] } },
      pin_hash: { not: null },
    };
    if (branchId != null) {
      where.OR = [
        { branch_id: branchId },
        { role: { name: 'SUPER_ADMIN' } },
        { userBranches: { some: { branch_id: branchId } } },
      ];
    }
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        branch_id: true,
        role: { select: { name: true } },
        pin_hash: true,
      },
      orderBy: { name: 'asc' },
    });
    return users.map(({ pin_hash: _ph, ...rest }) => ({ ...rest, has_pos_pin: true }));
  }

  async posSwitch(dto: PosSwitchDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.user_id },
      include: { role: true },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Invalid cashier');
    }

    if (!user.pin_hash) {
      throw new BadRequestException(
        'No POS PIN is set for this user. An admin can add one under Dashboard → Employees.',
      );
    }
    const pin = dto.pin.trim();
    const valid = await bcrypt.compare(pin, user.pin_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid PIN');
    }

    const payload = await this.buildTokenPayload(user);
    const token = this.signToken(payload);
    await this.activityLogs.create({
      user_id: user.id,
      action: 'pos_switch_login',
      branch_id: payload.branch_id ?? undefined,
    });

    const me = await this.getMe(user.id, payload.branch_id ?? undefined);
    const { password_hash, pin_hash, ...result } = user;
    return { access_token: token, user: { ...result, ...me, has_pos_pin: !!pin_hash } };
  }
}
