# Product Requirements

## 1. Product summary

Brightloop Software needs one operational system for a subscription business selling monthly and yearly software plans, optional add-ons, and product variants. The system replaces spreadsheets, manual invoices, bank-statement matching, and manually assembled revenue reports.

## 2. Personas and permissions

| Role | Required capabilities |
|---|---|
| Administrator | Full system access; manage staff, products, variants, plans, taxes, discounts, templates, customers, subscriptions, invoices, payments, settings, and reports |
| Internal staff | Day-to-day customer, quotation, subscription, invoice, payment, and report access according to assigned permissions; cannot create staff or change administrator-only configuration |
| Customer | Own profile, own subscriptions, own invoices, payment history, downloads, and permitted subscription actions; no cross-customer visibility |

The implementation SHOULD support permission bundles such as `customers.read`, `subscriptions.manage`, `billing.manage`, `catalog.manage`, and `reports.read`, while retaining the three product-facing roles.

## 3. Functional requirements

### Identity and access

- Registration MUST reject an already-registered email without exposing whether an account exists in a password-reset context.
- Passwords MUST be longer than eight characters and contain uppercase, lowercase, and special characters.
- Login, logout, refresh-token rotation, email verification, and password reset MUST be supported.
- The administrator MUST be the only role allowed to create staff accounts.
- Every protected request MUST enforce role and record-level authorization.

### Catalogue and plans

- An administrator MUST be able to create, edit, archive, and view products with name, type, sales price, cost price, notes, and currency.
- Products MAY have variants such as brand. A variant MUST support a label and a fixed or percentage price adjustment; the example Odoo variant adds 560.
- Plans MUST support daily, weekly, monthly, and yearly intervals, minimum quantity, start/end availability, renewal behaviour, pause behaviour, and early closure.
- Plans and products used by historical invoices MUST be archived rather than deleted.

### Quotes and subscriptions

- Quotation templates MUST provide reusable plan and product lines plus a validity duration.
- A quotation MUST contain a customer, lines, prices, taxes, totals, issue date, expiry date, and status.
- A subscription MUST contain a unique human-readable number, customer, plan, dates, payment terms, lines, taxes, totals, and status.
- Subscription transitions MUST be validated by the state machine in [Data Model](./05-data-model.md).
- The system MUST retain immutable price and tax snapshots on confirmed subscriptions so later catalogue edits do not rewrite history.

### Billing and invoices

- A billing worker MUST identify due active subscriptions and create exactly one invoice for each billing occurrence.
- Invoice generation MUST be safe to retry and MUST use a unique billing-period key.
- Invoices MUST copy customer details, line descriptions, quantities, prices, taxes, discounts, totals, due date, and currency from the subscription snapshot.
- Users MUST be able to confirm, cancel, send, print/download, and view invoices according to permissions.
- Invoice status MUST distinguish draft, confirmed, paid, overdue, partially paid, cancelled, and voided states as needed by implementation.
- An invoice MUST never be silently skipped; failed jobs MUST be visible and retryable.

### Taxes, discounts, and payments

- Tax rules MUST support rate, jurisdiction/label, effective dates, and applicability conditions.
- Discount rules MUST be admin-only and support fixed or percentage values, minimum purchase or quantity, start/end dates, usage limit, and product or subscription scope.
- Eligible discounts MUST be calculated automatically on the next invoice, with an applied-rule snapshot and usage count.
- Payments MUST record invoice, method, amount, currency, received date, external reference, note, and creator.
- Payment allocation MUST prevent overpayment unless an explicit credit-balance feature is enabled.
- Invoice balances MUST be derived from invoice total minus allocated payments and credits.

### Reporting

- The finance dashboard MUST show active subscriptions, revenue collected, amount outstanding, overdue invoices, payment totals, and trend summaries.
- Reports MUST support date range, status, plan, customer, payment method, and currency filters where applicable.
- Large result sets MUST use server-side pagination, filtering, and sorting.
- Export to CSV SHOULD be available for finance tables, with authorization and audit logging.

## 4. Non-functional requirements

- P95 response time for normal list/detail/dashboard queries MUST be below two seconds at the target dataset size.
- Billing processing MUST be idempotent and recoverable after worker restarts.
- Data MUST be encrypted in transit and protected at rest through managed database/storage controls.
- Every privileged mutation MUST create an audit event.
- The UI MUST meet WCAG 2.2 AA fundamentals: keyboard access, focus visibility, labels, contrast, status announcements, and non-colour error communication.
- The system MUST expose structured logs, health checks, metrics, and trace/request IDs.

## 5. Acceptance criteria

The first production-ready release is accepted when:

1. A new customer can register, verify/reset a password, log in, and see only their own portal data.
2. An administrator can configure a product, variant, plan, tax, discount, and staff account.
3. Staff can create a quotation from a template, confirm it, and activate a subscription.
4. A due subscription produces one correct invoice, even if the billing job is retried.
5. The invoice reflects tax and eligible discount rules and can be sent/printed.
6. Payments can be recorded and invoice status/balance updates correctly.
7. Finance can filter dashboard data and identify overdue invoices.
8. Unauthorized role and cross-customer access attempts are denied and audited.

## 6. Optional enhancements

The following are valuable differentiators but MUST NOT delay the mandatory release:

- Customer self-service card payments through a payment-provider adapter.
- Automated email reminders for upcoming, due, and overdue invoices.
- Dunning rules with retry schedules and grace periods.
- Usage-based or metered add-on billing.
- Proration previews for mid-cycle plan changes.
- Webhooks and an outbound integration event log.
- Multi-currency and exchange-rate snapshots.
- Revenue recognition schedules and MRR/ARR/churn/cohort analytics.
- Bulk import/export with validation previews.

