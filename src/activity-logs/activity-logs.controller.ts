import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityLogsService } from './activity-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('Activity Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('activity-logs')
export class ActivityLogsController {
  constructor(private readonly activityLogsService: ActivityLogsService) {}

  @Get()
  @ApiOperation({ summary: 'Get activity logs (paginated)' })
  async findAll(
    @Query() pagination: PaginationDto,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @BranchScopeParam() scope?: BranchScope,
  ) {
    const uid = userId != null && userId !== '' ? parseInt(userId, 10) : undefined;
    const branchId = scope?.allBranches ? undefined : scope?.branchId ?? undefined;
    const result = await this.activityLogsService.findAll(
      pagination.page,
      pagination.limit,
      Number.isNaN(uid) ? undefined : uid,
      action,
      branchId,
    );
    return { data: result };
  }
}
