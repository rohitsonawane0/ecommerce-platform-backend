# Cart Service

**Type:** TCP Microservice (port 3003)
**Database:** Postgres `cart_db` on port 5435
**Status:** Existing HTTP scaffold -- must be converted to TCP microservice

## Entities

### Cart

| Field     | Type      | Notes                       |
|-----------|-----------|-----------------------------|
| id        | UUID      | Primary key, auto-generated |
| userId    | UUID      | Indexed, one cart per user   |
| createdAt | timestamp | Auto-generated              |
| updatedAt | timestamp | Auto-updated                |
| items     | CartItem[]| OneToMany relation          |

### CartItem

| Field        | Type      | Notes                             |
|--------------|-----------|-----------------------------------|
| id           | UUID      | Primary key, auto-generated       |
| cartId       | UUID      | Foreign key to Cart               |
| cart         | Cart      | ManyToOne relation                |
| productId    | UUID      | Reference to product (no FK -- separate DB) |
| productName  | string    | Denormalized from product-service |
| productPrice | decimal   | Denormalized, price at time of add |
| quantity     | integer   | Minimum 1                         |
| createdAt    | timestamp | Auto-generated                    |

## Features

### Get Cart
- Retrieve cart for authenticated user (by userId from JWT)
- Auto-create empty cart if user has none
- Include all cart items
- Calculate and return cart total (sum of productPrice * quantity)

### Add Item to Cart
- Accept productId and quantity
- Call product-service via TCP to validate product exists and has sufficient stock
- Fetch product name and price from product-service
- If product already in cart, increment quantity instead of duplicating
- Re-validate stock for combined quantity
- Return updated cart

### Update Item Quantity
- Accept cartItem ID and new quantity
- Validate cart item belongs to user's cart
- Call product-service to validate stock for new quantity
- If quantity is 0, remove the item
- Return updated cart

### Remove Item
- Accept cartItem ID
- Validate cart item belongs to user's cart
- Delete the cart item
- Return updated cart

### Clear Cart
- Delete all cart items for user's cart
- Return empty cart

### Cart Total Calculation
- Computed field: sum of (productPrice * quantity) for all items
- Returned with every cart response

## Inter-Service Communication

Cart-service registers a TCP client to product-service for stock validation:

```
Cart Service ──TCP──► Product Service
  │                      │
  │ product.findOne      │ Returns product details (name, price, stock)
  │ product.checkStock   │ Returns { available: boolean, currentStock: number }
```

## Files to Create/Modify

- `apps/cart-service/src/main.ts` -- convert to `createMicroservice` TCP on port 3003
- `apps/cart-service/src/cart-service.module.ts` -- ConfigModule, TypeORM root, TCP client to product-service
- `apps/cart-service/src/cart/entities/cart.entity.ts`
- `apps/cart-service/src/cart/entities/cart-item.entity.ts`
- `apps/cart-service/src/cart/dto/add-to-cart.dto.ts`
- `apps/cart-service/src/cart/dto/update-cart-item.dto.ts`
- `apps/cart-service/src/cart/cart.module.ts`
- `apps/cart-service/src/cart/cart.controller.ts` -- MessagePattern handlers
- `apps/cart-service/src/cart/cart.service.ts`

## Message Patterns

```
CART_MESSAGES.GET_CART       = 'cart.getCart'
CART_MESSAGES.ADD_ITEM       = 'cart.addItem'
CART_MESSAGES.UPDATE_ITEM    = 'cart.updateItem'
CART_MESSAGES.REMOVE_ITEM    = 'cart.removeItem'
CART_MESSAGES.CLEAR_CART     = 'cart.clearCart'
```

## Dependencies

- `typeorm` / `pg` -- Postgres
- `@nestjs/microservices` -- TCP client to product-service
- `class-validator` / `class-transformer` -- DTO validation
