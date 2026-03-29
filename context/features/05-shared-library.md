# Shared Library (libs/common)

**Import path:** `@app/common`
**Location:** `libs/common/src/`
**Status:** Exists with auth constants -- needs product/cart constants, types, DTOs

## Updates Required

### Service Name Constants (`constants/services.ts`)

Already has: `AUTH_SERVICE`, `CART_SERVICE`, `PRODUCT_SERVICE`, etc.
No changes needed.

### Message Pattern Constants (`constants/messages.ts`)

Replace existing stub constants with properly structured message patterns:

```typescript
export const AUTH_MESSAGES = {
  REGISTER: 'auth.register',
  LOGIN: 'auth.login',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  ME: 'auth.me',
  FORGOT_PASSWORD: 'auth.forgotPassword',
  RESET_PASSWORD: 'auth.resetPassword',
  VALIDATE_TOKEN: 'auth.validateToken',
};

export const PRODUCT_MESSAGES = {
  CREATE: 'product.create',
  FIND_ALL: 'product.findAll',
  FIND_ONE: 'product.findOne',
  UPDATE: 'product.update',
  REMOVE: 'product.remove',
  CHECK_STOCK: 'product.checkStock',
  DECREMENT_STOCK: 'product.decrementStock',
  INCREMENT_STOCK: 'product.incrementStock',
};

export const CATEGORY_MESSAGES = {
  CREATE: 'category.create',
  FIND_ALL: 'category.findAll',
  FIND_ONE: 'category.findOne',
  UPDATE: 'category.update',
  REMOVE: 'category.remove',
};

export const CART_MESSAGES = {
  GET_CART: 'cart.getCart',
  ADD_ITEM: 'cart.addItem',
  UPDATE_ITEM: 'cart.updateItem',
  REMOVE_ITEM: 'cart.removeItem',
  CLEAR_CART: 'cart.clearCart',
};
```

### Shared Types (`types/`)

```typescript
// types/user-role.enum.ts
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

// types/current-user.interface.ts
export interface ICurrentUser {
  id: string;
  email: string;
  role: UserRole;
}
```

### Shared DTOs (`dto/`)

```typescript
// dto/pagination-query.dto.ts
export class PaginationQueryDto {
  page?: number;    // default 1
  limit?: number;   // default 10, max 100
}

// dto/paginated-response.dto.ts
export class PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

### Re-export from index.ts

Update `libs/common/src/index.ts` to export all new modules:

```typescript
export * from './constants';
export * from './types';
export * from './dto';
```

## Files to Create/Modify

- `libs/common/src/constants/messages.ts` -- rewrite with all message patterns
- `libs/common/src/types/user-role.enum.ts` -- new
- `libs/common/src/types/current-user.interface.ts` -- new
- `libs/common/src/types/index.ts` -- barrel export
- `libs/common/src/dto/pagination-query.dto.ts` -- new
- `libs/common/src/dto/paginated-response.dto.ts` -- new
- `libs/common/src/dto/index.ts` -- barrel export
- `libs/common/src/index.ts` -- update exports
