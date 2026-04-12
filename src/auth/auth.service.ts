import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { PosSwitchDto } from './dto/pos-switch.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private activityLogs: ActivityLogsService,
  ) {}

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

    const payload = { sub: user.id, email: user.email, role: user.role.name };
    const token = this.jwtService.sign(payload);

    await this.activityLogs.create({ user_id: user.id, action: 'login' });

    const { password_hash, pin_hash, ...result } = user;
    return { access_token: token, user: { ...result, has_pos_pin: !!pin_hash } };
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const { password_hash, pin_hash, ...result } = user;
    return { ...result, has_pos_pin: !!pin_hash };
  }

  async getPosSwitchUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        is_active: true,
        role: { name: { in: ['CASHIER', 'ADMIN', 'SUPER_ADMIN'] } },
        pin_hash: { not: null },
      },
      select: {
        id: true,
        name: true,
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

    const payload = { sub: user.id, email: user.email, role: user.role.name };
    const token = this.jwtService.sign(payload);
    await this.activityLogs.create({ user_id: user.id, action: 'pos_switch_login' });

    const { password_hash, pin_hash, ...result } = user;
    return { access_token: token, user: { ...result, has_pos_pin: !!pin_hash } };
  }
}
