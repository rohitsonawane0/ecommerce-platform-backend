import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { CategoriesService } from '../categories/categories.service';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { RpcException } from '@nestjs/microservices';

type MockRepository<T extends Record<string, any> = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <
  T extends Record<string, any> = any,
>(): MockRepository<T> => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  findOneBy: jest.fn(),
});

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepository: MockRepository;
  let categoryService: Partial<Record<keyof CategoriesService, jest.Mock>>;
  const createProductDto: CreateProductDto = {
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 29.99,
    stock: 100,
    categories: ['0defca43-daf6-43d4-8716-ec151185a2a9'],
  };

  const savedProduct = {
    id: 'uuid-1234',
    name: 'Wireless Mouse',
    slug: 'wireless-mouse',
    description: 'Ergonomic wireless mouse',
    price: 29.99,
    imageUrl: null,
    stock: 100,
    isActive: true,
    categories: [],
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
    deletedAt: null,
  };
  const productWithCategories = {
    id: 'uuid-1234',
    name: 'Wireless Mouse',
    slug: 'wireless-mouse',
    description: 'Ergonomic wireless mouse',
    price: 29.99,
    imageUrl: null,
    stock: 100,
    isActive: true,
    categories: ['uuid'],
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
    deletedAt: null,
  };
  const category = {
    id: 'dcc3260e-c9fb-44fc-8b34-35c90274ebba',
    name: 'Clothing',
    slug: 'clothing',
    description: 'Men and women apparel',
    createdAt: '2026-04-23T20:17:53.513Z',
    updatedAt: '2026-04-23T20:17:53.513Z',
    deletedAt: null,
  };
  beforeEach(async () => {
    categoryService = {
      findByIds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: createMockRepository(),
        },
        {
          provide: CategoriesService,
          useValue: categoryService,
        },
      ],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
    productRepository = module.get(getRepositoryToken(Product));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    // expect(CategoriesService).toBeDefined();
  });
  describe('create product', () => {
    it('it should create a new product', async () => {
      productRepository.findOneBy!.mockResolvedValue(null);
      categoryService.findByIds!.mockResolvedValue([
        '0defca43-daf6-43d4-8716-ec151185a2a9',
      ]);
      const savedProductWithCategories = {
        ...savedProduct,
        categories: ['uuid'],
      };
      productRepository.create!.mockReturnValue(savedProductWithCategories); // create returns entity
      productRepository.save!.mockResolvedValue(savedProductWithCategories);
      productRepository.findOne!.mockResolvedValue(savedProductWithCategories);
      // Act
      const result = await service.create(createProductDto);

      // Assert
      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Wireless Mouse',
          slug: 'wireless-mouse',
        }),
      );
      expect(productRepository.save).toHaveBeenCalled();
      expect(result).toEqual(savedProductWithCategories);
    });

    it('appends timestamp when slug exists', async () => {
      productRepository.findOneBy!.mockResolvedValue({
        id: 'uuid',
        slug: 'xyz',
      });
      categoryService.findByIds!.mockResolvedValue([
        '0defca43-daf6-43d4-8716-ec151185a2a9',
      ]);
      productRepository.create!.mockReturnValue(savedProduct); // create returns entity
      productRepository.save!.mockResolvedValue(savedProduct);
      productRepository.findOne!.mockResolvedValue(savedProduct);
      // Act
      const result = await service.create(createProductDto);

      // Assert
      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: expect.stringMatching(/^wireless-mouse-\d+$/),
        }),
      );
      expect(productRepository.save).toHaveBeenCalled();
      expect(productRepository.create).toHaveBeenCalled();
    });
    it('works with no categories', async () => {
      productRepository.findOneBy!.mockResolvedValue(null);
      categoryService.findByIds!.mockResolvedValue([]);

      productRepository.create!.mockReturnValue(savedProduct); // create returns entity
      productRepository.save!.mockResolvedValue(savedProduct);
      productRepository.findOne!.mockResolvedValue(savedProduct);
      // Act
      const result = await service.create({
        ...createProductDto,
        categories: [],
      });

      // Assert
      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Wireless Mouse',
          slug: 'wireless-mouse',
        }),
      );
      expect(productRepository.save).toHaveBeenCalled();
      expect(result).toEqual(savedProduct);
    });
    it('throws RpcException when some categories are missing', async () => {
      productRepository.findOneBy!.mockResolvedValue(null);
      categoryService.findByIds!.mockResolvedValue([]);
      await expect(service.create(createProductDto)).rejects.toThrow(
        RpcException,
      );
    });
  });
  describe('it will find a product', () => {
    it('returns product with categories', async () => {
      productRepository.findOne!.mockResolvedValue({
        ...savedProduct,
        categories: [category],
      });
      expect(await service.findOne('uuid-1234')).toMatchObject({
        ...savedProduct,
        categories: [category],
      });
    });
  });
});
