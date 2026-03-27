import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { ProductsService } from '../products/products.service';
import { CustomersService } from '../customers/customers.service';
import { OrdersService } from '../orders/orders.service';
import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { LoyaltyGiftsService } from '../loyalty/loyalty-gifts.service';
import { LoyaltyTiersService } from '../loyalty/loyalty-tiers.service';

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly customersService: CustomersService,
    private readonly ordersService: OrdersService,
    private readonly loyaltyGiftsService: LoyaltyGiftsService,
    private readonly loyaltyTiersService: LoyaltyTiersService,
  ) {}

  @Get('menu')
  @ApiOperation({ summary: 'Public menu: categories + available products' })
  async getMenu(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    const parsedCategoryId =
      categoryId && categoryId.trim() !== '' ? Number(categoryId) : undefined;
    const categories = await this.productsService.findAllCategories();
    const products = await this.productsService.findAll(
      1,
      200,
      Number.isFinite(parsedCategoryId) ? parsedCategoryId : undefined,
      true,
      search?.trim() || undefined,
    );
    return {
      categories,
      products: products.data,
    };
  }

  @Get('customers/search')
  @ApiOperation({ summary: 'Public customer lookup by phone' })
  async searchCustomerByPhone(@Query('phone') phone?: string) {
    if (!phone?.trim()) {
      throw new BadRequestException('Phone is required');
    }
    try {
      return await this.customersService.searchByPhone(phone.trim());
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  @Post('customers')
  @ApiOperation({ summary: 'Public create or update customer by phone' })
  async createCustomer(@Body() dto: CreateCustomerDto) {
    return this.customersService.upsertByPhone(dto);
  }

  @Get('customers/favorites')
  @ApiOperation({ summary: 'Public customer favorites by phone' })
  async getCustomerFavorites(@Query('phone') phone?: string) {
    if (!phone?.trim()) {
      throw new BadRequestException('Phone is required');
    }
    return this.customersService.getFavoriteProductIdsByPhone(phone.trim());
  }

  @Post('customers/favorites')
  @ApiOperation({ summary: 'Public set customer favorite by phone' })
  async setCustomerFavorite(
    @Body()
    body?: { phone?: string; product_id?: number; is_favorite?: boolean },
  ) {
    const phone = body?.phone?.trim();
    const productId = Number(body?.product_id);
    if (!phone) throw new BadRequestException('Phone is required');
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new BadRequestException('Valid product_id is required');
    }
    return this.customersService.setFavoriteByPhone(
      phone,
      productId,
      Boolean(body?.is_favorite),
    );
  }

  @Post('orders')
  @ApiOperation({ summary: 'Public website order creation' })
  createOrder(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto, undefined, 'PUBLIC');
  }

  @Get('loyalty/gifts')
  @ApiOperation({ summary: 'Public loyalty gifts for website redeem section (synced with POS)' })
  getPublicLoyaltyGifts(@Query('active') active?: string) {
    const activeOnly = active !== 'false';
    return this.loyaltyGiftsService.findAll(activeOnly);
  }

  @Get('loyalty/tiers')
  @ApiOperation({ summary: 'Public membership tiers for website loyalty section' })
  getPublicLoyaltyTiers(@Query('active') active?: string) {
    const activeOnly = active !== 'false';
    return this.loyaltyTiersService.findAll(activeOnly);
  }
}
