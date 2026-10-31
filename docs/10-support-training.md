# Customer Support & Operations Training Guide

## 1. Overview & Purpose
This guide equips Customer Support (Tier 1 & Tier 2), Customer Success Managers (CSMs), and Billing Operations with the operational knowledge necessary to support customers and internal stakeholders using the Brightloop Subscription Management System.

---

## 2. System Roles & Access Hierarchy

| Role | Target Persona | Key Capabilities | Restricted Capabilities |
|---|---|---|---|
| **admin** | Operations Lead, Financial Controller | Full catalogue management, staff administration, discount rule authoring, billing runs, tax rules, audit inspection | None |
| **staff** | Sales Execs, Account Managers, Support Reps | Quotation builder, customer management, manual payment recording, invoice downloads, viewing subscriptions | Cannot create staff accounts, cannot configure commercial discount rules or system tax tables |
| **customer** | Client Accounts Payable, End Customers | Self-service portal: view personal quotes, subscriptions, and download tax invoice PDFs | Completely isolated from other customers' data; cannot access staff/admin tools |

---

## 3. Support Procedures for Common Customer Inquiries

### Inquiry 1: "I received a quotation. How do I approve and activate my subscription?"
- **Explanation**: Quotations are issued by Brightloop sales staff with itemized product lines, variant adjustments, applicable discounts, and GST.
- **Workflow**:
  1. Staff can open **Sales & Quotations** tab, locate the quote number (e.g. `QT-2026-000101`).
  2. If the customer agreed via email or signature, click **Mark Accepted**.
  3. Click **Convert to Subscription**.
  4. The system atomically locks the pricing breakdown into an immutable subscription record (e.g. `SUB-2026-000101`), sets the start date, and initializes the first billing cycle.

### Inquiry 2: "Where can I find our official GST Tax Invoice PDF?"
- **Workflow**:
  1. Navigate to **Invoices & Billing** tab.
  2. Search for the customer company name or invoice number (e.g. `INV-2026-000101`).
  3. Click **Download PDF**.
  4. The PDF conforms to legal invoice requirements, detailing company GSTIN, taxable subtotal, CGST/SGST/IGST breakdown, payment terms, and bank remittance instructions.

### Inquiry 3: "Our payment was made via bank wire (NEFT/RTGS). Why does the invoice still show balance due?"
- **Explanation**: Bank wires require manual reconciliation or UTR remittance logging.
- **Workflow**:
  1. Go to **Finance & Payments** tab -> **Record Payment**.
  2. Select the customer's invoice from the dropdown. The invoice total and current balance due will populate automatically.
  3. Select Payment Method: `Bank Transfer (NEFT/RTGS/IMPS)`.
  4. Enter the exact received date, amount in INR, and bank reference/UTR number.
  5. Click **Record & Allocate Payment**.
  6. The invoice status transitions from `confirmed` / `partially_paid` to `paid` once the balance due reaches ₹0.00.

### Inquiry 4: "Can we temporarily pause our subscription while our team is away?"
- **Workflow**:
  1. Look up the subscription in the **Subscriptions** tab.
  2. Check if the plan allows pauses (`allow_pause = true`).
  3. Trigger `POST /api/v1/subscriptions/{id}/pause`.
  4. While paused, the scheduled billing engine will skip the subscription during scheduled billing sweeps until resumed.

---

## 4. Support Escalation Matrix & SLAs

| Incident Category | Example Scenario | Triage Tier | Target Response SLA | Target Resolution SLA |
|---|---|---|---|---|
| **P1 - Critical** | Scheduled billing failed for multiple customers; duplicate payment charged | Tier 3 (On-Call SRE / Billing Dev) | < 15 minutes | < 2 hours |
| **P2 - High** | Invoice calculation discrepancy; quotation conversion blocked | Tier 2 (Billing Specialist / Support Lead) | < 1 hour | < 4 hours |
| **P3 - Normal** | Customer request for tax invoice PDF re-send; customer address update | Tier 1 (Support Rep) | < 4 hours | < 24 hours |
| **P4 - Low** | General product enquiry; feature suggestion | Tier 1 (Support Rep) | < 8 hours | < 48 hours |

---

## 5. End-of-Month Finance Reconciliation Checklist
At month-end, the finance controller verifies:
1. All generated invoices have been confirmed and sent.
2. The Finance Dashboard shows `Reconciliation Check: Reconciled`.
3. Total Invoiced equals Revenue Collected plus Amount Outstanding:
   $$\text{Total Invoiced} = \text{Collected} + \text{Owed}$$
4. Download the 3 RFC 4180 audit CSV reports from the application:
   - Invoices Ledger (`btn-export-invoices-csv`)
   - Payments Ledger (`btn-export-payments-csv`)
   - Overdue Aging Report (`btn-export-overdue-csv`)
5. Archive the CSV exports into the company financial compliance vault.

