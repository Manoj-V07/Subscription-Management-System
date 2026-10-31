# Runbook 03: Payment Over-Allocation & Duplicate Settlement

## Severity: P1 (High)
## Audience: Finance Operations, Customer Accounts, Site Reliability Engineers

---

### 1. Trigger & Alert Condition
- Customer reports a double charge or duplicate bank wire transfer (NEFT/RTGS).
- Finance reconciliation alert triggers: `Total Payments Allocated > Grand Total Cents` or an unhandled constraint exception occurs during payment ingestion.
- API returns `400 PAYMENT_EXCEEDS_BALANCE` ("Payment amount exceeds remaining balance due").

---

### 2. Immediate Containment (First 5 Minutes)

1. **Query Payment & Allocation Ledger for the Affected Customer**:
   ```sql
   SELECT p.payment_number, p.invoice_id, p.method, p.amount_cents, p.received_date, p.external_reference, p.created_at
   FROM payments p
   WHERE p.customer_id = '<CUSTOMER_ID>'
   ORDER BY p.created_at DESC
   LIMIT 10;
   ```

2. **Check Invoice Outstanding Balance & Existing Allocations**:
   ```sql
   SELECT 
     i.invoice_number, 
     i.grand_total_cents, 
     i.balance_due_cents, 
     i.status,
     COALESCE(SUM(pa.amount_cents), 0) AS total_allocated
   FROM invoices i
   LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
   WHERE i.id = '<INVOICE_ID>'
   GROUP BY i.id;
   ```

3. **Verify Over-Payment Protection**:
   Confirm the API constraint properly rejected excess allocation:
   The application logic in `apps/api/src/routes/payments.js` strictly checks:
   `if (amountCents > invoice.balance_due_cents) throw 400 PAYMENT_EXCEEDS_BALANCE`
   Ensure no manual SQL update or bypass allowed balance due to go below 0.

---

### 3. Step-by-Step Resolution Workflow

#### Scenario A: Duplicate Ingestion (Customer Wire Arrived Twice in Application)
If a webhook or batch CSV import recorded the same bank UTR twice:
1. Verify bank account statement to confirm whether funds were physically received twice or if it was an internal recording error.
2. If funds were physically received twice:
   - Option 1 (Customer Account Credit): Leave payment as unallocated credit or allocate toward upcoming subscription renewal.
   - Option 2 (Refund): Execute bank wire reversal through corporate banking portal. Record refund adjustment note with reference `REFUND_<UTR_NUMBER>` and method `bank_transfer`.
3. If internal duplicate recording error (funds received once, recorded twice):
   - In a transaction, record an audit event explaining the administrative correction.
   - Adjust erroneous duplicate record and restore invoice balance.

#### Scenario B: Accidental Over-Payment by Customer
1. If customer paid more than due via uncoordinated cheque/wire:
   - Allocate up to the exact `balance_due_cents`. Invoice status transitions to `paid` and `balance_due_cents = 0`.
   - The remaining surplus is recorded in the customer's unallocated funds ledger.
   - Notify the customer contact with receipt confirmation and options (apply to next invoice or refund).

---

### 4. Post-Resolution Verification
Run the standard Brightloop accounting reconciliation equation:
```bash
npm run test:unit
```
Ensure `Total Invoiced = Collected + Owed` holds with zero discrepancy across all customer accounts.

