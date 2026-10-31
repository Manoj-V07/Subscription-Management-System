# Testing and Operations

## 1. Test pyramid

### Unit and domain tests

Cover password policy, permission policies, money arithmetic, tax and discount eligibility, billing date calculation, state transitions, balance calculation, and idempotency-key generation.

### Integration tests

Use a real PostgreSQL and Redis instance to verify transactions, constraints, migrations, queue retries, invoice generation, payment allocation, and audit events.

### Contract tests

Validate OpenAPI request/response schemas, status codes, pagination, errors, authorization, and backwards compatibility.

### End-to-end tests

Cover registration/reset, admin setup, quote-to-subscription, billing day, payment allocation, overdue reporting, and customer isolation in a browser.

### Non-functional tests

- Load-test dashboard and list queries at the expected thousands-of-subscriptions scale.
- Verify P95 normal queries under two seconds.
- Run accessibility checks and keyboard-only flows.
- Test worker restart, duplicate job delivery, provider timeout, and database connection recovery.

## 2. Observability

Every request and worker job SHOULD include a request/correlation ID. Capture:

- Structured JSON logs with actor, operation, entity, duration, result, and error code.
- Metrics for API latency/error rate, queue depth, billing successes/failures, invoices created, payment allocation failures, and email delivery.
- Traces across API -> database -> queue -> worker -> provider boundaries.
- Dashboards and alerts with actionable thresholds.

## 3. Health and readiness

- Liveness endpoint: process is running.
- Readiness endpoint: required database/queue dependencies are available.
- Worker heartbeat: scheduler and consumers are processing jobs.
- Billing-run status: visible progress, failures, retries, and final outcome.

## 4. Backup and recovery

- Automated encrypted database backups with tested retention.
- Point-in-time recovery where supported.
- Object-storage versioning for invoice PDFs and exports.
- Quarterly restore drill with measured RTO/RPO.
- Document recovery ownership, escalation, and customer communication.

## 5. Operational runbooks

At minimum, document procedures for:

1. Failed billing run: inspect occurrence, retry safely, verify duplicate constraint, notify finance.
2. Invoice mismatch: compare immutable line/tax/discount snapshots and audit events; do not edit paid history.
3. Payment over-allocation: stop allocation, reconcile provider/reference, create approved adjustment.
4. Queue backlog: inspect poison jobs, scale worker, pause scheduler if duplicates could result.
5. Account recovery: verify identity, revoke sessions, reset credentials, record audit event.

