import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('lifetime-summary')
  @ApiOperation({ summary: 'Branch dashboard KPIs (completed orders, customers, pending deliveries)' })
  lifetimeSummary(@BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getLifetimeSummary(scope);
  }

  @Get('daily-sales')
  @ApiOperation({ summary: 'Daily sales summary' })
  dailySales(@BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getSalesSummary('daily', scope);
  }

  @Get('weekly-sales')
  @ApiOperation({ summary: 'Weekly sales summary' })
  weeklySales(@BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getSalesSummary('weekly', scope);
  }

  @Get('monthly-sales')
  @ApiOperation({ summary: 'Monthly sales summary' })
  monthlySales(@BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getSalesSummary('monthly', scope);
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Top selling products' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  topProducts(@Query('limit') limit: number | undefined, @BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getTopProducts(scope, limit ? +limit : 10);
  }

  @Get('revenue-trends')
  @ApiOperation({ summary: 'Revenue trend over last N days' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  revenueTrends(@Query('days') days: number | undefined, @BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getRevenueTrends(scope, days ? +days : 30);
  }

  @Get('payment-breakdown')
  @ApiOperation({ summary: 'Orders and revenue split by payment method' })
  paymentBreakdown(@BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getPaymentBreakdown(scope);
  }

  @Get('clients-per-hour')
  @ApiOperation({ summary: 'Orders per hour for a given date (peak hours report)' })
  @ApiQuery({ name: 'date', required: false, description: 'Date in YYYY-MM-DD format (defaults to today)' })
  clientsPerHour(@Query('date') date: string | undefined, @BranchScopeParam() scope: BranchScope) {
    return this.analyticsService.getClientsPerHour(scope, date);
  }
}
