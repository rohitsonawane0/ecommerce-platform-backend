# Frontend API Documentation

This document outlines all the available API endpoints in the Ecommerce Platform backend, specifically tailored for frontend integration. All endpoints are prefixed with `/api/v1`.

> **Base URL:** `http://localhost:3000/api/v1`
> **Authentication:** Most endpoints require a Bearer token in the `Authorization` header, formatted as `Authorization: Bearer <access_token>`.

---

## 1. Authentication (`/auth`)

### Register
- **URL:** `POST /auth/register`
- **Access:** Public
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "strongPassword123",
    "firstName": "John",
    "lastName": "Doe"
  }
  ```
- **Returns:** User details and tokens upon successful registration.

### Login
- **URL:** `POST /auth/login`
- **Access:** Public
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "strongPassword123"
  }
  ```
- **Returns:** `{ "accessToken": "...", "refreshToken": "...", "user": { ... } }`

### Get Current User
- **URL:** `GET /auth/me`
- **Access:** Protected (Requires Token)
- **Returns:** The currently authenticated user's details.

### Refresh Token
- **URL:** `POST /auth/refresh`
- **Access:** Public
- **Body:** `{ "refreshToken": "..." }`
- **Returns:** A new `accessToken`.

### Logout
- **URL:** `POST /auth/logout`
- **Access:** Protected (Requires Token)
- **Returns:** Success confirmation.

### Password Management
- **Forgot Password:** `POST /auth/forgot-password` (Public) - Body: `{ "email": "user@example.com" }`
- **Reset Password:** `POST /auth/reset-password` (Public) - Body: `{ "token": "...", "newPassword": "..." }`

---

## 2. Products (`/products`)

### List Products
- **URL:** `GET /products`
- **Access:** Public
- **Query Parameters (Optional):**
  - `search` (string): Search by product name or description.
  - `page` (number): Page number (default: 1).
  - `limit` (number): Items per page (default: 10).
  - `categories` (string): Comma-separated list of category UUIDs.
- **Returns:** Paginated list of products.

### Get Product Details
- **URL:** `GET /products/:id`
- **Access:** Public
- **Returns:** Full details of a single product.

### Admin Product Endpoints (Requires Admin/Elevated Roles)
- **Create:** `POST /products`
- **Update:** `PATCH /products/:id`
- **Delete:** `DELETE /products/:id`
- **Body for Create/Update:**
  ```json
  {
    "name": "Product Name",
    "slug": "product-name", // Optional
    "description": "Product Description", // Optional
    "price": 99.99,
    "imageUrl": "https://...", // Optional
    "stock": 100, // Optional
    "isActive": true, // Optional
    "categories": ["uuid-1", "uuid-2"] // Optional array of Category IDs
  }
  ```

---

## 3. Categories (`/categories`)

### List Categories
- **URL:** `GET /categories`
- **Access:** Public
- **Returns:** List of all available product categories.

### Get Category Details
- **URL:** `GET /categories/:id`
- **Access:** Public
- **Returns:** Single category details.

### Admin Category Endpoints (Requires Admin/Elevated Roles)
- **Create:** `POST /categories`
- **Update:** `PATCH /categories/:id`
- **Delete:** `DELETE /categories/:id`
- **Body for Create/Update:**
  ```json
  {
    "name": "Electronics",
    "description": "Electronic items and gadgets" // Optional
  }
  ```

---

## 4. Shopping Cart (`/cart`)

### Get My Cart
- **URL:** `GET /cart`
- **Access:** Protected (Requires Token)
- **Returns:** The user's active cart along with its line items, total amount, etc.

### Add Item to Cart
- **URL:** `POST /cart/items`
- **Access:** Protected (Requires Token)
- **Body:**
  ```json
  {
    "productId": "uuid-of-product",
    "quantity": 2
  }
  ```
- **Returns:** The updated cart item or cart summary.

### Remove Item from Cart
- **URL:** `DELETE /cart/:id`  *(Note: `:id` is the `cartItemId`, NOT the productId)*
- **Access:** Protected (Requires Token)
- **Returns:** Success confirmation and the updated cart state.

---

## 5. Orders (`/orders`)

### Create Order (Checkout step 1)
- **URL:** `POST /orders`
- **Access:** Protected (Requires Token)
- **Body:** `{}` (The backend automatically pulls items from your active cart)
- **Returns:** The newly created Order object (with status `pending`) and an `id` that you'll use for payment.

### List My Orders
- **URL:** `GET /orders`
- **Access:** Protected (Requires Token)
- **Query Parameters (Optional):** `page`, `limit`
- **Returns:** Paginated list of the user's past and current orders.

### Get Order Details
- **URL:** `GET /orders/:id`
- **Access:** Protected (Requires Token)
- **Returns:** Full order details (items, total amount, status).

### Cancel Order
- **URL:** `POST /orders/:id/cancel`
- **Access:** Protected (Requires Token)
- **Returns:** The canceled order details.

---

## 6. Payments (`/payments`)

### Initialize Payment (Checkout step 2)
- **URL:** `POST /payments`
- **Access:** Protected (Requires Token)
- **Body:**
  ```json
  {
    "orderId": "uuid-of-the-newly-created-order"
  }
  ```
- **Returns:** 
  ```json
  {
    "paymentId": "uuid",
    "clientSecret": "pi_3..._secret_..." // Use this in the Stripe.js element
  }
  ```

### Get Payment Details
- **URL:** `GET /payments/:id`
- **Access:** Protected (Requires Token)
- **Returns:** Details about a specific payment intent.

### Stripe Webhook
- **URL:** `POST /payments/webhook`
- **Access:** Public (Used exclusively by Stripe servers)
- **Description:** Receives webhook events from Stripe to update the backend database once a card is charged successfully. Frontend does not call this endpoint.
