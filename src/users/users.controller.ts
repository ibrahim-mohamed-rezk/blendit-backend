import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserBranchesDto } from './dto/set-user-branches.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { BranchGuard } from '../common/guards/branch.guard';
import { BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create new user' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: { id: number; role: { name: string } },
  ) {
    return this.usersService.create(dto, user);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get all users (paginated)' })
  findAll(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: { id: number; role: { name: string } },
    @BranchScopeParam() scope: BranchScope,
  ) {
    return this.usersService.findAll(pagination.page, pagination.limit, user, scope);
  }

  @Get('roles')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get all roles' })
  getRoles() {
    return this.usersService.findAllRoles();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number; role: { name: string } }) {
    return this.usersService.findOne(id, user);
  }

  @Put(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update user' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: { id: number; role: { name: string } },
  ) {
    return this.usersService.update(id, dto, user);
  }

  @Post(':id/branches')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Set branch access for an admin user' })
  setBranches(@Param('id', ParseIntPipe) id: number, @Body() dto: SetUserBranchesDto) {
    return this.usersService.setUserBranches(id, dto.branch_assignments);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Delete user (SUPER_ADMIN only)' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number; role: { name: string } }) {
    return this.usersService.remove(id, user);
  }
}
