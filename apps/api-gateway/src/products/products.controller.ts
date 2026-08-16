import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Inject,
  Query,
} from '@nestjs/common';

import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PRODUCT_MESSAGES, PRODUCT_SERVICE, Public } from '@app/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { FindProductsQueryDto } from './dto/find-product-query.dto';

@Public()
@Controller('products')
export class ProductsController {
  constructor(@Inject(PRODUCT_SERVICE) private productClient: ClientProxy) {}

  @Post()
  create(@Body() createProductDto: CreateProductDto) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.CREATE, createProductDto),
    );
  }

  @Get()
  findAll(@Query() query: FindProductsQueryDto) {
    console.log(query);
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.FIND_ALL, query),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.FIND_ONE, { id }),
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.UPDATE, {
        ...updateProductDto,
        id,
      }),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.DELETE, { id }),
    );
  }
}
