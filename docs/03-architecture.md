# Technical Architecture

## 1. Recommended repository structure

Use a monorepo so shared contracts, validation schemas, and UI primitives remain versioned together.

```text
/
├─ apps/
│  ├─ web/                 # React customer and internal UI
│  ├─ api/                 # HTTP API and authentication
│  └─ worker/              # Billing, email, exports, and scheduled jobs
├─ packages/
│  ├─ contracts/           # OpenAPI-generated types and shared DTO schemas
│  ├─ domain/              # Domain types, state transitions, calculation policies
│  ├─ ui/                  # Shared accessible UI components
│  ├─ config/              # Typed environment/config loading
│  └─ test-utils/          # Fixtures, factories, and test helpers
├─ database/
│  ├─ migrations/
│  └─ seeds/
├─ infra/
│  ├─ docker/
│  └─ deployment/
├─ docs/
└─ package.json
```

## 2. Backend module boundaries

The API SHOULD be organised by business capability rather than technical layer alone:

- `identity`: registration, credentials, sessions, verification, reset.
- `access`: roles, permissions, policy checks, audit context.
- `customers`: customer profiles and portal scoping.
- `catalog`: products, variants, plans, taxes, discounts.
- `sales`: quotation templates, quotations, conversion.
- `subscriptions`: lifecycle, schedules, line snapshots, pause/renew/close.
- `billing`: billing runs, invoice generation, invoice state and delivery.
- `payments`: payment capture/recording and allocation.
- `reporting`: dashboard read models, filters, exports.
- `notifications`: email templates and delivery attempts.
- `audit`: immutable audit events.

Each module owns validation, application services, persistence adapters, and authorization checks. Controllers should remain thin and must not contain pricing or state-transition logic.

## 3. Frontend structure

```text
apps/web/src/
├─ app/                    # router, providers, error boundary
├─ features/
│  ├─ auth/
│  ├─ customers/
│  ├─ catalog/
│  ├─ quotations/
│  ├─ subscriptions/
│  ├─ billing/
│  ├─ payments/
│  └─ reporting/
├─ components/             # shared UI and data display
├─ lib/                    # API client, auth, formatting, permissions
└─ styles/
```

Use server state caching for API data, invalidate queries after mutations, and keep form state local until submission. UI permission checks improve usability but never replace backend authorization.

## 4. Runtime architecture

```text
Browser ──HTTPS──> Web app ──HTTPS──> API ──> PostgreSQL
                                      ├──> Redis/queue ──> Worker
                                      ├──> Object storage
                                      └──> Email/payment providers
```

The worker owns scheduled billing and retries. The API records a billing-run request and returns quickly; it MUST NOT perform hundreds of invoice calculations in a synchronous request.

## 5. Core design decisions

- PostgreSQL transactions protect subscription, invoice, payment, and discount usage invariants.
- Unique constraints provide a final safety net for idempotent billing.
- Decimal arithmetic or integer minor units are mandatory; JavaScript floating-point arithmetic MUST NOT calculate money.
- All external provider calls use an adapter interface and an idempotency key.
- Read-heavy dashboard queries use indexed aggregate queries or refreshable read models.
- Audit events are append-only and include actor, action, entity, before/after summary, request ID, and timestamp.

## 6. Configuration and environments

| Environment | Purpose |
|---|---|
| Local | Docker Compose, seeded demo data, fake email/provider adapters |
| Test/CI | Ephemeral database and Redis, deterministic clock, isolated credentials |
| Staging | Production-like infrastructure, sandbox payment/email providers |
| Production | Managed database, queue, storage, monitoring, backups, secret manager |

Configuration MUST be loaded from environment variables or a secret manager, validated at startup, and never committed.

