import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HeldOrdersService } from './held-orders.service';
import { CreateHeldOrderDto } from './dto/create-held-order.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Held Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
@Controller('held-orders')
export class HeldOrdersController {
  constructor(private readonly heldOrdersService: HeldOrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create held order' })
  create(
    @Body() dto: CreateHeldOrderDto,
    @CurrentUser() user: { id: number },
    @CurrentBranch() branchId: number,
  ) {
    return this.heldOrdersService.create(dto, user.id, branchId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all held orders' })
  findAll(@CurrentBranch() branchId: number, @Query('cashierId') cashierId?: string) {
    const cid = cashierId ? parseInt(cashierId, 10) : undefined;
    return this.heldOrdersService.findAll(branchId, cid);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get held order by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.heldOrdersService.findOne(id, branchId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete held order' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.heldOrdersService.remove(id, branchId);
  }
}
