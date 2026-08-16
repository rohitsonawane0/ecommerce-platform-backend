import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Inject,
} from '@nestjs/common';
import { PRODUCT_MESSAGES, PRODUCT_SERVICE, Public } from '@app/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Public()
@Controller('categories')
export class CategoriesController {
  constructor(@Inject(PRODUCT_SERVICE) private productClient: ClientProxy) {}

  @Post()
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.CATEGORY_CREATE, createCategoryDto),
    );
  }

  @Get()
  findAll() {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.CATEGORY_FIND_ALL, {}),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.CATEGORY_FIND_ONE, { id }),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.CATEGORY_UPDATE, { ...updateCategoryDto, id }),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGES.CATEGORY_DELETE, { id }),
    );
  }
}
