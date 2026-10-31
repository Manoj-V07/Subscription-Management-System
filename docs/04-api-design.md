# API Design

## 1. Conventions

- Base URL: `/api/v1`
- JSON request/response bodies.
- ISO-8601 timestamps in UTC.
- Money: `{ "amount": 125000, "currency": "INR" }`.
- UUIDs for resource IDs; human-readable numbers for subscriptions, quotations, and invoices.
- `Authorization: Bearer <access-token>`.
- `Idempotency-Key` required on retryable financial POST operations.
- List responses use `{ "data": [], "pagination": { "page": 1, "pageSize": 25, "total": 0 } }`.
- Sorting uses an allow-listed `sort` field and `direction=asc|desc`.

## 2. Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Register customer account |
| POST | `/auth/verify-email` | Verify a customer email with a single-use token |
| POST | `/auth/login` | Start session |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke current session |
| POST | `/auth/forgot-password` | Request reset email |
| POST | `/auth/reset-password` | Set new password |
| GET | `/auth/me` | Return current user and permissions |

Registration returns a generic success response and sends verification mail. Password reset requests MUST use the same response whether or not the email exists.

## 3. Resource endpoints

| Resource | Endpoints |
|---|---|
| Customers | `GET/POST /customers`, `GET/PATCH /customers/{id}` |
| Products | `GET/POST /products`, `GET/PATCH /products/{id}`, `POST /products/{id}/archive` |
| Variants | `GET/POST /products/{id}/variants`, `PATCH /products/{id}/variants/{variantId}` |
| Plans | `GET/POST /plans`, `GET/PATCH /plans/{id}`, `POST /plans/{id}/archive` |
| Taxes | `GET/POST /tax-rules`, `PATCH /tax-rules/{id}` |
| Discounts | `GET/POST /discount-rules`, `PATCH /discount-rules/{id}` |
| Quote templates | `GET/POST /quotation-templates`, `PATCH /quotation-templates/{id}` |
| Quotations | `GET/POST /quotations`, `GET/PATCH /quotations/{id}`, `POST /quotations/{id}/send`, `POST /quotations/{id}/confirm`, `POST /quotations/{id}/convert` |
| Subscriptions | `GET/POST /subscriptions`, `GET/PATCH /subscriptions/{id}`, `POST /subscriptions/{id}/pause`, `POST /subscriptions/{id}/renew`, `POST /subscriptions/{id}/close` |
| Invoices | `GET /invoices`, `GET /invoices/{id}`, `POST /invoices/{id}/confirm`, `POST /invoices/{id}/send`, `POST /invoices/{id}/cancel`, `GET /invoices/{id}/pdf` |
| Payments | `GET /payments`, `POST /payments`, `POST /payments/{id}/allocate` |
| Reports | `GET /reports/summary`, `GET /reports/revenue`, `GET /reports/overdue-invoices`, `POST /reports/exports` |
| Billing runs | `GET /billing-runs`, `POST /billing-runs`, `GET /billing-runs/{id}` |
| Audit | `GET /audit-events` |

## 4. Example subscription response

```json
{
  "id": "sub_01J...",
  "number": "SUB-2026-000123",
  "status": "active",
  "customer": { "id": "cus_01J...", "name": "Acme Stores" },
  "plan": { "id": "plan_01J...", "name": "Business Monthly", "interval": "month" },
  "startsAt": "2026-11-01T00:00:00Z",
  "expiresAt": null,
  "nextBillingAt": "2026-12-01T00:00:00Z",
  "paymentTermsDays": 15,
  "lines": [
    {
      "productId": "prod_01J...",
      "description": "Business seats",
      "quantity": 10,
      "unitPrice": { "amount": 2500, "currency": "INR" },
      "taxRate": 18,
      "lineTotal": { "amount": 29500, "currency": "INR" }
    }
  ],
  "totals": {
    "subtotal": { "amount": 25000, "currency": "INR" },
    "discount": { "amount": 0, "currency": "INR" },
    "tax": { "amount": 4500, "currency": "INR" },
    "grandTotal": { "amount": 29500, "currency": "INR" },
    "balanceDue": { "amount": 29500, "currency": "INR" }
  }
}
```

## 5. Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": [
      { "field": "password", "code": "PASSWORD_POLICY", "message": "Password does not meet requirements." }
    ],
    "requestId": "req_01J..."
  }
}
```

Use stable codes such as `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`, `BILLING_ALREADY_PROCESSED`, and `INTERNAL_ERROR`. Do not expose stack traces or sensitive fields.

## 6. Billing idempotency

The worker computes a key such as `subscriptionId:billingPeriodStart:billingPeriodEnd`. The database enforces uniqueness on that key. A retried request returns the existing invoice or billing-run result, never a second invoice.

## 7. OpenAPI and versioning

The API MUST publish an OpenAPI document generated from the source contracts. Breaking changes require a new version or a migration period. Contract tests MUST verify documented status codes, schemas, authorization, and error shapes.
