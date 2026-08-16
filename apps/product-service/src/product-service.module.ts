import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './products/entities/product.entity';
// import { Category } from './products/entities/category.entity';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { HealthModule } from '@app/common';

@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.PRODUCT_DB_HOST || 'localhost',
      port: parseInt(process.env.PRODUCT_DB_PORT || '5435', 10),
      username: process.env.PRODUCT_DB_USERNAME || 'postgres',
      password: process.env.PRODUCT_DB_PASSWORD || 'postgres',
      database: process.env.PRODUCT_DB_NAME || 'product_db',
      autoLoadEntities: true,
      synchronize: true, // disable in production
    }),
    ProductsModule,
    CategoriesModule,
  ],
})
export class ProductServiceModule {}
