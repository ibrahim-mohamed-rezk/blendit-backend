import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { normalizeWapilotApiToken } from './public/wapilot-config.util';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const wapilotToken =
    normalizeWapilotApiToken(configService.get<string>('WAPILOT_API_TOKEN')) ??
    normalizeWapilotApiToken(configService.get<string>('WAPILOT_API_KEY'));
  if (wapilotToken) {
    console.log(
      `✓ WAPILOT_API_TOKEN loaded (${wapilotToken.length} chars). Default send: POST api.wapilot.net/api/v2/{WAPILOT_INSTANCE_ID}/send-message + token header`,
    );
  } else {
    console.warn(
      '⚠ WAPILOT_API_TOKEN / WAPILOT_API_KEY missing — POST /public/auth/send-otp will return 503 until set in backend/.env.',
    );
  }

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });

  // Global Validation Pipe (forbidNonWhitelisted: false so query params like ?status= work on GET)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Exception Filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global Response Transform Interceptor
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('BLENDiT POS API')
    .setDescription(
      'Production-ready REST API for the BLENDiT juice & smoothie POS ecosystem. ' +
      'Serves the POS system, delivery management, super admin dashboard, and customer display screen.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication & Authorization')
    .addTag('Users', 'User management (RBAC)')
    .addTag('Products', 'Product & category management')
    .addTag('Customers', 'Customer management')
    .addTag('Orders', 'POS order workflow')
    .addTag('Delivery', 'Delivery order management')
    .addTag('Transactions', 'Payment transactions')
    .addTag('Loyalty', 'Customer loyalty points')
    .addTag('Inventory', 'Inventory & stock management')
    .addTag('Activity Logs', 'System activity audit log')
    .addTag('Settings', 'Store and loyalty settings')
    .addTag('Analytics', 'Sales & performance analytics')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port =process.env.PORT  || 7000;
  await app.listen(port, '0.0.0.0');
  console.log(`\n🥤 BLENDiT POS API running on: http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
