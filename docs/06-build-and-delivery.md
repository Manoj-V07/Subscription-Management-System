# Build and Delivery Procedure

## 1. Prerequisites

- Git
- Node.js LTS and the repository package manager
- Docker Desktop with Compose
- PostgreSQL and Redis available through Compose
- An SMTP or email sandbox account for non-local environments
- Optional payment-provider sandbox credentials

## 2. Bootstrap procedure

Once application scaffolding is added:

```powershell
git clone <repository-url>
Set-Location D:\Odoo-Kochi
Copy-Item .env.example .env
docker compose up -d postgres redis
<package-manager> install
<package-manager> run db:migrate
<package-manager> run db:seed
<package-manager> run dev
```

The actual package-manager commands MUST be recorded in the root package manifest and kept consistent with CI. Startup MUST fail with a clear configuration error when required variables are missing.

## 3. Recommended implementation order

1. Create monorepo, linting, formatting, type checking, environment validation, and CI.
2. Add PostgreSQL migrations, seed data, money/time utilities, and calculation tests.
3. Implement identity, sessions, roles, policies, and audit events.
4. Implement products, variants, plans, taxes, and discounts.
5. Implement customers, quotation templates, quotations, and conversion.
6. Implement subscription state machine and schedule calculation.
7. Implement billing occurrences, worker queue, invoice generation, and retry handling.
8. Implement invoice actions, PDFs, payment recording, and balance updates.
9. Implement internal UI workflows and customer portal.
10. Implement dashboard queries, exports, notifications, and operational tooling.
11. Run security, contract, integration, performance, accessibility, and backup-restore validation.

## 4. Local development

- Run API, web, and worker in separate processes or Compose services.
- Use deterministic seed data with admin, staff, and customer accounts.
- Use a fake email adapter that records messages locally.
- Use a deterministic clock in billing tests.
- Never use production credentials or real customer data locally.

## 5. CI pipeline

Every pull request SHOULD run:

1. Formatting check.
2. ESLint/static analysis.
3. Type check.
4. Unit and domain calculation tests.
5. API contract tests.
6. Database migration test from empty and current schema.
7. Integration tests with PostgreSQL and Redis.
8. Frontend component/accessibility tests.
9. Dependency and secret scanning.
10. Build of deployable artifacts.

Protected branches MUST require green checks and at least one review for changes to billing, permissions, migrations, or financial calculations.

## 6. Deployment procedure

1. Build immutable API, worker, and web artifacts.
2. Run migration in a controlled release step with a backup checkpoint.
3. Deploy API and worker using a rolling strategy.
4. Verify health, queue connectivity, database connectivity, and a read-only smoke flow.
5. Enable scheduled billing only after the worker and idempotency constraints are verified.
6. Monitor error rate, latency, queue depth, billing failures, and invoice creation counts.
7. Roll back application artifacts if needed; use forward-only database migrations unless a tested rollback exists.

## 7. Release checklist

- Mandatory acceptance criteria pass.
- No open critical/high security findings.
- Invoice, payment, tax, discount, and billing retry tests pass.
- Database backup and restore evidence is current.
- OpenAPI and migration notes are published.
- Support team has runbooks for failed billing, duplicate payment reports, and account recovery.

