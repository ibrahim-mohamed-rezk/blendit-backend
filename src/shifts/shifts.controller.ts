import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BranchScopeParam, CurrentBranch } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EnsureActiveShiftDto, ShiftAnalyticsQueryDto, ShiftsQueryDto } from './dto/shifts-query.dto';

@ApiTags('Shifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'List shifts (paginated, filter by active/date/cashier)' })
  findAll(@BranchScopeParam() scope: BranchScope, @Query() query: ShiftsQueryDto) {
    return this.shiftsService.findAll(scope, query);
  }

  @Get('active')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'All currently open shifts' })
  findActive(@BranchScopeParam() scope: BranchScope) {
    return this.shiftsService.findActive(scope);
  }

  @Get('analytics')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Shift analytics summary' })
  analytics(@BranchScopeParam() scope: BranchScope, @Query() query: ShiftAnalyticsQueryDto) {
    return this.shiftsService.getAnalytics(scope, query);
  }

  @Get('cashiers')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Cashiers who have shifts in this branch scope' })
  listCashiers(@BranchScopeParam() scope: BranchScope) {
    return this.shiftsService.listCashiers(scope);
  }

  @Get('current-summary')
  @Roles('SUPER_ADMIN', 'ADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Live summary of the caller\u2019s current open shift' })
  currentSummary(
    @CurrentBranch() branchId: number,
    @CurrentUser() user: { id: number },
  ) {
    return this.shiftsService.getCurrentSummary(branchId, user.id);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Get shift by ID' })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @BranchScopeParam() scope: BranchScope,
    @CurrentUser() user: { id: number; role: { name: string } },
  ) {
    return this.shiftsService.getOne(id, scope, user.id, user.role.name);
  }

  @Post('ensure-active')
  @Roles('SUPER_ADMIN', 'ADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Ensure cashier has an open shift (POS login / shift start)' })
  ensureActive(
    @CurrentBranch() branchId: number,
    @CurrentUser() user: { id: number },
    @Body() dto: EnsureActiveShiftDto,
  ) {
    return this.shiftsService.ensureActiveShift(branchId, user.id, dto.started_at);
  }

  @Post('end-active')
  @Roles('SUPER_ADMIN', 'ADMIN', 'CASHIER')
  @ApiOperation({ summary: 'End the current open shift for this cashier' })
  endActive(@CurrentBranch() branchId: number, @CurrentUser() user: { id: number }) {
    return this.shiftsService.endActiveShift(branchId, user.id);
  }

  @Post(':id/end')
  @Roles('SUPER_ADMIN', 'ADMIN', 'CASHIER')
  @ApiOperation({ summary: 'End a specific active shift' })
  endOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentBranch() branchId: number,
    @CurrentUser() user: { id: number; role: { name: string } },
  ) {
    const allowAny = user.role.name === 'SUPER_ADMIN' || user.role.name === 'ADMIN';
    return this.shiftsService.endShift(id, branchId, user.id, allowAny);
  }
}
