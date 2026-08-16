import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PRODUCT_MESSAGES, ResponseHelper } from '@app/common';

@Controller()
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @MessagePattern(PRODUCT_MESSAGES.CATEGORY_CREATE)
  async create(@Payload() createCategoryDto: CreateCategoryDto) {
    const category = await this.categoriesService.create(createCategoryDto);
    return ResponseHelper.success(category, 'Category created');
  }

  @MessagePattern(PRODUCT_MESSAGES.CATEGORY_FIND_ALL)
  async findAll() {
    const result = await this.categoriesService.findAll();
    return ResponseHelper.success(
      result.data,
      'Categories fetched successfully',
      result.meta,
    );
  }

  @MessagePattern(PRODUCT_MESSAGES.CATEGORY_FIND_ONE)
  async findOne(@Payload() data: { id: string }) {
    const category = await this.categoriesService.findOne(data.id);
    return ResponseHelper.success(category, 'Category fetched successfully');
  }

  @MessagePattern(PRODUCT_MESSAGES.CATEGORY_UPDATE)
  async update(@Payload() updateCategoryDto: UpdateCategoryDto) {
    const category = await this.categoriesService.update(
      updateCategoryDto.id,
      updateCategoryDto,
    );
    return ResponseHelper.success(category, 'Category updated successfully');
  }

  @MessagePattern(PRODUCT_MESSAGES.CATEGORY_DELETE)
  async remove(@Payload() data: { id: string }) {
    await this.categoriesService.remove(data.id);
    return ResponseHelper.success(null, 'Category deleted successfully');
  }
}
