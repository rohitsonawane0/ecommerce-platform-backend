# Testing Guide — Ecommerce Platform Backend

> How to write unit tests for your NestJS microservices using Jest + mocked repositories.

---

## Pattern Overview

Every service test follows the same structure:

1. **Create mock repositories** — fake TypeORM `Repository` methods with `jest.fn()`
2. **Build a test module** — use `Test.createTestingModule()` with mock providers
3. **Write tests per method** — test happy path, edge cases, and error cases

---

## Step 1: Mock Repository Helper

Put this at the top of every `*.spec.ts` file. It creates a fake repository with jest-mocked methods matching what your service actually calls.

```ts
import { Repository } from 'typeorm';

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
```

Add more methods (like `createQueryBuilder`) only if the service uses them.

---

## Step 2: Test Module Setup

### ProductsService Example

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { CategoriesService } from '../categories/categories.service';

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
});
```

**Key rules:**
- Use `getRepositoryToken(Entity)` to provide the mock for `@InjectRepository(Entity)`
- For injected services (like `CategoriesService`), provide a partial mock with only the methods you need
- For `@Inject('REDIS_CLIENT')`, use `{ provide: 'REDIS_CLIENT', useValue: mockRedis }`
- For `JwtService`, use `{ provide: JwtService, useValue: mockJwtService }`

### AuthService Example

```ts
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: MockRepository;
  let mockJwtService: Partial<Record<keyof JwtService, jest.Mock>>;
  let mockRedis: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockJwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
      verify: jest.fn(),
      decode: jest.fn(),
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null), // not blacklisted by default
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
});
```

---

## Step 3: Test Data Fixtures

Define reusable test data at the top of the file, outside `describe()`.

### Product fixtures

```ts
import { CreateProductDto } from './dto/create-product.dto';

const createProductDto: CreateProductDto = {
  name: 'Wireless Mouse',
  description: 'Ergonomic wireless mouse',
  price: 29.99,
  stock: 100,
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
```

### Auth fixtures

```ts
import { UserRole } from '@app/common';

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
```

---

## Step 4: Writing Tests

### Pattern: Happy path

```ts
describe('create', () => {
  it('should create a product with auto-generated slug', async () => {
    // Arrange — set up what the mocks return
    productRepository.findOneBy!.mockResolvedValue(null);        // no slug conflict
    categoryService.findByIds!.mockResolvedValue([]);            // no categories
    productRepository.create!.mockReturnValue(savedProduct);     // create returns entity
    productRepository.save!.mockResolvedValue(savedProduct);     // save persists it
    productRepository.findOne!.mockResolvedValue(savedProduct);  // reload with relations

    // Act
    const result = await service.create(createProductDto);

    // Assert
    expect(productRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Wireless Mouse',
        slug: 'wireless-mouse',
        categories: [],
      }),
    );
    expect(productRepository.save).toHaveBeenCalled();
    expect(result).toEqual(savedProduct);
  });
});
```

### Pattern: Error / exception cases

```ts
it('should throw RpcException when product not found', async () => {
  productRepository.findOne!.mockResolvedValue(null);

  await expect(service.findOne('non-existent-id')).rejects.toThrow(
    RpcException,
  );
});
```

For checking the exception details:

```ts
it('should throw 404 with correct message', async () => {
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
```

### Pattern: Verifying what was called

```ts
it('should soft delete the product', async () => {
  productRepository.findOne!.mockResolvedValue(savedProduct);
  productRepository.softDelete!.mockResolvedValue({ affected: 1 });

  await service.remove('uuid-1234');

  expect(productRepository.softDelete).toHaveBeenCalledWith('uuid-1234');
});
```

### Pattern: Conditional logic branches

```ts
it('should append timestamp to slug when slug already exists', async () => {
  // First findOneBy call (slug check) returns existing product
  productRepository.findOneBy!.mockResolvedValue(savedProduct);
  categoryService.findByIds!.mockResolvedValue([]);
  productRepository.create!.mockReturnValue(savedProduct);
  productRepository.save!.mockResolvedValue(savedProduct);
  productRepository.findOne!.mockResolvedValue(savedProduct);

  await service.create(createProductDto);

  expect(productRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      slug: expect.stringMatching(/^wireless-mouse-\d+$/),
    }),
  );
});

it('should throw when some categories not found', async () => {
  productRepository.findOneBy!.mockResolvedValue(null);
  categoryService.findByIds!.mockResolvedValue([]); // returns 0, but DTO has 2

  await expect(
    service.create({ ...createProductDto, categories: ['id-1', 'id-2'] }),
  ).rejects.toThrow(RpcException);
});
```

---

## Step 5: Mocking QueryBuilder (for findAll)

When a service uses `createQueryBuilder`, you need a chainable mock:

```ts
const mockQueryBuilder = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[savedProduct], 1]),
};

// In your beforeEach or individual test:
productRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
```

Then test:

```ts
describe('findAll', () => {
  it('should return paginated products', async () => {
    const result = await service.findAll({ page: 1, limit: 10 });

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
});
```

---

## Test Checklist — What You Need to Write

> Copy-pasteable reference tests for all services are in `context/TEST_REFERENCE.md`.

### ProductsService — 13 tests

| # | Method | Test Case | What to Assert |
| --- | --- | --- | --- |
| 1 | `create` | creates with auto-generated slug | `create` called with correct slug, result matches |
| 2 | `create` | appends timestamp when slug exists | slug matches `/^wireless-mouse-\d+$/` |
| 3 | `create` | works with no categories | `findByIds` called with `[]`, product created |
| 4 | `create` | throws when some categories not found | throws `RpcException` |
| 5 | `findOne` | returns product with categories | `findOne` called with `relations: ['categories']` |
| 6 | `findOne` | throws 404 when not found | throws `RpcException` with statusCode 404 |
| 7 | `findAll` | returns paginated results with defaults | meta has total, page, limit, totalPages |
| 8 | `findAll` | applies search filter | `where` called with ILIKE pattern |
| 9 | `findAll` | filters by category slugs | `andWhere` called with `IN (:...slugs)` |
| 10 | `findAll` | handles empty results | data is `[]`, total is 0 |
| 11 | `update` | updates fields | `save` called, result has new values |
| 12 | `update` | regenerates slug on name change | new slug matches slugified name |
| 13 | `update` | throws 404 for missing product | throws `RpcException` |
| 14 | `remove` | calls softDelete with id | `softDelete` called with correct id |
| 15 | `remove` | throws 404 for missing product | throws `RpcException` |

### AuthService — 14 tests

| # | Method | Test Case | What to Assert |
| --- | --- | --- | --- |
| 1 | `register` | creates user with hashed password | `bcrypt.hash` called with password + 10 rounds |
| 2 | `register` | returns tokens and sanitized user | result has accessToken, refreshToken, user without password |
| 3 | `register` | throws 409 on duplicate email | throws `RpcException` with 409 |
| 4 | `login` | returns tokens on valid credentials | result has both tokens + user |
| 5 | `login` | throws 401 on wrong password | `bcrypt.compare` returns false, throws |
| 6 | `login` | throws 401 on unknown email | `findOne` returns null, throws |
| 7 | `refresh` | issues new tokens and blacklists old | `redis.set` called, returns new token pair |
| 8 | `refresh` | throws 401 on invalid token | `jwtService.verify` throws, rejects |
| 9 | `refresh` | throws 401 on blacklisted token | `redis.get` returns `'1'`, rejects |
| 10 | `logout` | blacklists token in Redis | `redis.set` called, returns success message |
| 11 | `me` | returns sanitized user | no password/resetToken in result |
| 12 | `me` | throws 404 when not found | throws `RpcException` |
| 13 | `forgotPassword` | saves hashed reset token | `save` called with `resetPasswordToken` |
| 14 | `forgotPassword` | returns same message for non-existent user | `save` not called, same message returned |
| 15 | `resetPassword` | updates password and clears token | `save` called with null token/expiry |
| 16 | `resetPassword` | throws 400 on invalid/expired token | queryBuilder returns null, throws |

### CartService — 8 tests

| # | Method | Test Case | What to Assert |
| --- | --- | --- | --- |
| 1 | `create` | creates new cart for user | `create` + `save` called with userId |
| 2 | `create` | returns existing cart if user has one | `create` not called, existing cart returned |
| 3 | `getMyCart` | returns cart with items | `findOne` called with relations, items present |
| 4 | `getMyCart` | throws 404 when not found | throws `RpcException` |
| 5 | `addToCart` | creates cart and adds item with real product data | product client called, cartItem created with real name/price |
| 6 | `addToCart` | throws 404 when product not found | product client returns null data, throws |
| 7 | `removeFromCart` | removes item and returns updated cart | `remove` called, updated cart returned |
| 8 | `removeFromCart` | throws 404 if item doesn't belong to user | different userId on cart, throws |

### Total: 35 tests across 3 services

---

## Mocking bcrypt (for AuthService)

```ts
// At top of file
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

import * as bcrypt from 'bcrypt';

// In a specific test where password should NOT match:
it('should throw on wrong password', async () => {
  (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
  userRepository.findOne!.mockResolvedValue(savedUser);

  await expect(
    service.login({ email: 'john@example.com', password: 'wrong' }),
  ).rejects.toThrow(RpcException);
});
```

---

## Mocking ClientProxy (for CartService calling ProductService)

```ts
import { of } from 'rxjs';

const mockProductClient = {
  send: jest.fn(),
};

// In providers:
{ provide: 'product-service', useValue: mockProductClient }

// In test:
it('should fetch product when adding to cart', async () => {
  mockProductClient.send.mockReturnValue(
    of({ data: { id: 'prod-1', name: 'Mouse', price: 29.99 } }),
  );

  // ... call addToCart ...

  expect(mockProductClient.send).toHaveBeenCalledWith(
    'product.findOne',
    { id: 'prod-1' },
  );
});

// Error case:
it('should throw when product not found', async () => {
  mockProductClient.send.mockReturnValue(of({ data: null }));

  await expect(
    service.addToCart('bad-id', undefined, 1, 'user-1'),
  ).rejects.toThrow(RpcException);
});
```

---

## Running Tests

```bash
# Run all tests
pnpm test

# Run a single spec file
pnpm test -- --testPathPattern=products.service.spec

# Run with coverage
pnpm run test:cov

# Watch mode
pnpm run test:watch
```

---

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Forgetting `!` on mock calls | `productRepository.findOne!.mockResolvedValue(...)` — the `!` is needed because MockRepository marks methods as optional |
| Using `mockReturnValue` for async | Use `mockResolvedValue` for promises, `mockReturnValue` for sync |
| Not resetting mocks | `beforeEach` recreates the module, so mocks are fresh each test. If reusing across tests in same describe, call `jest.clearAllMocks()` |
| Testing implementation not behavior | Don't test that `create` was called before `save`. Test that the *result* is correct and key side effects happened |
| Mocking too much | Only mock external dependencies (DB, Redis, other services). Don't mock private methods of the service you're testing |
