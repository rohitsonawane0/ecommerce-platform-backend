import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { HealthModule } from '@app/common';
import { buildProductDataSourceOptions } from './data-source';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildProductDataSourceOptions((key) => config.get<string>(key)),
    }),
    ProductsModule,
    CategoriesModule,
  ],
})
export class ProductServiceModule {}
