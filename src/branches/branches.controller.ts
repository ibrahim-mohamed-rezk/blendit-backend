import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Controller('branches')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BranchesController {
  constructor(private branchesService: BranchesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  findAll() {
    return this.branchesService.findAll();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.branchesService.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.branchesService.remove(id);
  }
}
