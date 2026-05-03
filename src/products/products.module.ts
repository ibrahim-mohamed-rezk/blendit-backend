import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { LocalUploadService } from '../common/services/local-upload.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, LocalUploadService],
  exports: [ProductsService],
})
export class ProductsModule {}
