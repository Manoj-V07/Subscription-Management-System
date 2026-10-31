# Data Model and Business Rules

## 1. Core entities

| Entity | Important fields |
|---|---|
| `users` | id, email, password hash, status, verified at, last login |
| `roles` / `permissions` | role assignments and capability keys |
| `customers` | id, linked user, legal name, contacts, billing address, tax identity |
| `products` | name, type, sales price, cost price, currency, notes, archived at |
| `product_variants` | product, label, adjustment type/value, active dates |
| `plans` | name, interval, interval count, minimum quantity, availability, lifecycle flags |
| `tax_rules` | name, rate, applicability, effective dates |
| `discount_rules` | type, value, threshold, scope, validity, usage limit/count |
| `quotation_templates` / `quotation_template_lines` | reusable plan/product lines and validity days |
| `quotations` / `quotation_lines` | customer, dates, status, price/tax snapshots, totals |
| `subscriptions` / `subscription_lines` | number, customer, plan, lifecycle, schedule, snapshots, totals |
| `billing_occurrences` | subscription, period start/end, idempotency key, invoice, processing status |
| `invoices` / `invoice_lines` | number, customer, subscription, dates, status, snapshots, totals |
| `payments` / `payment_allocations` | method, amount, received date, invoice allocation, reference |
| `audit_events` | actor, action, entity, summary, request ID, timestamp |

Every business table SHOULD include `id`, `created_at`, `updated_at`, and, where appropriate, `created_by`, `updated_by`, and `archived_at`.

## 2. Relationships

- A user MAY own one customer portal profile; a customer MAY have multiple contacts.
- A product has zero or more variants; a plan references one or more products through plan lines.
- A quotation belongs to one customer and can convert once to one subscription.
- A subscription belongs to one customer and one plan and has many lines and invoices.
- An invoice belongs to one customer and usually one subscription; it has many lines and payments through allocations.
- A payment MAY be split across invoices only if the product explicitly supports it.
- A discount application and tax calculation are snapshotted on the affected document.

## 3. State machines

### Quotation

`draft -> sent -> accepted -> converted`  
`draft|sent -> expired`  
`draft|sent -> cancelled`

### Subscription

`draft -> quotation -> confirmed -> active -> closed`  
`active -> paused -> active`  
`active -> renewed -> active`  
`draft|quotation|confirmed -> closed` only with permission and reason.

### Invoice

`draft -> confirmed -> sent -> partially_paid -> paid`  
`confirmed|sent|partially_paid -> overdue` based on due date and balance  
`draft|confirmed|sent -> cancelled` with permission and reason.

Transitions MUST be implemented as explicit commands, not arbitrary status updates. Each transition validates the current state, actor permission, required fields, and side effects.

## 4. Calculation rules

1. Line subtotal = quantity × unit price + variant adjustments.
2. Eligible discount is selected according to scope, threshold, date, and remaining usage.
3. Tax is calculated from the taxable discounted base according to the configured tax policy.
4. Grand total = subtotal - discount + tax.
5. Balance due = grand total - allocated payments - credits.
6. Negative totals, unsupported currencies, excessive payment allocations, and invalid quantities MUST be rejected.
7. Confirmed document line prices, taxes, and discount results are immutable snapshots.

Use a shared calculation service for quotations, subscriptions, previews, and invoices. It MUST return a detailed breakdown suitable for the UI and audit record.

## 5. Indexes and constraints

Recommended constraints include:

- Unique normalized user email.
- Unique product/variant labels within a product.
- Unique quotation, subscription, and invoice numbers per organisation.
- Unique billing occurrence key.
- Foreign keys with deliberate delete behaviour; financial records are never cascaded away.
- Indexes on subscription status/next billing date, invoice status/due date, customer IDs, payment received date, and audit entity/time.

## 6. Time and currency

Store UTC timestamps and an explicit billing timezone on the organisation. Calculate billing dates in that timezone, then persist UTC instants. Store currency and exchange-rate snapshots on every financial document; never recalculate historical documents from current rates.

