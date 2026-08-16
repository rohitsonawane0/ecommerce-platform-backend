# Payment Flow — Frontend Integration Guide

This document describes the **end-to-end checkout + payment flow** for the ecommerce platform. The frontend MUST follow this sequence: **create the order first, capture the returned `orderId`, then call the payment endpoint with that `orderId` and the chosen `paymentMethod`.**

---

## 1. High-Level Sequence

```
User clicks "Place Order"
        │
        ▼
┌──────────────────────┐
│ POST /orders         │  ← creates order in PENDING state, returns orderId
└──────────┬───────────┘
           │ orderId
           ▼
┌──────────────────────┐
│ POST /payments       │  ← uses orderId + paymentMethod to charge
└──────────┬───────────┘
           │ clientSecret (for Stripe) | redirectUrl (for others)
           ▼
┌──────────────────────┐
│ Stripe.js confirm    │  ← frontend confirms with card details
└──────────┬───────────┘
           │
           ▼
   Webhook → backend updates order to PAID
           │
           ▼
   Frontend polls / receives push → show success
```

**Key rule:** never call `/payments` without a valid `orderId`. Never trust the client to mark an order as paid — the backend updates status only via Stripe webhook.

---

## 2. Base URL & Conventions

| Item | Value |
|---|---|
| Base URL | `http://localhost:3000/api/v1` (dev) |
| Auth | `Authorization: Bearer <accessToken>` on every protected route |
| Content-Type | `application/json` |
| Response envelope | All responses wrapped as `{ success, data, message, statusCode }` (`ApiResponse<T>`) |

Errors use standard HTTP status codes; the body still follows the envelope:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Cart is empty",
  "data": null
}
```

---

## 3. Step 1 — Create the Order

### Request

```
POST /api/v1/orders
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "shippingAddress": {
    "fullName": "Jane Doe",
    "line1": "221B Baker Street",
    "line2": "Apt 2",
    "city": "London",
    "state": "Greater London",
    "postalCode": "NW1 6XE",
    "country": "GB",
    "phone": "+447700900123"
  },
  "billingAddress": { /* same shape; optional — defaults to shippingAddress */ },
  "notes": "Leave at the door"
}
```

> The cart is read **server-side** from the authenticated user's cart. The frontend does NOT send line items. This prevents price tampering.

### Response — 201 Created

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Order created",
  "data": {
    "orderId": "ord_01HZX9K2P7Q3M4N5R6S7T8U9V0",
    "status": "PENDING_PAYMENT",
    "subtotal": 4999,
    "shipping": 500,
    "tax": 440,
    "total": 5939,
    "currency": "usd",
    "items": [
      {
        "productId": "prod_abc",
        "name": "Wireless Headphones",
        "quantity": 1,
        "unitPrice": 4999,
        "lineTotal": 4999
      }
    ],
    "expiresAt": "2026-05-09T12:30:00.000Z"
  }
}
```

> All money fields are **integer minor units** (cents). Always render with division by 100 + locale formatting.

### Errors

| Status | Reason | Frontend action |
|---|---|---|
| 400 | `Cart is empty` | Send user back to cart page |
| 400 | `Invalid shipping address` | Highlight the offending field |
| 409 | `Insufficient stock for productId X` | Refresh cart, show stock warning |
| 401 | Token expired | Refresh token, retry once |

### Frontend pseudo-code

```ts
const { data: order } = await api.post('/orders', {
  shippingAddress, billingAddress, notes,
});
const orderId = order.orderId;       // KEEP THIS — required for the next call
```

---

## 4. Step 2 — Initiate Payment

Once `orderId` is in hand, call the payments service. The frontend chooses the `paymentMethod` (the kind of payment instrument), the backend creates the corresponding Stripe object and returns whatever the frontend needs to complete it.

### Request

```
POST /api/v1/payments
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "orderId": "ord_01HZX9K2P7Q3M4N5R6S7T8U9V0",
  "paymentMethod": "card",
  "savePaymentMethod": false,
  "returnUrl": "https://app.example.com/orders/ord_01HZX9.../complete"
}
```

#### Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `orderId` | string | yes | From Step 1 |
| `paymentMethod` | enum | yes | One of: `card`, `apple_pay`, `google_pay`, `paypal`, `klarna`, `link` |
| `savePaymentMethod` | boolean | no | If `true`, attaches the method to the customer for future use |
| `returnUrl` | string (URL) | conditional | Required for redirect-based methods (`paypal`, `klarna`) |

### Response — 200 OK (card / wallets)

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Payment intent created",
  "data": {
    "paymentId": "pay_01HZXA0G2H3J4K5M6N7P8Q9R0S",
    "orderId": "ord_01HZX9K2P7Q3M4N5R6S7T8U9V0",
    "provider": "stripe",
    "clientSecret": "pi_3PXZ...secret_abc123",
    "publishableKey": "pk_test_...",
    "amount": 5939,
    "currency": "usd",
    "status": "REQUIRES_CONFIRMATION"
  }
}
```

### Response — 200 OK (redirect-based: PayPal, Klarna)

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_...",
    "orderId": "ord_...",
    "provider": "stripe",
    "redirectUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
    "status": "REQUIRES_REDIRECT"
  }
}
```

### Errors

| Status | Reason | Frontend action |
|---|---|---|
| 400 | `Order is not in PENDING_PAYMENT state` | Re-fetch order, show its current status |
| 404 | `Order not found` | Send user to orders list |
| 403 | `Order belongs to another user` | Log out, do not retry |
| 409 | `Payment already in progress for this order` | Resume with the existing `paymentId` (call `GET /payments/:id`) |
| 410 | `Order expired` | Tell user to recreate the order |

---

## 5. Step 3 — Confirm Payment on the Client (card / wallets)

Use **Stripe.js** with the `clientSecret` returned above. **Never** send raw card numbers to our backend.

```ts
import { loadStripe } from '@stripe/stripe-js';

const stripe = await loadStripe(publishableKey);

const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
  payment_method: {
    card: cardElement,                       // from Stripe Elements
    billing_details: { name, email },
  },
});

if (error) {
  // Show error.message to the user. Do NOT mark the order failed locally.
  return;
}

if (paymentIntent?.status === 'succeeded') {
  // Payment captured by Stripe — but order status is updated by webhook.
  // Navigate to the success page; that page should poll GET /orders/:id
  // until status === 'PAID' (timeout ~30s) before celebrating.
}
```

For **redirect-based** methods, just `window.location.href = redirectUrl`. Stripe will redirect back to your `returnUrl` after the user finishes.

---

## 6. Step 4 — Confirm the Order Was Paid (server-truth check)

After `confirmCardPayment` succeeds OR after the user is redirected back, the frontend must verify with the backend before showing "Order Confirmed". Stripe webhooks update the order asynchronously — usually in <2s, but never assume.

### Polling endpoint

```
GET /api/v1/orders/:orderId
Authorization: Bearer <accessToken>
```

### Response

```json
{
  "success": true,
  "data": {
    "orderId": "ord_...",
    "status": "PAID",
    "paidAt": "2026-05-09T12:05:11.000Z",
    "paymentId": "pay_...",
    "receiptUrl": "https://pay.stripe.com/receipts/..."
  }
}
```

### Polling strategy

```ts
async function waitForPaid(orderId: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data: order } = await api.get(`/orders/${orderId}`);
    if (order.status === 'PAID') return order;
    if (order.status === 'PAYMENT_FAILED' || order.status === 'CANCELLED') {
      throw new Error(`Payment ${order.status}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Timed out waiting for payment confirmation');
}
```

If polling times out, do **not** show failure — show "Processing… we'll email you when it's confirmed." Webhooks may be delayed under load.

---

## 7. Order & Payment Status Reference

### Order statuses

| Status | Meaning |
|---|---|
| `PENDING_PAYMENT` | Created, awaiting payment intent confirmation |
| `PAID` | Stripe webhook confirmed payment — safe to fulfil |
| `PAYMENT_FAILED` | Stripe reported failure (card declined, etc.) |
| `CANCELLED` | User or system cancelled before payment |
| `REFUNDED` | Full refund issued |
| `PARTIALLY_REFUNDED` | Partial refund issued |
| `FULFILLED` | Shipped to customer |

### Payment statuses

| Status | Meaning |
|---|---|
| `REQUIRES_CONFIRMATION` | Awaiting `stripe.confirmCardPayment` on the client |
| `REQUIRES_REDIRECT` | Send user to `redirectUrl` |
| `REQUIRES_ACTION` | 3D Secure / SCA challenge — Stripe.js handles this automatically |
| `PROCESSING` | Stripe is processing (some methods are async) |
| `SUCCEEDED` | Funds captured |
| `FAILED` | Declined / errored |
| `CANCELLED` | Voided before capture |

---

## 8. Optional — Saved Payment Methods

To reuse a previously saved card (passed `savePaymentMethod: true` on a prior order):

### List saved methods
```
GET /api/v1/payments/methods
```
```json
{
  "data": [
    { "id": "pm_1Q...", "brand": "visa", "last4": "4242", "expMonth": 12, "expYear": 2027 }
  ]
}
```

### Pay with a saved method
Add `paymentMethodId` to the `/payments` request body:
```json
{ "orderId": "...", "paymentMethod": "card", "paymentMethodId": "pm_1Q..." }
```
The response will usually skip `REQUIRES_CONFIRMATION` and go straight to `PROCESSING` or `SUCCEEDED` (no Stripe.js confirm step needed) unless 3DS is required (status `REQUIRES_ACTION` — Stripe.js still handles it via `clientSecret`).

---

## 9. Error Handling Checklist for the Frontend

- [ ] Disable the "Place Order" button between Step 1 and Step 2 to prevent double orders.
- [ ] If Step 2 returns 409 (payment already in progress), call `GET /payments/:paymentId` and resume — do not create a new payment.
- [ ] Always re-fetch order status from the backend after `stripe.confirmCardPayment` — do not trust client state.
- [ ] On any 401, run the token refresh flow once; on second 401, log the user out.
- [ ] Show a single global toast for network errors, not per-field.
- [ ] Money is in **minor units (cents)** everywhere — convert only at the render layer.
- [ ] Never log `clientSecret` to analytics or third-party logs (it can confirm the payment).

---

## 10. Quick End-to-End Example

```ts
async function checkout({ shippingAddress, paymentMethod, cardElement }) {
  // 1) Create order
  const { data: order } = await api.post('/orders', { shippingAddress });

  // 2) Create payment for that order
  const { data: payment } = await api.post('/payments', {
    orderId: order.orderId,
    paymentMethod,
    returnUrl: `${window.location.origin}/orders/${order.orderId}/complete`,
  });

  // 3) Confirm on client (card)
  if (payment.status === 'REQUIRES_CONFIRMATION') {
    const stripe = await loadStripe(payment.publishableKey);
    const { error } = await stripe.confirmCardPayment(payment.clientSecret, {
      payment_method: { card: cardElement },
    });
    if (error) throw new Error(error.message);
  } else if (payment.status === 'REQUIRES_REDIRECT') {
    window.location.href = payment.redirectUrl;
    return;
  }

  // 4) Verify with backend
  const paid = await waitForPaid(order.orderId);
  return paid;
}
```

---

## 11. Endpoint Summary

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/orders` | Create order from current cart, returns `orderId` |
| `GET`  | `/api/v1/orders/:orderId` | Fetch order (use for polling status) |
| `POST` | `/api/v1/payments` | Create payment for an `orderId` + `paymentMethod` |
| `GET`  | `/api/v1/payments/:paymentId` | Fetch payment status (resume in-progress) |
| `GET`  | `/api/v1/payments/methods` | List user's saved payment methods |
| `POST` | `/api/v1/payments/:paymentId/cancel` | Cancel a payment that hasn't succeeded |

All routes require `Authorization: Bearer <accessToken>` unless explicitly marked public.
