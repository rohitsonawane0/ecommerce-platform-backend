import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { HealthModule } from '@app/common';
import { productDataSourceOptions } from './data-source';

@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot(productDataSourceOptions),
    ProductsModule,
    CategoriesModule,
  ],
})
export class ProductServiceModule {}
