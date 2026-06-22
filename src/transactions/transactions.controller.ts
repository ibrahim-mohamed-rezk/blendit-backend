import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch, BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { TransactionsQueryDto } from './dto/transactions-query.dto';

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get transactions (paginated, filtered server-side)' })
  findAll(@Query() query: TransactionsQueryDto, @BranchScopeParam() scope: BranchScope) {
    return this.transactionsService.findAll(query, scope);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @BranchScopeParam() scope: BranchScope) {
    return this.transactionsService.findOne(id, scope);
  }
}
