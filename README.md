# Brightloop Subscription Management System

Brightloop is a unified subscription-management platform for configuring products and plans, converting quotations into subscriptions, automating recurring billing, recording payments, and reporting revenue.

This repository contains the product specification in [`Subscription_Management_System.pdf`](./Subscription_Management_System.pdf) and the architecture and technical documentation under [`docs/`](./docs/).

## Documentation

| Document | Purpose |
|---|---|
| [Requirements](./docs/01-requirements.md) | Mandatory scope, roles, business rules, acceptance criteria, and prioritised enhancements |
| [UX/UI Requirements](./docs/02-ux-ui-requirements.md) | Information architecture, screens, user journeys, accessibility, and responsive behaviour |
| [Architecture](./docs/03-architecture.md) | Recommended frontend/backend structure, modules, boundaries, and deployment architecture |
| [API Design](./docs/04-api-design.md) | REST conventions, authentication, endpoints, payloads, errors, pagination, and idempotency |
| [Data Model](./docs/05-data-model.md) | Entities, relationships, state machines, invariants, and billing data rules |
| [Build and Delivery Procedure](./docs/06-build-and-delivery.md) | Step-by-step local setup, implementation order, environments, migrations, and deployment |
| [Security and Compliance](./docs/07-security-and-compliance.md) | Security controls, tenant isolation, privacy, auditability, and operational safeguards |
| [Testing and Operations](./docs/08-testing-and-operations.md) | Test strategy, performance targets, observability, backups, and support runbooks |
| [Roadmap](./docs/09-roadmap.md) | Delivery phases, definition of done, and optional differentiating features |

## Status

**Phases Completed:**
- **Phase 0:** Documentation and Architecture Decisions (Complete)
- **Phase 1:** Foundation and Access Control (Complete)
- **Phase 2:** Catalogue and Sales Pipeline (Complete)
- **Phase 3:** Subscription Billing, Invoicing & Delivery (Complete & Certified)

**Next Phase:** Phase 4: Payments and Finance.

---

## Phase 3 Implementation Summary

Phase 3 implements recurring subscription billing, idempotent invoice generation, background billing workers, invoice lifecycle state machines, PDF rendering, email delivery tracking, and resilience testing.

### Key Capabilities

1. **Subscription Lifecycle & Scheduling:**
   - Formal state machine: `draft -> quotation -> confirmed -> active -> closed`, with `active <-> paused` and renewal loops.
   - Endpoints: `POST /api/v1/subscriptions/:id/activate`, `/pause`, `/resume`, `/renew`, `/close`.
   - Precise UTC billing interval calculation for `daily`, `weekly`, `monthly` (with calendar month-end day clamping), and `yearly` (with leap-year preservation).

2. **Idempotent Billing Engine & Worker:**
   - `billing_runs` records execution batches, target dates, processed totals, and error summaries.
   - `billing_occurrences` enforces unique period keys (`sub_${id}:${periodStart}:${periodEnd}`) preventing duplicate invoicing.
   - Automated due-date calculation based on payment terms.
   - Visible failure queue: failed occurrences log `last_error` and can be retried via `POST /api/v1/billing-occurrences/:id/retry`.
   - Standalone background worker process (`apps/worker/index.js`) for daemonized billing sweeps (`npm run worker`).

3. **Invoicing & Delivery Pipeline:**
   - Invoices state machine: `draft -> confirmed -> sent -> partially_paid -> paid -> overdue -> cancelled`.
   - Endpoints: `GET /api/v1/invoices`, `GET /api/v1/invoices/:id`, `POST /api/v1/invoices/:id/confirm`, `POST /api/v1/invoices/:id/send`, `POST /api/v1/invoices/:id/cancel`.
   - Standard PDF 1.4 generation without external binary dependencies via `GET /api/v1/invoices/:id/pdf`.
   - Email dispatch simulator recording delivery logs in `email_notifications`.
   - Strict customer portal data isolation (customers can only view and download their own invoices).

4. **Web Operations UI:**
   - Sales & Quotations Studio with live calculation breakdown.
   - Subscriptions tab with lifecycle actions (`Activate`, `Pause`, `Resume`, `Renew`, `Close`).
   - Invoices & Billing tab with scheduled billing trigger, recent sweeps log, failure queue with retries, and invoice actions (`Confirm`, `Send Email`, `PDF`, `Print`, `Cancel`).

---

## Getting Started

### Local Setup

```powershell
# 1. Install dependencies
npm install

# 2. Run schema migrations and database seed (if PostgreSQL is running)
npm run db:migrate
npm run db:seed

# 3. Build web assets
npm run build

# 4. Start API server
npm start

# 5. (Optional) Run background billing worker daemon
npm run worker
```

The seeded development administrator is `admin@brightloop.example` with password `Admin@12345`.

### Testing

```powershell
# Run the complete test suite (Unit, Integration, and E2E)
npm test

# Run unit tests (Pricing arithmetic, Billing intervals, PDF rendering)
npm run test:unit

# Run integration tests (Catalog, Customers, Sales, Invoices & Billing)
npm run test:integration

# Run Phase 2 & Phase 3 End-to-End certification suites
npm run test:e2e

# Run codebase syntax and lint checks
npm run check
```
