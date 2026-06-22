import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { SettingsService } from './settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentBranch } from '../common/decorators/current-branch.decorator';
import { LocalUploadService } from '../common/services/local-upload.service';
import { Query } from '@nestjs/common';

type UploadedMemoryFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly localUploadService: LocalUploadService,
  ) {}

  @Get('customer-display')
  @ApiOperation({ summary: 'Public: customer display screen (video + copy)' })
  getCustomerDisplay(@Query('branch_id') branchId?: string) {
    const id = branchId ? Number(branchId) : NaN;
    if (!Number.isFinite(id)) throw new BadRequestException('branch_id query param is required');
    return this.settingsService.getCustomerDisplayPublic(id);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'CASHIER')
  @ApiOperation({ summary: 'Get all settings (store + loyalty)' })
  getAll(@CurrentBranch() branchId: number) {
    return this.settingsService.getAll(branchId);
  }

  @Put('store')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  @ApiOperation({ summary: 'Update store settings' })
  updateStore(@Body() dto: UpdateStoreSettingsDto, @CurrentBranch() branchId: number) {
    return this.settingsService.updateStore(branchId, dto);
  }

  @Post('customer-display/video')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 120 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('video/')) {
          cb(new BadRequestException('Only video files are allowed'), false);
          return;
        }
        cb(null, true);
      },
      storage: memoryStorage(),
    }),
  )
  @ApiOperation({ summary: 'Upload customer display background video (replaces external URL)' })
  async uploadCustomerDisplayVideo(
    @UploadedFile() file: UploadedMemoryFile | undefined,
    @CurrentBranch() branchId: number,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const uploaded = await this.localUploadService.saveBuffer(file.buffer, {
      mimetype: file.mimetype,
      originalname: file.originalname,
      subfolder: 'customer-display',
    });
    await this.settingsService.setCustomerDisplayVideoLocalPath(branchId, uploaded.path);
    return { path: uploaded.path, filename: uploaded.filename };
  }

  @Put('loyalty')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, BranchGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update loyalty settings' })
  updateLoyalty(@Body() dto: UpdateLoyaltySettingsDto, @CurrentBranch() branchId: number) {
    return this.settingsService.updateLoyalty(branchId, dto);
  }
}
