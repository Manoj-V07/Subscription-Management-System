# Documentation Guide

This folder is the implementation source of truth for the Brightloop Subscription Management System.

## Reading order

1. [Requirements](./01-requirements.md)
2. [UX/UI Requirements](./02-ux-ui-requirements.md)
3. [Architecture](./03-architecture.md)
4. [API Design](./04-api-design.md)
5. [Data Model](./05-data-model.md)
6. [Build and Delivery Procedure](./06-build-and-delivery.md)
7. [Security and Compliance](./07-security-and-compliance.md)
8. [Testing and Operations](./08-testing-and-operations.md)
9. [Roadmap](./09-roadmap.md)
10. [Support & Operations Training Guide](./10-support-training.md)
11. [Staged Rollout & Launch Plan](./11-staged-rollout.md)
12. [Production Readiness Checklist (Phase 5 Exit)](./12-production-readiness-checklist.md)

### Operational Runbooks

- [Runbook 01: Failed Billing Run Resolution](./runbooks/01-failed-billing-run.md)
- [Runbook 02: Invoice Calculation or Snapshot Mismatch Resolution](./runbooks/02-invoice-mismatch.md)
- [Runbook 03: Payment Over-Allocation & Duplicate Settlement](./runbooks/03-payment-over-allocation.md)
- [Runbook 04: Background Worker Backlog & Queue Stalls](./runbooks/04-worker-queue-backlog.md)
- [Runbook 05: Account Recovery, Credential Compromise & Session Revocation](./runbooks/05-account-recovery-incident.md)
- [Runbook 06: Database Disaster Recovery, Backup Restoration & Integrity Audit](./runbooks/06-database-disaster-recovery.md)

## Document conventions

- **MUST** identifies mandatory product or engineering behaviour.
- **SHOULD** identifies a recommended default that may be changed with an explicit design decision.
- **MAY** identifies an optional enhancement.
- All money values are represented as integer minor units plus an ISO currency code.
- All timestamps are stored in UTC and rendered in the user’s configured timezone.
- API examples use JSON and `/api/v1` as the base path.
