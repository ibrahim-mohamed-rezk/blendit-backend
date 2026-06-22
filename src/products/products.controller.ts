import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { FindAllProductsQueryDto } from './dto/find-all-products-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BranchGuard } from '../common/guards/branch.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentBranch, BranchScopeParam } from '../common/decorators/current-branch.decorator';
import type { BranchScope } from '../common/branch-scope';
import { LocalUploadService } from '../common/services/local-upload.service';

type UploadedMemoryFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BranchGuard)
@Controller('')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly localUploadService: LocalUploadService,
  ) {}

  // --- Categories ---
  @Post('categories')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create category' })
  createCategory(@Body() dto: CreateCategoryDto, @CurrentBranch() branchId: number) {
    return this.productsService.createCategory(dto, branchId);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get all categories' })
  getCategories(@BranchScopeParam() scope: BranchScope) {
    return this.productsService.findAllCategories(scope);
  }

  @Get('categories/:id')
  @ApiOperation({ summary: 'Get category by ID' })
  getCategory(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.productsService.findOneCategory(id, branchId);
  }

  @Put('categories/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update category' })
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.productsService.updateCategory(id, dto, branchId);
  }

  @Delete('categories/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete category' })
  removeCategory(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.productsService.removeCategory(id, branchId);
  }

  @Post('admin/categories/:id/transfer')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Copy category to another branch (super admin)' })
  transferCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body('to_branch_id', ParseIntPipe) toBranchId: number,
    @CurrentBranch() branchId: number,
  ) {
    return this.productsService.transferCategory(id, branchId, toBranchId);
  }

  @Post('admin/categories/copy-all')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Copy all categories from the active branch to another branch (super admin)' })
  copyAllCategories(
    @Body('to_branch_id', ParseIntPipe) toBranchId: number,
    @CurrentBranch() branchId: number,
  ) {
    return this.productsService.copyAllCategories(branchId, toBranchId);
  }

  // --- Products ---
  @Post('products')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create product' })
  create(@Body() dto: CreateProductDto, @CurrentBranch() branchId: number) {
    return this.productsService.create(dto, branchId);
  }

  @Post('products/upload-image')
  @UseGuards(RolesGuard)
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
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
      storage: memoryStorage(),
    }),
  )
  @ApiOperation({ summary: 'Upload product image' })
  async uploadProductImage(@UploadedFile() file: UploadedMemoryFile | undefined) {
    if (!file) throw new BadRequestException('No file uploaded');
    const uploaded = await this.localUploadService.saveBuffer(file.buffer, {
      mimetype: file.mimetype,
      originalname: file.originalname,
      subfolder: 'products',
    });
    return { path: uploaded.path, filename: uploaded.filename };
  }

  @Get('products')
  @ApiOperation({ summary: 'Get all products (paginated)' })
  findAll(@Query() query: FindAllProductsQueryDto, @BranchScopeParam() scope: BranchScope) {
    return this.productsService.findAll(
      scope,
      query.page ?? 1,
      query.limit ?? 10,
      query.categoryId,
      query.available,
      query.search,
      query.updatedAfter,
    );
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Get product by ID' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.productsService.findOne(id, branchId);
  }

  @Put('products/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update product' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @CurrentBranch() branchId: number,
  ) {
    return this.productsService.update(id, dto, branchId);
  }

  @Delete('products/:id')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete product' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.productsService.remove(id, branchId);
  }

  @Post('admin/products/:id/transfer')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Copy product to another branch (super admin)' })
  transferProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body('to_branch_id', ParseIntPipe) toBranchId: number,
    @CurrentBranch() branchId: number,
  ) {
    return this.productsService.transferProduct(id, branchId, toBranchId);
  }

  @Post('admin/products/copy-all')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Copy all products (with categories) from the active branch to another branch (super admin)' })
  copyAllProducts(
    @Body('to_branch_id', ParseIntPipe) toBranchId: number,
    @CurrentBranch() branchId: number,
  ) {
    return this.productsService.copyAllProducts(branchId, toBranchId);
  }
}
