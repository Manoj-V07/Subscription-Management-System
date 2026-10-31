# Runbook 01: Failed Billing Run Resolution

## Severity: P1 (High)
## Audience: On-Call Site Reliability Engineers, Billing Operations, Finance Team

---

### 1. Trigger & Alert Condition
- An automated alert triggers when a scheduled billing sweep (`apps/worker/index.js` or `POST /api/v1/billing-runs`) finishes with `failed_count > 0` or terminates with an uncaught exception.
- Worker logs display: `[Worker] Billing run <RUN_NUM> completed: X succeeded, Y failed.`

---

### 2. Immediate Triage (First 5 Minutes)

1. **Verify Impact & Identify Failed Occurrences**:
   Query the billing occurrences queue for failed records:
   ```sql
   SELECT bo.id, bo.subscription_id, s.subscription_number, bo.idempotency_key, bo.retry_count, bo.last_error
   FROM billing_occurrences bo
   JOIN subscriptions s ON s.id = bo.subscription_id
   WHERE bo.status = 'failed'
   ORDER BY bo.updated_at DESC
   LIMIT 50;
   ```

2. **Categorize Root Cause**:
   - **Transient Network / DB Timeout**: Worker was unable to acquire database connection or transaction timed out.
   - **Data Validation / Schema Inconsistency**: Subscription lines missing valid product references, plan price currency mismatch, or negative quantity.
   - **Concurrency / Lock Contention**: Another worker thread was processing the same subscription occurrence simultaneously.

---

### 3. Step-by-Step Remediation Procedure

#### Scenario A: Transient Failures (Retryable)
The billing engine uses deterministic, unique idempotency keys:
`idempotency_key = sub_<UUID>_<period_start>_<period_end>`

Because invoice creation enforces `UNIQUE(idempotency_key)` and database transactions, retrying is strictly safe and cannot create duplicate invoices.

1. Trigger manual retry through the API:
   ```bash
   curl -X POST "https://api.brightloop.internal/api/v1/billing-occurrences/{id}/retry" \
     -H "Authorization: Bearer <ONCALL_TOKEN>" \
     -H "Content-Type: application/json"
   ```
2. Verify occurrence status transitions to `succeeded` and invoice is generated:
   ```sql
   SELECT id, status, invoice_id, retry_count FROM billing_occurrences WHERE id = '<OCCURRENCE_ID>';
   ```

#### Scenario B: Corrupted Subscription Configuration
1. Inspect the subscription and plan configuration:
   ```sql
   SELECT s.id, s.status, s.next_billing_at, p.interval, p.min_quantity
   FROM subscriptions s
   JOIN plans p ON p.id = s.plan_id
   WHERE s.id = '<SUBSCRIPTION_ID>';
   ```
2. If subscription has invalid dates or status, pause the subscription via admin endpoint:
   `POST /api/v1/subscriptions/{id}/pause`
3. Contact the account executive / customer support to fix subscription terms before resuming.

---

### 4. Verification & Recovery Confirmation
1. Verify no orphan occurrences remain in `pending` or `failed` state past the SLA window:
   ```sql
   SELECT COUNT(*) FROM billing_occurrences WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '12 hours';
   ```
2. Run accounting reconciliation verification:
   ```sql
   SELECT 
     SUM(grand_total_cents) AS total_invoiced,
     (SELECT COALESCE(SUM(amount_cents), 0) FROM payments) AS total_collected,
     SUM(balance_due_cents) AS total_owed
   FROM invoices WHERE status != 'cancelled';
   ```
   Confirm `total_invoiced = total_collected + total_owed`.

3. Send status report to `#finance-ops` Slack channel:
   - Billing Run Number
   - Total subscriptions processed
   - Failed subscriptions remediated
   - Final reconciliation status: GREEN

