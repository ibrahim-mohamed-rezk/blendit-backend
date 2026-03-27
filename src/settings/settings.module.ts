import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { CloudinaryService } from '../common/services/cloudinary.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, CloudinaryService],
  exports: [SettingsService],
})
export class SettingsModule {}
