import { Injectable } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Repository } from 'typeorm';

import slugify from 'slugify';
import { RpcException } from '@nestjs/microservices';
import { FindProductsQueryDto } from './dto/find-product-query.dto';
import { Category } from '../categories/entities/category.entity';
import { CategoriesService } from '../categories/categories.service';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private productRepository: Repository<Product>,
    private readonly categoryService: CategoriesService,
  ) {}
  async create(createProductDto: CreateProductDto) {
    let newSlug = this.generateSlug(createProductDto.name);

    const foundBySlug = await this.findBySlug(newSlug);
    if (foundBySlug) {
      newSlug = `${newSlug}-${Date.now()}`;
    }
    if (!createProductDto.categories?.length) {
      createProductDto.categories = [];
    }
    const categories = await this.categoryService.findByIds(
      createProductDto.categories,
    );
    if (categories.length !== createProductDto.categories.length) {
      throw new RpcException({
        statusCode: 400,
        message: 'Some categories not found',
      });
    }
    const product = this.productRepository.create({
      ...createProductDto,
      slug: newSlug,
      categories,
    });

    const saved = await this.productRepository.save(product);

    return this.productRepository.findOne({
      where: { id: saved.id },
      relations: ['categories'],
    });
  }
  private generateSlug(name: string) {
    return slugify(name, {
      replacement: '-', // replace spaces with replacement character, defaults to `-`
      remove: undefined, // remove characters that match regex, defaults to `undefined`
      lower: true, // convert to lower case, defaults to `false`
      strict: false, // strip special characters except replacement, defaults to `false`
      trim: true, // trim leading and trailing replacement chars, defaults to `true`
    });
  }
  private async findBySlug(slug: string) {
    return this.productRepository.findOneBy({ slug });
  }
  async findAll(query: FindProductsQueryDto) {
    const { search, categories, page = 1, limit = 10 } = query;
    const qb = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.categories', 'category');
    if (search) {
      qb.where(
        'product.name ILIKE :search OR product.description ILIKE :search',
        { search: `%${search}%` },
      );
    }
    if (categories) {
      const slugs = categories.split(',');
      qb.andWhere('category.slug IN (:...slugs)', { slugs });
    }
    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('product.createdAt', 'DESC')
      .getManyAndCount();
    return {
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data,
    };
  }

  async findOne(id: string) {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['categories'],
    });
    if (!product) {
      throw new RpcException({ statusCode: 404, message: 'Product not found' });
    }
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const product = await this.findOne(id);

    if (updateProductDto.name && updateProductDto.name !== product.name) {
      updateProductDto.slug = this.generateSlug(updateProductDto.name);
      const existing = await this.findBySlug(updateProductDto.slug);
      if (existing && existing.id !== id) {
        updateProductDto.slug = updateProductDto.slug + `-${Date.now()}`;
      }
    }

    Object.assign(product, updateProductDto);
    return this.productRepository.save(product);
  }

  async remove(id: string) {
    const product = await this.findOne(id);
    if (!product) {
      throw new RpcException({
        statusCode: 400,
        message: 'Product not found',
      });
    }
    await this.productRepository.softDelete(id);
  }
}
