# Test Reference — Copy-Pasteable Tests

> Use these as reference after you've written your own tests, or copy-paste as a starting point.

---

## ProductsService — 13 Tests

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { CategoriesService } from '../categories/categories.service';
import { CreateProductDto } from './dto/create-product.dto';

type MockRepository<T extends Record<string, any> = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <
  T extends Record<string, any> = any,
>(): MockRepository<T> => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  findAndCount: jest.fn(),
  softDelete: jest.fn(),
});

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

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepository: MockRepository;
  let categoryService: Partial<Record<keyof CategoriesService, jest.Mock>>;

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
  });

  // ─── CREATE (4 tests) ─────────────────────────────────

  describe('create', () => {
    it('should create a product with auto-generated slug', async () => {
      productRepository.findOneBy!.mockResolvedValue(null);
      categoryService.findByIds!.mockResolvedValue([
        { id: '0defca43-daf6-43d4-8716-ec151185a2a9', name: 'Electronics' },
      ]);
      productRepository.create!.mockReturnValue(savedProduct);
      productRepository.save!.mockResolvedValue(savedProduct);
      productRepository.findOne!.mockResolvedValue(savedProduct);

      const result = await service.create(createProductDto);

      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Wireless Mouse',
          slug: 'wireless-mouse',
        }),
      );
      expect(productRepository.save).toHaveBeenCalled();
      expect(result).toEqual(savedProduct);
    });

    it('should append timestamp to slug when slug already exists', async () => {
      productRepository.findOneBy!.mockResolvedValue(savedProduct);
      categoryService.findByIds!.mockResolvedValue([]);
      productRepository.create!.mockReturnValue(savedProduct);
      productRepository.save!.mockResolvedValue(savedProduct);
      productRepository.findOne!.mockResolvedValue(savedProduct);

      await service.create({ ...createProductDto, categories: [] });

      expect(productRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: expect.stringMatching(/^wireless-mouse-\d+$/),
        }),
      );
    });

    it('should create product with no categories', async () => {
      productRepository.findOneBy!.mockResolvedValue(null);
      categoryService.findByIds!.mockResolvedValue([]);
      productRepository.create!.mockReturnValue(savedProduct);
      productRepository.save!.mockResolvedValue(savedProduct);
      productRepository.findOne!.mockResolvedValue(savedProduct);

      const result = await service.create({
        ...createProductDto,
        categories: [],
      });

      expect(categoryService.findByIds).toHaveBeenCalledWith([]);
      expect(result).toEqual(savedProduct);
    });

    it('should throw when some categories not found', async () => {
      productRepository.findOneBy!.mockResolvedValue(null);
      categoryService.findByIds!.mockResolvedValue([]);

      await expect(
        service.create({
          ...createProductDto,
          categories: ['id-1', 'id-2'],
        }),
      ).rejects.toThrow(RpcException);
    });
  });

  // ─── FIND ONE (2 tests) ───────────────────────────────

  describe('findOne', () => {
    it('should return a product with categories', async () => {
      productRepository.findOne!.mockResolvedValue(savedProduct);

      const result = await service.findOne('uuid-1234');

      expect(productRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-1234' },
        relations: ['categories'],
      });
      expect(result).toEqual(savedProduct);
    });

    it('should throw 404 when product not found', async () => {
      productRepository.findOne!.mockResolvedValue(null);

      try {
        await service.findOne('bad-id');
        fail('Expected RpcException');
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        expect(e.getError()).toEqual({
          statusCode: 404,
          message: 'Product not found',
        });
      }
    });
  });

  // ─── FIND ALL (4 tests, needs QueryBuilder mock) ──────

  describe('findAll', () => {
    let mockQueryBuilder: Record<string, jest.Mock>;

    beforeEach(() => {
      mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[savedProduct], 1]),
      };
      productRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);
    });

    it('should return paginated products with defaults', async () => {
      const result = await service.findAll({});

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.data).toEqual([savedProduct]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('should apply search filter', async () => {
      await service.findAll({ search: 'mouse' });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'product.name ILIKE :search OR product.description ILIKE :search',
        { search: '%mouse%' },
      );
    });

    it('should filter by category slugs', async () => {
      await service.findAll({ categories: 'electronics,peripherals' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'category.slug IN (:...slugs)',
        { slugs: ['electronics', 'peripherals'] },
      );
    });

    it('should handle empty results', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  // ─── UPDATE (3 tests) ─────────────────────────────────

  describe('update', () => {
    it('should update product fields', async () => {
      const updated = { ...savedProduct, description: 'Updated description' };
      productRepository.findOne!.mockResolvedValue(savedProduct);
      productRepository.save!.mockResolvedValue(updated);

      const result = await service.update('uuid-1234', {
        id: 'uuid-1234',
        description: 'Updated description',
      });

      expect(productRepository.save).toHaveBeenCalled();
      expect(result.description).toBe('Updated description');
    });

    it('should regenerate slug when name changes', async () => {
      productRepository.findOne!.mockResolvedValue(savedProduct);
      productRepository.findOneBy!.mockResolvedValue(null);
      productRepository.save!.mockImplementation((entity) =>
        Promise.resolve(entity),
      );

      const result = await service.update('uuid-1234', {
        id: 'uuid-1234',
        name: 'Gaming Keyboard',
      });

      expect(result.slug).toBe('gaming-keyboard');
    });

    it('should throw 404 when updating non-existent product', async () => {
      productRepository.findOne!.mockResolvedValue(null);

      await expect(
        service.update('bad-id', { id: 'bad-id', name: 'New Name' }),
      ).rejects.toThrow(RpcException);
    });
  });

  // ─── REMOVE (2 tests) ─────────────────────────────────

  describe('remove', () => {
    it('should soft delete the product by id', async () => {
      productRepository.findOne!.mockResolvedValue(savedProduct);
      productRepository.softDelete!.mockResolvedValue({ affected: 1 });

      await service.remove('uuid-1234');

      expect(productRepository.softDelete).toHaveBeenCalledWith('uuid-1234');
    });

    it('should throw 404 when removing non-existent product', async () => {
      productRepository.findOne!.mockResolvedValue(null);

      await expect(service.remove('bad-id')).rejects.toThrow(RpcException);
    });
  });
});
```

---

## AuthService — 14 Tests

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { UserRole } from '@app/common';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('mock-reset-token-hex'),
  }),
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue({
      digest: jest.fn().mockReturnValue('hashed-reset-token'),
    }),
  }),
}));

import * as bcrypt from 'bcrypt';

type MockRepository<T extends Record<string, any> = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <
  T extends Record<string, any> = any,
>(): MockRepository<T> => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const registerDto = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  password: 'password123',
};

const savedUser = {
  id: 'uuid-user-1',
  email: 'john@example.com',
  password: '$2b$10$hashedpassword',
  firstName: 'John',
  lastName: 'Doe',
  role: UserRole.USER,
  isEmailVerified: false,
  resetPasswordToken: null,
  resetPasswordExpiry: null,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
};

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: MockRepository;
  let mockJwtService: Partial<Record<keyof JwtService, jest.Mock>>;
  let mockRedis: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockJwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
      verify: jest.fn().mockReturnValue({
        id: 'uuid-user-1',
        email: 'john@example.com',
        role: UserRole.USER,
      }),
      decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 900 }),
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository(),
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── REGISTER (3 tests) ───────────────────────────────

  describe('register', () => {
    it('should create user with hashed password and return tokens', async () => {
      userRepository.findOne!.mockResolvedValue(null);
      userRepository.create!.mockReturnValue(savedUser);
      userRepository.save!.mockResolvedValue(savedUser);

      const result = await service.register(registerDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      expect(result.user).not.toHaveProperty('password');
    });

    it('should return sanitized user without sensitive fields', async () => {
      userRepository.findOne!.mockResolvedValue(null);
      userRepository.create!.mockReturnValue(savedUser);
      userRepository.save!.mockResolvedValue(savedUser);

      const result = await service.register(registerDto);

      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('resetPasswordToken');
      expect(result.user).not.toHaveProperty('resetPasswordExpiry');
      expect(result.user).toHaveProperty('email', 'john@example.com');
    });

    it('should throw 409 when email already exists', async () => {
      userRepository.findOne!.mockResolvedValue(savedUser);

      await expect(service.register(registerDto)).rejects.toThrow(RpcException);

      try {
        await service.register(registerDto);
      } catch (e) {
        expect(e.getError()).toEqual({
          statusCode: 409,
          message: 'Email already exists',
        });
      }
    });
  });

  // ─── LOGIN (3 tests) ──────────────────────────────────

  describe('login', () => {
    it('should return tokens on valid credentials', async () => {
      userRepository.findOne!.mockResolvedValue(savedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.login({
        email: 'john@example.com',
        password: 'password123',
      });

      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      expect(result.user).toHaveProperty('email', 'john@example.com');
    });

    it('should throw 401 on wrong password', async () => {
      userRepository.findOne!.mockResolvedValue(savedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.login({ email: 'john@example.com', password: 'wrong' }),
      ).rejects.toThrow(RpcException);
    });

    it('should throw 401 on unknown email', async () => {
      userRepository.findOne!.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'pass' }),
      ).rejects.toThrow(RpcException);
    });
  });

  // ─── REFRESH (3 tests) ────────────────────────────────

  describe('refresh', () => {
    it('should issue new tokens and blacklist old refresh token', async () => {
      mockJwtService.verify!.mockReturnValue({
        id: 'uuid-user-1',
        email: 'john@example.com',
        role: UserRole.USER,
      });
      mockRedis.get.mockResolvedValue(null); // not blacklisted
      userRepository.findOne!.mockResolvedValue(savedUser);

      const result = await service.refresh('old-refresh-token');

      expect(mockRedis.set).toHaveBeenCalled(); // blacklists old token
      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
    });

    it('should throw 401 on invalid refresh token', async () => {
      mockJwtService.verify!.mockImplementation(() => {
        throw new Error('invalid');
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(RpcException);
    });

    it('should throw 401 on blacklisted refresh token', async () => {
      mockRedis.get.mockResolvedValue('1'); // blacklisted

      await expect(
        service.refresh('blacklisted-token'),
      ).rejects.toThrow(RpcException);
    });
  });

  // ─── LOGOUT (1 test) ──────────────────────────────────

  describe('logout', () => {
    it('should blacklist the access token in Redis', async () => {
      const result = await service.logout('some-access-token');

      expect(mockRedis.set).toHaveBeenCalled();
      expect(result.message).toBe('Logged out successfully');
    });
  });

  // ─── ME (2 tests) ─────────────────────────────────────

  describe('me', () => {
    it('should return sanitized user', async () => {
      userRepository.findOne!.mockResolvedValue(savedUser);

      const result = await service.me('uuid-user-1');

      expect(result).not.toHaveProperty('password');
      expect(result).toHaveProperty('email', 'john@example.com');
    });

    it('should throw 404 when user not found', async () => {
      userRepository.findOne!.mockResolvedValue(null);

      await expect(service.me('bad-id')).rejects.toThrow(RpcException);
    });
  });

  // ─── FORGOT PASSWORD (2 tests) ────────────────────────

  describe('forgotPassword', () => {
    it('should save hashed reset token when user exists', async () => {
      userRepository.findOne!.mockResolvedValue({ ...savedUser });

      const result = await service.forgotPassword({
        email: 'john@example.com',
      });

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          resetPasswordToken: 'hashed-reset-token',
        }),
      );
      expect(result.message).toBe(
        'If the email exists, a reset link has been sent',
      );
    });

    it('should return same message when user does not exist', async () => {
      userRepository.findOne!.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'nobody@example.com',
      });

      expect(userRepository.save).not.toHaveBeenCalled();
      expect(result.message).toBe(
        'If the email exists, a reset link has been sent',
      );
    });
  });

  // ─── RESET PASSWORD (2 tests) ─────────────────────────

  describe('resetPassword', () => {
    it('should update password and clear reset token', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...savedUser }),
      };
      userRepository.createQueryBuilder!.mockReturnValue(mockQb);

      const result = await service.resetPassword({
        token: 'valid-token',
        newPassword: 'newpassword123',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          resetPasswordToken: null,
          resetPasswordExpiry: null,
        }),
      );
      expect(result.message).toBe('Password reset successfully');
    });

    it('should throw 400 on invalid or expired reset token', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      userRepository.createQueryBuilder!.mockReturnValue(mockQb);

      await expect(
        service.resetPassword({
          token: 'expired-token',
          newPassword: 'newpass',
        }),
      ).rejects.toThrow(RpcException);
    });
  });
});
```

---

## CartService — 8 Tests

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { of } from 'rxjs';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { PRODUCT_SERVICE } from '@app/common';

type MockRepository<T extends Record<string, any> = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <
  T extends Record<string, any> = any,
>(): MockRepository<T> => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  findAndCountBy: jest.fn(),
  remove: jest.fn(),
});

const savedCart = {
  id: 'cart-uuid-1',
  userId: 'user-uuid-1',
  items: [],
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
};

const savedCartItem = {
  id: 'item-uuid-1',
  productId: 'prod-uuid-1',
  productName: 'Wireless Mouse',
  productPrice: 29.99,
  quantity: 2,
  cart: savedCart,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
};

describe('CartService', () => {
  let service: CartService;
  let cartRepository: MockRepository;
  let cartItemRepository: MockRepository;
  let mockProductClient: { send: jest.Mock };

  beforeEach(async () => {
    mockProductClient = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: getRepositoryToken(Cart),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CartItem),
          useValue: createMockRepository(),
        },
        {
          provide: PRODUCT_SERVICE,
          useValue: mockProductClient,
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    cartRepository = module.get(getRepositoryToken(Cart));
    cartItemRepository = module.get(getRepositoryToken(CartItem));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── CREATE (2 tests) ─────────────────────────────────

  describe('create', () => {
    it('should create a new cart for user', async () => {
      cartRepository.findOne!.mockResolvedValue(null); // no existing cart
      cartRepository.create!.mockReturnValue(savedCart);
      cartRepository.save!.mockResolvedValue(savedCart);

      const result = await service.create({ userId: 'user-uuid-1' });

      expect(cartRepository.create).toHaveBeenCalledWith({
        userId: 'user-uuid-1',
      });
      expect(result).toEqual(savedCart);
    });

    it('should return existing cart if user already has one', async () => {
      cartRepository.findOne!.mockResolvedValue(savedCart);

      const result = await service.create({ userId: 'user-uuid-1' });

      expect(cartRepository.create).not.toHaveBeenCalled();
      expect(result).toEqual(savedCart);
    });
  });

  // ─── GET MY CART (2 tests) ────────────────────────────

  describe('getMyCart', () => {
    it('should return cart with items', async () => {
      const cartWithItems = { ...savedCart, items: [savedCartItem] };
      cartRepository.findOne!.mockResolvedValue(cartWithItems);

      const result = await service.getMyCart('user-uuid-1');

      expect(cartRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
        relations: ['items'],
      });
      expect(result.items).toHaveLength(1);
    });

    it('should throw 404 when cart not found', async () => {
      cartRepository.findOne!.mockResolvedValue(null);

      await expect(service.getMyCart('bad-user')).rejects.toThrow(
        RpcException,
      );
    });
  });

  // ─── ADD TO CART (2 tests) ────────────────────────────

  describe('addToCart', () => {
    it('should create cart and add item with real product data', async () => {
      // No existing cart — create one
      cartRepository.findOne!
        .mockResolvedValueOnce(null)  // findByUserId returns null
        .mockResolvedValueOnce({ ...savedCart, items: [savedCartItem] }); // final reload
      cartRepository.create!.mockReturnValue(savedCart);
      cartRepository.save!.mockResolvedValue(savedCart);

      // Product service returns real product
      mockProductClient.send.mockReturnValue(
        of({ data: { id: 'prod-uuid-1', name: 'Wireless Mouse', price: 29.99 } }),
      );

      // No existing cart item
      cartItemRepository.findOne!.mockResolvedValue(null);
      cartItemRepository.create!.mockReturnValue(savedCartItem);
      cartItemRepository.save!.mockResolvedValue(savedCartItem);

      const result = await service.addToCart(
        'prod-uuid-1',
        undefined,
        2,
        'user-uuid-1',
      );

      expect(mockProductClient.send).toHaveBeenCalled();
      expect(cartItemRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-uuid-1',
          productName: 'Wireless Mouse',
          productPrice: 29.99,
          quantity: 2,
        }),
      );
    });

    it('should throw 404 when product not found', async () => {
      cartRepository.findOne!.mockResolvedValue(null);
      cartRepository.create!.mockReturnValue(savedCart);
      cartRepository.save!.mockResolvedValue(savedCart);

      mockProductClient.send.mockReturnValue(of({ data: null }));

      await expect(
        service.addToCart('bad-prod', undefined, 1, 'user-uuid-1'),
      ).rejects.toThrow(RpcException);
    });
  });

  // ─── REMOVE FROM CART (2 tests) ───────────────────────

  describe('removeFromCart', () => {
    it('should remove item and return updated cart', async () => {
      cartItemRepository.findOne!.mockResolvedValue(savedCartItem);
      cartItemRepository.remove!.mockResolvedValue(savedCartItem);
      cartRepository.findOne!.mockResolvedValue({ ...savedCart, items: [] });

      const result = await service.removeFromCart({
        cartItemId: 'item-uuid-1',
        userId: 'user-uuid-1',
      });

      expect(cartItemRepository.remove).toHaveBeenCalledWith(savedCartItem);
      expect(result.items).toHaveLength(0);
    });

    it('should throw 404 if item does not belong to user', async () => {
      cartItemRepository.findOne!.mockResolvedValue({
        ...savedCartItem,
        cart: { ...savedCart, userId: 'different-user' },
      });

      await expect(
        service.removeFromCart({
          cartItemId: 'item-uuid-1',
          userId: 'user-uuid-1',
        }),
      ).rejects.toThrow(RpcException);
    });
  });
});
```

---

## Summary

| Service | Tests | Methods Covered |
| --- | --- | --- |
| ProductsService | 13 | create, findOne, findAll, update, remove |
| AuthService | 14 | register, login, refresh, logout, me, forgotPassword, resetPassword |
| CartService | 8 | create, getMyCart, addToCart, removeFromCart |
| **Total** | **35** | |
