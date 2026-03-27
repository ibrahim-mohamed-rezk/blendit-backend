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
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { SettingsService } from './settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

const customerDisplayUploadDir = join(process.cwd(), 'uploads', 'customer-display');

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('customer-display')
  @ApiOperation({ summary: 'Public: customer display screen (video + copy)' })
  getCustomerDisplay() {
    return this.settingsService.getCustomerDisplayPublic();
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get all settings (store + loyalty)' })
  getAll() {
    return this.settingsService.getAll();
  }

  @Put('store')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  @ApiOperation({ summary: 'Update store settings' })
  updateStore(@Body() dto: UpdateStoreSettingsDto) {
    return this.settingsService.updateStore(dto);
  }

  @Post('customer-display/video')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
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
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(customerDisplayUploadDir)) {
            mkdirSync(customerDisplayUploadDir, { recursive: true });
          }
          cb(null, customerDisplayUploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '') || '.mp4';
          cb(null, `display-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
        },
      }),
    }),
  )
  @ApiOperation({ summary: 'Upload customer display background video (replaces external URL)' })
  async uploadCustomerDisplayVideo(@UploadedFile() file: { filename: string } | undefined) {
    if (!file) throw new BadRequestException('No file uploaded');
    const relativePath = `/uploads/customer-display/${file.filename}`;
    await this.settingsService.setCustomerDisplayVideoUpload(relativePath);
    return { path: relativePath, filename: file.filename };
  }

  @Put('loyalty')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update loyalty settings' })
  updateLoyalty(@Body() dto: UpdateLoyaltySettingsDto) {
    return this.settingsService.updateLoyalty(dto);
  }
}
