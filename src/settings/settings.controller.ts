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
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { LocalUploadService } from '../common/services/local-upload.service';

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
      storage: memoryStorage(),
    }),
  )
  @ApiOperation({ summary: 'Upload customer display background video (replaces external URL)' })
  async uploadCustomerDisplayVideo(@UploadedFile() file: UploadedMemoryFile | undefined) {
    if (!file) throw new BadRequestException('No file uploaded');
    const uploaded = await this.localUploadService.saveBuffer(file.buffer, {
      mimetype: file.mimetype,
      originalname: file.originalname,
      subfolder: 'customer-display',
    });
    await this.settingsService.setCustomerDisplayVideoLocalPath(uploaded.path);
    return { path: uploaded.path, filename: uploaded.filename };
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
