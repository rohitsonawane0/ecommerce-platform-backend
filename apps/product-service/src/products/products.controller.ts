import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PRODUCT_MESSAGES, ResponseHelper } from '@app/common';
import { FindProductsQueryDto } from './dto/find-product-query.dto';

@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @MessagePattern(PRODUCT_MESSAGES.CREATE)
  async create(@Payload() createProductDto: CreateProductDto) {
    const product = await this.productsService.create(createProductDto);
    return ResponseHelper.success(product, 'Product created successfully');
  }

  @MessagePattern(PRODUCT_MESSAGES.FIND_ALL)
  async findAll(@Payload() query: FindProductsQueryDto) {
    const products = await this.productsService.findAll(query);
    return ResponseHelper.success(
      products.data,
      'Products fetched successfully',
      products.meta,
    );
  }

  @MessagePattern(PRODUCT_MESSAGES.FIND_ONE)
  async findOne(@Payload() data: { id: string }) {
    const product = await this.productsService.findOne(data.id);
    return ResponseHelper.success(product, 'Product fetched successfully');
  }

  @MessagePattern(PRODUCT_MESSAGES.UPDATE)
  async update(@Payload() updateProductDto: UpdateProductDto) {
    const product = await this.productsService.update(
      updateProductDto.id,
      updateProductDto,
    );
    return ResponseHelper.success(product, 'Product updated successfully');
  }

  @MessagePattern(PRODUCT_MESSAGES.DELETE)
  async remove(@Payload() data: { id: string }) {
    await this.productsService.remove(data.id);
    return ResponseHelper.success(null, 'Product deleted successfully');
  }
}
