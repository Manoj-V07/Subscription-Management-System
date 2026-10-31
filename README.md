# Brightloop Subscription Management System

Brightloop is a unified subscription-management platform for configuring products and plans, converting quotations into subscriptions, automating recurring billing, recording payments, and reporting revenue.

This repository currently contains the product specification in [`Subscription_Management_System.pdf`](./Subscription_Management_System.pdf) and the implementation documentation under [`docs/`](./docs/).

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

## Product goals

- Replace spreadsheet-based subscription tracking with a reliable system of record.
- Automate invoice generation for every due subscription without duplicates or omissions.
- Give admins and staff controlled operational access while keeping customer data private.
- Give customers a self-service portal for subscriptions, invoices, payments, and account recovery.
- Give finance a current view of active subscriptions, collected revenue, outstanding balances, and overdue invoices.
- Keep list and dashboard operations responsive in under two seconds at the expected scale.

## Recommended implementation baseline

The documentation assumes:

- **Frontend:** React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, and a tested component system.
- **Backend:** TypeScript, NestJS or Fastify, REST/JSON API, OpenAPI, background workers, and a transactional service layer.
- **Database:** PostgreSQL with UUID identifiers, foreign keys, constraints, indexes, and migrations.
- **Queue and cache:** Redis-backed job queue for billing, email, and report work; cache only read models that can tolerate short-lived staleness.
- **Object storage:** S3-compatible storage for generated invoice PDFs and exports.
- **Local orchestration:** Docker Compose for PostgreSQL, Redis, API, worker, and frontend.

These are implementation defaults, not hidden requirements. A replacement technology must preserve the documented behaviour, security controls, API contracts, and performance targets.

## Mandatory scope

1. Account registration, unique email, password policy, login, logout, and password reset.
2. Roles for administrator, internal staff, and customer with least-privilege access.
3. Admin-only staff creation.
4. Product catalogue with product type, sales price, cost price, notes, variants, and price adjustments.
5. Plans with daily, weekly, monthly, or yearly billing intervals, quantity minimums, availability dates, and lifecycle options.
6. Quotation templates and quotations with validity periods and product/plan lines.
7. Subscription lifecycle from Draft to Quotation to Confirmed to Active to Closed.
8. Subscription numbers, customer, plan, dates, payment terms, lines, quantities, prices, taxes, and totals.
9. Automated due-invoice generation from active subscriptions, with duplicate and missed-billing protection.
10. Invoice lifecycle Draft to Confirmed to Paid, with cancel/send/print actions.
11. Configurable tax rules and automatic tax calculation.
12. Admin-only discount rules for fixed or percentage discounts, thresholds, validity, usage limits, and product/subscription scope.
13. Payment recording with method, amount, date, note, and invoice allocation.
14. Outstanding and overdue invoice views.
15. Finance dashboard with active subscriptions, revenue, payments, overdue invoices, filters, and summary views.
16. Customer portal restricted to the customer’s own subscriptions and invoices.

## Getting started

The project implementation should follow [`docs/06-build-and-delivery.md`](./docs/06-build-and-delivery.md). The first delivery milestone is documentation approval; application scaffolding should begin only after the API and data-model decisions are accepted.

## Status

**Phase:** Product and engineering documentation  
**Next step:** Approve the documented scope and recommended stack, then scaffold the monorepo and implement Phase 1 from the roadmap.

