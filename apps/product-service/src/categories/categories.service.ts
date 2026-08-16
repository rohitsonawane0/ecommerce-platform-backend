import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Category } from './entities/category.entity';
import { In, Repository } from 'typeorm';
import slugify from 'slugify';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}
  private generateSlug(name: string) {
    return slugify(name, {
      replacement: '-', // replace spaces with replacement character, defaults to `-`
      remove: undefined, // remove characters that match regex, defaults to `undefined`
      lower: true, // convert to lower case, defaults to `false`
      strict: false, // strip special characters except replacement, defaults to `false`
      trim: true, // trim leading and trailing replacement chars, defaults to `true`
    });
  }
  async create(createCategoryDto: CreateCategoryDto) {
    const isNameused = await this.findByName(createCategoryDto.name);
    if (isNameused) {
      throw new RpcException({
        statusCode: 409,
        error: 'Conflict',
        message: 'Category with this name already exists',
      });
    }
    const newSlug = this.generateSlug(createCategoryDto.name);
    const category = this.categoryRepository.create({
      ...createCategoryDto,
      slug: newSlug,
    });

    return this.categoryRepository.save(category);
  }

  async findByName(name: string) {
    return this.categoryRepository.findOneBy({ name });
  }

  async findAll() {
    const [data, total] = await this.categoryRepository.findAndCount();
    return { meta: { total }, data };
  }

  async findOne(id: string) {
    const category = await this.categoryRepository.findOneBy({ id });
    if (!category) {
      throw new RpcException({
        statusCode: 404,
        message: 'Category not found',
      });
    }
    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    const category = await this.findOne(id);

    if (updateCategoryDto.name && updateCategoryDto.name !== category.name) {
      const existing = await this.findByName(updateCategoryDto.name);
      if (existing && existing.id !== id) {
        throw new RpcException({
          statusCode: 409,
          error: 'Conflict',
          message: 'Category with this name already exists',
        });
      }
      updateCategoryDto.slug = this.generateSlug(updateCategoryDto.name);
    }

    Object.assign(category, updateCategoryDto);
    return this.categoryRepository.save(category);
  }

  async findByIds(params: string[]) {
    return this.categoryRepository.find({
      where: {
        id: In(params),
      },
    });
  }
  async remove(id: string) {
    const category = await this.findOne(id);
    if (!category) {
      throw new RpcException({
        statusCode: 400,
        message: 'Category not found',
      });
    }
    await this.categoryRepository.softDelete(id);
  }
}
