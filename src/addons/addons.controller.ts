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
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AddonsService } from './addons.service';
import { CreateAddonDto } from './dto/create-addon.dto';
import { UpdateAddonDto } from './dto/update-addon.dto';

@ApiTags('Addons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addons')
export class AddonsController {
  constructor(private readonly addonsService: AddonsService) {}

  @Get()
  @ApiOperation({ summary: 'List add-ons (admin: all; query activeOnly=false for inactive too)' })
  findAll(@Query('activeOnly') activeOnly?: string) {
    const onlyActive = activeOnly !== 'false';
    return onlyActive ? this.addonsService.findAllActive() : this.addonsService.findAllForAdmin();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create add-on' })
  create(@Body() dto: CreateAddonDto) {
    return this.addonsService.create(dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update add-on' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAddonDto) {
    return this.addonsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete add-on (soft-deactivate if used on past orders)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.addonsService.remove(id);
  }
}
