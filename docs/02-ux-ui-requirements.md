# UX/UI Requirements

## 1. Experience principles

1. **Operational clarity:** show state, next action, owner, dates, balance, and failure reason without requiring deep navigation.
2. **Safe financial actions:** confirm destructive or irreversible actions, show calculation breakdowns, and provide audit context.
3. **Progressive disclosure:** keep common workflows short while allowing finance and admins to inspect full detail.
4. **Accessible by default:** keyboard-first interaction, readable density, semantic labels, visible focus, and clear empty/error/loading states.
5. **Responsive by role:** internal tables are optimised for desktop/tablet; customer portal remains usable on mobile.

## 2. Information architecture

### Internal application

- Dashboard
- Customers
- Catalogue
  - Products
  - Variants
  - Plans
  - Taxes
  - Discounts
- Sales
  - Quotation templates
  - Quotations
  - Subscriptions
- Billing
  - Invoices
  - Payments
  - Billing runs
- Reports
- Administration
  - Staff and roles
  - Organisation settings
  - Audit log

### Customer portal

- Overview
- My subscriptions
- Subscription detail
- Invoices
- Invoice detail/download
- Payment history
- Profile and security

## 3. Required screens and behaviours

| Screen | Required content and actions |
|---|---|
| Login/register/reset | Validation, password requirements, non-enumerating reset messaging, verification status |
| Dashboard | KPI cards, trends, due/overdue queue, failed billing jobs, quick actions |
| Customer list/detail | Search, filters, status, contact data, subscription/invoice summary, timeline |
| Product editor | Product fields, variants, price adjustment preview, archive action |
| Plan editor | Interval, pricing, quantity minimum, availability, lifecycle controls, tax selection |
| Quotation builder | Template selection, editable lines, tax/discount preview, validity, save/send/convert |
| Subscription detail | Lifecycle timeline, schedule, line snapshot, totals, invoice history, pause/close/renew actions |
| Invoice detail | Header, billing period, lines, tax/discount breakdown, balance, activity, confirm/send/print/cancel |
| Payment form | Invoice lookup, amount validation, method, received date, reference, note, confirmation |
| Finance reports | Filter bar, summary cards, paginated tables, export, saved filters |
| Staff/roles | Admin-only staff creation, role assignment, activation/deactivation |
| Customer portal | Only own records, simple navigation, mobile-friendly documents and payment history |

## 4. Key journeys

### New customer

Register -> validate password -> verify email -> sign in -> view portal overview -> review active subscription/invoices.

### Quote to active subscription

Select customer -> choose template -> review/edit lines -> preview taxes/discounts -> set dates/payment terms -> save quotation -> send -> confirm -> activate.

### Billing day

Worker creates billing run -> operations sees progress and failures -> each due subscription receives one invoice -> invoice is confirmed/sent according to policy -> payment allocation updates balance -> overdue queue updates.

### Finance review

Select date range -> inspect active subscriptions/revenue/outstanding/overdue KPIs -> filter table -> open invoice/customer -> export permitted result.

## 5. UI state requirements

Every data-driven page MUST define:

- Initial loading skeleton or progress indicator.
- Empty state with explanation and a relevant action.
- Inline validation with field-level error text.
- Recoverable API error with retry.
- Permission-denied state without leaking record data.
- Success confirmation after mutations.
- Unsaved changes warning for long forms.

Status labels MUST include text and an icon or pattern; colour alone MUST NOT convey meaning. Destructive actions such as cancel, close, archive, and void require an explicit confirmation modal.

## 6. Design system baseline

- 8px spacing scale and consistent content widths.
- Semantic colour tokens for success, warning, danger, info, and neutral.
- Typography scale with minimum 16px body text on portal screens.
- Reusable data table, filter bar, status badge, money display, date display, empty state, confirmation dialog, and audit timeline components.
- Locale-aware currency and date formatting.
- Print stylesheet for invoices and quotations.

