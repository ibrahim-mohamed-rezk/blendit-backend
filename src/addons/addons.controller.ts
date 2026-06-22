import {
  Body,
  Controller, 
  Delete, 
  Get, 
  Param,
  ParseIntPipe, 
  Post, 
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AddonsService } from './addons.service';
import { CreateAddonDto } from './dto/create-addon.dto';
import { UpdateAddonDto } from './dto/update-addon.dto';

@ApiTags('Addons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
@Controller('addons')
export class AddonsController {
  constructor(private readonly addonsService: AddonsService) {}

  @Get()
  @ApiOperation({ summary: 'List add-ons (admin: all; query activeOnly=false for inactive too)' })
  findAll(@Query('activeOnly') activeOnly?: string, @CurrentBranch() branchId?: number) {
    const onlyActive = activeOnly !== 'false';
    return onlyActive
      ? this.addonsService.findAllActive(branchId!)
      : this.addonsService.findAllForAdmin(branchId!);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create add-on' })
  create(@Body() dto: CreateAddonDto, @CurrentBranch() branchId: number) {
    return this.addonsService.create(dto, branchId);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update add-on' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAddonDto, @CurrentBranch() branchId: number) {
    return this.addonsService.update(id, dto, branchId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete add-on (soft-deactivate if used on past orders)' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.addonsService.remove(id, branchId);
  }
}
