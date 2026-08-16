import { Module } from '@nestjs/common';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { AuthModule } from './auth/auth.module';
import { AccessTokenGuard } from '@app/common/guards/access-token.guard';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ProductsModule } from './products/products.module';
// import { CategoriesModule } from './products/categories/categories.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { AddressesModule } from './addresses/addresses.module';
import { HealthModule } from '@app/common';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'jwt-secret' }),
    ProductsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    AddressesModule,
  ],
  controllers: [ApiGatewayController],
  providers: [
    ApiGatewayService,
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
  ],
})
export class ApiGatewayModule {}
