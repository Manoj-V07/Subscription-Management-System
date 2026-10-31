# Delivery Roadmap

## Phase 0: Documentation and decisions (Complete)

- Approve mandatory requirements, roles, stack, currency/time policy, and API conventions.
- Confirm organisation/tenant scope and payment-provider strategy.
- Review UX journeys and accessibility baseline.

**Exit:** signed-off requirements and architecture decisions.

## Phase 1: Foundation and access (Complete & Certified)

- Monorepo and CI.
- Database migrations and seed data.
- Identity, sessions, roles, permissions, audit events.
- App shell, navigation, login, registration, reset, and portal shell.

**Exit:** users can securely access the correct role experience. Certified via `tests/e2e/phase1.test.js`.

## Phase 2: Catalogue and sales (Complete & Certified)

- Products, variants, plans, tax rules, discount rules.
- Customers and staff administration.
- Quotation templates, quotation builder, lifecycle, and conversion.

**Exit:** a valid quotation can become a confirmed subscription with a calculation breakdown. Certified via `tests/e2e/phase2.test.js`.

## Phase 3: Subscription billing (Complete & Certified)

- Subscription lifecycle and schedules (activate, pause, resume, renew, close).
- Billing occurrence records and idempotent worker.
- Invoice generation, invoice lifecycle (confirm, send, cancel), PDF generation, email delivery.
- Failure queue with retryability and visibility.

**Exit:** a due subscription produces one correct invoice and failures are retryable/visible. Certified via `tests/e2e/phase3.test.js`.

## Phase 4: Payments and finance (Complete & Certified)

- Payment recording/allocation (multi-method, atomic allocation, overpayment rejection).
- Outstanding and overdue views (aging in calendar days, delinquent balance tracking).
- Finance dashboard, filters, exports (RFC 4180 CSV), and reconciliation checks (`Total Invoiced = Collected + Owed`).

**Exit:** finance can answer active, collected, owed, and overdue questions from the application. Certified via `tests/e2e/phase4.test.js`.

## Phase 5: Hardening and launch (Complete & Certified)

- Performance, accessibility, security, restore, and failure-mode validation.
- Monitoring, alerts, runbooks, support training, and staged rollout.

**Exit:** production readiness checklist is complete. Certified via `tests/e2e/phase5.test.js`, [Production Readiness Checklist](./12-production-readiness-checklist.md), [Operational Runbooks](./runbooks/), [Support Training Guide](./10-support-training.md), and [Staged Rollout Plan](./11-staged-rollout.md).

## Interesting follow-on features

Prioritise based on customer value and payment-provider constraints:

1. Payment-provider checkout and saved payment methods.
2. Dunning automation and configurable grace periods.
3. Proration and plan-change preview.
4. Usage/metered billing.
5. MRR/ARR, churn, cohort, and revenue-recognition reports.
6. Webhooks, public API keys, and integration event replay.
7. Multi-currency, tax jurisdiction integrations, and regional invoice templates.
8. Customer approval workflows for enterprise quotations.

## Definition of done

A feature is complete only when its API contract, authorization policy, database migration, UI states, audit behaviour, automated tests, documentation, observability, and rollback/recovery impact are addressed. Financial features additionally require idempotency and reconciliation coverage.
