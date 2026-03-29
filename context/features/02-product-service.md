# Product Service

**Type:** TCP Microservice (port 3002)
**Database:** Postgres `product_db` on port 5434
**Status:** Existing HTTP scaffold -- must be converted to TCP microservice

## Entities

### Category

| Field       | Type      | Notes                       |
|-------------|-----------|-----------------------------|
| id          | UUID      | Primary key, auto-generated |
| name        | string    | Unique                      |
| slug        | string    | Unique, auto-generated from name |
| description | string    | Nullable                    |
| createdAt   | timestamp | Auto-generated              |

### Product

| Field       | Type      | Notes                          |
|-------------|-----------|--------------------------------|
| id          | UUID      | Primary key, auto-generated    |
| name        | string    | Indexed                        |
| slug        | string    | Unique, auto-generated from name |
| description | string    | Nullable                       |
| price       | decimal   | Precision 10, scale 2          |
| imageUrl    | string    | Nullable                       |
| stock       | integer   | Default 0, minimum 0           |
| isActive    | boolean   | Default `true`                 |
| categoryId  | UUID      | Foreign key to Category        |
| category    | Category  | ManyToOne relation             |
| createdAt   | timestamp | Auto-generated                 |
| updatedAt   | timestamp | Auto-updated                   |

## Features

### Product CRUD

- **Create product** -- admin only; validate category exists, auto-generate slug
- **Get all products** -- public; supports search, filter, pagination
- **Get product by ID** -- public; includes category relation
- **Update product** -- admin only; partial update
- **Delete product** -- admin only; soft consideration (or hard delete for simplicity)

### Search and Filter

- Search by name or description (case-insensitive `ILIKE`)
- Filter by categoryId
- Filter by price range (minPrice, maxPrice)
- Filter by isActive status
- Combine multiple filters

### Pagination

- Query params: `page` (default 1), `limit` (default 10, max 100)
- Response: `{ data: Product[], meta: { total, page, limit, totalPages } }`

### Category CRUD

- **Create category** -- admin only; auto-generate slug from name
- **Get all categories** -- public
- **Get category by ID** -- public; include product count
- **Update category** -- admin only
- **Delete category** -- admin only; check no products reference it

### Stock Management

- **Get stock** -- returns current stock for a product (used by cart-service)
- **Decrement stock** -- reduce stock by quantity (called when order is placed)
- **Increment stock** -- increase stock (restock or order cancellation)
- **Check stock availability** -- returns boolean for given productId + quantity

## Files to Create/Modify

- `apps/product-service/src/main.ts` -- convert to `createMicroservice` TCP on port 3002
- `apps/product-service/src/product-service.module.ts` -- ConfigModule, TypeORM root
- `apps/product-service/src/products/entities/product.entity.ts`
- `apps/product-service/src/products/dto/create-product.dto.ts`
- `apps/product-service/src/products/dto/update-product.dto.ts`
- `apps/product-service/src/products/dto/query-product.dto.ts` -- search/filter/pagination params
- `apps/product-service/src/products/products.module.ts`
- `apps/product-service/src/products/products.controller.ts` -- MessagePattern handlers
- `apps/product-service/src/products/products.service.ts`
- `apps/product-service/src/categories/entities/category.entity.ts`
- `apps/product-service/src/categories/dto/create-category.dto.ts`
- `apps/product-service/src/categories/dto/update-category.dto.ts`
- `apps/product-service/src/categories/categories.module.ts`
- `apps/product-service/src/categories/categories.controller.ts`
- `apps/product-service/src/categories/categories.service.ts`

## Message Patterns

```
PRODUCT_MESSAGES.CREATE           = 'product.create'
PRODUCT_MESSAGES.FIND_ALL         = 'product.findAll'
PRODUCT_MESSAGES.FIND_ONE         = 'product.findOne'
PRODUCT_MESSAGES.UPDATE           = 'product.update'
PRODUCT_MESSAGES.REMOVE           = 'product.remove'
PRODUCT_MESSAGES.CHECK_STOCK      = 'product.checkStock'
PRODUCT_MESSAGES.DECREMENT_STOCK  = 'product.decrementStock'
PRODUCT_MESSAGES.INCREMENT_STOCK  = 'product.incrementStock'

CATEGORY_MESSAGES.CREATE          = 'category.create'
CATEGORY_MESSAGES.FIND_ALL        = 'category.findAll'
CATEGORY_MESSAGES.FIND_ONE        = 'category.findOne'
CATEGORY_MESSAGES.UPDATE          = 'category.update'
CATEGORY_MESSAGES.REMOVE          = 'category.remove'
```

## Dependencies

- `typeorm` / `pg` -- Postgres
- `class-validator` / `class-transformer` -- DTO validation
