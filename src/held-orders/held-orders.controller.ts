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
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Held Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('held-orders')
export class HeldOrdersController {
  constructor(private readonly heldOrdersService: HeldOrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create held order' })
  create(@Body() dto: CreateHeldOrderDto, @CurrentUser() user: { id: number }) {
    return this.heldOrdersService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all held orders' })
  findAll(@Query('cashierId') cashierId?: string) {
    const cid = cashierId ? parseInt(cashierId, 10) : undefined;
    return this.heldOrdersService.findAll(cid);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get held order by ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.heldOrdersService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete held order' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.heldOrdersService.remove(id);
  }
}
