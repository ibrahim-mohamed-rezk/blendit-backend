import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { PaginationDto } from '../common/dto/pagination.dto';

/** Resolve the customer-visibility scope: cashiers only see their own branch's customers. */
function customerViewer(
  user: { role?: { name: string } } | undefined,
  scope: BranchScope,
): { roleName?: string; branchId?: number } {
  return {
    roleName: user?.role?.name,
    branchId: scope.allBranches ? undefined : scope.branchId ?? undefined,
  };
}

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Create customer' })
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all customers (paginated). Cashiers see only their branch.' })
  findAll(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: { role?: { name: string } },
    @BranchScopeParam() scope: BranchScope,
  ) {
    return this.customersService.findAll(pagination.page, pagination.limit, customerViewer(user, scope));
  }

  @Get('search')
  @ApiOperation({ summary: 'Search customer by exact phone' })
  searchByPhone(@Query('phone') phone: string) {
    return this.customersService.searchByPhone(phone);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer by ID' })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { role?: { name: string } },
    @BranchScopeParam() scope: BranchScope,
  ) {
    return this.customersService.findOne(id, customerViewer(user, scope));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete customer (orders remain; customer unlinked)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.remove(id);
  }
}
