# Security and Compliance

## 1. Identity and session security

- Hash passwords with Argon2id or a current equivalent; never log or store plaintext passwords.
- Rate-limit login, registration, and reset endpoints.
- Use short-lived access tokens and rotating, revocable refresh tokens.
- Send reset/verification links with single-use, expiring tokens.
- Use secure, HttpOnly, SameSite cookies when cookies carry session material.
- Require re-authentication or step-up confirmation for sensitive financial/admin actions.

## 2. Authorization and tenant isolation

- Enforce authorization in the API service layer for every read and mutation.
- Scope customer portal queries by the authenticated customer ID, not a client-provided filter alone.
- Enforce admin-only staff creation, tax/discount configuration, and privileged actions.
- Return indistinguishable `404` responses where revealing resource existence would leak data.
- Add automated tests for horizontal and vertical privilege escalation.

## 3. Financial integrity

- Use database transactions for invoice confirmation, payment allocation, discount usage, and state transitions.
- Require idempotency keys for financial commands and provider callbacks.
- Preserve immutable document snapshots and append-only audit events.
- Reconcile invoice totals, allocated payments, and balances with scheduled consistency checks.
- Never delete invoices, payments, or audit events; use cancellation/voiding states.

## 4. Data protection

- Enforce TLS externally and encrypted connections internally where supported.
- Encrypt database backups and object storage; use least-privilege service identities.
- Redact tokens, passwords, payment secrets, and personal data from logs.
- Define retention and deletion policies for users, exports, emails, and audit records.
- Obtain appropriate legal review before claiming PCI DSS, GDPR, tax, or accounting compliance.

## 5. Operational controls

- Centralise secrets in a managed secret store outside source control.
- Scan dependencies, containers, infrastructure, and committed secrets.
- Alert on repeated login failures, privilege changes, billing failures, queue growth, and unusual exports.
- Maintain an incident response process with containment, evidence preservation, notification, and recovery steps.

