import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { LocalUploadService } from '../common/services/local-upload.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, LocalUploadService],
  exports: [SettingsService],
})
export class SettingsModule {}
