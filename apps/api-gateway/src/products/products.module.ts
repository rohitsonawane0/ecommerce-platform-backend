import { Module } from '@nestjs/common';

import { ProductsController } from './products.controller';
import { ClientsModule } from '@nestjs/microservices';
import { PRODUCT_SERVICE } from '@app/common';
import { CategoriesController } from './categories/categories.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: PRODUCT_SERVICE,
        options: {
          host: process.env.PRODUCT_SERVICE_HOST || 'localhost',
          port: parseInt(process.env.PRODUCT_SERVICE_PORT || '3002', 10),
        },
      },
    ]),
  ],
  controllers: [ProductsController, CategoriesController],
})
export class ProductsModule {}
