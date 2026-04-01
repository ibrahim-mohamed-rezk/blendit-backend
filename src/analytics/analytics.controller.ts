import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator'; 

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('daily-sales')
  @ApiOperation({ summary: 'Daily sales summary' })
  dailySales() {
    return this.analyticsService.getSalesSummary('daily');
  }

  @Get('weekly-sales')
  @ApiOperation({ summary: 'Weekly sales summary' })
  weeklySales() {
    return this.analyticsService.getSalesSummary('weekly');
  }

  @Get('monthly-sales')
  @ApiOperation({ summary: 'Monthly sales summary' })
  monthlySales() {
    return this.analyticsService.getSalesSummary('monthly');
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Top selling products' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  topProducts(@Query('limit') limit?: number) {
    return this.analyticsService.getTopProducts(limit ? +limit : 10);
  }

  @Get('revenue-trends')
  @ApiOperation({ summary: 'Revenue trend over last N days' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  revenueTrends(@Query('days') days?: number) {
    return this.analyticsService.getRevenueTrends(days ? +days : 30);
  }

  @Get('payment-breakdown')
  @ApiOperation({ summary: 'Orders and revenue split by payment method' })
  paymentBreakdown() {
    return this.analyticsService.getPaymentBreakdown();
  }

  @Get('clients-per-hour')
  @ApiOperation({ summary: 'Orders per hour for a given date (peak hours report)' })
  @ApiQuery({ name: 'date', required: false, description: 'Date in YYYY-MM-DD format (defaults to today)' })
  clientsPerHour(@Query('date') date?: string) {
    return this.analyticsService.getClientsPerHour(date);
  }
}
