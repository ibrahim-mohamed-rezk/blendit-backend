import { Injectable, UnauthorizedException } from '@nestjs/common';
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
    return { access_token: token, user: result };
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const { password_hash, pin_hash, ...result } = user;
    return result;
  }

  async getPosSwitchUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        is_active: true,
        role: { name: { in: ['CASHIER', 'ADMIN', 'SUPER_ADMIN'] } },
      },
      select: {
        id: true,
        name: true,
        role: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return users;
  }

  async posSwitch(dto: PosSwitchDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.user_id },
      include: { role: true },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Invalid cashier');
    }

    const pin = dto.pin.trim();
    const valid = user.pin_hash
      ? await bcrypt.compare(pin, user.pin_hash)
      : await bcrypt.compare(pin, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid PIN');
    }

    const payload = { sub: user.id, email: user.email, role: user.role.name };
    const token = this.jwtService.sign(payload);
    await this.activityLogs.create({ user_id: user.id, action: 'pos_switch_login' });

    const { password_hash, pin_hash, ...result } = user;
    return { access_token: token, user: result };
  }
}
