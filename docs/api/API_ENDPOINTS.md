# API Endpoints

**Base URL:** `http://localhost:3000/api/v1`

## Response Format

All responses follow this structure:

```json
{
  "success": true,
  "message": "Human-readable message",
  "data": {},
  "meta": {}
}
```

| Field     | Type              | Description                                 |
| --------- | ----------------- | ------------------------------------------- |
| `success` | `boolean`         | `true` on success, `false` on error         |
| `message` | `string`          | Descriptive message                         |
| `data`    | `object` / `null` | Response payload                            |
| `meta`    | `object` (opt)    | Metadata (e.g. `{ "total": 10 }` for lists) |

## Authentication

All endpoints require a valid JWT access token via the `Authorization` header unless marked **Public**.

```
Authorization: Bearer <access_token>
```

---

## Auth Endpoints

### POST `/auth/register` — Public

Register a new user.

**Request Body:**

| Field       | Type     | Required | Validation       |
| ----------- | -------- | -------- | ---------------- |
| `email`     | `string` | Yes      | Valid email      |
| `password`  | `string` | Yes      | Min 8 characters |
| `firstName` | `string` | Yes      | Non-empty        |
| `lastName`  | `string` | Yes      | Non-empty        |

```json
{
  "email": "john@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

---

### POST `/auth/login` — Public

Login with email and password. Returns access and refresh tokens.

**Request Body:**

| Field      | Type     | Required | Validation  |
| ---------- | -------- | -------- | ----------- |
| `email`    | `string` | Yes      | Valid email |
| `password` | `string` | Yes      |             |

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

---

### POST `/auth/refresh` — Authenticated

Refresh an expired access token.

**Request Body:**

| Field          | Type     | Required |
| -------------- | -------- | -------- |
| `refreshToken` | `string` | Yes      |

```json
{
  "refreshToken": "<refresh_token>"
}
```

---

### POST `/auth/logout` — Authenticated

Logout the current user. _(Currently not fully implemented)_

---

### GET `/auth/me` — Authenticated

Get the current authenticated user's profile. No request body needed.

---

### POST `/auth/forgot-password` — Public (no auth check on handler, but global guard applies)

Request a password reset email.

**Request Body:**

| Field   | Type     | Required | Validation  |
| ------- | -------- | -------- | ----------- |
| `email` | `string` | Yes      | Valid email |

```json
{
  "email": "john@example.com"
}
```

---

### POST `/auth/reset-password` — Public (no auth check on handler, but global guard applies)

Reset password using the token from the email.

**Request Body:**

| Field         | Type     | Required | Validation       |
| ------------- | -------- | -------- | ---------------- |
| `token`       | `string` | Yes      |                  |
| `newPassword` | `string` | Yes      | Min 8 characters |

```json
{
  "token": "<reset_token>",
  "newPassword": "newpassword123"
}
```

---

## Product Endpoints — All Public

### POST `/products`

Create a new product.

**Request Body:**

| Field         | Type      | Required | Validation                |
| ------------- | --------- | -------- | ------------------------- |
| `name`        | `string`  | Yes      | Non-empty                 |
| `slug`        | `string`  | No       | Auto-generated if omitted |
| `description` | `string`  | No       |                           |
| `price`       | `number`  | Yes      | >= 0                      |
| `imageUrl`    | `string`  | No       | Valid URL                 |
| `stock`       | `number`  | No       | >= 0, defaults to 0       |
| `isActive`    | `boolean` | No       | Defaults to `true`        |

```json
{
  "name": "Wireless Mouse",
  "description": "Ergonomic wireless mouse",
  "price": 29.99,
  "imageUrl": "https://example.com/mouse.jpg",
  "stock": 100,
  "isActive": true
}
```

---

### GET `/products`

Get all products.

**Response `data`:** Array of product objects  
**Response `meta`:** `{ "total": <number> }`

---

### GET `/products/:id`

Get a single product by ID.

**URL Params:**

| Param | Type     | Description  |
| ----- | -------- | ------------ |
| `id`  | `string` | Product UUID |

---

### PATCH `/products/:id`

Update a product. All fields are optional.

**URL Params:**

| Param | Type     | Description  |
| ----- | -------- | ------------ |
| `id`  | `string` | Product UUID |

**Request Body:** Same fields as create, all optional.

```json
{
  "price": 24.99,
  "stock": 50
}
```

---

### DELETE `/products/:id`

Delete a product.

**URL Params:**

| Param | Type     | Description  |
| ----- | -------- | ------------ |
| `id`  | `string` | Product UUID |

---

## Category Endpoints — All Public

### POST `/categories`

Create a new category.

**Request Body:**

| Field         | Type     | Required | Validation                     |
| ------------- | -------- | -------- | ------------------------------ |
| `name`        | `string` | Yes      | Alphabetic only, max 50 chars  |
| `description` | `string` | No       | Alphabetic only, max 250 chars |

```json
{
  "name": "Electronics",
  "description": "Gadgetsanddevices"
}
```

> **Note:** `name` and `description` use `@IsAlpha()` validation, so they only accept letters (no spaces, numbers, or special characters).

---

### GET `/categories`

Get all categories.

**Response `data`:** Array of category objects  
**Response `meta`:** `{ "total": <number> }`

---

### GET `/categories/:id`

Get a single category by ID.

**URL Params:**

| Param | Type     | Description   |
| ----- | -------- | ------------- |
| `id`  | `string` | Category UUID |

---

### PATCH `/categories/:id`

Update a category. All fields are optional.

**URL Params:**

| Param | Type     | Description   |
| ----- | -------- | ------------- |
| `id`  | `string` | Category UUID |

**Request Body:** Same fields as create, all optional.

```json
{
  "name": "Clothing"
}
```

---

### DELETE `/categories/:id`

Delete a category.

**URL Params:**

| Param | Type     | Description   |
| ----- | -------- | ------------- |
| `id`  | `string` | Category UUID |

---

## Cart Endpoints — Authenticated

### POST `/cart/items`

Add an item to the current user's cart.

**Request Body:**

| Field       | Type     | Required |
| ----------- | -------- | -------- |
| `productId` | `string` | Yes      |
| `quantity`  | `number` | Yes      |

---

### GET `/cart`

Get the current user's cart.

---

### DELETE `/cart/:id`

Remove an item from the cart.

**URL Params:**

| Param | Type     | Description    |
| ----- | -------- | -------------- |
| `id`  | `string` | Cart Item UUID |

---

## Order Endpoints — Authenticated

### POST `/orders`

Create a new order from the current cart.

**Request Body:**

| Field               | Type     | Required | Description |
| ------------------- | -------- | -------- | ----------- |
| `shippingAddressId` | `string` | Yes      | UUID of a saved address |
| `billingAddressId`  | `string` | No       | UUID of a saved address |

---

### GET `/orders`

Get the current user's orders (paginated).

**Query Params:** `?page=1&limit=10`

---

### GET `/orders/:id`

Get a specific order by ID.

---

### POST `/orders/:id/cancel`

Cancel a pending order.

---

## Payment Endpoints — Authenticated

### POST `/payments`

Initialize a payment for an order. Returns a Stripe Checkout URL.

**Request Body:**

| Field           | Type     | Required |
| --------------- | -------- | -------- |
| `orderId`       | `string` | Yes      |
| `paymentMethod` | `string` | Yes      |

---

## Address Endpoints — Authenticated

### POST `/addresses`

Create a new address.

**Request Body:**

| Field         | Type     | Required | Notes |
| ------------- | -------- | -------- | ----- |
| `fullName`    | `string` | Yes      |       |
| `phone`       | `string` | Yes      |       |
| `line1`       | `string` | Yes      |       |
| `line2`       | `string` | No       |       |
| `city`        | `string` | Yes      |       |
| `state`       | `string` | Yes      |       |
| `postalCode`  | `string` | Yes      |       |
| `country`     | `string` | Yes      | ISO-2 |
| `isDefaultShipping` | `boolean` | No | |
| `isDefaultBilling`  | `boolean` | No | |

---

### GET `/addresses`

Get all saved addresses for the current user.

---

### GET `/addresses/:id`

Get a specific address by ID.

---

### PATCH `/addresses/:id`

Update a specific address. Same fields as POST, all optional.

---

### DELETE `/addresses/:id`

Delete an address.

---

### POST `/addresses/:id/default`

Set an address as the default for shipping or billing.

**Request Body:**

| Field  | Type     | Required | Notes |
| ------ | -------- | -------- | ----- |
| `type` | `string` | Yes      | `"shipping"` or `"billing"` |

---

## Error Responses

Errors return standard HTTP status codes with this structure:

```json
{
  "success": false,
  "message": "Error description",
  "data": null
}
```

| Status | Meaning               | Example                      |
| ------ | --------------------- | ---------------------------- |
| `400`  | Bad Request           | Validation failed            |
| `401`  | Unauthorized          | Missing or invalid JWT       |
| `404`  | Not Found             | Product/category not found   |
| `409`  | Conflict              | Category name already exists |
| `500`  | Internal Server Error | Unexpected error             |
