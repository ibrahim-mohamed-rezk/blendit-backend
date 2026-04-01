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
import { WebsitePhoneAuthService } from './website-phone-auth.service';
import { SendPhoneOtpDto } from './dto/send-phone-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { AddonsService } from '../addons/addons.service';

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly customersService: CustomersService,
    private readonly ordersService: OrdersService,
    private readonly loyaltyGiftsService: LoyaltyGiftsService,
    private readonly loyaltyTiersService: LoyaltyTiersService,
    private readonly websitePhoneAuthService: WebsitePhoneAuthService,
    private readonly addonsService: AddonsService,
  ) {}

  @Get('addons')
  @ApiOperation({ summary: 'Active add-ons for website checkout / POS' })
  getPublicAddons() {
    return this.addonsService.findAllActive();
  }

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

  @Post('auth/send-otp')
  @ApiOperation({ summary: 'Website: send SMS OTP (fallback code 1111 if Twilio missing or fails)' })
  sendPhoneOtp(@Body() dto: SendPhoneOtpDto) {
    return this.websitePhoneAuthService.sendOtp(dto.phone);
  }

  @Post('auth/verify-otp')
  @ApiOperation({ summary: 'Website: verify OTP — sign in or join with name + phone' })
  verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto) {
    return this.websitePhoneAuthService.verifyOtp(dto.phone, dto.code, dto.name);
  }

  @Get('customers/search')
  @ApiOperation({ summary: 'Public customer lookup by phone or email (q or phone)' })
  async searchCustomer(
    @Query('q') q?: string,
    @Query('phone') phone?: string,
  ) {
    const lookup = (q ?? phone)?.trim();
    if (!lookup) {
      throw new BadRequestException('Phone or email is required');
    }
    try {
      return await this.customersService.searchByPhoneOrEmail(lookup);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  @Post('customers/register')
  @ApiOperation({ summary: 'Join club: create account only (fails if phone or email already in use)' })
  async registerCustomer(@Body() dto: CreateCustomerDto) {
    return this.customersService.register(dto);
  }

  @Post('customers')
  @ApiOperation({ summary: 'Public create or update customer by phone (checkout / profile sync)' })
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
