# Runbook 02: Invoice Calculation or Snapshot Mismatch Resolution

## Severity: P2 (Medium)
## Audience: Billing Operations, Finance Controller, Application Engineers

---

### 1. Trigger & Problem Description
- A customer or finance staff member reports that an invoice grand total, line item price, tax calculation, or applied discount does not match the quotation or expected rate.
- An automated audit job detects a checksum or arithmetic discrepancy between an invoice's stored `snapshot_breakdown` JSONB and calculated lines.

---

### 2. Core Financial Safety Invariant
> [!IMPORTANT]
> **NEVER mutate or update an existing confirmed, sent, or paid invoice record.**
> Financial integrity requires append-only immutability. Historical financial records MUST NOT be modified in place. Adjustments MUST be made via formal credit notes, voiding, or supplementary billing.

---

### 3. Investigation Protocol

1. **Extract Immutable Snapshot & Line Items**:
   ```sql
   SELECT 
     i.invoice_number,
     i.status,
     i.subtotal_cents,
     i.discount_cents,
     i.tax_cents,
     i.grand_total_cents,
     i.snapshot_breakdown,
     i.created_at
   FROM invoices i
   WHERE i.invoice_number = '<INVOICE_NUMBER>';
   ```

2. **Inspect Individual Lines**:
   ```sql
   SELECT il.description, il.quantity, il.unit_price_cents, il.variant_adjustment_cents, il.line_subtotal_cents
   FROM invoice_lines il
   JOIN invoices i ON i.id = il.invoice_id
   WHERE i.invoice_number = '<INVOICE_NUMBER>';
   ```

3. **Inspect Audit Log for Modifications or Overrides**:
   ```sql
   SELECT action, actor_user_id, metadata, created_at, request_id
   FROM audit_events
   WHERE entity_type = 'invoice' AND entity_id = '<INVOICE_ID>'
   ORDER BY created_at ASC;
   ```

4. **Verify Tax & Discount Rules Active at Time of Generation**:
   Compare the effective dates and percentages of `applied_tax_rule_id` and `applied_discount_rule_id` recorded in `snapshot_breakdown`.
   - Tax Rule: Verify whether GST (18%) or standard rate was active on `issue_date`.
   - Discount Rule: Check if minimum threshold or coupon code expired prior to generation.

---

### 4. Remediation Procedure

#### Scenario A: Unpaid Draft or Confirmed Invoice (Customer Not Yet Charged)
If the invoice is in `draft` or `confirmed` status and no payment has been recorded:
1. Void / Cancel the incorrect invoice:
   ```bash
   curl -X POST "https://api.brightloop.internal/api/v1/invoices/{id}/cancel" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"reason": "Pricing rule rate adjustment required due to mismatch in discount configuration."}'
   ```
2. Correct the underlying product variant price, tax rate, or subscription line item.
3. Trigger re-generation of the invoice occurrence.

#### Scenario B: Sent or Partially Paid Invoice (Customer Already Notified/Charged)
1. Do not delete or cancel the original invoice.
2. If customer was overbilled:
   - Issue a Credit Memo / adjustment payment with method `other` and reference `CREDIT_MEMO_<ORIGINAL_INVOICE_NUM>`.
   - Reallocate or credit the customer's balance.
3. If customer was underbilled:
   - Issue an adjustment supplementary invoice for the difference.
4. Notify the customer billing contact with an itemized reconciliation summary.

