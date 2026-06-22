import { Controller, Post, Get, Body, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PosSwitchDto } from './dto/pos-switch.dto';
import { SwitchBranchDto } from './dto/switch-branch.dto';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly activityLogs: ActivityLogsService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login and get JWT token' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Logout (client-side token invalidation)' })
  async logout(@CurrentUser() user: { id: number }) {
    await this.activityLogs.create({ user_id: user.id, action: 'logout' });
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current authenticated user' })
  async getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.id);
  }

  @Post('switch-branch')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Switch active branch (admin / super admin)' })
  async switchBranch(@CurrentUser() user: { id: number }, @Body() dto: SwitchBranchDto) {
    return this.authService.switchBranch(user.id, dto);
  }

  @Get('pos-users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, BranchGuard)
  @ApiOperation({ summary: 'List active staff for POS quick switch' })
  async getPosUsers(@CurrentBranch() branchId: number) {
    return this.authService.getPosSwitchUsers(branchId);
  }

  @Post('pos-switch')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Switch active POS user by PIN' })
  async posSwitch(@Body() dto: PosSwitchDto) {
    return this.authService.posSwitch(dto);
  }
}
