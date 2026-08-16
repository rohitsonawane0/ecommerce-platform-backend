# Cart-Service <-> Product-Service Integration Guide

## Current State

- `cart.service.ts:80` has a hardcoded placeholder: `const foundProduct = { name: 'demo product' }`
- `updateCartItems()` uses default values: `productName = 'test product'`, `productPrice = 100`
- Cart service has no TCP client connection to product-service

## What Needs to Change

### 1. Add PRODUCT_SERVICE TCP Client to CartModule

**File:** `apps/cart-service/src/cart/cart.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PRODUCT_SERVICE } from '@app/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cart, CartItem]),
    ClientsModule.register([
      {
        name: PRODUCT_SERVICE,
        transport: Transport.TCP,
        options: { host: 'localhost', port: 3002 },
      },
    ]),
  ],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
```

### 2. Inject Product Client in CartService

**File:** `apps/cart-service/src/cart/cart.service.ts`

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { PRODUCT_SERVICE, PRODUCT_MESSAGES } from '@app/common';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart) private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem) private readonly cartItemRepository: Repository<CartItem>,
    @Inject(PRODUCT_SERVICE) private readonly productClient: ClientProxy,
  ) {}
```

### 3. Replace Hardcoded Product Lookup in `addToCart()`

**Replace line 80** (`const foundProduct = { name: 'demo product' }`) with:

```ts
// Call product-service to validate product exists and get real data
const productResponse = await firstValueFrom(
  this.productClient.send(PRODUCT_MESSAGES.FIND_ONE, { id: productId }),
);

if (!productResponse?.data) {
  throw new RpcException({
    statusCode: 404,
    message: 'Product not found',
  });
}

const foundProduct = productResponse.data;
```

### 4. Pass Real Product Data to `updateCartItems()`

**Replace the call at line 84** with:

```ts
const updatecartItem = await this.updateCartItems(
  cartId,
  productId,
  quantity,
  foundProduct.name,
  foundProduct.price,
);
```

## Message Flow

```
Cart Service                          Product Service
     |                                      |
     |--- TCP: PRODUCT_MESSAGES.FIND_ONE -->|
     |         { id: productId }            |
     |                                      |
     |<-- { data: { id, name, price } } ----|
     |                                      |
     | (validate product exists)            |
     | (save cart item with real data)      |
```

## Important Notes

- Product-service must be running on port 3002 for this to work
- The product-service `FIND_ONE` handler already wraps the response in `ResponseHelper.success()`, so the product data is at `response.data`
- Consider also calling product-service during `getMyCart()` to return up-to-date prices (prices may change after item was added)
